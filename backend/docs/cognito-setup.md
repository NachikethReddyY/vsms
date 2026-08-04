# Cognito staff setup

The application contains no local password authentication. Cognito verifies passwords, performs mandatory TOTP MFA, issues tokens, and supplies group claims. PostgreSQL stores only the approved local staff profile and application role.

## Deploy the user pool

The versioned CloudFormation template is at `infrastructure/cognito.yaml`. It creates:

- an email-login staff user pool;
- a public web app client with refresh flow and token revocation;
- a 12-character complexity policy;
- verified-email account recovery;
- mandatory software-token MFA;
- advanced threat protection;
- Cognito managed login with an authorization-code grant and PKCE;
- `Admin`, `EventManager`, `RegistrationOfficer`, `Screener`, `Reviewer`, and `Support` groups;
- administrator-only account creation.

Deploy it from the project root:

```powershell
aws cloudformation deploy `
  --template-file infrastructure/cognito.yaml `
  --stack-name vsms-staff-development `
  --parameter-overrides EnvironmentName=development FrontendUrl=https://localhost:5173
```

Copy the output values into `backend/.env` as `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_REGION`, `COGNITO_DOMAIN`, and `COGNITO_REDIRECT_URI`. Set `COGNITO_LOGOUT_URI` to the same frontend origin used by `FrontendUrl`.

## Create staff

Use the administrator Staff screen for normal account creation and role/status changes. It creates a missing Cognito identity, synchronizes the application groups, and commits the matching PostgreSQL profile only after Cognito succeeds. If the local transaction fails, the Cognito changes are compensated.

`COGNITO_STAFF_SYNC_MODE=required` is the default. A developer may explicitly set `COGNITO_STAFF_SYNC_MODE=local-only` for a local environment without Cognito; production rejects that mode.

The commands below are retained for bootstrap or test accounts when the administrator UI is unavailable.

Create Cognito staff accounts using the AWS Console or an approved administrator workflow. Never commit a temporary password.

```powershell
aws cognito-idp admin-create-user --user-pool-id YOUR_POOL_ID --username officer@example.com --user-attributes Name=email,Value=officer@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id YOUR_POOL_ID --username officer@example.com --group-name RegistrationOfficer
```

Create the matching local profile without a password:

```powershell
pnpm provision-staff -- officer@example.com "Registration Officer" RO-001 REGISTRATION_OFFICER
```

Repeat with the Cognito group and local role required by the staff member. The supported pairs are `Admin` (or legacy `ADMIN`)/`ADMINISTRATOR`, `EventManager`/`EVENT_MANAGER`, `RegistrationOfficer`/`REGISTRATION_OFFICER`, `Screener`/`SCREENER`, `Reviewer`/`REVIEWER`, and `Support`/`SUPPORT`. Support accounts receive assigned event and shift visibility only; they cannot access participant data, registration, screening, clinical review, organisation accounts, or event deletion. Both the verified Cognito group and local role must match; an inactive local account or missing group receives `403`.

Selecting Sign in redirects the browser to Cognito managed login. Cognito handles temporary-password changes, password recovery, and MFA before returning an authorization code to `/auth/callback`; the backend exchanges it with PKCE and stores tokens only in HttpOnly cookies.

## Production settings

- Serve both applications over HTTPS.
- Auth cookies are always `Secure`; terminate TLS only at a trusted proxy.
- Set `CORS_ORIGIN` to the exact frontend origin. Separate multiple approved origins with commas.
- Point `SIGNATURE_STORAGE_DIR` to encrypted, access-controlled persistent storage.
- Keep `.env` out of source control and use the deployment platform’s secret manager.
- Rotate app-client secrets if a confidential client is selected.
