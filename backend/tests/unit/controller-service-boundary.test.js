const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const accountService = require("../../services/account/accountService");

const controller = (name) => fs.readFileSync(path.join(__dirname, "../../controllers", name), "utf8");

test("controllers with prior direct Prisma access delegate to services", () => {
    for (const name of [
        "adminController.js",
        "authController.js",
        "qrController.js",
        "registrationController.js",
        "signatureController.js",
    ]) {
        assert.doesNotMatch(controller(name), /prismaClient|\bprisma\b/);
    }
    assert.match(controller("adminController.js"), /adminService/);
    assert.match(controller("authController.js"), /accountService\.establishCognitoLoginSession/);
    assert.match(controller("authController.js"), /accountService\.establishCognitoRefreshSession/);
    assert.match(controller("authController.js"), /accountService\.recordAuthAudit/);
    assert.doesNotMatch(controller("authController.js"), /syncLocalUser/);
    assert.doesNotMatch(controller("authController.js"), /createAuthAuditLog/);
    assert.doesNotMatch(controller("authController.js"), /canUseLimitedSession|sessionValidity|rolesFromCognitoGroups|recordSuccessfulLogin|syncCognitoUser/);
    assert.match(controller("qrController.js"), /qrService\.assertRegistrationAccess/);
    assert.match(controller("registrationController.js"), /registrationService/);
    assert.match(controller("signatureController.js"), /signatureService/);
});

test("account service owns Cognito session eligibility, role intersection, and successful-login audit", async (t) => {
    const originalSync = accountService.syncCognitoUser;
    const originalLogin = accountService.recordSuccessfulLogin;
    const originalAudit = accountService.recordAuthAudit;
    t.after(() => {
        accountService.syncCognitoUser = originalSync;
        accountService.recordSuccessfulLogin = originalLogin;
        accountService.recordAuthAudit = originalAudit;
    });

    const localUser = {
        id: "account-1",
        email: "staff@example.com",
        status: "ACTIVE",
        accessState: "ENABLED",
        deprovisionedAt: null,
        sessionInvalidBefore: null,
        userRoles: [
            { role: { roleName: "EVENT_MANAGER" } },
            { role: { roleName: "ADMINISTRATOR" } },
        ],
    };
    const loginAt = new Date("2026-08-10T10:00:00.000Z");
    const audits = [];
    accountService.syncCognitoUser = async () => localUser;
    accountService.recordSuccessfulLogin = async () => loginAt;
    accountService.recordAuthAudit = async (entry) => { audits.push(entry); };

    const accessTokenPayload = {
        sub: "cognito-1",
        auth_time: Math.floor(new Date("2026-08-10T09:00:00.000Z").getTime() / 1000),
        "cognito:groups": ["Event Manager", "Reviewer"],
    };
    const session = await accountService.establishCognitoLoginSession({
        idTokenPayload: { sub: "cognito-1", email: localUser.email, email_verified: true },
        accessTokenPayload,
        context: { requestId: "request-1" },
    });

    assert.deepEqual(session.roles, ["EVENT_MANAGER"]);
    assert.equal(session.localUser.lastLoginAt, loginAt);
    assert.deepEqual(audits, [{
        userId: localUser.id,
        eventType: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        identifier: localUser.email,
        context: { requestId: "request-1" },
    }]);

    accountService.syncCognitoUser = async () => ({ ...localUser, accessState: "DISABLED" });
    await assert.rejects(
        accountService.establishCognitoRefreshSession({ accessTokenPayload, username: localUser.email }),
        (error) => error.code === "ACCOUNT_SESSION_BLOCKED",
    );

    accountService.syncCognitoUser = async () => ({
        ...localUser,
        sessionInvalidBefore: new Date("2026-08-10T09:00:01.000Z"),
    });
    await assert.rejects(
        accountService.establishCognitoRefreshSession({ accessTokenPayload, username: localUser.email }),
        (error) => error.code === "ACCOUNT_SESSION_BLOCKED",
    );
});
