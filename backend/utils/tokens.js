const jwt = require("jsonwebtoken");
const env = require("../config/env");

const signAccessToken = (user) => jwt.sign(
  { type: "access" },
  env.jwtAccessSecret,
  {
    algorithm: "HS256",
    subject: user.id, // <-- FIX: Changed from user.userId to user.id
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL,
  },
);

const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret, {
  algorithms: ["HS256"],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
});

module.exports = { signAccessToken, verifyAccessToken };