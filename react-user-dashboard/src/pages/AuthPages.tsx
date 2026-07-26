import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient, { getApiError } from "../utils/apiClient";
import { useAuth } from "../auth/AuthProvider";
import {
  AppShell,
  AuthPageLayout,
  Field,
  FormErrorSummary,
  isPasswordValid,
  PasswordRequirements,
  PrimaryButton,
  SessionExpiredDialog,
  TextInput,
} from "../components/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeCode, setChallengeCode] = useState("");
  const [challengeName, setChallengeName] = useState<string | null>(null);
  const [challengeSession, setChallengeSession] = useState<string | null>(null);
  const [challengeUsername, setChallengeUsername] = useState<string | null>(null);
  const [requiredAttributes, setRequiredAttributes] = useState<string[]>([]);
  const [mfaSecretCode, setMfaSecretCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function acceptSession(data: { user: Parameters<typeof setSession>[0]["user"]; sessionExpiresIn?: number }) {
    setSession({
      user: data.user,
      expiresAt: Date.now() + Number(data.sessionExpiresIn || 2_592_000) * 1000,
    });
    navigate("/dashboard");
  }

  function acceptChallenge(data: {
    challengeName: string;
    session: string;
    secretCode?: string;
    challengeUsername?: string;
    requiredAttributes?: string[];
  }) {
    setChallengeName(data.challengeName);
    setChallengeSession(data.session);
    setChallengeUsername(data.challengeUsername ?? email);
    setRequiredAttributes(data.requiredAttributes ?? []);
    setMfaSecretCode(data.secretCode ?? null);
    setChallengeCode("");
  }

  async function handleLoginSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post("/auth/login", { email, password });
      if (response.status === 202 || response.data?.challengeName) {
        acceptChallenge(response.data);
        setPassword("");
      } else {
        acceptSession(response.data);
      }
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Sign-in failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleChallengeSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeName || !challengeSession) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post("/auth/respond-to-challenge", {
        email,
        challengeUsername,
        challengeName,
        session: challengeSession,
        ...(challengeName === "NEW_PASSWORD_REQUIRED"
          ? {
              newPassword,
              userAttributes: requiredAttributes.includes("name")
                ? { name: fullName.trim() }
                : {},
            }
          : { code: challengeCode }),
      });
      if (response.status === 202 || response.data?.challengeName) {
        acceptChallenge(response.data);
        setNewPassword("");
      } else {
        acceptSession(response.data);
      }
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "MFA verification failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Staff login"
      description="Sign in with your approved Cognito staff account. MFA is required by the configured user pool."
      footer={<Link to="/forgot-password">Forgot password?</Link>}
    >
      <SessionExpiredDialog />
      <FormErrorSummary error={error} />
      {!challengeName ? (
        <form className="space-y-4" onSubmit={handleLoginSubmit}>
          <Field label="Email">
            <TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </Field>
          <Field label="Password">
            <TextInput value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </Field>
          <PrimaryButton disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </PrimaryButton>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleChallengeSubmit}>
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {challengeName === "NEW_PASSWORD_REQUIRED"
              ? "Set a permanent password before continuing."
              : challengeName === "MFA_SETUP"
                ? "Add this account to your authenticator, then enter its six-digit code."
                : "Enter the verification code from your authenticator or registered phone."}
          </p>
          {challengeName === "MFA_SETUP" && mfaSecretCode ? (
            <div className="border border-slate-300 bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Authenticator setup key</p>
              <code className="mt-1 block break-all select-all">{mfaSecretCode}</code>
            </div>
          ) : null}
          {challengeName === "NEW_PASSWORD_REQUIRED" ? (
            <>
              {requiredAttributes.includes("name") ? (
                <Field label="Full name">
                  <TextInput
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </Field>
              ) : null}
              <Field label="New password">
                <TextInput
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <PasswordRequirements password={newPassword} />
            </>
          ) : (
            <Field label="Verification code">
              <TextInput
                value={challengeCode}
                onChange={(event) => setChallengeCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </Field>
          )}
          <PrimaryButton
            disabled={
              isSubmitting
              || (challengeName === "NEW_PASSWORD_REQUIRED" && !isPasswordValid(newPassword))
              || (challengeName === "NEW_PASSWORD_REQUIRED"
                && requiredAttributes.includes("name")
                && !fullName.trim())
            }
            type="submit"
          >
            {isSubmitting
              ? "Continuing…"
              : challengeName === "NEW_PASSWORD_REQUIRED"
                ? "Set password and continue"
                : "Verify MFA"}
          </PrimaryButton>
        </form>
      )}
    </AuthPageLayout>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get("/auth/me")
      .then((response) => {
        setSession({ user: response.data.user, expiresAt: Date.now() + 2_592_000_000 });
        navigate("/dashboard", { replace: true });
      })
      .catch((requestError: unknown) => setError(getApiError(requestError, "Authentication callback failed.")));
  }, [navigate, setSession]);

  return (
    <AuthPageLayout title="Completing sign-in" description="Validating your secure staff session.">
      <FormErrorSummary error={error} />
      {!error ? <p className="text-sm text-slate-600">Please wait…</p> : <Link to="/login">Return to login</Link>}
    </AuthPageLayout>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiClient.post("/auth/forgot-password", { email });
      navigate(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to request a reset code."));
    }
  }

  return (
    <AuthPageLayout title="Forgot password" description="Request a reset code for your approved staff account.">
      <FormErrorSummary error={error} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Email">
          <TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <PrimaryButton type="submit">Request reset code</PrimaryButton>
      </form>
    </AuthPageLayout>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet all requirements.");
      return;
    }
    try {
      await apiClient.post("/auth/confirm-forgot-password", { email, code, newPassword });
      setMessage("Password reset complete. You can now sign in.");
      setError(null);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to reset password."));
    }
  }

  return (
    <AuthPageLayout title="Reset password" description="Enter the Cognito recovery code and a new password.">
      <FormErrorSummary error={error} />
      {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Email"><TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></Field>
        <Field label="Reset code"><TextInput value={code} onChange={(event) => setCode(event.target.value)} required /></Field>
        <Field label="New password"><TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" required /></Field>
        <PasswordRequirements password={newPassword} />
        <PrimaryButton disabled={!isPasswordValid(newPassword)} type="submit">Reset password</PrimaryButton>
      </form>
    </AuthPageLayout>
  );
}

