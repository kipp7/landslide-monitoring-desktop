import type { DeviceStateSnapshot } from "../api/client";

export type DeviceStateScope = "core" | "environment" | "audit";

type DeviceStateScopeSample = {
  meta: Record<string, unknown>;
  metrics: Record<string, unknown>;
  receivedAt: string | null;
};

const DISPLAY_SCOPE_ORDER: DeviceStateScope[] = ["audit", "environment", "core"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function validTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function deviceStateScopeSample(
  snapshot: DeviceStateSnapshot,
  scope: DeviceStateScope
): DeviceStateScopeSample | null {
  const samples = asRecord(snapshot.meta._scope_samples);
  const sample = asRecord(samples?.[scope]);
  if (!sample) return null;

  return {
    meta: asRecord(sample.meta) ?? {},
    metrics: asRecord(sample.metrics) ?? {},
    receivedAt: validTimestamp(sample.received_ts)
  };
}

export function deviceStateScopeMetrics(
  snapshot: DeviceStateSnapshot | null | undefined,
  scope: DeviceStateScope
): Record<string, unknown> {
  return snapshot ? deviceStateScopeSample(snapshot, scope)?.metrics ?? {} : {};
}

export function deviceStateScopeMeta(
  snapshot: DeviceStateSnapshot | null | undefined,
  scope: DeviceStateScope
): Record<string, unknown> {
  return snapshot ? deviceStateScopeSample(snapshot, scope)?.meta ?? {} : {};
}

export function deviceStateDisplayMetrics(
  snapshot: DeviceStateSnapshot | null | undefined
): Record<string, unknown> {
  if (!snapshot) return {};

  // Compact V6 samples each scope independently. Merge only for presentation;
  // freshness and alarm decisions must continue to use their explicit scope.
  const scopedMetrics = DISPLAY_SCOPE_ORDER.reduce<Record<string, unknown>>(
    (metrics, scope) => Object.assign(metrics, deviceStateScopeMetrics(snapshot, scope)),
    {}
  );
  return Object.assign(scopedMetrics, snapshot.metrics);
}

export function deviceStateDisplayMeta(
  snapshot: DeviceStateSnapshot | null | undefined
): Record<string, unknown> {
  if (!snapshot) return {};

  const scopedMeta = DISPLAY_SCOPE_ORDER.reduce<Record<string, unknown>>(
    (meta, scope) => Object.assign(meta, deviceStateScopeMeta(snapshot, scope)),
    {}
  );
  return Object.assign(scopedMeta, snapshot.meta);
}

export function deviceStateScopeUpdatedAt(
  snapshot: DeviceStateSnapshot,
  scope: DeviceStateScope
): string | null {
  const receivedAt = deviceStateScopeSample(snapshot, scope)?.receivedAt ?? null;
  if (receivedAt) return receivedAt;

  // V6 merges independently sampled scopes into one state row. Its row timestamp
  // cannot prove that a missing core/environment scope is current.
  if (Number(snapshot.meta.compact_payload_version) >= 6) return null;

  return Number.isFinite(Date.parse(snapshot.updatedAt)) ? snapshot.updatedAt : null;
}
