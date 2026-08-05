const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(data),
});

describe("OneMap location search", () => {
  const originalBaseUrl = process.env.ONEMAP_BASE_URL;
  const originalEmail = process.env.ONEMAP_API_EMAIL;
  const originalPassword = process.env.ONEMAP_API_PASSWORD;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[require.resolve("../config/env")];
    delete require.cache[require.resolve("../services/locationService")];
    process.env.ONEMAP_BASE_URL = "https://www.onemap.gov.sg";
    process.env.ONEMAP_API_EMAIL = "manager@example.com";
    process.env.ONEMAP_API_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-one", expiry_timestamp: String(expiry) }))
      .mockResolvedValueOnce(jsonResponse({ error: "Authentication token expired. Tokens is valid for 3 days.", results: [] }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-two", expiry_timestamp: String(expiry) }))
      .mockResolvedValueOnce(jsonResponse({
        results: [{
          SEARCHVAL: "OUR TAMPINES HUB",
          BUILDING: "OUR TAMPINES HUB",
          ADDRESS: "1 TAMPINES WALK SINGAPORE 528523",
          POSTAL: "528523",
          LATITUDE: "1.3526",
          LONGITUDE: "103.9398",
        }],
      }));

    const { searchLocations } = require("../services/locationService");
    const locations = await searchLocations("Tampines Hub");

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe("token-one");
    expect(global.fetch.mock.calls[3][1].headers.Authorization).toBe("token-two");
    expect(locations).toEqual([expect.objectContaining({
      label: "OUR TAMPINES HUB",
      postalCode: "528523",
      timezone: "Asia/Singapore",
    })]);
  });

  test("reuses a valid cached token across searches", async () => {
    const expiry = Math.floor(Date.now() / 1000) + 72 * 60 * 60;
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "cached-token", expiry_timestamp: String(expiry) }))
      .mockResolvedValue(jsonResponse({ results: [] }));

    const { searchLocations } = require("../services/locationService");
    await searchLocations("Tampines");
    await searchLocations("Bedok");

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe("cached-token");
    expect(global.fetch.mock.calls[2][1].headers.Authorization).toBe("cached-token");
  });

  test("reports rejected credentials without exposing the provider response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      error: "Your password should be between 8 and 60 characters.",
    }, 400));

    const { searchLocations } = require("../services/locationService");

    await expect(searchLocations("Compass One")).rejects.toMatchObject({
      status: 503,
      code: "LOCATION_SEARCH_AUTH_FAILED",
      message: "OneMap rejected the configured sign-in; update the backend credentials",
    });
  });
});
