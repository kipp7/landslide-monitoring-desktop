import L from "leaflet";
import { useEffect, useState } from "react";
import { CircleMarker, useMapEvents } from "react-leaflet";

import "./mapCoordinateReadout.css";

type MapCoordinate = {
  lat: number;
  lng: number;
};

export function MapCoordinateReadout() {
  const [hovered, setHovered] = useState<MapCoordinate | null>(null);
  const [selected, setSelected] = useState<MapCoordinate | null>(null);
  const [center, setCenter] = useState<MapCoordinate | null>(null);
  const map = useMapEvents({
    mousemove: (event) => {
      if (!selected) setHovered({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
    mouseout: () => {
      setHovered(null);
    },
    click: (event) => {
      setSelected({ lat: event.latlng.lat, lng: event.latlng.lng });
      setHovered(null);
    },
    moveend: (event) => {
      const next = event.target.getCenter() as L.LatLng;
      setCenter({ lat: next.lat, lng: next.lng });
    }
  });

  useEffect(() => {
    const initial = map.getCenter();
    setCenter({ lat: initial.lat, lng: initial.lng });
  }, [map]);

  const coordinate = selected ?? hovered ?? center;
  if (!coordinate) return null;

  return (
    <>
      {selected ? (
        <CircleMarker
          center={[selected.lat, selected.lng]}
          radius={5}
          interactive={false}
          pathOptions={{
            color: "#ffffff",
            fillColor: "#06b6d4",
            fillOpacity: 1,
            weight: 2
          }}
        />
      ) : null}
      <div className="desk-map-coordinate-readout" aria-label="地图选点经纬度">
        <span className="desk-map-coordinate-state">{selected ? "选定点" : hovered ? "指针" : "地图中心"}</span>
        <span>
          经度 <strong>{coordinate.lng.toFixed(9)}</strong>
        </span>
        <span>
          纬度 <strong>{coordinate.lat.toFixed(9)}</strong>
        </span>
      </div>
    </>
  );
}
