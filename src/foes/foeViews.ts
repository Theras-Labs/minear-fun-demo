// Port of play-inUT-NSi.js 62525-62526 (scratch tF / nF) and 62939-63171: the foe view manager wF.
// Holds every drawn foe. Builds templates (foe nodes of foes.glb, bone names without the trailing _N),
// weapons and clips; adds / removes foes from the simulation's info tuples; keeps a 20-entry interpolation
// buffer per foe from snapshots, drawn at (now - delay); answers hit queries (capsule ray, capsule sweep,
// cone) and applies predicted damage. Fires hooks for rise, wind-up, death, golem slams, auras, mending and
// burrowing. The combat system (dI) owns one as `combat.foes`.
import * as THREE from 'three';
import { stylizeMaterial } from '../miner/stylize';
import { FOE_LOOPS, FOE_STATES, FOE_TYPES, type FoeKind } from './types';
import type { FoeInfo, FoeSnap } from './foe';
import { FoeView } from './foeView';
import { clampF, getRockMaterial, GLOW_MATERIALS, lerpAngle, LOOK_TIME, rockMesh, setRockMaterial } from './looks';
import type { FoeAsset } from './assets';

const tF = new THREE.Vector3(); // tF (62525)
const nF = new THREE.Vector3(); // nF (62526)

/** wF hooks (the combat system dI supplies them). */
export interface FoeViewHooks {
  rose(foe: FoeView): void;
  windup(foe: FoeView): void;
  /** mine = the local player is among the killers. */
  died(foe: FoeView, mine: boolean): void;
  /** A local hit to report to the simulation (host.hitFoe(id, dmg, dx, dz, knock, chill)). */
  hit(foe: FoeView, dmg: number, dx: number, dz: number, knock: number, chill: number): void;
  aura(foe: FoeView, dt: number): void;
  mending(foe: FoeView, dt: number): void;
  burrowing(foe: FoeView, dt: number): void;
  /** A surface golem's swing hit the ground at pos. */
  slam(foe: FoeView, pos: THREE.Vector3): void;
}

export interface FoeRayHit {
  foe: FoeView;
  t: number;
  point: THREE.Vector3;
}

