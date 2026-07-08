import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Skeleton, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { DashboardSummary, Device, Station } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { StatusTag } from "../components/StatusTag";
import { HomeAnnouncementsCard } from "./home/HomeAnnouncementsCard";
import { HomeKeySitesCard } from "./home/HomeKeySitesCard";
import { HomeTodosCard } from "./home/HomeTodosCard";
import "./home.css";

type HomeAnomaly = {
  id: string;
  deviceName: string;
  stationName: string;
  status: "online" | "warning" | "offline";
  time: string;
};

function healthLabel(value: number) {
  if (value >= 90) return { text: "优秀", color: "#22c55e" };
  if (value >= 75) return { text: "良好", color: "#60a5fa" };
  if (value >= 60) return { text: "一般", color: "#f59e0b" };
  return { text: "需关注", color: "#ef4444" };
}

export function HomePage() {
  const api = useApi();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const [s, d, st] = await Promise.all([api.dashboard.getSummary(), api.devices.list(), api.stations.list()]);
      setSummary(s);
      setDevices(d);
      setStations(st);
      setUpdatedAt(new Date().toLocaleString("zh-CN"));
      if (silent) message.success("已刷新");
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [api]);

  const anomalies = useMemo<HomeAnomaly[]>(() => {
    const list = devices
      .filter((d) => d.status !== "online")
      .map((d) => ({
        id: d.id,
        deviceName: d.name,
        stationName: d.stationName,
        status: d.status,
        time: new Date(d.lastSeenAt).toLocaleString("zh-CN")
      }))
      .sort((a, b) => b.time.localeCompare(a.time));
    return list.slice(0, 5);
  }, [devices]);

  const areaSummary = useMemo(() => {
    const set = new Set(stations.map((s) => s.area).filter((v) => Boolean(v)));
    const n = set.size;
    return n ? `${n} 个片区` : "—";
  }, [stations]);

  const health = healthLabel(summary?.systemHealthPercent ?? 0);

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
          <Typography.Text type="secondary">{updatedAt ? `更新：${updatedAt}` : "加载中…"}</Typography.Text>
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
          <BaseCard title="关键指标" extra={summary ? <span style={{ color: health.color, fontWeight: 900 }}>健康：{health.text}</span> : null}>
            {loading ? (
              <div style={{ padding: 10 }}>
                <Skeleton active paragraph={{ rows: 3 }} />
              </div>
            ) : (
              <div className="desk-home-metrics">
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">监测点</div>
                  <div className="desk-home-metric-value">{String(summary?.stationCount ?? 0)}</div>
                  <div className="desk-home-metric-sub">覆盖区域：{areaSummary}</div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">在线设备</div>
                  <div className="desk-home-metric-value">{String(summary?.deviceOnlineCount ?? 0)}</div>
                  <div className="desk-home-metric-sub">采集链路：正常</div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">今日预警</div>
                  <div className="desk-home-metric-value">{String(summary?.alertCountToday ?? 0)}</div>
                  <div className="desk-home-metric-sub">规则：默认策略</div>
                </div>
                <div className="desk-home-metric">
                  <div className="desk-home-metric-label">系统健康度</div>
                  <div className="desk-home-metric-value">{String(summary?.systemHealthPercent ?? 0)}%</div>
                  <div className="desk-home-metric-sub">状态：{health.text}</div>
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
                <div className="desk-home-shortcut-desc">设备状态监控、站点管理、基线管理与控制面板。</div>
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
                <div className="desk-home-shortcut-desc">位移曲线、阈值配置、预测趋势与导出入口。</div>
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
            title="最新异常设备"
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
              ) : anomalies.length ? (
                anomalies.map((r) => (
                  <div className="desk-home-anomaly-row" key={r.id}>
                    <div className="desk-home-anomaly-left">
                      <div className="desk-home-anomaly-name">{r.deviceName}</div>
                      <div className="desk-home-anomaly-meta">
                        {r.stationName} · {r.time}
                      </div>
                    </div>
                    <StatusTag value={r.status} />
                  </div>
                ))
              ) : (
                <Typography.Text type="secondary">当前无异常</Typography.Text>
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
