// Port of play-inUT-NSi.js 63172-63342: ground telegraph decals NF (TF clamp, jF / MF GLSL).
// Attack warning shapes painted on the ground: circle, strip and wedge. Each is a grid mesh draped over the
// terrain (ground(x, z, yHint)) with an SDF shader that fills from 0 to 1 over the wind-up time, shows a
// bright edge, a moving fill front and crawling warning stripes, then fades. Used by the combat system
// (golem rock landing) and the bosses.
// The scratch objects EF / DF / OF / kF / AF declared at 63173-63177 are used only by the boss VFX after
// this range, not by NF; they are not ported here.
import * as THREE from 'three';

const TF = THREE.MathUtils.clamp; // TF (63172)

/** jF (63178) */
const VERTEX = `
attribute vec2 aL;
varying vec2 vL;
void main() {
  vL = aL;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`; // jF (63178)

/** MF (63185) */
const FRAGMENT = `
uniform vec3 uColor;
uniform float uFill;
uniform float uAlpha;
uniform float uTime;
uniform int uShape;
uniform vec4 uP;
varying vec2 vL;
void main() {
  float d, prog;
  if (uShape == 0) {
    // a circle, radius uP.x (filling from its middle)
    float r = length(vL);
    d = r - uP.x;
    prog = r / uP.x;
  } else if (uShape == 1) {
    // a strip uP.x long (along +y from 0), uP.y either side (filling from its near end)
    vec2 q = vec2(abs(vL.x) - uP.y, max(-vL.y, vL.y - uP.x));
    d = max(q.x, q.y);
    prog = vL.y / uP.x;
  } else {
    // a wedge: radius uP.x, uP.y either side of +y, hollow inside uP.z (filling outward)
    float r = length(vL);
    float a = abs(atan(vL.x, vL.y));
    d = max(max(r - uP.x, uP.z - r), (a - uP.y) * max(r, 1.0));
    prog = (r - uP.z) / max(0.01, uP.x - uP.z);
  }
  if (d > 0.3) discard;
  float edge = 1.0 - smoothstep(0.0, 0.26, abs(d));
  float inside = 1.0 - smoothstep(-0.05, 0.05, d);
  float filled = inside * (1.0 - smoothstep(uFill - 0.015, uFill, prog));
  float front = inside * (1.0 - smoothstep(0.0, 0.06, abs(prog - uFill))) * step(0.02, uFill) * step(uFill, 0.99);
  // a slow crawl of stripes across the inside, so it reads as a warning and not a puddle
  float stripes = 0.5 + 0.5 * sin((vL.x + vL.y) * 2.2 - uTime * 5.0);
  float pulse = 0.8 + 0.2 * sin(uTime * 13.0);
  vec3 c = uColor * (inside * (0.12 + stripes * 0.08) + filled * (0.3 + 0.55 * uFill * uFill) + edge * 1.15 * pulse + front * 1.1);
  gl_FragColor = vec4(min(c * uAlpha, vec3(4.0)), 1.0);
}`; // MF (63185)

/** Ground height below (x, z) near yHint, or null (KR.footGround). */
export type GroundFn = (x: number, z: number, yHint: number) => number | null;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

interface XZ {
  x: number;
  z: number;
}

/** One live decal. f0..f1 = fill window (s), life = end of the hold (s), fade = fade-out time (s). */
export interface TelegraphDecal {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  mat: THREE.ShaderMaterial;
  t: number;
  f0: number;
  f1: number;
  life: number;
  fade: number;
}