export class FoeViews { // wF (62939)
  hooks: FoeViewHooks;
  group = new THREE.Group();
  foes: FoeView[] = [];
  /** Interpolation delay in ms (0 in solo, 150 when served). */
  delay = 0;
  /** The camera-side eye point that wraiths fade toward (KR sets it each frame). */
  eye = new THREE.Vector3();
  templates = new Map<string, THREE.Object3D>();
  weapons = new Map<string, THREE.Object3D>();
  clips = new Map<string, THREE.AnimationClip>();
  constructor(e: FoeAsset, t: FoeViewHooks) {
    this.hooks = t;
    e.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh)
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const s = mat as THREE.MeshStandardMaterial;
          if (GLOW_MATERIALS.has(s.name)) {
            s.color.setHex(12582894);
            s.emissive.setHex(5898188);
            s.emissiveIntensity = 2.2;
          }
        }
    });
    for (const def of Object.values(FOE_TYPES)) {
      const n = e.scene.getObjectByName(def.node);
      if (n) {
        n.traverse((b) => {
          if ((b as THREE.Bone).isBone) b.name = b.name.replace(/_\d+$/, ``);
        });
        this.templates.set(def.node, n);
      }
    }
    for (const name of [`F_W_Pick`, `F_W_Crossbow`, `F_W_Blade`, `F_W_Shield`, `F_W_Staff`, `F_W_Axe`, `F_W_Drill`]) {
      const n = e.scene.getObjectByName(name);
      if (n) this.weapons.set(name, n);
    }
    for (const c of e.clips) this.clips.set(c.name, c);
    e.scene.getObjectByName(`F_Golem`)?.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material;
      if (!getRockMaterial() && mat && !Array.isArray(mat) && mat.name === `G_Rock`) {
        const r = mat.clone() as THREE.MeshStandardMaterial;
        r.flatShading = true;
        stylizeMaterial(r, 0.08, 1.6);
        setRockMaterial(r);
      }
    });
  }
  get active(): number {
    let e = 0;
    for (const t of this.foes) if (t.state !== `dead`) e++;
    return e;
  }
  byId(e: number): FoeView | null {
    return this.foes.find((t) => t.id === e) ?? null;
  }
  /** A foe came into view: info tuple [id, kind, x, y, z, yaw, hp, maxHp, stateIdx, stateTime, loopIdx, champion]. */
  add(e: FoeInfo, t: number): void {
    const [n, r, i, a, o, s, c, l, u, d, f, p] = e;
    const m = FOE_TYPES[r as FoeKind];
    const h = m && (this.templates.get(m.node) ?? (m.surface ? this.templates.get(`F_Guard`) : void 0));
    if (!h) return;
    this.gone(n);
    const g = new FoeView(n, r as FoeKind, m, h, this.clips, this.weapons, c, l, p === 1);
    g.pos.set(i, a, o);
    g.yaw = s;
    g.loop = FOE_LOOPS[f] ?? `walk`;
    g.snaps.push({ t, x: i, y: a, z: o, yaw: s });
    this.foes.push(g);
    this.group.add(g.root);
    g.enter(FOE_STATES[u] ?? `hunt`, true, d);
    g.animate(0);
    if (g.state === `rise` && d < 0.5) this.hooks.rose(g);
  }
  /** Snapshot tuples [id, x, y, z, yaw, stateIdx, loopIdx, rate, hp] received at time t (ms). */
  snapshot(e: FoeSnap[], t: number): void {
    for (const [n, r, i, a, o, s, c, l, u] of e) {
      const f = this.byId(n);
      if (!f) continue;
      f.snaps.push({ t, x: r, y: i, z: a, yaw: o });
      if (f.snaps.length > 20) f.snaps.splice(0, f.snaps.length - 20);
      f.told(u);
      const loop = FOE_LOOPS[c] ?? `walk`;
      const changed = loop !== f.loop;
      f.loop = loop;
      f.rate = l;
      const state = FOE_STATES[s] ?? `hunt`;
      if (state === f.state) f.legs(changed);
      else f.enter(state);
    }
  }
  /** A wind-up (attack, or the state index of hurl / mend / dig). */
  windup(e: number, t?: number): void {
    const n = this.byId(e);
    if (n) {
      n.enter(t === void 0 ? `attack` : (FOE_STATES[t] ?? `attack`), true);
      this.hooks.windup(n);
    }
  }
  /** Reported HP after a hit by `by`; anim = the hit staggered it. */
  hurt(e: number, t: number, n: boolean, r: string | undefined, i: string): void {
    const a = this.byId(e);
    if (a) {
      a.told(t, r === i);
      if (r !== i) {
        a.flash = 1;
        a.sinceHit = 0;
      }
      if (n) a.enter(`hurt`, true);
    }
  }
  died(e: number, t: string[], n: string): void {
    const r = this.byId(e);
    if (r && r.state !== `dead`) {
      r.told(0);
      r.hp = 0;
      r.enter(`dead`);
      this.hooks.died(r, t.includes(n));
    }
  }
  gone(e: number): void {
    const t = this.foes.findIndex((f) => f.id === e);
    if (t < 0) return;
    this.foes[t].dispose();
    this.foes.splice(t, 1);
  }
  clear(): void {
    for (const e of this.foes) e.dispose();
    this.foes.length = 0;
  }
  /** Compiles every foe kind and the rock: adds one of each at y -5000, awaits render(), removes them. */
  async warmUp(e: () => Promise<unknown> | unknown): Promise<void> {
    const t = (Object.keys(FOE_TYPES) as FoeKind[]).map((kind, k) => {
      const id = -100 - k;
      this.add([id, kind, 0, -5e3, 0, 0, 1, 1, FOE_STATES.indexOf(`hunt`), 1, 0, 0], 0);
      return id;
    });
    const n = rockMesh();
    n.position.set(0, -5e3, 0);
    this.group.add(n);
    await e();
    n.removeFromParent();
    for (const id of t) this.gone(id);
  }
  /** Nearest live foe hit by the ray (origin, dir, max length) against its capsule. */
  rayHit(e: THREE.Vector3, t: THREE.Vector3, n: number): FoeRayHit | null {
    let r: FoeRayHit | null = null;
    for (const i of this.foes) {
      if (i.state === `dead`) continue;
      const a = this.capsuleT(i, e, t, n, i.def.radius);
      if (a !== null && (!r || a < r.t)) r = { foe: i, t: a, point: e.clone().addScaledVector(t, a) };
    }
    return r;
  }
  /** First live foe touched by a sphere of radius pad moving from a to b. */
  sweep(e: THREE.Vector3, t: THREE.Vector3, n: number): FoeView | null {
    nF.subVectors(t, e);
    const r = nF.length();
    if (r < 1e-5) return null;
    nF.divideScalar(r);
    let i: FoeView | null = null;
    let a = 1 / 0;
    for (const f of this.foes) {
      if (f.state === `dead`) continue;
      const o = this.capsuleT(f, e, nF, r, f.def.radius + n);
      if (o !== null && o < a) {
        a = o;
        i = f;
      }
    }
    return i;
  }
  /** Distance along the ray where it first enters the foe's vertical capsule of radius i (0.25 steps), or null. */
  capsuleT(e: FoeView, t: THREE.Vector3, n: THREE.Vector3, r: number, i: number): number | null {
    const a = e.pos.y + i * 0.6;
    const o = e.pos.y + e.height - 0.35 - i * 0.4;
    const s = Math.max(4, Math.ceil(r / 0.25));
    for (let c = 0; c <= s; c++) {
      const l = (c / s) * r;
      const u = t.x + n.x * l;
      const d = t.y + n.y * l;
      const f = t.z + n.z * l;
      const p = clampF(d, a, o);
      const m = u - e.pos.x;
      const h = d - p;
      const g = f - e.pos.z;
      if (m * m + h * h + g * g <= i * i) return l;
    }
    return null;
  }
  /** Live foes inside a cone (pos, unit dir, range, min dot), nearest first. */
  inCone(e: THREE.Vector3, t: THREE.Vector3, n: number, r: number): FoeView[] {
    const i: { f: FoeView; d: number }[] = [];
    for (const a of this.foes) {
      if (a.state === `dead`) continue;
      a.center(tF).sub(e);
      const o = tF.length();
      if (o - a.def.radius - 0.45 > n || (o > 0.6 && tF.divideScalar(o).dot(t) < r)) continue;
      i.push({ f: a, d: o });
    }
    return i.sort((x, y) => x.d - y.d).map((x) => x.f);
  }
  /** A local hit: predicts the damage, flashes, reports it through hooks.hit. Returns true if predicted dead. */
  damage(e: FoeView, t: number, n: THREE.Vector3, r: number, i = 0): boolean {
    if (e.state === `dead`) return false;
    e.predict(e.state === `rise` ? t * 0.3 : t);
    e.flash = 1;
    e.punch = 1;
    e.sinceHit = 0;
    this.hooks.hit(e, t, n.x, n.z, r, i);
    return e.hp <= 0;
  }
  /** Interpolates every foe to (now - delay), animates it and fires the per-frame hooks. */
  update(e: number, t: number): void {
    const n = t - this.delay;
    LOOK_TIME.value += e;
    for (const f of this.foes) {
      f.sinceHit += e;
      const r = f.snaps;
      const i = r.length;
      if (i) {
        let a = r[i - 1];
        let b = r[i - 1];
        for (let k = i - 1; k >= 0; k--) {
          if (r[k].t <= n) {
            a = r[k];
            b = r[Math.min(i - 1, k + 1)];
            break;
          }
          if (k === 0) a = b = r[0];
        }
        const o = b.t > a.t ? clampF((n - a.t) / (b.t - a.t), 0, 1) : 1;
        f.pos.set(a.x + (b.x - a.x) * o, a.y + (b.y - a.y) * o, a.z + (b.z - a.z) * o);
        f.yaw = lerpAngle(a.yaw, b.yaw, o);
      }
      if (f.def.ghost) f.ghostSeen = 1 - THREE.MathUtils.smoothstep(f.pos.distanceTo(this.eye), 7, 15);
      f.animate(e);
      if (f.def.look) this.hooks.aura(f, e);
      if (f.state === `mend`) this.hooks.mending(f, e);
      else if (f.state === `dig`) this.hooks.burrowing(f, e);
      const h = f.def.hurl;
      if (h && f.state === `hurl` && !f.thrown && f.attackT >= (h.len / h.rate) * h.at) f.letGo();
      if (
        f.def.surface &&
        f.state === `attack` &&
        !f.slammed &&
        f.attackT >= (f.def.swingLen / f.def.swingRate) * f.def.hitAt
      ) {
        f.slammed = true;
        this.hooks.slam(
          f,
          new THREE.Vector3(f.pos.x + Math.sin(f.yaw) * 2.4, f.pos.y + 0.1, f.pos.z + Math.cos(f.yaw) * 2.4),
        );
      }
    }
  }
}

/** Alias for callers that name wF by its role. */
export { FoeViews as FoeViewManager };
