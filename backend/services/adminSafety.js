const AppError = require("../errors/AppError");

const FINAL_ADMIN_LOCK_KEY = 868493827451n;

const administratorWhere = {
  status: "ACTIVE",
  approvalState: "APPROVED",
  accessState: "ENABLED",
  deprovisionedAt: null,
  userRoles: { some: { role: { roleName: "ADMINISTRATOR" } } },
};

// Lock order for every account mutation is account-specific first, then the
// shared final-administrator lock when that invariant is relevant.
async function lockAccountTransition(tx, userId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 7349281))`;
}

async function lockFinalAdministratorTransition(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FINAL_ADMIN_LOCK_KEY})`;
}

async function assertAdministratorRemains(tx, { currentIsAdministrator, nextIsAdministrator }) {
  if (!currentIsAdministrator || nextIsAdministrator) return;
  await lockFinalAdministratorTransition(tx);
  const count = await tx.user.count({ where: administratorWhere });
  if (count <= 1) {
    throw new AppError(422, "LAST_ADMIN_CHANGE_BLOCKED", "Keep at least one active administrator account");
  }
}

module.exports = {
  FINAL_ADMIN_LOCK_KEY,
  administratorWhere,
  assertAdministratorRemains,
  lockAccountTransition,
  lockFinalAdministratorTransition,
};