export function CognitoTestPage() {
  const [result, setResult] = useState("Run a check to inspect the current auth wiring.");
  async function check(path: string) {
    try {
      const response = await apiClient.get(path);
      setResult(JSON.stringify(response.data, null, 2));
    } catch (requestError: unknown) {
      setResult(getApiError(requestError, "Request failed."));
    }
  }
  return (
    <AppShell title="Authentication diagnostics">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex gap-3">
          <PrimaryButton type="button" onClick={() => void check("/auth/config-status")}>Check configuration</PrimaryButton>
          <PrimaryButton type="button" onClick={() => void check("/auth/me")}>Check current staff</PrimaryButton>
        </div>
        <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">{result}</pre>
      </div>
    </AppShell>
  );
}

export function AccountSecurityPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet all requirements.");
      return;
    }
    try {
      await apiClient.post("/auth/change-password", { oldPassword, newPassword });
      setMessage("Password changed successfully.");
      setError(null);
      setOldPassword("");
      setNewPassword("");
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to change password."));
    }
  }

  return (
    <AppShell title="Account security">
      <form className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={handleSubmit}>
        <FormErrorSummary error={error} />
        {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
        <Field label="Current password"><TextInput value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} type="password" required /></Field>
        <Field label="New password"><TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" required /></Field>
        <PasswordRequirements password={newPassword} />
        <PrimaryButton disabled={!isPasswordValid(newPassword)} type="submit">Change password</PrimaryButton>
      </form>
    </AppShell>
  );
}
