import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStore } from "../stores/authStore";

export function RequireAuth(props: PropsWithChildren) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();

  if (!token) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <>{props.children}</>;
}
