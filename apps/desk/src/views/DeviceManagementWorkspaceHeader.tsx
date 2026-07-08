import type React from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  title: string;
  subtitle: string;
  nowTime: string;
  lastUpdateTime?: string;
  actions?: React.ReactNode;
};

export function DeviceManagementWorkspaceHeader(props: Props) {
  const navigate = useNavigate();

  return (
    <div className="desk-dm-head">
      <div className="desk-dm-head-left">
        <div className="desk-dm-titleblock">
          <div className="desk-dm-title">{props.title}</div>
          <div className="desk-dm-subtitle">{props.subtitle}</div>
        </div>

        <div className="desk-dm-nav">
          <button type="button" className="desk-dm-navbtn" onClick={() => navigate("/app/analysis")}>
            数据分析
          </button>
          <button type="button" className="desk-dm-navbtn active">
            设备管理
          </button>
          <button type="button" className="desk-dm-navbtn" onClick={() => navigate("/app/gps-monitoring")}>
            地质形变监测
          </button>
          <button type="button" className="desk-dm-navbtn" onClick={() => navigate("/app/settings")}>
            系统设置
          </button>
        </div>
      </div>

      <div className="desk-dm-head-right">
        <div className="desk-dm-time">{props.nowTime}</div>
        {props.lastUpdateTime ? <div className="desk-dm-updated">数据更新: {props.lastUpdateTime}</div> : null}
        <div className="desk-dm-actions">{props.actions}</div>
      </div>
    </div>
  );
}
