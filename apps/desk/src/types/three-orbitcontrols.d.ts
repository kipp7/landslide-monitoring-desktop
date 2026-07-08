declare module "three/examples/jsm/controls/OrbitControls.js" {
  import { Camera, EventDispatcher, Vector3 } from "three";

  export class OrbitControls extends EventDispatcher<{ start: object; end: object; change: object }> {
    constructor(object: Camera, domElement?: HTMLElement);
    target: Vector3;
    enableDamping: boolean;
    dampingFactor: number;
    enableZoom: boolean;
    zoomSpeed: number;
    enableRotate: boolean;
    rotateSpeed: number;
    enablePan: boolean;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    autoRotate: boolean;
    autoRotateSpeed: number;
    update(): void;
    reset(): void;
    saveState(): void;
    dispose(): void;
  }
}
