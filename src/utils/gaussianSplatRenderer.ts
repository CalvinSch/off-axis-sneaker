import * as THREE from 'three';

// ─── GLSL Shaders ────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */`#version 300 es
precision highp float;
precision highp int;

in vec3 a_center;
in vec3 a_col;
in float a_opacity;
in vec3 a_covA;
in vec3 a_covB;

uniform float W;
uniform float H;
uniform float focal_x;
uniform float focal_y;
uniform float tan_fovx;
uniform float tan_fovy;
uniform mat4 projmatrix;
uniform mat4 viewmatrix;

out vec4 vColor;
out vec2 vPosition;
out vec3 vConic;

// Computes the upper-triangle of the 2D screen-space covariance.
// Returns vec3(cov2D_00, cov2D_01, cov2D_11).
vec3 computeCov2D(vec3 mean) {
    vec4 t = viewmatrix * vec4(mean, 1.0);

    float limx = 1.3 * tan_fovx;
    float limy = 1.3 * tan_fovy;
    t.x = clamp(t.x / t.z, -limx, limx) * t.z;
    t.y = clamp(t.y / t.z, -limy, limy) * t.z;

    // Jacobian of the perspective projection at t
    mat3 J = mat3(
        focal_x / t.z,  0.0,           -(focal_x * t.x) / (t.z * t.z),
        0.0,             focal_y / t.z, -(focal_y * t.y) / (t.z * t.z),
        0.0,             0.0,            0.0
    );

    mat3 Wm = mat3(viewmatrix);
    mat3 T = Wm * J;

    // Symmetric 3D covariance from packed upper triangle
    mat3 Vrk = mat3(
        a_covA.x, a_covA.y, a_covA.z,
        a_covA.y, a_covB.x, a_covB.y,
        a_covA.z, a_covB.y, a_covB.z
    );

    mat3 cov = transpose(T) * transpose(Vrk) * T;
    cov[0][0] += 0.3;
    cov[1][1] += 0.3;

    return vec3(cov[0][0], cov[0][1], cov[1][1]);
}

void main() {
    // Cull if behind camera (3DGS convention: front = +z after invertRows012)
    vec4 p_view = viewmatrix * vec4(a_center, 1.0);
    if (p_view.z < 0.1) {
        gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
        vColor = vec4(0.0);
        return;
    }

    // Project center
    vec4 p_hom = projmatrix * vec4(a_center, 1.0);
    float p_w = 1.0 / (p_hom.w + 1e-7);
    vec3 p_proj = p_hom.xyz * p_w;

    // Frustum cull (with generous margin for partially-visible splats)
    if (p_proj.x < -1.4 || p_proj.x > 1.4 || p_proj.y < -1.4 || p_proj.y > 1.4) {
        gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
        vColor = vec4(0.0);
        return;
    }

    vec3 cov2D = computeCov2D(a_center);

    float det = cov2D.x * cov2D.z - cov2D.y * cov2D.y;
    if (det == 0.0) {
        gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
        vColor = vec4(0.0);
        return;
    }

    // Inverse (conic) of the 2D covariance
    float det_inv = 1.0 / det;
    vConic = vec3(cov2D.z * det_inv, -cov2D.y * det_inv, cov2D.x * det_inv);

    // Bounding-box radius = 3-sigma
    float mid = 0.5 * (cov2D.x + cov2D.z);
    float lambda1 = mid + sqrt(max(0.1, mid * mid - det));
    float my_radius = ceil(3.0 * sqrt(lambda1));

    // Center in window pixel space
    vec2 center_px = vec2(
        W * 0.5 * p_proj.x + W * 0.5,
        H * 0.5 * p_proj.y + H * 0.5
    );

    // Quad corners (-1..1 per axis)
    const vec2 QUAD[4] = vec2[4](
        vec2(-1.0, -1.0),
        vec2(-1.0,  1.0),
        vec2( 1.0, -1.0),
        vec2( 1.0,  1.0)
    );
    vec2 q = QUAD[gl_VertexID];
    vPosition = q * my_radius;

    vec2 pos_px = center_px + vPosition;
    gl_Position = vec4(
         (pos_px.x - W * 0.5) / (W * 0.5),
        -(pos_px.y - H * 0.5) / (H * 0.5),
        p_proj.z,
        1.0
    );

    vColor = vec4(a_col, a_opacity);
}
`;

const FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vPosition;
in vec3 vConic;

out vec4 fragColor;

void main() {
    // Evaluate Gaussian at this fragment position within the splat quad
    float power = -0.5 * (
        vConic.x * vPosition.x * vPosition.x +
        2.0 * vConic.y * vPosition.x * vPosition.y +
        vConic.z * vPosition.y * vPosition.y
    );
    if (power > 0.0) discard;

    float alpha = min(0.99, vColor.a * exp(power));
    if (alpha < 1.0 / 255.0) discard;

    // Premultiplied alpha for back-to-front compositing
    fragColor = vec4(vColor.rgb * alpha, alpha);
}
`;

