// Port of play-inUT-NSi.js 63343-63729 (and the scratch EF / DF / OF / kF / AF declared at 63173-63177, which
// only these effects use): the boss VFX primitives used by the boss manager gL.
// PF erupting ice spikes (one InstancedMesh, cap 96); HF expanding ground shockwave rings; UF lobbed missiles on
// a sine arc that call land().
// Every effect is additive, transparent, depthWrite off, DoubleSide, renderOrder 4, frustumCulled off.
import * as THREE from 'three';

const TF = THREE.MathUtils.clamp; // TF (63172)
const EF = new THREE.Matrix4(); // EF (63173)
const DF = new THREE.Quaternion(); // DF (63174)
const OF = new THREE.Vector3(); // OF (63175)
const kF = new THREE.Vector3(); // kF (63176)
const AF = new THREE.Vector3(0, 1, 0); // AF (63177)

interface Spike {
  at: THREE.Vector3;
  h: number;
  tilt: THREE.Quaternion;
  t: number;
  life: number;
}

/** PF (63343): ice spikes that pop out of the ground, stand for their life, then sink 0.5 s. */
export class IceSpikes { // PF (63343)
  mesh: THREE.InstancedMesh;
  live: Spike[] = [];
  cap = 96;
  constructor() {
    const e = new THREE.ConeGeometry(0.5, 1, 6, 1);
    e.translate(0, 0.5, 0);
    const t = e.getAttribute(`position`) as THREE.BufferAttribute;
    for (let i = 0; i < t.count; i++) if (t.getY(i) > 0.9) t.setX(i, t.getX(i) + 0.06);
    e.computeVertexNormals();
    const n = new THREE.MeshStandardMaterial({
      color: 13167871,
      roughness: 0.15,
      metalness: 0.05,
      emissive: 3835584,
      emissiveIntensity: 0.55,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(e, n, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  /** One spike at pos (world), height h, standing for life seconds. */
  spawn(e: THREE.Vector3, t: number, n = 1.4): void {
    if (this.live.length >= this.cap) this.live.shift();
    const r = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((Math.random() - 0.5) * 0.5, Math.random() * 6.28, (Math.random() - 0.5) * 0.5),
    );
    this.live.push({ at: e.clone(), h: t, tilt: r, t: 0, life: n });
  }
  update(e: number): void {
    let t = 0;
    for (let n = this.live.length - 1; n >= 0; n--) {
      const r = this.live[n];
      r.t += e;
      if (r.t > r.life + 0.5) {
        this.live.splice(n, 1);
        continue;
      }
      const i = r.t < 0.12 ? r.t / 0.12 : r.t < 0.2 ? 1.08 - (r.t - 0.12) : 1;
      const a = r.t > r.life ? (r.t - r.life) / 0.5 : 0;
      const o = Math.max(0.001, i);
      kF.copy(r.at).setY(r.at.y - a * r.h * 0.9 - 0.2);
      OF.set(r.h * 0.34 * o, r.h * o, r.h * 0.34 * o);
      EF.compose(kF, r.tilt, OF);
      this.mesh.setMatrixAt(t++, EF);
    }
    this.mesh.count = t;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear(): void {
    this.live.length = 0;
    this.mesh.count = 0;
  }
}

/** BF (63538): shockwave vertex GLSL. */
export const WAVE_VERTEX = `
varying float vR;
void main() {
  vR = length(position.xz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`; // BF (63538)

/** VF (63544): shockwave fragment GLSL. */
export const WAVE_FRAGMENT = `
uniform vec3 uColor;
uniform float uK;
uniform float uR;
uniform float uW;
varying float vR;
void main() {
  // a bright band at the wave's front (uW wide), trailing off behind it
  float x = (vR * uR - (uR - uW)) / uW;
  if (x < 0.0) discard;
  float a = smoothstep(0.0, 0.8, x) * (1.0 - smoothstep(0.88, 1.0, x));
  gl_FragColor = vec4(min(uColor * a * uK * 2.2, vec3(5.0)), 1.0);
}`; // VF (63544)

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  r0: number;
  r1: number;
  speed: number;
}

/** HF (63557): ground shockwave rings growing from r0 to r1 at speed m/s, a band width wide. */
export class Shockwaves { // HF (63557)
  group = new THREE.Group();
  live: Ring[] = [];
  geo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
  /** A ring at pos (lifted 0.3), from radius r0 to r1 at speed, colour, band width. */
  spawn(e: THREE.Vector3, t: number, n: number, r: number, i: number, a = 1.4): void {
    const o = new THREE.ShaderMaterial({
      vertexShader: WAVE_VERTEX,
      fragmentShader: WAVE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(i) },
        uK: { value: 1 },
        uR: { value: t },
        uW: { value: a },
      },
    });
    const s = new THREE.Mesh(this.geo, o);
    s.position.copy(e).setY(e.y + 0.3);
    s.frustumCulled = false;
    s.renderOrder = 4;
    this.group.add(s);
    this.live.push({ mesh: s, mat: o, t: 0, r0: t, r1: n, speed: r });
  }
  /** The ring radius after t seconds. */
  static radius(e: number, t: number, n: number): number {
    return e + t * n;
  }
  update(t: number): void {
    for (let n = this.live.length - 1; n >= 0; n--) {
      const r = this.live[n];
      r.t += t;
      const i = Shockwaves.radius(r.r0, r.speed, r.t);
      r.mesh.scale.set(i, 1, i);
      r.mat.uniforms.uR.value = i;
      r.mat.uniforms.uK.value = TF(1 - (i - r.r0) / Math.max(0.1, r.r1 - r.r0), 0, 1) * 0.85 + 0.15;
      if (i >= r.r1) {
        r.mesh.removeFromParent();
        r.mat.dispose();
        this.live.splice(n, 1);
      }
    }
  }
  clear(): void {
    for (const e of this.live) {
      e.mesh.removeFromParent();
      e.mat.dispose();
    }
    this.live.length = 0;
  }
}

interface Missile {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  flight: number;
  apex: number;
  spin: THREE.Vector3;
  land: (to: THREE.Vector3) => void;
  trail?: (pos: THREE.Vector3) => void;
}

/** UF (63603): lobbed missiles (boulders, globs) on a sine arc, tumbling, calling land(to) on arrival. */
export class Missiles { // UF (63603)
  group = new THREE.Group();
  live: Missile[] = [];
  /** Throws mesh from -> to in flight seconds, arc height apex; trail(pos) each frame, land(to) at the end. */
  throw(
    e: THREE.Object3D,
    t: THREE.Vector3,
    n: THREE.Vector3,
    r: number,
    i: number,
    a: (to: THREE.Vector3) => void,
    o?: (pos: THREE.Vector3) => void,
  ): void {
    e.position.copy(t);
    this.group.add(e);
    this.live.push({
      mesh: e,
      from: t.clone(),
      to: n.clone(),
      t: 0,
      flight: r,
      apex: i,
      spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
      land: a,
      trail: o,
    });
  }
  update(e: number): void {
    for (let t = this.live.length - 1; t >= 0; t--) {
      const n = this.live[t];
      n.t += e;
      const r = Math.min(1, n.t / n.flight);
      n.mesh.position.lerpVectors(n.from, n.to, r);
      n.mesh.position.y += Math.sin(r * Math.PI) * n.apex;
      n.mesh.rotation.x += n.spin.x * e;
      n.mesh.rotation.y += n.spin.y * e;
      n.mesh.rotation.z += n.spin.z * e;
      n.trail?.(n.mesh.position);
      if (r >= 1) {
        n.mesh.removeFromParent();
        this.live.splice(t, 1);
        n.land(n.to);
      }
    }
  }
  clear(): void {
    for (const e of this.live) e.mesh.removeFromParent();
    this.live.length = 0;
  }
}
