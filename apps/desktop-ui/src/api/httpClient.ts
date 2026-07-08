import type {
  ApiClient,
  AccountRole,
  AccountUser,
  AccountUserListResponse,
  AiPrediction,
  AiPredictionCalibration,
  AiPredictionForecast,
  AiPredictionRiskLevel,
  DeviceType,
  EffectiveSuccessNotificationPolicy,
  FieldAlarmAction,
  FieldAlarmStatus,
  GpsDerivedAnalysis,
  OnboardingWorkbench,
  OnlineStatus,
  RiskLevel,
  StationManagementStation,
  SuccessNotificationPolicy,
  UserStatus,
} from "./client";
import {
  mapAuthUser,
  mapBaselineFromV1,
  mapDashboardSummaryFromV1,
  mapDevicesFromV1,
  makeLegacyWeeklyTrend,
  mapStationsFromV1,
  mapSystemStatusFromV1,
} from "./httpMappers";
import { createHttpTransport } from "./httpTransport";

type HttpClientOptions = {
  baseUrl: string;
  getToken?: () => string | null;
  getRefreshToken?: () => string | null;
  onAuthTokens?: (input: { token: string; refreshToken?: string }) => void;
  onAuthFailure?: () => void;
};

type AuthLoginResponse = {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: { userId: string; username: string; realName?: string; roles?: string[] };
};

type V1AccountRolePayload = {
  roleId: string;
  name: string;
  displayName: string;
  description?: string;
};

