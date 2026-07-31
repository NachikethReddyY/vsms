import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AuthPageLayout, Field, FormErrorSummary, PrimaryButton, SessionExpiredDialog, TextInput } from "../components/ui";
import apiClient, { getApiError, setSessionTokens } from "../utils/apiClient";

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await apiClient.post("/auth/login", { identifier, password });
      setSessionTokens(data);
      setSession({
        user: data.user,
        expiresAt: Date.now() + Number(data.sessionExpiresIn || 604_800) * 1000,
      });
      navigate("/dashboard");
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Sign-in failed."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageLayout title="Staff login" description="Sign in with a seeded development username and password.">
      <SessionExpiredDialog />
      <FormErrorSummary error={error} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Username or email">
          <TextInput value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <TextInput value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </Field>
        <PrimaryButton disabled={isSubmitting} type="submit">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>
    </AuthPageLayout>
  );
}
