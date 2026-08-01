# Auth and route-protection plan

## Goal

Require a validated session for every frontend route except `/`, `/login`, and `/signup`; restore sessions safely after reload; and make local HTTPS login work from both `localhost` and `127.0.0.1` without weakening the production origin boundary.

## Confirmed evidence

- `react-user-dashboard/src/App.tsx` exposes `/events` outside `ProtectedRoutes`.
- A login from `https://127.0.0.1:5173` sends an OPTIONS request to `https://localhost:5050/auth/login`; the API returns 403 because its exact origin allowlist only contains `https://localhost:5173`.
- `vsms_csrf` is scoped to `/auth`, so `AuthProvider` cannot read it from application routes after a reload.
- API event, user, and QR routes already authenticate on the server. Frontend route protection is an additional navigation/privacy boundary, not a replacement for API authorization.
- Access JWT verification already pins HS256, issuer, audience, expiry, token type, subject, and current active-user status. Refresh tokens are opaque, hashed in PostgreSQL, rotated once, family-revoked on reuse, Secure, HttpOnly, and SameSite=Strict.

## Approach

1. Put `/events` and every other non-public page behind the existing session bootstrap guard. Keep only `/`, `/login`, and `/signup` public.
2. Split session validation from workspace layout. Preserve the redesigned events surface without wrapping it in the older `AppShell`; keep the remaining private workspace pages in `AppShell`.
3. Make the default browser API hostname match `window.location.hostname`, while retaining `VITE_API_BASE_URL` and the existing QA proxy override.
4. Exact-allowlist both local HTTPS origins in development defaults and `.env.example`; do not use wildcard origins.
5. Scope only the readable CSRF cookie to `/` so session bootstrap can send it to `/auth/refresh`. Clear the legacy `/auth` CSRF cookie whenever cookies are issued or removed. Keep the refresh cookie HttpOnly and scoped to `/auth`.
6. Route bootstrap and Axios retries through one shared single-flight refresh function so React StrictMode and concurrent 401 responses cannot reuse a one-time refresh token.
7. Replace hard-coded events, identity, and login-bound actions in the redesigned events surface with authenticated user state, `eventApi` data, private event-detail links, and logout.
8. Retire `/forgot-password`, whose backend endpoint does not exist, rather than creating an authenticated recovery dead end.
9. Apply the existing Zod request-validation middleware to QR route parameters.
10. Add backend integration assertions for both allowed local origins, rejection of an unlisted origin, independent refresh/CSRF cookie attributes, malformed QR parameters, unauthenticated event reads and writes, and rejected JWT claims.
11. Verify the complete route matrix in the browser: no private-content flash, full deep-link return, reload restoration, service-unavailable retry, logout/session expiry, and consistent desktop/phone behavior on both local hostnames.

## Tradeoffs

- Supporting two explicit development origins is a slightly larger local allowlist, but remains exact and matches the certificate SANs.
- A CSRF cookie readable across the SPA has broader path exposure, but cookie paths are not a security boundary against same-origin script. The sensitive refresh token remains HttpOnly and `/auth`-scoped.
- No new auth library, UI framework, database table, or frontend test dependency is introduced.

## Foundations

| Area | Decision | Notes |
|---|---|---|
| Database Schema | PostgreSQL + Prisma, existing `User` and `RefreshSession`; no migration | Existing ownership, rotation, expiry, and revocation data are sufficient. |
| TypeScript Types | OpenAPI-generated frontend types; CommonJS backend | Preserve the current contract workflow. |
| Validation Strategy | Zod is authoritative at API boundaries; React Hook Form provides client feedback | Server validation remains the trust boundary. |
| Routing Structure | Only `/`, `/login`, and `/signup` public; all other pages private | API routes remain independently authenticated and role-gated. |
| Auth Flow | Memory-only HS256 access JWT, rotated opaque refresh cookie, CSRF, active-user check, RBAC | Fix origin/host and CSRF scope without replacing auth. |
| CSS Methodology | Existing global/feature CSS and current Tailwind usage | No styling migration during the security fix. |
| UI Framework | Reuse installed primitives and icon libraries | Polish with existing components; no new framework. |
| Client-Server Communication | REST + Axios + OpenAPI | Preserve current interceptors and contract. |
| Folder Structure | Existing frontend feature folders and backend route/controller/service layering | Touch the fewest existing files. |

## Rejected alternatives

- New auth/session framework: larger migration with no benefit for the identified defects.
- Wildcard CORS or reflected origins: incompatible with credentialed requests and unsafe.
- Persisting access JWTs in local storage: increases token exposure to XSS.
- Redirecting all `127.0.0.1` traffic to `localhost`: valid, but conflicts with the confirmed dual-host development choice.
- New component framework or full CSS migration: unrelated to the auth boundary.
