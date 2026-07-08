import {
  ApiOutlined,
  DesktopOutlined,
  EnvironmentOutlined,
  RadarChartOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { App as AntApp, Button, Divider, Form, Input, Space, Tabs, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useApi } from "../api/ApiProvider";
import { TerrainBackdrop } from "../components/TerrainBackdrop";
import { mobileLoginEnabled, operatorDebugFeaturesEnabled } from "../config/runtimeFlags";
import { useAuthStore } from "../stores/authStore";
import { useSettingsStore } from "../stores/settingsStore";
import "./login.css";

export function LoginPage() {
  const api = useApi();
  const token = useAuthStore((s) => s.token);
  const setSession = useAuthStore((s) => s.setSession);
  const terrainQuality = useSettingsStore((s) => s.terrainQuality);
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [accountForm] = Form.useForm<{ username: string; password: string }>();
  const [mobileForm] = Form.useForm<{ mobile: string; code: string }>();

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from ?? "/app/home";
  }, [location.state]);

  useEffect(() => {
    if (token) navigate(redirectTo, { replace: true });
  }, [navigate, redirectTo, token]);

  const loginAccount = async (input: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      const res = await api.auth.login(input);
      setSession(res);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const loginMobile = async (input: { mobile: string; code: string }) => {
    setSubmitting(true);
    try {
      const res = await api.auth.login(input);
      setSession(res);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="desk-login">
      <img className="desk-login-bgimg" src="/images/landslide.png" alt="" />
      <div className="desk-login-orb orb-a" aria-hidden="true" />
      <div className="desk-login-orb orb-b" aria-hidden="true" />

      <div className="desk-login-shell">
        <div className="desk-login-terrain-pane" aria-hidden="true">
          <TerrainBackdrop className="desk-login-terrain-canvas" quality={terrainQuality} />
        </div>

        <div className="desk-login-hero">
          <div className="desk-login-brand">
            <div className="desk-login-logo" aria-hidden="true">
              <EnvironmentOutlined />
            </div>
            <div>
              <div className="desk-login-brand-name">山体滑坡监测预警平台</div>
              <div className="desk-login-brand-sub">Landslide Monitoring & Early Warning</div>
            </div>
          </div>

          <div className="desk-login-hero-title">让风险可见，让预警更快</div>
          <div className="desk-login-hero-desc">
            汇聚 GNSS、雨量、倾角、土壤水分、温度与电导率等多源数据，构建监测站态势总览、异常告警与趋势分析，支撑风险研判与处置决策。
          </div>

          <div className="desk-login-features">
            <div className="desk-login-feature">
              <RadarChartOutlined className="desk-login-feature-ico" />
              <div className="desk-login-feature-txt">
                <div className="t">趋势洞察</div>
                <div className="d">实时曲线、阈值分级与预测提示，快速发现变化。</div>
              </div>
            </div>
            <div className="desk-login-feature">
              <DesktopOutlined className="desk-login-feature-ico" />
              <div className="desk-login-feature-txt">
                <div className="t">运维管控</div>
                <div className="d">站点与设备统一管理，状态可追踪，问题可定位。</div>
              </div>
            </div>
            <div className="desk-login-feature">
              <ApiOutlined className="desk-login-feature-ico" />
              <div className="desk-login-feature-txt">
                <div className="t">可扩展对接</div>
                <div className="d">统一接口封装，便于现场接入、边缘扩展与后续能力升级。</div>
              </div>
            </div>
            <div className="desk-login-feature">
              <SafetyCertificateOutlined className="desk-login-feature-ico" />
              <div className="desk-login-feature-txt">
                <div className="t">稳定可信</div>
                <div className="d">统一交互规范与错误兜底，保障关键操作可控可用。</div>
              </div>
            </div>
          </div>

          <div className="desk-login-hero-foot">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前交付形态：Windows 11 桌面端。
            </Typography.Text>
          </div>
        </div>

        <div className="desk-login-panel">
          <div className="desk-login-panel-head">
            <div className="desk-login-panel-title">登录控制台</div>
            <div className="desk-login-panel-desc">请输入账号信息以进入监测与预警控制台</div>
          </div>

          <Tabs
            centered
            defaultActiveKey="account"
            items={[
              {
                key: "account",
                label: "账号登录",
                children: (
                  <Form
                    form={accountForm}
                    layout="vertical"
                    onFinish={(values: { username: string; password: string }) => {
                      void loginAccount(values);
                    }}
                  >
                    <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
                      <Input size="large" placeholder="请输入账号" autoComplete="username" allowClear />
                    </Form.Item>
                    <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                      <Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 8 }}>
                      <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                        登录
                      </Button>
                    </Form.Item>
                  </Form>
                )
              },
              ...(mobileLoginEnabled
                ? [
                    {
                      key: "mobile",
                      label: "手机号登录",
                      children: (
                        <Form
                          form={mobileForm}
                          layout="vertical"
                          onFinish={(values: { mobile: string; code: string }) => {
                            void loginMobile(values);
                          }}
                        >
                          <Form.Item label="手机号" name="mobile" rules={[{ required: true, message: "请输入手机号" }]}>
                            <Input size="large" placeholder="请输入手机号" autoComplete="tel" allowClear />
                          </Form.Item>
                          <Form.Item label="验证码" name="code" rules={[{ required: true, message: "请输入验证码" }]}>
                            <Input size="large" placeholder="请输入验证码" autoComplete="one-time-code" />
                          </Form.Item>
                          <Form.Item style={{ marginBottom: 8 }}>
                            <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                              登录
                            </Button>
                          </Form.Item>
                        </Form>
                      )
                    }
                  ]
                : [])
            ]}
          />

          <Divider style={{ margin: "12px 0", borderColor: "rgba(148,163,184,0.18)" }} />

          <div className="desk-login-panel-foot">
            <Space size={10} wrap>
              {operatorDebugFeaturesEnabled ? (
                <>
                  <Button
                    type="link"
                    onClick={() => {
                      accountForm.setFieldsValue({ username: "admin", password: "123456" });
                      message.success("已填充账号");
                    }}
                  >
                    快速填充
                  </Button>
                  <span className="desk-login-sep" aria-hidden="true" />
                </>
              ) : null}
              <Button
                type="link"
                onClick={() => {
                  message.info("请联系管理员重置密码");
                }}
              >
                忘记密码
              </Button>
              <span className="desk-login-sep" aria-hidden="true" />
              <Button
                type="link"
                onClick={() => {
                  message.info("新账号由管理员在账号管理中注册；如需调整接口地址或权限，请联系管理员处理");
                }}
              >
                注册与登录帮助
              </Button>
            </Space>
          </div>
        </div>
      </div>
    </div>
  );
}
