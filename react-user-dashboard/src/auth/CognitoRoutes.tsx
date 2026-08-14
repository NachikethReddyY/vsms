import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient, { getApiError, getApiErrorCode, setSessionTokens } from "../utils/apiClient";
import { getCognitoAuthorizeUrl } from "../utils/cognitoAuth";
import { ThemeToggle } from "../components/MagicEffects";
import { useAuth } from "./AuthProvider";

const authActionClass = "inline-flex min-h-12 items-center justify-center rounded-lg border px-4.75 text-xs font-bold transition-[background-color,border-color,color,transform] duration-150 active:scale-[.98] motion-reduce:transition-none max-[620px]:w-full";

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
    <div className="min-h-dvh min-w-80 overflow-x-hidden bg-[var(--canvas)] font-sans text-[var(--ink)] antialiased [&_*]:box-border [&_a]:text-inherit [&_a]:no-underline [&_:focus-visible]:outline-3 [&_:focus-visible]:outline-offset-3 [&_:focus-visible]:outline-[var(--accent)]">
      <a className="fixed top-2.5 left-2.5 z-20 translate-y-[-150%] rounded-lg bg-[#172233] px-3.5 py-2.75 text-white focus:translate-y-0" href="#auth-status">Skip to sign-in status</a>
      <header className="absolute inset-x-0 top-0 z-10 border-b border-[var(--hairline)]">
        <div className="mx-auto flex min-h-18 w-[min(70rem,calc(100%-3rem))] items-center justify-between max-[620px]:min-h-16 max-[620px]:w-[calc(100%-2rem)]">
          <Link className="inline-flex min-h-12 items-center gap-2.75" to="/" aria-label="VSMS home">
            <span className="grid size-9.5 place-items-center rounded-lg bg-[#172233] text-white" aria-hidden="true">
              <svg className="size-6.75" viewBox="0 0 32 32" fill="none">
                <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="9" cy="21" r="2" fill="currentColor" />
                <circle cx="16.3" cy="11" r="2" fill="currentColor" />
                <circle cx="23" cy="16.3" r="2" fill="currentColor" />
              </svg>
            </span>
            <span className="grid gap-px">
              <strong className="text-[0.9375rem] font-bold tracking-[-.01em]">VSMS</strong>
              <small className="text-[0.625rem] tracking-[.025em] text-[var(--ink-2)] max-[620px]:hidden">Vision Screening Management System</small>
            </span>
          </Link>
          <div className="flex items-center gap-3 max-[620px]:gap-1">
            <ThemeToggle className="text-[var(--ink-2)] hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-[var(--ink)]" />
            <span className="text-xs font-semibold text-[var(--ink-2)] max-[620px]:hidden">Staff sign-in</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-dvh w-[min(65rem,calc(100%-3rem))] items-center py-12 pt-28 max-[620px]:w-[calc(100%-2rem)] max-[620px]:py-7.5 max-[620px]:pt-22">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(17.5rem,21.25rem)] items-center gap-[clamp(3rem,7vw,5.375rem)] max-[820px]:grid-cols-[minmax(0,1fr)_16.25rem] max-[820px]:gap-9.5 max-[620px]:grid-cols-1">
          <section id="auth-status" className="min-w-0 py-7.5 max-[620px]:py-5" aria-live="polite">
            <span className={`mb-7 grid size-11 place-items-center rounded-xl ${failure ? "bg-[color-mix(in_srgb,var(--orange)_12%,transparent)] text-[var(--orange)]" : "bg-[var(--accent-tint)] text-[var(--accent)]"}`} aria-hidden="true">
              {failure
                ? <svg className="size-5.5 stroke-current [stroke-linecap:round] [stroke-width:1.8]" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" /></svg>
                : <span className="size-4.5 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--accent)_24%,transparent)] border-t-[var(--accent)] motion-reduce:animate-none" />}
            </span>
            <h1 className="mb-4.5 max-w-[16ch] text-[clamp(2.375rem,4.5vw,3.375rem)] leading-none font-semibold tracking-[-.035em] text-balance max-[620px]:text-[clamp(2.25rem,11vw,2.875rem)]">{localProfileMissing ? "Your staff account isn’t ready yet." : failure ? "Sign-in couldn’t be completed." : "Checking your access."}</h1>
            <p className="m-0 max-w-[58ch] text-[0.9375rem] leading-[1.65] text-[var(--ink-2)] text-pretty">
              {localProfileMissing
                ? "Your Cognito identity was verified, but it is not linked to an approved VSMS staff profile yet."
                : retryRequired
                  ? "This sign-in request could not be verified. Start a new sign-in to continue."
                  : failure || "VSMS is validating your Cognito response and preparing your staff workspace."}
            </p>

            {localProfileMissing && (
              <div className="mt-7.5 grid grid-cols-[8.125rem_minmax(0,1fr)] gap-5 border-t border-[var(--hairline)] pt-5 max-[820px]:grid-cols-1 max-[820px]:gap-1.5">
                <strong className="text-xs font-bold">What happens next</strong>
                <span className="max-w-[44ch] text-[0.8125rem] leading-[1.55] text-[var(--ink-2)]">An administrator must create or approve your staff profile and assign your role before you can enter the workspace.</span>
              </div>
            )}

            {failure && (
              <div className="mt-8 flex flex-wrap gap-2.5 max-[620px]:w-full">
                {localProfileMissing
                  ? <>
                      <Link className={`${authActionClass} border-transparent bg-[var(--ink)] text-[var(--canvas)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,var(--accent))]`} to="/">Return home</Link>
                      <a className={`${authActionClass} border-[var(--hairline-strong)] bg-[var(--surface)] hover:bg-[var(--canvas-soft)]`} href={getCognitoAuthorizeUrl("/events")}>Try again</a>
                    </>
                  : <>
                      <a className={`${authActionClass} border-transparent bg-[var(--ink)] text-[var(--canvas)] hover:bg-[color-mix(in_srgb,var(--ink)_88%,var(--accent))]`} href={getCognitoAuthorizeUrl("/events")}>Start a new sign-in</a>
                      <Link className={`${authActionClass} border-[var(--hairline-strong)] bg-[var(--surface)] hover:bg-[var(--canvas-soft)]`} to="/">Return home</Link>
                    </>}
              </div>
            )}

            <p className="mt-5 mb-0 text-[0.6875rem] text-[var(--ink-2)]">For authorised screening personnel</p>
          </section>

          <figure className="m-0 grid h-115 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-xl bg-[#172233] max-[820px]:h-97.5 max-[620px]:hidden">
            <img
              className="block size-full object-cover object-[69%_center] [filter:saturate(.72)_contrast(1.04)]"
              src="/landing/vsms-screening-hero.webp"
              alt="Staff member using a tablet at a vision-screening station"
              width="1800"
              height="1013"
            />
            <figcaption className="bg-[#172233] px-4.25 pt-3.75 pb-4 text-[0.6875rem] font-semibold text-white">Secure access for the screening team.</figcaption>
          </figure>
        </div>
      </main>
    </div>
  );
}
