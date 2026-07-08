import { Button, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import type { Device, DeviceType, Station } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { StatusTag } from "../components/StatusTag";

function typeLabel(type: DeviceType): string {
  if (type === "gnss") return "GNSS";
  if (type === "rain") return "雨量";
  if (type === "tilt") return "倾角";
  if (type === "temp_hum") return "温湿度";
  return "摄像头";
}

export function DevicesPage() {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stationId, setStationId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const run = async () => {
      try {
        const [s, d] = await Promise.all([api.stations.list(), api.devices.list()]);
        if (abort.signal.aborted) return;
        setStations(s);
        setDevices(d);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => {
      abort.abort();
    };
  }, [api]);

  const filtered = useMemo(() => {
    if (!stationId) return devices;
    return devices.filter((d) => d.stationId === stationId);
  }, [devices, stationId]);

  return (
    <div className="desk-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226,232,240,0.96)" }}>
            设备管理
          </Typography.Title>
          <Typography.Text type="secondary">设备清单与状态概览</Typography.Text>
        </div>
        <Space>
          <Select
            allowClear
            placeholder="按监测点筛选"
            value={stationId}
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
            style={{ width: 260 }}
            onChange={(v) => {
              setStationId(v);
            }}
          />
          <Button
            onClick={() => {
              setStationId(undefined);
              setLoading(true);
              void api.devices
                .list()
                .then((d) => {
                  setDevices(d);
                })
                .finally(() => {
                  setLoading(false);
                });
            }}
          >
            刷新
          </Button>
          <Button type="primary">新增设备</Button>
        </Space>
      </div>

      <BaseCard title="设备列表" style={{ height: "calc(100vh - 132px)" }}>
        {loading ? (
          <Skeleton active />
        ) : (
          <div className="desk-dark-table">
            <Table<Device>
              rowKey="id"
              dataSource={filtered}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: "设备 ID", dataIndex: "id" },
                { title: "名称", dataIndex: "name" },
                { title: "所属监测点", dataIndex: "stationName" },
                {
                  title: "类型",
                  dataIndex: "type",
                  render: (v: DeviceType) => <Tag>{typeLabel(v)}</Tag>
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (v: Device["status"]) => <StatusTag value={v} />
                },
                {
                  title: "最后上报",
                  dataIndex: "lastSeenAt",
                  render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm")
                }
              ]}
            />
          </div>
        )}
      </BaseCard>
    </div>
  );
}
