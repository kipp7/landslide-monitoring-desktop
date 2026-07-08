import { App as AntApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import type { Baseline, BaselineStatus, Device } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";

type EditState =
  | { open: false }
  | { open: true; mode: "create" | "edit"; deviceId?: string; baseline?: Baseline };

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function baselineStatusTag(status: BaselineStatus) {
  if (status === "active") return <Tag color="green">已建立</Tag>;
  if (status === "draft") return <Tag color="blue">草稿</Tag>;
  return <Tag color="red">缺失</Tag>;
}

export function BaselinesPanel(props: { className?: string; style?: React.CSSProperties }) {
  const api = useApi();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [edit, setEdit] = useState<EditState>({ open: false });
  const [form] = Form.useForm<{
    deviceId: string;
    baselineLat: number;
    baselineLng: number;
    baselineAlt?: number;
    notes?: string;
    status: BaselineStatus;
  }>();

  const refresh = async () => {
    setLoading(true);
    try {
      const [devicesList, baselineList] = await Promise.all([api.devices.list(), api.baselines.list()]);
      setDevices(devicesList.filter((x) => x.type === "gnss" && isFormalIdentityClass(x.identityClass)));
      setBaselines(baselineList);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [api]);

  const baselineByDeviceId = useMemo(() => new Map(baselines.map((b) => [b.deviceId, b] as const)), [baselines]);

  const rows = useMemo(() => {
    return devices.map((d) => ({
      deviceId: d.id,
      deviceName: d.name,
      stationName: d.stationName,
      baseline: baselineByDeviceId.get(d.id)
    }));
  }, [baselineByDeviceId, devices]);

  const openCreate = (deviceId?: string) => {
    setEdit(deviceId ? { open: true, mode: "create", deviceId } : { open: true, mode: "create" });
    form.resetFields();
    form.setFieldsValue({ deviceId: deviceId ?? "", status: "active" });
  };

  const openEdit = (baseline: Baseline) => {
    setEdit({ open: true, mode: "edit", baseline, deviceId: baseline.deviceId });
    const values: Parameters<typeof form.setFieldsValue>[0] = {
      deviceId: baseline.deviceId,
      baselineLat: baseline.baselineLat,
      baselineLng: baseline.baselineLng,
      status: baseline.status
    };
    if (baseline.baselineAlt !== undefined) values.baselineAlt = baseline.baselineAlt;
    if (baseline.notes !== undefined) values.notes = baseline.notes;
    form.setFieldsValue(values);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      const saved = await api.baselines.upsert({
        deviceId: values.deviceId,
        baselineLat: values.baselineLat,
        baselineLng: values.baselineLng,
        establishedBy: "desk_manual",
        status: values.status,
        ...(values.baselineAlt !== undefined ? { baselineAlt: values.baselineAlt } : {}),
        ...(values.notes !== undefined ? { notes: values.notes } : {})
      });
      setBaselines((prev) => {
        const idx = prev.findIndex((x) => x.deviceId === saved.deviceId);
        if (idx >= 0) return prev.map((x) => (x.deviceId === saved.deviceId ? saved : x));
        return [...prev, saved];
      });
      message.success("已保存基线");
      setEdit({ open: false });
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <BaseCard
      title="GNSS 基线"
      className={props.className}
      style={props.style}
      extra={
        <Space>
          <Button
            onClick={() => {
              void refresh();
            }}
          >
            刷新
          </Button>
          <Button
            type="primary"
            disabled={!devices.length}
            onClick={() => {
              openCreate();
            }}
          >
            新建基线
          </Button>
        </Space>
      }
    >
      {loading ? (
        <Skeleton active />
      ) : !rows.length ? (
        <div style={{ color: "rgba(148,163,184,0.9)", padding: "20px 4px" }}>当前没有 GNSS 设备接入，未归档数据不会显示在当前视图。</div>
      ) : (
        <div className="desk-dark-table">
          <Table<(typeof rows)[number]>
            rowKey="deviceId"
            dataSource={rows}
            pagination={{ pageSize: 8 }}
            columns={[
              {
                title: "设备",
                dataIndex: "deviceName",
                render: (_: unknown, row) => (
                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.96)" }}>{row.deviceName}</div>
                    <div style={{ fontSize: 12, color: "rgba(148,163,184,0.9)" }}>{row.stationName}</div>
                  </div>
                )
              },
              {
                title: "状态",
                dataIndex: "baseline",
                render: (baseline?: Baseline) => baselineStatusTag(baseline?.status ?? "missing")
              },
              {
                title: "基线坐标",
                dataIndex: "baseline",
                render: (baseline?: Baseline) =>
                  baseline ? (
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                      {baseline.baselineLat.toFixed(6)}, {baseline.baselineLng.toFixed(6)}
                    </span>
                  ) : (
                    <span style={{ color: "rgba(148,163,184,0.9)" }}>-</span>
                  )
              },
              {
                title: "建立时间",
                dataIndex: "baseline",
                render: (baseline?: Baseline) =>
                  baseline ? dayjs(baseline.establishedTime).format("YYYY-MM-DD HH:mm") : <span style={{ color: "rgba(148,163,184,0.9)" }}>-</span>
              },
              {
                title: "操作",
                key: "actions",
                render: (_: unknown, row) => {
                  const has = !!row.baseline;
                  return (
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          if (row.baseline) openEdit(row.baseline);
                          else openCreate(row.deviceId);
                        }}
                      >
                        {has ? "编辑" : "设置"}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setLoading(true);
                          void api.baselines
                            .autoEstablish({ deviceId: row.deviceId })
                            .then((b) => {
                              setBaselines((prev) => {
                                const idx = prev.findIndex((x) => x.deviceId === b.deviceId);
                                if (idx >= 0) return prev.map((x) => (x.deviceId === b.deviceId ? b : x));
                                return [...prev, b];
                              });
                              message.success("已自动建立基线");
                            })
                            .catch((err: unknown) => {
                              message.error((err as Error).message);
                            })
                            .finally(() => {
                              setLoading(false);
                            });
                        }}
                      >
                        自动
                      </Button>
                      <Popconfirm
                        title="确认删除该基线？"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => {
                          void api.baselines
                            .remove({ deviceId: row.deviceId })
                            .then(() => {
                              setBaselines((prev) => prev.filter((x) => x.deviceId !== row.deviceId));
                              message.success("已删除");
                            })
                            .catch((err: unknown) => {
                              message.error((err as Error).message);
                            });
                        }}
                      >
                        <Button size="small" danger disabled={!has}>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  );
                }
              }
            ]}
          />
        </div>
      )}

      <Modal
        title={edit.open && edit.mode === "edit" ? "编辑基线" : "新建基线"}
        open={edit.open}
        onCancel={() => {
          setEdit({ open: false });
        }}
        onOk={() => {
          void handleSave();
        }}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="deviceId" label="设备" rules={[{ required: true }]}>
            <Select
              disabled={edit.open && edit.mode === "edit"}
              placeholder="请选择 GNSS 设备"
              options={devices.map((d) => ({ label: `${d.name}（${d.stationName}）`, value: d.id }))}
            />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="baselineLat" label="纬度" rules={[{ required: true }]}>
              <InputNumber style={{ width: "100%" }} precision={6} placeholder="例如 30.123456" />
            </Form.Item>
            <Form.Item name="baselineLng" label="经度" rules={[{ required: true }]}>
              <InputNumber style={{ width: "100%" }} precision={6} placeholder="例如 104.123456" />
            </Form.Item>
          </div>
          <Form.Item name="baselineAlt" label="高程（m）">
            <InputNumber style={{ width: "100%" }} precision={2} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "已建立", value: "active" },
                { label: "草稿", value: "draft" }
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="可填写测量时长、精度等备注" />
          </Form.Item>
        </Form>
      </Modal>
    </BaseCard>
  );
}
