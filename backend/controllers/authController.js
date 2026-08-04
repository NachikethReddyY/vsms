const crypto = require("crypto");
const asyncHandler = require("../middlewares/asyncHandler");
const {
    isCognitoConfigured,
    buildAuthorizationUrl,
    getLogoutUrl,
    exchangeAuthorizationCode,
    refreshSession,
    changePassword,
    globalSignOut,
} = require("../utils/cognitoClient");
const { verifyCognitoToken } = require("../utils/cognitoJwt");
const { createAuthAuditLog } = require("../utils/AuthAudit");
const { timingSafeEqual } = require("../utils/security");
const { syncLocalUser, rolesFromCognitoGroups, ALLOWED_ROLES } = require("../utils/staff");
const {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    USERNAME_COOKIE,
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_RETURN_TO_COOKIE,
    parseCookies,
    setAuthCookies,
    clearAuthCookies,
    setOAuthCookies,
    clearOAuthCookies,
} = require("../utils/httpCookies");

function requireFields(payload, fields) {
    const missing = fields.filter((field) => !String(payload?.[field] || "").trim());
    if (missing.length > 0) {
        const error = new Error(`Missing required fields: ${missing.join(", ")}`);
        error.statusCode = 400;
        throw error;
    }
}

function ensureCognitoConfigured() {
    if (!isCognitoConfigured()) {
        const error = new Error("Cognito is not configured. Populate backend/.env before using these routes.");
        error.statusCode = 503;
        throw error;
    }
}

function normalizeReturnTo(value) {
    const returnTo = String(value || "");
    return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/events";
}

function extractProfileFromIdToken(payload) {
    return {
        cognitoSub: payload.sub,
        email: payload.email || payload["cognito:username"],
        fullName: payload.name || payload.given_name || null,
        employeeNumber: payload["custom:employee_number"] || null,
        department: payload["custom:department"] || null,
        designation: payload["custom:designation"] || null,
    };
}

function publicUser(localUser, roles) {
    const systemRole = roles.includes("ADMINISTRATOR")
        ? "ADMIN"
        : roles.includes("EVENT_MANAGER")
            ? "EVENT_MANAGER"
            : "STAFF";
    return {
        id: localUser.id,
        userId: localUser.id,
        username: localUser.username || localUser.email,
        email: localUser.email,
        fullName: localUser.fullName,
        employeeNumber: localUser.employeeNumber,
        department: localUser.department,
        designation: localUser.designation,
        status: localUser.status,
        roles,
        systemRole,
    };
}

async function finalizeSuccessfulLogin(authResult, username, context, res) {
    const [idTokenPayload, accessTokenPayload] = await Promise.all([
        verifyCognitoToken(authResult.IdToken, "id"),
        verifyCognitoToken(authResult.AccessToken, "access"),
    ]);
    const localUser = await syncLocalUser(extractProfileFromIdToken(idTokenPayload));

    if (localUser.status !== "ACTIVE") {
        const error = new Error("Local staff account is not active");
        error.statusCode = 403;
        throw error;
    }

    const localRoles = localUser.userRoles.map((entry) => entry.role.roleName);
    const cognitoRoles = rolesFromCognitoGroups(accessTokenPayload);
    const roles = localRoles.filter((role) => cognitoRoles.includes(role));
    if (roles.length === 0) {
        const error = new Error("Cognito group membership does not grant an application role");
        error.statusCode = 403;
        throw error;
    }

    setAuthCookies(res, authResult, idTokenPayload.email || idTokenPayload["cognito:username"] || username);
    await createAuthAuditLog({
        userId: localUser.id,
        eventType: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        identifier: localUser.email,
        context,
    });

    return {
        expiresIn: authResult.ExpiresIn,
        sessionExpiresIn: Number(process.env.REFRESH_COOKIE_MAX_AGE_SECONDS || 30 * 24 * 60 * 60),
        user: publicUser(localUser, roles),
    };
}

exports.configStatus = asyncHandler(async (req, res) => {
    res.json({
        configured: isCognitoConfigured(),
        supportedRoles: ALLOWED_ROLES,
        requestId: req.context.requestId,
    });
});

