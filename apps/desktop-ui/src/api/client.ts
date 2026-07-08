export type ApiMode = "mock" | "http";

export type RiskLevel = "low" | "mid" | "high";
export type AiPredictionRiskLevel = "low" | "medium" | "high";
export type OnlineStatus = "online" | "offline" | "warning";

export type User = {
  id: string;
  name: string;
  role: "admin" | "viewer";
};

export type UserStatus = "active" | "inactive" | "locked";

export type AccountRole = {
  roleId: string;
  name: string;
  displayName: string;
  description: string;
};

export type AccountUser = {
  userId: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  status: UserStatus;
  roles: Array<Pick<AccountRole, "roleId" | "name"> & Partial<Pick<AccountRole, "displayName">>>;
  permissions?: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type AccountUserListResponse = {
  list: AccountUser[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type CreateAccountUserInput = {
  username: string;
  password: string;
  realName?: string;
  email?: string;
  phone?: string;
  roleIds?: string[];
};

export type UpdateAccountUserInput = {
  userId: string;
  realName?: string;
  email?: string;
  phone?: string;
  status?: UserStatus;
  roleIds?: string[];
};

export type ResetAccountPasswordResult = {
  userId: string;
  temporaryPassword: string;
  mustChangeOnNextLogin: boolean;
  resetAt: string;
};

export type DashboardSummary = {
  stationCount: number;
  deviceOnlineCount: number;
  alertCountToday: number;
  systemHealthPercent: number;
};

export type WeeklyTrend = {
  labels: string[];
  rainfallMm: number[];
  alertCount: number[];
  source: "mock_sample" | "derived_summary";
  note: string;
};

export type Station = {
  id: string;
  name: string;
  stationCode?: string | null;
  stationName?: string | null;
  displayName?: string | null;
  regionCode?: string | null;
  slopeCode?: string | null;
  lifecycleStatus?: string | null;
  area: string;
  risk: RiskLevel;
  status: OnlineStatus;
  lat: number;
  lng: number;
  deviceCount: number;
  metadata?: Record<string, unknown>;
};

export type StationManagementStation = {
  stationId: string;
  stationCode: string;
  stationName: string;
  displayName?: string | null;
  regionCode?: string | null;
  slopeCode?: string | null;
  lifecycleStatus?: string | null;
  locationName: string;
  description: string;
  chartLegendName: string;
  riskLevel: RiskLevel;
  status: OnlineStatus;
  lat: number;
  lng: number;
  altitude?: number;
  deviceCount: number;
  sensorTypes: DeviceType[];
  lastDataTime: string;
  updatedAt?: string;
};

export type DeviceType = "gnss" | "rain" | "tilt" | "temp_hum" | "camera" | "field_gateway";

export type Device = {
  id: string;
  name: string;
  deviceName?: string | null;
  legacyDeviceId?: string | null;
  stationId: string;
  stationName: string;
  stationCode?: string | null;
  displayName?: string | null;
  installLabel?: string | null;
  identityClass?: string | null;
  deviceRole?: string | null;
  lifecycleStatus?: string | null;
  regionCode?: string | null;
  slopeCode?: string | null;
  nodeCode?: string | null;
  gatewayCode?: string | null;
  registryStatus?: "inactive" | "active" | "revoked" | null;
  type: DeviceType;
  status: OnlineStatus;
  lastSeenAt: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type DeviceStateSnapshot = {
  deviceId: string;
  updatedAt: string;
  metrics: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type DeviceCommandStatus = "queued" | "sent" | "acked" | "failed" | "timeout" | "canceled";
export type SuccessNotificationPolicy = "inherit" | "silent" | "always_notify";
export type EffectiveSuccessNotificationPolicy = Exclude<SuccessNotificationPolicy, "inherit">;

export type DeviceCommand = {
  commandId: string;
  deviceId: string;
  commandType: string;
  payload: Record<string, unknown>;
  notifyOnAck: boolean;
  successNotificationPolicy: SuccessNotificationPolicy;
  effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
  status: DeviceCommandStatus;
  sentAt?: string;
  ackedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "active" | "acked" | "resolved";

export type AlertSummaryItem = {
  alertId: string;
  status: AlertStatus;
  severity: AlertSeverity;
  title: string;
  message?: string;
  deviceId: string | null;
  stationId: string | null;
  ruleId: string;
  ruleVersion: number;
  evidence?: Record<string, unknown>;
  lastEventAt: string;
};

export type FieldAlarmActuatorStatus = {
  available: boolean;
  dryRun?: boolean;
  state?: string;
  lastAction?: string | null;
  lastActionAt?: string | null;
  lastError?: string | null;
  detail?: string;
  yx75r?: unknown;
};

export type FieldAlarmStatus = {
  active: boolean;
  silenced: boolean;
  state: "active" | "under_review" | "normal" | string;
  activeCount: number;
  ackedCount: number;
  latestAlert: AlertSummaryItem | null;
  alerts: AlertSummaryItem[];
  actuator: FieldAlarmActuatorStatus;
};

export type FieldAlarmAction = "alarm_on" | "alarm_off" | "silence" | "status" | "ack" | "resolve";

export type FieldAlarmActionResult = {
  action: FieldAlarmAction;
  accepted: boolean;
  actuator: FieldAlarmActuatorStatus;
  alertEvent?: {
    alertId: string;
    eventId: string;
    eventType: "ALERT_ACK" | "ALERT_RESOLVE";
    createdAt: string;
  } | null;
};

export type TelemetrySeriesPoint = {
  ts: string;
  value: number;
};

export type DeviceHealthExpertResult = {
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
};

export type AiPredictionCalibration = {
  threshold: number | null;
  scoreOverThreshold: number | null;
  calibratedRiskLevel: AiPredictionRiskLevel | null;
  source: string | null;
};

export type AiPredictionForecast = {
  operationalRole: string | null;
  modelKey: string | null;
  modelVersion: string | null;
  artifactType: string | null;
  labelKey: string | null;
  horizonSpec: string | null;
  targetUnit: string | null;
  predictedValue: number | null;
  predictedDisplacementMm: number | null;
  explain: string | null;
  fallbackReason: string | null;
  requiredFeaturesSatisfied: boolean | null;
  missingFeatureKeys: string[];
  pointId: string | null;
};

export type AiPrediction = {
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
  payload: Record<string, unknown>;
  riskCalibration: AiPredictionCalibration | null;
  forecastInference: AiPredictionForecast | null;
  createdAt: string;
};

export type AiPredictionListResponse = {
  page: number;
  pageSize: number;
  total: number;
  list: AiPrediction[];
};

export type GpsPoint = {
  ts: string;
  dispMm: number;
  horizontalMm?: number | null;
  verticalMm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type GpsSeries = {
  deviceId: string;
  deviceName: string;
  points: GpsPoint[];
};

export type GpsDerivedAnalysis = {
  deviceId: string;
  hasBaseline: boolean;
  qualityScore: number;
  trendDiagnostics?: {
    direction: "stable" | "increasing" | "decreasing";
    changeMm: number;
    slopeMmPerHour: number;
    durationHours: number;
    regressionFitR2: number;
    accelerationMmPerHour2: number;
    averageStepMm: number;
    volatilityMm: number;
    sampleIntervalSeconds: number;
  };
  ceemd?: {
    imfs: number[][];
    residue: number[];
    energyDistribution: number[];
    dominantFrequencies: number[];
    qualityScore: number;
    reconstructionError: number;
    orthogonality: number;
  };
  prediction?: {
    confidence: number;
    shortTerm: number[];
    longTerm: number[];
    thresholdForecast?: {
      thresholdsMm: {
        blue: number;
        yellow: number;
        red: number;
      };
      shortTerm: Record<
        "blue" | "yellow" | "red",
        {
          breached: boolean;
          firstIndex: number | null;
          firstValue: number | null;
          etaHours: number | null;
          etaDays: number | null;
          firstTimestamp: string | null;
        }
      >;
      longTerm: Record<
        "blue" | "yellow" | "red",
        {
          breached: boolean;
          firstIndex: number | null;
          firstValue: number | null;
          etaHours: number | null;
          etaDays: number | null;
          firstTimestamp: string | null;
        }
      >;
    };
    confidenceIntervals?: {
      shortTermLower: number[];
      shortTermUpper: number[];
      longTermLower: number[];
      longTermUpper: number[];
    };
  };
};

export type BaselineStatus = "active" | "missing" | "draft";

export type Baseline = {
  deviceId: string;
  deviceName: string;
  baselineLat: number;
  baselineLng: number;
  baselineAlt?: number;
  establishedBy: string;
  establishedTime: string;
  status: BaselineStatus;
  notes?: string;
};

export type HealthState = "healthy" | "degraded" | "not_configured" | "unknown";

export type FieldEdgeRuntimeSummary = {
  overallLevel: string | null;
  score: number | null;
  deferredNodeIds: string[];
  networkMode: string | null;
  serialOpen: boolean | null;
  mqttConnected: boolean | null;
  portStatus: string | null;
  spoolPending: number | null;
  rejectedMessages: number | null;
  lastPublishedAgeSeconds: number | null;
};

export type FieldEdgeNodeStatus = {
  fieldNodeId: string;
  deviceId: string;
  installLabel: string;
  enabled: boolean | null;
  deferred: boolean;
  status: string;
  telemetryMessages: number | null;
  commandForwards: number | null;
  ackPublishes: number | null;
  lastTelemetryAgeSeconds: number | null;
  lastAckAgeSeconds: number | null;
};

export type FieldEdgeSoakSummary = {
  generatedAt: string | null;
  accepted: boolean | null;
  currentBoundary: string | null;
  cleanWindowRounds: number | null;
  allAcked: boolean | null;
  maxBoardObservationSchemaRejectedDelta: number | null;
};

export type FieldEdgeStatus = {
  available: boolean;
  stale: boolean;
  detail: string;
  source: "rk3568_field_link_monitor";
  generatedAt: string | null;
  currentBoundary: string | null;
  accepted: boolean | null;
  summary: FieldEdgeRuntimeSummary | null;
  nodes: FieldEdgeNodeStatus[];
  soak: FieldEdgeSoakSummary | null;
};

export type HermesEdgeStressSummary = {
  totalRequests: number | null;
  errorRate: number | null;
  throughputRps: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  recheckOk: number | null;
};

export type HermesEdgeVolatilityDimension = {
  key: string;
  label: string;
  unit: string;
};

export type HermesEdgeVolatilityPoint = {
  horizonMinutes: number;
  dimensionKey: string;
  volatilityScore: number;
  confidence: number | null;
  diagnosisType: string | null;
  driver: string;
};

export type HermesEdgeVolatilitySurface = {
  generatedAt: string | null;
  surfaceType: "edge_health_volatility_surface";
  method: string;
  horizonsMinutes: number[];
  dimensions: HermesEdgeVolatilityDimension[];
  points: HermesEdgeVolatilityPoint[];
  peakScore: number | null;
  peakDimensionKey: string | null;
  peakHorizonMinutes: number | null;
  modelConfidence: number | null;
  note: string;
};

export type HermesEdgeStatus = {
  available: boolean;
  stale: boolean;
  detail: string;
  source: "rk3568_hermes_edge_supervisor";
  generatedAt: string | null;
  boardHost: string | null;
  serviceActive: boolean | null;
  serviceEnabled: boolean | null;
  accepted: boolean | null;
  currentBoundary: string | null;
  modelLoaded: boolean | null;
  modelKey: string | null;
  modelVersion: string | null;
  modelType: string | null;
  modelTask: string | null;
  featureCount: number | null;
  aiModelCount: number | null;
  diagnosisType: string | null;
  confidence: number | null;
  confidenceLevel: string | null;
  naturalLanguageReady: boolean | null;
  intentCount: number | null;
  actionRecheckAccepted: boolean | null;
  actionRecheckStatus: string | null;
  safetyGatewayCoreTouched: boolean | null;
  safetySerialTouched: boolean | null;
  safetyMqttTouched: boolean | null;
  stress: HermesEdgeStressSummary | null;
  volatilitySurface: HermesEdgeVolatilitySurface | null;
};

export type SystemConfigItem = {
  key: string;
  value: string;
  type: string;
  description: string;
  updatedAt?: string;
};

export type CommandSuccessNotificationPolicyConfig = {
  systemDefault: Exclude<SuccessNotificationPolicy, "inherit">;
  commandTypeDefaults: Record<string, Exclude<SuccessNotificationPolicy, "inherit">>;
};

export type OperationLogRow = {
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
};

export type OperationLogsResponse = {
  page: number;
  pageSize: number;
  total: number;
  list: OperationLogRow[];
};

export type PendingObservation = {
  deviceId: string;
  runtimeName: string;
  displayName: string;
  stationCode: string | null;
  installLabel: string | null;
  fieldNodeId: string | null;
  nodeCodeHint: string | null;
  gatewayCode: string | null;
  regionCode: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeq: number | null;
  observationSource: "registry_incomplete" | "runtime_observed_only";
  reason: string;
  sampleMetrics: {
    temperatureC: number | null;
    humidityPct: number | null;
    batteryPct: number | null;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    warningFlag: boolean | null;
  };
  status: OnlineStatus;
};

export type OnboardingWorkbenchSummary = {
  pendingCount: number;
  formalCount: number;
  pendingCommissioningCount: number;
  auditCount: number;
};

export type OnboardingWorkbench = {
  summary: OnboardingWorkbenchSummary;
  stations: Station[];
  formalDevices: Device[];
  pendingObservations: PendingObservation[];
  baselines: Baseline[];
  audits: OperationLogRow[];
};

export type SystemStatus = {
  source: "mock_summary" | "health_summary";
  note: string;
  items: Array<{
    key: "postgres" | "clickhouse" | "kafka";
    label: string;
    status: HealthState;
    detail: string;
  }>;
  fieldEdge?: FieldEdgeStatus;
  hermesEdge?: HermesEdgeStatus;
};

export type ApiClient = {
  auth: {
    login: (
      input: { username: string; password: string } | { mobile: string; code: string }
    ) => Promise<{
      token: string;
      refreshToken?: string;
      user: User;
    }>;
    logout: () => Promise<void>;
    me: () => Promise<AccountUser>;
    changePassword: (input: { oldPassword: string; newPassword: string }) => Promise<void>;
  };
  accounts: {
    listRoles: () => Promise<AccountRole[]>;
    listUsers: (input?: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      status?: UserStatus;
      roleId?: string;
    }) => Promise<AccountUserListResponse>;
    createUser: (input: CreateAccountUserInput) => Promise<{ userId: string }>;
    updateUser: (input: UpdateAccountUserInput) => Promise<{ userId: string; updatedAt: string }>;
    deleteUser: (input: { userId: string }) => Promise<void>;
    resetPassword: (input: { userId: string }) => Promise<ResetAccountPasswordResult>;
  };
  dashboard: {
    getSummary: () => Promise<DashboardSummary>;
    getWeeklyTrend: () => Promise<WeeklyTrend>;
  };
  stations: {
    list: () => Promise<Station[]>;
    listManagement: () => Promise<StationManagementStation[]>;
    updateManagement: (input: {
      stationId: string;
      stationName: string;
      displayName?: string | null;
      regionCode?: string | null;
      slopeCode?: string | null;
      lifecycleStatus?: string | null;
      locationName: string;
      description: string;
      chartLegendName: string;
      riskLevel: RiskLevel;
      status: OnlineStatus;
      sensorTypes: DeviceType[];
    }) => Promise<{ stationId: string; updatedAt?: string }>;
    updateLegendNames: (input: { legends: Record<string, string> }) => Promise<{ updated: number }>;
  };
  devices: {
    list: (input?: { stationId?: string }) => Promise<Device[]>;
    getState: (input: { deviceId: string }) => Promise<DeviceStateSnapshot>;
    revoke: (input: {
      deviceId: string;
    }) => Promise<{ deviceId: string; status: "revoked"; revokedAt: string }>;
    issueCommand: (input: {
      deviceId: string;
      commandType: string;
      payload: Record<string, unknown>;
      notifyOnAck?: boolean;
      successNotificationPolicy?: SuccessNotificationPolicy;
    }) => Promise<{
      commandId: string;
      status: DeviceCommandStatus;
      notifyOnAck: boolean;
      successNotificationPolicy: SuccessNotificationPolicy;
      effectiveSuccessNotificationPolicy: EffectiveSuccessNotificationPolicy;
    }>;
    listCommands: (input: { deviceId: string }) => Promise<DeviceCommand[]>;
    getHealthExpert: (input: {
      deviceId: string;
      metric?: "all" | "battery" | "health" | "signal";
    }) => Promise<DeviceHealthExpertResult>;
  };
  telemetry: {
    getSeries: (input: {
      deviceId: string;
      sensorKey: string;
      startTime: string;
      endTime: string;
      interval?: "raw" | "1m" | "5m" | "1h" | "1d";
    }) => Promise<TelemetrySeriesPoint[]>;
  };
  aiPredictions: {
    list: (input?: {
      page?: number;
      pageSize?: number;
      deviceId?: string;
      stationId?: string;
      modelKey?: string;
      riskLevel?: AiPredictionRiskLevel;
    }) => Promise<AiPredictionListResponse>;
  };
  alerts: {
    list: (input?: {
      page?: number;
      pageSize?: number;
      deviceId?: string;
      stationId?: string;
      severity?: AlertSeverity;
      status?: AlertStatus;
    }) => Promise<{
      list: AlertSummaryItem[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
      summary: { active: number; acked: number; resolved: number; high: number; critical: number };
    }>;
  };
  fieldAlarm: {
    getStatus: () => Promise<FieldAlarmStatus>;
    sendAction: (input: {
      action: FieldAlarmAction;
      reason?: string;
      alertId?: string;
    }) => Promise<FieldAlarmActionResult>;
  };
  gps: {
    getSeries: (input: { deviceId: string; days?: number }) => Promise<GpsSeries>;
    getDerivedAnalysis: (input: {
      deviceId: string;
      rangeLabel?: string;
      limit?: number;
    }) => Promise<GpsDerivedAnalysis>;
  };
  baselines: {
    list: () => Promise<Baseline[]>;
    upsert: (
      input: Omit<Baseline, "deviceName" | "establishedTime"> & {
        establishedTime?: string;
        persist?: boolean;
      }
    ) => Promise<Baseline>;
    remove: (input: { deviceId: string }) => Promise<void>;
    autoEstablish: (input: { deviceId: string; persist?: boolean }) => Promise<Baseline>;
  };
  system: {
    getStatus: () => Promise<SystemStatus>;
    getConfigs: () => Promise<SystemConfigItem[]>;
    updateConfigs: (input: {
      configs: Array<{ key: string; value: string }>;
    }) => Promise<{ updated: number }>;
    getCommandSuccessNotificationPolicy: () => Promise<CommandSuccessNotificationPolicyConfig>;
    updateCommandSuccessNotificationPolicy: (
      input: CommandSuccessNotificationPolicyConfig
    ) => Promise<CommandSuccessNotificationPolicyConfig>;
    getOperationLogs: (input: {
      page: number;
      pageSize: number;
      module?: string;
      action?: string;
      startTime: string;
      endTime: string;
    }) => Promise<OperationLogsResponse>;
  };
  onboarding: {
    getWorkbench: () => Promise<OnboardingWorkbench>;
    bindPendingDevice: (input: {
      deviceId: string;
      stationId?: string;
      newStation?: {
        stationCode: string;
        stationName: string;
        displayName?: string;
        regionCode?: string;
        slopeCode?: string;
        locationName?: string;
        riskLevel?: RiskLevel;
        lifecycleStatus?: string;
        latitude?: number;
        longitude?: number;
        altitude?: number;
        gatewayCode?: string;
      };
      deviceName: string;
      displayName: string;
      installLabel: string;
      nodeCode: string;
      gatewayCode?: string;
      deviceRole?: string;
      lifecycleStatus?: string;
    }) => Promise<{
      deviceId: string;
      stationId: string | null;
      createdStationId?: string | null;
      createdDevice?: boolean;
      updatedAt: string;
    }>;
    confirmCommissioning: (input: {
      deviceId: string;
      lifecycleStatus?: string;
    }) => Promise<{ deviceId: string; updatedAt: string }>;
  };
};
