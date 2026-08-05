// tests/rbac.test.js
const request = require("supertest");
const app = require("../../app");
const { generateMockToken } = require("../helpers"); // Use your project helpers

describe("RBAC and Authorization Controls", () => {
  
  it("should forbid STAFF from deleting a participant (Admin-only action)", async () => {
    const staffToken = generateMockToken({ systemRole: "STAFF" });

    const res = await request(app)
      .delete("/api/v1/participants/123e4567-e89b-12d3-a456-426614174000")
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.statusCode).toEqual(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual("FORBIDDEN");
  });

  it("should allow EVENT_MANAGER or ADMIN to execute queue transfers", async () => {
    const managerToken = generateMockToken({ systemRole: "EVENT_MANAGER" });

    const res = await request(app)
      .patch("/api/v1/queues/123e4567-e89b-12d3-a456-426614174000/advance")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        toStationId: "123e4567-e89b-12d3-a456-426614174001",
        reason: "Proceed to next screening station",
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("completed");
    expect(res.body).toHaveProperty("nextEntry");
  });

});
