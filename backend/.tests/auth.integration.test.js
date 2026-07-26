const request = require("supertest");

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
    expect(response.headers["set-cookie"].join(" ")).toContain("Secure");
    expect(response.headers["set-cookie"].join(" ")).toContain("HttpOnly");
    expect(response.headers["set-cookie"].find((cookie) => cookie.startsWith("vsms_csrf=") && !cookie.split(";", 1)[0].endsWith("="))).toContain("Path=/;");
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

  test("development serves the OpenAPI document and Swagger UI", async () => {
    const document = await request(app).get("/api-docs/openapi.json");
    const ui = await request(app).get("/api-docs/");
    expect(document.status).toBe(200);
    expect(document.body.openapi).toBe("3.0.3");
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('id="swagger-ui"');
  });
});
