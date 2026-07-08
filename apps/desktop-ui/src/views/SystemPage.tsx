import { App as AntApp, Button, Card, Col, Input, Modal, Progress, Row, Select, Skeleton, Space, Switch, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type {
  CommandSuccessNotificationPolicyConfig,
  Device,
  DeviceStateSnapshot,
  FieldEdgeNodeStatus,
  FieldEdgeStatus,
  FieldAlarmStatus,
  OperationLogRow,
  SystemStatus
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
    buzzer_on: "现场声光报警启动（已统一到 RK3568）",
    buzzer_off: "现场声光报警停止（已统一到 RK3568）",
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

function healthPercent(status: SystemStatus["items"][number]["status"]): number {
  if (status === "healthy") return 100;
  if (status === "degraded") return 64;
  if (status === "not_configured") return 36;
  return 18;
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
  if (level === "attention") return "关注";
  if (level === "critical") return "严重";
  if (level === "offline") return "离线";
  return "未知";
}

function edgeLevelColor(level: string | null | undefined): string {
  if (level === "healthy") return "#22c55e";
  if (level === "attention") return "#f59e0b";
  if (level === "critical") return "#ef4444";
  if (level === "offline") return "#94a3b8";
  return "#38bdf8";
}

function edgeLevelPercent(level: string | null | undefined): number {
  if (level === "healthy") return 100;
  if (level === "attention") return 62;
  if (level === "critical") return 24;
  if (level === "offline") return 8;
  return 35;
}

function edgeLevelTag(level: string | null | undefined) {
  const color =
    level === "healthy"
      ? "green"
      : level === "attention"
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

function nodeStatusPercent(status: string): number {
  const normalized = status.trim().toLowerCase();
  if (normalized === "online") return 100;
  if (normalized === "degraded") return 64;
  if (normalized === "configured") return 48;
  if (normalized === "offline") return 12;
  return 32;
}

function nodeQualityStatusPercent(node: FieldEdgeNodeStatus): number | null {
  if (node.deferred || node.enabled === false) return null;
  return nodeStatusPercent(node.status);
}

function boolLabel(value: boolean | null | undefined): string {
  if (value === true) return "是";
  if (value === false) return "否";
  return "-";
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
  if (value == null || Number.isNaN(value)) return "-";
  return `${value}${suffix}`;
}

function metricChartValue(value: number | null | undefined): number | null {
  return value == null || Number.isNaN(value) ? null : value;
}

function freshnessPercent(ageSeconds: number | null | undefined): number | null {
  if (ageSeconds == null || Number.isNaN(ageSeconds)) return null;
  if (ageSeconds <= 15) return 100;
  if (ageSeconds <= 30) return clampPercent(100 - (ageSeconds - 15) * (20 / 15));
  if (ageSeconds <= 90) return clampPercent(80 - (ageSeconds - 30) * (40 / 60));
  if (ageSeconds <= 300) return clampPercent(40 - (ageSeconds - 90) * (40 / 210));
  return 0;
}

function forwardLoopPercent(node: FieldEdgeNodeStatus): number | null {
  if (node.deferred || node.enabled === false) return null;
  if (node.commandForwards == null || node.commandForwards <= 0) return null;
  if (node.telemetryMessages == null) return null;
  return clampPercent((node.telemetryMessages / Math.max(node.commandForwards, 1)) * 100);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  return formatBeijingDateTime(value, undefined, value);
}

type HermesVolatilitySurface = NonNullable<NonNullable<SystemStatus["hermesEdge"]>["volatilitySurface"]>;

function volatilityColor(score: number): string {
  if (score >= 78) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 42) return "#f59e0b";
  if (score >= 24) return "#22c55e";
  return "#38bdf8";
}

function volatilityLabel(score: number | null | undefined): string {
  if (score == null) return "等待数据";
  if (score >= 78) return "高波动";
  if (score >= 60) return "明显波动";
  if (score >= 42) return "轻度扰动";
  return "稳定";
}

function findSurfacePoint(surface: HermesVolatilitySurface, dimensionKey: string, horizonMinutes: number) {
  return surface.points.find((point) => point.dimensionKey === dimensionKey && point.horizonMinutes === horizonMinutes) ?? null;
}

function scoreToThreeColor(score: number): THREE.Color {
  if (score >= 78) return new THREE.Color("#f6bd60");
  if (score >= 60) return new THREE.Color("#8ab4ff");
  if (score >= 42) return new THREE.Color("#5eead4");
  if (score >= 24) return new THREE.Color("#45d483");
  return new THREE.Color("#67e8f9");
}

function HermesVolatilityThreeSurface({ surface }: { surface: HermesVolatilitySurface }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050811, 0.042);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(5.6, 4.35, 7.1);
    camera.lookAt(0, 1.35, 0);

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
    world.scale.set(0.82, 0.86, 0.82);
    world.position.set(0.2, 0.04, 0);
    scene.add(world);

    const horizons = surface.horizonsMinutes;
    const dimensions = surface.dimensions;
    const xStep = 1.12;
    const zStep = 0.52;
    const yScale = 0.031;
    const xOffset = ((horizons.length - 1) * xStep) / 2;
    const zOffset = ((dimensions.length - 1) * zStep) / 2;
    const sceneObjects: THREE.Object3D[] = [];
    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];

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
    const addVisualMicrostructure = (point: THREE.Vector3, sampleIndex: number, dimensionIndex: number, strength = 1) => {
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

    for (let d = 0; d < dimensions.length; d += 1) {
      for (let h = 0; h < horizons.length; h += 1) {
        const p = pointPosition(h, d);
        positions.push(p.x, p.y, p.z);
        const color = scoreToThreeColor(p.score);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let d = 0; d < dimensions.length - 1; d += 1) {
      for (let h = 0; h < horizons.length - 1; h += 1) {
        const a = d * horizons.length + h;
        const b = a + 1;
        const c = (d + 1) * horizons.length + h;
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
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    disposableMaterials.push(surfaceMaterial);
    const surfaceMesh = new THREE.Mesh(geometry, surfaceMaterial);
    world.add(surfaceMesh);
    sceneObjects.push(surfaceMesh);

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

    const axesMaterial = new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.34 });
    const axesGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-xOffset - 0.42, 0, -zOffset - 0.3),
      new THREE.Vector3(xOffset + 0.5, 0, -zOffset - 0.3),
      new THREE.Vector3(-xOffset - 0.42, 0, -zOffset - 0.3),
      new THREE.Vector3(-xOffset - 0.42, 0, zOffset + 0.46),
      new THREE.Vector3(-xOffset - 0.42, 0, -zOffset - 0.3),
      new THREE.Vector3(-xOffset - 0.42, 3.45, -zOffset - 0.3)
    ]);
    const axes = new THREE.LineSegments(axesGeometry, axesMaterial);
    world.add(axes);
    sceneObjects.push(axes);
    disposableGeometries.push(axesGeometry);
    disposableMaterials.push(axesMaterial);

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
    const pointGeometry = new THREE.SphereGeometry(0.034, 14, 10);
    disposableGeometries.push(pointGeometry);
    const cloudPositions: number[] = [];
    const cloudColors: number[] = [];
    const dropLinePositions: number[] = [];
    const dropLineColors: number[] = [];

    dimensions.forEach((_, dimensionIndex) => {
      const rawPoints = horizons.map((__, horizonIndex) => pointPosition(horizonIndex, dimensionIndex));
      const curvePoints = rawPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z));
      const curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.42);
      const sampledPoints = curve.getPoints(108).map((point, index) => addVisualMicrostructure(point, index, dimensionIndex, 1));
      const averageScore = rawPoints.reduce((sum, point) => sum + point.score, 0) / Math.max(1, rawPoints.length);
      const baseColor = scoreToThreeColor(averageScore);
      const isHighlighted = highlightedDimensionIndexes.has(dimensionIndex);

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

        [-1, 1].forEach((side) => {
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
        const pointMaterial = new THREE.MeshBasicMaterial({
          color: baseColor,
          transparent: true,
          opacity: isHighlighted ? 0.95 : 0.48
        });
        const dot = new THREE.Mesh(pointGeometry, pointMaterial);
        dot.position.set(point.x, point.y, point.z);
        world.add(dot);
        sceneObjects.push(dot);
        disposableMaterials.push(pointMaterial);
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
      const sampledPoints = curve.getPoints(86);
      const averageScore = rawPoints.reduce((sum, point) => sum + point.score, 0) / Math.max(1, rawPoints.length);
      const baseColor = scoreToThreeColor(averageScore).lerp(new THREE.Color("#7dd3fc"), 0.18);

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
    let targetYaw = -0.18;
    let currentYaw = targetYaw;
    let targetPitch = 0.08;
    let currentPitch = targetPitch;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";

    const handlePointerDown = (event: PointerEvent) => {
      isDragging = true;
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
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    };
    const handlePointerUp = (event: PointerEvent) => {
      isDragging = false;
      renderer.domElement.style.cursor = "grab";
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.zoom = clamp(camera.zoom + (event.deltaY < 0 ? 0.08 : -0.08), 0.78, 1.36);
      camera.updateProjectionMatrix();
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });

    let frame = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      frame += 1;
      if (!isDragging) targetYaw += 0.001;
      currentYaw += (targetYaw - currentYaw) * 0.08;
      currentPitch += (targetPitch - currentPitch) * 0.08;
      world.rotation.set(currentPitch, currentYaw, 0);
      renderer.render(scene, camera);
      window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      mount.removeChild(renderer.domElement);
      sceneObjects.forEach((object) => world.remove(object));
      disposableGeometries.forEach((item) => item.dispose());
      disposableMaterials.forEach((item) => item.dispose());
      renderer.dispose();
    };
  }, [surface]);

  return (
    <div className="system-page-volatility-three-wrap">
      <div className="system-page-volatility-three-caption">
        <strong>3D 端侧不稳定性曲面</strong>
        <span>数值越高表示波动风险越高；红色不是健康高分，而是需要关注的高不稳定性。</span>
      </div>
      <div ref={mountRef} className="system-page-volatility-three" />
      <div className="system-page-volatility-three-legend" aria-label="3D 曲面图例">
        <span>
          <i className="system-page-volatility-legend-dot" />
          采样点
        </span>
        <span>
          <i className="system-page-volatility-legend-line" />
          维度走势
        </span>
        <span>
          <i className="system-page-volatility-legend-plane" />
          窗口切片
        </span>
      </div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-x">X 复检时间窗</div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-y">Y 链路维度</div>
      <div className="system-page-volatility-three-label system-page-volatility-three-label-z">Z 不稳定性</div>
    </div>
  );
}

