import { PushpinFilled, PushpinOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Input, Select, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Device, Station } from "../../api/client";
import { BaseCard } from "../../components/BaseCard";
import { RiskTag } from "../../components/RiskTag";
import { StatusTag } from "../../components/StatusTag";
import { loadPins, savePins } from "./homePersist";

export function HomeKeySitesCard(props: { loading: boolean; stations: Station[]; devices: Device[] }) {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [pinnedStationIds, setPinnedStationIds] = useState<string[]>(() => loadPins());
  const pinnedSet = useMemo(() => new Set(pinnedStationIds), [pinnedStationIds]);
  const [siteArea, setSiteArea] = useState<string>("all");
  const [siteQuery, setSiteQuery] = useState<string>("");

  useEffect(() => {
    savePins(pinnedStationIds);
  }, [pinnedStationIds]);

  const areas = useMemo(() => {
    const set = new Set(props.stations.map((s) => s.area).filter(Boolean));
    return Array.from(set).sort();
  }, [props.stations]);

  const devicesByStationId = useMemo(() => {
    const map = new Map<string, Device[]>();
    for (const d of props.devices) {
      const list = map.get(d.stationId);
      if (list) list.push(d);
      else map.set(d.stationId, [d]);
    }
    return map;
  }, [props.devices]);

  const filteredStations = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    const list = props.stations.filter((s) => {
      if (siteArea !== "all" && s.area !== siteArea) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.area.toLowerCase().includes(q)
      );
    });

    const riskRank = (risk: Station["risk"]) => {
      if (risk === "high") return 0;
      if (risk === "mid") return 1;
      return 2;
    };

    const statusRank = (status: Station["status"]) => {
      if (status === "warning") return 0;
      if (status === "offline") return 1;
      return 2;
    };

    return list
      .sort((a, b) => {
        const ap = pinnedSet.has(a.id) ? 0 : 1;
        const bp = pinnedSet.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const ar = riskRank(a.risk);
        const br = riskRank(b.risk);
        if (ar !== br) return ar - br;
        const as = statusRank(a.status);
        const bs = statusRank(b.status);
        if (as !== bs) return as - bs;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);
  }, [pinnedSet, props.stations, siteArea, siteQuery]);

  const togglePin = (stationId: string) => {
    setPinnedStationIds((prev) => {
      const set = new Set(prev);
      if (set.has(stationId)) set.delete(stationId);
      else set.add(stationId);
      return Array.from(set.values());
    });
  };

  const goToStationManagement = (stationId?: string) => {
    const idPart = stationId ? `&stationId=${encodeURIComponent(stationId)}` : "";
    navigate(`/app/device-management?tab=management${idPart}`);
  };

  const goToStationGps = (stationId: string) => {
    const stationDevices = devicesByStationId.get(stationId) ?? [];
    const gnss = stationDevices.find((d) => d.type === "gnss") ?? null;
    if (!gnss) {
      message.warning("该站点暂无 GNSS 设备");
      return;
    }
    navigate(`/app/gps-monitoring?deviceId=${encodeURIComponent(gnss.id)}&range=7d&autoRefresh=1`);
  };

  return (
    <BaseCard
      title="重点站点"
      extra={
        <Button
          size="small"
          onClick={() => {
            goToStationManagement();
          }}
        >
          站点管理
        </Button>
      }
    >
      <div className="desk-home-sites-filter">
        <Space size={8} wrap>
          <Select
            size="small"
            value={siteArea}
            style={{ width: 160 }}
            onChange={(v) => setSiteArea(v)}
            options={[{ label: "全部区域", value: "all" }, ...areas.map((a) => ({ label: a, value: a }))]}
          />
          <Input
            size="small"
            value={siteQuery}
            style={{ width: 220 }}
            placeholder="搜索站点/区域"
            onChange={(e) => setSiteQuery(e.target.value)}
          />
        </Space>
      </div>

      <div className="desk-home-sites-list">
        {props.loading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : filteredStations.length ? (
          filteredStations.map((st) => {
            const pinned = pinnedSet.has(st.id);
            const list = devicesByStationId.get(st.id) ?? [];
            const total = Math.max(st.deviceCount, list.length);
            const online = list.filter((d) => d.status === "online").length;
            const last = list
              .map((d) => d.lastSeenAt)
              .filter(Boolean)
              .sort((a, b) => b.localeCompare(a))[0];
            const lastText = last ? new Date(last).toLocaleString("zh-CN") : "—";
            const gnss = list.find((d) => d.type === "gnss") ?? null;
            return (
              <div className={pinned ? "desk-home-site-row is-pinned" : "desk-home-site-row"} key={st.id}>
                <div
                  className="desk-home-site-main"
                  onClick={() => goToStationManagement(st.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="desk-home-site-title">
                    <div className="desk-home-site-name">{st.name}</div>
                    <div className="desk-home-site-tags">
                      <RiskTag value={st.risk} />
                      <StatusTag value={st.status} />
                      {pinned ? <Tag color="cyan">已固定</Tag> : null}
                    </div>
                  </div>
                  <div className="desk-home-site-meta">
                    {st.area} · 设备在线 {String(online)}/{String(total)} · 最近上报 {lastText}
                  </div>
                </div>
                <div className="desk-home-site-actions">
                  <Button size="small" icon={pinned ? <PushpinFilled /> : <PushpinOutlined />} onClick={() => togglePin(st.id)} />
                  <Button size="small" type="primary" disabled={!gnss} onClick={() => goToStationGps(st.id)}>
                    形变
                  </Button>
                  <Button size="small" onClick={() => goToStationManagement(st.id)}>
                    管理
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <Typography.Text type="secondary">暂无站点数据</Typography.Text>
        )}
      </div>
    </BaseCard>
  );
}
