import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ApiMode } from "../api/client";
import { productionDefaultApiBaseUrl } from "../config/runtimeFlags";

export const DEFAULT_HTTP_API_BASE_URL = productionDefaultApiBaseUrl;

const LEGACY_LOCAL_API_BASE_URLS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:8081",
  "http://localhost:8081"
]);

export function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

export function isLegacyLocalApiBaseUrl(value: unknown): boolean {
  const normalized = normalizeApiBaseUrl(value);
  return normalized.length > 0 && LEGACY_LOCAL_API_BASE_URLS.has(normalized);
}

export type TerrainQuality = "auto" | "high" | "medium" | "low";

type SettingsState = {
  apiMode: ApiMode;
  apiBaseUrl: string;
  mockDelayMs: number;
  mockFailureRate: number;
  terrainQuality: TerrainQuality;
  reducedMotion: boolean;
  trayEnabled: boolean;
  sessionApiModeOverride: ApiMode | null;
  setApiMode: (mode: ApiMode) => void;
  setApiBaseUrl: (url: string) => void;
  setMockDelayMs: (ms: number) => void;
  setMockFailureRate: (rate: number) => void;
  setTerrainQuality: (quality: TerrainQuality) => void;
  setReducedMotion: (enabled: boolean) => void;
  setTrayEnabled: (enabled: boolean) => void;
  setSessionApiModeOverride: (mode: ApiMode | null) => void;
  reset: () => void;
};

const defaults: Pick<
  SettingsState,
  | "apiMode"
  | "apiBaseUrl"
  | "mockDelayMs"
  | "mockFailureRate"
  | "terrainQuality"
  | "reducedMotion"
  | "trayEnabled"
  | "sessionApiModeOverride"
> = {
  apiMode: "http",
  apiBaseUrl: DEFAULT_HTTP_API_BASE_URL,
  mockDelayMs: 200,
  mockFailureRate: 0,
  terrainQuality: "auto",
  reducedMotion: false,
  trayEnabled: true,
  sessionApiModeOverride: null
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setApiMode: (apiMode) => {
        set({ apiMode });
      },
      setApiBaseUrl: (apiBaseUrl) => {
        set({ apiBaseUrl });
      },
      setMockDelayMs: (mockDelayMs) => {
        set({ mockDelayMs });
      },
      setMockFailureRate: (mockFailureRate) => {
        set({ mockFailureRate });
      },
      setTerrainQuality: (terrainQuality) => {
        set({ terrainQuality });
      },
      setReducedMotion: (reducedMotion) => {
        set({ reducedMotion });
      },
      setTrayEnabled: (trayEnabled) => {
        set({ trayEnabled });
      },
      setSessionApiModeOverride: (sessionApiModeOverride) => {
        set({ sessionApiModeOverride });
      },
      reset: () => {
        set({ ...defaults });
      }
    }),
    {
      name: "desk_settings_v1",
      version: 6,
      partialize: (state) => ({
        apiMode: state.apiMode,
        apiBaseUrl: state.apiBaseUrl,
        mockDelayMs: state.mockDelayMs,
        mockFailureRate: state.mockFailureRate,
        terrainQuality: state.terrainQuality,
        reducedMotion: state.reducedMotion,
        trayEnabled: state.trayEnabled
      }),
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<SettingsState>;
        const merged = { ...defaults, ...state } as SettingsState;
        const normalizedApiBaseUrl = normalizeApiBaseUrl(merged.apiBaseUrl);

        if (version < 6) {
          merged.apiMode = "http";
        }

        if (!normalizedApiBaseUrl || (version < 5 && isLegacyLocalApiBaseUrl(normalizedApiBaseUrl))) {
          merged.apiMode = "http";
          merged.apiBaseUrl = DEFAULT_HTTP_API_BASE_URL;
          return merged;
        }

        merged.apiBaseUrl = normalizedApiBaseUrl;
        return merged;
      }
    }
  )
);
