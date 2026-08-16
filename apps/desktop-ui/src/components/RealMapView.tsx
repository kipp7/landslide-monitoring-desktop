import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

import type { Station } from "../api/client";
import { DEFAULT_MONITORING_LOCATION } from "../utils/defaultMonitoringLocation";
import { MapCoordinateReadout } from "./MapCoordinateReadout";

type BaseLayer = "2D" | "卫星图";

const LEGACY_PUBLIC_TDT_KEY = "cc688e28c157fc3473807854c945f375";

export type StationMapMetrics = {
  deviceOnline: number;
  deviceWarn: number;
  deviceOffline: number;
  lastSeenAt?: string;
  types?: Partial<Record<"gnss" | "rain" | "tilt" | "temp_hum" | "camera", number>>;
};

export type RealMapPoint = {
  id: string;
  stationId: string;
  name: string;
  stationName: string;
  risk: Station["risk"];
  status: Station["status"];
  lat: number;
  lng: number;
  locationSource: "gps" | "default" | "station";
  lastSeenAt?: string;
  deviceCount?: number;
};

type RealMapViewProps = {
  layer: BaseLayer;
  stations: Station[];
  points?: RealMapPoint[];
  selectedStationIds: string[];
  onSelectStationIds: (ids: string[]) => void;
  resetKey?: number;
  scopeKey?: string;
  metricsByStationId?: Record<string, StationMapMetrics | undefined>;
};

function riskText(risk: Station["risk"]) {
  if (risk === "high") return "高风险";
  if (risk === "mid") return "中风险";
  return "低风险";
}

function statusText(status: Station["status"]) {
  if (status === "online") return "在线";
  if (status === "warning") return "预警";
  return "离线";
}

function riskClass(risk: Station["risk"]) {
  if (risk === "high") return "is-high";
  if (risk === "mid") return "is-mid";
  return "is-low";
}

function MaintainInitialGpsViewport(props: {
  resetKey: number | undefined;
  scopeKey?: string;
  bounds: L.LatLngBoundsExpression;
  hasGpsLocations: boolean;
}) {
  const map = useMap();
  const appliedResetKeyRef = useRef(props.resetKey);
  const appliedScopeKeyRef = useRef(props.scopeKey);
  const waitForInitialGpsRef = useRef(!props.hasGpsLocations);
  const userAdjustedViewRef = useRef(false);

  useEffect(() => {
    const container = map.getContainer();
    const markUserAdjusted = () => {
      userAdjustedViewRef.current = true;
    };

    container.addEventListener("pointerdown", markUserAdjusted, { passive: true });
    container.addEventListener("wheel", markUserAdjusted, { passive: true });
    container.addEventListener("touchstart", markUserAdjusted, { passive: true });
    container.addEventListener("dblclick", markUserAdjusted, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", markUserAdjusted);
      container.removeEventListener("wheel", markUserAdjusted);
      container.removeEventListener("touchstart", markUserAdjusted);
      container.removeEventListener("dblclick", markUserAdjusted);
    };
  }, [map]);

  useMapEvents({
    dragstart: () => {
      userAdjustedViewRef.current = true;
    }
  });

  useEffect(() => {
    const scopeChanged = props.scopeKey !== appliedScopeKeyRef.current;
    const resetRequested = props.resetKey != null && props.resetKey !== appliedResetKeyRef.current;
    if (scopeChanged || resetRequested) {
      appliedResetKeyRef.current = props.resetKey;
      appliedScopeKeyRef.current = props.scopeKey;
      userAdjustedViewRef.current = false;
      waitForInitialGpsRef.current = !props.hasGpsLocations;
      map.fitBounds(props.bounds, { padding: [24, 24] });
      return;
    }

    // The initial default view may follow the first valid GPS fix once. User operations own the view afterwards.
    if (!waitForInitialGpsRef.current || userAdjustedViewRef.current || !props.hasGpsLocations) return;
    waitForInitialGpsRef.current = false;
    map.fitBounds(props.bounds, { padding: [24, 24], animate: false });
  }, [map, props.bounds, props.hasGpsLocations, props.resetKey, props.scopeKey]);

  return null;
}

