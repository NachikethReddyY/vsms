const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuthAuditLog } = require("../utils/audit");

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";

function auditClient(findFirst) {
    const calls = [];
    let record;
    return {
        calls,
        get record() { return record; },
        device: { findFirst: async (args) => { calls.push(args); return findFirst(args); } },
        authAuditLog: { create: async ({ data }) => { record = data; return data; } },
    };
}

test("auth auditing records only an active device owned by the audited user", async () => {
    const client = auditClient(async () => ({ id: deviceId }));
    await createAuthAuditLog({
        userId,
        eventType: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        context: { deviceId, requestId: "33333333-3333-4333-8333-333333333333", ipAddress: "203.0.113.10" },
        client,
    });

    assert.deepEqual(client.calls, [{ where: { id: deviceId, userId, status: "ACTIVE" }, select: { id: true } }]);
    assert.equal(client.record.deviceId, deviceId);
});

test("auth auditing ignores unknown, foreign, inactive, and malformed device identifiers", async () => {
    for (const suppliedDeviceId of [deviceId, "not-a-uuid"]) {
        const client = auditClient(async () => null);
        await createAuthAuditLog({
            userId,
            eventType: "LOGIN_FAILED",
            outcome: "FAILED",
            context: { deviceId: suppliedDeviceId, requestId: "33333333-3333-4333-8333-333333333333" },
            client,
        });
        assert.equal(client.record.deviceId, null);
        assert.equal(client.calls.length, suppliedDeviceId === "not-a-uuid" ? 0 : 1);
    }
});
