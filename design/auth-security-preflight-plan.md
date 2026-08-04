# Whole-application security and design plan

## Goal

Require a validated session for every frontend route except `/`, `/login`, and `/signup`; restore sessions safely after reload; make local HTTPS login work from both `localhost` and `127.0.0.1` without weakening the production origin boundary; and bring every routed page into the operational design system defined by `docs/design.md` and the shipped landing page.

## Routed page inventory

| Route | Access | Surface | Required outcome |
|---|---|---|---|
| `/` | Public | Landing page | Keep the shipped visual world and working sign-in path. |
| `/login` | Public | Sign in | Clear validation, recovery from API errors, full deep-link return. |
| `/signup` | Public | Staff sign-up | Match server policy and validation without revealing account details. |
| `/events` | Authenticated | Event register | Real scoped event data, responsive navigation, loading/error/empty states. |
| `/events/new` | Authenticated; manager/admin action | Create event | Role-aware access, server-validated form, responsive draft workflow. |
| `/events/:eventId` | Authenticated and event-scoped | Event detail | Ownership-aware data, lifecycle/staff actions, complete states. |
| `/events/:eventId/edit` | Authenticated and manager-scoped | Edit event | Reuse the event form with scoped fetch/update and safe conflict handling. |
| `/qr-generator` | Authenticated | QR lookup/generation | Validate identifiers/tokens, avoid participant data leakage, match the app shell. |
| `/settings` | Authenticated | Account settings | Show account context and workspace appearance without exposing security controls. |

Unrouted prototype components are not application pages. They will not be exposed or expanded as part of this pass.

## Private navigation and state rules

- Events and QR passes are the discoverable private destinations on desktop, tablet, and phone. Settings remains in the account menu; event create/edit/detail remain contextual event actions.
- The Events register may retain its image-led header, but it must expose the same destinations, account action, focus behavior, and permission rules as `AppShell`.
- Create and edit routes require `ADMIN` or `EVENT_MANAGER` before rendering. An authenticated `STAFF` user is returned to Events with a clear permission message; the API independently enforces the same boundary.
- QR generation starts from a validated participant UUID entered by staff. It never displays a fabricated identity or the raw token; unknown, expired, and out-of-scope records use the same non-enumerating unavailable state.

## Route state matrix

| Surface | Loading | Empty | Error/recovery | Permission/conflict |
|---|---|---|---|---|
| Auth bootstrap | Secure-session message | Anonymous redirect | Service retry | Expired session returns to login with full deep link. |
| Events | Register skeleton | Distinct upcoming, past, and search copy | Retry/clear search | Create action only for manager/admin. |
| Event detail | Detail skeleton | Not applicable | Blocking unavailable + return | Non-enumerating 404; stale actions reload current version. |
| Create/edit | Form or blocking edit load | No shifts is valid | Field errors and retry/return | Route role guard; edit fetch failure never renders a blank editable form. |
| QR passes | Idle lookup form | No pass generated | Invalid/not found/expired/out-of-scope + retry | API verifies event assignment before generation or lookup. |

All surfaces require visible keyboard focus, semantic labels, 44px operational targets, reduced-motion support, no horizontal overflow, and checks at phone, tablet, and wide desktop sizes. Offline/sync states are not fabricated on routes whose APIs do not yet implement offline storage; those capabilities remain documented product requirements rather than false UI.

## Confirmed evidence

- The prior pass moved `/events` behind `ProtectedRoutes`; this pass verifies the complete route matrix and adds explicit role-aware action guards.
- The prior pass aligned the browser API host and exact development CORS allowlist for both `localhost` and `127.0.0.1`; integration and browser checks must preserve that fix.
- The prior pass moved only the readable CSRF cookie to `/` and added single-flight refresh; the refresh cookie remains HttpOnly and scoped to `/auth`.
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
12. Enforce role gating in both the frontend route tree and the API. Hiding controls is only a UX aid; every sensitive event mutation remains server-authorized and event-scoped.
13. Audit the mounted API surface for OWASP access control, authentication, CSRF/CORS, injection, file/data-URL handling, error disclosure, security headers, rate limits, secrets, dependency advisories, and audit logging. Do not claim that the application is absolutely secure; document tested controls and remaining operational requirements.
14. Use `docs/design.md` plus the shipped landing page as the visual authority for all routed React pages: warm neutral surfaces, restrained blue interactivity, semantic state colour, hairline structure, 44px operational targets, visible focus, reduced motion, and complete loading/empty/error/permission states.
15. Retire the redundant `/dashboard` page, redirect old dashboard bookmarks to Events, and keep create/edit/detail/QR/settings flows within the same app shell.
16. Run the Impeccable detector once after the implementation, inspect the complete path at desktop and phone sizes, fix one bounded batch of findings, and confirm once.

## Tradeoffs

- Supporting two explicit development origins is a slightly larger local allowlist, but remains exact and matches the certificate SANs.
- A CSRF cookie readable across the SPA has broader path exposure, but cookie paths are not a security boundary against same-origin script. The sensitive refresh token remains HttpOnly and `/auth`-scoped.
- No new auth library, UI framework, database table, or frontend test dependency is introduced.
- Events is the authenticated home; no speculative analytics endpoint or dashboard card framework is added.
- The public landing page remains an isolated shipped document in an iframe. Shared visual rules are applied to routed React pages without rebuilding the landing page or coupling its CSS to the application bundle.

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
