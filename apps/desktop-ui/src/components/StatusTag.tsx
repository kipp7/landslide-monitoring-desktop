import { Tag } from "antd";

import type { OnlineStatus } from "../api/client";

export function StatusTag(props: { value: OnlineStatus }) {
  if (props.value === "online") return <Tag color="green">在线</Tag>;
  if (props.value === "warning") return <Tag color="orange">预警</Tag>;
  return <Tag color="red">离线</Tag>;
}

