// Port of play-inUT-NSi.js 47545-47717: the Drill Slam FX manager CD (KR.ultFx). One group holds the aim ring and
// curtain (normal pass), their x-ray copies drawn on top with depthTest off, a pool of 3 crater scars and a pool of
// 3 additive light pillars. aim() follows the target, slam() fires a scar and a pillar, relay() lays the newest
// scar again after the crater is carved, update(dt) animates, warm(on) shows everything far below the map once so
// the shaders compile.
import * as THREE from 'three';
import { SLAM, SLAM_COLOR } from './planner';
import {
  AIM_RING_FRAG,
  CURTAIN_FRAG,
  CURTAIN_VERT,
  Curtain,
  DISC_VERT,
  GroundDisc,
  PILLAR_FRAG,
  PILLAR_VERT,
  SCAR_FRAG,
  type GroundFn,
} from './decals';

type U<T> = { value: T };

interface AimUniforms {
  [name: string]: THREE.IUniform;
  uColor: U<THREE.Color>;
  uR: U<number>;
  uTime: U<number>;
  uOk: U<number>;
  uAlpha: U<number>;
  uBias: U<number>;
  uXray: U<number>;
}

interface ScarUniforms {
  [name: string]: THREE.IUniform;
  uR: U<number>;
  uT: U<number>;
  uSeed: U<number>;
  uBias: U<number>;
}

interface PillarUniforms {
  [name: string]: THREE.IUniform;
  uK: U<number>;
  uTime: U<number>;
}

interface Scar {
  disc: GroundDisc;
  u: ScarUniforms;
  t: number;
  at: THREE.Vector3;
}

interface Pillar {
  mesh: THREE.Mesh;
  u: PillarUniforms;
  t: number;
}

export class SlamFx { // CD (47545)
  ground: GroundFn;
  group = new THREE.Group();
  time = { value: 0 };
  aimU: AimUniforms = {
    uColor: { value: new THREE.Color(SLAM_COLOR) },
    uR: { value: SLAM.radius },
    uTime: this.time,
    uOk: { value: 1 },
    uAlpha: { value: 0 },
    uBias: { value: 0.55 },
    uXray: { value: 1 },
  };
  ring: GroundDisc;
  curtain: Curtain;
  ringX: THREE.Mesh;
  curtainX: THREE.Mesh;
  aimK = 0;
  aimOn = false;
  scars: Scar[] = [];
  pillars: Pillar[] = [];
  nextScar = 0;
  nextPillar = 0;

