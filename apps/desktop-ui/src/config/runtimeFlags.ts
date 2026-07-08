function readEnvFlag(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readEnvString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export const operatorDebugFeaturesEnabled =
  import.meta.env.DEV || readEnvFlag(import.meta.env.VITE_ENABLE_OPERATOR_DEBUG);

export const forceMockApiEnabled =
  operatorDebugFeaturesEnabled && readEnvFlag(import.meta.env.VITE_FORCE_MOCK_API);

export const mobileLoginEnabled =
  operatorDebugFeaturesEnabled || readEnvFlag(import.meta.env.VITE_ENABLE_MOBILE_LOGIN);

export const productionDefaultApiBaseUrl =
  readEnvString(import.meta.env.VITE_DEFAULT_API_BASE_URL) ?? "http://127.0.0.1:8080";
