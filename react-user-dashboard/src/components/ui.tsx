import { passwordRequirements } from "../utils/passwordPolicy";

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
    <div className="border border-[var(--hairline-strong)] bg-[var(--canvas-soft)] p-3 text-sm" aria-live="polite">
      <p className="mb-2 font-semibold text-[var(--ink)]">Password must include:</p>
      <ul className="space-y-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.label}
            className={`flex items-center gap-2 ${requirement.met ? "text-[var(--green)]" : "text-[var(--ink-2)]"}`}
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