// ─── PLY Parsing helpers ──────────────────────────────────────────────────────

interface PlyProps {
  count: number;
  numProps: number;
  propIndex: Record<string, number>; // property name -> float offset within a vertex
  headerBytes: number;
}

function parsePlyHeader(bytes: Uint8Array): PlyProps {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  const lines = text.split('\n');

  let count = 0;
  const propIndex: Record<string, number> = {};
  let offset = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('element vertex')) {
      count = parseInt(line.split(' ')[2]);
    } else if (line.startsWith('property float')) {
      propIndex[line.split(' ')[2]] = offset++;
    } else if (line === 'end_header') {
      break;
    }
  }

  const headerEnd = text.indexOf('end_header') + 'end_header'.length + 1;
  return { count, numProps: offset, propIndex, headerBytes: headerEnd };
}

function computeCov3D(scale: number[], rot: number[]): number[] {
  const r = rot[0], x = rot[1], y = rot[2], z = rot[3];
  const s0 = scale[0], s1 = scale[1], s2 = scale[2];

  // Columns of the rotation matrix derived from quaternion [w,x,y,z]
  const R00 = 1 - 2*(y*y + z*z), R10 = 2*(x*y - r*z),      R20 = 2*(x*z + r*y);
  const R01 = 2*(x*y + r*z),     R11 = 1 - 2*(x*x + z*z),  R21 = 2*(y*z - r*x);
  const R02 = 2*(x*z - r*y),     R12 = 2*(y*z + r*x),       R22 = 1 - 2*(x*x + y*y);

  // M = S * R (columns of M)
  const M00 = s0*R00, M10 = s1*R10, M20 = s2*R20;
  const M01 = s0*R01, M11 = s1*R11, M21 = s2*R21;
  const M02 = s0*R02, M12 = s1*R12, M22 = s2*R22;

  // Sigma = M^T * M  (upper triangle)
  return [
    M00*M00 + M10*M10 + M20*M20,  // Σ00
    M00*M01 + M10*M11 + M20*M21,  // Σ01
    M00*M02 + M10*M12 + M20*M22,  // Σ02
    M01*M01 + M11*M11 + M21*M21,  // Σ11
    M01*M02 + M11*M12 + M21*M22,  // Σ12
    M02*M02 + M12*M12 + M22*M22,  // Σ22
  ];
}

function sigmoid(v: number) { return 1 / (1 + Math.exp(-v)); }

// ─── Main class ───────────────────────────────────────────────────────────────

export interface SplatCameraParams {
  viewMatrix: Float32Array;      // 3DGS-convention view matrix (rows 0,1,2 negated)
  viewProjMatrix: Float32Array;  // 3DGS-convention view-proj matrix
  W: number;
  H: number;
  focal_x: number;
  focal_y: number;
  tan_fovx: number;
  tan_fovy: number;
}

export class GaussianSplatRenderer {
  readonly canvas: HTMLCanvasElement;

  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private buffers: {
    color: WebGLBuffer;
    center: WebGLBuffer;
    opacity: WebGLBuffer;
    covA: WebGLBuffer;
    covB: WebGLBuffer;
  } | null = null;

