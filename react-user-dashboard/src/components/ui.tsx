import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import apiClient from "../utils/apiClient";

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
  return <p className="border border-slate-300 bg-white p-4 text-sm text-slate-700">{label}</p>;
}

export function FormErrorSummary({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
      <strong className="mr-2">Error:</strong>
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
  const { session } = useAuth();
  const navigationLinks = [
    ["/dashboard", "Dashboard"],
    ["/participants/search", "Participant Search"],
    ["/participants/new", "Create Participant"],
    ["/cognito-test", "Cognito Test"],
    ["/account/security", "Account Security"],
    ...(session?.user.roles.includes("ADMINISTRATOR") ? [["/admin/audit-logs", "Audit Logs"]] : []),
  ];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">VSMS simple view</p>
            <h1 className="text-2xl font-semibold">{title}</h1>
          </div>
          <div className="border border-slate-300 bg-slate-50 px-3 py-2 text-right text-sm text-slate-700">
            <p><strong>User:</strong> {session?.user.fullName}</p>
            <p><strong>Role:</strong> {session?.user.roles.join(", ")}</p>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pb-4 text-sm">
          {navigationLinks.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `border px-3 py-2 ${isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`
              }
            >
              {label}
            </NavLink>
          ))}
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-6">{children}</section>
    </main>
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
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-lg">
        <Link to="/" className="mb-6 inline-flex text-sm text-slate-700 underline">
          Back to login
        </Link>
        <section className="border border-slate-300 bg-white p-6 shadow-sm [&_label>span]:text-slate-700">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">{description}</p>
          <div className="mt-6 space-y-4">{children}</div>
          {footer ? <div className="mt-6 border-t border-slate-300 pt-4 text-sm text-slate-700">{footer}</div> : null}
        </section>
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
    <label className="block space-y-2 text-sm">
      <span className="font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 ${
        props.className ?? ""
      }`}
    />
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 ${
        props.className ?? ""
      }`}
    />
  );
}
