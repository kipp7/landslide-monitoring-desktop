import type {
  ApiClient,
  AccountRole,
  AccountUser,
  AiPrediction,
  Baseline,
  DashboardSummary,
  Device,
  EffectiveSuccessNotificationPolicy,
  FieldAlarmAction,
  FieldAlarmStatus,
  GpsSeries,
  GpsDerivedAnalysis,
  OnboardingWorkbench,
  PendingObservation,
  SuccessNotificationPolicy,
  DeviceType,
  Station,
  StationManagementStation,
  SystemStatus,
  UserStatus,
  WeeklyTrend,
} from "./client";
import { addDays, clamp, nowIso, sleep } from "./mockUtils";

type MockOptions = {
  delayMs?: number;
  failureRate?: number;
};

const DEMO_SITE_LAT = 22.68313880324831;
const DEMO_SITE_LNG = 110.19415268685714;

function stablePercent(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const t = (h >>> 0) / 4294967295;
  return Math.round(min + t * (max - min));
}

function makeMockAccountRoles(): AccountRole[] {
  return [
    {
      roleId: "role-super-admin",
      name: "super_admin",
      displayName: "超级管理员",
      description: "系统最高权限，可管理账号、设备、告警与系统配置。",
    },
    {
      roleId: "role-admin",
      name: "admin",
      displayName: "管理员",
      description: "可进行设备管理、告警处置、数据导出和账号维护。",
    },
    {
      roleId: "role-user",
      name: "user",
      displayName: "普通用户",
      description: "可查看监测数据、告警和设备状态，不允许下发控制命令。",
    },
  ];
}

function makeMockAccountUsers(roles: AccountRole[]): AccountUser[] {
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  const pickRole = (name: string) => {
    const role = roleByName.get(name);
    return role ? [{ roleId: role.roleId, name: role.name, displayName: role.displayName }] : [];
  };

  return [
    {
      userId: "u_admin",
      username: "admin",
      realName: "Local Admin",
      email: "admin@example.com",
      phone: "19134705351",
      status: "active",
      roles: pickRole("admin"),
      permissions: ["user:view", "user:create", "user:update", "device:view", "device:control"],
      lastLoginAt: nowIso(),
      createdAt: addDays(nowIso(), -21),
      updatedAt: nowIso(),
    },
    {
      userId: "u_viewer",
      username: "viewer",
      realName: "Local Viewer",
      email: "viewer@example.com",
      phone: "",
      status: "active",
      roles: pickRole("user"),
      permissions: ["device:view", "data:view", "alert:view"],
      lastLoginAt: addDays(nowIso(), -1),
      createdAt: addDays(nowIso(), -18),
      updatedAt: nowIso(),
    },
    {
      userId: "u_operator",
      username: "operator",
      realName: "现场运维",
      email: "operator@example.com",
      phone: "",
      status: "inactive",
      roles: pickRole("admin"),
      permissions: ["device:view", "device:control", "alert:update"],
      lastLoginAt: null,
      createdAt: addDays(nowIso(), -7),
      updatedAt: nowIso(),
    },
  ];
}

function makeMockHermesVolatilitySurface(): NonNullable<SystemStatus["hermesEdge"]>["volatilitySurface"] {
  const horizonsMinutes = [0, 5, 15, 30, 60];
  const dimensions = [
    { key: "serial_link", label: "串口链路", unit: "vol-score" },
    { key: "mqtt_uplink", label: "MQTT 上行", unit: "vol-score" },
    { key: "spool_queue", label: "缓冲队列", unit: "vol-score" },
    { key: "data_freshness", label: "数据新鲜度", unit: "vol-score" },
    { key: "parser_quality", label: "解析质量", unit: "vol-score" },
    { key: "node_fleet", label: "节点状态", unit: "vol-score" },
    { key: "resource_pressure", label: "资源压力", unit: "vol-score" },
    { key: "hermes_task_queue", label: "Hermes 任务队列", unit: "vol-score" },
  ];
  const scenarioByDimension: Record<
    string,
    {
      scores: number[];
      confidenceBase: number;
      diagnosisType: string;
      driver: string;
    }
  > = {
    serial_link: {
      scores: [34, 47, 39, 31, 24],
      confidenceBase: 0.936,
      diagnosisType: "southbound_serial_jitter",
      driver: "serial_gap_rate_frame_crc_and_retry_window",
    },
    mqtt_uplink: {
      scores: [92, 86, 68, 44, 27],
      confidenceBase: 0.992188,
      diagnosisType: "center_mqtt_route_unreachable",
      driver: "model_diagnosis",
    },
    spool_queue: {
      scores: [43, 66, 81, 58, 36],
      confidenceBase: 0.947,
      diagnosisType: "edge_spool_backlog_burst",
      driver: "spool_depth_drain_rate_and_retry_pressure",
    },
    data_freshness: {
      scores: [32, 49, 73, 82, 63],
      confidenceBase: 0.928,
      diagnosisType: "telemetry_freshness_lag",
      driver: "last_seen_gap_sensor_age_and_clock_skew",
    },
    parser_quality: {
      scores: [23, 31, 26, 42, 29],
      confidenceBase: 0.914,
      diagnosisType: "payload_parser_quality_drift",
      driver: "parse_error_ratio_schema_mismatch_and_value_outliers",
    },
    node_fleet: {
      scores: [54, 46, 41, 61, 74],
      confidenceBase: 0.921,
      diagnosisType: "field_node_group_instability",
      driver: "node_ack_distribution_battery_state_and_offline_tail",
    },
    resource_pressure: {
      scores: [29, 41, 57, 76, 89],
      confidenceBase: 0.904,
      diagnosisType: "rk3568_resource_pressure_accumulation",
      driver: "cpu_load_memory_pressure_disk_io_and_thermal_margin",
    },
    hermes_task_queue: {
      scores: [62, 75, 69, 48, 35],
      confidenceBase: 0.952,
      diagnosisType: "hermes_recheck_task_queue_drain",
      driver: "agent_queue_depth_recheck_latency_and_policy_backoff",
    },
  };
  const points = dimensions.flatMap((dimension, dimensionIndex) =>
    horizonsMinutes.map((horizon, horizonIndex) => {
      const scenario = scenarioByDimension[dimension.key];
      const baseScore = scenario?.scores[horizonIndex] ?? 20;
      const localRipple =
        Math.sin((dimensionIndex + 1.7) * (horizonIndex + 1.3)) * 1.7 +
        Math.cos((dimensionIndex + 2.2) * (horizon + 3) * 0.043) * 1.1;
      const volatilityScore = Math.round(clamp(baseScore + localRipple, 0, 100) * 100) / 100;
      const confidenceRipple = Math.sin((dimensionIndex + 1) * (horizonIndex + 2)) * 0.004;
      const confidence =
        Math.round(clamp((scenario?.confidenceBase ?? 0.9) - horizonIndex * 0.006 + confidenceRipple, 0.74, 0.996) * 1_000_000) /
        1_000_000;
      return {
        horizonMinutes: horizon,
        dimensionKey: dimension.key,
        volatilityScore,
        confidence,
        diagnosisType: scenario?.diagnosisType ?? "edge_health_surface_observation",
        driver: scenario?.driver ?? "derived_mock_signal",
      };
    })
  );
  const peak = points.reduce<(typeof points)[number] | null>(
    (current, point) => (!current || point.volatilityScore > current.volatilityScore ? point : current),
    null
  );
  return {
    generatedAt: nowIso(),
    surfaceType: "edge_health_volatility_surface",
    method: "derived_from_hermes_rf_diagnosis_source_freshness_resource_pressure_and_stress_latency",
    horizonsMinutes,
    dimensions,
    points,
    peakScore: peak?.volatilityScore ?? null,
    peakDimensionKey: peak?.dimensionKey ?? null,
    peakHorizonMinutes: peak?.horizonMinutes ?? null,
    modelConfidence: 0.992188,
    note: "端侧链路健康模拟数据，用于演示 Hermes 诊断曲面：包含上行中断、队列堆积、数据滞后、节点漂移和资源压力累积等故障传播形态。",
  };
}

function makeMockFieldAlarmStatus(action?: FieldAlarmAction): FieldAlarmStatus {
  const active = action === "alarm_on";
  const silenced = action === "silence" || action === "ack";
  const resolved = action === "alarm_off" || action === "resolve";
  return {
    active: resolved ? false : active,
    silenced: resolved ? false : silenced,
    state: active ? "active" : silenced ? "under_review" : "normal",
    activeCount: active ? 1 : 0,
    ackedCount: silenced ? 1 : 0,
    latestAlert: active || silenced
      ? {
          alertId: "mock-field-alarm-tilt-mutation",
          status: active ? "active" : "acked",
          severity: "critical",
          title: "倾角突变触发现场声光联动",
          message: "A 分节点倾角向量窗口变化超过演示阈值，等待人工复核。",
          deviceId: "device_tilt_01",
          stationId: "station_a",
          ruleId: "mock-rule-tilt-mutation",
          ruleVersion: 1,
          evidence: { sensorKey: "tilt_vector_delta_deg", value: 2.16 },
          lastEventAt: nowIso(),
        }
      : null,
    alerts: [],
    actuator: {
      available: true,
      dryRun: true,
      state: active ? "active" : silenced ? "silenced" : "idle",
      lastAction: action ?? null,
      lastActionAt: action ? nowIso() : null,
      detail: "Mock 模式：模拟 RK3568 /dev/ttyS7 声光报警执行器。",
    },
  };
}

