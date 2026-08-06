const AppError = require("../errors/AppError");

const ACCOUNT_LOCK_THRESHOLD = 5;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Defense-in-depth lockout guard. Password verification and account takeover
 * prevention live in Cognito; the local `failedLoginAttempts` / `lockedUntil`
 * columns remain an enforcement backstop for local session issuance.
 */
function isAccountLocked(user) {
    return Boolean(user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

function remainingLockSeconds(user) {
    const ms = new Date(user.lockedUntil).getTime() - Date.now();
    return Math.max(1, Math.ceil(ms / 1000));
}

function assertAccountUnlocked(user) {
    if (isAccountLocked(user)) {
        throw new AppError(423, "ACCOUNT_LOCKED", "Account is temporarily locked due to repeated failed sign-in attempts", {
            retryAfterSeconds: remainingLockSeconds(user),
        });
    }
}

async function recordFailedLogin(prisma, userId) {
    const user = await prisma.user.update({
        where: { id: userId },
        data: {
            failedLoginAttempts: { increment: 1 },
            lockedUntil: null,
        },
        select: { id: true, failedLoginAttempts: true },
    });
    if (user.failedLoginAttempts >= ACCOUNT_LOCK_THRESHOLD) {
        await prisma.user.update({
            where: { id: userId },
            data: { lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS) },
        });
    }
    return user.failedLoginAttempts;
}

async function clearLoginFailures(prisma, userId) {
    await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
    });
}

module.exports = {
    ACCOUNT_LOCK_THRESHOLD,
    ACCOUNT_LOCK_DURATION_MS,
    isAccountLocked,
    remainingLockSeconds,
    assertAccountUnlocked,
    recordFailedLogin,
    clearLoginFailures,
};
