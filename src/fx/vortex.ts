// Port of play-inUT-NSi.js 29430-29666: the suction funnel am (KR.vortex).
// A white wind funnel on the drill tip while the miner points the drill at open air (or the drill slam spins):
// a 2.6 m cone mouth of noise streaks, a short inner cone by the hand, 72 instanced streak quads that spiral down
// toward the tip (billboarded along their motion toward the camera) and 5 rings that slide down the funnel.
// Power fades in and out. `exhaust` (local (0, -0.42, 0) in world space) is where KR puffs the dust out (73596).
import * as THREE from 'three';

const FUNNEL_LEN = 2.6; // Gp (29430)
const MOUTH_R = 0.55; // Kp (29431)
const TIP_R = 0.07; // qp (29432)
const INNER_LEN = 0.42; // Jp (29433)
const INNER_R = 0.12; // Yp (29434)
const STREAKS = 72; // Xp (29435)
const RINGS = 5; // Zp (29436)

/** Funnel radius at height s (negative s is the inner cone). */
export const funnelRadius = (s: number): number => // Qp (29437)
  s >= 0
    ? TIP_R + 0.48000000000000004 * Math.min(1, s / FUNNEL_LEN) ** 0.85
    : TIP_R + 0.04999999999999999 * Math.min(1, -s / INNER_LEN);

/** $p (29441): funnel vertex shader. */
const FUNNEL_VERTEX = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`; // $p (29441)

/** em (29450): hash and value noise. */
const NOISE = `
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }`; // em (29450)

/** tm (29454): mouth cone fragment shader. */
const MOUTH_FRAGMENT = `
  uniform float uTime; uniform float uPower;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  ${NOISE}
  void main() {
    float along = vUv.y; // 0 at the tip, 1 out at the mouth
    vec2 q = vec2(vUv.x * 18.0 - along * 5.0 - uTime * 3.0, along * 2.4 + uTime * 7.0);
    float streak = smoothstep(0.52, 0.8, n2(q));
    vec3 V = normalize(cameraPosition - vW);
    float edge = 1.0 - abs(dot(normalize(vN), V));
    float fade = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.4, 1.0, along));
    float a = streak * (0.5 + 0.5 * edge) * fade * uPower * 0.8;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.97, 0.99, 1.0, a);
  }`; // tm (29454)

/** nm (29469): inner cone fragment shader. */
const INNER_FRAGMENT = `
  uniform float uTime; uniform float uPower;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  ${NOISE}
  void main() {
    float along = 1.0 - vUv.y; // 0 at the tip, 1 by the hand
    vec2 q = vec2(vUv.x * 9.0 + along * 7.0 - uTime * 6.0, along * 3.0 - uTime * 9.0);
    float band = smoothstep(0.5, 0.75, n2(q));
    vec3 V = normalize(cameraPosition - vW);
    float edge = 1.0 - abs(dot(normalize(vN), V));
    float fade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.6, 1.0, along));
    float a = band * (0.35 + 0.65 * edge) * fade * uPower * 0.75;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.97, 0.99, 1.0, a);
  }`; // nm (29469)

/** rm (29484): sliding ring fragment shader. */
const RING_FRAGMENT = `
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.68, 0.84, r) * (1.0 - smoothstep(0.84, 1.0, r));
    float a = ring * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  }`; // rm (29484)

const RING_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Streak quad shaders (29527, 29537). */
const STREAK_FRAGMENT = `
        varying vec2 vUv; varying float vA;
        void main() {
          float across = max(0.0, 1.0 - abs(vUv.y - 0.5) * 2.0);
          float along = smoothstep(0.0, 0.75, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
          float a = pow(across, 1.4) * along * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(0.97, 0.99, 1.0, a);
        }`;
const STREAK_VERTEX = `
        attribute float aAlpha; varying vec2 vUv; varying float vA;
        void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

/** Funnel material factory: normal blending, transparent, no depth write, double sided. */
const funnelMaterial = ( // im (29494)
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  vertexShader = FUNNEL_VERTEX,
): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

interface FunnelUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uPower: THREE.IUniform<number>;
}

