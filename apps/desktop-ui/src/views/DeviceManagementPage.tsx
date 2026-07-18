import {
  AlertOutlined,
  ExportOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { App as AntApp, Alert, Button, Empty, Select, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type {
  Device,
  DeviceCommand,
  DeviceStateSnapshot,
  FieldAlarmAction,
  FieldAlarmStatus,
  Station,
  TelemetrySeriesPoint,
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { StatusTag } from "../components/StatusTag";
import { formatBeijingDateTime, formatBeijingTime } from "../utils/beijingTime";
import {
  formatDeviceRoleDisplay,
  formatInstallLabelDisplay,
  formatLifecycleStatusDisplay,
  formatRegistryStatusDisplay,
} from "../utils/fieldIdentityDisplay";
import { BaselinesPanel } from "./BaselinesPanel";
import { DeviceManagementSectionNav } from "./DeviceManagementSectionNav";
import { DeviceManagementWorkspaceHeader } from "./DeviceManagementWorkspaceHeader";
import { StationManagementPanel } from "./StationManagementPanel";
import {
  buildDevicesExport,
  buildSensorExport,
  triggerPreparedExport,
  type DeviceManagementSensorRow,
} from "./deviceManagementExport";
import "./deviceManagement.css";

type TabKey = "status" | "management" | "baselines";

type TelemetryMetric = {
  key: keyof Omit<DeviceManagementSensorRow, "id" | "time">;
  sensorKey: string;
  label: string;
  unit: string;
  digits: number;
};

const TELEMETRY_METRICS: TelemetryMetric[] = [
  { key: "soilTemperatureC", sensorKey: "soil_temperature_c", label: "土壤温度", unit: "°C", digits: 1 },
  { key: "soilMoisturePct", sensorKey: "soil_moisture_pct", label: "土壤水分", unit: "%", digits: 1 },
  {
    key: "conductivityUsCm",
    sensorKey: "electrical_conductivity_us_cm",
    label: "土壤电导率",
    unit: "μS/cm",
    digits: 0,
  },
  { key: "tiltXDeg", sensorKey: "tilt_x_deg", label: "倾角 X", unit: "°", digits: 2 },
  { key: "tiltYDeg", sensorKey: "tilt_y_deg", label: "倾角 Y", unit: "°", digits: 2 },
  { key: "tiltZDeg", sensorKey: "tilt_z_deg", label: "倾角 Z", unit: "°", digits: 2 },
];

const COMMAND_LABELS: Record<string, string> = {
  manual_collect: "手动采集",
  restart_device: "重启设备",
  set_sampling_interval: "设置采样间隔",
};

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalDevice(device: Device): boolean {
  return normalizeIdentityClass(device.identityClass) === "formal";
}

function deviceTypeLabel(device: Device): string {
  if (device.type === "multi_sensor") return "土壤/倾角多传感";
  if (device.type === "gnss") return "GNSS";
  if (device.type === "rain") return "雨量";
  if (device.type === "tilt") return "倾角";
  if (device.type === "temp_hum") return "温湿度";
  if (device.type === "field_gateway") return "现场网关";
  return "摄像头";
}

function canIssueFieldNodeCommand(device: Device | null): boolean {
  if (!device) return false;
  const role = device.deviceRole?.toLowerCase() ?? "";
  return device.type === "multi_sensor" || role.includes("field") || role.includes("node");
}

function readMetricNumber(metrics: Record<string, unknown> | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatMetric(value: number | null, unit: string, digits: number): string {
  return value == null ? "--" : `${value.toFixed(digits)}${unit}`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "未上报";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1970) return "未上报";
  return formatBeijingDateTime(date);
}

function formatCoordinate(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return "未配置";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function formatActuatorState(value?: string | null): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "未回读";
  if (normalized === "idle" || normalized === "normal" || normalized === "off") return "待命";
  if (normalized === "active" || normalized === "on" || normalized === "alarm") return "告警中";
  if (normalized === "unavailable" || normalized === "offline") return "不可用";
  return value ?? "未回读";
}

function formatActuatorAction(value?: string | null): string {
  if (!value) return "无";
  if (value === "alarm_on") return "启动告警";
  if (value === "alarm_off" || value === "silence") return "停止告警";
  return value;
}

function commandStatusTag(status: DeviceCommand["status"]) {
  if (status === "acked") return <Tag color="success">已确认</Tag>;
  if (status === "queued" || status === "sent") return <Tag color="processing">执行中</Tag>;
  if (status === "canceled") return <Tag>已取消</Tag>;
  return <Tag color="error">{status === "timeout" ? "超时" : "失败"}</Tag>;
}

function mergeTelemetrySeries(series: TelemetrySeriesPoint[][]): DeviceManagementSensorRow[] {
  const rows = new Map<string, DeviceManagementSensorRow>();
  for (let metricIndex = 0; metricIndex < TELEMETRY_METRICS.length; metricIndex += 1) {
    const metric = TELEMETRY_METRICS[metricIndex];
    if (!metric) continue;
    for (const point of series[metricIndex] ?? []) {
      const existing = rows.get(point.ts) ?? {
        id: point.ts,
        time: point.ts,
        soilTemperatureC: null,
        soilMoisturePct: null,
        conductivityUsCm: null,
        tiltXDeg: null,
        tiltYDeg: null,
        tiltZDeg: null,
      };
      existing[metric.key] = point.value;
      rows.set(point.ts, existing);
    }
  }
  return Array.from(rows.values()).sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime());
}

export function DeviceManagementPage() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { message, modal } = AntApp.useApp();
  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceState, setDeviceState] = useState<DeviceStateSnapshot | null>(null);
  const [commands, setCommands] = useState<DeviceCommand[]>([]);
  const [telemetryRows, setTelemetryRows] = useState<DeviceManagementSensorRow[]>([]);
  const [fieldAlarmStatus, setFieldAlarmStatus] = useState<FieldAlarmStatus | null>(null);
  const [samplingInterval, setSamplingInterval] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [alarmBusy, setAlarmBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState("");
  const [nowTime, setNowTime] = useState(formatBeijingTime(new Date()));
  const selectedDeviceIdRef = useRef("");

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "status" || tab === "management" || tab === "baselines") setActiveTab(tab);
    const deviceId = params.get("deviceId");
    if (deviceId) setSelectedDeviceId(deviceId);
  }, [location.search]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTime(formatBeijingTime(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshOverview = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(null);
      try {
        const [stationList, deviceList, alarmStatus] = await Promise.all([
          api.stations.list(),
          api.devices.list(),
          api.fieldAlarm.getStatus().catch(() => null),
        ]);
        setStations(stationList);
        setDevices(deviceList);
        setFieldAlarmStatus(alarmStatus);
        setSelectedDeviceId((current) => {
          if (current && deviceList.some((device) => device.id === current)) return current;
          const preferred = deviceList.find((device) => device.status === "online") ?? deviceList[0];
          return preferred?.id ?? "";
        });
        setLastUpdateTime(formatBeijingTime(new Date()));
      } catch (error) {
        const detail = (error as Error).message;
        setLoadError(detail);
        if (!quiet) message.error(`设备数据加载失败：${detail}`);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [api, message],
  );

  useEffect(() => {
    void refreshOverview();
    const timer = window.setInterval(() => void refreshOverview(true), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const stationsById = useMemo(() => new Map(stations.map((station) => [station.id, station] as const)), [stations]);
  const selectedStation = selectedDevice ? stationsById.get(selectedDevice.stationId) ?? null : null;
  const formalDevices = useMemo(() => devices.filter(isFormalDevice), [devices]);
  const displayedDevices = formalDevices.length ? formalDevices : devices;
  const fieldNodeCommandAvailable = canIssueFieldNodeCommand(selectedDevice);

  const refreshSelectedData = useCallback(
    async (deviceId: string, quiet = false) => {
      if (!quiet) setTelemetryLoading(true);
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      try {
        const [snapshot, commandList, ...series] = await Promise.all([
          api.devices.getState({ deviceId }).catch(() => null),
          api.devices.listCommands({ deviceId }).catch(() => []),
          ...TELEMETRY_METRICS.map((metric) =>
            api.telemetry.getSeries({ deviceId, sensorKey: metric.sensorKey, startTime, endTime, interval: "1h" }).catch(() => []),
          ),
        ]);
        if (selectedDeviceIdRef.current !== deviceId) return;
        setDeviceState(snapshot);
        setCommands(commandList.slice(0, 20));
        setTelemetryRows(mergeTelemetrySeries(series));
      } finally {
        if (!quiet && selectedDeviceIdRef.current === deviceId) setTelemetryLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    setSamplingInterval(undefined);
    if (!selectedDeviceId) {
      setDeviceState(null);
      setCommands([]);
      setTelemetryRows([]);
      return;
    }
    void refreshSelectedData(selectedDeviceId);
    const commandTimer = window.setInterval(() => {
      void api.devices
        .listCommands({ deviceId: selectedDeviceId })
        .then((list) => {
          if (selectedDeviceIdRef.current === selectedDeviceId) setCommands(list.slice(0, 20));
        })
        .catch(() => undefined);
    }, 5000);
    const stateTimer = window.setInterval(() => {
      void api.devices
        .getState({ deviceId: selectedDeviceId })
        .then((snapshot) => {
          if (selectedDeviceIdRef.current === selectedDeviceId) setDeviceState(snapshot);
        })
        .catch(() => undefined);
    }, 5000);
    const telemetryTimer = window.setInterval(() => void refreshSelectedData(selectedDeviceId, true), 30_000);
    return () => {
      window.clearInterval(commandTimer);
      window.clearInterval(stateTimer);
      window.clearInterval(telemetryTimer);
    };
  }, [api, refreshSelectedData, selectedDeviceId]);

  const latestMetrics = useMemo(() => {
    const metrics = deviceState?.metrics;
    return {
      soilTemperatureC: readMetricNumber(metrics, "soil_temperature_c"),
      soilMoisturePct: readMetricNumber(metrics, "soil_moisture_pct"),
      conductivityUsCm: readMetricNumber(metrics, "electrical_conductivity_us_cm"),
      tiltXDeg: readMetricNumber(metrics, "tilt_x_deg"),
      tiltYDeg: readMetricNumber(metrics, "tilt_y_deg"),
      tiltZDeg: readMetricNumber(metrics, "tilt_z_deg"),
    };
  }, [deviceState]);

  const counts = useMemo(
    () => ({
      total: displayedDevices.length,
      online: displayedDevices.filter((device) => device.status === "online").length,
      warning: displayedDevices.filter((device) => device.status === "warning").length,
      offline: displayedDevices.filter((device) => device.status === "offline").length,
    }),
    [displayedDevices],
  );

  const issueCommand = async (commandType: "manual_collect" | "set_sampling_interval" | "restart_device", payload = {}) => {
    if (!selectedDevice || !fieldNodeCommandAvailable || commandBusy) return;
    setCommandBusy(true);
    try {
      const result = await api.devices.issueCommand({
        deviceId: selectedDevice.id,
        commandType,
        payload: { source: "desk-device-management", ...payload },
        successNotificationPolicy: "always_notify",
      });
      message.success(`${COMMAND_LABELS[commandType]}已下发，命令状态：${result.status}`);
      const commandList = await api.devices.listCommands({ deviceId: selectedDevice.id });
      setCommands(commandList.slice(0, 20));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCommandBusy(false);
    }
  };

  const confirmRestart = () => {
    if (!selectedDevice) return;
    modal.confirm({
      title: `确认重启 ${selectedDevice.name}？`,
      content: "设备会短暂离线。命令下发后请在控制历史中确认设备回执。",
      okText: "确认重启",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => issueCommand("restart_device"),
    });
  };

  const issueAlarmAction = async (action: Extract<FieldAlarmAction, "alarm_on" | "alarm_off">) => {
    if (alarmBusy || !fieldAlarmStatus?.actuator.available) return;
    setAlarmBusy(true);
    try {
      const result = await api.fieldAlarm.sendAction({
        action,
        reason: action === "alarm_on" ? "设备管理中心人工启动现场声光告警" : "设备管理中心人工停止现场声光告警",
      });
      const refreshed = await api.fieldAlarm.getStatus().catch(() => null);
      setFieldAlarmStatus(refreshed ?? {
        ...fieldAlarmStatus,
        active: action === "alarm_on" && result.accepted,
        silenced: action === "alarm_off" && result.accepted,
        actuator: result.actuator,
      });
      if (result.accepted) message.success(action === "alarm_on" ? "现场声光告警已启动" : "现场声光告警已停止");
      else message.error(result.actuator.lastError ?? "现场执行器未确认命令");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAlarmBusy(false);
    }
  };

  const exportTelemetry = () => {
    if (!selectedDevice || !telemetryRows.length) {
      message.info("当前设备在近 24 小时内没有可导出的遥测数据");
      return;
    }
    triggerPreparedExport(buildSensorExport(telemetryRows, selectedDevice.name));
    message.success("已导出真实遥测数据");
  };

  return (
    <div className="desk-page desk-dm-page">
      <DeviceManagementWorkspaceHeader
        title="设备管理中心"
        subtitle="真实资产、实时遥测与现场控制"
        nowTime={nowTime}
        lastUpdateTime={lastUpdateTime}
        actions={
          <>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshOverview()}>
              刷新
            </Button>
            <Button
              size="small"
              icon={<ExportOutlined />}
              onClick={() => triggerPreparedExport(buildDevicesExport(displayedDevices))}
            >
              导出设备
            </Button>
            <Button size="small" icon={<SettingOutlined />} onClick={() => navigate("/app/settings")}>
              设置
            </Button>
          </>
        }
      />

      <DeviceManagementSectionNav active={activeTab} />

      {loadError ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="error"
          showIcon
          message="设备业务数据加载失败"
          description={`${loadError}。页面不会使用示例数据或 0 值代替缺失结果。`}
        />
      ) : null}

      {activeTab === "management" ? <StationManagementPanel /> : null}
      {activeTab === "baselines" ? <BaselinesPanel /> : null}
      {activeTab === "status" ? (
        <div className="desk-dm-live-layout">
          <div className="desk-dm-summary-strip">
            <div><span>分节点设备</span><strong>{counts.total}</strong></div>
            <div><span>在线</span><strong className="is-online">{counts.online}</strong></div>
            <div><span>待确认</span><strong className="is-warning">{counts.warning}</strong></div>
            <div><span>离线</span><strong>{counts.offline}</strong></div>
            <div><span>现场执行器</span><strong>{fieldAlarmStatus?.actuator.dryRun ? "演示配置" : fieldAlarmStatus?.actuator.available ? "可用" : "不可用"}</strong></div>
          </div>

          <div className="desk-dm-live-top">
            <BaseCard title="设备清单" className="desk-dm-device-list-card">
              <div className="desk-dm-muted" style={{ marginBottom: 10 }}>展示服务器登记的正式分节点；现场执行器单独展示。</div>
              <div className="desk-dm-devlist">
                {displayedDevices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`desk-dm-devitem ${selectedDeviceId === device.id ? "active" : ""}`}
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <span className={`desk-dm-dot is-${device.status}`} />
                    <span className="desk-dm-devmeta">
                      <span className="desk-dm-devname">{device.name}</span>
                      <span className="desk-dm-devsub">{device.nodeCode ?? device.id} · {deviceTypeLabel(device)}</span>
                      <span className="desk-dm-devsub">最后上报：{formatTimestamp(device.lastSeenAt)}</span>
                    </span>
                    <StatusTag value={device.status} />
                  </button>
                ))}
                {!displayedDevices.length && !loading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="服务器未登记设备" /> : null}
              </div>
            </BaseCard>

            <BaseCard
              title={selectedDevice ? `${selectedDevice.name} · 最新遥测` : "最新遥测"}
              extra={selectedDevice ? <StatusTag value={selectedDevice.status} /> : null}
            >
              {selectedDevice ? (
                <>
                  <div className="desk-dm-live-metrics">
                    {TELEMETRY_METRICS.map((metric) => (
                      <div key={metric.sensorKey} className="desk-dm-live-metric">
                        <span>{metric.label}</span>
                        <strong>{formatMetric(latestMetrics[metric.key], metric.unit, metric.digits)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="desk-dm-device-facts">
                    <div><span>状态时间</span><strong>{formatTimestamp(deviceState?.updatedAt)}</strong></div>
                    <div><span>所属站点</span><strong>{selectedDevice.stationName || "未绑定"}</strong></div>
                    <div><span>设备类型</span><strong>{deviceTypeLabel(selectedDevice)}</strong></div>
                    <div><span>安装标识</span><strong>{formatInstallLabelDisplay(selectedDevice.installLabel, "未配置")}</strong></div>
                    <div><span>设备角色</span><strong>{formatDeviceRoleDisplay(selectedDevice.deviceRole, "未配置")}</strong></div>
                    <div><span>接入状态</span><strong>{formatRegistryStatusDisplay(selectedDevice.registryStatus, "未配置")}</strong></div>
                    <div><span>生命周期</span><strong>{formatLifecycleStatusDisplay(selectedDevice.lifecycleStatus, "未配置")}</strong></div>
                    <div><span>站点坐标</span><strong>{formatCoordinate(selectedStation?.lat, selectedStation?.lng)}</strong></div>
                  </div>
                </>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择设备" />}
            </BaseCard>

            <BaseCard title="现场声光告警" extra={<Tag color={fieldAlarmStatus?.active ? "error" : "default"}>{fieldAlarmStatus?.active ? "告警中" : "待命"}</Tag>}>
              <div className="desk-dm-alarm-status">
                <div><span>执行器</span><strong>{fieldAlarmStatus?.actuator.dryRun ? "演示配置" : fieldAlarmStatus?.actuator.available ? "已连接" : "不可用"}</strong></div>
                <div><span>执行状态</span><strong>{formatActuatorState(fieldAlarmStatus?.actuator.state)}</strong></div>
                <div><span>最近动作</span><strong>{formatActuatorAction(fieldAlarmStatus?.actuator.lastAction)}</strong></div>
                <div><span>动作时间</span><strong>{formatTimestamp(fieldAlarmStatus?.actuator.lastActionAt)}</strong></div>
              </div>
              <div className="desk-dm-actuator-detail">{fieldAlarmStatus?.actuator.detail ?? "服务器未返回现场执行器信息"}</div>
              {fieldAlarmStatus?.actuator.lastError ? <Alert type="error" showIcon message={fieldAlarmStatus.actuator.lastError} /> : null}
              <Space style={{ marginTop: 12 }}>
                <Button
                  danger
                  type="primary"
                  icon={<AlertOutlined />}
                  loading={alarmBusy}
                  disabled={!fieldAlarmStatus?.actuator.available || fieldAlarmStatus?.actuator.dryRun || fieldAlarmStatus?.active}
                  onClick={() => void issueAlarmAction("alarm_on")}
                >
                  启动告警
                </Button>
                <Button
                  loading={alarmBusy}
                  disabled={!fieldAlarmStatus?.actuator.available || fieldAlarmStatus?.actuator.dryRun || !fieldAlarmStatus?.active}
                  onClick={() => void issueAlarmAction("alarm_off")}
                >
                  停止告警
                </Button>
              </Space>
            </BaseCard>
          </div>

          <div className="desk-dm-live-bottom">
            <BaseCard
              title="近 24 小时遥测（1 小时聚合）"
              extra={<Button size="small" icon={<ExportOutlined />} onClick={exportTelemetry}>导出</Button>}
            >
              <div className="desk-dark-table">
                <Table<DeviceManagementSensorRow>
                  rowKey="id"
                  size="small"
                  loading={telemetryLoading}
                  dataSource={telemetryRows}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  locale={{ emptyText: "当前设备近 24 小时没有遥测数据" }}
                  scroll={{ x: 930 }}
                  columns={[
                    { title: "时间", dataIndex: "time", width: 170, render: (value: string) => formatTimestamp(value) },
                    ...TELEMETRY_METRICS.map((metric) => ({
                      title: `${metric.label}（${metric.unit}）`,
                      dataIndex: metric.key,
                      width: metric.key === "conductivityUsCm" ? 170 : 125,
                      render: (value: number | null) => value == null ? "--" : value.toFixed(metric.digits),
                    })),
                  ]}
                />
              </div>
            </BaseCard>

            <div className="desk-dm-control-stack">
              <BaseCard title="分节点控制">
                <div className="desk-dm-muted">
                  {selectedDevice
                    ? fieldNodeCommandAvailable
                      ? `命令将下发至 ${selectedDevice.name}，执行结果以设备回执为准。`
                      : "所选资产没有分节点命令通道。"
                    : "请选择分节点设备。"}
                </div>
                <div className="desk-dm-command-row">
                  <Select
                    value={samplingInterval}
                    placeholder="选择采样间隔"
                    disabled={!fieldNodeCommandAvailable || commandBusy}
                    style={{ width: 160 }}
                    onChange={setSamplingInterval}
                    options={[1, 3, 5, 10, 30, 60].map((value) => ({ label: `${value} 秒`, value }))}
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    disabled={!fieldNodeCommandAvailable || samplingInterval == null}
                    loading={commandBusy}
                    onClick={() => void issueCommand("set_sampling_interval", { intervalSeconds: samplingInterval })}
                  >
                    下发间隔
                  </Button>
                </div>
                <Space wrap>
                  <Button
                    disabled={!fieldNodeCommandAvailable}
                    loading={commandBusy}
                    onClick={() => void issueCommand("manual_collect")}
                  >
                    手动采集
                  </Button>
                  <Button danger disabled={!fieldNodeCommandAvailable} loading={commandBusy} onClick={confirmRestart}>
                    重启设备
                  </Button>
                </Space>
              </BaseCard>

              <BaseCard title="设备命令历史">
                <div className="desk-dark-table desk-dm-command-history">
                  <Table<DeviceCommand>
                    rowKey="commandId"
                    size="small"
                    dataSource={commands}
                    pagination={false}
                    locale={{ emptyText: selectedDevice ? "暂无真实命令记录" : "请选择设备" }}
                    columns={[
                      { title: "时间", dataIndex: "createdAt", width: 150, render: (value: string) => formatTimestamp(value) },
                      {
                        title: "命令",
                        dataIndex: "commandType",
                        render: (value: string) => COMMAND_LABELS[value] ?? value,
                      },
                      { title: "状态", dataIndex: "status", width: 90, render: commandStatusTag },
                      {
                        title: "结果",
                        key: "result",
                        ellipsis: true,
                        render: (_: unknown, row: DeviceCommand) => row.errorMessage ?? (row.ackedAt ? `确认于 ${formatTimestamp(row.ackedAt)}` : "--"),
                      },
                    ]}
                  />
                </div>
              </BaseCard>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
