// Port of play-inUT-NSi.js 47295-47544: the Drill Slam FX shaders (aim ring, aim curtain, crater scar, light
// pillar) and the terrain-following meshes: a small height grid sampled from a ground(x, z, yTop) probe, a ground
// disc whose vertices sit on that grid, and a curtain band standing on the disc's grid.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp; // iD (47189)

/** pD (47295): disc vertex shader; aL = local xz, uBias pulls each vertex toward the camera. */
export const DISC_VERT = `
attribute vec2 aL;
uniform float uBias;
varying vec2 vL;
void main() {
  vL = aL;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= max(0.0, 1.0 - uBias / max(length(mv.xyz), 1e-3));
  gl_Position = projectionMatrix * mv;
}`; // pD (47295)

/** mD (47305): aim ring fragment. */
export const AIM_RING_FRAG = `
uniform vec3 uColor;
uniform float uR;
uniform float uTime;
uniform float uOk;
uniform float uAlpha;
uniform float uXray;
varying vec2 vL;
void main() {
  float r = length(vL);
  float ang = atan(vL.y, vL.x);
  float rim = 1.0 - smoothstep(0.04, 0.13, abs(r - uR));
  float glow = (1.0 - smoothstep(0.0, 0.55, abs(r - uR))) * 0.3;
  float shade = (1.0 - smoothstep(0.0, 0.14, abs(r - uR - 0.2))) * 0.55;
  float tick = step(0.55, fract(ang * 3.8197 + uTime * 0.22)) * (1.0 - smoothstep(0.03, 0.08, abs(r - uR - 0.44)));
  float ph = fract(uTime * 1.15);
  float pr = uR * (1.0 - ph * ph);
  float pulse = (1.0 - smoothstep(0.03, 0.14, abs(r - pr))) * (1.0 - ph) * step(r, uR) * 0.85 * uOk;
  float fill = step(r, uR) * (0.05 + 0.1 * smoothstep(uR * 0.4, uR, r));
  float mid = (1.0 - smoothstep(0.04, 0.09, min(abs(vL.x), abs(vL.y)))) * (1.0 - smoothstep(0.3, 0.42, r));
  float lit = rim + glow + tick * 0.8 + pulse + fill + mid * 0.9;
  float a = clamp(lit + shade, 0.0, 1.0) * uAlpha * uXray;
  if (a < 0.004) discard;
  vec3 c = mix(vec3(1.0, 0.3, 0.22), uColor, uOk);
  vec3 col = mix(vec3(0.07, 0.045, 0.03), c * (0.55 + lit * 1.05), lit / max(lit + shade, 1e-3));
  gl_FragColor = vec4(min(col, vec3(3.0)), a);
}`; // mD (47305)

/** hD (47332): curtain vertex shader; aAH = (around 0..1, height 0..1). */
export const CURTAIN_VERT = `
attribute vec2 aAH;
varying vec2 vAH;
void main() {
  vAH = aAH;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`; // hD (47332)

