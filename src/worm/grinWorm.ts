// Port of play-inUT-NSi.js 44851-45188: the Grin worm simulation _T. One giant worm swims through rock toward
// a deep player: approach from below, stalk in an orbit while giggling, wind up (coil below the player and
// show an emerge point), lunge through the player (bite), recover, repeat. It leaves after 150 s or when the
// player stays away (surface, haven, knocked out) for 7 s. Face hits do double damage and enough face damage
// staggers it. On death it bursts after 3.13 s.
// Server-style: it runs inside the monster host (src/worm/wormHost.ts) and reports through hooks; the view
// (src/worm/wormView.ts) only draws the snapshots.
import * as THREE from 'three';
import { surfaceHeight } from '../world/generate';
import type { SimPlayer } from '../foes/foeManager';

/** State names; snapshots carry the index. */
export const WORM_STATES = [`none`, `approach`, `stalk`, `windup`, `lunge`, `recover`, `leave`, `dying`] as const; // iT (44851)
export type WormState = (typeof WORM_STATES)[number];
/** Model scale of the worm. */
export const WORM_SCALE = 0.95; // aT (44852)
// 44853 `1.35 * aT;` is a dead expression left by the minifier (1.2825 is the head hit radius in the view).
export const WORM_BASE_HP = 1800; // oT (44854)
/** Seconds into the death before the body starts to pop (view). */
export const WORM_POP_DELAY = 1.6; // sT (44855)
/** Seconds between two popped segments (view). */
export const WORM_POP_STEP = 0.09; // cT (44856)

/** Max HP and bite damage for a target depth (surface height minus y) and the director level. */
export function wormStats(depth: number, level: number): { maxHp: number; bite: number } { // lT (44857)
  const n = (1 + Math.max(0, depth - 22) / 110) * (1 + level * 0.35);
  return {
    maxHp: Math.round(WORM_BASE_HP * n ** 1.25),
    bite: Math.round(58 * (1 + Math.max(0, depth - 22) / 160) * (1 + level * 0.2)),
  };
}

// module scratch (44864-44870)
const tmpA = new THREE.Vector3(); // uT
const tmpB = new THREE.Vector3(); // dT
const tmpC = new THREE.Vector3(); // fT
const tmpQ = new THREE.Quaternion(); // pT
const UP = new THREE.Vector3(0, 1, 0); // mT
const clamp = THREE.MathUtils.clamp; // hT
const round2 = (e: number) => Math.round(e * 100) / 100; // gT

export type WormCue = `screech` | `giggle` | `windup` | `lunge` | `die`;

/** Snapshot: [x, y, z, dirX, dirY, dirZ, stateIdx, hp, emergeK, emergeX, emergeY, emergeZ, staggered, speed, maxHp]. */
export type WormSnap = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** What the worm reads from the world. */
export interface WormWorld {
  sample(x: number, y: number, z: number): number;
}

/** _T hooks (the monster host turns them into messages). */
export interface GrinWormHooks {
  spawned(targetId: string): void;
  cue(kind: WormCue, pos: THREE.Vector3): void;
  bite(playerId: string, dmg: number, pos: THREE.Vector3): void;
  hurt(dmg: number, weak: boolean, by: string | undefined): void;
  left(): void;
  died(pos: THREE.Vector3, hitters: string[]): void;
  gone(): void;
}

/** The chosen target as think() reads it. */
export interface WormPrey {
  id: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ok: boolean;
  surface: boolean;
}

interface XYZ {
  x: number;
  y: number;
  z: number;
}

export class GrinWorm { // _T (44871)
  world: WormWorld;
  hooks: GrinWormHooks;
  state: WormState = `none`;
  hp = WORM_BASE_HP;
  maxHp = WORM_BASE_HP;
  bite = 58;
  pos = new THREE.Vector3();
  dir = new THREE.Vector3(0, 0, 1);
  speed = 0;
  target: string | null = null;
  hitters = new Set<string>();
  emerge = new THREE.Vector3();
  emergeK = 0;
  stagger = 0;
  t = 0;
  stateT = 0;
  life = 0;
  cool = 0;
  orbit = 1;
  giggleT = 4;
  away = 0;
  bitten = new Set<string>();
  lungeFrom = new THREE.Vector3();
  lungeDir = new THREE.Vector3();
  windAt = new THREE.Vector3();
  coiled = false;
  coilT = 0;
  faceDmg = 0;
  dieT = 0;
  burst = false;
  prey: WormPrey = { id: ``, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ok: false, surface: false };

