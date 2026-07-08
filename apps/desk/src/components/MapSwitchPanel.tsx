import clsx from "clsx";

import "./mapSwitchPanel.css";

export type MapType = "2D" | "3D" | "卫星图" | "视频";

const mapTypes: MapType[] = ["2D", "3D", "卫星图", "视频"];

export function MapSwitchPanel(props: { selected: MapType; onSelect: (type: MapType) => void }) {
  return (
    <div className="desk-map-switch">
      {mapTypes.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => {
            props.onSelect(type);
          }}
          className={clsx("desk-map-switch-btn", props.selected === type && "is-active")}
        >
          {type}
        </button>
      ))}
    </div>
  );
}
