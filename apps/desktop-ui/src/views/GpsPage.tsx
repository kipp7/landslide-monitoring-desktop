import { Col, Row, Select, Skeleton, Statistic, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import type { Baseline, Device, GpsSeries } from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";

export function GpsPage() {
  const api = useApi();
  const [devices, setDevices] = useState<Device[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [days, setDays] = useState<number>(7);
  const [series, setSeries] = useState<GpsSeries | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const run = async () => {
      try {
        const [list, baselineList] = await Promise.all([api.devices.list(), api.baselines.list()]);
        if (abort.signal.aborted) return;
        const baselineIds = new Set(baselineList.map((item) => item.deviceId));
        const gnss = list.filter((d) => d.type === "gnss" && baselineIds.has(d.id));
        setDevices(gnss);
        setBaselines(baselineList);
        setDeviceId((prev) => (prev && baselineIds.has(prev) ? prev : gnss[0]?.id));
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
    if (!deviceId) return;
    const abort = new AbortController();
    setLoading(true);
    const run = async () => {
      try {
        const s = await api.gps.getSeries({ deviceId, days });
        if (abort.signal.aborted) return;
        setSeries(s);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => {
      abort.abort();
    };
  }, [api, days, deviceId]);

  const option = useMemo(() => {
    const pts = series?.points ?? [];
    return {
      backgroundColor: "transparent",
      textStyle: { color: "rgba(226, 232, 240, 0.9)" },
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 18, top: 22, bottom: 58 },
      xAxis: {
        type: "category",
        data: pts.map((p) => dayjs(p.ts).format("MM-DD HH:mm")),
        axisLabel: { rotate: 45, color: "rgba(226, 232, 240, 0.85)" },
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.45)" } },
        splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
      },
      yAxis: {
        type: "value",
        name: "mm",
        nameTextStyle: { color: "rgba(226, 232, 240, 0.85)" },
        axisLabel: { color: "rgba(226, 232, 240, 0.85)" },
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.45)" } },
        splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
      },
      series: [
        {
          name: "形变(mm)",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: pts.map((p) => p.dispMm),
          lineStyle: { width: 2, color: "#22d3ee" },
          areaStyle: { color: "rgba(34, 211, 238, 0.12)" }
        }
      ]
    };
  }, [series]);

  const lastValue = series?.points.at(-1)?.dispMm ?? 0;

  return (
    <div className="desk-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226,232,240,0.96)" }}>
            地质形变监测
          </Typography.Title>
          <Typography.Text type="secondary">GNSS 形变曲线</Typography.Text>
        </div>
      </div>

      <Row gutter={[12, 12]}>
        <Col span={6}>
          <BaseCard title="当前形变">
            {loading ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic value={lastValue} suffix="mm" valueStyle={{ color: "rgba(226,232,240,0.96)" }} />
            )}
          </BaseCard>
        </Col>
        <Col span={6}>
          <BaseCard title="时间窗口">
            <Statistic value={`${String(days)} 天`} valueStyle={{ color: "rgba(226,232,240,0.96)" }} />
          </BaseCard>
        </Col>
        <Col span={12}>
          <BaseCard title="设备选择">
            <Row gutter={12} wrap={false}>
              <Col flex="none">
              <Select
                  value={deviceId}
                  options={devices.map((d) => ({ label: `${d.name}（${d.stationName}）`, value: d.id }))}
                  style={{ width: 360 }}
                  placeholder="选择 GNSS 设备"
                  onChange={(v) => {
                    setDeviceId(v);
                  }}
                />
              </Col>
              <Col flex="none">
                <Select
                  value={days}
                  options={[
                    { label: "7 天", value: 7 },
                    { label: "30 天", value: 30 }
                  ]}
                  style={{ width: 120 }}
                  onChange={(v) => {
                    setDays(v);
                  }}
                />
              </Col>
            </Row>
          </BaseCard>
        </Col>
        <Col span={24}>
          <BaseCard title="形变曲线">
            {loading ? <Skeleton active /> : <ReactECharts option={option} style={{ height: 420 }} />}
          </BaseCard>
        </Col>
      </Row>
    </div>
  );
}
