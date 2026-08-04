import { useState } from "react";
import apiClient, { getApiError } from "../utils/apiClient";
import { isPasswordValid } from "../utils/passwordPolicy";
import { AppShell, Field, FormErrorSummary, PasswordRequirements, PrimaryButton, TextInput } from "../components/ui";

export default function AccountSecurityPage() {
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
