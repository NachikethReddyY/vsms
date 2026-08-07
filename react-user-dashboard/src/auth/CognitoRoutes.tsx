import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient, { getApiError, setSessionTokens } from "../utils/apiClient";
import { getCognitoAuthorizeUrl } from "../utils/cognitoAuth";
import { useAuth } from "./AuthProvider";
import "../features/Stage4Pages.css";

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
      .catch((error) => setFailure(getApiError(error, "We could not finish sign-in. Please try again.")));
  }, [navigate, searchParams, setSession]);

  if (failure) {
    return <div className="stage4-page"><section className="stage4-hero"><div><h1>Sign-in failed</h1><p>{failure}</p></div><div className="stage4-actions"><Link className="stage4-button" to="/">Return home</Link><a className="stage4-button secondary" href={getCognitoAuthorizeUrl("/events")}>Try again</a></div></section></div>;
  }

  return <div className="stage4-page"><section className="stage4-hero"><div><h1>Finishing secure sign-in</h1><p>VSMS is validating your Cognito response and preparing your staff workspace.</p></div><span className="stage4-pill warn">Loading</span></section></div>;
}
