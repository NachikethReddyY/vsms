const crypto = require("crypto");
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

module.exports = (req, res, next) => {
  const supplied = req.get("x-request-id");
  req.requestId = supplied && UUID.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  const suppliedDeviceId = req.get("x-device-id");
  const deviceId = suppliedDeviceId && UUID.test(suppliedDeviceId)
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
