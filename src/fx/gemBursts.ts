// Port of play-inUT-NSi.js 29159-29318: the rare-find light beam pool zp (KR.gemBursts).
// A rare find erupts a vertical shaft of light with a ring spreading on the ground. One shared PointLight follows
// the strongest live beam, or a stronger one-shot flare (the drill slam's hook). `focus` (strongest beam position,
// color and strength) drives the burrow rock's uFlashPos / uFlashCol / uFlashK (KR 71971-71973).
import * as THREE from 'three';

/** Ip (29159): shaft vertex shader (uv, world normal, world position). */
const BEAM_VERTEX = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`; // Ip (29159)

/** Lp (29168): shaft fragment shader. */
const BEAM_FRAGMENT = `
  uniform vec3 uColor; uniform float uTime; uniform float uLife; uniform float uSeed;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  float h(float n) { return fract(sin(n) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    // feather the silhouette: the tube's edges vanish, only its glowing core reads
    float facing = abs(dot(normalize(vN), V));
    float soft = pow(facing, 2.2);
    // bright at the rock, thinning out as it rises
    float rise = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.05, vUv.y);
    // vertical light streaks drifting upward
    float ang = vUv.x * 6.2832;
    float streak = 0.55 + 0.45 * n1(vUv.x * 18.0 + uSeed * 10.0) * (0.6 + 0.4 * sin(vUv.y * 9.0 - uTime * 3.0 + vUv.x * 40.0));
    float life = smoothstep(0.0, 0.12, uLife) * (1.0 - smoothstep(0.55, 1.0, uLife));
    float a = soft * rise * streak * life;
    gl_FragColor = vec4(uColor * (1.2 + streak), a * 0.9);
  }`; // Lp (29168)

/** Rp (29187): ground ring fragment shader. */
const RING_FRAGMENT = `
  uniform vec3 uColor; uniform float uLife;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.78, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float a = ring * (1.0 - uLife) * (1.0 - uLife) * 0.8;
    gl_FragColor = vec4(uColor * 2.0, a);
  }`; // Rp (29187)

const RING_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface ShaftUniforms {
  [name: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uTime: THREE.IUniform<number>;
  uLife: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
}

interface GroundRingUniforms {
  [name: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uLife: THREE.IUniform<number>;
}

interface Beam {
  group: THREE.Group;
  shaft: THREE.Mesh;
  ring: THREE.Mesh;
  color: THREE.Color;
  su: ShaftUniforms;
  ru: GroundRingUniforms;
  t: number;
  dur: number;
  power: number;
  active: boolean;
}

export interface GemBurstFocus {
  pos: THREE.Vector3;
  color: THREE.Color;
  strength: number;
}

export class GemBursts { // zp (29196)
  readonly group = new THREE.Group();
  pool: Beam[] = [];
  /** The strongest live beam: (1 - life) * power. */
  focus: GemBurstFocus = { pos: new THREE.Vector3(), color: new THREE.Color(), strength: 0 };
  light = new THREE.PointLight(16777215, 0, 16, 1.6);
  flareI = 0;
  flarePos = new THREE.Vector3();
  flareCol = new THREE.Color();

  constructor(count = 3) {
    this.group.add(this.light);
    const shaftGeo = new THREE.CylinderGeometry(0.9, 1.4, 14, 32, 1, true).translate(0, 7, 0);
    const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let k = 0; k < count; k++) {
      const su: ShaftUniforms = {
        uColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uLife: { value: 1 },
        uSeed: { value: Math.random() },
      };
      const shaft = new THREE.Mesh(
        shaftGeo,
        new THREE.ShaderMaterial({
          uniforms: su,
          vertexShader: BEAM_VERTEX,
          fragmentShader: BEAM_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      shaft.frustumCulled = false;
      shaft.renderOrder = 12;
      const ru: GroundRingUniforms = { uColor: { value: new THREE.Color() }, uLife: { value: 1 } };
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.ShaderMaterial({
          uniforms: ru,
          vertexShader: RING_VERTEX,
          fragmentShader: RING_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      ring.frustumCulled = false;
      ring.renderOrder = 12;
      const group = new THREE.Group();
      group.add(shaft, ring);
      group.visible = false;
      this.group.add(group);
      this.pool.push({ group, shaft, ring, color: new THREE.Color(), su, ru, t: 0, dur: 1.8, power: 1, active: false });
    }
  }

  /** A one-shot light burst; keeps the stronger of the current and the new flare. */
  flare(pos: THREE.Vector3, hex: number, intensity: number): void {
    if (intensity < this.flareI) return;
    this.flareI = intensity;
    this.flarePos.copy(pos);
    this.flareCol.setHex(hex);
  }

  /** Fires a beam at pos (first idle beam, else the oldest). KR releaseGem: fire(pos, color, tier - 1). */
  fire(pos: THREE.Vector3, hex: number, power = 1): void {
    let b = this.pool.find((e) => !e.active);
    if (!b) b = this.pool.reduce((a, c) => (a.t > c.t ? a : c));
    b.active = true;
    b.t = 0;
    b.dur = 1.6 + power * 0.4;
    b.power = power;
    b.group.visible = true;
    b.group.position.copy(pos);
    b.su.uColor.value.setHex(hex);
    b.ru.uColor.value.setHex(hex);
    b.su.uSeed.value = Math.random();
    b.color.setHex(hex);
    b.shaft.scale.set(0.8 + power * 0.2, 0.7 + power * 0.25, 0.8 + power * 0.2);
  }

  update(dt: number): void {
    this.focus.strength = 0;
    let best: Beam | null = null;
    let bestI = 0;
    for (const b of this.pool) {
      if (!b.active) continue;
      b.t += dt;
      const life = b.t / b.dur;
      if (life >= 1) {
        b.active = false;
        b.group.visible = false;
        continue;
      }
      b.su.uLife.value = life;
      b.su.uTime.value += dt;
      const a = Math.min(1, b.t / 0.7);
      b.ru.uLife.value = a;
      const o = 0.6 + a * (5 + b.power * 1.5);
      b.ring.scale.set(o * 2, 1, o * 2);
      b.ring.visible = a < 1;
      const s = (Math.exp(-b.t * 5) * 18 + (1 - life) * 6) * b.power;
      if (s > bestI) {
        bestI = s;
        best = b;
      }
      const c = (1 - life) * b.power;
      if (c > this.focus.strength) {
        this.focus.strength = c;
        this.focus.pos.copy(b.group.position);
        this.focus.color.copy(b.color);
      }
    }
    this.flareI = this.flareI > 0.05 ? this.flareI * Math.exp(-dt * 7) : 0;
    if (this.flareI > bestI) {
      this.light.intensity = this.flareI;
      this.light.position.copy(this.flarePos);
      this.light.color.copy(this.flareCol);
      this.light.distance = 24;
      return;
    }
    this.light.intensity = bestI;
    if (best) {
      this.light.position.copy(best.group.position).y += 1;
      this.light.color.copy(best.color);
      this.light.distance = 12 + best.power * 4;
    }
  }
}
