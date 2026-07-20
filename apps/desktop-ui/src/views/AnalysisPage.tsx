import clsx from "clsx";
import { HistoryOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Input, InputNumber, Modal, Select, Switch, Tag } from "antd";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  AlertLifecycleEvent,
  AlertSeverity,
  AlertSummaryItem,
  CompetitionTiltVector,
  Device,
  DeviceStateSnapshot,
  Station,
  TelemetrySeriesPoint
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { MapSwitchPanel, type MapType } from "../components/MapSwitchPanel";
import { RealMapView, type RealMapPoint } from "../components/RealMapView";
import { StatusTag } from "../components/StatusTag";
import { TerrainBackdrop } from "../components/TerrainBackdrop";
import { useAuthStore } from "../stores/authStore";
import { useFieldAlarmStore } from "../stores/fieldAlarmStore";
import { useSettingsStore } from "../stores/settingsStore";
import { formatBeijingDate, formatBeijingDateTime, formatBeijingTime } from "../utils/beijingTime";
import { formatInstallLabelDisplay, formatWarningFlagDisplay } from "../utils/fieldIdentityDisplay";

import "./analysis.css";

type AnomalyRow = {
  id: string;
  deviceName: string;
  stationName: string;
  level: "info" | "warn" | "critical";
  message: string;
  time: string;
};

type AnomalyKind = "availability" | "tilt" | "soil" | "conductivity" | "gnss" | "battery" | "device";

type AnomalyAnalysis = {
  isAnomaly: boolean;
  level: AnomalyRow["level"];
  kind: AnomalyKind;
  message: string;
};

type CompetitionThresholdForm = {
  highDeg: number;
  criticalDeg: number;
  recoveryDeg: number;
  triggerPoints: number;
  recoveryPoints: number;
  updateStepDeg: number;
};

type ReviewConclusion = "confirmed_risk" | "environmental_disturbance" | "device_issue" | "false_positive";

type ReviewArchiveItem = {
  alert: AlertSummaryItem;
  resolvedAt: string;
  note: string;
  eventCount: number;
};

const DEFAULT_COMPETITION_THRESHOLDS: CompetitionThresholdForm = {
  highDeg: 3,
  criticalDeg: 7,
  recoveryDeg: 1.5,
  triggerPoints: 2,
  recoveryPoints: 2,
  updateStepDeg: 0.25,
};

const REVIEW_CONCLUSION_OPTIONS: Array<{ value: ReviewConclusion; label: string }> = [
  { value: "confirmed_risk", label: "确认风险事件" },
  { value: "environmental_disturbance", label: "现场扰动" },
  { value: "device_issue", label: "设备或安装问题" },
  { value: "false_positive", label: "误报" },
];

function lifecycleEventLabel(eventType: AlertLifecycleEvent["eventType"]): string {
  if (eventType === "ALERT_TRIGGER") return "告警触发";
  if (eventType === "ALERT_UPDATE") return "等级更新";
  if (eventType === "ALERT_ACK") return "进入复核";
  return "复核归档";
}

function lifecycleEventNote(event: AlertLifecycleEvent): string {
  const evidence = asRecord(event.evidence);
  return typeof evidence.notes === "string" && evidence.notes.trim() ? evidence.notes.trim() : "未填写备注";
}

function darkAxis() {
  return {
    axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.45)" } },
    axisLabel: { color: "rgba(226, 232, 240, 0.85)" },
    splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
  };
}

