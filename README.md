# VSMS secure staff registration

This module covers the staff workflow from secure Cognito login through participant registration and the registration-ID handoff to QR/check-in. Staff passwords and Cognito tokens are never stored in PostgreSQL or browser JavaScript storage.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL
- An AWS account and AWS CLI for deploying Cognito

## 1. Configure Cognito

Deploy `infrastructure/cognito.yaml`, then follow `backend/docs/cognito-setup.md`. The template enforces administrator-created staff accounts, a 12-character password policy, mandatory authenticator-app MFA, recovery by verified email, and the `Admin` and `RegistrationOfficer` groups.

Create matching local staff profiles with `npm run provision-staff`; both the Cognito group and local role must authorize access.

## 2. Configure and migrate the backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed
```

Edit `backend/.env` before migrating. At minimum, set `DATABASE_URL`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, and the exact `CORS_ORIGIN`. Do not commit `.env`.

Start the API:

```powershell
npm start
```

The default API URL is `http://localhost:5000/api/v1`. API documentation is available at `/api-docs`.

## 3. Configure and run the frontend

```powershell
cd react-user-dashboard
Copy-Item .env.example .env
npm install
npm run dev
```

The default frontend URL is `http://localhost:5173`. Staff sign in at `/login`. A new administrator-created account is prompted to set its permanent password and enroll an authenticator before access is granted.

## Verification

```powershell
cd backend
npm test

cd ..\react-user-dashboard
npm run lint
npm run build
```

The API uses HttpOnly cookies, verified Cognito claims, matching local roles, active-user checks, request IDs, rate limits, strict validation, idempotency keys, database uniqueness constraints, append-only consent/status evidence, and redacted audit logs.

## Production requirements

- Serve the frontend and API over HTTPS and set `COOKIE_SECURE=true`.
- Store environment values in the deployment platform's secret manager.
- Set `SIGNATURE_STORAGE_DIR` to encrypted, access-controlled persistent storage.
- Apply Prisma migrations before starting the new application version.
- Keep Cognito staff creation and local role approval within an administrator workflow.