function ResizeAndInvalidateSize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;

    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
      });
    };

    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    window.addEventListener("resize", refresh);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", refresh);
    };
  }, [map]);

  return null;
}

function RemoveLeafletAttributionPrefix() {
  const map = useMap();
  useEffect(() => {
    if (!map.attributionControl) return;
    map.attributionControl.setPrefix(false);
  }, [map]);
  return null;
}

function ClearSelectionOnMapClick(props: { onClear: () => void }) {
  useMapEvents({
    click: (e) => {
      const target = e.originalEvent?.target as Element | null | undefined;
      if (target?.closest?.(".leaflet-marker-icon") || target?.closest?.(".leaflet-tooltip")) return;
      if (e.originalEvent?.defaultPrevented) return;
      props.onClear();
    }
  });
  return null;
}

export function RealMapView(props: RealMapViewProps) {
  const configuredTdtKey = (import.meta.env.VITE_TDT_KEY as string | undefined)?.trim();
  const tdtKey = configuredTdtKey || LEGACY_PUBLIC_TDT_KEY;
  const useTdt = Boolean(tdtKey);
  const defaultLat = DEFAULT_MONITORING_LOCATION.lat;
  const defaultLng = DEFAULT_MONITORING_LOCATION.lng;

  const points = useMemo<RealMapPoint[]>(
    () =>
      props.points ??
      props.stations.map((station) => ({
        id: station.id,
        stationId: station.id,
        name: station.name,
        stationName: station.name,
        risk: station.risk,
        status: station.status,
        lat: station.lat,
        lng: station.lng,
        locationSource: "station",
        deviceCount: station.deviceCount
      })),
    [props.points, props.stations]
  );
  const hasGpsLocations = points.some((point) => point.locationSource === "gps");

  const icons = useMemo(() => {
    const byId = new Map<string, L.DivIcon>();

    for (const point of points) {
      const isSelected = props.selectedStationIds.includes(point.stationId);
      const cls = `${riskClass(point.risk)}${isSelected ? " is-selected" : ""}`;
      const count = Math.max(0, Math.round(point.deviceCount ?? 0));
      const badge = count > 0 ? `<span class="badge">${count}</span>` : "";
      const html =
        `<div class="desk-map-marker ${cls}">` +
        `<span class="halo"></span>` +
        `<span class="pulse"></span>` +
        `<span class="core"></span>` +
        badge +
        `</div>`;

      byId.set(
        point.id,
        L.divIcon({
          className: "desk-map-marker-icon",
          html,
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        })
      );
    }

    return byId;
  }, [points, props.selectedStationIds]);

  const bounds = useMemo<L.LatLngBoundsExpression>(() => {
    const validPoints = points
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      .map((point) => [point.lat, point.lng] as [number, number]);
    const gpsPoints = points
      .filter(
        (point) =>
          point.locationSource === "gps" &&
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lng)
      )
      .map((point) => [point.lat, point.lng] as [number, number]);
    // Prefer real GPS fixes. Default station coordinates remain a fallback until the first fix arrives.
    const pts = gpsPoints.length ? gpsPoints : validPoints;
    if (!pts.length) return [[defaultLat - 0.05, defaultLng - 0.06], [defaultLat + 0.05, defaultLng + 0.06]];
    const lats = pts.map((point) => point[0]);
    const lngs = pts.map((point) => point[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const usesDefaultLocations = !gpsPoints.length && points.some((point) => point.locationSource === "default");
    const latSpan = Math.max(maxLat - minLat, usesDefaultLocations ? 0.00045 : 0.018);
    const lngSpan = Math.max(maxLng - minLng, usesDefaultLocations ? 0.0006 : 0.024);
    return [
      [centerLat - latSpan / 2, centerLng - lngSpan / 2],
      [centerLat + latSpan / 2, centerLng + lngSpan / 2],
    ];
  }, [points]);

  const tdtAttribution = `&copy; 天地图`;

  const tdtBaseLayer = props.layer === "卫星图" ? "img" : "vec";
  const tdtLabelLayer = props.layer === "卫星图" ? "cia" : "cva";
  const tdtUrl = (layer: string) => `https://t{s}.tianditu.gov.cn/DataServer?T=${layer}_w&x={x}&y={y}&l={z}&tk=${tdtKey}`;

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      maxZoom={18}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
      doubleClickZoom
      scrollWheelZoom
      attributionControl
      preferCanvas
    >
      {useTdt ? (
        <>
          <TileLayer
            key={`tianditu-base-${tdtBaseLayer}`}
            url={tdtUrl(tdtBaseLayer)}
            attribution={tdtAttribution}
            subdomains={["0", "1", "2", "3", "4", "5", "6", "7"]}
            maxZoom={18}
            maxNativeZoom={18}
            updateWhenIdle
          />
          <TileLayer
            key={`tianditu-label-${tdtLabelLayer}`}
            url={tdtUrl(tdtLabelLayer)}
            attribution={tdtAttribution}
            subdomains={["0", "1", "2", "3", "4", "5", "6", "7"]}
            maxZoom={18}
            maxNativeZoom={18}
            updateWhenIdle
          />
        </>
      ) : null}
      <RemoveLeafletAttributionPrefix />
      <ResizeAndInvalidateSize />
      <MapCoordinateReadout />
      <MaintainInitialGpsViewport
        resetKey={props.resetKey}
        scopeKey={props.scopeKey ?? "scope:none"}
        bounds={bounds}
        hasGpsLocations={hasGpsLocations}
      />
      <ClearSelectionOnMapClick
        onClear={() => {
          props.onSelectStationIds([]);
        }}
      />
      {points.map((point) => {
        const icon = icons.get(point.id);
        if (!icon) return null;
        const risk = riskText(point.risk);
        const status = statusText(point.status);
        const m = props.metricsByStationId?.[point.stationId];
        const locationText =
          point.locationSource === "gps"
            ? null
            : point.locationSource === "default"
              ? `${DEFAULT_MONITORING_LOCATION.label}默认位置（等待首次有效 GPS）`
              : "站点登记位置";

        return (
          <Marker
            key={point.id}
            position={[point.lat, point.lng]}
            icon={icon}
            eventHandlers={{
              click: (e) => {
                e.originalEvent?.stopPropagation?.();
                e.originalEvent?.preventDefault?.();
                const multi =
                  Boolean(e.originalEvent && ("ctrlKey" in e.originalEvent ? (e.originalEvent as MouseEvent).ctrlKey : false)) ||
                  Boolean(e.originalEvent && ("shiftKey" in e.originalEvent ? (e.originalEvent as MouseEvent).shiftKey : false));

                if (!multi) {
                  props.onSelectStationIds([point.stationId]);
                  return;
                }

                const set = new Set(props.selectedStationIds);
                if (set.has(point.stationId)) set.delete(point.stationId);
                else set.add(point.stationId);
                props.onSelectStationIds(Array.from(set));
              }
            }}
          >
            <Tooltip className="desk-map-tooltip" direction="top" offset={[0, -12]} opacity={1} sticky>
              <div style={{ fontWeight: 900 }}>{point.name}</div>
              <div style={{ opacity: 0.9, fontSize: 12 }}>
                {risk} · {status}{locationText ? ` · ${locationText}` : ""}
              </div>
              <div style={{ opacity: 0.72, fontSize: 11 }}>{point.stationName}</div>
              {m ? (
                <div style={{ opacity: 0.9, fontSize: 12 }}>
                  在线 {m.deviceOnline} 预警 {m.deviceWarn} 离线 {m.deviceOffline}
                </div>
              ) : null}
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
