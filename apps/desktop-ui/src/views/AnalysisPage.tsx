import clsx from "clsx";
import { Button, Input, Modal, Select, Switch, Tag } from "antd";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { AiPrediction, Device, DeviceStateSnapshot, FieldAlarmStatus, Station, TelemetrySeriesPoint } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { MapSwitchPanel, type MapType } from "../components/MapSwitchPanel";
import { RealMapView } from "../components/RealMapView";
import { StatusTag } from "../components/StatusTag";
import { TerrainBackdrop } from "../components/TerrainBackdrop";
import { baijiabaoReviewQueueSnapshot, type BaijiabaoReviewQueueItem } from "../data/baijiabaoReviewQueueSnapshot";
import { useAuthStore } from "../stores/authStore";
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

function riskLevelText(value: AiPrediction["riskLevel"]): string {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return "未知";
}

function forecastHorizonText(value: string | null | undefined): string {
  if (value === "24h") return "未来 24h";
  if (value === "72h") return "未来 72h";
  if (value && value.trim()) return `未来 ${value.trim()}`;
  return "未来窗口";
}

function formatForecastDisplacementMm(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(3)} mm` : "暂无可用预测值";
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function deviceTypeLabel(type: Device["type"]): string {
  if (type === "gnss") return "GNSS";
  if (type === "rain") return "雨量";
  if (type === "tilt") return "倾角";
  if (type === "temp_hum") return "土壤温度/水分";
  return "视频";
}

function isSoilSensorDevice(device: Device): boolean {
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

function reviewSeverityLabel(value: BaijiabaoReviewQueueItem["severity"]): string {
  if (value === "high") return "高优先";
  if (value === "medium") return "中优先";
  if (value === "needs-evidence") return "需证据";
  return "低优先";
}

function reviewActionLabel(value: BaijiabaoReviewQueueItem["recommendedAction"]): string {
  if (value === "prioritize-manual-review") return "优先人工复核";
  if (value === "review-process-evidence") return "复核过程证据";
  if (value === "review-label-window") return "复核标签窗口";
  if (value === "request-raw-evidence") return "补查原始证据";
  return "归档为对照";
}

function reviewClassLabel(value: BaijiabaoReviewQueueItem["autoReview"]["finalClass"]): string {
  if (value === "true_pre_signal") return "强前兆候选";
  if (value === "process_related") return "过程相关";
  if (value === "label_boundary_artifact") return "标签边界";
  if (value === "expected_noise") return "预期噪声";
  return "证据不足";
}

function reviewSeverityColor(value: BaijiabaoReviewQueueItem["severity"]): string {
  if (value === "high") return "red";
  if (value === "medium") return "orange";
  if (value === "needs-evidence") return "purple";
  return "default";
}

function reviewUsefulLabel(value: BaijiabaoReviewQueueItem["autoReview"]["useful"]): string {
  if (value === "yes") return "有复核价值";
  if (value === "no") return "对照/噪声";
  return "待补证据";
}

function reviewConfidenceLabel(value: BaijiabaoReviewQueueItem["autoReview"]["confidence"]): string {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  return "低";
}

function reviewDateLabel(value: string): string {
  return dayjs(value).format("YYYY-MM-DD");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildReviewQueueCsv(items: readonly BaijiabaoReviewQueueItem[]): string {
  const headers = [
    "queueItemId",
    "sourceReviewItemId",
    "pointId",
    "priority",
    "severity",
    "severityLabel",
    "recommendedAction",
    "recommendedActionLabel",
    "autoFinalClass",
    "autoFinalClassLabel",
    "autoUseful",
    "autoConfidence",
    "rawEvidenceNeeded",
    "windowStart",
    "windowEnd",
    "durationDays",
    "seasonSet",
    "monthSet",
    "evidenceRowCount",
    "immediatePositiveDays",
    "greyZoneDays",
    "within30Days",
    "isolatedDays",
    "maxBoosterScore",
    "classificationMix",
    "autoRule",
    "autoWarning",
    "humanReviewStatus",
    "humanFinalClass",
    "humanUseful",
    "humanConfidence",
    "humanNotes"
  ];

  const rows = items.map((item) => [
    item.queueItemId,
    item.sourceReviewItemId,
    item.pointId,
    item.priority,
    item.severity,
    reviewSeverityLabel(item.severity),
    item.recommendedAction,
    reviewActionLabel(item.recommendedAction),
    item.autoReview.finalClass,
    reviewClassLabel(item.autoReview.finalClass),
    item.autoReview.useful,
    item.autoReview.confidence,
    item.autoReview.rawEvidenceNeeded,
    item.window.startTs,
    item.window.endTs,
    item.window.durationDays,
    item.window.seasonSet,
    item.window.monthSet,
    item.evidenceSummary.evidenceRowCount,
    item.evidenceSummary.immediatePositiveDays,
    item.evidenceSummary.greyZoneDays,
    item.evidenceSummary.within30Days,
    item.evidenceSummary.isolatedDays,
    item.evidenceSummary.maxBoosterScore,
    item.evidenceSummary.classificationMix,
    item.autoReview.rule,
    item.autoReview.rawEvidenceNeeded === "yes" ? "需补查原始证据" : "机器证据较完整",
    "pending",
    "",
    "",
    "",
    ""
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function buildReviewQueueEvidenceText(item: BaijiabaoReviewQueueItem): string {
  return [
    `reviewItem: ${item.sourceReviewItemId}`,
    `point: ${item.pointId}`,
    `priority: ${item.priority}`,
    `severity: ${item.severity} (${reviewSeverityLabel(item.severity)})`,
    `recommendedAction: ${item.recommendedAction} (${reviewActionLabel(item.recommendedAction)})`,
    `window: ${reviewDateLabel(item.window.startTs)} to ${reviewDateLabel(item.window.endTs)} (${item.window.durationDays} days)`,
    `season: ${item.window.seasonSet}; months: ${item.window.monthSet}`,
    `evidenceRows: ${item.evidenceSummary.evidenceRowCount}`,
    `evidenceCounts: immediate=${item.evidenceSummary.immediatePositiveDays}, greyZone=${item.evidenceSummary.greyZoneDays}, within30d=${item.evidenceSummary.within30Days}, isolated=${item.evidenceSummary.isolatedDays}`,
    `classificationMix: ${item.evidenceSummary.classificationMix}`,
    `maxBoosterScore: ${item.evidenceSummary.maxBoosterScore.toFixed(6)}`,
    `autoReview: ${item.autoReview.finalClass} (${reviewClassLabel(item.autoReview.finalClass)}), useful=${item.autoReview.useful}, confidence=${item.autoReview.confidence}, rawEvidenceNeeded=${item.autoReview.rawEvidenceNeeded}`,
    `rule: ${item.autoReview.rule}`,
    `reviewNote: ${item.autoReview.rawEvidenceNeeded === "yes" ? "需补查原始证据" : "机器证据较完整"}`,
    "boundary: REVIEW_ONLY; requires human confirmation before publishing."
  ].join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

type ReviewQueueSeverityFilter = "all" | BaijiabaoReviewQueueItem["severity"];
type ReviewQueueActionFilter = "all" | BaijiabaoReviewQueueItem["recommendedAction"];

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

function analyzeAnomaly(row: LiveSnapshotRow): { isAnomaly: boolean; level: AnomalyRow["level"]; message: string } {
  const batteryPct = row.batteryPct;
  const tiltX = row.tiltXDeg;
  const tiltY = row.tiltYDeg;
  const staleMinutes = dayjs().diff(dayjs(row.updatedAt), "minute");

  if (row.device.status === "offline") {
    return { isAnomaly: true, level: "critical", message: "离线：无数据上报" };
  }
  if (staleMinutes > 30) {
    return { isAnomaly: true, level: "warn", message: `数据超时：${String(staleMinutes)} 分钟未更新` };
  }
  if (row.warningFlag) {
    return {
      isAnomaly: true,
      level: "warn",
      message: `已触发预警，倾角 ${tiltX?.toFixed(2) ?? "--"}/${tiltY?.toFixed(2) ?? "--"}°`
    };
  }
  if (row.device.status === "warning") {
    return { isAnomaly: true, level: "warn", message: "设备状态为预警，需复核现场链路与测值" };
  }
  if (batteryPct != null && batteryPct <= 20) {
    return { isAnomaly: true, level: "warn", message: `低电量：battery_pct=${batteryPct.toFixed(0)}%` };
  }
  if ((tiltX != null && Math.abs(tiltX) >= 120) || (tiltY != null && Math.abs(tiltY) >= 90)) {
    return {
      isAnomaly: true,
      level: "warn",
      message: `姿态异常：tilt_x/tilt_y=${tiltX?.toFixed(2) ?? "--"}/${tiltY?.toFixed(2) ?? "--"}°`
    };
  }
  return { isAnomaly: false, level: "info", message: "状态正常" };
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
  const [reviewQueueSeverityFilter, setReviewQueueSeverityFilter] = useState<ReviewQueueSeverityFilter>("all");
  const [reviewQueueActionFilter, setReviewQueueActionFilter] = useState<ReviewQueueActionFilter>("all");
  const [reviewQueuePointFilter, setReviewQueuePointFilter] = useState<string>("all");
  const [selectedReviewQueueId, setSelectedReviewQueueId] = useState<string | null>(
    baijiabaoReviewQueueSnapshot.items[0]?.queueItemId ?? null
  );
  const [reviewQueueExportStatus, setReviewQueueExportStatus] = useState<string>("");
  const [rainfallTrend, setRainfallTrend] = useState<TimeBucketValue[]>([]);
  const [soilTrendGroups, setSoilTrendGroups] = useState<SoilTrendGroup[]>([]);
  const [soilTrendLoading, setSoilTrendLoading] = useState(false);
  const [conductivityTrendGroups, setConductivityTrendGroups] = useState<ConductivityTrendGroup[]>([]);
  const [conductivityTrendLoading, setConductivityTrendLoading] = useState(false);
  const [tiltTrendGroups, setTiltTrendGroups] = useState<TiltTrendGroup[]>([]);
  const [tiltTrendLoading, setTiltTrendLoading] = useState(false);
  const [mapBottomMode, setMapBottomMode] = useState<MapBottomMode>("realtime");
  const [historyMetricKey, setHistoryMetricKey] = useState<HistoryMetricKey>("tilt_x_deg");
  const [historyRange, setHistoryRange] = useState<HistoryRangeKey>("24h");
  const [realtimeTrendRange, setRealtimeTrendRange] = useState<RealtimeTrendRangeKey>("24h");
  const [historyTrendGroups, setHistoryTrendGroups] = useState<HistoryTrendGroup[]>([]);
  const [historyTrendLoading, setHistoryTrendLoading] = useState(false);
  const [latestAiPrediction, setLatestAiPrediction] = useState<AiPrediction | null>(null);
  const [fieldAlarmStatus, setFieldAlarmStatus] = useState<FieldAlarmStatus | null>(null);
  const [trendRefreshSeq, setTrendRefreshSeq] = useState(0);
  const [fieldAlarmReviewOpen, setFieldAlarmReviewOpen] = useState(false);
  const [fieldAlarmReviewNote, setFieldAlarmReviewNote] = useState("现场复核确认，解除声光报警。");
  const [fieldAlarmReviewSubmitting, setFieldAlarmReviewSubmitting] = useState(false);
  const [fieldAlarmReviewError, setFieldAlarmReviewError] = useState("");
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
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      if (!silent) setLoading(true);
      else setRefreshing(true);

      try {
        const [s, d, predictionResult, fieldAlarmResult] = await Promise.all([
          api.stations.list(),
          api.devices.list(),
          api.aiPredictions.list({ page: 1, pageSize: 1 }).catch(() => null),
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
        setLatestAiPrediction(predictionResult?.list[0] ?? null);
        setFieldAlarmStatus(fieldAlarmResult);
        setLastUpdate(formatBeijingDateTime(new Date()));
        setTrendRefreshSeq((value) => value + 1);
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    void loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(() => {
      void loadData({ silent: true });
    }, 15000);
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
            api.telemetry
              .getSeries({
                deviceId: device.id,
                sensorKey: "rainfall_mm",
                startTime,
                endTime,
                interval
              })
              .catch(() => [])
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
    const soilDevices = visibleDevices.filter(isSoilSensorDevice);
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
                  api.telemetry
                    .getSeries({
                      deviceId: device.id,
                      sensorKey: "soil_temperature_c",
                      startTime,
                      endTime,
                      interval
                    })
                    .catch(() => [])
                )
              ),
              Promise.all(
                source.devices.map((device) =>
                  api.telemetry
                    .getSeries({
                      deviceId: device.id,
                      sensorKey: "soil_moisture_pct",
                      startTime,
                      endTime,
                      interval
                    })
                    .catch(() => [])
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
  }, [api, chartGroups, realtimeTrendWindow, trendRefreshSeq, useNodeLevelTrend, visibleDevices]);

  useEffect(() => {
    const soilDevices = visibleDevices.filter(isSoilSensorDevice);
    const { buckets, unit, interval, startTime, endTime } = realtimeTrendWindow;
    const trendSources = useNodeLevelTrend
      ? buildNodeTrendSources(soilDevices)
      : buildGroupedTrendSources(chartGroups, soilDevices);
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
                api.telemetry
                  .getSeries({
                    deviceId: device.id,
                    sensorKey: "electrical_conductivity_us_cm",
                    startTime,
                    endTime,
                    interval
                  })
                  .catch(() => [])
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
  }, [api, chartGroups, realtimeTrendWindow, trendRefreshSeq, useNodeLevelTrend, visibleDevices]);

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
                  api.telemetry
                    .getSeries({
                      deviceId: device.id,
                      sensorKey: "tilt_x_deg",
                      startTime,
                      endTime,
                      interval
                    })
                    .catch(() => [])
                )
              ),
              Promise.all(
                source.devices.map((device) =>
                  api.telemetry
                    .getSeries({
                      deviceId: device.id,
                      sensorKey: "tilt_y_deg",
                      startTime,
                      endTime,
                      interval
                    })
                    .catch(() => [])
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
                api.telemetry
                  .getSeries({
                    deviceId: device.id,
                    sensorKey: historyMetric.key,
                    startTime,
                    endTime,
                    interval
                  })
                  .catch(() => [])
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
      stations: visibleStations.length,
      devices: visibleDevices.length,
      online,
      warn,
      offline
    };
  }, [visibleDevices, visibleStations.length]);

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
        .filter((row) => isSoilSensorDevice(row.device) && (row.soilTemperatureC != null || row.soilMoisturePct != null))
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
      const preferredRows = stationRows.filter((row) => isSoilSensorDevice(row.device));
      const soilRows = (preferredRows.length ? preferredRows : stationRows).filter(
        (row) => row.soilTemperatureC != null || row.soilMoisturePct != null
      );

      return {
        label: group.label,
        soilTemperatureC: avg(soilRows.map((row) => row.soilTemperatureC).filter((value): value is number => value != null)),
        soilMoisturePct: avg(soilRows.map((row) => row.soilMoisturePct).filter((value): value is number => value != null))
      };
    });
  }, [chartGroups, liveSnapshotRows, useNodeLevelTrend]);

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
          min: 0,
          max: 100,
          ...darkAxis(),
          nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: "{value}" }
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
        .filter((row) => isSoilSensorDevice(row.device) && row.conductivityUsCm != null)
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
        .filter((row) => isSoilSensorDevice(row.device))
        .map((row) => row.conductivityUsCm)
        .filter((value): value is number => value != null);
      return {
        label: group.label,
        conductivityUsCm: avg(conductivityRows)
      };
    });
  }, [chartGroups, liveSnapshotRows, useNodeLevelTrend]);

  const conductivityProfileOption = useMemo(() => {
    const { axisLabel: _unusedAxisLabel, ...baseXAxis } = chartBase.xAxis as Record<string, unknown>;
    const rows = conductivityProfileRows.filter((row) => row.conductivityUsCm != null);
    return {
      ...chartBase,
      grid: { left: "0%", right: "0%", top: 30, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      xAxis: {
        ...baseXAxis,
        data: rows.map((row) => row.label),
        axisLabel: { ...darkAxis().axisLabel, hideOverlap: true }
      },
      yAxis: {
        type: "value",
        name: "μS/cm",
        ...darkAxis(),
        nameTextStyle: { color: "rgba(251, 191, 36, 0.72)" },
        axisLabel: { ...darkAxis().axisLabel, margin: 3 }
      },
      series: [
        {
          name: "电导率",
          type: "bar",
          data: rows.map((row) => row.conductivityUsCm == null ? null : Number(row.conductivityUsCm.toFixed(0))),
          barWidth: 16,
          itemStyle: { color: "rgba(251, 191, 36, 0.82)" }
        }
      ]
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
          showSymbol: false,
          data: group.buckets.map((bucket) => bucket.value == null ? null : Number(bucket.value.toFixed(2))),
          lineStyle: { width: 2.2, color },
          itemStyle: { color },
          areaStyle: { color: "rgba(251, 191, 36, 0.07)" }
        };
      })
    };
  }, [chartBase, conductivityTrendGroups, realtimeTrendWindow.buckets]);

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
          min: 0,
          max: 100,
          ...darkAxis(),
          nameTextStyle: { color: "rgba(52, 211, 153, 0.72)" },
          axisLabel: { ...darkAxis().axisLabel, margin: 2, formatter: "{value}" }
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
            showSymbol: false,
            data: group.buckets.map((bucket) => bucket.temperatureC == null ? null : Number(bucket.temperatureC.toFixed(2))),
            lineStyle: { width: 2.2, color },
            itemStyle: { color }
          },
          {
            name: moistureName,
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            showSymbol: false,
            data: group.buckets.map((bucket) => bucket.moisturePct == null ? null : Number(bucket.moisturePct.toFixed(2))),
            lineStyle: { width: 2, type: "dashed", color, opacity: 0.78 },
            itemStyle: { color, opacity: 0.78 }
          }
        ];
      })
    };
  }, [chartBase, realtimeTrendWindow.buckets, soilTrendGroups]);

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
            showSymbol: false,
            data: group.buckets.map((bucket) => bucket.tiltXDeg == null ? null : Number(bucket.tiltXDeg.toFixed(3))),
            lineStyle: { width: 2.2, color },
            itemStyle: { color }
          },
          {
            name: tiltYName,
            type: "line",
            smooth: true,
            showSymbol: false,
            data: group.buckets.map((bucket) => bucket.tiltYDeg == null ? null : Number(bucket.tiltYDeg.toFixed(3))),
            lineStyle: { width: 2, type: "dashed", color, opacity: 0.78 },
            itemStyle: { color, opacity: 0.78 },
            areaStyle: { color: "rgba(52, 211, 153, 0.04)" }
          }
        ];
      })
    };
  }, [chartBase, realtimeTrendWindow.buckets, tiltTrendGroups]);

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

  const rainfallOption = useMemo(() => {
    const labels = rainfallTrend.map((point) => point.label);
    const data = rainfallTrend.map((point) => point.value);

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      grid: { left: "0%", right: "0%", top: 30, bottom: 0, containLabel: true },
      tooltip: { trigger: "axis", ...darkTooltip() },
      xAxis: { type: "category", data: labels, ...darkAxis() },
      yAxis: { type: "value", ...darkAxis(), axisLabel: { ...darkAxis().axisLabel, margin: 6 } },
      series: [
        {
          name: "雨量",
          type: "bar",
          data,
          itemStyle: { color: "rgba(34, 211, 238, 0.85)" },
          barWidth: 14
        }
      ]
    };
  }, [rainfallTrend]);

  const riskDistributionOption = useMemo(() => {
    const high = visibleStations.filter((s) => s.risk === "high").length;
    const mid = visibleStations.filter((s) => s.risk === "mid").length;
    const low = visibleStations.filter((s) => s.risk === "low").length;
    const total = visibleStations.length;

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
  }, [visibleStations]);

  const anomalyDetails = useMemo(
    () =>
      liveSnapshotRows
        .map((row) => ({ row, analysis: analyzeAnomaly(row) }))
        .filter((entry) => entry.analysis.isAnomaly),
    [liveSnapshotRows]
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

  const freshDeviceCount = useMemo(
    () => liveSnapshotRows.filter((row) => dayjs().diff(dayjs(row.updatedAt), "minute") <= 15).length,
    [liveSnapshotRows]
  );
  const staleDeviceCount = Math.max(0, visibleDevices.length - freshDeviceCount);
  const lowBatteryCount = useMemo(
    () => liveSnapshotRows.filter((row) => row.batteryPct != null && row.batteryPct <= 20).length,
    [liveSnapshotRows]
  );
  const warningFlagCount = useMemo(() => liveSnapshotRows.filter((row) => row.warningFlag).length, [liveSnapshotRows]);
  const tiltAlertCount = useMemo(
    () =>
      liveSnapshotRows.filter(
        (row) => (row.tiltXDeg != null && Math.abs(row.tiltXDeg) >= 120) || (row.tiltYDeg != null && Math.abs(row.tiltYDeg) >= 90)
      ).length,
    [liveSnapshotRows]
  );

  const sensorTypeOption = useMemo(() => {
    const typeOrder: Device["type"][] = ["gnss", "rain", "tilt", "temp_hum", "camera"];
    const abnormalIds = new Set(anomalyDetails.map((entry) => entry.row.device.id));
    const items = typeOrder
      .map((type) => {
        const typed = visibleDevices.filter((device) => device.type === type);
        return {
          label: deviceTypeLabel(type),
          total: typed.length,
          abnormal: typed.filter((device) => abnormalIds.has(device.id)).length
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
          name: "异常",
          type: "bar",
          data: items.map((item) => item.abnormal),
          itemStyle: { color: "rgba(239, 68, 68, 0.82)" },
          barWidth: 12
        }
      ]
    };
  }, [anomalyDetails, visibleDevices]);

  const operationalSummary = useMemo(() => {
    if (!visibleDevices.length) {
      return [
        "当前没有设备接入，未归档数据不会显示在当前视图。",
        "设备接入后，大屏将展示真实站点、异常与雨量统计。"
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
      `当前${activeArea ? scopeLevelLabel(activeArea.level) : "范围"} ${activeArea?.label ?? "未选择"}，分节点 ${visibleStations.length} 个，设备 ${visibleDevices.length} 台，在线 ${stats.online} 台，离线 ${stats.offline} 台。`,
      `${realtimeTrendWindow.label}累计雨量 ${rainfallSummary.total.toFixed(2)} mm。`,
      `低电量 ${lowBatteryCount} 台，已触发预警 ${warningFlagCount} 台，姿态超阈 ${tiltAlertCount} 台。`,
      topAnomaly
        ? `优先处置：${topAnomaly.deviceName}，${topAnomaly.message}。`
        : strongestTilt
          ? `当前未检出异常，姿态最大设备为 ${strongestTilt.deviceName}，最大倾角 ${strongestTilt.magnitude.toFixed(2)}°。`
          : "当前未检出设备异常。"
    ];
    if (latestAiPrediction?.riskCalibration) {
      const calibration = latestAiPrediction.riskCalibration;
      const threshold = calibration.threshold == null ? "—" : calibration.threshold.toFixed(6);
      const over = calibration.scoreOverThreshold == null ? "—" : `${calibration.scoreOverThreshold.toFixed(2)}x`;
      summary.push(
        `区域专家模型：${riskLevelText(latestAiPrediction.riskLevel)}，score=${latestAiPrediction.riskScore.toFixed(4)}，阈值=${threshold}，越阈=${over}。`
      );
    } else if (latestAiPrediction) {
      summary.push(
        `区域专家模型：${riskLevelText(latestAiPrediction.riskLevel)}，score=${latestAiPrediction.riskScore.toFixed(4)}，暂无校准阈值。`
      );
    }
    if (latestAiPrediction?.forecastInference) {
      const forecast = latestAiPrediction.forecastInference;
      summary.push(
        `形变预测模型：${forecastHorizonText(forecast.horizonSpec)} 形变增量 ${formatForecastDisplacementMm(
          forecast.predictedDisplacementMm
        )}，模型 ${forecast.modelVersion ?? forecast.modelKey ?? "forecast"}。`
      );
    }
    if (fieldAlarmStatus?.active) {
      summary.unshift(
        `现场声光报警已触发：${fieldAlarmStatus.latestAlert?.title || "RK3568 声光报警器处于动作状态"}，请先人工复核现场。`
      );
    } else if (fieldAlarmStatus?.silenced) {
      summary.unshift("现场声光报警已静音，事件仍处于人工复核窗口。");
    }
    return summary;
  }, [activeArea, anomalies, fieldAlarmStatus, latestAiPrediction, liveSnapshotRows, lowBatteryCount, rainfallSummary, realtimeTrendWindow.label, stats.offline, stats.online, tiltAlertCount, visibleDevices.length, visibleStations.length, warningFlagCount]);

  const warningCount = anomalyDetails.filter((entry) => entry.analysis.level === "warn").length;
  const physicalAlarmActive = fieldAlarmStatus?.active ?? false;
  const hasOffline = stats.offline > 0;
  const hasCritical = physicalAlarmActive;
  const hasWarn = warningCount > 0;
  const reviewQueueUsefulRatio = baijiabaoReviewQueueSnapshot.sourceSummary.reviewPrecision;
  const reviewQueueWinterRatio = baijiabaoReviewQueueSnapshot.sourceSummary.winterUsefulRatio;
  const reviewQueueSeverityOptions = useMemo(
    () => ["all", ...baijiabaoReviewQueueSnapshot.summary.bySeverity.map((entry) => entry.key)] as ReviewQueueSeverityFilter[],
    []
  );
  const reviewQueueActionOptions = useMemo(
    () => ["all", ...baijiabaoReviewQueueSnapshot.summary.byRecommendedAction.map((entry) => entry.key)] as ReviewQueueActionFilter[],
    []
  );
  const reviewQueuePointOptions = useMemo(
    () => ["all", ...baijiabaoReviewQueueSnapshot.summary.byPoint.map((entry) => entry.key)],
    []
  );
  const reviewQueueFilteredItems = useMemo(() => {
    return baijiabaoReviewQueueSnapshot.items.filter((item) => {
      if (reviewQueueSeverityFilter !== "all" && item.severity !== reviewQueueSeverityFilter) return false;
      if (reviewQueueActionFilter !== "all" && item.recommendedAction !== reviewQueueActionFilter) return false;
      if (reviewQueuePointFilter !== "all" && item.pointId !== reviewQueuePointFilter) return false;
      return true;
    });
  }, [reviewQueueActionFilter, reviewQueuePointFilter, reviewQueueSeverityFilter]);
  const selectedReviewQueueItem = useMemo(() => {
    return (
      reviewQueueFilteredItems.find((item) => item.queueItemId === selectedReviewQueueId) ??
      reviewQueueFilteredItems[0] ??
      null
    );
  }, [reviewQueueFilteredItems, selectedReviewQueueId]);
  const reviewQueueFilterActive =
    reviewQueueSeverityFilter !== "all" || reviewQueueActionFilter !== "all" || reviewQueuePointFilter !== "all";
  const clearReviewQueueFilters = useCallback(() => {
    setReviewQueueSeverityFilter("all");
    setReviewQueueActionFilter("all");
    setReviewQueuePointFilter("all");
  }, []);
  const showReviewQueueExportStatus = useCallback((message: string) => {
    setReviewQueueExportStatus(message);
    window.setTimeout(() => setReviewQueueExportStatus(""), 3200);
  }, []);
  const downloadReviewQueueCsv = useCallback(() => {
    if (!reviewQueueFilteredItems.length) {
      showReviewQueueExportStatus("当前筛选没有可导出的队列项。");
      return;
    }
    const csv = `\uFEFF${buildReviewQueueCsv(reviewQueueFilteredItems)}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = dayjs().format("YYYYMMDD-HHmmss");
    a.href = url;
    a.download = `baijiabao-review-queue-filtered-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showReviewQueueExportStatus(`已导出 ${reviewQueueFilteredItems.length} 条筛选结果。`);
  }, [reviewQueueFilteredItems, showReviewQueueExportStatus]);
  const copySelectedReviewQueueEvidence = useCallback(() => {
    if (!selectedReviewQueueItem) {
      showReviewQueueExportStatus("当前没有选中的复核项。");
      return;
    }
    void copyTextToClipboard(buildReviewQueueEvidenceText(selectedReviewQueueItem))
      .then(() => {
        showReviewQueueExportStatus(`已复制 ${selectedReviewQueueItem.sourceReviewItemId} 的证据摘要。`);
      })
      .catch(() => {
        showReviewQueueExportStatus("复制失败，当前宿主可能禁用了剪贴板。");
      });
  }, [selectedReviewQueueItem, showReviewQueueExportStatus]);

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

  const acknowledgeFieldAlarm = useCallback(async () => {
    setFieldAlarmReviewSubmitting(true);
    setFieldAlarmReviewError("");
    try {
      await api.fieldAlarm.sendAction({
        action: "ack",
        reason: fieldAlarmReviewNote.trim() || "人工确认已到场复核，先静音保留事件。",
        ...(fieldAlarmAlertId ? { alertId: fieldAlarmAlertId } : {})
      });
      await loadData({ silent: true });
    } catch (err) {
      setFieldAlarmReviewError(err instanceof Error ? err.message : "复核静音失败，请检查 API 或 RK3568 执行器连接。");
    } finally {
      setFieldAlarmReviewSubmitting(false);
    }
  }, [api, fieldAlarmAlertId, fieldAlarmReviewNote, loadData]);

  const resolveFieldAlarm = useCallback(async () => {
    setFieldAlarmReviewSubmitting(true);
    setFieldAlarmReviewError("");
    try {
      await api.fieldAlarm.sendAction({
        action: "resolve",
        reason: fieldAlarmReviewNote.trim() || "现场复核确认，解除声光报警。",
        ...(fieldAlarmAlertId ? { alertId: fieldAlarmAlertId } : {})
      });
      setFieldAlarmReviewOpen(false);
      await loadData({ silent: true });
    } catch (err) {
      setFieldAlarmReviewError(err instanceof Error ? err.message : "解除警报失败，请检查 API 或 RK3568 执行器连接。");
    } finally {
      setFieldAlarmReviewSubmitting(false);
    }
  }, [api, fieldAlarmAlertId, fieldAlarmReviewNote, loadData]);

  const selectedStations = useMemo(() => {
    if (!selectedStationIds.length) return [];
    const set = new Set(selectedStationIds);
    return visibleStations.filter((s) => set.has(s.id));
  }, [selectedStationIds, visibleStations]);

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
                    ? `${option.label} · ${option.stationIds.length} 分节点`
                    : `${scopeLevelLabel(option.level)}：${option.label} · ${option.stationIds.length} 分节点`
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
            <Tag color="cyan">分节点 {stats.stations}</Tag>
            <Tag color="green">在线 {stats.online}</Tag>
            <Tag color={hasWarn ? "orange" : "blue"}>异常 {warningCount}</Tag>
            <Tag color={hasOffline ? "red" : "blue"}>离线 {stats.offline}</Tag>
            {fieldAlarmStatus?.active ? <Tag color="red">现场声光报警</Tag> : null}
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
              {fieldAlarmStatus.latestAlert?.title || "RK3568 声光报警器动作状态已由平台捕获"}
            </div>
          </div>
          <div className="desk-analysis-field-alarm-meta">
            <span>活跃 {fieldAlarmStatus.activeCount}</span>
            <span>复核 {fieldAlarmStatus.ackedCount}</span>
            <span>{fieldAlarmStatus.actuator.available ? "RK3568 已连接" : "执行器未连接"}</span>
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
        width={560}
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
            先静音，继续复核
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
            确认复核并解除警报
          </Button>
        ]}
      >
        <div className="desk-analysis-review-body">
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
              <span>最近事件</span>
              <strong>{fieldAlarmLastEventAt ? formatBeijingDateTime(fieldAlarmLastEventAt) : "未记录"}</strong>
            </div>
          </div>
          <div className="desk-analysis-review-alert">
            {fieldAlarmStatus?.latestAlert?.title || "RK3568 声光报警器动作状态已由平台捕获"}
          </div>
          <Input.TextArea
            rows={3}
            value={fieldAlarmReviewNote}
            maxLength={500}
            showCount
            onChange={(event) => setFieldAlarmReviewNote(event.target.value)}
          />
          <div className="desk-analysis-review-hint">
            提交后会写入告警生命周期事件和操作日志；“解除警报”会关闭 RK3568 声光报警并清除当前红色预警态。
          </div>
          {fieldAlarmReviewError ? <div className="desk-analysis-review-error">{fieldAlarmReviewError}</div> : null}
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
              <BaseCard title={`雨量趋势（${realtimeTrendWindow.label}，mm）`}>
                <ReactECharts option={rainfallOption} style={{ height: "100%" }} />
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
                  <div className="desk-review-queue">
                    <div className="desk-review-queue-head">
                      <div>
                        <div className="desk-review-queue-title">AI 离线复核队列</div>
                        <div className="desk-review-queue-subtitle">白家堡 Batch-1 模型复核候选队列</div>
                      </div>
                      <div className="desk-review-queue-head-actions">
                        <Tag color={baijiabaoReviewQueueSnapshot.productGate.reviewOnlyWorkflowCandidate ? "green" : "orange"}>
                          {baijiabaoReviewQueueSnapshot.productGate.reviewOnlyWorkflowCandidate ? "可进入复核流" : "待验证"}
                        </Tag>
                        <Button size="small" onClick={downloadReviewQueueCsv}>
                          导出CSV
                        </Button>
                        <Button size="small" onClick={copySelectedReviewQueueEvidence}>
                          复制证据
                        </Button>
                      </div>
                    </div>
                    <div className="desk-review-queue-metrics">
                      <div>
                        <span className="k">队列</span>
                        <span className="v">{baijiabaoReviewQueueSnapshot.summary.itemCount}</span>
                      </div>
                      <div>
                        <span className="k">复核有效率</span>
                        <span className="v">{(reviewQueueUsefulRatio * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="k">winter useful</span>
                        <span className="v">{(reviewQueueWinterRatio * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="desk-review-queue-filters">
                      <div className="desk-review-queue-filter-group" aria-label="复核优先级筛选">
                        {reviewQueueSeverityOptions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={clsx("desk-review-queue-filter", reviewQueueSeverityFilter === value && "is-active")}
                            onClick={() => setReviewQueueSeverityFilter(value)}
                          >
                            {value === "all" ? "全部优先级" : reviewSeverityLabel(value)}
                          </button>
                        ))}
                      </div>
                      <div className="desk-review-queue-filter-group" aria-label="复核点位筛选">
                        {reviewQueuePointOptions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={clsx("desk-review-queue-filter", reviewQueuePointFilter === value && "is-active")}
                            onClick={() => setReviewQueuePointFilter(value)}
                          >
                            {value === "all" ? "全部点位" : value}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="desk-review-queue-action-filters" aria-label="复核动作筛选">
                      {reviewQueueActionOptions.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={clsx("desk-review-queue-filter", reviewQueueActionFilter === value && "is-active")}
                          onClick={() => setReviewQueueActionFilter(value)}
                        >
                          {value === "all" ? "全部动作" : reviewActionLabel(value)}
                        </button>
                      ))}
                      {reviewQueueFilterActive ? (
                        <button type="button" className="desk-review-queue-filter is-reset" onClick={clearReviewQueueFilters}>
                          重置筛选
                        </button>
                      ) : null}
                    </div>
                    <div className="desk-review-queue-workbench">
                      <div className="desk-review-queue-list">
                        {reviewQueueFilteredItems.length ? (
                          reviewQueueFilteredItems.map((item) => (
                            <button
                              key={item.queueItemId}
                              type="button"
                              className={clsx(
                                "desk-review-queue-item",
                                selectedReviewQueueItem?.queueItemId === item.queueItemId && "is-selected"
                              )}
                              onClick={() => setSelectedReviewQueueId(item.queueItemId)}
                            >
                              <div className="desk-review-queue-item-main">
                                <span className="desk-review-queue-priority">#{item.priority}</span>
                                <span className="desk-review-queue-point">{item.pointId}</span>
                                <Tag color={reviewSeverityColor(item.severity)}>{reviewSeverityLabel(item.severity)}</Tag>
                              </div>
                              <div className="desk-review-queue-item-meta">
                                <span>{reviewActionLabel(item.recommendedAction)}</span>
                                <span>{reviewClassLabel(item.autoReview.finalClass)}</span>
                                <span>{reviewDateLabel(item.window.startTs)} 至 {reviewDateLabel(item.window.endTs)}</span>
                                <span>{item.window.durationDays} 天</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="desk-review-queue-empty">
                            当前筛选无队列项。{reviewQueueFilterActive ? "可重置筛选查看全部候选。" : ""}
                          </div>
                        )}
                      </div>
                      {selectedReviewQueueItem ? (
                        <div className="desk-review-queue-detail">
                          <div className="desk-review-queue-detail-head">
                            <div>
                              <div className="desk-review-queue-detail-title">
                                #{selectedReviewQueueItem.priority} {selectedReviewQueueItem.pointId}
                              </div>
                              <div className="desk-review-queue-detail-subtitle">
                                {selectedReviewQueueItem.sourceReviewItemId} · {selectedReviewQueueItem.window.seasonSet}
                              </div>
                            </div>
                            <Tag color={selectedReviewQueueItem.autoReview.useful === "yes" ? "green" : selectedReviewQueueItem.autoReview.useful === "no" ? "default" : "purple"}>
                              {reviewUsefulLabel(selectedReviewQueueItem.autoReview.useful)}
                            </Tag>
                          </div>
                          <div className="desk-review-queue-detail-grid">
                            <div>
                              <span>窗口</span>
                              <strong>
                                {reviewDateLabel(selectedReviewQueueItem.window.startTs)} 至 {reviewDateLabel(selectedReviewQueueItem.window.endTs)}
                              </strong>
                            </div>
                            <div>
                              <span>证据行</span>
                              <strong>{selectedReviewQueueItem.evidenceSummary.evidenceRowCount}</strong>
                            </div>
                            <div>
                              <span>immediate</span>
                              <strong>{selectedReviewQueueItem.evidenceSummary.immediatePositiveDays}</strong>
                            </div>
                            <div>
                              <span>grey zone</span>
                              <strong>{selectedReviewQueueItem.evidenceSummary.greyZoneDays}</strong>
                            </div>
                            <div>
                              <span>within 30d</span>
                              <strong>{selectedReviewQueueItem.evidenceSummary.within30Days}</strong>
                            </div>
                            <div>
                              <span>isolated</span>
                              <strong>{selectedReviewQueueItem.evidenceSummary.isolatedDays}</strong>
                            </div>
                          </div>
                          <div className="desk-review-queue-detail-line">
                            <span>推荐动作</span>
                            <strong>{reviewActionLabel(selectedReviewQueueItem.recommendedAction)}</strong>
                          </div>
                          <div className="desk-review-queue-detail-line">
                            <span>自动分类</span>
                            <strong>{reviewClassLabel(selectedReviewQueueItem.autoReview.finalClass)} · 置信度 {reviewConfidenceLabel(selectedReviewQueueItem.autoReview.confidence)}</strong>
                          </div>
                          <div className="desk-review-queue-detail-line">
                            <span>规则</span>
                            <strong>{selectedReviewQueueItem.autoReview.rule}</strong>
                          </div>
                          <div className="desk-review-queue-detail-line">
                            <span>证据混合</span>
                            <strong>{selectedReviewQueueItem.evidenceSummary.classificationMix}</strong>
                          </div>
                          <div className="desk-review-queue-detail-line">
                            <span>booster max</span>
                            <strong>{selectedReviewQueueItem.evidenceSummary.maxBoosterScore.toFixed(4)}</strong>
                          </div>
                          <div className="desk-review-queue-detail-warning">
                            {selectedReviewQueueItem.autoReview.rawEvidenceNeeded === "yes"
                              ? "需要补查原始证据。"
                              : "当前机器证据较完整。"}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
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
                      <span className="desk-sensor-label">低电量</span>
                      <span className="desk-sensor-value" style={{ color: "#f59e0b" }}>
                        {String(lowBatteryCount)}
                      </span>
                    </div>
                    <div className="desk-sensor-item">
                      <span className="desk-sensor-label">预警设备</span>
                      <span className="desk-sensor-value" style={{ color: "#ef4444" }}>
                        {String(warningFlagCount)}
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

