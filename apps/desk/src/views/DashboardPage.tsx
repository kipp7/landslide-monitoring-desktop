import { Card, Col, Row, Skeleton, Statistic, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";

import type { DashboardSummary, WeeklyTrend } from "../api/client";
import { useApi } from "../api/ApiProvider";

export function DashboardPage() {
  const api = useApi();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<WeeklyTrend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const run = async () => {
      try {
        const [s, t] = await Promise.all([api.dashboard.getSummary(), api.dashboard.getWeeklyTrend()]);
        if (abort.signal.aborted) return;
        setSummary(s);
        setTrend(t);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => {
      abort.abort();
    };
  }, [api]);

  const option = useMemo(() => {
    const labels = trend?.labels ?? [];
    const rainfallMm = trend?.rainfallMm ?? [];
    const alertCount = trend?.alertCount ?? [];

    return {
      tooltip: { trigger: "axis" },
      grid: { left: 40, right: 20, top: 30, bottom: 40 },
      legend: { data: ["雨量", "预警数"] },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value" },
      series: [
        { name: "雨量", type: "bar", data: rainfallMm, barWidth: 16 },
        { name: "预警数", type: "line", data: alertCount, smooth: true }
      ]
    };
  }, [trend]);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        总览
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            {loading ? <Skeleton active paragraph={false} /> : <Statistic title="监测点" value={summary?.stationCount ?? 0} />}
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            {loading ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic title="在线设备" value={summary?.deviceOnlineCount ?? 0} />
            )}
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            {loading ? <Skeleton active paragraph={false} /> : <Statistic title="今日预警" value={summary?.alertCountToday ?? 0} />}
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            {loading ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic title="系统健康度" value={summary?.systemHealthPercent ?? 0} suffix="%" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card title="一周趋势">
            {loading ? <Skeleton active /> : <ReactECharts option={option} style={{ height: 320 }} />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