  constructor(world: WormWorld, hooks: GrinWormHooks) {
    this.world = world;
    this.hooks = hooks;
  }

  get active(): boolean {
    return this.state !== `none`;
  }

  /** Spawns on a ring (radius * 0.8) around the target, 18-30 below it. */
  spawn(e: XYZ, t: string, n = 48, r = 0): void {
    const i = Math.random() * Math.PI * 2;
    this.pos.set(e.x + Math.cos(i) * n * 0.8, e.y - 18 - Math.random() * 12, e.z + Math.sin(i) * n * 0.8);
    this.dir.set(e.x - this.pos.x, 0, e.z - this.pos.z).normalize();
    const a = wormStats(surfaceHeight(e.x, e.z) - e.y, r);
    this.maxHp = a.maxHp;
    this.bite = a.bite;
    this.hp = this.maxHp;
    this.target = t;
    this.hitters.clear();
    this.setState(`approach`);
    this.life = 0;
    this.t = 0;
    this.cool = 3;
    this.away = 0;
    this.stagger = 0;
    this.orbit = Math.random() < 0.5 ? -1 : 1;
    this.speed = 7;
    this.dieT = 0;
    this.burst = false;
    this.emergeK = 0;
    this.hooks.spawned(t);
  }

  /** The calming song: dive away now. */
  flee(): void {
    if (this.active && this.state !== `dying` && this.state !== `leave`) {
      this.stagger = 0;
      this.setState(`leave`);
      this.hooks.cue(`screech`, this.pos);
      this.hooks.left();
    }
  }

  despawn(): void {
    if (this.state !== `none`) {
      this.state = `none`;
      this.emergeK = 0;
      this.target = null;
      this.hooks.gone();
    }
  }

  /** face = hit on the weak side (x2, else x0.7). */
  damage(e: number, t: boolean, n?: string): void {
    if (!this.active || this.state === `dying`) return;
    const r = Math.max(1, Math.round(e * (t ? 2 : 0.7)));
    this.hp -= r;
    if (n) this.hitters.add(n);
    this.hooks.hurt(r, t, n);
    if (t) {
      this.faceDmg += r;
      if (this.faceDmg > this.maxHp * 0.09 && this.stagger <= 0) {
        this.faceDmg = 0;
        this.stagger = 1.4;
        this.hooks.cue(`screech`, this.pos);
        if (this.state === `windup` || this.state === `lunge`) this.setState(`recover`);
      }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.setState(`dying`);
      this.hooks.cue(`die`, this.pos);
    }
  }

  snap(): WormSnap {
    const e = this.emerge;
    return [
      round2(this.pos.x),
      round2(this.pos.y),
      round2(this.pos.z),
      round2(this.dir.x),
      round2(this.dir.y),
      round2(this.dir.z),
      WORM_STATES.indexOf(this.state),
      Math.round(this.hp),
      round2(this.emergeK),
      round2(e.x),
      round2(e.y),
      round2(e.z),
      +(this.stagger > 0),
      round2(this.speed),
      this.maxHp,
    ];
  }

  setState(e: WormState): void {
    this.state = e;
    this.stateT = 0;
    if (e === `lunge`) this.bitten.clear();
    if (e === `windup`) {
      this.coiled = false;
      this.coilT = 0;
      this.emergeK = 0;
    }
  }

