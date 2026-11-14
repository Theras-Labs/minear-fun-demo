// Port of play-inUT-NSi.js 40844-40848 (temps YS / XS, clamp ZS) and 40893-41554: the boss AI rC.
// Server-style simulation of one biome boss (the frost titan in this build): sleep -> wake when a player in the
// arena comes within wakeR -> fight -> home (no target for 9 s) -> sleep, or dying -> dead. HP scales with depth
// (power) and with the crew (1-4 fighters seen in the last 15 s). Phase 2 at half HP.
// Math.random calls are in the original order.
import * as THREE from 'three';
import type { SimPlayer } from '../../foes/foeManager';
import { cavernMetric, type Cavern } from '../../world/caverns';
import { surfaceHeight } from '../../world/generate';
import {
  AIM_LEAD,
  AIM_LEAD_SCALE,
  BOSS_DEFS,
  BOSS_MODES,
  BOSS_OF_BIOME,
  FIGHTER_MEMORY_S,
  LEAP_WINDOW,
  PERCH_HEIGHT,
  PERCH_WEIGHT,
  SPRINT_GAP,
  SPRINT_MUL,
  bossActIndex,
  bossLair,
  bossPower,
  round2,
  wrapAngle,
  type BossAct,
  type BossDef,
  type BossKind,
  type BossMode,
  type BossMove,
} from './defs';

const T_AIM = new THREE.Vector3(); // YS (40844)
const clamp = THREE.MathUtils.clamp; // ZS (40846)

/** What the boss needs of the world (ChunkManager fits). */
export interface BossWorld {
  groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null;
  sample(x: number, y: number, z: number): number;
}

/** The hooks rC calls; the monster host turns them into messages (45329-45365). */
export interface BossHooks {
  /** n = damage dealt, by = player id. */
  hurt(boss: Boss, n: number, by: string | undefined): void;
  woke(boss: Boss, by: string | undefined): void;
  /** aim = the boss aim, points = markers. */
  act(boss: Boss, act: BossAct, aim: THREE.Vector3, points: THREE.Vector3[]): void;
  died(boss: Boss, pos: THREE.Vector3, hitters: string[]): void;
  gone(boss: Boss): void;
}

/** info(): the full state, sent as {t:`boss`, b}. */
export interface BossInfo {
  id: number;
  kind: BossKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  /** BOSS_MODES index */
  mode: number;
  /** BOSS_ACTS index */
  act: number;
  t: number;
  phase: number;
  k: number;
  lair: [number, number, number];
}

/**
 * snap(): [id, x, y, z, yaw, hp, maxHp, mode, act, actT, phase]. Sent in {t:`bosses`, list}.
 */
export type BossSnap = number[];

export class Boss { // rC (40893)
  region: Cavern;
  world: BossWorld;
  hooks: BossHooks;
  id: number;
  def: BossDef;
  mode: BossMode = `sleep`;
  act: BossAct = `sleep`;
  actT = 0;
  actLen = 0;
  phase = 1;
  hp: number;
  maxHp: number;
  power: number;
  baseHp: number;
  seen: readonly SimPlayer[] = [];
  pos = new THREE.Vector3();
  yaw = 0;
  lair: THREE.Vector3;
  hitters = new Set<string>();
  fighters = new Map<string, number>();
  crew = 1;
  clock = 0;
  target: string | null = null;
  lonely = 0;
  idle = 0;
  gcd = 1.5;
  cd = new Map<BossAct, number>();
  aim = new THREE.Vector3();
  aimYaw = 0;
  from = new THREE.Vector3();
  travelled = 0;
  dieT = 0;

  constructor(e: Cavern, t: BossWorld, n: BossHooks) {
    this.region = e;
    this.world = t;
    this.hooks = n;
    this.id = e.key;
    const kind = BOSS_OF_BIOME[e.biome];
    if (!kind) throw new Error(`no boss in a ${e.biome} cavern`);
    this.def = BOSS_DEFS[kind];
    this.lair = bossLair(e).clone();
    this.pos.copy(this.lair);
    this.yaw = Math.atan2(e.cx - this.lair.x, e.cz - this.lair.z) + Math.PI;
    this.power = bossPower(surfaceHeight(this.lair.x, this.lair.z) - this.lair.y);
    this.baseHp = Math.round(this.def.hp * this.power ** 1.2);
    this.maxHp = this.hp = this.baseHp;
  }

  get kind(): BossKind {
    return this.def.kind;
  }

  inArena(e: SimPlayer): boolean {
    return cavernMetric(this.region, e.pos.x, e.pos.y + 1, e.pos.z) < 1.12;
  }

