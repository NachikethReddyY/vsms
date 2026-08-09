const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const prisma = require("../../prisma/prismaClient");
const { lockAccountTransition, lockFinalAdministratorTransition } = require("../../services/account/adminSafety");
const accountService = require("../../services/account/accountService");
const userService = require("../../services/account/userService");
const {
  enqueueProviderOperation,
  processProviderOperation,
  maintainProviderOperation,
  drainDueProviderOperations,
} = require("../../services/account/accountProviderOperationService");

test("final-administrator advisory lock serializes concurrent transactions", async () => {
  let releaseFirst;
  let firstLocked;
  const firstLockedPromise = new Promise((resolve) => { firstLocked = resolve; });
  const releasePromise = new Promise((resolve) => { releaseFirst = resolve; });
  let secondLocked = false;

  const first = prisma.$transaction(async (tx) => {
    await lockFinalAdministratorTransition(tx);
    firstLocked();
    await releasePromise;
  }, { timeout: 5000 });
  await firstLockedPromise;

  const second = prisma.$transaction(async (tx) => {
    await lockFinalAdministratorTransition(tx);
    secondLocked = true;
  }, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(secondLocked, false);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondLocked, true);
});

test("account-specific advisory lock serializes transitions for the same account", async () => {
  const accountId = crypto.randomUUID();
  let releaseFirst;
  let firstLocked;
  const firstLockedPromise = new Promise((resolve) => { firstLocked = resolve; });
  const releasePromise = new Promise((resolve) => { releaseFirst = resolve; });
  let secondLocked = false;
  const first = prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, accountId);
    firstLocked();
    await releasePromise;
  });
  await firstLockedPromise;
  const second = prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, accountId);
    secondLocked = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(secondLocked, false);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondLocked, true);
});

test("account approval decisions reject direct updates and deletes", async () => {
  const attemptMutation = (operation) => prisma.$transaction(async (tx) => {
    const actor = await tx.user.create({
      data: { fullName: "Decision Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
    });
    const account = await tx.user.create({
      data: { fullName: "Decision Subject", email: `${crypto.randomUUID()}@test.local` },
    });
    const decision = await tx.accountApprovalDecision.create({
      data: { userId: account.id, decision: "REJECTED", decidedById: actor.id, reason: "Test rejection" },
    });
    if (operation === "update") {
      await tx.$executeRaw`UPDATE "account_approval_decisions" SET "reason" = 'changed' WHERE "approval_decision_id" = ${decision.id}::uuid`;
    } else {
      await tx.$executeRaw`DELETE FROM "account_approval_decisions" WHERE "approval_decision_id" = ${decision.id}::uuid`;
    }
  });

  await assert.rejects(attemptMutation("update"), /account approval decisions are immutable/);
  await assert.rejects(attemptMutation("delete"), /account approval decisions are immutable/);
});

test("concurrent approve and reject transitions serialize to a coherent rejected state", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Concurrent Decision Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: { fullName: "Concurrent Decision Subject", email: `${crypto.randomUUID()}@test.local`, status: "INACTIVE" },
  });

  const outcomes = await Promise.allSettled([
    accountService.decideApproval(account.id, "APPROVED", null, actor.id, {}),
    accountService.decideApproval(account.id, "REJECTED", "Concurrent rejection", actor.id, {}),
  ]);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
  const decisions = await prisma.accountApprovalDecision.findMany({ where: { userId: account.id } });

  assert.equal(outcomes.some(({ status }) => status === "fulfilled"), true);
  assert.equal(saved.approvalState, "REJECTED");
  assert.equal(saved.accessState, "ENABLED");
  assert.equal(saved.status, "INACTIVE");
  assert.ok(decisions.length >= 1 && decisions.length <= 2);
});

