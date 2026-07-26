const asyncHandler = require("../middlewares/asyncHandler");
const {
    isCognitoConfigured,
    signUp,
    confirmSignUp,
    resendConfirmationCode,
    login,
    refreshSession,
    respondToAuthChallenge,
    forgotPassword,
    confirmForgotPassword,
    changePassword,
    globalSignOut,
} = require("../utils/cognitoClient");
const { verifyCognitoToken } = require("../utils/cognitoJwt");
const { createAuthAuditLog } = require("../utils/audit");
const { syncLocalUser, ALLOWED_ROLES } = require("../utils/staff");

function requireFields(payload, fields) {
    const missing = fields.filter((field) => !payload[field]);
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

function extractProfileFromIdToken(idTokenPayload) {
    return {
        cognitoSub: idTokenPayload.sub,
        email: idTokenPayload.email || idTokenPayload["cognito:username"],
        fullName: idTokenPayload.name || idTokenPayload.given_name || null,
        employeeNumber: idTokenPayload["custom:employee_number"] || null,
        department: idTokenPayload["custom:department"] || null,
        designation: idTokenPayload["custom:designation"] || null,
        role: idTokenPayload["custom:role"] || null,
    };
}

async function finalizeSuccessfulLogin(authResult, context) {
    const idTokenPayload = await verifyCognitoToken(authResult.IdToken, "id");
    const localUser = await syncLocalUser(extractProfileFromIdToken(idTokenPayload));

    await createAuthAuditLog({
        userId: localUser.id,
        eventType: "LOGIN_SUCCESS",
        outcome: "SUCCESS",
        identifier: localUser.email,
        context,
    });

    return {
        accessToken: authResult.AccessToken,
        idToken: authResult.IdToken,
        refreshToken: authResult.RefreshToken || null,
        expiresIn: authResult.ExpiresIn,
        tokenType: authResult.TokenType,
        user: {
            id: localUser.id,
            email: localUser.email,
            fullName: localUser.fullName,
            employeeNumber: localUser.employeeNumber,
            department: localUser.department,
            designation: localUser.designation,
            status: localUser.status,
            roles: localUser.userRoles.map((entry) => entry.role.roleName),
        },
    };
}

exports.configStatus = asyncHandler(async (req, res) => {
    res.json({
        configured: isCognitoConfigured(),
        supportedRoles: ALLOWED_ROLES,
        requestId: req.context.requestId,
    });
});

exports.signup = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["fullName", "email", "employeeNumber", "password", "role"]);

    const response = await signUp(req.body);

    await createAuthAuditLog({
        eventType: "SIGNUP_REQUESTED",
        outcome: "SUCCESS",
        identifier: req.body.email,
        context: req.context,
    });

    res.status(201).json({
        message: "Sign-up request submitted. Confirm the verification code next.",
        userSub: response.UserSub,
        codeDeliveryDetails: response.CodeDeliveryDetails || null,
    });
});

exports.confirmSignup = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["fullName", "email", "employeeNumber", "code", "role"]);

    await confirmSignUp(req.body);
    const localUser = await syncLocalUser(req.body);

    await createAuthAuditLog({
        userId: localUser.id,
        eventType: "SIGNUP_CONFIRMED",
        outcome: "SUCCESS",
        identifier: localUser.email,
        context: req.context,
    });

    res.json({
        message: "Account verified. You can sign in now.",
        user: {
            id: localUser.id,
            email: localUser.email,
            fullName: localUser.fullName,
            roles: localUser.userRoles.map((entry) => entry.role.roleName),
        },
    });
});

exports.resendCode = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email"]);

    const response = await resendConfirmationCode(req.body.email);

    res.json({
        message: "Verification code resent.",
        codeDeliveryDetails: response.CodeDeliveryDetails || null,
    });
});

exports.login = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "password"]);

    try {
        const response = await login(req.body);

        if (response.ChallengeName) {
            return res.status(202).json({
                challengeName: response.ChallengeName,
                session: response.Session,
                email: req.body.email,
            });
        }

        const payload = await finalizeSuccessfulLogin(response.AuthenticationResult, req.context);
        res.json(payload);
    } catch (error) {
        await createAuthAuditLog({
            eventType: "LOGIN_FAILED",
            outcome: "FAILED",
            failureCategory: error.message,
            identifier: req.body.email,
            context: req.context,
        });
        throw error;
    }
});

exports.respondToChallenge = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "challengeName", "session", "code"]);

    const response = await respondToAuthChallenge(req.body);
    const payload = await finalizeSuccessfulLogin(response.AuthenticationResult, req.context);
    res.json(payload);
});

exports.refresh = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "refreshToken"]);

    try {
        const response = await refreshSession(req.body);
        const authResult = response.AuthenticationResult;
        const idTokenPayload = await verifyCognitoToken(authResult.IdToken, "id");
        const localUser = await syncLocalUser(extractProfileFromIdToken(idTokenPayload));

        res.json({
            accessToken: authResult.AccessToken,
            idToken: authResult.IdToken,
            expiresIn: authResult.ExpiresIn,
            tokenType: authResult.TokenType,
            user: {
                id: localUser.id,
                email: localUser.email,
                fullName: localUser.fullName,
                roles: localUser.userRoles.map((entry) => entry.role.roleName),
            },
        });
    } catch (error) {
        await createAuthAuditLog({
            eventType: "TOKEN_REFRESH_FAILED",
            outcome: "FAILED",
            failureCategory: error.message,
            identifier: req.body.email,
            context: req.context,
        });
        throw error;
    }
});

exports.me = asyncHandler(async (req, res) => {
    res.json({
        user: {
            id: req.auth.user.id,
            email: req.auth.user.email,
            fullName: req.auth.user.fullName,
            employeeNumber: req.auth.user.employeeNumber,
            department: req.auth.user.department,
            designation: req.auth.user.designation,
            roles: req.auth.roles,
        },
    });
});

exports.logout = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    const accessToken = req.body.accessToken || req.auth?.token;
    if (!accessToken) {
        const error = new Error("Access token is required for logout");
        error.statusCode = 400;
        throw error;
    }

    await globalSignOut(accessToken);

    await createAuthAuditLog({
        userId: req.auth?.userId || null,
        eventType: "LOGOUT_SUCCESS",
        outcome: "SUCCESS",
        identifier: req.auth?.email || null,
        context: req.context,
    });

    res.json({
        message: "Logged out successfully",
    });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email"]);

    await forgotPassword(req.body.email);
    res.json({
        message: "If the account exists, a reset code has been sent.",
    });
});

exports.confirmForgotPassword = asyncHandler(async (req, res) => {
    ensureCognitoConfigured();
    requireFields(req.body, ["email", "code", "newPassword"]);

    await confirmForgotPassword(req.body);
    res.json({
        message: "Password reset completed. You can sign in now.",
    });
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

    res.json({
        message: "Password changed successfully.",
    });
});