  info(): BossInfo {
    return {
      id: this.id,
      kind: this.def.kind,
      x: round2(this.pos.x),
      y: round2(this.pos.y),
      z: round2(this.pos.z),
      yaw: round2(this.yaw),
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      mode: BOSS_MODES.indexOf(this.mode),
      act: bossActIndex(this.act),
      t: round2(this.actT),
      phase: this.phase,
      k: round2(this.power),
      lair: [round2(this.lair.x), round2(this.lair.y), round2(this.lair.z)],
    };
  }

  snap(): BossSnap {
    return [
      this.id,
      round2(this.pos.x),
      round2(this.pos.y),
      round2(this.pos.z),
      round2(this.yaw),
      Math.round(this.hp),
      this.maxHp,
      BOSS_MODES.indexOf(this.mode),
      bossActIndex(this.act),
      round2(this.actT),
      this.phase,
    ];
  }

  /** A hit: e = damage, t = crit (weak spot), n = player id. */
  damage(e: number, t: boolean, n: string | undefined): void {
    if (this.mode === `dying` || this.mode === `dead`) return;
    if (this.mode === `sleep`) this.wake(n, this.seen);
    else if (this.mode === `home`) this.mode = `fight`;
    const i = t ? 1.3 : 1;
    const a = Math.max(1, Math.round(e * i));
    this.hp -= a;
    if (n) this.hitters.add(n);
    this.hooks.hurt(this, a, n);
    if (n) this.fighters.set(n, this.clock);
    if (this.hp <= 0) {
      this.hp = 0;
      const g = this.world.groundBelow(this.pos.x, this.pos.z, this.pos.y + 1, 24);
      if (g !== null) this.pos.y = g;
      this.mode = `dying`;
      this.begin(`die`, this.def.lens.die);
      this.dieT = 0;
    }
  }

  hpFor(e: number): number {
    return Math.round(this.baseHp * (1 + 0.6 * (Math.min(4, Math.max(1, e)) - 1)));
  }

  rescale(e: readonly SimPlayer[]): void {
    for (const p of e) if (p.ok && this.inArena(p)) this.fighters.set(p.id, this.clock);
    for (const [id, at] of this.fighters) if (this.clock - at > FIGHTER_MEMORY_S) this.fighters.delete(id);
    const t = Math.min(4, Math.max(1, this.fighters.size));
    if (t === this.crew) return;
    this.crew = t;
    const n = this.hpFor(t);
    this.hp = Math.max(1, (this.hp * n) / this.maxHp);
    this.maxHp = n;
  }

  wake(e: string | undefined, t: readonly SimPlayer[] = []): void {
    this.fighters.clear();
    for (const p of t) if (p.ok && this.inArena(p)) this.fighters.set(p.id, this.clock);
    if (e) this.fighters.set(e, this.clock);
    this.crew = Math.min(4, Math.max(1, this.fighters.size));
    this.maxHp = this.hpFor(this.crew);
    this.hp = this.maxHp;
    this.mode = `fight`;
    this.phase = 1;
    this.lonely = 0;
    this.gcd = 1.2;
    this.cd.clear();
    this.begin(`wake`, this.def.lens.wake);
    this.hooks.woke(this, e);
  }

  begin(e: BossAct, t: number, n?: THREE.Vector3, r: THREE.Vector3[] = []): void {
    this.act = e;
    this.actT = 0;
    this.actLen = t;
    this.from.copy(this.pos);
    this.travelled = 0;
    if (n) {
      this.aim.copy(n);
      this.aimYaw = Math.atan2(n.x - this.pos.x, n.z - this.pos.z);
    } else this.aim.copy(this.pos);
    this.hooks.act(this, e, this.aim, r);
  }

  update(e: number, t: readonly SimPlayer[]): void {
    this.seen = t;
    this.clock += e;
    for (const [k, v] of this.cd) this.cd.set(k, v - e);
    this.gcd -= e;
    switch (this.mode) {
      case `sleep`:
        this.hp = this.maxHp;
        for (const p of t)
          if (p.ok && this.inArena(p) && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.def.wakeR) {
            this.wake(p.id, t);
            break;
          }
        break;
      case `fight`:
        this.rescale(t);
        this.fight(e, t);
        break;
      case `home`:
        this.rescale(t);
        this.goHome(e, t);
        break;
      case `dying`:
        this.actT += e;
        this.dieT += e;
        if (this.dieT >= this.def.lens.die && this.mode === `dying`) {
          this.mode = `dead`;
          this.hooks.died(this, this.pos.clone(), [...this.hitters]);
        }
        break;
      case `dead`:
        this.actT += e;
        this.dieT += e;
    }
  }

