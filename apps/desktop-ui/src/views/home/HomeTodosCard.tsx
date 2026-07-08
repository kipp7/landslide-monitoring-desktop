import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Checkbox, Form, Input, Modal, Select, Skeleton, Space, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Device, Station } from "../../api/client";
import { BaseCard } from "../../components/BaseCard";
import { buildSystemTasks, createId, loadTodos, priorityLabel, saveTodos } from "./homePersist";
import type { HomeTask, HomeTaskPriority, HomeTodoPersist } from "./homePersist";

export function HomeTodosCard(props: { loading: boolean; stations: Station[]; devices: Device[] }) {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const [persist, setPersist] = useState<HomeTodoPersist>(() => loadTodos());
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{
    title: string;
    priority: HomeTaskPriority;
    stationId?: string;
    deviceId?: string;
    description?: string;
  }>();

  useEffect(() => {
    saveTodos(persist);
  }, [persist]);

  const systemTasks = useMemo(() => buildSystemTasks(props.stations, props.devices), [props.devices, props.stations]);

  const allTasks = useMemo(() => {
    const map = new Map<string, HomeTask>();
    for (const t of systemTasks) map.set(t.id, t);
    for (const t of persist.manualTasks) map.set(t.id, t);
    return Array.from(map.values());
  }, [persist.manualTasks, systemTasks]);

  const rankPriority = (p: HomeTaskPriority) => {
    if (p === "high") return 0;
    if (p === "mid") return 1;
    return 2;
  };

  const pendingTasks = useMemo(() => {
    const list = allTasks
      .filter((t) => !persist.doneAtById[t.id])
      .sort((a, b) => {
        const pa = rankPriority(a.priority);
        const pb = rankPriority(b.priority);
        if (pa !== pb) return pa - pb;
        return b.createdAt.localeCompare(a.createdAt);
      });
    return list.slice(0, 10);
  }, [allTasks, persist.doneAtById]);

  const doneTasks = useMemo(() => {
    const list = allTasks
      .filter((t) => !!persist.doneAtById[t.id])
      .sort((a, b) => {
        const da = persist.doneAtById[a.id] ?? "";
        const db = persist.doneAtById[b.id] ?? "";
        return db.localeCompare(da);
      });
    return list.slice(0, 10);
  }, [allTasks, persist.doneAtById]);

  const toggleTaskDone = (id: string, done: boolean) => {
    setPersist((prev) => {
      const nextDone = { ...prev.doneAtById };
      if (done) nextDone[id] = new Date().toISOString();
      else delete nextDone[id];
      return { ...prev, doneAtById: nextDone };
    });
  };

  const resetTodos = () => {
    modal.confirm({
      title: "重置待处理事项",
      content: "将清空已勾选状态与自定义待办（本地保存）。",
      okText: "重置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        setPersist({ version: 1, manualTasks: [], doneAtById: {} });
        message.success("已重置");
      }
    });
  };

  const goToTask = (task: HomeTask) => {
    if (task.deviceId) {
      const d = props.devices.find((x) => x.id === task.deviceId) ?? null;
      if (d?.type === "gnss") {
        navigate(`/app/gps-monitoring?deviceId=${encodeURIComponent(d.id)}&range=7d&autoRefresh=1`);
        return;
      }
      navigate(`/app/device-management?tab=status&deviceId=${encodeURIComponent(task.deviceId)}`);
      return;
    }

    if (task.stationId) {
      navigate(`/app/device-management?tab=management&stationId=${encodeURIComponent(task.stationId)}`);
      return;
    }

    navigate("/app/analysis");
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ priority: "mid" });
    setCreateOpen(true);
  };

  const createTodo = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const station = values.stationId ? props.stations.find((s) => s.id === values.stationId) ?? null : null;
      const device = values.deviceId ? props.devices.find((d) => d.id === values.deviceId) ?? null : null;
      const title = values.title.trim();
      const description = values.description?.trim();
      const base: HomeTask = {
        id: createId("usr:todo:"),
        source: "manual",
        title,
        category: device ? "device" : station ? "site" : "other",
        priority: values.priority,
        createdAt: new Date().toISOString()
      };

      const next: HomeTask = {
        ...base,
        ...(station ? { stationId: station.id, stationName: station.name } : {}),
        ...(device
          ? {
              deviceId: device.id,
              deviceName: device.name,
              stationId: device.stationId,
              stationName: device.stationName
            }
          : {}),
        ...(description ? { description } : {})
      };
      setPersist((prev) => ({ ...prev, manualTasks: [next, ...prev.manualTasks] }));
      message.success("已添加待办");
      setCreateOpen(false);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderList = (list: HomeTask[]) => {
    if (props.loading) return <Skeleton active paragraph={{ rows: 4 }} />;
    if (!list.length) return <Typography.Text type="secondary">暂无待处理事项</Typography.Text>;

    return list.map((t) => {
      const doneAt = persist.doneAtById[t.id];
      const p = priorityLabel(t.priority);
      return (
        <div className={doneAt ? "desk-home-todo-row is-done" : "desk-home-todo-row"} key={t.id}>
          <Checkbox
            checked={!!doneAt}
            onChange={(e) => {
              toggleTaskDone(t.id, e.target.checked);
            }}
          />
          <div className="desk-home-todo-main">
            <div className="desk-home-todo-title">{t.title}</div>
            <div className="desk-home-todo-tags">
              <Tag className={`desk-pill-tag desk-tone-${t.source === "system" ? "cyan" : "geekblue"}`}>
                {t.source === "system" ? "系统建议" : "我的待办"}
              </Tag>
              <Tag className={`desk-pill-tag desk-tone-${p.color}`}>{p.text}</Tag>
              {t.stationName ? <Tag className="desk-pill-tag desk-tone-blue">{t.stationName}</Tag> : null}
              {t.deviceName ? <Tag className="desk-pill-tag desk-tone-purple">{t.deviceName}</Tag> : null}
            </div>
            <div className="desk-home-todo-meta">
              <span>{t.description ?? "—"}</span>
              {doneAt ? (
                <span> · 完成：{new Date(doneAt).toLocaleString("zh-CN")}</span>
              ) : (
                <span> · 创建：{new Date(t.createdAt).toLocaleString("zh-CN")}</span>
              )}
            </div>
          </div>
          <div className="desk-home-todo-actions">
            <Button
              size="small"
              shape="round"
              className="desk-home-go-btn"
              onClick={() => {
                goToTask(t);
              }}
            >
              前往
            </Button>
          </div>
        </div>
      );
    });
  };

  return (
    <>
      <BaseCard
        title="待处理事项"
        extra={
          <Space size={8}>
            <Button size="small" shape="round" type="primary" className="desk-home-action-primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建
            </Button>
            <Button size="small" shape="round" className="desk-home-action-secondary" icon={<ReloadOutlined />} onClick={resetTodos}>
              重置
            </Button>
          </Space>
        }
      >
        <Tabs
          size="small"
          activeKey={tab}
          onChange={(key) => {
            if (key === "todo" || key === "done") setTab(key);
          }}
          items={[
            { key: "todo", label: `待处理 ${String(pendingTasks.length)}`, children: <div className="desk-home-todo-list">{renderList(pendingTasks)}</div> },
            { key: "done", label: `已完成 ${String(doneTasks.length)}`, children: <div className="desk-home-todo-list">{renderList(doneTasks)}</div> }
          ]}
        />
      </BaseCard>

      <Modal
        title="新建待办"
        open={createOpen}
        okText="添加"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => {
          void createTodo();
        }}
        onCancel={() => {
          if (!submitting) setCreateOpen(false);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="例如：现场巡检滑坡点 A 供电箱" />
          </Form.Item>
          <Form.Item name="priority" label="优先级" rules={[{ required: true, message: "请选择优先级" }]}>
            <Select
              options={[
                { value: "high", label: "高优先" },
                { value: "mid", label: "中优先" },
                { value: "low", label: "低优先" }
              ]}
            />
          </Form.Item>
          <Form.Item name="stationId" label="关联站点（可选）">
            <Select
              allowClear
              placeholder="选择站点"
              options={props.stations.map((s) => ({ value: s.id, label: `${s.name}（${s.area}）` }))}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const stationId = form.getFieldValue("stationId") as string | undefined;
              const options = (stationId ? props.devices.filter((d) => d.stationId === stationId) : props.devices).map((d) => ({
                value: d.id,
                label: `${d.name}（${d.stationName}）`
              }));
              return (
                <Form.Item name="deviceId" label="关联设备（可选）">
                  <Select allowClear placeholder="选择设备" options={options} />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="description" label="说明（可选）">
            <Input.TextArea rows={3} placeholder="补充说明（将展示在待办列表）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