export class Telegraph { // NF (63223)
  ground: GroundFn;
  group = new THREE.Group();
  live: TelegraphDecal[] = [];
  /** Shared time uniform of every decal. */
  time = { value: 0 };
  constructor(e: GroundFn) {
    this.ground = e;
  }
  /** A disc of radius t at e, filling over r seconds, then held for i seconds. */
  circle(e: XYZ, t: number, n: THREE.ColorRepresentation, r: number, i = 0.25): TelegraphDecal {
    return this.add(e, 0, 0, 1, -t - 0.5, t + 0.5, -t - 0.5, t + 0.5, 0, [t, 0, 0, 0], n, r, i);
  }
  /** A strip from e along dir t, n long, r either side. */
  strip(e: XYZ, t: XZ, n: number, r: number, i: THREE.ColorRepresentation, a: number, o = 0.25): TelegraphDecal {
    const s = Math.hypot(t.x, t.z) || 1;
    return this.add(e, 0, t.x / s, t.z / s, -r - 0.5, r + 0.5, -0.5, n + 0.5, 1, [n, r, 0, 0], i, a, o);
  }
  /** A wedge from e along dir t: radius n, half angle r, hollow inside radius i. */
  wedge(
    e: XYZ,
    t: XZ,
    n: number,
    r: number,
    i: number,
    a: THREE.ColorRepresentation,
    o: number,
    s = 0.25,
  ): TelegraphDecal {
    const c = Math.hypot(t.x, t.z) || 1;
    const l = r > Math.PI / 2 ? -n - 0.5 : -0.5;
    const u = r > Math.PI / 2 ? n + 0.5 : Math.sin(r) * n + 0.5;
    return this.add(e, 0, t.x / c, t.z / c, -u, u, l, n + 0.5, 2, [n, r, i, 0], a, o, s);
  }
  /**
   * Builds a decal: centre e, unused t, forward (n, r) in xz, local x range [i, a], local y range [o, s],
   * shape c, shader params l, colour u, fill time d, hold f.
   */
  add(
    e: XYZ,
    _t: number,
    n: number,
    r: number,
    i: number,
    a: number,
    o: number,
    s: number,
    c: number,
    l: [number, number, number, number],
    u: THREE.ColorRepresentation,
    d: number,
    f: number,
  ): TelegraphDecal {
    if (n === 0 && r === 0) r = 1;
    const p = r;
    const m = -n;
    const h = a - i;
    const g = s - o;
    const cell = Math.max(0.8, Math.sqrt((h * g) / 1400));
    const v = Math.max(2, Math.ceil(h / cell) + 1);
    const y = Math.max(2, Math.ceil(g / cell) + 1);
    const b = new Float32Array(v * y * 3);
    const x = new Float32Array(v * y * 2);
    const S = e.y + 2.2;
    for (let row = 0; row < y; row++)
      for (let col = 0; col < v; col++) {
        const lx = i + (h * col) / (v - 1);
        const ly = o + (g * row) / (y - 1);
        const wx = e.x + p * lx + n * ly;
        const wz = e.z + m * lx + r * ly;
        const gy = this.ground(wx, wz, S);
        const k = row * v + col;
        b[k * 3] = wx;
        b[k * 3 + 1] = (gy ?? e.y) + 0.09;
        b[k * 3 + 2] = wz;
        x[k * 2] = lx;
        x[k * 2 + 1] = ly;
      }
    const C: number[] = [];
    for (let row = 0; row < y - 1; row++)
      for (let col = 0; col < v - 1; col++) {
        const q0 = row * v + col;
        const q1 = q0 + 1;
        const q2 = q0 + v;
        const q3 = q2 + 1;
        C.push(q0, q2, q1, q1, q2, q3);
      }
    const w = new THREE.BufferGeometry();
    w.setAttribute(`position`, new THREE.BufferAttribute(b, 3));
    w.setAttribute(`aL`, new THREE.BufferAttribute(x, 2));
    w.setIndex(C);
    const T = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: {
        uColor: { value: new THREE.Color(u) },
        uFill: { value: 0 },
        uAlpha: { value: 0 },
        uTime: this.time,
        uShape: { value: c },
        uP: { value: new THREE.Vector4(l[0], l[1], l[2], l[3]) },
      },
    });
    const E = new THREE.Mesh(w, T);
    E.frustumCulled = false;
    E.renderOrder = 3;
    this.group.add(E);
    const D: TelegraphDecal = { mesh: E, mat: T, t: 0, f0: 0, f1: d, life: d + f, fade: 0.25 };
    this.live.push(D);
    return D;
  }
  /** Ends a decal early (it fades out from now). */
  drop(e: TelegraphDecal | null | undefined): void {
    if (e) e.life = Math.min(e.life, e.t);
  }
  update(e: number): void {
    this.time.value += e;
    for (let t = this.live.length - 1; t >= 0; t--) {
      const n = this.live[t];
      n.t += e;
      const r = n.mat.uniforms;
      r.uFill.value = TF((n.t - n.f0) / Math.max(0.01, n.f1 - n.f0), 0, 1);
      r.uAlpha.value = Math.min(1, n.t / 0.12) * TF(1 - (n.t - n.life) / n.fade, 0, 1);
      if (n.t > n.life + n.fade) {
        n.mesh.removeFromParent();
        n.mesh.geometry.dispose();
        n.mat.dispose();
        this.live.splice(t, 1);
      }
    }
  }
  clear(): void {
    for (const e of this.live) {
      e.mesh.removeFromParent();
      e.mesh.geometry.dispose();
      e.mat.dispose();
    }
    this.live.length = 0;
  }
}

/** Alias for callers that name NF by its role. */
export { Telegraph as GroundTelegraph };
