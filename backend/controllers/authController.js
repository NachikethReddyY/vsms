const asyncHandler = require("../middlewares/asyncHandler");
const {
    isCognitoConfigured,
    resolveChallengeUsername,
    resolveRequiredAttributes,
    login,
    refreshSession,
    respondToAuthChallenge,
    associateSoftwareToken,
    verifySoftwareToken,
    completeMfaSetup,
    forgotPassword,
    confirmForgotPassword,
    changePassword,
    globalSignOut,
} = require("../utils/cognitoClient");
const { verifyCognitoToken } = require("../utils/cognitoJwt");
const { createAuthAuditLog } = require("../utils/audit");
const { syncLocalUser, rolesFromCognitoGroups, ALLOWED_ROLES } = require("../utils/staff");
const {
    REFRESH_COOKIE,
    USERNAME_COOKIE,
    parseCookies,
    setAuthCookies,
    clearAuthCookies,
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

    setAuthCookies(res, authResult, username);
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

async function pendingChallenge(response, email, previousChallengeUsername = null) {
    const challengeUsername = resolveChallengeUsername(
        response,
        previousChallengeUsername || email
    );
    if (response.ChallengeName !== "MFA_SETUP") {
        return {
            challengeName: response.ChallengeName,
            session: response.Session,
            email,
            challengeUsername,
            requiredAttributes: resolveRequiredAttributes(response),
        };
    }

    const setup = await associateSoftwareToken(response.Session);
    const issuer = encodeURIComponent("VSMS");
    const account = encodeURIComponent(`VSMS:${email}`);
    return {
        challengeName: "MFA_SETUP",
        session: setup.Session,
        email,
        challengeUsername,
        requiredAttributes: resolveRequiredAttributes(response),
        secretCode: setup.SecretCode,
        otpAuthUri: `otpauth://totp/${account}?secret=${encodeURIComponent(setup.SecretCode)}&issuer=${issuer}`,
    };
}

exports.configStatus = asyncHandler(async (req, res) => {
    res.json({
        configured: isCognitoConfigured(),
        supportedRoles: ALLOWED_ROLES,
        requestId: req.context.requestId,
    });
});

exports.login = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "password"]);

    try {
        const response = await login(req.body);
        if (response.ChallengeName) {
            return res.status(202).json(await pendingChallenge(response, req.body.email));
        }

        const payload = await finalizeSuccessfulLogin(
            response.AuthenticationResult,
            req.body.email,
            req.context,
            res
        );
        res.json(payload);
    } catch (error) {
        await createAuthAuditLog({
            eventType: "LOGIN_FAILED",
            outcome: "FAILED",
            failureCategory: error.name || "AUTHENTICATION_FAILED",
            identifier: req.body.email,
            context: req.context,
        }).catch(() => {});
        if (!error.statusCode) error.statusCode = 401;
        throw error;
    }
});

exports.respondToChallenge = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "challengeName", "session"]);
    if (req.body.challengeName === "NEW_PASSWORD_REQUIRED") {
        requireFields(req.body, ["newPassword"]);
    } else {
        requireFields(req.body, ["code"]);
    }

    try {
        let response;
        if (req.body.challengeName === "MFA_SETUP") {
            const verification = await verifySoftwareToken(req.body.session, req.body.code);
            response = await completeMfaSetup({
                email: req.body.email,
                challengeUsername: req.body.challengeUsername,
                session: verification.Session,
            });
        } else {
            response = await respondToAuthChallenge(req.body);
        }
        if (response.ChallengeName) {
            return res.status(202).json(await pendingChallenge(
                response,
                req.body.email,
                req.body.challengeUsername
            ));
        }
        const payload = await finalizeSuccessfulLogin(
            response.AuthenticationResult,
            req.body.email,
            req.context,
            res
        );
        res.json(payload);
    } catch (error) {
        await createAuthAuditLog({
            eventType: "MFA_CHALLENGE_FAILED",
            outcome: "FAILED",
            failureCategory: error.name || "MFA_FAILED",
            identifier: req.body.email,
            context: req.context,
        }).catch(() => {});
        if (!error.statusCode) error.statusCode = 401;
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
    try {
        await globalSignOut(req.auth.token);
        await createAuthAuditLog({
            userId: req.auth.userId,
            eventType: "LOGOUT_SUCCESS",
            outcome: "SUCCESS",
            identifier: req.auth.email,
            context: req.context,
        });
    } finally {
        clearAuthCookies(res);
    }
    res.json({ message: "Logged out successfully" });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email"]);
    await forgotPassword(req.body.email).catch(() => {});
    res.json({ message: "If the account exists, a reset code has been sent." });
});

exports.confirmForgotPassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "code", "newPassword"]);
    await confirmForgotPassword(req.body);
    res.json({ message: "Password reset completed. You can sign in now." });
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
