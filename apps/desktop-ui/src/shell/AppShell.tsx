import { AlertOutlined, BellOutlined, EyeOutlined, SoundOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Modal, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import type { AlertSummaryItem, FieldAlarmStatus } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { HoverSidebar } from "../components/HoverSidebar";
import { useAuthStore } from "../stores/authStore";
import "./shell.css";

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function evidenceNumber(evidence: Record<string, unknown>, key: string): number | null {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function alertSeverityLabel(severity: AlertSummaryItem["severity"]): string {
  if (severity === "critical") return "严重风险";
  if (severity === "high") return "高风险";
  if (severity === "medium") return "中风险";
  return "低风险";
}

function shortDeviceId(value: string | null): string {
  if (!value) return "未绑定节点";
  return `节点 ${value.slice(-4).toUpperCase()}`;
}

export function AppShell() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { message, modal } = AntApp.useApp();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clear);
  const isAnalysis = location.pathname.startsWith("/app/analysis");
  const [alarmStatus, setAlarmStatus] = useState<FieldAlarmStatus | null>(null);
  const [alarmModalOpen, setAlarmModalOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alarmAction, setAlarmAction] = useState<"ack" | "resolve" | null>(null);

  const refreshAlarmStatus = useCallback(async (options?: { open?: boolean; selectAlertId?: string }) => {
    try {
      const status = await api.fieldAlarm.getStatus();
      setAlarmStatus(status);
      const preferred = options?.selectAlertId
        ? status.alerts.find((alert) => alert.alertId === options.selectAlertId)
        : null;
      const nextSelected = preferred ?? status.alerts[0] ?? null;
      setSelectedAlertId((current) =>
        status.alerts.some((alert) => alert.alertId === current) ? current : nextSelected?.alertId ?? null
      );
      if (options?.open && status.alerts.length > 0) setAlarmModalOpen(true);
      if (status.alerts.length === 0) setAlarmModalOpen(false);
    } catch {
      // The realtime stream reconnects independently; retain the last known alert state.
    }
  }, [api]);

  useEffect(() => {
    void refreshAlarmStatus({ open: true });
    const unsubscribe = api.alerts.subscribe({
      onEvent: (event) => {
        void refreshAlarmStatus({
          open: event.eventType === "ALERT_TRIGGER" || event.eventType === "ALERT_UPDATE",
          selectAlertId: event.alertId,
        });
      },
    });
    const fallbackTimer = window.setInterval(() => {
      void refreshAlarmStatus();
    }, 2000);
    return () => {
      unsubscribe();
      window.clearInterval(fallbackTimer);
    };
  }, [api, refreshAlarmStatus]);

  const selectedAlert = useMemo(
    () => alarmStatus?.alerts.find((alert) => alert.alertId === selectedAlertId) ?? alarmStatus?.alerts[0] ?? null,
    [alarmStatus?.alerts, selectedAlertId]
  );
  const selectedEvidence = useMemo(() => evidenceRecord(selectedAlert?.evidence), [selectedAlert?.evidence]);
  const maxDeviationDeg = evidenceNumber(selectedEvidence, "maxDeviationDeg");
  const maxAxis = typeof selectedEvidence.maxAxis === "string" ? selectedEvidence.maxAxis.toUpperCase() : null;

  const handleAlarmAction = async (action: "ack" | "resolve") => {
    if (!selectedAlert || alarmAction) return;
    setAlarmAction(action);
    try {
      const result = await api.fieldAlarm.sendAction({
        action,
        alertId: selectedAlert.alertId,
        reason:
          action === "ack"
            ? "Windows 值守端已确认告警，暂时静音并继续现场复核。"
            : "Windows 值守端已完成现场复核，确认解除当前告警。",
      });
      if (!result.accepted) throw new Error(result.actuator.lastError ?? "现场告警终端未接受命令");
      await refreshAlarmStatus({ open: action === "ack" });
      message.success(action === "ack" ? "已静音，告警保留待复核" : "告警已解除");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "告警操作失败");
    } finally {
      setAlarmAction(null);
    }
  };

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
    <div className={`desk-app${alarmStatus?.active ? " is-field-alarming" : ""}`}>
      {isAnalysis ? null : <HoverSidebar userName={user?.name ?? null} onLogout={() => { void logout(); }} />}
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
      <Modal
        centered
        width={820}
        className="desk-global-alarm-modal"
        open={alarmModalOpen && Boolean(selectedAlert)}
        title={
          <div className="desk-global-alarm-title">
            <span className="desk-global-alarm-title-icon"><BellOutlined /></span>
            <div>
              <strong>现场监测告警</strong>
              <span>服务器实时事件 · {alarmStatus?.alerts.length ?? 0} 条待处理</span>
            </div>
          </div>
        }
        maskClosable={false}
        keyboard={false}
        onCancel={() => setAlarmModalOpen(false)}
        footer={null}
      >
        {selectedAlert ? (
          <div className="desk-global-alarm-layout">
            <div className="desk-global-alarm-list" aria-label="实时告警列表">
              {(alarmStatus?.alerts ?? []).map((alert) => (
                <button
                  key={alert.alertId}
                  type="button"
                  className={`desk-global-alarm-item${alert.alertId === selectedAlert.alertId ? " is-selected" : ""}`}
                  onClick={() => setSelectedAlertId(alert.alertId)}
                >
                  <span className={`desk-global-alarm-severity is-${alert.severity}`} />
                  <span>
                    <strong>{alert.title || shortDeviceId(alert.deviceId)}</strong>
                    <small>{alert.status === "acked" ? "已静音待复核" : alertSeverityLabel(alert.severity)}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="desk-global-alarm-detail">
              <div className="desk-global-alarm-heading">
                <div>
                  <Tag color={selectedAlert.severity === "critical" ? "red" : "volcano"}>
                    {alertSeverityLabel(selectedAlert.severity)}
                  </Tag>
                  {selectedAlert.status === "acked" ? <Tag color="gold">已静音待复核</Tag> : <Tag color="red">正在告警</Tag>}
                </div>
                <span>{new Date(selectedAlert.lastEventAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>
              <h2>{selectedAlert.title || "倾角监测告警"}</h2>
              <p className="desk-global-alarm-reason">
                {selectedAlert.message || "真实监测数据达到告警阈值，请查看现场状态。"}
              </p>
              <div className="desk-global-alarm-evidence">
                <div><span>触发节点</span><strong>{shortDeviceId(selectedAlert.deviceId)}</strong></div>
                <div><span>最大偏移</span><strong>{maxDeviationDeg === null ? "--" : `${maxDeviationDeg.toFixed(2)}°`}</strong></div>
                <div><span>主变化轴</span><strong>{maxAxis ?? "--"}</strong></div>
                <div><span>现场终端</span><strong>{alarmStatus?.actuator.available ? "Tongxiao RK2206 已连接" : "连接待确认"}</strong></div>
              </div>
              <div className="desk-global-alarm-actions">
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => {
                    const params = new URLSearchParams({ alertId: selectedAlert.alertId });
                    if (selectedAlert.deviceId) params.set("deviceId", selectedAlert.deviceId);
                    setAlarmModalOpen(false);
                    navigate(`/app/analysis?${params.toString()}`);
                  }}
                >
                  查看监测大屏
                </Button>
                <Button
                  icon={<SoundOutlined />}
                  loading={alarmAction === "ack"}
                  disabled={selectedAlert.status === "acked" || alarmAction !== null}
                  onClick={() => { void handleAlarmAction("ack"); }}
                >
                  暂时静音
                </Button>
                <Button
                  danger
                  type="primary"
                  icon={<AlertOutlined />}
                  loading={alarmAction === "resolve"}
                  disabled={alarmAction !== null}
                  onClick={() => { void handleAlarmAction("resolve"); }}
                >
                  确认并解除
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
