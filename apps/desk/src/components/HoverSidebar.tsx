import { Layout, Menu } from "antd";
import {
  BarChartOutlined,
  DesktopOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuUnfoldOutlined,
  RadarChartOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./hoverSidebar.css";

const { Sider } = Layout;

type MenuKey = "home" | "analysis" | "device-management" | "gps-monitoring" | "system" | "accounts" | "settings";

type HoverSidebarProps = {
  userName?: string | null;
  onLogout?: () => void;
};

function keyFromPath(pathname: string): MenuKey {
  if (pathname.startsWith("/app/home")) return "home";
  if (pathname.startsWith("/app/analysis")) return "analysis";
  if (pathname.startsWith("/app/device-management")) return "device-management";
  if (pathname.startsWith("/app/gps-monitoring")) return "gps-monitoring";
  if (pathname.startsWith("/app/system")) return "system";
  if (pathname.startsWith("/app/accounts")) return "accounts";
  if (pathname.startsWith("/app/settings")) return "settings";
  return "home";
}

export function HoverSidebar({ userName, onLogout }: HoverSidebarProps) {
  const [hovering, setHovering] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = useMemo(() => keyFromPath(location.pathname), [location.pathname]);
  const displayName = userName?.trim() || "未登录";

  return (
    <div
      className={`desk-hover-sidebar ${hovering ? "is-expanded" : ""}`}
      onMouseEnter={() => {
        setHovering(true);
      }}
      onMouseLeave={() => {
        setHovering(false);
      }}
    >
      <Sider
        theme="dark"
        collapsible
        collapsed={!hovering}
        trigger={null}
        width={200}
        collapsedWidth={56}
        className="desk-hover-sider"
        style={{
          backgroundColor: "#001529",
          borderRight: "4px solid rgba(0, 255, 255, 0.10)"
        }}
      >
        <div
          className="desk-hover-sider-head"
          style={{
            borderBottom: "4px solid rgba(0, 255, 255, 0.10)"
          }}
        >
          <MenuUnfoldOutlined className="desk-hover-sider-head-icon" />
          <span className="desk-hover-sider-head-label">菜单导航</span>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => {
            if (key === "home") navigate("/app/home");
            if (key === "analysis") navigate("/app/analysis");
            if (key === "device-management") navigate("/app/device-management");
            if (key === "gps-monitoring") navigate("/app/gps-monitoring");
            if (key === "system") navigate("/app/system");
            if (key === "accounts") navigate("/app/accounts");
            if (key === "settings") navigate("/app/settings");
          }}
          items={[
            { key: "home", icon: <HomeOutlined />, label: "首页" },
            { key: "analysis", icon: <BarChartOutlined />, label: "数据分析" },
            { key: "device-management", icon: <DesktopOutlined />, label: "设备管理" },
            { key: "gps-monitoring", icon: <EnvironmentOutlined />, label: "地质形变监测" },
            { key: "system", icon: <RadarChartOutlined />, label: "系统监控" },
            { key: "accounts", icon: <TeamOutlined />, label: "账号管理" },
            { key: "settings", icon: <SettingOutlined />, label: "系统设置" }
          ]}
        />

        <div className="desk-hover-userbar">
          <div className="desk-hover-user" title={displayName}>
            <UserOutlined className="desk-hover-user-icon" />
            <div className="desk-hover-user-meta">
              <div className="desk-hover-user-name">{displayName}</div>
              <div className="desk-hover-user-role">本地工作台</div>
            </div>
          </div>
          <button
            type="button"
            className="desk-hover-logout"
            title="退出登录"
            aria-label="退出登录"
            onClick={(event) => {
              event.stopPropagation();
              onLogout?.();
            }}
          >
            <LogoutOutlined />
            <span className="desk-hover-logout-label">退出登录</span>
          </button>
        </div>
      </Sider>
    </div>
  );
}
