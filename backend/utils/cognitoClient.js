const crypto = require("crypto");

function getCognitoConfig() {
    return {
        region: process.env.COGNITO_REGION,
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        clientId: process.env.COGNITO_APP_CLIENT_ID,
        clientSecret: process.env.COGNITO_APP_CLIENT_SECRET || "",
    };
}

function isCognitoConfigured() {
    const config = getCognitoConfig();
    return Boolean(config.region && config.userPoolId && config.clientId);
}

function getCognitoEndpoint() {
    const { region } = getCognitoConfig();
    return `https://cognito-idp.${region}.amazonaws.com/`;
}

function buildSecretHash(username) {
    const { clientId, clientSecret } = getCognitoConfig();
    if (!clientSecret) {
        return undefined;
    }

    return crypto
        .createHmac("sha256", clientSecret)
        .update(`${username}${clientId}`)
        .digest("base64");
}

async function sendCognitoRequest(target, body) {
    if (!isCognitoConfigured()) {
        const error = new Error("Cognito is not configured");
        error.statusCode = 503;
        throw error;
    }

    const response = await fetch(getCognitoEndpoint(), {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.message || data.__type || "Cognito request failed");
        error.statusCode = 400;
        error.details = data;
        throw error;
    }

    return data;
}

function buildUserAttributes(payload) {
    const attributes = [
        { Name: "email", Value: payload.email },
        { Name: "name", Value: payload.fullName },
    ];

    if (payload.employeeNumber) {
        attributes.push({ Name: "custom:employee_number", Value: payload.employeeNumber });
    }
    if (payload.department) {
        attributes.push({ Name: "custom:department", Value: payload.department });
    }
    if (payload.designation) {
        attributes.push({ Name: "custom:designation", Value: payload.designation });
    }
    if (payload.role) {
        attributes.push({ Name: "custom:role", Value: payload.role });
    }

    return attributes;
}

async function signUp(payload) {
    const { clientId } = getCognitoConfig();
    const body = {
        ClientId: clientId,
        Username: payload.email,
        Password: payload.password,
        UserAttributes: buildUserAttributes(payload),
    };

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        body.SecretHash = secretHash;
    }

    return sendCognitoRequest("SignUp", body);
}

async function confirmSignUp(payload) {
    const { clientId } = getCognitoConfig();
    const body = {
        ClientId: clientId,
        Username: payload.email,
        ConfirmationCode: payload.code,
    };

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        body.SecretHash = secretHash;
    }

    return sendCognitoRequest("ConfirmSignUp", body);
}

async function resendConfirmationCode(email) {
    const { clientId } = getCognitoConfig();
    const body = {
        ClientId: clientId,
        Username: email,
    };

    const secretHash = buildSecretHash(email);
    if (secretHash) {
        body.SecretHash = secretHash;
    }

    return sendCognitoRequest("ResendConfirmationCode", body);
}

async function login(payload) {
    const { clientId } = getCognitoConfig();
    const authParameters = {
        USERNAME: payload.email,
        PASSWORD: payload.password,
    };

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        authParameters.SECRET_HASH = secretHash;
    }

    return sendCognitoRequest("InitiateAuth", {
        ClientId: clientId,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: authParameters,
    });
}

async function refreshSession(payload) {
    const { clientId } = getCognitoConfig();
    const authParameters = {
        REFRESH_TOKEN: payload.refreshToken,
    };

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        authParameters.SECRET_HASH = secretHash;
    }

    return sendCognitoRequest("InitiateAuth", {
        ClientId: clientId,
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: authParameters,
    });
}

async function respondToAuthChallenge(payload) {
    const { clientId } = getCognitoConfig();
    const challengeResponses = {
        USERNAME: payload.email,
    };

    if (payload.challengeName === "SOFTWARE_TOKEN_MFA") {
        challengeResponses.SOFTWARE_TOKEN_MFA_CODE = payload.code;
    }

    if (payload.challengeName === "SMS_MFA") {
        challengeResponses.SMS_MFA_CODE = payload.code;
    }

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        challengeResponses.SECRET_HASH = secretHash;
    }

    return sendCognitoRequest("RespondToAuthChallenge", {
        ClientId: clientId,
        ChallengeName: payload.challengeName,
        Session: payload.session,
        ChallengeResponses: challengeResponses,
    });
}

async function forgotPassword(email) {
    const { clientId } = getCognitoConfig();
    const body = {
        ClientId: clientId,
        Username: email,
    };

    const secretHash = buildSecretHash(email);
    if (secretHash) {
        body.SecretHash = secretHash;
    }

    return sendCognitoRequest("ForgotPassword", body);
}

async function confirmForgotPassword(payload) {
    const { clientId } = getCognitoConfig();
    const body = {
        ClientId: clientId,
        Username: payload.email,
        ConfirmationCode: payload.code,
        Password: payload.newPassword,
    };

    const secretHash = buildSecretHash(payload.email);
    if (secretHash) {
        body.SecretHash = secretHash;
    }

    return sendCognitoRequest("ConfirmForgotPassword", body);
}

async function changePassword(payload) {
    return sendCognitoRequest("ChangePassword", {
        AccessToken: payload.accessToken,
        PreviousPassword: payload.oldPassword,
        ProposedPassword: payload.newPassword,
    });
}

async function globalSignOut(accessToken) {
    return sendCognitoRequest("GlobalSignOut", {
        AccessToken: accessToken,
    });
}

module.exports = {
    getCognitoConfig,
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
};
