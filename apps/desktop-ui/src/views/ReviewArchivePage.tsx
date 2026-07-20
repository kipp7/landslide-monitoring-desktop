import {
  DownloadOutlined,
  EyeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Select, Space, Table, Tag, Tooltip } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AlertLifecycleEvent,
  AlertSeverity,
  AlertSummaryItem,
  Device,
  Station,
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { formatBeijingDateTime } from "../utils/beijingTime";
import { formatInstallLabelDisplay } from "../utils/fieldIdentityDisplay";

import "./reviewArchivePage.css";

type ReviewArchiveRecord = {
  alert: AlertSummaryItem;
  events: AlertLifecycleEvent[];
  resolvedAt: string;
  note: string;
  conclusion: string;
  firstTriggeredAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventNote(event: AlertLifecycleEvent | null | undefined): string {
  const notes = asRecord(event?.evidence).notes;
  return typeof notes === "string" && notes.trim() ? notes.trim() : "未填写复核记录";
}

function parseReviewNote(note: string): { conclusion: string; detail: string } {
  const matched = /^\[复核结论：([^\]]+)\]\s*(.*)$/u.exec(note.trim());
  return matched
    ? { conclusion: matched[1] || "已复核", detail: matched[2] || "未填写补充说明" }
    : { conclusion: "已复核", detail: note || "未填写复核记录" };
}

function severityLabel(severity: AlertSeverity): string {
  if (severity === "critical") return "严重风险";
  if (severity === "high") return "高风险";
  if (severity === "medium") return "中风险";
  return "低风险";
}

function severityColor(severity: AlertSeverity): string {
  if (severity === "critical") return "red";
  if (severity === "high") return "volcano";
  if (severity === "medium") return "gold";
  return "cyan";
}

function lifecycleLabel(eventType: AlertLifecycleEvent["eventType"]): string {
  if (eventType === "ALERT_TRIGGER") return "告警触发";
  if (eventType === "ALERT_UPDATE") return "等级更新";
  if (eventType === "ALERT_ACK") return "进入复核";
  return "完成归档";
}

