// Port of play-inUT-NSi.js lines 34371-35045: the GPU-instanced grass, tufts ("pills") and flowers field
// with its top-down ground height capture.
//
// The field does not query the chunk manager. It reads the world by rendering the scene from above into a
// height texture (GroundCapture.capture). The scene must put objects on these camera layers:
//   2 = terrain chunk meshes (need the aMat and carved attributes; grass grows on aMat 1 Grass / 8 Plaza),
//   5 = surface dressing (writes height, no grass),
//   4 = hub caps (height + grass), 3 = hub dressing (height, no grass); 4 and 3 only while capture.hub.
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise';
import { PAINT_GROUND_GLSL, groundCaptureUniforms } from './painterly';

export interface GrassQuality {
  nearSpacing: number;
  nearR: number;
  farR: number;
  block: number;
  flowers: boolean;
}

export type GrassQualityName = 'lite' | 'low' | 'medium' | 'high' | 'ultra';

export const GRASS_QUALITY: Record<GrassQualityName, GrassQuality> = { // Ky (34371)
  lite: { nearSpacing: 0.27, nearR: 11, farR: 30, block: 3, flowers: false },
  low: { nearSpacing: 0.2, nearR: 15, farR: 40, block: 3, flowers: false },
  medium: { nearSpacing: 0.16, nearR: 18, farR: 44, block: 3, flowers: true },
  high: { nearSpacing: 0.13, nearR: 21, farR: 46, block: 2, flowers: true },
  ultra: { nearSpacing: 0.105, nearR: 25, farR: 56, block: 2, flowers: true },
};

export const CAPTURE_SIZE = 144; // qy (34378) metres covered by the height capture
export const CAPTURE_RES = 576; // Jy (34379) capture resolution in pixels

export const CAPTURE_LAYER_TERRAIN = 2;
export const CAPTURE_LAYER_HUB_DRESSING = 3;
export const CAPTURE_LAYER_HUB_CAPS = 4;
export const CAPTURE_LAYER_DRESSING = 5;

/** Top-down orthographic capture: r = world ground height, g = grass coverage. */
export class GroundCapture { // Yy (34380)
  rt: THREE.WebGLRenderTarget;
  cam: THREE.OrthographicCamera;
  center = new THREE.Vector2(1e9, 1e9);
  vp = new THREE.Matrix4();
  mat: THREE.ShaderMaterial;
  capMat: THREE.ShaderMaterial;
  dressMat: THREE.ShaderMaterial;
  hub = false;
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(CAPTURE_RES, CAPTURE_RES, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.rt.texture.colorSpace = ``;
    const half = CAPTURE_SIZE / 2;
    this.cam = new THREE.OrthographicCamera(-72, half, half, -72, 1, 180);
    this.cam.up.set(0, 0, -1);
    this.cam.layers.set(CAPTURE_LAYER_TERRAIN);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aMat; attribute float carved;
        varying float vY; varying float vMask;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vY = wp.y;
          float up = normalize(mat3(modelMatrix) * normal).y;
          float grass = ((aMat > 0.5 && aMat < 1.5) || (aMat > 7.5 && aMat < 8.5)) ? 1.0 : 0.0; // grass, and the (grassy) landing plaza
          vMask = grass * smoothstep(0.5, 0.8, up) * (1.0 - carved);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying float vY; varying float vMask;
        void main() { gl_FragColor = vec4(vY, vMask, 0.0, 1.0); }`,
    });
    const vertex = `
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`;
    this.capMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: `varying float vY; void main() { gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }`,
    });
    this.dressMat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: `varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }`,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
  }
  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, x: number, z: number): void {
    this.center.set(x, z);
    this.cam.position.set(x, 76, z);
    this.cam.lookAt(x, 0, z);
    this.cam.updateMatrixWorld();
    this.vp.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    scene.overrideMaterial = this.mat;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0, 1);
    renderer.autoClear = true;
    renderer.render(scene, this.cam);
    renderer.autoClear = false;
    this.cam.layers.set(CAPTURE_LAYER_DRESSING);
    scene.overrideMaterial = this.dressMat;
    renderer.render(scene, this.cam);
    this.cam.layers.set(CAPTURE_LAYER_TERRAIN);
    if (this.hub) {
      renderer.autoClear = false;
      this.cam.layers.set(CAPTURE_LAYER_HUB_CAPS);
      scene.overrideMaterial = this.capMat;
      renderer.render(scene, this.cam);
      this.cam.layers.set(CAPTURE_LAYER_HUB_DRESSING);
      scene.overrideMaterial = this.dressMat;
      renderer.render(scene, this.cam);
      this.cam.layers.set(CAPTURE_LAYER_TERRAIN);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    scene.overrideMaterial = prevOverride;
  }
}

export const GRASS_GLSL = `
  uniform sampler2D uHeightTex; uniform mat4 uHeightVP;
  uniform vec2 uGridOrigin; uniform float uSpacing; uniform float uGridW;
  uniform vec3 uCam; uniform float uRadius; uniform float uInner;
  uniform vec3 uPlayer; uniform float uDensity;
  // the Drill Slam: grass pressed flat away from a spot (xyz) out to a radius (w), this hard (0..1)
  uniform vec4 uSlam; uniform float uSlamK;
  float slamPush(vec2 base, float groundY) {
    float d = length(base - uSlam.xz);
    return uSlamK * (1.0 - smoothstep(uSlam.w - 0.6, uSlam.w + 0.25, d)) * step(abs(uSlam.y - groundY), 3.0);
  }

