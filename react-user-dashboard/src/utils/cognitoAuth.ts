export function getCognitoAuthorizeUrl(returnTo = "/events", screenHint?: "signup") {
  const baseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/auth/authorize`, window.location.origin);
  url.searchParams.set("returnTo", returnTo);
  if (screenHint) url.searchParams.set("screen_hint", screenHint);
  return url.toString();
}
