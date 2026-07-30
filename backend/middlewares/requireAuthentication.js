const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const { isCognitoConfigured, verifyCognitoToken } = require("../utils/cognitoJwt");
const { rolesFromCognitoGroups } = require("../utils/staff");
const { ACCESS_COOKIE, parseCookies } = require("../utils/httpCookies");

const requireAuthentication = asyncHandler(async (req, res, next) => {
    if (!isCognitoConfigured()) {
        const error = new Error("Cognito is not configured. See backend/.env.example and backend/docs/cognito-setup.md.");
        error.statusCode = 503;
        throw error;
    }

    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie);
    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : cookies[ACCESS_COOKIE];

    if (!token) {
        const error = new Error("Access token required");
        error.statusCode = 401;
        throw error;
    }

    let payload;
    try {
        payload = await verifyCognitoToken(token, "access");
    } catch {
        const error = new Error("Access token is invalid or expired");
        error.statusCode = 401;
        throw error;
    }
    const username = payload.username || payload["cognito:username"] || payload.email;

    if (!payload.sub && !username) {
        const error = new Error("Unable to resolve user identity from token");
        error.statusCode = 401;
        throw error;
    }

    const identityMatches = [];
    if (payload.sub) {
        identityMatches.push({ cognitoSub: payload.sub });
    }
    if (payload.email) {
        identityMatches.push({ email: String(payload.email).toLowerCase() });
    }
    if (username && String(username).includes("@")) {
        identityMatches.push({ email: String(username).toLowerCase() });
    }

    const user = await prisma.user.findFirst({
        where: {
            OR: identityMatches,
        },
        include: {
            userRoles: {
                include: {
                    role: true,
                },
            },
        },
    });

    if (!user) {
        const error = new Error("No local staff profile found for this Cognito account");
        error.statusCode = 403;
        throw error;
    }

    if (user.status !== "ACTIVE") {
        const error = new Error("Local staff account is not active");
        error.statusCode = 403;
        throw error;
    }

    const tokenRoles = rolesFromCognitoGroups(payload);
    const localRoles = user.userRoles.map((entry) => entry.role.roleName);
    const effectiveRoles = localRoles.filter((role) => tokenRoles.includes(role));

    if (effectiveRoles.length === 0) {
        const error = new Error("Cognito group membership does not grant an application role");
        error.statusCode = 403;
        throw error;
    }

    if (req.context.deviceId) {
        await prisma.device.upsert({
            where: { id: req.context.deviceId },
            update: {
                userId: user.id,
                deviceName: req.context.deviceName,
                lastSeenAt: new Date(),
            },
            create: {
                id: req.context.deviceId,
                userId: user.id,
                deviceName: req.context.deviceName,
                lastSeenAt: new Date(),
            },
        });
    }

    req.auth = {
        token,
        tokenPayload: payload,
        user,
        userId: user.id,
        email: user.email,
        roles: effectiveRoles,
        cognitoGroups: payload["cognito:groups"] || [],
    };

    next();
});

module.exports = requireAuthentication;
