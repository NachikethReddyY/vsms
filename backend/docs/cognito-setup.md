# Cognito setup

This project is wired so Cognito configuration stays in local environment files and does not need to be committed in a pull request.

## 1. Create the user pool

1. Open AWS Console.
2. Go to `Amazon Cognito`.
3. Create a new `User Pool`.
4. Use `Email` as a sign-in option.
5. Turn on self-service sign-up if you want staff accounts created from the app.
6. Add the standard attributes you want to collect, then add these custom attributes:
   - `employee_number`
   - `department`
   - `designation`
   - `role`
7. Configure password policy and MFA based on your project requirement.

## 2. Create the app client

1. Inside the user pool, create an `App client`.
2. Enable:
   - `ALLOW_USER_PASSWORD_AUTH`
   - `ALLOW_REFRESH_TOKEN_AUTH`
   - `ALLOW_USER_SRP_AUTH` if you want future hosted UI flexibility
3. If you use a client secret, copy it into `COGNITO_APP_CLIENT_SECRET`.
4. Save the `User Pool ID`, `App Client ID`, region, and optional client secret.

## 3. Local backend setup

1. Copy [backend/.env.example](C:\Users\mikef\OneDrive\Documents\DBS PROJECT 2\backend\.env.example) to `backend/.env`.
2. Fill in:
   - `DATABASE_URL`
   - `COGNITO_REGION`
   - `COGNITO_USER_POOL_ID`
   - `COGNITO_APP_CLIENT_ID`
   - `COGNITO_APP_CLIENT_SECRET` if your app client uses one
3. Start the backend on `http://localhost:5000`.

## 4. Local frontend setup

1. Copy [react-user-dashboard/.env.example](C:\Users\mikef\OneDrive\Documents\DBS PROJECT 2\react-user-dashboard\.env.example) to `react-user-dashboard/.env`.
2. Keep `VITE_API_BASE_URL` pointed at your local backend unless you intentionally deploy an API somewhere else.
3. Start the frontend on `http://localhost:5173`.

## 5. What teammates need

Teammates do not need your Cognito values in git.

They only need their own local `backend/.env` and `react-user-dashboard/.env`.

If they do not configure Cognito, the frontend still builds, but the protected auth routes will return `503 Cognito is not configured`.

## 6. Current auth routes

Backend base path: `http://localhost:5000/api/v1/auth`

- `GET /config-status`
- `POST /signup`
- `POST /confirm-signup`
- `POST /resend-code`
- `POST /login`
- `POST /respond-to-challenge`
- `POST /refresh`
- `GET /me`
- `POST /logout`
- `POST /global-logout`
- `POST /forgot-password`
- `POST /confirm-forgot-password`
- `POST /change-password`

## 7. Current frontend routes

Frontend base path: `http://localhost:5173`

- `/login`
- `/signup`
- `/verify-signup`
- `/forgot-password`
- `/reset-password`
- `/dashboard`
- `/cognito-test`
- `/events/:eventId/register`
- `/participants/search`
- `/participants/new`
- `/participants/:participantId`
- `/participants/:participantId/edit`
- `/participants/:participantId/emergency-contacts`
- `/events/:eventId/participants/:participantId/consent`
- `/events/:eventId/participants/:participantId/review`
- `/registrations/:registrationId/confirmation`
- `/participants/:participantId/history`
- `/account/security`
- `/admin/audit-logs`
