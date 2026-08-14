import { useState } from "react";
import apiClient, { getApiError } from "../utils/apiClient";
import { isPasswordValid } from "../utils/passwordPolicy";
import { Field, FormErrorSummary, PasswordRequirements, PrimaryButton, TextInput } from "../components/ui";

export default function AccountSecurityPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet all requirements.");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post("/auth/change-password", { oldPassword, newPassword });
      setMessage("Password changed successfully.");
      setError(null);
      setOldPassword("");
      setNewPassword("");
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to change password."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="page-frame narrow min-h-full bg-[var(--canvas)] text-[var(--ink)] motion-reduce:[&_*]:transition-none motion-reduce:[&_*]:animate-none">
      <header className="page-heading items-end border-b border-[var(--hairline)] pb-11 max-[700px]:pb-8">
        <div><h1 className="mb-2 text-[2.125rem] leading-none font-bold tracking-[-.035em]">Account security</h1><p className="m-0 text-sm leading-[1.3125rem] text-[var(--ink-2)]">Change the password for your managed staff identity.</p></div>
      </header>
      <form className="grid w-[min(100%,40rem)] gap-4.5 py-8.5 text-[var(--ink)] [&_.field]:grid [&_.field]:gap-2 [&_.field]:text-[0.8125rem] [&_.field]:font-semibold [&_.form-control]:min-h-12 [&_.form-control]:rounded-lg [&_.form-control]:border [&_.form-control]:border-[var(--hairline)] [&_.form-control]:bg-transparent [&_.form-control]:px-3.5 [&_.form-control]:text-[var(--ink)] [&_.form-control]:outline-none [&_.form-control:focus]:border-[var(--accent)] [&_.form-control:focus]:shadow-[0_0_0_3px_var(--accent-tint)]" onSubmit={handleSubmit}>
        <FormErrorSummary error={error} />
        {message ? <p className="m-0 border border-[color-mix(in_srgb,var(--green)_35%,transparent)] px-3.5 py-3 text-[var(--green)]" role="status">{message}</p> : null}
        <Field label="Current password"><TextInput value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} type="password" autoComplete="current-password" required /></Field>
        <Field label="New password"><TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" required /></Field>
        <div className="[&>div]:border-[var(--hairline)] [&>div]:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] [&_p]:text-[var(--ink-2)] [&_li]:text-[var(--ink-2)]"><PasswordRequirements password={newPassword} /></div>
        <PrimaryButton className="min-h-12 w-fit rounded-lg border-0 bg-[var(--ink)] px-4.5 font-bold text-[var(--canvas)] disabled:cursor-not-allowed disabled:opacity-50" disabled={pending || !oldPassword || !isPasswordValid(newPassword)} type="submit">{pending ? 'Changing password…' : 'Change password'}</PrimaryButton>
      </form>
    </section>
  );
}
