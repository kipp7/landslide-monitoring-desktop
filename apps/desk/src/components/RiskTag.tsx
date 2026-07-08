import { Tag } from "antd";

import type { RiskLevel } from "../api/client";

export function RiskTag(props: { value: RiskLevel }) {
  if (props.value === "high") return <Tag color="red">高</Tag>;
  if (props.value === "mid") return <Tag color="orange">中</Tag>;
  return <Tag color="green">低</Tag>;
}

