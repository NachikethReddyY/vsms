const env = require("../config/env");
const AppError = require("../errors/AppError");

let cachedToken = null;
let tokenExpiresAt = 0;
let tokenRefresh = null;

const providerUrl = (pathname, query) => {
  const url = new URL(pathname, env.ONEMAP_BASE_URL);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  return url;
};

const fetchProvider = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  return response;
};

const refreshToken = async () => {
  if (!env.ONEMAP_API_EMAIL || !env.ONEMAP_API_PASSWORD) {
    throw new AppError(503, "LOCATION_SEARCH_NOT_CONFIGURED", "Location search is not configured; enter the venue manually");
  }
  const response = await fetchProvider(providerUrl("/api/auth/post/getToken"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.ONEMAP_API_EMAIL, password: env.ONEMAP_API_PASSWORD }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  }
  if (!response.ok) {
    if ([400, 401, 404].includes(response.status)) {
      throw new AppError(503, "LOCATION_SEARCH_AUTH_FAILED", "OneMap rejected the configured sign-in; update the backend credentials");
    }
    throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  }
  const expiryTimestamp = Number(data.expiry_timestamp);
  if (!data.access_token || !Number.isFinite(expiryTimestamp) || expiryTimestamp <= Date.now() / 1000) {
    throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  }
  cachedToken = data.access_token;
  tokenExpiresAt = expiryTimestamp * 1000;
  return cachedToken;
};

const getToken = async (force = false) => {
  if (!force && cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return cachedToken;
  if (!tokenRefresh) {
    tokenRefresh = refreshToken().finally(() => {
      tokenRefresh = null;
    });
  }
  return tokenRefresh;
};

const requestSearch = async (query, forceRefresh = false) => {
  const token = await getToken(forceRefresh);
  const response = await fetchProvider(providerUrl("/api/common/elastic/search", {
    searchVal: query,
    returnGeom: "Y",
    getAddrDetails: "Y",
    pageNum: "1",
  }), { headers: { Authorization: token } });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  }
  return { response, data };
};

const tokenRejected = ({ response, data }) => response.status === 401
  || /authentication token|token (?:is )?(?:expired|invalid|missing)/i.test(String(data?.error || ""));

const searchLocations = async (query) => {
  let result;
  try {
    result = await requestSearch(query);
    if (tokenRejected(result)) result = await requestSearch(query, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  }
  const { response, data } = result;
  if (!response.ok) throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  if (data.error) throw new AppError(503, "LOCATION_PROVIDER_UNAVAILABLE", "Location search is temporarily unavailable");
  return (data.results || []).slice(0, 8).flatMap((item) => {
    const latitude = Number(item.LATITUDE);
    const longitude = Number(item.LONGITUDE || item.LONGTITUDE);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const building = item.BUILDING && item.BUILDING !== "NIL" ? item.BUILDING : item.SEARCHVAL;
    const address = item.ADDRESS || item.SEARCHVAL;
    return [{
      id: `${item.POSTAL || ""}:${latitude}:${longitude}`,
      label: building || address,
      address,
      postalCode: item.POSTAL || null,
      latitude,
      longitude,
      provider: "ONEMAP",
      timezone: "Asia/Singapore",
    }];
  });
};

module.exports = { searchLocations };
