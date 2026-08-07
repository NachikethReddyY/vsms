function sessionOriginMs(payload, { allowLocalIatFallback = false } = {}) {
  const authTime = Number(payload?.auth_time);
  if (Number.isFinite(authTime) && authTime > 0) return authTime * 1000;
  if (allowLocalIatFallback) {
    const issuedAt = Number(payload?.iat);
    if (Number.isFinite(issuedAt) && issuedAt > 0) return issuedAt * 1000;
  }
  return null;
}

function sessionValidity(user, payload, options) {
  const origin = sessionOriginMs(payload, options);
  if (origin === null) return { valid: false, reason: "MISSING_SESSION_ORIGIN" };
  if (user.sessionInvalidBefore && origin <= user.sessionInvalidBefore.getTime()) {
    return { valid: false, reason: "SESSION_REVOKED" };
  }
  return { valid: true, reason: null };
}

module.exports = { sessionOriginMs, sessionValidity };
