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
- `Admin` and `RegistrationOfficer` groups;
- administrator-only account creation.

Deploy it from the project root:

```powershell
aws cloudformation deploy `
  --template-file infrastructure/cognito.yaml `
  --stack-name vsms-staff-development `
  --parameter-overrides EnvironmentName=development
```

Copy the output values into `backend/.env` as `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, and `COGNITO_REGION`.

## Create test staff

Create Cognito staff accounts using the AWS Console or an approved administrator workflow. Never commit a temporary password.

```powershell
aws cognito-idp admin-create-user --user-pool-id YOUR_POOL_ID --username officer@example.com --user-attributes Name=email,Value=officer@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id YOUR_POOL_ID --username officer@example.com --group-name RegistrationOfficer
```

Create the matching local profile without a password:

```powershell
npm run provision-staff -- officer@example.com "Registration Officer" RO-001 REGISTRATION_OFFICER
```

Repeat with the `Admin` Cognito group and `ADMINISTRATOR` local role for the administrator test account. Both the verified Cognito group and local role must match; an inactive local account or missing group receives `403`.

At first login, the web app handles Cognito's permanent-password challenge and software-token MFA enrollment. The staff member enters the setup key in an authenticator app and verifies the generated code before a session is issued.

## Production settings

- Serve both applications over HTTPS.
- Set `COOKIE_SECURE=true`.
- Set `CORS_ORIGIN` to the exact frontend origin. Separate multiple approved origins with commas.
- Point `SIGNATURE_STORAGE_DIR` to encrypted, access-controlled persistent storage.
- Keep `.env` out of source control and use the deployment platform’s secret manager.
- Rotate app-client secrets if a confidential client is selected.
