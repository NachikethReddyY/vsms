const request = require("supertest");
const app = require("../app");

describe("Rate Limiter Integration Tests", () => {
  it("should return 429 Too Many Requests after threshold is breached", async () => {
    const endpoint = "/api/v1/verify"; // Target your rate-limited route
    let res;

    for (let i = 0; i < 55; i++) {
      res = await request(app).post(endpoint).send({ code: "123456" });
    }

    expect(res.statusCode).toEqual(429);
    expect(res.body.error).toEqual("TOO_MANY_REQUESTS");
  });
});