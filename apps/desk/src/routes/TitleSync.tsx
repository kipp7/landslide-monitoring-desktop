import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const APP_NAME = "山体滑坡监测预警平台";

function titleForPath(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return null;
  if (pathname === "/login") return "登录";

  if (pathname === "/app" || pathname === "/app/") return "控制台";
  if (pathname.startsWith("/app/home")) return "首页";
  if (pathname.startsWith("/app/analysis")) return "数据大屏";
  if (pathname.startsWith("/app/device-management/onboarding")) return "设备接入与投运";
  if (pathname.startsWith("/app/device-management")) return "设备管理";
  if (pathname.startsWith("/app/gps-monitoring")) return "地质形变监测";
  if (pathname.startsWith("/app/accounts")) return "账号管理";
  if (pathname.startsWith("/app/settings")) return "系统设置";

  if (pathname.startsWith("/app/stations")) return "监测站";
  if (pathname.startsWith("/app/devices")) return "设备";
  if (pathname.startsWith("/app/baselines")) return "基线管理";
  if (pathname.startsWith("/app/gps")) return "形变监测";
  if (pathname.startsWith("/app/system")) return "系统状态";

  return null;
}

export function TitleSync() {
  const location = useLocation();

  useEffect(() => {
    const subtitle = titleForPath(location.pathname);
    document.title = subtitle ? `${APP_NAME} · ${subtitle}` : APP_NAME;
  }, [location.pathname]);

  return null;
}
