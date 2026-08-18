const crypto = require("crypto");
const { AppError } = require("../errors/AppError");
const env = require("../config/env");
const asyncHandler = require("../middlewares/asyncHandler");
const {
    isCognitoConfigured,
    buildAuthorizationUrl,
    getLogoutUrl,
    exchangeAuthorizationCode,
    refreshSession,
    changePassword,
    globalSignOut,
} = require("../utils/auth/cognitoClient");
const { verifyCognitoToken } = require("../utils/auth/cognitoJwt");
const { timingSafeEqual } = require("../utils/crypto/security");
const { ALLOWED_ROLES } = require("../utils/auth/staff");
const accountService = require("../services/account/accountService");
const { AUTH_AUDIT_EVENTS } = require("../utils/logging/auditEvents");
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
} = require("../utils/http/httpCookies");

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
    const returnTo = String(value || "").trim();
    let decoded;
    try {
        decoded = decodeURIComponent(returnTo);
    } catch {
        return "/events";
    }
    const isPath = decoded.startsWith("/") && !decoded.startsWith("//");
    const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(decoded);
    if (!isPath && !isAbsoluteUrl || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return "/events";

    try {
        const url = new URL(decoded, env.publicAppOrigin);
        if (url.origin !== env.publicAppOrigin || url.pathname.startsWith("//") || ["/", "/api"].includes(url.pathname) || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) {
            return "/events";
        }
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/events";
    }
}

exports.normalizeReturnTo = normalizeReturnTo;

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
        approvalState: localUser.approvalState,
        accessState: localUser.accessState,
        professionalCategory: localUser.professionalCategory,
        roles,
        systemRole,
    };
}

async function finalizeSuccessfulLogin(authResult, username, context, res) {
    const [idTokenPayload, accessTokenPayload] = await Promise.all([
        verifyCognitoToken(authResult.IdToken, "id"),
        verifyCognitoToken(authResult.AccessToken, "access"),
    ]);
    const { localUser, roles } = await accountService.establishCognitoLoginSession({
        idTokenPayload,
        accessTokenPayload,
        context,
    });
    setAuthCookies(res, authResult, idTokenPayload.email || idTokenPayload["cognito:username"] || username);

    return {
        expiresIn: authResult.ExpiresIn,
        sessionExpiresIn: env.REFRESH_COOKIE_MAX_AGE_SECONDS,
        user: publicUser(localUser, roles),
    };
}

exports.configStatus = asyncHandler(async (req, res) => {
    res.json({
        configured: isCognitoConfigured(),
        publicSignupEnabled: env.publicSignupEnabled,
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
    res.redirect(buildAuthorizationUrl({ state, codeChallenge, screenHint: env.publicSignupEnabled && req.query.screen_hint === "signup" ? "signup" : undefined }));
});

exports.callback = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.query, ["code", "state"]);
    const cookies = parseCookies(req.headers.cookie);
    if (!timingSafeEqual(req.query.state, cookies[OAUTH_STATE_COOKIE]) || !cookies[OAUTH_VERIFIER_COOKIE]) {
        clearOAuthCookies(res);
        await accountService.recordAuthAuditBestEffort({
            eventType: AUTH_AUDIT_EVENTS.LOGIN_FAILED,
            outcome: "DENIED",
            failureCategory: "OAUTH_STATE_INVALID",
            context: req.context,
        });
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
        await accountService.recordAuthAudit({
            eventType: AUTH_AUDIT_EVENTS.LOGIN_FAILED,
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
        await accountService.recordAuthAuditBestEffort({
            eventType: AUTH_AUDIT_EVENTS.TOKEN_REFRESH_FAILED,
            outcome: "DENIED",
            failureCategory: "REFRESH_SESSION_UNAVAILABLE",
            identifier: username,
            context: req.context,
        });
        const error = new Error("Refresh session is unavailable");
        error.statusCode = 401;
        throw error;
    }

    try {
        const response = await refreshSession({ email: username, refreshToken });
        const authResult = response.AuthenticationResult;
        const accessPayload = await verifyCognitoToken(authResult.AccessToken, "access");
        const { localUser, roles } = await accountService.establishCognitoRefreshSession({
            accessTokenPayload: accessPayload,
            username,
        });
        await accountService.recordAuthAuditBestEffort({
            userId: localUser.id,
            eventType: AUTH_AUDIT_EVENTS.TOKEN_REFRESH_SUCCESS,
            outcome: "SUCCESS",
            identifier: username,
            context: req.context,
        });
        setAuthCookies(res, { ...authResult, RefreshToken: refreshToken }, username);
        res.json({
            expiresIn: authResult.ExpiresIn,
            sessionExpiresIn: env.REFRESH_COOKIE_MAX_AGE_SECONDS,
            user: publicUser(localUser, roles),
        });
    } catch (error) {
        clearAuthCookies(res);
        await accountService.recordAuthAudit({
            eventType: AUTH_AUDIT_EVENTS.TOKEN_REFRESH_FAILED,
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
    const username = parseCookies(req.headers.cookie)[USERNAME_COOKIE];
    clearAuthCookies(res);
    await accountService.recordAuthAuditBestEffort({
        eventType: AUTH_AUDIT_EVENTS.LOGOUT_SUCCESS,
        outcome: "SUCCESS",
        identifier: username,
        context: req.context,
    });
    res.json({ message: "Logged out successfully", logoutUrl: getLogoutUrl() });
});

exports.globalLogout = asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const accessToken = cookies[ACCESS_COOKIE];
    const username = cookies[USERNAME_COOKIE];
    try {
        ensureCognitoConfigured();
        if (!accessToken) {
            const error = new Error("An active access session is required to sign out everywhere");
            error.statusCode = 401;
            throw error;
        }
        await globalSignOut(accessToken);
        await accountService.recordAuthAuditBestEffort({
            eventType: AUTH_AUDIT_EVENTS.GLOBAL_LOGOUT_SUCCESS,
            outcome: "SUCCESS",
            identifier: username,
            context: req.context,
        });
    } catch (error) {
        await accountService.recordAuthAuditBestEffort({
            eventType: AUTH_AUDIT_EVENTS.GLOBAL_LOGOUT_FAILED,
            outcome: error.statusCode === 401 ? "DENIED" : "FAILED",
            failureCategory: error.name || "GLOBAL_LOGOUT_FAILED",
            identifier: username,
            context: req.context,
        });
        if (error.statusCode !== 401 && error.statusCode !== 503) error.statusCode = 502;
        throw error;
    } finally {
        clearAuthCookies(res);
    }
    res.json({ message: "Signed out everywhere successfully", logoutUrl: getLogoutUrl() });
});

exports.changePassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["oldPassword", "newPassword"]);
    try {
        await changePassword({
            accessToken: req.auth.token,
            oldPassword: req.body.oldPassword,
            newPassword: req.body.newPassword,
        });
        await accountService.recordPasswordChange({
            userId: req.auth.userId,
            email: req.auth.email,
            context: req.context,
        });
    } catch (error) {
        await accountService.recordAuthAuditBestEffort({
            userId: req.auth.userId,
            eventType: AUTH_AUDIT_EVENTS.PASSWORD_CHANGE_FAILED,
            outcome: error.statusCode === 403 ? "DENIED" : "FAILED",
            failureCategory: error.name || "PASSWORD_CHANGE_FAILED",
            identifier: req.auth.email,
            context: req.context,
        });
        throw error;
    }
    res.json({ message: "Password changed successfully." });
});
