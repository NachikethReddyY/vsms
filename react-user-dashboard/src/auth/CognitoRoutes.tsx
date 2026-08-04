import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import apiClient from "../utils/apiClient";
import { getCognitoAuthorizeUrl } from "../utils/cognitoAuth";
import { useAuth } from "./AuthProvider";

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

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (searchParams.has("error") || !code || !state) {
      window.location.replace("/?auth=failed");
      return;
    }

    apiClient.get("/auth/callback", { params: { code, state } })
      .then((response) => {
        setSession({
          user: response.data.user,
          expiresAt: Date.now() + Number(response.data.sessionExpiresIn || 2_592_000) * 1000,
        });
        navigate(response.data.returnTo || "/events", { replace: true });
      })
      .catch(() => window.location.replace("/?auth=failed"));
  }, [navigate, searchParams, setSession]);

  return null;
}
