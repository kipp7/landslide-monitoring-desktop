import type { MenuProps } from "antd";
import {
  App as AntApp,
  Alert,
  Button,
  Col,
  Dropdown,
  Form,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tabs,
  Typography
} from "antd";
import { ExportOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AiPrediction, Baseline, Device, GpsDerivedAnalysis, GpsSeries, TelemetrySeriesPoint } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { formatBeijingDateTime, formatBeijingMonthDay, formatBeijingMonthDayTime, formatBeijingTime } from "../utils/beijingTime";
import { buildGpsAnalysisExport, buildGpsChartExport, buildGpsCsvExport, buildGpsReportExport, triggerPreparedExport } from "./gpsMonitoringExport";
import "./gpsMonitoring.css";

type TimeRange = "1h" | "6h" | "24h" | "7d" | "15d" | "30d";
type GpsTabKey = "realtime" | "ceemd" | "prediction" | "data";
type Thresholds = { blue: number; yellow: number; red: number };
type GpsReferencePoint = { lat: number; lng: number; source: "baseline" | "temporary"; label: string };
type GpsTrendDirection = NonNullable<GpsDerivedAnalysis["trendDiagnostics"]>["direction"];
type GpsThresholdForecastPoint = NonNullable<NonNullable<GpsDerivedAnalysis["prediction"]>["thresholdForecast"]>["longTerm"]["red"];

const GPS_THRESHOLD_BLUE_KEY = "gps.displacement_threshold_blue_mm";
const GPS_THRESHOLD_YELLOW_KEY = "gps.displacement_threshold_yellow_mm";
const GPS_THRESHOLD_RED_KEY = "gps.displacement_threshold_red_mm";
const GPS_DATA_LIMIT_KEY = "gps.data_limit";

function isTimeRange(value: string): value is TimeRange {
  return value === "1h" || value === "6h" || value === "24h" || value === "7d" || value === "15d" || value === "30d";
}

function isGpsTabKey(value: string | null): value is GpsTabKey {
  return value === "realtime" || value === "ceemd" || value === "prediction" || value === "data";
}

type GpsChartRow = {
  key: string;
  ts: string;
  time: string;
  displacement: number;
  horizontal: number;
  vertical: number | null;
  velocityMmH: number;
  temperature: number | null;
  humidity: number | null;
  confidence: number | null;
  riskLevel: number;
  lat: number | null;
  lng: number | null;
};

function daysFromRange(range: TimeRange) {
  if (range === "1h") return 1;
  if (range === "6h") return 1;
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  if (range === "15d") return 15;
  return 30;
}

function computeTelemetryWindow(range: TimeRange): { startTime: string; endTime: string; interval: "5m" | "1h" | "1d" } {
  const end = new Date();
  const start = new Date(end);
  let interval: "5m" | "1h" | "1d" = "1h";

  if (range === "1h") {
    start.setHours(start.getHours() - 1);
    interval = "5m";
  } else if (range === "6h") {
    start.setHours(start.getHours() - 6);
    interval = "5m";
  } else if (range === "24h") {
    start.setHours(start.getHours() - 24);
    interval = "1h";
  } else if (range === "7d") {
    start.setDate(start.getDate() - 7);
    interval = "1h";
  } else if (range === "15d") {
    start.setDate(start.getDate() - 15);
    interval = "1d";
  } else {
    start.setDate(start.getDate() - 30);
    interval = "1d";
  }

  return { startTime: start.toISOString(), endTime: end.toISOString(), interval };
}

function bucketKey(ts: string, range: TimeRange): string {
  if (range === "1h" || range === "6h") return formatBeijingDateTime(ts, { includeSeconds: false });
  if (range === "24h" || range === "7d") return formatBeijingMonthDayTime(ts, { includeMinutes: false });
  return formatBeijingMonthDay(ts);
}

function readOptionalNumber(value: number | null | undefined, digits = 2): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function formatOptionalNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function riskFromDispMm(dispMm: number, thresholds: Thresholds) {
  if (dispMm >= thresholds.red) return 3;
  if (dispMm >= thresholds.yellow) return 2;
  if (dispMm >= thresholds.blue) return 1;
  return 0;
}

function riskColor(level: number) {
  if (level >= 3) return "#ef4444";
  if (level >= 2) return "#f59e0b";
  if (level >= 1) return "#3b82f6";
  return "#22c55e";
}

function riskDesc(level: number) {
  if (level >= 3) return "红色预警";
  if (level >= 2) return "黄色预警";
  if (level >= 1) return "蓝色预警";
  return "正常";
}

function trendDirectionText(direction: GpsTrendDirection | null | undefined): string {
  if (direction === "increasing") return "上升";
  if (direction === "decreasing") return "下降";
  if (direction === "stable") return "平稳";
  return "--";
}

function aiRiskDesc(level: AiPrediction["riskLevel"]): string {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  if (level === "low") return "低风险";
  return "未知";
}

function aiRiskColor(level: AiPrediction["riskLevel"]) {
  if (level === "high") return "#ef4444";
  if (level === "medium") return "#f59e0b";
  if (level === "low") return "#22c55e";
  return "rgba(148, 163, 184, 0.9)";
}

function forecastHorizonText(value: string | null | undefined): string {
  if (value === "24h") return "未来 24h";
  if (value === "72h") return "未来 72h";
  if (value && value.trim()) return `未来 ${value.trim()}`;
  return "未来窗口";
}

