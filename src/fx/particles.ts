// Port of play-inUT-NSi.js 52899-53076: point particle emitter FA (sparks with streaks, soft dust puffs).
import * as THREE from 'three';
import { copyAtmoUniforms } from '../render/atmosphere';

const tmpColor = new THREE.Color(); // AA (52899)

// jA (52900): spark vertex shader, fast sparks become streaks along their screen direction
const SPARK_VERT = `
  #include <common>
  attribute float size; attribute float alpha; attribute vec3 color; attribute vec3 vel; attribute float seed;
  varying vec3 vColor; varying float vAlpha; varying vec2 vDir; varying float vStretch;
  uniform float uScale;
  void main() {
    vColor = color; vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // screen-space direction of travel: fast sparks become streaks along it
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position - vel * 0.045, 1.0));
    vec2 sd = c0.xy / c0.w - c1.xy / max(c1.w, 1e-4);
    float px = size * uScale / max(0.1, -mv.z);
    float len = length(sd) * uScale * 1.5;
    vStretch = clamp(len / max(px, 1.0), 1.0, 5.0);
    vDir = len > 1e-4 ? normalize(sd) : vec2(1.0, 0.0);
    gl_PointSize = max(px * vStretch, 2.0);
    vAlpha *= clamp(px / 2.0, 0.25, 1.0);
    gl_Position = c0;
  }`;

// MA (52920)
const SPARK_FRAG = `
  varying vec3 vColor; varying float vAlpha; varying vec2 vDir; varying float vStretch;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y = -c.y;
    // rotate into the travel direction and squash across it
    vec2 q = vec2(dot(c, vDir), dot(c, vec2(-vDir.y, vDir.x)) * vStretch);
    float d = length(q) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 0.35, d);
    float halo = 1.0 - smoothstep(0.1, 1.0, d);
    gl_FragColor = vec4(vColor * (0.7 + core * 1.3), (halo * 0.75 + core * 0.5) * vAlpha);
  }`;

// NA (52933)
const PUFF_VERT = `
  #include <common>
  attribute float size; attribute float alpha; attribute vec3 color; attribute float seed;
  varying vec3 vColor; varying float vAlpha; varying float vSeed; varying vec3 vW;
  uniform float uScale;
  void main() {
    vColor = color; vAlpha = alpha; vSeed = seed; vW = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(size * uScale / max(0.1, -mv.z), 2.0);
    gl_Position = projectionMatrix * mv;
  }`;

// PA (52944)
const PUFF_FRAG = `
  #include <common>
  varying vec3 vColor; varying float vAlpha; varying float vSeed; varying vec3 vW;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y = -c.y;
    float a = vSeed * 6.2832;
    c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
    float r = length(c) * 2.0;
    // cotton-ball silhouette: a few soft lobes around the edge
    float ang = atan(c.y, c.x);
    float edge = 0.78 + 0.16 * vn(vec2(ang * 1.6 + vSeed * 20.0, vSeed * 7.0)) + 0.08 * sin(ang * 5.0 + vSeed * 30.0);
    float body = 1.0 - smoothstep(edge - 0.35, edge, r);
    // wispy inside: billowing holes so it reads as dust, not a blob
    float wisp = 0.45 + 0.55 * vn(c * 5.0 + vSeed * 31.0) * (0.6 + 0.4 * vn(c * 11.0 - vSeed * 17.0));
    body *= wisp;
    if (body < 0.01) discard;
    // lit from above like a little cloud: bright crown, shaded belly
    float shade = 0.72 + 0.4 * smoothstep(-0.5, 0.45, c.y + 0.12 * vn(c * 6.0 + vSeed * 13.0));
    vec3 col = vColor * shade * (0.75 + atmoSunColor * 0.35);
    col = atmoFog(col, vW);
    gl_FragColor = vec4(col, body * vAlpha * 0.8);
  }`;

type Vec3Like = { x: number; y: number; z: number };

export interface EmitOptions {
  pos: Vec3Like;
  vel?: Vec3Like;
  count?: number;
  spread?: number;
  color: number | THREE.Color;
  intensity?: number;
  size?: number;
  sizeEnd?: number;
  alpha?: number;
  life?: number;
  gravity?: number;
  drag?: number;
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number; g: number; b: number;
  life: number; max: number;
  s0: number; s1: number; a0: number;
  grav: number; drag: number; seed: number;
}

/** FA (52970). `sparks` = additive streaks; otherwise normal-blended dust puffs with atmosphere fog. */
export class Particles {
  readonly cap: number;
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private ps: Particle[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private seed: Float32Array;

  constructor(cap: number, sparks: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.seed = new Float32Array(cap);
    const attr = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.pos, 3));
    this.geo.setAttribute('color', attr(this.col, 3));
    this.geo.setAttribute('size', attr(this.size, 1));
    this.geo.setAttribute('alpha', attr(this.alpha, 1));
    this.geo.setAttribute('vel', attr(this.vel, 3));
    this.geo.setAttribute('seed', attr(this.seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, ...copyAtmoUniforms() },
      vertexShader: sparks ? SPARK_VERT : PUFF_VERT,
      fragmentShader: sparks ? SPARK_FRAG : PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: sparks ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(e: EmitOptions) {
    const count = e.count ?? 1;
    const c = typeof e.color === 'number' ? tmpColor.setHex(e.color) : e.color;
    const k = e.intensity ?? 1;
    for (let i = 0; i < count; i++) {
      if (this.ps.length >= this.cap) this.ps.shift();
      const spread = e.spread ?? 0;
      const life = (e.life ?? 1) * (0.7 + Math.random() * 0.6);
      this.ps.push({
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        vx: (e.vel?.x ?? 0) + (Math.random() - 0.5) * 2 * spread,
        vy: (e.vel?.y ?? 0) + (Math.random() - 0.5) * 2 * spread,
        vz: (e.vel?.z ?? 0) + (Math.random() - 0.5) * 2 * spread,
        r: c.r * k,
        g: c.g * k,
        b: c.b * k,
        life,
        max: life,
        s0: e.size ?? 0.3,
        s1: e.sizeEnd ?? e.size ?? 0.3,
        a0: e.alpha ?? 1,
        grav: e.gravity ?? 0,
        drag: e.drag ?? 1.5,
        seed: Math.random(),
      });
    }
  }

  update(dt: number) {
    const ps = this.ps;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d - p.grav * dt;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      ps[n++] = p;
    }
    ps.length = n;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r;
      this.col[i * 3 + 1] = p.g;
      this.col[i * 3 + 2] = p.b;
      this.vel[i * 3] = p.vx;
      this.vel[i * 3 + 1] = p.vy;
      this.vel[i * 3 + 2] = p.vz;
      this.seed[i] = p.seed;
      const ease = 1 - (1 - t) * (1 - t);
      this.size[i] = p.s0 + (p.s1 - p.s0) * ease;
      const fadeIn = Math.min(1, t * 8);
      this.alpha[i] = p.a0 * fadeIn * (1 - t) * (1 - t * 0.3);
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size', 'alpha', 'vel', 'seed'])
      this.geo.getAttribute(name).needsUpdate = true;
  }
}
