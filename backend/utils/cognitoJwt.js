const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { getCognitoConfig } = require("./cognitoClient");

let jwksCache = {
    expiresAt: 0,
    keys: [],
};

function isCognitoConfigured() {
    const config = getCognitoConfig();
    return Boolean(config.region && config.userPoolId && config.clientId);
}

function getIssuer() {
    const { region, userPoolId } = getCognitoConfig();
    return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

async function loadJwks(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && jwksCache.keys.length > 0 && jwksCache.expiresAt > now) {
        return jwksCache.keys;
    }

    const response = await fetch(`${getIssuer()}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
        throw new Error("Unable to fetch Cognito JWKS");
    }

    const data = await response.json();
    jwksCache = {
        keys: data.keys || [],
        expiresAt: now + 60 * 60 * 1000,
    };

    return jwksCache.keys;
}

function decodeHeader(token) {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Malformed JWT");
    }

    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
}

async function getKeyObjectForToken(token) {
    const header = decodeHeader(token);
    let keys = await loadJwks();
    let matchingKey = keys.find((key) => key.kid === header.kid);
    if (!matchingKey) {
        keys = await loadJwks(true);
        matchingKey = keys.find((key) => key.kid === header.kid);
    }

    if (!matchingKey) {
        throw new Error("Unable to match Cognito signing key");
    }

    return crypto.createPublicKey({
        key: matchingKey,
        format: "jwk",
    });
}

async function verifyCognitoToken(token, tokenUse) {
    const keyObject = await getKeyObjectForToken(token);
    const { clientId } = getCognitoConfig();

    const payload = jwt.verify(token, keyObject, {
        algorithms: ["RS256"],
        issuer: getIssuer(),
    });

    if (payload.token_use !== tokenUse) {
        throw new Error(`Expected a Cognito ${tokenUse} token`);
    }

    if (tokenUse === "id" && payload.aud !== clientId) {
        throw new Error("Token audience does not match the Cognito app client");
    }

    if (tokenUse === "access" && payload.client_id !== clientId) {
        throw new Error("Access token client_id does not match the Cognito app client");
    }

    return payload;
}

module.exports = {
    isCognitoConfigured,
    getIssuer,
    verifyCognitoToken,
};
