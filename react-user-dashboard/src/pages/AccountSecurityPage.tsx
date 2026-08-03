import { useState } from "react";
import apiClient, { getApiError } from "../utils/apiClient";
import { isPasswordValid } from "../utils/passwordPolicy";
import { Field, FormErrorSummary, PasswordRequirements, PrimaryButton, TextInput } from "../components/ui";
import "../components/SettingsPage.css";

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
    <section className="page-frame narrow settings-page midnight-settings account-security-page">
      <header className="page-heading settings-heading">
        <div><h1>Account security</h1><p>Change the password for your managed staff identity.</p></div>
      </header>
      <form className="account-security-form" onSubmit={handleSubmit}>
        <FormErrorSummary error={error} />
        {message ? <p className="account-security-success" role="status">{message}</p> : null}
        <Field label="Current password"><TextInput value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} type="password" autoComplete="current-password" required /></Field>
        <Field label="New password"><TextInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" required /></Field>
        <div className="account-security-requirements"><PasswordRequirements password={newPassword} /></div>
        <PrimaryButton disabled={pending || !oldPassword || !isPasswordValid(newPassword)} type="submit">{pending ? 'Changing password…' : 'Change password'}</PrimaryButton>
      </form>
    </section>
  );
}
