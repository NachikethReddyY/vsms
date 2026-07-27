const COGNITO_GROUP_ROLE_MAP = {
    Admin: "ADMINISTRATOR",
    Administrator: "ADMINISTRATOR",
    ADMINISTRATOR: "ADMINISTRATOR",
    RegistrationOfficer: "REGISTRATION_OFFICER",
    REGISTRATION_OFFICER: "REGISTRATION_OFFICER",
    EventManager: "EVENT_MANAGER",
    EVENT_MANAGER: "EVENT_MANAGER",
    Screener: "SCREENER",
    SCREENER: "SCREENER",
    Reviewer: "REVIEWER",
    REVIEWER: "REVIEWER",
};

function rolesFromCognitoGroups(payload) {
    const groups = Array.isArray(payload?.["cognito:groups"]) ? payload["cognito:groups"] : [];
    return [...new Set(groups.map((group) => COGNITO_GROUP_ROLE_MAP[group]).filter(Boolean))];
}

module.exports = { rolesFromCognitoGroups };