  /** Nearest player within 120 (current target x0.6, not targetable +500). */
  choose(e: readonly SimPlayer[]): WormPrey {
    let t: SimPlayer | null = null;
    let n = 1 / 0;
    for (const r of e) {
      if (r.ko) continue;
      const d = Math.hypot(r.pos.x - this.pos.x, r.pos.y - this.pos.y, r.pos.z - this.pos.z);
      if (d > 120) continue;
      const i = d * (r.id === this.target ? 0.6 : 1) + (r.ok ? 0 : 500);
      if (i < n) {
        n = i;
        t = r;
      }
    }
    const r = this.prey;
    if (t) {
      this.target = t.id;
      r.id = t.id;
      r.pos.set(t.pos.x, t.pos.y, t.pos.z);
      r.vel.set(t.vel.x, t.vel.y, t.vel.z);
      r.ok = t.ok;
      r.surface = surfaceHeight(t.pos.x, t.pos.z) - t.pos.y < 4;
    } else r.ok = false;
    return r;
  }

  think(e: number, t: WormPrey): void {
    const n = tmpA.set(t.pos.x, t.pos.y + 0.9, t.pos.z);
    const r = tmpB.subVectors(n, this.pos).length();
    this.stateT += e;
    this.life += e;
    this.cool -= e;
    this.stagger -= e;
    this.faceDmg = Math.max(0, this.faceDmg - e * 40);
    this.away = t.ok && !t.surface ? 0 : this.away + e;
    if (this.state !== `leave` && this.state !== `dying` && (this.away > 7 || this.life > 150)) {
      this.setState(`leave`);
      this.hooks.left();
    }
    const i = tmpC;
    let a = 8;
    let o = 1.6;
    switch (this.state) {
      case `approach`:
        i.copy(n).add(new THREE.Vector3(0, -8, 0));
        a = 9;
        o = 1.2;
        if (r < 26) this.setState(`stalk`);
        break;
      case `stalk`: {
        const s = Math.atan2(this.pos.z - n.z, this.pos.x - n.x) + this.orbit * 0.9;
        const c = 13 + Math.sin(this.stateT * 0.7) * 3;
        i.set(n.x + Math.cos(s) * c, n.y - 3 + Math.sin(this.stateT * 0.55) * 6.5, n.z + Math.sin(s) * c);
        a = 8.5;
        o = 1.5;
        this.giggleT -= e;
        if (this.giggleT <= 0 && r < 30) {
          this.giggleT = 7 + Math.random() * 7;
          this.hooks.cue(`giggle`, this.pos);
        }
        if (this.cool <= 0 && r < 24 && this.stagger <= 0 && t.ok) {
          const w = Math.random() * Math.PI * 2;
          this.windAt.set(n.x + Math.cos(w) * 8, n.y - 7.5, n.z + Math.sin(w) * 8);
          this.setState(`windup`);
          this.hooks.cue(`windup`, this.pos);
        }
        break;
      }
      case `windup`: {
        i.copy(this.windAt);
        const d = this.pos.distanceTo(this.windAt);
        if (d < 2.5 || this.stateT > 2.2) this.coiled = true;
        const s = this.coiled;
        a = s ? 2 : clamp(d * 1.8, 4, 14);
        o = s || d < 8 ? 3.5 : 2.2;
        if (s) {
          const lead = n.clone().addScaledVector(t.vel, 0.35);
          i.copy(lead);
          this.lungeDir.subVectors(lead, this.pos).normalize();
          this.findEmerge(this.pos, this.lungeDir, this.pos.distanceTo(lead) + 2);
          this.emergeK = Math.min(1, this.emergeK + e * 1.2);
          this.coilT += e;
        }
        if (this.coilT > 1.25 || this.stateT > 5) {
          this.lungeFrom.copy(this.pos);
          this.lungeDir.subVectors(n.clone().addScaledVector(t.vel, 0.25), this.pos).normalize();
          this.dir.copy(this.lungeDir);
          this.speed = Math.max(this.speed, 14);
          this.setState(`lunge`);
          this.hooks.cue(`lunge`, this.pos);
        }
        break;
      }
      case `lunge`:
        i.copy(this.pos).addScaledVector(this.lungeDir, 10);
        a = 27;
        o = 0.4;
        this.emergeK = Math.max(0, this.emergeK - e * 2);
        if (this.pos.distanceTo(this.lungeFrom) > 22 || this.stateT > 1.6) this.setState(`recover`);
        break;
      case `recover`: {
        const dive = this.stateT > 1.4;
        i.copy(this.pos)
          .addScaledVector(this.dir, 6)
          .add(new THREE.Vector3(0, dive ? -6 : 0.6, 0));
        if (!dive) i.lerp(n, 0.25);
        a = dive ? 9 : 6;
        o = dive ? 1.1 : 1.8;
        if (this.stateT > 2.4) {
          this.cool = 3.5 + Math.random() * 3;
          this.orbit = Math.random() < 0.5 ? -1 : 1;
          this.setState(`stalk`);
        }
        break;
      }
      case `leave`:
        i.copy(this.pos)
          .addScaledVector(this.dir, 10)
          .add(new THREE.Vector3(0, -14, 0));
        a = 15;
        o = 1.2;
        this.emergeK = 0;
        break;
      case `dying`:
        a = Math.max(0, this.speed - e * 18);
        i.copy(this.pos)
          .addScaledVector(this.dir, 5)
          .add(new THREE.Vector3(Math.sin(this.t * 13) * 3, Math.cos(this.t * 11) * 3, 0));
        o = 5;
    }
    if (this.stagger > 0 && this.state !== `dying`) {
      i.copy(this.pos)
        .addScaledVector(this.dir, -4)
        .add(new THREE.Vector3(0, -3, 0));
      a = 6;
      o = 3;
    }
    if (this.state !== `lunge` && this.state !== `dying`) {
      const side = tmpB.crossVectors(this.dir, UP);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      i.addScaledVector(side, Math.sin(this.t * 1.4) * 2.5).addScaledVector(UP, Math.sin(this.t * 0.9) * 1.2);
    }
    this.speed += (a - this.speed) * Math.min(1, e * (this.state === `lunge` ? 6 : 2));
    const s = i.sub(this.pos);
    if (s.lengthSq() > 1e-4) {
      s.normalize();
      const ang = this.dir.angleTo(s);
      const k = ang > 1e-4 ? Math.min(1, (o * e) / ang) : 1;
      tmpQ.setFromUnitVectors(this.dir, s);
      tmpQ.slerp(tmpQ.clone().identity(), 1 - k);
      this.dir.applyQuaternion(tmpQ).normalize();
    }
  }