function HermesVolatilitySurfaceView({
  surface,
  stale
}: {
  surface: HermesVolatilitySurface | null | undefined;
  stale?: boolean | null;
}) {
  if (stale) {
    return <div className="system-page-edge-detail">端侧 AI 诊断待刷新</div>;
  }
  if (!surface || surface.dimensions.length < 2 || surface.horizonsMinutes.length < 2 || surface.points.length === 0) {
    return <div className="system-page-edge-detail">端侧 AI 不稳定性曲面等待 Hermes API 数据。</div>;
  }

  const peakDimension = surface.dimensions.find((dimension) => dimension.key === surface.peakDimensionKey);
  const averageScore =
    surface.points.length > 0
      ? surface.points.reduce((sum, point) => sum + point.volatilityScore, 0) / surface.points.length
      : 0;
  const hotDimensions = surface.dimensions
    .map((dimension) => {
      const values = surface.horizonsMinutes
        .map((horizon) => findSurfacePoint(surface, dimension.key, horizon)?.volatilityScore)
        .filter((value): value is number => typeof value === "number");
      const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return { dimension, average };
    })
    .sort((a, b) => b.average - a.average)
    .slice(0, 3);
  const scoreValues = surface.points.map((point) => point.volatilityScore);
  const minScore = scoreValues.length > 0 ? Math.min(...scoreValues) : 0;
  const maxScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;
  const summaryCards = [
    { label: "链路维度", value: `${surface.dimensions.length}`, note: "维度数量" },
    { label: "复检窗口", value: `${surface.horizonsMinutes.length}`, note: surface.horizonsMinutes.map((item) => `${item}m`).join(" / ") },
    { label: "平均波动", value: `${Math.round(averageScore)}`, note: volatilityLabel(averageScore) },
    { label: "波动区间", value: `${Math.round(minScore)} - ${Math.round(maxScore)}`, note: "波动得分" },
    { label: "峰值点", value: `${Math.round(surface.peakScore ?? maxScore)}`, note: `${surface.peakHorizonMinutes ?? "-"}min` }
  ];

  return (
    <div className="system-page-volatility">
      <div className="system-page-volatility-head">
        <div>
          <div className="system-page-panel-title">RK3568 端侧 AI 不稳定性曲面</div>
          <div className="system-page-volatility-subtitle">
            X=复检时间窗 · Y=链路维度 · Z=不稳定性得分。数值越高、颜色越暖，表示越需要关注。
          </div>
        </div>
        <Space size={8} wrap>
          <Tag color={surface.peakScore != null && surface.peakScore >= 78 ? "red" : "orange"}>
            峰值 {formatMetric(surface.peakScore)}
          </Tag>
          <Tag color="cyan">模型置信度 {surface.modelConfidence == null ? "-" : `${Math.round(surface.modelConfidence * 1000) / 10}%`}</Tag>
        </Space>
      </div>

      <div className="system-page-volatility-summary-grid">
        {summaryCards.map((item) => (
          <div key={item.label} className="system-page-volatility-summary-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.note}</em>
          </div>
        ))}
      </div>

      <div className="system-page-volatility-body">
        <div className="system-page-volatility-stage">
          <div className="system-page-volatility-chart-shell">
            <HermesVolatilityThreeSurface surface={surface} />
          </div>
        </div>

        <div className="system-page-volatility-side">
          <div className="system-page-volatility-core">
            <span>端侧 AI 平均波动</span>
            <strong>{Math.round(averageScore)}</strong>
            <em>{volatilityLabel(averageScore)}</em>
          </div>
          <div className="system-page-volatility-peak">
            <span>当前峰值维度</span>
            <strong>{peakDimension?.label ?? "-"}</strong>
            <em>
              {formatMetric(surface.peakScore)} · {surface.peakHorizonMinutes ?? "-"}min · {volatilityLabel(surface.peakScore)}
            </em>
          </div>
          <div className="system-page-volatility-legend">
            {[18, 38, 56, 72, 88].map((score) => (
              <span key={score}>
                <i style={{ background: volatilityColor(score) }} />
                {score}
              </span>
            ))}
          </div>
          <div className="system-page-volatility-hotlist">
            {hotDimensions.map((item) => (
              <span key={item.dimension.key}>
                <i style={{ background: volatilityColor(item.average) }} />
                {item.dimension.label}
                <b>{Math.round(item.average)}</b>
              </span>
            ))}
          </div>
          <div className="system-page-volatility-note">{surface.note}</div>
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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
        telemetryMessages: snapshot ? 1 : 0,
        commandForwards: null,
        ackPublishes: null,
        lastTelemetryAgeSeconds,
        lastAckAgeSeconds: null
      };
    })
    .sort((a, b) => a.installLabel.localeCompare(b.installLabel));

  const onlineCount = nodes.filter((node) => node.status === "online").length;
  const degradedCount = nodes.filter((node) => node.status === "degraded").length;
  const score = clampPercent(((onlineCount + degradedCount * 0.6) / Math.max(nodes.length, 1)) * 100);
  const maxTelemetryAge = nodes
    .map((node) => node.lastTelemetryAgeSeconds)
    .filter((value): value is number => typeof value === "number")
    .reduce<number | null>((current, value) => (current == null ? value : Math.max(current, value)), null);
  const overallLevel = score >= 90 ? "healthy" : score >= 60 ? "attention" : score > 0 ? "critical" : "offline";

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
      score,
      deferredNodeIds: [],
      networkMode: "api-live",
      serialOpen: null,
      mqttConnected: null,
      portStatus: "api-live",
      spoolPending: 0,
      rejectedMessages: 0,
      lastPublishedAgeSeconds: maxTelemetryAge
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
  const [fieldAlarmBusy, setFieldAlarmBusy] = useState<"alarm_on" | "resolve" | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyHistoryLoading, setPolicyHistoryLoading] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<CommandSuccessNotificationPolicyConfig>({
    systemDefault: "silent",
    commandTypeDefaults: {}
  });
  const [policyHistory, setPolicyHistory] = useState<OperationLogRow[]>([]);
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
      } else {
        setStatus(null);
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
      if (statusResult.status === "fulfilled" || deviceListResult.status === "fulfilled" || fieldAlarmResult.status === "fulfilled") {
        setStatusCheckedAt(new Date().toISOString());
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
        { key: "postgres", label: "PostgreSQL", status: "unknown" as const, detail: "-" },
        { key: "clickhouse", label: "ClickHouse", status: "unknown" as const, detail: "-" },
        { key: "kafka", label: "Kafka", status: "unknown" as const, detail: "-" }
      ],
    [status]
  );

  const rawFieldEdge = status?.fieldEdge ?? null;
  const usingLiveFallback = Boolean(liveFieldEdge) && (!rawFieldEdge || !rawFieldEdge.available || rawFieldEdge.nodes.length === 0);
  const fieldEdge = usingLiveFallback ? liveFieldEdge : rawFieldEdge;

  const serviceHealthyCount = useMemo(
    () => serviceItems.filter((item) => item.status === "healthy").length,
    [serviceItems]
  );
  const serviceHealthPercent = serviceItems.length > 0 ? Math.round((serviceHealthyCount / serviceItems.length) * 100) : 0;
  const fieldEdgeLevel = fieldEdge?.summary?.overallLevel ?? null;
  const fieldEdgeScore = fieldEdge?.summary?.score ?? null;
  const fieldEdgeActiveNodes = useMemo(
    () => fieldEdge?.nodes.filter((node) => !node.deferred && node.enabled !== false) ?? [],
    [fieldEdge]
  );
  const fieldEdgeOnlineNodeCount = fieldEdgeActiveNodes.filter((node) => node.status.trim().toLowerCase() === "online").length;
  const fieldEdgeDeferredNodeCount = fieldEdge?.nodes.filter((node) => node.deferred || node.enabled === false).length ?? 0;
  const centerNodeOnline =
    Boolean(fieldAlarmStatus?.actuator.available) ||
    Boolean(fieldEdge?.available && (fieldEdge.summary?.serialOpen || fieldEdge.summary?.mqttConnected));
  const onlineDeviceCount = fieldEdgeOnlineNodeCount + (centerNodeOnline ? 1 : 0);
  const activeDeviceCount = fieldEdgeActiveNodes.length + 1;
  const hermesEdge = status?.hermesEdge ?? null;
  const hermesConfidencePercent = hermesEdge?.confidence == null ? null : Math.round(hermesEdge.confidence * 1000) / 10;
  const hermesSafetyOk =
    hermesEdge?.safetyGatewayCoreTouched === false &&
    hermesEdge.safetySerialTouched === false &&
    hermesEdge.safetyMqttTouched === false;
  const fieldEdgeHealthPercent = fieldEdgeScore == null ? null : clampPercent(fieldEdgeScore);
  const hermesHealthPercent =
    hermesEdge == null
      ? null
      : hermesEdge.serviceActive && hermesEdge.modelLoaded
        ? 100
        : hermesEdge.serviceActive || hermesEdge.modelLoaded
          ? 60
          : 0;
  const systemHealthParts = [serviceHealthPercent, fieldEdgeHealthPercent, hermesHealthPercent].filter(
    (value): value is number => typeof value === "number"
  );
  const systemHealthPercent =
    systemHealthParts.length > 0 ? Math.floor(systemHealthParts.reduce((sum, value) => sum + value, 0) / systemHealthParts.length) : 0;
  const systemHealthNote = hermesHealthPercent == null ? "平台+边缘综合，AI 状态待接入" : "平台+边缘+AI 综合";
  const systemHealthy =
    serviceHealthyCount === serviceItems.length &&
    edgeLevelLabel(fieldEdgeLevel) === "健康" &&
    (hermesHealthPercent == null || hermesHealthPercent >= 90);

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

  const nodeQualityMatrixOption = useMemo(() => {
    const nodes = fieldEdge?.nodes ?? [];
    const dimensions = ["状态", "遥测时效", "转发闭环"];
    const matrixData = nodes.flatMap((node, nodeIndex) => {
      const telemetryFreshness = freshnessPercent(node.lastTelemetryAgeSeconds);
      const forwardScore = forwardLoopPercent(node);
      return [
        [nodeIndex, 0, nodeQualityStatusPercent(node)],
        [nodeIndex, 1, telemetryFreshness],
        [nodeIndex, 2, forwardScore]
      ];
    });

    return {
      backgroundColor: "transparent",
      tooltip: { show: false },
      grid: { left: "4%", right: "4%", top: 24, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: nodes.map((node) => formatInstallLabelDisplay(node.installLabel, node.deviceId)),
        splitArea: { show: true, areaStyle: { color: ["rgba(15, 23, 42, 0.08)", "rgba(15, 23, 42, 0.02)"] } },
        ...darkAxis()
      },
      yAxis: {
        type: "category",
        data: dimensions,
        splitArea: { show: true, areaStyle: { color: ["rgba(15, 23, 42, 0.08)", "rgba(15, 23, 42, 0.02)"] } },
        ...darkAxis()
      },
      visualMap: {
        min: 0,
        max: 100,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: "rgba(226, 232, 240, 0.82)" },
        inRange: { color: ["#7f1d1d", "#b45309", "#0f766e", "#22c55e"] }
      },
      series: [
        {
          type: "heatmap",
          data: matrixData,
          label: {
            show: true,
            color: "rgba(255,255,255,0.92)",
            formatter: (params: { value: [number, number, number | null] }) => (params.value[2] == null ? "暂无" : `${params.value[2]}`)
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: "rgba(0, 0, 0, 0.35)"
            }
          }
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
        reason: action === "alarm_on" ? "系统监控页手动启动 RK3568 声光报警" : "系统监控页人工停止声光并解除当前告警，后续遥测重新建立倾角基准"
      };
      if (action === "resolve" && fieldAlarmStatus?.latestAlert?.alertId) {
        fieldAlarmActionInput.alertId = fieldAlarmStatus.latestAlert.alertId;
      }
      const result = await api.fieldAlarm.sendAction(fieldAlarmActionInput);
      if (result.accepted) {
        message.success(action === "alarm_on" ? "RK3568 声光报警已启动" : "RK3568 声光报警已停止，当前告警已解除");
      } else {
        message.error(`RK3568 声光报警未被执行器确认：${result.actuator.lastError ?? "执行器未连接"}`);
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
            <Typography.Text type="secondary">自动刷新 15s</Typography.Text>
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
            <div className="system-page-hero-k">综合健康</div>
            <div className="system-page-hero-v">{systemHealthPercent}%</div>
            <div className="system-page-hero-note">{systemHealthNote}</div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">边缘链路</div>
            <div className="system-page-hero-v" style={{ color: edgeLevelColor(fieldEdgeLevel) }}>
              {edgeLevelLabel(fieldEdgeLevel)}
            </div>
            <div className="system-page-hero-note">RK3568 链路评分 {formatMetric(fieldEdgeScore)}</div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">在线设备</div>
            <div className="system-page-hero-v">
              {onlineDeviceCount}/{activeDeviceCount}
            </div>
            <div className="system-page-hero-note">
              RK3568 中心节点 {centerNodeOnline ? "在线" : "待确认"} · 分节点 {fieldEdgeOnlineNodeCount}/{fieldEdgeActiveNodes.length}
              {fieldEdgeDeferredNodeCount > 0 ? ` · 预留 ${fieldEdgeDeferredNodeCount}` : ""}
            </div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">Hermes Agent</div>
            <div className="system-page-hero-v" style={{ color: hermesEdge?.modelLoaded ? "#22d3ee" : "#94a3b8" }}>
              {hermesEdge?.modelLoaded ? "在线" : "待接入"}
            </div>
            <div className="system-page-hero-note">
              {hermesConfidencePercent == null ? "等待模型诊断" : `置信度 ${hermesConfidencePercent}%`}
            </div>
          </div>
          <div className="system-page-hero-metric">
            <div className="system-page-hero-k">策略记录</div>
            <div className="system-page-hero-v">{policyHistory.length}</div>
            <div className="system-page-hero-note">近 30 天变更</div>
          </div>
        </div>
      </section>

      <BaseCard
        title="RK3568 中心节点声光报警器"
        extra={
          <Space size={8} wrap>
            <Tag color={fieldAlarmStatus?.actuator.available ? "green" : "orange"}>
              {fieldAlarmStatus?.actuator.available ? "执行器已连接" : "执行器待确认"}
            </Tag>
            <Tag color={fieldAlarmStatus?.active ? "red" : fieldAlarmStatus?.silenced ? "gold" : "default"}>
              {fieldAlarmStatus?.active ? "报警中" : fieldAlarmStatus?.silenced ? "已停止" : "待命"}
            </Tag>
          </Space>
        }
      >
        <div className="system-page-field-alarm">
          <div className="system-page-field-alarm-main">
            <div className="system-page-field-alarm-title">
              {fieldAlarmStatus?.active ? "中心节点正在驱动现场声光报警" : "手动联调 RK3568 中心节点 -> YX75R 声光报警链路"}
            </div>
            <div className="system-page-field-alarm-detail">
              {fieldAlarmStatus?.actuator.detail ?? "通过中心 API 调用 RK3568 actuator，不走 RK2206 蜂鸣器/设备命令。"}
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
              启动 RK3568 声光
            </Button>
            <Button
              loading={fieldAlarmBusy === "resolve"}
              onClick={() => void issueFieldAlarmAction("resolve")}
            >
              停止 RK3568 声光
            </Button>
          </Space>
        </div>
      </BaseCard>

      <div className="system-page-spacer" />

      <div className="system-page-section-head">
        <div>
          <div className="system-page-section-title">平台服务</div>
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
                  <div>
                    <div className="system-page-meter-label">
                      <span>健康度</span>
                      <span>{healthPercent(item.status)}%</span>
                    </div>
                    <Progress
                      percent={healthPercent(item.status)}
                      showInfo={false}
                      strokeColor={healthAccent(item.status)}
                      trailColor="rgba(51, 65, 85, 0.45)"
                    />
                  </div>
                  <div className="system-page-service-evidence">
                    <span>最近检查 {formatTimestamp(statusCheckedAt)}</span>
                    <span>API 健康检查</span>
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
                <Tag color="gold">API 实时退化视图</Tag>
              ) : fieldEdge.stale ? (
                <Tag color="orange">数据滞后</Tag>
              ) : (
                <Tag color="cyan">RK3568 证据窗口</Tag>
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
                  <span>网络 {fieldEdge.summary?.networkMode ?? "-"}</span>
                  <span>串口 {fieldEdge.summary?.portStatus ?? "-"}</span>
                </div>
                <Progress
                  percent={edgeLevelPercent(fieldEdge.summary?.overallLevel)}
                  showInfo={false}
                  strokeColor={edgeLevelColor(fieldEdge.summary?.overallLevel)}
                  trailColor="rgba(51, 65, 85, 0.45)"
                />
              </div>

              <div className="system-page-kpi">
                <div className="system-page-kpi-label">链路评分</div>
                <div className="system-page-kpi-value">{formatMetric(fieldEdge.summary?.score, "分")}</div>
                <div className="system-page-kpi-meta">
                  <span>串口打开 {boolLabel(fieldEdge.summary?.serialOpen)}</span>
                  <span>MQTT 已连 {boolLabel(fieldEdge.summary?.mqttConnected)}</span>
                </div>
                <div className="system-page-kpi-note">证据生成 {formatTimestamp(fieldEdge.generatedAt)}</div>
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
                  <span>边界 {fieldEdge.soak?.currentBoundary ?? fieldEdge.currentBoundary ?? "-"}</span>
                  <span>ACK 全闭环 {boolLabel(fieldEdge.soak?.allAcked)}</span>
                </div>
                <div className="system-page-kpi-note">清洁窗口 {formatMetric(fieldEdge.soak?.cleanWindowRounds)}</div>
              </div>
            </div>

            <div className="system-page-edge-detail">{productStatusDetail(fieldEdge.detail)}</div>

            {hermesEdge ? (
              <div className="system-page-hermes-card">
                <div className="system-page-hermes-head">
                  <div>
                    <div className="system-page-panel-title">Hermes 端侧智能体</div>
                    <div className="system-page-hermes-title">
                      {modelJudgementLabel(hermesEdge.diagnosisType)}
                    </div>
                    <div className="system-page-hermes-subtitle">
                      {productStatusDetail(hermesEdge.detail)} · {formatTimestamp(hermesEdge.generatedAt)}
                    </div>
                  </div>
                  <Space size={8} wrap>
                    {hermesDiagnosisTag(hermesEdge.diagnosisType, hermesEdge.confidenceLevel)}
                    {hermesEdge.stale ? <Tag color="orange">证据过期</Tag> : null}
                    <Tag color={hermesEdge.serviceActive ? "green" : "default"}>服务 {hermesEdge.serviceActive ? "运行中" : "待确认"}</Tag>
                    <Tag color={hermesEdge.modelLoaded ? "cyan" : "default"}>模型 {hermesEdge.modelLoaded ? "已加载" : "未加载"}</Tag>
                    <Tag color={hermesSafetyOk ? "green" : "orange"}>主链路保护 {hermesSafetyOk ? "通过" : "待确认"}</Tag>
                  </Space>
                </div>

                <div className="system-page-hermes-grid">
                  <div className="system-page-hermes-metric">
                    <span>模型</span>
                    <strong>{hermesModelTypeLabel(hermesEdge.modelType)}</strong>
                    <em>{hermesModelKeyLabel(hermesEdge.modelKey)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>特征 / 模型数</span>
                    <strong>{formatMetric(hermesEdge.featureCount)}</strong>
                    <em>模型数 {formatMetric(hermesEdge.aiModelCount)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>置信度</span>
                    <strong>{hermesConfidencePercent == null ? "-" : `${hermesConfidencePercent}%`}</strong>
                    <em>{confidenceLevelLabel(hermesEdge.confidenceLevel)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>自然语言入口</span>
                    <strong>{boolLabel(hermesEdge.naturalLanguageReady)}</strong>
                    <em>意图数 {formatMetric(hermesEdge.intentCount)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>安全复检</span>
                    <strong>{actionStatusLabel(hermesEdge.actionRecheckStatus)}</strong>
                    <em>复检接纳 {boolLabel(hermesEdge.actionRecheckAccepted)}</em>
                  </div>
                  <div className="system-page-hermes-metric">
                    <span>压测</span>
                    <strong>{formatMetric(hermesEdge.stress?.throughputRps, " rps")}</strong>
                    <em>P95 {formatMetric(hermesEdge.stress?.p95Ms, "ms")} · 错误率 {formatMetric(hermesEdge.stress?.errorRate)}</em>
                  </div>
                </div>

                <HermesVolatilitySurfaceView surface={hermesEdge.volatilitySurface} stale={hermesEdge.stale} />

                <div className="system-page-hermes-boundary">
                  <span>网关主流程触碰 {boolLabel(hermesEdge.safetyGatewayCoreTouched)}</span>
                  <span>串口链路触碰 {boolLabel(hermesEdge.safetySerialTouched)}</span>
                  <span>MQTT 链路触碰 {boolLabel(hermesEdge.safetyMqttTouched)}</span>
                  <span>板端主机 {hermesEdge.boardHost ?? "-"}</span>
                </div>
              </div>
            ) : (
              <div className="system-page-edge-detail">当前 API 尚未返回 RK3568 Hermes Agent 状态。</div>
            )}

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={10}>
                <div className="system-page-panel">
                  <div className="system-page-panel-title">节点通信计数</div>
                  {fieldEdge.nodes.length > 0 ? (
                    <ReactECharts option={nodeTrafficOption} style={{ height: 320 }} />
                  ) : (
                    <div className="system-page-empty">{usingLiveFallback ? "当前展示 API 实时节点统计。" : "暂无 RK3568 节点运行数据。"}</div>
                  )}
                </div>
              </Col>
              <Col xs={24} xl={14}>
                <div className="system-page-panel">
                  <div className="system-page-panel-title">节点质量矩阵</div>
                  {fieldEdge.nodes.length > 0 ? (
                    <ReactECharts option={nodeQualityMatrixOption} style={{ height: 320 }} />
                  ) : (
                    <div className="system-page-empty">{usingLiveFallback ? "当前展示 API 实时节点质量矩阵。" : "暂无节点质量矩阵数据。"}</div>
                  )}
                </div>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col span={24}>
                <div className="system-page-panel">
                  <div className="system-page-panel-title">节点时效对比</div>
                  {fieldEdge.nodes.length > 0 ? (
                    <ReactECharts option={nodeFreshnessOption} style={{ height: 280 }} />
                  ) : (
                    <div className="system-page-empty">{usingLiveFallback ? "当前展示 API 实时节点新鲜度。" : "暂无节点新鲜度指标。"}</div>
                  )}
                </div>
              </Col>
            </Row>

            <div className="system-page-node-grid">
              {fieldEdge.nodes.length > 0 ? (
                fieldEdge.nodes.map((node) => {
                  const statusPercent = nodeQualityStatusPercent(node);
                  return (
                    <div key={`${node.fieldNodeId}-${node.deviceId}`} className="system-page-node-card">
                      <div className="system-page-node-head">
                        <div>
                          <div className="system-page-node-title">{formatInstallLabelDisplay(node.installLabel, node.deviceId)}</div>
                          <div className="system-page-node-subtitle">{node.deviceId}</div>
                        </div>
                        {edgeNodeTag(node.status)}
                      </div>
                      <div className="system-page-node-metrics">
                        <div>
                          <div className="system-page-meter-label">
                            <span>节点状态</span>
                            <span>{statusPercent == null ? "暂无" : `${statusPercent}%`}</span>
                          </div>
                          <Progress
                            percent={statusPercent ?? 0}
                            showInfo={false}
                            strokeColor={statusPercent == null ? "#64748b" : "#22d3ee"}
                            trailColor="rgba(51, 65, 85, 0.45)"
                          />
                        </div>
                        <div className="system-page-node-summary">
                          <span>遥测 {formatMetric(node.telemetryMessages)}</span>
                          <span>转发 {formatMetric(node.commandForwards)}</span>
                          <span>业务 ACK 发布 {formatMetric(node.ackPublishes)}</span>
                        </div>
                        <div className="system-page-node-summary">
                          <span>最近遥测 {formatMetric(node.lastTelemetryAgeSeconds, "s")}</span>
                          <span>最近ACK {formatMetric(node.lastAckAgeSeconds, "s")}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="system-page-empty">
                  {usingLiveFallback ? "当前暂无设备实时上报。" : "当前桌面端尚未拿到 RK3568 节点运行数据。"}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="system-page-empty">当前桌面端尚未拿到 RK3568 fieldEdge 数据，也没有形成实时设备退化视图。</div>
        )}
      </BaseCard>

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
