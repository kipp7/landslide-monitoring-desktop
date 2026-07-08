import type { AiPredictionForecast, Baseline, Device, GpsDerivedAnalysis } from "../api/client";

export type GpsMonitoringExportRow = {
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

export type PreparedExport = {
  filename: string;
  mimeType: string;
  content: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toCsv(lines: Array<Array<string | number>>): string {
  return lines
    .map((line) =>
      line
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\r\n");
}

function csvCell(value: string | number | null | undefined): string | number {
  if (value == null) return "";
  if (typeof value === "number" && Number.isNaN(value)) return "";
  return value;
}

export function buildGpsCsvExport(rows: GpsMonitoringExportRow[]): PreparedExport {
  const csvRows = [
    ["time", "displacement", "horizontal", "vertical", "velocityMmH", "temperature", "humidity", "confidence", "riskLevel", "lat", "lng"],
    ...rows.map((row) => [
      row.time,
      csvCell(row.displacement),
      csvCell(row.horizontal),
      csvCell(row.vertical),
      csvCell(row.velocityMmH),
      csvCell(row.temperature),
      csvCell(row.humidity),
      csvCell(row.confidence),
      csvCell(row.riskLevel),
      csvCell(row.lat),
      csvCell(row.lng)
    ])
  ];
  return {
    filename: "desk-deformation-monitoring.csv",
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFF" + toCsv(csvRows)
  };
}

export function buildGpsAnalysisExport(input: {
  device: Device | null;
  baseline: Baseline | null;
  timeRange: string;
  rowCount: number;
  rows: GpsMonitoringExportRow[];
  derivedAnalysis?: GpsDerivedAnalysis | null;
  forecastInference?: AiPredictionForecast | null;
}): PreparedExport {
  return {
    filename: "desk-deformation-analysis.json",
    mimeType: "application/json;charset=utf-8",
    content: JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        timeRange: input.timeRange,
        rowCount: input.rowCount,
        device: input.device,
        baseline: input.baseline,
        sample: input.rows.slice(0, 20),
        derivedAnalysis: input.derivedAnalysis ?? null,
        forecastInference: input.forecastInference ?? null
      },
      null,
      2
    )
  };
}

export function buildGpsReportExport(input: {
  device: Device | null;
  baseline: Baseline | null;
  timeRange: string;
  rows: GpsMonitoringExportRow[];
  derivedAnalysis?: GpsDerivedAnalysis | null;
  forecastInference?: AiPredictionForecast | null;
}): PreparedExport {
  const latest = input.rows.at(-1);
  const shortConfidence = input.derivedAnalysis?.prediction?.confidence;
  const ceemdQuality = input.derivedAnalysis?.ceemd?.qualityScore;
  const trendDirection = input.derivedAnalysis?.trendDiagnostics?.direction;
  const trendSlope = input.derivedAnalysis?.trendDiagnostics?.slopeMmPerHour;
  const trendFit = input.derivedAnalysis?.trendDiagnostics?.regressionFitR2;
  const redForecast = input.derivedAnalysis?.prediction?.thresholdForecast?.longTerm.red;
  const forecast = input.forecastInference;
  const forecastValue =
    forecast?.predictedDisplacementMm == null
      ? "-"
      : `${forecast.predictedDisplacementMm.toFixed(3)} ${forecast.targetUnit ?? "mm"}`;
  const forecastFeatureStatus =
    forecast?.requiredFeaturesSatisfied == null
      ? "-"
      : forecast.requiredFeaturesSatisfied
        ? "完整"
        : `缺失：${forecast.missingFeatureKeys.length ? forecast.missingFeatureKeys.join(", ") : "-"}`;
  const body = [
    `生成时间: ${new Date().toLocaleString("zh-CN")}`,
    `设备: ${input.device?.name ?? "-"}`,
    `监测点: ${input.device?.stationName ?? "-"}`,
    `时间范围: ${input.timeRange}`,
    `基线状态: ${input.baseline ? "已建立" : "缺失"}`,
    `最新位移(mm): ${latest?.displacement ?? "-"}`,
    `最近样本数: ${input.rows.length}`,
    `CEEMD质量分: ${ceemdQuality === undefined ? "-" : Math.round(ceemdQuality * 100)}`,
    `预测置信度: ${shortConfidence === undefined ? "-" : `${Math.round(shortConfidence * 100)}%`}`,
    `趋势方向: ${trendDirection ?? "-"}`,
    `趋势斜率(mm/h): ${trendSlope === undefined ? "-" : trendSlope.toFixed(4)}`,
    `趋势拟合R²: ${trendFit === undefined ? "-" : trendFit.toFixed(4)}`,
    `红色阈值长期越界: ${redForecast?.breached ? `是，约${redForecast.etaHours ?? "-"}小时后` : "否"}`,
    `AI形变预测: ${forecastValue}`,
    `预测窗口: ${forecast?.horizonSpec ?? "-"}`,
    `预测模型: ${forecast?.modelVersion ?? forecast?.modelKey ?? "-"}`,
    `预测特征状态: ${forecastFeatureStatus}`
  ].join("\r\n");
  return {
    filename: "desk-deformation-report.txt",
    mimeType: "text/plain;charset=utf-8",
    content: body
  };
}

export function buildGpsChartExport(input: {
  device: Device | null;
  timeRange: string;
  rows: GpsMonitoringExportRow[];
}): PreparedExport {
  const width = 1280;
  const height = 720;
  const margin = { top: 88, right: 44, bottom: 88, left: 72 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const rows = input.rows;
  const xCount = Math.max(1, rows.length - 1);

  const values = rows.flatMap((row) => [row.displacement, row.horizontal, row.vertical]);
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minValue = finiteValues.length ? Math.min(...finiteValues) : 0;
  const maxValue = finiteValues.length ? Math.max(...finiteValues) : 1;
  const span = Math.max(1, maxValue - minValue);
  const paddedMin = minValue - span * 0.12;
  const paddedMax = maxValue + span * 0.12;
  const paddedSpan = Math.max(1, paddedMax - paddedMin);

  const xAt = (index: number) => margin.left + (chartWidth * index) / xCount;
  const yAt = (value: number) => margin.top + chartHeight - ((value - paddedMin) / paddedSpan) * chartHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const value = paddedMax - paddedSpan * ratio;
    const y = margin.top + chartHeight * ratio;
    return { value, y };
  });

  const buildPath = (picker: (row: GpsMonitoringExportRow) => number | null) => {
    let started = false;
    return rows
      .map((row, index) => {
        const value = picker(row);
        if (value == null || Number.isNaN(value)) return null;
        const prefix = started ? "L" : "M";
        started = true;
        return `${prefix} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`;
      })
      .filter((segment): segment is string => Boolean(segment))
      .join(" ");
  };

  const seriesMeta = [
    { label: "总位移", color: "#22d3ee", path: buildPath((row) => row.displacement) },
    { label: "水平位移", color: "#34d399", path: buildPath((row) => row.horizontal) },
    { label: "垂直位移", color: "#60a5fa", path: buildPath((row) => row.vertical) }
  ];

  const xLabels = rows.length <= 6 ? rows : rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 4) === 0);

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="deformation monitoring chart export">`,
    `<rect width="100%" height="100%" fill="#0f172a"/>`,
    `<text x="${margin.left}" y="42" fill="#e2e8f0" font-size="28" font-family="Segoe UI, Microsoft YaHei, sans-serif">形变监测趋势导出</text>`,
    `<text x="${margin.left}" y="72" fill="#94a3b8" font-size="16" font-family="Segoe UI, Microsoft YaHei, sans-serif">设备：${escapeXml(input.device?.name ?? "-")} · 监测点：${escapeXml(input.device?.stationName ?? "-")} · 范围：${escapeXml(input.timeRange)} · 样本：${rows.length}</text>`,
    `<rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" rx="16" fill="rgba(15,23,42,0.38)" stroke="rgba(148,163,184,0.20)"/>`,
    ...ticks.map(
      (tick) =>
        `<g><line x1="${margin.left}" y1="${tick.y.toFixed(1)}" x2="${margin.left + chartWidth}" y2="${tick.y.toFixed(1)}" stroke="rgba(148,163,184,0.14)" /><text x="${margin.left - 12}" y="${(tick.y + 5).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="13" font-family="Segoe UI, Microsoft YaHei, sans-serif">${tick.value.toFixed(2)}</text></g>`
    ),
    ...xLabels.map((row) => {
      const index = rows.indexOf(row);
      const x = xAt(index);
      return `<g><line x1="${x.toFixed(1)}" y1="${margin.top + chartHeight}" x2="${x.toFixed(1)}" y2="${margin.top + chartHeight + 8}" stroke="rgba(148,163,184,0.35)" /><text x="${x.toFixed(1)}" y="${height - 34}" text-anchor="middle" fill="#94a3b8" font-size="13" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(row.time)}</text></g>`;
    }),
    ...seriesMeta.map(
      (series) =>
        `<path d="${series.path}" fill="none" stroke="${series.color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
    ),
    ...seriesMeta.map((series, index) => {
      const legendX = margin.left + index * 180;
      const legendY = height - 18;
      return `<g><line x1="${legendX}" y1="${legendY}" x2="${legendX + 32}" y2="${legendY}" stroke="${series.color}" stroke-width="4" stroke-linecap="round"/><text x="${legendX + 42}" y="${legendY + 5}" fill="#e2e8f0" font-size="14" font-family="Segoe UI, Microsoft YaHei, sans-serif">${series.label}</text></g>`;
    }),
    `</svg>`
  ].join("");

  return {
    filename: "desk-deformation-chart.svg",
    mimeType: "image/svg+xml;charset=utf-8",
    content: svg
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