/** gD (47339): curtain fragment. */
export const CURTAIN_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uOk;
uniform float uAlpha;
uniform float uXray;
varying vec2 vAH;
void main() {
  float h = vAH.y;
  float fade = pow(max(0.0, 1.0 - h), 1.3);
  float bands = 0.7 + 0.3 * sin(vAH.x * 6.2832 * 20.0 + uTime * 2.4);
  float rise = 0.65 + 0.35 * sin(h * 10.0 - uTime * 7.0);
  float a = fade * bands * rise * uAlpha * uXray * 0.7;
  if (a < 0.004) discard;
  vec3 c = mix(vec3(1.0, 0.3, 0.22), uColor, uOk);
  gl_FragColor = vec4(min(c * (0.9 + 1.1 * (1.0 - h)), vec3(3.0)), a);
}`; // gD (47339)

/** _D (47356): crater scar fragment (shock ring, core flash, 11 glowing cracks, scorch). */
export const SCAR_FRAG = `
uniform float uR;
uniform float uT;
uniform float uSeed;
varying vec2 vL;
float h11(float n) { return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
float vn(float x) { float i = floor(x), f = fract(x); return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float r = length(vL);
  float ang = atan(vL.y, vL.x) / 6.2832 + 0.5;
  float sk = clamp(uT / 0.34, 0.0, 1.0);
  float sr = (uR + 1.2) * (1.0 - (1.0 - sk) * (1.0 - sk));
  float shock = (1.0 - smoothstep(0.0, 0.45 + sk * 0.6, abs(r - sr))) * (1.0 - sk) * 1.5;
  float core = (1.0 - smoothstep(0.0, uR * 0.4, r)) * exp(-uT * 8.0) * 1.4;
  float n = 11.0;
  float s = floor(ang * n);
  float local = fract(ang * n) - 0.5;
  float wob = (vn(r * 1.6 + s * 7.3 + uSeed) - 0.5) * 0.55 + (vn(r * 4.1 + s * 3.1 + uSeed) - 0.5) * 0.18;
  float d = abs(local - wob) * r * 6.2832 / n;
  float len = uR * (0.45 + 0.5 * h11(s + uSeed));
  float w = 0.1 * (1.0 - smoothstep(0.0, len, r)) + 0.035;
  float crack = (1.0 - smoothstep(w * 0.4, w, d)) * smoothstep(0.35, 0.8, r) * (1.0 - smoothstep(len * 0.82, len, r));
  float heat = exp(-uT * 1.1);
  vec3 hot = mix(vec3(0.9, 0.18, 0.04), vec3(1.0, 0.75, 0.35), heat) * (0.35 + 2.6 * heat);
  float scorch = (1.0 - smoothstep(uR * 0.25, uR * 0.85, r)) * 0.5;
  float life = 1.0 - smoothstep(2.6, 3.6, uT);
  vec3 col = mix(vec3(0.07, 0.05, 0.04), hot, crack);
  float a = max(scorch, crack);
  col += vec3(1.0, 0.86, 0.55) * (shock + core);
  a = max(a, min(1.0, shock + core)) * life;
  if (a < 0.004) discard;
  gl_FragColor = vec4(min(col, vec3(6.0)), a);
}`; // _D (47356)

/** vD (47389): light pillar vertex shader. */
export const PILLAR_VERT = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`; // vD (47389)

/** yD (47400): light pillar fragment (additive). */
export const PILLAR_FRAG = `
uniform float uK;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  float y = vUv.y;
  float streak = 0.55 + 0.45 * sin(vUv.x * 50.0 + uTime * 9.0) * sin(vUv.x * 23.0 - uTime * 5.0);
  float body = (1.0 - smoothstep(0.1, 1.0, y)) * smoothstep(0.0, 0.03, y);
  float rim = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vView)))), 1.4);
  float a = body * (0.25 + rim) * streak * uK;
  vec3 c = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.95, 0.8), 1.0 - smoothstep(0.0, 0.3, y));
  gl_FragColor = vec4(min(c * a * 2.6, vec3(5.0)), 1.0);
}`; // yD (47400)

/** The ground probe the decals use: (x, z, yTop) -> ground height below yTop, or null. */
export type GroundFn = (x: number, z: number, yTop: number) => number | null;

/** bD (47415): a square height grid around a point (1 m cells), sampled bilinearly. */
export class HeightGrid { // bD (47415)
  heights: Float32Array;
  x0 = 0;
  z0 = 0;
  side: number;

  constructor(e: number) {
    this.side = Math.ceil(e) * 2 + 3;
    this.heights = new Float32Array(this.side * this.side);
  }

  measure(e: THREE.Vector3, t: GroundFn): void {
    const n = this.side;
    this.x0 = Math.floor(e.x) - (n - 1) / 2;
    this.z0 = Math.floor(e.z) - (n - 1) / 2;
    const r = e.y + 2.6;
    for (let i = 0; i < n; i++) for (let a = 0; a < n; a++) this.heights[i * n + a] = t(this.x0 + a, this.z0 + i, r) ?? e.y;
  }

  at(e: number, t: number): number {
    const n = this.side,
      r = this.heights,
      i = e - this.x0,
      a = t - this.z0,
      o = clamp(Math.floor(i), 0, n - 2),
      s = clamp(Math.floor(a), 0, n - 2),
      c = clamp(i - o, 0, 1),
      l = clamp(a - s, 0, 1);
    return (r[s * n + o] * (1 - c) + r[s * n + o + 1] * c) * (1 - l) + (r[(s + 1) * n + o] * (1 - c) + r[(s + 1) * n + o + 1] * c) * l;
  }
}

/** xD (47446): a ground disc (centre vertex + `rings` rings of `segs` vertices) laid on the terrain. */
export class GroundDisc { // xD (47446)
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  floor: HeightGrid;
  pos: Float32Array;
  loc: Float32Array;
  placed = new THREE.Vector3(NaN, 0, NaN);

  constructor(e: THREE.Material, t: number, n = 9, r = 56) {
    const i = 1 + n * r;
    this.floor = new HeightGrid(t);
    this.pos = new Float32Array(i * 3);
    this.loc = new Float32Array(i * 2);
    for (let ring = 1; ring <= n; ring++)
      for (let k = 0; k < r; k++) {
        const a = 1 + (ring - 1) * r + k,
          o = (t * ring) / n,
          s = (k / r) * Math.PI * 2;
        this.loc[a * 2] = Math.cos(s) * o;
        this.loc[a * 2 + 1] = Math.sin(s) * o;
      }
    const a: number[] = [];
    for (let k = 0; k < r; k++) a.push(0, 1 + ((k + 1) % r), 1 + k);
    for (let ring = 1; ring < n; ring++)
      for (let k = 0; k < r; k++) {
        const v0 = 1 + (ring - 1) * r + k,
          v1 = 1 + (ring - 1) * r + ((k + 1) % r),
          v2 = v0 + r,
          v3 = v1 + r;
        a.push(v0, v1, v2, v1, v3, v2);
      }
    const o = new THREE.BufferGeometry();
    o.setAttribute(`position`, new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    o.setAttribute(`aL`, new THREE.BufferAttribute(this.loc, 2));
    o.setIndex(a);
    this.mesh = new THREE.Mesh(o, e);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Lays the disc at `e` (skipped when it moved less than 0.1 m across / 0.2 m up unless forced); true when moved. */
  place(e: THREE.Vector3, t: GroundFn, n = false): boolean {
    this.mesh.visible = true;
    if (!n && Math.abs(e.x - this.placed.x) < 0.1 && Math.abs(e.z - this.placed.z) < 0.1 && Math.abs(e.y - this.placed.y) < 0.2)
      return false;
    this.placed.copy(e);
    this.floor.measure(e, t);
    const r = this.pos,
      i = this.loc;
    for (let k = 0; k < i.length / 2; k++) {
      const x = e.x + i[k * 2],
        z = e.z + i[k * 2 + 1];
      r[k * 3] = x;
      r[k * 3 + 1] = this.floor.at(x, z) + 0.06;
      r[k * 3 + 2] = z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    return true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.placed.set(NaN, 0, NaN);
  }
}

/** SD (47506): a vertical band of height `h` around a circle of radius `r`, standing on a height grid. */
export class Curtain { // SD (47506)
  r: number;
  h: number;
  seg: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  pos: Float32Array;

  constructor(e: THREE.Material, t: number, n: number, r = 72) {
    this.r = t;
    this.h = n;
    this.seg = r;
    this.pos = new Float32Array((r + 1) * 2 * 3);
    const i = new Float32Array((r + 1) * 2 * 2),
      a: number[] = [];
    for (let k = 0; k <= r; k++) {
      i[k * 4] = i[k * 4 + 2] = k / r;
      i[k * 4 + 1] = 0;
      i[k * 4 + 3] = 1;
      if (k < r) a.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const o = new THREE.BufferGeometry();
    o.setAttribute(`position`, new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    o.setAttribute(`aAH`, new THREE.BufferAttribute(i, 2));
    o.setIndex(a);
    this.mesh = new THREE.Mesh(o, e);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  place(e: THREE.Vector3, t: HeightGrid): void {
    const n = this.pos;
    for (let k = 0; k <= this.seg; k++) {
      const i = (k / this.seg) * Math.PI * 2,
        a = e.x + Math.cos(i) * this.r,
        o = e.z + Math.sin(i) * this.r,
        s = t.at(a, o);
      n[k * 6] = n[k * 6 + 3] = a;
      n[k * 6 + 2] = n[k * 6 + 5] = o;
      n[k * 6 + 1] = s - 0.05;
      n[k * 6 + 4] = s + this.h;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.visible = true;
  }
}
