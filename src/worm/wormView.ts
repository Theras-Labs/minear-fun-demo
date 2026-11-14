// Port of play-inUT-NSi.js 65535-65922: the Grin worm view TI (the boss-size worm the player sees) and its
// helpers EI (basis quaternion) and DI (ray / sphere). It draws the worm from simulation snapshots (seen),
// interpolated by time with a delay; the body is 16 instanced segments (plus the spines) laid along a trail
// of past head positions, then the tail. It reports rock breaches (enter / leave rock), turns drill, rivet and
// blast hits into hooks (hurt for the floaters and sparks, hit for the simulation), and pops the body one
// segment at a time on death. The game (src/worm/wormGlue.ts) also sets it as combat.worm: rayHit, sweep,
// damage and blast are the calls the combat system makes.
// The objects keep matrixAutoUpdate (the original sets no matrix calls here; only the scene itself is static).
import * as THREE from 'three';
import { stylizeMaterial } from '../miner/stylize';
import { WORM_BASE_HP, WORM_POP_DELAY, WORM_POP_STEP, WORM_SCALE, WORM_STATES, type WormSnap, type WormState, type WormWorld } from './grinWorm';
import type { WormAsset } from './wormAssets';

const SCALE = WORM_SCALE; // pI (65535)
/** Body segments. */
export const WORM_SEGMENTS = 16; // mI (65536)
const SEG_GAP = 1.25 * SCALE; // hI (65537)
const HEAD_GAP = 1.4 * SCALE; // gI (65538)
/** Spacing of the head trail. */
const PATH_STEP = 0.3; // _I (65539)

// module scratch (65540-65546)
const tmpA = new THREE.Vector3(); // vI
const tmpB = new THREE.Vector3(); // yI
const tmpC = new THREE.Vector3(); // bI
const tmpQ = new THREE.Quaternion(); // xI
const tmpM = new THREE.Matrix4(); // SI
const UP = new THREE.Vector3(0, 1, 0); // CI
const clamp = THREE.MathUtils.clamp; // wI

/** Game hooks of the view (KR.makeWorm 72320). */
export interface WormViewHooks {
  /** The head (or a popped segment) crossed between rock and air; big = fast or the final burst. */
  breach(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void;
  /** A hit landed: point, the damage the worm takes (x2 weak, x0.7 else, at least 1), weak side, crit. */
  hurt(point: THREE.Vector3, shown: number, weak: boolean, crit: boolean): void;
  /** Send the raw damage to the simulation (mp.hitWorm). */
  hit(dmg: number, weak: boolean): void;
}

export interface WormHit {
  t: number;
  point: THREE.Vector3;
  weak: boolean;
}

export interface WormSweepHit {
  point: THREE.Vector3;
  weak: boolean;
}

interface Snap {
  t: number;
  p: THREE.Vector3;
  d: THREE.Vector3;
}

type PartVisitor = (center: THREE.Vector3, radius: number, head: boolean) => boolean | void;

export class WormView { // TI (65547)
  world: WormWorld;
  hooks: WormViewHooks;
  group = new THREE.Group();
  state: WormState = `none`;
  hp = WORM_BASE_HP;
  maxHp = WORM_BASE_HP;
  threat = 0;
  sinceHit = 99;
  pos = new THREE.Vector3();
  dir = new THREE.Vector3(0, 0, 1);
  emerge = new THREE.Vector3();
  emergeK = 0;
  /** Interpolation delay in ms (0 in solo; the server delay when served). */
  delay = 0;
  snaps: Snap[] = [];
  speed = 0;
  recoil = false;
  up = new THREE.Vector3(0, 1, 0);
  t = 0;
  inRock = true;
  jawOpen = 0;
  flash = 0;
  dieT = 0;
  popped = 0;
  path: THREE.Vector3[] = [];
  head: THREE.Object3D;
  jaw: THREE.Object3D | null;
  body: THREE.InstancedMesh;
  spines: THREE.InstancedMesh | null;
  tail: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[] = [];
  pupils: THREE.MeshStandardMaterial[] = [];
  segPos: THREE.Vector3[] = [];
  segR: number[] = [];
  segQ: THREE.Quaternion[] = [];
  tailPos = new THREE.Vector3();