function formatForecastDisplacementMm(value: number | null | undefined, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} mm` : "--";
}

function formatTargetValue(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

function buildMonitoringPointLabel(device: Device | null, forecast: AiPrediction["forecastInference"] | null | undefined): string {
  return formatTargetValue([forecast?.pointId, device?.displayName, device?.installLabel, device?.stationName, device?.name].find((value) => value?.trim()));
}

function forecastRunStatusText(forecast: AiPrediction["forecastInference"] | null | undefined): string {
  if (!forecast) return "待输出";
  if (forecast.requiredFeaturesSatisfied === false) return "特征待补";
  return "运行正常";
}

function forecastRunStatusColor(forecast: AiPrediction["forecastInference"] | null | undefined): string {
  if (!forecast) return "default";
  if (forecast.requiredFeaturesSatisfied === false) return "orange";
  return "green";
}

function thresholdEtaText(forecast: GpsThresholdForecastPoint | null | undefined): string {
  if (!forecast) return "等待越界判断";
  if (!forecast.breached) return "红色阈值未触发";
  if (forecast.etaHours != null) return `${forecast.etaHours}h 触发红色阈值`;
  if (forecast.etaDays != null) return `${forecast.etaDays}d 触发红色阈值`;
  return "红色阈值已触发";
}

function axisTheme() {
  return {
    axisLabel: { color: "rgba(226, 232, 240, 0.85)" },
    axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.45)" } },
    splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
  };
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function isBaselineMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return message.includes("未找到基准点") || normalized.includes("baseline");
}

function formatGpsAxisTime(ts: string, range: TimeRange): string {
  if (range === "1h" || range === "6h") return formatBeijingMonthDayTime(ts);
  if (range === "24h" || range === "7d") return formatBeijingMonthDayTime(ts, { includeMinutes: false });
  return formatBeijingMonthDay(ts);
}

function buildRawGpsSeriesFromTelemetry(
  deviceId: string,
  latSeries: TelemetrySeriesPoint[],
  lngSeries: TelemetrySeriesPoint[]
): { series: GpsSeries; referencePoint: GpsReferencePoint | null } {
  const rows = new Map<string, { lat?: number; lng?: number }>();

  for (const point of latSeries) {
    const entry = rows.get(point.ts) ?? {};
    entry.lat = point.value;
    rows.set(point.ts, entry);
  }

  for (const point of lngSeries) {
    const entry = rows.get(point.ts) ?? {};
    entry.lng = point.value;
    rows.set(point.ts, entry);
  }

  const ordered = Array.from(rows.entries())
    .filter((entry): entry is [string, { lat: number; lng: number }] => {
      const value = entry[1];
      return typeof value.lat === "number" && Number.isFinite(value.lat) && typeof value.lng === "number" && Number.isFinite(value.lng);
    })
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));

  if (!ordered.length) {
    return {
      series: { deviceId, deviceName: deviceId, points: [] },
      referencePoint: null
    };
  }

  const referenceSeed = ordered.slice(0, Math.min(12, ordered.length));
  const referenceLat = referenceSeed.reduce((sum, entry) => sum + entry[1].lat, 0) / referenceSeed.length;
  const referenceLng = referenceSeed.reduce((sum, entry) => sum + entry[1].lng, 0) / referenceSeed.length;
  const referencePoint: GpsReferencePoint = {
    lat: Number(referenceLat.toFixed(6)),
    lng: Number(referenceLng.toFixed(6)),
    source: "temporary",
    label: "临时参考点"
  };

  return {
    series: {
      deviceId,
      deviceName: deviceId,
      points: ordered.map(([ts, coords]) => {
        const horizontalMeters = haversineMeters(referenceLat, referenceLng, coords.lat, coords.lng);
        const horizontalMm = Number((horizontalMeters * 1000).toFixed(2));
        return {
          ts,
          dispMm: horizontalMm,
          horizontalMm,
          latitude: Number(coords.lat.toFixed(6)),
          longitude: Number(coords.lng.toFixed(6))
        };
      })
    },
    referencePoint
  };
}

export function GpsMonitoringPage() {
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();

  const [devices, setDevices] = useState<Device[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [activeTab, setActiveTab] = useState<GpsTabKey>("realtime");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [series, setSeries] = useState<GpsSeries | null>(null);
  const [derivedAnalysis, setDerivedAnalysis] = useState<GpsDerivedAnalysis | null>(null);
  const [temperatureSeries, setTemperatureSeries] = useState<TelemetrySeriesPoint[]>([]);
  const [humiditySeries, setHumiditySeries] = useState<TelemetrySeriesPoint[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [nowTime, setNowTime] = useState<string>(formatBeijingTime(new Date()));
  const [temporaryReferencePoint, setTemporaryReferencePoint] = useState<GpsReferencePoint | null>(null);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [latestAiPrediction, setLatestAiPrediction] = useState<AiPrediction | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [thresholds, setThresholds] = useState<Thresholds>({ blue: 2, yellow: 5, red: 8 });
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [form] = Form.useForm<Thresholds>();

  const DATA_LIMIT_STORAGE_KEY = "desk.gps.dataLimit.v1";
  const [dataLimit, setDataLimit] = useState<number>(() => {
    const raw = localStorage.getItem(DATA_LIMIT_STORAGE_KEY);
    const parsed = raw ? Number(raw) : 200;
    const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : 200;
    return Math.max(50, Math.min(2000, safe));
  });
  const [showLimit, setShowLimit] = useState(false);
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitForm] = Form.useForm<{ limit: number }>();

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(formatBeijingTime(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const queryInitRef = useRef(false);

  useEffect(() => {
    if (queryInitRef.current) return;
    queryInitRef.current = true;
    const params = new URLSearchParams(location.search);
    const qDevice = params.get("deviceId");
    const qRange = params.get("range");
    const qAuto = params.get("autoRefresh");
    const qTab = params.get("tab");

    if (qDevice) setSelectedDeviceId(qDevice);
    if (qRange && isTimeRange(qRange)) setTimeRange(qRange);
    if (isGpsTabKey(qTab)) setActiveTab(qTab);
    if (qAuto === "1" || qAuto === "true") setAutoRefresh(true);
    if (qAuto === "0" || qAuto === "false") setAutoRefresh(false);
  }, [location.search]);

  useEffect(() => {
    if (!queryInitRef.current) return;
    const params = new URLSearchParams(location.search);
    if (selectedDeviceId) params.set("deviceId", selectedDeviceId);
    else params.delete("deviceId");
    params.set("range", timeRange);
    params.set("tab", activeTab);
    params.set("autoRefresh", autoRefresh ? "1" : "0");
    const nextSearch = `?${params.toString()}`;
    if (nextSearch !== (location.search || "")) {
      navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
    }
  }, [activeTab, autoRefresh, location.pathname, location.search, navigate, selectedDeviceId, timeRange]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(null);
    const run = async () => {
      try {
        const [deviceList, baselineList] = await Promise.all([api.devices.list(), api.baselines.list()]);
        if (abort.signal.aborted) return;
        const gnssCandidates = deviceList.filter((d) => d.type === "gnss");
        const formalGnss = gnssCandidates.filter((d) => isFormalIdentityClass(d.identityClass));
        const gnss = formalGnss.length > 0 ? formalGnss : gnssCandidates;
        setDevices(gnss);
        setBaselines(baselineList);
        setSelectedDeviceId((prev) => (prev && gnss.some((device) => device.id === prev) ? prev : gnss[0]?.id || ""));
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = (err as Error).message;
        setLoadError(msg);
        message.error(`形变监测页面加载失败：${msg}（可在系统设置检查数据源与接口地址）`);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => abort.abort();
  }, [api]);

  useEffect(() => {
    const abort = new AbortController();
    const run = async () => {
      try {
        const configs = await api.system.getConfigs();
        if (abort.signal.aborted) return;
        const getNumber = (key: string, fallback: number) => {
          const value = configs.find((item) => item.key === key)?.value;
          const parsed = typeof value === "string" ? Number(value) : Number.NaN;
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        setThresholds({
          blue: getNumber(GPS_THRESHOLD_BLUE_KEY, 2),
          yellow: getNumber(GPS_THRESHOLD_YELLOW_KEY, 5),
          red: getNumber(GPS_THRESHOLD_RED_KEY, 8)
        });
        const configuredLimit = getNumber(GPS_DATA_LIMIT_KEY, 200);
        const normalizedLimit = Math.max(50, Math.min(2000, Math.trunc(configuredLimit)));
        setDataLimit(normalizedLimit);
        localStorage.setItem(DATA_LIMIT_STORAGE_KEY, String(normalizedLimit));
      } catch {
        // keep local defaults when config read is unavailable
      }
    };
    void run();
    return () => abort.abort();
  }, [api]);

  const refresh = async () => {
    if (!selectedDeviceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const days = daysFromRange(timeRange);
      const telemetryWindow = computeTelemetryWindow(timeRange);
      let nextSeries: GpsSeries;
      let nextDerivedAnalysis: GpsDerivedAnalysis | null = null;
      let nextTemporaryReferencePoint: GpsReferencePoint | null = null;
      let nextNotice: string | null = null;

      try {
        nextSeries = await api.gps.getSeries({ deviceId: selectedDeviceId, days });
        try {
          nextDerivedAnalysis = await api.gps.getDerivedAnalysis({ deviceId: selectedDeviceId, rangeLabel: timeRange, limit: dataLimit });
        } catch (analysisError) {
          nextNotice = isBaselineMissingError(analysisError)
            ? "当前设备尚未建立持久基线，分析页已退化为实时坐标视图。"
            : `形变分析暂不可用：${analysisError instanceof Error ? analysisError.message : String(analysisError)}`;
        }
      } catch (seriesError) {
        if (!isBaselineMissingError(seriesError)) {
          throw seriesError;
        }

        const [latSeries, lngSeries] = await Promise.all([
          api.telemetry.getSeries({
            deviceId: selectedDeviceId,
            sensorKey: "gps_latitude",
            startTime: telemetryWindow.startTime,
            endTime: telemetryWindow.endTime,
            interval: telemetryWindow.interval
          }),
          api.telemetry.getSeries({
            deviceId: selectedDeviceId,
            sensorKey: "gps_longitude",
            startTime: telemetryWindow.startTime,
            endTime: telemetryWindow.endTime,
            interval: telemetryWindow.interval
          })
        ]);

        const rawGps = buildRawGpsSeriesFromTelemetry(selectedDeviceId, latSeries, lngSeries);
        nextSeries = rawGps.series;
        nextTemporaryReferencePoint = rawGps.referencePoint;
        nextNotice = rawGps.referencePoint
          ? "当前设备尚未建立持久基线，页面已按实时坐标自动生成临时参考点，仅用于当前窗口查看。"
          : "当前设备尚未建立持久基线，且当前窗口没有可用定位坐标数据。";
      }

      const [temperature, humidity, aiPredictionResult] = await Promise.all([
        api.telemetry
          .getSeries({
            deviceId: selectedDeviceId,
            sensorKey: "temperature_c",
            startTime: telemetryWindow.startTime,
            endTime: telemetryWindow.endTime,
            interval: telemetryWindow.interval
          })
          .catch(() => []),
        api.telemetry
          .getSeries({
            deviceId: selectedDeviceId,
            sensorKey: "humidity_pct",
            startTime: telemetryWindow.startTime,
            endTime: telemetryWindow.endTime,
            interval: telemetryWindow.interval
          })
          .catch(() => []),
        api.aiPredictions
          .list({
            page: 1,
            pageSize: 1,
            deviceId: selectedDeviceId
          })
          .catch(() => null)
      ]);
      setSeries(nextSeries);
      setDerivedAnalysis(nextDerivedAnalysis);
      setTemperatureSeries(temperature);
      setHumiditySeries(humidity);
      setLatestAiPrediction(aiPredictionResult?.list[0] ?? null);
      setTemporaryReferencePoint(nextTemporaryReferencePoint);
      setGpsNotice(nextNotice);
      setLastUpdateTime(formatBeijingDateTime(new Date()));
    } catch (err) {
      const msg = (err as Error).message;
      setLoadError(msg);
      message.error(`获取形变数据失败：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [dataLimit, selectedDeviceId, timeRange]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [autoRefresh, selectedDeviceId, timeRange]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  );
  const baseline = useMemo(
    () => baselines.find((b) => b.deviceId === selectedDeviceId) ?? null,
    [baselines, selectedDeviceId]
  );
  const referencePoint = baseline
    ? ({ lat: baseline.baselineLat, lng: baseline.baselineLng, source: "baseline", label: "持久基线" } satisfies GpsReferencePoint)
    : temporaryReferencePoint;

  const pts = series?.points ?? [];

  const chartData: GpsChartRow[] = useMemo(() => {
    const temperatureByBucket = new Map<string, number>();
    const humidityByBucket = new Map<string, number>();
    for (const point of temperatureSeries) {
      temperatureByBucket.set(bucketKey(point.ts, timeRange), point.value);
    }
    for (const point of humiditySeries) {
      humidityByBucket.set(bucketKey(point.ts, timeRange), point.value);
    }
    const rows: GpsChartRow[] = [];

    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!;
      const prev = i > 0 ? pts[i - 1]! : null;
      const disp = p.dispMm;
      const rowBucket = bucketKey(p.ts, timeRange);
      const horizontal = readOptionalNumber(p.horizontalMm ?? disp, 2) ?? disp;
      const vertical = readOptionalNumber(p.verticalMm, 2);

      const dtHours = prev ? Math.max(1 / 60, (Date.parse(p.ts) - Date.parse(prev.ts)) / 3.6e6) : 1;
      const velocityMmH = prev ? Number(((disp - prev.dispMm) / dtHours).toFixed(3)) : 0;
      const riskLevel = riskFromDispMm(disp, thresholds);
      const confidence = readOptionalNumber(derivedAnalysis?.prediction?.confidence ?? derivedAnalysis?.qualityScore, 2);
      const lat = readOptionalNumber(p.latitude, 6);
      const lng = readOptionalNumber(p.longitude, 6);

      rows.push({
        key: `${p.ts}-${i}`,
        ts: p.ts,
        time: formatGpsAxisTime(p.ts, timeRange),
        displacement: Number(disp.toFixed(2)),
        horizontal,
        vertical,
        velocityMmH,
        temperature: readOptionalNumber(temperatureByBucket.get(rowBucket), 1),
        humidity: readOptionalNumber(humidityByBucket.get(rowBucket), 0),
        confidence,
        riskLevel,
        lat,
        lng
      });
    }

    return rows.slice(-dataLimit);
  }, [dataLimit, derivedAnalysis?.prediction?.confidence, derivedAnalysis?.qualityScore, humiditySeries, pts, temperatureSeries, thresholds, timeRange]);

  const latest = chartData.at(-1) ?? null;
  const predictionConfidencePct = derivedAnalysis?.prediction ? Math.round(derivedAnalysis.prediction.confidence * 100) : null;
  const longRedForecast = derivedAnalysis?.prediction?.thresholdForecast?.longTerm.red ?? null;
  const hasEnvData = useMemo(() => chartData.some((row) => row.temperature != null || row.humidity != null), [chartData]);
  const hasCoordData = useMemo(() => chartData.some((row) => row.lat != null && row.lng != null), [chartData]);
  const hasCeemdData = Boolean(derivedAnalysis?.ceemd?.imfs?.length && derivedAnalysis?.ceemd?.residue?.length);
  const hasShortPrediction = Boolean(derivedAnalysis?.prediction?.shortTerm?.length && chartData.length);
  const hasLongPrediction = Boolean(derivedAnalysis?.prediction?.longTerm?.length && chartData.length);

  const latestDisp = latest?.displacement ?? 0;
  const level = riskFromDispMm(latestDisp, thresholds);
  const displacementLabel = baseline ? "最新位移（持久基线）" : referencePoint ? "最新位移（临时参考）" : "最新位移";
  const referenceStatusText = baseline ? "持久基线已建立" : referencePoint ? "临时参考点" : "未形成参考点";
  const forecastInference = latestAiPrediction?.forecastInference ?? null;
  const riskCalibration = latestAiPrediction?.riskCalibration ?? null;
  const forecastRunStatus = forecastRunStatusText(forecastInference);
  const trendDiagnostics = derivedAnalysis?.trendDiagnostics ?? null;
  const monitoringPointLabel = buildMonitoringPointLabel(selectedDevice, forecastInference);
  const predictionTargetItems = [
    { key: "region", label: "区域", value: selectedDevice?.regionCode },
    { key: "slope", label: "坡段", value: selectedDevice?.slopeCode },
    { key: "station", label: "站点", value: selectedDevice?.displayName ?? selectedDevice?.stationName },
    { key: "point", label: "监测点", value: monitoringPointLabel },
    { key: "device", label: "设备", value: selectedDevice?.deviceName ?? selectedDevice?.name ?? selectedDevice?.id },
    { key: "node", label: "节点", value: selectedDevice?.nodeCode },
    { key: "window", label: "预测窗口", value: forecastInference ? forecastHorizonText(forecastInference.horizonSpec) : "等待模型输出" }
  ];
  const selectedDeviceStatusText =
    selectedDevice?.lifecycleStatus === "active"
      ? "在役"
      : selectedDevice?.lifecycleStatus === "inactive"
        ? "停用"
        : selectedDevice?.status === "online"
          ? "在线"
          : selectedDevice?.status === "warning"
            ? "告警"
            : selectedDevice?.status === "offline"
              ? "离线"
              : "未选择";

  const quality = useMemo(() => {
    const expected = Math.min(200, daysFromRange(timeRange) * 24);
    const score = expected > 0 ? Math.min(1, pts.length / expected) : 0;
    return { score, pct: Number((score * 100).toFixed(1)) };
  }, [pts.length, timeRange]);

  const displacementOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderColor: "rgba(148, 163, 184, 0.22)",
        textStyle: { color: "rgba(226, 232, 240, 0.92)" }
      },
      legend: {
        data: ["总位移", "水平位移", "垂直位移"],
        top: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.85)", fontSize: 12 }
      },
      grid: { left: 54, right: 16, top: 44, bottom: 54 },
      xAxis: { type: "category", data: chartData.map((x) => x.time), ...axisTheme() },
      yAxis: { type: "value", name: "mm", ...axisTheme() },
      series: [
        {
          name: "总位移",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.displacement),
          lineStyle: { width: 3, color: "#22d3ee" },
          areaStyle: { color: "rgba(34, 211, 238, 0.14)" }
        },
        {
          name: "水平位移",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.horizontal),
          lineStyle: { width: 2.5, color: "#34d399" },
          areaStyle: { color: "rgba(52, 211, 153, 0.10)" }
        },
        {
          name: "垂直位移",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.vertical),
          lineStyle: { width: 2.5, color: "#60a5fa" },
          areaStyle: { color: "rgba(96, 165, 250, 0.10)" }
        }
      ]
    };
  }, [chartData]);

  const velocityOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      grid: { left: 54, right: 16, top: 20, bottom: 54 },
      xAxis: { type: "category", data: chartData.map((x) => x.time), ...axisTheme() },
      yAxis: { type: "value", name: "mm/h", ...axisTheme() },
      series: [
        {
          name: "形变速度",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.velocityMmH),
          lineStyle: { width: 3, color: "#f87171" },
          areaStyle: { color: "rgba(248, 113, 113, 0.14)" }
        }
      ]
    };
  }, [chartData]);

  const envOption = useMemo(() => {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      legend: {
        data: ["温度", "湿度"],
        top: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.85)", fontSize: 12 }
      },
      grid: { left: 54, right: 54, top: 44, bottom: 54 },
      xAxis: { type: "category", data: chartData.map((x) => x.time), ...axisTheme() },
      yAxis: [
        { type: "value", name: "°C", ...axisTheme() },
        { type: "value", name: "%", ...axisTheme() }
      ],
      series: [
        {
          name: "温度",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.temperature),
          yAxisIndex: 0,
          lineStyle: { width: 2.5, color: "#fbbf24" },
          areaStyle: { color: "rgba(251, 191, 36, 0.10)" }
        },
        {
          name: "湿度",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: chartData.map((x) => x.humidity),
          yAxisIndex: 1,
          lineStyle: { width: 2.5, color: "#60a5fa" },
          areaStyle: { color: "rgba(96, 165, 250, 0.10)" }
        }
      ]
    };
  }, [chartData]);

  const coordOption = useMemo(() => {
    const baseLat = referencePoint?.lat ?? latest?.lat ?? chartData[0]?.lat ?? 22.684674;
    const baseLng = referencePoint?.lng ?? latest?.lng ?? chartData[0]?.lng ?? 110.189371;
    const curLat = latest?.lat ?? null;
    const curLng = latest?.lng ?? null;
    const referenceLabel = referencePoint?.source === "temporary" ? "临时参考点" : "基线点";

    const pad = 0.00008;
    const minLng = Math.min(baseLng, ...(curLng == null ? [] : [curLng])) - pad;
    const maxLng = Math.max(baseLng, ...(curLng == null ? [] : [curLng])) + pad;
    const minLat = Math.min(baseLat, ...(curLat == null ? [] : [curLat])) - pad;
    const maxLat = Math.max(baseLat, ...(curLat == null ? [] : [curLat])) + pad;
    const points = [
      {
        name: referenceLabel,
        value: [baseLng, baseLat] as [number, number],
        symbolSize: 16,
        itemStyle: { color: "#22c55e", shadowBlur: 12, shadowColor: "rgba(34, 211, 238, 0.18)" }
      },
      ...(curLat != null && curLng != null
        ? [
            {
              name: "最新点",
              value: [curLng, curLat] as [number, number],
              symbolSize: 18,
              itemStyle: { color: riskColor(level), shadowBlur: 14, shadowColor: "rgba(34, 211, 238, 0.22)" }
            }
          ]
        : [])
    ];

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderColor: "rgba(148, 163, 184, 0.22)",
        textStyle: { color: "rgba(226, 232, 240, 0.92)" },
        formatter: (p: { data: { name: string; value: [number, number] } }) => {
          const [lng, lat] = p.data.value;
          return `${p.data.name}<br/>纬度：${lat.toFixed(6)}<br/>经度：${lng.toFixed(6)}`;
        }
      },
      grid: { left: 10, right: 10, top: 10, bottom: 10 },
      xAxis: { type: "value", min: minLng, max: maxLng, show: false },
      yAxis: { type: "value", min: minLat, max: maxLat, show: false },
      series: [
        {
          type: "scatter",
          data: points
        }
      ]
    };
  }, [chartData, latest?.lat, latest?.lng, level, referencePoint]);

  const ceemdMetrics = useMemo(() => {
    if (!derivedAnalysis?.ceemd) return null;
    return {
      q: Math.round(derivedAnalysis.ceemd.qualityScore * 100),
      snr: Number((Math.max(0, (derivedAnalysis.ceemd.dominantFrequencies[0] ?? 0) * 10000)).toFixed(1)),
      ortho: Number(derivedAnalysis.ceemd.orthogonality.toFixed(2)),
      recon: Number(derivedAnalysis.ceemd.reconstructionError.toFixed(3))
    };
  }, [derivedAnalysis]);

  const longTermPredictionOption = useMemo(() => {
    if (!derivedAnalysis?.prediction?.longTerm?.length || !chartData.length) return null;
    const history = chartData.slice(-30);
    const historyX = history.map((x) => x.time);
    const historyY = history.map((x) => x.displacement);
    const future = derivedAnalysis.prediction.longTerm;
    const longLower = derivedAnalysis.prediction.confidenceIntervals?.longTermLower ?? [];
    const longUpper = derivedAnalysis.prediction.confidenceIntervals?.longTermUpper ?? [];
    const futureX = Array.from({ length: future.length }, (_, idx) => dayjs().add(idx + 1, "day").format("MM-DD"));
    const allX = [...historyX, ...futureX];
    const historyPad: (number | null)[] = [...historyY, ...future.map(() => null)];
    const predPad: (number | null)[] = [...historyY.map(() => null), ...future];
    const lower: (number | null)[] = [...historyY.map(() => null), ...longLower];
    const upper: (number | null)[] = [...historyY.map(() => null), ...longUpper];

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      legend: {
        data: ["历史", "预测", "置信区间"],
        top: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.85)", fontSize: 12 }
      },
      grid: { left: 54, right: 16, top: 44, bottom: 54 },
      xAxis: { type: "category", data: allX, ...axisTheme() },
      yAxis: { type: "value", name: "mm", ...axisTheme() },
      series: [
        {
          name: "历史",
          type: "line",
          showSymbol: false,
          data: historyPad,
          lineStyle: { width: 2.5, color: "#22d3ee" }
        },
        {
          name: "预测",
          type: "line",
          showSymbol: false,
          data: predPad,
          lineStyle: { width: 2.5, color: "#34d399" },
          areaStyle: { color: "rgba(52, 211, 153, 0.10)" }
        },
        {
          name: "置信区间",
          type: "line",
          showSymbol: false,
          data: lower,
          lineStyle: { opacity: 0 },
          stack: "band-long"
        },
        {
          name: "置信区间",
          type: "line",
          showSymbol: false,
          data: upper,
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(52, 211, 153, 0.14)" },
          stack: "band-long"
        }
      ]
    };
  }, [chartData, derivedAnalysis]);

  const ceemdSeriesOption = useMemo(() => {
    if (!derivedAnalysis?.ceemd?.imfs?.length) return null;
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      legend: {
        data: ["IMF-1", "IMF-2", "IMF-3", "Residue"],
        top: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.85)", fontSize: 12 }
      },
      grid: { left: 54, right: 16, top: 44, bottom: 54 },
      xAxis: { type: "category", data: chartData.map((x) => x.time), ...axisTheme() },
      yAxis: { type: "value", name: "分量", ...axisTheme() },
      series: [
        { name: "IMF-1", type: "line", showSymbol: false, smooth: true, data: derivedAnalysis.ceemd.imfs[0] ?? [], lineStyle: { width: 2, color: "#22d3ee" } },
        { name: "IMF-2", type: "line", showSymbol: false, smooth: true, data: derivedAnalysis.ceemd.imfs[1] ?? [], lineStyle: { width: 2, color: "#34d399" } },
        { name: "IMF-3", type: "line", showSymbol: false, smooth: true, data: derivedAnalysis.ceemd.imfs[2] ?? [], lineStyle: { width: 2, color: "#60a5fa" } },
        { name: "Residue", type: "line", showSymbol: false, smooth: true, data: derivedAnalysis.ceemd.residue ?? [], lineStyle: { width: 2.5, color: "#fbbf24" } }
      ]
    };
  }, [chartData, derivedAnalysis]);

  const ceemdEnergyOption = useMemo(() => {
    if (!derivedAnalysis?.ceemd?.energyDistribution?.length) return null;
    const energies = derivedAnalysis.ceemd.energyDistribution.map((value) => Math.round(value * 100));
    const e1 = energies[0] ?? 0;
    const e2 = energies[1] ?? 0;
    const e3 = energies[2] ?? 0;
    const e4 = Math.max(1, 100 - e1 - e2 - e3);
    return {
        backgroundColor: "transparent",
        textStyle: { color: "rgba(226, 232, 240, 0.9)" },
        tooltip: { trigger: "item" },
        grid: { left: 40, right: 16, top: 20, bottom: 40 },
        xAxis: { type: "category", data: ["IMF-1", "IMF-2", "IMF-3", "Residue"], ...axisTheme() },
        yAxis: { type: "value", name: "%", ...axisTheme() },
        series: [
          {
            type: "bar",
            data: [
              { value: e1, itemStyle: { color: "#22d3ee" } },
              { value: e2, itemStyle: { color: "#34d399" } },
              { value: e3, itemStyle: { color: "#60a5fa" } },
              { value: e4, itemStyle: { color: "#fbbf24" } }
            ],
            barWidth: 18
          }
        ]
      };
  }, [derivedAnalysis]);

  const predictionOption = useMemo(() => {
    if (!derivedAnalysis?.prediction?.shortTerm?.length || !chartData.length) return null;
    const history = chartData.slice(-24);
    const historyX = history.map((x) => x.time);
    const historyY = history.map((x) => x.displacement);
    const future = derivedAnalysis.prediction.shortTerm;
    const shortLower = derivedAnalysis.prediction.confidenceIntervals?.shortTermLower ?? [];
    const shortUpper = derivedAnalysis.prediction.confidenceIntervals?.shortTermUpper ?? [];
    const futureX = Array.from({ length: future.length }, (_, idx) => dayjs().add(idx + 1, "hour").format("MM-DD HH:mm"));

    const allX = [...historyX, ...futureX];
    const historyPad: (number | null)[] = [...historyY, ...future.map(() => null)];
    const predPad: (number | null)[] = [...historyY.map(() => null), ...future];
    const lower: (number | null)[] = [...historyY.map(() => null), ...shortLower];
    const upper: (number | null)[] = [...historyY.map(() => null), ...shortUpper];

    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      legend: {
        data: ["历史", "预测", "置信区间"],
        top: 10,
        textStyle: { color: "rgba(226, 232, 240, 0.85)", fontSize: 12 }
      },
      grid: { left: 54, right: 16, top: 44, bottom: 54 },
      xAxis: { type: "category", data: allX, ...axisTheme() },
      yAxis: { type: "value", name: "mm", ...axisTheme() },
      series: [
        {
          name: "历史",
          type: "line",
          showSymbol: false,
          data: historyPad,
          lineStyle: { width: 2.5, color: "#22d3ee" }
        },
        {
          name: "预测",
          type: "line",
          showSymbol: false,
          data: predPad,
          lineStyle: { width: 2.5, color: "#a78bfa" },
          areaStyle: { color: "rgba(167, 139, 250, 0.10)" }
        },
        {
          name: "置信区间",
          type: "line",
          showSymbol: false,
          data: lower,
          lineStyle: { opacity: 0 },
          stack: "band"
        },
        {
          name: "置信区间",
          type: "line",
          showSymbol: false,
          data: upper,
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(167, 139, 250, 0.14)" },
          stack: "band"
        }
      ]
    };
  }, [chartData, derivedAnalysis]);

  const realtimeRows = useMemo(() => chartData.slice(-24).reverse(), [chartData]);

  const exportItems: MenuProps["items"] = [
    { key: "csv", label: "导出当前设备数据" },
    { key: "analysis", label: "导出分析结果" },
    { key: "report", label: "导出综合报告" },
    { key: "chart", label: "导出图表图片" }
  ];

  return (
    <div className="desk-page desk-gps-page">
      <div className="desk-gps-head">
        <div className="desk-gps-head-left">
          <div className="desk-gps-titleblock">
            <div className="desk-gps-title">地质形变监测</div>
            <div className="desk-gps-subtitle">Geological Deformation Monitoring</div>
          </div>

          <div className="desk-gps-nav">
            <button type="button" className="desk-gps-navbtn" onClick={() => navigate("/app/analysis")}>
              数据分析
            </button>
            <button type="button" className="desk-gps-navbtn" onClick={() => navigate("/app/device-management")}>
              设备管理
            </button>
            <button type="button" className="desk-gps-navbtn active">
              地质形变监测
            </button>
            <button type="button" className="desk-gps-navbtn" onClick={() => navigate("/app/settings")}>
              系统设置
            </button>
          </div>
        </div>

        <div className="desk-gps-head-right">
          <div className="desk-gps-controls">
            <Space size={10} wrap>
            <Select
              value={selectedDeviceId}
              placeholder="选择设备"
              style={{ width: 260 }}
              options={devices.map((d) => ({ label: `${d.name}（${d.stationName}）`, value: d.id }))}
              onChange={(v) => setSelectedDeviceId(v)}
            />
            <Select
              value={timeRange}
              style={{ width: 140 }}
              onChange={(v) => setTimeRange(v)}
              options={[
                { label: "1小时", value: "1h" },
                { label: "6小时", value: "6h" },
                { label: "24小时", value: "24h" },
                { label: "7天", value: "7d" },
                { label: "15天", value: "15d" },
                { label: "30天", value: "30d" }
              ]}
            />

            <Button
              type={autoRefresh ? "primary" : "default"}
              icon={<ReloadOutlined spin={autoRefresh} />}
              onClick={() => setAutoRefresh((v) => !v)}
            >
              {autoRefresh ? "停止" : "刷新"}
            </Button>

            <Dropdown
              menu={{
                items: exportItems,
                onClick: ({ key }) => {
                  try {
                    if (key === "csv") {
                      triggerPreparedExport(buildGpsCsvExport(chartData));
                      message.success("已导出当前设备数据");
                    }
                    if (key === "analysis") {
                      triggerPreparedExport(
                        buildGpsAnalysisExport({
                          device: selectedDevice,
                          baseline,
                          timeRange,
                          rowCount: chartData.length,
                          rows: chartData,
                          derivedAnalysis,
                          forecastInference: latestAiPrediction?.forecastInference ?? null
                        })
                      );
                      message.success("已导出分析结果");
                    }
                    if (key === "report") {
                      triggerPreparedExport(
                        buildGpsReportExport({
                          device: selectedDevice,
                          baseline,
                          timeRange,
                          rows: chartData,
                          derivedAnalysis,
                          forecastInference: latestAiPrediction?.forecastInference ?? null
                        })
                      );
                      message.success("已导出综合报告");
                    }
                    if (key === "chart") {
                      triggerPreparedExport(
                        buildGpsChartExport({
                          device: selectedDevice,
                          timeRange,
                          rows: chartData
                        })
                      );
                      message.success("已导出图表图片");
                    }
                  } catch (err) {
                    message.error((err as Error).message);
                  }
                }
              }}
              placement="bottomLeft"
              trigger={["click"]}
            >
              <Button icon={<ExportOutlined />}>导出</Button>
            </Dropdown>

            <Button
              icon={<SettingOutlined />}
              onClick={() => {
                form.setFieldsValue(thresholds);
                setShowSettings(true);
              }}
            >
              设置
            </Button>

            <Button
              onClick={() => {
                limitForm.setFieldsValue({ limit: dataLimit });
                setShowLimit(true);
              }}
            >
              点数设置
            </Button>

            <Button className="desk-gps-baseline-btn" onClick={() => navigate("/app/device-management?tab=baselines")}>
              基线管理
            </Button>
            </Space>
          </div>

          <div className="desk-gps-meta">
            <div className="desk-gps-time">{nowTime}</div>
            {lastUpdateTime ? <div className="desk-gps-updated">数据更新: {lastUpdateTime}</div> : null}
          </div>
        </div>
      </div>

      {loadError ? (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type="error"
            showIcon
            message="数据加载失败"
            description={
              <div style={{ color: "rgba(226,232,240,0.9)" }}>
                <div style={{ marginBottom: 6 }}>{loadError}</div>
                <div style={{ color: "rgba(148,163,184,0.9)" }}>可在「系统设置」检查当前数据源与接口地址。</div>
              </div>
            }
          />
        </div>
      ) : null}

      {gpsNotice ? (
        <div style={{ marginBottom: 12 }}>
          <Alert
            type={referencePoint ? "warning" : "info"}
            showIcon
            message={baseline ? "形变分析提示" : "形变参考点提示"}
            description={<div style={{ color: "rgba(226,232,240,0.9)" }}>{gpsNotice}</div>}
          />
        </div>
      ) : null}

      <section className="desk-gps-target-strip" aria-label="当前监测对象">
        <div className="desk-gps-target-main">
          <div className="desk-gps-target-eyebrow">当前监测对象</div>
          <div className="desk-gps-target-title">{monitoringPointLabel}</div>
          <div className="desk-gps-target-sub">
            {formatTargetValue(selectedDevice?.stationName)} · {formatTargetValue(selectedDevice?.nodeCode)}
          </div>
        </div>
        <div className="desk-gps-target-items">
          {predictionTargetItems.map((item) => (
            <div className="desk-gps-target-item" key={item.key}>
              <div className="desk-gps-target-k">{item.label}</div>
              <div className="desk-gps-target-v" title={formatTargetValue(item.value)}>
                {formatTargetValue(item.value)}
              </div>
            </div>
          ))}
          <div className="desk-gps-target-item is-status">
            <div className="desk-gps-target-k">状态</div>
            <div className="desk-gps-target-v">{selectedDeviceStatusText}</div>
          </div>
        </div>
      </section>

      <div className="desk-gps-stats">
        <div className="desk-gps-stat">
          <div className="desk-gps-stat-label">预警等级（国标）</div>
          <div className="desk-gps-stat-main">
            <span className="desk-gps-stat-value" style={{ color: riskColor(level) }}>
              {riskDesc(level)}
            </span>
            <Tag color={riskColor(level)} style={{ fontWeight: 800 }}>
              等级 {level}
            </Tag>
          </div>
          <div className="desk-gps-stat-sub">GB/T 38509-2020</div>
        </div>

        <div className="desk-gps-stat">
          <div className="desk-gps-stat-label">{displacementLabel}</div>
          <div className="desk-gps-stat-main">
            <span className="desk-gps-stat-value" style={{ color: referencePoint ? "#22c55e" : "rgba(148,163,184,0.9)" }}>
              {referencePoint ? latestDisp.toFixed(2) : "0.00"}
            </span>
            <span className="desk-gps-stat-unit">mm</span>
          </div>
          <div className="desk-gps-stat-sub">
            {referencePoint ? (latest ? `更新: ${formatBeijingDateTime(latest.ts)}` : "无数据") : "当前窗口未形成参考点"}
          </div>
        </div>

        <div className="desk-gps-stat">
          <div className="desk-gps-stat-label">数据质量</div>
          <div className="desk-gps-stat-main">
            <span
              className="desk-gps-stat-value"
              style={{ color: quality.pct >= 80 ? "#22c55e" : quality.pct >= 60 ? "#f59e0b" : "#ef4444" }}
            >
              {quality.pct}
            </span>
            <span className="desk-gps-stat-unit">%</span>
          </div>
          <Progress
            percent={quality.pct}
            showInfo={false}
            strokeColor={quality.pct >= 80 ? "#22c55e" : quality.pct >= 60 ? "#f59e0b" : "#ef4444"}
            size="small"
          />
        </div>

        <div className="desk-gps-stat">
          <div className="desk-gps-stat-label">数据点数</div>
          <div className="desk-gps-stat-main">
            <span className="desk-gps-stat-value" style={{ color: "rgba(96,165,250,0.95)" }}>
              {chartData.length}
            </span>
            <span className="desk-gps-stat-unit">条</span>
          </div>
          <div className="desk-gps-stat-sub">
            范围：{timeRange.toUpperCase()} · 上限：{dataLimit}
          </div>
        </div>
      </div>

      <div className="desk-gps-main">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            if (isGpsTabKey(key)) setActiveTab(key);
          }}
          items={[
            {
              key: "realtime",
              label: "实时监测",
              children: (
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={12}>
                    <BaseCard title="位移趋势图">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : (
                        <ReactECharts option={displacementOption} style={{ height: 320 }} />
                      )}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={12}>
                    <BaseCard title="形变速度">
                      {loading ? <div className="desk-loading">加载中…</div> : <ReactECharts option={velocityOption} style={{ height: 320 }} />}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={12}>
                    <BaseCard title="环境因素">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : hasEnvData ? (
                        <ReactECharts option={envOption} style={{ height: 320 }} />
                      ) : (
                        <div className="desk-dm-empty">当前时间窗口内暂无温湿度序列数据。</div>
                      )}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={12}>
                    <BaseCard title="最近数据">
                      <div className="desk-dark-table">
                        <Table<GpsChartRow>
                          rowKey="key"
                          size="small"
                          dataSource={realtimeRows}
                          pagination={{ pageSize: 8 }}
                          columns={[
                            {
                              title: "时间",
                              dataIndex: "ts",
                              render: (v: string) => formatBeijingDateTime(v)
                            },
                            { title: "位移(mm)", dataIndex: "displacement" },
                            { title: "速度(mm/h)", dataIndex: "velocityMmH" },
                            {
                              title: "风险",
                              dataIndex: "riskLevel",
                              render: (v: number) => (
                                <Tag color={riskColor(v)} style={{ fontWeight: 800 }}>
                                  {riskDesc(v)}
                                </Tag>
                              )
                            }
                          ]}
                        />
                      </div>
                    </BaseCard>
                  </Col>
                  <Col span={24}>
                    <BaseCard title="基线 / 最新坐标">
                      <div className="desk-gps-coord">
                        <div className="desk-gps-coord-kv">
                          <div className="desk-gps-coord-title">定位坐标</div>
                          <div className="desk-gps-coord-row">
                            <span className="desk-gps-coord-k">{baseline ? "基线" : "参考点"}</span>
                            <span className="desk-gps-coord-v">
                              {referencePoint ? (
                                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                                  {referencePoint.lat.toFixed(6)}, {referencePoint.lng.toFixed(6)}
                                </span>
                              ) : (
                                <span style={{ color: "rgba(148,163,184,0.9)" }}>未建立</span>
                              )}
                            </span>
                          </div>
                          <div className="desk-gps-coord-row">
                            <span className="desk-gps-coord-k">最新</span>
                            <span className="desk-gps-coord-v">
                              {latest?.lat != null && latest?.lng != null ? (
                                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                                  {latest.lat.toFixed(6)}, {latest.lng.toFixed(6)}
                                </span>
                              ) : (
                                <span style={{ color: "rgba(148,163,184,0.9)" }}>--</span>
                              )}
                            </span>
                          </div>
                          <div className="desk-gps-coord-row">
                            <span className="desk-gps-coord-k">风险</span>
                            <span className="desk-gps-coord-v">
                              <Tag color={riskColor(level)} style={{ fontWeight: 800, marginInlineEnd: 0 }}>
                                {riskDesc(level)}
                              </Tag>
                            </span>
                          </div>
                          <div className="desk-gps-coord-tip">{referenceStatusText}。坐标图展示参考点与当前最新定位点位。</div>
                        </div>
                        <div className="desk-gps-coord-chart">
                          {loading ? (
                            <div className="desk-loading">加载中…</div>
                          ) : hasCoordData || referencePoint ? (
                            <ReactECharts option={coordOption} style={{ height: 220 }} />
                          ) : (
                            <div className="desk-dm-empty">当前没有可展示的定位坐标点。</div>
                          )}
                        </div>
                      </div>
                    </BaseCard>
                  </Col>
                </Row>
              )
            },
            {
              key: "ceemd",
              label: "CEEMD 分解",
              children: (
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={16}>
                    <BaseCard title="分解结果">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : hasCeemdData && ceemdSeriesOption ? (
                        <ReactECharts option={ceemdSeriesOption} style={{ height: 360 }} />
                      ) : (
                        <div className="desk-dm-empty">当前数据量不足，暂未生成 CEEMD 分解结果。</div>
                      )}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={8}>
                    <BaseCard title="能量分布">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : hasCeemdData && ceemdEnergyOption ? (
                        <ReactECharts option={ceemdEnergyOption} style={{ height: 360 }} />
                      ) : (
                        <div className="desk-dm-empty">当前没有可用的能量分布结果。</div>
                      )}
                    </BaseCard>
                  </Col>
                  <Col span={24}>
                    <BaseCard title="CEEMD 分解概览">
                      <Row gutter={[12, 12]}>
                        <Col xs={24} lg={10}>
                          {ceemdMetrics ? (
                            <div className="desk-gps-ceemd-metrics">
                              <div className="desk-gps-ceemd-metric">
                                <div className="desk-gps-ceemd-k">质量评分</div>
                                <div className="desk-gps-ceemd-v">{ceemdMetrics.q}/100</div>
                                <Progress
                                  percent={ceemdMetrics.q}
                                  showInfo={false}
                                  strokeColor={ceemdMetrics.q >= 85 ? "#22c55e" : ceemdMetrics.q >= 70 ? "#f59e0b" : "#ef4444"}
                                />
                              </div>
                              <div className="desk-gps-ceemd-metric">
                                <div className="desk-gps-ceemd-k">重构误差</div>
                                <div className="desk-gps-ceemd-v">{ceemdMetrics.recon}</div>
                                <div className="desk-gps-ceemd-muted">越小越好</div>
                              </div>
                              <div className="desk-gps-ceemd-metric">
                                <div className="desk-gps-ceemd-k">正交性</div>
                                <div className="desk-gps-ceemd-v">{ceemdMetrics.ortho}</div>
                                <div className="desk-gps-ceemd-muted">0~1</div>
                              </div>
                              <div className="desk-gps-ceemd-metric">
                                <div className="desk-gps-ceemd-k">SNR</div>
                                <div className="desk-gps-ceemd-v">{ceemdMetrics.snr} dB</div>
                                <div className="desk-gps-ceemd-muted">信噪比</div>
                              </div>
                            </div>
                          ) : (
                            <div className="desk-dm-empty">当前没有可展示的分解质量指标。</div>
                          )}
                        </Col>
                        <Col xs={24} lg={14}>
                          <div className="desk-gps-note">
                            <div className="desk-gps-note-title">分解解释</div>
                            <div className="desk-gps-note-line">- IMF-1/2/3：不同频段的细节成分</div>
                            <div className="desk-gps-note-line">- Residue：长期趋势项</div>
                            <div className="desk-gps-note-line">- 质量评分、重构误差与正交性均来自当前后端分析结果。</div>
                          </div>
                        </Col>
                      </Row>
                    </BaseCard>
                  </Col>
                  <Col span={24}>
                    <BaseCard title="说明">
                      <div className="desk-gps-note">
                        <div className="desk-gps-note-title">CEEMD 说明</div>
                        <div className="desk-gps-note-line">- 本页展示分解曲线与能量占比。</div>
                        <div className="desk-gps-note-line">- 当样本量不足或分析服务未返回结果时，页面将保持空态而不再补造数据。</div>
                      </div>
                    </BaseCard>
                  </Col>
                </Row>
              )
            },
            {
              key: "prediction",
              label: "预测分析",
              children: (
                <Row gutter={[12, 12]}>
                  <Col span={24}>
                    <BaseCard title="AI形变预测">
                      <div className="desk-gps-forecast-grid">
                        <div className="desk-gps-forecast-card is-primary">
                          <div className="desk-gps-forecast-k">预计增量</div>
                          <div className="desk-gps-forecast-v">
                            {formatForecastDisplacementMm(forecastInference?.predictedDisplacementMm)}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            {forecastInference ? `${forecastHorizonText(forecastInference.horizonSpec)} · ${monitoringPointLabel}` : "等待模型输出"}
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">预测对象</div>
                          <div className="desk-gps-forecast-v">
                            {monitoringPointLabel}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            {formatTargetValue(selectedDevice?.slopeCode)} · {formatTargetValue(selectedDevice?.nodeCode)}
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">当前位移</div>
                          <div className="desk-gps-forecast-v">
                            {latest ? `${latest.displacement.toFixed(2)} mm` : "--"}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            水平 {formatOptionalNumber(latest?.horizontal, 2)} / 垂直 {formatOptionalNumber(latest?.vertical, 2)}
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">形变速度</div>
                          <div className="desk-gps-forecast-v">
                            {latest ? `${latest.velocityMmH.toFixed(3)} mm/h` : "--"}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            近 {formatOptionalNumber(trendDiagnostics?.durationHours, 1)}h 变化 {formatOptionalNumber(trendDiagnostics?.changeMm, 2)} mm
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">趋势方向</div>
                          <div className="desk-gps-forecast-v">
                            {trendDirectionText(trendDiagnostics?.direction)}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            拟合 {formatOptionalNumber(trendDiagnostics?.regressionFitR2, 2)} / 波动 {formatOptionalNumber(trendDiagnostics?.volatilityMm, 2)} mm
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">预测置信</div>
                          <div className="desk-gps-forecast-v">
                            {predictionConfidencePct == null ? "--" : `${predictionConfidencePct}%`}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            曲线预测置信度
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">数据质量</div>
                          <div className="desk-gps-forecast-v">
                            {quality.pct}%
                          </div>
                          <div className="desk-gps-forecast-sub">
                            样本 {pts.length} · {referenceStatusText}
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">模型状态</div>
                          <div className="desk-gps-forecast-v">
                            <Tag color={forecastRunStatusColor(forecastInference)}>
                              {forecastRunStatus}
                            </Tag>
                          </div>
                          <div className="desk-gps-forecast-sub" title={forecastInference?.modelKey ?? undefined}>
                            {forecastInference?.modelVersion ? `版本 ${forecastInference.modelVersion}` : "暂无版本信息"}
                          </div>
                        </div>
                        <div className="desk-gps-forecast-card">
                          <div className="desk-gps-forecast-k">风险参考</div>
                          <div className="desk-gps-forecast-v" style={{ color: aiRiskColor(latestAiPrediction?.riskLevel ?? null) }}>
                            {latestAiPrediction ? aiRiskDesc(latestAiPrediction.riskLevel) : "--"}
                          </div>
                          <div className="desk-gps-forecast-sub">
                            {riskCalibration ? thresholdEtaText(longRedForecast) : "预警模型独立判断"}
                          </div>
                        </div>
                      </div>
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={16}>
                    <BaseCard title="短期预测">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : hasShortPrediction && predictionOption ? (
                        <ReactECharts option={predictionOption} style={{ height: 360 }} />
                      ) : (
                        <div className="desk-dm-empty">当前没有可展示的短期预测结果。</div>
                      )}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={8}>
                    <BaseCard title="分析摘要">
                      <div className="desk-gps-note">
                        <div className="desk-gps-note-title">建议</div>
                        <div className="desk-gps-note-line">
                          当前风险：
                          <span style={{ color: riskColor(level), fontWeight: 900, marginLeft: 8 }}>{riskDesc(level)}</span>
                          <span className="desk-gps-note-muted" style={{ marginLeft: 8 }}>位移阈值</span>
                        </div>
                        <div className="desk-gps-note-line">
                          预警参考：
                          <span style={{ color: aiRiskColor(latestAiPrediction?.riskLevel ?? null), fontWeight: 900, marginLeft: 8 }}>
                            {latestAiPrediction ? aiRiskDesc(latestAiPrediction.riskLevel) : "--"}
                          </span>
                        </div>
                        <div className="desk-gps-note-line">
                          AI形变预测：
                          <span style={{ color: "#22d3ee", fontWeight: 900, marginLeft: 8 }}>
                            {latestAiPrediction?.forecastInference
                              ? `${forecastHorizonText(latestAiPrediction.forecastInference.horizonSpec)} ${formatForecastDisplacementMm(
                                  latestAiPrediction.forecastInference.predictedDisplacementMm
                                )}`
                              : "--"}
                          </span>
                        </div>
                        <div className="desk-gps-note-line">
                          置信度：
                          <span style={{ fontWeight: 900, marginLeft: 8 }}>
                            {predictionConfidencePct == null ? "--" : `${predictionConfidencePct}%`}
                          </span>
                        </div>
                        <div className="desk-gps-note-line">
                          基线：
                          <span style={{ fontWeight: 900, marginLeft: 8 }}>{baseline ? "已建立" : "未建立"}</span>
                        </div>
                        <div className="desk-gps-note-line">
                          趋势方向：
                          <span style={{ fontWeight: 900, marginLeft: 8 }}>
                            {trendDirectionText(trendDiagnostics?.direction)}
                          </span>
                        </div>
                        <div style={{ height: 10 }} />
                        <div className="desk-gps-note-muted">AI 形变预测用于短期增量参考，预警等级由风险模型单独判断。</div>
                      </div>
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={16}>
                    <BaseCard title="长期预测">
                      {loading ? (
                        <div className="desk-loading">加载中…</div>
                      ) : hasLongPrediction && longTermPredictionOption ? (
                        <ReactECharts option={longTermPredictionOption} style={{ height: 360 }} />
                      ) : (
                        <div className="desk-dm-empty">当前没有可展示的长期预测结果。</div>
                      )}
                    </BaseCard>
                  </Col>
                  <Col xs={24} lg={8}>
                    <BaseCard title="预测指标">
                      <div className="desk-gps-ceemd-metrics">
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">预测范围</div>
                          <div className="desk-gps-ceemd-v">未来 14 天</div>
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">当前位移</div>
                          <div className="desk-gps-ceemd-v">{latest ? `${latest.displacement.toFixed(2)} mm` : "--"}</div>
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">当前风险</div>
                          <div className="desk-gps-ceemd-v" style={{ color: riskColor(level) }}>
                            {riskDesc(level)}
                          </div>
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">预警参考</div>
                          <div className="desk-gps-ceemd-v" style={{ color: aiRiskColor(latestAiPrediction?.riskLevel ?? null) }}>
                            {latestAiPrediction ? aiRiskDesc(latestAiPrediction.riskLevel) : "--"}
                          </div>
                          <div className="desk-gps-note-muted">
                            {latestAiPrediction?.riskCalibration ? "预警模型已校准" : "暂无预警参考"}
                          </div>
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">AI形变预测</div>
                          <div className="desk-gps-ceemd-v" style={{ color: "#22d3ee" }}>
                            {formatForecastDisplacementMm(latestAiPrediction?.forecastInference?.predictedDisplacementMm)}
                          </div>
                          <div className="desk-gps-note-muted">
                            {latestAiPrediction?.forecastInference
                              ? `${forecastHorizonText(latestAiPrediction.forecastInference.horizonSpec)} · ${forecastRunStatusText(latestAiPrediction.forecastInference)}`
                              : "暂无 AI 预测输出"}
                          </div>
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">模型置信度</div>
                          <div className="desk-gps-ceemd-v">{predictionConfidencePct == null ? "--" : `${predictionConfidencePct}%`}</div>
                          <Progress percent={predictionConfidencePct ?? 0} showInfo={false} strokeColor="rgba(34,211,238,0.9)" />
                        </div>
                        <div className="desk-gps-ceemd-metric">
                          <div className="desk-gps-ceemd-k">红色阈值长期越界</div>
                          <div className="desk-gps-ceemd-v">
                            {longRedForecast?.breached ? `${longRedForecast.etaHours ?? "-"} h` : "未触发"}
                          </div>
                        </div>
                      </div>
                      <div className="desk-gps-note-muted" style={{ marginTop: 8 }}>空态表示后端尚未返回预测结果，不再补造样例指标。</div>
                    </BaseCard>
                  </Col>
                </Row>
              )
            },
            {
              key: "data",
              label: "数据详情",
              children: (
                <BaseCard title="形变数据表" style={{ height: "calc(100vh - 360px)" }}>
                  <div className="desk-dark-table">
                    <Table<GpsChartRow>
                      rowKey="key"
                      size="small"
                      dataSource={chartData}
                      loading={loading}
                      pagination={{ pageSize: 12 }}
                      scroll={{ x: 1200 }}
                      columns={[
                        { title: "时间", dataIndex: "ts", width: 170, render: (v: string) => formatBeijingDateTime(v) },
                        {
                          title: "风险",
                          dataIndex: "riskLevel",
                          width: 110,
                          render: (v: number) => (
                            <Tag color={riskColor(v)} style={{ fontWeight: 800 }}>
                              {riskDesc(v)}
                            </Tag>
                          )
                        },
                        { title: "位移(mm)", dataIndex: "displacement", width: 110, render: (v: number) => formatOptionalNumber(v, 2) },
                        { title: "水平(mm)", dataIndex: "horizontal", width: 110, render: (v: number | null) => formatOptionalNumber(v, 2) },
                        { title: "垂直(mm)", dataIndex: "vertical", width: 110, render: (v: number | null) => formatOptionalNumber(v, 2) },
                        { title: "速度(mm/h)", dataIndex: "velocityMmH", width: 120, render: (v: number) => formatOptionalNumber(v, 3) },
                        { title: "置信度", dataIndex: "confidence", width: 110, render: (v: number | null) => formatOptionalNumber(v, 2) },
                        { title: "温度(°C)", dataIndex: "temperature", width: 110, render: (v: number | null) => formatOptionalNumber(v, 1) },
                        { title: "湿度(%)", dataIndex: "humidity", width: 100, render: (v: number | null) => formatOptionalNumber(v, 0) },
                        { title: "纬度", dataIndex: "lat", width: 120, render: (v: number | null) => formatOptionalNumber(v, 6) },
                        { title: "经度", dataIndex: "lng", width: 120, render: (v: number | null) => formatOptionalNumber(v, 6) }
                      ]}
                    />
                  </div>
                </BaseCard>
              )
            }
          ]}
        />
      </div>

      <Modal
        title="监测阈值设置"
        open={showSettings}
        onCancel={() => setShowSettings(false)}
        okText="保存"
        confirmLoading={thresholdSaving}
        onOk={async () => {
          const values = await form.validateFields();
          if (values.blue >= values.yellow || values.yellow >= values.red) {
            message.error("阈值需要满足：蓝 < 黄 < 红");
            return;
          }
          setThresholdSaving(true);
          try {
            await api.system.updateConfigs({
              configs: [
                { key: GPS_THRESHOLD_BLUE_KEY, value: String(values.blue) },
                { key: GPS_THRESHOLD_YELLOW_KEY, value: String(values.yellow) },
                { key: GPS_THRESHOLD_RED_KEY, value: String(values.red) }
              ]
            });
            setThresholds(values);
            setShowSettings(false);
            message.success("已保存");
          } catch (err) {
            message.error((err as Error).message);
          } finally {
            setThresholdSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="blue" label="蓝色预警阈值（mm）" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="yellow" label="黄色预警阈值（mm）" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="red" label="红色预警阈值（mm）" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <div style={{ color: "rgba(148,163,184,0.9)", fontSize: 12 }}>仅影响本页展示，后续可从后端配置中心下发。</div>
        </Form>
      </Modal>

      <Modal
        title="数据点数设置"
        open={showLimit}
        onCancel={() => setShowLimit(false)}
        okText="保存"
        confirmLoading={limitSaving}
        onOk={async () => {
          const values = await limitForm.validateFields();
          const limit = Math.trunc(values.limit);
          if (!Number.isFinite(limit) || limit < 50 || limit > 2000) {
            message.error("请输入有效的数据点数（50-2000）");
            return;
          }
          setLimitSaving(true);
          try {
            await api.system.updateConfigs({
              configs: [{ key: GPS_DATA_LIMIT_KEY, value: String(limit) }]
            });
            setDataLimit(limit);
            localStorage.setItem(DATA_LIMIT_STORAGE_KEY, String(limit));
            setShowLimit(false);
            message.success(`数据点数已更新为 ${limit} 条`);
          } catch (err) {
            message.error((err as Error).message);
          } finally {
            setLimitSaving(false);
          }
        }}
      >
        <Form form={limitForm} layout="vertical">
          <Form.Item name="limit" label="数据点数限制" rules={[{ required: true }]}>
            <InputNumber min={50} max={2000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <div style={{ color: "rgba(148,163,184,0.9)", fontSize: 12 }}>说明：仅影响本页图表与表格的展示条数，不会影响后端数据。</div>
        </Form>
      </Modal>
    </div>
  );
}
