const { test, describe, beforeEach, afterEach } = require("node:test");
const { expect } = require("expect");

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

const fetchStub = (responses) => {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    const next = responses.shift();
    if (typeof next === "function") return next();
    return next;
  };
  fn.mock = { calls };
  return fn;
};

describe("OneMap location search", () => {
  const originalBaseUrl = process.env.ONEMAP_BASE_URL;
  const originalEmail = process.env.ONEMAP_API_EMAIL;
  const originalPassword = process.env.ONEMAP_API_PASSWORD;
  const originalFetch = global.fetch;

  const resetEnv = () => {
    delete require.cache[require.resolve("../../config/env")];
    delete require.cache[require.resolve("../../services/event/locationService")];
    process.env.ONEMAP_BASE_URL = "https://www.onemap.gov.sg";
    process.env.ONEMAP_API_EMAIL = "manager@example.com";
    process.env.ONEMAP_API_PASSWORD = "test-password";
  };

  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ONEMAP_BASE_URL;
    else process.env.ONEMAP_BASE_URL = originalBaseUrl;
    if (originalEmail === undefined) delete process.env.ONEMAP_API_EMAIL;
    else process.env.ONEMAP_API_EMAIL = originalEmail;
    if (originalPassword === undefined) delete process.env.ONEMAP_API_PASSWORD;
    else process.env.ONEMAP_API_PASSWORD = originalPassword;
  });

  test("renews and retries when OneMap reports an expired token in a 200 response", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 72 * 60 * 60;
    const fetch = fetchStub([
      jsonResponse({ access_token: "token-one", expiry_timestamp: String(expiry) }),
      jsonResponse({ error: "Authentication token expired. Tokens is valid for 3 days.", results: [] }),
      jsonResponse({ access_token: "token-two", expiry_timestamp: String(expiry) }),
      jsonResponse({
        results: [{
          SEARCHVAL: "OUR TAMPINES HUB",
          BUILDING: "OUR TAMPINES HUB",
          ADDRESS: "1 TAMPINES WALK SINGAPORE 528523",
          POSTAL: "528523",
          LATITUDE: "1.3526",
          LONGITUDE: "103.9398",
        }],
      }),
    ]);
    global.fetch = fetch;

    const { searchLocations } = require("../../services/event/locationService");
    const locations = await searchLocations("Tampines Hub");

    expect(fetch.mock.calls).toHaveLength(4);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("token-one");
    expect(fetch.mock.calls[3][1].headers.Authorization).toBe("token-two");
    expect(locations).toEqual([expect.objectContaining({
      label: "OUR TAMPINES HUB",
      postalCode: "528523",
      timezone: "Asia/Singapore",
    })]);
  });

  test("reuses a valid cached token across searches", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 72 * 60 * 60;
    const fetch = fetchStub([
      jsonResponse({ access_token: "cached-token", expiry_timestamp: String(expiry) }),
      jsonResponse({ results: [] }),
      jsonResponse({ results: [] }),
    ]);
    global.fetch = fetch;

    const { searchLocations } = require("../../services/event/locationService");
    await searchLocations("Tampines");
    await searchLocations("Bedok");

    expect(fetch.mock.calls).toHaveLength(3);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("cached-token");
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe("cached-token");
  });

  test("reports rejected credentials without exposing the provider response", async () => {
    global.fetch = fetchStub([
      jsonResponse({
        error: "Your password should be between 8 and 60 characters.",
      }, 400),
    ]);

    const { searchLocations } = require("../../services/event/locationService");

    await expect(searchLocations("Compass One")).rejects.toMatchObject({
      status: 503,
      code: "LOCATION_SEARCH_AUTH_FAILED",
      message: "OneMap rejected the configured sign-in; update the backend credentials",
    });
  });
});