test("reactivate and deprovision serialize without reviving a deprovisioned account", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Concurrent Access Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: {
      fullName: "Concurrent Access Subject",
      email: `${crypto.randomUUID()}@test.local`,
      approvalState: "APPROVED",
      accessState: "SUSPENDED",
      status: "SUSPENDED",
    },
  });

  const outcomes = await Promise.allSettled([
    accountService.changeAccess(account.id, "reactivate", null, actor.id, {}, {
      providerOverrides: {
        synchronize: async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }),
      },
    }),
    accountService.deprovision(account.id, "Concurrent deprovision", actor.id, {}, {
      providerOverrides: { disableAndRevoke: async () => ({ managed: true }) },
    }),
  ]);
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });

  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal(saved.accessState, "DISABLED");
  assert.equal(saved.status, "DISABLED");
  assert.ok(saved.deprovisionedAt);
});

test("deprovision commits its lifecycle outbox with the account transition and rolls both back on enqueue failure", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Deprovision Outbox Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: { fullName: "Deprovision Outbox Subject", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED", accessState: "ENABLED", status: "ACTIVE" },
  });
  await assert.rejects(accountService.deprovision(account.id, "Transaction test", actor.id, {}, {
    enqueue: async () => { throw new Error("outbox insert failed"); },
  }), /outbox insert failed/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).accessState, "ENABLED");
  assert.equal(await prisma.lifecycleEmailOutbox.count({ where: { userId: account.id, purpose: "DEPROVISIONED" } }), 0);

  await accountService.deprovision(account.id, "Transaction test", actor.id, {}, {
    providerOverrides: { disableAndRevoke: async () => null },
  });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).accessState, "DISABLED");
  assert.equal(await prisma.lifecycleEmailOutbox.count({ where: { userId: account.id, purpose: "DEPROVISIONED", status: "QUEUED" } }), 1);
});

test("provider failure is durable and repeating suspend retries the same operation", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Provider Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: {
      fullName: "Provider Subject",
      email: `${crypto.randomUUID()}@test.local`,
      approvalState: "APPROVED",
      accessState: "ENABLED",
      status: "ACTIVE",
    },
  });

  const deferred = await accountService.changeAccess(account.id, "suspend", "Security response", actor.id, {}, {
    providerOverrides: { revoke: async () => { throw new Error("provider unavailable"); } },
  });
  assert.equal(deferred.providerOperation.pending, true);
  assert.equal(deferred.providerOperation.status, "FAILED");
  assert.equal(deferred.providerOperation.reason, "RETRY_QUEUED");
  const failed = await prisma.accountProviderOperation.findFirstOrThrow({ where: { userId: account.id } });
  const suspended = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.nextAttemptAt > failed.updatedAt);
  assert.equal(suspended.accessState, "SUSPENDED");
  assert.equal(suspended.status, "SUSPENDED");

  await accountService.changeAccess(account.id, "suspend", "Retry security response", actor.id, {}, {
    providerOverrides: { revoke: async () => ({ managed: true }) },
  });
  const retried = await prisma.accountProviderOperation.findUniqueOrThrow({ where: { id: failed.id } });
  assert.equal(retried.status, "SUCCEEDED");
  assert.equal(retried.attemptCount, 2);
});

test("pending and rejected accounts cannot use reactivate as an approval bypass", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Transition Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  for (const approvalState of ["PENDING", "REJECTED"]) {
    const account = await prisma.user.create({
      data: {
        fullName: `${approvalState} Transition Subject`,
        email: `${crypto.randomUUID()}@test.local`,
        approvalState,
        accessState: "SUSPENDED",
        status: "SUSPENDED",
      },
    });
    await assert.rejects(
      accountService.changeAccess(account.id, "reactivate", null, actor.id, {}),
      (error) => error.code === "ACCOUNT_NOT_APPROVED",
    );
  }
});

test("admin-created inactive accounts remain recoverable through explicit reactivate", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Dormant Account Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const role = await prisma.role.upsert({
    where: { roleName: "SUPPORT" },
    update: {},
    create: { roleName: "SUPPORT" },
  });
  const created = await userService.createUser({
    fullName: "Dormant Account",
    email: `${crypto.randomUUID()}@test.local`,
    employeeNumber: `D-${crypto.randomUUID().slice(0, 12)}`,
    department: null,
    designation: null,
    status: "INACTIVE",
    roles: [role.roleName],
  }, actor.id, {}, async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }), async () => {});

  assert.equal(created.approvalState, "APPROVED");
  assert.equal(created.accessState, "ENABLED");
  assert.equal(created.status, "INACTIVE");

  const reactivated = await accountService.changeAccess(created.id, "reactivate", "Approved activation", actor.id, {}, {
    providerOverrides: {
      synchronize: async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }),
    },
  });
  assert.equal(reactivated.approvalState, "APPROVED");
  assert.equal(reactivated.accessState, "ENABLED");
  assert.equal(reactivated.status, "ACTIVE");
});

