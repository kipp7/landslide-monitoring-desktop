import type { MenuProps } from "antd";
import { ExportOutlined, ReloadOutlined, SettingOutlined, ToolOutlined } from "@ant-design/icons";
import { App as AntApp, Alert, Button, Dropdown, Modal, Progress, Select, Space, Table, Tag, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  Baseline,
  Device,
  DeviceCommand,
  DeviceHealthExpertResult,
  DeviceStateSnapshot,
  FieldAlarmStatus,
  OnlineStatus,
  Station,
  SuccessNotificationPolicy
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { RiskTag } from "../components/RiskTag";
import { StatusTag } from "../components/StatusTag";
import {
  formatDeviceRoleDisplay,
  formatInstallLabelDisplay,
  formatLifecycleStatusDisplay,
  formatRegistryStatusDisplay,
  formatRegistryStatusHint,
  formatWarningFlagDisplay,
} from "../utils/fieldIdentityDisplay";
import { buildBaselinesExport, buildDeviceDetailText, buildDevicesExport, buildSensorExport, copyTextContent, triggerPreparedExport } from "./deviceManagementExport";
import { DeviceManagementSectionNav } from "./DeviceManagementSectionNav";
import { DeviceManagementWorkspaceHeader } from "./DeviceManagementWorkspaceHeader";
import { BaselinesPanel } from "./BaselinesPanel";
import { StationManagementPanel } from "./StationManagementPanel";
import "./deviceManagement.css";

type TabKey = "status" | "management" | "baselines";
type IdentityFilter = "all" | "formal" | "non_formal";
const CENTER_NODE_SELECTION_ID = "__rk3568_center_node__";

type SensorRow = {
  id: string;
  time: string;
  temperature: number;
  humidity: number;
  dispMm: number;
  rainMm: number;
};

type ControlLogRow = {
  id: string;
  time: string;
  action: string;
  result: "success" | "pending" | "failed";
};

type CenterNodeSummary = {
  displayName: string;
  gatewayCode: string | null;
  regionCode: string | null;
  role: string;
  status: OnlineStatus;
  available: boolean;
  dryRun: boolean;
  detail: string;
  lastActionAt: string | null;
};

function statusDotColor(status: OnlineStatus) {
  if (status === "online") return "#4ade80";
  if (status === "warning") return "#fbbf24";
  return "#94a3b8";
}

function progressColor(value: number) {
  if (value >= 70) return "#22c55e";
  if (value >= 40) return "#f59e0b";
  return "#ef4444";
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function canonicalText(value?: string | null): string {
  return value?.trim() ? value.trim() : "—";
}

function readMetadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildCenterNodeSummary(devices: Device[], fieldAlarmStatus: FieldAlarmStatus | null): CenterNodeSummary | null {
  const gatewayDevice =
    devices.find((device) => device.gatewayCode || readMetadataString(device.metadata, ["gatewayDisplayName", "gateway_display_name"])) ??
    devices[0];
  const gatewayCode =
    gatewayDevice?.gatewayCode ??
    readMetadataString(gatewayDevice?.metadata, ["gatewayCode", "gateway_code"]) ??
    null;
  const regionCode =
    gatewayDevice?.regionCode ??
    readMetadataString(gatewayDevice?.metadata, ["regionCode", "region_code"]) ??
    null;
  const gatewayDisplayName =
    readMetadataString(gatewayDevice?.metadata, ["gatewayDisplayName", "gateway_display_name"]) ??
    readMetadataString(gatewayDevice?.metadata, ["centerDisplayName", "center_display_name"]);
  const available = Boolean(fieldAlarmStatus?.actuator.available);
  const dryRun = Boolean(fieldAlarmStatus?.actuator.dryRun);

  if (!gatewayDevice && !fieldAlarmStatus) return null;

  return {
    displayName: gatewayDisplayName ? `${gatewayDisplayName} 中心节点` : "RK3568 中心节点",
    gatewayCode,
    regionCode,
    role: "center_node",
    status: available ? "online" : fieldAlarmStatus ? "warning" : "offline",
    available,
    dryRun,
    detail: fieldAlarmStatus?.actuator.detail ?? "中心 API -> RK3568 actuator -> YX75R 声光报警器",
    lastActionAt: fieldAlarmStatus?.actuator.lastActionAt ?? null
  };
}

function buildCenterNodeDetailText(summary: CenterNodeSummary, alarmStatus: FieldAlarmStatus | null): string {
  return [
    `中心节点：${summary.displayName}`,
    `网关编码：${summary.gatewayCode ?? "-"}`,
    `区域编码：${summary.regionCode ?? "-"}`,
    `设备角色：${formatDeviceRoleDisplay(summary.role)}`,
    `在线状态：${summary.status === "online" ? "在线" : summary.status === "warning" ? "待确认" : "离线"}`,
    `执行器：${summary.available ? "已连接" : "待确认"}`,
    `执行模式：${summary.dryRun ? "Mock 演示" : "真实执行"}`,
    `声光状态：${alarmStatus?.active ? "报警中" : alarmStatus?.silenced ? "已停止" : "待命"}`,
    `最近动作：${summary.lastActionAt ? new Date(summary.lastActionAt).toLocaleString("zh-CN") : "-"}`,
    `执行链路：${summary.detail}`
  ].join("\n");
}

function mapCommandStatus(status: DeviceCommand["status"]): ControlLogRow["result"] {
  if (status === "queued" || status === "sent") return "pending";
  if (status === "acked") return "success";
  return "failed";
}

function successNotificationPolicyLabel(policy: SuccessNotificationPolicy): string {
  if (policy === "always_notify") return "始终通知";
  if (policy === "silent") return "静默";
  return "继承默认";
}

function deviceTypeLabel(device: Device) {
  if (device.type === "gnss") return "GNSS";
  if (device.type === "rain") return "雨量";
  if (device.type === "tilt") return "倾角";
  if (device.type === "temp_hum") return "温湿度";
  if (device.type === "field_gateway") return "中心网关";
  return "摄像头";
}

function readMetricNumber(metrics: Record<string, unknown> | undefined, key: string): number | null {
  const value = metrics?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readMetricBoolean(metrics: Record<string, unknown> | undefined, key: string): boolean | null {
  const value = metrics?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

function formatMetricNumber(value: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

export function DeviceManagementPage() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { message, modal } = AntApp.useApp();
  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("formal");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [nowTime, setNowTime] = useState<string>(new Date().toLocaleTimeString("zh-CN"));
  const [detailOpen, setDetailOpen] = useState(false);
  const [motorRunning, setMotorRunning] = useState(false);
  const [fieldAlarmOn, setFieldAlarmOn] = useState(false);
  const [successNotificationPolicy, setSuccessNotificationPolicy] = useState<SuccessNotificationPolicy>("inherit");
  const [samplingInterval, setSamplingInterval] = useState<number>(10);
  const [controlLogs, setControlLogs] = useState<ControlLogRow[]>([]);
  const [sensorRows, setSensorRows] = useState<SensorRow[]>([]);
  const [deviceExpert, setDeviceExpert] = useState<DeviceHealthExpertResult | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceStateSnapshot | null>(null);
  const [fieldAlarmStatus, setFieldAlarmStatus] = useState<FieldAlarmStatus | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "status" || tab === "management" || tab === "baselines") setActiveTab(tab);

    const qDeviceId = params.get("deviceId");
    if (qDeviceId) setSelectedDeviceId(qDeviceId);
  }, [location.search]);

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set("tab", tab);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date().toLocaleTimeString("zh-CN"));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const queryStationId = useMemo(() => new URLSearchParams(location.search).get("stationId"), [location.search]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(null);
    const run = async () => {
      try {
        const [s, d, b, alarm] = await Promise.all([
          api.stations.list(),
          api.devices.list(),
          api.baselines.list(),
          api.fieldAlarm.getStatus().catch(() => null)
        ]);
        if (abort.signal.aborted) return;
        setStations(s);
        setDevices(d);
        setBaselines(b);
        setFieldAlarmStatus(alarm);
        setFieldAlarmOn(Boolean(alarm?.active));
        setSelectedDeviceId((prev) => {
          if (prev === CENTER_NODE_SELECTION_ID) return prev;
          if (prev && d.some((x) => x.id === prev)) return prev;
          const preferred = d.find((x) => x.status === "online") ?? d.find((x) => x.status === "warning") ?? d[0];
          return preferred?.id || "";
        });
        setLastUpdateTime(new Date().toLocaleTimeString("zh-CN"));
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = (err as Error).message;
        setLoadError(msg);
        message.error(`设备管理加载失败：${msg}（可在系统设置检查数据源与接口地址）`);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => abort.abort();
  }, [api]);

  const areas = useMemo(() => {
    const set = new Set(stations.map((s) => s.area));
    return Array.from(set).sort();
  }, [stations]);

  const stationsById = useMemo(() => new Map(stations.map((s) => [s.id, s] as const)), [stations]);
  const baselineByDeviceId = useMemo(() => new Map(baselines.map((b) => [b.deviceId, b] as const)), [baselines]);
  const deviceIdentityStats = useMemo(() => {
    const formal = devices.filter((device) => isFormalIdentityClass(device.identityClass)).length;
    return {
      total: devices.length,
      formal,
      nonFormal: Math.max(0, devices.length - formal)
    };
  }, [devices]);

  const filteredDevices = useMemo(() => {
    const regionFiltered =
      selectedRegion === "all"
        ? devices
        : devices.filter((device) => {
            const station = stationsById.get(device.stationId);
            return station?.area === selectedRegion;
          });
    if (identityFilter === "formal") {
      return regionFiltered.filter((device) => isFormalIdentityClass(device.identityClass));
    }
    if (identityFilter === "non_formal") {
      return regionFiltered.filter((device) => !isFormalIdentityClass(device.identityClass));
    }
    return regionFiltered;
  }, [devices, identityFilter, selectedRegion, stationsById]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    if (selectedDeviceId === CENTER_NODE_SELECTION_ID) return;
    if (filteredDevices.some((d) => d.id === selectedDeviceId)) return;
    const preferred = filteredDevices.find((d) => d.status === "online") ?? filteredDevices.find((d) => d.status === "warning") ?? filteredDevices[0];
    setSelectedDeviceId(preferred?.id ?? "");
  }, [filteredDevices, selectedDeviceId]);

  const selectedDevice = useMemo(() => devices.find((d) => d.id === selectedDeviceId) ?? null, [devices, selectedDeviceId]);
  const selectedStation = useMemo(
    () => (selectedDevice ? stationsById.get(selectedDevice.stationId) ?? null : null),
    [selectedDevice, stationsById]
  );
  const latestSeenDevice = useMemo(() => {
    return [...filteredDevices]
      .filter((device) => {
        const ts = new Date(device.lastSeenAt).getTime();
        return !Number.isNaN(ts);
      })
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0] ?? null;
  }, [filteredDevices]);
  const centerNodeSummary = useMemo(
    () => buildCenterNodeSummary(devices.filter((device) => isFormalIdentityClass(device.identityClass)), fieldAlarmStatus),
    [devices, fieldAlarmStatus]
  );
  const centerNodeSelected = selectedDeviceId === CENTER_NODE_SELECTION_ID;

  const refreshSelectedDeviceState = useCallback(
    async (deviceId: string) => {
      const snapshot = await api.devices.getState({ deviceId });
      setDeviceState(snapshot);
    },
    [api]
  );

  useEffect(() => {
    if (!selectedDevice) {
      setDeviceState(null);
      return;
    }
    const abort = new AbortController();
    const run = async () => {
      try {
        const snapshot = await api.devices.getState({ deviceId: selectedDevice.id });
        if (!abort.signal.aborted) setDeviceState(snapshot);
      } catch {
        if (!abort.signal.aborted) setDeviceState(null);
      }
    };
    void run();
    return () => abort.abort();
  }, [api, selectedDevice]);

  const deviceStateSummary = useMemo(() => {
    const metrics = deviceState?.metrics ?? {};
    const meta = deviceState?.meta ?? {};
    return {
      updatedAt: deviceState?.updatedAt ?? null,
      todayDataCount: readMetricNumber(meta, "todayDataCount") ?? readMetricNumber(meta, "today_data_count"),
      temperatureC: readMetricNumber(metrics, "temperature_c"),
      humidityPct: readMetricNumber(metrics, "humidity_pct"),
      batteryPct: readMetricNumber(metrics, "battery_pct"),
      tiltXDeg: readMetricNumber(metrics, "tilt_x_deg"),
      tiltYDeg: readMetricNumber(metrics, "tilt_y_deg"),
      gpsLatitude: readMetricNumber(metrics, "gps_latitude"),
      gpsLongitude: readMetricNumber(metrics, "gps_longitude"),
      warningFlag: readMetricBoolean(metrics, "warning_flag")
    };
  }, [deviceState]);

  const deviceMetrics = useMemo(() => {
    if (!selectedDevice) {
      return {
        health: 0,
        battery: 0,
        signal: 0,
        todayCount: 0,
        baselineEstablished: false,
        stateUpdatedAt: null as string | null,
        warningFlag: null as boolean | null,
        temperatureC: null as number | null,
        humidityPct: null as number | null,
        tiltXDeg: null as number | null,
        tiltYDeg: null as number | null
      };
    }
    const health = deviceExpert?.result.health?.score ?? 0;
    const battery = deviceStateSummary.batteryPct ?? deviceExpert?.result.battery?.soc ?? 0;
    const signal = deviceExpert?.result.signal?.strength ?? 0;
    const todayCount = deviceStateSummary.todayDataCount ?? 0;
    const baselineEstablished = !!baselineByDeviceId.get(selectedDevice.id);
    return {
      health,
      battery,
      signal,
      todayCount,
      baselineEstablished,
      stateUpdatedAt: deviceStateSummary.updatedAt,
      warningFlag: deviceStateSummary.warningFlag,
      temperatureC: deviceStateSummary.temperatureC,
      humidityPct: deviceStateSummary.humidityPct,
      tiltXDeg: deviceStateSummary.tiltXDeg,
      tiltYDeg: deviceStateSummary.tiltYDeg
    };
  }, [baselineByDeviceId, deviceExpert, deviceStateSummary, selectedDevice]);

  const mapOption = useMemo(() => {
    const riskColor = (risk: Station["risk"]) => {
      if (risk === "high") return "#ef4444";
      if (risk === "mid") return "#f59e0b";
      return "#22c55e";
    };

    const points = stations.map((s) => ({
      stationId: s.id,
      name: s.name,
      value: [s.lng, s.lat] as [number, number],
      risk: s.risk,
      status: s.status,
      symbolSize: selectedStation?.id && s.id === selectedStation.id ? 20 : 14,
      itemStyle: { color: riskColor(s.risk), shadowBlur: 16, shadowColor: "rgba(0,255,255,0.22)" }
    }));
    const focusStationId = selectedStation?.id;

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: {
        trigger: "item",
        formatter: (p: { data: { name: string; risk?: Station["risk"]; status?: Station["status"] } }) => {
          const risk = p.data.risk ?? "low";
          const status = p.data.status ?? "offline";
          const riskLabel = risk === "high" ? "高" : risk === "mid" ? "中" : "低";
          const statusLabel = status === "online" ? "在线" : status === "warning" ? "预警" : "离线";
          return `${p.data.name}<br/>风险：${riskLabel}<br/>状态：${statusLabel}`;
        }
      },
      grid: { left: 12, right: 12, top: 12, bottom: 12 },
      xAxis: { show: false, type: "value" },
      yAxis: { show: false, type: "value" },
      series: [
        {
          type: "scatter",
          data: points,
          symbolSize: 14,
          // Use per-point itemStyle/symbolSize to avoid callback runtime errors.
          emphasis: { scale: true }
        }
      ]
    };
  }, [selectedStation?.id, stations]);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d, b, alarm] = await Promise.all([
        api.devices.list(),
        api.baselines.list(),
        api.fieldAlarm.getStatus().catch(() => null)
      ]);
      setDevices(d);
      setBaselines(b);
      setFieldAlarmStatus(alarm);
      setFieldAlarmOn(Boolean(alarm?.active));
      if (selectedDeviceId && selectedDeviceId !== CENTER_NODE_SELECTION_ID) {
        try {
          await refreshSelectedDeviceState(selectedDeviceId);
        } catch {
          setDeviceState(null);
        }
      }
      setLastUpdateTime(new Date().toLocaleTimeString("zh-CN"));
      message.success("已刷新");
    } catch (err) {
      const msg = (err as Error).message;
      setLoadError(msg);
      message.error(`刷新失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshCommandLogs = async (deviceId: string) => {
    try {
      const commands = await api.devices.listCommands({ deviceId });
      setControlLogs(
        commands.slice(0, 12).map((command) => ({
          id: command.commandId,
          time: new Date(command.createdAt).toLocaleTimeString("zh-CN"),
          action: command.commandType,
          result: mapCommandStatus(command.status)
        }))
      );
    } catch {
      // keep current logs on failure
    }
  };

  const pushControlLog = (action: string, result: ControlLogRow["result"] = "success") => {
    const now = new Date();
    const row: ControlLogRow = {
      id: `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
      time: now.toLocaleTimeString("zh-CN"),
      action,
      result
    };
    setControlLogs((prev) => [row, ...prev].slice(0, 12));
  };

  const issueSelectedCommand = async (
    action: string,
    commandType: string,
    payload: Record<string, unknown> = {},
    overrideSuccessNotificationPolicy?: SuccessNotificationPolicy
  ) => {
    if (!selectedDevice) {
      message.info("请先选择设备");
      return;
    }
    try {
      const issued = await api.devices.issueCommand({
        deviceId: selectedDevice.id,
        commandType,
        payload,
        successNotificationPolicy: overrideSuccessNotificationPolicy ?? successNotificationPolicy
      });
      message.success(`${action} 已下发（${successNotificationPolicyLabel(issued.effectiveSuccessNotificationPolicy)}）`);
      pushControlLog(
        `${action} -> ${selectedDevice.name}（${selectedDevice.id.slice(-4)} / ${issued.commandId.slice(0, 8)}）`,
        issued.status === "queued" ? "pending" : "success"
      );
      await refreshCommandLogs(selectedDevice.id);
    } catch (err) {
      message.error((err as Error).message);
      pushControlLog(action, "failed");
    }
  };

  const issueFieldAlarmAction = async (actionName: string, action: "alarm_on" | "alarm_off" | "silence") => {
    try {
      const result = await api.fieldAlarm.sendAction({
        action,
        reason: `${actionName}：${centerNodeSummary?.displayName ?? "RK3568 中心节点"}${
          centerNodeSummary?.gatewayCode ? ` / ${centerNodeSummary.gatewayCode}` : ""
        }`
      });
      const stateText = result.actuator.dryRun ? "演示模式" : result.actuator.available ? "已转发至 RK3568" : "执行器未连接";
      if (result.accepted) {
        message.success(`${actionName} 已下发（${stateText}）`);
      } else {
        message.error(`${actionName} 未被现场执行器确认（${result.actuator.lastError ?? stateText}）`);
      }
      setFieldAlarmOn(action === "alarm_on" && result.accepted);
      setFieldAlarmStatus((prev) => ({
        active: action === "alarm_on" && result.accepted,
        silenced: action !== "alarm_on" && result.accepted,
        state: action === "alarm_on" && result.accepted ? "active" : action !== "alarm_on" && result.accepted ? "under_review" : "normal",
        activeCount: action === "alarm_on" && result.accepted ? 1 : 0,
        ackedCount: action !== "alarm_on" && result.accepted ? 1 : 0,
        latestAlert: prev?.latestAlert ?? null,
        alerts: prev?.alerts ?? [],
        actuator: result.actuator
      }));
      pushControlLog(
        `${actionName} -> ${centerNodeSummary?.displayName ?? "RK3568 中心节点声光报警器"}`,
        result.accepted ? "success" : "failed"
      );
    } catch (err) {
      message.error((err as Error).message);
      pushControlLog(actionName, "failed");
    }
  };

  useEffect(() => {
    if (!selectedDeviceId || selectedDeviceId === CENTER_NODE_SELECTION_ID) {
      setControlLogs([]);
      return;
    }
    void refreshCommandLogs(selectedDeviceId);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId || selectedDeviceId === CENTER_NODE_SELECTION_ID) return;

    const timer = window.setInterval(() => {
      void api.devices
        .listCommands({ deviceId: selectedDeviceId })
        .then((commands) => {
          setControlLogs(
            commands.slice(0, 12).map((command) => ({
              id: command.commandId,
              time: new Date(command.createdAt).toLocaleTimeString("zh-CN"),
              action: command.commandType,
              result: mapCommandStatus(command.status)
            }))
          );
        })
        .catch(() => {
          // Keep the last known command history if the network briefly drops.
        });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [api, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDevice) {
      setDeviceExpert(null);
      return;
    }
    const abort = new AbortController();
    const run = async () => {
      try {
        const expert = await api.devices.getHealthExpert({ deviceId: selectedDevice.id, metric: "all" });
        if (!abort.signal.aborted) setDeviceExpert(expert);
      } catch {
        if (!abort.signal.aborted) setDeviceExpert(null);
      }
    };
    void run();
    return () => abort.abort();
  }, [api, selectedDevice]);

  useEffect(() => {
    if (!selectedDevice) {
      setSensorRows([]);
      return;
    }
    const abort = new AbortController();
    const run = async () => {
      try {
        const endTime = new Date().toISOString();
        const start = new Date();
        start.setHours(start.getHours() - 24);
        const startTime = start.toISOString();

        const [temperature, humidity, rain, gps] = await Promise.all([
          api.telemetry.getSeries({ deviceId: selectedDevice.id, sensorKey: "temperature_c", startTime, endTime, interval: "1h" }),
          api.telemetry.getSeries({ deviceId: selectedDevice.id, sensorKey: "humidity_pct", startTime, endTime, interval: "1h" }),
          api.telemetry.getSeries({ deviceId: selectedDevice.id, sensorKey: "rainfall_mm", startTime, endTime, interval: "1h" }),
          baselineByDeviceId.get(selectedDevice.id)
            ? api.gps.getSeries({ deviceId: selectedDevice.id, days: 7 })
            : Promise.resolve(null)
        ]);
        if (abort.signal.aborted) return;

        const rows = new Map<string, SensorRow>();
        const upsert = (ts: string) => {
          const existing = rows.get(ts);
          if (existing) return existing;
          const created: SensorRow = {
            id: ts,
            time: new Date(ts).toLocaleTimeString("zh-CN"),
            temperature: 0,
            humidity: 0,
            dispMm: 0,
            rainMm: 0
          };
          rows.set(ts, created);
          return created;
        };

        for (const point of temperature) {
          upsert(point.ts).temperature = Number(point.value.toFixed(1));
        }
        for (const point of humidity) {
          upsert(point.ts).humidity = Number(point.value.toFixed(0));
        }
        for (const point of rain) {
          upsert(point.ts).rainMm = Number(point.value.toFixed(0));
        }
        for (const point of gps?.points ?? []) {
          upsert(point.ts).dispMm = Number(point.dispMm.toFixed(2));
        }

        const ordered = Array.from(rows.values())
          .sort((a, b) => new Date(a.id).getTime() - new Date(b.id).getTime())
          .slice(-10);
        setSensorRows(ordered);
      } catch {
        if (!abort.signal.aborted) setSensorRows([]);
      }
    };
    void run();
    return () => abort.abort();
  }, [api, baselineByDeviceId, selectedDevice]);

  const showDiagnostics = () => {
    if (!selectedDevice) {
      message.info("请先选择设备");
      return;
    }

    void api.devices
      .getHealthExpert({ deviceId: selectedDevice.id, metric: "all" })
      .then((expert) => {
        const health = expert.result.health;
        const battery = expert.result.battery;
        const signal = expert.result.signal;
        const overallLevel = health?.level ?? "bad";
        const overallLabel = overallLevel === "good" ? "健康" : overallLevel === "warn" ? "需要关注" : "异常";
        const overallColor = overallLevel === "good" ? "#22c55e" : overallLevel === "warn" ? "#f59e0b" : "#ef4444";

        modal.info({
          title: (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ToolOutlined style={{ color: "rgba(34,211,238,0.95)" }} />
              <span>设备诊断结果 - {selectedDevice.name}</span>
            </div>
          ),
          width: 640,
          okText: "确定",
          content: (
            <div style={{ marginTop: 12, color: "rgba(226,232,240,0.92)" }}>
              <div
                style={{
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(2,6,23,0.28)",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span style={{ color: "rgba(148,163,184,0.9)" }}>整体状态</span>
                <span style={{ color: overallColor, fontWeight: 800 }}>{overallLabel}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>健康评分</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{health?.score ?? 0}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>基线状态</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: deviceMetrics.baselineEstablished ? "#22c55e" : "#f59e0b" }}>
                    {deviceMetrics.baselineEstablished ? "已建立" : "待建立"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>电池电量</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{battery?.soc ?? 0}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>信号强度</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{signal?.strength ?? 0}%</div>
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 12, color: "rgba(148,163,184,0.9)" }}>
                诊断时间：{new Date(expert.result.metadata.calculationTime).toLocaleString("zh-CN")}
              </div>
            </div>
          )
        });
      })
      .catch((err: unknown) => {
        message.error((err as Error).message);
      });
  };

  const exportItems: MenuProps["items"] = [
    { key: "devices", label: "导出设备列表" },
    { key: "sensor", label: "导出传感器数据" },
    { key: "baselines", label: "导出基线信息" }
  ];

  const onExportClick: MenuProps["onClick"] = ({ key }) => {
    try {
      if (key === "devices") {
        triggerPreparedExport(buildDevicesExport(filteredDevices));
        message.success("已导出设备列表");
      }
      if (key === "sensor") {
        triggerPreparedExport(buildSensorExport(sensorRows));
        message.success("已导出传感器数据");
      }
      if (key === "baselines") {
        triggerPreparedExport(buildBaselinesExport(baselines));
        message.success("已导出基线信息");
      }
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <div className="desk-page desk-dm-page">
      <DeviceManagementWorkspaceHeader
        title="设备管理中心"
        subtitle="Device Management Center"
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
            <Dropdown menu={{ items: exportItems, onClick: onExportClick }}>
              <Button size="small" icon={<ExportOutlined />}>
                导出
              </Button>
            </Dropdown>
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

      <DeviceManagementSectionNav active={activeTab} />

      {loadError ? (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type="error"
            showIcon
            message="页面数据加载失败"
            description={
              <div style={{ color: "rgba(226,232,240,0.9)" }}>
                <div style={{ marginBottom: 6 }}>{loadError}</div>
                <div style={{ color: "rgba(148,163,184,0.9)" }}>可在「系统设置」检查当前数据源与接口地址。</div>
              </div>
            }
          />
        </div>
      ) : null}

      {activeTab === "status" ? (
        <div className="desk-dm-content">
          <div className="desk-dm-grid-top">
            <BaseCard title="设备选择" className="desk-dm-panel">
              <div className="desk-dm-muted">
                总计: {deviceIdentityStats.total + (centerNodeSummary ? 1 : 0)} 台 | 中心节点:{" "}
                {centerNodeSummary?.status === "online" ? 1 : 0}/{centerNodeSummary ? 1 : 0} 台 | 分节点设备: {deviceIdentityStats.formal} 台 | 未归档:{" "}
                {deviceIdentityStats.nonFormal} 台
              </div>
              <div className="desk-dm-muted" style={{ marginTop: 4 }}>
                当前筛选结果: {filteredDevices.length} 台
              </div>
              <div style={{ height: 10 }} />
              <div className="desk-dm-field">
                <div className="desk-dm-label">监测区域</div>
                <Select
                  size="small"
                  value={selectedRegion}
                  style={{ width: "100%" }}
                  onChange={(v) => setSelectedRegion(v)}
                  options={[
                    { label: `全部区域`, value: "all" },
                    ...areas.map((a) => ({ label: `${a}（${stations.filter((s) => s.area === a).length}）`, value: a }))
                  ]}
                />
              </div>

              <div className="desk-dm-field">
                <div className="desk-dm-label">数据范围</div>
                <Select
                  size="small"
                  value={identityFilter}
                  style={{ width: "100%" }}
                  onChange={(value) => setIdentityFilter(value)}
                  options={[
                    { label: `全部设备（${deviceIdentityStats.total}）`, value: "all" },
                    { label: `当前设备（${deviceIdentityStats.formal}）`, value: "formal" },
                    { label: `未归档（${deviceIdentityStats.nonFormal}）`, value: "non_formal" }
                  ]}
                />
              </div>

              <div className="desk-dm-field">
                <div className="desk-dm-label">监测设备</div>
                {centerNodeSummary ? (
                  <button
                    type="button"
                    className={`desk-dm-center-node ${centerNodeSelected ? "active" : ""}`}
                    aria-label="RK3568 中心节点运行态"
                    onClick={() => {
                      setSelectedDeviceId(CENTER_NODE_SELECTION_ID);
                    }}
                  >
                    <span className="desk-dm-dot" style={{ backgroundColor: statusDotColor(centerNodeSummary.status) }} />
                    <span className="desk-dm-devmeta">
                      <span className="desk-dm-devname">{centerNodeSummary.displayName}</span>
                      <span className="desk-dm-devsub">
                        {[
                          centerNodeSummary.gatewayCode,
                          centerNodeSummary.regionCode,
                          formatDeviceRoleDisplay(centerNodeSummary.role)
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" · ")}
                      </span>
                      <span className="desk-dm-devsub">{centerNodeSummary.detail}</span>
                    </span>
                    <span className="desk-dm-devstatus">
                      <StatusTag value={centerNodeSummary.status} />
                      {centerNodeSummary.dryRun ? <Tag color="gold">Mock</Tag> : <Tag color="cyan">中心节点</Tag>}
                    </span>
                  </button>
                ) : null}
                <div className="desk-dm-devlist">
                  {filteredDevices.length ? (
                    filteredDevices.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`desk-dm-devitem ${d.id === selectedDeviceId ? "active" : ""}`}
                        onClick={() => setSelectedDeviceId(d.id)}
                      >
                        <span className="desk-dm-dot" style={{ backgroundColor: statusDotColor(d.status) }} />
                          <span className="desk-dm-devmeta">
                          <span className="desk-dm-devname">{d.name}</span>
                          <span className="desk-dm-devsub">
                            {d.installLabel ? formatInstallLabelDisplay(d.installLabel) : d.stationCode ?? d.stationName}
                          </span>
                        </span>
                        <span className="desk-dm-devstatus">
                          <StatusTag value={d.status} />
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="desk-dm-empty">
                      {identityFilter === "formal"
                        ? "当前没有设备接入，未归档数据不会进入当前视图。"
                        : "当前筛选条件下没有设备"}
                    </div>
                  )}
                </div>
              </div>
            </BaseCard>

            <BaseCard title="设备状态概览" className="desk-dm-panel desk-dm-panel-overview">
              {centerNodeSelected && centerNodeSummary ? (
                <>
                  <div className="desk-dm-overview-head">
                    <div>
                      <div className="desk-dm-overview-title">{centerNodeSummary.displayName}</div>
                      <div className="desk-dm-muted">
                        {[
                          centerNodeSummary.gatewayCode,
                          centerNodeSummary.regionCode,
                          "中心节点 / RK3568"
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" · ")}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <Tag className="desk-pill-tag">中心网关</Tag>
                      <Tag color={centerNodeSummary.available ? "green" : "orange"}>
                        {centerNodeSummary.available ? "执行器已连接" : "执行器待确认"}
                      </Tag>
                      <StatusTag value={centerNodeSummary.status} />
                    </div>
                  </div>

                  <div className="desk-dm-overview-grid">
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">在线状态</div>
                      <div className="desk-dm-metric-value">{centerNodeSummary.status === "online" ? "在线" : centerNodeSummary.status === "warning" ? "待确认" : "离线"}</div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">执行器</div>
                      <div className="desk-dm-metric-value" style={{ color: centerNodeSummary.available ? "#22c55e" : "#f59e0b" }}>
                        {centerNodeSummary.available ? "已连接" : "待确认"}
                      </div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">声光状态</div>
                      <div className="desk-dm-metric-value" style={{ color: fieldAlarmStatus?.active ? "#ef4444" : "#22c55e" }}>
                        {fieldAlarmStatus?.active ? "报警中" : fieldAlarmStatus?.silenced ? "已停止" : "待命"}
                      </div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">最近动作</div>
                      <div className="desk-dm-metric-value" style={{ fontSize: 12, fontWeight: 600 }}>
                        {centerNodeSummary.lastActionAt ? new Date(centerNodeSummary.lastActionAt).toLocaleString("zh-CN") : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="desk-dm-canonical-grid">
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">网关编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(centerNodeSummary.gatewayCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">区域编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(centerNodeSummary.regionCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">设备角色</div>
                      <div className="desk-dm-canonical-v">{formatDeviceRoleDisplay(centerNodeSummary.role)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">执行模式</div>
                      <div className="desk-dm-canonical-v">{centerNodeSummary.dryRun ? "Mock 演示" : "真实执行"}</div>
                    </div>
                  </div>

                  <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                    中心节点展示 RK3568 网关和 YX75R 声光报警执行链；A/B/C 分节点仍然用于传感器遥测、采样和设备命令。
                  </div>
                  <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                    执行链路: {centerNodeSummary.detail}
                  </div>
                  {fieldAlarmStatus?.active ? (
                    <Alert
                      type="error"
                      showIcon
                      message="中心节点声光报警正在动作，请结合现场情况人工复核。"
                      style={{ marginTop: 12 }}
                    />
                  ) : null}
                </>
              ) : selectedDevice ? (
                <>
                  <div className="desk-dm-overview-head">
                    <div>
                      <div className="desk-dm-overview-title">{selectedDevice.name}</div>
                      <div className="desk-dm-muted">
                        {[
                          selectedDevice.stationName,
                          selectedStation?.area ?? null,
                          selectedDevice.installLabel ? formatInstallLabelDisplay(selectedDevice.installLabel) : selectedDevice.id
                        ]
                          .filter((value): value is string => Boolean(value))
                          .join(" · ")}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <Tag className="desk-pill-tag">{deviceTypeLabel(selectedDevice)}</Tag>
                      {selectedStation?.area ? <Tag color="blue">{selectedStation.area}</Tag> : null}
                      {selectedDevice.stationCode ? <Tag color="cyan">站点编码 {selectedDevice.stationCode}</Tag> : null}
                      <StatusTag value={selectedDevice.status} />
                    </div>
                  </div>

                  <div className="desk-dm-overview-grid">
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">在线状态</div>
                      <div className="desk-dm-metric-value">{selectedDevice.status === "online" ? "在线" : selectedDevice.status === "warning" ? "预警" : "离线"}</div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">基线状态</div>
                      <div className="desk-dm-metric-value" style={{ color: deviceMetrics.baselineEstablished ? "#22c55e" : "#f59e0b" }}>
                        {deviceMetrics.baselineEstablished ? "已建立" : "待建立"}
                      </div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">今日数据</div>
                      <div className="desk-dm-metric-value">{deviceMetrics.todayCount} 条</div>
                    </div>
                    <div className="desk-dm-metric">
                      <div className="desk-dm-metric-label">最后上报</div>
                      <div className="desk-dm-metric-value" style={{ fontSize: 12, fontWeight: 600 }}>
                        {new Date(deviceMetrics.stateUpdatedAt ?? selectedDevice.lastSeenAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  </div>

                  <div className="desk-dm-bars">
                    <div className="desk-dm-bar">
                      <div className="desk-dm-bar-label">健康度</div>
                      <Progress percent={deviceMetrics.health} showInfo={false} strokeColor={progressColor(deviceMetrics.health)} />
                      <div className="desk-dm-bar-value">{deviceMetrics.health}%</div>
                    </div>
                    <div className="desk-dm-bar">
                      <div className="desk-dm-bar-label">电池电量</div>
                      <Progress percent={deviceMetrics.battery} showInfo={false} strokeColor={progressColor(deviceMetrics.battery)} />
                      <div className="desk-dm-bar-value">{deviceMetrics.battery}%</div>
                    </div>
                    <div className="desk-dm-bar">
                      <div className="desk-dm-bar-label">信号强度</div>
                      <Progress percent={deviceMetrics.signal} showInfo={false} strokeColor={progressColor(deviceMetrics.signal)} />
                      <div className="desk-dm-bar-value">{deviceMetrics.signal}%</div>
                    </div>
                  </div>

                  <div className="desk-dm-canonical-grid">
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">站点编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(selectedDevice.stationCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">区域编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(selectedDevice.regionCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">边坡编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(selectedDevice.slopeCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">节点编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(selectedDevice.nodeCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">网关编码</div>
                      <div className="desk-dm-canonical-v">{canonicalText(selectedDevice.gatewayCode)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">安装标识</div>
                      <div className="desk-dm-canonical-v">{formatInstallLabelDisplay(selectedDevice.installLabel)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">生命周期状态</div>
                      <div className="desk-dm-canonical-v">{formatLifecycleStatusDisplay(selectedDevice.lifecycleStatus)}</div>
                    </div>
                    <div className="desk-dm-canonical-item">
                      <div className="desk-dm-canonical-k">接入控制</div>
                      <div className="desk-dm-canonical-v">
                        {formatRegistryStatusDisplay(selectedDevice.registryStatus)}
                      </div>
                    </div>
                  </div>

                  <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                    站点风险: {selectedStation ? <RiskTag value={selectedStation.risk} /> : "--"}
                  </div>
                  <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                    状态语义: 在线状态看最近上报，生命周期看业务投运阶段，接入控制看是否允许直连或已停用。
                    {selectedDevice.registryStatus
                      ? ` 当前设备${formatRegistryStatusHint(selectedDevice.registryStatus)}`
                      : ""}
                  </div>
                  <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                    状态快照: 温度 {formatMetricNumber(deviceMetrics.temperatureC)}°C · 湿度 {formatMetricNumber(deviceMetrics.humidityPct, 0)}% · 倾角 X/Y{" "}
                    {formatMetricNumber(deviceMetrics.tiltXDeg, 2)}/{formatMetricNumber(deviceMetrics.tiltYDeg, 2)}°
                  </div>
                  {deviceMetrics.warningFlag ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="设备已触发预警，请结合现场姿态与电量继续观察。"
                      style={{ marginTop: 12 }}
                    />
                  ) : null}
                </>
              ) : (
                <div className="desk-dm-empty">请选择设备</div>
              )}
            </BaseCard>

            <BaseCard title="快速操作" className="desk-dm-panel">
              <Space direction="vertical" style={{ width: "100%" }} size={10}>
                <Button
                  type="primary"
                  block
                  loading={loading}
                  onClick={() => {
                    void refresh();
                  }}
                >
                  刷新数据
                </Button>
                <Button
                  block
                  onClick={() => {
                    showDiagnostics();
                  }}
                >
                  设备诊断
                </Button>
                <Button
                  block
                  onClick={() => {
                    setDetailOpen(true);
                  }}
                >
                  详细信息
                </Button>
                <div className="desk-dm-quick-alarm">
                  <div className="desk-dm-ctrl-title">RK3568 声光报警测试</div>
                  <div className="desk-dm-quick-target">
                    <span>目标：</span>
                    <strong>{centerNodeSummary?.displayName ?? "RK3568 中心节点声光报警器"}</strong>
                    <span>
                      {[
                        centerNodeSummary?.gatewayCode,
                        centerNodeSummary ? formatDeviceRoleDisplay(centerNodeSummary.role) : null,
                        centerNodeSummary?.available ? "执行器已连接" : "执行器待确认"
                      ]
                        .filter((value): value is string => Boolean(value))
                        .join(" · ")}
                    </span>
                    {centerNodeSummary?.lastActionAt ? (
                      <span>最近动作 {new Date(centerNodeSummary.lastActionAt).toLocaleString("zh-CN")}</span>
                    ) : null}
                  </div>
                  <div className="desk-dm-quick-alarm-row">
                    <Button
                      size="small"
                      danger
                      type="primary"
                      onClick={() => {
                        void issueFieldAlarmAction("启动声光报警", "alarm_on");
                      }}
                    >
                      启动声光
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        void issueFieldAlarmAction("停止声光报警", "alarm_off");
                      }}
                    >
                      停止声光
                    </Button>
                    <Tag color={fieldAlarmOn ? "red" : "default"}>{fieldAlarmOn ? "已下发启动" : "待测试"}</Tag>
                  </div>
                  <Button
                    size="small"
                    block
                    disabled={!latestSeenDevice || latestSeenDevice.id === selectedDevice?.id}
                    onClick={() => {
                      if (!latestSeenDevice) return;
                      setSelectedDeviceId(latestSeenDevice.id);
                      void refreshCommandLogs(latestSeenDevice.id);
                      message.info(`已切到最近上报节点：${latestSeenDevice.name} / ${latestSeenDevice.id.slice(-4)}`);
                    }}
                  >
                    切到最近上报节点
                  </Button>
                </div>
                <Button
                  block
                  onClick={() => {
                    void issueSelectedCommand("远程重启", "restart_device", { source: "desk-device-management" });
                  }}
                >
                  远程重启
                </Button>
                <Button
                  danger
                  block
                  onClick={() => {
                    void issueSelectedCommand("下线设备", "deactivate_device", { source: "desk-device-management" });
                  }}
                >
                  下线设备
                </Button>
              </Space>
            </BaseCard>
          </div>

          <div className="desk-dm-grid-mid">
            <BaseCard title="设备总览">
              <div className="desk-dm-muted" style={{ marginBottom: 10 }}>
                当前页面优先展示当前设备的业务编码字段；未归档数据只在专门筛选时显示。
              </div>
              <div className="desk-dark-table desk-dm-table-wrap">
                <Table<Device>
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                  scroll={{ x: 1480 }}
                  dataSource={filteredDevices}
                  rowClassName={(row) => (row.id === selectedDeviceId ? "desk-dm-selected-row" : "")}
                  onRow={(row) => ({
                    onClick: () => setSelectedDeviceId(row.id)
                  })}
                  columns={[
                    {
                      title: "设备",
                      key: "device",
                      width: 280,
                      render: (_value: unknown, row) => (
                        <div>
                          <div style={{ fontWeight: 900, color: "rgba(226,232,240,0.96)" }}>{row.name}</div>
                          <div className="desk-dm-muted" style={{ marginTop: 2 }}>
                            {row.deviceName ?? row.id}
                          </div>
                          <div className="desk-dm-muted" style={{ marginTop: 2 }}>
                            {row.installLabel ? formatInstallLabelDisplay(row.installLabel) : row.id}
                          </div>
                        </div>
                      )
                    },
                    {
                      title: "站点编码",
                      dataIndex: "stationCode",
                      width: 170,
                      render: (value: string | null | undefined) => canonicalText(value)
                    },
                    {
                      title: "区域编码",
                      dataIndex: "regionCode",
                      width: 150,
                      render: (value: string | null | undefined) => canonicalText(value)
                    },
                    {
                      title: "边坡编码",
                      dataIndex: "slopeCode",
                      width: 180,
                      render: (value: string | null | undefined) => canonicalText(value)
                    },
                    {
                      title: "节点编码",
                      dataIndex: "nodeCode",
                      width: 210,
                      render: (value: string | null | undefined) => canonicalText(value)
                    },
                    {
                      title: "网关编码",
                      dataIndex: "gatewayCode",
                      width: 190,
                      render: (value: string | null | undefined) => canonicalText(value)
                    },
                    {
                      title: "状态",
                      dataIndex: "status",
                      width: 90,
                      render: (value: Device["status"]) => <StatusTag value={value} />
                    }
                  ]}
                />
              </div>
            </BaseCard>
          </div>

          <div className="desk-dm-grid-bottom">
            <div className="desk-dm-stack">
              <div className="desk-dm-stack-item">
                <BaseCard
                  className="desk-dm-stack-card"
                  title={
                    <div className="desk-dm-card-titleblock">
                      <div className="desk-dm-card-title">设备控制</div>
                      <div className="desk-dm-card-subtitle">
                        {selectedDevice
                          ? `${selectedDevice.name}${selectedDevice.installLabel ? ` · ${formatInstallLabelDisplay(selectedDevice.installLabel)}` : ""}`
                          : "未选择设备"}
                      </div>
                    </div>
                  }
                >
                  <div className="desk-dm-ctrl">
                    <div className="desk-dm-ctrl-section">
                      <div className="desk-dm-ctrl-title">电机控制</div>
                      <div className="desk-dm-ctrl-row">
                        <Button
                          size="small"
                          type="primary"
                          disabled={!selectedDevice}
                          onClick={() => {
                            setMotorRunning(true);
                            void issueSelectedCommand("启动电机", "motor_start", { source: "desk-device-management" });
                          }}
                        >
                          启动
                        </Button>
                        <Button
                          size="small"
                          danger
                          disabled={!selectedDevice}
                          onClick={() => {
                            setMotorRunning(false);
                            void issueSelectedCommand("停止电机", "motor_stop", { source: "desk-device-management" });
                          }}
                        >
                          停止
                        </Button>
                        <Tag color={motorRunning ? "green" : "default"}>{motorRunning ? "运行中" : "已停止"}</Tag>
                      </div>
                    </div>

                    <div className="desk-dm-ctrl-section desk-dm-alarm-section">
                      <div className="desk-dm-ctrl-title">RK3568 声光报警器</div>
                      <div className="desk-dm-ctrl-row">
                        <Button
                          size="small"
                          danger
                          type="primary"
                          disabled={fieldAlarmOn}
                          onClick={() => {
                            void issueFieldAlarmAction("启动声光报警", "alarm_on");
                          }}
                        >
                          启动报警
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            void issueFieldAlarmAction("停止声光报警", "alarm_off");
                          }}
                        >
                          停止报警
                        </Button>
                        <Tag color={fieldAlarmOn ? "red" : "default"}>{fieldAlarmOn ? "报警已启动" : "报警未启动"}</Tag>
                      </div>
                    </div>

                    <div className="desk-dm-ctrl-section">
                      <div className="desk-dm-ctrl-title">采样间隔</div>
                      <div className="desk-dm-ctrl-row">
                        <Select
                          size="small"
                          value={samplingInterval}
                          style={{ width: 140 }}
                          disabled={!selectedDevice}
                          onChange={(v) => {
                            setSamplingInterval(v);
                            void issueSelectedCommand(`设置采样间隔 ${v}s`, "set_sampling_interval", {
                              source: "desk-device-management",
                              intervalSeconds: v
                            });
                          }}
                          options={[
                            { label: "1s", value: 1 },
                            { label: "5s", value: 5 },
                            { label: "10s", value: 10 },
                            { label: "30s", value: 30 },
                            { label: "60s", value: 60 }
                          ]}
                        />
                        <Button
                          size="small"
                          disabled={!selectedDevice}
                          onClick={() => {
                            void issueSelectedCommand("手动采集一次", "manual_collect", { source: "desk-device-management" });
                          }}
                        >
                          手动采集
                        </Button>
                      </div>
                    </div>

                    <div className="desk-dm-ctrl-section">
                      <div className="desk-dm-ctrl-title">成功回执通知</div>
                      <div className="desk-dm-ctrl-row">
                        <Select
                          size="small"
                          value={successNotificationPolicy}
                          style={{ width: 160 }}
                          onChange={(value) => setSuccessNotificationPolicy(value)}
                          options={[
                            { label: "继承默认", value: "inherit" },
                            { label: "静默", value: "silent" },
                            { label: "始终通知", value: "always_notify" }
                          ]}
                        />
                        <span className="desk-dm-muted">{successNotificationPolicyLabel(successNotificationPolicy)}</span>
                      </div>
                    </div>

                    <div className="desk-dm-ctrl-section desk-dm-ctrl-section-history">
                      <div className="desk-dm-ctrl-title">控制历史</div>
                      <div className="desk-dark-table desk-dm-history-table">
                        <table className="desk-table">
                          <thead>
                            <tr>
                              <th style={{ width: 92 }}>时间</th>
                              <th>动作</th>
                              <th style={{ width: 90 }}>结果</th>
                            </tr>
                          </thead>
                          <tbody>
                            {controlLogs.length ? (
                              controlLogs.map((row) => (
                                <tr key={row.id}>
                                  <td>{row.time}</td>
                                  <td>{row.action}</td>
                                  <td>
                                    <Tag
                                      color={row.result === "success" ? "green" : row.result === "pending" ? "gold" : "red"}
                                      style={{ marginInlineEnd: 0 }}
                                    >
                                      {row.result === "success" ? "成功" : row.result === "pending" ? "执行中" : "失败"}
                                    </Tag>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={3} style={{ color: "rgba(148,163,184,0.9)" }}>
                                  暂无控制记录
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </BaseCard>
              </div>

              <div className="desk-dm-stack-item">
                <BaseCard title="实时传感器数据" className="desk-dm-stack-card">
                  <div className="desk-dm-muted" style={{ marginBottom: 10 }}>
                    当前快照：电池 {formatMetricNumber(deviceStateSummary.batteryPct, 0)}% · 定位{" "}
                    {formatMetricNumber(deviceStateSummary.gpsLatitude, 6)}, {formatMetricNumber(deviceStateSummary.gpsLongitude, 6)} · 更新时间{" "}
                    {deviceStateSummary.updatedAt ? new Date(deviceStateSummary.updatedAt).toLocaleString("zh-CN") : "--"}
                  </div>
                  <div className="desk-dark-table" style={{ height: "100%", overflow: "auto" }}>
                    <table className="desk-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>温度（°C）</th>
                          <th>湿度（%）</th>
                          <th>位移（mm）</th>
                          <th>雨量（mm）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sensorRows.length ? (
                          sensorRows.map((r) => (
                            <tr key={r.id}>
                              <td>{r.time}</td>
                              <td>{r.temperature}</td>
                              <td>{r.humidity}</td>
                              <td>{r.dispMm}</td>
                              <td>{r.rainMm}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} style={{ color: "rgba(148,163,184,0.9)" }}>
                              暂无趋势数据，当前页面已切到状态快照主读路径。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </BaseCard>
              </div>
            </div>

            <BaseCard title="设备位置地图">
              <div style={{ height: "100%" }}>
                <ReactECharts option={mapOption} style={{ height: "100%" }} />
              </div>
            </BaseCard>
          </div>
        </div>
      ) : null}

      {activeTab === "management" ? (
        <div className="desk-dm-content">
          <StationManagementPanel style={{ height: "calc(100vh - 216px)" }} initialStationId={queryStationId} />
        </div>
      ) : null}

      {activeTab === "baselines" ? (
        <div className="desk-dm-content">
          <BaselinesPanel style={{ height: "calc(100vh - 216px)" }} />
        </div>
      ) : null}

      {loading ? (
        <div className="desk-dm-loading">
          <Typography.Text type="secondary">加载中…</Typography.Text>
        </div>
      ) : null}

      <Modal
        title="设备详细信息"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={
          <Space>
            <Button
              onClick={() => {
                setDetailOpen(false);
              }}
            >
              关闭
            </Button>
            <Button
              type="primary"
              onClick={() => {
                const text =
                  centerNodeSelected && centerNodeSummary
                    ? buildCenterNodeDetailText(centerNodeSummary, fieldAlarmStatus)
                    : selectedDevice
                      ? buildDeviceDetailText({
                          device: selectedDevice,
                          station: selectedStation,
                          metrics: deviceMetrics
                        })
                      : "";
                if (!text) return;
                void copyTextContent(text)
                  .then(() => {
                    message.success("已复制设备信息");
                  })
                  .catch((err: unknown) => {
                    message.error((err as Error).message);
                  });
              }}
            >
              复制信息
            </Button>
          </Space>
        }
        width={860}
      >
        {centerNodeSelected && centerNodeSummary ? (
          <div className="desk-dm-detail">
            <div className="desk-dm-detail-grid">
              <div className="desk-dm-detail-card">
                <div className="desk-dm-detail-title">中心节点信息</div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">节点名称</span>
                  <span className="desk-dm-detail-v">{centerNodeSummary.displayName}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">设备角色</span>
                  <span className="desk-dm-detail-v">{formatDeviceRoleDisplay(centerNodeSummary.role)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">网关编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(centerNodeSummary.gatewayCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">区域编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(centerNodeSummary.regionCode)}</span>
                </div>
              </div>

              <div className="desk-dm-detail-card">
                <div className="desk-dm-detail-title">执行链路</div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">在线状态</span>
                  <span className="desk-dm-detail-v">{centerNodeSummary.status === "online" ? "在线" : centerNodeSummary.status === "warning" ? "待确认" : "离线"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">执行器</span>
                  <span className="desk-dm-detail-v">{centerNodeSummary.available ? "已连接" : "待确认"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">执行模式</span>
                  <span className="desk-dm-detail-v">{centerNodeSummary.dryRun ? "Mock 演示" : "真实执行"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">声光状态</span>
                  <span className="desk-dm-detail-v">{fieldAlarmStatus?.active ? "报警中" : fieldAlarmStatus?.silenced ? "已停止" : "待命"}</span>
                </div>
              </div>
            </div>

            <div className="desk-dm-detail-card" style={{ marginTop: 12 }}>
              <div className="desk-dm-detail-title">链路说明</div>
              <div className="desk-dm-detail-item">
                <span className="desk-dm-detail-k">最近动作</span>
                <span className="desk-dm-detail-v">
                  {centerNodeSummary.lastActionAt ? new Date(centerNodeSummary.lastActionAt).toLocaleString("zh-CN") : "-"}
                </span>
              </div>
              <div className="desk-dm-detail-item">
                <span className="desk-dm-detail-k">链路详情</span>
                <span className="desk-dm-detail-v">{centerNodeSummary.detail}</span>
              </div>
              <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                该视图表示 RK3568 中心节点和 YX75R 声光报警执行链，不参与分节点采样、电机、重启等 RK2206 指令。
              </div>
            </div>
          </div>
        ) : selectedDevice ? (
          <div className="desk-dm-detail">
            <div className="desk-dm-detail-grid">
              <div className="desk-dm-detail-card">
                <div className="desk-dm-detail-title">基本信息</div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">设备名称</span>
                  <span className="desk-dm-detail-v">{selectedDevice.name}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">原始设备名</span>
                  <span className="desk-dm-detail-v">{selectedDevice.deviceName ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">设备类型</span>
                  <span className="desk-dm-detail-v">{deviceTypeLabel(selectedDevice)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">所属站点</span>
                  <span className="desk-dm-detail-v">{selectedDevice.stationName}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">安装标识</span>
                  <span className="desk-dm-detail-v">{formatInstallLabelDisplay(selectedDevice.installLabel)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">最后上报</span>
                  <span className="desk-dm-detail-v">{new Date(deviceMetrics.stateUpdatedAt ?? selectedDevice.lastSeenAt).toLocaleString("zh-CN")}</span>
                </div>
              </div>

              <div className="desk-dm-detail-card">
                <div className="desk-dm-detail-title">运行指标</div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">健康度</span>
                  <span className="desk-dm-detail-v">{deviceMetrics.health}%</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">电池电量</span>
                  <span className="desk-dm-detail-v">{deviceMetrics.battery}%</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">信号强度</span>
                  <span className="desk-dm-detail-v">{deviceMetrics.signal}%</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">基线状态</span>
                  <span className="desk-dm-detail-v">{deviceMetrics.baselineEstablished ? "已建立" : "待建立"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">预警状态</span>
                  <span className="desk-dm-detail-v">{formatWarningFlagDisplay(deviceMetrics.warningFlag, "-")}</span>
                </div>
              </div>

              <div className="desk-dm-detail-card">
                <div className="desk-dm-detail-title">编码与标识</div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">历史设备 ID</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.legacyDeviceId)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">站点编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.stationCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">区域编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.regionCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">边坡编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.slopeCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">节点编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.nodeCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">网关编码</span>
                  <span className="desk-dm-detail-v">{canonicalText(selectedDevice.gatewayCode)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">设备角色</span>
                  <span className="desk-dm-detail-v">{formatDeviceRoleDisplay(selectedDevice.deviceRole)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">生命周期状态</span>
                  <span className="desk-dm-detail-v">{formatLifecycleStatusDisplay(selectedDevice.lifecycleStatus)}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">接入控制</span>
                  <span className="desk-dm-detail-v">
                    {formatRegistryStatusDisplay(selectedDevice.registryStatus)}
                  </span>
                </div>
              </div>
              <div className="desk-dm-muted" style={{ marginTop: 8 }}>
                在线状态只反映最近上报；生命周期反映投运阶段；接入控制反映是否允许设备直连或已停用。
              </div>
            </div>

            <div className="desk-dm-detail-card" style={{ marginTop: 12 }}>
              <div className="desk-dm-detail-title">状态快照</div>
              <div className="desk-dm-detail-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">温度</span>
                  <span className="desk-dm-detail-v">{formatMetricNumber(deviceMetrics.temperatureC)}°C</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">湿度</span>
                  <span className="desk-dm-detail-v">{formatMetricNumber(deviceMetrics.humidityPct, 0)}%</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">倾角 X</span>
                  <span className="desk-dm-detail-v">{formatMetricNumber(deviceMetrics.tiltXDeg, 2)}°</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">倾角 Y</span>
                  <span className="desk-dm-detail-v">{formatMetricNumber(deviceMetrics.tiltYDeg, 2)}°</span>
                </div>
              </div>
            </div>

            <div className="desk-dm-detail-card" style={{ marginTop: 12 }}>
              <div className="desk-dm-detail-title">站点信息</div>
              <div className="desk-dm-detail-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">监测点展示名</span>
                  <span className="desk-dm-detail-v">{selectedStation?.displayName ?? selectedStation?.name ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">站点编码</span>
                  <span className="desk-dm-detail-v">{selectedStation?.stationCode ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">区域</span>
                  <span className="desk-dm-detail-v">{selectedStation?.area ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">区域编码</span>
                  <span className="desk-dm-detail-v">{selectedStation?.regionCode ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">边坡编码</span>
                  <span className="desk-dm-detail-v">{selectedStation?.slopeCode ?? "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">生命周期状态</span>
                  <span className="desk-dm-detail-v">{formatLifecycleStatusDisplay(selectedStation?.lifecycleStatus, "-")}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">风险</span>
                  <span className="desk-dm-detail-v">{selectedStation ? <RiskTag value={selectedStation.risk} /> : "-"}</span>
                </div>
                <div className="desk-dm-detail-item">
                  <span className="desk-dm-detail-k">坐标</span>
                  <span className="desk-dm-detail-v" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {selectedStation ? `${selectedStation.lat.toFixed(6)}, ${selectedStation.lng.toFixed(6)}` : "-"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="desk-dm-empty">请选择设备</div>
        )}
      </Modal>
    </div>
  );
}
