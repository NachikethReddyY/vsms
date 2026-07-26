const asyncHandler = require("./asyncHandler");
const prisma = require("../prisma/prismaClient");
const { isCognitoConfigured, verifyCognitoToken } = require("../utils/cognitoJwt");

const requireAuthentication = asyncHandler(async (req, res, next) => {
    if (!isCognitoConfigured()) {
        const error = new Error("Cognito is not configured. See backend/.env.example and backend/docs/cognito-setup.md.");
        error.statusCode = 503;
        throw error;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        const error = new Error("Access token required");
        error.statusCode = 401;
        throw error;
    }

    const token = authHeader.split(" ")[1];
    const payload = await verifyCognitoToken(token, "access");
    const username = payload.username || payload["cognito:username"] || payload.email;

    if (!username) {
        const error = new Error("Unable to resolve user identity from token");
        error.statusCode = 401;
        throw error;
    }

    const user = await prisma.user.findUnique({
        where: {
            email: username,
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

    req.auth = {
        token,
        tokenPayload: payload,
        user,
        userId: user.id,
        email: user.email,
        roles: user.userRoles.map((entry) => entry.role.roleName),
    };

    next();
});

module.exports = requireAuthentication;