test("a stale provider worker cannot leave older desired state authoritative", async () => {
  const account = await prisma.user.create({
    data: { fullName: "Provider Fence Subject", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const [older, newer] = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    const first = await enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "SYNC_ACCESS",
      idempotencyKey: `FENCE-OLD:${account.id}`,
      payload: { roles: ["SUPPORT"], status: "ACTIVE" },
    });
    const second = await enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "SYNC_ACCESS",
      idempotencyKey: `FENCE-NEW:${account.id}`,
      payload: { roles: ["REVIEWER"], status: "ACTIVE" },
    });
    return [first, second];
  });

  let now = new Date("2026-08-06T12:00:00.000Z");
  let releaseStale;
  let staleEntered;
  const releaseStalePromise = new Promise((resolve) => { releaseStale = resolve; });
  const staleEnteredPromise = new Promise((resolve) => { staleEntered = resolve; });
  let providerCalls = 0;
  let providerRole = null;
  const synchronize = async ({ roles }) => {
    providerCalls += 1;
    if (providerCalls === 1) {
      staleEntered();
      await releaseStalePromise;
    }
    providerRole = roles[0];
    return { managed: false, cognitoSub: null, compensate: async () => {} };
  };
  const overrides = { synchronize, now: () => now, leaseMs: 100 };

  const staleWorker = processProviderOperation(older.id, overrides);
  await staleEnteredPromise;
  now = new Date(now.getTime() + 200);
  await processProviderOperation(older.id, overrides);
  await processProviderOperation(newer.id, overrides);
  assert.equal(providerRole, "REVIEWER");
  releaseStale();
  await staleWorker;

  assert.equal(providerRole, "REVIEWER");
  assert.equal(providerCalls, 4);
  const operations = await prisma.accountProviderOperation.findMany({
    where: { userId: account.id },
    orderBy: { generation: "asc" },
  });
  assert.deepEqual(operations.map(({ generation }) => generation), [1, 2, 3]);
  assert.equal(operations.at(-1).status, "SUCCEEDED");
});

test("due-operation drain is bounded, reports owned leases, backs off, and escalates", async () => {
  const account = await prisma.user.create({
    data: { fullName: "Provider Drain Subject", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const operation = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `DRAIN:${account.id}`,
    });
  });
  let release;
  let entered;
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const activeWorker = processProviderOperation(operation.id, {
    revoke: async () => { entered(); await releasePromise; },
  });
  await enteredPromise;
  const owned = await processProviderOperation(operation.id, { revoke: async () => {} });
  assert.equal(owned.pending, true);
  assert.equal(owned.reason, "LEASE_OWNED");
  release();
  await activeWorker;

  const failing = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `ESCALATE:${account.id}`,
    });
  });
  await assert.rejects(processProviderOperation(failing.id, {
    revoke: async () => { throw new Error("unavailable"); },
    maxAttempts: 1,
  }));
  assert.equal((await prisma.accountProviderOperation.findUniqueOrThrow({ where: { id: failing.id } })).status, "ESCALATED");

  const due = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `DUE:${account.id}`,
    });
  });
  const summary = await drainDueProviderOperations({ limit: 1 }, { userId: account.id, revoke: async () => {} });
  assert.equal(summary.attempted, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.operations[0].id, due.id);
});