  constructor(e: WormAsset, t: WormWorld, n: WormViewHooks) {
    this.world = t;
    this.hooks = n;
    const r = (m: THREE.Material): THREE.Material => {
      const src = m as THREE.MeshStandardMaterial;
      if (src.name === `W_Socket`) return new THREE.MeshBasicMaterial({ color: 0 });
      if (src.name === `W_Throat`) return new THREE.MeshBasicMaterial({ color: 655876 });
      const c = src.clone();
      if (src.name === `W_Pupil`) {
        c.color.setHex(4194304);
        c.emissive.setHex(16716294);
        c.emissiveIntensity = 3;
        this.pupils.push(c);
        return c;
      }
      stylizeMaterial(c, src.name === `W_Flesh` ? 0.18 : 0.1, src.name === `W_Face` ? 1.2 : 1.6);
      if (src.name === `W_Skin` && c.map) {
        c.emissiveMap = c.map;
        c.metalness = 0;
        c.roughness = 1;
      }
      c.userData.em = new THREE.Color(
        src.name === `W_Face` ? 4867648 : src.name === `W_Teeth` ? 5591103 : src.name === `W_Skin` ? 2762278 : 0,
      );
      this.mats.push(c);
      return c;
    };
    const i = (o: THREE.Object3D) => {
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.isMesh) {
          m.material = Array.isArray(m.material) ? m.material.map(r) : r(m.material);
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
      return o;
    };
    this.head = i(e.head.clone(true));
    this.head.scale.setScalar(SCALE);
    this.jaw = this.head.getObjectByName(`W_Jaw`) ?? null;
    this.tail = i(e.tail.clone(true));
    this.tail.scale.setScalar(SCALE);
    const a = e.segment;
    const o = a as THREE.Mesh;
    const s = r(o.material as THREE.Material);
    this.body = new THREE.InstancedMesh(o.geometry, s, WORM_SEGMENTS);
    const c = a.children.find((x) => (x as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    this.spines = c ? new THREE.InstancedMesh(c.geometry, r(c.material as THREE.Material), WORM_SEGMENTS) : null;
    for (const m of [this.body, this.spines])
      if (m) {
        m.frustumCulled = false;
        m.castShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
    for (let k = 0; k < WORM_SEGMENTS; k++) {
      this.segPos.push(new THREE.Vector3());
      this.segQ.push(new THREE.Quaternion());
      this.segR.push(1.12 * SCALE * (1 - 0.42 * (k / (WORM_SEGMENTS - 1)) ** 1.4));
    }
    this.group.add(this.head, this.body, this.tail);
    if (this.spines) this.group.add(this.spines);
    this.group.visible = false;
  }

  get active(): boolean {
    return this.state !== `none`;
  }

  get dead(): boolean {
    return this.state === `dying`;
  }

  /** A simulation snapshot arrived at time t (performance.now()). */
  seen(e: WormSnap, t: number): void {
    const [n, r, i, a, o, s, c, l, u, d, f, p, m, h, g] = e;
    const st: WormState = WORM_STATES[c] ?? `stalk`;
    if (!this.active) {
      if (st === `none`) return;
      this.show(n, r, i, a, o, s);
    }
    if (st === `dying` && this.state !== `dying`) this.dieT = 0;
    this.state = st;
    this.hp = l;
    if (g > 0) this.maxHp = g;
    this.emergeK = u;
    this.emerge.set(d, f, p);
    this.recoil = m === 1;
    this.speed = h;
    this.snaps.push({ t, p: new THREE.Vector3(n, r, i), d: new THREE.Vector3(a, o, s) });
    if (this.snaps.length > 20) this.snaps.splice(0, this.snaps.length - 20);
  }

  show(e: number, t: number, n: number, r: number, i: number, a: number): void {
    this.pos.set(e, t, n);
    this.dir.set(r, i, a).normalize();
    this.up.set(0, 1, 0);
    this.snaps.length = 0;
    this.path.length = 0;
    const o = Math.ceil((HEAD_GAP + WORM_SEGMENTS * SEG_GAP + 4) / PATH_STEP) + 4;
    for (let k = o; k >= 0; k--) this.path.push(this.pos.clone().addScaledVector(this.dir, -k * PATH_STEP));
    this.inRock = this.world.sample(e, t, n) > 134;
    this.dieT = 0;
    this.popped = 0;
    this.threat = 0;
    this.sinceHit = 99;
    this.group.visible = true;
    this.body.count = WORM_SEGMENTS;
    if (this.spines) this.spines.count = WORM_SEGMENTS;
    this.head.visible = this.tail.visible = true;
  }

  /** wormHurt message: by = hitter id, me = my id (no flash for my own hits; damage() flashed already). */
  hurtBy(e: string | undefined, t: string): void {
    this.sinceHit = 0;
    if (e !== t) this.flash = 1;
  }

  gone(): void {
    this.state = `none`;
    this.group.visible = false;
    this.threat = 0;
    this.emergeK = 0;
    this.snaps.length = 0;
  }

  /** Hit spheres: head (r 1.2825, the weak part), the segments, the tail. Stops when e returns true. */
  parts(e: PartVisitor): void {
    if (this.active && this.state !== `dying` && !e(this.pos, 1.2825, true)) {
      for (let t = 0; t < WORM_SEGMENTS; t++) if (e(this.segPos[t], this.segR[t], false)) return;
      e(this.tailPos, 0.8 * SCALE, false);
    }
  }

  /** A head hit is weak when it lands in front (the face). */
  isWeak(e: THREE.Vector3, t: THREE.Vector3): boolean {
    return tmpC.subVectors(t, e).normalize().dot(this.dir) > 0.2;
  }

  /** Swept segment a -> b (a rivet step) against the parts grown by pad. */
  sweep(e: THREE.Vector3, t: THREE.Vector3, n: number): WormSweepHit | null {
    let r: WormSweepHit | null = null;
    let i = 1 / 0;
    const a = tmpA.subVectors(t, e);
    const o = a.length();
    if (o < 1e-5) return null;
    a.divideScalar(o);
    this.parts((c, s, w) => {
      const l = raySphere(e, a, c, s + n);
      if (l !== null && l <= o && l < i) {
        i = l;
        const p = e.clone().addScaledVector(a, l);
        r = { point: p, weak: w && this.isWeak(c, p) };
      }
    });
    return r;
  }

  /** Nearest part along a ray within max. */
  rayHit(e: THREE.Vector3, t: THREE.Vector3, n: number): WormHit | null {
    let r: WormHit | null = null;
    this.parts((i, a, o) => {
      const s = raySphere(e, t, i, a);
      if (s !== null && s <= n && (!r || s < r.t)) {
        const p = e.clone().addScaledVector(t, s);
        r = { t: s, point: p, weak: o && this.isWeak(i, p) };
      }
    });
    return r;
  }

  /** combat.worm.damage(dmg, point, weak, crit). */
  damage(e: number, t: THREE.Vector3, n: boolean, r: boolean): void {
    if (this.active && this.state !== `dying`) {
      this.flash = 1;
      this.sinceHit = 0;
      this.hooks.hurt(t, Math.max(1, Math.round(e * (n ? 2 : 0.7))), n, r);
      this.hooks.hit(e, n);
    }
  }

  /** Splash damage when any part is within radius t of e. */
  blast(e: THREE.Vector3, t: number, n: number): void {
    let r = false;
    this.parts((c, i) => {
      if (c.distanceTo(e) - i < t) r = true;
      return r;
    });
    if (r) this.damage(n, e, false, false);
  }

  /** Per frame: e = dt (hitstop scaled), t = performance.now(), n = the player position. */
  update(e: number, t: number, n: THREE.Vector3): void {
    if (!this.active) return;
    this.t += e;
    this.sinceHit += e;
    const r = this.snaps;
    const i = r.length;
    if (i) {
      const at = t - this.delay;
      let a0 = r[i - 1];
      let a1 = r[i - 1];
      for (let k = i - 1; k >= 0; k--) {
        if (r[k].t <= at) {
          a0 = r[k];
          a1 = r[Math.min(i - 1, k + 1)];
          break;
        }
        if (k === 0) a0 = a1 = r[0];
      }
      const o = a1.t > a0.t ? clamp((at - a0.t) / (a1.t - a0.t), 0, 1) : 1;
      this.pos.lerpVectors(a0.p, a1.p, o);
      this.dir.lerpVectors(a0.d, a1.d, o);
      if (this.dir.lengthSq() < 1e-6) this.dir.copy(a1.d);
      this.dir.normalize();
    }
    const a = this.world.sample(this.pos.x, this.pos.y, this.pos.z) > 134;
    if (a !== this.inRock) {
      this.inRock = a;
      this.hooks.breach(this.pos, this.dir, this.speed > 15);
    }
    const o = tmpA.set(n.x, n.y + 0.9, n.z).distanceTo(this.pos);
    const s = 1 - THREE.MathUtils.smoothstep(o, 10, 55);
    const c =
      this.state === `windup` ? 0.35 + this.emergeK * 0.4 : this.state === `lunge` ? 0.9 : this.state === `recover` ? 0.4 : 0;
    const l =
      this.state === `leave` ? s * 0.3 : this.state === `dying` ? 0.5 * (1 - this.dieT / 3) : clamp(s * 0.75 + c, 0, 1);
    this.threat += (l - this.threat) * Math.min(1, e * 2.5);
    let u = this.path[this.path.length - 1];
    let d = u.distanceTo(this.pos);
    if (!Number.isFinite(d) || d > 40) {
      this.path.length = 0;
      for (let k = 90; k >= 0; k--) this.path.push(this.pos.clone().addScaledVector(this.dir, -k * PATH_STEP));
      d = 0;
      u = this.path[this.path.length - 1];
    }
    for (; d >= PATH_STEP; ) {
      const p = u.clone().lerp(this.pos, PATH_STEP / d);
      this.path.push(p);
      u = p;
      d -= PATH_STEP;
      if (this.path.length > 220) this.path.shift();
    }
    this.pose(e, n);
    if (this.state === `dying`) this.updateDeath(e);
  }

  /** Head turned toward the player when close, jaw, hit flash, pupils, then the body along the trail. */
  pose(e: number, t: THREE.Vector3): void {
    const n = tmpA.set(t.x, t.y + 1, t.z).sub(this.pos);
    const r = n.length();
    const look = tmpB.copy(this.dir);
    if (r > 0.1 && r < 26 && this.state !== `leave`) {
      n.divideScalar(r);
      const k = this.state === `windup` ? 0.9 : this.state === `lunge` ? 0.5 : 0.35;
      look.lerp(n, k * (1 - THREE.MathUtils.smoothstep(r, 14, 26))).normalize();
    }
    this.up.lerp(UP, Math.min(1, e * 2));
    this.up.addScaledVector(look, -this.up.dot(look)).normalize();
    if (this.up.lengthSq() < 0.5) this.up.set(0, 1, 0);
    basisQuaternion(look, this.up, this.head.quaternion);
    this.head.position.copy(this.pos);
    if (this.recoil || this.state === `dying`)
      this.head.position.add(tmpC.set(Math.sin(this.t * 41) * 0.12, Math.cos(this.t * 37) * 0.12, 0));
    const a =
      this.state === `lunge`
        ? 0.62
        : this.state === `windup`
          ? 0.25 + Math.sin(this.t * 9) * 0.08
          : this.state === `dying`
            ? 0.7
            : this.recoil
              ? 0.55
              : 0.06 + Math.max(0, Math.sin(this.t * 1.7)) * 0.1;
    this.jawOpen += (a - this.jawOpen) * Math.min(1, e * (this.state === `lunge` ? 10 : 4));
    if (this.jaw) this.jaw.rotation.x = this.jawOpen;
    this.flash = Math.max(0, this.flash - e * 6);
    const o = this.flash * this.flash * 0.5;
    for (const m of this.mats) m.emissive.copy(m.userData.em as THREE.Color).addScalar(o);
    const s = 2.4 + Math.sin(this.t * 3.1) * 0.8 + (this.state === `windup` ? 2.5 : this.state === `lunge` ? 4 : 0);
    for (const m of this.pupils) m.emissiveIntensity = s;
    const c = this.path;
    let l = c.length - 1;
    let u = 0;
    let d = this.pos;
    const f = look.clone();
    const p = this.up.clone();
    const gap = (k: number) => HEAD_GAP + k * SEG_GAP;
    let h = 0;
    const g = new THREE.Vector3();
    for (; h <= WORM_SEGMENTS && l >= 0; ) {
      const pt = c[l];
      const dist = d.distanceTo(pt);
      const need = gap(h) + (h === WORM_SEGMENTS ? 0.4 * SCALE : 0);
      if (u + dist >= need) {
        const k = (need - u) / Math.max(1e-5, dist);
        g.copy(d).lerp(pt, k);
        const fwd = tmpC.subVectors(h === 0 ? this.pos : this.segPos[h - 1], g);
        if (fwd.lengthSq() < 1e-6) fwd.copy(f);
        fwd.normalize();
        tmpQ.setFromUnitVectors(f, fwd);
        p.applyQuaternion(tmpQ);
        p.addScaledVector(fwd, -p.dot(fwd)).normalize();
        f.copy(fwd);
        if (h < WORM_SEGMENTS) {
          this.segPos[h].copy(g);
          basisQuaternion(fwd, p, this.segQ[h]);
          const w = (this.segR[h] / (1.12 * SCALE)) * (1 + Math.sin(this.t * 4 - h * 0.7) * 0.035);
          tmpM.compose(g, this.segQ[h], tmpB.set(w * SCALE, w * SCALE, SCALE));
          this.body.setMatrixAt(h, tmpM);
          this.spines?.setMatrixAt(h, tmpM);
        } else {
          this.tailPos.copy(g);
          basisQuaternion(fwd, p, this.tail.quaternion);
          this.tail.position.copy(g);
          const w = (1 - 0.42) * SCALE;
          this.tail.scale.set(w, w, SCALE);
        }
        u = need;
        d = g.clone();
        h++;
        continue;
      }
      u += dist;
      d = pt;
      l--;
    }
    this.body.instanceMatrix.needsUpdate = true;
    if (this.spines) this.spines.instanceMatrix.needsUpdate = true;
  }

  /** From 1.6 s into the death, pops the tail then each segment every 0.09 s, then the head (big breach). */
  updateDeath(e: number): void {
    this.dieT += e;
    if (this.dieT < 1.6) return;
    const t = Math.floor((this.dieT - WORM_POP_DELAY) / WORM_POP_STEP);
    while (this.popped < Math.min(t, WORM_SEGMENTS + 1)) {
      const k = WORM_SEGMENTS - this.popped;
      const at = k === WORM_SEGMENTS ? this.tailPos : this.segPos[k];
      this.hooks.breach(at, this.dir, false);
      if (k === WORM_SEGMENTS) this.tail.visible = false;
      else {
        this.body.count = k;
        if (this.spines) this.spines.count = k;
      }
      this.popped++;
    }
    if (this.popped > WORM_SEGMENTS && this.head.visible) {
      this.head.visible = false;
      this.hooks.breach(this.pos, this.dir, true);
    }
  }
}

/** Quaternion whose +Z is forward and +Y is up (orthogonalised). Uses the shared matrix scratch. */
export function basisQuaternion(e: THREE.Vector3, t: THREE.Vector3, n: THREE.Quaternion): void { // EI (65904)
  const r = e;
  const i = new THREE.Vector3().crossVectors(t, r);
  if (i.lengthSq() < 1e-6) i.set(1, 0, 0);
  i.normalize();
  const a = new THREE.Vector3().crossVectors(r, i);
  tmpM.makeBasis(i, a, r);
  n.setFromRotationMatrix(tmpM);
}

/** Ray (origin e, unit dir t) against sphere (center n, radius r): entry distance, 0 when inside, else null. */
export function raySphere(e: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, r: number): number | null { // DI (65911)
  const i = e.x - n.x;
  const a = e.y - n.y;
  const o = e.z - n.z;
  const s = i * t.x + a * t.y + o * t.z;
  const c = i * i + a * a + o * o - r * r;
  const l = s * s - c;
  if (l < 0) return null;
  const u = Math.sqrt(l);
  const d = -s - u;
  return d >= 0 ? d : -s + u >= 0 ? 0 : null;
}
