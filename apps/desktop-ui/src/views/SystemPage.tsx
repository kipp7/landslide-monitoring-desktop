import { App as AntApp, Button, Card, Col, Input, Modal, Row, Select, Skeleton, Space, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type {
  CommandSuccessNotificationPolicyConfig,
  CompetitionTiltProfile,
  Device,
  DeviceStateSnapshot,
  FieldEdgeStatus,
  FieldAlarmStatus,
  OperationLogRow,
  SystemStatus,
  TelemetrySeriesPoint
} from "../api/client";
import { useApi } from "../api/ApiProvider";
import { BaseCard } from "../components/BaseCard";
import { formatInstallLabelDisplay } from "../utils/fieldIdentityDisplay";
import { formatBeijingDateTime } from "../utils/beijingTime";

import "./systemPage.css";

function policyLabel(value: "silent" | "always_notify"): string {
  return value === "always_notify" ? "成功后通知" : "静默记录";
}

function operationStatusLabel(value: string | null | undefined): string {
  if (value === "success") return "成功";
  if (value === "failed") return "失败";
  if (value === "pending") return "处理中";
  return value || "-";
}

function commandTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    set_config: "下发配置",
    reboot: "重启设备",
    restart_device: "重启设备",
    deactivate_device: "停用设备",
    set_sampling_interval: "设置采样间隔",
    manual_collect: "手动采集",
    motor_start: "启动电机",
    motor_stop: "停止电机",
    buzzer_on: "现场告警终端启动",
    buzzer_off: "现场告警终端停止",
    "huawei:reboot": "华为 IoT 重启"
  };
  const label = labels[value];
  return label ? `${label}（${value}）` : value;
}

function healthLabel(status: SystemStatus["items"][number]["status"]): string {
  if (status === "healthy") return "健康";
  if (status === "degraded") return "降级";
  if (status === "not_configured") return "未配置";
  return "未知";
}

function healthAccent(status: SystemStatus["items"][number]["status"]): string {
  if (status === "healthy") return "#22c55e";
  if (status === "degraded") return "#f59e0b";
  if (status === "not_configured") return "#60a5fa";
  return "#94a3b8";
}

function healthTag(status: SystemStatus["items"][number]["status"]) {
  const color =
    status === "healthy" ? "green" : status === "degraded" ? "orange" : status === "not_configured" ? "blue" : "default";
  return <Tag color={color}>{healthLabel(status)}</Tag>;
}

function serviceRoleLabel(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized.includes("postgres")) return "业务状态库";
  if (normalized.includes("clickhouse")) return "遥测明细仓库";
  if (normalized.includes("kafka")) return "遥测消息总线";
  return "平台依赖服务";
}

function serviceScopeLabel(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized.includes("postgres")) return "设备 / 站点 / 命令 / 策略";
  if (normalized.includes("clickhouse")) return "原始遥测 / 历史查询 / 回放证据";
  if (normalized.includes("kafka")) return "采集入站 / 异步处理 / 削峰缓冲";
  return "运行依赖 / 健康检查";
}

function edgeLevelLabel(level: string | null | undefined): string {
  if (level === "healthy") return "健康";
  if (level === "degraded") return "降级";
  if (level === "attention") return "关注";
  if (level === "critical") return "严重";
  if (level === "offline") return "离线";
  return "未知";
}

function edgeLevelColor(level: string | null | undefined): string {
  if (level === "healthy") return "#22c55e";
  if (level === "degraded") return "#f59e0b";
  if (level === "attention") return "#f59e0b";
  if (level === "critical") return "#ef4444";
  if (level === "offline") return "#94a3b8";
  return "#38bdf8";
}

function edgeLevelTag(level: string | null | undefined) {
  const color =
    level === "healthy"
      ? "green"
      : level === "attention" || level === "degraded"
        ? "orange"
        : level === "critical"
          ? "red"
        : level === "offline"
          ? "default"
          : "blue";
  return <Tag color={color}>{edgeLevelLabel(level)}</Tag>;
}

function edgeNodeTag(status: string) {
  const normalized = status.trim().toLowerCase();
  const color =
    normalized === "online"
      ? "green"
      : normalized === "degraded"
        ? "orange"
        : normalized === "offline"
          ? "default"
          : normalized === "configured"
            ? "blue"
            : "purple";
  const label =
    normalized === "online"
      ? "在线"
      : normalized === "degraded"
        ? "降级"
        : normalized === "offline"
          ? "离线"
          : normalized === "configured"
            ? "已配置"
            : status;
  return <Tag color={color}>{label}</Tag>;
}

function boolLabel(value: boolean | null | undefined): string {
  if (value === true) return "是";
  if (value === false) return "否";
  return "未上报";
}

function productStatusDetail(value: string | null | undefined): string {
  if (!value) return "-";
  const normalized = value.trim();
  const labels: Record<string, string> = {
    "RK3568 edge quality summary loaded from latest local report artifacts": "已载入最新 RK3568 边缘链路质量证据",
    "RK3568 edge quality summary is stale; showing last known summary": "RK3568 链路证据待刷新",
    "RK3568 Hermes supervisor report loaded from latest local artifacts": "已载入最新端侧 AI 诊断状态",
    "RK3568 Hermes supervisor report is stale; showing last known edge AI status": "端侧 AI 诊断待刷新",
    "RK3568 Hermes supervisor latest report is missing or unreadable": "暂未读取到端侧 AI 诊断状态"
  };
  return labels[normalized] ?? normalized;
}

function hermesDiagnosisLabel(value: string | null | undefined): string {
  if (!value) return "等待边缘诊断";
  const labels: Record<string, string> = {
    healthy_watch: "链路稳定巡检",
    center_mqtt_route_unreachable: "中心 MQTT 连通性待确认",
    center_mqtt_service_unavailable: "中心 MQTT 服务待确认",
    southbound_serial_or_gateway_gap: "南向采集链路待确认",
    field_nodes_not_reporting: "节点接入待确认",
    shared_port_noise: "串口解析质量待确认",
    ap_fallback_backhaul_degraded: "回传网络状态待确认",
    publish_backlog_pressure: "上行发布压力提示",
    edge_resource_pressure: "端侧资源压力提示"
  };
  return labels[value] ?? value;
}

function hermesDiagnosisTag(value: string | null | undefined, confidenceLevel: string | null | undefined) {
  if (!value) return <Tag color="default">等待诊断</Tag>;
  if (value === "healthy_watch") return <Tag color="green">稳定巡检</Tag>;
  if (confidenceLevel === "high") return <Tag color="orange">高置信提示</Tag>;
  if (confidenceLevel === "medium") return <Tag color="blue">模型提示</Tag>;
  return <Tag color="default">低置信参考</Tag>;
}

function hermesModelTypeLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const labels: Record<string, string> = {
    random_forest_classifier: "随机森林诊断模型"
  };
  return labels[value] ?? value;
}

function hermesModelKeyLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const labels: Record<string, string> = {
    "hermes-edge-diagnosis-rf": "边缘链路诊断模型"
  };
  return labels[value] ?? value;
}

function confidenceLevelLabel(value: string | null | undefined): string {
  if (value === "high") return "高置信";
  if (value === "medium") return "中置信";
  if (value === "low") return "低置信";
  return value || "-";
}

function actionStatusLabel(value: string | null | undefined): string {
  if (value === "completed") return "已完成";
  if (value === "accepted") return "已接纳";
  if (value === "rejected") return "已拒绝";
  if (value === "pending") return "处理中";
  return value || "-";
}

function modelJudgementLabel(value: string | null | undefined): string {
  return `模型判断：${hermesDiagnosisLabel(value)}`;
}

function formatMetric(value: number | null | undefined, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "未上报";
  return `${value}${suffix}`;
}

function metricChartValue(value: number | null | undefined): number | null {
  return value == null || Number.isNaN(value) ? null : value;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "未上报";
  return formatBeijingDateTime(value, undefined, value);
}

type HermesVolatilitySurface = NonNullable<NonNullable<SystemStatus["hermesEdge"]>["volatilitySurface"]>;

type SurfacePresentation = {
  captionTitle: string;
  captionText: string;
  xAxisLabel: string;
  yAxisLabel: string;
  zAxisLabel: string;
  legendLabels: [string, string, string];
  colorMode?: "default" | "tilt-risk";
  warningRatio?: number;
};

function findSurfacePoint(surface: HermesVolatilitySurface, dimensionKey: string, horizonMinutes: number) {
  return surface.points.find((point) => point.dimensionKey === dimensionKey && point.horizonMinutes === horizonMinutes) ?? null;
}

function scoreToThreeColor(score: number, colorMode: SurfacePresentation["colorMode"], warningRatio = 60): THREE.Color {
  if (colorMode === "tilt-risk") {
    if (score >= 100) return new THREE.Color("#ef4444");
    if (score >= warningRatio) return new THREE.Color("#f97316");
    if (score >= warningRatio * 0.6) return new THREE.Color("#facc15");
    if (score >= warningRatio * 0.25) return new THREE.Color("#45d483");
    return new THREE.Color("#67e8f9");
  }
  if (score >= 78) return new THREE.Color("#f6bd60");
  if (score >= 60) return new THREE.Color("#8ab4ff");
  if (score >= 42) return new THREE.Color("#5eead4");
  if (score >= 24) return new THREE.Color("#45d483");
  return new THREE.Color("#67e8f9");
}