test("account service reports queued provider work while an older generation owns its lease", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Queued State Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: {
      fullName: "Queued State Subject",
      email: `${crypto.randomUUID()}@test.local`,
      approvalState: "APPROVED",
      accessState: "SUSPENDED",
      status: "SUSPENDED",
    },
  });
  const older = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `OWNED:${account.id}`,
    });
  });
  let release;
  let entered;
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const worker = processProviderOperation(older.id, {
    revoke: async () => { entered(); await releasePromise; },
  });
  await enteredPromise;

  const reactivated = await accountService.changeAccess(account.id, "reactivate", null, actor.id, {}, {
    providerOverrides: {
      synchronize: async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }),
    },
  });
  assert.equal(reactivated.status, "ACTIVE");
  assert.equal(reactivated.providerOperation.pending, true);
  assert.equal(reactivated.providerOperation.status, "PENDING");
  assert.equal(reactivated.providerOperation.reason, "OLDER_GENERATION_PENDING");

  release();
  await worker;
  await processProviderOperation(reactivated.providerOperation.id, {
    synchronize: async () => ({ managed: false, cognitoSub: null, compensate: async () => {} }),
  });
});

test("administrators requeue escalated provider work as a new ordered generation and resolve with evidence", async () => {
  const actor = await prisma.user.create({
    data: { fullName: "Provider Maintenance Actor", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const account = await prisma.user.create({
    data: { fullName: "Provider Maintenance Subject", email: `${crypto.randomUUID()}@test.local`, approvalState: "APPROVED" },
  });
  const escalated = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `MAINTAIN:${account.id}`,
    });
  });
  await assert.rejects(processProviderOperation(escalated.id, {
    revoke: async () => { throw new Error("provider unavailable"); },
    maxAttempts: 1,
  }));

  const requeueReason = "Provider outage ended; retry authorized";
  const requeued = await maintainProviderOperation(
    escalated.id,
    "REQUEUE",
    requeueReason,
    actor.id,
    {},
    { providerOverrides: { revoke: async () => {} } },
  );
  assert.equal(requeued.operation.status, "RESOLVED");
  assert.equal(requeued.operation.resolutionReason, requeueReason);
  assert.equal(requeued.operation.attemptCount, 1);
  assert.ok(requeued.operation.lastErrorCode);
  assert.equal(requeued.requeuedOperation.generation, escalated.generation + 1);
  assert.equal(requeued.requeuedOperation.status, "SUCCEEDED");
  assert.equal(requeued.providerOperation.pending, false);

  const second = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `RESOLVE:${account.id}`,
    });
  });
  await assert.rejects(processProviderOperation(second.id, {
    revoke: async () => { throw new Error("identity removed externally"); },
    maxAttempts: 1,
  }));
  const resolutionReason = "Identity was removed directly in Cognito";
  const resolved = await maintainProviderOperation(second.id, "RESOLVE", resolutionReason, actor.id, {});
  assert.equal(resolved.operation.status, "RESOLVED");
  assert.equal(resolved.operation.resolutionReason, resolutionReason);
  assert.equal(resolved.operation.attemptCount, 1);
  assert.ok(resolved.operation.lastErrorCode);

  const audits = await prisma.auditLog.findMany({
    where: {
      entityId: { in: [escalated.id, second.id] },
      action: { in: ["ACCOUNT_PROVIDER_OPERATION_REQUEUED", "ACCOUNT_PROVIDER_OPERATION_RESOLVED"] },
    },
  });
  assert.equal(audits.length, 2);
  assert.ok(audits.some(({ newValue }) => newValue.resolutionReason === requeueReason));
  assert.ok(audits.some(({ newValue }) => newValue.resolutionReason === resolutionReason));

  const superseded = await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    return enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `SUPERSEDED:${account.id}`,
    });
  });
  await assert.rejects(processProviderOperation(superseded.id, {
    revoke: async () => { throw new Error("provider unavailable"); },
    maxAttempts: 1,
  }));
  await prisma.$transaction(async (tx) => {
    await lockAccountTransition(tx, account.id);
    await enqueueProviderOperation(tx, {
      userId: account.id,
      operationType: "GLOBAL_SIGN_OUT",
      idempotencyKey: `NEWER:${account.id}`,
    });
  });
  await assert.rejects(
    maintainProviderOperation(superseded.id, "REQUEUE", "Retry the stale provider operation", actor.id, {}),
    (error) => error.code === "PROVIDER_OPERATION_SUPERSEDED",
  );
});
