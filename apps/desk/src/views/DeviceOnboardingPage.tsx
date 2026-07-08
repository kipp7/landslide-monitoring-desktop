import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import {
  App as AntApp,
  Alert,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  Baseline,
  Device,
  DeviceCommand,
  DeviceStateSnapshot,
  OnboardingWorkbenchSummary,
  OperationLogRow,
  PendingObservation,
  Station,
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { StatusTag } from "../components/StatusTag";
import {
  formatInstallLabelDisplay,
  formatLifecycleStatusDisplay,
  formatRegistryStatusDisplay,
  formatRegistryStatusHint,
  formatWarningFlagDisplay,
} from "../utils/fieldIdentityDisplay";
import {
  buildFieldIdentityExamples,
  normalizeCanonicalCode,
  normalizeFreeText,
  validateFieldIdentityDraft,
} from "../utils/fieldIdentityNaming";
import { DeviceManagementSectionNav } from "./DeviceManagementSectionNav";
import { DeviceManagementWorkspaceHeader } from "./DeviceManagementWorkspaceHeader";
import "./deviceManagement.css";

function isCommissionedLifecycle(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "commissioned" || normalized === "active";
}

function optionalTrimmedString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readFirstString(record: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readMetricNumber(
  metrics: Record<string, unknown> | undefined,
  key: string
): number | null {
  const value = metrics?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatTimeOrDash(value?: string | null): string {
  if (!value) return "—";
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "—";
  return ts.toLocaleString("zh-CN");
}

function formatAgeMinutes(value?: string | null): string {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

function readinessTag(ok: boolean, text: string) {
  return <Tag color={ok ? "green" : "orange"}>{text}</Tag>;
}

function formatAuditActionLabel(action: string): string {
  if (action === "bind_pending_device") return "认领并绑定";
  if (action === "confirm_commissioning") return "确认投运";
  if (action === "revoke_device") return "停用设备";
  if (action === "reactivate_device") return "恢复投运";
  return action.replaceAll("_", " ");
}

function readAuditDeviceId(log: OperationLogRow): string | null {
  if (log.targetType === "device" && log.targetId) return log.targetId;
  const requestData = asRecord(log.requestData);
  const responseData = asRecord(log.responseData);
  return (
    readFirstString(requestData, ["deviceId", "device_id"]) ??
    readFirstString(responseData, ["deviceId", "device_id"])
  );
}

function readAuditDeviceLabel(log: OperationLogRow): string | null {
  const requestData = asRecord(log.requestData);
  const responseData = asRecord(log.responseData);
  return (
    readFirstString(requestData, ["displayName", "deviceDisplayName", "deviceName"]) ??
    readFirstString(responseData, ["displayName", "deviceDisplayName", "deviceName"])
  );
}

function stringifyAuditJson(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatPendingObservationSource(
  source: PendingObservation["observationSource"]
): string {
  return source === "runtime_observed_only" ? "运行期新发现" : "台账待补录";
}

function formatSampleNumber(
  value: number | null | undefined,
  suffix = "",
  digits = 1
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatCoordinatePair(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string {
  if (latitude == null || longitude == null) return "—";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "—";
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function DeviceOnboardingPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [logs, setLogs] = useState<OperationLogRow[]>([]);
  const [pendingObservations, setPendingObservations] = useState<PendingObservation[]>([]);
  const [workbenchSummary, setWorkbenchSummary] = useState<OnboardingWorkbenchSummary>({
    pendingCount: 0,
    formalCount: 0,
    pendingCommissioningCount: 0,
    auditCount: 0,
  });
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [nowTime, setNowTime] = useState<string>(new Date().toLocaleTimeString("zh-CN"));
  const [selectedPendingId, setSelectedPendingId] = useState<string>("");
  const [selectedFormalDeviceId, setSelectedFormalDeviceId] = useState<string>("");
  const [deviceState, setDeviceState] = useState<DeviceStateSnapshot | null>(null);
  const [deviceCommands, setDeviceCommands] = useState<DeviceCommand[]>([]);
  const [bindingMode, setBindingMode] = useState<"existing" | "new">("existing");
  const [bindingStationId, setBindingStationId] = useState<string>("");
  const [bindingDisplayName, setBindingDisplayName] = useState<string>("");
  const [bindingInstallLabel, setBindingInstallLabel] = useState<string>("");
  const [bindingNodeCode, setBindingNodeCode] = useState<string>("");
  const [bindingGatewayCode, setBindingGatewayCode] = useState<string>("");
  const [newStationCode, setNewStationCode] = useState<string>("");
  const [newStationName, setNewStationName] = useState<string>("");
  const [newStationDisplayName, setNewStationDisplayName] = useState<string>("");
  const [newStationRegionCode, setNewStationRegionCode] = useState<string>("");
  const [newStationSlopeCode, setNewStationSlopeCode] = useState<string>("");
  const [newStationLocationName, setNewStationLocationName] = useState<string>("");
  const [newStationGatewayCode, setNewStationGatewayCode] = useState<string>("");
  const [newStationRiskLevel, setNewStationRiskLevel] = useState<"low" | "mid" | "high">("low");
  const [bindingSubmitting, setBindingSubmitting] = useState(false);
  const [rebindSubmitting, setRebindSubmitting] = useState(false);
  const [commissioningSubmitting, setCommissioningSubmitting] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState<
    "all" | "bind_pending_device" | "confirm_commissioning" | "revoke_device" | "reactivate_device"
  >("all");
  const [auditDeviceFilter, setAuditDeviceFilter] = useState<string>("all");

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date().toLocaleTimeString("zh-CN"));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const workbench = await api.onboarding.getWorkbench();
      setStations(workbench.stations);
      setDevices(workbench.formalDevices);
      setBaselines(workbench.baselines);
      setLogs(workbench.audits);
      setPendingObservations(workbench.pendingObservations);
      setWorkbenchSummary(workbench.summary);
      setLastUpdateTime(new Date().toLocaleTimeString("zh-CN"));
    } catch (err) {
      const msg = (err as Error).message;
      setLoadError(msg);
      message.error(`设备接入与投运加载失败：${msg}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [api]);

  const formalDevices = devices;
  const baselineByDeviceId = useMemo(
    () => new Map(baselines.map((item) => [item.deviceId, item] as const)),
    [baselines]
  );

  useEffect(() => {
    setSelectedPendingId((prev) => {
      if (prev && pendingObservations.some((item) => item.deviceId === prev)) return prev;
      return pendingObservations[0]?.deviceId ?? "";
    });
  }, [pendingObservations]);

  useEffect(() => {
    setSelectedFormalDeviceId((prev) => {
      if (prev && formalDevices.some((item) => item.id === prev)) return prev;
      const preferred = formalDevices.find((item) => item.status === "online") ?? formalDevices[0];
      return preferred?.id ?? "";
    });
  }, [formalDevices]);

  const selectedPending = useMemo(
    () => pendingObservations.find((item) => item.deviceId === selectedPendingId) ?? null,
    [pendingObservations, selectedPendingId]
  );
  const selectedFormalDevice = useMemo(
    () => formalDevices.find((item) => item.id === selectedFormalDeviceId) ?? null,
    [formalDevices, selectedFormalDeviceId]
  );
  const selectedFormalStation = useMemo(
    () => stations.find((item) => item.id === selectedFormalDevice?.stationId) ?? null,
    [selectedFormalDevice, stations]
  );
  const selectedBindingStation = useMemo(
    () => stations.find((item) => item.id === bindingStationId) ?? null,
    [bindingStationId, stations]
  );
  const selectedBindingPreviewStation = useMemo(() => {
    if (bindingMode === "existing") return selectedBindingStation;
    return null;
  }, [bindingMode, selectedBindingStation]);

  useEffect(() => {
    if (!selectedPending) {
      setBindingMode("existing");
      setBindingStationId("");
      setBindingDisplayName("");
      setBindingInstallLabel("");
      setBindingNodeCode("");
      setBindingGatewayCode("");
      setNewStationCode("");
      setNewStationName("");
      setNewStationDisplayName("");
      setNewStationRegionCode("");
      setNewStationSlopeCode("");
      setNewStationLocationName("");
      setNewStationGatewayCode("");
      setNewStationRiskLevel("low");
      return;
    }

    setBindingMode(stations.length ? "existing" : "new");
    setBindingDisplayName(selectedPending.displayName);
    setBindingInstallLabel(selectedPending.installLabel ?? "");
    setBindingNodeCode(selectedPending.nodeCodeHint ?? "");
    setBindingGatewayCode(selectedPending.gatewayCode ?? "");
    setNewStationCode("");
    setNewStationName("");
    setNewStationDisplayName("");
    setNewStationRegionCode(selectedPending.regionCode ?? "");
    setNewStationSlopeCode("");
    setNewStationLocationName("");
    setNewStationGatewayCode(selectedPending.gatewayCode ?? "");
    setNewStationRiskLevel("low");
  }, [selectedPending?.deviceId, stations.length]);

  useEffect(() => {
    if (!selectedPending) {
      setBindingStationId("");
      return;
    }

    const preferredStation =
      stations.find(
        (item) => selectedPending.regionCode && item.regionCode === selectedPending.regionCode
      ) ??
      stations[0] ??
      null;
    setBindingStationId((prev) =>
      prev && stations.some((item) => item.id === prev) ? prev : (preferredStation?.id ?? "")
    );
  }, [selectedPending, stations]);

  useEffect(() => {
    if (!selectedFormalDeviceId) {
      setDeviceState(null);
      setDeviceCommands([]);
      return;
    }
    let canceled = false;
    const run = async () => {
      try {
        const [nextState, nextCommands] = await Promise.all([
          api.devices.getState({ deviceId: selectedFormalDeviceId }),
          api.devices.listCommands({ deviceId: selectedFormalDeviceId }),
        ]);
        if (canceled) return;
        setDeviceState(nextState);
        setDeviceCommands(nextCommands);
      } catch {
        if (canceled) return;
        setDeviceState(null);
        setDeviceCommands([]);
      }
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [api, selectedFormalDeviceId]);

  const commissioningSummary = useMemo(() => {
    if (!selectedFormalDevice) {
      return {
        hasBaseline: false,
        isCommissioned: false,
        telemetryFresh: false,
        lastCommandAcked: false,
      };
    }

    const hasBaseline = baselineByDeviceId.has(selectedFormalDevice.id);
    const isCommissioned = isCommissionedLifecycle(selectedFormalDevice.lifecycleStatus);
    const lastSeenAt = new Date(selectedFormalDevice.lastSeenAt).getTime();
    const telemetryFresh = !Number.isNaN(lastSeenAt) && Date.now() - lastSeenAt <= 15 * 60 * 1000;
    const latestCommand = deviceCommands[0] ?? null;
    const lastCommandAcked = latestCommand?.status === "acked";

    return {
      hasBaseline,
      isCommissioned,
      telemetryFresh,
      lastCommandAcked,
    };
  }, [baselineByDeviceId, deviceCommands, selectedFormalDevice]);

  const normalizedBindingDisplayName = normalizeFreeText(bindingDisplayName);
  const normalizedBindingInstallLabel = normalizeCanonicalCode(bindingInstallLabel);
  const normalizedBindingNodeCode = normalizeCanonicalCode(bindingNodeCode);
  const normalizedBindingGatewayCode = normalizeCanonicalCode(bindingGatewayCode);
  const normalizedNewStationCode = normalizeCanonicalCode(newStationCode);
  const normalizedNewStationName = normalizeFreeText(newStationName);
  const normalizedNewStationDisplayName = normalizeFreeText(newStationDisplayName);
  const normalizedNewStationRegionCode = normalizeCanonicalCode(newStationRegionCode);
  const normalizedNewStationSlopeCode = normalizeCanonicalCode(newStationSlopeCode);
  const normalizedNewStationGatewayCode = normalizeCanonicalCode(newStationGatewayCode);
  const selectedStationGatewayCode = normalizeCanonicalCode(
    typeof selectedBindingPreviewStation?.metadata?.gatewayCode === "string"
      ? selectedBindingPreviewStation.metadata.gatewayCode
      : null
  );
  const resolvedBindingStationCode =
    bindingMode === "existing"
      ? normalizeCanonicalCode(selectedBindingPreviewStation?.stationCode)
      : normalizedNewStationCode;
  const resolvedBindingRegionCode =
    bindingMode === "existing"
      ? normalizeCanonicalCode(selectedBindingPreviewStation?.regionCode)
      : normalizedNewStationRegionCode;
  const resolvedBindingSlopeCode =
    bindingMode === "existing"
      ? normalizeCanonicalCode(selectedBindingPreviewStation?.slopeCode)
      : normalizedNewStationSlopeCode;
  const resolvedBindingGatewayCode =
    normalizedBindingGatewayCode ||
    (bindingMode === "existing" ? selectedStationGatewayCode : normalizedNewStationGatewayCode);
  const bindingIdentityExamples = buildFieldIdentityExamples({
    regionCode: resolvedBindingRegionCode,
    slopeCode: resolvedBindingSlopeCode,
    stationCode: resolvedBindingStationCode,
    nodeSuffix: selectedPending?.fieldNodeId ?? "A",
  });
  const bindingIdentityIssues = useMemo(
    () =>
      selectedPending
        ? validateFieldIdentityDraft({
            regionCode: resolvedBindingRegionCode,
            slopeCode: resolvedBindingSlopeCode,
            stationCode: resolvedBindingStationCode,
            nodeCode: normalizedBindingNodeCode,
            gatewayCode: resolvedBindingGatewayCode,
            installLabel: normalizedBindingInstallLabel,
            requireRegionCode: true,
            requireSlopeCode: true,
            requireStationCode: true,
            requireNodeCode: true,
            requireGatewayCode: true,
            requireInstallLabel: true,
          })
        : [],
    [
      normalizedBindingInstallLabel,
      normalizedBindingNodeCode,
      resolvedBindingGatewayCode,
      resolvedBindingRegionCode,
      resolvedBindingSlopeCode,
      resolvedBindingStationCode,
      selectedPending,
    ]
  );
  const canSubmitBinding = Boolean(
    selectedPending &&
    normalizedBindingDisplayName &&
    normalizedBindingInstallLabel &&
    normalizedBindingNodeCode &&
    resolvedBindingGatewayCode &&
    bindingIdentityIssues.length === 0 &&
    (bindingMode === "existing"
      ? bindingStationId
      : normalizedNewStationCode &&
        normalizedNewStationName &&
        normalizedNewStationDisplayName &&
        normalizedNewStationRegionCode &&
        normalizedNewStationSlopeCode)
  );

  const newStationPreviewName = normalizedNewStationDisplayName || normalizedNewStationName || "—";
  const bindingPreviewStationName =
    (bindingMode === "existing"
      ? (selectedBindingPreviewStation?.displayName ?? selectedBindingPreviewStation?.name)
      : newStationPreviewName) ?? "—";
  const bindingPreviewRegionCode = resolvedBindingRegionCode || "—";
  const bindingPreviewSlopeCode = resolvedBindingSlopeCode || "—";
  const bindingPreviewGatewayCode = resolvedBindingGatewayCode || "—";
  const bindingPreviewRuntimeName = selectedPending?.runtimeName ?? "—";

  const handleBindPendingDevice = async () => {
    if (!selectedPending || !canSubmitBinding) {
      message.info("请先补齐标准身份字段，并使编码符合统一命名标准");
      return;
    }

    setBindingSubmitting(true);
    try {
      const result = await api.onboarding.bindPendingDevice({
        deviceId: selectedPending.deviceId,
        ...(bindingMode === "existing"
          ? { stationId: bindingStationId }
          : {
              newStation: {
                stationCode: normalizedNewStationCode,
                stationName: normalizedNewStationName,
                displayName: normalizedNewStationDisplayName,
                regionCode: normalizedNewStationRegionCode,
                slopeCode: normalizedNewStationSlopeCode,
                ...(optionalTrimmedString(newStationLocationName)
                  ? { locationName: newStationLocationName.trim() }
                  : {}),
                ...(resolvedBindingGatewayCode ? { gatewayCode: resolvedBindingGatewayCode } : {}),
                riskLevel: newStationRiskLevel,
              },
            }),
        deviceName: selectedPending.runtimeName,
        displayName: normalizedBindingDisplayName,
        installLabel: normalizedBindingInstallLabel,
        nodeCode: normalizedBindingNodeCode,
        ...(resolvedBindingGatewayCode ? { gatewayCode: resolvedBindingGatewayCode } : {}),
        deviceRole: "field_node",
        lifecycleStatus: "pending_commissioning",
      });
      await refresh(true);
      setSelectedFormalDeviceId(result.deviceId);
      message.success(
        result.createdStationId
          ? "设备已认领，并完成站点与设备建档"
          : result.createdDevice
            ? "设备已认领，并补建设备台账"
            : "设备已认领并纳入设备台账"
      );
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBindingSubmitting(false);
    }
  };

  const handleRebindFormalDevice = async () => {
    if (!selectedFormalDevice || !selectedFormalDevice.stationId) {
      message.info("请先选择已纳入设备台账的设备");
      return;
    }
    if (!selectedFormalDevice.installLabel || !selectedFormalDevice.nodeCode) {
      message.error("当前设备缺少安装标识或节点编码，暂不适合执行复核绑定");
      return;
    }

    setRebindSubmitting(true);
    try {
      await api.onboarding.bindPendingDevice({
        deviceId: selectedFormalDevice.id,
        stationId: selectedFormalDevice.stationId,
        deviceName:
          selectedFormalDevice.deviceName ??
          selectedFormalDevice.legacyDeviceId ??
          selectedFormalDevice.id,
        displayName: selectedFormalDevice.displayName ?? selectedFormalDevice.name,
        installLabel: selectedFormalDevice.installLabel,
        nodeCode: selectedFormalDevice.nodeCode,
        ...(selectedFormalDevice.gatewayCode
          ? { gatewayCode: selectedFormalDevice.gatewayCode }
          : {}),
        deviceRole: selectedFormalDevice.deviceRole ?? "field_node",
        lifecycleStatus: "pending_commissioning",
      });
      await refresh(true);
      setSelectedFormalDeviceId(selectedFormalDevice.id);
      setAuditDeviceFilter(selectedFormalDevice.id);
      setAuditActionFilter("all");
      message.success("已重新写入绑定信息，设备已回到投运复核阶段");
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRebindSubmitting(false);
    }
  };

  const handleConfirmCommissioning = async () => {
    if (!selectedFormalDevice) {
      message.info("请先选择在册设备");
      return;
    }

    setCommissioningSubmitting(true);
    try {
      await api.onboarding.confirmCommissioning({
        deviceId: selectedFormalDevice.id,
        lifecycleStatus: "commissioned",
      });
      await refresh(true);
      setSelectedFormalDeviceId(selectedFormalDevice.id);
      setAuditDeviceFilter(selectedFormalDevice.id);
      message.success("设备已确认投运");
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setCommissioningSubmitting(false);
    }
  };

  const handleRevokeFormalDevice = async () => {
    if (!selectedFormalDevice) {
      message.info("请先选择在册设备");
      return;
    }

    setRevokeSubmitting(true);
    try {
      await api.devices.revoke({ deviceId: selectedFormalDevice.id });
      await refresh(true);
      setAuditActionFilter("revoke_device");
      setAuditDeviceFilter("all");
      message.success("设备已停用并移出设备台账");
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRevokeSubmitting(false);
    }
  };

  const auditRows = useMemo(
    () =>
      logs.map((log) => ({
        ...log,
        deviceId: readAuditDeviceId(log),
      })),
    [logs]
  );
  const auditDeviceOptions = useMemo(
    () => [
      { value: "all", label: "全部设备" },
      ...formalDevices.map((device) => ({
        value: device.id,
        label: device.displayName ?? device.name,
      })),
    ],
    [formalDevices]
  );
  const filteredAuditRows = useMemo(
    () =>
      auditRows.filter((log) => {
        if (auditActionFilter !== "all" && log.action !== auditActionFilter) return false;
        if (auditDeviceFilter !== "all" && log.deviceId !== auditDeviceFilter) return false;
        return true;
      }),
    [auditActionFilter, auditDeviceFilter, auditRows]
  );

  const overviewCards = useMemo(
    () => [
      {
        label: "待接入设备",
        value: workbenchSummary.pendingCount,
        hint: "等待认领或补齐标准身份",
      },
      {
        label: "在册设备",
        value: workbenchSummary.formalCount,
        hint: "已纳入当前产品视图",
      },
      {
        label: "待投运复核",
        value: workbenchSummary.pendingCommissioningCount,
        hint: "需要继续核对上线与投运状态",
      },
      {
        label: "最近操作记录",
        value: workbenchSummary.auditCount,
        hint: "当前工作台加载的接入审计",
      },
    ],
    [workbenchSummary]
  );

  return (
    <div className="desk-page desk-dm-page">
      <DeviceManagementWorkspaceHeader
        title="设备接入与投运中心"
        subtitle="待接入识别、建档绑定、投运复核与审计追溯"
        nowTime={nowTime}
        lastUpdateTime={lastUpdateTime}
        actions={
          <>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => {
                void refresh();
              }}
            >
              刷新
            </Button>
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => {
                navigate("/app/settings");
              }}
            >
              设置
            </Button>
          </>
        }
      />

      <DeviceManagementSectionNav active="onboarding" />

      {loadError ? (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type="error"
            showIcon
            message="页面数据加载失败"
            description={
              <div style={{ color: "rgba(226,232,240,0.9)" }}>
                <div style={{ marginBottom: 6 }}>{loadError}</div>
                <div style={{ color: "rgba(148,163,184,0.9)" }}>
                  可在「系统设置」检查当前数据源与接口地址。
                </div>
              </div>
            }
          />
        </div>
      ) : null}

      <div className="desk-onb-summary-grid">
        {overviewCards.map((card) => (
          <BaseCard key={card.label} className="desk-onb-summary-card">
            <div className="desk-onb-summary-label">{card.label}</div>
            <div className="desk-onb-summary-value">{card.value}</div>
            <div className="desk-onb-summary-hint">{card.hint}</div>
          </BaseCard>
        ))}
      </div>

      <div className="desk-onb-grid-top">
        <BaseCard title="待接入设备" className="desk-onb-panel">
          <div className="desk-dm-muted" style={{ marginBottom: 10 }}>
            按现场最近上报整理待接入对象，待运维确认后再纳入设备台账。
          </div>
          {pendingObservations.length ? (
            <div className="desk-onb-queue">
              {pendingObservations.map((item) => (
                <button
                  key={item.deviceId}
                  type="button"
                  className={`desk-onb-queue-item ${item.deviceId === selectedPendingId ? "active" : ""}`}
                  onClick={() => setSelectedPendingId(item.deviceId)}
                >
                  <div className="desk-onb-queue-title">{item.displayName}</div>
                  <div className="desk-onb-queue-meta">
                    {item.installLabel
                      ? formatInstallLabelDisplay(item.installLabel)
                      : item.deviceId}
                  </div>
                  <div className="desk-onb-queue-meta">
                    {formatPendingObservationSource(item.observationSource)} · 最近上报{" "}
                    {formatAgeMinutes(item.lastSeenAt)}
                  </div>
                  <div className="desk-onb-queue-meta">
                    {item.reason}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="desk-onb-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前没有待接入设备。新设备上报后，会进入待接入队列，待运维确认绑定。"
              />
            </div>
          )}
        </BaseCard>

        <BaseCard title="绑定与命名" className="desk-onb-panel">
          {selectedPending ? (
            <>
              <div className="desk-onb-detail-grid">
                <div className="desk-onb-detail-item">
                  <span className="k">设备 ID</span>
                  <span className="v">{selectedPending.deviceId}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">运行名</span>
                  <span className="v">{selectedPending.runtimeName}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">界面名称</span>
                  <span className="v">{selectedPending.displayName}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">安装标识</span>
                  <span className="v">
                    {selectedPending.installLabel
                      ? formatInstallLabelDisplay(selectedPending.installLabel)
                      : "—"}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">节点标识</span>
                  <span className="v">{selectedPending.fieldNodeId ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">现有节点编码</span>
                  <span className="v">{selectedPending.nodeCodeHint ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">站点编码</span>
                  <span className="v">{selectedPending.stationCode ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">网关编码</span>
                  <span className="v">{selectedPending.gatewayCode ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">区域编码</span>
                  <span className="v">{selectedPending.regionCode ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">发现来源</span>
                  <span className="v">{formatPendingObservationSource(selectedPending.observationSource)}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近序号</span>
                  <span className="v">
                    {selectedPending.lastSeq == null ? "—" : String(selectedPending.lastSeq)}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">首次发现</span>
                  <span className="v">{formatTimeOrDash(selectedPending.firstSeenAt)}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近发现</span>
                  <span className="v">{formatTimeOrDash(selectedPending.lastSeenAt)}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近温度</span>
                  <span className="v">
                    {formatSampleNumber(selectedPending.sampleMetrics.temperatureC, " °C")}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近湿度</span>
                  <span className="v">
                    {formatSampleNumber(selectedPending.sampleMetrics.humidityPct, " %")}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近电量</span>
                  <span className="v">
                    {formatSampleNumber(selectedPending.sampleMetrics.batteryPct, " %", 0)}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近定位</span>
                  <span className="v">
                    {formatCoordinatePair(
                      selectedPending.sampleMetrics.gpsLatitude,
                      selectedPending.sampleMetrics.gpsLongitude
                    )}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近预警</span>
                  <span className="v">
                    {formatWarningFlagDisplay(selectedPending.sampleMetrics.warningFlag, "—")}
                  </span>
                </div>
              </div>

              <div className="desk-onb-reference-block">
                <div className="desk-onb-reference-title">认领设置</div>
                <Segmented<"existing" | "new">
                  className="desk-onb-bind-mode"
                  block
                  value={bindingMode}
                  onChange={(value) => setBindingMode(value)}
                  options={[
                    { label: "绑定现有站点", value: "existing", disabled: stations.length === 0 },
                    { label: "新建站点", value: "new" },
                  ]}
                />

                {!stations.length ? (
                  <Alert
                    type="info"
                    showIcon
                    message="当前没有可复用的在册站点"
                    description="本次认领将直接创建一个新站点，并把设备纳入该站点。"
                    style={{ marginBottom: 12 }}
                  />
                ) : null}

                <div className="desk-onb-reference-meta">
                  编码模板：区域 {bindingIdentityExamples.regionCode} · 边坡{" "}
                  {bindingIdentityExamples.slopeCode} · 站点 {bindingIdentityExamples.stationCode} ·
                  节点 {bindingIdentityExamples.nodeCode} · 网关{" "}
                  {bindingIdentityExamples.gatewayCode}
                </div>

                {bindingIdentityIssues.length ? (
                  <Alert
                    style={{ marginTop: 12 }}
                    type="warning"
                    showIcon
                    message="标准身份编码未通过校验"
                    description={
                      <div className="desk-onb-issue-list">
                        {bindingIdentityIssues.map((issue) => (
                          <div key={`${issue.field}-${issue.message}`}>{issue.message}</div>
                        ))}
                      </div>
                    }
                  />
                ) : (
                  <Alert
                    style={{ marginTop: 12 }}
                    type="success"
                    showIcon
                    message="标准身份校验通过"
                    description="提交时会按大写编码写入设备台账，命名语义与现场标准保持一致。"
                  />
                )}

                {bindingMode === "existing" ? (
                  <div className="desk-onb-form-section">
                    <div className="desk-onb-form-section-title">目标站点</div>
                    <div className="desk-onb-form-grid">
                      <div className="desk-onb-form-item">
                        <label>在册站点</label>
                        <Select
                          value={bindingStationId || null}
                          onChange={setBindingStationId}
                          options={stations.map((item) => ({
                            value: item.id,
                            label: item.displayName ?? item.name,
                          }))}
                        />
                      </div>
                    </div>
                    {selectedBindingStation ? (
                      <div className="desk-onb-reference-meta">
                        绑定站点：
                        {selectedBindingStation.displayName ?? selectedBindingStation.name} ·
                        站点编码 {selectedBindingStation.stationCode ?? "—"} · 区域编码{" "}
                        {selectedBindingStation.regionCode ?? "—"} · 边坡编码{" "}
                        {selectedBindingStation.slopeCode ?? "—"}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="desk-onb-form-section">
                    <div className="desk-onb-form-section-title">新建站点</div>
                    <div className="desk-onb-form-grid">
                      <div className="desk-onb-form-item">
                        <label>站点编码</label>
                        <Input
                          value={newStationCode}
                          placeholder={`例如：${bindingIdentityExamples.stationCode}`}
                          onChange={(event) => setNewStationCode(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>站点名称</label>
                        <Input
                          value={newStationName}
                          onChange={(event) => setNewStationName(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>站点展示名称</label>
                        <Input
                          value={newStationDisplayName}
                          onChange={(event) => setNewStationDisplayName(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>区域编码</label>
                        <Input
                          value={newStationRegionCode}
                          placeholder={`例如：${bindingIdentityExamples.regionCode}`}
                          onChange={(event) => setNewStationRegionCode(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>边坡编码</label>
                        <Input
                          value={newStationSlopeCode}
                          placeholder={`例如：${bindingIdentityExamples.slopeCode}`}
                          onChange={(event) => setNewStationSlopeCode(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>位置名称</label>
                        <Input
                          value={newStationLocationName}
                          onChange={(event) => setNewStationLocationName(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>站点网关编码</label>
                        <Input
                          value={newStationGatewayCode}
                          placeholder={`例如：${bindingIdentityExamples.gatewayCode}`}
                          onChange={(event) => setNewStationGatewayCode(event.target.value)}
                        />
                      </div>
                      <div className="desk-onb-form-item">
                        <label>风险等级</label>
                        <Select
                          value={newStationRiskLevel}
                          onChange={(value) => setNewStationRiskLevel(value)}
                          options={[
                            { value: "low", label: "低" },
                            { value: "mid", label: "中" },
                            { value: "high", label: "高" },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="desk-onb-reference-meta">
                      新站点摘要：{newStationPreviewName} · 区域编码{" "}
                      {normalizedNewStationRegionCode || "—"} · 边坡编码{" "}
                      {normalizedNewStationSlopeCode || "—"} · 网关编码{" "}
                      {normalizedNewStationGatewayCode || "—"}
                    </div>
                  </div>
                )}

                <div className="desk-onb-form-section">
                  <div className="desk-onb-form-section-title">设备命名</div>
                  <div className="desk-onb-form-grid">
                    <div className="desk-onb-form-item">
                      <label>展示名称</label>
                      <Input
                        value={bindingDisplayName}
                        placeholder="例如：GBS Station 01 Node A"
                        onChange={(event) => setBindingDisplayName(event.target.value)}
                      />
                    </div>
                    <div className="desk-onb-form-item">
                      <label>安装标识</label>
                      <Input
                        value={bindingInstallLabel}
                        placeholder={`例如：${bindingIdentityExamples.installLabel}`}
                        onChange={(event) => setBindingInstallLabel(event.target.value)}
                      />
                    </div>
                    <div className="desk-onb-form-item">
                      <label>节点编码</label>
                      <Input
                        value={bindingNodeCode}
                        placeholder={`例如：${bindingIdentityExamples.nodeCode}`}
                        onChange={(event) => setBindingNodeCode(event.target.value)}
                      />
                    </div>
                    <div className="desk-onb-form-item">
                      <label>设备网关编码</label>
                      <Input
                        value={bindingGatewayCode}
                        placeholder={`例如：${bindingIdentityExamples.gatewayCode}`}
                        onChange={(event) => setBindingGatewayCode(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="desk-onb-reference-meta">
                    运行名会保留设备原始上报标识，展示名称才用于操作员界面展示；编码字段会按统一标准写入。
                  </div>
                </div>

                <div className="desk-onb-form-section">
                  <div className="desk-onb-form-section-title">标准身份摘要</div>
                  <div className="desk-onb-preview-grid">
                    <div className="desk-onb-preview-item">
                      <span className="k">运行名</span>
                      <span className="v">{bindingPreviewRuntimeName}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">展示名称</span>
                      <span className="v">{normalizedBindingDisplayName || "—"}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">目标站点</span>
                      <span className="v">{bindingPreviewStationName}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">安装标识</span>
                      <span className="v">{normalizedBindingInstallLabel || "—"}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">节点编码</span>
                      <span className="v">{normalizedBindingNodeCode || "—"}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">设备网关编码</span>
                      <span className="v">{bindingPreviewGatewayCode}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">区域编码</span>
                      <span className="v">{bindingPreviewRegionCode}</span>
                    </div>
                    <div className="desk-onb-preview-item">
                      <span className="k">边坡编码</span>
                      <span className="v">{bindingPreviewSlopeCode}</span>
                    </div>
                  </div>
                </div>

                <div className="desk-onb-action-row">
                  <Button
                    type="primary"
                    loading={bindingSubmitting}
                    disabled={!canSubmitBinding}
                    onClick={() => void handleBindPendingDevice()}
                  >
                    {bindingMode === "new" ? "建档并认领" : "认领并绑定"}
                  </Button>
                  <span className="desk-dm-muted">
                    认领完成后，设备会纳入设备台账，并进入投运复核阶段。
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                message="当前现场没有待认领设备"
                description="当前设备已纳入设备台账。后续如有新设备或替换板卡，会先在本页等待认领、命名与投运复核。"
              />
              <div className="desk-onb-reference-block">
                <div className="desk-onb-reference-title">当前点位模板</div>
                {stations[0] ? (
                  <div className="desk-onb-detail-grid">
                    <div className="desk-onb-detail-item">
                      <span className="k">站点展示名</span>
                      <span className="v">{stations[0].displayName ?? stations[0].name}</span>
                    </div>
                    <div className="desk-onb-detail-item">
                      <span className="k">站点编码</span>
                      <span className="v">{stations[0].stationCode ?? "—"}</span>
                    </div>
                    <div className="desk-onb-detail-item">
                      <span className="k">区域编码</span>
                      <span className="v">{stations[0].regionCode ?? "—"}</span>
                    </div>
                    <div className="desk-onb-detail-item">
                      <span className="k">边坡编码</span>
                      <span className="v">{stations[0].slopeCode ?? "—"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="desk-dm-muted">当前没有可复用的站点模板。</div>
                )}
              </div>
            </>
          )}
        </BaseCard>

        <BaseCard
          title="投运验证"
          className="desk-onb-panel"
          extra={
            formalDevices.length ? (
              <Select
                size="small"
                value={selectedFormalDeviceId}
                style={{ width: 220 }}
                onChange={setSelectedFormalDeviceId}
                options={formalDevices.map((item) => ({
                  value: item.id,
                  label: item.displayName ?? item.name,
                }))}
              />
            ) : null
          }
        >
          {selectedFormalDevice ? (
            <>
              <div className="desk-onb-device-head">
                <div>
                  <div className="desk-onb-device-title">
                    {selectedFormalDevice.displayName ?? selectedFormalDevice.name}
                  </div>
                  <div className="desk-dm-muted">
                    {[
                      selectedFormalStation?.displayName ?? selectedFormalDevice.stationName,
                      selectedFormalStation?.area ?? null,
                      selectedFormalDevice.installLabel
                        ? formatInstallLabelDisplay(selectedFormalDevice.installLabel)
                        : null,
                    ]
                      .filter((item): item is string => Boolean(item))
                      .join(" · ")}
                  </div>
                </div>
                <StatusTag value={selectedFormalDevice.status} />
              </div>

              <div className="desk-onb-checklist">
                <div className="desk-onb-check-row">
                  <span>投运状态</span>
                  {readinessTag(
                    commissioningSummary.isCommissioned,
                    commissioningSummary.isCommissioned ? "已投运" : "待投运"
                  )}
                </div>
                <div className="desk-onb-check-row">
                  <span>最近上报新鲜度</span>
                  {readinessTag(
                    commissioningSummary.telemetryFresh,
                    commissioningSummary.telemetryFresh ? "15 分钟内有上报" : "上报超时"
                  )}
                </div>
                <div className="desk-onb-check-row">
                  <span>形变基线</span>
                  {readinessTag(
                    commissioningSummary.hasBaseline,
                    commissioningSummary.hasBaseline ? "已建立" : "待建立"
                  )}
                </div>
                <div className="desk-onb-check-row">
                  <span>最近命令闭环</span>
                  {readinessTag(
                    commissioningSummary.lastCommandAcked,
                    commissioningSummary.lastCommandAcked
                      ? "最近一次控制已回执"
                      : "最近一次控制未回执"
                  )}
                </div>
              </div>

              <div className="desk-onb-detail-grid" style={{ marginTop: 12 }}>
                <div className="desk-onb-detail-item">
                  <span className="k">最后上报</span>
                  <span className="v">{formatTimeOrDash(selectedFormalDevice.lastSeenAt)}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">站点编码</span>
                  <span className="v">{selectedFormalDevice.stationCode ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">节点编码</span>
                  <span className="v">{selectedFormalDevice.nodeCode ?? "—"}</span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">生命周期</span>
                  <span className="v">
                    {formatLifecycleStatusDisplay(selectedFormalDevice.lifecycleStatus)}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">接入控制</span>
                  <span className="v">
                    {formatRegistryStatusDisplay(selectedFormalDevice.registryStatus)}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">温度</span>
                  <span className="v">
                    {readMetricNumber(deviceState?.metrics, "temperature_c") ?? "—"}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">电量</span>
                  <span className="v">
                    {readMetricNumber(deviceState?.metrics, "battery_pct") ?? "—"}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">预警状态</span>
                  <span className="v">
                    {formatWarningFlagDisplay(
                      deviceState?.metrics?.warning_flag as boolean | null | undefined,
                      "-"
                    )}
                  </span>
                </div>
                <div className="desk-onb-detail-item">
                  <span className="k">最近命令</span>
                  <span className="v">{deviceCommands[0]?.commandType ?? "—"}</span>
                </div>
              </div>

              <div className="desk-onb-action-row">
                <Button loading={rebindSubmitting} onClick={() => void handleRebindFormalDevice()}>
                  重新进入投运复核
                </Button>
                <Button
                  type="primary"
                  loading={commissioningSubmitting}
                  disabled={commissioningSummary.isCommissioned}
                  onClick={() => void handleConfirmCommissioning()}
                >
                  {commissioningSummary.isCommissioned ? "已投运" : "确认投运"}
                </Button>
                <Button
                  danger
                  loading={revokeSubmitting}
                  onClick={() => {
                    modal.confirm({
                      title: "确认停用当前设备？",
                      content: "停用后设备会移出设备台账，但历史数据与审计记录会保留。",
                      okText: "确认停用",
                      cancelText: "取消",
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        await handleRevokeFormalDevice();
                      },
                    });
                  }}
                >
                  停用设备
                </Button>
                <span className="desk-dm-muted">
                  可先重新写入当前绑定信息，让设备回到待投运复核；如设备退场或替换，可执行停用并保留审计。
                </span>
              </div>
              <div className="desk-dm-muted" style={{ marginTop: 10 }}>
                在线状态看最近上报，生命周期看投运阶段，接入控制看是否允许设备直连或已停用。
                {selectedFormalDevice.registryStatus
                  ? ` 当前设备${formatRegistryStatusHint(selectedFormalDevice.registryStatus)}`
                  : ""}
              </div>
            </>
          ) : (
            <div className="desk-onb-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前没有可用于投运复核的在册设备。"
              />
            </div>
          )}
        </BaseCard>
      </div>

      <div className="desk-onb-grid-bottom">
        <BaseCard title="审计记录">
          <div className="desk-dm-muted" style={{ marginBottom: 10 }}>
            展示近期接入相关操作记录，用于核对绑定、命名、投运与停用过程。
          </div>
          <div className="desk-onb-audit-toolbar">
            <Select
              size="small"
              value={auditActionFilter}
              style={{ width: 180 }}
              onChange={(value) => setAuditActionFilter(value)}
              options={[
                { value: "all", label: "全部动作" },
                { value: "bind_pending_device", label: "认领并绑定" },
                { value: "confirm_commissioning", label: "确认投运" },
                { value: "revoke_device", label: "停用设备" },
                { value: "reactivate_device", label: "恢复投运" },
              ]}
            />
            <Select
              size="small"
              value={auditDeviceFilter}
              style={{ width: 220 }}
              onChange={(value) => setAuditDeviceFilter(value)}
              options={auditDeviceOptions}
            />
          </div>
          <div className="desk-dark-table desk-dm-table-wrap">
            <Table<OperationLogRow & { deviceId: string | null }>
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8, showSizeChanger: false }}
              dataSource={filteredAuditRows}
              locale={{ emptyText: "当前没有可显示的操作记录" }}
              expandable={{
                expandedRowRender: (record) => (
                  <div className="desk-onb-audit-expand">
                    <div className="desk-onb-audit-block">
                      <div className="desk-onb-audit-block-title">请求载荷</div>
                      <pre className="desk-onb-audit-json">
                        {stringifyAuditJson(record.requestData)}
                      </pre>
                    </div>
                    <div className="desk-onb-audit-block">
                      <div className="desk-onb-audit-block-title">响应载荷</div>
                      <pre className="desk-onb-audit-json">
                        {stringifyAuditJson(record.responseData)}
                      </pre>
                    </div>
                  </div>
                ),
                rowExpandable: (record) => Boolean(record.requestData || record.responseData),
              }}
              columns={[
                {
                  title: "时间",
                  dataIndex: "createdAt",
                  width: 180,
                  render: (value: string) => formatTimeOrDash(value),
                },
                {
                  title: "动作",
                  dataIndex: "action",
                  width: 140,
                  render: (value: string) => formatAuditActionLabel(value),
                },
                {
                  title: "关联设备",
                  width: 220,
                  render: (_value, record) => {
                    const device =
                      formalDevices.find((item) => item.id === record.deviceId) ?? null;
                    return device
                      ? (device.displayName ?? device.name)
                      : (readAuditDeviceLabel(record) ?? record.deviceId ?? "—");
                  },
                },
                {
                  title: "操作人",
                  dataIndex: "username",
                  width: 120,
                },
                {
                  title: "结果",
                  dataIndex: "status",
                  width: 100,
                  render: (value: string) => (
                    <Tag color={value === "success" ? "green" : "red"}>
                      {value === "success" ? "成功" : value}
                    </Tag>
                  ),
                },
                {
                  title: "摘要",
                  render: (_value, record) => {
                    const requestData = asRecord(record.requestData);
                    const responseData = asRecord(record.responseData);
                    const stationId =
                      readFirstString(requestData, ["stationId", "station_id"]) ??
                      readFirstString(responseData, ["stationId", "station_id"]);
                    const station = stations.find((item) => item.id === stationId) ?? null;
                    const parts = [
                      station ? `站点 ${station.displayName ?? station.name}` : null,
                      readFirstString(requestData, ["displayName"])
                        ? `展示名 ${readFirstString(requestData, ["displayName"])}`
                        : null,
                      readFirstString(requestData, ["installLabel"])
                        ? `安装标识 ${readFirstString(requestData, ["installLabel"])}`
                        : null,
                      readFirstString(requestData, ["nodeCode"])
                        ? `节点编码 ${readFirstString(requestData, ["nodeCode"])}`
                        : null,
                      record.action === "confirm_commissioning" ? "生命周期切换为已投运" : null,
                      record.action === "revoke_device" ? "设备已停用并移出设备台账" : null,
                      record.action === "reactivate_device" ? "设备已恢复到投运台账" : null,
                    ].filter((item): item is string => Boolean(item));
                    return (
                      <Typography.Text style={{ color: "rgba(226,232,240,0.92)" }}>
                        {parts.join(" · ") || record.description || "—"}
                      </Typography.Text>
                    );
                  },
                },
                {
                  title: "说明",
                  dataIndex: "description",
                  width: 180,
                  render: (value: string) => (
                    <Typography.Text style={{ color: "rgba(148,163,184,0.92)" }}>
                      {value || "—"}
                    </Typography.Text>
                  ),
                },
              ]}
            />
          </div>
        </BaseCard>
      </div>
    </div>
  );
}
