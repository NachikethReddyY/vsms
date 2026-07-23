const crypto = require("crypto");

module.exports = (req, res, next) => {
  const supplied = req.get("x-request-id");
  req.requestId = supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
};