  private worker: Worker | null = null;
  private gaussianCount = 0;
  private maxGaussians = 0;
  private isWorkerSorting = false;
  private pendingCameraParams: SplatCameraParams | null = null;
  private hasData = false;
  private onFirstData: (() => void) | null = null;

  // Column-major 4×4 model matrix: places the scene in Three.js world space.
  // Default identity; overwritten after PLY load based on bounding box.
  sceneModelMatrix: Float32Array = new Float32Array([
    1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1
  ]);

  private uLoc: Record<string, WebGLUniformLocation | null> = {};

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

    // Behind any existing children (Three.js canvas goes on top)
    container.insertBefore(this.canvas, container.firstChild ?? null);

    const gl = this.canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available for Gaussian splatting');
    this.gl = gl;

    this.compileShaders();
    this.setupBuffers();
    this.setupBlending();
  }

  // ── GL setup ──────────────────────────────────────────────────────────────

  private compileShaders(): void {
    const gl = this.gl;

    const compileShader = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const vert = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Shader link error: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;

    // Cache uniform locations
    for (const name of ['W', 'H', 'focal_x', 'focal_y', 'tan_fovx', 'tan_fovy',
                        'projmatrix', 'viewmatrix']) {
      this.uLoc[name] = gl.getUniformLocation(prog, name);
    }
  }

  private setupBuffers(): void {
    const gl = this.gl;
    const prog = this.program!;
    gl.useProgram(prog);

    const makeAttrib = (name: string, size: number): WebGLBuffer => {
      const loc = gl.getAttribLocation(prog, name);
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
      return buf;
    };

    this.buffers = {
      color:   makeAttrib('a_col',     3),
      center:  makeAttrib('a_center',  3),
      opacity: makeAttrib('a_opacity', 1),
      covA:    makeAttrib('a_covA',    3),
      covB:    makeAttrib('a_covB',    3),
    };
  }

  private setupBlending(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
  }

  // ── PLY loading ───────────────────────────────────────────────────────────

  async loadPly(url: string, maxGaussians = 1_000_000, onFirstData?: () => void): Promise<void> {
    this.onFirstData = onFirstData ?? null;
    console.log('[SplatRenderer] Fetching PLY…');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`PLY fetch failed: ${response.status}`);

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const { count, numProps, propIndex, headerBytes } = parsePlyHeader(bytes);

    const needed = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
                    'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
                    'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    for (const p of needed) {
      if (propIndex[p] == null)
        throw new Error(`PLY missing required property: ${p}`);
    }

    const SH_C0 = 0.28209479177387814;
    const total = Math.min(count, maxGaussians);

    const positions  = new Float32Array(total * 3);
    const opacities  = new Float32Array(total);
    const colors     = new Float32Array(total * 3);
    const cov3Ds     = new Float32Array(total * 6);

    const view = new DataView(buffer);
    const base = headerBytes;
    const stride = numProps * 4;

    const get = (i: number, prop: string) =>
      view.getFloat32(base + i * stride + propIndex[prop]! * 4, true);

    let xmin = Infinity, ymin = Infinity, zmin = Infinity;
    let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;

    for (let i = 0; i < total; i++) {
      const px = get(i, 'x'), py = get(i, 'y'), pz = get(i, 'z');
      positions[i*3]   = px;
      positions[i*3+1] = py;
      positions[i*3+2] = pz;

      if (px < xmin) xmin = px; if (px > xmax) xmax = px;
      if (py < ymin) ymin = py; if (py > ymax) ymax = py;
      if (pz < zmin) zmin = pz; if (pz > zmax) zmax = pz;

      opacities[i] = sigmoid(get(i, 'opacity'));

      colors[i*3]   = Math.max(0, Math.min(1, 0.5 + SH_C0 * get(i, 'f_dc_0')));
      colors[i*3+1] = Math.max(0, Math.min(1, 0.5 + SH_C0 * get(i, 'f_dc_1')));
      colors[i*3+2] = Math.max(0, Math.min(1, 0.5 + SH_C0 * get(i, 'f_dc_2')));

      const sc = [
        Math.exp(get(i, 'scale_0')),
        Math.exp(get(i, 'scale_1')),
        Math.exp(get(i, 'scale_2')),
      ];
      const rot = [get(i, 'rot_0'), get(i, 'rot_1'), get(i, 'rot_2'), get(i, 'rot_3')];
      const len = Math.sqrt(rot[0]**2 + rot[1]**2 + rot[2]**2 + rot[3]**2);
      rot[0] /= len; rot[1] /= len; rot[2] /= len; rot[3] /= len;

      const cov = computeCov3D(sc, rot);
      cov3Ds[i*6]   = cov[0];
      cov3Ds[i*6+1] = cov[1];
      cov3Ds[i*6+2] = cov[2];
      cov3Ds[i*6+3] = cov[3];
      cov3Ds[i*6+4] = cov[4];
      cov3Ds[i*6+5] = cov[5];
    }

    this.gaussianCount = total;
    this.maxGaussians  = total;

    // Auto-transform: center the scene and scale so its largest axis = 2 Three.js units,
    // then place the center 2m behind the screen (z = -2 in Three.js world space).
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2, cz = (zmin + zmax) / 2;
    const maxDim = Math.max(xmax - xmin, ymax - ymin, zmax - zmin);
    const s = 2.0 / Math.max(maxDim, 1e-6);
    const tz = -2.0; // meters behind screen
    // Column-major 4×4: scale, then translate center to (0,0,tz)
    this.sceneModelMatrix = new Float32Array([
      s, 0, 0, 0,
      0, s, 0, 0,
      0, 0, s, 0,
      -cx * s, -cy * s, -cz * s + tz, 1
    ]);

    console.log(`[SplatRenderer] Loaded ${total} gaussians. BBox: [${xmin.toFixed(2)},${xmax.toFixed(2)}] x [${ymin.toFixed(2)},${ymax.toFixed(2)}] x [${zmin.toFixed(2)},${zmax.toFixed(2)}]. scale=${s.toFixed(4)} tz=${tz}`);

    this.worker = new Worker('/splat-worker.js');
    this.worker.onmessage = (e) => this.onWorkerMessage(e);
    this.worker.postMessage({
      gaussians: { positions, opacities, colors, cov3Ds, count: total }
    });
    this.hasData = false; // data pending from worker
  }

  private onWorkerMessage(e: MessageEvent): void {
    const { data } = e.data;
    const gl = this.gl;
    const bufs = this.buffers!;

    const upload = (buf: WebGLBuffer, arr: Float32Array) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    };

    upload(bufs.color,   data.colors);
    upload(bufs.center,  data.positions);
    upload(bufs.opacity, data.opacities);
    upload(bufs.covA,    data.cov3Da);
    upload(bufs.covB,    data.cov3Db);

    const isFirst = !this.hasData;
    this.hasData = true;
    this.isWorkerSorting = false;

    if (isFirst && this.onFirstData) {
      this.onFirstData();
      this.onFirstData = null;
    }

    // Immediately re-sort with the latest camera if it changed
    if (this.pendingCameraParams) {
      this.requestSort(this.pendingCameraParams.viewProjMatrix);
    }
  }

  private lastVpm = new Float32Array(16);
  private requestSort(vpm: Float32Array): void {
    if (this.isWorkerSorting || !this.worker) return;

    // Only re-sort when view direction changed enough
    const dot = this.lastVpm[2]  * vpm[2]
              + this.lastVpm[6]  * vpm[6]
              + this.lastVpm[10] * vpm[10];
    if (Math.abs(dot - 1) < 0.01) return;

    this.lastVpm.set(vpm);
    this.isWorkerSorting = true;
    this.worker.postMessage({ viewMatrix: vpm, maxGaussians: this.maxGaussians });
  }

  // ── Camera update ─────────────────────────────────────────────────────────

  updateCamera(params: SplatCameraParams): void {
    this.pendingCameraParams = params;
    if (this.hasData) {
      this.requestSort(params.viewProjMatrix);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(): void {
    if (!this.hasData || !this.program || !this.buffers) return;

    const params = this.pendingCameraParams;
    if (!params) return;

    const gl = this.gl;
    const { W, H } = params;

    if (gl.canvas.width !== W || gl.canvas.height !== H) {
      (gl.canvas as HTMLCanvasElement).width  = W;
      (gl.canvas as HTMLCanvasElement).height = H;
    }

    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.uniform1f(this.uLoc['W']!,         W);
    gl.uniform1f(this.uLoc['H']!,         H);
    gl.uniform1f(this.uLoc['focal_x']!,   params.focal_x);
    gl.uniform1f(this.uLoc['focal_y']!,   params.focal_y);
    gl.uniform1f(this.uLoc['tan_fovx']!,  params.tan_fovx);
    gl.uniform1f(this.uLoc['tan_fovy']!,  params.tan_fovy);
    gl.uniformMatrix4fv(this.uLoc['projmatrix']!,  false, params.viewProjMatrix);
    gl.uniformMatrix4fv(this.uLoc['viewmatrix']!,  false, params.viewMatrix);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.maxGaussians);
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  resize(w: number, h: number): void {
    this.canvas.width  = w;
    this.canvas.height = h;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    const gl = this.gl;
    if (this.buffers) {
      Object.values(this.buffers).forEach(b => gl.deleteBuffer(b));
      this.buffers = null;
    }
    if (this.program) { gl.deleteProgram(this.program); this.program = null; }
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}

// ─── Camera matrix helpers ────────────────────────────────────────────────────

/**
 * Convert a Three.js camera (after updateMatrixWorld) into the 3DGS rendering
 * convention expected by the splat shaders (all 3 direction rows negated).
 */
export function buildSplatCameraParams(
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  sceneModelMatrix?: Float32Array
): SplatCameraParams {
  camera.updateMatrixWorld();

  const ve = camera.matrixWorldInverse.elements;
  const pe = camera.projectionMatrix.elements;

  // If a scene model matrix M is provided, compute effective view: V * M
  // (transforms from scene-local space into camera space)
  let veEff: ArrayLike<number>;
  if (sceneModelMatrix) {
    const vm = new Float32Array(16);
    // vm = ve * sceneModelMatrix  (column-major mat4 multiply)
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += ve[k*4 + row] * sceneModelMatrix[col*4 + k];
        vm[col*4 + row] = sum;
      }
    }
    veEff = vm;
  } else {
    veEff = ve;
  }

  // vm: view matrix with rows 0,1,2 negated (3DGS convention)
  const vm = new Float32Array(16);
  for (let i = 0; i < 16; i++) vm[i] = veEff[i];
  invertRows012(vm);

  // vpm: projection * effective view
  const vpm = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += pe[k*4 + row] * veEff[col*4 + k];
      vpm[col*4 + row] = sum;
    }
  }
  invertRows012(vpm);

  // Focal lengths in pixels from projection matrix diagonal
  const focal_x_ndc = pe[0];   // col0,row0 = 2n/(r-l)
  const focal_y_ndc = pe[5];   // col1,row1 = 2n/(t-b)
  const focal_x = focal_x_ndc * W / 2;
  const focal_y = focal_y_ndc * H / 2;

  // tan_fov accounts for off-axis shift (pe[8]=cx, pe[9]=cy in NDC)
  const cx_ndc = pe[8];
  const cy_ndc = pe[9];
  const tan_fovx = (1 + Math.abs(cx_ndc)) / focal_x_ndc;
  const tan_fovy = (1 + Math.abs(cy_ndc)) / focal_y_ndc;

  return { viewMatrix: vm, viewProjMatrix: vpm, W, H, focal_x, focal_y, tan_fovx, tan_fovy };
}

function invertRows012(m: Float32Array): void {
  for (let row = 0; row <= 2; row++) {
    m[row]      = -m[row];
    m[row +  4] = -m[row + 4];
    m[row +  8] = -m[row + 8];
    m[row + 12] = -m[row + 12];
  }
}
