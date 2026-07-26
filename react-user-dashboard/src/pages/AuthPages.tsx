import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient from "../utils/apiClient";
import { clearPendingSignupProfile, getPendingSignupProfile, setPendingSignupProfile } from "../utils/session";
import { useAuth } from "../auth/AuthProvider";
import type { PendingSignupProfile } from "../types";
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

const roleOptions = [
  "REGISTRATION_OFFICER",
  "EVENT_MANAGER",
  "ADMINISTRATOR",
  "SCREENER",
  "REVIEWER",
];

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeCode, setChallengeCode] = useState("");
  const [challengeName, setChallengeName] = useState<string | null>(null);
  const [challengeSession, setChallengeSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLoginSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.post("/auth/login", { email, password });
      if (response.status === 202 || response.data?.challengeName) {
        setChallengeName(response.data.challengeName);
        setChallengeSession(response.data.session);
        return;
      }

      setSession(response.data);
      navigate("/dashboard");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Sign-in failed.");
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
        challengeName,
        session: challengeSession,
        code: challengeCode,
      });
      setSession(response.data);
      navigate("/dashboard");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Challenge verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageLayout
      title="Staff login"
      description="Use your Cognito-backed staff account. If MFA is enabled, this form will continue into the challenge step."
      footer={
        <div className="flex flex-wrap gap-3">
          <Link to="/signup">Create staff account</Link>
          <Link to="/forgot-password">Forgot password</Link>
        </div>
      }
    >
      <SessionExpiredDialog />
      <FormErrorSummary error={error} />
      {!challengeName ? (
        <form className="space-y-4" onSubmit={handleLoginSubmit}>
          <Field label="Email">
            <TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </Field>
          <Field label="Password">
            <TextInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
            />
          </Field>
          <PrimaryButton disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </PrimaryButton>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleChallengeSubmit}>
          <div className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-300">
            MFA challenge detected: <strong>{challengeName}</strong>
          </div>
          <Field label="Verification code">
            <TextInput
              value={challengeCode}
              onChange={(event) => setChallengeCode(event.target.value)}
              required
            />
          </Field>
          <PrimaryButton disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying..." : "Verify challenge"}
          </PrimaryButton>
        </form>
      )}
    </AuthPageLayout>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<PendingSignupProfile & { password: string; confirmPassword: string }>({
    fullName: "",
    email: "",
    employeeNumber: "",
    department: "",
    designation: "",
    role: "REGISTRATION_OFFICER",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!isPasswordValid(form.password)) {
      setError("Password does not meet all of the requirements.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await apiClient.post("/auth/signup", {
        fullName: form.fullName,
        email: form.email,
        employeeNumber: form.employeeNumber,
        department: form.department,
        designation: form.designation,
        role: form.role,
        password: form.password,
      });

      setPendingSignupProfile({
        fullName: form.fullName,
        email: form.email,
        employeeNumber: form.employeeNumber,
        department: form.department,
        designation: form.designation,
        role: form.role,
      });

      navigate("/verify-signup");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Sign-up failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageLayout title="Create staff account" description="This form only collects the data needed to create the Cognito user and local staff profile.">
      <FormErrorSummary error={error} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Full name">
          <TextInput value={form.fullName} onChange={(event) => updateField("fullName", event.target.value)} required />
        </Field>
        <Field label="Email">
          <TextInput value={form.email} onChange={(event) => updateField("email", event.target.value)} type="email" required />
        </Field>
        <Field label="Employee number">
          <TextInput value={form.employeeNumber} onChange={(event) => updateField("employeeNumber", event.target.value)} required />
        </Field>
        <Field label="Department">
          <TextInput value={form.department} onChange={(event) => updateField("department", event.target.value)} />
        </Field>
        <Field label="Designation">
          <TextInput value={form.designation} onChange={(event) => updateField("designation", event.target.value)} />
        </Field>
        <Field label="Role">
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            value={form.role}
            onChange={(event) => updateField("role", event.target.value)}
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Password">
          <TextInput value={form.password} onChange={(event) => updateField("password", event.target.value)} type="password" required />
        </Field>
        <Field label="Confirm password">
          <TextInput
            value={form.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
            type="password"
            required
          />
        </Field>
        <PasswordRequirements password={form.password} confirmPassword={form.confirmPassword} />
        <PrimaryButton
          disabled={isSubmitting || !isPasswordValid(form.password) || form.password !== form.confirmPassword}
          type="submit"
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </PrimaryButton>
      </form>
    </AuthPageLayout>
  );
}

