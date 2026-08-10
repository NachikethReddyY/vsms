const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    assert.match(controller("authController.js"), /accountService\.syncCognitoUser/);
    assert.match(controller("authController.js"), /accountService\.recordSuccessfulLogin/);
    assert.match(controller("authController.js"), /accountService\.recordAuthAudit/);
    assert.doesNotMatch(controller("authController.js"), /syncLocalUser/);
    assert.doesNotMatch(controller("authController.js"), /createAuthAuditLog/);
    assert.match(controller("qrController.js"), /qrService\.assertRegistrationAccess/);
    assert.match(controller("registrationController.js"), /registrationService/);
    assert.match(controller("signatureController.js"), /signatureService/);
});
