import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient, { getApiError, getApiErrorCode, setSessionTokens } from "../utils/apiClient";
import { getCognitoAuthorizeUrl } from "../utils/cognitoAuth";
import { useAuth } from "./AuthProvider";
import styles from "./CognitoRoutes.module.css";

export function CognitoLoginRedirect({ returnTo }: { returnTo?: string }) {
  useEffect(() => {
    window.location.replace(getCognitoAuthorizeUrl(returnTo));
  }, [returnTo]);

  return null;
}

export function CognitoCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setSession } = useAuth();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (searchParams.has("error") || !code || !state) {
      setFailure(searchParams.get("error_description") || "Cognito did not return a valid authorization response.");
      return;
    }

    apiClient.get("/auth/callback", { params: { code, state } })
      .then((response) => {
        setSessionTokens(response.data);
        setSession({
          user: response.data.user,
          expiresAt: Date.now() + Number(response.data.sessionExpiresIn || 2_592_000) * 1000,
        });
        navigate(response.data.returnTo || "/events", { replace: true });
      })
      .catch((error) => {
        setFailure(getApiError(error, "We could not finish sign-in. Please try again."));
        setFailureCode(getApiErrorCode(error));
      });
  }, [navigate, searchParams, setSession]);

  const localProfileMissing = failureCode === "LOCAL_PROFILE_NOT_FOUND";
  const retryRequired = failureCode === "REQUEST_FAILED";

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#auth-status">Skip to sign-in status</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} to="/" aria-label="VSMS home">
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="9" cy="21" r="2" fill="currentColor" />
                <circle cx="16.3" cy="11" r="2" fill="currentColor" />
                <circle cx="23" cy="16.3" r="2" fill="currentColor" />
              </svg>
            </span>
            <span className={styles.brandCopy}>
              <strong>VSMS</strong>
              <small>Vision Screening Management System</small>
            </span>
          </Link>
          <span className={styles.headerLabel}>Staff sign-in</span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.layout}>
          <section id="auth-status" className={styles.content} aria-live="polite">
            <span className={`${styles.statusMark} ${failure ? styles.error : styles.loading}`} aria-hidden="true">
              {failure
                ? <svg viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" /></svg>
                : <span />}
            </span>
            <h1>{localProfileMissing ? "Your staff account isn’t ready yet." : failure ? "Sign-in couldn’t be completed." : "Checking your access."}</h1>
            <p className={styles.summary}>
              {localProfileMissing
                ? "Your Cognito identity was verified, but it is not linked to an approved VSMS staff profile yet."
                : retryRequired
                  ? "This sign-in request could not be verified. Start a new sign-in to continue."
                  : failure || "VSMS is validating your Cognito response and preparing your staff workspace."}
            </p>

            {localProfileMissing && (
              <div className={styles.guidance}>
                <strong>What happens next</strong>
                <span>An administrator must create or approve your staff profile and assign your role before you can enter the workspace.</span>
              </div>
            )}

            {failure && (
              <div className={styles.actions}>
                {localProfileMissing
                  ? <>
                      <Link className={styles.primaryAction} to="/">Return home</Link>
                      <a className={styles.secondaryAction} href={getCognitoAuthorizeUrl("/events")}>Try again</a>
                    </>
                  : <>
                      <a className={styles.primaryAction} href={getCognitoAuthorizeUrl("/events")}>Start a new sign-in</a>
                      <Link className={styles.secondaryAction} to="/">Return home</Link>
                    </>}
              </div>
            )}

            <p className={styles.footnote}>For authorised screening personnel</p>
          </section>

          <figure className={styles.visual}>
            <img
              src="/landing/vsms-screening-hero.webp"
              alt="Staff member using a tablet at a vision-screening station"
              width="1800"
              height="1013"
            />
            <figcaption>Secure access for the screening team.</figcaption>
          </figure>
        </div>
      </main>
    </div>
  );
}
