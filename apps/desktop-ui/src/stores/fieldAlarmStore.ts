import { create } from "zustand";

import type { AlertSummaryItem, FieldAlarmActionResult, FieldAlarmStatus } from "../api/client";

function currentAlerts(status: FieldAlarmStatus): AlertSummaryItem[] {
  if (status.alerts.length > 0) return status.alerts;
  return status.latestAlert ? [status.latestAlert] : [];
}

export function applyFieldAlarmActionResult(
  status: FieldAlarmStatus,
  result: FieldAlarmActionResult,
  alertId?: string
): FieldAlarmStatus {
  if (!result.accepted || (result.action !== "ack" && result.action !== "resolve") || !alertId) {
    return { ...status, actuator: result.actuator };
  }

  const alerts = currentAlerts(status)
    .filter((alert) => result.action !== "resolve" || alert.alertId !== alertId)
    .map((alert) =>
      result.action === "ack" && alert.alertId === alertId
        ? { ...alert, status: "acked" as const }
        : alert
    );
  const activeAlerts = alerts.filter((alert) => alert.status === "active");
  const ackedAlerts = alerts.filter((alert) => alert.status === "acked");
  const actuatorActive = result.actuator.state === "active" || result.actuator.lastAction === "alarm_on";
  const active = activeAlerts.length > 0 || actuatorActive;
  const silenced = !active && ackedAlerts.length > 0;

  return {
    ...status,
    active,
    silenced,
    state: active ? "active" : silenced ? "under_review" : "normal",
    activeCount: activeAlerts.length,
    ackedCount: ackedAlerts.length,
    latestAlert: activeAlerts[0] ?? ackedAlerts[0] ?? null,
    alerts: [...activeAlerts, ...ackedAlerts],
    actuator: result.actuator,
  };
}

type FieldAlarmStore = {
  status: FieldAlarmStatus | null;
  setStatus: (status: FieldAlarmStatus | null) => void;
  applyActionResult: (result: FieldAlarmActionResult, alertId?: string) => void;
  reset: () => void;
};

export const useFieldAlarmStore = create<FieldAlarmStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  applyActionResult: (result, alertId) =>
    set((current) => ({
      status: current.status ? applyFieldAlarmActionResult(current.status, result, alertId) : null,
    })),
  reset: () => set({ status: null }),
}));
