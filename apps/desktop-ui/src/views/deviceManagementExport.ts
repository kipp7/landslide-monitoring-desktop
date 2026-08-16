import type { Baseline, Device } from "../api/client";

export type DeviceManagementSensorRow = {
  id: string;
  time: string;
  soilTemperatureC: number | null;
  soilMoisturePct: number | null;
  conductivityUsCm: number | null;
  tiltXDeg: number | null;
  tiltYDeg: number | null;
  tiltZDeg: number | null;
};

export type PreparedExport = {
  filename: string;
  mimeType: string;
  content: string;
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

export function buildSensorExport(rows: DeviceManagementSensorRow[], deviceName = "device"): PreparedExport {
  const csvRows = [
    ["时间", "土壤温度(°C)", "土壤水分(%)", "电导率(μS/cm)", "倾角X(°)", "倾角Y(°)", "倾角Z(°)"],
    ...rows.map((row) => [
      row.time,
      row.soilTemperatureC ?? "",
      row.soilMoisturePct ?? "",
      row.conductivityUsCm ?? "",
      row.tiltXDeg ?? "",
      row.tiltYDeg ?? "",
      row.tiltZDeg ?? ""
    ])
  ];
  return {
    filename: `desk-${deviceName.replaceAll(/[^a-zA-Z0-9_-]+/g, "-")}-telemetry.csv`,
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFF" + toCsv(csvRows)
  };
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
