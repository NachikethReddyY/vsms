function getCognitoConfig() {
    return {
        region: process.env.COGNITO_REGION,
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        clientId: process.env.COGNITO_APP_CLIENT_ID,
        clientSecret: process.env.COGNITO_APP_CLIENT_SECRET || "",
        domain: String(process.env.COGNITO_DOMAIN || "").replace(/\/$/, ""),
        redirectUri: process.env.COGNITO_REDIRECT_URI,
        logoutUri: process.env.COGNITO_LOGOUT_URI,
    };
}

function isCognitoConfigured() {
    const config = getCognitoConfig();
    return Boolean(config.region && config.userPoolId && config.clientId && config.domain && config.redirectUri && config.logoutUri);
}

function buildAuthorizationUrl({ state, codeChallenge }) {
    const { domain, clientId, redirectUri } = getCognitoConfig();
    const url = new URL(`${domain}/oauth2/authorize`);
    url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    }).toString();
    return url.toString();
}

function getLogoutUrl() {
    const { domain, clientId, logoutUri } = getCognitoConfig();
    const url = new URL(`${domain}/logout`);
    url.search = new URLSearchParams({ client_id: clientId, logout_uri: logoutUri }).toString();
    return url.toString();
}

async function sendTokenRequest(parameters) {
    const { domain, clientId, clientSecret } = getCognitoConfig();
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const body = new URLSearchParams({ ...parameters, client_id: clientId });
    if (clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
        body.delete("client_id");
    }

    const response = await fetch(`${domain}/oauth2/token`, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error("Cognito token exchange failed");
        error.name = data.error || "CognitoOAuthError";
        error.statusCode = 401;
        throw error;
    }
    return {
        AccessToken: data.access_token,
        IdToken: data.id_token,
        RefreshToken: data.refresh_token,
        ExpiresIn: data.expires_in,
        TokenType: data.token_type,
    };
}

function exchangeAuthorizationCode(code, codeVerifier) {
    const { redirectUri } = getCognitoConfig();
    return sendTokenRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
    });
}

function getCognitoEndpoint() {
    const { region } = getCognitoConfig();
    return `https://cognito-idp.${region}.amazonaws.com/`;
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
        signal: AbortSignal.timeout(10000),
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

async function refreshSession(payload) {
    return { AuthenticationResult: await sendTokenRequest({
        grant_type: "refresh_token",
        refresh_token: payload.refreshToken,
    }) };
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
    buildAuthorizationUrl,
    getLogoutUrl,
    exchangeAuthorizationCode,
    refreshSession,
    changePassword,
    globalSignOut,
};