type V1AccountUserPayload = {
  userId: string;
  username: string;
  realName?: string;
  email?: string;
  phone?: string;
  status: UserStatus;
  roles?: Array<{ roleId: string; name: string; displayName?: string }>;
  permissions?: string[];
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type V1BaselineResponse = {
  list: Array<{
    deviceId: string;
    deviceName: string;
    method?: "auto" | "manual";
    computedAt?: string;
    baseline?: {
      latitude?: number;
      longitude?: number;
      altitude?: number;
      notes?: string;
      establishedBy?: string;
    };
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type V1ListResponse<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type V1GpsDeformationResponse = {
  deviceId: string;
  points: Array<{
    ts: string;
    distanceMeters: number;
    horizontalMeters?: number | null;
    verticalMeters?: number | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
};

type V1StationPayload = {
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
  metadata?: Record<string, unknown>;
  updatedAt?: string;
};

type V1AiPredictionPayload = {
  predictionId: string;
  deviceId: string;
  stationId: string | null;
  modelKey: string;
  modelVersion: string | null;
  horizonSeconds: number;
  predictedTs: string;
  riskScore: number;
  riskLevel: AiPredictionRiskLevel | null;
  explain: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

function normalizeIdentityClass(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isFormalStationMetadata(metadata: Record<string, unknown> | null): boolean {
  const note = normalizeIdentityClass(metadata?.note);
  if (note === "seed demo") return false;
  return (
    normalizeIdentityClass(metadata?.identityClass) === "formal" ||
    normalizeIdentityClass(metadata?.identity_class) === "formal"
  );
}

function readOptionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeManagementRisk(value: unknown): RiskLevel {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "high") return "high";
  if (raw === "mid" || raw === "medium") return "mid";
  return "low";
}

function normalizeManagementStatus(value: V1StationPayload["status"]): OnlineStatus {
  if (value === "inactive") return "offline";
  if (value === "maintenance") return "warning";
  return "online";
}

function normalizeAiRiskLevel(value: unknown): AiPredictionRiskLevel | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function mapAiPredictionCalibration(payload: Record<string, unknown>): AiPredictionCalibration | null {
  const nested = asRecord(payload.riskCalibration);
  const threshold = readFiniteNumber(payload.calibrationThreshold ?? nested?.threshold);
  const scoreOverThreshold = readFiniteNumber(payload.scoreOverThreshold ?? nested?.scoreOverThreshold);
  const calibratedRiskLevel = normalizeAiRiskLevel(payload.calibratedRiskLevel ?? nested?.calibratedRiskLevel);
  const source = readNullableString(nested?.source);

  if (
    threshold === null &&
    scoreOverThreshold === null &&
    calibratedRiskLevel === null &&
    source === null
  ) {
    return null;
  }

  return {
    threshold,
    scoreOverThreshold,
    calibratedRiskLevel,
    source,
  };
}

function findForecastInferencePayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(payload.forecastInference);
  if (direct) return direct;

  const secondaryInferences = Array.isArray(payload.secondaryInferences)
    ? payload.secondaryInferences
    : [];
  for (const item of secondaryInferences) {
    const record = asRecord(item);
    if (!record) continue;
    const operationalRole = readNullableString(record.operationalRole);
    const artifactType = readNullableString(record.artifactType);
    if (operationalRole === "forecast" || artifactType === "calibrated_prediction_regression_v1") {
      return record;
    }
  }

  return null;
}

function mapAiPredictionForecast(payload: Record<string, unknown>): AiPredictionForecast | null {
  const forecast = findForecastInferencePayload(payload);
  if (!forecast) return null;

  const targetUnit = readNullableString(forecast.targetUnit);
  const predictedValue = readFiniteNumber(forecast.predictedValue);
  const predictedDisplacementMm =
    readFiniteNumber(forecast.predictedDisplacementMm) ??
    (targetUnit === "mm" ? predictedValue : null);

  return {
    operationalRole: readNullableString(forecast.operationalRole),
    modelKey: readNullableString(forecast.modelKey),
    modelVersion: readNullableString(forecast.modelVersion),
    artifactType: readNullableString(forecast.artifactType),
    labelKey: readNullableString(forecast.labelKey),
    horizonSpec: readNullableString(forecast.horizonSpec),
    targetUnit,
    predictedValue,
    predictedDisplacementMm,
    explain: readNullableString(forecast.explain),
    fallbackReason: readNullableString(forecast.fallbackReason),
    requiredFeaturesSatisfied: readBoolean(forecast.requiredFeaturesSatisfied),
    missingFeatureKeys: readStringArray(forecast.missingFeatureKeys),
    pointId: readNullableString(forecast.pointId),
  };
}

function mapAiPredictionFromV1(item: V1AiPredictionPayload): AiPrediction {
  const payload = asRecord(item.payload) ?? {};
  return {
    predictionId: item.predictionId,
    deviceId: item.deviceId,
    stationId: item.stationId,
    modelKey: item.modelKey,
    modelVersion: item.modelVersion,
    horizonSeconds: Number(item.horizonSeconds ?? 0),
    predictedTs: item.predictedTs,
    riskScore: Number(item.riskScore ?? 0),
    riskLevel: normalizeAiRiskLevel(item.riskLevel),
    explain: item.explain,
    payload,
    riskCalibration: mapAiPredictionCalibration(payload),
    forecastInference: mapAiPredictionForecast(payload),
    createdAt: item.createdAt,
  };
}

function normalizeSensorTypes(value: unknown): DeviceType[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .map((item): DeviceType | null => {
      if (item === "gnss" || item === "gps" || item === "multi_sensor" || item === "multisensor")
        return "gnss";
      if (item === "rain" || item === "rainfall") return "rain";
      if (item === "tilt" || item === "inclinometer") return "tilt";
      if (item === "camera" || item === "video") return "camera";
      if (item === "temp_hum" || item === "temperature" || item === "humidity") return "temp_hum";
      return null;
    })
    .filter((item): item is DeviceType => item !== null);
  return Array.from(new Set(normalized));
}

function mapStationManagementFromV1(
  stations: V1StationPayload[],
  devices: Array<{
    deviceId: string;
    deviceName?: string;
    deviceType?: string;
    stationId?: string | null;
    status: "inactive" | "active" | "revoked";
    lastSeenAt?: string | null;
  }>
): StationManagementStation[] {
  const devicesByStation = new Map<string, typeof devices>();
  for (const device of devices) {
    const stationId = typeof device.stationId === "string" ? device.stationId : "";
    if (!stationId) continue;
    const list = devicesByStation.get(stationId) ?? [];
    list.push(device);
    devicesByStation.set(stationId, list);
  }

  return stations
    .map((station) => {
      const metadata = asRecord(station.metadata) ?? {};
      const stationDevices = devicesByStation.get(station.stationId) ?? [];
      const sensorTypes = normalizeSensorTypes(
        (metadata as Record<string, unknown>).sensorTypes ??
          (metadata as Record<string, unknown>).sensor_types ??
          stationDevices.map((device) => device.deviceType ?? "")
      );
      const lastDataTime =
        stationDevices
          .map((device) => (typeof device.lastSeenAt === "string" ? device.lastSeenAt : ""))
          .filter((value) => value)
          .sort()
          .at(-1) ?? new Date().toISOString();
      const displayName =
        readNullableString(station.displayName) ??
        readNullableString((metadata as Record<string, unknown>).displayName) ??
        readNullableString((metadata as Record<string, unknown>).display_name) ??
        station.stationName;
      const regionCode =
        readNullableString(station.regionCode) ??
        readNullableString((metadata as Record<string, unknown>).regionCode) ??
        readNullableString((metadata as Record<string, unknown>).region_code);
      const slopeCode =
        readNullableString(station.slopeCode) ??
        readNullableString((metadata as Record<string, unknown>).slopeCode) ??
        readNullableString((metadata as Record<string, unknown>).slope_code);
      const lifecycleStatus =
        readNullableString(station.lifecycleStatus) ??
        readNullableString((metadata as Record<string, unknown>).lifecycleStatus) ??
        readNullableString((metadata as Record<string, unknown>).lifecycle_status);

      return {
        stationId: station.stationId,
        stationCode: readOptionalTrimmedString(station.stationCode || ""),
        stationName: station.stationName,
        displayName: displayName ?? null,
        regionCode: regionCode ?? null,
        slopeCode: slopeCode ?? null,
        lifecycleStatus: lifecycleStatus ?? null,
        locationName:
          typeof (metadata as Record<string, unknown>).locationName === "string"
            ? ((metadata as Record<string, unknown>).locationName as string)
            : typeof (metadata as Record<string, unknown>).location_name === "string"
              ? ((metadata as Record<string, unknown>).location_name as string)
              : displayName,
        description:
          typeof (metadata as Record<string, unknown>).description === "string"
            ? ((metadata as Record<string, unknown>).description as string)
            : "",
        chartLegendName:
          typeof (metadata as Record<string, unknown>).chartLegendName === "string"
            ? ((metadata as Record<string, unknown>).chartLegendName as string)
            : typeof (metadata as Record<string, unknown>).chart_legend_name === "string"
              ? ((metadata as Record<string, unknown>).chart_legend_name as string)
              : displayName,
        riskLevel: normalizeManagementRisk(
          (metadata as Record<string, unknown>).riskLevel ??
            (metadata as Record<string, unknown>).risk_level
        ),
        status: normalizeManagementStatus(station.status),
        lat: typeof station.latitude === "number" ? station.latitude : 0,
        lng: typeof station.longitude === "number" ? station.longitude : 0,
        ...(typeof station.altitude === "number" ? { altitude: station.altitude } : {}),
        deviceCount: stationDevices.length,
        sensorTypes,
        lastDataTime,
        ...(typeof station.updatedAt === "string" ? { updatedAt: station.updatedAt } : {}),
      };
    })
    .filter(
      (station) =>
        station.deviceCount > 0 ||
        isFormalStationMetadata(
          asRecord(stations.find((item) => item.stationId === station.stationId)?.metadata)
        )
    );
}

function computeTimeRange(days: number): {
  startTime: string;
  endTime: string;
  interval: "5m" | "1h" | "1d";
} {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const interval = days <= 1 ? "5m" : days <= 7 ? "1h" : "1d";
  return { startTime: start.toISOString(), endTime: end.toISOString(), interval };
}

function shouldUseLocalDevFallback(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function deriveSuccessNotificationPolicy(item: {
  notifyOnAck?: boolean;
  successNotificationPolicy?: SuccessNotificationPolicy;
  effectiveSuccessNotificationPolicy?: EffectiveSuccessNotificationPolicy;
}): {
  notifyOnAck: boolean;
  successNotificationPolicy: SuccessNotificationPolicy;
  effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
} {
  const successNotificationPolicy =
    item.successNotificationPolicy ?? (item.notifyOnAck ? "always_notify" : "silent");
  const effectiveSuccessNotificationPolicy =
    item.effectiveSuccessNotificationPolicy ??
    (successNotificationPolicy === "inherit"
      ? item.notifyOnAck
        ? "always_notify"
        : "silent"
      : successNotificationPolicy);
  return {
    notifyOnAck: Boolean(
      item.notifyOnAck ?? effectiveSuccessNotificationPolicy === "always_notify"
    ),
    successNotificationPolicy,
    effectiveSuccessNotificationPolicy,
  };
}

function mapAccountRole(item: V1AccountRolePayload): AccountRole {
  return {
    roleId: item.roleId,
    name: item.name,
    displayName: item.displayName || item.name,
    description: item.description ?? "",
  };
}

function mapAccountUser(item: V1AccountUserPayload): AccountUser {
  return {
    userId: item.userId,
    username: item.username,
    realName: item.realName ?? "",
    email: item.email ?? "",
    phone: item.phone ?? "",
    status: item.status,
    roles: Array.isArray(item.roles) ? item.roles : [],
    permissions: Array.isArray(item.permissions) ? item.permissions : [],
    lastLoginAt: item.lastLoginAt ?? null,
    createdAt: item.createdAt ?? "",
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

async function fetchAllV1Pages<T>(
  requestPage: (page: number, pageSize: number) => Promise<V1ListResponse<T>>,
  pageSize = 200
): Promise<T[]> {
  const first = await requestPage(1, pageSize);
  const items = [...first.list];
  const totalPages = Math.max(1, Number(first.pagination?.totalPages ?? 1));

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await requestPage(page, pageSize);
    items.push(...next.list);
  }

  return items;
}

export function createHttpClient(options: HttpClientOptions): ApiClient {
  const transport = createHttpTransport(options);
  const localDevFallback = shouldUseLocalDevFallback(options.baseUrl);

  return {
    auth: {
      async login(input) {
        if ("mobile" in input) {
          throw new Error("当前 HTTP 模式未接入手机号登录，请使用账号密码登录。");
        }

        try {
          const res = await transport.requestV1<AuthLoginResponse>(
            "/api/v1/auth/login",
            transport.withJson({
              method: "POST",
              body: JSON.stringify({ username: input.username, password: input.password }),
            })
          );
          options.onAuthTokens?.({
            token: res.token,
            ...(res.refreshToken ? { refreshToken: res.refreshToken } : {}),
          });
          return {
            token: res.token,
            ...(res.refreshToken ? { refreshToken: res.refreshToken } : {}),
            user: mapAuthUser(res.user),
          };
        } catch (error) {
          if (!localDevFallback) throw error;
          return {
            token: "dev",
            user: { id: "u_http", name: input.username, role: "admin" },
          };
        }
      },
      async logout() {
        try {
          await transport.requestV1<unknown>("/api/v1/auth/logout", { method: "POST" });
        } catch {
          return;
        }
      },
      async me() {
        const res = await transport.requestV1<V1AccountUserPayload>("/api/v1/auth/me");
        return mapAccountUser(res);
      },
      async changePassword(input) {
        await transport.requestV1<unknown>(
          "/api/v1/auth/password",
          transport.withJson({
            method: "PUT",
            body: JSON.stringify(input),
          })
        );
      },
    },
    accounts: {
      async listRoles() {
        const res = await transport.requestV1<{ list: V1AccountRolePayload[] }>("/api/v1/roles");
        return res.list.map(mapAccountRole);
      },
      async listUsers(input) {
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 20;
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (input?.keyword?.trim()) params.set("keyword", input.keyword.trim());
        if (input?.status) params.set("status", input.status);
        if (input?.roleId) params.set("roleId", input.roleId);
        const res = await transport.requestV1<{
          list: V1AccountUserPayload[];
          pagination: { page: number; pageSize: number; total: number; totalPages?: number };
        }>(`/api/v1/users?${params.toString()}`);
        const total = Number(res.pagination.total ?? 0);
        const totalPages = Number(res.pagination.totalPages ?? Math.max(1, Math.ceil(total / pageSize)));
        return {
          list: res.list.map(mapAccountUser),
          pagination: {
            page: Number(res.pagination.page ?? page),
            pageSize: Number(res.pagination.pageSize ?? pageSize),
            total,
            totalPages,
          },
        } satisfies AccountUserListResponse;
      },
      async createUser(input) {
        return transport.requestV1<{ userId: string }>(
          "/api/v1/users",
          transport.withJson({
            method: "POST",
            body: JSON.stringify({
              username: input.username.trim(),
              password: input.password,
              ...(trimOptional(input.realName) ? { realName: trimOptional(input.realName) } : {}),
              ...(trimOptional(input.email) ? { email: trimOptional(input.email) } : {}),
              ...(trimOptional(input.phone) ? { phone: trimOptional(input.phone) } : {}),
              roleIds: input.roleIds ?? [],
            }),
          })
        );
      },
      async updateUser(input) {
        const body = {
          ...(trimOptional(input.realName) ? { realName: trimOptional(input.realName) } : {}),
          ...(trimOptional(input.email) ? { email: trimOptional(input.email) } : {}),
          ...(trimOptional(input.phone) ? { phone: trimOptional(input.phone) } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.roleIds ? { roleIds: input.roleIds } : {}),
        };
        return transport.requestV1<{ userId: string; updatedAt: string }>(
          `/api/v1/users/${encodeURIComponent(input.userId)}`,
          transport.withJson({
            method: "PUT",
            body: JSON.stringify(body),
          })
        );
      },
      async deleteUser(input) {
        await transport.requestV1<unknown>(`/api/v1/users/${encodeURIComponent(input.userId)}`, {
          method: "DELETE",
        });
      },
      async resetPassword(input) {
        return transport.requestV1<{
          userId: string;
          temporaryPassword?: string;
          mustChangeOnNextLogin: boolean;
          resetAt: string;
        }>(
          `/api/v1/users/${encodeURIComponent(input.userId)}/reset-password`,
          transport.withJson({ method: "POST" })
        ).then((res) => ({
          userId: res.userId,
          temporaryPassword: res.temporaryPassword ?? "",
          mustChangeOnNextLogin: res.mustChangeOnNextLogin,
          resetAt: res.resetAt,
        }));
      },
    },
    dashboard: {
      async getSummary() {
        const res = await transport.requestV1<{
          stations: number;
          onlineDevices: number;
          freshDevices: number;
          totalDevices: number;
          todayAlerts: number;
          offlineDevices: number;
          pendingAlerts: number;
          alertsBySeverity?: Partial<Record<"low" | "medium" | "high" | "critical", number>>;
        }>("/api/v1/dashboard");
        return mapDashboardSummaryFromV1(res);
      },
      async getWeeklyTrend() {
        const res = await transport.requestV1<unknown>("/api/v1/dashboard/weekly-trend");
        return makeLegacyWeeklyTrend(res);
      },
    },
    stations: {
      async list() {
        const [stations, devices] = await Promise.all([
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                stationId: string;
                stationCode: string;
                stationName: string;
                status: "active" | "inactive" | "maintenance";
                latitude: number | null;
                longitude: number | null;
                metadata?: Record<string, unknown>;
              }>
            >(`/api/v1/stations?page=${String(page)}&pageSize=${String(pageSize)}`)
          ),
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                deviceId: string;
                deviceName?: string;
                deviceType?: string;
                stationId?: string | null;
                status: "inactive" | "active" | "revoked";
                lastSeenAt?: string | null;
              }>
            >(`/api/v1/devices?page=${String(page)}&pageSize=${String(pageSize)}`)
          ),
        ]);
        return mapStationsFromV1(stations, devices);
      },
      async listManagement() {
        const [stations, devices] = await Promise.all([
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<V1ListResponse<V1StationPayload>>(
              `/api/v1/stations?page=${String(page)}&pageSize=${String(pageSize)}`
            )
          ),
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                deviceId: string;
                deviceName?: string;
                deviceType?: string;
                stationId?: string | null;
                status: "inactive" | "active" | "revoked";
                lastSeenAt?: string | null;
              }>
            >(`/api/v1/devices?page=${String(page)}&pageSize=${String(pageSize)}`)
          ),
        ]);
        return mapStationManagementFromV1(stations, devices);
      },
      async updateManagement(input) {
        const current = await transport.requestV1<V1StationPayload>(
          `/api/v1/stations/${encodeURIComponent(input.stationId)}`
        );
        const currentMetadata =
          current.metadata && typeof current.metadata === "object" ? current.metadata : {};
        const displayName = readOptionalTrimmedString(input.displayName);
        const regionCode = readOptionalTrimmedString(input.regionCode);
        const slopeCode = readOptionalTrimmedString(input.slopeCode);
        const lifecycleStatus = readOptionalTrimmedString(input.lifecycleStatus);
        const metadata = {
          ...currentMetadata,
          locationName: input.locationName,
          location_name: input.locationName,
          description: input.description,
          chartLegendName: input.chartLegendName,
          chart_legend_name: input.chartLegendName,
          riskLevel: input.riskLevel,
          risk_level: input.riskLevel,
          sensorTypes: input.sensorTypes,
          sensor_types: input.sensorTypes,
          ...(displayName ? { displayName } : {}),
          ...(regionCode ? { regionCode } : {}),
          ...(slopeCode ? { slopeCode } : {}),
          ...(lifecycleStatus ? { lifecycleStatus } : {}),
        };
        const status =
          input.status === "online"
            ? "active"
            : input.status === "warning"
              ? "maintenance"
              : "inactive";
        const res = await transport.requestV1<{ stationId: string; updatedAt: string }>(
          `/api/v1/stations/${encodeURIComponent(input.stationId)}`,
          transport.withJson({
            method: "PUT",
            body: JSON.stringify({
              stationName: input.stationName,
              status,
              metadata,
            }),
          })
        );
        return {
          stationId: res.stationId,
          ...(res.updatedAt ? { updatedAt: res.updatedAt } : {}),
        };
      },
      async updateLegendNames(input) {
        let updated = 0;
        for (const [stationId, chartLegendName] of Object.entries(input.legends)) {
          if (!chartLegendName.trim()) continue;
          const current = await transport.requestV1<V1StationPayload>(
            `/api/v1/stations/${encodeURIComponent(stationId)}`
          );
          const metadata =
            current.metadata && typeof current.metadata === "object" ? current.metadata : {};
          await transport.requestV1<{ stationId: string; updatedAt: string }>(
            `/api/v1/stations/${encodeURIComponent(stationId)}`,
            transport.withJson({
              method: "PUT",
              body: JSON.stringify({
                metadata: {
                  ...metadata,
                  chartLegendName,
                  chart_legend_name: chartLegendName,
                },
              }),
            })
          );
          updated += 1;
        }
        return { updated };
      },
    },
    devices: {
      async list(input) {
        const stationQuery = input?.stationId
          ? `&stationId=${encodeURIComponent(input.stationId)}`
          : "";
        const [stations, devices] = await Promise.all([
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                stationId: string;
                stationCode: string;
                stationName: string;
                status: "active" | "inactive" | "maintenance";
                latitude: number | null;
                longitude: number | null;
                metadata?: Record<string, unknown>;
              }>
            >(`/api/v1/stations?page=${String(page)}&pageSize=${String(pageSize)}`)
          ),
          fetchAllV1Pages((page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                deviceId: string;
                deviceName?: string;
                deviceType?: string;
                stationId?: string | null;
                status: "inactive" | "active" | "revoked";
                lastSeenAt?: string | null;
              }>
            >(`/api/v1/devices?page=${String(page)}&pageSize=${String(pageSize)}${stationQuery}`)
          ),
        ]);
        const stationModels = mapStationsFromV1(stations, devices);
        return mapDevicesFromV1(devices, stationModels);
      },
      async getState(input) {
        const response = await transport.requestV1<{
          deviceId: string;
          updatedAt: string;
          state?: {
            metrics?: Record<string, unknown>;
            meta?: Record<string, unknown>;
          };
        }>(`/api/v1/data/state/${encodeURIComponent(input.deviceId)}`);
        const state = response.state && typeof response.state === "object" ? response.state : {};
        return {
          deviceId: response.deviceId,
          updatedAt: response.updatedAt,
          metrics: state.metrics && typeof state.metrics === "object" ? state.metrics : {},
          meta: state.meta && typeof state.meta === "object" ? state.meta : {},
        };
      },
      async revoke(input) {
        return transport.requestV1<{
          deviceId: string;
          status: "revoked";
          revokedAt: string;
        }>(
          `/api/v1/devices/${encodeURIComponent(input.deviceId)}/revoke`,
          transport.withJson({
            method: "PUT",
          })
        );
      },
      async issueCommand(input) {
        const response = await transport.requestV1<{
          commandId: string;
          status: "queued" | "sent" | "acked" | "failed" | "timeout" | "canceled";
          notifyOnAck: boolean;
          successNotificationPolicy: SuccessNotificationPolicy;
          effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
        }>(
          `/api/v1/devices/${encodeURIComponent(input.deviceId)}/commands`,
          transport.withJson({
            method: "POST",
            body: JSON.stringify({
              commandType: input.commandType,
              ...(input.notifyOnAck === undefined ? {} : { notifyOnAck: input.notifyOnAck }),
              ...(input.successNotificationPolicy === undefined
                ? {}
                : { successNotificationPolicy: input.successNotificationPolicy }),
              payload: input.payload,
            }),
          })
        );
        return {
          commandId: response.commandId,
          status: response.status,
          ...deriveSuccessNotificationPolicy(response),
        };
      },
      async listCommands(input) {
        const list = await fetchAllV1Pages(
          (page, pageSize) =>
            transport.requestV1<
              V1ListResponse<{
                commandId: string;
                deviceId: string;
                commandType: string;
                payload: Record<string, unknown>;
                notifyOnAck?: boolean;
                successNotificationPolicy?: SuccessNotificationPolicy;
                effectiveSuccessNotificationPolicy?: EffectiveSuccessNotificationPolicy;
                status: "queued" | "sent" | "acked" | "failed" | "timeout" | "canceled";
                sentAt?: string | null;
                ackedAt?: string | null;
                result?: Record<string, unknown>;
                errorMessage?: string;
                createdAt: string;
                updatedAt: string;
              }>
            >(
              `/api/v1/devices/${encodeURIComponent(input.deviceId)}/commands?page=${String(page)}&pageSize=${String(pageSize)}`
            ),
          50
        );
        return list.map((item) => ({
          commandId: item.commandId,
          deviceId: item.deviceId,
          commandType: item.commandType,
          payload: item.payload ?? {},
          ...deriveSuccessNotificationPolicy(item),
          status: item.status,
          ...(item.sentAt ? { sentAt: item.sentAt } : {}),
          ...(item.ackedAt ? { ackedAt: item.ackedAt } : {}),
          ...(item.errorMessage ? { errorMessage: item.errorMessage } : {}),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }));
      },
      async getHealthExpert(input) {
        const metric = input.metric ?? "all";
        return transport.requestV1<{
          deviceId: string;
          metric: "all" | "battery" | "health" | "signal";
          runId: string;
          cachedAt?: string;
          result: {
            analysisType: string;
            battery?: {
              soc: number;
              voltage: number | null;
              temperatureC: number | null;
              confidence: number;
              warnings: string[];
            };
            signal?: {
              rssi: number | null;
              strength: number;
              confidence: number;
              warnings: string[];
            };
            health?: {
              score: number;
              level: "good" | "warn" | "bad";
              components: {
                batteryScore: number;
                signalScore: number;
                dataFreshnessScore: number;
              };
              warnings: string[];
            };
            metadata: {
              apiVersion: string;
              analysisMethod: string;
              calculationTime: string;
              cacheUsed: boolean;
            };
          };
        }>(
          `/api/v1/devices/${encodeURIComponent(input.deviceId)}/health/expert?metric=${encodeURIComponent(metric)}`
        );
      },
    },
    telemetry: {
      async getSeries(input) {
        const interval = input.interval ?? "1h";
        const res = await transport.requestV1<{
          series: Array<{
            sensorKey: string;
            points: Array<{ ts: string; value: unknown }>;
          }>;
        }>(
          `/api/v1/data/series/${encodeURIComponent(input.deviceId)}?startTime=${encodeURIComponent(input.startTime)}&endTime=${encodeURIComponent(input.endTime)}&sensorKeys=${encodeURIComponent(input.sensorKey)}&interval=${encodeURIComponent(interval)}`
        );
        const series = res.series.find((item) => item.sensorKey === input.sensorKey);
        if (!series) return [];
        return series.points
          .map((point) => ({
            ts: point.ts,
            value: typeof point.value === "number" ? point.value : Number(point.value),
          }))
          .filter((point) => Number.isFinite(point.value));
      },
    },
    aiPredictions: {
      async list(input) {
        const params = new URLSearchParams();
        params.set("page", String(input?.page ?? 1));
        params.set("pageSize", String(input?.pageSize ?? 10));
        if (input?.deviceId) params.set("deviceId", input.deviceId);
        if (input?.stationId) params.set("stationId", input.stationId);
        if (input?.modelKey) params.set("modelKey", input.modelKey);
        if (input?.riskLevel) params.set("riskLevel", input.riskLevel);

        const res = await transport.requestV1<{
          page: number;
          pageSize: number;
          total: number;
          list: V1AiPredictionPayload[];
        }>(`/api/v1/ai/predictions?${params.toString()}`);

        return {
          page: Number(res.page ?? 1),
          pageSize: Number(res.pageSize ?? input?.pageSize ?? 10),
          total: Number(res.total ?? 0),
          list: Array.isArray(res.list) ? res.list.map(mapAiPredictionFromV1) : [],
        };
      },
    },
    alerts: {
      async list(input) {
        const params = new URLSearchParams();
        params.set("page", String(input?.page ?? 1));
        params.set("pageSize", String(input?.pageSize ?? 20));
        if (input?.deviceId) params.set("deviceId", input.deviceId);
        if (input?.stationId) params.set("stationId", input.stationId);
        if (input?.severity) params.set("severity", input.severity);
        if (input?.status) params.set("status", input.status);
        return transport.requestV1<{
          list: Array<{
            alertId: string;
            status: "active" | "acked" | "resolved";
            severity: "low" | "medium" | "high" | "critical";
            title: string;
            message?: string;
            deviceId: string | null;
            stationId: string | null;
            ruleId: string;
            ruleVersion: number;
            evidence?: Record<string, unknown>;
            lastEventAt: string;
          }>;
          pagination: { page: number; pageSize: number; total: number; totalPages: number };
          summary: { active: number; acked: number; resolved: number; high: number; critical: number };
        }>(`/api/v1/alerts?${params.toString()}`);
      },
    },
    fieldAlarm: {
      async getStatus() {
        return transport.requestV1<FieldAlarmStatus>("/api/v1/field-alarm/status");
      },
      async sendAction(input) {
        return transport.requestV1<{
          action: FieldAlarmAction;
          accepted: boolean;
          actuator: FieldAlarmStatus["actuator"];
        }>(
          "/api/v1/field-alarm/actions",
          transport.withJson({
            method: "POST",
            body: JSON.stringify(input),
          })
        );
      },
    },
    gps: {
      async getSeries(input) {
        const days = input.days ?? 7;
        const range = computeTimeRange(days);
        const res = await transport.requestV1<V1GpsDeformationResponse>(
          `/api/v1/gps/deformations/${encodeURIComponent(input.deviceId)}/series?startTime=${encodeURIComponent(range.startTime)}&endTime=${encodeURIComponent(range.endTime)}&interval=${encodeURIComponent(range.interval)}`
        );
        return {
          deviceId: res.deviceId,
          deviceName: input.deviceId,
          points: res.points.map((point) => ({
            ts: point.ts,
            dispMm: Number((point.distanceMeters * 1000).toFixed(2)),
            ...(typeof point.horizontalMeters === "number"
              ? { horizontalMm: Number((point.horizontalMeters * 1000).toFixed(2)) }
              : {}),
            ...(typeof point.verticalMeters === "number"
              ? { verticalMm: Number((point.verticalMeters * 1000).toFixed(2)) }
              : {}),
            ...(typeof point.latitude === "number"
              ? { latitude: Number(point.latitude.toFixed(6)) }
              : {}),
            ...(typeof point.longitude === "number"
              ? { longitude: Number(point.longitude.toFixed(6)) }
              : {}),
          })),
        };
      },
      async getDerivedAnalysis(input): Promise<GpsDerivedAnalysis> {
        const rangeLabel = input.rangeLabel ?? "7d";
        const limit = input.limit ?? 200;
        const res = await transport.requestV1<{
          deviceId: string;
          hasBaseline: boolean;
          qualityScore?: number;
          trendDiagnostics?: {
            direction?: "stable" | "increasing" | "decreasing";
            changeMm?: number;
            slopeMmPerHour?: number;
            durationHours?: number;
            regressionFitR2?: number;
            accelerationMmPerHour2?: number;
            averageStepMm?: number;
            volatilityMm?: number;
            sampleIntervalSeconds?: number;
          };
          ceemd?: {
            imfs?: number[][];
            residue?: number[];
            energyDistribution?: number[];
            dominantFrequencies?: number[];
            qualityScore?: number;
            reconstructionError?: number;
            orthogonality?: number;
          };
          prediction?: {
            confidence?: number;
            shortTerm?: number[];
            longTerm?: number[];
            thresholdForecast?: {
              thresholdsMm?: {
                blue?: number;
                yellow?: number;
                red?: number;
              };
              shortTerm?: Record<
                string,
                {
                  breached?: boolean;
                  firstIndex?: number | null;
                  firstValue?: number | null;
                  etaHours?: number | null;
                  etaDays?: number | null;
                  firstTimestamp?: string | null;
                }
              >;
              longTerm?: Record<
                string,
                {
                  breached?: boolean;
                  firstIndex?: number | null;
                  firstValue?: number | null;
                  etaHours?: number | null;
                  etaDays?: number | null;
                  firstTimestamp?: string | null;
                }
              >;
            };
            confidenceIntervals?: {
              shortTermLower?: number[];
              shortTermUpper?: number[];
              longTermLower?: number[];
              longTermUpper?: number[];
            };
          };
        }>(
          `/api/v1/gps/deformations/${encodeURIComponent(input.deviceId)}/analysis?timeRange=${encodeURIComponent(rangeLabel)}&limit=${encodeURIComponent(String(limit))}`
        );

        const ceemdAnalysis = res.ceemd;
        const prediction = res.prediction;

        return {
          deviceId: input.deviceId,
          hasBaseline: Boolean(res.hasBaseline),
          qualityScore: Number(res.qualityScore ?? 0),
          ...(res.trendDiagnostics
            ? {
                trendDiagnostics: {
                  direction:
                    res.trendDiagnostics.direction === "decreasing"
                      ? "decreasing"
                      : res.trendDiagnostics.direction === "increasing"
                        ? "increasing"
                        : "stable",
                  changeMm: Number(res.trendDiagnostics.changeMm ?? 0),
                  slopeMmPerHour: Number(res.trendDiagnostics.slopeMmPerHour ?? 0),
                  durationHours: Number(res.trendDiagnostics.durationHours ?? 0),
                  regressionFitR2: Number(res.trendDiagnostics.regressionFitR2 ?? 0),
                  accelerationMmPerHour2: Number(res.trendDiagnostics.accelerationMmPerHour2 ?? 0),
                  averageStepMm: Number(res.trendDiagnostics.averageStepMm ?? 0),
                  volatilityMm: Number(res.trendDiagnostics.volatilityMm ?? 0),
                  sampleIntervalSeconds: Number(res.trendDiagnostics.sampleIntervalSeconds ?? 0),
                },
              }
            : {}),
          ...(ceemdAnalysis
            ? {
                ceemd: {
                  imfs: Array.isArray(ceemdAnalysis.imfs)
                    ? ceemdAnalysis.imfs.map((series) =>
                        series.map((value) => Number((value * 1000).toFixed(3)))
                      )
                    : [],
                  residue: Array.isArray(ceemdAnalysis.residue)
                    ? ceemdAnalysis.residue.map((value) => Number((value * 1000).toFixed(3)))
                    : [],
                  energyDistribution: Array.isArray(ceemdAnalysis.energyDistribution)
                    ? ceemdAnalysis.energyDistribution.map((value) => Number(value))
                    : [],
                  dominantFrequencies: Array.isArray(ceemdAnalysis.dominantFrequencies)
                    ? ceemdAnalysis.dominantFrequencies.map((value) => Number(value))
                    : [],
                  qualityScore: Number(ceemdAnalysis.qualityScore ?? 0),
                  reconstructionError: Number(ceemdAnalysis.reconstructionError ?? 0),
                  orthogonality: Number(ceemdAnalysis.orthogonality ?? 0),
                },
              }
            : {}),
          ...(prediction
            ? {
                prediction: {
                  confidence: Number(prediction.confidence ?? 0),
                  shortTerm: Array.isArray(res.prediction?.shortTerm)
                    ? res.prediction.shortTerm.map((value) => Number(value))
                    : [],
                  longTerm: Array.isArray(res.prediction?.longTerm)
                    ? res.prediction.longTerm.map((value) => Number(value))
                    : [],
                  ...(prediction.thresholdForecast
                    ? {
                        thresholdForecast: {
                          thresholdsMm: {
                            blue: Number(prediction.thresholdForecast.thresholdsMm?.blue ?? 0),
                            yellow: Number(prediction.thresholdForecast.thresholdsMm?.yellow ?? 0),
                            red: Number(prediction.thresholdForecast.thresholdsMm?.red ?? 0),
                          },
                          shortTerm: {
                            blue: {
                              breached: Boolean(
                                prediction.thresholdForecast.shortTerm?.blue?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.shortTerm?.blue?.firstIndex == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.blue.firstIndex),
                              firstValue:
                                prediction.thresholdForecast.shortTerm?.blue?.firstValue == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.blue.firstValue),
                              etaHours:
                                prediction.thresholdForecast.shortTerm?.blue?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.blue.etaHours),
                              etaDays:
                                prediction.thresholdForecast.shortTerm?.blue?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.blue.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.shortTerm?.blue?.firstTimestamp == null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.shortTerm.blue.firstTimestamp
                                    ),
                            },
                            yellow: {
                              breached: Boolean(
                                prediction.thresholdForecast.shortTerm?.yellow?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.shortTerm?.yellow?.firstIndex == null
                                  ? null
                                  : Number(
                                      prediction.thresholdForecast.shortTerm.yellow.firstIndex
                                    ),
                              firstValue:
                                prediction.thresholdForecast.shortTerm?.yellow?.firstValue == null
                                  ? null
                                  : Number(
                                      prediction.thresholdForecast.shortTerm.yellow.firstValue
                                    ),
                              etaHours:
                                prediction.thresholdForecast.shortTerm?.yellow?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.yellow.etaHours),
                              etaDays:
                                prediction.thresholdForecast.shortTerm?.yellow?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.yellow.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.shortTerm?.yellow?.firstTimestamp ==
                                null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.shortTerm.yellow.firstTimestamp
                                    ),
                            },
                            red: {
                              breached: Boolean(
                                prediction.thresholdForecast.shortTerm?.red?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.shortTerm?.red?.firstIndex == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.red.firstIndex),
                              firstValue:
                                prediction.thresholdForecast.shortTerm?.red?.firstValue == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.red.firstValue),
                              etaHours:
                                prediction.thresholdForecast.shortTerm?.red?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.red.etaHours),
                              etaDays:
                                prediction.thresholdForecast.shortTerm?.red?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.shortTerm.red.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.shortTerm?.red?.firstTimestamp == null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.shortTerm.red.firstTimestamp
                                    ),
                            },
                          },
                          longTerm: {
                            blue: {
                              breached: Boolean(
                                prediction.thresholdForecast.longTerm?.blue?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.longTerm?.blue?.firstIndex == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.blue.firstIndex),
                              firstValue:
                                prediction.thresholdForecast.longTerm?.blue?.firstValue == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.blue.firstValue),
                              etaHours:
                                prediction.thresholdForecast.longTerm?.blue?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.blue.etaHours),
                              etaDays:
                                prediction.thresholdForecast.longTerm?.blue?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.blue.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.longTerm?.blue?.firstTimestamp == null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.longTerm.blue.firstTimestamp
                                    ),
                            },
                            yellow: {
                              breached: Boolean(
                                prediction.thresholdForecast.longTerm?.yellow?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.longTerm?.yellow?.firstIndex == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.yellow.firstIndex),
                              firstValue:
                                prediction.thresholdForecast.longTerm?.yellow?.firstValue == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.yellow.firstValue),
                              etaHours:
                                prediction.thresholdForecast.longTerm?.yellow?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.yellow.etaHours),
                              etaDays:
                                prediction.thresholdForecast.longTerm?.yellow?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.yellow.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.longTerm?.yellow?.firstTimestamp ==
                                null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.longTerm.yellow.firstTimestamp
                                    ),
                            },
                            red: {
                              breached: Boolean(
                                prediction.thresholdForecast.longTerm?.red?.breached
                              ),
                              firstIndex:
                                prediction.thresholdForecast.longTerm?.red?.firstIndex == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.red.firstIndex),
                              firstValue:
                                prediction.thresholdForecast.longTerm?.red?.firstValue == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.red.firstValue),
                              etaHours:
                                prediction.thresholdForecast.longTerm?.red?.etaHours == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.red.etaHours),
                              etaDays:
                                prediction.thresholdForecast.longTerm?.red?.etaDays == null
                                  ? null
                                  : Number(prediction.thresholdForecast.longTerm.red.etaDays),
                              firstTimestamp:
                                prediction.thresholdForecast.longTerm?.red?.firstTimestamp == null
                                  ? null
                                  : String(
                                      prediction.thresholdForecast.longTerm.red.firstTimestamp
                                    ),
                            },
                          },
                        },
                      }
                    : {}),
                  ...(prediction.confidenceIntervals
                    ? {
                        confidenceIntervals: {
                          shortTermLower: Array.isArray(
                            prediction.confidenceIntervals.shortTermLower
                          )
                            ? prediction.confidenceIntervals.shortTermLower.map((value) =>
                                Number(value)
                              )
                            : [],
                          shortTermUpper: Array.isArray(
                            prediction.confidenceIntervals.shortTermUpper
                          )
                            ? prediction.confidenceIntervals.shortTermUpper.map((value) =>
                                Number(value)
                              )
                            : [],
                          longTermLower: Array.isArray(prediction.confidenceIntervals.longTermLower)
                            ? prediction.confidenceIntervals.longTermLower.map((value) =>
                                Number(value)
                              )
                            : [],
                          longTermUpper: Array.isArray(prediction.confidenceIntervals.longTermUpper)
                            ? prediction.confidenceIntervals.longTermUpper.map((value) =>
                                Number(value)
                              )
                            : [],
                        },
                      }
                    : {}),
                },
              }
            : {}),
        };
      },
    },
    baselines: {
      async list() {
        const list = await fetchAllV1Pages((page, pageSize) =>
          transport.requestV1<V1BaselineResponse>(
            `/api/v1/gps/baselines?page=${String(page)}&pageSize=${String(pageSize)}`
          )
        );
        return list.map((item) => mapBaselineFromV1(item));
      },
      async upsert(input) {
        await transport.requestV1<unknown>(
          `/api/v1/gps/baselines/${encodeURIComponent(input.deviceId)}`,
          transport.withJson({
            method: "PUT",
            body: JSON.stringify({
              method: "manual",
              baseline: {
                latitude: input.baselineLat,
                longitude: input.baselineLng,
                ...(input.baselineAlt === undefined ? {} : { altitude: input.baselineAlt }),
                establishedBy: input.establishedBy,
                ...(input.notes === undefined ? {} : { notes: input.notes }),
              },
              ...(input.persist === undefined ? {} : { persist: input.persist }),
            }),
          })
        );
        const detail = await transport.requestV1<{
          deviceId: string;
          deviceName: string;
          method?: "auto" | "manual";
          computedAt?: string;
          baseline?: {
            latitude?: number;
            longitude?: number;
            altitude?: number;
            notes?: string;
            establishedBy?: string;
          };
        }>(`/api/v1/gps/baselines/${encodeURIComponent(input.deviceId)}`);
        return mapBaselineFromV1(detail);
      },
      async remove(input) {
        await transport.requestV1<unknown>(
          `/api/v1/gps/baselines/${encodeURIComponent(input.deviceId)}`,
          { method: "DELETE" }
        );
      },
      async autoEstablish(input) {
        const res = await transport.requestV1<{
          deviceId: string;
          pointsUsed: number;
          persisted?: boolean;
          baseline: {
            latitude: number;
            longitude: number;
            altitude?: number;
            notes?: string;
          };
        }>(
          `/api/v1/gps/baselines/${encodeURIComponent(input.deviceId)}/auto-establish`,
          transport.withJson({
            method: "POST",
            body: JSON.stringify({
              pointsCount: 20,
              lookbackDays: 30,
              latKey: "gps_latitude",
              lonKey: "gps_longitude",
              altKey: "gps_altitude",
              ...(input.persist === undefined ? {} : { persist: input.persist }),
            }),
          })
        );
        const baseline: {
          latitude?: number;
          longitude?: number;
          altitude?: number;
          notes?: string;
        } = res.baseline ?? {};
        return {
          deviceId: input.deviceId,
          deviceName: input.deviceId,
          baselineLat: Number(baseline.latitude ?? 0),
          baselineLng: Number(baseline.longitude ?? 0),
          ...(baseline.altitude === undefined ? {} : { baselineAlt: Number(baseline.altitude) }),
          establishedBy: "system",
          establishedTime: new Date().toISOString(),
          status: "active",
          ...(baseline.notes ? { notes: String(baseline.notes) } : {}),
        };
      },
    },
    system: {
      async getStatus() {
        const res = await transport.requestV1<unknown>("/api/v1/system/status");
        return mapSystemStatusFromV1(res);
      },
      async getConfigs() {
        const res = await transport.requestV1<{
          list: Array<{
            key: string;
            value: string;
            type: string;
            description: string;
            updatedAt?: string;
          }>;
        }>("/api/v1/system/configs");
        return res.list.map((item) => ({
          key: item.key,
          value: item.value,
          type: item.type,
          description: item.description,
          ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
        }));
      },
      async updateConfigs(input) {
        const res = await transport.requestV1<{ updated: number }>(
          "/api/v1/system/configs",
          transport.withJson({
            method: "PUT",
            body: JSON.stringify({ configs: input.configs }),
          })
        );
        return { updated: res.updated };
      },
      async getCommandSuccessNotificationPolicy() {
        return transport.requestV1<{
          systemDefault: "silent" | "always_notify";
          commandTypeDefaults: Record<string, "silent" | "always_notify">;
        }>("/api/v1/system/command-success-notification-policy");
      },
      async updateCommandSuccessNotificationPolicy(input) {
        return transport.requestV1<{
          systemDefault: "silent" | "always_notify";
          commandTypeDefaults: Record<string, "silent" | "always_notify">;
        }>(
          "/api/v1/system/command-success-notification-policy",
          transport.withJson({
            method: "PUT",
            body: JSON.stringify(input),
          })
        );
      },
      async getOperationLogs(input) {
        const params = new URLSearchParams();
        params.set("page", String(input.page));
        params.set("pageSize", String(input.pageSize));
        params.set("startTime", input.startTime);
        params.set("endTime", input.endTime);
        if (input.module) params.set("module", input.module);
        if (input.action) params.set("action", input.action);
        return transport.requestV1<{
          page: number;
          pageSize: number;
          total: number;
          list: Array<{
            id: string;
            userId: string | null;
            username: string;
            module: string;
            action: string;
            targetType: string;
            targetId: string;
            description: string;
            requestData: unknown;
            responseData: unknown;
            ipAddress: string;
            userAgent: string;
            status: string;
            errorMessage: string;
            createdAt: string;
          }>;
        }>(`/api/v1/system/logs/operation?${params.toString()}`);
      },
    },
    onboarding: {
      async getWorkbench() {
        return transport.requestV1<OnboardingWorkbench>("/api/v1/onboarding/workbench");
      },
      async bindPendingDevice(input) {
        return transport.requestV1<{
          deviceId: string;
          stationId: string | null;
          createdStationId?: string | null;
          createdDevice?: boolean;
          updatedAt: string;
        }>(
          "/api/v1/onboarding/bind",
          transport.withJson({
            method: "POST",
            body: JSON.stringify(input),
          })
        );
      },
      async confirmCommissioning(input) {
        return transport.requestV1<{ deviceId: string; updatedAt: string }>(
          "/api/v1/onboarding/commission",
          transport.withJson({
            method: "POST",
            body: JSON.stringify(input),
          })
        );
      },
    },
  };
}