  /** First rock-to-air crossing along dir within len (sample > 128 is rock); else 4 units ahead. */
  findEmerge(e: THREE.Vector3, t: THREE.Vector3, n: number): void {
    const r = this.world;
    let i = r.sample(e.x, e.y, e.z) > 128;
    for (let a = 0.5; a < n; a += 0.5) {
      const x = e.x + t.x * a;
      const y = e.y + t.y * a;
      const z = e.z + t.z * a;
      const c = r.sample(x, y, z) > 128;
      if (i && !c) {
        this.emerge.set(x, y, z);
        return;
      }
      i = c;
    }
    this.emerge.copy(e).addScaledVector(t, Math.min(n, 4));
  }

  update(e: number, t: readonly SimPlayer[]): void {
    if (!this.active) return;
    this.t += e;
    const n = this.choose(t);
    this.think(e, n);
    this.pos.addScaledVector(this.dir, this.speed * e);
    if (this.state === `lunge`)
      for (const p of t)
        if (
          p.ok &&
          !this.bitten.has(p.id) &&
          Math.hypot(p.pos.x - this.pos.x, p.pos.y + 0.9 - this.pos.y, p.pos.z - this.pos.z) < 2.0324999999999998
        ) {
          this.bitten.add(p.id);
          this.hooks.bite(p.id, this.bite, this.pos);
        }
    if (this.state === `leave` && this.stateT > 5) this.despawn();
    if (this.state === `dying`) {
      this.dieT += e;
      if (!this.burst && this.dieT >= 3.13) {
        this.burst = true;
        this.hooks.died(this.pos.clone(), [...this.hitters]);
      }
      if (this.dieT > 4.33) this.despawn();
    }
  }
}
