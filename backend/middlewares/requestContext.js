const crypto = require("crypto");

module.exports = (req, res, next) => {
  const supplied = req.get("x-request-id");
  req.requestId = supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const suppliedDeviceId = req.get("x-device-id");
  const deviceId = suppliedDeviceId && /^[0-9a-f-]{36}$/i.test(suppliedDeviceId)
    ? suppliedDeviceId
    : null;
  req.context = {
    requestId: req.requestId,
    deviceId,
    deviceName: String(req.get("x-device-name") || "VSMS staff web").slice(0, 100),
    ipAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 45),
    userAgent: String(req.get("user-agent") || "").slice(0, 500),
  };
  next();
};