interface Streak {
  /** Height along the funnel. */
  s: number;
  /** Angle around the funnel. */
  th: number;
  /** Fraction of the funnel radius. */
  f: number;
  vs: number;
  vth: number;
  t: number;
  /** Quad width. */
  w: number;
  on: boolean;
  prev: THREE.Vector3;
}

interface SlideRing {
  s: number;
  v: number;
  t: number;
  on: boolean;
  mesh: THREE.Mesh;
  u: { [name: string]: THREE.IUniform; uAlpha: THREE.IUniform<number> };
}

const UP = new THREE.Vector3(0, 1, 0); // om (29654)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // sm (29655)
const tmpDir = new THREE.Vector3(); // cm (29656)
const tmpCam = new THREE.Vector3(); // lm (29657)
const tmpInv = new THREE.Matrix4(); // um (29658)
const tmpPos = new THREE.Vector3(); // dm (29659)
const tmpVel = new THREE.Vector3(); // fm (29660)
const tmpMid = new THREE.Vector3(); // pm (29661)
const tmpSide = new THREE.Vector3(); // mm (29662)
const tmpNormal = new THREE.Vector3(); // hm (29663)
const tmpX = new THREE.Vector3(); // gm (29664)
const tmpY = new THREE.Vector3(); // _m (29665)
const tmpMatrix = new THREE.Matrix4(); // vm (29666)

export class Vortex { // am (29503)
  readonly group = new THREE.Group();
  fu: FunnelUniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
  su: FunnelUniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
  streaks: THREE.InstancedMesh;
  aAlpha: THREE.InstancedBufferAttribute;
  ss: Streak[] = [];
  rings: SlideRing[] = [];
  power = 0;
  spawnT = 0;
  ringT = 0;
  next = 0;
  nextRing = 0;
  /** World position just behind the hand, updated each visible frame. */
  exhaust = new THREE.Vector3();

