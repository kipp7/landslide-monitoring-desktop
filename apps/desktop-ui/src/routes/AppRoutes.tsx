import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../shell/AppShell";
import { HomeRedirect } from "./HomeRedirect";
import { RequireAuth } from "./RequireAuth";

const AnalysisPage = lazy(async () => ({ default: (await import("../views/AnalysisPage")).AnalysisPage }));
const AccountManagementPage = lazy(async () => ({ default: (await import("../views/AccountManagementPage")).AccountManagementPage }));
const BaselinesPage = lazy(async () => ({ default: (await import("../views/BaselinesPage")).BaselinesPage }));
const DeviceManagementPage = lazy(async () => ({ default: (await import("../views/DeviceManagementPage")).DeviceManagementPage }));
const DeviceOnboardingPage = lazy(async () => ({ default: (await import("../views/DeviceOnboardingPage")).DeviceOnboardingPage }));
const DevicesPage = lazy(async () => ({ default: (await import("../views/DevicesPage")).DevicesPage }));
const GpsMonitoringPage = lazy(async () => ({ default: (await import("../views/GpsMonitoringPage")).GpsMonitoringPage }));
const GpsPage = lazy(async () => ({ default: (await import("../views/GpsPage")).GpsPage }));
const HomePage = lazy(async () => ({ default: (await import("../views/HomePage")).HomePage }));
const LoginPage = lazy(async () => ({ default: (await import("../views/LoginPage")).LoginPage }));
const SettingsPage = lazy(async () => ({ default: (await import("../views/SettingsPage")).SettingsPage }));
const StationsPage = lazy(async () => ({ default: (await import("../views/StationsPage")).StationsPage }));
const SystemPage = lazy(async () => ({ default: (await import("../views/SystemPage")).SystemPage }));

export function AppRoutes() {
  const fallback = <div className="desk-loading">加载中…</div>;
  return (
    <Suspense fallback={fallback}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="device-management/onboarding" element={<DeviceOnboardingPage />} />
          <Route path="device-management" element={<DeviceManagementPage />} />
          <Route path="gps-monitoring" element={<GpsMonitoringPage />} />
          <Route path="accounts" element={<AccountManagementPage />} />
          <Route path="settings" element={<SettingsPage />} />

          <Route path="dashboard" element={<Navigate to="/app/home" replace />} />
          <Route path="stations" element={<StationsPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="baselines" element={<BaselinesPage />} />
          <Route path="gps" element={<GpsPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </Suspense>
  );
}
