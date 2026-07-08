import type { Baseline, DashboardSummary, Device, DeviceType, GpsSeries, Station, SystemStatus, User, WeeklyTrend } from "./client";

type AuthUserPayload = {
  userId: string;
  username: string;
  realName?: string;
  roles?: string[];
};

type DashboardPayload = {
  stations: number;
  onlineDevices: number;
  freshDevices: number;
  totalDevices: number;
  todayAlerts: number;
  offlineDevices: number;
  pendingAlerts: number;
  alertsBySeverity?: Partial<Record<"low" | "medium" | "high" | "critical", number>>;
};

type StationPayload = {
  stationId: string;
  stationCode: string;
  stationName: string;
  displayName?: string | null;
  regionCode?: string | null;
  slopeCode?: string | null;
  lifecycleStatus?: string | null;
  status: "active" | "inactive" | "maintenance";
  latitude: number | null;
  longitude: number | null;
  altitude?: number | null;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

type DevicePayload = {
  deviceId: string;
  deviceName?: string;
  legacyDeviceId?: string | null;
  deviceType?: string;
  stationId?: string | null;
  stationCode?: string | null;
  stationName?: string | null;
  status: "inactive" | "active" | "revoked";
  lastSeenAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  identityClass?: string | null;
  deviceRole?: string | null;
  lifecycleStatus?: string | null;
  regionCode?: string | null;
  slopeCode?: string | null;
  nodeCode?: string | null;
  gatewayCode?: string | null;
  displayName?: string | null;
  installLabel?: string | null;
  metadata?: Record<string, unknown>;
};

type BaselinePayload = {
  deviceId: string;
  deviceName: string;
  method?: "auto" | "manual";
  baseline?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
    notes?: string;
    establishedBy?: string;
  };
  computedAt?: string;
};

