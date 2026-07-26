const { v4: uuidv4, validate: isUuid } = require("uuid");

function getIpAddress(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        return forwarded.split(",")[0].trim();
    }

    return req.socket?.remoteAddress || req.ip || "unknown";
}

function getDeviceName(req) {
    const explicitName = req.headers["x-device-name"];
    if (typeof explicitName === "string" && explicitName.length > 0) {
        return explicitName.slice(0, 100);
    }

    const userAgent = req.headers["user-agent"];
    if (typeof userAgent === "string" && userAgent.length > 0) {
        return userAgent.slice(0, 100);
    }

    return "unknown-device";
}

function requestContext(req, res, next) {
    const requestIdHeader = req.headers["x-request-id"];
    const deviceIdHeader = req.headers["x-device-id"];
    const requestId = typeof requestIdHeader === "string" && isUuid(requestIdHeader) ? requestIdHeader : uuidv4();
    const deviceId = typeof deviceIdHeader === "string" && isUuid(deviceIdHeader) ? deviceIdHeader : null;

    req.context = {
        requestId,
        deviceId,
        ipAddress: getIpAddress(req),
        userAgent: req.headers["user-agent"] || "unknown-user-agent",
        deviceName: getDeviceName(req),
    };

    res.setHeader("x-request-id", req.context.requestId);
    next();
}

module.exports = requestContext;