function makeStations(): Station[] {
  return [
    {
      id: "station_a",
      name: "挂傍山 01 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-001-01",
      stationName: "挂傍山中心监测站 A",
      displayName: "挂傍山 01 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市挂傍山",
      risk: "high",
      status: "online",
      lat: DEMO_SITE_LAT,
      lng: DEMO_SITE_LNG,
      deviceCount: 4,
      metadata: {
        locationName: "挂傍山中心区",
        displayName: "挂傍山 01 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-001",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_b",
      name: "挂傍山 02 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-001-02",
      stationName: "挂傍山东侧监测站 B",
      displayName: "挂傍山 02 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市挂傍山",
      risk: "mid",
      status: "online",
      lat: 22.68247880324831,
      lng: 110.19539568685714,
      deviceCount: 3,
      metadata: {
        locationName: "挂傍山东侧区",
        displayName: "挂傍山 02 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-001",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_c",
      name: "挂傍山 03 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-001-03",
      stationName: "挂傍山西南监测站 C",
      displayName: "挂傍山 03 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市挂傍山",
      risk: "low",
      status: "online",
      lat: 22.68181880324831,
      lng: 110.19307568685714,
      deviceCount: 2,
      metadata: {
        locationName: "挂傍山西南区",
        displayName: "挂傍山 03 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-001",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_d",
      name: "云岭北坡 01 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-01",
      stationName: "云岭北坡中心监测站 A",
      displayName: "云岭北坡 01 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市云岭北坡",
      risk: "mid",
      status: "online",
      lat: 22.69913880324831,
      lng: 110.21015268685714,
      deviceCount: 4,
      metadata: {
        locationName: "云岭北坡中心区",
        displayName: "云岭北坡 01 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-002",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_e",
      name: "云岭北坡 02 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-02",
      stationName: "云岭北坡东侧监测站 B",
      displayName: "云岭北坡 02 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市云岭北坡",
      risk: "low",
      status: "online",
      lat: 22.69847880324831,
      lng: 110.21139568685714,
      deviceCount: 3,
      metadata: {
        locationName: "云岭北坡东侧区",
        displayName: "云岭北坡 02 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-002",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_f",
      name: "云岭北坡 03 号监测点",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-03",
      stationName: "云岭北坡西南监测站 C",
      displayName: "云岭北坡 03 号监测点",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市云岭北坡",
      risk: "low",
      status: "online",
      lat: 22.69781880324831,
      lng: 110.2090756868571,
      deviceCount: 3,
      metadata: {
        locationName: "云岭北坡西南区",
        displayName: "云岭北坡 03 号监测点",
        regionCode: "CN-GX-YL-GBS",
        slopeCode: "LS-CN-GX-YL-GBS-002",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_g",
      name: "大塘滑坡 01 号监测点",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-01",
      stationName: "大塘滑坡中心监测站 A",
      displayName: "大塘滑坡 01 号监测点",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市大塘滑坡",
      risk: "high",
      status: "warning",
      lat: 22.65813880324831,
      lng: 110.17615268685714,
      deviceCount: 4,
      metadata: {
        locationName: "大塘滑坡中心区",
        displayName: "大塘滑坡 01 号监测点",
        regionCode: "CN-GX-YL-DTP",
        slopeCode: "LS-CN-GX-YL-DTP-001",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_h",
      name: "大塘滑坡 02 号监测点",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-02",
      stationName: "大塘滑坡东侧监测站 B",
      displayName: "大塘滑坡 02 号监测点",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市大塘滑坡",
      risk: "mid",
      status: "online",
      lat: 22.65747880324831,
      lng: 110.17739568685714,
      deviceCount: 3,
      metadata: {
        locationName: "大塘滑坡东侧区",
        displayName: "大塘滑坡 02 号监测点",
        regionCode: "CN-GX-YL-DTP",
        slopeCode: "LS-CN-GX-YL-DTP-001",
        lifecycleStatus: "commissioned",
      },
    },
    {
      id: "station_i",
      name: "大塘滑坡 03 号监测点",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-03",
      stationName: "大塘滑坡西南监测站 C",
      displayName: "大塘滑坡 03 号监测点",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      lifecycleStatus: "commissioned",
      area: "广西壮族自治区玉林市大塘滑坡",
      risk: "low",
      status: "online",
      lat: 22.65681880324831,
      lng: 110.17507568685714,
      deviceCount: 3,
      metadata: {
        locationName: "大塘滑坡西南区",
        displayName: "大塘滑坡 03 号监测点",
        regionCode: "CN-GX-YL-DTP",
        slopeCode: "LS-CN-GX-YL-DTP-001",
        lifecycleStatus: "commissioned",
      },
    },
  ];
}

function makeAiPredictions(devices: Device[], stations: Station[]): AiPrediction[] {
  const device = devices[0];
  const station = stations.find((item) => item.id === device?.stationId) ?? stations[0];
  const forecastInference = {
    operationalRole: "forecast",
    modelKey: "baijiabao.displacement.pointwise-fixed-expert-ensemble-v31-dev-gated-state-protected-v33",
    modelVersion: "0.33.0",
    artifactType: "calibrated_prediction_regression_v1",
    labelKey: "displacementLabel",
    horizonSpec: "24h",
    targetUnit: "mm",
    predictedValue: 0.356907,
    predictedDisplacementMm: 0.356907,
    explain: "未来24h地表位移增量预测，来自 Baijiabao v33 production forecast artifact。",
    fallbackReason: null,
    requiredFeaturesSatisfied: true,
    missingFeatureKeys: [],
    pointId: "Baijiabao",
  };
  return [
    {
      predictionId: "mock-ai-prediction-baijiabao-calibrated",
      deviceId: device?.id ?? "mock-device",
      stationId: station?.id ?? null,
      modelKey: "baijiabao.window099.no-crack.station.Baijiabao.linear-risk-v1",
      modelVersion: "0.2.0",
      horizonSeconds: 3600,
      predictedTs: nowIso(),
      riskScore: 0.12914013962423895,
      riskLevel: "medium",
      explain: "区域专家模型完成校准，中风险结果需结合雨量、位移和现场证据复核。",
      payload: {
        calibrationThreshold: 0.090203,
        scoreOverThreshold: 1.4316612487859488,
        calibratedRiskLevel: "medium",
        riskCalibration: {
          threshold: 0.090203,
          scoreOverThreshold: 1.4316612487859488,
          calibratedRiskLevel: "medium",
          source: "metadata.replaySummary.threshold",
        },
        matchedModelKey: "baijiabao.window099.no-crack.station.Baijiabao.linear-risk-v1",
        requiredFeaturesSatisfied: true,
        fallbackReason: null,
        forecastInference,
        secondaryInferences: [forecastInference],
      },
      riskCalibration: {
        threshold: 0.090203,
        scoreOverThreshold: 1.4316612487859488,
        calibratedRiskLevel: "medium",
        source: "metadata.replaySummary.threshold",
      },
      forecastInference,
      createdAt: nowIso(),
    },
  ];
}

function makeStationManagementStations(
  stations: Station[],
  devices: Device[]
): StationManagementStation[] {
  return stations.map((station) => {
    const stationDevices = devices.filter((device) => device.stationId === station.id);
    const sensorTypes = Array.from(
      new Set(stationDevices.map((device) => device.type))
    ) as DeviceType[];
    const lastDataTime =
      stationDevices
        .map((device) => device.lastSeenAt)
        .sort()
        .at(-1) ?? nowIso();
    return {
      stationId: station.id,
      stationCode: station.stationCode ?? station.id.toUpperCase(),
      stationName: station.stationName ?? station.name,
      displayName: station.displayName ?? station.name,
      regionCode: station.regionCode ?? null,
      slopeCode: station.slopeCode ?? null,
      lifecycleStatus: station.lifecycleStatus ?? null,
      locationName: station.area,
      description: `用于统一管理 ${station.name} 的监测站配置与传感器设置。`,
      chartLegendName: station.displayName ?? station.name,
      riskLevel: station.risk,
      status: station.status,
      lat: station.lat,
      lng: station.lng,
      deviceCount: stationDevices.length,
      sensorTypes,
      lastDataTime,
      updatedAt: nowIso(),
    };
  });
}

function makeMockNodeDevices(input: {
  stationId: string;
  stationCode: string;
  regionCode: string;
  slopeCode: string;
  label: string;
  nodeSuffix: string;
  gatewayCode: string;
  includeRain?: boolean;
  warningTilt?: boolean;
}): Array<Omit<Device, "stationName">> {
  const key = input.stationId.replace(/^station_/, "");
  const makeDevice = (
    sensor: "gnss" | "rain" | "tilt" | "soil",
    type: Device["type"],
    displaySuffix: string,
    status: Device["status"] = "online"
  ): Omit<Device, "stationName"> => {
    const sensorCode = sensor.toUpperCase();
    const name = `${input.label} ${displaySuffix}`;
    return {
      id: `device_${key}_${sensor}`,
      name,
      deviceName: `device_${key}_${sensor}`,
      displayName: name,
      legacyDeviceId: `device_${key}_${sensor}`,
      stationId: input.stationId,
      stationCode: input.stationCode,
      regionCode: input.regionCode,
      slopeCode: input.slopeCode,
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: `FIELD-NODE-${input.nodeSuffix}-${sensorCode}`,
      nodeCode: `ND-${input.stationCode}-${input.nodeSuffix}-${sensorCode}`,
      gatewayCode: input.gatewayCode,
      type,
      status,
      lastSeenAt: sensor === "gnss" ? addDays(nowIso(), -0.012) : nowIso(),
      createdAt: addDays(nowIso(), -10),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: name },
    };
  };

  return [
    makeDevice("gnss", "gnss", "GNSS"),
    ...(input.includeRain ? [makeDevice("rain", "rain", "RS-YL-N01-5 雨量计")] : []),
    makeDevice("tilt", "tilt", "RS-DIP-N01-1H 倾角计", input.warningTilt ? "warning" : "online"),
    makeDevice("soil", "temp_hum", "RS-ECTH-N01-TR-1 土壤三合一"),
  ];
}

function makeDevices(stations: Station[]): Device[] {
  const byId = new Map(stations.map((s) => [s.id, s] as const));
  const mk = (d: Omit<Device, "stationName">): Device => ({
    ...d,
    stationName: byId.get(d.stationId)?.name ?? d.stationId,
    stationCode: d.stationCode ?? byId.get(d.stationId)?.stationCode ?? null,
    regionCode: d.regionCode ?? byId.get(d.stationId)?.regionCode ?? null,
    slopeCode: d.slopeCode ?? byId.get(d.stationId)?.slopeCode ?? null,
  });

  return [
    mk({
      id: "device_gnss_01",
      name: "挂傍山 A 节点 GNSS",
      deviceName: "device_gnss_01",
      displayName: "挂傍山 A 节点 GNSS",
      legacyDeviceId: "device_gnss_01",
      stationId: "station_a",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-A-GNSS",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-01-A",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "gnss",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -20),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 A 节点 GNSS" },
    }),
    mk({
      id: "device_rain_01",
      name: "挂傍山 A 节点 RS-YL-N01-5 雨量计",
      deviceName: "device_rain_01",
      displayName: "挂傍山 A 节点 RS-YL-N01-5 雨量计",
      legacyDeviceId: "device_rain_01",
      stationId: "station_a",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-A-RAIN",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-01-A-R",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "rain",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -18),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 A 节点 RS-YL-N01-5 雨量计" },
    }),
    mk({
      id: "device_tilt_01",
      name: "挂傍山 A 节点 RS-DIP-N01-1H 倾角计",
      deviceName: "device_tilt_01",
      displayName: "挂傍山 A 节点 RS-DIP-N01-1H 倾角计",
      legacyDeviceId: "device_tilt_01",
      stationId: "station_a",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-A-TILT",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-01-A-T",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "tilt",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -14),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 A 节点 RS-DIP-N01-1H 倾角计" },
    }),
    mk({
      id: "device_soil_01",
      name: "挂傍山 A 节点 RS-ECTH-N01-TR-1 土壤三合一",
      deviceName: "device_soil_01",
      displayName: "挂傍山 A 节点 RS-ECTH-N01-TR-1 土壤三合一",
      legacyDeviceId: "device_soil_01",
      stationId: "station_a",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-A-SOIL",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-01-A-S",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "temp_hum",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -12),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 A 节点 RS-ECTH-N01-TR-1 土壤三合一" },
    }),
    mk({
      id: "device_gnss_02",
      name: "挂傍山 B 节点 GNSS",
      deviceName: "device_gnss_02",
      displayName: "挂傍山 B 节点 GNSS",
      legacyDeviceId: "device_gnss_02",
      stationId: "station_b",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-B-GNSS",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-02-B",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "gnss",
      status: "online",
      lastSeenAt: addDays(nowIso(), -0.035),
      createdAt: addDays(nowIso(), -16),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 B 节点 GNSS" },
    }),
    mk({
      id: "device_tilt_02",
      name: "挂傍山 B 节点 RS-DIP-N01-1H 倾角计",
      deviceName: "device_tilt_02",
      displayName: "挂傍山 B 节点 RS-DIP-N01-1H 倾角计",
      legacyDeviceId: "device_tilt_02",
      stationId: "station_b",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-B-TILT",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-02-B-T",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "tilt",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -14),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 B 节点 RS-DIP-N01-1H 倾角计" },
    }),
    mk({
      id: "device_soil_02",
      name: "挂傍山 B 节点 RS-ECTH-N01-TR-1 土壤三合一",
      deviceName: "device_soil_02",
      displayName: "挂傍山 B 节点 RS-ECTH-N01-TR-1 土壤三合一",
      legacyDeviceId: "device_soil_02",
      stationId: "station_b",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-B-SOIL",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-02-B-S",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "temp_hum",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -10),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 B 节点 RS-ECTH-N01-TR-1 土壤三合一" },
    }),
    mk({
      id: "device_tilt_03",
      name: "挂傍山 C 节点 RS-DIP-N01-1H 倾角计",
      deviceName: "device_tilt_03",
      displayName: "挂傍山 C 节点 RS-DIP-N01-1H 倾角计",
      legacyDeviceId: "device_tilt_03",
      stationId: "station_c",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-C-TILT",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-03-C-T",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "tilt",
      status: "warning",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -6),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 C 节点 RS-DIP-N01-1H 倾角计" },
    }),
    mk({
      id: "device_soil_03",
      name: "挂傍山 C 节点 RS-ECTH-N01-TR-1 土壤三合一",
      deviceName: "device_soil_03",
      displayName: "挂傍山 C 节点 RS-ECTH-N01-TR-1 土壤三合一",
      legacyDeviceId: "device_soil_03",
      stationId: "station_c",
      identityClass: "formal",
      deviceRole: "field_node",
      lifecycleStatus: "commissioned",
      installLabel: "FIELD-NODE-C-SOIL",
      nodeCode: "ND-ST-LS-CN-GX-YL-GBS-001-03-C-S",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      type: "temp_hum",
      status: "online",
      lastSeenAt: nowIso(),
      createdAt: addDays(nowIso(), -6),
      updatedAt: nowIso(),
      metadata: { identityClass: "formal", displayName: "挂傍山 C 节点 RS-ECTH-N01-TR-1 土壤三合一" },
    }),
    ...makeMockNodeDevices({
      stationId: "station_d",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-01",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      label: "云岭北坡 A 节点",
      nodeSuffix: "A",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
      includeRain: true,
    }).map(mk),
    ...makeMockNodeDevices({
      stationId: "station_e",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-02",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      label: "云岭北坡 B 节点",
      nodeSuffix: "B",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
    }).map(mk),
    ...makeMockNodeDevices({
      stationId: "station_f",
      stationCode: "ST-LS-CN-GX-YL-GBS-002-03",
      regionCode: "CN-GX-YL-GBS",
      slopeCode: "LS-CN-GX-YL-GBS-002",
      label: "云岭北坡 C 节点",
      nodeSuffix: "C",
      gatewayCode: "GW-CN-GX-YL-GBS-01",
    }).map(mk),
    ...makeMockNodeDevices({
      stationId: "station_g",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-01",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      label: "大塘滑坡 A 节点",
      nodeSuffix: "A",
      gatewayCode: "GW-CN-GX-YL-DTP-01",
      includeRain: true,
      warningTilt: true,
    }).map(mk),
    ...makeMockNodeDevices({
      stationId: "station_h",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-02",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      label: "大塘滑坡 B 节点",
      nodeSuffix: "B",
      gatewayCode: "GW-CN-GX-YL-DTP-01",
    }).map(mk),
    ...makeMockNodeDevices({
      stationId: "station_i",
      stationCode: "ST-LS-CN-GX-YL-DTP-001-03",
      regionCode: "CN-GX-YL-DTP",
      slopeCode: "LS-CN-GX-YL-DTP-001",
      label: "大塘滑坡 C 节点",
      nodeSuffix: "C",
      gatewayCode: "GW-CN-GX-YL-DTP-01",
    }).map(mk),
  ];
}

