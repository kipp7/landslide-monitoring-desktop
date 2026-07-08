import type { Baseline, Device, Station } from "../api/client";
import {
  formatInstallLabelDisplay,
  formatLifecycleStatusDisplay,
  formatRegistryStatusDisplay,
  formatWarningFlagDisplay,
} from "../utils/fieldIdentityDisplay";

export type DeviceManagementSensorRow = {
  id: string;
  time: string;
  temperature: number;
  humidity: number;
  dispMm: number;
  rainMm: number;
};

export type PreparedExport = {
  filename: string;
  mimeType: string;
  content: string;
};

export type DeviceDetailCopyInput = {
  device: Device;
  station: Station | null;
  metrics: {
    health: number;
    battery: number;
    signal: number;
    todayCount: number;
    baselineEstablished: boolean;
    stateUpdatedAt?: string | null;
    warningFlag?: boolean | null;
    temperatureC?: number | null;
    humidityPct?: number | null;
    tiltXDeg?: number | null;
    tiltYDeg?: number | null;
  };
};

function toCsv(lines: Array<Array<string | number>>): string {
  return lines
    .map((line) =>
      line
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\r\n");
}

export function buildDevicesExport(devices: Device[]): PreparedExport {
  const rows = [
    [
      "设备ID",
      "原始设备名",
      "展示名称",
      "站点ID",
      "站点编码",
      "站点名称",
      "区域编码",
      "边坡编码",
      "节点编码",
      "网关编码",
      "设备类型",
      "设备状态",
      "最后上报时间"
    ],
    ...devices.map((device) => [
      device.id,
      device.deviceName ?? device.id,
      device.name,
      device.stationId,
      device.stationCode ?? "",
      device.stationName,
      device.regionCode ?? "",
      device.slopeCode ?? "",
      device.nodeCode ?? "",
      device.gatewayCode ?? "",
      device.type,
      device.status,
      device.lastSeenAt
    ])
  ];
  return {
    filename: "desk-devices.csv",
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFF" + toCsv(rows)
  };
}

export function buildBaselinesExport(baselines: Baseline[]): PreparedExport {
  const rows = [
    ["设备ID", "设备名称", "基线纬度", "基线经度", "基线高程", "建立人", "建立时间", "状态", "备注"],
    ...baselines.map((baseline) => [
      baseline.deviceId,
      baseline.deviceName,
      baseline.baselineLat,
      baseline.baselineLng,
      baseline.baselineAlt ?? "",
      baseline.establishedBy,
      baseline.establishedTime,
      baseline.status,
      baseline.notes ?? ""
    ])
  ];
  return {
    filename: "desk-baselines.csv",
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFF" + toCsv(rows)
  };
}

export function buildSensorExport(rows: DeviceManagementSensorRow[]): PreparedExport {
  const csvRows = [
    ["时间", "温度", "湿度", "位移(mm)", "雨量(mm)"],
    ...rows.map((row) => [row.time, row.temperature, row.humidity, row.dispMm, row.rainMm])
  ];
  return {
    filename: "desk-device-sensor.csv",
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFF" + toCsv(csvRows)
  };
}

export function buildDeviceDetailText(input: DeviceDetailCopyInput): string {
  const { device, station, metrics } = input;
  return [
    `设备名称: ${device.name}`,
    `设备ID: ${device.id}`,
    `原始设备名: ${device.deviceName ?? "-"}`,
    `历史设备ID: ${device.legacyDeviceId ?? "-"}`,
    `设备类型: ${device.type}`,
    `在线状态: ${device.status}`,
    `接入控制: ${formatRegistryStatusDisplay(device.registryStatus, "-")}`,
    `所属站点: ${device.stationName}`,
    `站点编码: ${device.stationCode ?? "-"}`,
    `区域编码: ${device.regionCode ?? "-"}`,
    `边坡编码: ${device.slopeCode ?? "-"}`,
    `节点编码: ${device.nodeCode ?? "-"}`,
    `网关编码: ${device.gatewayCode ?? "-"}`,
    `安装标识: ${formatInstallLabelDisplay(device.installLabel, "-")}`,
    `生命周期状态: ${formatLifecycleStatusDisplay(device.lifecycleStatus, "-")}`,
    `站点区域: ${station?.area ?? "-"}`,
    `站点风险: ${station?.risk ?? "-"}`,
    `最后上报: ${new Date(device.lastSeenAt).toLocaleString("zh-CN")}`,
    `健康度: ${metrics.health}%`,
    `电池电量: ${metrics.battery}%`,
    `信号强度: ${metrics.signal}%`,
    `今日数据: ${metrics.todayCount} 条`,
    `基线状态: ${metrics.baselineEstablished ? "已建立" : "待建立"}`,
    `状态更新时间: ${metrics.stateUpdatedAt ? new Date(metrics.stateUpdatedAt).toLocaleString("zh-CN") : "-"}`,
    `温度: ${metrics.temperatureC == null ? "-" : `${metrics.temperatureC.toFixed(1)}°C`}`,
    `湿度: ${metrics.humidityPct == null ? "-" : `${metrics.humidityPct.toFixed(0)}%`}`,
    `倾角 X/Y: ${metrics.tiltXDeg == null || metrics.tiltYDeg == null ? "-" : `${metrics.tiltXDeg.toFixed(2)} / ${metrics.tiltYDeg.toFixed(2)}°`}`,
    `预警状态: ${formatWarningFlagDisplay(metrics.warningFlag, "-")}`
  ].join("\r\n");
}

export async function copyTextContent(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("当前运行环境不支持复制到剪贴板");
  }
}

export function triggerPreparedExport(file: PreparedExport): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
