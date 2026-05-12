import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HeadPose } from './headPose';
import { CameraDebugOffsets, OffAxisCamera } from './offAxisCamera';
import { calibrationManager, CalibrationData } from './calibration';
import { GaussianSplatRenderer, buildSplatCameraParams } from './gaussianSplatRenderer';
export interface ThreeSceneOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
  /** Non-empty string loads that URL. Omitted, `null`, or `''` skips PLY (wireframe room only). */
  environmentPlyUrl?: string | null;
}

export class ThreeSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private offAxisCamera: OffAxisCamera;
  private model: THREE.Object3D | null = null;
  private imagePlanes: THREE.Mesh[] = [];
  private animationFrameId: number | null = null;
  private isRunning = false;
  private currentHeadPose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private debugMode: boolean = false;
  private debugHelpers: THREE.Object3D[] = [];
  private roomObjects: THREE.Object3D[] = [];
  private splatRenderer: GaussianSplatRenderer | null = null;

  constructor(options: ThreeSceneOptions) {
    const width = options.width || options.container.clientWidth;
    const height = options.height || options.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent — splat canvas sits behind

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 1000);
    this.camera.position.z = 5;

    const calibration = calibrationManager.getCalibration();
    calibration.pixelWidth = width;
    calibration.pixelHeight = height;
    calibrationManager.updatePixelDimensions(width, height);

    this.offAxisCamera = new OffAxisCamera(this.camera, calibration);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,  // transparent so splat canvas shows through
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.pointerEvents = 'none';
    options.container.appendChild(this.renderer.domElement);

    this.loadShoeModel();
    this.loadImagePlane('/models/ringo - shea.png',  0.2, -0.5, 0,  0.25, -0.05);
    this.loadImagePlane('/models/Beatles - Shea.png', 0.45, -0.3, 1, 0,    0);
    this.createWireframeRoom();
    this.createDebugHelpers();

    const raw = options.environmentPlyUrl;
    const plyUrl = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (plyUrl) {
      this.initSplatRenderer(options.container, plyUrl);
    }
  }

  private initSplatRenderer(container: HTMLElement, url: string): void {
    try {
      this.splatRenderer = new GaussianSplatRenderer(container);
      this.splatRenderer
        .loadPly(url, 1_000_000, () => this.removeWireframeRoom())
        .catch((err) => console.error('[SplatRenderer] load failed:', err));
    } catch (err) {
      console.error('[SplatRenderer] init failed:', err);
    }
  }

  private loadImagePlane(url: string, height: number, depth: number, renderOrder: number, x = 0, y = 0): void {
    new THREE.TextureLoader().load(
      encodeURI(url),
      (texture) => {
        const imgW = texture.image.naturalWidth  || texture.image.width  || 1;
        const imgH = texture.image.naturalHeight || texture.image.height || 1;
        const geo = new THREE.PlaneGeometry(height * (imgW / imgH), height);
        const mat = new THREE.ShaderMaterial({
          uniforms: { map: { value: texture } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D map;
            varying vec2 vUv;
            void main() {
              vec4 c = texture2D(map, vUv);
              if (c.r > 0.93 && c.g > 0.93 && c.b > 0.93) discard;
              gl_FragColor = c;
            }
          `,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, depth);
        mesh.renderOrder = renderOrder;
        this.imagePlanes.push(mesh);
        this.scene.add(mesh);
      },
      undefined,
      (err) => console.error('[ImagePlane] failed to load', url, err),
    );
  }

  private loadShoeModel(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(1, 1, 1);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-1, -1, 0.5);
    this.scene.add(directionalLight2);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/models/shoe.glb',
      (gltf) => {
        this.model = gltf.scene;
        this.model.position.set(0, -0.09, -0.03);
        this.model.rotation.set(0, -0.628, 0);
        this.model.scale.set(0.071, 0.071, 0.071);
        this.scene.add(this.model);
      },
      undefined,
      (error) => {
        console.error('Error loading shoe model:', error);
      }
    );
  }

  private createWireframeRoom(): void {
    this.removeWireframeRoom();

    const screenDims = this.offAxisCamera.getScreenDimensions();
    const roomWidth = screenDims.width;
    const roomHeight = screenDims.height;
    const roomDepth = 0.35;
    const gridDivisions = 8;
    const gridColor = 0xff8c00;

    const wallMaterial = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
      depthWrite: true,
      linewidth: 8
    });

    const createGridWall = (width: number, height: number): THREE.LineSegments => {
      const geometry = new THREE.BufferGeometry();
      const vertices: number[] = [];

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2 + t * width, -height / 2, 0);
        vertices.push(-width / 2 + t * width, height / 2, 0);
      }

      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2, -height / 2 + t * height, 0);
        vertices.push(width / 2, -height / 2 + t * height, 0);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return new THREE.LineSegments(geometry, wallMaterial);
    };

    const backWall = createGridWall(roomWidth, roomHeight);
    backWall.position.z = -roomDepth;
    this.scene.add(backWall);
    this.roomObjects.push(backWall);

    const leftWall = createGridWall(roomDepth, roomHeight);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -roomWidth / 2;
    leftWall.position.z = -roomDepth / 2;
    this.scene.add(leftWall);
    this.roomObjects.push(leftWall);

    const rightWall = createGridWall(roomDepth, roomHeight);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = roomWidth / 2;
    rightWall.position.z = -roomDepth / 2;
    this.scene.add(rightWall);
    this.roomObjects.push(rightWall);

    const floor = createGridWall(roomWidth, roomDepth);
    floor.rotation.x = Math.PI / 2;
    floor.position.y = -roomHeight / 2;
    floor.position.z = -roomDepth / 2;
    this.scene.add(floor);
    this.roomObjects.push(floor);

    const ceiling = createGridWall(roomWidth, roomDepth);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = roomHeight / 2;
    ceiling.position.z = -roomDepth / 2;
    this.scene.add(ceiling);
    this.roomObjects.push(ceiling);

    const screenFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(roomWidth, roomHeight)),
      new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 4,
        depthTest: true,
        depthWrite: true
      })
    );
    screenFrame.position.z = 0.001;
    this.scene.add(screenFrame);
    this.roomObjects.push(screenFrame);
  }

  private removeWireframeRoom(): void {
    this.roomObjects.forEach(obj => {
      this.scene.remove(obj);
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) {
          obj.material.dispose();
        }
      }
    });
    this.roomObjects = [];
  }

  private createDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.debugHelpers.push(axesHelper);
    this.scene.add(axesHelper);

    const headPositionMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff })
    );
    headPositionMarker.visible = false;
    this.debugHelpers.push(headPositionMarker);
    this.scene.add(headPositionMarker);
  }

  updateHeadPose(headPose: HeadPose): void {
    this.currentHeadPose = headPose;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.debugHelpers.forEach(helper => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    if (!this.splatRenderer) {
      this.createWireframeRoom();
    }
  }

  setCameraDebugOffsets(offsets: CameraDebugOffsets): void {
    this.offAxisCamera.setCameraDebugOffsets(offsets);
  }

  getCameraDebugOffsets(): CameraDebugOffsets {
    return this.offAxisCamera.getCameraDebugOffsets();
  }

  updateModelPosition(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.position.set(x, y, z);
    }
  }

  updateModelScale(scale: number): void {
    if (this.model) {
      this.model.scale.set(scale, scale, scale);
    }
  }

  getModelPosition(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.position.x,
        y: this.model.position.y,
        z: this.model.position.z
      };
    }
    return { x: 0, y: -0.09, z: -0.03 };
  }

  getModelScale(): number {
    if (this.model) {
      return this.model.scale.x;
    }
    return 0.071;
  }

  updateModelRotation(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.rotation.set(x, y, z);
    }
  }

  getModelRotation(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.rotation.x,
        y: this.model.rotation.y,
        z: this.model.rotation.z
      };
    }
    return { x: 0, y: -0.628, z: 0 };
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    this.offAxisCamera.updateFromHeadPose(this.currentHeadPose);

    if (this.debugMode && this.debugHelpers.length > 1) {
      const worldPos = this.offAxisCamera.headPoseToWorldPosition(this.currentHeadPose);
      this.debugHelpers[1].position.set(worldPos.x, worldPos.y, worldPos.z);
    }

    // Splat rendering: update camera matrices and render to the background canvas
    if (this.splatRenderer) {
      this.camera.updateMatrixWorld();
      // Use the actual GL buffer dimensions (set by Three.js setSize × setPixelRatio)
      const W = this.renderer.domElement.width;
      const H = this.renderer.domElement.height;
      if (W > 0 && H > 0) {
        const params = buildSplatCameraParams(
          this.camera, W, H, this.splatRenderer.sceneModelMatrix
        );
        this.splatRenderer.updateCamera(params);
        this.splatRenderer.render();
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.animate();
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  resize(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.camera.aspect = width / height;
    }
    this.renderer.setSize(width, height);
    if (this.splatRenderer) {
      // Sync to the actual buffer dimensions Three.js just set
      this.splatRenderer.resize(this.renderer.domElement.width, this.renderer.domElement.height);
    }
  }

  dispose(): void {
    this.stop();

    this.removeWireframeRoom();

    if (this.splatRenderer) {
      this.splatRenderer.dispose();
      this.splatRenderer = null;
    }

    for (const plane of this.imagePlanes) {
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
      this.scene.remove(plane);
    }
    this.imagePlanes = [];

    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