function makeWeeklyTrend(): WeeklyTrend {
  return {
    labels: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    rainfallMm: [2.4, 5.8, 11.6, 18.2, 9.4, 3.2, 0.8],
    alertCount: [0, 0, 0, 1, 0, 0, 0],
    source: "mock_sample",
    note: "近七日降雨与告警趋势摘要。",
  };
}

function makeBaselines(devices: Device[], stations: Station[]): Baseline[] {
  const stationById = new Map(stations.map((s) => [s.id, s] as const));
  const gnss = devices.filter((d) => d.type === "gnss");

  return gnss.map((d, idx) => {
    const st = stationById.get(d.stationId);
    const baseLat = (st?.lat ?? DEMO_SITE_LAT) + (idx - 1) * 0.00015;
    const baseLng = (st?.lng ?? DEMO_SITE_LNG) + (idx - 1) * 0.0002;
    return {
      deviceId: d.id,
      deviceName: d.name,
      baselineLat: Number(baseLat.toFixed(6)),
      baselineLng: Number(baseLng.toFixed(6)),
      baselineAlt: 510 + idx * 2,
      establishedBy: "system",
      establishedTime: addDays(nowIso(), -idx),
      status: "active",
      notes: "初始基线",
    };
  });
}

function makeSummary(stations: Station[], devices: Device[]): DashboardSummary {
  const deviceOnlineCount = devices.filter((d) => d.status === "online").length;
  const alertCountToday = devices.filter((d) => d.status === "warning").length;
  const systemHealthPercent = clamp(96 - alertCountToday * 3, 0, 100);

  return {
    stationCount: stations.length,
    deviceOnlineCount,
    alertCountToday,
    systemHealthPercent,
  };
}

