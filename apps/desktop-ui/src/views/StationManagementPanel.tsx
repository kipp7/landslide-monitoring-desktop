import {
  App as AntApp,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  EditOutlined,
  EyeOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SettingOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import type { Device, DeviceType, OnlineStatus, RiskLevel, StationManagementStation } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { RiskTag } from "../components/RiskTag";
import { StatusTag } from "../components/StatusTag";
import { formatBeijingDateTime, formatBeijingTime } from "../utils/beijingTime";
import { formatLifecycleStatusDisplay, lifecycleStatusTagColor } from "../utils/fieldIdentityDisplay";
import "./stationManagement.css";

type ViewMode = "list" | "hierarchy";

type EditState =
  | { open: false }
  | { open: true; stationId: string };

type LegendState =
  | { open: false }
  | { open: true; draft: Record<string, string> };

type HierarchyNetwork = {
  network_name: string;
  network_code: string;
  network_type: string;
  configured_station_count: number;
  actual_station_count: number;
  online_stations: number;
  stations: StationManagementStation[];
};

type HierarchyRegion = {
  region_name: string;
  region_code: string;
  network_count: number;
  station_count: number;
  online_stations: number;
  coverage_hint: string;
  networks: HierarchyNetwork[];
};

function deviceTypeLabel(type: DeviceType) {
  if (type === "gnss") return "GNSS";
  if (type === "rain") return "雨量";
  if (type === "tilt") return "倾角";
  if (type === "temp_hum") return "温湿度";
  return "摄像头";
}

function canonicalText(value?: string | null): string {
  return value?.trim() ? value.trim() : "—";
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function centeredCell(content: React.ReactNode, className?: string) {
  return <div className={["desk-sm-center-cell", className].filter(Boolean).join(" ")}>{content}</div>;
}

function lifecycleTag(value?: string | null) {
  const display = formatLifecycleStatusDisplay(value, "未设置");
  const color = lifecycleStatusTagColor(value);
  return color ? <Tag color={color}>{display}</Tag> : <Tag>{display}</Tag>;
}

function buildHierarchyData(stations: StationManagementStation[]): HierarchyRegion[] {
  const regionBuckets = new Map<
    string,
    {
      region_name: string;
      region_code: string;
      coverage_hint: string;
      stations: StationManagementStation[];
      networks: Map<string, HierarchyNetwork>;
    }
  >();

  for (const station of stations) {
    const regionCode = station.regionCode?.trim() || "UNASSIGNED";
    const regionEntry =
      regionBuckets.get(regionCode) ??
      (() => {
        const created = {
          region_name: station.locationName?.trim() || station.regionCode?.trim() || "未命名部署区域",
          region_code: regionCode,
          coverage_hint: station.slopeCode?.trim() ? `${station.slopeCode.trim()} 点位组` : "现场点位组",
          stations: [] as StationManagementStation[],
          networks: new Map<string, HierarchyNetwork>()
        };
        regionBuckets.set(regionCode, created);
        return created;
      })();

    regionEntry.stations.push(station);

    const networkCode = station.slopeCode?.trim() || station.stationCode || station.stationId;
    const networkEntry =
      regionEntry.networks.get(networkCode) ??
      (() => {
        const created: HierarchyNetwork = {
          network_name: station.slopeCode?.trim() ? `${station.slopeCode.trim()} 监测网络` : `${station.displayName ?? station.stationName} 监测网络`,
          network_code: networkCode,
          network_type: "现场监测网络",
          configured_station_count: 0,
          actual_station_count: 0,
          online_stations: 0,
          stations: []
        };
        regionEntry.networks.set(networkCode, created);
        return created;
      })();

    networkEntry.stations.push(station);
  }

  return Array.from(regionBuckets.values())
    .map((region) => {
      const networks = Array.from(region.networks.values())
        .map((network) => {
          const onlineStations = network.stations.filter((station) => station.status === "online").length;
          return {
            ...network,
            configured_station_count: network.stations.length,
            actual_station_count: network.stations.length,
            online_stations: onlineStations,
            stations: network.stations.slice().sort((a, b) => (a.displayName ?? a.stationName).localeCompare(b.displayName ?? b.stationName))
          };
        })
        .sort((a, b) => a.network_code.localeCompare(b.network_code));

      return {
        region_name: region.region_name,
        region_code: region.region_code,
        network_count: networks.length,
        station_count: region.stations.length,
        online_stations: region.stations.filter((station) => station.status === "online").length,
        coverage_hint: region.coverage_hint,
        networks
      };
    })
    .sort((a, b) => a.region_code.localeCompare(b.region_code));
}

export function StationManagementPanel(props: { className?: string; style?: React.CSSProperties; initialStationId?: string | null }) {
  const api = useApi();
  const { message } = AntApp.useApp();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [stations, setStations] = useState<StationManagementStation[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  const [edit, setEdit] = useState<EditState>({ open: false });
  const [legend, setLegend] = useState<LegendState>({ open: false });
  const [detailStationId, setDetailStationId] = useState<string | null>(null);

  useEffect(() => {
    if (!props.initialStationId) return;
    setDetailStationId(props.initialStationId);
  }, [props.initialStationId]);

  const [form] = Form.useForm<{
    stationId: string;
    stationCode: string;
    displayName: string;
    stationName: string;
    chartLegendName: string;
    regionCode: string;
    slopeCode: string;
    lifecycleStatus: string;
    locationName: string;
    description: string;
    riskLevel: RiskLevel;
    status: OnlineStatus;
    sensorTypes: DeviceType[];
  }>();

  const refresh = async (showToast = true) => {
    setLoading(true);
    setError(null);
    try {
      const [nextStations, nextDevices] = await Promise.all([api.stations.listManagement(), api.devices.list()]);
      setStations(nextStations);
      setDevices(nextDevices);
      const t = formatBeijingTime(new Date());
      setLastUpdateTime(t);
      if (showToast) message.success("已刷新");
    } catch (err) {
      setError((err as Error).message);
      if (showToast) message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(false);
  }, [api]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      void refresh(false);
    }, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const formalStationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const device of devices) {
      if (isFormalIdentityClass(device.identityClass)) {
        ids.add(device.stationId);
      }
    }
    return ids;
  }, [devices]);

  const visibleStations = useMemo(
    () => stations.filter((station) => formalStationIds.has(station.stationId)),
    [formalStationIds, stations]
  );

  const counts = useMemo(() => {
    const total = visibleStations.length;
    const online = visibleStations.filter((s) => s.status === "online").length;
    const offline = visibleStations.filter((s) => s.status === "offline").length;
    const highRisk = visibleStations.filter((s) => s.riskLevel === "high").length;
    return { total, online, offline, highRisk };
  }, [visibleStations]);

  const regions = useMemo(() => buildHierarchyData(visibleStations), [visibleStations]);
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());
  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!regions.length) {
      setExpandedRegions(new Set());
      setExpandedNetworks(new Set());
      return;
    }
    setExpandedRegions((prev) => (prev.size ? prev : new Set(regions.map((region) => region.region_code))));
    setExpandedNetworks((prev) =>
      prev.size ? prev : new Set(regions.flatMap((region) => region.networks.map((network) => network.network_code)))
    );
  }, [regions]);

  const toggleRegionExpanded = (regionCode: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(regionCode)) next.delete(regionCode);
      else next.add(regionCode);
      return next;
    });
  };

  const toggleNetworkExpanded = (networkCode: string) => {
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(networkCode)) next.delete(networkCode);
      else next.add(networkCode);
      return next;
    });
  };

  const toggleAllExpanded = () => {
    const allRegionCodes = regions.map((region) => region.region_code);
    const allNetworkCodes = regions.flatMap((region) => region.networks.map((network) => network.network_code));
    const isAllExpanded = allRegionCodes.every((code) => expandedRegions.has(code)) && allNetworkCodes.every((code) => expandedNetworks.has(code));
    if (isAllExpanded) {
      setExpandedRegions(new Set());
      setExpandedNetworks(new Set());
      return;
    }
    setExpandedRegions(new Set(allRegionCodes));
    setExpandedNetworks(new Set(allNetworkCodes));
  };

  const openEdit = (stationId: string) => {
    const st = visibleStations.find((s) => s.stationId === stationId);
    if (!st) return;
    setEdit({ open: true, stationId });
    form.resetFields();
    form.setFieldsValue({
      stationId: st.stationId,
      stationCode: st.stationCode,
      displayName: st.displayName ?? "",
      stationName: st.stationName,
      chartLegendName: st.chartLegendName,
      regionCode: st.regionCode ?? "",
      slopeCode: st.slopeCode ?? "",
      lifecycleStatus: st.lifecycleStatus ?? "",
      locationName: st.locationName,
      description: st.description,
      riskLevel: st.riskLevel,
      status: st.status,
      sensorTypes: st.sensorTypes
    });
  };

  const saveEdit = async () => {
    const values = await form.validateFields();
    await api.stations.updateManagement({
      stationId: values.stationId,
      stationName: values.stationName,
      displayName: values.displayName,
      regionCode: values.regionCode,
      slopeCode: values.slopeCode,
      lifecycleStatus: values.lifecycleStatus,
      chartLegendName: values.chartLegendName,
      locationName: values.locationName,
      description: values.description,
      riskLevel: values.riskLevel,
      status: values.status,
      sensorTypes: values.sensorTypes
    });
    await refresh(false);
    message.success("已保存");
    setEdit({ open: false });
  };

  const openLegendConfig = () => {
    const draft: Record<string, string> = {};
    for (const st of visibleStations) draft[st.stationId] = st.chartLegendName;
    setLegend({ open: true, draft });
  };

  const saveLegendConfig = () => {
    if (!legend.open) return;
    void api.stations
      .updateLegendNames({ legends: legend.draft })
      .then(async () => {
        await refresh(false);
        message.success("已更新图例名称");
        setLegend({ open: false });
      })
      .catch((err: unknown) => {
        message.error((err as Error).message);
      });
  };

  const detailStation = useMemo(
    () => (detailStationId ? visibleStations.find((s) => s.stationId === detailStationId) ?? null : null),
    [detailStationId, visibleStations]
  );

  const columns: Parameters<typeof Table<StationManagementStation>>[0]["columns"] = [
    {
      title: "监测站",
      key: "station",
      width: 340,
      align: "center",
      render: (_: unknown, row) => (
        <div className="desk-sm-station-cell">
          <div className="desk-sm-station-cell-head">
            <div className="desk-sm-station-cell-title">{row.displayName ?? row.stationName}</div>
            <StatusTag value={row.status} />
            <RiskTag value={row.riskLevel} />
          </div>
          <div className="desk-sm-station-cell-sub">{row.stationName}</div>
          <div className="desk-sm-station-cell-sub">
            {row.stationCode} · {row.stationId}
          </div>
        </div>
      )
    },
    {
      title: "业务编码",
      key: "canonical",
      width: 420,
      align: "center",
      render: (_: unknown, row) => (
        <div className="desk-sm-canonical-cell">
          <div className="desk-sm-canonical-row">
            <span className="desk-sm-canonical-k">区域编码</span>
            <span className="desk-sm-canonical-v">{canonicalText(row.regionCode)}</span>
          </div>
          <div className="desk-sm-canonical-row">
            <span className="desk-sm-canonical-k">边坡编码</span>
            <span className="desk-sm-canonical-v">{canonicalText(row.slopeCode)}</span>
          </div>
        </div>
      )
    },
    {
      title: "位置",
      dataIndex: "locationName",
      key: "locationName",
      width: 260,
      align: "center",
      render: (value: string) => <div className="desk-sm-location-cell">{value || "—"}</div>
    },
    {
      title: "传感器",
      key: "sensors",
      align: "center",
      render: (_: unknown, row) => (
        centeredCell(
          <Space size={6} wrap>
            {row.sensorTypes.length ? (
              row.sensorTypes.map((t) => (
                <Tag key={t} className="desk-pill-tag">
                  {deviceTypeLabel(t)}
                </Tag>
              ))
            ) : (
              <span style={{ color: "rgba(148,163,184,0.9)" }}>-</span>
            )}
          </Space>,
          "desk-sm-sensor-cell"
        )
      )
    },
    {
      title: "设备数",
      dataIndex: "deviceCount",
      key: "deviceCount",
      width: 90,
      align: "center",
      render: (value: number) => centeredCell(value, "desk-sm-number-cell")
    },
    {
      title: "生命周期",
      dataIndex: "lifecycleStatus",
      key: "lifecycleStatus",
      width: 150,
      align: "center",
      render: (value: string | null | undefined) => centeredCell(lifecycleTag(value), "desk-sm-lifecycle-cell")
    },
    {
      title: "坐标",
      key: "coord",
      width: 180,
      align: "center",
      render: (_: unknown, row) => (
        centeredCell(
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
          </span>,
          "desk-sm-coord-cell"
        )
      )
    },
    {
      title: "最后数据",
      dataIndex: "lastDataTime",
      key: "lastDataTime",
      width: 188,
      align: "center",
      render: (v: string) => centeredCell(formatBeijingDateTime(v, { includeSeconds: false }), "desk-sm-last-data-cell")
    },
    {
      title: "图例名称",
      dataIndex: "chartLegendName",
      key: "chartLegendName",
      align: "center",
      ellipsis: true,
      render: (value: string) => centeredCell(value || "—", "desk-sm-legend-cell")
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_: unknown, row) => (
        centeredCell(
          <Space>
            <Tooltip title="编辑监测站">
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row.stationId)} />
            </Tooltip>
            <Tooltip title="查看详情">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => {
                  setDetailStationId(row.stationId);
                }}
              />
            </Tooltip>
          </Space>,
          "desk-sm-action-cell"
        )
      )
    }
  ];

  return (
    <BaseCard
      className={props.className}
      style={props.style}
      title={
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <RadarChartOutlined style={{ color: "rgba(34,211,238,0.95)" }} />
          <span>挂傍山监测站管理</span>
        </span>
      }
      extra={
        <Space size={8} wrap>
          <div className="desk-sm-toggle">
            <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>
              列表视图
            </button>
            <button type="button" className={viewMode === "hierarchy" ? "active" : ""} onClick={() => setViewMode("hierarchy")}>
              分层视图
            </button>
          </div>

          {viewMode === "hierarchy" ? (
            <Button size="small" onClick={toggleAllExpanded} icon={expandedRegions.size ? <CaretDownOutlined /> : <CaretRightOutlined />}>
              {expandedRegions.size ? "全部收缩" : "全部展开"}
            </Button>
          ) : null}

          <Button size="small" icon={<SettingOutlined />} onClick={openLegendConfig}>
            图例配置
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined spin={loading} />}
            loading={loading}
            onClick={() => {
              void refresh(true);
            }}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <div className="desk-sm-body">
        <div className="desk-sm-subtitle">统一管理监测站配置、业务编码、图表图例和传感器设置</div>

        <div className="desk-sm-stats">
          <div className="desk-sm-stat">
            <div className="desk-sm-dot blue" />
            <div>
              <div className="desk-sm-stat-label">总监测站</div>
              <div className="desk-sm-stat-value">{counts.total}</div>
            </div>
          </div>
          <div className="desk-sm-stat">
            <div className="desk-sm-dot green" />
            <div>
              <div className="desk-sm-stat-label">在线</div>
              <div className="desk-sm-stat-value" style={{ color: "#22c55e" }}>
                {counts.online}
              </div>
            </div>
          </div>
          <div className="desk-sm-stat">
            <div className="desk-sm-dot red" />
            <div>
              <div className="desk-sm-stat-label">离线</div>
              <div className="desk-sm-stat-value" style={{ color: "#ef4444" }}>
                {counts.offline}
              </div>
            </div>
          </div>
          <div className="desk-sm-stat">
            <div className="desk-sm-dot yellow" />
            <div>
              <div className="desk-sm-stat-label">高风险</div>
              <div className="desk-sm-stat-value" style={{ color: "#f59e0b" }}>
                {counts.highRisk}
              </div>
            </div>
          </div>
          <div className="desk-sm-stat-meta">
            <div className="desk-sm-meta-row">
              <span className="desk-sm-meta-k">自动刷新</span>
              <Button size="small" type={autoRefresh ? "primary" : "default"} onClick={() => setAutoRefresh((v) => !v)}>
                {autoRefresh ? "开启" : "关闭"}
              </Button>
            </div>
            <div className="desk-sm-meta-row">
              <span className="desk-sm-meta-k">更新时间</span>
              <span className="desk-sm-meta-v">{lastUpdateTime || "--"}</span>
            </div>
          </div>
        </div>

        {!loading && !error && !visibleStations.length ? (
          <div className="desk-sm-placeholder">
            <Typography.Text type="secondary">当前没有监测站接入，未归档数据不会显示在当前视图。</Typography.Text>
          </div>
        ) : viewMode === "list" ? (
          <div className="desk-dark-table">
            <Table<StationManagementStation>
              rowKey="stationId"
              size="small"
              dataSource={visibleStations}
              loading={loading}
              pagination={false}
              scroll={{ x: 1620, y: 420 }}
              columns={columns}
            />
          </div>
        ) : (
          <div className="desk-sm-hierarchy">
            {loading ? <div className="desk-sm-loading">加载分层数据…</div> : null}
            {regions.map((region) => (
              <div key={region.region_code} className="desk-sm-region">
                <div className="desk-sm-region-head" onClick={() => toggleRegionExpanded(region.region_code)}>
                  <div className="desk-sm-region-left">
                    <span className="desk-sm-caret">{expandedRegions.has(region.region_code) ? <CaretDownOutlined /> : <CaretRightOutlined />}</span>
                    <div>
                      <div className="desk-sm-region-title">{region.region_name}</div>
                      <div className="desk-sm-region-sub">
                        {region.region_code} · {region.coverage_hint}
                      </div>
                    </div>
                  </div>
                  <div className="desk-sm-region-metrics">
                    <div className="desk-sm-region-metric">
                      <div className="v">{region.network_count}</div>
                      <div className="k">网络</div>
                    </div>
                    <div className="desk-sm-region-metric">
                      <div className="v">{region.station_count}</div>
                      <div className="k">站点</div>
                    </div>
                    <div className="desk-sm-region-metric">
                      <div className="v" style={{ color: "#22c55e" }}>
                        {region.online_stations}
                      </div>
                      <div className="k">在线</div>
                    </div>
                  </div>
                </div>

                {expandedRegions.has(region.region_code) ? (
                  <div className="desk-sm-region-body">
                    {region.networks.map((network) => (
                      <div key={network.network_code} className="desk-sm-network">
                        <div className="desk-sm-network-head" onClick={() => toggleNetworkExpanded(network.network_code)}>
                          <div className="desk-sm-region-left">
                            <span className="desk-sm-caret">
                              {expandedNetworks.has(network.network_code) ? <CaretDownOutlined /> : <CaretRightOutlined />}
                            </span>
                            <div>
                              <div className="desk-sm-network-title">{network.network_name}</div>
                              <div className="desk-sm-region-sub">
                                {network.network_code} · {network.network_type}
                              </div>
                            </div>
                          </div>
                          <div className="desk-sm-network-metrics">
                            <span>
                              配置 <span className="v blue">{network.configured_station_count}</span>
                            </span>
                            <span>
                              实际 <span className="v green">{network.actual_station_count}</span>
                            </span>
                            <span>
                              在线 <span className="v green">{network.online_stations}</span>
                            </span>
                          </div>
                        </div>

                        {expandedNetworks.has(network.network_code) ? (
                          <div className="desk-sm-station-grid">
                            {network.stations.map((st) => (
                              <div key={st.stationId} className="desk-sm-station-card">
                                <div className="desk-sm-station-top">
                                  <div className="desk-sm-station-name">{st.displayName ?? st.stationName}</div>
                                  <div className="desk-sm-station-tags">
                                    <StatusTag value={st.status} />
                                    <RiskTag value={st.riskLevel} />
                                  </div>
                                </div>
                                <div className="desk-sm-station-sub">{st.displayName ?? st.stationName}</div>
                                <div className="desk-sm-station-sub">
                                  {st.stationCode} · {st.stationId}
                                </div>
                                <div className="desk-sm-station-sub">
                                  {canonicalText(st.regionCode)} · {canonicalText(st.slopeCode)}
                                </div>
                                <div className="desk-sm-station-sub">{st.locationName}</div>
                                <div className="desk-sm-station-actions">
                                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(st.stationId)}>
                                    编辑
                                  </Button>
                                  <Button
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={() => {
                                      setDetailStationId(st.stationId);
                                    }}
                                  >
                                    详情
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {error ? (
          <div className="desk-sm-error">
            <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 900 }}>加载失败</div>
            <div style={{ color: "rgba(226,232,240,0.9)", marginTop: 6 }}>{error}</div>
            <Button
              size="small"
              style={{ marginTop: 10 }}
              onClick={() => {
                void refresh(true);
              }}
            >
              重试
            </Button>
          </div>
        ) : null}
      </div>

      <Modal
        title={edit.open ? `编辑监测站 - ${visibleStations.find((s) => s.stationId === edit.stationId)?.stationName ?? ""}` : "编辑监测站"}
        open={edit.open}
        onCancel={() => {
          setEdit({ open: false });
        }}
        onOk={() => {
          void saveEdit();
        }}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="stationId" label="站点 ID">
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stationCode" label="站点编码">
                <Input disabled />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="displayName" label="展示名称">
                <Input placeholder="例如：挂傍山 01 号监测点" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stationName" label="监测站名称" rules={[{ required: true }]}>
                <Input placeholder="例如：挂傍山中心监测站" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="regionCode" label="区域编码">
                <Input placeholder="例如：CN-GX-YL-GBS" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="slopeCode" label="边坡编码">
                <Input placeholder="例如：LS-CN-GX-YL-GBS-001" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="lifecycleStatus" label="生命周期状态">
                <Input placeholder="例如：已投运（commissioned）/ 维护中（maintenance）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="chartLegendName" label="图例显示名称" rules={[{ required: true }]}>
                <Input placeholder="例如：中心监测站" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="locationName" label="位置描述" rules={[{ required: true }]}>
            <Input placeholder="例如：挂傍山中心点" />
          </Form.Item>
          <Form.Item name="description" label="详细描述">
            <Input.TextArea rows={3} placeholder="监测站的详细描述信息" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="riskLevel" label="风险等级" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: "低风险", value: "low" },
                    { label: "中风险", value: "mid" },
                    { label: "高风险", value: "high" }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="设备状态" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: "在线", value: "online" },
                    { label: "预警", value: "warning" },
                    { label: "离线", value: "offline" }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="sensorTypes" label="传感器类型" rules={[{ required: true, message: "请选择传感器类型" }]}>
            <Select
              mode="multiple"
              placeholder="选择传感器类型"
              options={[
                { label: "GNSS", value: "gnss" },
                { label: "雨量", value: "rain" },
                { label: "倾角", value: "tilt" },
                { label: "温湿度", value: "temp_hum" },
                { label: "摄像头", value: "camera" }
              ]}
            />
          </Form.Item>
          <div style={{ color: "rgba(148,163,184,0.9)", fontSize: 12 }}>提示：用于统一管理监测站配置、图表图例和传感器设置。</div>
        </Form>
      </Modal>

      <Modal
        title="图例配置"
        open={legend.open}
        onCancel={() => setLegend({ open: false })}
        onOk={saveLegendConfig}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        {legend.open ? (
          <div className="desk-sm-legend-list">
            {visibleStations.map((st) => (
              <div key={st.stationId} className="desk-sm-legend-row">
                <div className="desk-sm-legend-left">
                  <div className="desk-sm-legend-title">{st.stationName}</div>
                  <div className="desk-sm-legend-sub">{st.stationId}</div>
                </div>
                <Input
                  value={legend.draft[st.stationId] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLegend((prev) => {
                      if (!prev.open) return prev;
                      return { open: true, draft: { ...prev.draft, [st.stationId]: v } };
                    });
                  }}
                  placeholder="图例显示名称"
                />
              </div>
            ))}
            <div style={{ color: "rgba(148,163,184,0.9)", fontSize: 12, marginTop: 10 }}>
              提示：图例名称用于形变监测/分析页曲线图的 legend 显示（后续可统一从后端配置中心下发）。
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        title="监测站详情"
        open={!!detailStationId}
        onCancel={() => setDetailStationId(null)}
        footer={
          <Button
            type="primary"
            onClick={() => {
              setDetailStationId(null);
            }}
          >
            关闭
          </Button>
        }
        width={760}
      >
        {detailStation ? (
          <div className="desk-sm-detail">
            <div className="desk-sm-detail-grid">
              <div className="desk-sm-detail-card">
                <div className="desk-sm-detail-title">基本信息</div>
                <div className="desk-sm-detail-item">
                  <span className="k">监测站名称</span>
                  <span className="v">{detailStation.stationName}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">展示名称</span>
                  <span className="v">{detailStation.displayName ?? "-"}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">站点 ID</span>
                  <span className="v">{detailStation.stationId}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">站点编码</span>
                  <span className="v">{detailStation.stationCode}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">位置</span>
                  <span className="v">{detailStation.locationName}</span>
                </div>
              </div>

              <div className="desk-sm-detail-card">
                <div className="desk-sm-detail-title">状态与命名</div>
                <div className="desk-sm-detail-item">
                  <span className="k">状态</span>
                  <span className="v">
                    <StatusTag value={detailStation.status} />
                  </span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">风险</span>
                  <span className="v">
                    <RiskTag value={detailStation.riskLevel} />
                  </span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">区域编码</span>
                  <span className="v">{canonicalText(detailStation.regionCode)}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">边坡编码</span>
                  <span className="v">{canonicalText(detailStation.slopeCode)}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">生命周期状态</span>
                  <span className="v">{lifecycleTag(detailStation.lifecycleStatus)}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">设备数</span>
                  <span className="v">{detailStation.deviceCount}</span>
                </div>
                <div className="desk-sm-detail-item">
                  <span className="k">最后数据</span>
                  <span className="v">{formatBeijingDateTime(detailStation.lastDataTime)}</span>
                </div>
              </div>
            </div>

            <div className="desk-sm-detail-card" style={{ marginTop: 12 }}>
              <div className="desk-sm-detail-title">传感器与图例</div>
              <div className="desk-sm-detail-item">
                <span className="k">传感器类型</span>
                <span className="v">
                  <Space size={6} wrap>
                    {detailStation.sensorTypes.map((t) => (
                      <Tag key={t} className="desk-pill-tag">
                        {deviceTypeLabel(t)}
                      </Tag>
                    ))}
                  </Space>
                </span>
              </div>
              <div className="desk-sm-detail-item">
                <span className="k">图例名称</span>
                <span className="v">{detailStation.chartLegendName}</span>
              </div>
              <div className="desk-sm-detail-item">
                <span className="k">描述</span>
                <span className="v">{detailStation.description}</span>
              </div>
              <div className="desk-sm-detail-item">
                <span className="k">坐标</span>
                <span className="v" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                  {detailStation.lat.toFixed(6)}, {detailStation.lng.toFixed(6)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: "rgba(148,163,184,0.9)" }}>-</div>
        )}
      </Modal>
    </BaseCard>
  );
}