function durationText(start: string | null, end: string): string {
  if (!start) return "未记录";
  const durationMs = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(durationMs) || durationMs < 0) return "未记录";
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 1) return "不足 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分钟` : `${hours} 小时`;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportArchive(records: ReviewArchiveRecord[], deviceLabel: (deviceId: string | null) => string) {
  const rows = [
    ["档案编号", "节点", "等级", "复核结论", "复核记录", "首次触发", "归档时间", "处置时长", "生命周期事件数"],
    ...records.map((record) => [
      record.alert.alertId,
      deviceLabel(record.alert.deviceId),
      severityLabel(record.alert.severity),
      record.conclusion,
      record.note,
      record.firstTriggeredAt ? formatBeijingDateTime(record.firstTriggeredAt) : "未记录",
      formatBeijingDateTime(record.resolvedAt),
      durationText(record.firstTriggeredAt, record.resolvedAt),
      record.events.length,
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `告警复核档案-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReviewArchivePage() {
  const api = useApi();
  const requestSequence = useRef(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [severity, setSeverity] = useState<AlertSeverity | undefined>();
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<ReviewArchiveRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ resolved: 0, high: 0, critical: 0 });
  const [devices, setDevices] = useState<Device[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ReviewArchiveRecord | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const [alertResult, deviceResult, stationResult] = await Promise.all([
        api.alerts.list({
          page,
          pageSize,
          status: "resolved",
          ...(severity ? { severity } : {}),
          ...(deviceId ? { deviceId } : {}),
        }),
        api.devices.list(),
        api.stations.list(),
      ]);
      const nextRecords = await Promise.all(
        alertResult.list.map(async (alert): Promise<ReviewArchiveRecord> => {
          try {
            const detail = await api.alerts.getEvents(alert.alertId);
            const events = detail.events.slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
            const resolveEvent = events.filter((event) => event.eventType === "ALERT_RESOLVE").at(-1) ?? null;
            const triggerEvent = events.find((event) => event.eventType === "ALERT_TRIGGER") ?? null;
            const parsed = parseReviewNote(eventNote(resolveEvent));
            return {
              alert,
              events,
              resolvedAt: resolveEvent?.createdAt ?? alert.lastEventAt,
              note: parsed.detail,
              conclusion: parsed.conclusion,
              firstTriggeredAt: triggerEvent?.createdAt ?? null,
            };
          } catch {
            return {
              alert,
              events: [],
              resolvedAt: alert.lastEventAt,
              note: "生命周期事件读取失败",
              conclusion: "记录待补全",
              firstTriggeredAt: null,
            };
          }
        }),
      );
      if (sequence !== requestSequence.current) return;
      setRecords(nextRecords);
      setTotal(alertResult.pagination.total);
      setSummary(alertResult.summary);
      setDevices(deviceResult);
      setStations(stationResult);
      setSelectedRecord((current) =>
        current ? nextRecords.find((record) => record.alert.alertId === current.alert.alertId) ?? nextRecords[0] ?? null : nextRecords[0] ?? null
      );
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setRecords([]);
      setTotal(0);
      setError(loadError instanceof Error ? loadError.message : "复核档案读取失败");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [api, deviceId, page, pageSize, severity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const stationById = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const deviceLabel = useCallback(
    (value: string | null) => {
      if (!value) return "未绑定节点";
      const device = deviceById.get(value);
      return device ? formatInstallLabelDisplay(device.installLabel ?? device.name, device.id) : value;
    },
    [deviceById]
  );
  const stationLabel = useCallback(
    (value: string | null) => {
      if (!value) return "未绑定监测站";
      const station = stationById.get(value);
      return station?.displayName ?? station?.stationName ?? station?.name ?? value;
    },
    [stationById]
  );
  const pageCriticalCount = records.filter((record) => record.alert.severity === "critical").length;
  const representedNodeCount = new Set(records.map((record) => record.alert.deviceId).filter(Boolean)).size;

  const columns: TableProps<ReviewArchiveRecord>["columns"] = [
    {
      title: "归档时间",
      dataIndex: "resolvedAt",
      width: 150,
      render: (_value, record) => <span className="review-archive-mono">{formatBeijingDateTime(record.resolvedAt)}</span>,
    },
    {
      title: "节点 / 监测站",
      key: "target",
      width: 190,
      render: (_value, record) => (
        <div className="review-archive-target">
          <strong>{deviceLabel(record.alert.deviceId)}</strong>
          <span>{stationLabel(record.alert.stationId)}</span>
        </div>
      ),
    },
    {
      title: "最终等级",
      dataIndex: ["alert", "severity"],
      width: 96,
      render: (_value, record) => <Tag color={severityColor(record.alert.severity)}>{severityLabel(record.alert.severity)}</Tag>,
    },
    {
      title: "复核结论",
      dataIndex: "conclusion",
      width: 118,
      render: (value: string) => <strong className="review-archive-conclusion">{value}</strong>,
    },
    {
      title: "复核记录",
      dataIndex: "note",
      ellipsis: true,
      render: (value: string) => <span title={value}>{value}</span>,
    },
    {
      title: "处置时长",
      key: "duration",
      width: 106,
      render: (_value, record) => durationText(record.firstTriggeredAt, record.resolvedAt),
    },
    {
      title: "操作",
      key: "action",
      width: 58,
      render: (_value, record) => (
        <Tooltip title="查看档案">
          <Button
            type="text"
            shape="circle"
            aria-label="查看档案"
            icon={<EyeOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedRecord(record);
            }}
          />
        </Tooltip>
      ),
    },
  ];

  const selectedEvidenceEvent = selectedRecord?.events
    .filter((event) => event.eventType === "ALERT_TRIGGER" || event.eventType === "ALERT_UPDATE")
    .at(-1) ?? null;
  const selectedEvidence = asRecord(selectedEvidenceEvent?.evidence ?? selectedRecord?.alert.evidence);
  const selectedCurrent = asRecord(selectedEvidence.current);
  const selectedBaseline = asRecord(selectedEvidence.baseline);
  const selectedDelta = asRecord(selectedEvidence.delta);

  return (
    <div className="desk-page review-archive-page">
      <header className="review-archive-head">
        <div className="review-archive-title-block">
          <span className="review-archive-title-mark" aria-hidden="true" />
          <div>
            <h1>复核档案</h1>
            <p>已完成处置的真实告警、人工结论与生命周期证据。</p>
          </div>
        </div>
        <Space className="review-archive-actions" size={8} wrap>
          <Button icon={<DownloadOutlined />} disabled={!records.length} onClick={() => exportArchive(records, deviceLabel)}>
            导出
          </Button>
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        </Space>
      </header>

      <section className="review-archive-kpis" aria-label="复核档案统计">
        <div><span>归档记录</span><strong>{total}</strong><em>当前筛选结果</em></div>
        <div><span>严重风险</span><strong className="is-critical">{summary.critical}</strong><em>已完成复核</em></div>
        <div><span>高风险</span><strong className="is-high">{summary.high}</strong><em>已完成复核</em></div>
        <div><span>涉及节点</span><strong>{representedNodeCount}</strong><em>本页严重 {pageCriticalCount} 条</em></div>
      </section>

      <section className="review-archive-workbench">
        <div className="review-archive-list-panel">
          <div className="review-archive-toolbar">
            <div>
              <strong>档案清单</strong>
              <span>点击记录查看完整证据链</span>
            </div>
            <Space size={8} wrap>
              <Select
                allowClear
                placeholder="全部节点"
                value={deviceId}
                style={{ width: 176 }}
                options={devices.map((device) => ({
                  value: device.id,
                  label: formatInstallLabelDisplay(device.installLabel ?? device.name, device.id),
                }))}
                onChange={(value) => { setDeviceId(value); setPage(1); }}
              />
              <Select
                allowClear
                placeholder="全部等级"
                value={severity}
                style={{ width: 126 }}
                options={(["critical", "high", "medium", "low"] as AlertSeverity[]).map((value) => ({
                  value,
                  label: severityLabel(value),
                }))}
                onChange={(value) => { setSeverity(value); setPage(1); }}
              />
            </Space>
          </div>

          {error ? <div className="review-archive-error">{error}</div> : null}
          <Table<ReviewArchiveRecord>
            rowKey={(record) => record.alert.alertId}
            columns={columns}
            dataSource={records}
            loading={loading}
            size="middle"
            scroll={{ x: 960 }}
            locale={{ emptyText: "当前筛选条件下没有已归档的真实告警记录" }}
            rowClassName={(record) => `review-archive-row${selectedRecord?.alert.alertId === record.alert.alertId ? " is-selected" : ""}`}
            onRow={(record) => ({ onClick: () => setSelectedRecord(record) })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              showTotal: (value) => `共 ${value} 条`,
              onChange: setPage,
            }}
          />
        </div>

        <aside className="review-archive-detail-panel" aria-label="所选复核档案详情">
          {selectedRecord ? (
            <div className="review-archive-detail">
              <div className="review-archive-detail-status">
                <div>
                  <Tag color={severityColor(selectedRecord.alert.severity)}>{severityLabel(selectedRecord.alert.severity)}</Tag>
                  <Tag color="green">已归档</Tag>
                </div>
                <span>{formatBeijingDateTime(selectedRecord.resolvedAt)}</span>
              </div>

              <div className="review-archive-detail-head">
                <h2>{deviceLabel(selectedRecord.alert.deviceId)}</h2>
                <p>{selectedRecord.alert.title || "倾角监测告警"}</p>
              </div>

              <div className="review-archive-decision">
                <span>人工复核结论</span>
                <strong>{selectedRecord.conclusion}</strong>
                <p>{selectedRecord.note}</p>
              </div>

              <div className="review-archive-detail-grid">
                <div><span>处置时长</span><strong>{durationText(selectedRecord.firstTriggeredAt, selectedRecord.resolvedAt)}</strong></div>
                <div><span>监测站</span><strong>{stationLabel(selectedRecord.alert.stationId)}</strong></div>
                <div><span>规则版本</span><strong>{selectedRecord.alert.ruleId} · v{selectedRecord.alert.ruleVersion}</strong></div>
                <div><span>档案编号</span><strong title={selectedRecord.alert.alertId}>{selectedRecord.alert.alertId}</strong></div>
              </div>

              <section className="review-archive-evidence">
                <div className="review-archive-section-title">触发证据</div>
                <div className="review-archive-evidence-grid">
                  <div><span>最大偏移</span><strong>{readNumber(selectedEvidence, "maxDeviationDeg")?.toFixed(3) ?? "--"}°</strong></div>
                  <div><span>主变化轴</span><strong>{String(selectedEvidence.maxAxis ?? "--").toUpperCase()}</strong></div>
                  <div><span>当前姿态</span><strong>X {readNumber(selectedCurrent, "x")?.toFixed(3) ?? "--"}° · Y {readNumber(selectedCurrent, "y")?.toFixed(3) ?? "--"}° · Z {readNumber(selectedCurrent, "z")?.toFixed(3) ?? "--"}°</strong></div>
                  <div><span>倾角基线</span><strong>X {readNumber(selectedBaseline, "x")?.toFixed(3) ?? "--"}° · Y {readNumber(selectedBaseline, "y")?.toFixed(3) ?? "--"}° · Z {readNumber(selectedBaseline, "z")?.toFixed(3) ?? "--"}°</strong></div>
                  <div><span>相对偏移</span><strong>X {readNumber(selectedDelta, "x")?.toFixed(3) ?? "--"}° · Y {readNumber(selectedDelta, "y")?.toFixed(3) ?? "--"}° · Z {readNumber(selectedDelta, "z")?.toFixed(3) ?? "--"}°</strong></div>
                </div>
              </section>

              <section>
                <div className="review-archive-section-title">生命周期</div>
                {selectedRecord.events.length ? (
                  <div className="review-archive-lifecycle">
                    {selectedRecord.events.map((event) => (
                      <div key={event.eventId} className={`review-archive-event is-${event.eventType.toLowerCase()}`}>
                        <i />
                        <div>
                          <div><strong>{lifecycleLabel(event.eventType)}</strong><span>{formatBeijingDateTime(event.createdAt)}</span></div>
                          <p>{event.eventType === "ALERT_ACK" || event.eventType === "ALERT_RESOLVE" ? eventNote(event) : severityLabel(event.severity)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="review-archive-detail-empty">生命周期事件暂不可用。</div>
                )}
              </section>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一条档案查看证据链" />
          )}
        </aside>
      </section>
    </div>
  );
}