  constructor() {
    const mouth = new THREE.Mesh(
      new THREE.CylinderGeometry(MOUTH_R, TIP_R, FUNNEL_LEN, 28, 12, true).translate(0, FUNNEL_LEN / 2, 0),
      funnelMaterial(MOUTH_FRAGMENT, this.fu),
    );
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(TIP_R, INNER_R, INNER_LEN, 20, 6, true).translate(0, -0.42 / 2, 0),
      funnelMaterial(INNER_FRAGMENT, this.su),
    );
    for (const m of [mouth, inner]) {
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(STREAKS), 1);
    quad.setAttribute('aAlpha', this.aAlpha);
    this.streaks = new THREE.InstancedMesh(quad, funnelMaterial(STREAK_FRAGMENT, {}, STREAK_VERTEX), STREAKS);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 5;
    for (let k = 0; k < STREAKS; k++) {
      this.streaks.setMatrixAt(k, HIDDEN);
      this.ss.push({ s: 0, th: 0, f: 0, vs: 0, vth: 0, t: 0, w: 0, on: false, prev: new THREE.Vector3() });
    }
    this.group.add(this.streaks);
    const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let k = 0; k < RINGS; k++) {
      const u = { uAlpha: { value: 0 } };
      const mesh = new THREE.Mesh(ringGeo, funnelMaterial(RING_FRAGMENT, u, RING_VERTEX));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.rings.push({ s: 0, v: 0, t: 0, on: false, mesh, u });
    }
    this.group.visible = false;
  }

  /**
   * KR 71913: update(t, pointing || ult.spinning, model.drillTip(), model.drillAxis(), camera.position).
   * The funnel opens along `dir` from `hand`.
   */
  update(dt: number, active: boolean, hand: THREE.Vector3, dir: THREE.Vector3, camPos: THREE.Vector3): void {
    this.power += (+active - this.power) * Math.min(1, dt * (active ? 12 : 8));
    const alive = this.ss.some((e) => e.on) || this.rings.some((e) => e.on);
    this.group.visible = this.power > 0.01 || alive;
    if (!this.group.visible) return;
    this.group.position.copy(hand);
    this.group.quaternion.setFromUnitVectors(UP, tmpDir.copy(dir).normalize());
    this.group.updateMatrixWorld(true);
    this.exhaust.set(0, -0.42, 0).applyMatrix4(this.group.matrixWorld);
    for (const u of [this.fu, this.su]) {
      u.uTime.value += dt;
      u.uPower.value = this.power;
    }
    const cam = tmpCam.copy(camPos).applyMatrix4(tmpInv.copy(this.group.matrixWorld).invert());
    if (active)
      for (this.spawnT -= dt; this.spawnT <= 0; ) {
        this.spawnT += 0.018;
        const s = this.ss[this.next];
        this.next = (this.next + 1) % STREAKS;
        s.s = 0.7 + Math.random() * 1.7000000000000002;
        s.th = Math.random() * Math.PI * 2;
        s.f = 0.55 + Math.random() * 0.45;
        s.vs = -(3.5 + Math.random() * 2.5);
        s.vth = 6 + Math.random() * 4;
        s.t = 0;
        s.w = 0.018 + Math.random() * 0.016;
        s.on = true;
        this.place(s, s.prev);
      }
    let any = false;
    for (let k = 0; k < STREAKS; k++) {
      const s = this.ss[k];
      if (!s.on) continue;
      any = true;
      s.t += dt;
      const r = 1 - Math.min(1, Math.max(0, s.s) / FUNNEL_LEN);
      s.s += s.vs * dt * (1 + r * 1.6);
      s.th += s.vth * dt * (1 + r * 2.2);
      if (s.s < -0.42) {
        s.on = false;
        this.streaks.setMatrixAt(k, HIDDEN);
        this.aAlpha.setX(k, 0);
        continue;
      }
      const p = this.place(s, tmpPos);
      tmpVel.copy(p).sub(s.prev);
      const speed = tmpVel.length() / Math.max(dt, 1e-4);
      s.prev.copy(p);
      if (speed < 0.001) continue;
      tmpVel.normalize();
      const len = THREE.MathUtils.clamp(speed * 0.05, 0.06, 0.45);
      tmpMid.copy(p).addScaledVector(tmpVel, -len * 0.5);
      tmpSide.copy(cam).sub(tmpMid).cross(tmpVel);
      if (tmpSide.lengthSq() < 1e-8) tmpSide.set(1, 0, 0);
      tmpSide.normalize();
      tmpNormal.copy(tmpVel).cross(tmpSide);
      tmpMatrix
        .makeBasis(tmpX.copy(tmpVel).multiplyScalar(len), tmpY.copy(tmpSide).multiplyScalar(s.w), tmpNormal)
        .setPosition(tmpMid);
      this.streaks.setMatrixAt(k, tmpMatrix);
      const a = Math.min(1, s.t / 0.12) * (1 - THREE.MathUtils.smoothstep(-s.s, INNER_LEN * 0.5, INNER_LEN));
      this.aAlpha.setX(k, a * 0.85 * Math.max(0.25, this.power));
    }
    if (any) {
      this.streaks.instanceMatrix.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
    if (active) this.ringT -= dt;
    if (active && this.ringT <= 0) {
      this.ringT = 0.16;
      const ring = this.rings[this.nextRing];
      this.nextRing = (this.nextRing + 1) % RINGS;
      ring.s = FUNNEL_LEN * 0.72;
      ring.v = 2.2;
      ring.t = 0;
      ring.on = true;
    }
    for (const ring of this.rings) {
      if (!ring.on) continue;
      ring.t += dt;
      ring.v += dt * 9;
      ring.s -= ring.v * dt;
      if (ring.s <= 0.04) {
        ring.on = false;
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.visible = true;
      ring.mesh.position.set(0, ring.s, 0);
      ring.mesh.scale.setScalar(funnelRadius(ring.s) * 2.1);
      ring.u.uAlpha.value =
        Math.min(1, ring.t / 0.12) * THREE.MathUtils.smoothstep(ring.s, 0.04, 0.5) * 0.75 * Math.max(0.25, this.power);
    }
  }

  /** A streak's position in funnel space. */
  place(s: Streak, out: THREE.Vector3): THREE.Vector3 {
    const r = s.s >= 0 ? funnelRadius(s.s) * s.f : funnelRadius(s.s);
    return out.set(r * Math.sin(s.th), s.s, r * Math.cos(s.th));
  }
}
