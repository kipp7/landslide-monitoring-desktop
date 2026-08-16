import type { AiPrediction } from "../api/client";

export type AiRouteEvidence = {
  matchedModelKey: string | null;
  matchedModelVersion: string | null;
  matchedScopeType: string | null;
  matchedScopeKey: string | null;
  matchScore: number | null;
  candidateCount: number | null;
  rerankMode: string | null;
  selectedReason: string | null;
  fallbackReason: string | null;
  requiredFeaturesSatisfied: boolean | null;
  missingFeatureKeys: string[];
  regionCode: string | null;
  slopeCode: string | null;
  stationCode: string | null;
  runAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter((item): item is string => item != null);
}

export function extractAiRouteEvidence(prediction: AiPrediction | null | undefined): AiRouteEvidence | null {
  if (!prediction) return null;

  const payload = asRecord(prediction.payload);
  const matchTrace = asRecord(payload.matchTrace);
  const traceRefs = asRecord(payload.traceRefs);
  const candidateSet = Array.isArray(matchTrace.candidateSet) ? matchTrace.candidateSet : [];

  return {
    matchedModelKey: readString(payload.matchedModelKey),
    matchedModelVersion: readString(payload.matchedModelVersion),
    matchedScopeType: readString(payload.matchedScopeType),
    matchedScopeKey: readString(payload.matchedScopeKey),
    matchScore: readNumber(payload.matchScore),
    candidateCount: readNumber(payload.candidateCount) ?? (candidateSet.length > 0 ? candidateSet.length : null),
    rerankMode: readString(matchTrace.rerankMode),
    selectedReason: readString(matchTrace.selectedReason),
    fallbackReason: readString(payload.fallbackReason) ?? prediction.forecastInference?.fallbackReason ?? null,
    requiredFeaturesSatisfied:
      readBoolean(payload.requiredFeaturesSatisfied) ?? prediction.forecastInference?.requiredFeaturesSatisfied ?? null,
    missingFeatureKeys:
      readStringArray(payload.missingFeatureKeys).length > 0
        ? readStringArray(payload.missingFeatureKeys)
        : prediction.forecastInference?.missingFeatureKeys ?? [],
    regionCode: readString(traceRefs.regionCode),
    slopeCode: readString(traceRefs.slopeCode),
    stationCode: readString(traceRefs.stationCode),
    runAt: prediction.createdAt || prediction.predictedTs
  };
}

export function regionalScopeLabel(value: string | null | undefined): string {
  if (value === "station") return "站点专家";
  if (value === "slope") return "坡体专家";
  if (value === "region") return "区域专家";
  if (value === "global") return "全局专家";
  return value || "等待路由";
}

export function regionalRerankLabel(value: string | null | undefined): string {
  if (value === "metadata-replay") return "Replay 证据重排";
  if (value === "static-prior") return "静态先验重排";
  if (value === "base-score") return "基础证据排序";
  return value || "等待重排证据";
}
