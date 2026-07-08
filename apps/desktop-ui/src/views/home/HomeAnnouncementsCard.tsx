import { BellOutlined, PlusOutlined } from "@ant-design/icons";
import { App as AntApp, Badge, Button, Form, Input, Modal, Select, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BaseCard } from "../../components/BaseCard";
import { getDeskHostInfo, isDeskHost } from "../../native/deskHost";
import { useAuthStore } from "../../stores/authStore";
import {
  announcementLabel,
  createId,
  loadAnnouncementRead,
  loadAnnouncements,
  saveAnnouncementRead,
  saveAnnouncements
} from "./homePersist";
import type { HomeAnnouncement, HomeAnnouncementLevel, HomeAnnouncementPersist } from "./homePersist";

export function HomeAnnouncementsCard(props: { loading: boolean }) {
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? "anon";
  const runningInDeskHost = isDeskHost();
  const hostInfo = getDeskHostInfo();

  const [persist, setPersist] = useState<HomeAnnouncementPersist>(() => loadAnnouncements());
  const [readAtById, setReadAtById] = useState<Record<string, string>>(() => loadAnnouncementRead(userId));
  const [detail, setDetail] = useState<HomeAnnouncement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{
    title: string;
    level: HomeAnnouncementLevel;
    body: string;
    route?: string;
  }>();

  useEffect(() => {
    saveAnnouncements(persist);
  }, [persist]);

  useEffect(() => {
    setReadAtById(loadAnnouncementRead(userId));
  }, [userId]);

  useEffect(() => {
    saveAnnouncementRead(userId, readAtById);
  }, [readAtById, userId]);

  const announcements = useMemo(() => {
    const unique = new Map<string, HomeAnnouncement>();
    for (const a of persist.items) unique.set(a.id, a);
    return Array.from(unique.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  }, [persist.items]);

  const unreadCount = useMemo(() => announcements.filter((a) => !readAtById[a.id]).length, [announcements, readAtById]);

  const markRead = (id: string) => {
    setReadAtById((prev) => ({ ...prev, [id]: new Date().toISOString() }));
  };

  const markAllRead = () => {
    const now = new Date().toISOString();
    const next: Record<string, string> = { ...readAtById };
    for (const a of announcements) next[a.id] = next[a.id] ?? now;
    setReadAtById(next);
    message.success("已全部标为已读");
  };

  const openDetail = (a: HomeAnnouncement) => {
    setDetail(a);
    markRead(a.id);
  };

  const deleteAnnouncement = (id: string) => {
    modal.confirm({
      title: "删除公告",
      content: "该操作只影响当前桌面端的本地公告记录，不会删除后端业务数据。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        setPersist((prev) => ({ ...prev, items: prev.items.filter((a) => a.id !== id) }));
        setReadAtById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        message.success("已删除");
      }
    });
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ level: "info" });
    setCreateOpen(true);
  };

  const createAnnouncement = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const title = values.title.trim();
      const body = values.body.trim();
      const route = values.route?.trim();
      const next: HomeAnnouncement = {
        id: createId("usr:ann:"),
        level: values.level,
        title,
        body,
        createdAt: new Date().toISOString(),
        ...(route ? { route } : {})
      };
      setPersist((prev) => ({ ...prev, items: [next, ...prev.items] }));
      message.success("已发布公告");
      setCreateOpen(false);
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <BaseCard
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <BellOutlined /> 系统公告
          </span>
        }
        extra={
          <Space size={8}>
            <Badge count={unreadCount} size="small" />
            <Button size="small" onClick={markAllRead} disabled={unreadCount <= 0}>
              全部已读
            </Button>
            {user?.role === "admin" ? (
              <Button size="small" icon={<PlusOutlined />} onClick={openCreate}>
                发布
              </Button>
            ) : null}
          </Space>
        }
      >
        <div style={{ padding: 6 }}>
          <Typography.Text type="secondary">
            {runningInDeskHost
              ? `桌面端：${hostInfo?.app?.version ?? "-"} · WebView2：${hostInfo?.webview2?.browserVersion ?? "-"}`
              : "浏览器模式：部分原生能力（托盘/通知/全屏）不可用"}
          </Typography.Text>
        </div>

        <div className="desk-home-ann-list">
          {props.loading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : !announcements.length ? (
            <Typography.Text type="secondary">暂无公告</Typography.Text>
          ) : (
            announcements.map((a) => {
              const read = !!readAtById[a.id];
              const lvl = announcementLabel(a.level);
              return (
                <div className={read ? "desk-home-ann-row is-read" : "desk-home-ann-row"} key={a.id}>
                  <div className="desk-home-ann-main" role="button" tabIndex={0} onClick={() => openDetail(a)}>
                    <div className="desk-home-ann-title">
                      {!read ? <span className="desk-home-ann-dot" /> : null}
                      <span className="t">{a.title}</span>
                      <Tag color={lvl.color}>{lvl.text}</Tag>
                    </div>
                    <div className="desk-home-ann-meta">
                      {new Date(a.createdAt).toLocaleString("zh-CN")}
                      {a.route ? " · 可跳转" : ""}
                    </div>
                  </div>
                  {user?.role === "admin" ? (
                    <div className="desk-home-ann-actions">
                      <Button size="small" danger onClick={() => deleteAnnouncement(a.id)}>
                        删除
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </BaseCard>

      <Modal
        title="发布公告"
        open={createOpen}
        okText="发布"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => {
          void createAnnouncement();
        }}
        onCancel={() => {
          if (!submitting) setCreateOpen(false);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="例如：系统维护通知" />
          </Form.Item>
          <Form.Item name="level" label="级别" rules={[{ required: true, message: "请选择级别" }]}>
            <Select
              options={[
                { value: "info", label: "信息" },
                { value: "warning", label: "提醒" },
                { value: "critical", label: "重要" }
              ]}
            />
          </Form.Item>
          <Form.Item name="route" label="跳转路由（可选）">
            <Input placeholder="例如：/app/gps-monitoring" />
          </Form.Item>
          <Form.Item name="body" label="正文" rules={[{ required: true, message: "请输入正文" }]}>
            <Input.TextArea rows={4} placeholder="公告正文（支持多行）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={detail?.title ?? "公告详情"}
        open={!!detail}
        okText={detail?.route ? "前往" : "关闭"}
        cancelText="关闭"
        onOk={() => {
          if (detail?.route) navigate(detail.route);
          setDetail(null);
        }}
        onCancel={() => setDetail(null)}
      >
        {detail ? (
          <div>
            <Typography.Paragraph style={{ marginBottom: 8, color: "rgba(226,232,240,0.92)" }}>
              {detail.body}
            </Typography.Paragraph>
            <Typography.Text type="secondary">{new Date(detail.createdAt).toLocaleString("zh-CN")}</Typography.Text>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
