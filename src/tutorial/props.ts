// The tutorial props: the light shaft material, the beacon, the ring gate and the dig marker.
// Bundle play-inUT-NSi.js lines 60037-60331.
import * as THREE from 'three';
import type { EmitOptions } from '../fx/particles';
import { TMP_A, TMP_B } from './steps';

/** What a prop emits its sparks into (the game's spark particles). */
export interface PropSparks {
  emit(e: EmitOptions): void;
}

/** A fresnel-faded vertical light shaft (uv.y 0 at the foot, 1 at the top) with a slow flicker. */
export function beaconMaterial(e: THREE.Color): THREE.ShaderMaterial { // LN (60037)
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: e }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        float core = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.7);
        float fade = pow(clamp(1.0 - vH, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.04, vH);
        float flick = 0.86 + 0.14 * sin(uTime * 3.1 + vH * 11.0);
        gl_FragColor = vec4(uColor, clamp(core * fade * flick * uAlpha, 0.0, 1.0));
      }`,
    transparent: !0,
    depthWrite: !1,
    side: THREE.DoubleSide,
  });
}

/** The `move` beacon: a light shaft, a turning halo, a ripple ring and a bobbing mote. Pops in, shrinks away on go(). */
export class Beacon { // RN (60060)
  group = new THREE.Group();
  shaft: THREE.Mesh;
  shaftMat: THREE.ShaderMaterial;
  halo: THREE.Mesh;
  ripple: THREE.Mesh;
  mote: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  rippleMat: THREE.MeshBasicMaterial;
  t = 0;
  k = 0;
  going = !1;
  constructor(e = 16763210, t = 11, n = 1.15) {
    const r = new THREE.Color(e),
      i = r.clone().multiplyScalar(1.6);
    ((this.shaftMat = beaconMaterial(i)),
      (this.shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(n * 0.42, n * 0.42, t, 28, 1, !0).translate(0, t / 2, 0),
        this.shaftMat,
      )),
      (this.haloMat = new THREE.MeshBasicMaterial({ color: i, transparent: !0, depthWrite: !1, side: THREE.DoubleSide })),
      (this.halo = new THREE.Mesh(new THREE.RingGeometry(n, n + 0.16, 56).rotateX(-Math.PI / 2), this.haloMat)),
      (this.halo.position.y = 0.95),
      (this.rippleMat = new THREE.MeshBasicMaterial({ color: i, transparent: !0, depthWrite: !1, side: THREE.DoubleSide })),
      (this.ripple = new THREE.Mesh(new THREE.RingGeometry(n, n + 0.09, 56).rotateX(-Math.PI / 2), this.rippleMat)),
      (this.ripple.position.y = 0.95),
      (this.mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: r.clone().lerp(new THREE.Color(16777215), 0.5).multiplyScalar(2.2) }),
      )),
      (this.mote.position.y = 2.3));
    for (const e of [this.shaft, this.halo, this.ripple, this.mote]) ((e.renderOrder = 6), (e.frustumCulled = !1));
    (this.group.add(this.shaft, this.halo, this.ripple, this.mote), this.group.scale.setScalar(0.001));
  }
  at(e: THREE.Vector3): this {
    return (this.group.position.copy(e), this);
  }
  go(): void {
    this.going = !0;
  }
  /** Returns false once it has shrunk away after go(). */
  update(e: number, t: PropSparks): boolean {
    ((this.t += e), (this.k = this.going ? Math.max(0, this.k - e * 3) : Math.min(1, this.k + e * 2.2)));
    const n = this.going ? this.k : 1 - (1 - this.k) ** 3 * Math.cos(this.k * 5);
    (this.group.scale.set(
      Math.max(0.001, n),
      Math.max(0.001, this.going ? 1 + (1 - this.k) * 0.6 : n),
      Math.max(0.001, n),
    ),
      (this.shaftMat.uniforms.uAlpha.value = 0.62 * this.k),
      (this.shaftMat.uniforms.uTime.value = this.t),
      (this.haloMat.opacity = 0.9 * this.k),
      (this.halo.rotation.y = this.t * 0.6),
      this.halo.scale.setScalar(1 + Math.sin(this.t * 2.6) * 0.05));
    const r = (this.t * 0.75) % 1;
    if (
      (this.ripple.scale.setScalar(1 + r * 1.3),
      (this.rippleMat.opacity = (1 - r) * 0.7 * this.k),
      (this.mote.position.y = 2.3 + Math.sin(this.t * 2.1) * 0.22),
      !this.going && Math.random() < e * 9)
    ) {
      const e = Math.random() * Math.PI * 2,
        n = Math.random() * 0.9,
        r = this.group.position;
      t.emit({
        pos: TMP_A.set(r.x + Math.cos(e) * n, r.y + 0.3 + Math.random(), r.z + Math.sin(e) * n),
        vel: TMP_B.set(0, 1.6 + Math.random(), 0),
        spread: 0.2,
        color: 16765803,
        intensity: 2.4,
        size: 0.09,
        sizeEnd: 0.02,
        life: 1.4,
        gravity: -0.4,
        drag: 0.5,
      });
    }
    return !(this.going && this.k <= 0);
  }
  dispose(): void {
    (this.group.removeFromParent(),
      this.group.traverse((e) => {
        const t = e as THREE.Mesh;
        t.isMesh && (t.geometry.dispose(), (t.material as THREE.Material).dispose());
      }));
  }
}

/** The `fly` ring: a glowing torus with a faint film, tilted along n. through(p) tests a pass through it. */
export class RingGate { // zN (60149)
  group = new THREE.Group();
  ring: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  film: THREE.Mesh;
  filmMat: THREE.MeshBasicMaterial;
  t = 0;
  k = 0;
  going = !1;
  r = 2.3;
  n = new THREE.Vector3(0, 1, 0);
  constructor() {
    const e = new THREE.Color(9434111);
    ((this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.r, 0.13, 12, 80),
      new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(2.1) }),
    )),
      (this.glowMat = new THREE.MeshBasicMaterial({
        color: e.clone().multiplyScalar(1.4),
        transparent: !0,
        opacity: 0.22,
        depthWrite: !1,
      })));
    const t = new THREE.Mesh(new THREE.TorusGeometry(this.r, 0.36, 10, 80), this.glowMat);
    ((this.filmMat = new THREE.MeshBasicMaterial({
      color: e,
      transparent: !0,
      opacity: 0.1,
      depthWrite: !1,
      side: THREE.DoubleSide,
    })),
      (this.film = new THREE.Mesh(new THREE.CircleGeometry(this.r - 0.1, 56), this.filmMat)));
    for (const e of [this.ring, t, this.film]) ((e.renderOrder = 6), this.group.add(e));
    this.group.scale.setScalar(0.001);
  }
  at(e: THREE.Vector3, t: THREE.Vector3): this {
    return (
      this.group.position.copy(e),
      this.n.copy(t).normalize(),
      this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.n),
      this
    );
  }
  go(): void {
    this.going = !0;
  }
  /** Is e within 1.1 m of the ring's plane and inside its rim? */
  through(e: THREE.Vector3): boolean {
    TMP_A.copy(e).sub(this.group.position);
    const t = TMP_A.dot(this.n),
      n = Math.sqrt(Math.max(0, TMP_A.lengthSq() - t * t));
    return Math.abs(t) < 1.1 && n < this.r + 0.25;
  }
  /** Returns false once it has shrunk away after go(). */
  update(e: number, t: PropSparks): boolean {
    ((this.t += e), (this.k = this.going ? Math.max(0, this.k - e * 2.4) : Math.min(1, this.k + e * 2)));
    const n = this.going ? 1 + (1 - this.k) * 0.8 : 1 - (1 - this.k) ** 3 * Math.cos(this.k * 5);
    if (
      (this.group.scale.setScalar(Math.max(0.001, n)),
      (this.glowMat.opacity = (0.18 + 0.08 * Math.sin(this.t * 3)) * this.k),
      (this.filmMat.opacity = (0.07 + 0.04 * Math.sin(this.t * 2.2)) * this.k),
      (this.ring.rotation.z = this.t * 0.4),
      !this.going && Math.random() < e * 14)
    ) {
      const e = Math.random() * Math.PI * 2;
      (TMP_A.set(Math.cos(e) * this.r, Math.sin(e) * this.r, 0).applyQuaternion(this.group.quaternion).add(this.group.position),
        t.emit({
          pos: TMP_A,
          vel: TMP_B.set(0, 0.4, 0),
          spread: 0.4,
          color: 10483455,
          intensity: 2.4,
          size: 0.08,
          sizeEnd: 0.02,
          life: 0.9,
          gravity: -0.2,
          drag: 0.8,
        }));
    }
    if (this.going && this.k > 0.5)
      for (let e = 0; e < 3; e++) {
        const e = Math.random() * Math.PI * 2;
        (TMP_A.set(Math.cos(e) * this.r, Math.sin(e) * this.r, 0).applyQuaternion(this.group.quaternion).add(this.group.position),
          t.emit({
            pos: TMP_A,
            vel: TMP_B.set(Math.cos(e) * 3, Math.sin(e) * 3, 0).applyQuaternion(this.group.quaternion),
            spread: 1,
            color: 12581375,
            intensity: 3,
            size: 0.12,
            sizeEnd: 0.02,
            life: 0.7,
            drag: 1.5,
          }));
      }
    return !(this.going && this.k <= 0);
  }
  dispose(): void {
    (this.group.removeFromParent(),
      this.group.traverse((e) => {
        const t = e as THREE.Mesh;
        t.isMesh && (t.geometry.dispose(), (t.material as THREE.Material).dispose());
      }));
  }
}

/** The `dig` marker: a pulsing ground ring (one copy drawn through the rock) and three arrows falling into it. */
export class DigMarker { // BN (60259)
  group = new THREE.Group();
  mats: THREE.MeshBasicMaterial[] = [];
  arrows: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[] = [];
  t = 0;
  k = 0;
  going = !1;
  constructor() {
    const e = new THREE.Color(16753213).multiplyScalar(1.5),
      t = new THREE.RingGeometry(1.35, 1.6, 56).rotateX(-Math.PI / 2),
      n = new THREE.MeshBasicMaterial({ color: e, transparent: !0, depthWrite: !1, side: THREE.DoubleSide }),
      r = new THREE.MeshBasicMaterial({ color: e, transparent: !0, depthWrite: !1, depthTest: !1, side: THREE.DoubleSide });
    this.mats.push(n, r);
    const i = new THREE.Mesh(t, n),
      a = new THREE.Mesh(t, r);
    ((i.position.y = a.position.y = 0.08), (i.renderOrder = 6), (a.renderOrder = 7), this.group.add(i, a));
    const o = new THREE.Shape();
    (o.moveTo(-0.5, 0.3),
      o.lineTo(0, -0.2),
      o.lineTo(0.5, 0.3),
      o.lineTo(0.5, 0.05),
      o.lineTo(0, -0.45),
      o.lineTo(-0.5, 0.05),
      o.closePath());
    const s = new THREE.ShapeGeometry(o);
    for (let t = 0; t < 3; t++) {
      const t = new THREE.MeshBasicMaterial({ color: e, transparent: !0, depthWrite: !1, side: THREE.DoubleSide });
      this.mats.push(t);
      const n = new THREE.Mesh(s, t);
      ((n.renderOrder = 6), this.arrows.push(n), this.group.add(n));
    }
    this.group.scale.setScalar(0.001);
  }
  at(e: THREE.Vector3): this {
    return (this.group.position.copy(e), this);
  }
  go(): void {
    this.going = !0;
  }
  /** t: the camera (the arrows turn to face it). Returns false once it has shrunk away after go(). */
  update(e: number, t: THREE.Object3D): boolean {
    ((this.t += e),
      (this.k = this.going ? Math.max(0, this.k - e * 3) : Math.min(1, this.k + e * 2.2)),
      this.group.scale.setScalar(Math.max(0.001, this.going ? this.k : 1 - (1 - this.k) ** 3 * Math.cos(this.k * 5))));
    const n = 0.8 + 0.2 * Math.sin(this.t * 4);
    ((this.mats[0].opacity = 0.95 * n * this.k), (this.mats[1].opacity = 0.38 * n * this.k));
    const r = Math.atan2(t.position.x - this.group.position.x, t.position.z - this.group.position.z);
    return (
      this.arrows.forEach((e, t) => {
        const n = (this.t * 0.8 + t / 3) % 1;
        (e.position.set(0, 3.2 - n * 2.4, 0), e.rotation.set(0, r, 0), (e.material.opacity = Math.sin(n * Math.PI) * this.k));
      }),
      !(this.going && this.k <= 0)
    );
  }
  dispose(): void {
    (this.group.removeFromParent(),
      this.group.traverse((e) => {
        const t = e as THREE.Mesh;
        t.isMesh && t.geometry.dispose();
      }));
    for (const e of this.mats) e.dispose();
  }
}

export type TutorialProp = Beacon | RingGate | DigMarker;