function HermesVolatilityThreeSurface({
  surface: incomingSurface,
  presentation
}: {
  surface: HermesVolatilitySurface;
  presentation: SurfacePresentation;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const pendingSurfaceRef = useRef(incomingSurface);
  const interactionActiveRef = useRef(false);
  const viewStateRef = useRef({ yaw: -0.64, pitch: 0.2, zoom: 0.9 });
  const [surface, setSurface] = useState(incomingSurface);

  useEffect(() => {
    pendingSurfaceRef.current = incomingSurface;
    if (!interactionActiveRef.current) setSurface(incomingSurface);
  }, [incomingSurface]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050811, 0.042);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(8.8, 6.45, 10.7);
    camera.lookAt(0, 1.25, 0);
    camera.zoom = viewStateRef.current.zoom;
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xa7d8ff, 0.68);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xe6f7ff, 1.28);
    keyLight.position.set(3.2, 6.8, 4.8);
    scene.add(keyLight);

    const cyanLight = new THREE.PointLight(0x5eead4, 3.8, 18);
    cyanLight.position.set(-4.2, 2.2, 2.8);
    scene.add(cyanLight);

    const amberLight = new THREE.PointLight(0xf6bd60, 2.7, 14);
    amberLight.position.set(2.8, 4.1, -2.8);
    scene.add(amberLight);

    const world = new THREE.Group();
    world.scale.set(0.78, 0.82, 0.78);
    world.position.set(0.12, -0.04, 0);
    scene.add(world);

    const horizons = surface.horizonsMinutes;
    const dimensions = surface.dimensions;
    const colorMode = presentation.colorMode ?? "default";
    const warningRatio = presentation.warningRatio ?? 60;
    const isTiltRiskSurface = colorMode === "tilt-risk";
    const xStep = isTiltRiskSurface
      ? (horizons.length > 8 ? 7.8 : Math.max(1.62, (horizons.length - 1) * 1.62)) / Math.max(1, horizons.length - 1)
      : 1.12;
    const zStep = isTiltRiskSurface
      ? (dimensions.length > 3 ? 5.8 : Math.max(2.36, (dimensions.length - 1) * 1.18)) / Math.max(1, dimensions.length - 1)
      : 0.52;
    const yScale = isTiltRiskSurface ? 0.021 : 0.031;
    const xOffset = ((horizons.length - 1) * xStep) / 2;
    const zOffset = ((dimensions.length - 1) * zStep) / 2;
    const sceneObjects: THREE.Object3D[] = [];
    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];
    const disposableTextures: THREE.Texture[] = [];

    const pointPosition = (horizonIndex: number, dimensionIndex: number) => {
      const horizon = horizons[horizonIndex] ?? 0;
      const dimension = dimensions[dimensionIndex];
      const score = dimension ? findSurfacePoint(surface, dimension.key, horizon)?.volatilityScore ?? 0 : 0;
      return {
        x: horizonIndex * xStep - xOffset,
        y: 0.18 + score * yScale,
        z: dimensionIndex * zStep - zOffset,
        score
      };
    };
    const interpolateSurfacePoint = (u: number, v: number) => {
      const horizonPosition = u * Math.max(1, horizons.length - 1);
      const dimensionPosition = v * Math.max(1, dimensions.length - 1);
      const h0 = Math.min(horizons.length - 1, Math.floor(horizonPosition));
      const h1 = Math.min(horizons.length - 1, h0 + 1);
      const d0 = Math.min(dimensions.length - 1, Math.floor(dimensionPosition));
      const d1 = Math.min(dimensions.length - 1, d0 + 1);
      const tx = horizonPosition - h0;
      const tz = dimensionPosition - d0;
      const score00 = pointPosition(h0, d0).score;
      const score10 = pointPosition(h1, d0).score;
      const score01 = pointPosition(h0, d1).score;
      const score11 = pointPosition(h1, d1).score;
      const upper = THREE.MathUtils.lerp(score00, score10, tx);
      const lower = THREE.MathUtils.lerp(score01, score11, tx);
      const score = THREE.MathUtils.lerp(upper, lower, tz);
      return {
        x: u * Math.max(1, horizons.length - 1) * xStep - xOffset,
        y: 0.18 + score * yScale,
        z: v * Math.max(1, dimensions.length - 1) * zStep - zOffset,
        score
      };
    };
    const addVisualMicrostructure = (point: THREE.Vector3, sampleIndex: number, dimensionIndex: number, strength = 1) => {
      if (isTiltRiskSurface) return point.clone();
      const waveA = Math.sin(sampleIndex * 0.31 + dimensionIndex * 1.17);
      const waveB = Math.cos(sampleIndex * 0.19 + dimensionIndex * 0.73);
      return new THREE.Vector3(
        point.x + waveB * 0.035 * strength,
        point.y + waveA * 0.105 * strength,
        point.z + waveA * 0.075 * strength
      );
    };

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const meshColumns = isTiltRiskSurface ? 33 : horizons.length;
    const meshRows = isTiltRiskSurface ? 25 : dimensions.length;

    for (let d = 0; d < meshRows; d += 1) {
      for (let h = 0; h < meshColumns; h += 1) {
        const p = interpolateSurfacePoint(
          meshColumns <= 1 ? 0 : h / (meshColumns - 1),
          meshRows <= 1 ? 0 : d / (meshRows - 1)
        );
        positions.push(p.x, p.y, p.z);
        const color = scoreToThreeColor(p.score, colorMode, warningRatio);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let d = 0; d < meshRows - 1; d += 1) {
      for (let h = 0; h < meshColumns - 1; h += 1) {
        const a = d * meshColumns + h;
        const b = a + 1;
        const c = (d + 1) * meshColumns + h;
        const e = c + 1;
        indices.push(a, c, b, b, c, e);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    disposableGeometries.push(geometry);

    const surfaceMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: isTiltRiskSurface ? 0.42 : 0.3,
      metalness: isTiltRiskSurface ? 0.18 : 0.1,
      transparent: true,
      opacity: isTiltRiskSurface ? 0.34 : 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    disposableMaterials.push(surfaceMaterial);
    const surfaceMesh = new THREE.Mesh(geometry, surfaceMaterial);
    world.add(surfaceMesh);
    sceneObjects.push(surfaceMesh);

    if (isTiltRiskSurface) {
      const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.13,
        wireframe: true,
        depthWrite: false
      });
      const wireMesh = new THREE.Mesh(geometry, wireMaterial);
      world.add(wireMesh);
      sceneObjects.push(wireMesh);
      disposableMaterials.push(wireMaterial);

      for (let rowIndex = 0; rowIndex <= 8; rowIndex += 1) {
        const v = rowIndex / 8;
        const linePoints = Array.from({ length: 65 }, (_, index) => {
          const point = interpolateSurfacePoint(index / 64, v);
          return new THREE.Vector3(point.x, point.y + 0.012, point.z);
        });
        const averageScore = linePoints.reduce((sum, point) => sum + Math.max(0, (point.y - 0.18) / yScale), 0) / linePoints.length;
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: scoreToThreeColor(averageScore, colorMode, warningRatio),
          transparent: true,
          opacity: rowIndex % 4 === 0 ? 0.72 : 0.3
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        world.add(line);
        sceneObjects.push(line);
        disposableGeometries.push(lineGeometry);
        disposableMaterials.push(lineMaterial);
      }

      for (let columnIndex = 0; columnIndex <= 12; columnIndex += 1) {
        const u = columnIndex / 12;
        const linePoints = Array.from({ length: 49 }, (_, index) => {
          const point = interpolateSurfacePoint(u, index / 48);
          return new THREE.Vector3(point.x, point.y + 0.01, point.z);
        });
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: columnIndex % 6 === 0 ? 0x67e8f9 : 0x60a5fa,
          transparent: true,
          opacity: columnIndex % 6 === 0 ? 0.46 : 0.18
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        world.add(line);
        sceneObjects.push(line);
        disposableGeometries.push(lineGeometry);
        disposableMaterials.push(lineMaterial);
      }
    }

    const floorGeometry = new THREE.PlaneGeometry(6.2, 4.5, 1, 1);
    const floorPlaneMaterial = new THREE.MeshBasicMaterial({
      color: 0x102234,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const floorPlane = new THREE.Mesh(floorGeometry, floorPlaneMaterial);
    floorPlane.rotation.x = -Math.PI / 2;
    floorPlane.position.y = -0.025;
    floorPlane.position.z = 0.08;
    world.add(floorPlane);
    sceneObjects.push(floorPlane);
    disposableGeometries.push(floorGeometry);
    disposableMaterials.push(floorPlaneMaterial);

    const floor = new THREE.GridHelper(6.5, 16, 0x224e67, 0x123044);
    floor.position.y = -0.035;
    const floorMaterial = floor.material as THREE.Material;
    floorMaterial.transparent = true;
    floorMaterial.opacity = 0.3;
    world.add(floor);
    sceneObjects.push(floor);
    disposableGeometries.push(floor.geometry);
    disposableMaterials.push(floorMaterial);

    if (isTiltRiskSurface) {
      [
        { score: warningRatio, color: 0xf97316 },
        { score: 100, color: 0xef4444 }
      ].forEach((threshold) => {
        const thresholdGeometry = new THREE.PlaneGeometry(xOffset * 2 + 0.46, zOffset * 2 + 0.46);
        const thresholdMaterial = new THREE.MeshBasicMaterial({
          color: threshold.color,
          transparent: true,
          opacity: threshold.score === 100 ? 0.05 : 0.035,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const thresholdPlane = new THREE.Mesh(thresholdGeometry, thresholdMaterial);
        thresholdPlane.rotation.x = -Math.PI / 2;
        thresholdPlane.position.y = 0.18 + threshold.score * yScale;
        world.add(thresholdPlane);
        sceneObjects.push(thresholdPlane);
        disposableGeometries.push(thresholdGeometry);
        disposableMaterials.push(thresholdMaterial);

        const thresholdEdgesGeometry = new THREE.EdgesGeometry(thresholdGeometry);
        const thresholdEdgesMaterial = new THREE.LineBasicMaterial({
          color: threshold.color,
          transparent: true,
          opacity: threshold.score === 100 ? 0.5 : 0.32
        });
        const thresholdEdges = new THREE.LineSegments(thresholdEdgesGeometry, thresholdEdgesMaterial);
        thresholdEdges.rotation.x = -Math.PI / 2;
        thresholdEdges.position.y = thresholdPlane.position.y + 0.006;
        world.add(thresholdEdges);
        sceneObjects.push(thresholdEdges);
        disposableGeometries.push(thresholdEdgesGeometry);
        disposableMaterials.push(thresholdEdgesMaterial);
      });
    }

    const axesOrigin = new THREE.Vector3(-xOffset - 0.42, 0, -zOffset - 0.3);
    const axisDefinitions = [
      {
        label: "X",
        direction: new THREE.Vector3(1, 0, 0),
        length: xOffset * 2 + 0.92,
        color: 0xfb7185
      },
      {
        label: "Y",
        direction: new THREE.Vector3(0, 0, 1),
        length: zOffset * 2 + 0.76,
        color: 0x4ade80
      },
      {
        label: "Z",
        direction: new THREE.Vector3(0, 1, 0),
        length: 0.18 + 142 * yScale,
        color: 0x60a5fa
      }
    ] as const;

    axisDefinitions.forEach(({ label, direction, length, color }) => {
      const arrow = new THREE.ArrowHelper(
        direction,
        axesOrigin,
        length,
        color,
        Math.min(0.3, length * 0.12),
        Math.min(0.14, length * 0.06)
      );
      const arrowLineMaterial = arrow.line.material as THREE.LineBasicMaterial;
      const arrowConeMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
      arrowLineMaterial.transparent = true;
      arrowLineMaterial.opacity = 0.84;
      arrowConeMaterial.transparent = true;
      arrowConeMaterial.opacity = 0.94;
      world.add(arrow);
      sceneObjects.push(arrow);
      disposableGeometries.push(arrow.line.geometry, arrow.cone.geometry);
      disposableMaterials.push(arrowLineMaterial, arrowConeMaterial);

      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 96;
      labelCanvas.height = 96;
      const labelContext = labelCanvas.getContext("2d");
      if (!labelContext) return;
      const labelColor = new THREE.Color(color);
      labelContext.fillStyle = "rgba(2, 6, 23, 0.86)";
      labelContext.beginPath();
      labelContext.arc(48, 48, 34, 0, Math.PI * 2);
      labelContext.fill();
      labelContext.lineWidth = 5;
      labelContext.strokeStyle = `#${labelColor.getHexString()}`;
      labelContext.stroke();
      labelContext.fillStyle = "#f8fafc";
      labelContext.font = "700 46px sans-serif";
      labelContext.textAlign = "center";
      labelContext.textBaseline = "middle";
      labelContext.fillText(label, 48, 51);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      labelTexture.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(labelTexture);
      const labelMaterial = new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const labelSprite = new THREE.Sprite(labelMaterial);
      labelSprite.position.copy(axesOrigin).addScaledVector(direction, length + 0.24);
      labelSprite.scale.set(0.42, 0.42, 1);
      labelSprite.renderOrder = 10;
      world.add(labelSprite);
      sceneObjects.push(labelSprite);
      disposableMaterials.push(labelMaterial);
    });

    const dimensionAverages = dimensions
      .map((dimension, index) => {
        const values = horizons
          .map((horizon) => findSurfacePoint(surface, dimension.key, horizon)?.volatilityScore)
          .filter((value): value is number => typeof value === "number");
        return {
          index,
          average: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
        };
      })
      .sort((a, b) => b.average - a.average);
    const highlightedDimensionIndexes = new Set(dimensionAverages.slice(0, 4).map((item) => item.index));
    const pointGeometry = new THREE.SphereGeometry(isTiltRiskSurface ? 0.055 : 0.034, 14, 10);
    disposableGeometries.push(pointGeometry);
    const cloudPositions: number[] = [];
    const cloudColors: number[] = [];
    const dropLinePositions: number[] = [];
    const dropLineColors: number[] = [];

    dimensions.forEach((_, dimensionIndex) => {
      const rawPoints = horizons.map((__, horizonIndex) => pointPosition(horizonIndex, dimensionIndex));
      const curvePoints = rawPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z));
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.42);
      const sampledPoints = isTiltRiskSurface
        ? Array.from({ length: 109 }, (_, index) => {
            const point = interpolateSurfacePoint(index / 108, dimensionIndex / Math.max(1, dimensions.length - 1));
            return new THREE.Vector3(point.x, point.y, point.z);
          })
        : curve.getPoints(108).map((point, index) => addVisualMicrostructure(point, index, dimensionIndex, 1));
      const averageScore = rawPoints.reduce((sum, point) => sum + point.score, 0) / Math.max(1, rawPoints.length);
      const baseColor = scoreToThreeColor(averageScore, colorMode, warningRatio);
      const isHighlighted = highlightedDimensionIndexes.has(dimensionIndex);

      if (!isTiltRiskSurface) {
        sampledPoints.forEach((point, index) => {
          if (index % 2 !== 0) return;
          cloudPositions.push(point.x, point.y, point.z);
          const pointColor = isHighlighted ? baseColor.clone().lerp(new THREE.Color("#ffffff"), 0.18) : baseColor;
          cloudColors.push(pointColor.r, pointColor.g, pointColor.b);

          if (isHighlighted && index % 6 === 0) {
            dropLinePositions.push(point.x, point.y, point.z, point.x, 0.02, point.z);
            dropLineColors.push(baseColor.r, baseColor.g, baseColor.b, baseColor.r, baseColor.g, baseColor.b);
          }
        });
      }

      const lineGeometry = new THREE.BufferGeometry().setFromPoints(sampledPoints);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: isHighlighted ? 0.92 : 0.38
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      world.add(line);
      sceneObjects.push(line);
      disposableGeometries.push(lineGeometry);
      disposableMaterials.push(lineMaterial);

      if (isHighlighted) {
        const visualCurve = new THREE.CatmullRomCurve3(sampledPoints, false, "catmullrom", 0.34);
        const tubeGeometry = new THREE.TubeGeometry(visualCurve, 108, 0.011, 8, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: 0.56,
          depthWrite: false
        });
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        world.add(tube);
        sceneObjects.push(tube);
        disposableGeometries.push(tubeGeometry);
        disposableMaterials.push(tubeMaterial);

        (isTiltRiskSurface ? [] : [-1, 1]).forEach((side) => {
          const companionPoints = sampledPoints.map((point, index) => {
            const lift = Math.sin(index * 0.23 + dimensionIndex) * 0.08 + 0.12;
            return new THREE.Vector3(point.x, point.y + lift, point.z + side * 0.12);
          });
          const companionGeometry = new THREE.BufferGeometry().setFromPoints(companionPoints);
          const companionMaterial = new THREE.LineBasicMaterial({
            color: side > 0 ? 0x8ab4ff : 0x5eead4,
            transparent: true,
            opacity: 0.42
          });
          const companionLine = new THREE.Line(companionGeometry, companionMaterial);
          world.add(companionLine);
          sceneObjects.push(companionLine);
          disposableGeometries.push(companionGeometry);
          disposableMaterials.push(companionMaterial);

          companionPoints.forEach((point, index) => {
            if (index % 2 !== 0) return;
            const companionColor = side > 0 ? new THREE.Color("#8ab4ff") : new THREE.Color("#5eead4");
            cloudPositions.push(point.x, point.y, point.z);
            cloudColors.push(companionColor.r, companionColor.g, companionColor.b);
          });
        });

        const curtainPositions: number[] = [];
        const curtainIndices: number[] = [];
        sampledPoints.forEach((point, index) => {
          curtainPositions.push(point.x, point.y, point.z, point.x, 0.02, point.z);
          if (index < sampledPoints.length - 1) {
            const a = index * 2;
            curtainIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        });
        const curtainGeometry = new THREE.BufferGeometry();
        curtainGeometry.setIndex(curtainIndices);
        curtainGeometry.setAttribute("position", new THREE.Float32BufferAttribute(curtainPositions, 3));
        curtainGeometry.computeVertexNormals();
        const curtainMaterial = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: 0.065,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const curtain = new THREE.Mesh(curtainGeometry, curtainMaterial);
        world.add(curtain);
        sceneObjects.push(curtain);
        disposableGeometries.push(curtainGeometry);
        disposableMaterials.push(curtainMaterial);
      }

      rawPoints.forEach((point) => {
        if (isTiltRiskSurface) {
          cloudPositions.push(point.x, point.y, point.z);
          const actualPointColor = scoreToThreeColor(point.score, colorMode, warningRatio).clone().lerp(new THREE.Color("#ffffff"), 0.16);
          cloudColors.push(actualPointColor.r, actualPointColor.g, actualPointColor.b);
          dropLinePositions.push(point.x, point.y, point.z, point.x, 0.02, point.z);
          dropLineColors.push(
            actualPointColor.r,
            actualPointColor.g,
            actualPointColor.b,
            actualPointColor.r,
            actualPointColor.g,
            actualPointColor.b
          );
        }
        const pointMaterial = new THREE.MeshBasicMaterial({
          color: isTiltRiskSurface ? scoreToThreeColor(point.score, colorMode, warningRatio) : baseColor,
          transparent: true,
          opacity: isTiltRiskSurface ? 1 : isHighlighted ? 0.95 : 0.48
        });
        const dot = new THREE.Mesh(pointGeometry, pointMaterial);
        dot.position.set(point.x, point.y, point.z);
        world.add(dot);
        sceneObjects.push(dot);
        disposableMaterials.push(pointMaterial);

        if (isTiltRiskSurface) {
          const haloGeometry = new THREE.SphereGeometry(0.105, 12, 8);
          const haloMaterial = new THREE.MeshBasicMaterial({
            color: scoreToThreeColor(point.score, colorMode, warningRatio),
            transparent: true,
            opacity: 0.12,
            depthWrite: false
          });
          const halo = new THREE.Mesh(haloGeometry, haloMaterial);
          halo.position.copy(dot.position);
          world.add(halo);
          sceneObjects.push(halo);
          disposableGeometries.push(haloGeometry);
          disposableMaterials.push(haloMaterial);
        }
      });
    });

    horizons.forEach((_, horizonIndex) => {
      const rawPoints = dimensions.map((__, dimensionIndex) => pointPosition(horizonIndex, dimensionIndex));
      const curve = new THREE.CatmullRomCurve3(
        rawPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
        false,
        "catmullrom",
        0.36
      );
      const sampledPoints = isTiltRiskSurface
        ? Array.from({ length: 87 }, (_, index) => {
            const point = interpolateSurfacePoint(horizonIndex / Math.max(1, horizons.length - 1), index / 86);
            return new THREE.Vector3(point.x, point.y, point.z);
          })
        : curve.getPoints(86);
      const averageScore = rawPoints.reduce((sum, point) => sum + point.score, 0) / Math.max(1, rawPoints.length);
      const baseColor = scoreToThreeColor(averageScore, colorMode, warningRatio).lerp(new THREE.Color("#7dd3fc"), 0.18);

      if (horizonIndex === 0 || horizonIndex === Math.floor(horizons.length / 2) || horizonIndex === horizons.length - 1) {
        const slicePositions: number[] = [];
        const sliceIndices: number[] = [];
        sampledPoints.forEach((point, index) => {
          const top = addVisualMicrostructure(point, index, horizonIndex + 9, 0.56);
          slicePositions.push(top.x, top.y, top.z, point.x, 0.02, point.z);
          if (index < sampledPoints.length - 1) {
            const a = index * 2;
            sliceIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        });
        const sliceGeometry = new THREE.BufferGeometry();
        sliceGeometry.setIndex(sliceIndices);
        sliceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(slicePositions, 3));
        sliceGeometry.computeVertexNormals();
        const sliceMaterial = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: horizonIndex === Math.floor(horizons.length / 2) ? 0.085 : 0.052,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const slice = new THREE.Mesh(sliceGeometry, sliceMaterial);
        world.add(slice);
        sceneObjects.push(slice);
        disposableGeometries.push(sliceGeometry);
        disposableMaterials.push(sliceMaterial);
      }
    });

    const cloudGeometry = new THREE.BufferGeometry();
    cloudGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cloudPositions, 3));
    cloudGeometry.setAttribute("color", new THREE.Float32BufferAttribute(cloudColors, 3));
    const cloudMaterial = new THREE.PointsMaterial({
      size: 0.058,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    });
    const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
    world.add(cloud);
    sceneObjects.push(cloud);
    disposableGeometries.push(cloudGeometry);
    disposableMaterials.push(cloudMaterial);

    const dropLineGeometry = new THREE.BufferGeometry();
    dropLineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dropLinePositions, 3));
    dropLineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(dropLineColors, 3));
    const dropLineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.2
    });
    const dropLines = new THREE.LineSegments(dropLineGeometry, dropLineMaterial);
    world.add(dropLines);
    sceneObjects.push(dropLines);
    disposableGeometries.push(dropLineGeometry);
    disposableMaterials.push(dropLineMaterial);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let targetYaw = viewStateRef.current.yaw;
    let currentYaw = targetYaw;
    let targetPitch = viewStateRef.current.pitch;
    let currentPitch = targetPitch;
    let wheelReleaseTimer = 0;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";

    const persistViewState = () => {
      viewStateRef.current = {
        yaw: targetYaw,
        pitch: targetPitch,
        zoom: camera.zoom
      };
    };
    const applyPendingSurface = () => {
      setSurface((current) => pendingSurfaceRef.current === current ? current : pendingSurfaceRef.current);
    };
    const endInteraction = () => {
      interactionActiveRef.current = false;
      persistViewState();
      applyPendingSurface();
    };

    const handlePointerDown = (event: PointerEvent) => {
      isDragging = true;
      interactionActiveRef.current = true;
      targetYaw = currentYaw;
      window.clearTimeout(wheelReleaseTimer);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      targetYaw += deltaX * 0.008;
      targetPitch = clamp(targetPitch + deltaY * 0.006, -0.42, 0.36);
      currentYaw = targetYaw;
      currentPitch = targetPitch;
      world.rotation.set(currentPitch, currentYaw, 0);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    };
    const handlePointerUp = (event: PointerEvent) => {
      isDragging = false;
      renderer.domElement.style.cursor = "grab";
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      endInteraction();
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      interactionActiveRef.current = true;
      window.clearTimeout(wheelReleaseTimer);
      camera.zoom = clamp(camera.zoom + (event.deltaY < 0 ? 0.08 : -0.08), 0.68, 1.45);
      camera.updateProjectionMatrix();
      persistViewState();
      wheelReleaseTimer = window.setTimeout(endInteraction, 450);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });

    let disposed = false;
    let animationFrameId = 0;
    const animate = () => {
      if (disposed) return;
      if (!isDragging) targetYaw += 0.00012;
      currentYaw += (targetYaw - currentYaw) * 0.08;
      currentPitch += (targetPitch - currentPitch) * 0.08;
      world.rotation.set(currentPitch, currentYaw, 0);
      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(wheelReleaseTimer);
      persistViewState();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneObjects.forEach((object) => world.remove(object));
      disposableGeometries.forEach((item) => item.dispose());
      disposableMaterials.forEach((item) => item.dispose());
      disposableTextures.forEach((item) => item.dispose());
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [presentation.colorMode, presentation.warningRatio, surface]);

  return (
    <div className="system-page-volatility-three-wrap">
      <div className="system-page-volatility-three-caption">
        <strong>{presentation.captionTitle}</strong>
        {presentation.captionText ? <span>{presentation.captionText}</span> : null}
      </div>
      <div ref={mountRef} className="system-page-volatility-three" />
      <div className="system-page-volatility-three-legend" aria-label="3D 曲面图例">
        <span>
          <i className="system-page-volatility-legend-dot" />
          {presentation.legendLabels[0]}
        </span>
        <span>
          <i className="system-page-volatility-legend-line" />
          {presentation.legendLabels[1]}
        </span>
        <span>
          <i className="system-page-volatility-legend-plane" />
          {presentation.legendLabels[2]}
        </span>
      </div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-x">{presentation.xAxisLabel}</div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-y">{presentation.yAxisLabel}</div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-z">{presentation.zAxisLabel}</div>
    </div>
  );
}

