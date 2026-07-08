type TransportOptions = {
  baseUrl: string;
  getToken?: () => string | null;
  getRefreshToken?: () => string | null;
  onAuthTokens?: (input: { token: string; refreshToken?: string }) => void;
  onAuthFailure?: () => void;
};

type ApiSuccessResponse<T> = {
  success: true;
  code: number;
  message: string;
  data: T;
  timestamp: string;
  traceId: string;
};

type LegacySuccessResponse<T> = {
  success: true;
  data: T;
  message?: string;
  timestamp?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function pickErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (!isObject(payload)) return fallback;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message) return message;
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  if (error) return error;
  return fallback;
}

export function createHttpTransport(options: TransportOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const getToken = options.getToken ?? (() => null);
  const getRefreshToken = options.getRefreshToken ?? (() => null);
  const onAuthTokens = options.onAuthTokens;
  const onAuthFailure = options.onAuthFailure;
  let refreshPromise: Promise<boolean> | null = null;

  const withAuth = (init: RequestInit = {}): RequestInit => {
    const token = getToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  };

  const withJson = (init: RequestInit = {}): RequestInit => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    return { ...init, headers };
  };

  const refreshTokensOnce = async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refreshToken })
      });
      const payload = await parseJson(res);
      if (!res.ok || !isObject(payload) || payload.success === false || !("data" in payload) || !isObject(payload.data)) {
        return false;
      }

      const nextToken = typeof payload.data.token === "string" ? payload.data.token : "";
      const nextRefreshToken = typeof payload.data.refreshToken === "string" ? payload.data.refreshToken : "";
      if (!nextToken) return false;

      onAuthTokens?.({ token: nextToken, ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}) });
      return true;
    })()
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  };

  const requestJson = async (path: string, init?: RequestInit, allowRefresh = true): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, withAuth(init));
    const payload = await parseJson(res);

    if (
      res.status === 401 &&
      allowRefresh &&
      path !== "/api/v1/auth/login" &&
      path !== "/api/v1/auth/refresh"
    ) {
      const refreshed = await refreshTokensOnce();
      if (refreshed) return requestJson(path, init, false);
      onAuthFailure?.();
    }

    if (!res.ok) {
      throw new Error(pickErrorMessage(payload, `HTTP ${String(res.status)} ${res.statusText}`));
    }

    return payload;
  };

  return {
    withJson,
    async requestV1<T>(path: string, init?: RequestInit): Promise<T> {
      const payload = await requestJson(path, init);
      if (!isObject(payload)) throw new Error("API 返回格式错误");
      if (payload.success === false) throw new Error(pickErrorMessage(payload, "API 请求失败"));
      const json = payload as ApiSuccessResponse<T>;
      return json.data;
    },
    async requestLegacy<T>(path: string, init?: RequestInit): Promise<T> {
      const payload = await requestJson(path, init);
      if (!isObject(payload)) throw new Error("API 返回格式错误");
      if (payload.success === false) throw new Error(pickErrorMessage(payload, "API 请求失败"));
      const json = payload as LegacySuccessResponse<T> | ApiSuccessResponse<T>;
      if ("data" in json) return json.data;
      throw new Error("API 返回格式错误");
    },
    async requestRaw(path: string, init?: RequestInit): Promise<unknown> {
      return requestJson(path, init);
    }
  };
}
