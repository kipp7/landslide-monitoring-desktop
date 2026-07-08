import { Card } from "antd";
import clsx from "clsx";
import type React from "react";

import "./baseCard.css";

export function BaseCard(props: {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}) {
  const titleNode = props.title ? (
    typeof props.title === "string" ? (
      <span className="desk-basecard-title">{props.title}</span>
    ) : (
      props.title
    )
  ) : undefined;

  const header = titleNode ? (
    props.extra ? (
      <div className="desk-basecard-title-row">
        {typeof props.title === "string" ? titleNode : <span className="desk-basecard-title">{titleNode}</span>}
        <div className="desk-basecard-extra">{props.extra}</div>
      </div>
    ) : (
      titleNode
    )
  ) : undefined;

  return (
    <Card
      title={header}
      variant="borderless"
      className={clsx("desk-basecard", props.className)}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(0, 255, 255, 0.12)",
        borderRadius: 12,
        boxShadow: "0 0 12px rgba(0, 255, 255, 0.08)",
        color: "#fff",
        ...props.style
      }}
      styles={{
        header: {
          padding: "8px 16px",
          fontSize: 14,
          minHeight: 32,
          borderBottom: "1px solid rgba(255, 255, 255, 0.10)"
        },
        body: {
          flex: 1,
          minHeight: 0,
          padding: 8
        }
      }}
    >
      {props.children}
    </Card>
  );
}
