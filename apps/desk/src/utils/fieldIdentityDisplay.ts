function normalizeValue(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeUpperToken(token: string): string {
  return token.trim().toUpperCase();
}

function joinReadableToken(token: string): string {
  return token
    .split(/[-_]+/)
    .filter(Boolean)
    .join(" ");
}

export function formatLifecycleStatusDisplay(value?: string | null, fallback = "—"): string {
  const raw = normalizeValue(value);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized === "commissioned") return "已投运";
  if (normalized === "maintenance") return "维护中";
  if (normalized === "inactive") return "未启用";
  if (normalized === "active") return "运行中";
  if (normalized === "rehearsal") return "演练中";
  if (normalized === "decommissioned") return "已退役";
  if (normalized === "pending_sensor_completion") return "待补齐传感器";
  if (normalized === "pending_activation") return "待启用";
  if (normalized === "pending_commissioning") return "待投运";
  if (normalized === "pending") return "待处理";
  if (normalized.startsWith("pending_")) return "待处理";
  if (normalized.includes("maintenance")) return "维护中";
  if (normalized.includes("commission")) return "已投运";
  return raw;
}

export function lifecycleStatusTagColor(value?: string | null): string | undefined {
  const normalized = normalizeValue(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "commissioned" || normalized === "active") return "green";
  if (normalized === "maintenance" || normalized.includes("maintenance")) return "orange";
  if (normalized.startsWith("pending") || normalized === "inactive") return "blue";
  if (normalized === "rehearsal") return "gold";
  if (normalized === "decommissioned") return "red";
  return "purple";
}

export function formatRegistryStatusDisplay(value?: string | null, fallback = "—"): string {
  const raw = normalizeValue(value);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized === "inactive") return "已登记";
  if (normalized === "active") return "已启用直连";
  if (normalized === "revoked") return "已停用";
  return raw;
}

export function formatRegistryStatusHint(value?: string | null, fallback = ""): string {
  const raw = normalizeValue(value);
  const normalized = raw.toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "inactive") {
    return "当前台账已登记，但未启用设备直连鉴权；是否在线请看最近上报。";
  }
  if (normalized === "active") {
    return "当前台账已允许设备直连平台；运行在线性仍以最近上报为准。";
  }
  if (normalized === "revoked") {
    return "当前设备已停用，平台会拒绝该设备接入与发布。";
  }
  return fallback || raw;
}

export function formatInstallLabelDisplay(value?: string | null, fallback = "—"): string {
  const raw = normalizeValue(value);
  if (!raw) return fallback;

  const fieldNodeMatch = /^FIELD-NODE-([A-Z0-9]+)(?:[-_](.+))?$/i.exec(raw);
  if (fieldNodeMatch) {
    const nodeCode = normalizeUpperToken(fieldNodeMatch[1] ?? "");
    const suffix = fieldNodeMatch[2] ? joinReadableToken(fieldNodeMatch[2]) : "";
    return suffix ? `现场节点 ${nodeCode} · ${suffix}` : `现场节点 ${nodeCode}`;
  }

  const fieldDemoMatch = /^FIELD-DEMO-([A-Z0-9]+)(?:[-_](.+))?$/i.exec(raw);
  if (fieldDemoMatch) {
    const nodeCode = normalizeUpperToken(fieldDemoMatch[1] ?? "");
    const suffix = fieldDemoMatch[2] ? joinReadableToken(fieldDemoMatch[2]) : "";
    return suffix ? `现场节点 ${nodeCode} · ${suffix}` : `现场节点 ${nodeCode}`;
  }

  return raw;
}

export function formatWarningFlagDisplay(value?: boolean | null, fallback = "—"): string {
  if (value == null) return fallback;
  return value ? "已触发" : "未触发";
}

export function formatDeviceRoleDisplay(value?: string | null, fallback = "—"): string {
  const raw = normalizeValue(value);
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (normalized === "field_node") return "现场节点";
  if (normalized === "field_gateway") return "现场网关";
  if (normalized === "gateway") return "网关";
  if (normalized === "center_node") return "中心节点";
  return raw;
}
