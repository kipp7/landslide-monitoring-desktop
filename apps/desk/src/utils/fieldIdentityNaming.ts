export type FieldIdentityIssue = {
  field: string;
  message: string;
};

export type FieldIdentityExamples = {
  regionCode: string;
  slopeCode: string;
  stationCode: string;
  nodeCode: string;
  gatewayCode: string;
  installLabel: string;
};

const REGION_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+){3,}$/;
const SLOPE_CODE_PATTERN = /^LS-[A-Z0-9]+(?:-[A-Z0-9]+){3,}-\d{3}$/;
const STATION_CODE_PATTERN = /^ST-LS-[A-Z0-9]+(?:-[A-Z0-9]+){3,}-\d{3}-\d{2}$/;
const GATEWAY_CODE_PATTERN = /^GW-[A-Z0-9]+(?:-[A-Z0-9]+){3,}-\d{2}$/;
const INSTALL_LABEL_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const NODE_SUFFIX_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SLOPE_REGION_CAPTURE_PATTERN = /^LS-([A-Z0-9]+(?:-[A-Z0-9]+){3,})-\d{3}$/;
const STATION_SLOPE_CAPTURE_PATTERN = /^ST-(LS-[A-Z0-9]+(?:-[A-Z0-9]+){3,}-\d{3})-\d{2}$/;
const NODE_STATION_CAPTURE_PATTERN = /^ND-(ST-LS-[A-Z0-9]+(?:-[A-Z0-9]+){3,}-\d{3}-\d{2})-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const GATEWAY_REGION_CAPTURE_PATTERN = /^GW-([A-Z0-9]+(?:-[A-Z0-9]+){3,})-\d{2}$/;

export function normalizeCanonicalCode(value?: string | null): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeFreeText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function deriveRegionCodeFromSlopeCode(value?: string | null): string {
  const normalized = normalizeCanonicalCode(value);
  const match = normalized.match(SLOPE_REGION_CAPTURE_PATTERN);
  return match?.[1] ?? "";
}

export function deriveSlopeCodeFromStationCode(value?: string | null): string {
  const normalized = normalizeCanonicalCode(value);
  const match = normalized.match(STATION_SLOPE_CAPTURE_PATTERN);
  return match?.[1] ?? "";
}

export function deriveStationCodeFromNodeCode(value?: string | null): string {
  const normalized = normalizeCanonicalCode(value);
  const match = normalized.match(NODE_STATION_CAPTURE_PATTERN);
  return match?.[1] ?? "";
}

export function deriveRegionCodeFromGatewayCode(value?: string | null): string {
  const normalized = normalizeCanonicalCode(value);
  const match = normalized.match(GATEWAY_REGION_CAPTURE_PATTERN);
  return match?.[1] ?? "";
}

export function buildFieldIdentityExamples(input?: {
  regionCode?: string | null;
  slopeCode?: string | null;
  stationCode?: string | null;
  nodeSuffix?: string | null;
}): FieldIdentityExamples {
  const providedStationCode = normalizeCanonicalCode(input?.stationCode);
  const providedSlopeCode = normalizeCanonicalCode(input?.slopeCode);
  const derivedSlopeCode =
    providedSlopeCode || deriveSlopeCodeFromStationCode(providedStationCode);
  const regionCode =
    normalizeCanonicalCode(input?.regionCode) ||
    deriveRegionCodeFromSlopeCode(derivedSlopeCode) ||
    "CN-GX-YL-GBS";
  const slopeCode = derivedSlopeCode || `LS-${regionCode}-001`;
  const stationCode = providedStationCode || `ST-${slopeCode}-01`;
  const nodeSuffix = normalizeCanonicalCode(input?.nodeSuffix) || "A";

  return {
    regionCode,
    slopeCode,
    stationCode,
    nodeCode: `ND-${stationCode}-${nodeSuffix}`,
    gatewayCode: `GW-${regionCode}-01`,
    installLabel: `FIELD-NODE-${nodeSuffix}`,
  };
}

function pushIssue(issues: FieldIdentityIssue[], field: string, message: string): void {
  issues.push({ field, message });
}

