import { useNavigate } from "react-router-dom";

export type DeviceManagementSectionKey = "status" | "management" | "baselines" | "onboarding";

type Props = {
  active: DeviceManagementSectionKey;
};

export function DeviceManagementSectionNav(props: Props) {
  const navigate = useNavigate();

  const go = (key: DeviceManagementSectionKey) => {
    if (key === "onboarding") {
      navigate("/app/device-management/onboarding");
      return;
    }
    navigate(`/app/device-management?tab=${key}`);
  };

  return (
    <div className="desk-dm-tabs">
      <button
        type="button"
        className={`desk-dm-tabbtn ${props.active === "status" ? "active" : ""}`}
        onClick={() => go("status")}
      >
        设备状态监控
      </button>
      <button
        type="button"
        className={`desk-dm-tabbtn ${props.active === "management" ? "active" : ""}`}
        onClick={() => go("management")}
      >
        监测站管理
      </button>
      <button
        type="button"
        className={`desk-dm-tabbtn ${props.active === "baselines" ? "active" : ""}`}
        onClick={() => go("baselines")}
      >
        基线管理
      </button>
      <button
        type="button"
        className={`desk-dm-tabbtn ${props.active === "onboarding" ? "active" : ""}`}
        onClick={() => go("onboarding")}
      >
        设备接入与投运
      </button>
    </div>
  );
}
