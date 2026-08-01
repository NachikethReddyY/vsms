const request = require("supertest");
const jwt = require("jsonwebtoken");

let app;
let helpers;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOCAL_HTTPS = "false";
  process.env.PUBLIC_SIGNUP_ENABLED = "false";
  process.env.JWT_ACCESS_SECRET = "test-only-access-secret-with-at-least-thirty-two-characters";
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
  process.env.DATABASE_URL = url.toString();
  app = require("../app");
  helpers = require("./helpers");
  await helpers.ensureTestUser("EVENT_MANAGER");
});

afterAll(async () => helpers.prisma.$disconnect());

describe("authentication boundary", () => {
  test("login issues a short-lived memory-token response without exposing a refresh token", async () => {
    const response = await request(app)
      .post("/auth/login")
      .set("Origin", "https://localhost:5173")
      .send({ identifier: "test-event-manager", password: helpers.PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toBeUndefined();
    expect(response.body.csrfToken).toEqual(expect.any(String));
    const cookies = response.headers["set-cookie"];
    const refreshCookie = cookies.find((cookie) => cookie.startsWith("vsms_refresh=") && !cookie.includes("Max-Age=0"));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("vsms_csrf=") && !cookie.includes("Max-Age=0"));
    const legacyClear = cookies.find((cookie) => cookie.startsWith("vsms_csrf=") && cookie.includes("Expires=Thu, 01 Jan 1970") && cookie.includes("Path=/auth"));
    expect(refreshCookie).toContain("Path=/auth");
    expect(refreshCookie).toContain("HttpOnly");
    expect(refreshCookie).toContain("Secure");
    expect(refreshCookie).toContain("SameSite=Strict");
    expect(csrfCookie).toContain("Path=/");
    expect(csrfCookie).toContain("Secure");
    expect(csrfCookie).toContain("SameSite=Strict");
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(legacyClear).toBeDefined();
  });

  test("concurrent refresh reuse revokes the winning replacement family", async () => {
    const login = await request(app)
      .post("/auth/login")
      .set("Origin", "https://localhost:5173")
      .send({ identifier: "test-event-manager", password: helpers.PASSWORD });
    const rotate = () => request(app)
      .post("/auth/refresh")
      .set("Origin", "https://localhost:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-CSRF-Token", login.body.csrfToken)
      .set("Cookie", helpers.cookieHeader(login));
    const responses = await Promise.all([rotate(), rotate()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);

    const winner = responses.find((response) => response.status === 200);
    const afterReuse = await request(app)
      .post("/auth/refresh")
      .set("Origin", "https://localhost:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-CSRF-Token", winner.body.csrfToken)
      .set("Cookie", helpers.cookieHeader(winner));
    expect(afterReuse.status).toBe(401);
  });

  test("invalid credentials remain generic and signup is unavailable", async () => {
    const invalid = await request(app).post("/auth/login").send({ identifier: "nobody", password: "Wrong-Password-Value!" });
    const signup = await request(app).post("/auth/signup").send({ email: "x@y.test", password: helpers.PASSWORD });
    expect(invalid.status).toBe(401);
    expect(invalid.body.code).toBe("INVALID_CREDENTIALS");
    expect(signup.status).toBe(404);
  });

  test("user listing is not public", async () => {
    expect((await request(app).get("/users")).status).toBe(401);
  });

  test("credentialed CORS allows both exact local origins and rejects others", async () => {
    for (const origin of ["https://localhost:5173", "https://127.0.0.1:5173"]) {
      const response = await request(app)
        .options("/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
    }

    const rejected = await request(app)
      .options("/auth/login")
      .set("Origin", "https://attacker.example")
      .set("Access-Control-Request-Method", "POST");
    expect(rejected.status).toBe(403);
  });

  test("event APIs reject anonymous and invalid JWT claims", async () => {
    expect((await request(app).get("/api/events")).status).toBe(401);
    expect((await request(app).post("/api/events").send({})).status).toBe(401);

    const user = await helpers.ensureTestUser("EVENT_MANAGER");
    const wrongAudience = jwt.sign({ type: "access" }, process.env.JWT_ACCESS_SECRET, {
      algorithm: "HS256",
      subject: user.userId,
      issuer: "vsms-api",
      audience: "wrong-audience",
      expiresIn: "15m",
    });
    expect((await request(app).get("/api/events").set("Authorization", `Bearer ${wrongAudience}`)).status).toBe(401);

    const invalidTokens = [
      jwt.sign({ type: "access" }, process.env.JWT_ACCESS_SECRET, { algorithm: "HS256", subject: user.userId, issuer: "wrong", audience: "vsms-dashboard", expiresIn: "15m" }),
      jwt.sign({ type: "refresh" }, process.env.JWT_ACCESS_SECRET, { algorithm: "HS256", subject: user.userId, issuer: "vsms-api", audience: "vsms-dashboard", expiresIn: "15m" }),
      jwt.sign({ type: "access" }, process.env.JWT_ACCESS_SECRET, { algorithm: "HS256", subject: user.userId, issuer: "vsms-api", audience: "vsms-dashboard", expiresIn: -1 }),
      jwt.sign({ type: "access" }, "wrong-signing-secret-with-at-least-thirty-two-characters", { algorithm: "HS256", subject: user.userId, issuer: "vsms-api", audience: "vsms-dashboard", expiresIn: "15m" }),
    ];
    for (const token of invalidTokens) {
      expect((await request(app).get("/api/events").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    }
  });

  test("refresh and logout reject missing, mismatched, and cross-site CSRF proof", async () => {
    const login = await request(app).post("/auth/login").set("Origin", "https://localhost:5173").send({ identifier: "test-event-manager", password: helpers.PASSWORD });
    const cookies = helpers.cookieHeader(login);
    expect((await request(app).post("/auth/refresh").set("Cookie", cookies).set("X-CSRF-Token", login.body.csrfToken)).status).toBe(403);
    expect((await request(app).post("/auth/refresh").set("Origin", "https://localhost:5173").set("Cookie", cookies)).status).toBe(403);
    expect((await request(app).post("/auth/refresh").set("Origin", "https://localhost:5173").set("Cookie", cookies).set("X-CSRF-Token", "wrong-token")).status).toBe(403);
    expect((await request(app).post("/auth/logout").set("Origin", "https://localhost:5173").set("Sec-Fetch-Site", "cross-site").set("Cookie", cookies).set("X-CSRF-Token", login.body.csrfToken)).status).toBe(403);
  });

  test("QR route parameters are validated after authentication", async () => {
    const login = await request(app)
      .post("/auth/login")
      .set("Origin", "https://localhost:5173")
      .send({ identifier: "test-event-manager", password: helpers.PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    expect((await request(app).post("/api/qr/generate/not-a-uuid").set(auth)).status).toBe(422);
    expect((await request(app).post("/api/qr/resolve").set(auth).send({ token: "not-a-token" })).status).toBe(422);
  });
});
