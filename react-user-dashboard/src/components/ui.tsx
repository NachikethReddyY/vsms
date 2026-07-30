import {
  CloudArrowUpIcon,
  EyeIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import apiClient from "../utils/apiClient";
import { ThemeToggle } from "./MagicEffects";

const passwordRequirements = [
  { label: "At least 12 characters", test: (password: string) => password.length >= 12 },
  { label: "At least 1 uppercase letter", test: (password: string) => /[A-Z]/.test(password) },
  { label: "At least 1 lowercase letter", test: (password: string) => /[a-z]/.test(password) },
  { label: "At least 1 number", test: (password: string) => /\d/.test(password) },
  { label: "At least 1 special character", test: (password: string) => /[^A-Za-z0-9]/.test(password) },
];

// Kept with PasswordRequirements so both use one authoritative policy.
// eslint-disable-next-line react-refresh/only-export-components
export function isPasswordValid(password: string) {
  return passwordRequirements.every((requirement) => requirement.test(password));
}

export function PasswordRequirements({
  password,
  confirmPassword,
}: {
  password: string;
  confirmPassword?: string;
}) {
  const requirements = [
    ...passwordRequirements.map((requirement) => ({
      label: requirement.label,
      met: requirement.test(password),
    })),
    ...(confirmPassword === undefined
      ? []
      : [{
          label: "Passwords match",
          met: confirmPassword.length > 0 && password === confirmPassword,
        }]),
  ];

  return (
    <div className="border border-slate-300 bg-slate-50 p-3 text-sm" aria-live="polite">
      <p className="mb-2 font-semibold text-slate-800">Password must include:</p>
      <ul className="space-y-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.label}
            className={`flex items-center gap-2 ${requirement.met ? "text-emerald-700" : "text-slate-600"}`}
          >
            <span className="w-4 font-bold" aria-hidden="true">
              {requirement.met ? "Yes" : "No"}
            </span>
            <span>{requirement.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <p className="loading-state" role="status">{label}</p>;
}

export function FormErrorSummary({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="alert error" role="alert">
      <strong>Error:</strong>
      {error}
    </div>
  );
}

export function SessionExpiredDialog() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("reason") !== "session-expired") {
    return null;
  }

  return (
    <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Your session expired. Sign in again to continue.
    </div>
  );
}

export function LogoutButton() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await apiClient.post("/auth/logout");
    } catch (error) {
      console.error("Logout request failed", error);
    } finally {
      clearSession();
      navigate("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="border border-slate-400 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
    >
      Logout
    </button>
  );
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="page-frame narrow registration-page">
      <header className="page-heading registration-page-heading">
        <div>
          <p className="page-kicker">Registration workspace</p>
          <h1>{title}</h1>
          <p>Search first, maintain one reusable participant record, then create an event-specific check-in.</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function AuthPageLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <header className="auth-topbar">
        <Link className="login-brand" to="/">
          <span aria-hidden="true">V</span>
          <div><strong>VSMS</strong><small>Secure staff workspace</small></div>
        </Link>
        <ThemeToggle />
      </header>
      <div className="auth-layout">
        <section className="auth-story" aria-labelledby="auth-title">
          <span className="auth-context">Visual Screening Management System</span>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
          <ul aria-label="Security and access commitments">
            <li><ShieldCheckIcon /> Backend-enforced roles</li>
            <li><UserGroupIcon /> Approved staff accounts only</li>
            <li><CloudArrowUpIcon /> Secure event workspace</li>
          </ul>
        </section>
        <div className="auth-card-wrap">
          <section className="auth-card">
            <div className="login-icon" aria-hidden="true"><EyeIcon /></div>
            <div className="login-form">
              <h2>Continue securely</h2>
              <p>Your role comes from your approved Cognito group; it cannot be selected here.</p>
              <div className="login-form-content">{children}</div>
              {footer ? <div className="auth-card-footer">{footer}</div> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`form-control ${
        props.className ?? ""
      }`}
    />
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`primary ${
        props.className ?? ""
      }`}
    />
  );
}
