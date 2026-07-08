import { Card, Descriptions, Drawer, Skeleton, Table, Typography } from "antd";
import { useEffect, useState } from "react";

import type { Device, Station } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { RiskTag } from "../components/RiskTag";
import { StatusTag } from "../components/StatusTag";

export function StationsPage() {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<Station | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const run = async () => {
      try {
        const s = await api.stations.list();
        if (abort.signal.aborted) return;
        setStations(s);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => {
      abort.abort();
    };
  }, [api]);

  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setDevices([]);
    setDevicesLoading(true);
    const run = async () => {
      try {
        const list = await api.devices.list({ stationId: selected.id });
        if (abort.signal.aborted) return;
        setDevices(list);
      } finally {
        if (!abort.signal.aborted) setDevicesLoading(false);
      }
    };
    void run();
    return () => {
      abort.abort();
    };
  }, [api, selected]);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        监测点
      </Typography.Title>
      <Card title="监测点列表">
        {loading ? (
          <Skeleton active />
        ) : (
          <Table<Station>
          rowKey="id"
          dataSource={stations}
          pagination={false}
          columns={[
            { title: "监测点 ID", dataIndex: "id" },
            { title: "名称", dataIndex: "name" },
            { title: "区域", dataIndex: "area" },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: Station["status"]) => <StatusTag value={v} />
            },
            {
              title: "风险",
              dataIndex: "risk",
              render: (v: Station["risk"]) => <RiskTag value={v} />
            },
            {
              title: "设备数",
              dataIndex: "deviceCount"
            }
          ]}
          onRow={(record) => ({
            onClick: () => {
              setSelected(record);
            }
          })}
        />
        )}
      </Card>

      <Drawer
        title={selected?.name ?? "监测点详情"}
        width={520}
        open={!!selected}
        onClose={() => {
          setSelected(null);
        }}
      >
        {selected ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="区域">{selected.area}</Descriptions.Item>
              <Descriptions.Item label="坐标">
                {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <StatusTag value={selected.status} />
              </Descriptions.Item>
              <Descriptions.Item label="风险">
                <RiskTag value={selected.risk} />
              </Descriptions.Item>
              <Descriptions.Item label="设备数">{selected.deviceCount}</Descriptions.Item>
            </Descriptions>

            <div style={{ height: 16 }} />
            <Typography.Title level={5} style={{ margin: 0 }}>
              设备
            </Typography.Title>
            <div style={{ height: 8 }} />
            {devicesLoading ? (
              <Skeleton active />
            ) : (
              <Table<Device>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={devices}
                columns={[
                  { title: "名称", dataIndex: "name" },
                  { title: "类型", dataIndex: "type" },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v: Device["status"]) => <StatusTag value={v} />
                  }
                ]}
              />
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
