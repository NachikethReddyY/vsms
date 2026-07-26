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

function resolveChallengeUsername(response, fallbackUsername) {
    const parameters = response?.ChallengeParameters || {};
    let userAttributes = parameters.userAttributes;
    if (typeof userAttributes === "string") {
        try {
            userAttributes = JSON.parse(userAttributes);
        } catch {
            userAttributes = {};
        }
    }
    return parameters.USER_ID_FOR_SRP
        || parameters.USERNAME
        || userAttributes?.sub
        || fallbackUsername;
}

function resolveRequiredAttributes(response) {
    const rawAttributes = response?.ChallengeParameters?.requiredAttributes;
    let attributes = rawAttributes;
    if (typeof attributes === "string") {
        try {
            attributes = JSON.parse(attributes);
        } catch {
            attributes = [];
        }
    }
    if (!Array.isArray(attributes)) return [];
    return attributes
        .filter((attribute) => typeof attribute === "string")
        .map((attribute) => attribute.replace(/^userAttributes\./, ""))
        .filter(Boolean);
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
        const errorType = String(data.__type || "").split("#").pop();
        const authenticationFailure = [
            "NotAuthorizedException",
            "CodeMismatchException",
            "ExpiredCodeException",
            "UserNotFoundException",
        ].includes(errorType);
        const providerMessage = String(data.message || data.Message || "").trim();
        const exposeProviderMessage = process.env.NODE_ENV !== "production"
            && !authenticationFailure
            && providerMessage;
        const error = new Error(
            authenticationFailure
                ? "Authentication request was rejected"
                : exposeProviderMessage
                    ? `Cognito request failed: ${providerMessage}`
                    : "Cognito request failed",
        );
        error.name = errorType || "CognitoError";
        error.statusCode = authenticationFailure ? 401 : 400;
        error.cognitoReasonCode = data.reasonCode || null;
        throw error;
    }

    return data;
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
    const username = payload.challengeUsername || payload.email;
    const challengeResponses = {
        USERNAME: username,
    };

    if (payload.challengeName === "SOFTWARE_TOKEN_MFA") {
        challengeResponses.SOFTWARE_TOKEN_MFA_CODE = payload.code;
    }

    if (payload.challengeName === "SMS_MFA") {
        challengeResponses.SMS_MFA_CODE = payload.code;
    }

    if (payload.challengeName === "NEW_PASSWORD_REQUIRED") {
        challengeResponses.NEW_PASSWORD = payload.newPassword;
        const supportedAttributes = new Set(["name"]);
        for (const [attribute, value] of Object.entries(payload.userAttributes || {})) {
            const normalizedValue = String(value || "").trim();
            if (supportedAttributes.has(attribute) && normalizedValue) {
                challengeResponses[`userAttributes.${attribute}`] = normalizedValue;
            }
        }
    }

    const secretHash = buildSecretHash(username);
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

async function associateSoftwareToken(session) {
    return sendCognitoRequest("AssociateSoftwareToken", { Session: session });
}

async function verifySoftwareToken(session, code) {
    return sendCognitoRequest("VerifySoftwareToken", {
        Session: session,
        UserCode: code,
        FriendlyDeviceName: "VSMS staff portal",
    });
}

async function completeMfaSetup(payload) {
    const { clientId } = getCognitoConfig();
    const username = payload.challengeUsername || payload.email;
    const challengeResponses = { USERNAME: username };
    const secretHash = buildSecretHash(username);
    if (secretHash) challengeResponses.SECRET_HASH = secretHash;

    return sendCognitoRequest("RespondToAuthChallenge", {
        ClientId: clientId,
        ChallengeName: "MFA_SETUP",
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
};
