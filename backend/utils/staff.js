const { APPLICATION_ROLES, normalizeApplicationRole, rolesFromCognitoGroups } = require("./roles");
const eventAuthorization = require("../services/event/eventAuthorizationService");
const accountService = require("../services/account/accountService");

const ALLOWED_ROLES = APPLICATION_ROLES;

function normalizeRole(role) {
    return normalizeApplicationRole(role);
}

async function assertRegistrationAssignment(db, eventId, auth) {
    return eventAuthorization.requireEventRoleAndDuty(eventId, auth?.user || auth, "REGISTRATION", { db });
}

async function assertScreenerAssignment(db, eventId, auth, stationId) {
    return eventAuthorization.requireEventRoleAndDuty(eventId, auth?.user || auth, "SCREENER", { db, stationId });
}

async function assertQrVerifyAccess(db, eventId, auth) {
    const user = auth?.user || auth;
    const membership = await eventAuthorization.requireEventRoles(eventId, user, ["REGISTRATION", "SCREENER"], { db });
    if (membership.roles.has("REGISTRATION")) {
        try { return await eventAuthorization.requireCurrentDuty(eventId, user, "REGISTRATION", { db }); } catch (_error) {}
    }
    return eventAuthorization.requireCurrentDuty(eventId, user, "SCREENER", { db });
}

const syncLocalUser = (...args) => accountService.syncCognitoUser(...args);

module.exports = {
    normalizeRole,
    rolesFromCognitoGroups,
    syncLocalUser,
    assertRegistrationAssignment,
    assertScreenerAssignment,
    assertQrVerifyAccess,
    ALLOWED_ROLES,
};
