import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import apiClient from "../utils/apiClient";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{label}</p>;
}

export function FormErrorSummary({ error }: { error: string | null }) {
  if (!error) return null;

  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
}

export function SessionExpiredDialog() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("reason") !== "session-expired") {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Your session expired. Sign in again to continue.
    </div>
  );
}

export function LogoutButton() {
  const { session, clearSession } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await apiClient.post("/auth/global-logout", {
        accessToken: session?.accessToken,
      });
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
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">VSMS</p>
            <h1 className="text-xl font-semibold">{title}</h1>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p>{session?.user.fullName}</p>
            <p>{session?.user.roles.join(", ")}</p>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pb-4 text-sm">
          {navigationLinks.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 ${isActive ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`
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
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto max-w-lg">
        <Link to="/" className="mb-6 inline-flex text-sm text-slate-300 hover:text-white">
          VSMS staff access
        </Link>
        <section className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl [&_label>span]:text-slate-200">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">{description}</p>
          <div className="mt-6 space-y-4">{children}</div>
          {footer ? <div className="mt-6 border-t border-slate-800 pt-4 text-sm text-slate-400">{footer}</div> : null}
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
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 ${
        props.className ?? ""
      }`}
    />
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 ${
        props.className ?? ""
      }`}
    />
  );
}
