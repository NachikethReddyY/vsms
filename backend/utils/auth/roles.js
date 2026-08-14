const APPLICATION_ROLES = [
    "ADMINISTRATOR",
    "EVENT_MANAGER",
];

// Cognito groups pre-date the application role names in some environments.
// Normalising here keeps the session, route guards, and database-role
// intersection on the one application vocabulary.
const COGNITO_GROUP_ROLE_MAP = {
    ADMIN: "ADMINISTRATOR",
    ADMINISTRATOR: "ADMINISTRATOR",
    EVENTMANAGER: "EVENT_MANAGER",
    REGISTRATIONOFFICER: "REGISTRATION_OFFICER",
    SCREENER: "SCREENER",
    REVIEWER: "REVIEWER",
    SUPPORT: "SUPPORT",
};

function normalizeApplicationRole(value) {
    const key = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return COGNITO_GROUP_ROLE_MAP[key] || null;
}

function rolesFromCognitoGroups(payload) {
    const groups = Array.isArray(payload?.["cognito:groups"]) ? payload["cognito:groups"] : [];
    return [...new Set(groups.map(normalizeApplicationRole).filter((role) => APPLICATION_ROLES.includes(role)))];
}

module.exports = { APPLICATION_ROLES, normalizeApplicationRole, rolesFromCognitoGroups };