export function VerifySignUpPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PendingSignupProfile | null>(() => getPendingSignupProfile());
  const [email, setEmail] = useState(profile?.email ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!profile && email) {
      setProfile({
        fullName: "",
        email,
        employeeNumber: "",
        department: "",
        designation: "",
        role: "REGISTRATION_OFFICER",
      });
    }
  }, [email, profile]);

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!profile) {
      setError("Finish the sign-up form first so the local profile data is available.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await apiClient.post("/auth/confirm-signup", {
        ...profile,
        code,
      });
      clearPendingSignupProfile();
      navigate("/login");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setMessage(null);

    try {
      await apiClient.post("/auth/resend-code", { email });
      setMessage("Verification code resent.");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to resend code.");
    }
  }

  return (
    <AuthPageLayout title="Verify sign-up" description="Enter the Cognito verification code to activate the staff account and create the local Prisma user.">
      <FormErrorSummary error={error} />
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      <form className="space-y-4" onSubmit={handleVerify}>
        <Field label="Email">
          <TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <Field label="Verification code">
          <TextInput value={code} onChange={(event) => setCode(event.target.value)} required />
        </Field>
        <div className="flex flex-wrap gap-3">
          <PrimaryButton disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying..." : "Verify account"}
          </PrimaryButton>
          <button
            type="button"
            onClick={handleResendCode}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Resend code
          </button>
        </div>
      </form>
    </AuthPageLayout>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await apiClient.post("/auth/forgot-password", { email });
      setMessage("Reset code requested.");
      navigate(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to request reset.");
    }
  }

  return (
    <AuthPageLayout title="Forgot password" description="Request a Cognito reset code for the staff account.">
      <FormErrorSummary error={error} />
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
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
    setError(null);
    setMessage(null);

    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet all of the requirements.");
      return;
    }

    try {
      await apiClient.post("/auth/confirm-forgot-password", {
        email,
        code,
        newPassword,
      });
      setMessage("Password reset complete.");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to reset password.");
    }
  }

  return (
    <AuthPageLayout title="Reset password" description="Complete the password-reset challenge with the code from Cognito.">
      <FormErrorSummary error={error} />
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Email">
          <TextInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <Field label="Reset code">
          <TextInput value={code} onChange={(event) => setCode(event.target.value)} required />
        </Field>
        <Field label="New password">
          <TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" required />
        </Field>
        <PasswordRequirements password={newPassword} />
        <PrimaryButton disabled={!isPasswordValid(newPassword)} type="submit">Reset password</PrimaryButton>
      </form>
    </AuthPageLayout>
  );
}

export function CognitoTestPage() {
  const [result, setResult] = useState<string>("Run a check to inspect the current auth wiring.");

  async function runConfigCheck() {
    const response = await apiClient.get("/auth/config-status");
    setResult(JSON.stringify(response.data, null, 2));
  }

  async function runProfileCheck() {
    try {
      const response = await apiClient.get("/auth/me");
      setResult(JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      setResult(JSON.stringify(error.response?.data ?? { error: "Request failed" }, null, 2));
    }
  }

  return (
    <AppShell title="Cognito test page">
      <div className="grid gap-4 md:grid-cols-[240px,1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="space-y-3">
            <PrimaryButton type="button" onClick={runConfigCheck}>
              Check config
            </PrimaryButton>
            <PrimaryButton type="button" onClick={runProfileCheck}>
              Check /auth/me
            </PrimaryButton>
          </div>
        </div>
        <pre className="overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-sm text-slate-100">
          {result}
        </pre>
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
    setError(null);
    setMessage(null);

    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet all of the requirements.");
      return;
    }

    try {
      await apiClient.post("/auth/change-password", {
        oldPassword,
        newPassword,
      });
      setMessage("Password changed successfully.");
      setOldPassword("");
      setNewPassword("");
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to change password.");
    }
  }

  return (
    <AppShell title="Account security">
      <div className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-600">
          This page is intentionally plain. It gives you a working Cognito-connected password change flow without committing the final UI design yet.
        </p>
        <FormErrorSummary error={error} />
        {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Current password">
            <TextInput value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} type="password" required />
          </Field>
          <Field label="New password">
            <TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" required />
          </Field>
          <PasswordRequirements password={newPassword} />
          <PrimaryButton disabled={!isPasswordValid(newPassword)} type="submit">Change password</PrimaryButton>
        </form>
      </div>
    </AppShell>
  );
}