type GpsDeformationPayload = {
  deviceId: string;
  points: Array<{
    ts: string;
    distanceMeters: number;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIdentityClass(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isFormalStationMetadata(metadata: Record<string, unknown> | null): boolean {
  const note = normalizeIdentityClass(metadata?.note);
  if (note === "seed demo") return false;
  return normalizeIdentityClass(metadata?.identityClass) === "formal" || normalizeIdentityClass(metadata?.identity_class) === "formal";
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readNullableString(item))
    .filter((item): item is string => item !== null);
}

function normalizeRisk(value: unknown): Station["risk"] {
  const raw = readString(value).toLowerCase();
  if (raw === "high") return "high";
  if (raw === "mid" || raw === "medium") return "mid";
  return "low";
}

function normalizeStationStatus(value: StationPayload["status"]): Station["status"] {
  if (value === "maintenance") return "warning";
  if (value === "inactive") return "offline";
  return "online";
}

function normalizeDeviceType(value: unknown): DeviceType {
  const raw = readString(value).toLowerCase();
  if (raw === "gnss" || raw === "gps" || raw === "multi_sensor" || raw === "multisensor") return "gnss";
  if (raw === "rain" || raw === "rainfall") return "rain";
  if (raw === "tilt" || raw === "inclinometer") return "tilt";
  if (raw === "camera" || raw === "video") return "camera";
  if (raw === "field_gateway" || raw === "gateway" || raw === "center_node" || raw === "rk3568") return "field_gateway";
  return "temp_hum";
}

const DEFAULT_DEVICE_ONLINE_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIELD_NODE_ONLINE_WINDOW_MS = 3 * 60 * 1000;

function isFormalFieldNodeDevice(device?: DevicePayload): boolean {
  if (!device) return false;
  const metadata = asRecord(device.metadata);
  const identityClass =
    normalizeIdentityClass(device.identityClass) ||
    normalizeIdentityClass(metadata?.identityClass) ||
    normalizeIdentityClass(metadata?.identity_class);
  const deviceType = readString(device.deviceType).toLowerCase();
  const deviceRole =
    readString(device.deviceRole).toLowerCase() ||
    readString(metadata?.deviceRole).toLowerCase() ||
    readString(metadata?.device_role).toLowerCase();
  const nodeCode = readString(device.nodeCode) || readString(metadata?.nodeCode) || readString(metadata?.node_code);
  const deviceName = readString(device.deviceName, device.deviceId).toLowerCase();

  return (
    identityClass === "formal" &&
    (
      deviceType === "multi_sensor" ||
      deviceType === "multisensor" ||
      deviceRole.includes("field") ||
      deviceRole.includes("node") ||
      Boolean(nodeCode) ||
      deviceName.includes("field-node")
    )
  );
}

function normalizeDeviceStatus(
  value: DevicePayload["status"],
  lastSeenAt?: string | null,
  device?: DevicePayload
): Device["status"] {
  if (value === "revoked") return "offline";
  const lastSeen = readString(lastSeenAt);
  if (lastSeen) {
    const ts = new Date(lastSeen);
    if (!Number.isNaN(ts.getTime())) {
      const freshnessWindow = isFormalFieldNodeDevice(device) ? FIELD_NODE_ONLINE_WINDOW_MS : DEFAULT_DEVICE_ONLINE_WINDOW_MS;
      const threshold = Date.now() - freshnessWindow;
      if (ts.getTime() >= threshold) return "online";
    }
  }
  return value === "active" ? "warning" : "offline";
}

function normalizeHealthState(value: unknown): SystemStatus["items"][number]["status"] {
  const raw = readString(value, "unknown");
  if (raw === "healthy" || raw === "configured") return "healthy";
  if (raw === "not_configured") return "not_configured";
  if (raw === "unhealthy") return "degraded";
  return "unknown";
}

export function mapAuthUser(input: AuthUserPayload): User {
  const roles = Array.isArray(input.roles) ? input.roles : [];
  return {
    id: input.userId,
    name: readString(input.realName, readString(input.username, input.userId)),
    role: roles.includes("admin") ? "admin" : "viewer"
  };
}

export function mapDashboardSummaryFromV1(input: DashboardPayload): DashboardSummary {
  const totalDevices = Math.max(1, Number(input.totalDevices ?? input.onlineDevices + input.offlineDevices));
  const availability = Number(input.onlineDevices ?? 0) / totalDevices;
  const freshness = Number(input.freshDevices ?? 0) / totalDevices;
  const alertsBySeverity = {
    low: Number(input.alertsBySeverity?.low ?? 0),
    medium: Number(input.alertsBySeverity?.medium ?? 0),
    high: Number(input.alertsBySeverity?.high ?? 0),
    critical: Number(input.alertsBySeverity?.critical ?? 0)
  };
  const weightedRiskLoad =
    alertsBySeverity.low * 0.05 +
    alertsBySeverity.medium * 0.1 +
    alertsBySeverity.high * 0.18 +
    alertsBySeverity.critical * 0.28;
  const riskScore = Math.max(0, 1 - Math.min(0.8, weightedRiskLoad));
  const healthScore = availability * 0.4 + freshness * 0.2 + riskScore * 0.4;

  return {
    stationCount: Number(input.stations ?? 0),
    deviceOnlineCount: Number(input.onlineDevices ?? 0),
    alertCountToday: Number(input.todayAlerts ?? 0),
    systemHealthPercent: Math.max(0, Math.min(100, Math.round(healthScore * 100)))
  };
}

export function makeLegacyWeeklyTrend(input: unknown): WeeklyTrend {
  const record = asRecord(input);
  const labels = Array.isArray(record?.labels) ? record.labels.map((x) => String(x)) : [];
  const rainfallMm = Array.isArray(record?.rainfallMm) ? record.rainfallMm.map((x) => Number(x)) : [];
  const alertCount = Array.isArray(record?.alertCount) ? record.alertCount.map((x) => Number(x)) : [];
  return {
    labels,
    rainfallMm,
    alertCount,
    source: "derived_summary",
    note: readString(record?.note, "基于后端聚合生成。")
  };
}

export function mapStationsFromV1(input: StationPayload[], devices: DevicePayload[]): Station[] {
  const deviceCountByStationId = new Map<string, number>();
  const stationStatusById = new Map<string, Station["status"]>();
  for (const device of devices) {
    const stationId = readString(device.stationId);
    if (!stationId) continue;
    deviceCountByStationId.set(stationId, (deviceCountByStationId.get(stationId) ?? 0) + 1);
    const nextStatus = normalizeDeviceStatus(device.status, device.lastSeenAt, device);
    const current = stationStatusById.get(stationId);
    if (current === "online") continue;
    if (nextStatus === "online") {
      stationStatusById.set(stationId, "online");
      continue;
    }
    if (current !== "warning" && nextStatus === "warning") {
      stationStatusById.set(stationId, "warning");
      continue;
    }
    if (!current) stationStatusById.set(stationId, nextStatus);
  }

  return input
    .map((station) => {
      const metadata = asRecord(station.metadata);
      const stationName = readString(station.stationName, station.stationCode);
      const displayName =
        readNullableString(station.displayName) ??
        readNullableString(metadata?.displayName) ??
        readNullableString(metadata?.display_name) ??
        stationName;
      const regionCode =
        readNullableString(station.regionCode) ??
        readNullableString(metadata?.regionCode) ??
        readNullableString(metadata?.region_code);
      const slopeCode =
        readNullableString(station.slopeCode) ??
        readNullableString(metadata?.slopeCode) ??
        readNullableString(metadata?.slope_code);
      const lifecycleStatus =
        readNullableString(station.lifecycleStatus) ??
        readNullableString(metadata?.lifecycleStatus) ??
        readNullableString(metadata?.lifecycle_status);
      return {
        id: station.stationId,
        name: displayName,
        stationCode: readString(station.stationCode),
        stationName,
        displayName: displayName ?? null,
        regionCode: regionCode ?? null,
        slopeCode: slopeCode ?? null,
        lifecycleStatus: lifecycleStatus ?? null,
        area: readString(
          readString(metadata?.locationName, readString(metadata?.location_name, readString(metadata?.area, regionCode ?? displayName)))
        ),
        risk: normalizeRisk(metadata?.riskLevel ?? metadata?.risk_level),
        status: stationStatusById.get(station.stationId) ?? normalizeStationStatus(station.status),
        lat: asFiniteNumber(station.latitude) ?? 0,
        lng: asFiniteNumber(station.longitude) ?? 0,
        deviceCount: deviceCountByStationId.get(station.stationId) ?? 0,
        ...(metadata ? { metadata } : {})
      };
    })
    .filter((station) => station.deviceCount > 0 || isFormalStationMetadata(asRecord(station.metadata)));
}

export function mapMonitoringStationsLegacy(input: unknown): Station[] {
  const record = asRecord(input);
  const list = Array.isArray(record?.data) ? record.data : Array.isArray(input) ? input : [];
  const grouped = new Map<string, Station>();

  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const id = readString(row.actual_device_id, readString(row.device_id));
    const stationName = readString(row.station_name, id);
    const area = readString(row.location_name, stationName);
    const lat = asFiniteNumber(row.latitude) ?? 0;
    const lng = asFiniteNumber(row.longitude) ?? 0;
    const risk = normalizeRisk(row.risk_level);
    const statusRaw = readString(row.online_status).toLowerCase();
    const status: Station["status"] = statusRaw === "online" ? "online" : "offline";
    const key = `${stationName}|${area}|${lat}|${lng}`;

    const existing = grouped.get(key);
    if (existing) {
      existing.deviceCount += 1;
      if (existing.status !== "online" && status === "online") existing.status = "online";
      if (existing.risk === "low" && risk !== "low") existing.risk = risk;
      continue;
    }

    grouped.set(key, {
      id,
      name: stationName,
      area,
      risk,
      status,
      lat,
      lng,
      deviceCount: 1
    });
  }

  return Array.from(grouped.values());
}

export function mapDevicesFromV1(input: DevicePayload[], stations: Station[]): Device[] {
  const stationDetailsById = new Map(
    stations.map((station) => [
      station.id,
      {
        name: station.name,
        stationCode: station.stationCode ?? null,
        regionCode: station.regionCode ?? null,
        slopeCode: station.slopeCode ?? null
      }
    ] as const)
  );
  return input.map((device) => {
    const stationId = readString(device.stationId);
    const metadata = asRecord(device.metadata);
    const linkedStation = stationDetailsById.get(stationId);
    const displayName =
      readNullableString(device.displayName) ??
      readNullableString(metadata?.displayName) ??
      readNullableString(metadata?.display_name);
    const stationName = readString(device.stationName, linkedStation?.name ?? (stationId || "Unassigned"));
    const stationCode =
      readNullableString(device.stationCode) ??
      readNullableString(metadata?.stationCode) ??
      readNullableString(metadata?.station_code) ??
      linkedStation?.stationCode ??
      null;
    const identityClass =
      readNullableString(device.identityClass) ??
      readNullableString(metadata?.identityClass) ??
      readNullableString(metadata?.identity_class);
    const deviceRole =
      readNullableString(device.deviceRole) ??
      readNullableString(metadata?.deviceRole) ??
      readNullableString(metadata?.device_role);
    const lifecycleStatus =
      readNullableString(device.lifecycleStatus) ??
      readNullableString(metadata?.lifecycleStatus) ??
      readNullableString(metadata?.lifecycle_status);
    const regionCode =
      readNullableString(device.regionCode) ??
      readNullableString(metadata?.regionCode) ??
      readNullableString(metadata?.region_code) ??
      linkedStation?.regionCode ??
      null;
    const slopeCode =
      readNullableString(device.slopeCode) ??
      readNullableString(metadata?.slopeCode) ??
      readNullableString(metadata?.slope_code) ??
      linkedStation?.slopeCode ??
      null;
    const nodeCode =
      readNullableString(device.nodeCode) ??
      readNullableString(metadata?.nodeCode) ??
      readNullableString(metadata?.node_code);
    const gatewayCode =
      readNullableString(device.gatewayCode) ??
      readNullableString(metadata?.gatewayCode) ??
      readNullableString(metadata?.gateway_code);
    const installLabel =
      readNullableString(device.installLabel) ??
      readNullableString(metadata?.installLabel) ??
      readNullableString(metadata?.install_label);
    const rawDeviceName = readString(device.deviceName, device.deviceId);
    const createdAt = readNullableString(device.createdAt);
    const updatedAt = readNullableString(device.updatedAt);
    return {
      id: device.deviceId,
      name: displayName ?? rawDeviceName,
      deviceName: rawDeviceName,
      legacyDeviceId:
        readNullableString(device.legacyDeviceId) ??
        readNullableString(metadata?.legacyDeviceId) ??
        readNullableString(metadata?.legacy_device_id) ??
        rawDeviceName,
      stationId,
      stationName,
      stationCode,
      displayName: displayName ?? null,
      installLabel: installLabel ?? null,
      identityClass: identityClass ?? null,
      deviceRole: deviceRole ?? null,
      lifecycleStatus: lifecycleStatus ?? null,
      regionCode,
      slopeCode,
      nodeCode: nodeCode ?? null,
      gatewayCode: gatewayCode ?? null,
      registryStatus: device.status ?? null,
      type: normalizeDeviceType(device.deviceType),
      status: normalizeDeviceStatus(device.status, device.lastSeenAt, device),
      lastSeenAt: readString(device.lastSeenAt, new Date(0).toISOString()),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(metadata ? { metadata } : {})
    };
  });
}

export function mapDevicesFromLegacy(input: unknown): Device[] {
  const list = Array.isArray(input) ? input : [];
  return list.map((item) => {
    const row = asRecord(item) ?? {};
    return {
      id: readString(row.id),
      name: readString(row.name, readString(row.id)),
      stationId: readString(row.stationId),
      stationName: readString(row.stationName, "Unassigned"),
      type: normalizeDeviceType(row.type),
      status: readString(row.status).toLowerCase() === "online" ? "online" : "offline",
      lastSeenAt: readString(row.lastSeenAt, new Date(0).toISOString())
    };
  });
}

export function mapBaselineFromV1(input: BaselinePayload): Baseline {
  const baseline = input.baseline ?? {};
  const altitude = asFiniteNumber(baseline.altitude);
  return {
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    baselineLat: asFiniteNumber(baseline.latitude) ?? 0,
    baselineLng: asFiniteNumber(baseline.longitude) ?? 0,
    ...(altitude == null ? {} : { baselineAlt: altitude }),
    establishedBy: readString(baseline.establishedBy, input.method ?? "manual"),
    establishedTime: readString(input.computedAt, new Date().toISOString()),
    status: "active",
    ...(readString(baseline.notes) ? { notes: readString(baseline.notes) } : {})
  };
}

export function mapBaselinesFromLegacy(input: unknown): Baseline[] {
  const record = asRecord(input);
  const list = Array.isArray(record?.data) ? record.data : [];
  return list.map((item) => {
    const row = asRecord(item) ?? {};
    const altitude = asFiniteNumber(row.baseline_altitude);
    return {
      deviceId: readString(row.device_id),
      deviceName: readString(row.device_name, readString(row.device_id)),
      baselineLat: asFiniteNumber(row.baseline_latitude) ?? 0,
      baselineLng: asFiniteNumber(row.baseline_longitude) ?? 0,
      ...(altitude == null ? {} : { baselineAlt: altitude }),
      establishedBy: readString(row.established_by, "manual"),
      establishedTime: readString(row.established_time, new Date().toISOString()),
      status: "active",
      ...(readString(row.notes) ? { notes: readString(row.notes) } : {})
    };
  });
}

export function mapBaselineDetailFromLegacy(input: unknown): Baseline {
  const record = asRecord(input);
  const row = asRecord(record?.data) ?? {};
  const altitude = asFiniteNumber(row.baseline_altitude);
  return {
    deviceId: readString(row.device_id),
    deviceName: readString(row.device_name, readString(row.device_id)),
    baselineLat: asFiniteNumber(row.baseline_latitude) ?? 0,
    baselineLng: asFiniteNumber(row.baseline_longitude) ?? 0,
    ...(altitude == null ? {} : { baselineAlt: altitude }),
    establishedBy: readString(row.established_by, "manual"),
    establishedTime: readString(row.established_time, new Date().toISOString()),
    status: "active",
    ...(readString(row.notes) ? { notes: readString(row.notes) } : {})
  };
}

export function mapGpsSeriesFromLegacy(input: unknown, deviceName: string): GpsSeries {
  const record = asRecord(input);
  const data = asRecord(record?.data) ?? {};
  const points = Array.isArray(data.points) ? data.points : [];
  return {
    deviceId: readString(data.resolvedDeviceId, readString(data.deviceId)),
    deviceName,
    points: points.map((point) => {
      const row = asRecord(point) ?? {};
      return {
        ts: readString(row.event_time, new Date().toISOString()),
        dispMm: Number((asFiniteNumber(row.deformation_distance_3d) ?? 0).toFixed(2))
      };
    })
  };
}

export function mapSystemStatusFromLegacy(input: unknown): SystemStatus {
  const record = asRecord(input) ?? {};
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const fallbackItems = rawItems.length > 0
    ? rawItems
    : [
        { key: "postgres", label: "PostgreSQL", status: asRecord(record.postgres)?.status, detail: asRecord(record.postgres)?.status },
        { key: "clickhouse", label: "ClickHouse", status: asRecord(record.clickhouse)?.status, detail: asRecord(record.clickhouse)?.status },
        { key: "kafka", label: "Kafka", status: asRecord(record.kafka)?.status, detail: asRecord(record.kafka)?.status }
      ];
  const items: SystemStatus["items"] = fallbackItems.map((item) => {
    const row = asRecord(item) ?? {};
    return {
      key: readString(row.key) as SystemStatus["items"][number]["key"],
      label: readString(row.label, readString(row.key)),
      status: normalizeHealthState(row.status),
      detail: readString(row.detail, readString(row.status, "unknown"))
    };
  });
  const fieldEdgeRecord = asRecord(record.fieldEdge);
  const fieldEdgeSummary = asRecord(fieldEdgeRecord?.summary);
  const fieldEdgeSoak = asRecord(fieldEdgeRecord?.soak);
  const fieldEdgeNodes = Array.isArray(fieldEdgeRecord?.nodes) ? fieldEdgeRecord.nodes : [];
  const hermesEdgeRecord = asRecord(record.hermesEdge);
  const hermesStress = asRecord(hermesEdgeRecord?.stress);
  const hermesSurface = asRecord(hermesEdgeRecord?.volatilitySurface);
  const hermesSurfaceDimensions = Array.isArray(hermesSurface?.dimensions) ? hermesSurface.dimensions : [];
  const hermesSurfacePoints = Array.isArray(hermesSurface?.points) ? hermesSurface.points : [];
  return {
    source: readString(record.source, "health_summary") as SystemStatus["source"],
    note: readString(record.note, "当前页面展示的是健康摘要。"),
    items,
    ...(fieldEdgeRecord
      ? {
          fieldEdge: {
            available: Boolean(fieldEdgeRecord.available),
            stale: Boolean(fieldEdgeRecord.stale),
            detail: readString(fieldEdgeRecord.detail, "RK3568 edge summary unavailable"),
            source: "rk3568_field_link_monitor" as const,
            generatedAt: readNullableString(fieldEdgeRecord.generatedAt),
            currentBoundary: readNullableString(fieldEdgeRecord.currentBoundary),
            accepted: readBoolean(fieldEdgeRecord.accepted),
            summary: fieldEdgeSummary
                ? {
                  overallLevel: readNullableString(fieldEdgeSummary.overallLevel),
                  score: asFiniteNumber(fieldEdgeSummary.score),
                  deferredNodeIds: readStringArray(fieldEdgeSummary.deferredNodeIds),
                  networkMode: readNullableString(fieldEdgeSummary.networkMode),
                  serialOpen: readBoolean(fieldEdgeSummary.serialOpen),
                  mqttConnected: readBoolean(fieldEdgeSummary.mqttConnected),
                  portStatus: readNullableString(fieldEdgeSummary.portStatus),
                  spoolPending: asFiniteNumber(fieldEdgeSummary.spoolPending),
                  rejectedMessages: asFiniteNumber(fieldEdgeSummary.rejectedMessages),
                  lastPublishedAgeSeconds: asFiniteNumber(fieldEdgeSummary.lastPublishedAgeSeconds)
                }
              : null,
            nodes: fieldEdgeNodes
              .map((item) => {
                const row = asRecord(item);
                if (!row) return null;
                const fieldNodeId = readString(row.fieldNodeId);
                const deviceId = readString(row.deviceId);
                if (!fieldNodeId || !deviceId) return null;
                return {
                  fieldNodeId,
                  deviceId,
                  installLabel: readString(row.installLabel, fieldNodeId),
                  enabled: readBoolean(row.enabled),
                  deferred: Boolean(row.deferred),
                  status: readString(row.status, "unknown"),
                  telemetryMessages: asFiniteNumber(row.telemetryMessages),
                  commandForwards: asFiniteNumber(row.commandForwards),
                  ackPublishes: asFiniteNumber(row.ackPublishes),
                  lastTelemetryAgeSeconds: asFiniteNumber(row.lastTelemetryAgeSeconds),
                  lastAckAgeSeconds: asFiniteNumber(row.lastAckAgeSeconds)
                };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null),
            soak: fieldEdgeSoak
              ? {
                  generatedAt: readNullableString(fieldEdgeSoak.generatedAt),
                  accepted: readBoolean(fieldEdgeSoak.accepted),
                  currentBoundary: readNullableString(fieldEdgeSoak.currentBoundary),
                  cleanWindowRounds: asFiniteNumber(fieldEdgeSoak.cleanWindowRounds),
                  allAcked: readBoolean(fieldEdgeSoak.allAcked),
                  maxBoardObservationSchemaRejectedDelta: asFiniteNumber(fieldEdgeSoak.maxBoardObservationSchemaRejectedDelta)
                }
              : null
          }
        }
      : {}),
    ...(hermesEdgeRecord
      ? {
          hermesEdge: {
            available: Boolean(hermesEdgeRecord.available),
            stale: Boolean(hermesEdgeRecord.stale),
            detail: readString(hermesEdgeRecord.detail, "RK3568 Hermes supervisor unavailable"),
            source: "rk3568_hermes_edge_supervisor" as const,
            generatedAt: readNullableString(hermesEdgeRecord.generatedAt),
            boardHost: readNullableString(hermesEdgeRecord.boardHost),
            serviceActive: readBoolean(hermesEdgeRecord.serviceActive),
            serviceEnabled: readBoolean(hermesEdgeRecord.serviceEnabled),
            accepted: readBoolean(hermesEdgeRecord.accepted),
            currentBoundary: readNullableString(hermesEdgeRecord.currentBoundary),
            modelLoaded: readBoolean(hermesEdgeRecord.modelLoaded),
            modelKey: readNullableString(hermesEdgeRecord.modelKey),
            modelVersion: readNullableString(hermesEdgeRecord.modelVersion),
            modelType: readNullableString(hermesEdgeRecord.modelType),
            modelTask: readNullableString(hermesEdgeRecord.modelTask),
            featureCount: asFiniteNumber(hermesEdgeRecord.featureCount),
            aiModelCount: asFiniteNumber(hermesEdgeRecord.aiModelCount),
            diagnosisType: readNullableString(hermesEdgeRecord.diagnosisType),
            confidence: asFiniteNumber(hermesEdgeRecord.confidence),
            confidenceLevel: readNullableString(hermesEdgeRecord.confidenceLevel),
            naturalLanguageReady: readBoolean(hermesEdgeRecord.naturalLanguageReady),
            intentCount: asFiniteNumber(hermesEdgeRecord.intentCount),
            actionRecheckAccepted: readBoolean(hermesEdgeRecord.actionRecheckAccepted),
            actionRecheckStatus: readNullableString(hermesEdgeRecord.actionRecheckStatus),
            safetyGatewayCoreTouched: readBoolean(hermesEdgeRecord.safetyGatewayCoreTouched),
            safetySerialTouched: readBoolean(hermesEdgeRecord.safetySerialTouched),
            safetyMqttTouched: readBoolean(hermesEdgeRecord.safetyMqttTouched),
            stress: hermesStress
              ? {
                  totalRequests: asFiniteNumber(hermesStress.totalRequests),
                  errorRate: asFiniteNumber(hermesStress.errorRate),
                  throughputRps: asFiniteNumber(hermesStress.throughputRps),
                  p95Ms: asFiniteNumber(hermesStress.p95Ms),
                  p99Ms: asFiniteNumber(hermesStress.p99Ms),
                  recheckOk: asFiniteNumber(hermesStress.recheckOk)
                }
              : null,
            volatilitySurface: hermesSurface
              ? {
                  generatedAt: readNullableString(hermesSurface.generatedAt),
                  surfaceType: "edge_health_volatility_surface" as const,
                  method: readString(hermesSurface.method, "derived"),
                  horizonsMinutes: (Array.isArray(hermesSurface.horizonsMinutes) ? hermesSurface.horizonsMinutes : [])
                    .map((item) => asFiniteNumber(item))
                    .filter((item): item is number => item !== null),
                  dimensions: hermesSurfaceDimensions
                    .map((item) => {
                      const row = asRecord(item);
                      if (!row) return null;
                      const key = readString(row.key);
                      if (!key) return null;
                      return {
                        key,
                        label: readString(row.label, key),
                        unit: readString(row.unit, "vol-score")
                      };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null),
                  points: hermesSurfacePoints
                    .map((item) => {
                      const row = asRecord(item);
                      if (!row) return null;
                      const horizonMinutes = asFiniteNumber(row.horizonMinutes);
                      const volatilityScore = asFiniteNumber(row.volatilityScore);
                      const dimensionKey = readString(row.dimensionKey);
                      if (horizonMinutes == null || volatilityScore == null || !dimensionKey) return null;
                      return {
                        horizonMinutes,
                        dimensionKey,
                        volatilityScore,
                        confidence: asFiniteNumber(row.confidence),
                        diagnosisType: readNullableString(row.diagnosisType),
                        driver: readString(row.driver, "derived")
                      };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null),
                  peakScore: asFiniteNumber(hermesSurface.peakScore),
                  peakDimensionKey: readNullableString(hermesSurface.peakDimensionKey),
                  peakHorizonMinutes: asFiniteNumber(hermesSurface.peakHorizonMinutes),
                  modelConfidence: asFiniteNumber(hermesSurface.modelConfidence),
                  note: readString(hermesSurface.note)
                }
              : null
          }
        }
      : {})
  };
}

export function mapSystemStatusFromV1(input: unknown): SystemStatus {
  return mapSystemStatusFromLegacy(input);
}
