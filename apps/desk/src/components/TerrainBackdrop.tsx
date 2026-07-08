import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { TerrainQuality } from "../stores/settingsStore";

type TerrainBackdropProps = {
  className?: string;
  quality?: TerrainQuality;
};

type ResolvedTerrainQuality = Exclude<TerrainQuality, "auto">;

type TerrainPreset = {
  segX: number;
  segZ: number;
  maxPixelRatio: number;
  pointSize: number;
  pointsAlpha: number;
  meshOpacity: number;
  enableRim: boolean;
  enableGrid: boolean;
  scanSpeed: number;
  ringWidth: number;
};

function resolveInitialQuality(quality: TerrainQuality): ResolvedTerrainQuality {
  if (quality === "auto") return "medium";
  return quality;
}

function getPreset(quality: ResolvedTerrainQuality): TerrainPreset {
  if (quality === "high") {
    return {
      segX: 360,
      segZ: 270,
      maxPixelRatio: 1.5,
      pointSize: 1.35,
      pointsAlpha: 0.82,
      meshOpacity: 0.26,
      enableRim: true,
      enableGrid: true,
      scanSpeed: 0.24,
      ringWidth: 0.04
    };
  }

  if (quality === "low") {
    return {
      segX: 160,
      segZ: 120,
      maxPixelRatio: 1,
      pointSize: 1.1,
      pointsAlpha: 0.72,
      meshOpacity: 0.2,
      enableRim: false,
      enableGrid: false,
      scanSpeed: 0.2,
      ringWidth: 0.05
    };
  }

  return {
    segX: 240,
    segZ: 180,
    maxPixelRatio: 1.25,
    pointSize: 1.25,
    pointsAlpha: 0.78,
    meshOpacity: 0.24,
    enableRim: true,
    enableGrid: true,
    scanSpeed: 0.22,
    ringWidth: 0.045
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function fract(n: number) {
  return n - Math.floor(n);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iz: number) {
  return fract(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123);
}

function valueNoise2(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x: number, z: number) {
  let sum = 0;
  let amp = 0.6;
  let freq = 1;
  for (let i = 0; i < 5; i += 1) {
    const n = valueNoise2(x * freq, z * freq) * 2 - 1;
    sum += n * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

function ridged(x: number, z: number) {
  let sum = 0;
  let amp = 0.8;
  let freq = 1;
  for (let i = 0; i < 4; i += 1) {
    const n = valueNoise2(x * freq, z * freq) * 2 - 1;
    const v = 1 - Math.abs(n);
    sum += v * v * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

function heightColor(height01: number) {
  const low = { r: 28, g: 110, b: 160 };
  const mid = { r: 34, g: 211, b: 238 };
  const high = { r: 180, g: 224, b: 242 };

  if (height01 < 0.55) {
    const t = height01 / 0.55;
    return {
      r: Math.round(lerp(low.r, mid.r, t)),
      g: Math.round(lerp(low.g, mid.g, t)),
      b: Math.round(lerp(low.b, mid.b, t))
    };
  }

  const t = (height01 - 0.55) / 0.45;
  return {
    r: Math.round(lerp(mid.r, high.r, t)),
    g: Math.round(lerp(mid.g, high.g, t)),
    b: Math.round(lerp(mid.b, high.b, t))
  };
}

function terrainHeight(nx: number, nz: number, seed: number) {
  const mx = nx * 1.05 + 0.03;
  const mz = nz * 1.26 - 0.04;

  const r = Math.sqrt(mx * mx + mz * mz);
  const base = Math.exp(-(r * r) * 1.22);
  const falloff = smoothstep(1.38, 0.18, r);

  const warp = fbm(mx * 0.9 + seed * 0.33, mz * 0.9 - seed * 0.21) * 0.16;
  const wx = mx + warp * 1.1;
  const wz = mz - warp * 0.95;

  const rg = ridged(wx * 3.35, wz * 3.35);
  const n = fbm(wx * 7.8, wz * 7.8) * 0.16 + fbm(wx * 15.6, wz * 15.6) * 0.06;
  const ridgeLine = Math.exp(-Math.pow(mx * 0.72 + mz * 0.28, 2) * 5.2) * 0.1;

  let h = base * (0.62 + rg * 0.75 + n) + ridgeLine * base;
  h *= falloff;
  h = Math.max(0, h - 0.03);
  h = Math.pow(h, 1.18);
  return h;
}

const POINTS_VERTEX_SHADER = /* glsl */ `
  attribute float aHeight;

  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uRadius;
  uniform vec3 uLight;

  varying float vHeight;
  varying float vDist;
  varying float vShade;

  void main() {
    vHeight = aHeight;
    vDist = length(position.xz) / uRadius;

    vec3 n = normalize(normalMatrix * normal);
    vec3 l = normalize(uLight);
    vShade = clamp(dot(n, l), 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float size = uPointSize * uPixelRatio * (1.0 + vHeight * 0.72);
    size = min(size, uPointSize * uPixelRatio * 1.55);
    gl_PointSize = size * (1.0 / max(0.35, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const POINTS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAlpha;
  uniform float uScanSpeed;
  uniform float uRingWidth;

  uniform vec3 uLow;
  uniform vec3 uMid;
  uniform vec3 uHigh;
  uniform vec3 uRingColor;

  varying float vHeight;
  varying float vDist;
  varying float vShade;

  vec3 heightColor(float h) {
    if (h < 0.55) {
      float t = h / 0.55;
      return mix(uLow, uMid, t);
    }
    float t = (h - 0.55) / 0.45;
    return mix(uMid, uHigh, t);
  }

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float soft = smoothstep(0.52, 0.0, d);
    float edge = smoothstep(0.5, 0.18, d);

    float scan = mod(uTime * uScanSpeed, 1.35);
    float ring = abs(vDist - scan);
    float ringHit = smoothstep(uRingWidth, 0.0, ring);

    vec3 col = heightColor(vHeight);
    float peakMask = smoothstep(0.68, 1.0, vHeight);
    peakMask = pow(peakMask, 1.4);
    float peakFade = mix(1.0, 0.36, peakMask);
    col *= (0.6 + vShade * 0.42 + vHeight * 0.03);
    col = mix(col, col * col, peakMask * 0.85);
    col *= peakFade;
    col = mix(col, uRingColor, ringHit);

    float alpha = soft * uAlpha * (0.42 + vShade * 0.78) * peakFade;
    alpha += ringHit * 0.14 * edge;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const RIM_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const RIM_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uRimColor;
  uniform float uRimPower;
  uniform float uRimAlpha;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0);
    float rim = pow(fresnel, uRimPower);
    float alpha = rim * uRimAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uRimColor, alpha);
  }
`;

export function TerrainBackdrop(props: TerrainBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestedQuality: TerrainQuality = props.quality ?? "auto";
  const [quality, setQuality] = useState<ResolvedTerrainQuality>(() => resolveInitialQuality(requestedQuality));
  const autoLockedRef = useRef(false);

  useEffect(() => {
    autoLockedRef.current = false;
    setQuality(resolveInitialQuality(requestedQuality));
  }, [requestedQuality]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preset = getPreset(quality);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.07;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(2.2, 2.5, 2.3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.rotateSpeed = 0.65;
    controls.minDistance = 2.2;
    controls.maxDistance = 7.2;
    controls.minPolarAngle = 0.75;
    controls.maxPolarAngle = 1.35;
    controls.target.set(0, 0.08, 0);
    controls.update();
    controls.saveState();

    const ambient = new THREE.AmbientLight(0x0b2a3a, 1.05);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xe6fbff, 0x061021, 0.52);
    hemi.position.set(0, 2.1, 0);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xe6fbff, 1.1);
    key.position.set(4, 5, 2);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const size = 3.95;
    const maxHeight = 0.55;
    const segX = preset.segX;
    const segZ = preset.segZ;

    const geometry = new THREE.PlaneGeometry(size, size, segX, segZ);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const vCount = pos.count;

    const heights = new Float32Array(vCount);
    let minH = Infinity;
    let maxH = -Infinity;

    for (let i = 0; i < vCount; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const nx = x / (size * 0.5);
      const nz = z / (size * 0.5);
      const seed = fract(Math.sin((nx + 2.7) * 91.7 + (nz - 1.9) * 57.3) * 43758.5453);
      const h = terrainHeight(nx, nz, seed);
      heights[i] = h;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
      pos.setY(i, h * maxHeight);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    const hSpan = Math.max(0.0001, maxH - minH);
    const aHeight = new Float32Array(vCount);
    const colors = new Float32Array(vCount * 3);

    for (let i = 0; i < vCount; i += 1) {
      const h01 = clamp((heights[i]! - minH) / hSpan, 0, 1);
      aHeight[i] = h01;
      const rgb = heightColor(h01);
      const peakFade = 1 - smoothstep(0.72, 1.0, h01) * 0.18;
      const tone = (0.54 + h01 * 0.26) * peakFade;
      colors[i * 3] = (rgb.r / 255) * tone;
      colors[i * 3 + 1] = (rgb.g / 255) * tone;
      colors[i * 3 + 2] = (rgb.b / 255) * tone;
    }

    geometry.setAttribute("aHeight", new THREE.BufferAttribute(aHeight, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const meshMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: preset.meshOpacity,
      roughness: 0.9,
      metalness: 0,
      emissive: new THREE.Color(0x0b2a3a),
      emissiveIntensity: 0.72,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, meshMaterial);
    scene.add(mesh);

    const rimMaterial = preset.enableRim
      ? new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uRimColor: { value: new THREE.Color(125 / 255, 211 / 255, 252 / 255) },
            uRimPower: { value: 2.6 },
            uRimAlpha: { value: 0.18 }
          },
          vertexShader: RIM_VERTEX_SHADER,
          fragmentShader: RIM_FRAGMENT_SHADER
        })
      : null;

    const rimMesh = rimMaterial ? new THREE.Mesh(geometry, rimMaterial) : null;
    if (rimMesh) scene.add(rimMesh);

    type PointsUniforms = {
      uTime: { value: number };
      uAlpha: { value: number };
      uScanSpeed: { value: number };
      uRingWidth: { value: number };
      uPointSize: { value: number };
      uPixelRatio: { value: number };
      uRadius: { value: number };
      uLight: { value: THREE.Vector3 };
      uLow: { value: THREE.Color };
      uMid: { value: THREE.Color };
      uHigh: { value: THREE.Color };
      uRingColor: { value: THREE.Color };
    };

    const pointsUniforms: PointsUniforms = {
      uTime: { value: 0 },
      uAlpha: { value: preset.pointsAlpha },
      uScanSpeed: { value: preset.scanSpeed },
      uRingWidth: { value: preset.ringWidth },
      uPointSize: { value: preset.pointSize },
      uPixelRatio: { value: 1 },
      uRadius: { value: size * 0.5 },
      uLight: { value: new THREE.Vector3(0.58, 0.82, 0.28) },
      uLow: { value: new THREE.Color(28 / 255, 110 / 255, 160 / 255) },
      uMid: { value: new THREE.Color(34 / 255, 211 / 255, 238 / 255) },
      uHigh: { value: new THREE.Color(180 / 255, 224 / 255, 242 / 255) },
      uRingColor: { value: new THREE.Color(245 / 255, 158 / 255, 11 / 255) }
    };

    const pointsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: pointsUniforms,
      vertexShader: POINTS_VERTEX_SHADER,
      fragmentShader: POINTS_FRAGMENT_SHADER
    });

    const points = new THREE.Points(geometry, pointsMaterial);
    scene.add(points);

    const baseGrid = preset.enableGrid ? new THREE.GridHelper(size * 1.04, 22, 0x22d3ee, 0x1e3a8a) : null;
    if (baseGrid) {
      baseGrid.material = new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.07
      });
      baseGrid.position.y = -0.02;
      scene.add(baseGrid);
    }

    let raf = 0;
    const clock = new THREE.Clock();
    let lastInteraction = performance.now();
    let lastFrameAt = performance.now();
    let lastDrawAt = performance.now();
    let sampleCount = 0;
    let sampleTotalDt = 0;
    const minFrameMs = quality === "low" ? 1000 / 30 : 0;

    const onStart = () => {
      lastInteraction = performance.now();
      controls.autoRotate = false;
    };

    const onEnd = () => {
      lastInteraction = performance.now();
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    const onDblClick = () => {
      controls.reset();
      lastInteraction = performance.now();
    };
    canvas.addEventListener("dblclick", onDblClick);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      const pixelRatio = Math.max(1, Math.min(preset.maxPixelRatio, window.devicePixelRatio || 1));
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(nextW, nextH, false);
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      pointsUniforms.uPixelRatio.value = pixelRatio;
    };

    const render = () => {
      const t = clock.getElapsedTime();
      const now = performance.now();

      const dt = now - lastFrameAt;
      lastFrameAt = now;
      if (minFrameMs > 0 && now - lastDrawAt < minFrameMs) {
        raf = window.requestAnimationFrame(render);
        return;
      }
      lastDrawAt = now;

      controls.autoRotate = now - lastInteraction > 2200;
      controls.autoRotateSpeed = 0.25;

      pointsUniforms.uTime.value = t;

      controls.update();
      renderer.render(scene, camera);

      if (requestedQuality === "auto" && !autoLockedRef.current && sampleCount < 90) {
        sampleCount += 1;
        sampleTotalDt += dt;
        if (sampleCount >= 90) {
          const avgDt = sampleTotalDt / Math.max(1, sampleCount);
          const fps = 1000 / Math.max(1, avgDt);
          const next: ResolvedTerrainQuality = fps < 45 ? "low" : fps < 58 ? "medium" : "high";
          autoLockedRef.current = true;
          if (next !== quality) {
            setQuality(next);
          }
        }
      }

      raf = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("dblclick", onDblClick);
      window.cancelAnimationFrame(raf);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      controls.dispose();
      if (baseGrid) {
        baseGrid.geometry.dispose();
        (baseGrid.material as THREE.Material).dispose();
      }
      pointsMaterial.dispose();
      rimMaterial?.dispose();
      meshMaterial.dispose();
      geometry.dispose();
      renderer.dispose();
    };
  }, [quality, requestedQuality]);

  return <canvas ref={canvasRef} className={props.className} aria-hidden="true" />;
}
