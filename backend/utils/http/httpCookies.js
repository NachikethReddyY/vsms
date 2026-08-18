const crypto = require("crypto");
const env = require("../../config/env");

const ACCESS_COOKIE = "vsms_access";
const REFRESH_COOKIE = "vsms_refresh";
const USERNAME_COOKIE = "vsms_username";
const CSRF_COOKIE = "vsms_csrf";
const OAUTH_STATE_COOKIE = "vsms_oauth_state";
const OAUTH_VERIFIER_COOKIE = "vsms_oauth_verifier";
const OAUTH_RETURN_TO_COOKIE = "vsms_oauth_return_to";

function parseCookies(header = "") {
    return String(header)
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separator = part.indexOf("=");
            if (separator < 0) return cookies;
            try {
                cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
            } catch {
                // Ignore malformed, attacker-controlled cookie values.
            }
            return cookies;
        }, {});
}

function cookie(name, value, maxAgeSeconds, httpOnly = true) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "SameSite=Lax",
        "Secure",
        `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    ];
    if (httpOnly) parts.splice(1, 0, "HttpOnly");
    return parts.join("; ");
}

function appendCookies(res, cookies) {
    const current = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", [...(Array.isArray(current) ? current : current ? [current] : []), ...cookies]);
}

function setAuthCookies(res, authenticationResult, username) {
    const accessMaxAge = Number(authenticationResult.ExpiresIn || 3600);
    const refreshMaxAge = env.REFRESH_COOKIE_MAX_AGE_SECONDS;
    const csrfToken = crypto.randomBytes(32).toString("base64url");
    const cookies = [
        cookie(ACCESS_COOKIE, authenticationResult.AccessToken, accessMaxAge),
        cookie(USERNAME_COOKIE, username, refreshMaxAge),
        cookie(CSRF_COOKIE, csrfToken, refreshMaxAge, false),
    ];
    if (authenticationResult.RefreshToken) {
        cookies.push(cookie(REFRESH_COOKIE, authenticationResult.RefreshToken, refreshMaxAge));
    }
    appendCookies(res, cookies);
    return csrfToken;
}

function clearAuthCookies(res) {
    appendCookies(res, [
        cookie(ACCESS_COOKIE, "", 0),
        cookie(REFRESH_COOKIE, "", 0),
        cookie(USERNAME_COOKIE, "", 0),
        cookie(CSRF_COOKIE, "", 0, false),
    ]);
}

function setOAuthCookies(res, { state, verifier, returnTo }) {
    const maxAge = 10 * 60;
    appendCookies(res, [
        cookie(OAUTH_STATE_COOKIE, state, maxAge),
        cookie(OAUTH_VERIFIER_COOKIE, verifier, maxAge),
        cookie(OAUTH_RETURN_TO_COOKIE, returnTo, maxAge),
    ]);
}

function clearOAuthCookies(res) {
    appendCookies(res, [
        cookie(OAUTH_STATE_COOKIE, "", 0),
        cookie(OAUTH_VERIFIER_COOKIE, "", 0),
        cookie(OAUTH_RETURN_TO_COOKIE, "", 0),
    ]);
}

module.exports = {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    USERNAME_COOKIE,
    CSRF_COOKIE,
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_RETURN_TO_COOKIE,
    parseCookies,
    setAuthCookies,
    clearAuthCookies,
    setOAuthCookies,
    clearOAuthCookies,
};