  // ground at a world xz: x height, y grass coverage (0 outside the captured area)
  vec2 groundAt(vec2 p) {
    vec4 c = uHeightVP * vec4(p.x, 0.0, p.y, 1.0);
    vec2 uv = c.xy * 0.5 + 0.5;
    if (uv.x < 0.002 || uv.y < 0.002 || uv.x > 0.998 || uv.y > 0.998) return vec2(0.0);
    return texture2D(uHeightTex, uv).rg;
  }

  // wind: rolling gusts sweep across the field (carried as far as the wind has taken them: see
  // ATMO.windScroll; faster when it blows harder) + a little per-blade flutter
  float windAt(vec2 p, float seed) {
    float ws = atmoWind.z;
    float t = atmoParams.x;
    float gust = nzValue2(p * 0.07 - (atmoWindScroll.xy * 0.55 + atmoWindScroll.zw * 0.9));
    float ripple = nzValue2(p * 0.35 - atmoWindScroll.xy * 1.7);
    return ws * (0.35 + gust * 1.05 + ripple * 0.25) + sin(t * (2.2 + seed * 1.5) + seed * 40.0) * 0.05;
  }
`; // Xy (34477)

/** Blade strip geometry with `segments` rows, tip at (0, 1, 0). */
export function bladeGeometry(segments: number): THREE.InstancedBufferGeometry { // Zy (34507)
  const pos: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < segments; k++) {
    const r = k / segments;
    pos.push(-1, r, 0, 1, r, 0);
  }
  pos.push(0, 1, 0);
  for (let k = 0; k < segments - 1; k++) {
    const e = k * 2;
    index.push(e, e + 1, e + 2, e + 1, e + 3, e + 2);
  }
  const r = (segments - 1) * 2;
  index.push(r, r + 1, r + 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(`position`, new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    `normal`,
    new THREE.Float32BufferAttribute(
      Array(pos.length)
        .fill(0)
        .map((_e: number, t: number) => +(t % 3 == 1)),
      3,
    ),
  );
  geo.setIndex(index);
  return geo;
}

/** Flower geometry: stem, 5 petals, centre. aPart 0 stem / 1 petal / 2 centre. */
export function flowerGeometry(): THREE.InstancedBufferGeometry { // Qy (34537)
  const pos: number[] = [];
  const part: number[] = [];
  const index: number[] = [];
  const add = (x: number, y: number, z: number, p: number): number => (pos.push(x, y, z), part.push(p), pos.length / 3 - 1);
  for (let e = 0; e <= 3; e++) {
    const t = (e / 3) * 0.92;
    add(-0.012, t, 0, 0);
    add(0.012, t, 0, 0);
  }
  for (let e = 0; e < 3; e++) {
    const t = e * 2;
    index.push(t, t + 1, t + 2, t + 1, t + 3, t + 2);
  }
  const centre = add(0, 0.9400000000000001, 0, 2);
  for (let e = 0; e < 5; e++) {
    const t = (e / 5) * Math.PI * 2;
    const i = t + 0.42;
    const a = t - 0.42;
    const o = 0.1;
    const s = add(Math.cos(t) * o * 1.15, 0.9550000000000001, Math.sin(t) * o * 1.15, 1);
    const c = add(Math.cos(i) * o * 0.55, 0.93, Math.sin(i) * o * 0.55, 1);
    const l = add(Math.cos(a) * o * 0.55, 0.93, Math.sin(a) * o * 0.55, 1);
    const u = add(0, 0.92, 0, 1);
    index.push(u, c, s, u, s, l);
  }
  for (let e = 0; e < 5; e++) {
    const t = (e / 5) * Math.PI * 2;
    const a = ((e + 1) / 5) * Math.PI * 2;
    const o = add(Math.cos(t) * 0.03, 0.9550000000000001, Math.sin(t) * 0.03, 2);
    const s = add(Math.cos(a) * 0.03, 0.9550000000000001, Math.sin(a) * 0.03, 2);
    index.push(centre, s, o);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(`position`, new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    `normal`,
    new THREE.Float32BufferAttribute(
      Array(pos.length)
        .fill(0)
        .map((_e: number, t: number) => +(t % 3 == 1)),
      3,
    ),
  );
  geo.setAttribute(`aPart`, new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(index);
  return geo;
}

/** Painterly tuft ("pill") geometry: 3 rows and a half-disc cap. */
export function pillGeometry(): THREE.InstancedBufferGeometry { // $y (34586)
  const pos: number[] = [];
  const index: number[] = [];
  for (const t of [0, 0.5, 1]) pos.push(-1, t, 0, 1, t, 0);
  index.push(0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4);
  const hub = pos.length / 3;
  pos.push(0, 1, 0);
  const rim = [5];
  for (let t = 1; t < 6; t++) {
    const n = (t / 6) * Math.PI;
    rim.push(pos.length / 3);
    pos.push(Math.cos(n), 1, Math.sin(n));
  }
  rim.push(4);
  for (let e = 0; e < rim.length - 1; e++) index.push(hub, rim[e], rim[e + 1]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute(`position`, new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute(
    `normal`,
    new THREE.Float32BufferAttribute(
      Array(pos.length)
        .fill(0)
        .map((_e: number, t: number) => +(t % 3 == 1)),
      3,
    ),
  );
  geo.setIndex(index);
  return geo;
}

export const RING_UNIFORMS_GLSL = `
  uniform float uWidth; uniform float uHeight; uniform float uRole; uniform float uBlock; uniform float uCell;
  uniform vec2 uHand; uniform vec2 uFadeOut; uniform float uRepWide;
`; // eb (34616)

/** Instance placement GLSL (cell, block representative, keep, thin, edge, wide). */
export const placementGLSL = (hashOffset: string, hashOffset2: string): string => `
          float fid = float(gl_InstanceID);
          float iz = floor(fid / uGridW);
          float ix = fid - iz * uGridW;
          vec2 cellIdx = floor(uGridOrigin / uSpacing + 0.5) + vec2(ix, iz);
          vec2 blk = uRole > 0.5 ? cellIdx : floor(cellIdx / uBlock);
          vec2 pick = floor(nzHash42(blk + 3.3).xy * uBlock);
          vec2 cell = uRole > 0.5 ? blk * uBlock + pick : cellIdx;
          vec2 own = cellIdx - blk * uBlock;
          float rep = uRole > 0.5 ? 1.0 : step(max(abs(own.x - pick.x), abs(own.y - pick.y)), 0.5);
          vec4 r = nzHash42(cell${hashOffset});
          vec4 r2 = nzHash42(cell + ${hashOffset2});
          vec2 base = (cell + r.xy) * uCell;
          vec2 gr = groundAt(base);
          float dist = length(base - uPlayer.xz);
          float fo = 1.0 - smoothstep(uFadeOut.x, uFadeOut.y, dist);
          float thin = uRole > 0.5 ? step(uHand.y, dist) * fo : mix(1.0 - smoothstep(uHand.x, uHand.y, dist), step(dist, uHand.y), rep);
          // (each one that goes slims away over a third of the stretch: never shorter, never a pop)
          float keep = clamp((thin * uDensity * 1.5 - r.z) * 2.0, 0.0, 1.0) * step(dist, uRadius);
          float edge = mix(1.0, fo, uRole);
          float wide = mix(1.0, uRepWide, rep);
`; // tb (34620)

/** normal_fragment_begin replacement: keeps the interpolated vNormal. */
export const NORMAL_BEGIN_GLSL = `
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
  vec3 normal = normalize(vNormal);
  vec3 nonPerturbedNormal = normal;`; // nb (34642)

export interface GrassBaseUniforms {
  [name: string]: THREE.IUniform;
  uHeightTex: { value: THREE.Texture };
  uHeightVP: { value: THREE.Matrix4 };
  uGridOrigin: { value: THREE.Vector2 };
  uSpacing: { value: number };
  uGridW: { value: number };
  uCam: { value: THREE.Vector3 };
  uRadius: { value: number };
  uInner: { value: number };
  uPlayer: { value: THREE.Vector3 };
  uDensity: { value: number };
  uSlam: { value: THREE.Vector4 };
  uSlamK: { value: number };
}

export interface GrassRingUniforms {
  [name: string]: THREE.IUniform;
  uWidth: { value: number };
  uHeight: { value: number };
  uRole: { value: number };
  uBlock: { value: number };
  uCell: { value: number };
  uHand: { value: THREE.Vector2 };
  uFadeOut: { value: THREE.Vector2 };
  uRepWide: { value: number };
}

export interface GrassRingOptions {
  role: number;
  block: number;
  cell: number;
  hand: [number, number];
  fadeOut: [number, number];
  repWide: number;
}

export interface GrassFieldPart {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshLambertMaterial>;
  mat: THREE.MeshLambertMaterial;
  u: GrassBaseUniforms;
  spacing: number;
  radius: number;
  inner: number;
  gridW: number;
}

export type GrassStyle = 'classic' | 'painterly';

/** Infinite instanced grass, tufts and flowers around the player. */
export class GrassField { // rb (34646)
  group = new THREE.Group();
  capture = new GroundCapture();
  enableHub(): void {
    this.hubEnabled = true;
    this.capture.hub = true;
    this.dirty = true;
  }
  hubEnabled = false;
  hubCaptureBelow = -Infinity;
  fields: GrassFieldPart[] = [];
  style: string = `classic`;
  dirty = true;
  cooldown = 0;
  q: GrassQuality;
  playerPos = new THREE.Vector3();
  slamAt = new THREE.Vector4(0, -1e5, 0, 0);
  slamK = { value: 0 };
  /** Drill Slam: press the grass flat away from (x, y, z) out to radius, k = strength 0..1. */
  slam(x: number, y: number, z: number, radius: number, k: number): void {
    this.slamAt.set(x, y, z, radius);
    this.slamK.value = k;
  }
  constructor(quality: string = `high`) {
    this.q = GRASS_QUALITY[quality as GrassQualityName] ?? GRASS_QUALITY.high;
    groundCaptureUniforms.tex.value = this.capture.rt.texture;
    groundCaptureUniforms.vp.value = this.capture.vp;
    this.build();
  }
  get farRadius(): number {
    return this.q.farR;
  }
  get heightTexture(): THREE.Texture {
    return this.capture.rt.texture;
  }
  get heightVP(): THREE.Matrix4 {
    return this.capture.vp;
  }
  setQuality(quality: string): void {
    const t = GRASS_QUALITY[quality as GrassQualityName] ?? GRASS_QUALITY.high;
    if (t !== this.q) {
      this.q = t;
      this.rebuild();
    }
  }
  setStyle(style: string): void {
    if (style !== this.style) {
      this.style = style;
      this.rebuild();
    }
  }
  rebuild(): void {
    for (const f of this.fields) {
      this.group.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mat.dispose();
    }
    this.fields = [];
    this.build();
  }
  /** Marks the height capture stale; with x/z only when within 88 m of the capture centre. */
  markDirty(x?: number, z?: number): void {
    if (x === undefined || z === undefined) {
      this.dirty = true;
      return;
    }
    const n = this.capture.center;
    if (Math.abs(x - n.x) < 88 && Math.abs(z - n.y) < 88) this.dirty = true;
  }
  build(): void {
    const e = this.q;
    const painterly = this.style === `painterly`;
    const n = painterly ? e.block : 3;
    const r = painterly ? e.nearSpacing * 1.9 : e.nearSpacing;
    const hand: [number, number] = [e.nearR * 0.55, e.nearR];
    const repWide = painterly ? (n === 2 ? 1.5 : 1.9) : 2;
    const near: GrassRingOptions = { role: 0, block: n, cell: r, hand, fadeOut: [1e5, 2e5], repWide };
    const far: GrassRingOptions = { role: 1, block: n, cell: r, hand, fadeOut: [e.farR * 0.72, e.farR], repWide };
    if (painterly) {
      this.fields.push(this.makePills(r, e.nearR, 0.065, 0.38, near));
      this.fields.push(this.makePills(r * n, e.farR, 0.065, 0.38, far));
    } else {
      this.fields.push(this.makeBlades(r, e.nearR, 4, 0.046, 0.66, near));
      this.fields.push(this.makeBlades(r * n, e.farR, 2, 0.046, 0.66, far));
    }
    if (e.flowers) this.fields.push(this.makeFlowers(this.style === `painterly` ? 1.5 : 0.85, e.nearR + 8));
    for (const f of this.fields) this.group.add(f.mesh);
  }
  baseUniforms(spacing: number, inner: number, radius: number): GrassBaseUniforms {
    const gridW = Math.ceil((radius * 2) / spacing) + 2;
    return {
      uHeightTex: { value: this.capture.rt.texture },
      uHeightVP: { value: this.capture.vp },
      uGridOrigin: { value: new THREE.Vector2() },
      uSpacing: { value: spacing },
      uGridW: { value: gridW },
      uCam: { value: new THREE.Vector3() },
      uRadius: { value: radius },
      uInner: { value: inner },
      uPlayer: { value: this.playerPos },
      uDensity: { value: 1 },
      uSlam: { value: this.slamAt },
      uSlamK: this.slamK,
    };
  }
  ringUniforms(width: number, height: number, opts: GrassRingOptions): GrassRingUniforms {
    return {
      uWidth: { value: width },
      uHeight: { value: height },
      uRole: { value: opts.role },
      uBlock: { value: opts.block },
      uCell: { value: opts.cell },
      uHand: { value: new THREE.Vector2(...opts.hand) },
      uFadeOut: { value: new THREE.Vector2(...opts.fadeOut) },
      uRepWide: { value: opts.repWide },
    };
  }
  makeBlades(spacing: number, radius: number, segments: number, width: number, height: number, opts: GrassRingOptions): GrassFieldPart {
    const o = { ...this.baseUniforms(spacing, 0, radius), ...this.ringUniforms(width, height, opts) };
    const s = o.uGridW.value;
    const c = bladeGeometry(segments);
    c.instanceCount = s * s;
    const l = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    l.alphaToCoverage = true;
    l.onBeforeCompile = (e) => {
      Object.assign(e.uniforms, o);
      e.vertexShader = e.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
          ${NOISE_GLSL}
          ${GRASS_GLSL}
          ${RING_UNIFORMS_GLSL}
          centroid varying float vT; centroid varying vec3 vGCol; varying vec3 vGWorld; centroid varying float vGAO;`,
        )
        .replace(
          `#include <beginnormal_vertex>`,
          `
          ${placementGLSL(``, `71.3`)}
          float patchH = 0.62 + 0.75 * nzValue2(base * 0.06 + 3.7);
          float h = uHeight * (0.42 + 0.58 * r.w) * patchH * smoothstep(0.35, 0.8, gr.y) * step(0.001, keep) * (0.35 + 0.65 * edge);
          vec2 facing = vec2(cos(r2.x * 6.2832), sin(r2.x * 6.2832));
          vec2 side = vec2(-facing.y, facing.x);
          // lean with the wind (plus a random rest lean), pushed flat around the miner
          float w = windAt(base, r2.y);
          vec2 lean = normalize(atmoWind.xy * (0.4 + w) + (r2.zw - 0.5) * 0.9);
          float bend = 0.18 + r2.y * 0.25 + w * 0.9;
          vec2 away = base - uPlayer.xz;
          float pd = length(away);
          float push = (1.0 - smoothstep(0.25, 1.1, pd)) * step(abs(uPlayer.y - gr.x), 1.4);
          lean = normalize(mix(lean, away / max(pd, 1e-3), push));
          bend = mix(bend, 1.35, push);
          float sp = slamPush(base, gr.x);
          vec2 awayS = base - uSlam.xz;
          lean = normalize(mix(lean, awayS / max(length(awayS), 1e-3), sp));
          bend = mix(bend, 1.4, sp);
          float t = position.y;
          float bt = bend * t;
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 leanDir = vec3(lean.x, 0.0, lean.y);
          vec3 grassPos = vec3(base.x, gr.x - 0.03, base.y)
            + up * h * t * (1.0 - 0.22 * bt * t)
            + leanDir * h * bt * t * 0.62
            + vec3(side.x, 0.0, side.y) * position.x * uWidth * wide * keep * (0.7 + 0.6 * r.w) * pow(1.0 - t, 0.9);
          vec3 objectNormal = normalize(up * 1.6 + vec3(facing.x, 0.0, facing.y) * 0.5 + vec3(side.x, 0.0, side.y) * position.x * 0.45 - leanDir * 0.35);
          vT = t;
          vGAO = mix(0.42, 1.0, pow(t, 0.7));
          // color: matches the ground's lush/sunny patches, per-blade variation, sun-dried tips
          float big = nzFbm2(base * 0.03);
          vec3 lush = vec3(0.17, 0.38, 0.09);
          vec3 sunny = vec3(0.45, 0.54, 0.14);
          vec3 cBase = mix(lush, sunny, smoothstep(0.4, 0.78, big));
          cBase *= 0.85 + 0.3 * r.w;
          vec3 tip = mix(cBase * 1.4 + vec3(0.07, 0.06, 0.02), vec3(0.7, 0.7, 0.34), 0.25 * r2.z);
          vGCol = mix(cBase, tip, t * t);
          `,
        )
        .replace(
          `#include <begin_vertex>`,
          `vec3 transformed = grassPos;
          vGWorld = grassPos;`,
        );
      e.fragmentShader = e.fragmentShader
        .replace(
          `#include <common>`,
          `#include <common>
          centroid varying float vT; centroid varying vec3 vGCol; varying vec3 vGWorld; centroid varying float vGAO;`,
        )
        .replace(
          `#include <color_fragment>`,
          `// MSAA shades thin blades outside their triangle: keep the varyings in range, or a blade seen
          // edge-on extrapolates to a blinding pixel that bloom blows up into a flickering orb
          float gT = clamp(vT, 0.0, 1.0);
          diffuseColor.rgb = clamp(vGCol, 0.0, 1.0) * clamp(vGAO, 0.0, 1.0) * (1.0 - atmoParams.y * 0.2);
          // blades brushing the camera lens fade out (MSAA coverage) instead of filling the screen
          diffuseColor.a = smoothstep(0.35, 1.1, length(vGWorld - cameraPosition));
          if (diffuseColor.a < 0.02) discard;`,
        )
        .replace(`#include <normal_fragment_begin>`, NORMAL_BEGIN_GLSL)
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
          {
            // sunlight glowing through the blades when looking toward the sun
            vec3 vd = normalize(vGWorld - cameraPosition);
            float back = pow(max(dot(vd, atmoSunDir), 0.0), 3.0);
            totalEmissiveRadiance += atmoSunColor * clamp(vGCol, 0.0, 1.0) * back * gT * gT * 1.1 * (1.0 - atmoParams.w);
          }`,
        );
    };
    const u = new THREE.Mesh(c, l);
    u.frustumCulled = false;
    u.receiveShadow = true;
    u.castShadow = false;
    return { mesh: u, mat: l, u: o, spacing, radius, inner: 0, gridW: s };
  }
  makePills(spacing: number, radius: number, width: number, height: number, opts: GrassRingOptions): GrassFieldPart {
    const a = { ...this.baseUniforms(spacing, 0, radius), ...this.ringUniforms(width, height, opts) };
    const o = a.uGridW.value;
    const s = pillGeometry();
    s.instanceCount = o * o;
    const c = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    c.alphaToCoverage = true;
    c.onBeforeCompile = (e) => {
      Object.assign(e.uniforms, a);
      e.vertexShader = e.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
          ${NOISE_GLSL}
          ${GRASS_GLSL}
          ${PAINT_GROUND_GLSL}
          ${RING_UNIFORMS_GLSL}
          centroid varying float vT; centroid varying vec3 vGCol; varying vec3 vGWorld; centroid varying float vGAO;`,
        )
        .replace(
          `#include <beginnormal_vertex>`,
          `
          ${placementGLSL(` + 5.7`, `91.3`)}
          float drift = smoothstep(0.22, 0.42, nzFbm2(base * 0.05 + 21.0));
          float sz = smoothstep(0.35, 0.8, gr.y) * drift;
          float halfW = uWidth * wide * (0.85 + 0.3 * r.w) * sz * keep * (0.55 + 0.45 * edge);
          float sp = slamPush(base, gr.x);
          float hRect = uHeight * (0.8 + 0.4 * r2.z) * sz * (0.4 + 0.6 * edge) * (1.0 - 0.55 * sp);
          // a little sway from the root; pressed down round the miner
          float w = windAt(base, r2.y);
          vec2 away = base - uPlayer.xz;
          float pd = length(away);
          float push = (1.0 - smoothstep(0.3, 1.1, pd)) * step(abs(uPlayer.y - gr.x), 1.4);
          vec2 awayS = base - uSlam.xz;
          vec2 lean = atmoWind.xy * w * 0.22 + away / max(pd, 1e-3) * push * 0.9 + awayS / max(length(awayS), 1e-3) * sp * 1.1;
          // turned to face you (each a little off)
          vec2 toC = cameraPosition.xz - base;
          toC /= max(length(toC), 1e-3);
          float ja = (r2.x - 0.5) * 0.7;
          vec2 f2 = vec2(toC.x * cos(ja) - toC.y * sin(ja), toC.x * sin(ja) + toC.y * cos(ja));
          vec3 sideD = vec3(-f2.y, 0.0, f2.x);
          float hy = position.y * hRect + position.z * halfW;
          float tt = hy / max(hRect + halfW, 1e-4);
          vec3 grassPos = vec3(base.x, gr.x - 0.02, base.y)
            + sideD * position.x * halfW
            + vec3(0.0, hy, 0.0)
            + vec3(lean.x, -0.3 * length(lean), lean.y) * hy * tt;
          grassPos = mix(vec3(base.x, gr.x - 0.5, base.y), grassPos, step(0.0005, halfW));
          // lit just as the ground it grows from
          vec3 objectNormal = vec3(0.0, 1.0, 0.0);
          vT = tt;
          vGAO = 1.0;
          vec3 g0 = paintGround(vec3(base.x, gr.x, base.y), 1.0);
          vGCol = mix(g0 * 0.8, g0 * 1.06 + vec3(0.015, 0.02, 0.0), smoothstep(0.0, 1.0, tt));
          `,
        )
        .replace(
          `#include <begin_vertex>`,
          `vec3 transformed = grassPos;
          vGWorld = grassPos;`,
        );
      e.fragmentShader = e.fragmentShader
        .replace(
          `#include <common>`,
          `#include <common>
          centroid varying float vT; centroid varying vec3 vGCol; varying vec3 vGWorld; centroid varying float vGAO;`,
        )
        .replace(
          `#include <color_fragment>`,
          `float gT = clamp(vT, 0.0, 1.0);
          diffuseColor.rgb = clamp(vGCol, 0.0, 1.0) * (1.0 - atmoParams.y * 0.2);
          diffuseColor.a = smoothstep(0.35, 1.1, length(vGWorld - cameraPosition));
          if (diffuseColor.a < 0.02) discard;`,
        )
        .replace(`#include <normal_fragment_begin>`, NORMAL_BEGIN_GLSL)
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
          {
            // a soft glow through them looking toward the sun
            vec3 vd = normalize(vGWorld - cameraPosition);
            float back = pow(max(dot(vd, atmoSunDir), 0.0), 3.0);
            totalEmissiveRadiance += atmoSunColor * clamp(vGCol, 0.0, 1.0) * back * gT * gT * 0.5 * (1.0 - atmoParams.w);
          }`,
        );
    };
    c.customProgramCacheKey = () => `grass-pills`;
    const l = new THREE.Mesh(s, c);
    l.frustumCulled = false;
    l.receiveShadow = true;
    l.castShadow = false;
    return { mesh: l, mat: c, u: a, spacing, radius, inner: 0, gridW: o };
  }
  makeFlowers(spacing: number, radius: number): GrassFieldPart {
    const n = this.baseUniforms(spacing, 0, radius);
    const r = n.uGridW.value;
    const i = flowerGeometry();
    i.instanceCount = r * r;
    const a = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    a.onBeforeCompile = (e) => {
      Object.assign(e.uniforms, n);
      e.vertexShader = e.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
          ${NOISE_GLSL}
          ${GRASS_GLSL}
          attribute float aPart;
          centroid varying vec3 vFCol;`,
        )
        .replace(
          `#include <beginnormal_vertex>`,
          `
          float fid = float(gl_InstanceID);
          float iz = floor(fid / uGridW);
          float ix = fid - iz * uGridW;
          vec2 cellIdx = floor(uGridOrigin / uSpacing + 0.5) + vec2(ix, iz);
          vec4 r = nzHash42(cellIdx + 913.0);
          vec2 base = (cellIdx + r.xy) * uSpacing;
          vec2 gr = groundAt(base);
          float dist = length(base - uPlayer.xz);
          // flowers gather in meadows
          float meadow = smoothstep(0.45, 0.8, nzFbm2(base * 0.045 + 11.0));
          float keep = step(r.z, 0.05 + meadow * 0.5) * step(dist, uRadius) * smoothstep(0.5, 0.85, gr.y);
          float edge = 1.0 - smoothstep(uRadius * 0.75, uRadius, dist);
          float hgt = (0.5 + r.w * 0.32) * keep * edge;
          float w = windAt(base, r.w);
          vec2 lean = atmoWind.xy * w * 0.35;
          vec2 away = base - uPlayer.xz;
          float pd = length(away);
          float push = (1.0 - smoothstep(0.25, 1.0, pd)) * step(abs(uPlayer.y - gr.x), 1.4);
          lean += away / max(pd, 1e-3) * push * 0.9;
          float yy = position.y;
          float a = r.x * 6.2832;
          vec2 rp = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xz;
          // head stays a fixed small size; petals cup upward a little
          float headR = 0.75 + r.z * 0.5;
          float cup = length(position.xz) * 0.6;
          vec3 flowerPos = vec3(base.x + rp.x * headR + lean.x * yy * yy * hgt,
                                gr.x - 0.02 + yy * hgt + cup * step(0.5, aPart),
                                base.y + rp.y * headR + lean.y * yy * yy * hgt);
          // a flower that isn't kept collapses to a point: otherwise its head would still lie on
          // whatever the capture saw there (roofs, canopy cards) and float about in the sky
          flowerPos = mix(vec3(base.x, gr.x - 0.5, base.y), flowerPos, step(0.001, hgt));
          vec3 objectNormal = vec3(0.0, 1.0, 0.0);
          // palette: white, butter yellow, pink, lilac, sky blue
          float pick = fract(r.w * 7.13 + floor(nzValue2(base * 0.03) * 3.0) * 0.37);
          vec3 petal = pick < 0.3 ? vec3(1.0, 0.98, 0.94) : pick < 0.52 ? vec3(1.0, 0.82, 0.25) : pick < 0.72 ? vec3(1.0, 0.55, 0.72) : pick < 0.88 ? vec3(0.72, 0.6, 1.0) : vec3(0.55, 0.78, 1.0);
          vFCol = aPart < 0.5 ? vec3(0.22, 0.45, 0.12) : aPart < 1.5 ? petal : vec3(1.0, 0.78, 0.2);
          `,
        )
        .replace(`#include <begin_vertex>`, `vec3 transformed = flowerPos;`);
      e.fragmentShader = e.fragmentShader
        .replace(
          `#include <common>`,
          `#include <common>
centroid varying vec3 vFCol;`,
        )
        .replace(`#include <color_fragment>`, `diffuseColor.rgb = clamp(vFCol, 0.0, 1.0);`)
        .replace(`#include <normal_fragment_begin>`, NORMAL_BEGIN_GLSL)
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
totalEmissiveRadiance += clamp(vFCol, 0.0, 1.0) * 0.08;`,
        );
    };
    const o = new THREE.Mesh(i, a);
    o.frustumCulled = false;
    o.receiveShadow = true;
    return { mesh: o, mat: a, u: n, spacing, radius, inner: 0, gridW: r };
  }
  /**
   * Per frame, before the main render. Recaptures the ground height when the camera moves more than
   * 16 m (8 m grid) or when dirty (0.2 s cooldown), then moves every field's grid with the player.
   */
  update(
    dt: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    playerPos: THREE.Vector3,
    visible: boolean,
  ): void {
    this.group.visible = visible;
    this.playerPos.copy(playerPos);
    if (!visible) return;
    const o = this.capture.center;
    const s = Math.round(camera.position.x / 8) * 8;
    const c = Math.round(camera.position.z / 8) * 8;
    this.cooldown -= dt;
    const hub = this.hubEnabled && playerPos.y > this.hubCaptureBelow;
    if (hub !== this.capture.hub) {
      this.capture.hub = hub;
      this.dirty = true;
      this.cooldown = 0;
    }
    const moved = Math.abs(s - o.x) > 16 || Math.abs(c - o.y) > 16;
    if (moved || (this.dirty && this.cooldown <= 0)) {
      this.capture.capture(renderer, scene, moved ? s : o.x, moved ? c : o.y);
      this.dirty = false;
      this.cooldown = 0.2;
    }
    for (const f of this.fields) {
      const t = f.spacing;
      f.u.uGridOrigin.value.set(Math.floor((playerPos.x - f.radius) / t) * t, Math.floor((playerPos.z - f.radius) / t) * t);
      f.u.uCam.value.copy(camera.position);
    }
  }
}
