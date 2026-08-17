import apiClient from "./apiClient";

export async function logoutAndReturnHome(clearSession: () => void) {
  clearSession();
  let logoutUrl: string | null = null;
  try {
    const response = await apiClient.post<{ logoutUrl?: string }>("/auth/logout");
    const candidate = response.data.logoutUrl;
    if (candidate && new URL(candidate).protocol === "https:") logoutUrl = candidate;
  } catch {
    // HttpOnly cookies can only be cleared by the server. The local auth state
    // is already locked; encrypted offline work remains available after sign-in.
  } finally {
    const landing = new URL("/", window.location.href);
    landing.protocol = "https:";
    window.location.replace(logoutUrl ?? landing.toString());
  }
}