type RealtimeTiltRow = {
  deviceId: string;
  label: string;
  updatedAt: string | null;
  delta: { x: number; y: number; z: number };
  maxAxis: "x" | "y" | "z";
  maxDeviationDeg: number;
};

const TILT_AXES = ["x", "y", "z"] as const;
const TILT_SENSOR_KEYS = ["tilt_x_deg", "tilt_y_deg", "tilt_z_deg"] as const;
type TiltAxis = (typeof TILT_AXES)[number];
type TiltSensorKey = (typeof TILT_SENSOR_KEYS)[number];
type RealtimeTiltHistoryRow = {
  deviceId: string;
  series: Record<TiltSensorKey, TelemetrySeriesPoint[]>;
};

type RealtimeTiltSurfaceData = {
  surface: HermesVolatilitySurface;
  rows: RealtimeTiltRow[];
  highDeg: number;
  criticalDeg: number;
  peak: RealtimeTiltRow;
  mode: "timeline" | "snapshot";
  sampleFrameCount: number;
  sourcePointCount: number;
  windowStartedAt: string | null;
};

function tiltDeviationToSurfaceScore(deviationDeg: number, criticalDeg: number): number {
  const thresholdRatio = (Math.abs(deviationDeg) / criticalDeg) * 100;
  if (thresholdRatio <= 140) return thresholdRatio;
  return Math.min(340, 140 + Math.log2(thresholdRatio / 140) * 38);
}

