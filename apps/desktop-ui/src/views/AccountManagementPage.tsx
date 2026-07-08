import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined, UserAddOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";

import type { AccountRole, AccountUser, UserStatus } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { useAuthStore } from "../stores/authStore";
import "./accountManagement.css";

type AccountFormValues = {
  username: string;
  password?: string;
  realName?: string;
  email?: string;
  phone?: string;
  status?: UserStatus;
  roleIds?: string[];
};

type PasswordFormValues = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const statusOptions: Array<{ label: string; value: UserStatus }> = [
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" },
  { label: "锁定", value: "locked" },
];

function statusLabel(status: UserStatus): string {
  if (status === "active") return "启用";
  if (status === "inactive") return "停用";
  return "锁定";
}

function statusColor(status: UserStatus): string {
  if (status === "active") return "green";
  if (status === "inactive") return "default";
  return "red";
}

function roleText(user: AccountUser, rolesById: Map<string, AccountRole>): string {
  if (!user.roles.length) return "未分配";
  return user.roles
    .map((role) => rolesById.get(role.roleId)?.displayName ?? role.displayName ?? role.name)
    .join(" / ");
}

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function readOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

export function AccountManagementPage() {
  const api = useApi();
  const { message, modal } = AntApp.useApp();
  const currentUser = useAuthStore((s) => s.user);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<UserStatus | undefined>();
  const [roleId, setRoleId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AccountUser | null>(null);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; temporaryPassword: string; resetAt: string } | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [form] = Form.useForm<AccountFormValues>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();

  const rolesById = useMemo(() => new Map(roles.map((role) => [role.roleId, role])), [roles]);
  const roleOptions = useMemo(
    () => roles.map((role) => ({ label: role.displayName, value: role.roleId })),
    [roles]
  );
  const defaultRoleId = useMemo(
    () => roles.find((role) => role.name === "user")?.roleId ?? roles[0]?.roleId,
    [roles]
  );

  const loadUsers = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const queryKeyword = readOptionalText(keyword);
      const res = await api.accounts.listUsers({
        page: nextPage,
        pageSize: nextPageSize,
        ...(queryKeyword ? { keyword: queryKeyword } : {}),
        ...(status ? { status } : {}),
        ...(roleId ? { roleId } : {}),
      });
      setUsers(res.list);
      setTotal(res.pagination.total);
      setPage(res.pagination.page);
      setPageSize(res.pagination.pageSize);
    } catch (err) {
      message.error(`账号列表加载失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        const nextRoles = await api.accounts.listRoles();
        setRoles(nextRoles);
      } catch (err) {
        message.error(`角色列表加载失败：${(err as Error).message}`);
      }
    };
    void run();
  }, [api, message]);

  useEffect(() => {
    void loadUsers(1, pageSize);
  }, [api, keyword, status, roleId]);

  const openCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ status: "active", roleIds: defaultRoleId ? [defaultRoleId] : [] });
    setEditorOpen(true);
  };

  const openEdit = (user: AccountUser) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleIds: user.roles.map((role) => role.roleId),
    });
    setEditorOpen(true);
  };

  const submitEditor = async () => {
    const values = await form.validateFields();
    setEditorSubmitting(true);
    try {
      if (editingUser) {
        const realName = readOptionalText(values.realName);
        const email = readOptionalText(values.email);
        const phone = readOptionalText(values.phone);
        await api.accounts.updateUser({
          userId: editingUser.userId,
          ...(realName ? { realName } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(values.status ? { status: values.status } : {}),
          roleIds: values.roleIds ?? [],
        });
        message.success("账号已更新");
      } else {
        const realName = readOptionalText(values.realName);
        const email = readOptionalText(values.email);
        const phone = readOptionalText(values.phone);
        await api.accounts.createUser({
          username: values.username,
          password: values.password ?? "",
          ...(realName ? { realName } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          roleIds: values.roleIds ?? [],
        });
        message.success("账号已注册");
      }
      setEditorOpen(false);
      await loadUsers(1, pageSize);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setEditorSubmitting(false);
    }
  };

  const updateStatus = (user: AccountUser, nextStatus: UserStatus) => {
    modal.confirm({
      title: nextStatus === "active" ? "启用账号" : "停用账号",
      content: `确认将账号 ${user.username} 设置为${statusLabel(nextStatus)}？`,
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        await api.accounts.updateUser({
          userId: user.userId,
          status: nextStatus,
          roleIds: user.roles.map((role) => role.roleId),
        });
        message.success("账号状态已更新");
        await loadUsers(page, pageSize);
      },
    });
  };

  const resetPassword = (user: AccountUser) => {
    modal.confirm({
      title: "重置登录密码",
      content: `确认重置账号 ${user.username} 的密码？系统会生成一次临时密码。`,
      okText: "重置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await api.accounts.resetPassword({ userId: user.userId });
        setResetResult({ username: user.username, temporaryPassword: res.temporaryPassword, resetAt: res.resetAt });
        setResetOpen(true);
        await loadUsers(page, pageSize);
      },
    });
  };

  const submitPasswordChange = async () => {
    const values = await passwordForm.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      message.error("两次输入的新密码不一致");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await api.auth.changePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success("当前账号密码已修改");
      setPasswordOpen(false);
      passwordForm.resetFields();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const activeCount = users.filter((user) => user.status === "active").length;
  const lockedCount = users.filter((user) => user.status === "locked").length;

  return (
    <div className="desk-page desk-account-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226,232,240,0.96)" }}>
            账号管理
          </Typography.Title>
          <Typography.Text type="secondary">管理员创建账号、分配角色、启停用账号与重置密码</Typography.Text>
        </div>
        <Space wrap>
          <Button
            onClick={() => {
              setPasswordOpen(true);
            }}
          >
            修改当前密码
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void loadUsers(page, pageSize);
            }}
          >
            刷新
          </Button>
          <Button type="primary" icon={<UserAddOutlined />} onClick={openCreate}>
            注册新账号
          </Button>
        </Space>
      </div>

      <div className="desk-account-summary">
        <BaseCard title="当前登录">
          <div className="desk-account-kpi-value">{currentUser?.name ?? "未知用户"}</div>
          <div className="desk-account-kpi-label">{currentUser?.role === "admin" ? "管理员权限" : "查看权限"}</div>
        </BaseCard>
        <BaseCard title="本页账号">
          <div className="desk-account-kpi-value">{total}</div>
          <div className="desk-account-kpi-label">符合当前筛选条件</div>
        </BaseCard>
        <BaseCard title="启用账号">
          <div className="desk-account-kpi-value">{activeCount}</div>
          <div className="desk-account-kpi-label">当前页可登录账号</div>
        </BaseCard>
        <BaseCard title="锁定账号">
          <div className="desk-account-kpi-value">{lockedCount}</div>
          <div className="desk-account-kpi-label">需管理员处理</div>
        </BaseCard>
      </div>

      <BaseCard
        title="账号列表"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索账号 / 姓名 / 手机"
              style={{ width: 240 }}
              onSearch={(value) => {
                setKeyword(value);
              }}
            />
            <Select
              allowClear
              placeholder="账号状态"
              style={{ width: 132 }}
              options={statusOptions}
              value={status}
              onChange={(value) => {
                setStatus(value);
              }}
            />
            <Select
              allowClear
              placeholder="角色"
              style={{ width: 150 }}
              options={roleOptions}
              value={roleId}
              onChange={(value) => {
                setRoleId(value);
              }}
            />
          </Space>
        }
      >
        <div className="desk-dark-table desk-account-table">
          <Table<AccountUser>
            rowKey="userId"
            loading={loading}
            dataSource={users}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [12, 20, 50],
              onChange: (nextPage, nextPageSize) => {
                void loadUsers(nextPage, nextPageSize);
              },
            }}
            columns={[
              {
                title: "账号",
                dataIndex: "username",
                width: 150,
                render: (_, user) => (
                  <div>
                    <div className="desk-account-name">{user.username}</div>
                    <div className="desk-account-sub">{user.userId}</div>
                  </div>
                ),
              },
              {
                title: "姓名 / 联系方式",
                width: 210,
                render: (_, user) => (
                  <div>
                    <div>{user.realName || "-"}</div>
                    <div className="desk-account-sub">{user.phone || user.email || "-"}</div>
                  </div>
                ),
              },
              {
                title: "角色",
                width: 170,
                render: (_, user) => roleText(user, rolesById),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 90,
                render: (value: UserStatus) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
              },
              {
                title: "最近登录",
                dataIndex: "lastLoginAt",
                width: 170,
                render: (value: string | null) => formatTime(value),
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 170,
                render: (value: string) => formatTime(value),
              },
              {
                title: "操作",
                width: 230,
                fixed: "right",
                render: (_, user) => (
                  <Space size={6} wrap>
                    <Button size="small" onClick={() => openEdit(user)}>
                      编辑
                    </Button>
                    <Button size="small" onClick={() => resetPassword(user)}>
                      重置密码
                    </Button>
                    {user.status === "active" ? (
                      <Button size="small" danger onClick={() => updateStatus(user, "inactive")}>
                        停用
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => updateStatus(user, "active")}>
                        启用
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
            scroll={{ x: 1200 }}
          />
        </div>
      </BaseCard>

      <Modal
        title={editingUser ? "编辑账号" : "注册新账号"}
        open={editorOpen}
        confirmLoading={editorSubmitting}
        okText={editingUser ? "保存" : "注册"}
        cancelText="取消"
        width={680}
        onOk={() => {
          void submitEditor();
        }}
        onCancel={() => {
          if (!editorSubmitting) setEditorOpen(false);
        }}
      >
        <Form form={form} layout="vertical" className="desk-account-form">
          <Form.Item
            label="登录账号"
            name="username"
            rules={[{ required: true, message: "请输入登录账号" }, { min: 3, message: "账号至少 3 位" }]}
          >
            <Input disabled={Boolean(editingUser)} placeholder="例如 operator01" autoComplete="username" />
          </Form.Item>
          {!editingUser ? (
            <Form.Item
              label="初始密码"
              name="password"
              rules={[{ required: true, message: "请输入初始密码" }, { min: 6, message: "密码至少 6 位" }]}
            >
              <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
            </Form.Item>
          ) : null}
          <div className="desk-account-form-grid">
            <Form.Item label="姓名" name="realName">
              <Input placeholder="真实姓名或岗位名" />
            </Form.Item>
            <Form.Item label="手机号" name="phone">
              <Input placeholder="用于后续告警联系库" />
            </Form.Item>
            <Form.Item label="邮箱" name="email" rules={[{ type: "email", message: "邮箱格式不正确" }]}>
              <Input placeholder="可选" />
            </Form.Item>
            <Form.Item label="状态" name="status">
              <Select options={statusOptions} />
            </Form.Item>
          </div>
          <Form.Item label="角色" name="roleIds" rules={[{ required: true, message: "请选择至少一个角色" }]}>
            <Select mode="multiple" options={roleOptions} placeholder="选择账号角色" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="临时密码已生成"
        open={resetOpen}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
        onOk={() => {
          setResetOpen(false);
          setResetResult(null);
        }}
        onCancel={() => {
          setResetOpen(false);
          setResetResult(null);
        }}
      >
        <Typography.Paragraph style={{ color: "rgba(226,232,240,0.92)" }}>
          账号：{resetResult?.username ?? "-"}
        </Typography.Paragraph>
        <Input readOnly value={resetResult?.temporaryPassword ?? ""} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          生成时间：{formatTime(resetResult?.resetAt)}
        </Typography.Paragraph>
      </Modal>

      <Modal
        title="修改当前密码"
        open={passwordOpen}
        confirmLoading={passwordSubmitting}
        okText="保存"
        cancelText="取消"
        onOk={() => {
          void submitPasswordChange();
        }}
        onCancel={() => {
          if (!passwordSubmitting) setPasswordOpen(false);
        }}
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item label="旧密码" name="oldPassword" rules={[{ required: true, message: "请输入旧密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[{ required: true, message: "请输入新密码" }, { min: 6, message: "密码至少 6 位" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="确认新密码" name="confirmPassword" rules={[{ required: true, message: "请再次输入新密码" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