function darkTooltip() {
  return {
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    borderColor: "rgba(34, 211, 238, 0.22)",
    textStyle: { color: "rgba(226, 232, 240, 0.92)" }
  };
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readTiltVector(value: unknown): CompetitionTiltVector | null {
  const record = asRecord(value);
  const x = readMetricNumber(record, "x");
  const y = readMetricNumber(record, "y");
  const z = readMetricNumber(record, "z");
  return x == null || y == null || z == null ? null : { x, y, z };
}

function formatTiltValue(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}°` : "--";
}

function alertSeverityLabel(severity: AlertSeverity | undefined): string {
  if (severity === "critical") return "严重风险";
  if (severity === "high") return "高风险";
  if (severity === "medium") return "中风险";
  return severity === "low" ? "低风险" : "未判定";
}

function readMetricBoolean(metrics: Record<string, unknown> | undefined, key: string): boolean {
  const value = metrics?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

const XIAMEN_UNIVERSITY_DEFAULT_LOCATION = {
  lat: 24.43803,
  lng: 118.09631
} as const;

function isValidGpsCoordinatePair(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Math.abs(latitude) > 0.0001 &&
    Math.abs(longitude) > 0.0001 &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function isFormalFieldNode(device: Device): boolean {
  if (!isFormalIdentityClass(device.identityClass) || device.type === "field_gateway") return false;
  const identityText = [device.deviceRole, device.installLabel, device.nodeCode, device.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return identityText.includes("field") || identityText.includes("node") || identityText.includes("分节点");
}

function spreadDefaultMapLocation(index: number, total: number): { lat: number; lng: number } {
  if (total <= 1) return XIAMEN_UNIVERSITY_DEFAULT_LOCATION;
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  const radius = 0.0012;
  return {
    lat: XIAMEN_UNIVERSITY_DEFAULT_LOCATION.lat + Math.sin(angle) * radius,
    lng: XIAMEN_UNIVERSITY_DEFAULT_LOCATION.lng + Math.cos(angle) * radius
  };
}

function deviceTypeLabel(type: Device["type"]): string {
  if (type === "gnss") return "GNSS";
  if (type === "rain") return "雨量";
  if (type === "tilt") return "倾角";
  if (type === "temp_hum") return "土壤温度/水分";
  return "视频";
}

function isSoilSensorDevice(device: Device, snapshot?: DeviceStateSnapshot | null): boolean {
  const metrics = snapshot?.metrics ?? {};
  if (
    readMetricNumber(metrics, "soil_temperature_c") != null ||
    readMetricNumber(metrics, "temperature_c") != null ||
    readMetricNumber(metrics, "soil_moisture_pct") != null ||
    readMetricNumber(metrics, "humidity_pct") != null ||
    readMetricNumber(metrics, "electrical_conductivity_us_cm") != null
  ) {
    return true;
  }
  const text = [
    device.type,
    device.name,
    device.deviceName,
    device.displayName,
    device.installLabel,
    device.nodeCode
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return device.type === "temp_hum" || text.includes("soil") || text.includes("土壤") || text.includes("温度水分");
}

function isTiltSensorDevice(device: Device, snapshot?: DeviceStateSnapshot | null): boolean {
  const metrics = snapshot?.metrics ?? {};
  if (readMetricNumber(metrics, "tilt_x_deg") != null || readMetricNumber(metrics, "tilt_y_deg") != null) return true;
  const text = [
    device.type,
    device.name,
    device.deviceName,
    device.displayName,
    device.installLabel,
    device.nodeCode
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return device.type === "tilt" || text.includes("tilt") || text.includes("倾角") || text.includes("姿态");
}

const HISTORY_METRICS: HistoryMetricMeta[] = [
  {
    key: "tilt_x_deg",
    label: "倾角 X",
    unit: "°",
    aggregation: "avg",
    color: "#34d399",
    deviceMatches: isTiltSensorDevice
  },
  {
    key: "tilt_y_deg",
    label: "倾角 Y",
    unit: "°",
    aggregation: "avg",
    color: "#fbbf24",
    deviceMatches: isTiltSensorDevice
  },
  {
    key: "tilt_z_deg",
    label: "倾角 Z",
    unit: "°",
    aggregation: "avg",
    color: "#60a5fa",
    deviceMatches: isTiltSensorDevice
  },
  {
    key: "soil_temperature_c",
    label: "土壤温度",
    unit: "°C",
    aggregation: "avg",
    color: "#22d3ee",
    deviceMatches: isSoilSensorDevice
  },
  {
    key: "soil_moisture_pct",
    label: "土壤水分",
    unit: "%",
    aggregation: "avg",
    color: "#2dd4bf",
    deviceMatches: isSoilSensorDevice
  },
  {
    key: "electrical_conductivity_us_cm",
    label: "土壤电导率",
    unit: "μS/cm",
    aggregation: "avg",
    color: "#f59e0b",
    deviceMatches: isSoilSensorDevice
  },
  {
    key: "rainfall_mm",
    label: "雨量",
    unit: "mm",
    aggregation: "sum",
    color: "#38bdf8",
    deviceMatches: (device) => device.type === "rain"
  }
];

function stationSnapshotLabel(stationName: string): string {
  if (stationName.includes(" A") || stationName.includes("中心")) return "A";
  if (stationName.includes(" B") || stationName.includes("东侧")) return "B";
  if (stationName.includes(" C") || stationName.includes("西南")) return "C";
  return stationName.replace(/^挂傍山/, "").replace(/监测站$/, "").trim() || stationName;
}

function stationAreaLabel(station: Station): string {
  return station.area?.trim() || station.displayName?.trim() || station.stationName?.trim() || station.name;
}

type LiveSnapshotRow = {
  device: Device;
  updatedAt: string;
  temperatureC: number | null;
  humidityPct: number | null;
  soilTemperatureC: number | null;
  soilMoisturePct: number | null;
  conductivityUsCm: number | null;
  batteryPct: number | null;
  tiltXDeg: number | null;
  tiltYDeg: number | null;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  warningFlag: boolean;
};

type TimeBucketValue = {
  key: string;
  label: string;
  value: number;
};

type AnalysisScopeLevel = "slope" | "region" | "regionGroup" | "all";
type AnalysisChartGroupLevel = "station" | "slope" | "region" | "regionGroup";

type SoilProfileRow = {
  label: string;
  soilTemperatureC: number | null;
  soilMoisturePct: number | null;
};

type SoilTrendBucket = {
  key: string;
  label: string;
  temperatureC: number | null;
  moisturePct: number | null;
};

type SoilTrendGroup = {
  key: string;
  label: string;
  buckets: SoilTrendBucket[];
};

type ConductivityProfileRow = {
  label: string;
  conductivityUsCm: number | null;
};

type ConductivityTrendGroup = {
  key: string;
  label: string;
  buckets: Array<{
    key: string;
    label: string;
    value: number | null;
  }>;
};

type TiltTrendBucket = {
  key: string;
  label: string;
  tiltXDeg: number | null;
  tiltYDeg: number | null;
};

type TiltTrendGroup = {
  key: string;
  label: string;
  buckets: TiltTrendBucket[];
};

type MapBottomMode = "realtime" | "history";
type HistoryRangeKey = "24h" | "7d";
type RealtimeTrendRangeKey = "60s" | "10m" | "1h" | "24h";
type TelemetryBucketUnit = "second" | "minute" | "hour" | "day";
type TelemetrySeriesInterval = "raw" | "1m" | "5m" | "1h" | "1d";
type HistoryMetricKey =
  | "tilt_x_deg"
  | "tilt_y_deg"
  | "tilt_z_deg"
  | "soil_temperature_c"
  | "soil_moisture_pct"
  | "electrical_conductivity_us_cm"
  | "rainfall_mm";
type HistoryAggregation = "avg" | "sum";

type HistoryTrendBucket = {
  key: string;
  label: string;
  value: number | null;
};

type HistoryTrendGroup = {
  key: string;
  label: string;
  buckets: HistoryTrendBucket[];
  pointCount: number;
  latestValue: number | null;
  latestTs: string | null;
};

type HistoryMetricMeta = {
  key: HistoryMetricKey;
  label: string;
  unit: string;
  aggregation: HistoryAggregation;
  color: string;
  deviceMatches: (device: Device, snapshot?: DeviceStateSnapshot | null) => boolean;
};

const REALTIME_TREND_RANGE_OPTIONS: Array<{ key: RealtimeTrendRangeKey; label: string }> = [
  { key: "60s", label: "近 60 秒" },
  { key: "10m", label: "近 10 分钟" },
  { key: "1h", label: "近 1 小时" },
  { key: "24h", label: "近 24 小时" }
];

type AnalysisAreaOption = {
  key: string;
  label: string;
  detail: string;
  level: AnalysisScopeLevel;
  stationIds: string[];
};

type AnalysisChartGroup = {
  key: string;
  label: string;
  level: AnalysisChartGroupLevel;
  stationIds: string[];
};

type AnalysisTrendSource = {
  key: string;
  label: string;
  devices: Device[];
};

function normalizeText(value?: string | null): string {
  return value?.trim() ?? "";
}

function stationSlopeKey(station: Station): string {
  return normalizeText(station.slopeCode) || normalizeText(station.regionCode) || normalizeText(station.area) || station.id;
}

function stationRegionKey(station: Station): string {
  return normalizeText(station.regionCode) || normalizeText(station.area) || stationSlopeKey(station);
}

function stationRegionGroupKey(station: Station): string | null {
  const regionCode = normalizeText(station.regionCode);
  if (!regionCode) return null;
  const parts = regionCode.split("-").filter(Boolean);
  if (parts.length <= 2) return null;
  return parts.slice(0, -1).join("-");
}

function stationScopeLabel(station: Station, level: AnalysisChartGroupLevel): string {
  if (level === "station") return stationSnapshotLabel(station.stationName ?? station.name);
  if (level === "slope") return stationAreaLabel(station);
  if (level === "region") return stationRegionKey(station);
  return stationRegionGroupKey(station) ?? stationRegionKey(station);
}

function scopeLevelLabel(level: AnalysisScopeLevel): string {
  if (level === "slope") return "边坡监测网络";
  if (level === "region") return "部署区域";
  if (level === "regionGroup") return "区域组";
  return "全部区域";
}

function chartGroupLevelLabel(level: AnalysisChartGroupLevel, stationCount: number): string {
  if (level === "station") return "各分节点";
  if (level === "slope") return "边坡监测网络";
  if (level === "region") return "部署区域";
  return "区域组";
}

function analysisChartScopeLabel(
  activeLevel: AnalysisScopeLevel | undefined,
  groupLevel: AnalysisChartGroupLevel,
  stationCount: number
): string {
  if (activeLevel === "all") return "全部区域";
  return chartGroupLevelLabel(groupLevel, stationCount);
}

function compactSoilSeriesName(label: string, metric: "temperature" | "moisture"): string {
  const suffix = metric === "temperature" ? "温度" : "水分";
  return label.length <= 2 ? `${label}${suffix}` : `${label} ${suffix}`;
}

function compactTiltSeriesName(label: string, axis: "x" | "y"): string {
  const suffix = axis === "x" ? "倾角X" : "倾角Y";
  return label.length <= 2 ? `${label}${suffix}` : `${label} ${suffix}`;
}

function fieldNodeLegendLabel(device: Device): string {
  const installLabel = device.installLabel?.trim();
  const fieldNodeMatch = installLabel ? /^FIELD-NODE-([A-Z0-9]+)(?:[-_].*)?$/i.exec(installLabel) : null;
  if (fieldNodeMatch?.[1]) return `${fieldNodeMatch[1].toUpperCase()} 分节点`;

  const nodeCode = device.nodeCode?.trim();
  const nodeCodeMatch = nodeCode ? /-(?:\d+-)?([A-Z0-9]+)(?:-[A-Z]+)?$/i.exec(nodeCode) : null;
  if (nodeCodeMatch?.[1]) return `${nodeCodeMatch[1].toUpperCase()} 分节点`;

  const displayName = device.displayName?.trim();
  const displayMatch = displayName ? /\bNode\s+([A-Z0-9]+)\b/i.exec(displayName) : null;
  if (displayMatch?.[1]) return `${displayMatch[1].toUpperCase()} 分节点`;

  return formatInstallLabelDisplay(device.installLabel, displayName || device.name);
}

function buildNodeTrendSources(devices: Device[]): AnalysisTrendSource[] {
  return devices
    .map((device) => ({
      key: device.id,
      label: fieldNodeLegendLabel(device),
      devices: [device]
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildGroupedTrendSources(groups: AnalysisChartGroup[], devices: Device[]): AnalysisTrendSource[] {
  return groups
    .map((group) => {
      const stationIds = new Set(group.stationIds);
      return {
        key: group.key,
        label: group.label,
        devices: devices.filter((device) => stationIds.has(device.stationId))
      };
    })
    .filter((source) => source.devices.length > 0);
}

function chartGroupKey(station: Station, level: AnalysisChartGroupLevel): string {
  if (level === "station") return station.id;
  if (level === "slope") return `slope:${stationSlopeKey(station)}`;
  if (level === "region") return `region:${stationRegionKey(station)}`;
  return `regionGroup:${stationRegionGroupKey(station) ?? stationRegionKey(station)}`;
}

function distinctChartGroupCount(stations: Station[], level: AnalysisChartGroupLevel): number {
  return new Set(stations.map((station) => chartGroupKey(station, level))).size;
}

function chooseChartGroupLevel(scopeLevel: AnalysisScopeLevel | undefined, stations: Station[]): AnalysisChartGroupLevel {
  if (scopeLevel === "slope") return "station";

  const regionCount = distinctChartGroupCount(stations, "region");
  const regionGroupCount = distinctChartGroupCount(stations, "regionGroup");

  if (scopeLevel === "region") return "region";
  if (scopeLevel === "regionGroup") {
    return "region";
  }
  if (scopeLevel === "all") {
    if (regionGroupCount > 1) return "regionGroup";
    if (regionCount > 1) return "region";
    return "region";
  }
  return "station";
}

function buildChartGroups(stations: Station[], level: AnalysisChartGroupLevel): AnalysisChartGroup[] {
  const buckets = new Map<string, AnalysisChartGroup>();

  for (const station of stations) {
    const key = chartGroupKey(station, level);
    const bucket =
      buckets.get(key) ??
      (() => {
        const group: AnalysisChartGroup = {
          key,
          label: stationScopeLabel(station, level),
          level,
          stationIds: []
        };
        buckets.set(key, group);
        return group;
      })();
    bucket.stationIds.push(station.id);
  }

  return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function analyzeAnomaly(row: LiveSnapshotRow, activeTiltAlert?: AlertSummaryItem): AnomalyAnalysis {
  const batteryPct = row.batteryPct;
  const tiltX = row.tiltXDeg;
  const tiltY = row.tiltYDeg;
  const staleMinutes = dayjs().diff(dayjs(row.updatedAt), "minute");

  if (row.device.status === "offline") {
    return { isAnomaly: true, level: "critical", kind: "availability", message: "离线：无数据上报" };
  }
  if (staleMinutes > 30) {
    return {
      isAnomaly: true,
      level: "warn",
      kind: "availability",
      message: `数据超时：${String(staleMinutes)} 分钟未更新`
    };
  }
  if (activeTiltAlert) {
    return {
      isAnomaly: true,
      level: activeTiltAlert.severity === "critical" ? "critical" : "warn",
      kind: "tilt",
      message: `${alertSeverityLabel(activeTiltAlert.severity)}：${activeTiltAlert.title || `相对基线倾角 ${tiltX?.toFixed(2) ?? "--"}/${tiltY?.toFixed(2) ?? "--"}°`}`
    };
  }
  if (row.device.status === "warning") {
    return {
      isAnomaly: true,
      level: "warn",
      kind: "device",
      message: "设备状态为预警，需复核现场链路与测值"
    };
  }
  if (batteryPct != null && batteryPct <= 20) {
    return {
      isAnomaly: true,
      level: "warn",
      kind: "battery",
      message: `低电量：battery_pct=${batteryPct.toFixed(0)}%`
    };
  }
  return { isAnomaly: false, level: "info", kind: "device", message: "状态正常" };
}

function buildTimeBuckets(count: number, unit: TelemetryBucketUnit, labelFormat: string): TimeBucketValue[] {
  const end = dayjs().startOf(unit);
  const start = end.subtract(count - 1, unit);
  return Array.from({ length: count }, (_, idx) => {
    const point = start.add(idx, unit);
    return {
      key: point.toISOString(),
      label: point.format(labelFormat),
      value: 0
    };
  });
}

function buildRealtimeTrendRange(range: RealtimeTrendRangeKey): {
  label: string;
  buckets: TimeBucketValue[];
  unit: TelemetryBucketUnit;
  interval: TelemetrySeriesInterval;
  startTime: string;
  endTime: string;
} {
  const now = dayjs();
  const config =
    range === "60s"
      ? { count: 60, unit: "second" as const, labelFormat: "HH:mm:ss", interval: "raw" as const }
      : range === "10m"
        ? { count: 10, unit: "minute" as const, labelFormat: "HH:mm", interval: "1m" as const }
        : range === "1h"
          ? { count: 60, unit: "minute" as const, labelFormat: "HH:mm", interval: "1m" as const }
          : { count: 24, unit: "hour" as const, labelFormat: "HH:00", interval: "1h" as const };
  const buckets = buildTimeBuckets(config.count, config.unit, config.labelFormat);
  const start = dayjs(buckets[0]?.key ?? now.subtract(config.count - 1, config.unit).startOf(config.unit).toISOString());
  const end =
    range === "60s"
      ? now
      : dayjs(buckets[buckets.length - 1]?.key ?? now.startOf(config.unit).toISOString()).endOf(config.unit);
  const label = REALTIME_TREND_RANGE_OPTIONS.find((option) => option.key === range)?.label ?? "近 24 小时";
  return {
    label,
    buckets,
    unit: config.unit,
    interval: config.interval,
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function aggregateTelemetryBuckets(
  buckets: TimeBucketValue[],
  seriesList: Array<Array<{ ts: string; value: number }>>,
  unit: TelemetryBucketUnit
): TimeBucketValue[] {
  const totals = new Map(buckets.map((bucket) => [bucket.key, 0]));
  for (const series of seriesList) {
    for (const point of series) {
      const key = dayjs(point.ts).startOf(unit).toISOString();
      if (!totals.has(key)) continue;
      totals.set(key, (totals.get(key) ?? 0) + point.value);
    }
  }
  return buckets.map((bucket) => ({
    ...bucket,
    value: Number(((totals.get(bucket.key) ?? 0) as number).toFixed(2))
  }));
}

function averageTelemetryBuckets(
  buckets: TimeBucketValue[],
  seriesList: TelemetrySeriesPoint[],
  unit: TelemetryBucketUnit
): Array<{ key: string; label: string; value: number | null }> {
  const totals = new Map(buckets.map((bucket) => [bucket.key, { sum: 0, count: 0 }]));
  for (const point of seriesList) {
    const key = dayjs(point.ts).startOf(unit).toISOString();
    const slot = totals.get(key);
    if (!slot) continue;
    slot.sum += point.value;
    slot.count += 1;
  }
  return buckets.map((bucket) => {
    const slot = totals.get(bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      value: slot?.count ? Number((slot.sum / slot.count).toFixed(2)) : null
    };
  });
}

async function loadTelemetrySeriesWithRetry(
  load: () => Promise<TelemetrySeriesPoint[]>
): Promise<TelemetrySeriesPoint[]> {
  try {
    return await load();
  } catch {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 200));
    try {
      return await load();
    } catch {
      return [];
    }
  }
}

function buildHistoryRange(range: HistoryRangeKey): {
  buckets: TimeBucketValue[];
  unit: "hour" | "day";
  interval: "1h" | "1d";
  startTime: string;
  endTime: string;
} {
  const unit = range === "7d" ? "day" : "hour";
  const buckets = range === "7d" ? buildTimeBuckets(7, "day", "MM-DD") : buildTimeBuckets(24, "hour", "HH:00");
  const start = dayjs(buckets[0]?.key ?? dayjs().subtract(range === "7d" ? 6 : 23, unit).startOf(unit).toISOString());
  const end = dayjs(buckets[buckets.length - 1]?.key ?? dayjs().startOf(unit).toISOString()).endOf(unit);

  return {
    buckets,
    unit,
    interval: range === "7d" ? "1d" : "1h",
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function formatHistoryValue(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = unit === "°" ? 3 : unit === "mm" ? 2 : unit === "μS/cm" ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

function summarizeHistoryGroups(groups: HistoryTrendGroup[]): {
  latest: number | null;
  max: number | null;
  min: number | null;
  avg: number | null;
  pointCount: number;
  activeGroupCount: number;
} {
  const values = groups.flatMap((group) => group.buckets.map((bucket) => bucket.value).filter((value): value is number => value != null));
  const latestGroup = groups
    .filter((group) => group.latestValue != null && group.latestTs)
    .sort((a, b) => dayjs(b.latestTs ?? 0).valueOf() - dayjs(a.latestTs ?? 0).valueOf())[0];
  const pointCount = groups.reduce((sum, group) => sum + group.pointCount, 0);

  return {
    latest: latestGroup?.latestValue ?? null,
    max: values.length ? Math.max(...values) : null,
    min: values.length ? Math.min(...values) : null,
    avg: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    pointCount,
    activeGroupCount: groups.filter((group) => group.buckets.some((bucket) => bucket.value != null)).length
  };
}

export function AnalysisPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const terrainQuality = useSettingsStore((s) => s.terrainQuality);
  const user = useAuthStore((s) => s.user);
  const [mapType, setMapType] = useState<MapType>("卫星图");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceStates, setDeviceStates] = useState<Record<string, DeviceStateSnapshot>>({});
  const [now, setNow] = useState<Date>(() => new Date());
  const [online, setOnline] = useState<boolean>(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [mapViewSeed, setMapViewSeed] = useState(0);
  const [stationPanelExpanded, setStationPanelExpanded] = useState(false);
  const [stationPanelPage, setStationPanelPage] = useState(0);
  const [stationPanelPlaying, setStationPanelPlaying] = useState(true);
  const [rainfallTrend, setRainfallTrend] = useState<TimeBucketValue[]>([]);
  const [soilTrendGroups, setSoilTrendGroups] = useState<SoilTrendGroup[]>([]);
  const [soilTrendLoading, setSoilTrendLoading] = useState(false);
  const [conductivityTrendGroups, setConductivityTrendGroups] = useState<ConductivityTrendGroup[]>([]);
  const [conductivityTrendLoading, setConductivityTrendLoading] = useState(false);
  const [tiltTrendGroups, setTiltTrendGroups] = useState<TiltTrendGroup[]>([]);
  const [tiltTrendLoading, setTiltTrendLoading] = useState(false);
  const [mapBottomMode, setMapBottomMode] = useState<MapBottomMode>("history");
  const [historyMetricKey, setHistoryMetricKey] = useState<HistoryMetricKey>("tilt_x_deg");
  const [historyRange, setHistoryRange] = useState<HistoryRangeKey>("24h");
  const [realtimeTrendRange, setRealtimeTrendRange] = useState<RealtimeTrendRangeKey>("24h");
  const [historyTrendGroups, setHistoryTrendGroups] = useState<HistoryTrendGroup[]>([]);
  const [historyTrendLoading, setHistoryTrendLoading] = useState(false);
  const fieldAlarmStatus = useFieldAlarmStore((state) => state.status);
  const setFieldAlarmStatus = useFieldAlarmStore((state) => state.setStatus);
  const applyFieldAlarmActionResult = useFieldAlarmStore((state) => state.applyActionResult);
  const [trendRefreshSeq, setTrendRefreshSeq] = useState(0);
  const [fieldAlarmReviewOpen, setFieldAlarmReviewOpen] = useState(false);
  const [fieldAlarmReviewNote, setFieldAlarmReviewNote] = useState("现场已确认，进入人工复核。");
  const [fieldAlarmReviewConclusion, setFieldAlarmReviewConclusion] = useState<ReviewConclusion>("confirmed_risk");
  const [fieldAlarmReviewSubmitting, setFieldAlarmReviewSubmitting] = useState(false);
  const [fieldAlarmReviewError, setFieldAlarmReviewError] = useState("");
  const [fieldAlarmEvents, setFieldAlarmEvents] = useState<AlertLifecycleEvent[]>([]);
  const [reviewArchiveOpen, setReviewArchiveOpen] = useState(false);
  const [reviewArchiveLoading, setReviewArchiveLoading] = useState(false);
  const [reviewArchiveError, setReviewArchiveError] = useState("");
  const [reviewArchiveItems, setReviewArchiveItems] = useState<ReviewArchiveItem[]>([]);
  const [competitionSetupOpen, setCompetitionSetupOpen] = useState(false);
  const [competitionCaptureBusy, setCompetitionCaptureBusy] = useState(false);
  const [competitionCaptureError, setCompetitionCaptureError] = useState("");
  const [competitionThresholds, setCompetitionThresholds] = useState<CompetitionThresholdForm>(
    DEFAULT_COMPETITION_THRESHOLDS
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const loadData = useCallback(
    async (opts?: { silent?: boolean; refreshTrends?: boolean }) => {
      const silent = opts?.silent ?? false;
      const refreshTrends = opts?.refreshTrends ?? true;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      if (!silent) setLoading(true);
      else setRefreshing(true);

      try {
        const [s, d, fieldAlarmResult] = await Promise.all([
          api.stations.list(),
          api.devices.list(),
          api.fieldAlarm.getStatus().catch(() => null)
        ]);
        if (abort.signal.aborted) return;
        const formalDevices = d.filter((device) => isFormalIdentityClass(device.identityClass));
        const formalStationIds = new Set(formalDevices.map((device) => device.stationId));
        const formalStations = s.filter((station) => formalStationIds.has(station.id));
        const stateSettled = await Promise.allSettled(
          formalDevices.map(async (device) => [device.id, await api.devices.getState({ deviceId: device.id })] as const)
        );
        if (abort.signal.aborted) return;
        const nextStates: Record<string, DeviceStateSnapshot> = {};
        for (const entry of stateSettled) {
          if (entry.status !== "fulfilled") continue;
          const [deviceId, snapshot] = entry.value;
          nextStates[deviceId] = snapshot;
        }
        setStations(formalStations);
        setDevices(formalDevices);
        setDeviceStates(nextStates);
        setFieldAlarmStatus(fieldAlarmResult);
        setLastUpdate(formatBeijingDateTime(new Date()));
        if (refreshTrends) setTrendRefreshSeq((value) => value + 1);
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, setFieldAlarmStatus]
  );

  const refreshFieldAlarmStatus = useCallback(async () => {
    try {
      setFieldAlarmStatus(await api.fieldAlarm.getStatus());
    } catch {
      // Keep the accepted local transition; the regular refresh loop will retry.
    }
  }, [api, setFieldAlarmStatus]);

  useEffect(() => {
    void loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    let refreshCount = 0;
    const t = window.setInterval(() => {
      refreshCount += 1;
      void loadData({ silent: true, refreshTrends: refreshCount % 3 === 0 });
    }, 5000);
    return () => {
      window.clearInterval(t);
    };
  }, [autoRefresh, loadData]);

  const areaOptions = useMemo<AnalysisAreaOption[]>(() => {
    const bucketsByLevel: Record<Exclude<AnalysisScopeLevel, "all">, Map<string, AnalysisAreaOption>> = {
      slope: new Map(),
      region: new Map(),
      regionGroup: new Map()
    };

    const addScope = (level: Exclude<AnalysisScopeLevel, "all">, rawKey: string | null, label: string, detail: string, stationId: string) => {
      const scopeKey = normalizeText(rawKey);
      if (!scopeKey) return;
      const key = `scope:${level}:${scopeKey}`;
      const bucket =
        bucketsByLevel[level].get(key) ??
        (() => {
          const option: AnalysisAreaOption = {
            key,
            label,
            detail,
            level,
            stationIds: []
          };
          bucketsByLevel[level].set(key, option);
          return option;
        })();
      bucket.stationIds.push(stationId);
    };

    for (const station of stations) {
      const slopeKey = stationSlopeKey(station);
      const regionKey = stationRegionKey(station);
      const regionGroupKey = stationRegionGroupKey(station);

      addScope("slope", slopeKey, stationAreaLabel(station), slopeKey, station.id);
      addScope("region", regionKey, regionKey, regionKey, station.id);
      addScope("regionGroup", regionGroupKey, regionGroupKey ?? "", regionGroupKey ?? "", station.id);
    }

    const sortOptions = (items: AnalysisAreaOption[]) => items.sort((a, b) => a.label.localeCompare(b.label));
    const scopeOptions = [
      ...sortOptions(Array.from(bucketsByLevel.slope.values())),
      ...sortOptions(Array.from(bucketsByLevel.region.values())),
      ...sortOptions(Array.from(bucketsByLevel.regionGroup.values()))
    ];

    if (stations.length) {
      scopeOptions.push({
        key: "scope:all",
        label: "全部区域",
        detail: "全部正式接入分节点",
        level: "all",
        stationIds: stations.map((station) => station.id)
      });
    }

    return scopeOptions;
  }, [stations]);

  const areaNodeCountByKey = useMemo(() => {
    return new Map(
      areaOptions.map((option) => {
        const stationIds = new Set(option.stationIds);
        return [option.key, devices.filter((device) => stationIds.has(device.stationId)).length] as const;
      })
    );
  }, [areaOptions, devices]);

  useEffect(() => {
    if (!areaOptions.length) {
      if (selectedAreaKey != null) setSelectedAreaKey(null);
      return;
    }
    const firstAreaKey = areaOptions[0]?.key;
    if (firstAreaKey && (!selectedAreaKey || !areaOptions.some((option) => option.key === selectedAreaKey))) {
      setSelectedAreaKey(firstAreaKey);
    }
  }, [areaOptions, selectedAreaKey]);

  const activeArea = useMemo(
    () => areaOptions.find((option) => option.key === selectedAreaKey) ?? areaOptions[0] ?? null,
    [areaOptions, selectedAreaKey]
  );

  const visibleStationIds = useMemo(() => {
    return new Set(activeArea?.stationIds ?? stations.map((station) => station.id));
  }, [activeArea, stations]);

  const visibleStations = useMemo(
    () => stations.filter((station) => visibleStationIds.has(station.id)),
    [stations, visibleStationIds]
  );

  const visibleDevices = useMemo(
    () => devices.filter((device) => visibleStationIds.has(device.stationId)),
    [devices, visibleStationIds]
  );

  const chartGroupLevel = useMemo(
    () => chooseChartGroupLevel(activeArea?.level, visibleStations),
    [activeArea?.level, visibleStations]
  );

  const chartGroups = useMemo(
    () => buildChartGroups(visibleStations, chartGroupLevel),
    [chartGroupLevel, visibleStations]
  );

  const useNodeLevelTrend = activeArea?.level === "slope";
  const chartScopeLabel = analysisChartScopeLabel(activeArea?.level, chartGroupLevel, visibleStations.length);
  const historyMetric = useMemo(
    () => HISTORY_METRICS.find((metric) => metric.key === historyMetricKey) ?? HISTORY_METRICS[0]!,
    [historyMetricKey]
  );
  const historyChartGroups = useMemo(() => {
    if (!selectedStationIds.length) return chartGroups;
    const selectedSet = new Set(selectedStationIds);
    const selectedVisibleStations = visibleStations.filter((station) => selectedSet.has(station.id));
    return buildChartGroups(selectedVisibleStations, "station");
  }, [chartGroups, selectedStationIds, visibleStations]);
  const historyScopeLabel = selectedStationIds.length ? "已选分节点" : chartScopeLabel;
  const realtimeTrendWindow = useMemo(() => buildRealtimeTrendRange(realtimeTrendRange), [realtimeTrendRange]);

  useEffect(() => {
    setSelectedStationIds((prev) => prev.filter((stationId) => visibleStationIds.has(stationId)));
  }, [visibleStationIds]);

  useEffect(() => {
    const rainDevices = visibleDevices.filter((device) => device.type === "rain");
    const { buckets, unit, interval, startTime, endTime } = realtimeTrendWindow;
    if (!rainDevices.length) {
      setRainfallTrend(buckets);
      return;
    }

    const abort = new AbortController();

    const loadRainfall = async () => {
      try {
        const rainfallSeries = await Promise.all(
          rainDevices.map((device) =>
            loadTelemetrySeriesWithRetry(() =>
              api.telemetry.getSeries({
                deviceId: device.id,
                sensorKey: "rainfall_mm",
                startTime,
                endTime,
                interval
              })
            )
          )
        );

        if (abort.signal.aborted) return;

        setRainfallTrend(aggregateTelemetryBuckets(buckets, rainfallSeries, unit));
      } catch {
        if (abort.signal.aborted) return;
        setRainfallTrend(buckets);
      }
    };

    void loadRainfall();
    return () => abort.abort();
  }, [api, realtimeTrendWindow, trendRefreshSeq, visibleDevices]);

  useEffect(() => {
    if (mapType === "3D" || mapType === "视频") {
      setSelectedStationIds([]);
    }
  }, [mapType]);

  useEffect(() => {
    const soilDevices = visibleDevices.filter((device) => isSoilSensorDevice(device, deviceStates[device.id]));
    const { buckets, unit, interval, startTime, endTime } = realtimeTrendWindow;
    const trendSources = useNodeLevelTrend
      ? buildNodeTrendSources(soilDevices)
      : buildGroupedTrendSources(chartGroups, soilDevices);
    if (!trendSources.length) {
      setSoilTrendGroups([]);
      setSoilTrendLoading(false);
      return;
    }

    const abort = new AbortController();

    const loadSoilTrend = async () => {
      setSoilTrendLoading(true);
      try {
        const nextGroups = await Promise.all(
          trendSources.map(async (source) => {
            const [temperatureSeries, moistureSeries] = await Promise.all([
              Promise.all(
                source.devices.map((device) =>
                  loadTelemetrySeriesWithRetry(() =>
                    api.telemetry.getSeries({
                      deviceId: device.id,
                      sensorKey: "soil_temperature_c",
                      startTime,
                      endTime,
                      interval
                    })
                  )
                )
              ),
              Promise.all(
                source.devices.map((device) =>
                  loadTelemetrySeriesWithRetry(() =>
                    api.telemetry.getSeries({
                      deviceId: device.id,
                      sensorKey: "soil_moisture_pct",
                      startTime,
                      endTime,
                      interval
                    })
                  )
                )
              )
            ]);
            const temperatureBuckets = averageTelemetryBuckets(buckets, temperatureSeries.flat(), unit);
            const moistureBuckets = averageTelemetryBuckets(buckets, moistureSeries.flat(), unit);
            return {
              key: source.key,
              label: source.label,
              buckets: buckets.map((bucket, idx) => ({
                key: bucket.key,
                label: bucket.label,
                temperatureC: temperatureBuckets[idx]?.value ?? null,
                moisturePct: moistureBuckets[idx]?.value ?? null
              }))
            };
          })
        );

        if (!abort.signal.aborted) {
          setSoilTrendGroups(nextGroups);
        }
      } finally {
        if (!abort.signal.aborted) {
          setSoilTrendLoading(false);
        }
      }
    };

    void loadSoilTrend();
    return () => abort.abort();
  }, [api, chartGroups, deviceStates, realtimeTrendWindow, trendRefreshSeq, useNodeLevelTrend, visibleDevices]);

  useEffect(() => {
    const conductivityDevices = visibleDevices.filter((device) => {
      const snapshot = deviceStates[device.id];
      return isFormalFieldNode(device) || isSoilSensorDevice(device, snapshot);
    });
    const { buckets, unit, interval, startTime, endTime } = realtimeTrendWindow;
    const trendSources = useNodeLevelTrend
      ? buildNodeTrendSources(conductivityDevices)
      : buildGroupedTrendSources(chartGroups, conductivityDevices);
    if (!trendSources.length) {
      setConductivityTrendGroups([]);
      setConductivityTrendLoading(false);
      return;
    }

    const abort = new AbortController();

    const loadConductivityTrend = async () => {
      setConductivityTrendLoading(true);
      try {
        const nextGroups = await Promise.all(
          trendSources.map(async (source) => {
            const conductivitySeries = await Promise.all(
              source.devices.map((device) =>
                loadTelemetrySeriesWithRetry(() =>
                  api.telemetry.getSeries({
                    deviceId: device.id,
                    sensorKey: "electrical_conductivity_us_cm",
                    startTime,
                    endTime,
                    interval
                  })
                )
              )
            );
            return {
              key: source.key,
              label: source.label,
              buckets: averageTelemetryBuckets(buckets, conductivitySeries.flat(), unit)
            };
          })
        );

        if (!abort.signal.aborted) {
          setConductivityTrendGroups(nextGroups);
        }
      } finally {
        if (!abort.signal.aborted) {
          setConductivityTrendLoading(false);
        }
      }
    };

    void loadConductivityTrend();
    return () => abort.abort();
  }, [api, chartGroups, deviceStates, realtimeTrendWindow, trendRefreshSeq, useNodeLevelTrend, visibleDevices]);

  useEffect(() => {
    const tiltDevices = visibleDevices.filter((device) => isTiltSensorDevice(device, deviceStates[device.id]));
    const { buckets, unit, interval, startTime, endTime } = realtimeTrendWindow;
    const trendSources = useNodeLevelTrend
      ? buildNodeTrendSources(tiltDevices)
      : buildGroupedTrendSources(chartGroups, tiltDevices);
    if (!trendSources.length) {
      setTiltTrendGroups([]);
      setTiltTrendLoading(false);
      return;
    }

    const abort = new AbortController();

    const loadTiltTrend = async () => {
      setTiltTrendLoading(true);
      try {
        const nextGroups = await Promise.all(
          trendSources.map(async (source) => {
            const [tiltXSeries, tiltYSeries] = await Promise.all([
              Promise.all(
                source.devices.map((device) =>
                  loadTelemetrySeriesWithRetry(() =>
                    api.telemetry.getSeries({
                      deviceId: device.id,
                      sensorKey: "tilt_x_deg",
                      startTime,
                      endTime,
                      interval
                    })
                  )
                )
              ),
              Promise.all(
                source.devices.map((device) =>
                  loadTelemetrySeriesWithRetry(() =>
                    api.telemetry.getSeries({
                      deviceId: device.id,
                      sensorKey: "tilt_y_deg",
                      startTime,
                      endTime,
                      interval
                    })
                  )
                )
              )
            ]);
            const tiltXBuckets = averageTelemetryBuckets(buckets, tiltXSeries.flat(), unit);
            const tiltYBuckets = averageTelemetryBuckets(buckets, tiltYSeries.flat(), unit);
            return {
              key: source.key,
              label: source.label,
              buckets: buckets.map((bucket, idx) => ({
                key: bucket.key,
                label: bucket.label,
                tiltXDeg: tiltXBuckets[idx]?.value ?? null,
                tiltYDeg: tiltYBuckets[idx]?.value ?? null
              }))
            };
          })
        );

        if (!abort.signal.aborted) {
          setTiltTrendGroups(nextGroups);
        }
      } finally {
        if (!abort.signal.aborted) {
          setTiltTrendLoading(false);
        }
      }
    };

    void loadTiltTrend();
    return () => abort.abort();
  }, [api, chartGroups, deviceStates, realtimeTrendWindow, trendRefreshSeq, useNodeLevelTrend, visibleDevices]);

  useEffect(() => {
    const { buckets, unit, interval, startTime, endTime } = buildHistoryRange(historyRange);
    const matchedDevices = visibleDevices.filter((device) => historyMetric.deviceMatches(device, deviceStates[device.id]));
    if (!historyChartGroups.length || !matchedDevices.length) {
      setHistoryTrendGroups([]);
      setHistoryTrendLoading(false);
      return;
    }

    const abort = new AbortController();

    const loadHistoryTrend = async () => {
      setHistoryTrendLoading(true);
      try {
        const nextGroups = await Promise.all(
          historyChartGroups.map(async (group) => {
            const stationIds = new Set(group.stationIds);
            const groupDevices = matchedDevices.filter((device) => stationIds.has(device.stationId));
            if (!groupDevices.length) {
              return {
                key: group.key,
                label: group.label,
                buckets: buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: null })),
                pointCount: 0,
                latestValue: null,
                latestTs: null
              };
            }

            const seriesList = await Promise.all(
              groupDevices.map((device) =>
                loadTelemetrySeriesWithRetry(() =>
                  api.telemetry.getSeries({
                    deviceId: device.id,
                    sensorKey: historyMetric.key,
                    startTime,
                    endTime,
                    interval
                  })
                )
              )
            );
            const flatSeries = seriesList
              .flat()
              .filter((point) => typeof point.value === "number" && Number.isFinite(point.value));
            const latestPoint = flatSeries
              .slice()
              .sort((a, b) => dayjs(b.ts).valueOf() - dayjs(a.ts).valueOf())[0];
            const bucketed =
              historyMetric.aggregation === "sum"
                ? (() => {
                    const bucketCounts = new Map(buckets.map((bucket) => [bucket.key, 0]));
                    for (const point of flatSeries) {
                      const key = dayjs(point.ts).startOf(unit).toISOString();
                      if (bucketCounts.has(key)) bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
                    }
                    return aggregateTelemetryBuckets(buckets, seriesList, unit).map((bucket) => ({
                      key: bucket.key,
                      label: bucket.label,
                      value: (bucketCounts.get(bucket.key) ?? 0) > 0 ? bucket.value : null
                    }));
                  })()
                : averageTelemetryBuckets(buckets, flatSeries, unit);

            return {
              key: group.key,
              label: group.label,
              buckets: bucketed.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.value })),
              pointCount: flatSeries.length,
              latestValue: latestPoint?.value ?? null,
              latestTs: latestPoint?.ts ?? null
            };
          })
        );

        if (!abort.signal.aborted) {
          setHistoryTrendGroups(nextGroups);
        }
      } finally {
        if (!abort.signal.aborted) {
          setHistoryTrendLoading(false);
        }
      }
    };

    void loadHistoryTrend();
    return () => abort.abort();
  }, [api, deviceStates, historyChartGroups, historyMetric, historyRange, trendRefreshSeq, visibleDevices]);

  const stats = useMemo(() => {
    const online = visibleDevices.filter((d) => d.status === "online").length;
    const warn = visibleDevices.filter((d) => d.status === "warning").length;
    const offline = visibleDevices.filter((d) => d.status === "offline").length;
    return {
      nodes: visibleDevices.length,
      devices: visibleDevices.length,
      online,
      warn,
      offline
    };
  }, [visibleDevices]);

  const chartBase = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      grid: { left: "10%", right: "6%", top: 42, bottom: 30, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      xAxis: {
        type: "category",
        data: Array.from({ length: 12 }, (_, i) => String(i + 1)),
        ...darkAxis()
      },
      yAxis: { type: "value", ...darkAxis() }
    };
  }, []);

  const historySummary = useMemo(() => summarizeHistoryGroups(historyTrendGroups), [historyTrendGroups]);
  const historyTrendHasSeries = useMemo(
    () => historyTrendGroups.some((group) => group.buckets.some((bucket) => bucket.value != null)),
    [historyTrendGroups]
  );
  const historyTrendOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const groups = historyTrendGroups.filter((group) => group.buckets.some((bucket) => bucket.value != null));
    const labels = groups[0]?.buckets.map((bucket) => bucket.label) ?? buildHistoryRange(historyRange).buckets.map((bucket) => bucket.label);
    const colors = ["#22d3ee", "#34d399", "#f59e0b", "#a78bfa", "#f472b6", "#60a5fa", "#fb7185", "#2dd4bf"];

    return {
      ...chartBase,
      grid: { left: "1%", right: "1%", top: 42, bottom: 2, containLabel: true },
      tooltip: {
        trigger: "axis",
        ...darkTooltip(),
        valueFormatter: (value: number | string | null | undefined) => {
          const numeric = typeof value === "number" ? value : Number(value);
          return Number.isFinite(numeric) ? formatHistoryValue(numeric, historyMetric.unit) : "—";
        }
      },
      legend: {
        type: groups.length > 6 ? "scroll" : "plain",
        top: 0,
        left: "center",
        width: "92%",
        textStyle: { color: "rgba(226, 232, 240, 0.9)", fontSize: 11, fontWeight: 800 },
        itemWidth: 10,
        itemHeight: 8,
        itemGap: 8,
        pageIconColor: "rgba(34, 211, 238, 0.86)",
        pageTextStyle: { color: "rgba(226, 232, 240, 0.76)" }
      },
      xAxis: {
        ...baseXAxis,
        data: labels,
        boundaryGap: false,
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: historyMetric.unit,
        nameGap: 7,
        ...darkAxis(),
        nameTextStyle: { color: "rgba(125, 211, 252, 0.74)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3, formatter: "{value}" }
      },
      series: groups.map((group, idx) => {
        const color = colors[idx % colors.length] ?? historyMetric.color;
        return {
          name: group.label,
          type: "line",
          smooth: true,
          showSymbol: false,
          connectNulls: false,
          data: group.buckets.map((bucket) => bucket.value == null ? null : Number(bucket.value.toFixed(3))),
          lineStyle: { width: 2.25, color },
          itemStyle: { color },
          areaStyle: { color: `${color}16` }
        };
      })
    };
  }, [chartBase, historyMetric, historyRange, historyTrendGroups]);

  const liveSnapshotRows = useMemo(() => {
    return visibleDevices
      .map((device) => {
        const snapshot = deviceStates[device.id] ?? null;
        const metrics = snapshot?.metrics ?? {};
        const soilTemperatureC = readMetricNumber(metrics, "soil_temperature_c");
        const soilMoisturePct = readMetricNumber(metrics, "soil_moisture_pct");
        return {
          device,
          updatedAt: snapshot?.updatedAt ?? device.lastSeenAt,
          temperatureC: readMetricNumber(metrics, "temperature_c"),
          humidityPct: readMetricNumber(metrics, "humidity_pct"),
          soilTemperatureC: soilTemperatureC ?? readMetricNumber(metrics, "temperature_c"),
          soilMoisturePct: soilMoisturePct ?? readMetricNumber(metrics, "humidity_pct"),
          conductivityUsCm: readMetricNumber(metrics, "electrical_conductivity_us_cm"),
          batteryPct: readMetricNumber(metrics, "battery_pct"),
          tiltXDeg: readMetricNumber(metrics, "tilt_x_deg"),
          tiltYDeg: readMetricNumber(metrics, "tilt_y_deg"),
          accelX: readMetricNumber(metrics, "accel_x_g"),
          accelY: readMetricNumber(metrics, "accel_y_g"),
          accelZ: readMetricNumber(metrics, "accel_z_g"),
          warningFlag: readMetricBoolean(metrics, "warning_flag")
        };
      })
      .sort((a, b) => {
        const aw = a.warningFlag ? 1 : 0;
        const bw = b.warningFlag ? 1 : 0;
        if (aw !== bw) return bw - aw;
        return a.device.name.localeCompare(b.device.name);
      });
  }, [deviceStates, visibleDevices]);

  const soilProfileRows = useMemo<SoilProfileRow[]>(() => {
    const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    if (useNodeLevelTrend) {
      return liveSnapshotRows
        .filter(
          (row) =>
            isSoilSensorDevice(row.device, deviceStates[row.device.id]) &&
            (row.soilTemperatureC != null || row.soilMoisturePct != null)
        )
        .map((row) => ({
          label: fieldNodeLegendLabel(row.device),
          soilTemperatureC: row.soilTemperatureC,
          soilMoisturePct: row.soilMoisturePct
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return chartGroups.map((group) => {
      const groupStationIds = new Set(group.stationIds);
      const stationRows = liveSnapshotRows.filter((row) => groupStationIds.has(row.device.stationId));
      const preferredRows = stationRows.filter((row) => isSoilSensorDevice(row.device, deviceStates[row.device.id]));
      const soilRows = (preferredRows.length ? preferredRows : stationRows).filter(
        (row) => row.soilTemperatureC != null || row.soilMoisturePct != null
      );

      return {
        label: group.label,
        soilTemperatureC: avg(soilRows.map((row) => row.soilTemperatureC).filter((value): value is number => value != null)),
        soilMoisturePct: avg(soilRows.map((row) => row.soilMoisturePct).filter((value): value is number => value != null))
      };
    });
  }, [chartGroups, deviceStates, liveSnapshotRows, useNodeLevelTrend]);

  const soilProfileOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const rows = soilProfileRows.filter((row) => row.soilTemperatureC != null || row.soilMoisturePct != null);
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 30, bottom: 0, containLabel: true },
      legend: {
        top: 2,
        left: "center",
        textStyle: { color: "rgba(226, 232, 240, 0.88)", fontSize: 11, fontWeight: 700 },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12
      },
      xAxis: {
        ...baseXAxis,
        data: rows.map((row) => row.label),
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: [
        {
          type: "value",
          name: "°C",
          min: (value: { min: number }) => Math.floor(value.min - 1),
          max: (value: { max: number }) => Math.ceil(value.max + 1),
          ...darkAxis(),
          nameTextStyle: { color: "rgba(125, 211, 252, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: "{value}" }
        },
        {
          type: "value",
          name: "%",
          min: -5,
          max: 100,
          ...darkAxis(),
          nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: (value: number) => (value < 0 ? "" : `${value}`) }
        }
      ],
      series: [
        {
          name: "温度 °C",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          data: rows.map((row) => row.soilTemperatureC == null ? null : Number(row.soilTemperatureC.toFixed(1))),
          lineStyle: { width: 2.4, color: "#22d3ee" },
          itemStyle: { color: "#22d3ee", borderColor: "rgba(224, 242, 254, 0.92)", borderWidth: 1 },
          areaStyle: { color: "rgba(34, 211, 238, 0.10)" }
        },
        {
          name: "水分 %",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          data: rows.map((row) => row.soilMoisturePct == null ? null : Number(row.soilMoisturePct.toFixed(1))),
          lineStyle: { width: 2.4, color: "#34d399" },
          itemStyle: { color: "#34d399", borderColor: "rgba(240, 253, 244, 0.9)", borderWidth: 1 },
          areaStyle: { color: "rgba(52, 211, 153, 0.08)" }
        }
      ]
    };
  }, [chartBase, soilProfileRows]);

  const conductivityProfileRows = useMemo<ConductivityProfileRow[]>(() => {
    const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    if (useNodeLevelTrend) {
      return liveSnapshotRows
        .filter((row) => isSoilSensorDevice(row.device, deviceStates[row.device.id]) && row.conductivityUsCm != null)
        .map((row) => ({
          label: fieldNodeLegendLabel(row.device),
          conductivityUsCm: row.conductivityUsCm
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return chartGroups.map((group) => {
      const groupStationIds = new Set(group.stationIds);
      const stationRows = liveSnapshotRows.filter((row) => groupStationIds.has(row.device.stationId));
      const conductivityRows = stationRows
        .filter((row) => isSoilSensorDevice(row.device, deviceStates[row.device.id]))
        .map((row) => row.conductivityUsCm)
        .filter((value): value is number => value != null);
      return {
        label: group.label,
        conductivityUsCm: avg(conductivityRows)
      };
    });
  }, [chartGroups, deviceStates, liveSnapshotRows, useNodeLevelTrend]);

  const conductivityProfileOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const rows = conductivityProfileRows.filter((row) => row.conductivityUsCm != null);
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 30, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      xAxis: {
        ...baseXAxis,
        show: rows.length > 0,
        data: rows.map((row) => row.label),
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: "μS/cm",
        show: rows.length > 0,
        ...darkAxis(),
        nameTextStyle: { color: "rgba(251, 191, 36, 0.72)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3 }
      },
      series: rows.length
        ? [
            {
              name: "电导率",
              type: "bar",
              data: rows.map((row) => row.conductivityUsCm == null ? null : Number(row.conductivityUsCm.toFixed(0))),
              barWidth: 16,
              itemStyle: { color: "rgba(251, 191, 36, 0.82)" }
            }
          ]
        : [],
      graphic: rows.length
        ? undefined
        : {
            type: "text",
            left: "center",
            top: "middle",
            silent: true,
            style: {
              text: "当前节点未提供土壤电导率数据\n传感器未启用该指标",
              fill: "rgba(203, 213, 225, 0.72)",
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 20,
              textAlign: "center"
            }
          }
    };
  }, [chartBase, conductivityProfileRows]);

  const conductivityTrendHasSeries = useMemo(
    () => conductivityTrendGroups.some((group) => group.buckets.some((bucket) => bucket.value != null)),
    [conductivityTrendGroups]
  );

  const conductivityTrendOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const groups = conductivityTrendGroups.filter((group) => group.buckets.some((bucket) => bucket.value != null));
    const labels = groups[0]?.buckets.map((bucket) => bucket.label) ?? realtimeTrendWindow.buckets.map((bucket) => bucket.label);
    const colors = ["#f59e0b", "#22d3ee", "#34d399", "#a78bfa", "#f472b6", "#60a5fa"];
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 34, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      legend: {
        type: groups.length > 6 ? "scroll" : "plain",
        data: groups.map((group) => group.label),
        top: 0,
        left: "center",
        width: "92%",
        textStyle: { color: "rgba(226, 232, 240, 0.88)", fontSize: 11, fontWeight: 800 },
        itemWidth: 10,
        itemHeight: 8,
        itemGap: 8,
        pageIconColor: "rgba(251, 191, 36, 0.86)",
        pageTextStyle: { color: "rgba(226, 232, 240, 0.76)" }
      },
      xAxis: {
        ...baseXAxis,
        data: labels,
        boundaryGap: false,
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: "μS/cm",
        ...darkAxis(),
        nameTextStyle: { color: "rgba(251, 191, 36, 0.72)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3 }
      },
      series: groups.map((group, idx) => {
        const color = colors[idx % colors.length] ?? "#f59e0b";
        return {
          name: group.label,
          type: "line",
          smooth: true,
          showSymbol: realtimeTrendRange === "60s",
          symbol: "circle",
          symbolSize: realtimeTrendRange === "60s" ? 7 : 4,
          connectNulls: realtimeTrendRange === "60s",
          data: group.buckets.map((bucket) => bucket.value == null ? null : Number(bucket.value.toFixed(2))),
          lineStyle: { width: 2.2, color },
          itemStyle: { color },
          areaStyle: { color: "rgba(251, 191, 36, 0.07)" }
        };
      })
    };
  }, [chartBase, conductivityTrendGroups, realtimeTrendRange, realtimeTrendWindow.buckets]);

  const conductivityDisplayOption = conductivityTrendHasSeries ? conductivityTrendOption : conductivityProfileOption;
  const conductivityCardTitle =
    conductivityTrendHasSeries || conductivityTrendLoading
      ? `${chartScopeLabel}土壤电导率趋势（${realtimeTrendWindow.label}）`
      : `${chartScopeLabel}土壤电导率实时剖面`;

  const soilTrendHasSeries = useMemo(
    () =>
      soilTrendGroups.some((group) =>
        group.buckets.some((bucket) => bucket.temperatureC != null || bucket.moisturePct != null)
      ),
    [soilTrendGroups]
  );

  const soilTrendOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const groups = soilTrendGroups.filter((group) =>
      group.buckets.some((bucket) => bucket.temperatureC != null || bucket.moisturePct != null)
    );
    const labels = groups[0]?.buckets.map((bucket) => bucket.label) ?? realtimeTrendWindow.buckets.map((bucket) => bucket.label);
    const colors = ["#22d3ee", "#34d399", "#f59e0b", "#a78bfa", "#f472b6", "#60a5fa", "#fb7185", "#2dd4bf"];
    const legendNames = groups.flatMap((group) => [
      compactSoilSeriesName(group.label, "temperature"),
      compactSoilSeriesName(group.label, "moisture")
    ]);
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 42, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      legend: {
        type: legendNames.length > 8 ? "scroll" : "plain",
        data: legendNames,
        top: 0,
        left: "center",
        width: "92%",
        textStyle: { color: "rgba(226, 232, 240, 0.9)", fontSize: 11, fontWeight: 800 },
        itemWidth: 10,
        itemHeight: 8,
        itemGap: 8,
        pageIconColor: "rgba(34, 211, 238, 0.86)",
        pageTextStyle: { color: "rgba(226, 232, 240, 0.76)" }
      },
      xAxis: {
        ...baseXAxis,
        data: labels,
        boundaryGap: false,
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: [
        {
          type: "value",
          name: "°C",
          min: (value: { min: number }) => Math.floor(value.min - 1),
          max: (value: { max: number }) => Math.ceil(value.max + 1),
          ...darkAxis(),
          nameTextStyle: { color: "rgba(125, 211, 252, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: "{value}" }
        },
        {
          type: "value",
          name: "%",
          min: -5,
          max: 100,
          ...darkAxis(),
          nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: (value: number) => (value < 0 ? "" : `${value}`) }
        }
      ],
      series: groups.flatMap((group, idx) => {
        const color = colors[idx % colors.length] ?? "#22d3ee";
        const temperatureName = compactSoilSeriesName(group.label, "temperature");
        const moistureName = compactSoilSeriesName(group.label, "moisture");
        return [
          {
            name: temperatureName,
            type: "line",
            smooth: true,
            showSymbol: realtimeTrendRange === "60s",
            symbol: "circle",
            symbolSize: realtimeTrendRange === "60s" ? 7 : 4,
            connectNulls: realtimeTrendRange === "60s",
            data: group.buckets.map((bucket) => bucket.temperatureC == null ? null : Number(bucket.temperatureC.toFixed(2))),
            lineStyle: { width: 2.2, color },
            itemStyle: { color }
          },
          {
            name: moistureName,
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            showSymbol: realtimeTrendRange === "60s",
            symbol: "circle",
            symbolSize: realtimeTrendRange === "60s" ? 7 : 4,
            connectNulls: realtimeTrendRange === "60s",
            data: group.buckets.map((bucket) => bucket.moisturePct == null ? null : Number(bucket.moisturePct.toFixed(2))),
            lineStyle: { width: 2, type: "dashed", color, opacity: 0.78 },
            itemStyle: { color, opacity: 0.78 }
          }
        ];
      })
    };
  }, [chartBase, realtimeTrendRange, realtimeTrendWindow.buckets, soilTrendGroups]);

  const soilDisplayOption = soilTrendHasSeries ? soilTrendOption : soilProfileOption;
  const soilCardTitle =
    soilTrendHasSeries || soilTrendLoading
      ? `${chartScopeLabel}土壤趋势（${realtimeTrendWindow.label}）`
      : `${chartScopeLabel}土壤实时剖面（温度 / 水分）`;

  const tiltTrendHasSeries = useMemo(
    () =>
      tiltTrendGroups.some((group) =>
        group.buckets.some((bucket) => bucket.tiltXDeg != null || bucket.tiltYDeg != null)
      ),
    [tiltTrendGroups]
  );

  const tiltTrendOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const groups = tiltTrendGroups.filter((group) =>
      group.buckets.some((bucket) => bucket.tiltXDeg != null || bucket.tiltYDeg != null)
    );
    const labels = groups[0]?.buckets.map((bucket) => bucket.label) ?? realtimeTrendWindow.buckets.map((bucket) => bucket.label);
    const colors = ["#34d399", "#fbbf24", "#22d3ee", "#a78bfa", "#fb7185", "#60a5fa", "#2dd4bf", "#f472b6"];
    const legendNames = groups.flatMap((group) => [
      compactTiltSeriesName(group.label, "x"),
      compactTiltSeriesName(group.label, "y")
    ]);
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 42, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      legend: {
        type: legendNames.length > 8 ? "scroll" : "plain",
        data: legendNames,
        top: 0,
        left: "center",
        width: "92%",
        textStyle: { color: "rgba(226, 232, 240, 0.9)", fontSize: 11, fontWeight: 800 },
        itemWidth: 10,
        itemHeight: 8,
        itemGap: 8,
        pageIconColor: "rgba(52, 211, 153, 0.86)",
        pageTextStyle: { color: "rgba(226, 232, 240, 0.76)" }
      },
      xAxis: {
        ...baseXAxis,
        data: labels,
        boundaryGap: false,
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: "°",
        nameGap: 6,
        min: (value: { min: number }) => Number((Math.floor((value.min - 0.1) * 10) / 10).toFixed(1)),
        max: (value: { max: number }) => Number((Math.ceil((value.max + 0.1) * 10) / 10).toFixed(1)),
        ...darkAxis(),
        nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3, formatter: "{value}" }
      },
      series: groups.flatMap((group, idx) => {
        const color = colors[idx % colors.length] ?? "#34d399";
        const tiltXName = compactTiltSeriesName(group.label, "x");
        const tiltYName = compactTiltSeriesName(group.label, "y");
        return [
          {
            name: tiltXName,
            type: "line",
            smooth: true,
            showSymbol: realtimeTrendRange === "60s",
            symbol: "circle",
            symbolSize: realtimeTrendRange === "60s" ? 7 : 4,
            connectNulls: realtimeTrendRange === "60s",
            data: group.buckets.map((bucket) => bucket.tiltXDeg == null ? null : Number(bucket.tiltXDeg.toFixed(3))),
            lineStyle: { width: 2.2, color },
            itemStyle: { color }
          },
          {
            name: tiltYName,
            type: "line",
            smooth: true,
            showSymbol: realtimeTrendRange === "60s",
            symbol: "circle",
            symbolSize: realtimeTrendRange === "60s" ? 7 : 4,
            connectNulls: realtimeTrendRange === "60s",
            data: group.buckets.map((bucket) => bucket.tiltYDeg == null ? null : Number(bucket.tiltYDeg.toFixed(3))),
            lineStyle: { width: 2, type: "dashed", color, opacity: 0.78 },
            itemStyle: { color, opacity: 0.78 },
            areaStyle: { color: "rgba(52, 211, 153, 0.04)" }
          }
        ];
      })
    };
  }, [chartBase, realtimeTrendRange, realtimeTrendWindow.buckets, tiltTrendGroups]);

  const tiltProfileOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
    const rows = useNodeLevelTrend
      ? liveSnapshotRows
          .filter((row) => isTiltSensorDevice(row.device, deviceStates[row.device.id]) && (row.tiltXDeg != null || row.tiltYDeg != null))
          .map((row) => ({
            label: fieldNodeLegendLabel(row.device),
            tiltXDeg: row.tiltXDeg,
            tiltYDeg: row.tiltYDeg
          }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : chartGroups.map((group) => {
          const groupStationIds = new Set(group.stationIds);
          const stationRows = liveSnapshotRows.filter((row) => groupStationIds.has(row.device.stationId));
          const tiltRows = stationRows.filter((row) => isTiltSensorDevice(row.device, deviceStates[row.device.id]));
          return {
            label: group.label,
            tiltXDeg: avg(tiltRows.map((row) => row.tiltXDeg).filter((value): value is number => value != null)),
            tiltYDeg: avg(tiltRows.map((row) => row.tiltYDeg).filter((value): value is number => value != null))
          };
        });
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 30, bottom: 0, containLabel: true },
      legend: {
        top: 2,
        left: "center",
        textStyle: { color: "rgba(226, 232, 240, 0.82)" },
        itemWidth: 10,
        itemHeight: 10
      },
      xAxis: {
        ...baseXAxis,
        data: rows.map((row) => row.label),
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: "°",
        nameGap: 6,
        ...darkAxis(),
        nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3 }
      },
      series: [
        {
          name: "倾角 X",
          type: "bar",
          data: rows.map((row) => Number((row.tiltXDeg ?? 0).toFixed(2))),
          lineStyle: { width: 2, color: "#34d399" },
          itemStyle: { color: "rgba(52, 211, 153, 0.85)" }
        },
        {
          name: "倾角 Y",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: rows.map((row) => Number((row.tiltYDeg ?? 0).toFixed(2))),
          lineStyle: { width: 2, color: "#fbbf24" },
          areaStyle: { color: "rgba(251, 191, 36, 0.10)" }
        }
      ]
    };
  }, [chartBase, chartGroups, deviceStates, liveSnapshotRows, useNodeLevelTrend]);

  const tiltDisplayOption = tiltTrendHasSeries ? tiltTrendOption : tiltProfileOption;
  const tiltCardTitle =
    tiltTrendHasSeries || tiltTrendLoading
      ? `${chartScopeLabel}姿态趋势（${realtimeTrendWindow.label}）`
      : `${chartScopeLabel}姿态实时剖面（倾角 X / 倾角 Y）`;

  const dataFreshnessOption = useMemo(() => {
    const rows = liveSnapshotRows
      .map((row) => {
        const updatedAt = dayjs(row.updatedAt);
        const ageSeconds = updatedAt.isValid() ? Math.max(0, dayjs(now).diff(updatedAt, "second")) : 300;
        return {
          label: fieldNodeLegendLabel(row.device),
          ageSeconds,
          status: row.device.status
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const axisMax = Math.max(15, Math.ceil((Math.max(0, ...rows.map((row) => row.ageSeconds)) + 2) / 5) * 5);
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      grid: { left: "0%", right: 42, top: 20, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      xAxis: {
        type: "value",
        min: 0,
        max: axisMax,
        name: "秒",
        nameTextStyle: { color: "rgba(226, 232, 240, 0.72)" },
        ...darkAxis(),
        axisLabel: { ...darkAxis().axisLabel, margin: 6 }
      },
      yAxis: { type: "category", data: rows.map((row) => row.label), ...darkAxis() },
      series: [
        {
          name: "距最后上报",
          type: "bar",
          data: rows.map((row) => ({
            value: row.ageSeconds,
            itemStyle: {
              color:
                row.status === "offline" || row.ageSeconds > 30
                  ? "rgba(248, 113, 113, 0.88)"
                  : row.ageSeconds > 10
                    ? "rgba(251, 191, 36, 0.88)"
                    : "rgba(45, 212, 191, 0.88)"
            }
          })),
          barWidth: 16,
          barMinHeight: 4,
          label: {
            show: true,
            position: "right",
            color: "rgba(226, 232, 240, 0.9)",
            formatter: "{c}s"
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "rgba(251, 191, 36, 0.72)", type: "dashed" },
            label: { color: "rgba(251, 191, 36, 0.92)", formatter: "10s 目标" },
            data: [{ xAxis: 10 }]
          }
        }
      ]
    };
  }, [liveSnapshotRows, now]);

  const activeTiltAlertByDevice = useMemo(() => {
    const result = new Map<string, AlertSummaryItem>();
    for (const alert of fieldAlarmStatus?.alerts ?? []) {
      if (alert.status === "active" && alert.deviceId) result.set(alert.deviceId, alert);
    }
    return result;
  }, [fieldAlarmStatus?.alerts]);

  const riskDistributionOption = useMemo(() => {
    const riskRows = liveSnapshotRows.map((row) => analyzeAnomaly(row, activeTiltAlertByDevice.get(row.device.id)));
    const high = riskRows.filter((analysis) => analysis.level === "critical").length;
    const mid = riskRows.filter((analysis) => analysis.level === "warn").length;
    const low = riskRows.filter((analysis) => analysis.level === "info").length;
    const total = liveSnapshotRows.length;

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "item", ...darkTooltip() },
      legend: {
        bottom: 0,
        left: "center",
        orient: "horizontal",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.82)" }
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "78%"],
          center: ["50%", "44%"],
          label: {
            show: true,
            position: "center",
            formatter: `{v|${String(total)}}\n{l|分节点}`,
            rich: {
              v: { color: "rgba(226, 232, 240, 0.96)", fontSize: 22, fontWeight: 900, lineHeight: 24 },
              l: { color: "rgba(148, 163, 184, 0.9)", fontSize: 12, fontWeight: 800, lineHeight: 16 }
            }
          },
          labelLine: { show: false },
          data: [
            { name: "高风险", value: high, itemStyle: { color: "#ef4444" } },
            { name: "中风险", value: mid, itemStyle: { color: "#f59e0b" } },
            { name: "低风险", value: low, itemStyle: { color: "#22c55e" } }
          ]
        }
      ]
    };
  }, [activeTiltAlertByDevice, liveSnapshotRows]);

  const anomalyDetails = useMemo(
    () =>
      liveSnapshotRows
        .map((row) => ({ row, analysis: analyzeAnomaly(row, activeTiltAlertByDevice.get(row.device.id)) }))
        .filter((entry) => entry.analysis.isAnomaly),
    [activeTiltAlertByDevice, liveSnapshotRows]
  );

  const anomalies: AnomalyRow[] = useMemo(() => {
    return anomalyDetails
      .slice()
      .sort((a, b) => {
        const levelScore = (level: AnomalyRow["level"]) => (level === "critical" ? 3 : level === "warn" ? 2 : 1);
        const scoreDiff = levelScore(b.analysis.level) - levelScore(a.analysis.level);
        if (scoreDiff) return scoreDiff;
        return dayjs(b.row.updatedAt).valueOf() - dayjs(a.row.updatedAt).valueOf();
      })
      .slice(0, 8)
      .map(({ row, analysis }) => ({
        id: row.device.id,
        deviceName: row.device.name,
        stationName: row.device.stationName,
        level: analysis.level,
        message: analysis.message,
        time: formatBeijingTime(row.updatedAt)
      }));
  }, [anomalyDetails]);

  const rainfallSummary = useMemo(() => {
    const total = rainfallTrend.reduce((sum, point) => sum + point.value, 0);
    const peak = rainfallTrend.reduce<TimeBucketValue | null>((current, point) => (!current || point.value > current.value ? point : current), null);
    return {
      total: Number(total.toFixed(2)),
      peak
    };
  }, [rainfallTrend]);

  const freshSnapshotRows = useMemo(
    () => liveSnapshotRows.filter((row) => dayjs().diff(dayjs(row.updatedAt), "minute") <= 15),
    [liveSnapshotRows]
  );
  const freshDeviceCount = freshSnapshotRows.length;
  const staleDeviceCount = Math.max(0, visibleDevices.length - freshDeviceCount);
  const freshTiltCount = useMemo(
    () => freshSnapshotRows.filter((row) => row.tiltXDeg != null || row.tiltYDeg != null).length,
    [freshSnapshotRows]
  );
  const activeTiltAlertCount = fieldAlarmStatus?.activeCount ?? 0;
  const pendingTiltReviewCount = fieldAlarmStatus?.ackedCount ?? 0;

  const sensorTypeOption = useMemo(() => {
    type SensorOverviewKind = "soil" | "tilt" | "conductivity" | "gnss";
    const anomalyKindsByDevice = new Map<string, Set<AnomalyKind>>();
    for (const entry of anomalyDetails) {
      const kinds = anomalyKindsByDevice.get(entry.row.device.id) ?? new Set<AnomalyKind>();
      kinds.add(entry.analysis.kind);
      anomalyKindsByDevice.set(entry.row.device.id, kinds);
    }
    const activeTiltAlertIds = new Set(
      (fieldAlarmStatus?.alerts ?? [])
        .filter((alert) => alert.status === "active")
        .map((alert) => alert.deviceId)
        .filter((deviceId): deviceId is string => Boolean(deviceId))
    );
    const pendingTiltReviewIds = new Set(
      (fieldAlarmStatus?.alerts ?? [])
        .filter((alert) => alert.status === "acked")
        .map((alert) => alert.deviceId)
        .filter((deviceId): deviceId is string => Boolean(deviceId))
    );
    const categories: Array<{
      key: SensorOverviewKind;
      label: string;
      matches: (device: Device) => boolean;
    }> = [
      {
        key: "soil",
        label: "土壤温湿度",
        matches: (device) => isSoilSensorDevice(device, deviceStates[device.id])
      },
      {
        key: "tilt",
        label: "倾角",
        matches: (device) => isTiltSensorDevice(device, deviceStates[device.id])
      },
      {
        key: "conductivity",
        label: "土壤电导率",
        matches: (device) =>
          readMetricNumber(deviceStates[device.id]?.metrics, "electrical_conductivity_us_cm") != null
      },
      {
        key: "gnss",
        label: "GNSS",
        matches: (device) => {
          const metrics = deviceStates[device.id]?.metrics;
          const latitude = readMetricNumber(metrics, "gps_latitude") ?? readMetricNumber(metrics, "latitude");
          const longitude = readMetricNumber(metrics, "gps_longitude") ?? readMetricNumber(metrics, "longitude");
          return isValidGpsCoordinatePair(latitude, longitude);
        }
      }
    ];
    const items = categories
      .map((category) => {
        const matched = visibleDevices.filter(category.matches);
        return {
          label: category.label,
          total: matched.length,
          abnormal: matched.filter((device) => {
            const kinds = anomalyKindsByDevice.get(device.id);
            if (kinds?.has("availability")) return true;
            if (category.key === "tilt" && activeTiltAlertIds.has(device.id)) return true;
            return kinds?.has(category.key) ?? false;
          }).length,
          pendingReview: category.key === "tilt"
            ? matched.filter((device) => pendingTiltReviewIds.has(device.id)).length
            : 0
        };
      })
      .filter((item) => item.total > 0);

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...darkTooltip() },
      legend: {
        top: 2,
        left: "center",
        textStyle: { color: "rgba(226, 232, 240, 0.82)" },
        itemWidth: 10,
        itemHeight: 10
      },
      grid: { left: "8%", right: "6%", top: 28, bottom: 10, containLabel: true },
      xAxis: { type: "value", ...darkAxis() },
      yAxis: {
        type: "category",
        data: items.map((item) => item.label),
        ...darkAxis(),
        axisLabel: { ...darkAxis().axisLabel, margin: 8 }
      },
      series: [
        {
          name: "总数",
          type: "bar",
          data: items.map((item) => item.total),
          itemStyle: { color: "rgba(34, 211, 238, 0.72)" },
          barWidth: 12
        },
        {
          name: "异常 / 告警",
          type: "bar",
          data: items.map((item) => item.abnormal),
          itemStyle: { color: "rgba(239, 68, 68, 0.82)" },
          barWidth: 12
        },
        {
          name: "待复核",
          type: "bar",
          data: items.map((item) => item.pendingReview),
          itemStyle: { color: "rgba(251, 191, 36, 0.86)" },
          barWidth: 12
        }
      ]
    };
  }, [anomalyDetails, deviceStates, fieldAlarmStatus?.alerts, visibleDevices]);

  const freshSoilReadings = useMemo(() => {
    return freshSnapshotRows
      .filter((row) => row.soilTemperatureC != null || row.soilMoisturePct != null)
      .map((row) => {
        const temperature = row.soilTemperatureC == null ? "温度未上报" : `${row.soilTemperatureC.toFixed(1)}°C`;
        const moisture = row.soilMoisturePct == null ? "水分未上报" : `${row.soilMoisturePct.toFixed(1)}%`;
        return `${fieldNodeLegendLabel(row.device)} ${temperature} / ${moisture}`;
      });
  }, [freshSnapshotRows]);

  const rainDeviceCount = useMemo(
    () => visibleDevices.filter((device) => device.type === "rain").length,
    [visibleDevices]
  );
  const warningCount = anomalyDetails.filter((entry) => entry.analysis.level === "warn").length;

  const operationalSummary = useMemo(() => {
    if (!visibleDevices.length) {
      return [
        "当前没有设备接入，未归档数据不会显示在当前视图。",
        "设备接入后，大屏仅展示实时设备状态和实测传感器数据。"
      ];
    }
    const topAnomaly = anomalies[0];
    const strongestTilt = liveSnapshotRows
      .filter((row) => row.tiltXDeg != null || row.tiltYDeg != null)
      .reduce<{ deviceName: string; magnitude: number } | null>((current, row) => {
        const magnitude = Math.max(Math.abs(row.tiltXDeg ?? 0), Math.abs(row.tiltYDeg ?? 0));
        if (!current || magnitude > current.magnitude) {
          return { deviceName: row.device.name, magnitude };
        }
        return current;
      }, null);

    const summary = [
      `当前${activeArea ? scopeLevelLabel(activeArea.level) : "范围"} ${activeArea?.label ?? "未选择"}，分节点 ${stats.nodes} 个，在线 ${stats.online} 个，异常 ${warningCount} 个，离线 ${stats.offline} 个。`,
      `数据新鲜度：15 分钟内上报 ${freshDeviceCount} 个，超时未更新 ${staleDeviceCount} 个。`,
      freshSoilReadings.length ? `土壤实测：${freshSoilReadings.join("；")}。` : "当前没有 15 分钟内的新鲜土壤实测数据。",
      rainDeviceCount > 0
        ? `${realtimeTrendWindow.label}累计雨量 ${rainfallSummary.total.toFixed(2)} mm。`
        : "当前未接入雨量传感器，不生成雨量数值。",
      `姿态监测：15 分钟内有效倾角 ${freshTiltCount}/${visibleDevices.length}，活动告警 ${fieldAlarmStatus?.activeCount ?? 0} 个，待复核 ${fieldAlarmStatus?.ackedCount ?? 0} 个。`,
      topAnomaly
        ? `优先处置：${topAnomaly.deviceName}，${topAnomaly.message}。`
        : strongestTilt
          ? `当前未检出异常，姿态最大设备为 ${strongestTilt.deviceName}，最大倾角 ${strongestTilt.magnitude.toFixed(2)}°。`
          : "当前未检出设备异常。"
    ];
    if (fieldAlarmStatus?.active) {
      summary.unshift(
        `现场告警已触发：${fieldAlarmStatus.latestAlert?.title || "Tongxiao RK2206 告警终端处于动作状态"}，请先人工复核现场。`
      );
    } else if (fieldAlarmStatus?.silenced) {
      summary.unshift("现场声光报警已静音，事件仍处于人工复核窗口。");
    }
    return summary;
  }, [activeArea, anomalies, fieldAlarmStatus, freshDeviceCount, freshSoilReadings, freshTiltCount, liveSnapshotRows, rainDeviceCount, rainfallSummary.total, realtimeTrendWindow.label, staleDeviceCount, stats.nodes, stats.offline, stats.online, visibleDevices.length, warningCount]);

  const physicalAlarmActive = fieldAlarmStatus?.active ?? false;
  const hasOffline = stats.offline > 0;
  const hasCritical = physicalAlarmActive;
  const hasWarn = warningCount > 0;

  const fieldAlarmAlertId = fieldAlarmStatus?.latestAlert?.alertId;
  const fieldAlarmLastEventAt = fieldAlarmStatus?.latestAlert?.lastEventAt;
  const fieldAlarmStationName = useMemo(() => {
    const stationId = fieldAlarmStatus?.latestAlert?.stationId;
    if (!stationId) return "未绑定区域";
    return stations.find((station) => station.id === stationId)?.name ?? stationId;
  }, [fieldAlarmStatus?.latestAlert?.stationId, stations]);
  const fieldAlarmDeviceName = useMemo(() => {
    const deviceId = fieldAlarmStatus?.latestAlert?.deviceId;
    if (!deviceId) return "未绑定节点";
    return devices.find((device) => device.id === deviceId)?.name ?? deviceId;
  }, [devices, fieldAlarmStatus?.latestAlert?.deviceId]);

  useEffect(() => {
    if (!fieldAlarmReviewOpen || !fieldAlarmAlertId) {
      setFieldAlarmEvents([]);
      return;
    }
    let cancelled = false;
    void api.alerts
      .getEvents(fieldAlarmAlertId)
      .then((result) => {
        if (!cancelled) setFieldAlarmEvents(result.events);
      })
      .catch(() => {
        if (!cancelled) setFieldAlarmEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, fieldAlarmAlertId, fieldAlarmReviewOpen]);

  useEffect(() => {
    if (!reviewArchiveOpen) return;
    let cancelled = false;
    const ruleId = fieldAlarmStatus?.competitionProfile?.ruleId;
    setReviewArchiveLoading(true);
    setReviewArchiveError("");
    void api.alerts
      .list({ page: 1, pageSize: 50, status: "resolved" })
      .then(async (result) => {
        const resolvedAlerts = result.list
          .filter((alert) => !ruleId || alert.ruleId === ruleId)
          .slice(0, 20);
        const items = await Promise.all(
          resolvedAlerts.map(async (alert): Promise<ReviewArchiveItem> => {
            try {
              const detail = await api.alerts.getEvents(alert.alertId);
              const resolveEvent = detail.events
                .filter((event) => event.eventType === "ALERT_RESOLVE")
                .slice()
                .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
              return {
                alert,
                resolvedAt: resolveEvent?.createdAt ?? alert.lastEventAt,
                note: resolveEvent ? lifecycleEventNote(resolveEvent) : "未填写复核结论",
                eventCount: detail.events.length,
              };
            } catch {
              return {
                alert,
                resolvedAt: alert.lastEventAt,
                note: "复核事件读取失败",
                eventCount: 0,
              };
            }
          })
        );
        if (!cancelled) setReviewArchiveItems(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setReviewArchiveItems([]);
          setReviewArchiveError(error instanceof Error ? error.message : "复核档案读取失败");
        }
      })
      .finally(() => {
        if (!cancelled) setReviewArchiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, fieldAlarmStatus?.competitionProfile?.ruleId, reviewArchiveOpen]);

  const fieldAlarmReviewData = useMemo(() => {
    const alert = fieldAlarmStatus?.latestAlert ?? null;
    const profile = fieldAlarmStatus?.competitionProfile ?? null;
    const deviceId = alert?.deviceId ?? null;
    const evidenceEvent = fieldAlarmEvents
      .filter((event) => event.eventType === "ALERT_TRIGGER" || event.eventType === "ALERT_UPDATE")
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const evidence = asRecord(evidenceEvent?.evidence ?? alert?.evidence);
    const live = profile?.live?.find((item) => item.deviceId === deviceId)?.deviation ?? null;
    const profileDevice = profile?.devices.find((item) => item.deviceId === deviceId) ?? null;
    const baseline = readTiltVector(evidence.baseline) ?? live?.baseline ?? profileDevice?.baseline ?? null;
    const current = readTiltVector(evidence.current) ?? live?.current ?? null;
    const delta = readTiltVector(evidence.delta) ?? live?.delta ?? null;
    const thresholdsEvidence = asRecord(evidence.thresholds);
    const thresholds = {
      highDeg: readMetricNumber(thresholdsEvidence, "highDeg") ?? profile?.thresholds.highDeg ?? 3,
      criticalDeg: readMetricNumber(thresholdsEvidence, "criticalDeg") ?? profile?.thresholds.criticalDeg ?? 7,
      recoveryDeg: readMetricNumber(thresholdsEvidence, "recoveryDeg") ?? profile?.thresholds.recoveryDeg ?? 1.5,
      recoveryPoints: readMetricNumber(thresholdsEvidence, "recoveryPoints") ?? profile?.thresholds.recoveryPoints ?? 2,
    };
    const maxDeviationDeg = readMetricNumber(evidence, "maxDeviationDeg") ?? live?.maxDeviationDeg ?? null;
    const maxAxisRaw = typeof evidence.maxAxis === "string" ? evidence.maxAxis.toLowerCase() : live?.maxAxis;
    const maxAxis = maxAxisRaw === "x" || maxAxisRaw === "y" || maxAxisRaw === "z" ? maxAxisRaw.toUpperCase() : "--";
    const triggerThreshold = alert?.severity === "critical" ? thresholds.criticalDeg : thresholds.highDeg;
    const firstTriggerAt = fieldAlarmEvents
      .filter((event) => event.eventType === "ALERT_TRIGGER")
      .slice()
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]?.createdAt ?? alert?.lastEventAt ?? null;
    const tongxiao = asRecord(fieldAlarmStatus?.actuator.tongxiao);
    const reported = asRecord(tongxiao.reported);
    const boardOnline = tongxiao.boardOnline === true;
    const actuatorState = typeof reported.state === "string"
      ? reported.state
      : typeof fieldAlarmStatus?.actuator.state === "string"
        ? fieldAlarmStatus.actuator.state
        : "unknown";

    return {
      alert,
      baseline,
      current,
      delta,
      thresholds,
      maxDeviationDeg,
      maxAxis,
      triggerThreshold,
      exceededBy: maxDeviationDeg == null ? null : Math.max(0, maxDeviationDeg - triggerThreshold),
      firstTriggerAt,
      boardOnline,
      actuatorState,
      concurrentAlerts: Math.max(0, (fieldAlarmStatus?.alerts.length ?? 0) - 1),
      eventCount: fieldAlarmEvents.length,
    };
  }, [fieldAlarmEvents, fieldAlarmStatus]);

  const openCompetitionSetup = () => {
    setCompetitionThresholds(fieldAlarmStatus?.competitionProfile?.thresholds ?? DEFAULT_COMPETITION_THRESHOLDS);
    setCompetitionCaptureError("");
    setCompetitionSetupOpen(true);
  };

  const captureCompetitionBaseline = async () => {
    if (competitionCaptureBusy) return;
    setCompetitionCaptureBusy(true);
    setCompetitionCaptureError("");
    try {
      const result = await api.fieldAlarm.captureCompetitionBaseline({ thresholds: competitionThresholds });
      if (fieldAlarmStatus) {
        setFieldAlarmStatus({ ...fieldAlarmStatus, competitionProfile: result.profile });
      }
      if (result.skipped.length > 0) {
        setCompetitionCaptureError(
          `已采集 ${result.profile.devices.length} 个节点；${result.skipped.map((item) => `${item.deviceName}：${item.reason}`).join("；")}`
        );
      } else {
        setCompetitionSetupOpen(false);
      }
    } catch (error) {
      setCompetitionCaptureError(error instanceof Error ? error.message : "倾角基线采集失败");
    } finally {
      setCompetitionCaptureBusy(false);
    }
  };

  const acknowledgeFieldAlarm = useCallback(async () => {
    setFieldAlarmReviewSubmitting(true);
    setFieldAlarmReviewError("");
    try {
      const result = await api.fieldAlarm.sendAction({
        action: "ack",
        reason: fieldAlarmReviewNote.trim() || "人工确认已到场复核，先静音保留事件。",
        ...(fieldAlarmAlertId ? { alertId: fieldAlarmAlertId } : {})
      });
      if (!result.accepted) throw new Error(result.actuator.lastError ?? "现场告警终端未接受静音命令");
      applyFieldAlarmActionResult(result, fieldAlarmAlertId);
      void refreshFieldAlarmStatus();
      message.success("已静音，告警保留待复核");
    } catch (err) {
      setFieldAlarmReviewError(err instanceof Error ? err.message : "复核静音失败，请检查 API 或 Tongxiao RK2206 连接。");
    } finally {
      setFieldAlarmReviewSubmitting(false);
    }
  }, [api, applyFieldAlarmActionResult, fieldAlarmAlertId, fieldAlarmReviewNote, message, refreshFieldAlarmStatus]);

  const resolveFieldAlarm = useCallback(async () => {
    setFieldAlarmReviewSubmitting(true);
    setFieldAlarmReviewError("");
    try {
      const conclusionLabel = REVIEW_CONCLUSION_OPTIONS.find((option) => option.value === fieldAlarmReviewConclusion)?.label ?? "已复核";
      const reviewNote = fieldAlarmReviewNote.trim() || "现场复核已完成。";
      const result = await api.fieldAlarm.sendAction({
        action: "resolve",
        reason: `[复核结论：${conclusionLabel}] ${reviewNote}`,
        ...(fieldAlarmAlertId ? { alertId: fieldAlarmAlertId } : {})
      });
      if (!result.accepted) throw new Error(result.actuator.lastError ?? "现场告警终端未接受解除命令");
      applyFieldAlarmActionResult(result, fieldAlarmAlertId);
      setFieldAlarmReviewOpen(false);
      void refreshFieldAlarmStatus();
      const thresholds = fieldAlarmStatus?.competitionProfile?.thresholds ?? DEFAULT_COMPETITION_THRESHOLDS;
      message.success(
        `复核已完成并归档，现场警报已解除。回到倾角基线 ${String(thresholds.recoveryDeg)}° 内连续 ${String(thresholds.recoveryPoints)} 个点后自动重新布防；也可以重新采集基线。`,
        6
      );
    } catch (err) {
      setFieldAlarmReviewError(err instanceof Error ? err.message : "解除警报失败，请检查 API 或 Tongxiao RK2206 连接。");
    } finally {
      setFieldAlarmReviewSubmitting(false);
    }
  }, [api, applyFieldAlarmActionResult, fieldAlarmAlertId, fieldAlarmReviewConclusion, fieldAlarmReviewNote, fieldAlarmStatus?.competitionProfile?.thresholds, message, refreshFieldAlarmStatus]);

  const selectedStations = useMemo(() => {
    if (!selectedStationIds.length) return [];
    const set = new Set(selectedStationIds);
    return visibleStations.filter((s) => set.has(s.id));
  }, [selectedStationIds, visibleStations]);

  const mapPoints = useMemo<RealMapPoint[]>(() => {
    const stationById = new Map(visibleStations.map((station) => [station.id, station] as const));
    const fieldNodes = visibleDevices
      .filter(isFormalFieldNode)
      .slice()
      .sort((a, b) => fieldNodeLegendLabel(a).localeCompare(fieldNodeLegendLabel(b)));

    return fieldNodes.map((device, index) => {
      const station = stationById.get(device.stationId);
      const snapshot = deviceStates[device.id];
      const latitude = readMetricNumber(snapshot?.metrics, "gps_latitude");
      const longitude = readMetricNumber(snapshot?.metrics, "gps_longitude");
      const hasValidGps = isValidGpsCoordinatePair(latitude, longitude);
      const fallback = spreadDefaultMapLocation(index, fieldNodes.length);
      return {
        id: device.id,
        stationId: device.stationId,
        name: fieldNodeLegendLabel(device),
        stationName: station?.name ?? device.stationName,
        risk: station?.risk ?? "low",
        status: device.status,
        lat: hasValidGps ? latitude! : fallback.lat,
        lng: hasValidGps ? longitude! : fallback.lng,
        locationSource: hasValidGps ? "gps" : "default",
        lastSeenAt: snapshot?.updatedAt ?? device.lastSeenAt
      };
    });
  }, [deviceStates, visibleDevices, visibleStations]);

  useEffect(() => {
    if (!selectedStationIds.length) {
      setStationPanelExpanded(false);
      setStationPanelPage(0);
    }
  }, [selectedStationIds.length]);

  useEffect(() => {
    if (!stationPanelPlaying) return;
    const pages = Math.max(1, Math.ceil(selectedStations.length / 3));
    if (pages <= 1) return;
    const t = window.setInterval(() => {
      setStationPanelPage((p) => (p + 1) % pages);
    }, 5000);
    return () => window.clearInterval(t);
  }, [selectedStations.length, stationPanelPlaying]);

  const metricsByStationId = useMemo(() => {
    type Metrics = {
      deviceOnline: number;
      deviceWarn: number;
      deviceOffline: number;
      lastSeenAt?: string;
      types: Partial<Record<Device["type"], number>>;
    };

    const map: Record<string, Metrics> = {};

    for (const d of visibleDevices) {
      const slot: Metrics =
        map[d.stationId] ??
        (map[d.stationId] = {
          deviceOnline: 0,
          deviceWarn: 0,
          deviceOffline: 0,
          types: {}
        });

      if (d.status === "online") slot.deviceOnline += 1;
      else if (d.status === "warning") slot.deviceWarn += 1;
      else slot.deviceOffline += 1;

      slot.types[d.type] = (slot.types[d.type] ?? 0) + 1;
      const stateUpdatedAt = deviceStates[d.id]?.updatedAt ?? d.lastSeenAt;
      if (!slot.lastSeenAt || stateUpdatedAt > slot.lastSeenAt) slot.lastSeenAt = stateUpdatedAt;
    }

    return map;
  }, [deviceStates, visibleDevices]);

  const dataSyncing = loading || refreshing;
  const alertOn = physicalAlarmActive;
  const mapStatusColor = physicalAlarmActive ? "red" : hasOffline || hasWarn ? "orange" : "green";
  const mapStatusText = physicalAlarmActive ? "告警" : hasOffline ? "离线" : hasWarn ? "预警" : "正常";

  return (
    <div className="desk-analysis-screen">
      {alertOn ? (
        <div className="desk-analysis-alert-glow" aria-hidden="true">
          <div className="desk-analysis-alert-top" />
          <div className="desk-analysis-alert-bottom" />
          <div className="desk-analysis-alert-left" />
          <div className="desk-analysis-alert-right" />
        </div>
      ) : null}

      <div className="desk-analysis-topbar">
        <div className="desk-analysis-glowbar" aria-hidden="true" />

        <div className="desk-analysis-nav left">
          <button
            type="button"
            className="desk-analysis-navbtn"
            onClick={() => {
              navigate("/app/home");
            }}
          >
            首页
          </button>
          <button
            type="button"
            className="desk-analysis-navbtn"
            onClick={() => {
              navigate("/app/device-management");
            }}
          >
            设备管理
          </button>
        </div>

        <div className="desk-analysis-title">山体滑坡数据监测大屏</div>
        <div className="desk-analysis-meta" role="status" aria-label="系统信息">
          <div className="desk-analysis-meta-group">
            <span className="desk-analysis-meta-dot" aria-hidden="true" />
            <span>{formatBeijingDate(now, true)}</span>
            <span className="desk-analysis-meta-muted">{formatBeijingTime(now)}</span>
          </div>
          <div className="desk-analysis-meta-group">
            <Tag color={online ? "green" : "red"}>{online ? "网络正常" : "网络离线"}</Tag>
            <Tag color="cyan">{user?.name ?? "未登录"}</Tag>
          </div>
          <div className="desk-analysis-meta-group desk-analysis-area-group">
            <span className="desk-analysis-area-label">区域</span>
            <Select
              size="small"
              className="desk-analysis-area-select"
              value={activeArea?.key ?? null}
              onChange={(value: string) => {
                setSelectedAreaKey(value ?? null);
                setSelectedStationIds([]);
                setStationPanelPage(0);
              }}
              options={areaOptions.map((option) => ({
                value: option.key,
                label:
                  option.level === "all"
                    ? `${option.label} · ${areaNodeCountByKey.get(option.key) ?? 0} 分节点`
                    : `${scopeLevelLabel(option.level)}：${option.label} · ${areaNodeCountByKey.get(option.key) ?? 0} 分节点`
              }))}
            />
          </div>
          <div className="desk-analysis-meta-group desk-analysis-area-group">
            <span className="desk-analysis-area-label">时间窗</span>
            <Select
              size="small"
              className="desk-analysis-trend-range-select"
              value={realtimeTrendRange}
              onChange={(value: RealtimeTrendRangeKey) => setRealtimeTrendRange(value)}
              options={REALTIME_TREND_RANGE_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
            />
          </div>
          <div className="desk-analysis-meta-group">
            <Tag color="cyan">分节点 {stats.nodes}</Tag>
            <Tag color="green">在线 {stats.online}</Tag>
            <Tag color={hasWarn ? "orange" : "blue"}>异常 {warningCount}</Tag>
            <Tag color={hasOffline ? "red" : "blue"}>离线 {stats.offline}</Tag>
            {fieldAlarmStatus?.active ? <Tag color="red">现场声光报警</Tag> : null}
            <Button
              size="small"
              className="desk-analysis-baseline-button"
              disabled={Boolean(fieldAlarmStatus?.active || fieldAlarmStatus?.silenced)}
              onClick={openCompetitionSetup}
            >
              {fieldAlarmStatus?.competitionProfile ? "重采倾角基线" : "采集倾角基线"}
            </Button>
            <Button
              size="small"
              className="desk-analysis-baseline-button"
              icon={<HistoryOutlined />}
              onClick={() => setReviewArchiveOpen(true)}
            >
              复核档案
            </Button>
            <span className="desk-analysis-meta-muted">更新 {lastUpdate || "—"}</span>
          </div>
        </div>

        <div className="desk-analysis-nav right">
          <button
            type="button"
            className="desk-analysis-navbtn"
            onClick={() => {
              navigate("/app/gps-monitoring");
            }}
          >
            地质形变监测
          </button>
          <button
            type="button"
            className="desk-analysis-navbtn"
            onClick={() => {
              navigate("/app/settings");
            }}
          >
            系统设置
          </button>
        </div>
      </div>

      {fieldAlarmStatus?.active || fieldAlarmStatus?.silenced ? (
        <div className={`desk-analysis-field-alarm${fieldAlarmStatus.active ? " is-active" : " is-silenced"}`}>
          <div>
            <div className="desk-analysis-field-alarm-k">
              {fieldAlarmStatus.active ? "现场声光报警已触发" : "现场报警已静音，等待人工复核"}
            </div>
            <div className="desk-analysis-field-alarm-v">
              {fieldAlarmStatus.latestAlert?.title || "Tongxiao RK2206 告警终端动作状态已由平台捕获"}
            </div>
          </div>
          <div className="desk-analysis-field-alarm-meta">
            <span>活跃 {fieldAlarmStatus.activeCount}</span>
            <span>复核 {fieldAlarmStatus.ackedCount}</span>
            <span>{fieldAlarmStatus.actuator.available ? "RK2206 已连接" : "告警终端未连接"}</span>
            <Button
              size="small"
              danger={fieldAlarmStatus.active}
              onClick={() => {
                setFieldAlarmReviewError("");
                setFieldAlarmReviewOpen(true);
              }}
            >
              人工确认复核
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        centered
        className="desk-analysis-review-modal"
        open={fieldAlarmReviewOpen}
        title="人工确认复核"
        width={760}
        onCancel={() => {
          if (!fieldAlarmReviewSubmitting) setFieldAlarmReviewOpen(false);
        }}
        footer={[
          <Button
            key="ack"
            disabled={!fieldAlarmStatus?.active}
            loading={fieldAlarmReviewSubmitting}
            onClick={() => {
              void acknowledgeFieldAlarm();
            }}
          >
            确认并进入复核
          </Button>,
          <Button
            key="resolve"
            type="primary"
            danger
            loading={fieldAlarmReviewSubmitting}
            onClick={() => {
              void resolveFieldAlarm();
            }}
          >
            完成复核并归档
          </Button>
        ]}
      >
        <div className="desk-analysis-review-body">
          <div className="desk-analysis-review-alert">
            <div className="desk-analysis-review-alert-head">
              <Tag color={fieldAlarmReviewData.alert?.severity === "critical" ? "red" : "volcano"}>
                {alertSeverityLabel(fieldAlarmReviewData.alert?.severity)}
              </Tag>
              <span title={fieldAlarmReviewData.alert?.alertId ?? undefined}>
                告警编号 {fieldAlarmReviewData.alert?.alertId ?? "未记录"}
              </span>
            </div>
            <strong>{fieldAlarmReviewData.alert?.title || "Tongxiao RK2206 告警终端动作状态已由平台捕获"}</strong>
            <p>{fieldAlarmReviewData.alert?.message || "真实监测数据达到告警阈值，请复核现场姿态与设备状态。"}</p>
          </div>

          <div className="desk-analysis-review-deviation">
            <div className="desk-analysis-review-deviation-main">
              <span>最大相对偏移</span>
              <strong>
                {fieldAlarmReviewData.maxDeviationDeg == null
                  ? "--"
                  : `${fieldAlarmReviewData.maxDeviationDeg.toFixed(2)}°`}
              </strong>
              <small>
                主变化轴 {fieldAlarmReviewData.maxAxis} · 超出当前等级阈值 {fieldAlarmReviewData.exceededBy == null ? "--" : `${fieldAlarmReviewData.exceededBy.toFixed(2)}°`}
              </small>
            </div>
            <div className="desk-analysis-review-thresholds">
              <div><span>高风险阈值</span><strong>{fieldAlarmReviewData.thresholds.highDeg.toFixed(1)}°</strong></div>
              <div><span>严重风险阈值</span><strong>{fieldAlarmReviewData.thresholds.criticalDeg.toFixed(1)}°</strong></div>
              <div><span>恢复范围</span><strong>≤ {fieldAlarmReviewData.thresholds.recoveryDeg.toFixed(1)}°</strong></div>
            </div>
          </div>

          <div className="desk-analysis-review-vectors" aria-label="倾角基线、当前值和偏移">
            <div className="desk-analysis-review-vector-row is-head">
              <span>姿态</span><span>X 轴</span><span>Y 轴</span><span>Z 轴</span>
            </div>
            {[
              { label: "采集基线", value: fieldAlarmReviewData.baseline },
              { label: "触发姿态", value: fieldAlarmReviewData.current },
              { label: "相对偏移", value: fieldAlarmReviewData.delta },
            ].map((row) => (
              <div key={row.label} className="desk-analysis-review-vector-row">
                <strong>{row.label}</strong>
                <span>{formatTiltValue(row.value?.x)}</span>
                <span>{formatTiltValue(row.value?.y)}</span>
                <span>{formatTiltValue(row.value?.z)}</span>
              </div>
            ))}
          </div>

          <div className="desk-analysis-review-grid">
            <div>
              <span>区域</span>
              <strong>{fieldAlarmStationName}</strong>
            </div>
            <div>
              <span>节点</span>
              <strong>{fieldAlarmDeviceName}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong>{fieldAlarmStatus?.active ? "现场声光报警中" : fieldAlarmStatus?.silenced ? "已静音待复核" : "正常"}</strong>
            </div>
            <div>
              <span>首次触发</span>
              <strong>{fieldAlarmReviewData.firstTriggerAt ? formatBeijingDateTime(fieldAlarmReviewData.firstTriggerAt) : "未记录"}</strong>
            </div>
            <div>
              <span>最近事件</span>
              <strong>{fieldAlarmLastEventAt ? formatBeijingDateTime(fieldAlarmLastEventAt) : "未记录"}</strong>
            </div>
            <div>
              <span>现场终端</span>
              <strong>{fieldAlarmReviewData.boardOnline ? `RK2206 在线 · ${fieldAlarmReviewData.actuatorState}` : "RK2206 离线"}</strong>
            </div>
            <div>
              <span>其它待处理告警</span>
              <strong>{fieldAlarmReviewData.concurrentAlerts} 条</strong>
            </div>
            <div>
              <span>生命周期事件</span>
              <strong>{fieldAlarmReviewData.eventCount > 0 ? `${fieldAlarmReviewData.eventCount} 条` : "读取中"}</strong>
            </div>
          </div>
          {fieldAlarmEvents.length ? (
            <div className="desk-analysis-review-lifecycle">
              <div className="desk-analysis-review-section-head">
                <strong>当前告警生命周期</strong>
                <span>{fieldAlarmEvents.length} 条真实事件</span>
              </div>
              <div className="desk-analysis-review-lifecycle-list">
                {fieldAlarmEvents
                  .slice()
                  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                  .map((event) => (
                    <div key={event.eventId} className="desk-analysis-review-lifecycle-item">
                      <i className={`is-${event.eventType.toLowerCase().replace("alert_", "")}`} />
                      <div>
                        <strong>{lifecycleEventLabel(event.eventType)}</strong>
                        <span>{formatBeijingDateTime(event.createdAt)}</span>
                        {event.eventType === "ALERT_ACK" || event.eventType === "ALERT_RESOLVE" ? (
                          <p>{lifecycleEventNote(event)}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
          <label className="desk-analysis-review-conclusion">
            <span>复核结论（完成归档时写入）</span>
            <Select
              value={fieldAlarmReviewConclusion}
              onChange={(value: ReviewConclusion) => setFieldAlarmReviewConclusion(value)}
              options={REVIEW_CONCLUSION_OPTIONS}
            />
          </label>
          <label className="desk-analysis-review-note">
            <span>复核记录</span>
            <Input.TextArea
              rows={3}
              value={fieldAlarmReviewNote}
              maxLength={500}
              showCount
              onChange={(event) => setFieldAlarmReviewNote(event.target.value)}
            />
          </label>
          <div className="desk-analysis-review-hint">
            “进入复核”只静音并保留待办；“完成复核并归档”会解除警报并保存结论。规则等级始终由真实相对偏移计算，人工复核不会覆盖或降低测值等级。解除后需回到倾角基线 {fieldAlarmReviewData.thresholds.recoveryDeg.toFixed(1)}° 内并保持 {String(fieldAlarmReviewData.thresholds.recoveryPoints)} 个上报点，规则才会自动重新布防。
          </div>
          {fieldAlarmReviewError ? <div className="desk-analysis-review-error">{fieldAlarmReviewError}</div> : null}
        </div>
      </Modal>

      <Modal
        centered
        className="desk-analysis-review-modal desk-analysis-review-archive-modal"
        open={reviewArchiveOpen}
        title="倾角复核档案"
        width={860}
        footer={null}
        onCancel={() => setReviewArchiveOpen(false)}
      >
        <div className="desk-analysis-review-archive">
          <div className="desk-analysis-review-archive-summary">
            <div>
              <span>已归档</span>
              <strong>{reviewArchiveItems.length}</strong>
            </div>
            <p>这里只展示服务器中状态为 resolved 的真实倾角告警。每条记录保留生命周期事件、最终等级、复核时间和人工结论。</p>
          </div>
          {reviewArchiveLoading ? (
            <div className="desk-analysis-review-archive-empty">正在读取复核档案…</div>
          ) : reviewArchiveError ? (
            <div className="desk-analysis-review-error">{reviewArchiveError}</div>
          ) : reviewArchiveItems.length ? (
            <div className="desk-analysis-review-archive-list">
              {reviewArchiveItems.map((item) => {
                const deviceName = item.alert.deviceId
                  ? devices.find((device) => device.id === item.alert.deviceId)?.name ?? item.alert.deviceId
                  : "未绑定节点";
                return (
                  <div key={item.alert.alertId} className="desk-analysis-review-archive-item">
                    <div className="desk-analysis-review-archive-item-head">
                      <div>
                        <Tag color={item.alert.severity === "critical" ? "red" : "orange"}>
                          {alertSeverityLabel(item.alert.severity)}
                        </Tag>
                        <strong>{item.alert.title || "倾角告警"}</strong>
                      </div>
                      <span>{formatBeijingDateTime(item.resolvedAt)}</span>
                    </div>
                    <p>{item.note}</p>
                    <div className="desk-analysis-review-archive-meta">
                      <span>节点 {deviceName}</span>
                      <span>生命周期 {item.eventCount} 条</span>
                      <span title={item.alert.alertId}>编号 {item.alert.alertId}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="desk-analysis-review-archive-empty">当前没有已完成并归档的倾角复核记录。</div>
          )}
        </div>
      </Modal>

      <Modal
        centered
        width={640}
        className="desk-analysis-competition-modal"
        open={competitionSetupOpen}
        title="倾角告警基线"
        onCancel={() => {
          if (!competitionCaptureBusy) setCompetitionSetupOpen(false);
        }}
        footer={[
          <Button key="cancel" disabled={competitionCaptureBusy} onClick={() => setCompetitionSetupOpen(false)}>
            取消
          </Button>,
          <Button
            key="capture"
            type="primary"
            danger
            loading={competitionCaptureBusy}
            onClick={() => { void captureCompetitionBaseline(); }}
          >
            采集当前姿态并启用
          </Button>,
        ]}
      >
        <div className="desk-analysis-competition-body">
          <div className="desk-analysis-competition-status">
            <Tag color={fieldAlarmStatus?.competitionProfile?.enabled ? "green" : "default"}>
              {fieldAlarmStatus?.competitionProfile?.enabled ? "已启用" : "未采集"}
            </Tag>
            <span>覆盖节点 {fieldAlarmStatus?.competitionProfile?.devices.length ?? 0}</span>
            <span>最近采集 {fieldAlarmStatus?.competitionProfile?.capturedAt ? formatBeijingDateTime(fieldAlarmStatus.competitionProfile.capturedAt) : "--"}</span>
          </div>
          <div className="desk-analysis-competition-thresholds">
            <label>
              <span>高风险阈值</span>
              <InputNumber
                min={0.5}
                max={45}
                step={0.5}
                precision={1}
                value={competitionThresholds.highDeg}
                addonAfter="°"
                onChange={(value) => setCompetitionThresholds((current) => ({ ...current, highDeg: Number(value ?? 3) }))}
              />
            </label>
            <label>
              <span>严重风险阈值</span>
              <InputNumber
                min={1}
                max={90}
                step={0.5}
                precision={1}
                value={competitionThresholds.criticalDeg}
                addonAfter="°"
                onChange={(value) => setCompetitionThresholds((current) => ({ ...current, criticalDeg: Number(value ?? 7) }))}
              />
            </label>
            <label>
              <span>重新布防范围</span>
              <InputNumber
                min={0}
                max={20}
                step={0.5}
                precision={1}
                value={competitionThresholds.recoveryDeg}
                addonAfter="°"
                onChange={(value) => setCompetitionThresholds((current) => ({ ...current, recoveryDeg: Number(value ?? 1.5) }))}
              />
            </label>
            <label>
              <span>连续确认点数</span>
              <InputNumber
                min={1}
                max={10}
                step={1}
                precision={0}
                value={competitionThresholds.triggerPoints}
                addonAfter="点"
                onChange={(value) => setCompetitionThresholds((current) => ({ ...current, triggerPoints: Number(value ?? 2) }))}
              />
            </label>
          </div>
          {fieldAlarmStatus?.competitionProfile?.devices.length ? (
            <div className="desk-analysis-competition-baselines">
              {fieldAlarmStatus.competitionProfile.devices.map((device) => (
                <div key={device.deviceId}>
                  <strong>{device.deviceName}</strong>
                  <span>X {device.baseline.x.toFixed(2)}°</span>
                  <span>Y {device.baseline.y.toFixed(2)}°</span>
                  <span>Z {device.baseline.z.toFixed(2)}°</span>
                </div>
              ))}
            </div>
          ) : null}
          {competitionCaptureError ? <div className="desk-analysis-competition-error">{competitionCaptureError}</div> : null}
        </div>
      </Modal>

      <div className="desk-analysis-content">
        <div className="desk-analysis-grid">
          <div className="desk-analysis-leftcol">
            <BaseCard title="分节点风险分布">
              <ReactECharts option={riskDistributionOption} style={{ height: "100%" }} />
            </BaseCard>
            <BaseCard title={conductivityCardTitle}>
              <ReactECharts
                option={conductivityDisplayOption}
                notMerge
                showLoading={conductivityTrendLoading && !conductivityTrendHasSeries}
                style={{ height: "100%" }}
              />
            </BaseCard>
            <BaseCard title={soilCardTitle}>
              <ReactECharts
                option={soilDisplayOption}
                notMerge
                showLoading={soilTrendLoading && !soilTrendHasSeries}
                style={{ height: "100%" }}
              />
            </BaseCard>
            <BaseCard title={tiltCardTitle}>
              <ReactECharts
                option={tiltDisplayOption}
                notMerge
                showLoading={tiltTrendLoading && !tiltTrendHasSeries}
                style={{ height: "100%" }}
              />
            </BaseCard>
          </div>

          <div className="desk-analysis-mapcol">
            <BaseCard
              title={
                <span>
                  <span className={`desk-live-dot${dataSyncing && !reducedMotion ? " is-loading" : ""}`} aria-hidden="true" />
                  滑坡监测地图与预警
                </span>
              }
              extra={
                <div className="desk-analysis-map-extra">
                  <Tag color={mapStatusColor}>{mapStatusText}</Tag>
                  <Switch checked={autoRefresh} size="small" onChange={setAutoRefresh} />
                  <Button
                    size="small"
                    onClick={() => {
                      void loadData({ silent: true });
                    }}
                  >
                    刷新
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setSelectedStationIds([]);
                      setMapViewSeed((s) => s + 1);
                    }}
                  >
                    重置视图
                  </Button>
                  {selectedStations.length ? <Tag color="cyan">已选 {selectedStations.length}</Tag> : null}
                  <MapSwitchPanel selected={mapType} onSelect={setMapType} />
                </div>
              }
            >
              <div className="desk-analysis-mapstack">
                <div
                  className={clsx(
                    "desk-analysis-maptop",
                    (mapType === "卫星图" || mapType === "2D") && "is-realmap",
                    mapType === "卫星图" && "is-satellite",
                    mapType === "2D" && "is-2d",
                    mapType === "3D" && "is-3d"
                  )}
                >
                  {mapType === "视频" ? (
                    <div className="desk-video-placeholder">视频接入后将在此显示</div>
                  ) : mapType === "3D" ? (
                    <div className="desk-analysis-3dwrap">
                      <TerrainBackdrop className="desk-analysis-terrain" quality={terrainQuality} />
                      <div className="desk-analysis-map-overlay">
                        <div className="desk-analysis-map-hint">3D 视图：拖拽旋转，滚轮缩放，双击聚焦</div>
                        <div className="desk-analysis-map-legend">
                          <span className="dot high" />
                          高风险
                          <span className="dot mid" />
                          中风险
                          <span className="dot low" />
                          低风险
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <RealMapView
                        layer={mapType}
                        stations={visibleStations}
                        points={mapPoints}
                        selectedStationIds={selectedStationIds}
                        onSelectStationIds={setSelectedStationIds}
                        resetKey={mapViewSeed}
                        metricsByStationId={metricsByStationId}
                      />
                      <div className="desk-analysis-map-overlay">
                        <div className="desk-analysis-map-hint">拖拽移动，滚轮缩放，点击分节点查看详情</div>
                        <div className="desk-analysis-map-legend">
                          <span className="dot high" />
                          高风险
                          <span className="dot mid" />
                          中风险
                          <span className="dot low" />
                          低风险
                        </div>
                        {selectedStations.length ? (
                          <div className="desk-analysis-map-selectedpanel">
                            <div className="desk-analysis-map-selectedpanel-head">
                              <div className="desk-analysis-map-selectedpanel-title">已选分节点</div>
                              <div className="desk-analysis-map-selectedpanel-actions">
                                <button
                                  type="button"
                                  className="desk-analysis-map-selectedpanel-close"
                                  onClick={() => setStationPanelExpanded((v) => !v)}
                                >
                                  {stationPanelExpanded ? "收起" : "展开"}
                                </button>
                                <button
                                  type="button"
                                  className="desk-analysis-map-selectedpanel-close"
                                  onClick={() => setSelectedStationIds([])}
                                >
                                  关闭
                                </button>
                              </div>
                            </div>
                            <div className="desk-analysis-map-selectedpanel-body">
                              <div className="desk-analysis-map-selectedpanel-summary">
                                <span className="badge">{selectedStations.length} 个分节点</span>
                                <button
                                  type="button"
                                  className="desk-analysis-map-selectedpanel-pill"
                                  onClick={() => setStationPanelPlaying((v) => !v)}
                                >
                                  {stationPanelPlaying ? "暂停轮播" : "开始轮播"}
                                </button>
                                <button
                                  type="button"
                                  className="desk-analysis-map-selectedpanel-pill"
                                  onClick={() => setSelectedStationIds([])}
                                >
                                  清空
                                </button>
                              </div>

                              <div className="desk-analysis-map-selectedpanel-list">
                                {selectedStations
                                  .slice()
                                  .sort((a, b) => {
                                    const score = (r: Station["risk"]) => (r === "high" ? 3 : r === "mid" ? 2 : 1);
                                    const diff = score(b.risk) - score(a.risk);
                                    if (diff) return diff;
                                    return a.name.localeCompare(b.name);
                                  })
                                  .slice(stationPanelPage * 3, stationPanelPage * 3 + 3)
                                  .map((s) => {
                                    const m = metricsByStationId[s.id];
                                    const risk = s.risk === "high" ? "高风险" : s.risk === "mid" ? "中风险" : "低风险";
                                    const status = s.status === "online" ? "在线" : s.status === "warning" ? "预警" : "离线";
                                    return (
                                      <button
                                        key={s.id}
                                        type="button"
                                        className="desk-analysis-map-selectedpanel-item"
                                        onClick={() => setSelectedStationIds([s.id])}
                                      >
                                        <div className="n">{s.name}</div>
                                        <div className="m">
                                          <span className={`t ${s.risk}`}>{risk}</span>
                                          <span className={`t ${s.status}`}>{status}</span>
                                          <span className="t">传感器 {s.deviceCount}</span>
                                        </div>
                                        <div className="m2">
                                          <span>在线 {m?.deviceOnline ?? 0}</span>
                                          <span>预警 {m?.deviceWarn ?? 0}</span>
                                          <span>离线 {m?.deviceOffline ?? 0}</span>
                                          <span>更新 {m?.lastSeenAt?.slice(11, 19) ?? "—"}</span>
                                        </div>
                                        {stationPanelExpanded ? (
                                          <div className="m3">
                                            <span>坐标 {s.lng.toFixed(5)}, {s.lat.toFixed(5)}</span>
                                            <span>
                                              类型{" "}
                                              {Object.entries(m?.types ?? {})
                                                .map(([t, n]) => `${deviceTypeLabel(t as Device["type"])}:${String(n)}`)
                                                .join("  ") || "—"}
                                            </span>
                                            <span className="area">{s.area}</span>
                                          </div>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                            <div className="desk-analysis-map-selectedpanel-foot">
                              <button
                                type="button"
                                className="desk-analysis-map-selectedpanel-link"
                                onClick={() => navigate("/app/device-management")}
                              >
                                前往设备管理
                              </button>
                              <button
                                type="button"
                                className="desk-analysis-map-selectedpanel-link"
                                onClick={() => navigate("/app/gps-monitoring")}
                              >
                                前往形变监测
                              </button>
                            </div>
                          </div>
                        ) : null}
                    </div>
                  </>
                )}
                </div>
                <div className="desk-analysis-mapbottom">
                  <div className="desk-analysis-mapbottom-head">
                    <div>
                      <div className="desk-analysis-subtitle">{mapBottomMode === "history" ? "历史趋势" : "实时异常"}</div>
                      <div className="desk-analysis-mapbottom-caption">
                        {mapBottomMode === "history"
                          ? `${historyScopeLabel} · ${historyMetric.label} · ${historyRange === "24h" ? "近 24 小时" : "近 7 天"}`
                          : `${anomalies.length} 条待复核异常`}
                      </div>
                    </div>
                    <div className="desk-analysis-mapbottom-tabs" aria-label="地图下方面板切换">
                      <button
                        type="button"
                        className={clsx("desk-analysis-mapbottom-tab", mapBottomMode === "realtime" && "is-active")}
                        onClick={() => setMapBottomMode("realtime")}
                      >
                        实时异常
                      </button>
                      <button
                        type="button"
                        className={clsx("desk-analysis-mapbottom-tab", mapBottomMode === "history" && "is-active")}
                        onClick={() => setMapBottomMode("history")}
                      >
                        历史趋势
                      </button>
                    </div>
                  </div>
                  {mapBottomMode === "realtime" ? (
                    <div className="desk-dark-table">
                      <table className="desk-table">
                        <thead>
                          <tr>
                            <th>设备</th>
                            <th>监测点</th>
                            <th>状态</th>
                            <th>信息</th>
                            <th>时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {anomalies.length ? (
                            anomalies.map((r) => (
                              <tr key={r.id}>
                                <td>{r.deviceName}</td>
                                <td>{r.stationName}</td>
                                <td>
                                  <StatusTag value={r.level === "warn" ? "warning" : "offline"} />
                                </td>
                                <td>{r.message}</td>
                                <td>{r.time}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} style={{ textAlign: "center", color: "rgba(148,163,184,0.9)" }}>
                                {visibleDevices.length ? "当前未发现设备异常。" : "当前区域没有设备接入。"}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="desk-analysis-history-panel">
                      <div className="desk-analysis-history-toolbar">
                        <Select
                          size="small"
                          className="desk-analysis-history-select"
                          value={historyMetricKey}
                          onChange={(value) => setHistoryMetricKey(value as HistoryMetricKey)}
                          options={HISTORY_METRICS.map((metric) => ({
                            value: metric.key,
                            label: `${metric.label}（${metric.unit}）`
                          }))}
                        />
                        <div className="desk-analysis-history-range">
                          <Button
                            size="small"
                            type={historyRange === "24h" ? "primary" : "default"}
                            onClick={() => setHistoryRange("24h")}
                          >
                            24h
                          </Button>
                          <Button
                            size="small"
                            type={historyRange === "7d" ? "primary" : "default"}
                            onClick={() => setHistoryRange("7d")}
                          >
                            7d
                          </Button>
                        </div>
                      </div>
                      <div className="desk-analysis-history-summary">
                        <div className="desk-analysis-history-stat">
                          <span className="k">最新</span>
                          <span className="v">{formatHistoryValue(historySummary.latest, historyMetric.unit)}</span>
                        </div>
                        <div className="desk-analysis-history-stat">
                          <span className="k">最大</span>
                          <span className="v">{formatHistoryValue(historySummary.max, historyMetric.unit)}</span>
                        </div>
                        <div className="desk-analysis-history-stat">
                          <span className="k">均值</span>
                          <span className="v">{formatHistoryValue(historySummary.avg, historyMetric.unit)}</span>
                        </div>
                        <div className="desk-analysis-history-stat">
                          <span className="k">数据点</span>
                          <span className="v">{historySummary.pointCount}</span>
                        </div>
                      </div>
                      <div className="desk-analysis-history-chart">
                        {historyTrendHasSeries || historyTrendLoading ? (
                          <ReactECharts
                            option={historyTrendOption}
                            notMerge
                            showLoading={historyTrendLoading && !historyTrendHasSeries}
                            style={{ height: "100%" }}
                          />
                        ) : (
                          <div className="desk-analysis-history-empty">
                            当前筛选暂无 {historyMetric.label} 历史数据
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </BaseCard>
          </div>

          <div className="desk-analysis-rightcol">
            <div className="desk-analysis-right-top">
              <BaseCard title="各分节点数据新鲜度（距最后上报，秒）">
                <ReactECharts option={dataFreshnessOption} style={{ height: "100%" }} />
              </BaseCard>
            </div>

            <div className="desk-analysis-right-mid">
              <BaseCard title="运行研判摘要">
                <div className="desk-ai-box">
                  {operationalSummary.map((line) => (
                    <div key={line} className="desk-ai-line">
                      <span className="desk-ai-dot" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </BaseCard>
            </div>

            <div className="desk-analysis-right-bot">
              <BaseCard title="传感器运行概览">
                <div className="desk-sensor-row">
                  <div className="desk-sensor-col">
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">设备总数</span>
                      <span className="desk-sensor-value" style={{ color: "#22d3ee" }}>
                        {String(stats.devices)}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">15 分钟内新鲜</span>
                      <span className="desk-sensor-value" style={{ color: "#22c55e" }}>
                        {String(freshDeviceCount)}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">超时未更新</span>
                      <span className="desk-sensor-value" style={{ color: "#f97316" }}>
                        {String(staleDeviceCount)}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">倾角有效</span>
                      <span className="desk-sensor-value" style={{ color: "#22d3ee" }}>
                        {`${freshTiltCount}/${visibleDevices.length}`}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">活动倾角告警</span>
                      <span className="desk-sensor-value" style={{ color: "#ef4444" }}>
                        {String(activeTiltAlertCount)}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">待人工复核</span>
                      <span className="desk-sensor-value" style={{ color: "#fbbf24" }}>
                        {String(pendingTiltReviewCount)}
                      </span>
                    </div>
                  </div>
                  <div className="desk-sensor-col">
                    <ReactECharts option={sensorTypeOption} style={{ height: "100%" }} />
                  </div>
                </div>
              </BaseCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
