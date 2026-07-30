const ACCESS_COOKIE = "vsms_access";
const REFRESH_COOKIE = "vsms_refresh";
const USERNAME_COOKIE = "vsms_username";

function parseCookies(header = "") {
    return String(header)
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separator = part.indexOf("=");
            if (separator < 0) return cookies;
            cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
            return cookies;
        }, {});
}

function cookie(name, value, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        "HttpOnly",
        "Path=/",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

function setAuthCookies(res, authenticationResult, username) {
    const accessMaxAge = Number(authenticationResult.ExpiresIn || 3600);
    const refreshMaxAge = Number(process.env.REFRESH_COOKIE_MAX_AGE_SECONDS || 30 * 24 * 60 * 60);
    const cookies = [
        cookie(ACCESS_COOKIE, authenticationResult.AccessToken, accessMaxAge),
        cookie(USERNAME_COOKIE, username, refreshMaxAge),
    ];
    if (authenticationResult.RefreshToken) {
        cookies.push(cookie(REFRESH_COOKIE, authenticationResult.RefreshToken, refreshMaxAge));
    }
    res.setHeader("Set-Cookie", cookies);
}

function clearAuthCookies(res) {
    res.setHeader("Set-Cookie", [
        cookie(ACCESS_COOKIE, "", 0),
        cookie(REFRESH_COOKIE, "", 0),
        cookie(USERNAME_COOKIE, "", 0),
    ]);
}

module.exports = {
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    USERNAME_COOKIE,
    parseCookies,
    setAuthCookies,
    clearAuthCookies,
};
