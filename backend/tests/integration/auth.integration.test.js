const { test, describe, before, after } = require("node:test");
const { expect } = require("expect");
const request = require("supertest");
const helpers = require("../helpers");

const app = require("../../app");
let manager;
let managerToken;

before(async () => {
  manager = await helpers.ensureTestUser("EVENT_MANAGER", "auth-event-manager");
  managerToken = helpers.accessTokenFor(manager);
});

after(async () => helpers.prisma.$disconnect());

describe("Cognito authentication boundary", () => {
  test("a verified Cognito access token resolves only the approved local role", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(expect.objectContaining({
      id: manager.id,
      email: manager.email,
      roles: ["EVENT_MANAGER"],
      systemRole: "EVENT_MANAGER",
    }));
    expect(JSON.stringify(response.body)).not.toContain(managerToken);
  });

  test("unverified and locally disabled identities are rejected generically", async () => {
    const invalid = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer not.a.cognito-token");
    expect(invalid.status).toBe(401);
    expect(invalid.body.code).toBe("INVALID_SESSION");

    await helpers.prisma.user.update({ where: { id: manager.id }, data: { status: "DISABLED", accessState: "DISABLED" } });
    const disabled = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(disabled.status).toBe(401);
    expect(disabled.body.code).toBe("INVALID_SESSION");
    await helpers.prisma.user.update({ where: { id: manager.id }, data: { status: "ACTIVE", accessState: "ENABLED" } });
  });

  test("cookie mutations require same-origin double-submit CSRF while bearer mutations bypass it", async () => {
    const denied = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", "vsms_csrf=csrf-value");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INVALID_ORIGIN");

    const allowedCookie = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "https://localhost:5173")
      .set("Sec-Fetch-Site", "same-origin")
      .set("X-CSRF-Token", "csrf-value")
      .set("Cookie", "vsms_csrf=csrf-value");
    expect(allowedCookie.status).toBe(200);

    const allowedBearer = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(allowedBearer.status).toBe(200);
  });

  test("local password and public signup endpoints are not part of the Cognito surface", async () => {
    const login = await request(app).post("/api/v1/auth/login")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ identifier: manager.email, password: "irrelevant" });
    const signup = await request(app).post("/api/v1/auth/signup")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ email: "x@y.test", password: "irrelevant" });
    expect(login.status).toBe(404);
    expect(signup.status).toBe(404);
  });

  test("Cognito configuration and authorization-code PKCE entry point are exposed", async () => {
    const status = await request(app).get("/api/v1/auth/config-status");
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(true);
    expect(status.body.supportedRoles).toEqual(expect.arrayContaining([
      "ADMINISTRATOR", "EVENT_MANAGER", "REGISTRATION_OFFICER", "SCREENER", "REVIEWER", "SUPPORT",
    ]));

    const authorize = await request(app).get("/api/v1/auth/authorize?returnTo=%2Fevents");
    expect(authorize.status).toBe(302);
    expect(authorize.headers.location).toContain("response_type=code");
    expect(authorize.headers.location).toContain("code_challenge_method=S256");
    expect(authorize.headers["set-cookie"].join(" ")).toMatch(/vsms_oauth_state=.*HttpOnly.*Secure/);
  });

  test("user listing is not public", async () => {
    expect((await request(app).get("/api/v1/users")).status).toBe(401);
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