  constructor(e: GroundFn) {
    this.ground = e;
    const t = {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    };
    this.ring = new GroundDisc(
      new THREE.ShaderMaterial({ uniforms: this.aimU, vertexShader: DISC_VERT, fragmentShader: AIM_RING_FRAG, ...t }),
      SLAM.radius + 0.7,
    );
    this.curtain = new Curtain(
      new THREE.ShaderMaterial({
        uniforms: this.aimU,
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      SLAM.radius,
      1.1,
    );
    const n: AimUniforms = { ...this.aimU, uXray: { value: 0.42 } },
      r = { transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide };
    this.ringX = new THREE.Mesh(
      this.ring.mesh.geometry,
      new THREE.ShaderMaterial({ uniforms: n, vertexShader: DISC_VERT, fragmentShader: AIM_RING_FRAG, ...r }),
    );
    this.curtainX = new THREE.Mesh(
      this.curtain.mesh.geometry,
      new THREE.ShaderMaterial({ uniforms: n, vertexShader: CURTAIN_VERT, fragmentShader: CURTAIN_FRAG, ...r }),
    );
    for (const m of [this.ringX, this.curtainX]) {
      m.frustumCulled = false;
      m.renderOrder = 20;
      m.visible = false;
    }
    this.group.add(this.ring.mesh, this.curtain.mesh, this.ringX, this.curtainX);
    for (let k = 0; k < 3; k++) {
      const u: ScarUniforms = {
          uR: { value: SLAM.radius },
          uT: { value: 99 },
          uSeed: { value: Math.random() * 50 },
          uBias: { value: 0.35 },
        },
        disc = new GroundDisc(
          new THREE.ShaderMaterial({ uniforms: u, vertexShader: DISC_VERT, fragmentShader: SCAR_FRAG, ...t }),
          SLAM.radius + 1.6,
          10,
          64,
        );
      this.group.add(disc.mesh);
      this.scars.push({ disc, u, t: 99, at: new THREE.Vector3() });
    }
    const i = new THREE.CylinderGeometry(0.3, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    for (let k = 0; k < 3; k++) {
      const u: PillarUniforms = { uK: { value: 0 }, uTime: this.time },
        mesh = new THREE.Mesh(
          i,
          new THREE.ShaderMaterial({
            uniforms: u,
            vertexShader: PILLAR_VERT,
            fragmentShader: PILLAR_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      mesh.visible = false;
      this.group.add(mesh);
      this.pillars.push({ mesh, u, t: 99 });
    }
  }

  /** Shows the aim ring at `e` (red when `t` is false); the curtain follows when the ring moved. */
  aim(e: THREE.Vector3, t: boolean): void {
    this.aimOn = true;
    if (this.ring.place(e, this.ground) || !this.curtain.mesh.visible) this.curtain.place(e, this.ring.floor);
    this.aimU.uOk.value = +!!t;
  }

  hideAim(): void {
    this.aimOn = false;
  }

  /** A scar disc and a light pillar at `e` (round robin over 3 each). */
  slam(e: THREE.Vector3): void {
    const t = this.scars[this.nextScar];
    this.nextScar = (this.nextScar + 1) % this.scars.length;
    t.t = 0;
    t.at.copy(e);
    t.u.uSeed.value = Math.random() * 50;
    t.disc.place(e, this.ground, true);
    const n = this.pillars[this.nextPillar];
    this.nextPillar = (this.nextPillar + 1) % this.pillars.length;
    n.t = 0;
    n.mesh.position.copy(e);
    n.mesh.visible = true;
  }

  /** Lays the newest scar on the ground again (after the crater changed it). */
  relay(): void {
    const e = this.scars[(this.nextScar + this.scars.length - 1) % this.scars.length];
    if (e.disc.mesh.visible) e.disc.place(e.at, this.ground, true);
  }

  update(e: number): void {
    this.time.value += e;
    this.aimK += (+!!this.aimOn - this.aimK) * Math.min(1, e * (this.aimOn ? 16 : 10));
    this.aimU.uAlpha.value = this.aimK;
    if (this.aimK < 0.01 && !this.aimOn) {
      this.ring.hide();
      this.curtain.mesh.visible = false;
    }
    this.ringX.visible = this.ring.mesh.visible;
    this.curtainX.visible = this.curtain.mesh.visible;
    for (const t of this.scars) {
      if (!t.disc.mesh.visible) continue;
      const n = t.t;
      t.t += e;
      t.u.uT.value = t.t;
      if ((n < 0.1 && t.t >= 0.1) || (n < 0.6 && t.t >= 0.6)) t.disc.place(t.at, this.ground, true);
      if (t.t > 3.7) t.disc.hide();
    }
    for (const t of this.pillars) {
      if (!t.mesh.visible) continue;
      t.t += e;
      const n = t.t / 0.36;
      if (n >= 1) {
        t.mesh.visible = false;
        continue;
      }
      const r = Math.min(1, t.t / 0.06);
      t.mesh.scale.set(0.7 + n * 1.3, 10 * r * (1 - n * 0.3), 0.7 + n * 1.3);
      t.u.uK.value = (1 - n) * (1 - n);
    }
  }

  /** KR.warmUp (70978-70980): true shows every mesh 5 km below the map for one render, false hides them again. */
  warm(e: boolean): void {
    if (e) {
      this.ring.mesh.visible = this.curtain.mesh.visible = this.ringX.visible = this.curtainX.visible = true;
      for (const s of this.scars) s.disc.mesh.visible = true;
      for (const p of this.pillars) p.mesh.visible = true;
      this.group.position.set(0, -5e3, 0);
    } else {
      this.group.position.set(0, 0, 0);
      this.ring.hide();
      this.curtain.mesh.visible = this.ringX.visible = this.curtainX.visible = false;
      for (const s of this.scars) s.disc.hide();
      for (const p of this.pillars) p.mesh.visible = false;
    }
  }
}