function makeSystemStatus(): SystemStatus {
  return {
    source: "mock_summary",
    note: "中心节点、平台服务和现场链路运行正常。",
    items: [
      { key: "postgres", label: "PostgreSQL", status: "healthy", detail: "healthy" },
      { key: "clickhouse", label: "ClickHouse", status: "healthy", detail: "healthy" },
      { key: "kafka", label: "Kafka", status: "healthy", detail: "configured" },
    ],
    fieldEdge: {
      available: true,
      stale: false,
      detail: "RK3568中心节点链路摘要已加载，A/B/C现场节点均处于在线状态。",
      source: "rk3568_field_link_monitor",
      generatedAt: nowIso(),
      currentBoundary: "rk3568-edge-link-quality-visible",
      accepted: true,
      summary: {
        overallLevel: "healthy",
        score: 96,
        deferredNodeIds: [],
        networkMode: "sta_connected",
        serialOpen: true,
        mqttConnected: true,
        portStatus: "online",
        spoolPending: 0,
        rejectedMessages: 0,
        lastPublishedAgeSeconds: 3,
      },
      nodes: [
        {
          fieldNodeId: "A",
          deviceId: "00000000-0000-0000-0000-000000000001",
          installLabel: "FIELD-NODE-A",
          enabled: true,
          deferred: false,
          status: "online",
          telemetryMessages: 4128,
          commandForwards: 18,
          ackPublishes: 18,
          lastTelemetryAgeSeconds: 4,
          lastAckAgeSeconds: 12,
        },
        {
          fieldNodeId: "B",
          deviceId: "00000000-0000-0000-0000-000000000002",
          installLabel: "FIELD-NODE-B",
          enabled: true,
          deferred: false,
          status: "online",
          telemetryMessages: 3896,
          commandForwards: 16,
          ackPublishes: 16,
          lastTelemetryAgeSeconds: 5,
          lastAckAgeSeconds: 18,
        },
        {
          fieldNodeId: "C",
          deviceId: "00000000-0000-0000-0000-000000000003",
          installLabel: "FIELD-NODE-C",
          enabled: true,
          deferred: false,
          status: "online",
          telemetryMessages: 2764,
          commandForwards: 12,
          ackPublishes: 12,
          lastTelemetryAgeSeconds: 7,
          lastAckAgeSeconds: 21,
        },
      ],
      soak: {
        generatedAt: nowIso(),
        accepted: true,
        currentBoundary: "rk3568-center-soak-ready",
        cleanWindowRounds: 2,
        allAcked: true,
        maxBoardObservationSchemaRejectedDelta: 0,
      },
    },
    hermesEdge: {
      available: true,
      stale: false,
      detail: "RK3568 Hermes 边缘智能监督 sidecar 已加载 64 特征链路诊断模型，并通过安全动作压测。",
      source: "rk3568_hermes_edge_supervisor",
      generatedAt: nowIso(),
      boardHost: "192.168.124.179",
      serviceActive: true,
      serviceEnabled: true,
      accepted: true,
      currentBoundary: "rk3568-hermes-edge-supervisor-agent-model-registry-ready",
      modelLoaded: true,
      modelKey: "hermes-edge-diagnosis-rf",
      modelVersion: "2026-05-06",
      modelType: "random_forest_classifier",
      modelTask: "edge_link_diagnosis",
      featureCount: 64,
      aiModelCount: 1,
      diagnosisType: "center_mqtt_route_unreachable",
      confidence: 0.992188,
      confidenceLevel: "high",
      naturalLanguageReady: true,
      intentCount: 3,
      actionRecheckAccepted: true,
      actionRecheckStatus: "completed",
      safetyGatewayCoreTouched: false,
      safetySerialTouched: false,
      safetyMqttTouched: false,
      stress: {
        totalRequests: 8143,
        errorRate: 0,
        throughputRps: 271.254,
        p95Ms: 72.65,
        p99Ms: 94.818,
        recheckOk: 271,
      },
      volatilitySurface: makeMockHermesVolatilitySurface(),
    },
  };
}

function makeGpsSeries(
  devices: Device[],
  stations: Station[],
  deviceId: string,
  days: number
): GpsSeries {
  const device = devices.find((d) => d.id === deviceId) ?? devices[0];
  const station = stations.find((item) => item.id === device?.stationId);
  const pointsCount = Math.max(16, Math.min(200, days * 24));

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);

  const baseLat = station?.lat ?? DEMO_SITE_LAT;
  const baseLng = station?.lng ?? DEMO_SITE_LNG;
  let v = 0;
  const points = Array.from({ length: pointsCount }, (_, idx) => {
    const ts = new Date(
      start.getTime() + (idx * days * 24 * 60 * 60 * 1000) / pointsCount
    ).toISOString();
    const horizontalMm = Number((idx * 0.22 + Math.sin(idx / 5) * 0.12).toFixed(2));
    const verticalMm = Number((idx * 0.07 + Math.cos(idx / 6) * 0.05).toFixed(2));
    v = Number(Math.sqrt(horizontalMm * horizontalMm + verticalMm * verticalMm).toFixed(2));
    return {
      ts,
      dispMm: v,
      horizontalMm,
      verticalMm,
      latitude: Number((baseLat + horizontalMm / 111_111_000).toFixed(6)),
      longitude: Number((baseLng + verticalMm / 111_111_000).toFixed(6)),
    };
  });

  return {
    deviceId,
    deviceName: device?.name ?? deviceId,
    points,
  };
}

function makeGpsDerivedAnalysis(
  devices: Device[],
  stations: Station[],
  deviceId: string,
  rangeLabel: string
): GpsDerivedAnalysis {
  const days = rangeLabel.endsWith("d") ? Number.parseInt(rangeLabel, 10) : 7;
  const series = makeGpsSeries(devices, stations, deviceId, Number.isFinite(days) ? days : 7);
  const values = series.points.map((point) => point.dispMm / 1000);
  const imf1 = values.map((_, idx) => Number((Math.sin(idx / 2) * 0.4).toFixed(3)));
  const imf2 = values.map((_, idx) => Number((Math.sin(idx / 4) * 0.7).toFixed(3)));
  const imf3 = values.map((_, idx) => Number((Math.sin(idx / 10) * 1.0).toFixed(3)));
  const residue = values.map((value) => Number((value * 0.12 * 1000).toFixed(3)));
  const last = series.points.at(-1)?.dispMm ?? 0;
  const slope = series.points.length > 1 ? last - (series.points.at(-2)?.dispMm ?? last) : 0;
  return {
    deviceId,
    hasBaseline: true,
    qualityScore: 0.84,
    trendDiagnostics: {
      direction: slope > 0.05 ? "increasing" : slope < -0.05 ? "decreasing" : "stable",
      changeMm: Number((last - (series.points[0]?.dispMm ?? last)).toFixed(3)),
      slopeMmPerHour: Number(slope.toFixed(4)),
      durationHours: days * 24,
      regressionFitR2: 0.93,
      accelerationMmPerHour2: Number((slope / 6).toFixed(5)),
      averageStepMm: Number(slope.toFixed(4)),
      volatilityMm: 0.42,
      sampleIntervalSeconds: 3600,
    },
    ceemd: {
      imfs: [imf1, imf2, imf3],
      residue,
      energyDistribution: [0.28, 0.33, 0.24, 0.15],
      dominantFrequencies: [0.0018, 0.0008, 0.0003],
      qualityScore: 0.84,
      reconstructionError: 0.08,
      orthogonality: 0.91,
    },
    prediction: {
      confidence: 0.81,
      shortTerm: Array.from({ length: 12 }, (_v, idx) =>
        Number((last + slope * (idx + 1)).toFixed(2))
      ),
      longTerm: Array.from({ length: 14 }, (_v, idx) =>
        Number((last + slope * 3 * (idx + 1)).toFixed(2))
      ),
      thresholdForecast: {
        thresholdsMm: {
          blue: 2,
          yellow: 5,
          red: 8,
        },
        shortTerm: {
          blue: {
            breached: true,
            firstIndex: 1,
            firstValue: Number((last + slope).toFixed(2)),
            etaHours: 1,
            etaDays: 0.042,
            firstTimestamp: addDays(nowIso(), 1 / 24),
          },
          yellow: {
            breached: last >= 5,
            firstIndex: last >= 5 ? 1 : null,
            firstValue: last >= 5 ? Number((last + slope).toFixed(2)) : null,
            etaHours: last >= 5 ? 1 : null,
            etaDays: last >= 5 ? 0.042 : null,
            firstTimestamp: last >= 5 ? addDays(nowIso(), 1 / 24) : null,
          },
          red: {
            breached: false,
            firstIndex: null,
            firstValue: null,
            etaHours: null,
            etaDays: null,
            firstTimestamp: null,
          },
        },
        longTerm: {
          blue: {
            breached: true,
            firstIndex: 1,
            firstValue: Number((last + slope * 3).toFixed(2)),
            etaHours: 1,
            etaDays: 0.042,
            firstTimestamp: addDays(nowIso(), 1 / 24),
          },
          yellow: {
            breached: true,
            firstIndex: 3,
            firstValue: Number((last + slope * 9).toFixed(2)),
            etaHours: 3,
            etaDays: 0.125,
            firstTimestamp: addDays(nowIso(), 3 / 24),
          },
          red: {
            breached: false,
            firstIndex: null,
            firstValue: null,
            etaHours: null,
            etaDays: null,
            firstTimestamp: null,
          },
        },
      },
      confidenceIntervals: {
        shortTermLower: Array.from({ length: 12 }, (_v, idx) =>
          Number((last + slope * (idx + 1) - 0.8).toFixed(2))
        ),
        shortTermUpper: Array.from({ length: 12 }, (_v, idx) =>
          Number((last + slope * (idx + 1) + 0.8).toFixed(2))
        ),
        longTermLower: Array.from({ length: 14 }, (_v, idx) =>
          Number((last + slope * 3 * (idx + 1) - 1.8).toFixed(2))
        ),
        longTermUpper: Array.from({ length: 14 }, (_v, idx) =>
          Number((last + slope * 3 * (idx + 1) + 1.8).toFixed(2))
        ),
      },
    },
  };
}

