import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import { useEffect } from "react";
import { HashRouter } from "react-router-dom";

import { ApiProvider } from "./api/ApiProvider";
import { AppRoutes } from "./routes/AppRoutes";
import { TitleSync } from "./routes/TitleSync";
import { useAuthStore } from "./stores/authStore";
import {
  DEFAULT_HTTP_API_BASE_URL,
  isLegacyLocalApiBaseUrl,
  normalizeApiBaseUrl,
  useSettingsStore
} from "./stores/settingsStore";
import { getDeskHostInfo, isDeskHost, requestDeskToggleTray } from "./native/deskHost";

export function App() {
  const apiMode = useSettingsStore((s) => s.apiMode);
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const mockDelayMs = useSettingsStore((s) => s.mockDelayMs);
  const mockFailureRate = useSettingsStore((s) => s.mockFailureRate);
  const sessionApiModeOverride = useSettingsStore((s) => s.sessionApiModeOverride);
  const trayEnabled = useSettingsStore((s) => s.trayEnabled);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setApiMode = useSettingsStore((s) => s.setApiMode);
  const setApiBaseUrl = useSettingsStore((s) => s.setApiBaseUrl);
  const token = useAuthStore((s) => s.token);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const clearAuth = useAuthStore((s) => s.clear);
  const runningInDeskHost = isDeskHost();
  const hostInfo = getDeskHostInfo();
  const hostApiMode = hostInfo?.api?.mode === "mock" ? "mock" : "http";
  const hostApiBaseUrl = normalizeApiBaseUrl(hostInfo?.api?.baseUrl ?? "");
  const hostApiForce = hostInfo?.api?.force === true;
  const hostApiLocked = runningInDeskHost && hostApiForce && hostApiBaseUrl.length > 0;
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const shouldPreferHostApiBaseUrl =
    runningInDeskHost &&
    hostApiBaseUrl.length > 0 &&
    (
      hostApiForce ||
      normalizedApiBaseUrl.length === 0 ||
      normalizedApiBaseUrl === DEFAULT_HTTP_API_BASE_URL ||
      isLegacyLocalApiBaseUrl(normalizedApiBaseUrl)
    );
  const shouldUseHostApiConfig = hostApiLocked || shouldPreferHostApiBaseUrl;
  const effectiveApiMode = hostApiLocked && sessionApiModeOverride
    ? sessionApiModeOverride
    : shouldUseHostApiConfig ? hostApiMode : apiMode;
  const effectiveApiBaseUrl = shouldUseHostApiConfig
    ? hostApiBaseUrl
    : (normalizedApiBaseUrl || DEFAULT_HTTP_API_BASE_URL);

  useEffect(() => {
    if (!runningInDeskHost) return;
    requestDeskToggleTray(trayEnabled);
  }, [runningInDeskHost, trayEnabled]);

  useEffect(() => {
    document.documentElement.classList.toggle("desk-reduced-motion", reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (effectiveApiMode !== "http") return;
    if (token?.startsWith("mock-") || refreshToken?.startsWith("mock-")) {
      clearAuth();
    }
  }, [clearAuth, effectiveApiMode, refreshToken, token]);

  useEffect(() => {
    if (!shouldUseHostApiConfig) return;
    if (!hostApiLocked && apiMode !== hostApiMode) {
      setApiMode(hostApiMode);
    }
    if (normalizedApiBaseUrl !== hostApiBaseUrl) {
      setApiBaseUrl(hostApiBaseUrl);
    }
  }, [
    apiMode,
    hostApiBaseUrl,
    hostApiLocked,
    hostApiMode,
    normalizedApiBaseUrl,
    setApiBaseUrl,
    setApiMode,
    shouldUseHostApiConfig
  ]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: { borderRadius: 10, colorPrimary: "#06b6d4" }
      }}
    >
      <AntApp>
        <ApiProvider
          config={{
            mode: effectiveApiMode,
            baseUrl: effectiveApiBaseUrl,
            token,
            refreshToken,
            onAuthTokens: ({ token: nextToken, refreshToken: nextRefreshToken }) => {
              setTokens(nextRefreshToken === undefined ? { token: nextToken } : { token: nextToken, refreshToken: nextRefreshToken });
            },
            onAuthFailure: () => {
              clearAuth();
            },
            mockDelayMs,
            mockFailureRate
          }}
        >
          <HashRouter>
            <TitleSync />
            <AppRoutes />
          </HashRouter>
        </ApiProvider>
      </AntApp>
    </ConfigProvider>
  );
}
