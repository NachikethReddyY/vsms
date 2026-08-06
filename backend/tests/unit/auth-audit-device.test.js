const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuthAuditLog } = require("../../utils/audit");

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "99999999-9999-4999-8999-999999999999";
const deviceId = "22222222-2222-4222-8222-222222222222";
const context = {
    deviceId,
    deviceName: "Event tablet",
    requestId: "33333333-3333-4333-8333-333333333333",
    ipAddress: "203.0.113.10",
};

function auditClient({ findUnique = async () => null, findFirst = async () => null, create } = {}) {
    const calls = { findUnique: [], findFirst: [], create: [] };
    let record;
    return {
        calls,
        get record() { return record; },
        device: {
            findUnique: async (args) => { calls.findUnique.push(args); return findUnique(args); },
            findFirst: async (args) => { calls.findFirst.push(args); return findFirst(args); },
            create: async (args) => {
                calls.create.push(args);
                return create ? create(args) : { id: deviceId, userId, status: "ACTIVE" };
            },
        },
        authAuditLog: { create: async ({ data }) => { record = data; return data; } },
    };
}

const recordLogin = (client, overrides = {}) => createAuthAuditLog({
    userId,
    eventType: "LOGIN_SUCCESS",
    outcome: "SUCCESS",
    context,
    client,
    ...overrides,
});

test("a successful authenticated login enrolls a first-seen device", async () => {
    const client = auditClient();
    await recordLogin(client);

    assert.equal(client.calls.create.length, 1);
    assert.deepEqual(client.calls.create[0].data, {
        id: deviceId,
        userId,
        deviceName: "Event tablet",
        lastSeenAt: client.calls.create[0].data.lastSeenAt,
    });
    assert.ok(client.calls.create[0].data.lastSeenAt instanceof Date);
    assert.equal(client.record.deviceId, deviceId);
});

test("a repeat login accepts the existing active owned device without writing it", async () => {
    const client = auditClient({ findUnique: async () => ({ id: deviceId, userId, status: "ACTIVE" }) });
    await recordLogin(client);

    assert.equal(client.calls.findUnique.length, 1);
    assert.equal(client.calls.create.length, 0);
    assert.equal(client.record.deviceId, deviceId);
});

test("a concurrent enrollment uniqueness race re-reads ownership", async () => {
    const existing = [null, { id: deviceId, userId, status: "ACTIVE" }];
    const client = auditClient({
        findUnique: async () => existing.shift(),
        create: async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); },
    });
    await recordLogin(client);

    assert.equal(client.calls.findUnique.length, 2);
    assert.equal(client.calls.create.length, 1);
    assert.equal(client.record.deviceId, deviceId);
});

test("foreign and inactive devices are never reassigned", async () => {
    for (const existing of [
        { id: deviceId, userId: otherUserId, status: "ACTIVE" },
        { id: deviceId, userId, status: "INACTIVE" },
    ]) {
        const client = auditClient({ findUnique: async () => existing });
        await recordLogin(client);
        assert.equal(client.calls.create.length, 0);
        assert.equal(client.record.deviceId, null);
    }
});

test("failed logins and malformed identifiers cannot enroll devices", async () => {
    for (const [eventType, suppliedContext] of [
        ["LOGIN_FAILED", context],
        ["LOGIN_SUCCESS", { ...context, deviceId: "not-a-uuid" }],
    ]) {
        const client = auditClient();
        await recordLogin(client, { eventType, context: suppliedContext });
        assert.equal(client.calls.create.length, 0);
        assert.equal(client.record.deviceId, null);
    }
});
