/**
 * Safe Navigation Utility (Layer 2 Open Redirect Guard)
 * Protects against open redirect vulnerabilities by validating target URLs
 * before executing client-side navigation.
 */

// Define allowed internal or trusted external domain hostnames
const ALLOWED_REDIRECT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'vsms-screening.org',
  'app.vsms-screening.org',
]);

/**
 * Validates a target URL string and returns a safe URL for navigation.
 * * @param targetUrl - The raw redirect URL string (e.g., from query params)
 * @param fallback - The safe fallback route if validation fails (default: '/dashboard')
 * @returns A safe relative path or validated absolute URL string
 */
export function getSafeRedirectUrl(
  targetUrl: string | null | undefined,
  fallback: string = '/dashboard'
): string {
  // 1. Return fallback if input is empty or null
  if (!targetUrl) {
    return fallback;
  }

  const cleanUrl = targetUrl.trim();

  // 2. Allow safe relative paths (e.g., "/dashboard", "/settings")
  // Block protocol-relative URLs like "//attacker.com" or backslash bypasses "/\"
  if (
    cleanUrl.startsWith('/') &&
    !cleanUrl.startsWith('//') &&
    !cleanUrl.startsWith('/\\')
  ) {
    return cleanUrl;
  }

  // 3. Handle Absolute URLs
  try {
    const parsed = new URL(cleanUrl);

    // Enforce strict HTTP/HTTPS protocol check (Blocks javascript:, data:, file: URIs)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      console.warn(`[Security Guard] Blocked unsafe protocol: ${parsed.protocol}`);
      return fallback;
    }

    // Check hostname against trusted domain allowlist
    if (ALLOWED_REDIRECT_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed.href;
    }

    console.warn(`[Security Guard] Blocked unauthorized domain redirect to: ${parsed.hostname}`);
  } catch {
    console.warn(`[Security Guard] Malformed redirect URL ignored: ${cleanUrl}`);
  }

  // Fallback if URL fails validation
  return fallback;
}