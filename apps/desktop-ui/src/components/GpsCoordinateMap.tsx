import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { memo, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

import { MapCoordinateReadout } from "./MapCoordinateReadout";

type CoordinatePoint = {
  lat: number;
  lng: number;
  label: string;
};

type GpsCoordinateMapProps = {
  reference: CoordinatePoint | null;
  latest: CoordinatePoint | null;
  latestColor: string;
};

const LEGACY_PUBLIC_TDT_KEY = "cc688e28c157fc3473807854c945f375";

function FitCoordinateBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18, animate: false });
      });
    };

    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bounds, map]);

  return null;
}

function GpsCoordinateMapComponent({ reference, latest, latestColor }: GpsCoordinateMapProps) {
  const tdtKey =
    (import.meta.env.VITE_TDT_KEY as string | undefined)?.trim() || LEGACY_PUBLIC_TDT_KEY;
  const points = useMemo(
    () => [reference, latest].filter((point): point is CoordinatePoint => point !== null),
    [latest, reference]
  );

  const bounds = useMemo<L.LatLngBoundsExpression>(() => {
    if (!points.length)
      return [
        [0, 0],
        [0, 0],
      ];
    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lng);
    const pad = 0.00025;
    return [
      [Math.min(...latitudes) - pad, Math.min(...longitudes) - pad],
      [Math.max(...latitudes) + pad, Math.max(...longitudes) + pad],
    ];
  }, [points]);

  if (!points.length) return null;

  const tdtUrl = (layer: string) =>
    `https://t{s}.tianditu.gov.cn/DataServer?T=${layer}_w&x={x}&y={y}&l={z}&tk=${tdtKey}`;
  return (
    <div className="desk-gps-location-map" aria-label="定位基线与最新坐标地图">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [28, 28] }}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        scrollWheelZoom
        doubleClickZoom
        attributionControl
        preferCanvas
      >
        <TileLayer
          url={tdtUrl("vec")}
          attribution="&copy; 天地图"
          subdomains={["0", "1", "2", "3", "4", "5", "6", "7"]}
          maxZoom={18}
          maxNativeZoom={18}
          updateWhenIdle
        />
        <TileLayer
          url={tdtUrl("cva")}
          attribution="&copy; 天地图"
          subdomains={["0", "1", "2", "3", "4", "5", "6", "7"]}
          maxZoom={18}
          maxNativeZoom={18}
          updateWhenIdle
        />
        <FitCoordinateBounds bounds={bounds} />
        <MapCoordinateReadout />
        {reference && latest ? (
          <Polyline
            positions={[
              [reference.lat, reference.lng],
              [latest.lat, latest.lng],
            ]}
            pathOptions={{ color: latestColor, weight: 2, opacity: 0.78, dashArray: "6 6" }}
          />
        ) : null}
        {reference ? (
          <CircleMarker
            center={[reference.lat, reference.lng]}
            radius={10}
            pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.35, weight: 3 }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <strong>{reference.label}</strong>
              <br />
              {reference.lat.toFixed(6)}, {reference.lng.toFixed(6)}
            </Tooltip>
          </CircleMarker>
        ) : null}
        {latest ? (
          <CircleMarker
            center={[latest.lat, latest.lng]}
            radius={6}
            pathOptions={{
              color: latestColor,
              fillColor: latestColor,
              fillOpacity: 0.94,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <strong>{latest.label}</strong>
              <br />
              {latest.lat.toFixed(6)}, {latest.lng.toFixed(6)}
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>
      <div className="desk-gps-location-legend" aria-hidden="true">
        <span>
          <i className="is-reference" />
          基线
        </span>
        <span>
          <i style={{ background: latestColor }} />
          最新位置
        </span>
      </div>
    </div>
  );
}

export const GpsCoordinateMap = memo(
  GpsCoordinateMapComponent,
  (previous, next) =>
    previous.reference?.lat === next.reference?.lat &&
    previous.reference?.lng === next.reference?.lng &&
    previous.reference?.label === next.reference?.label &&
    previous.latest?.lat === next.latest?.lat &&
    previous.latest?.lng === next.latest?.lng &&
    previous.latest?.label === next.latest?.label &&
    previous.latestColor === next.latestColor
);
