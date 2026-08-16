import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  AlertSeverity,
  AlertStatus,
  AlertSummaryItem,
  DashboardSummary,
  Device,
  Station,
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { HomeAnnouncementsCard } from "./home/HomeAnnouncementsCard";
import { HomeKeySitesCard } from "./home/HomeKeySitesCard";
import { HomeTodosCard } from "./home/HomeTodosCard";
import "./home.css";

function formatEventTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "时间未上报";
  return new Date(timestamp).toLocaleString("zh-CN");
}

function alertSeverityLabel(value: AlertSeverity) {
  if (value === "critical") return { text: "严重", color: "red" };
  if (value === "high") return { text: "高", color: "volcano" };
  if (value === "medium") return { text: "中", color: "orange" };
  return { text: "低", color: "blue" };
}

function alertStatusLabel(value: AlertStatus) {
  if (value === "active") return { text: "活动", color: "red" };
  if (value === "acked") return { text: "待复核", color: "gold" };
  return { text: "已解除", color: "green" };
}

export function HomePage() {
  const api = useApi();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingAlerts, setPendingAlerts] = useState<AlertSummaryItem[]>([]);
  const [pendingAlertCounts, setPendingAlertCounts] = useState({ active: 0, acked: 0 });
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [loadError, setLoadError] = useState("");

  const load = async (silent?: boolean) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const [s, d, st, activeAlerts, ackedAlerts] = await Promise.all([
        api.dashboard.getSummary(),
        api.devices.list(),
        api.stations.list(),
        api.alerts.list({ page: 1, pageSize: 5, status: "active" }),
        api.alerts.list({ page: 1, pageSize: 5, status: "acked" }),
      ]);
      const latestPendingAlerts = [...activeAlerts.list, ...ackedAlerts.list]
        .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt))
        .slice(0, 5);
      setSummary(s);
      setDevices(d);
      setStations(st);
      setPendingAlerts(latestPendingAlerts);
      setPendingAlertCounts({
        active: activeAlerts.pagination.total,
        acked: ackedAlerts.pagination.total,
      });
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
      if (silent) message.success("已刷新");
    } catch (err) {
      const errorMessage = (err as Error).message;
      setLoadError(errorMessage);
      message.error(errorMessage);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [api]);

  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device] as const)),
    [devices]
  );
  const stationById = useMemo(
    () => new Map(stations.map((station) => [station.id, station] as const)),
    [stations]
  );

  const deviceCounts = useMemo(() => {
    const online = devices.filter((device) => device.status === "online").length;
    const delayed = devices.filter((device) => device.status === "warning").length;
    const offline = devices.filter((device) => device.status === "offline").length;
    return { total: devices.length, online, delayed, offline };
  }, [devices]);

  const areaSummary = useMemo(() => {
    const set = new Set(stations.map((s) => s.area).filter((v) => Boolean(v)));
    const n = set.size;
    return n ? `${n} 个片区` : "—";
  }, [stations]);

  const pendingAlertCount = pendingAlertCounts.active + pendingAlertCounts.acked;

  return (
    <div className="desk-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226,232,240,0.96)" }}>
            首页
          </Typography.Title>
          <Typography.Text type="secondary">系统概览与快捷入口</Typography.Text>
        </div>
        <Space size={8}>
          {loadError ? (
            <Typography.Text type="danger">
              刷新失败{updatedAt ? "，显示上次成功数据" : ""}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              {updatedAt ? `更新：${updatedAt}` : "加载中…"}
            </Typography.Text>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void load(true);
            }}
          >
            刷新
          </Button>
        </Space>
      </div>

      <div className="desk-home-grid">
        <div className="desk-home-cell metrics">
          <BaseCard title="关键指标">
            {loading ? (
              <div style={{ padding: 10 }}>
                <Skeleton active paragraph={{ rows: 3 }} />
              </div>
            ) : (
              <div className="desk-home-metrics">
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">监测站点</div>
                  <div className="desk-home-metric-value">
                    {summary ? String(stations.length) : "—"}
                  </div>
                  <div className="desk-home-metric-sub">覆盖区域：{areaSummary}</div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">在线设备</div>
                  <div className="desk-home-metric-value">
                    {summary ? String(deviceCounts.online) : "—"}
                  </div>
                  <div className="desk-home-metric-sub">
                    总计 {deviceCounts.total} · 上报超时 {deviceCounts.delayed} · 离线{" "}
                    {deviceCounts.offline}
                  </div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">待处理告警</div>
                  <div className="desk-home-metric-value">
                    {summary ? String(pendingAlertCount) : "—"}
                  </div>
                  <div className="desk-home-metric-sub">
                    活动 {pendingAlertCounts.active} · 待复核 {pendingAlertCounts.acked}
                  </div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">今日涉及告警</div>
                  <div className="desk-home-metric-value">
                    {summary ? String(summary.alertCountToday) : "—"}
                  </div>
                  <div className="desk-home-metric-sub">今日触发或更新，按告警 ID 去重</div>
                </div>
              </div>
            )}
          </BaseCard>
        </div>

        <div className="desk-home-cell todos">
          <HomeTodosCard loading={loading} stations={stations} devices={devices} />
        </div>

        <div className="desk-home-cell shortcuts">
          <BaseCard title="快捷入口">
            <div className="desk-home-shortcuts">
              <div className="desk-home-shortcut">
                <div className="desk-home-shortcut-title">数据分析大屏</div>
                <div className="desk-home-shortcut-desc">总览、实时异常、趋势图与 AI 提示。</div>
                <div style={{ marginTop: "auto" }}>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    onClick={() => {
                      navigate("/app/analysis");
                    }}
                  >
                    进入
                  </Button>
                </div>
              </div>

              <div className="desk-home-shortcut">
                <div className="desk-home-shortcut-title">设备管理中心</div>
                <div className="desk-home-shortcut-desc">
                  设备状态监控、站点管理、基线管理与控制面板。
                </div>
                <div style={{ marginTop: "auto" }}>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    onClick={() => {
                      navigate("/app/device-management");
                    }}
                  >
                    进入
                  </Button>
                </div>
              </div>

              <div className="desk-home-shortcut">
                <div className="desk-home-shortcut-title">形变监测</div>
                <div className="desk-home-shortcut-desc">
                  位移曲线、阈值配置、预测趋势与导出入口。
                </div>
                <div style={{ marginTop: "auto" }}>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    onClick={() => {
                      navigate("/app/gps-monitoring");
                    }}
                  >
                    进入
                  </Button>
                </div>
              </div>

              <div className="desk-home-shortcut">
                <div className="desk-home-shortcut-title">系统设置</div>
                <div className="desk-home-shortcut-desc">数据源与性能、托盘与通知、退出登录。</div>
                <div style={{ marginTop: "auto" }}>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    onClick={() => {
                      navigate("/app/settings");
                    }}
                  >
                    进入
                  </Button>
                </div>
              </div>
            </div>
          </BaseCard>
        </div>

        <div className="desk-home-cell anomalies">
          <BaseCard
            title="未闭环告警"
            extra={
              <Button
                size="small"
                onClick={() => {
                  navigate("/app/analysis");
                }}
              >
                查看更多
              </Button>
            }
          >
            <div className="desk-home-anomaly">
              {loading ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : pendingAlerts.length ? (
                pendingAlerts.map((alert) => {
                  const device = alert.deviceId ? deviceById.get(alert.deviceId) : null;
                  const station = alert.stationId ? stationById.get(alert.stationId) : null;
                  const severity = alertSeverityLabel(alert.severity);
                  const status = alertStatusLabel(alert.status);
                  return (
                    <div className="desk-home-anomaly-row" key={alert.alertId}>
                      <div className="desk-home-anomaly-left">
                        <div className="desk-home-anomaly-name">{alert.title || "未命名告警"}</div>
                        <div className="desk-home-anomaly-meta">
                          {station?.name ?? device?.stationName ?? "未绑定站点"} ·{" "}
                          {device?.name ?? alert.deviceId ?? "未绑定设备"} ·{" "}
                          {formatEventTime(alert.lastEventAt)}
                        </div>
                      </div>
                      <div className="desk-home-anomaly-tags">
                        <Tag color={severity.color}>{severity.text}</Tag>
                        <Tag color={status.color}>{status.text}</Tag>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Typography.Text type="secondary">当前无待处理告警</Typography.Text>
              )}
            </div>
          </BaseCard>
        </div>

        <div className="desk-home-cell sites">
          <HomeKeySitesCard loading={loading} stations={stations} devices={devices} />
        </div>

        <div className="desk-home-cell announcements">
          <HomeAnnouncementsCard loading={loading} />
        </div>
      </div>
    </div>
  );
}
