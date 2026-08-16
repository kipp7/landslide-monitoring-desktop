import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useApi } from "../api/ApiProvider";
import { useAuthStore } from "../stores/authStore";

export function RequireAuth(props: PropsWithChildren) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const api = useApi();
  const verifiedTokenRef = useRef<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      verifiedTokenRef.current = null;
      setCheckingSession(false);
      return;
    }

    if (verifiedTokenRef.current === token) {
      setCheckingSession(false);
      return;
    }

    let cancelled = false;
    setCheckingSession(true);

    void api.auth.me()
      .then(() => {
        if (cancelled) return;
        verifiedTokenRef.current = token;
        setCheckingSession(false);
      })
      .catch(() => {
        if (cancelled) return;

        // A 401 clears the store in the HTTP transport and this component redirects below.
        // Keep an existing session for transient network failures instead of forcing a logout.
        setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, token]);

  if (!token) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (checkingSession) return <div className="desk-loading">正在验证登录状态…</div>;
  return <>{props.children}</>;
}
