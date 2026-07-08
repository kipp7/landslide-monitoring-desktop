import { Navigate } from "react-router-dom";

import { useAuthStore } from "../stores/authStore";

export function HomeRedirect() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/app/home" : "/login"} replace />;
}