export function validateFieldIdentityDraft(input: {
  regionCode?: string | null;
  slopeCode?: string | null;
  stationCode?: string | null;
  nodeCode?: string | null;
  gatewayCode?: string | null;
  installLabel?: string | null;
  requireRegionCode?: boolean;
  requireSlopeCode?: boolean;
  requireStationCode?: boolean;
  requireNodeCode?: boolean;
  requireGatewayCode?: boolean;
  requireInstallLabel?: boolean;
}): FieldIdentityIssue[] {
  const issues: FieldIdentityIssue[] = [];

  const regionCode = normalizeCanonicalCode(input.regionCode);
  const slopeCode = normalizeCanonicalCode(input.slopeCode);
  const stationCode = normalizeCanonicalCode(input.stationCode);
  const nodeCode = normalizeCanonicalCode(input.nodeCode);
  const gatewayCode = normalizeCanonicalCode(input.gatewayCode);
  const installLabel = normalizeCanonicalCode(input.installLabel);
  const effectiveStationCode = stationCode || deriveStationCodeFromNodeCode(nodeCode);
  const effectiveSlopeCode = slopeCode || deriveSlopeCodeFromStationCode(effectiveStationCode);
  const effectiveRegionCode =
    regionCode ||
    deriveRegionCodeFromSlopeCode(effectiveSlopeCode) ||
    deriveRegionCodeFromGatewayCode(gatewayCode);

  if (input.requireRegionCode && !regionCode) {
    pushIssue(issues, "regionCode", "区域编码不能为空");
  } else if (regionCode && !REGION_CODE_PATTERN.test(regionCode)) {
    pushIssue(issues, "regionCode", "区域编码应为大写连字符格式，例如 CN-GX-YL-GBS");
  }

  if (input.requireSlopeCode && !slopeCode) {
    pushIssue(issues, "slopeCode", "边坡编码不能为空");
  } else if (slopeCode && !SLOPE_CODE_PATTERN.test(slopeCode)) {
    pushIssue(
      issues,
      "slopeCode",
      "边坡编码应符合 LS-<区域编码>-<三位序号>，例如 LS-CN-GX-YL-GBS-001"
    );
  } else if (effectiveRegionCode && slopeCode && !slopeCode.startsWith(`LS-${effectiveRegionCode}-`)) {
    pushIssue(issues, "slopeCode", "边坡编码必须归属于当前区域编码");
  }

  if (input.requireStationCode && !stationCode) {
    pushIssue(issues, "stationCode", "站点编码不能为空");
  } else if (stationCode && !STATION_CODE_PATTERN.test(stationCode)) {
    pushIssue(
      issues,
      "stationCode",
      "站点编码应符合 ST-<边坡编码>-<两位序号>，例如 ST-LS-CN-GX-YL-GBS-001-01"
    );
  } else if (
    effectiveSlopeCode &&
    stationCode &&
    !stationCode.startsWith(`ST-${effectiveSlopeCode}-`)
  ) {
    pushIssue(issues, "stationCode", "站点编码必须归属于当前边坡编码");
  }

  if (input.requireGatewayCode && !gatewayCode) {
    pushIssue(issues, "gatewayCode", "网关编码不能为空");
  } else if (gatewayCode && !GATEWAY_CODE_PATTERN.test(gatewayCode)) {
    pushIssue(
      issues,
      "gatewayCode",
      "网关编码应符合 GW-<区域编码>-<两位序号>，例如 GW-CN-GX-YL-GBS-01"
    );
  } else if (
    effectiveRegionCode &&
    gatewayCode &&
    !gatewayCode.startsWith(`GW-${effectiveRegionCode}-`)
  ) {
    pushIssue(issues, "gatewayCode", "网关编码必须归属于当前区域编码");
  }

  if (input.requireInstallLabel && !installLabel) {
    pushIssue(issues, "installLabel", "安装标识不能为空");
  } else if (installLabel && !INSTALL_LABEL_PATTERN.test(installLabel)) {
    pushIssue(issues, "installLabel", "安装标识只允许大写字母、数字和连字符，例如 FIELD-NODE-A");
  }

  if (input.requireNodeCode && !nodeCode) {
    pushIssue(issues, "nodeCode", "节点编码不能为空");
  } else if (nodeCode) {
    if (effectiveStationCode) {
      const nodePrefix = `ND-${effectiveStationCode}-`;
      if (!nodeCode.startsWith(nodePrefix)) {
        pushIssue(issues, "nodeCode", `节点编码必须以 ${nodePrefix} 开头`);
      } else {
        const suffix = nodeCode.slice(nodePrefix.length);
        if (!suffix) {
          pushIssue(issues, "nodeCode", "节点编码缺少节点角色后缀，例如 A、B、C 或 GNSS");
        } else if (!NODE_SUFFIX_PATTERN.test(suffix)) {
          pushIssue(issues, "nodeCode", "节点编码后缀只允许大写字母、数字和连字符");
        }
      }
    } else if (!NODE_STATION_CAPTURE_PATTERN.test(nodeCode)) {
      pushIssue(
        issues,
        "nodeCode",
        "节点编码应符合 ND-<站点编码>-<节点角色>，例如 ND-ST-LS-CN-GX-YL-GBS-001-01-A"
      );
    }
  }

  return issues;
}
