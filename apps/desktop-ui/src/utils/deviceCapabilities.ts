import type { Device } from "../api/client";

function normalize(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "";
  const values = [
    metadata.capabilities,
    metadata.sensors,
    metadata.sensorKeys,
    metadata.sensor_keys,
    metadata.deviceRole,
    metadata.device_role
  ];
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isFormalDevice(device: Device): boolean {
  return normalize(device.identityClass) === "formal";
}

export function hasGnssCapability(device: Device): boolean {
  if (device.type === "gnss") return true;

  const capabilityText = metadataText(device.metadata);
  if (/\b(gnss|gps|gps_latitude|gps_longitude)\b/.test(capabilityText)) return true;
  if (device.type !== "multi_sensor") return false;

  const identityText = [device.deviceRole, device.installLabel, device.nodeCode, device.name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return identityText.includes("field") || identityText.includes("node") || identityText.includes("分节点");
}

export function isFormalGnssDevice(device: Device): boolean {
  return isFormalDevice(device) && hasGnssCapability(device);
}