  /** The nearest player in the arena (the current target counts at 0.7 of its distance). */
  choose(e: readonly SimPlayer[]): SimPlayer | null {
    let t: SimPlayer | null = null;
    let n = 1 / 0;
    for (const r of e) {
      if (!r.ok || !this.inArena(r)) continue;
      const d = Math.hypot(r.pos.x - this.pos.x, r.pos.z - this.pos.z) * (r.id === this.target ? 0.7 : 1);
      if (d < n) {
        n = d;
        t = r;
      }
    }
    this.target = t?.id ?? null;
    return t;
  }

  fight(e: number, t: readonly SimPlayer[]): void {
    const n = this.choose(t);
    this.lonely = n ? 0 : this.lonely + e;
    if (this.act !== `idle` && this.act !== `walk`) {
      this.actT += e;
      this.during(e, n);
      if (this.actT >= this.actLen) this.endAct();
      return;
    }
    this.actT += e;
    if (this.lonely > 9) {
      this.mode = `home`;
      this.setLoop(`walk`);
      return;
    }
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase2();
      return;
    }
    if (!n) {
      this.setLoop(`idle`);
      return;
    }
    const r = n.pos.x - this.pos.x;
    const i = n.pos.z - this.pos.z;
    const a = Math.hypot(r, i);
    const o = Math.abs(wrapAngle(Math.atan2(r, i) - this.yaw));
    if (this.gcd <= 0) {
      const m = this.pick(n, a, o);
      if (m) {
        this.start(m, n, t);
        return;
      }
    }
    this.turnTo(Math.atan2(r, i), e, 1);
    if (a > this.def.keep + this.def.radius && o < 1.2) {
      this.setLoop(`walk`);
      this.walk(e, this.def.speed * (a > this.def.keep + this.def.radius + SPRINT_GAP ? SPRINT_MUL : 1));
    } else this.setLoop(`idle`);
  }

  setLoop(e: BossAct): void {
    if (this.act !== e) {
      this.act = e;
      this.actT = 0;
    }
  }

  /** Weighted move pick: e = target, t = distance, n = angle off the facing. */
  pick(e: SimPlayer, t: number, n: number): BossMove | null {
    const i: BossMove[] = [];
    let a = 0;
    const s = this.world.groundBelow(e.pos.x, e.pos.z, e.pos.y + 0.5, 30);
    const c = s !== null && e.pos.y - s > PERCH_HEIGHT;
    for (const m of this.def.moves) {
      if (
        (this.cd.get(m.act) ?? 0) > 0 ||
        (t < m.min && !(c && m.act === `throw`)) ||
        t > m.max + this.def.radius ||
        (m.cone > 0 && n > m.cone) ||
        (m.act === `nova` && t > m.max)
      )
        continue;
      i.push(m);
    }
    if (!i.length) return null;
    const l = (m: BossMove): number => m.w * (c ? (PERCH_WEIGHT[m.act] ?? 1) : 1);
    for (const m of i) a += l(m);
    let u = Math.random() * a;
    for (const m of i) if ((u -= l(m)) <= 0) return m;
    return i[i.length - 1];
  }

  /** Starts move e on target t: cooldowns, the led aim and the ground markers. */
  start(e: BossMove, t: SimPlayer, n: readonly SimPlayer[]): void {
    this.cd.set(e.act, e.cd * (this.phase === 2 ? 0.72 : 1) * (0.85 + Math.random() * 0.3));
    this.gcd = (this.phase === 2 ? 0.45 : 0.8) + Math.random() * 0.5;
    const r = T_AIM.set(t.pos.x, t.pos.y, t.pos.z);
    const i: THREE.Vector3[] = [];
    const a = (e.act === `leap` ? (LEAP_WINDOW[this.def.kind]?.[1] ?? 0.8) : (AIM_LEAD[e.act] ?? 0.25)) * AIM_LEAD_SCALE;
    const o = clamp(t.vel.x, -9, 9) * a;
    const s = clamp(t.vel.z, -9, 9) * a;
    const c = Math.hypot(o, s);
    const l = c > 7 ? 7 / c : 1;
    r.x += o * l;
    r.z += s * l;
    if (e.act === `throw`) r.y += clamp(t.vel.y, -6, 6) * a * 0.5;
    const u = n.filter((p) => p.ok && this.inArena(p));
    switch (e.act) {
      case `slam`:
        if (this.phase === 2)
          for (const sgn of [-1, 1]) {
            const ang = Math.atan2(r.x - this.pos.x, r.z - this.pos.z) + sgn * 0.42;
            i.push(new THREE.Vector3(this.pos.x + Math.sin(ang) * 16, r.y, this.pos.z + Math.cos(ang) * 16));
          }
        break;
      case `leap`: {
        const dx = r.x - this.pos.x;
        const dz = r.z - this.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const go = Math.max(0, len - this.def.radius * 0.8);
        let x = this.pos.x + (dx / len) * go;
        let z = this.pos.z + (dz / len) * go;
        if (cavernMetric(this.region, x, this.pos.y + 3, z) > 0.85) {
          x = this.pos.x + (x - this.pos.x) * 0.5;
          z = this.pos.z + (z - this.pos.z) * 0.5;
        }
        const y = this.world.groundBelow(x, z, r.y + 6, 16) ?? r.y;
        i.push(new THREE.Vector3(x, y, z));
        break;
      }
    }
    this.begin(e.act, e.len, r, i);
    if (e.act === `leap` && i.length) this.aim.copy(i[0]);
  }

  /** Motion during an action: e = dt, t = target, n = players. */
  during(e: number, t: SimPlayer | null): void {
    const r = this.actT;
    switch (this.act) {
      case `nova`:
        if (r < 0.6 && t) this.turnTo(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), e, 1.5);
        break;
      case `slam`:
        if (r < 0.7) this.turnTo(this.aimYaw, e, 2.6);
        break;
      case `punch`:
      case `throw`:
        if (r < 0.4 && t) this.turnTo(Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), e, 3.4);
        break;
      case `leap`: {
        const [a, b] = LEAP_WINDOW[this.def.kind] ?? [0.3, 1];
        if (r < a) this.turnTo(this.aimYaw, e, 3);
        else if (r <= b + e) {
          const k = clamp((r - a) / (b - a), 0, 1);
          this.pos.lerpVectors(this.from, this.aim, k);
          this.pos.y += Math.sin(k * Math.PI) * 7;
        }
        break;
      }
    }
  }

  /** The end of an action. */
  endAct(): void {
    if (this.act === `die`) return;
    this.act = `idle`;
    this.actT = 0;
  }

  /** Phase 2 at half HP: the boss roars. */
  phase2(): void {
    this.phase = 2;
    this.begin(`roar`, this.def.lens.roar);
  }

  /** Turns toward yaw e at turn x n rad/s. */
  turnTo(e: number, t: number, n: number): void {
    const r = wrapAngle(e - this.yaw);
    const i = this.def.turn * n * t;
    this.yaw = wrapAngle(this.yaw + clamp(r, -i, i));
  }

  /** Walks at speed t; n = straight only (else 7 probe angles). */
  walk(e: number, t: number, n = false): void {
    if (t <= 0) return;
    const r = t * e;
    const i = n ? [0] : [0, 0.5, -0.5, 1, -1, 1.5, -1.5];
    for (const off of i) {
      const ang = this.yaw + off;
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      if (!this.free(this.pos.x + s * (this.def.radius + 1), this.pos.z + c * (this.def.radius + 1))) continue;
      const x = this.pos.x + s * r;
      const z = this.pos.z + c * r;
      const g = this.world.groundBelow(x, z, this.pos.y + 4, 9);
      if (!(g === null || Math.abs(g - this.pos.y) > 3)) {
        this.pos.set(x, this.pos.y + (g - this.pos.y) * Math.min(1, e * 10), z);
        if (off !== 0) this.turnTo(ang, e, 1.5);
        return;
      }
    }
  }

  /** Is (e, t) open: inside the cavern and air at body height. */
  free(e: number, t: number): boolean {
    const n = this.pos.y;
    return cavernMetric(this.region, e, n + 2, t) > 0.9
      ? false
      : this.world.sample(e, n + 1.6, t) <= 128 && this.world.sample(e, n + this.def.height * 0.6, t) <= 128;
  }

  /** Walks back to the lair healing 2 % a second; sleeps there. */
  goHome(e: number, t: readonly SimPlayer[]): void {
    if (this.choose(t)) {
      this.mode = `fight`;
      this.lonely = 0;
      return;
    }
    const n = this.lair.x - this.pos.x;
    const r = this.lair.z - this.pos.z;
    if (Math.hypot(n, r) < 2 || this.def.speed <= 0) {
      this.mode = `sleep`;
      this.hp = this.maxHp;
      this.phase = 1;
      this.hitters.clear();
      this.fighters.clear();
      this.begin(`sleep`, 0);
      return;
    }
    this.turnTo(Math.atan2(n, r), e, 1);
    this.setLoop(`walk`);
    this.walk(e, this.def.speed);
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.02 * e);
  }
}
