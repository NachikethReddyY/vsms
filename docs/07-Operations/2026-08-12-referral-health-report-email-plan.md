# Referral health report email plan

## Goal

When a reviewer issues a referral, generate the existing signed health-report PDF, protect it with a one-time random password, and email it as an attachment through the existing delivery tracking flow.

The PDF password remains a cryptographically random, one-time handoff secret. The reviewer receives it once through the authenticated issuance response and shares it with the intended recipient through a separate channel.

## Approach

1. Reuse the existing referral issuance endpoint, reviewer authorization, PDFKit renderer, SES attachment delivery, idempotency, audit logs, document artifact, and notification delivery records.
2. Keep the existing 18-byte random handoff secret, 15-minute encrypted recovery escrow, one-time acknowledgement, and no-secret-in-email rule.
3. Centralize the referral email subject and body in the existing service so the delivered MIME and stored delivery metadata use the same template.
4. Update the issuance UI copy to explain that the recipient may be the participant or referral provider, and that the reviewer must verify the address and share the one-time password separately.
5. Add executable checks for the email template, encrypted PDF, secret non-disclosure, and idempotent one-email behavior using the existing referral tests.

## Components

- Backend: `backend/services/screening/referralService.js`
- Validation and API contract: existing referral schemas and `backend/docs/openapi.yaml`, only where the active response changes
- Backend checks: `backend/tests/unit/referral-service.test.js`
- Frontend: existing review issuance form, API types, recovery state, and focused tests
- Delivery: existing SES raw MIME attachment path; no new provider or infrastructure

## Tradeoffs

- A random password requires a separate handoff, but avoids a reusable, offline-guessable credential derived from participant identifiers.
- Retaining existing artifact and delivery records avoids a migration and preserves download integrity, retry safety, auditability, and historical compatibility.
- Email attachment delivery avoids a public download-token route but inherits email size and provider-delivery limits already handled by the current flow.

## Foundations

| Area | Decision | Rationale / rejected alternative |
|---|---|---|
| Database Schema | Reuse `Referral`, `DocumentArtifact`, and `NotificationDelivery`; no new table or migration. | The PDF remains a generated attachment within the existing audited flow. A recipient-share table was rejected because there is no hosted portal or link. |
| TypeScript Types | Keep generated OpenAPI client types. | One contract source prevents hand-written DTO drift. |
| Validation Strategy | Keep existing Zod server validation and native email input validation; generate the password cryptographically on the server. | Client-provided or participant-derived password material would expose or weaken the trust boundary. |
| Routing Structure | Reuse the authenticated referral issuance route. | A public hosted-download route adds token expiry and access-control surface without serving the attachment requirement. |
| Auth Flow | Preserve reviewer ownership and event membership checks and retain the random one-time passphrase with separate-channel handoff. | Preflight security found the proposed NRIC-plus-phone password to be reusable and offline-guessable; the user approved the safer recommendation. |
| CSS Methodology | Reuse colocated plain CSS only if styling changes. | Tailwind migration is deferred to a separate cleanup to avoid mixed conventions. |
| UI Framework | Reuse the installed ASTRYX/shared controls and current issuance form. | Adding shadcn or another library for one flow creates redundant primitives. |
| Client-Server Communication | Keep Axios REST and the existing idempotent POST. | A new job/RPC system is unnecessary for the existing synchronous provider flow. |
| Folder Structure | Keep logic and tests in the existing referral service and reviews feature. | Extract a shared document/email package only when another flow needs the same behavior. |

## Acceptance checks

- Issuing a referral sends one email with the encrypted PDF attached through the configured provider.
- The returned one-time passphrase opens the PDF; the PDF does not expose clinical plaintext without decryption.
- The actual password does not appear in the email, audit details, logs, signed payload, stored delivery template, or filename.
- The reviewer is told to verify whether the address belongs to the participant or intended referral provider before issuing.
- Duplicate issuance remains idempotent and does not send a second email.
- Existing backend tests, frontend focused tests, lint, build, schema validation, OpenAPI lint, and contract checks pass.
