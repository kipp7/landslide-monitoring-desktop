export const DEFAULT_MONITORING_LOCATION = {
  label: "南京集成电路培训基地 3 号楼",
  lat: 32.09243722,
  lng: 118.649366293
} as const;

export type DefaultFieldNodeCode = "A" | "B" | "C";

const EARTH_RADIUS_M = 6_378_137;
const WEB_MERCATOR_METERS_PER_PIXEL_AT_EQUATOR = 156_543.03392804097;
const DEFAULT_MAP_REFERENCE_ZOOM = 18;
const DEFAULT_NODE_SPACING_PX = 34;
const FIELD_NODE_SPACING_M =
  WEB_MERCATOR_METERS_PER_PIXEL_AT_EQUATOR *
  Math.cos(DEFAULT_MONITORING_LOCATION.lat * Math.PI / 180) /
  2 ** DEFAULT_MAP_REFERENCE_ZOOM *
  DEFAULT_NODE_SPACING_PX;
const TRIANGLE_RADIUS_M = FIELD_NODE_SPACING_M / Math.sqrt(3);

const FIELD_NODE_OFFSETS_M: Record<DefaultFieldNodeCode, { east: number; north: number }> = {
  A: { east: 0, north: -TRIANGLE_RADIUS_M / 2 },
  B: { east: -FIELD_NODE_SPACING_M / 2, north: -TRIANGLE_RADIUS_M / 2 },
  C: { east: FIELD_NODE_SPACING_M / 2, north: -TRIANGLE_RADIUS_M / 2 }
};

export function resolveDefaultFieldNodeCode(identity?: string | null): DefaultFieldNodeCode | null {
  const normalized = identity?.trim().toUpperCase() ?? "";
  if (normalized === "A" || normalized.endsWith("-A") || normalized.endsWith("000000000001")) return "A";
  if (normalized === "B" || normalized.endsWith("-B") || normalized.endsWith("000000000002")) return "B";
  if (normalized === "C" || normalized.endsWith("-C") || normalized.endsWith("000000000003")) return "C";
  return null;
}

export function defaultFieldNodeLocation(identity?: string | null): { lat: number; lng: number } {
  const nodeCode = resolveDefaultFieldNodeCode(identity);
  if (!nodeCode) return DEFAULT_MONITORING_LOCATION;

  const offset = FIELD_NODE_OFFSETS_M[nodeCode];
  const centerLatRad = DEFAULT_MONITORING_LOCATION.lat * Math.PI / 180;
  const lat = DEFAULT_MONITORING_LOCATION.lat + offset.north / EARTH_RADIUS_M * 180 / Math.PI;
  const lng = DEFAULT_MONITORING_LOCATION.lng + offset.east / (EARTH_RADIUS_M * Math.cos(centerLatRad)) * 180 / Math.PI;
  return { lat, lng };
}
