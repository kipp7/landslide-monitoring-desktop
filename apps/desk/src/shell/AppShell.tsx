import { App as AntApp } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useApi } from "../api/ApiProvider";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { HoverSidebar } from "../components/HoverSidebar";
import { useAuthStore } from "../stores/authStore";
import "./shell.css";

export function AppShell() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { message, modal } = AntApp.useApp();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const isAnalysis = location.pathname.startsWith("/app/analysis");

  const logout = async () => {
    modal.confirm({
      title: "确认退出登录",
      content: "退出后将回到登录页；登录状态会被清空。",
      okText: "退出",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.auth.logout();
        } catch (err) {
          message.error((err as Error).message);
        } finally {
          clearAuth();
          navigate("/login");
        }
      }
    });
  };

  return (
    <div className="desk-app">
      {isAnalysis ? null : <HoverSidebar userName={user?.name ?? null} onLogout={() => { void logout(); }} />}
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </div>
  );
}