exports.authorize = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(64).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    setOAuthCookies(res, {
        state,
        verifier,
        returnTo: normalizeReturnTo(req.query.returnTo),
    });
    res.redirect(buildAuthorizationUrl({ state, codeChallenge }));
});

exports.callback = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.query, ["code", "state"]);
    const cookies = parseCookies(req.headers.cookie);
    if (!timingSafeEqual(req.query.state, cookies[OAUTH_STATE_COOKIE]) || !cookies[OAUTH_VERIFIER_COOKIE]) {
        clearOAuthCookies(res);
        const error = new Error("Cognito authorization state is invalid or expired");
        error.statusCode = 400;
        throw error;
    }

    const returnTo = normalizeReturnTo(cookies[OAUTH_RETURN_TO_COOKIE]);
    try {
        const authResult = await exchangeAuthorizationCode(req.query.code, cookies[OAUTH_VERIFIER_COOKIE]);
        const payload = await finalizeSuccessfulLogin(authResult, null, req.context, res);
        clearOAuthCookies(res);
        res.json({ ...payload, returnTo });
    } catch (error) {
        clearOAuthCookies(res);
        await createAuthAuditLog({
            eventType: "LOGIN_FAILED",
            outcome: "FAILED",
            failureCategory: error.name || "OAUTH_CALLBACK_FAILED",
            context: req.context,
        }).catch(() => {});
        throw error;
    }
});

exports.refresh = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies[REFRESH_COOKIE];
    const username = cookies[USERNAME_COOKIE];
    if (!refreshToken || !username) {
        const error = new Error("Refresh session is unavailable");
        error.statusCode = 401;
        throw error;
    }

    try {
        const response = await refreshSession({ email: username, refreshToken });
        const authResult = response.AuthenticationResult;
        const accessPayload = await verifyCognitoToken(authResult.AccessToken, "access");
        const localUser = await syncLocalUser({
            cognitoSub: accessPayload.sub,
            email: username.includes("@") ? username : null,
        });
        if (localUser.status !== "ACTIVE") {
            const error = new Error("Local staff account is not active");
            error.statusCode = 403;
            throw error;
        }

        const localRoles = localUser.userRoles.map((entry) => entry.role.roleName);
        const cognitoRoles = rolesFromCognitoGroups(accessPayload);
        const roles = localRoles.filter((role) => cognitoRoles.includes(role));
        if (roles.length === 0) {
            const error = new Error("Cognito group membership does not grant an application role");
            error.statusCode = 403;
            throw error;
        }

        setAuthCookies(res, { ...authResult, RefreshToken: refreshToken }, username);
        res.json({
            expiresIn: authResult.ExpiresIn,
            sessionExpiresIn: Number(process.env.REFRESH_COOKIE_MAX_AGE_SECONDS || 30 * 24 * 60 * 60),
            user: publicUser(localUser, roles),
        });
    } catch (error) {
        clearAuthCookies(res);
        await createAuthAuditLog({
            eventType: "TOKEN_REFRESH_FAILED",
            outcome: "FAILED",
            failureCategory: error.name || "TOKEN_REFRESH_FAILED",
            identifier: username,
            context: req.context,
        }).catch(() => {});
        if (!error.statusCode) error.statusCode = 401;
        throw error;
    }
});

exports.me = asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.auth.user, req.auth.roles) });
});

exports.logout = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    const accessToken = parseCookies(req.headers.cookie)[ACCESS_COOKIE];
    if (accessToken) void globalSignOut(accessToken).catch(() => {});
    clearAuthCookies(res);
    res.json({ message: "Logged out successfully", logoutUrl: getLogoutUrl() });
});

exports.changePassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["oldPassword", "newPassword"]);
    await changePassword({
        accessToken: req.auth.token,
        oldPassword: req.body.oldPassword,
        newPassword: req.body.newPassword,
    });
    await createAuthAuditLog({
        userId: req.auth.userId,
        eventType: "PASSWORD_CHANGE_SUCCESS",
        outcome: "SUCCESS",
        identifier: req.auth.email,
        context: req.context,
    });
    res.json({ message: "Password changed successfully." });
});