function deriveSuccessNotificationPolicy(input: {
  notifyOnAck?: boolean;
  successNotificationPolicy?: SuccessNotificationPolicy;
}): {
  notifyOnAck: boolean;
  successNotificationPolicy: SuccessNotificationPolicy;
  effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
} {
  const successNotificationPolicy =
    input.successNotificationPolicy ?? (input.notifyOnAck ? "always_notify" : "silent");
  const effectiveSuccessNotificationPolicy =
    successNotificationPolicy === "inherit"
      ? input.notifyOnAck
        ? "always_notify"
        : "silent"
      : successNotificationPolicy;
  return {
    notifyOnAck: Boolean(
      input.notifyOnAck ?? effectiveSuccessNotificationPolicy === "always_notify"
    ),
    successNotificationPolicy,
    effectiveSuccessNotificationPolicy,
  };
}

function normalizeIdentityClass(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isFormalIdentityClass(value: unknown): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function isCommissionedLifecycle(value: unknown): boolean {
  const normalized = normalizeIdentityClass(value);
  return normalized === "commissioned" || normalized === "active";
}

function deriveMockFieldNodeId(nodeCode: string, currentFieldNodeId?: string | null): string {
  const normalizedCurrent = typeof currentFieldNodeId === "string" ? currentFieldNodeId.trim() : "";
  if (normalizedCurrent && normalizedCurrent !== nodeCode && normalizedCurrent.length <= 16)
    return normalizedCurrent;
  const suffix = nodeCode.trim().match(/-([A-Za-z0-9]+)$/)?.[1];
  return suffix || nodeCode;
}

function makePendingObservations(devices: Device[]): PendingObservation[] {
  return devices
    .filter(
      (device) =>
        !isFormalIdentityClass(device.identityClass) ||
        !device.stationCode ||
        !device.regionCode ||
        !device.gatewayCode
    )
    .map((device) => ({
      deviceId: device.id,
      runtimeName: device.deviceName ?? device.id,
      displayName: device.displayName ?? device.name,
      stationCode: device.stationCode ?? null,
      installLabel: device.installLabel ?? null,
      nodeCodeHint: device.nodeCode ?? null,
      fieldNodeId:
        (typeof device.metadata?.fieldNodeId === "string" && device.metadata.fieldNodeId.trim()
          ? device.metadata.fieldNodeId.trim()
          : deriveMockFieldNodeId(device.nodeCode ?? "")
        ) ||
        (device.nodeCode
          ? deriveMockFieldNodeId(device.nodeCode)
          : null),
      gatewayCode: device.gatewayCode ?? null,
      regionCode: device.regionCode ?? null,
      firstSeenAt: device.createdAt ?? device.updatedAt ?? device.lastSeenAt,
      lastSeenAt: device.lastSeenAt,
      lastSeq: null,
      observationSource: "registry_incomplete" as const,
      reason: !isFormalIdentityClass(device.identityClass)
        ? "台账已存在，待完成正式认领"
        : "台账已存在，待补齐正式身份字段",
      sampleMetrics: {
        temperatureC: null,
        humidityPct: null,
        batteryPct: null,
        gpsLatitude: null,
        gpsLongitude: null,
        warningFlag: null,
      },
      status: device.status,
    }))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

function makeOnboardingWorkbench(
  stations: Station[],
  devices: Device[],
  baselines: Baseline[],
  audits: Array<{
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
  }>
): OnboardingWorkbench {
  const formalDevices = devices.filter((device) => isFormalIdentityClass(device.identityClass));
  const pendingObservations = makePendingObservations(devices);
  return {
    summary: {
      pendingCount: pendingObservations.length,
      formalCount: formalDevices.length,
      pendingCommissioningCount: formalDevices.filter(
        (device) => !isCommissionedLifecycle(device.lifecycleStatus) || device.status !== "online"
      ).length,
      auditCount: audits.length,
    },
    stations,
    formalDevices,
    pendingObservations,
    baselines,
    audits,
  };
}

export function createMockClient(options: MockOptions = {}): ApiClient {
  const delayMs = options.delayMs ?? 200;
  const failureRate = clamp(options.failureRate ?? 0, 0, 1);
  let stations = makeStations();
  let devices = makeDevices(stations);
  let stationManagementStations = makeStationManagementStations(stations, devices);
  const weeklyTrend = makeWeeklyTrend();
  const summary = makeSummary(stations, devices);
  const systemStatus = makeSystemStatus();
  const accountRoles = makeMockAccountRoles();
  let accountUsers = makeMockAccountUsers(accountRoles);
  const accountPasswords = new Map<string, string>([
    ["u_admin", "123456"],
    ["u_viewer", "123456"],
    ["u_operator", "123456"],
  ]);
  let fieldAlarmAction: FieldAlarmAction | undefined;
  let systemConfigs = [
    {
      key: "gps.displacement_threshold_blue_mm",
      value: "2",
      type: "number",
      description: "形变蓝色预警阈值（mm）",
      updatedAt: nowIso(),
    },
    {
      key: "gps.displacement_threshold_yellow_mm",
      value: "5",
      type: "number",
      description: "形变黄色预警阈值（mm）",
      updatedAt: nowIso(),
    },
    {
      key: "gps.displacement_threshold_red_mm",
      value: "8",
      type: "number",
      description: "形变红色预警阈值（mm）",
      updatedAt: nowIso(),
    },
    {
      key: "gps.data_limit",
      value: "200",
      type: "number",
      description: "形变数据点数限制",
      updatedAt: nowIso(),
    },
  ];
  let baselines = makeBaselines(devices, stations);
  let commands: Array<{
    commandId: string;
    deviceId: string;
    commandType: string;
    payload: Record<string, unknown>;
    notifyOnAck: boolean;
    successNotificationPolicy: SuccessNotificationPolicy;
    effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
    status: "queued" | "sent" | "acked" | "failed" | "timeout" | "canceled";
    createdAt: string;
    updatedAt: string;
  }> = [];
  let onboardingAudits: Array<{
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
  }> = [];

  const afterDelay = async (endpoint: string) => {
    await sleep(delayMs);
    if (failureRate <= 0) return;
    if (Math.random() < failureRate) {
      throw new Error(`数据服务暂不可用：${endpoint}`);
    }
  };

  const appendOnboardingAudit = (input: {
    module: string;
    action: string;
    targetType: string;
    targetId: string;
    description: string;
    requestData: unknown;
    responseData: unknown;
  }) => {
    onboardingAudits = [
      {
        id: `mock-op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        userId: "u_admin",
        username: "admin",
        module: input.module,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        description: input.description,
        requestData: input.requestData,
        responseData: input.responseData,
        ipAddress: "127.0.0.1",
        userAgent: "desktop-client",
        status: "success",
        errorMessage: "",
        createdAt: nowIso(),
      },
      ...onboardingAudits,
    ].slice(0, 50);
  };

  const upsertBaseline: ApiClient["baselines"]["upsert"] = async (input) => {
    await afterDelay("baselines.upsert");
    const device = devices.find((d) => d.id === input.deviceId);
    const establishedTime = input.establishedTime ?? nowIso();

    const next: Baseline = {
      deviceId: input.deviceId,
      deviceName: device?.name ?? input.deviceId,
      baselineLat: input.baselineLat,
      baselineLng: input.baselineLng,
      establishedBy: input.establishedBy,
      establishedTime,
      status: input.status,
      ...(input.baselineAlt !== undefined ? { baselineAlt: input.baselineAlt } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    if (input.persist !== false) {
      const idx = baselines.findIndex((b) => b.deviceId === input.deviceId);
      if (idx >= 0) baselines = baselines.map((b) => (b.deviceId === input.deviceId ? next : b));
      else baselines = [...baselines, next];
    }
    return next;
  };

  const resolveAccountLoginUser = (username: string, password: string) => {
    const account = accountUsers.find((item) => item.username === username);
    if (!account) throw new Error("账号不存在");
    if (account.status !== "active") throw new Error("账号已停用或锁定");
    if (accountPasswords.get(account.userId) !== password) throw new Error("用户名或密码错误");
    const isAdmin = account.roles.some((role) => role.name === "admin" || role.name === "super_admin");
    return {
      id: account.userId,
      name: account.realName || account.username,
      role: isAdmin ? "admin" as const : "viewer" as const,
    };
  };

  const normalizeAccountUserInput = (value?: string) => {
    const trimmed = value?.trim() ?? "";
    return trimmed ? trimmed : undefined;
  };

  const appendAccountAudit = (input: {
    action: string;
    targetId: string;
    description: string;
    requestData: unknown;
    responseData: unknown;
  }) => {
    appendOnboardingAudit({
      module: "account",
      action: input.action,
      targetType: "user",
      targetId: input.targetId,
      description: input.description,
      requestData: input.requestData,
      responseData: input.responseData,
    });
  };

  return {
    auth: {
      async login(input) {
        await afterDelay("auth.login");
        if ("mobile" in input) {
          return {
            token: `mock-token-${String(Date.now())}`,
            refreshToken: `mock-refresh-${String(Date.now())}`,
            user: { id: "u_mobile", name: input.mobile, role: "viewer" as const },
          };
        }
        const user = resolveAccountLoginUser(input.username, input.password);
        return {
          token: `mock-token-${String(Date.now())}`,
          refreshToken: `mock-refresh-${String(Date.now())}`,
          user,
        };
      },
      async logout() {
        await afterDelay("auth.logout");
      },
      async me() {
        await afterDelay("auth.me");
        const account = accountUsers.find((item) => item.userId === "u_admin");
        if (!account) throw new Error("账号不存在");
        return account;
      },
      async changePassword(input) {
        await afterDelay("auth.changePassword");
        const current = accountPasswords.get("u_admin");
        if (current !== input.oldPassword) throw new Error("旧密码错误");
        accountPasswords.set("u_admin", input.newPassword);
      },
    },
    accounts: {
      async listRoles() {
        await afterDelay("accounts.listRoles");
        return accountRoles;
      },
      async listUsers(input) {
        await afterDelay("accounts.listUsers");
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 20;
        const keyword = input?.keyword?.trim().toLowerCase() ?? "";
        const filtered = accountUsers.filter((user) => {
          if (input?.status && user.status !== input.status) return false;
          if (input?.roleId && !user.roles.some((role) => role.roleId === input.roleId)) return false;
          if (!keyword) return true;
          return [user.username, user.realName, user.email, user.phone]
            .join(" ")
            .toLowerCase()
            .includes(keyword);
        });
        const total = filtered.length;
        const start = (page - 1) * pageSize;
        return {
          list: filtered.slice(start, start + pageSize),
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
        };
      },
      async createUser(input) {
        await afterDelay("accounts.createUser");
        const username = input.username.trim();
        if (accountUsers.some((user) => user.username === username)) throw new Error("账号已存在");
        const now = nowIso();
        const roleIds = input.roleIds?.length ? input.roleIds : [accountRoles.find((role) => role.name === "user")?.roleId ?? ""];
        const roles = accountRoles
          .filter((role) => roleIds.includes(role.roleId))
          .map((role) => ({ roleId: role.roleId, name: role.name, displayName: role.displayName }));
        const userId = `u_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const next: AccountUser = {
          userId,
          username,
          realName: normalizeAccountUserInput(input.realName) ?? username,
          email: normalizeAccountUserInput(input.email) ?? "",
          phone: normalizeAccountUserInput(input.phone) ?? "",
          status: "active",
          roles,
          permissions: [],
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        };
        accountUsers = [next, ...accountUsers];
        accountPasswords.set(userId, input.password);
        appendAccountAudit({
          action: "create_user",
          targetId: userId,
          description: "create mock account",
          requestData: { username, roleIds },
          responseData: { userId },
        });
        return { userId };
      },
      async updateUser(input) {
        await afterDelay("accounts.updateUser");
        const updatedAt = nowIso();
        let found = false;
        accountUsers = accountUsers.map((user) => {
          if (user.userId !== input.userId) return user;
          found = true;
          const nextRoles = input.roleIds
            ? accountRoles
                .filter((role) => input.roleIds?.includes(role.roleId))
                .map((role) => ({ roleId: role.roleId, name: role.name, displayName: role.displayName }))
            : user.roles;
          return {
            ...user,
            realName: normalizeAccountUserInput(input.realName) ?? user.realName,
            email: normalizeAccountUserInput(input.email) ?? user.email,
            phone: normalizeAccountUserInput(input.phone) ?? user.phone,
            status: input.status ?? user.status,
            roles: nextRoles,
            updatedAt,
          };
        });
        if (!found) throw new Error("账号不存在");
        appendAccountAudit({
          action: "update_user",
          targetId: input.userId,
          description: "update mock account",
          requestData: input,
          responseData: { updatedAt },
        });
        return { userId: input.userId, updatedAt };
      },
      async deleteUser(input) {
        await afterDelay("accounts.deleteUser");
        accountUsers = accountUsers.filter((user) => user.userId !== input.userId);
        accountPasswords.delete(input.userId);
      },
      async resetPassword(input) {
        await afterDelay("accounts.resetPassword");
        const user = accountUsers.find((item) => item.userId === input.userId);
        if (!user) throw new Error("账号不存在");
        const temporaryPassword = `Lsm@${Math.random().toString(36).slice(2, 10)}`;
        const resetAt = nowIso();
        accountPasswords.set(input.userId, temporaryPassword);
        accountUsers = accountUsers.map((item) =>
          item.userId === input.userId ? { ...item, updatedAt: resetAt } : item
        );
        appendAccountAudit({
          action: "reset_password",
          targetId: input.userId,
          description: "reset mock account password",
          requestData: { userId: input.userId },
          responseData: { resetAt },
        });
        return {
          userId: input.userId,
          temporaryPassword,
          mustChangeOnNextLogin: true,
          resetAt,
        };
      },
    },
    dashboard: {
      async getSummary() {
        await afterDelay("dashboard.getSummary");
        return summary;
      },
      async getWeeklyTrend() {
        await afterDelay("dashboard.getWeeklyTrend");
        return weeklyTrend;
      },
    },
    stations: {
      async list() {
        await afterDelay("stations.list");
        return stations;
      },
      async listManagement() {
        await afterDelay("stations.listManagement");
        return stationManagementStations;
      },
      async updateManagement(input) {
        await afterDelay("stations.updateManagement");
        const updatedAt = nowIso();
        stationManagementStations = stationManagementStations.map((station) =>
          station.stationId === input.stationId
            ? {
                ...station,
                stationName: input.stationName,
                displayName: input.displayName || null,
                regionCode: input.regionCode || null,
                slopeCode: input.slopeCode || null,
                lifecycleStatus: input.lifecycleStatus || null,
                locationName: input.locationName,
                description: input.description,
                chartLegendName: input.chartLegendName,
                riskLevel: input.riskLevel,
                status: input.status,
                sensorTypes: input.sensorTypes,
                updatedAt,
              }
            : station
        );
        return { stationId: input.stationId, updatedAt };
      },
      async updateLegendNames(input) {
        await afterDelay("stations.updateLegendNames");
        let updated = 0;
        stationManagementStations = stationManagementStations.map((station) => {
          const nextLegend = input.legends[station.stationId];
          if (!nextLegend || !nextLegend.trim()) return station;
          updated += 1;
          return {
            ...station,
            chartLegendName: nextLegend.trim(),
            updatedAt: nowIso(),
          };
        });
        return { updated };
      },
    },
    devices: {
      async list(input) {
        await afterDelay("devices.list");
        if (!input?.stationId) return devices;
        return devices.filter((d) => d.stationId === input.stationId);
      },
      async getState(input) {
        await afterDelay("devices.getState");
        const device = devices.find((item) => item.id === input.deviceId);
        const station = stations.find((item) => item.id === device?.stationId);
        const batteryPct =
          input.deviceId === "device_soil_02" ? 18 : stablePercent(`${input.deviceId}-battery`, 86, 96);
        const humidityPct = stablePercent(`${input.deviceId}-humidity`, 58, 74);
        const temperatureC = stablePercent(`${input.deviceId}-temperature`, 196, 248) / 10;
        const soilMoisturePct = stablePercent(`${input.deviceId}-soil-moisture`, 265, 382) / 10;
        const conductivityUsCm = stablePercent(`${input.deviceId}-conductivity`, 420, 860);
        const tiltXDeg =
          input.deviceId === "device_tilt_03" ? 1.36 : stablePercent(`${input.deviceId}-tilt-x`, 18, 96) / 100;
        const tiltYDeg =
          input.deviceId === "device_tilt_03" ? 0.92 : stablePercent(`${input.deviceId}-tilt-y`, 12, 84) / 100;
        const warningFlag = device?.status === "warning";
        return {
          deviceId: input.deviceId,
          updatedAt: device?.lastSeenAt ?? nowIso(),
          metrics: {
            temperature_c: Number(temperatureC.toFixed(1)),
            humidity_pct: Number(humidityPct.toFixed(1)),
            accel_x_g: Number(
              (stablePercent(`${input.deviceId}-accel-x`, -100, 100) / 100).toFixed(2)
            ),
            accel_y_g: Number(
              (stablePercent(`${input.deviceId}-accel-y`, -100, 100) / 100).toFixed(2)
            ),
            accel_z_g: 1,
            gyro_x_dps: Number(
              (stablePercent(`${input.deviceId}-gyro-x`, -50, 50) / 10).toFixed(1)
            ),
            gyro_y_dps: Number(
              (stablePercent(`${input.deviceId}-gyro-y`, -50, 50) / 10).toFixed(1)
            ),
            gyro_z_dps: Number(
              (stablePercent(`${input.deviceId}-gyro-z`, -50, 50) / 10).toFixed(1)
            ),
            tilt_x_deg: Number(tiltXDeg.toFixed(3)),
            tilt_y_deg: Number(tiltYDeg.toFixed(3)),
            gps_latitude: Number(((station?.lat ?? DEMO_SITE_LAT) + 0.000123).toFixed(6)),
            gps_longitude: Number(((station?.lng ?? DEMO_SITE_LNG) + 0.000156).toFixed(6)),
            battery_pct: batteryPct,
            soil_temperature_c: Number(temperatureC.toFixed(1)),
            soil_moisture_pct: Number(soilMoisturePct.toFixed(1)),
            electrical_conductivity_us_cm: conductivityUsCm,
            warning_flag: warningFlag,
          },
          meta: {
            install_label: device?.name ?? input.deviceId,
            legacy_node: station?.name ?? "",
            upload_trigger: "periodic",
          },
        };
      },
      async revoke(input) {
        await afterDelay("devices.revoke");
        const revokedAt = nowIso();
        const device = devices.find((item) => item.id === input.deviceId);
        if (!device) {
          throw new Error("设备不存在");
        }

        devices = devices.filter((item) => item.id !== input.deviceId);
        stationManagementStations = makeStationManagementStations(stations, devices);

        appendOnboardingAudit({
          module: "device",
          action: "revoke_device",
          targetType: "device",
          targetId: input.deviceId,
          description: "revoke device",
          requestData: {
            deviceId: input.deviceId,
            deviceName: device.deviceName ?? device.id,
            displayName: device.displayName ?? device.name,
            stationId: device.stationId,
            stationCode: device.stationCode ?? null,
            stationName: device.stationName,
            installLabel: device.installLabel ?? null,
            nodeCode: device.nodeCode ?? null,
            gatewayCode: device.gatewayCode ?? null,
            lifecycleStatus: device.lifecycleStatus ?? null,
          },
          responseData: {
            deviceId: input.deviceId,
            status: "revoked",
            revokedAt,
          },
        });

        return {
          deviceId: input.deviceId,
          status: "revoked" as const,
          revokedAt,
        };
      },
      async issueCommand(input) {
        await afterDelay("devices.issueCommand");
        const createdAt = nowIso();
        const commandId = `mock-cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const successPolicy = deriveSuccessNotificationPolicy(input);
        commands = [
          {
            commandId,
            deviceId: input.deviceId,
            commandType: input.commandType,
            payload: input.payload,
            ...successPolicy,
            status: "queued",
            createdAt,
            updatedAt: createdAt,
          },
          ...commands,
        ];
        return { commandId, status: "queued" as const, ...successPolicy };
      },
      async listCommands(input) {
        await afterDelay("devices.listCommands");
        return commands.filter((item) => item.deviceId === input.deviceId);
      },
      async getHealthExpert(input) {
        await afterDelay("devices.getHealthExpert");
        const device = devices.find((item) => item.id === input.deviceId);
        const battery = stablePercent(`${input.deviceId}-battery`, 86, 96);
        const signal = stablePercent(`${input.deviceId}-signal`, 82, 96);
        const freshness =
          device?.status === "online" ? 100 : device?.status === "warning" ? 45 : 10;
        const score = Math.round(0.4 * battery + 0.3 * signal + 0.3 * freshness);
        const level = score >= 80 ? "good" : score >= 50 ? "warn" : "bad";
        return {
          deviceId: input.deviceId,
          metric: input.metric ?? "all",
          runId: `mock-expert-${Date.now()}`,
          result: {
            analysisType: "edge_health_expert_v1",
            battery: {
              soc: battery,
              voltage: 3.9,
              temperatureC: 21,
              confidence: 0.8,
              warnings: battery < 20 ? ["battery low"] : [],
            },
            signal: {
              rssi: -72,
              strength: signal,
              confidence: 0.8,
              warnings: signal < 40 ? ["signal weak"] : [],
            },
            health: {
              score,
              level,
              components: {
                batteryScore: battery,
                signalScore: signal,
                dataFreshnessScore: freshness,
              },
              warnings: level === "bad" ? ["data stale"] : [],
            },
            metadata: {
              apiVersion: "demo-v1",
              analysisMethod: "edge_health_expert_v1",
              calculationTime: nowIso(),
              cacheUsed: false,
            },
          },
        };
      },
    },
    telemetry: {
      async getSeries(input) {
        await afterDelay("telemetry.getSeries");
        const device = devices.find((item) => item.id === input.deviceId);
        const station = stations.find((item) => item.id === device?.stationId);
        const startMs = Number.isFinite(Date.parse(input.startTime))
          ? Date.parse(input.startTime)
          : Date.now() - 11 * 60 * 60 * 1000;
        const endMs = Number.isFinite(Date.parse(input.endTime)) ? Date.parse(input.endTime) : Date.now();
        const count = input.interval === "1d" ? 7 : input.interval === "1h" ? 24 : 12;
        const stepMs =
          input.interval === "1d"
            ? 24 * 60 * 60 * 1000
            : input.interval === "1h"
              ? 60 * 60 * 1000
              : Math.max(1, Math.floor((endMs - startMs) / Math.max(1, count - 1)));

        return Array.from({ length: count }, (_, idx) => {
          const ts = new Date(Math.min(endMs, startMs + idx * stepMs)).toISOString();
          const wave = Math.sin(idx / 2.5);
          const seed = stablePercent(`${input.deviceId}-${input.sensorKey}-${idx}`, 0, 100) / 100;
          let value: number;

          if (input.sensorKey === "rainfall_mm") {
            value = Math.max(0, 0.4 + wave * 0.35 + seed * 1.6);
          } else if (input.sensorKey === "temperature_c") {
            value = 21.2 + wave * 1.1 + seed * 1.4;
          } else if (input.sensorKey === "humidity_pct") {
            value = 62 + wave * 4.2 + seed * 6.5;
          } else if (input.sensorKey === "soil_temperature_c") {
            value = 22.4 + wave * 0.9 + seed * 1.2;
          } else if (input.sensorKey === "soil_moisture_pct") {
            value = 29 + wave * 2.6 + seed * 4.2;
          } else if (input.sensorKey === "electrical_conductivity_us_cm") {
            value = 520 + wave * 38 + seed * 110;
          } else if (input.sensorKey === "tilt_x_deg" || input.sensorKey === "tilt_y_deg") {
            const isTiltX = input.sensorKey === "tilt_x_deg";
            const baseline = (isTiltX ? 0.42 : 0.18) + stablePercent(`${input.deviceId}-${input.sensorKey}-base`, 0, 42) / 100;
            const stationBias = stablePercent(`${station?.id ?? input.deviceId}-${input.sensorKey}-bias`, 0, 18) / 100;
            const warningBoost = device?.status === "warning" ? (isTiltX ? 0.42 : 0.28) : 0;
            const drift = idx * (isTiltX ? 0.006 : 0.004);
            value = Math.max(0, baseline + stationBias + warningBoost + drift + wave * (isTiltX ? 0.055 : 0.04) + (seed - 0.5) * 0.045);
          } else if (input.sensorKey === "gps_latitude") {
            value = (station?.lat ?? DEMO_SITE_LAT) + idx * 0.000002;
          } else if (input.sensorKey === "gps_longitude") {
            value = (station?.lng ?? DEMO_SITE_LNG) + idx * 0.000002;
          } else {
            value = 1 + seed * 9;
          }

          return {
            ts,
            value: Number(value.toFixed(input.sensorKey.startsWith("gps_") ? 6 : input.sensorKey.startsWith("tilt_") ? 3 : 2)),
          };
        });
      },
    },
    aiPredictions: {
      async list(input) {
        await afterDelay("aiPredictions.list");
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 10;
        const list = makeAiPredictions(devices, stations).filter((item) => {
          if (input?.deviceId && item.deviceId !== input.deviceId) return false;
          if (input?.stationId && item.stationId !== input.stationId) return false;
          if (input?.modelKey && item.modelKey !== input.modelKey) return false;
          if (input?.riskLevel && item.riskLevel !== input.riskLevel) return false;
          return true;
        });
        return {
          page,
          pageSize,
          total: list.length,
          list: list.slice((page - 1) * pageSize, page * pageSize),
        };
      },
    },
    alerts: {
      async list(input) {
        await afterDelay("alerts.list");
        const status = makeMockFieldAlarmStatus(fieldAlarmAction);
        const all = status.latestAlert ? [status.latestAlert] : [];
        const filtered = all.filter((item) => {
          if (input?.deviceId && item.deviceId !== input.deviceId) return false;
          if (input?.stationId && item.stationId !== input.stationId) return false;
          if (input?.severity && item.severity !== input.severity) return false;
          if (input?.status && item.status !== input.status) return false;
          return true;
        });
        const page = input?.page ?? 1;
        const pageSize = input?.pageSize ?? 20;
        return {
          list: filtered.slice((page - 1) * pageSize, page * pageSize),
          pagination: {
            page,
            pageSize,
            total: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
          },
          summary: {
            active: filtered.filter((item) => item.status === "active").length,
            acked: filtered.filter((item) => item.status === "acked").length,
            resolved: filtered.filter((item) => item.status === "resolved").length,
            high: filtered.filter((item) => item.severity === "high").length,
            critical: filtered.filter((item) => item.severity === "critical").length,
          },
        };
      },
    },
    fieldAlarm: {
      async getStatus() {
        await afterDelay("fieldAlarm.getStatus");
        return makeMockFieldAlarmStatus(fieldAlarmAction);
      },
      async sendAction(input) {
        await afterDelay("fieldAlarm.sendAction");
        fieldAlarmAction = input.action;
        return {
          action: input.action,
          accepted: true,
          actuator: makeMockFieldAlarmStatus(fieldAlarmAction).actuator,
        };
      },
    },
    gps: {
      async getSeries(input) {
        await afterDelay("gps.getSeries");
        return makeGpsSeries(devices, stations, input.deviceId, input.days ?? 7);
      },
      async getDerivedAnalysis(input) {
        await afterDelay("gps.getDerivedAnalysis");
        return makeGpsDerivedAnalysis(devices, stations, input.deviceId, input.rangeLabel ?? "7d");
      },
    },
    baselines: {
      async list() {
        await afterDelay("baselines.list");
        return baselines;
      },
      upsert: upsertBaseline,
      async remove(input) {
        await afterDelay("baselines.remove");
        baselines = baselines.filter((b) => b.deviceId !== input.deviceId);
      },
      async autoEstablish(input) {
        await afterDelay("baselines.autoEstablish");
        const device = devices.find((d) => d.id === input.deviceId);
        const st = stations.find((s) => s.id === device?.stationId);
        const lat = Number(((st?.lat ?? DEMO_SITE_LAT) + (Math.random() - 0.5) * 0.0006).toFixed(6));
        const lng = Number(((st?.lng ?? DEMO_SITE_LNG) + (Math.random() - 0.5) * 0.0006).toFixed(6));
        return upsertBaseline({
          deviceId: input.deviceId,
          baselineLat: lat,
          baselineLng: lng,
          baselineAlt: 510,
          establishedBy: "auto",
          status: "active",
          notes: "auto established",
          ...(input.persist === undefined ? {} : { persist: input.persist }),
        });
      },
    },
    system: {
      async getStatus() {
        await afterDelay("system.getStatus");
        return systemStatus;
      },
      async getConfigs() {
        await afterDelay("system.getConfigs");
        return systemConfigs;
      },
      async updateConfigs(input) {
        await afterDelay("system.updateConfigs");
        const stamp = nowIso();
        const updates = new Map(input.configs.map((item) => [item.key, item.value] as const));
        let updated = 0;
        systemConfigs = systemConfigs.map((item) => {
          if (!updates.has(item.key)) return item;
          updated += 1;
          return {
            ...item,
            value: updates.get(item.key) ?? item.value,
            updatedAt: stamp,
          };
        });
        return { updated };
      },
      async getCommandSuccessNotificationPolicy() {
        await afterDelay("system.getCommandSuccessNotificationPolicy");
        return {
          systemDefault: "silent" as const,
          commandTypeDefaults: {
            set_config: "always_notify" as const,
            reboot: "always_notify" as const,
            restart_device: "always_notify" as const,
            deactivate_device: "always_notify" as const,
          },
        };
      },
      async updateCommandSuccessNotificationPolicy(input) {
        await afterDelay("system.updateCommandSuccessNotificationPolicy");
        return input;
      },
      async getOperationLogs(input) {
        await afterDelay("system.getOperationLogs");
        return {
          page: input.page,
          pageSize: input.pageSize,
          total: 1,
          list: [
            {
              id: "mock-op-1",
              userId: "u_admin",
              username: "admin",
              module: "system",
              action: "update_command_success_notification_policy",
              targetType: "",
              targetId: "",
              description: "update command success notification policy",
              requestData: {
                previousPolicy: {
                  systemDefault: "silent",
                  commandTypeDefaults: {},
                },
                nextPolicy: {
                  systemDefault: "silent",
                  commandTypeDefaults: {
                    set_config: "always_notify",
                  },
                },
              },
              responseData: {
                updatedPolicy: {
                  systemDefault: "silent",
                  commandTypeDefaults: {
                    set_config: "always_notify",
                  },
                },
              },
              ipAddress: "127.0.0.1",
              userAgent: "desktop-client",
              status: "success",
              errorMessage: "",
              createdAt: nowIso(),
            },
          ],
        };
      },
    },
    onboarding: {
      async getWorkbench() {
        await afterDelay("onboarding.getWorkbench");
        return makeOnboardingWorkbench(stations, devices, baselines, onboardingAudits);
      },
      async bindPendingDevice(input) {
        await afterDelay("onboarding.bindPendingDevice");
        let stationId = input.stationId ?? null;
        let createdStationId: string | null = null;
        let createdDevice = false;

        if (input.newStation) {
          createdStationId = `station_${Date.now()}`;
          stationId = createdStationId;
          const nextStation: Station = {
            id: createdStationId,
            name: input.newStation.displayName ?? input.newStation.stationName,
            stationCode: input.newStation.stationCode,
            stationName: input.newStation.stationName,
            displayName: input.newStation.displayName ?? input.newStation.stationName,
            regionCode: input.newStation.regionCode ?? null,
            slopeCode: input.newStation.slopeCode ?? null,
            lifecycleStatus: input.newStation.lifecycleStatus ?? "pending_commissioning",
            area: input.newStation.locationName ?? input.newStation.regionCode ?? "现场新站点",
            risk: input.newStation.riskLevel ?? "mid",
            status: "online",
            lat: input.newStation.latitude ?? 0,
            lng: input.newStation.longitude ?? 0,
            deviceCount: 0,
            metadata: {
              identityClass: "formal",
              displayName: input.newStation.displayName ?? input.newStation.stationName,
              regionCode: input.newStation.regionCode ?? undefined,
              slopeCode: input.newStation.slopeCode ?? undefined,
              lifecycleStatus: input.newStation.lifecycleStatus ?? "pending_commissioning",
              locationName: input.newStation.locationName ?? undefined,
              gatewayCode: input.newStation.gatewayCode ?? undefined,
            },
          };
          stations = [...stations, nextStation];
        }

        const targetStation =
          stations.find((station) => station.id === stationId) ??
          stations.find((station) => station.id === input.stationId) ??
          null;
        const nextDevice = (device?: Device): Device => ({
          id: input.deviceId,
          name: input.displayName,
          deviceName: input.deviceName,
          legacyDeviceId: device?.legacyDeviceId ?? input.deviceId,
          stationId: stationId ?? device?.stationId ?? "",
          stationName: targetStation?.name ?? device?.stationName ?? "未分配",
          stationCode: targetStation?.stationCode ?? device?.stationCode ?? null,
          displayName: input.displayName,
          installLabel: input.installLabel,
          identityClass: "formal",
          deviceRole: input.deviceRole ?? "field_node",
          lifecycleStatus: input.lifecycleStatus ?? "pending_commissioning",
          regionCode: targetStation?.regionCode ?? device?.regionCode ?? null,
          slopeCode: targetStation?.slopeCode ?? device?.slopeCode ?? null,
          nodeCode: input.nodeCode,
          gatewayCode: input.gatewayCode ?? device?.gatewayCode ?? null,
          registryStatus: device?.registryStatus ?? "inactive",
          type: device?.type ?? "gnss",
          status: device?.status ?? "warning",
          lastSeenAt: device?.lastSeenAt ?? nowIso(),
          ...(device?.createdAt ? { createdAt: device.createdAt } : { createdAt: nowIso() }),
          updatedAt: nowIso(),
          metadata: {
            ...(device?.metadata ?? {}),
            identityClass: "formal",
            displayName: input.displayName,
            installLabel: input.installLabel,
            nodeCode: input.nodeCode,
            fieldNodeId: deriveMockFieldNodeId(
              input.nodeCode,
              typeof device?.metadata?.fieldNodeId === "string" ? device.metadata.fieldNodeId : null
            ),
            deviceRole: input.deviceRole ?? "field_node",
            lifecycleStatus: input.lifecycleStatus ?? "pending_commissioning",
            ...(input.gatewayCode ? { gatewayCode: input.gatewayCode } : {}),
          },
        });

        const existingDevice = devices.find((device) => device.id === input.deviceId);
        if (existingDevice) {
          devices = devices.map((device) =>
            device.id === input.deviceId ? nextDevice(device) : device
          );
        } else {
          createdDevice = true;
          devices = [...devices, nextDevice()];
        }
        stationManagementStations = makeStationManagementStations(stations, devices);
        const updatedAt = nowIso();
        appendOnboardingAudit({
          module: "onboarding",
          action: "bind_pending_device",
          targetType: "device",
          targetId: input.deviceId,
          description: "bind pending device to formal registry",
          requestData: input,
          responseData: {
            deviceId: input.deviceId,
            stationId,
            createdStationId,
            createdDevice,
            updatedAt,
          },
        });
        return {
          deviceId: input.deviceId,
          stationId,
          createdStationId,
          createdDevice,
          updatedAt,
        };
      },
      async confirmCommissioning(input) {
        await afterDelay("onboarding.confirmCommissioning");
        const updatedAt = nowIso();
        devices = devices.map((device) =>
          device.id === input.deviceId
            ? {
                ...device,
                lifecycleStatus: input.lifecycleStatus ?? "commissioned",
                metadata: {
                  ...(device.metadata ?? {}),
                  lifecycleStatus: input.lifecycleStatus ?? "commissioned",
                  commissionedAt: updatedAt,
                  commissionedBy: "admin",
                },
                updatedAt,
              }
            : device
        );
        stationManagementStations = makeStationManagementStations(stations, devices);
        appendOnboardingAudit({
          module: "onboarding",
          action: "confirm_commissioning",
          targetType: "device",
          targetId: input.deviceId,
          description: "confirm device commissioning",
          requestData: input,
          responseData: {
            deviceId: input.deviceId,
            updatedAt,
          },
        });
        return {
          deviceId: input.deviceId,
          updatedAt,
        };
      },
    },
  };
}