function buildRealtimeTiltSurface(
  status: FieldAlarmStatus | null,
  historyRows: RealtimeTiltHistoryRow[]
): RealtimeTiltSurfaceData | null {
  const profile = status?.competitionProfile;
  if (!profile?.enabled || !profile.live?.length || profile.thresholds.criticalDeg <= 0) return null;

  const identityByDeviceId = new Map(profile.devices.map((device) => [device.deviceId, device]));
  const rows = profile.live
    .filter((item): item is typeof item & { deviation: NonNullable<typeof item.deviation> } => item.deviation != null)
    .map((item) => {
      const identity = identityByDeviceId.get(item.deviceId);
      return {
        deviceId: item.deviceId,
        label: formatInstallLabelDisplay(identity?.deviceName ?? item.deviceId, item.deviceId),
        updatedAt: item.updatedAt,
        delta: item.deviation.delta,
        maxAxis: item.deviation.maxAxis,
        maxDeviationDeg: item.deviation.maxDeviationDeg
      } satisfies RealtimeTiltRow;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!rows.length) return null;

  const criticalDeg = profile.thresholds.criticalDeg;
  const snapshotPoints = rows.flatMap((row) =>
    TILT_AXES.map((axis, axisIndex) => ({
      horizonMinutes: axisIndex,
      dimensionKey: row.deviceId,
      volatilityScore: tiltDeviationToSurfaceScore(row.delta[axis], criticalDeg),
      confidence: null,
      diagnosisType: null,
      driver: `${axis.toUpperCase()} 轴相对倾角基线偏移`
    }))
  );
  const peak = rows.reduce((current, row) => (row.maxDeviationDeg > current.maxDeviationDeg ? row : current), rows[0]!);
  const newestUpdatedAt = rows
    .map((row) => row.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? profile.updatedAt;

  const baselineByDeviceId = new Map(profile.devices.map((device) => [device.deviceId, device.baseline]));
  const historyByDeviceId = new Map(historyRows.map((row) => [row.deviceId, row.series]));
  const channels = rows.flatMap((row) =>
    TILT_AXES.map((axis, axisIndex) => {
      const sensorKey = TILT_SENSOR_KEYS[axisIndex]!;
      const capturedAt = Date.parse(profile.devices.find((device) => device.deviceId === row.deviceId)?.capturedAt ?? profile.capturedAt);
      const series = [...(historyByDeviceId.get(row.deviceId)?.[sensorKey] ?? [])]
        .filter((point) => !Number.isFinite(capturedAt) || Date.parse(point.ts) >= capturedAt)
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      return {
        key: `${row.deviceId}:${axis}`,
        label: `${row.label} · ${axis.toUpperCase()}`,
        row,
        axis,
        series
      };
    })
  );
  const referenceChannel = channels.reduce(
    (current, channel) => (channel.series.length < current.series.length ? channel : current),
    channels[0]!
  );
  const cursorByChannel = new Map(channels.map((channel) => [channel.key, -1]));
  const matchedFrames: Array<{
    anchorTs: string;
    samples: Map<string, TelemetrySeriesPoint>;
  }> = [];
  const matchToleranceMs = 2_500;

  for (const referencePoint of referenceChannel.series) {
    const referenceTs = Date.parse(referencePoint.ts);
    if (!Number.isFinite(referenceTs)) continue;
    const candidates: Array<{ channelKey: string; point: TelemetrySeriesPoint; pointIndex: number }> = [];

    for (const channel of channels) {
      const startIndex = (cursorByChannel.get(channel.key) ?? -1) + 1;
      let nearest: { point: TelemetrySeriesPoint; pointIndex: number; distanceMs: number } | null = null;
      for (let index = startIndex; index < channel.series.length; index += 1) {
        const point = channel.series[index]!;
        const pointTs = Date.parse(point.ts);
        if (!Number.isFinite(pointTs)) continue;
        const distanceMs = Math.abs(pointTs - referenceTs);
        if (distanceMs <= matchToleranceMs && (!nearest || distanceMs < nearest.distanceMs)) {
          nearest = { point, pointIndex: index, distanceMs };
        }
        if (pointTs > referenceTs + matchToleranceMs) break;
      }
      if (!nearest) break;
      candidates.push({ channelKey: channel.key, point: nearest.point, pointIndex: nearest.pointIndex });
    }

    if (candidates.length !== channels.length) continue;
    const samples = new Map<string, TelemetrySeriesPoint>();
    for (const candidate of candidates) {
      cursorByChannel.set(candidate.channelKey, candidate.pointIndex);
      samples.set(candidate.channelKey, candidate.point);
    }
    matchedFrames.push({ anchorTs: referencePoint.ts, samples });
  }

  const alignedFrames = matchedFrames.slice(-20);
  const sampleFrameCount = alignedFrames.length;

  if (sampleFrameCount >= 2) {
    const horizons = Array.from({ length: sampleFrameCount }, (_, index) => index);
    let peakScore = 0;
    let peakDimensionKey = channels[0]?.key ?? rows[0]!.deviceId;
    let peakHorizonMinutes = 0;
    const points = channels.flatMap((channel) => {
      const baseline = baselineByDeviceId.get(channel.row.deviceId)?.[channel.axis] ?? 0;
      return alignedFrames.map((frame, index) => {
        const point = frame.samples.get(channel.key)!;
        const score = tiltDeviationToSurfaceScore(point.value - baseline, criticalDeg);
        if (score > peakScore) {
          peakScore = score;
          peakDimensionKey = channel.key;
          peakHorizonMinutes = index;
        }
        return {
          horizonMinutes: index,
          dimensionKey: channel.key,
          volatilityScore: score,
          confidence: null,
          diagnosisType: null,
          driver: `${channel.label} 相对倾角基线偏移`
        };
      });
    });
    const timestamps = alignedFrames.flatMap((frame) => Array.from(frame.samples.values(), (point) => point.ts));
    const sortedTimestamps = timestamps.sort((a, b) => Date.parse(a) - Date.parse(b));
    const generatedAt = sortedTimestamps.at(-1) ?? newestUpdatedAt;

    return {
      rows,
      highDeg: profile.thresholds.highDeg,
      criticalDeg,
      peak,
      mode: "timeline",
      sampleFrameCount,
      sourcePointCount: points.length,
      windowStartedAt: sortedTimestamps[0] ?? null,
      surface: {
        generatedAt,
        surfaceType: "edge_health_volatility_surface",
        method: "realtime_competition_tilt_timeline_v1",
        horizonsMinutes: horizons,
        dimensions: channels.map((channel) => ({ key: channel.key, label: channel.label, unit: "°" })),
        points,
        peakScore,
        peakDimensionKey,
        peakHorizonMinutes,
        modelConfidence: null,
        note: `最近 ${sampleFrameCount} 轮、${points.length} 个倾角历史点。`
      }
    };
  }

  return {
    rows,
    highDeg: profile.thresholds.highDeg,
    criticalDeg,
    peak,
    mode: "snapshot",
    sampleFrameCount: 1,
    sourcePointCount: snapshotPoints.length,
    windowStartedAt: null,
    surface: {
      generatedAt: newestUpdatedAt,
      surfaceType: "edge_health_volatility_surface",
      method: "realtime_competition_tilt_baseline_v1",
      horizonsMinutes: [0, 1, 2],
      dimensions: rows.map((row) => ({ key: row.deviceId, label: row.label, unit: "°" })),
      points: snapshotPoints,
      peakScore: tiltDeviationToSurfaceScore(peak.maxDeviationDeg, criticalDeg),
      peakDimensionKey: peak.deviceId,
      peakHorizonMinutes: TILT_AXES.indexOf(peak.maxAxis),
      modelConfidence: null,
      note: "最近 60 秒历史点尚不足，当前回退为 A/B/C 的真实 X/Y/Z 快照；历史就绪后会自动切换为时序曲面。"
    }
  };
}

function tiltRiskColor(value: number, highDeg: number, criticalDeg: number): string {
  if (value >= criticalDeg) return "#ef4444";
  if (value >= highDeg) return "#f97316";
  return "#22d3ee";
}

function TiltBusinessSurfaceView({ data }: { data: RealtimeTiltSurfaceData | null }) {
  if (!data) {
    return (
      <div className="system-page-edge-detail">
        实时倾角形变曲面正在等待已启用的倾角告警基线与 A/B/C 实时姿态；页面不会使用模拟曲面补位。
      </div>
    );
  }

  const warningRatio = Math.min(100, (data.highDeg / data.criticalDeg) * 100);
  const isTimeline = data.mode === "timeline";
  const summaryCards = [
    { label: "真实节点", value: `${data.rows.length}`, note: "来自现场告警实时状态" },
    {
      label: "真实采样点",
      value: `${data.sourcePointCount}`,
      note: isTimeline ? `${data.sampleFrameCount} 轮 × ${data.surface.dimensions.length} 通道` : "当前三轴快照"
    },
    { label: "峰值偏移", value: `${data.peak.maxDeviationDeg.toFixed(2)}°`, note: `${data.peak.label} · ${data.peak.maxAxis.toUpperCase()} 轴` },
    { label: "高风险阈值", value: `${data.highDeg.toFixed(2)}°`, note: "达到后进入高风险" },
    { label: "严重风险阈值", value: `${data.criticalDeg.toFixed(2)}°`, note: "达到后进入严重风险" },
    {
      label: isTimeline ? "时序范围" : "最新姿态",
      value: isTimeline ? `${formatTimestamp(data.windowStartedAt)} 起` : formatTimestamp(data.surface.generatedAt),
      note: isTimeline ? `更新至 ${formatTimestamp(data.surface.generatedAt)}` : "A/B/C 最新有效时间"
    }
  ];

  return (
    <div className="system-page-volatility">
      <div className="system-page-volatility-head">
        <div>
          <div className="system-page-panel-title">A/B/C 倾角时序 3D 曲面</div>
          <div className="system-page-volatility-subtitle">
            {isTimeline
              ? "沿 X 看时间，沿 Y 找节点和倾角轴，沿 Z 看偏离基线的高度；全部来自 A/B/C 真实上报。"
              : "历史点不足时显示当前快照：沿 X 找倾角轴，沿 Y 找节点，沿 Z 看偏离基线的高度。"}
          </div>
        </div>
        <Space size={8} wrap>
          <Tag color={data.peak.maxDeviationDeg >= data.criticalDeg ? "red" : data.peak.maxDeviationDeg >= data.highDeg ? "orange" : "cyan"}>
            峰值 {data.peak.maxDeviationDeg.toFixed(2)}°
          </Tag>
          <Tag color={isTimeline ? "green" : "gold"}>{isTimeline ? "真实时序" : "实时快照"}</Tag>
          <Tag color="blue">基线相对偏移</Tag>
        </Space>
      </div>

      <div className="system-page-volatility-summary-grid">
        {summaryCards.map((item) => (
          <div key={item.label} className="system-page-volatility-summary-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em title={item.note}>{item.note}</em>
          </div>
        ))}
      </div>

      <div className="system-page-volatility-body">
        <div className="system-page-volatility-stage">
          <div className="system-page-volatility-chart-shell">
            <HermesVolatilityThreeSurface
              surface={data.surface}
              presentation={{
                captionTitle: isTimeline ? "最近 60 秒真实倾角时序" : "当前真实倾角快照",
                captionText: "",
                xAxisLabel: isTimeline ? "X 采样时间（旧 → 新）" : "X 倾角轴（X / Y / Z）",
                yAxisLabel: isTimeline ? "Y 分节点 × 倾角轴" : "Y 正式分节点（A / B / C）",
                zAxisLabel: "Z 相对基线偏移（°）",
                legendLabels: [isTimeline ? "真实历史点" : "真实姿态点", "插值等值线", "告警阈值面"],
                colorMode: "tilt-risk",
                warningRatio
              }}
            />
          </div>
          <div className="system-page-surface-guide" aria-label="3D 曲面读图说明">
            <div className="system-page-surface-guide-axis is-x"><b>X</b><span>采样时间</span><em>旧 → 新</em></div>
            <div className="system-page-surface-guide-axis is-y"><b>Y</b><span>节点 × 倾角轴</span><em>A/B/C · X/Y/Z</em></div>
            <div className="system-page-surface-guide-axis is-z"><b>Z</b><span>相对基线偏移</span><em>越高，偏移越大</em></div>
            <p><strong>读图：</strong>先沿 Y 找到目标通道，再沿 X 看它最近 60 秒的变化，最后用 Z 高度和颜色判断风险等级。</p>
          </div>
        </div>

        <div className="system-page-volatility-side">
          <div className="system-page-volatility-peak">
            <span>当前最大偏移</span>
            <strong>{data.peak.label}</strong>
            <em>{data.peak.maxAxis.toUpperCase()} 轴 · {data.peak.maxDeviationDeg.toFixed(3)}°</em>
          </div>
          <div className="system-page-tilt-thresholds">
            <span><i style={{ background: "#22d3ee" }} />正常区间<strong>&lt; {data.highDeg.toFixed(2)}°</strong></span>
            <span><i style={{ background: "#f97316" }} />高风险<strong>≥ {data.highDeg.toFixed(2)}°</strong></span>
            <span><i style={{ background: "#ef4444" }} />严重风险<strong>≥ {data.criticalDeg.toFixed(2)}°</strong></span>
          </div>
          <div className="system-page-tilt-readings">
            {data.rows.map((row) => (
              <div key={row.deviceId} className="system-page-tilt-reading">
                <div>
                  <span>{row.label}</span>
                  <strong style={{ color: tiltRiskColor(row.maxDeviationDeg, data.highDeg, data.criticalDeg) }}>
                    {row.maxDeviationDeg.toFixed(3)}°
                  </strong>
                </div>
                <p>X {row.delta.x.toFixed(3)}° · Y {row.delta.y.toFixed(3)}° · Z {row.delta.z.toFixed(3)}°</p>
                <em>{formatTimestamp(row.updatedAt)}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function darkAxis() {
  return {
    axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.45)" } },
    axisLabel: { color: "rgba(226, 232, 240, 0.85)" },
    splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
  };
}

function darkTooltip() {
  return {
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    borderColor: "rgba(34, 211, 238, 0.22)",
    textStyle: { color: "rgba(226, 232, 240, 0.92)" }
  };
}

function normalizeIdentityClass(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFormalIdentityClass(value?: string | null): boolean {
  return normalizeIdentityClass(value) === "formal";
}

function deriveLiveNodeStatus(device: Device, lastTelemetryAgeSeconds: number | null): string {
  if (device.status === "offline") return "offline";
  if (device.status === "warning") return "degraded";
  if (lastTelemetryAgeSeconds == null) return "configured";
  if (lastTelemetryAgeSeconds <= 15 * 60) return "online";
  if (lastTelemetryAgeSeconds <= 60 * 60) return "degraded";
  return "offline";
}

function buildLiveFieldEdgeFallback(
  devices: Device[],
  stateByDeviceId: Record<string, DeviceStateSnapshot>,
  now = new Date()
): FieldEdgeStatus | null {
  if (!devices.length) return null;

  const nowMs = now.getTime();
  const nodes = devices
    .map((device) => {
      const snapshot = stateByDeviceId[device.id];
      const updatedAt = snapshot?.updatedAt ?? device.lastSeenAt;
      const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
      const lastTelemetryAgeSeconds = Number.isFinite(updatedMs) ? Math.max(0, Math.round((nowMs - updatedMs) / 1000)) : null;
      return {
        fieldNodeId: device.nodeCode ?? device.installLabel ?? device.name,
        deviceId: device.id,
        installLabel: device.installLabel ?? device.name,
        enabled: null,
        deferred: false,
        status: deriveLiveNodeStatus(device, lastTelemetryAgeSeconds),
        telemetryMessages: null,
        commandForwards: null,
        ackPublishes: null,
        lastTelemetryAgeSeconds,
        lastAckAgeSeconds: null
      };
    })
    .sort((a, b) => a.installLabel.localeCompare(b.installLabel));

  const onlineCount = nodes.filter((node) => node.status === "online").length;
  const degradedCount = nodes.filter((node) => node.status === "degraded").length;
  const offlineCount = nodes.filter((node) => node.status === "offline").length;
  const freshestTelemetryAge = nodes
    .map((node) => node.lastTelemetryAgeSeconds)
    .filter((value): value is number => typeof value === "number")
    .reduce<number | null>((current, value) => (current == null ? value : Math.min(current, value)), null);
  const overallLevel =
    onlineCount > 0
      ? offlineCount > 0
        ? "degraded"
        : degradedCount > 0
          ? "attention"
          : "healthy"
      : degradedCount > 0
        ? "attention"
        : offlineCount > 0
          ? "offline"
          : null;

  return {
    available: true,
    stale: false,
    detail: "未检测到 RK3568 边缘证据文件，当前已切换为基于当前设备最新上报的 API 实时退化视图；该视图不包含板端 ACK/命令转发闭环证据。",
    source: "rk3568_field_link_monitor",
    generatedAt: now.toISOString(),
    currentBoundary: null,
    accepted: null,
    summary: {
      overallLevel,
      score: null,
      deferredNodeIds: [],
      networkMode: "api-live",
      serialOpen: null,
      mqttConnected: null,
      portStatus: null,
      spoolPending: null,
      rejectedMessages: null,
      lastPublishedAgeSeconds: freshestTelemetryAge
    },
    nodes,
    soak: null
  };
}

type PolicyRow = { commandType: string; policy: "silent" | "always_notify" };
type PolicyTemplate = { commandType: string; policy: "silent" | "always_notify"; label: string };
type PolicySnapshot = CommandSuccessNotificationPolicyConfig;
type PolicyChangeDetails = {
  systemDefaultChanged: boolean;
  added: Array<{ commandType: string; policy: "silent" | "always_notify" }>;
  removed: Array<{ commandType: string; policy: "silent" | "always_notify" }>;
  changed: Array<{ commandType: string; before: "silent" | "always_notify"; after: "silent" | "always_notify" }>;
};

const RECOMMENDED_POLICY_DEFAULTS: CommandSuccessNotificationPolicyConfig = {
  systemDefault: "silent",
  commandTypeDefaults: {
    set_config: "always_notify",
    reboot: "always_notify",
    restart_device: "always_notify",
    deactivate_device: "always_notify",
    set_sampling_interval: "always_notify",
    manual_collect: "always_notify",
    "huawei:reboot": "always_notify"
  }
};

const LEGACY_NODE_ALARM_COMMAND_TYPES = new Set(["buzzer_on", "buzzer_off"]);

function stripLegacyNodeAlarmPolicies(
  policy: CommandSuccessNotificationPolicyConfig
): CommandSuccessNotificationPolicyConfig {
  const commandTypeDefaults = Object.fromEntries(
    Object.entries(policy.commandTypeDefaults).filter(([commandType]) => !LEGACY_NODE_ALARM_COMMAND_TYPES.has(commandType))
  ) as Record<string, "silent" | "always_notify">;
  return { ...policy, commandTypeDefaults };
}

const POLICY_TEMPLATES: PolicyTemplate[] = [
  { commandType: "set_config", policy: "always_notify", label: commandTypeLabel("set_config") },
  { commandType: "reboot", policy: "always_notify", label: commandTypeLabel("reboot") },
  { commandType: "restart_device", policy: "always_notify", label: commandTypeLabel("restart_device") },
  { commandType: "deactivate_device", policy: "always_notify", label: commandTypeLabel("deactivate_device") },
  { commandType: "set_sampling_interval", policy: "always_notify", label: commandTypeLabel("set_sampling_interval") },
  { commandType: "manual_collect", policy: "always_notify", label: commandTypeLabel("manual_collect") },
  { commandType: "motor_start", policy: "silent", label: commandTypeLabel("motor_start") },
  { commandType: "motor_stop", policy: "silent", label: commandTypeLabel("motor_stop") },
  { commandType: "huawei:reboot", policy: "always_notify", label: commandTypeLabel("huawei:reboot") }
];

function readPolicySnapshot(value: unknown, key: "previousPolicy" | "nextPolicy"): PolicySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record[key];
  if (!candidate || typeof candidate !== "object") return null;
  const snapshot = candidate as Record<string, unknown>;
  const systemDefault = snapshot.systemDefault;
  const commandTypeDefaults = snapshot.commandTypeDefaults;
  if ((systemDefault !== "silent" && systemDefault !== "always_notify") || !commandTypeDefaults || typeof commandTypeDefaults !== "object") {
    return null;
  }
  const normalized: Record<string, "silent" | "always_notify"> = {};
  for (const [commandType, policy] of Object.entries(commandTypeDefaults as Record<string, unknown>)) {
    if ((policy === "silent" || policy === "always_notify") && commandType.trim()) {
      normalized[commandType] = policy;
    }
  }
  return { systemDefault, commandTypeDefaults: normalized };
}

function summarizePolicyChange(requestData: unknown): string {
  const previousPolicy = readPolicySnapshot(requestData, "previousPolicy");
  const nextPolicy = readPolicySnapshot(requestData, "nextPolicy");
  if (!previousPolicy || !nextPolicy) return "-";

  const parts: string[] = [];
  if (previousPolicy.systemDefault !== nextPolicy.systemDefault) {
    parts.push(`系统默认策略 ${policyLabel(previousPolicy.systemDefault)} -> ${policyLabel(nextPolicy.systemDefault)}`);
  }

  const allKeys = Array.from(
    new Set([...Object.keys(previousPolicy.commandTypeDefaults), ...Object.keys(nextPolicy.commandTypeDefaults)])
  ).sort((a, b) => a.localeCompare(b));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of allKeys) {
    const before = previousPolicy.commandTypeDefaults[key];
    const after = nextPolicy.commandTypeDefaults[key];
    if (!before && after) added.push(`${commandTypeLabel(key)}=${policyLabel(after)}`);
    else if (before && !after) removed.push(`${commandTypeLabel(key)}=${policyLabel(before)}`);
    else if (before && after && before !== after) changed.push(`${commandTypeLabel(key)}: ${policyLabel(before)} -> ${policyLabel(after)}`);
  }

  if (added.length) parts.push(`新增 ${added.join(", ")}`);
  if (changed.length) parts.push(`修改 ${changed.join(", ")}`);
  if (removed.length) parts.push(`移除 ${removed.join(", ")}`);
  return parts.length ? parts.join("；") : "无策略差异";
}

function renderPolicySnapshot(snapshot: PolicySnapshot | null): string {
  if (!snapshot) return "-";
  const rows = Object.entries(snapshot.commandTypeDefaults)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([commandType, policy]) => `  ${commandTypeLabel(commandType)}：${policyLabel(policy)}`);
  return [`系统默认策略：${policyLabel(snapshot.systemDefault)}`, "命令类型默认策略：", ...(rows.length ? rows : ["  无"])].join("\n");
}

async function copyText(text: string): Promise<void> {
  if (!text.trim()) return;
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("当前环境不支持剪贴板");
  }
  await navigator.clipboard.writeText(text);
}

function buildPolicyChangeMarkdown(log: OperationLogRow): string {
  const previousPolicy = readPolicySnapshot(log.requestData, "previousPolicy");
  const nextPolicy = readPolicySnapshot(log.requestData, "nextPolicy");
  const details = diffPolicySnapshots(previousPolicy, nextPolicy);
  const lines = [
    `- 时间：${log.createdAt}`,
    `- 用户：${log.username}`,
    `- 状态：${operationStatusLabel(log.status)}`,
    `- 摘要：${summarizePolicyChange(log.requestData)}`,
    `- 系统默认策略：${
      details?.systemDefaultChanged
        ? `${previousPolicy ? policyLabel(previousPolicy.systemDefault) : "-"} -> ${nextPolicy ? policyLabel(nextPolicy.systemDefault) : "-"}`
        : "无变化"
    }`,
    `- 新增：${details && details.added.length ? details.added.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join(", ") : "无"}`,
    `- 修改：${
      details && details.changed.length
        ? details.changed.map((item) => `${commandTypeLabel(item.commandType)}: ${policyLabel(item.before)} -> ${policyLabel(item.after)}`).join(", ")
        : "无"
    }`,
    `- 移除：${details && details.removed.length ? details.removed.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join(", ") : "无"}`
  ];
  return lines.join("\n");
}

function diffPolicySnapshots(previousPolicy: PolicySnapshot | null, nextPolicy: PolicySnapshot | null): PolicyChangeDetails | null {
  if (!previousPolicy || !nextPolicy) return null;

  const allKeys = Array.from(
    new Set([...Object.keys(previousPolicy.commandTypeDefaults), ...Object.keys(nextPolicy.commandTypeDefaults)])
  ).sort((a, b) => a.localeCompare(b));

  const added: PolicyChangeDetails["added"] = [];
  const removed: PolicyChangeDetails["removed"] = [];
  const changed: PolicyChangeDetails["changed"] = [];

  for (const key of allKeys) {
    const before = previousPolicy.commandTypeDefaults[key];
    const after = nextPolicy.commandTypeDefaults[key];
    if (!before && after) added.push({ commandType: key, policy: after });
    else if (before && !after) removed.push({ commandType: key, policy: before });
    else if (before && after && before !== after) changed.push({ commandType: key, before, after });
  }

  return {
    systemDefaultChanged: previousPolicy.systemDefault !== nextPolicy.systemDefault,
    added,
    removed,
    changed
  };
}

function buildPolicyChangeNotice(log: OperationLogRow): string {
  const previousPolicy = readPolicySnapshot(log.requestData, "previousPolicy");
  const nextPolicy = readPolicySnapshot(log.requestData, "nextPolicy");
  const details = diffPolicySnapshots(previousPolicy, nextPolicy);
  const lines = [
    "命令成功通知默认表已更新",
    `时间：${log.createdAt}`,
    `操作人：${log.username}`,
    `结果：${operationStatusLabel(log.status)}`,
    `变更摘要：${summarizePolicyChange(log.requestData)}`,
    `系统默认策略：${
      details?.systemDefaultChanged
        ? `${previousPolicy ? policyLabel(previousPolicy.systemDefault) : "-"} -> ${nextPolicy ? policyLabel(nextPolicy.systemDefault) : "-"}`
        : "无变化"
    }`,
    `新增条目：${details && details.added.length ? details.added.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join("，") : "无"}`,
    `修改条目：${
      details && details.changed.length
        ? details.changed.map((item) => `${commandTypeLabel(item.commandType)}: ${policyLabel(item.before)} -> ${policyLabel(item.after)}`).join("，")
        : "无"
    }`,
    `移除条目：${details && details.removed.length ? details.removed.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join("，") : "无"}`,
    "请相关运维/产品同学按需确认命令成功通知策略是否符合当前业务预期。"
  ];
  return lines.join("\n");
}

function buildPolicyChangeExportJson(log: OperationLogRow): string {
  const previousPolicy = readPolicySnapshot(log.requestData, "previousPolicy");
  const nextPolicy = readPolicySnapshot(log.requestData, "nextPolicy");
  const details = diffPolicySnapshots(previousPolicy, nextPolicy);
  return JSON.stringify(
    {
      createdAt: log.createdAt,
      username: log.username,
      status: operationStatusLabel(log.status),
      summary: summarizePolicyChange(log.requestData),
      previousPolicy,
      nextPolicy,
      diff: details
    },
    null,
    2
  );
}

export function SystemPage() {
  const api = useApi();
  const { message, modal } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [liveFieldEdge, setLiveFieldEdge] = useState<FieldEdgeStatus | null>(null);
  const [fieldAlarmStatus, setFieldAlarmStatus] = useState<FieldAlarmStatus | null>(null);
  const [tiltHistoryRows, setTiltHistoryRows] = useState<RealtimeTiltHistoryRow[]>([]);
  const [fieldAlarmBusy, setFieldAlarmBusy] = useState<"alarm_on" | "resolve" | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyHistoryLoading, setPolicyHistoryLoading] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<CommandSuccessNotificationPolicyConfig>({
    systemDefault: "silent",
    commandTypeDefaults: {}
  });
  const [policyHistory, setPolicyHistory] = useState<OperationLogRow[]>([]);
  const [policyHistoryTotal, setPolicyHistoryTotal] = useState<number | null>(null);
  const [statusCheckedAt, setStatusCheckedAt] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<OperationLogRow | null>(null);
  const [newCommandType, setNewCommandType] = useState("");
  const [newCommandTypePolicy, setNewCommandTypePolicy] = useState<"silent" | "always_notify">("silent");
  const [selectedTemplate, setSelectedTemplate] = useState<string>();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshStatus = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const [statusResult, deviceListResult, fieldAlarmResult] = await Promise.allSettled([
        api.system.getStatus(),
        api.devices.list(),
        api.fieldAlarm.getStatus()
      ]);
      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
        setStatusCheckedAt(new Date().toISOString());
      } else {
        setStatus(null);
        setStatusCheckedAt(null);
      }

      if (deviceListResult.status === "fulfilled") {
        const formalDevices = deviceListResult.value.filter((device) => isFormalIdentityClass(device.identityClass));
        const stateSettled = await Promise.allSettled(
          formalDevices.map(async (device) => [device.id, await api.devices.getState({ deviceId: device.id })] as const)
        );
        const stateByDeviceId: Record<string, DeviceStateSnapshot> = {};
        for (const entry of stateSettled) {
          if (entry.status !== "fulfilled") continue;
          const [deviceId, snapshot] = entry.value;
          stateByDeviceId[deviceId] = snapshot;
        }
        setLiveFieldEdge(buildLiveFieldEdgeFallback(formalDevices, stateByDeviceId, new Date()));
      } else {
        setLiveFieldEdge(null);
      }

      if (fieldAlarmResult.status === "fulfilled") {
        setFieldAlarmStatus(fieldAlarmResult.value);
      } else {
        setFieldAlarmStatus(null);
      }

      if (!silent && statusResult.status === "rejected" && deviceListResult.status === "rejected" && fieldAlarmResult.status === "rejected") {
        message.error("系统状态与现场设备状态读取失败，请检查 API 服务连接。");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [api, message]);

  const refreshPolicy = useCallback(async () => {
    setPolicyLoading(true);
    try {
      const policy = await api.system.getCommandSuccessNotificationPolicy();
      setPolicyDraft(stripLegacyNodeAlarmPolicies(policy));
    } finally {
      setPolicyLoading(false);
    }
  }, [api]);

  const refreshPolicyHistory = useCallback(async () => {
    setPolicyHistoryLoading(true);
    try {
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const logs = await api.system.getOperationLogs({
        page: 1,
        pageSize: 10,
        module: "system",
        action: "update_command_success_notification_policy",
        startTime,
        endTime
      });
      setPolicyHistory(logs.list);
      setPolicyHistoryTotal(logs.total);
    } finally {
      setPolicyHistoryLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshStatus();
    void refreshPolicy();
    void refreshPolicyHistory();
  }, [refreshPolicy, refreshPolicyHistory, refreshStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void refreshStatus({ silent: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshStatus]);

  const competitionProfile = fieldAlarmStatus?.competitionProfile ?? null;

  useEffect(() => {
    if (!competitionProfile?.enabled || !competitionProfile.devices.length) {
      setTiltHistoryRows([]);
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;
    const refreshTiltHistory = async (profile: CompetitionTiltProfile) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const endMs = Date.now();
        const capturedAtMs = Date.parse(profile.capturedAt);
        const startMs = Math.max(endMs - 60_000, Number.isFinite(capturedAtMs) ? capturedAtMs : 0);
        if (startMs >= endMs) {
          if (!cancelled) setTiltHistoryRows([]);
          return;
        }
        const startTime = new Date(startMs).toISOString();
        const endTime = new Date(endMs).toISOString();
        const settled = await Promise.allSettled(
          profile.devices.map(async (device) => {
            const batch = await api.telemetry.getSeriesBatch({
              deviceId: device.deviceId,
              sensorKeys: [...TILT_SENSOR_KEYS],
              startTime,
              endTime,
              interval: "raw"
            });
            return {
              deviceId: device.deviceId,
              series: {
                tilt_x_deg: batch.tilt_x_deg ?? [],
                tilt_y_deg: batch.tilt_y_deg ?? [],
                tilt_z_deg: batch.tilt_z_deg ?? []
              }
            } satisfies RealtimeTiltHistoryRow;
          })
        );
        if (cancelled) return;
        const nextRows = settled
          .filter((entry): entry is PromiseFulfilledResult<RealtimeTiltHistoryRow> => entry.status === "fulfilled")
          .map((entry) => entry.value);
        setTiltHistoryRows(nextRows);
      } finally {
        inFlight = false;
      }
    };

    void refreshTiltHistory(competitionProfile);
    if (!autoRefresh) return () => { cancelled = true; };
    const timer = window.setInterval(() => {
      void refreshTiltHistory(competitionProfile);
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, autoRefresh, competitionProfile]);

  const policyRows = useMemo<PolicyRow[]>(
    () =>
      Object.entries(policyDraft.commandTypeDefaults)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([commandType, policy]) => ({ commandType, policy })),
    [policyDraft.commandTypeDefaults]
  );

  const serviceItems = useMemo(
    () =>
      status?.items ?? [
        { key: "postgres", label: "PostgreSQL", status: "unknown" as const, detail: "系统状态 API 未返回" },
        { key: "clickhouse", label: "ClickHouse", status: "unknown" as const, detail: "系统状态 API 未返回" },
        { key: "kafka", label: "Kafka", status: "unknown" as const, detail: "系统状态 API 未返回" }
      ],
    [status]
  );

  const rawFieldEdge = status?.fieldEdge ?? null;
  const usingLiveFallback = Boolean(liveFieldEdge) && (!rawFieldEdge || !rawFieldEdge.available || rawFieldEdge.nodes.length === 0);
  const selectedFieldEdge = usingLiveFallback ? liveFieldEdge : rawFieldEdge;
  const fieldEdge =
    selectedFieldEdge && !selectedFieldEdge.stale && (selectedFieldEdge.available || selectedFieldEdge.nodes.length > 0)
      ? selectedFieldEdge
      : null;
  const fieldEdgeUnavailableDetail = selectedFieldEdge && !fieldEdge ? productStatusDetail(selectedFieldEdge.detail) : null;

  const serviceHealthyCount = useMemo(
    () => serviceItems.filter((item) => item.status === "healthy").length,
    [serviceItems]
  );
  const fieldEdgeLevel = fieldEdge?.summary?.overallLevel ?? null;
  const fieldEdgeScore = fieldEdge?.summary?.score ?? null;
  const fieldEdgeCenterDerived = Boolean(
    usingLiveFallback ||
      fieldEdge?.currentBoundary === "center-derived-field-edge-status" ||
      fieldEdge?.detail.includes("中心数据库实时推导")
  );
  const fieldEdgeReportedScore = fieldEdgeCenterDerived ? null : fieldEdgeScore;
  const fieldEdgeActiveNodes = useMemo(
    () => fieldEdge?.nodes.filter((node) => !node.deferred && node.enabled !== false) ?? [],
    [fieldEdge]
  );
  const fieldEdgeOnlineNodeCount = fieldEdgeActiveNodes.filter((node) => node.status.trim().toLowerCase() === "online").length;
  const fieldEdgeDeferredNodeCount = fieldEdge?.nodes.filter((node) => node.deferred || node.enabled === false).length ?? 0;
  const hermesEdge = status?.hermesEdge ?? null;
  const hermesCurrent = hermesEdge?.available && !hermesEdge.stale ? hermesEdge : null;
  const hermesConfidencePercent = hermesCurrent?.confidence == null ? null : Math.round(hermesCurrent.confidence * 1000) / 10;
  const hermesSafetyOk =
    hermesCurrent?.safetyGatewayCoreTouched === false &&
    hermesCurrent.safetySerialTouched === false &&
    hermesCurrent.safetyMqttTouched === false;
  const hermesSafetyReported =
    typeof hermesCurrent?.safetyGatewayCoreTouched === "boolean" &&
    typeof hermesCurrent.safetySerialTouched === "boolean" &&
    typeof hermesCurrent.safetyMqttTouched === "boolean";
  const hermesActionRecheckReported =
    hermesCurrent?.actionRecheckStatus != null || hermesCurrent?.actionRecheckAccepted != null;
  const realtimeTiltSurface = useMemo(
    () => buildRealtimeTiltSurface(fieldAlarmStatus, tiltHistoryRows),
    [fieldAlarmStatus, tiltHistoryRows]
  );
  const systemHealthy =
    serviceItems.length > 0 &&
    serviceHealthyCount === serviceItems.length &&
    fieldEdgeLevel === "healthy";

  const hasNodeTrafficData = Boolean(
    fieldEdge?.nodes.some(
      (node) => node.telemetryMessages != null || node.commandForwards != null || node.ackPublishes != null
    )
  );
  const hasNodeFreshnessData = Boolean(
    fieldEdge?.nodes.some((node) => node.lastTelemetryAgeSeconds != null || node.lastAckAgeSeconds != null)
  );

  const nodeTrafficOption = useMemo(() => {
    const nodes = fieldEdge?.nodes ?? [];
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...darkTooltip() },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: "rgba(226, 232, 240, 0.82)" },
        itemWidth: 10,
        itemHeight: 10
      },
      grid: { left: "4%", right: "4%", top: 42, bottom: 18, containLabel: true },
      xAxis: { type: "category", data: nodes.map((node) => formatInstallLabelDisplay(node.installLabel, node.deviceId)), ...darkAxis() },
      yAxis: { type: "value", ...darkAxis() },
      series: [
        {
          name: "遥测",
          type: "bar",
          barMaxWidth: 24,
          data: nodes.map((node) => metricChartValue(node.telemetryMessages)),
          itemStyle: { color: "rgba(34, 211, 238, 0.8)" }
        },
        {
          name: "转发",
          type: "bar",
          barMaxWidth: 24,
          data: nodes.map((node) => metricChartValue(node.commandForwards)),
          itemStyle: { color: "rgba(96, 165, 250, 0.82)" }
        },
        {
          name: "业务 ACK 发布",
          type: "bar",
          barMaxWidth: 24,
          data: nodes.map((node) => metricChartValue(node.ackPublishes)),
          itemStyle: { color: "rgba(52, 211, 153, 0.82)" }
        }
      ]
    };
  }, [fieldEdge]);

  const nodeFreshnessOption = useMemo(() => {
    const nodes = fieldEdge?.nodes ?? [];
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...darkTooltip() },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: "rgba(226, 232, 240, 0.82)" },
        itemWidth: 10,
        itemHeight: 10
      },
      grid: { left: "4%", right: "4%", top: 42, bottom: 18, containLabel: true },
      xAxis: { type: "category", data: nodes.map((node) => formatInstallLabelDisplay(node.installLabel, node.deviceId)), ...darkAxis() },
      yAxis: {
        type: "value",
        name: "秒",
        nameTextStyle: { color: "rgba(148, 163, 184, 0.85)" },
        ...darkAxis()
      },
      series: [
        {
          name: "最近遥测",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: nodes.map((node) => metricChartValue(node.lastTelemetryAgeSeconds)),
          lineStyle: { width: 2, color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
          areaStyle: { color: "rgba(245, 158, 11, 0.10)" }
        },
        {
          name: "最近 ACK",
          type: "line",
          smooth: true,
          showSymbol: true,
          symbolSize: 8,
          data: nodes.map((node) => metricChartValue(node.lastAckAgeSeconds)),
          lineStyle: { width: 2, color: "#34d399" },
          itemStyle: { color: "#34d399" },
          areaStyle: { color: "rgba(52, 211, 153, 0.08)" }
        }
      ]
    };
  }, [fieldEdge]);

  const savePolicy = async () => {
    setPolicySaving(true);
    try {
      const updated = await api.system.updateCommandSuccessNotificationPolicy(stripLegacyNodeAlarmPolicies(policyDraft));
      setPolicyDraft(stripLegacyNodeAlarmPolicies(updated));
      message.success("已保存命令成功通知默认表");
      await refreshPolicyHistory();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setPolicySaving(false);
    }
  };

  const issueFieldAlarmAction = async (action: "alarm_on" | "resolve") => {
    setFieldAlarmBusy(action);
    try {
      const fieldAlarmActionInput: Parameters<typeof api.fieldAlarm.sendAction>[0] = {
        action,
        reason: action === "alarm_on" ? "系统监控页手动启动 Tongxiao RK2206 告警终端" : "系统监控页人工停止告警终端并解除当前告警"
      };
      if (action === "resolve" && fieldAlarmStatus?.latestAlert?.alertId) {
        fieldAlarmActionInput.alertId = fieldAlarmStatus.latestAlert.alertId;
      }
      const result = await api.fieldAlarm.sendAction(fieldAlarmActionInput);
      if (result.accepted) {
        message.success(action === "alarm_on" ? "Tongxiao RK2206 告警终端已启动" : "告警终端已停止，当前告警已解除");
      } else {
        message.error(`Tongxiao RK2206 未确认告警动作：${result.actuator.lastError ?? "告警终端未连接"}`);
      }
      await refreshStatus({ silent: true });
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setFieldAlarmBusy(null);
    }
  };

  const addPolicyRow = (commandType = newCommandType, policy = newCommandTypePolicy) => {
    const key = commandType.trim();
    if (!key) {
      message.info("命令类型不能为空");
      return;
    }
    if (key.length > 50) {
      message.error("命令类型长度不能超过 50");
      return;
    }
    if (policyDraft.commandTypeDefaults[key]) {
      message.info("该命令类型已存在");
      return;
    }
    setPolicyDraft((prev) => ({
      ...prev,
      commandTypeDefaults: {
        ...prev.commandTypeDefaults,
        [key]: policy
      }
    }));
    setNewCommandType("");
    setNewCommandTypePolicy("silent");
  };

  const restoreRecommendedDefaults = () => {
    setPolicyDraft(stripLegacyNodeAlarmPolicies(RECOMMENDED_POLICY_DEFAULTS));
    message.success("已恢复推荐默认表，请继续保存生效");
  };

  const addTemplateRow = () => {
    const template = POLICY_TEMPLATES.find((item) => item.commandType === selectedTemplate);
    if (!template) {
      message.info("请先选择模板");
      return;
    }
    addPolicyRow(template.commandType, template.policy);
    setSelectedTemplate(undefined);
  };

  return (
    <div className="desk-page system-page">
      <div className="desk-page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: "rgba(226, 232, 240, 0.96)" }}>
            系统监控
          </Typography.Title>
          <Typography.Text type="secondary">核心服务、边缘链路与命令策略的生产运行总览。</Typography.Text>
        </div>
        <Space wrap>
          <Space size={8}>
            <Typography.Text type="secondary">状态 15s · 倾角 5s</Typography.Text>
            <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshStatus()} loading={loading}>
            刷新状态
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshPolicy()} loading={policyLoading}>
            刷新默认表
          </Button>
        </Space>
      </div>

      <section className="system-page-hero" aria-label="系统运行总览">
        <div className="system-page-hero-main">
          <div className="system-page-hero-eyebrow">运行总览</div>
          <div className="system-page-hero-title">
            {systemHealthy ? "系统运行健康" : "系统状态需关注"}
          </div>
          <div className="system-page-hero-sub">
            平台服务 {serviceHealthyCount}/{serviceItems.length} 健康 · 边缘链路 {edgeLevelLabel(fieldEdgeLevel)} · 自动刷新{" "}
            {autoRefresh ? "已开启" : "已关闭"}
          </div>
        </div>
        <div className="system-page-hero-metrics">
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">平台服务</div>
            <div className="system-page-hero-v">
              {serviceHealthyCount}/{serviceItems.length}
            </div>
            <div className="system-page-hero-note">真实健康检查通过数</div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">边缘链路</div>
            <div className="system-page-hero-v" style={{ color: edgeLevelColor(fieldEdgeLevel) }}>
              {edgeLevelLabel(fieldEdgeLevel)}
            </div>
            <div className="system-page-hero-note">
              {fieldEdgeCenterDerived
                ? "中心数据库实时推导"
                : fieldEdgeReportedScore == null
                  ? "RK3568 评分未上报"
                  : `RK3568 上报评分 ${fieldEdgeReportedScore}`}
            </div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">分节点在线</div>
            <div className="system-page-hero-v">
              {fieldEdgeOnlineNodeCount}/{fieldEdgeActiveNodes.length}
            </div>
            <div className="system-page-hero-note">
              仅统计正式分节点{fieldEdgeDeferredNodeCount > 0 ? ` · 预留 ${fieldEdgeDeferredNodeCount}` : ""}
            </div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">Hermes Agent</div>
            <div className="system-page-hero-v" style={{ color: hermesCurrent?.modelLoaded ? "#22d3ee" : "#94a3b8" }}>
              {hermesCurrent?.serviceActive && hermesCurrent.modelLoaded ? "已就绪" : hermesCurrent ? "未就绪" : "未接入"}
            </div>
            <div className="system-page-hero-note">
              {hermesConfidencePercent == null ? "等待模型诊断" : `置信度 ${hermesConfidencePercent}%`}
            </div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">策略记录</div>
            <div className="system-page-hero-v">{formatMetric(policyHistoryTotal)}</div>
            <div className="system-page-hero-note">API 返回的近 30 天总数</div>
          </div>
        </div>
      </section>

      <BaseCard
        title="Tongxiao RK2206 现场告警终端"
        extra={
          <Space size={8} wrap>
            <Tag color={fieldAlarmStatus == null ? "default" : fieldAlarmStatus.actuator.available ? "green" : "orange"}>
              {fieldAlarmStatus == null ? "执行器状态未上报" : fieldAlarmStatus.actuator.available ? "执行器已连接" : "执行器待确认"}
            </Tag>
            <Tag color={fieldAlarmStatus?.active ? "red" : fieldAlarmStatus?.silenced ? "gold" : "default"}>
              {fieldAlarmStatus == null ? "运行状态未上报" : fieldAlarmStatus.active ? "报警中" : fieldAlarmStatus.silenced ? "已停止" : "待命"}
            </Tag>
          </Space>
        }
      >
        <div className="system-page-field-alarm">
          <div className="system-page-field-alarm-main">
            <div className="system-page-field-alarm-title">
              {fieldAlarmStatus == null
                ? "等待现场告警终端状态"
                : fieldAlarmStatus.active
                  ? "服务器正在驱动现场告警终端"
                  : "手动联调云端 -> Tongxiao RK2206 告警链路"}
            </div>
            <div className="system-page-field-alarm-detail">
              {fieldAlarmStatus?.actuator.detail ??
                (fieldAlarmStatus
                  ? "通过中心 API 下发到 Tongxiao RK2206 的蜂鸣器、马达、RGB 与 LCD。"
                  : "当前尚未读取到现场告警终端 API 状态。")}
            </div>
            {fieldAlarmStatus?.actuator.lastActionAt ? (
              <div className="system-page-field-alarm-time">最近动作 {formatTimestamp(fieldAlarmStatus.actuator.lastActionAt)}</div>
            ) : null}
          </div>
          <Space wrap>
            <Button
              danger
              type="primary"
              loading={fieldAlarmBusy === "alarm_on"}
              onClick={() => void issueFieldAlarmAction("alarm_on")}
            >
              启动现场告警
            </Button>
            <Button
              loading={fieldAlarmBusy === "resolve"}
              onClick={() => void issueFieldAlarmAction("resolve")}
            >
              停止现场告警
            </Button>
          </Space>
        </div>
      </BaseCard>

      <div className="system-page-spacer" />

      <div className="system-page-section-head">
        <div>
          <div className="system-page-section-title">平台服务</div>
          <div className="system-page-section-desc">
            {status?.note ?? "等待 API 返回平台服务健康检查；本区不推算 CPU、内存或磁盘占用。"}
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {serviceItems.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.key}>
            <BaseCard title={item.label}>
              {loading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
              ) : (
                <div className="system-page-service-card">
                  <div className="system-page-service-head">
                    <div>
                      <div className="system-page-service-value" style={{ color: healthAccent(item.status) }}>
                        {healthLabel(item.status)}
                      </div>
                      <div className="system-page-service-detail">{item.detail}</div>
                    </div>
                    {healthTag(item.status)}
                  </div>
                  <div className="system-page-service-facts">
                    <span>{serviceRoleLabel(item.key)}</span>
                    <span>{serviceScopeLabel(item.key)}</span>
                  </div>
                  <div className="system-page-service-evidence">
                    <span>最近检查 {formatTimestamp(statusCheckedAt)}</span>
                    <span>数据源：系统状态 API</span>
                  </div>
                </div>
              )}
            </BaseCard>
          </Col>
        ))}
      </Row>

      <div className="system-page-spacer" />

      <div className="system-page-section-head">
        <div>
          <div className="system-page-section-title">边缘链路</div>
          <div className="system-page-section-desc">聚焦 RK3568、现场节点、遥测时效和转发闭环。</div>
        </div>
      </div>

      <BaseCard
        title="RK3568 边缘状态"
        extra={
          fieldEdge ? (
            <Space size={8} wrap>
              {edgeLevelTag(fieldEdge.summary?.overallLevel)}
              {usingLiveFallback ? (
                <Tag color="gold">中心数据库实时推导</Tag>
              ) : fieldEdgeCenterDerived ? (
                <Tag color="gold">中心数据库推导</Tag>
              ) : (
                <Tag color="cyan">RK3568 实时证据</Tag>
              )}
            </Space>
          ) : undefined
        }
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : fieldEdge ? (
          <div className="system-page-edge-wrap">
            <div className="system-page-kpi-grid">
              <div className="system-page-kpi">
                <div className="system-page-kpi-label">链路等级</div>
                <div className="system-page-kpi-value" style={{ color: edgeLevelColor(fieldEdge.summary?.overallLevel) }}>
                  {edgeLevelLabel(fieldEdge.summary?.overallLevel)}
                </div>
                <div className="system-page-kpi-meta">
                  <span>网络 {fieldEdge.summary?.networkMode ?? "未上报"}</span>
                  <span>串口 {fieldEdge.summary?.portStatus ?? "未上报"}</span>
                </div>
                <div className="system-page-kpi-note">离散运行状态，不折算百分比</div>
              </div>

              <div className="system-page-kpi">
                <div className="system-page-kpi-label">RK3568 链路评分</div>
                <div className="system-page-kpi-value">{formatMetric(fieldEdgeReportedScore, "分")}</div>
                <div className="system-page-kpi-meta">
                  <span>串口打开 {boolLabel(fieldEdge.summary?.serialOpen)}</span>
                  <span>MQTT 已连 {boolLabel(fieldEdge.summary?.mqttConnected)}</span>
                </div>
                <div className="system-page-kpi-note">
                  {fieldEdgeCenterDerived ? "中心推导视图不生成板端评分" : `证据生成 ${formatTimestamp(fieldEdge.generatedAt)}`}
                </div>
              </div>

              <div className="system-page-kpi">
                <div className="system-page-kpi-label">缓冲与拒收</div>
                <div className="system-page-kpi-value">{formatMetric(fieldEdge.summary?.spoolPending)}</div>
                <div className="system-page-kpi-meta">
                  <span>缓冲待发</span>
                  <span>拒绝消息 {formatMetric(fieldEdge.summary?.rejectedMessages)}</span>
                </div>
                <div className="system-page-kpi-note">最近发布 {formatMetric(fieldEdge.summary?.lastPublishedAgeSeconds, "s")}</div>
              </div>

              <div className="system-page-kpi">
                <div className="system-page-kpi-label">验收窗口</div>
                <div className="system-page-kpi-value">{boolLabel(fieldEdge.soak?.accepted ?? fieldEdge.accepted)}</div>
                <div className="system-page-kpi-meta">
                  <span>边界 {fieldEdge.soak?.currentBoundary ?? fieldEdge.currentBoundary ?? "未上报"}</span>
                  <span>ACK 全闭环 {boolLabel(fieldEdge.soak?.allAcked)}</span>
                </div>
                <div className="system-page-kpi-note">清洁窗口 {formatMetric(fieldEdge.soak?.cleanWindowRounds)}</div>
              </div>
            </div>

            <div className="system-page-edge-detail">{productStatusDetail(fieldEdge.detail)}</div>

            {hermesCurrent ? (
              <div className="system-page-hermes-card">
                <div className="system-page-hermes-head">
                  <div>
                    <div className="system-page-panel-title">Hermes 端侧智能体</div>
                    <div className="system-page-hermes-title">
                      {modelJudgementLabel(hermesCurrent.diagnosisType)}
                    </div>
                    <div className="system-page-hermes-subtitle">
                      {productStatusDetail(hermesCurrent.detail)} · {formatTimestamp(hermesCurrent.generatedAt)}
                    </div>
                  </div>
                  <Space size={8} wrap>
                    {hermesDiagnosisTag(hermesCurrent.diagnosisType, hermesCurrent.confidenceLevel)}
                    <Tag color={hermesCurrent.serviceActive ? "green" : "default"}>服务 {hermesCurrent.serviceActive ? "运行中" : "待确认"}</Tag>
                    <Tag color={hermesCurrent.modelLoaded ? "cyan" : "default"}>模型 {hermesCurrent.modelLoaded ? "已加载" : "未加载"}</Tag>
                    {hermesSafetyReported ? (
                      <Tag color={hermesSafetyOk ? "green" : "orange"}>主链路保护 {hermesSafetyOk ? "通过" : "异常"}</Tag>
                    ) : null}
                  </Space>
                </div>

                <div className="system-page-hermes-grid">
                  <div className="system-page-hermes-metric">
                    <span>模型</span>
                    <strong>{hermesModelTypeLabel(hermesCurrent.modelType)}</strong>
                    <em>{hermesModelKeyLabel(hermesCurrent.modelKey)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>特征 / 模型数</span>
                    <strong>{formatMetric(hermesCurrent.featureCount)}</strong>
                    <em>模型数 {formatMetric(hermesCurrent.aiModelCount)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>置信度</span>
                    <strong>{hermesConfidencePercent == null ? "未上报" : `${hermesConfidencePercent}%`}</strong>
                    <em>{confidenceLevelLabel(hermesCurrent.confidenceLevel)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>自然语言入口</span>
                    <strong>{boolLabel(hermesCurrent.naturalLanguageReady)}</strong>
                    <em>意图数 {formatMetric(hermesCurrent.intentCount)}</em>
                  </div>
                  {hermesActionRecheckReported ? (
                    <div className="system-page-hermes-metric">
                      <span>安全复检</span>
                      <strong>{actionStatusLabel(hermesCurrent.actionRecheckStatus)}</strong>
                      <em>复检接纳 {boolLabel(hermesCurrent.actionRecheckAccepted)}</em>
                    </div>
                  ) : null}
                  <div className="system-page-hermes-metric">
                    <span>运行验收</span>
                    <strong>{boolLabel(hermesCurrent.accepted)}</strong>
                    <em>{hermesCurrent.currentBoundary ?? "运行边界未上报"}</em>
                  </div>
                </div>

                <div className="system-page-hermes-source">
                  <span>端侧职责</span>
                  <strong>只读链路诊断，不接管采集、串口或 MQTT 主流程</strong>
                  {hermesCurrent.boardHost ? <em>状态源地址 {hermesCurrent.boardHost}</em> : null}
                </div>
              </div>
            ) : (
              <div className="system-page-edge-detail">
                {hermesEdge ? productStatusDetail(hermesEdge.detail) : "当前 API 尚未返回 RK3568 Hermes Agent 实时状态。"}
              </div>
            )}

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <div className="system-page-panel">
                  <div className="system-page-panel-title">节点累计通信计数</div>
                  {hasNodeTrafficData ? (
                    <ReactECharts option={nodeTrafficOption} style={{ height: 320 }} />
                  ) : (
                    <div className="system-page-empty">当前数据源未上报节点累计遥测、命令转发或 ACK 计数。</div>
                  )}
                </div>
              </Col>
              <Col xs={24} xl={12}>
                <div className="system-page-panel">
                  <div className="system-page-panel-title">节点遥测时效</div>
                  {hasNodeFreshnessData ? (
                    <ReactECharts option={nodeFreshnessOption} style={{ height: 320 }} />
                  ) : (
                    <div className="system-page-empty">当前数据源未上报最近遥测或最近 ACK 时效。</div>
                  )}
                </div>
              </Col>
            </Row>

            <div className="system-page-node-grid">
              {fieldEdge.nodes.length > 0 ? (
                fieldEdge.nodes.map((node) => (
                  <div key={`${node.fieldNodeId}-${node.deviceId}`} className="system-page-node-card">
                    <div className="system-page-node-head">
                      <div>
                        <div className="system-page-node-title">{formatInstallLabelDisplay(node.installLabel, node.deviceId)}</div>
                        <div className="system-page-node-subtitle">{node.deviceId}</div>
                      </div>
                      {edgeNodeTag(node.status)}
                    </div>
                    <div className="system-page-node-metrics">
                      <div className="system-page-node-summary">
                        <span>累计遥测 {formatMetric(node.telemetryMessages)}</span>
                        <span>累计转发 {formatMetric(node.commandForwards)}</span>
                        <span>累计业务 ACK {formatMetric(node.ackPublishes)}</span>
                      </div>
                      <div className="system-page-node-summary">
                        <span>最近遥测 {formatMetric(node.lastTelemetryAgeSeconds, "s")}</span>
                        <span>最近 ACK {formatMetric(node.lastAckAgeSeconds, "s")}</span>
                      </div>
                      <div className="system-page-node-summary">
                        <span>数据源 {fieldEdgeCenterDerived ? "中心数据库推导" : "RK3568 实时状态"}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="system-page-empty">
                  {usingLiveFallback ? "当前暂无设备实时上报。" : "当前桌面端尚未拿到 RK3568 节点运行数据。"}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="system-page-empty">
            {fieldEdgeUnavailableDetail ?? "当前尚未拿到 RK3568 实时状态，也没有可用的中心数据库节点状态。"}
          </div>
        )}
      </BaseCard>

      <div className="system-page-spacer" />

      <div className="system-page-section-head">
        <div>
          <div className="system-page-section-title">现场形变</div>
          <div className="system-page-section-desc">倾角曲面使用 A/B/C 真实姿态；只展示已从现场和云端返回的证据。</div>
        </div>
      </div>

      <TiltBusinessSurfaceView data={realtimeTiltSurface} />

      <div className="system-page-spacer" />

      <div className="system-page-section-head">
        <div>
          <div className="system-page-section-title">运维策略与审计</div>
          <div className="system-page-section-desc">配置类内容从运行监控主视线下移，避免和实时状态混在一起。</div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <BaseCard
            title="命令成功通知默认表"
            extra={
              <Space wrap>
                <Button onClick={restoreRecommendedDefaults}>恢复推荐默认表</Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void savePolicy()} loading={policySaving}>
                  保存默认表
                </Button>
              </Space>
            }
          >
            <div className="system-page-toolbar">
              <div className="system-page-toolbar-group">
                <Typography.Text strong>系统默认策略</Typography.Text>
                <Select
                  value={policyDraft.systemDefault}
                  style={{ width: 180 }}
                  onChange={(value) => setPolicyDraft((prev) => ({ ...prev, systemDefault: value }))}
                  options={[
                    { value: "silent", label: policyLabel("silent") },
                    { value: "always_notify", label: policyLabel("always_notify") }
                  ]}
                />
              </div>
              <Typography.Text type="secondary">当某个命令类型没有单独配置时，使用这里的默认通知策略。</Typography.Text>
            </div>

            <div className="system-page-toolbar">
              <Input
                value={newCommandType}
                placeholder="新增命令类型，例如 custom_reboot"
                style={{ width: 280 }}
                onChange={(e) => setNewCommandType(e.target.value)}
              />
              <Select
                value={newCommandTypePolicy}
                style={{ width: 160 }}
                onChange={(value) => setNewCommandTypePolicy(value)}
                options={[
                  { value: "silent", label: policyLabel("silent") },
                  { value: "always_notify", label: policyLabel("always_notify") }
                ]}
              />
              <Button icon={<PlusOutlined />} onClick={() => addPolicyRow()}>
                新增条目
              </Button>
            </div>

            <div className="system-page-toolbar">
              <Select
                value={selectedTemplate}
                allowClear
                placeholder="从常用模板快速新增"
                style={{ width: 320 }}
                onChange={(value) => setSelectedTemplate(value)}
                options={POLICY_TEMPLATES.map((item) => ({
                  value: item.commandType,
                  label: `${item.label}（${policyLabel(item.policy)}）`
                }))}
              />
              <Button onClick={addTemplateRow}>添加模板</Button>
            </div>

            <div className="desk-dark-table system-page-table-wrap">
              <Table
                rowKey="commandType"
                size="small"
                loading={policyLoading}
                pagination={false}
                scroll={{ x: 720 }}
                dataSource={policyRows}
                columns={[
                  {
                    title: "命令类型",
                    dataIndex: "commandType",
                    render: (value: string) => <span>{commandTypeLabel(value)}</span>
                  },
                  {
                    title: "默认策略",
                    dataIndex: "policy",
                    width: 180,
                    render: (_: unknown, row: PolicyRow) => (
                      <Select
                        value={row.policy}
                        style={{ width: 160 }}
                        onChange={(value) =>
                          setPolicyDraft((prev) => ({
                            ...prev,
                            commandTypeDefaults: {
                              ...prev.commandTypeDefaults,
                              [row.commandType]: value
                            }
                          }))
                        }
                        options={[
                          { value: "silent", label: policyLabel("silent") },
                          { value: "always_notify", label: policyLabel("always_notify") }
                        ]}
                      />
                    )
                  },
                  {
                    title: "操作",
                    width: 90,
                    render: (_: unknown, row: PolicyRow) => (
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          modal.confirm({
                            title: "移除默认策略条目",
                            content: `确认移除 ${row.commandType} 吗？保存后才会正式生效。`,
                            okText: "移除",
                            okButtonProps: { danger: true },
                            cancelText: "取消",
                            onOk: () =>
                              setPolicyDraft((prev) => {
                                const next = { ...prev.commandTypeDefaults };
                                delete next[row.commandType];
                                return { ...prev, commandTypeDefaults: next };
                              })
                          })
                        }
                      >
                        移除
                      </Button>
                    )
                  }
                ]}
              />
            </div>
          </BaseCard>
        </Col>

        <Col xs={24} xl={9}>
          <BaseCard
            title="最近变更"
            extra={
              <Button icon={<ReloadOutlined />} onClick={() => void refreshPolicyHistory()} loading={policyHistoryLoading}>
                刷新历史
              </Button>
            }
          >
            <div className="system-page-history-kpi">
              <div className="system-page-history-kpi-item">
                <div className="system-page-history-kpi-label">30 天内</div>
                <div className="system-page-history-kpi-value">{policyHistory.length}</div>
                <div className="system-page-history-kpi-note">策略变更记录</div>
              </div>
              <div className="system-page-history-kpi-item">
                <div className="system-page-history-kpi-label">默认表条目</div>
                <div className="system-page-history-kpi-value">{policyRows.length}</div>
                <div className="system-page-history-kpi-note">系统默认：{policyLabel(policyDraft.systemDefault)}</div>
              </div>
            </div>

            <div className="desk-dark-table system-page-table-wrap">
              <Table
                rowKey="id"
                size="small"
                loading={policyHistoryLoading}
                pagination={false}
                scroll={{ x: 720 }}
                dataSource={policyHistory}
                columns={[
                  {
                    title: "创建时间",
                    dataIndex: "createdAt",
                    width: 176,
                    render: (value: string) => <span className="system-page-mono">{value}</span>
                  },
                  { title: "操作人", dataIndex: "username", width: 110 },
                  { title: "结果", dataIndex: "status", width: 96, render: (value: string) => operationStatusLabel(value) },
                  {
                    title: "变更摘要",
                    dataIndex: "requestData",
                    render: (value: unknown) => <span className="system-page-history-summary">{summarizePolicyChange(value)}</span>
                  },
                  {
                    title: "详情",
                    width: 90,
                    render: (_: unknown, row: OperationLogRow) => (
                      <Button size="small" onClick={() => setHistoryDetail(row)}>
                        查看
                      </Button>
                    )
                  }
                ]}
              />
            </div>
          </BaseCard>
        </Col>
      </Row>

      <Modal
        title="默认表变更详情"
        open={historyDetail !== null}
        width={980}
        footer={null}
        onCancel={() => setHistoryDetail(null)}
      >
        {historyDetail ? (
          (() => {
            const previousPolicy = readPolicySnapshot(historyDetail.requestData, "previousPolicy");
            const nextPolicy = readPolicySnapshot(historyDetail.requestData, "nextPolicy");
            const details = diffPolicySnapshots(previousPolicy, nextPolicy);
            return (
              <div className="system-page-modal-grid">
                <div className="system-page-modal-head">
                  <Typography.Text type="secondary">时间：{historyDetail.createdAt}</Typography.Text>
                  <Typography.Text type="secondary">用户：{historyDetail.username}</Typography.Text>
                  <Typography.Text type="secondary">状态：{operationStatusLabel(historyDetail.status)}</Typography.Text>
                </div>
                <div>
                  <div className="system-page-modal-actions">
                    <Button
                      size="small"
                      onClick={() => {
                        void copyText(summarizePolicyChange(historyDetail.requestData))
                          .then(() => message.success("已复制差异摘要"))
                          .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)));
                      }}
                    >
                      复制差异摘要
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        void copyText(buildPolicyChangeMarkdown(historyDetail))
                          .then(() => message.success("已复制文档摘要"))
                          .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)));
                      }}
                    >
                      复制文档摘要
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        void copyText(buildPolicyChangeNotice(historyDetail))
                          .then(() => message.success("已复制变更通告模板"))
                          .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)));
                      }}
                    >
                      复制变更通告模板
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        void copyText(buildPolicyChangeExportJson(historyDetail))
                          .then(() => message.success("已复制完整差异 JSON"))
                          .catch((error: unknown) => message.error(error instanceof Error ? error.message : String(error)));
                      }}
                    >
                      复制完整差异 JSON
                    </Button>
                  </div>
                  <div className="system-page-history-summary system-page-modal-summary">{summarizePolicyChange(historyDetail.requestData)}</div>
                </div>
                <div className="system-page-modal-diff">
                  <Typography.Text strong>差异</Typography.Text>
                  <div className="system-page-mono">
                    系统默认策略：
                    {details?.systemDefaultChanged
                      ? `${previousPolicy ? policyLabel(previousPolicy.systemDefault) : "-"} -> ${nextPolicy ? policyLabel(nextPolicy.systemDefault) : "-"}`
                      : "无变化"}
                  </div>
                  <div className="system-page-mono">
                    新增：
                    {details && details.added.length
                      ? details.added.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join(", ")
                      : "无"}
                  </div>
                  <div className="system-page-mono">
                    修改：
                    {details && details.changed.length
                      ? details.changed.map((item) => `${commandTypeLabel(item.commandType)}: ${policyLabel(item.before)} -> ${policyLabel(item.after)}`).join(", ")
                      : "无"}
                  </div>
                  <div className="system-page-mono">
                    移除：
                    {details && details.removed.length
                      ? details.removed.map((item) => `${commandTypeLabel(item.commandType)}=${policyLabel(item.policy)}`).join(", ")
                      : "无"}
                  </div>
                </div>
                <div className="system-page-modal-snapshots">
                  <Card size="small" title="变更前">
                    <pre className="system-page-pre">{renderPolicySnapshot(previousPolicy)}</pre>
                  </Card>
                  <Card size="small" title="变更后">
                    <pre className="system-page-pre">{renderPolicySnapshot(nextPolicy)}</pre>
                  </Card>
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>
    </div>
  );
}
