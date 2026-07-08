import { Typography } from "antd";

import { BaselinesPanel } from "./BaselinesPanel";

export function BaselinesPage() {
  return (
    <div className="desk-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226,232,240,0.96)" }}>
            基线管理
          </Typography.Title>
          <Typography.Text type="secondary">GNSS 基线管理与校验</Typography.Text>
        </div>
      </div>

      <BaselinesPanel style={{ height: "calc(100vh - 132px)" }} />
    </div>
  );
}
