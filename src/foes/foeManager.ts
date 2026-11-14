// Port of play-inUT-NSi.js 43741-43744 (scratch vectors Xw / Zw / Qw) and 43837-44850: the foe manager and
// AI rT. It spawns and runs every regular foe: a time-budgeted scan of chunks around players for dormant
// camp spots in undug cave floor (they wake when a player passes within 16 m), six golem spots around the
// town, an ambush heat per deep player, and a per-foe state machine (rise, hunt, attack, hurt, idle, dead,
// hurl, mend, dig) with A* steering, ranged kiting, melee lunges, projectile lead, golem rock hurl and heal,
// burrowers that tunnel to unreachable players and ghost wraiths that fly without collision.
// It is the server-side simulation: it talks to the outside only through its hooks (see FoeManagerHooks).
import * as THREE from 'three';
import { LIFT_POINT, summonCooldown } from '../world/constants';
import { seededRandom, hash3 } from '../world/rng';
import { surfaceHeight } from '../world/generate';
import { cavernAtWorld, cavernMetric, liquidAt } from '../world/caverns';
import { chunkKey } from '../world/chunk';
import {
  AMBUSH_DEPTH,
  AMBUSH_LINE,
  biomeAt,
  CHAMPION_DMG,
  CHAMPION_HP,
  CREW_R,
  FOE_DIGGING,
  FOE_SHOTS,
  FOE_TYPES,
  FOES_BIOME_ONLY,
  GOLEM_AGGRO_R,
  GOLEM_LEASH_R,
  GOLEM_SPOT_COUNT,
  GOLEM_TOWN_KEEP,
  GOLEM_WAKE_R,
  HOME_CALM_S,
  LOSE_TRACK_S,
  MAX_ACTIVE_NEAR,
  SIGHT_CHECK_S,
  SPOT_RESPAWN,
  SPOT_WAKE_R,
  STALL_GIVE_UP_S,
  TOWN_NO_SPAWN_R,
  type FoeKind,
  type FoeShotKind,
} from './types';
import { clamp, Foe, round2, wrapAngle, type FoeSpot } from './foe';
import { bossLair } from './lair';
import {
  boulderPushOut,
  findPath,
  groundCell,
  hoverFits,
  inTownZone,
  inTunnel,
  navKey,
  setWadeLava,
  stepCell,
  type FoeWorld,
} from './nav';

const W = LIFT_POINT; // W (28758)
const Xw = new THREE.Vector3(); // Xw (43741)
const Zw = new THREE.Vector3(); // Zw (43742)
const Qw = new THREE.Vector3(); // Qw (43743)

interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** The player record the simulation reads ({id, pos, vel, ok, ko, digging, burrowing, fortune}; KR.simPlayer 72369). */
export interface SimPlayer {
  id: string;
  pos: XYZ;
  vel: XYZ;
  /** Targetable (started, not knocked out, not on the lift, not in the haven, not hidden in smoke). */
  ok: boolean;
  ko: boolean;
  digging: boolean;
  burrowing: boolean;
  fortune?: number;
}

/** A burrower dig request {x, y, z, r, a, p} (the same shape as a player dig message). */
export interface FoeDig {
  x: number;
  y: number;
  z: number;
  r: number;
  a: number;
  p: number;
}

/** rT hooks (the monster host ET turns them into per-player messages). */
export interface FoeManagerHooks {
  rose(foe: Foe): void;
  windup(foe: Foe): void;
  melee(foe: Foe, targetId: string, dmg: number): void;
  shoot(foe: Foe, targetId: string, from: THREE.Vector3, vel: THREE.Vector3, kind: FoeShotKind, dmg: number): void;
  hurt(foe: Foe, staggered: boolean, by: string | undefined): void;
  died(foe: Foe): void;
  removed(foe: Foe): void;
  ambush(playerId: string, pos: THREE.Vector3): void;
  dig(d: FoeDig): void;
  /** True while the player is in a boss fight (no ambushes then). */
  calm?(player: SimPlayer): boolean;
}

interface AmbushHeat {
  heat: number;
  line: number;
  calm: number;
}

export interface SummonOverride {
  hp?: number;
  dmg?: number;
  speed?: number;
}

export class FoeManager { // rT (43837)
  world: FoeWorld;
  hooks: FoeManagerHooks;
  foes: Foe[] = [];
  quiet = false;
  spots = new Map<number, FoeSpot[]>();
  spent = new Map<number, number>();
  time = 0;
  scanT = 0;
  pruneT = 0;
  navBudget = 1;
  nextId = 1;
  golemSpots: FoeSpot[] = [];
  ambushHeat = new Map<string, AmbushHeat>();
  constructor(e: FoeWorld, t: FoeManagerHooks) {
    this.world = e;
    this.hooks = t;
    const n = seededRandom(hash3(7, 11, 13, 4242));
    for (let k = 0; k < GOLEM_SPOT_COUNT; k++) {
      const a = (k / GOLEM_SPOT_COUNT) * Math.PI * 2 + n() * 0.8;
      const r = 48 + n() * 46;
      const x = W.x + Math.cos(a) * r;
      const z = W.z + Math.sin(a) * r;
      this.golemSpots.push({
        key: k + 1,
        pos: new THREE.Vector3(x, surfaceHeight(x, z), z),
        kind: `golem`,
        state: `dormant`,
        depth: 0,
      });
    }
  }
  get active(): number {
    let e = 0;
    for (const t of this.foes) if (t.state !== `dead`) e++;
    return e;
  }
  byId(e: number): Foe | null {
    return this.foes.find((t) => t.id === e) ?? null;
  }
  /** A boulder was placed at e with radius t: push foes caught inside it out. */
  boulder(e: XYZ, t: number): void {
    for (const n of this.foes) {
      if (n.state === `dead`) continue;
      const r = boulderPushOut(this.world, n.pos, e, t, 1.7, FOE_TYPES[n.kind].radius);
      if (r) {
        n.pos.set(r.x, r.y, r.z);
        n.vel.set(0, 0, 0);
        n.path = null;
        n.pathT = 0;
      }
    }
  }
  clear(): void {
    for (const e of [...this.foes]) this.remove(e);
  }
  /** At most one dormant spot of a chunk (seeded by the chunk coordinate). */
  scanChunk(e: number, t: number, n: number): FoeSpot[] {
    const r = e * 16 + 8;
    const i = n * 16 + 8;
    if (Math.hypot(r - W.x, i - W.z) < TOWN_NO_SPAWN_R) return [];
    const a = surfaceHeight(r, i);
    const o = a - (t * 16 + 8);
    if (o < 10) return [];
    const s = seededRandom(hash3(e, t, n, 9001));
    const c = { x: e * 16 + 8, y: t * 16 + 8, z: n * 16 + 8 };
    // MINEAR: biome caverns only. A cavern (beast caverns too) stays more than 12 m inside its 240 x 150 x 240 m
    // cell, more than a chunk's half width, so a chunk whose centre cell has no cavern has no cavern floor.
    if (FOES_BIOME_ONLY && !cavernAtWorld(c.x, c.y, c.z)) return [];
    const l = clamp(0.1 + o * 0.0028, 0, 0.4) * (biomeAt(c) ? 1.5 : 1);
    if (s() > l) return [];
    const u = this.world;
    const d: number[] = [];
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const x = e * 16 + lx;
        const z = n * 16 + lz;
        let below = u.solid(x, t * 16 - 1, z);
        let here = u.solid(x, t * 16, z);
        for (let ly = 0; ly < 16; ly++) {
          const y = t * 16 + ly;
          const above = u.solid(x, y + 1, z);
          if (
            below &&
            !here &&
            !above &&
            !u.dug(x, y - 1, z) &&
            !u.dug(x, y, z) &&
            (!FOES_BIOME_ONLY || biomeAt({ x, y, z }))
          )
            d.push(lx + 16 * (ly + 16 * lz));
          below = here;
          here = above;
        }
      }
    for (let k = 0; k < 6 && d.length; k++) {
      const cell = d[Math.floor(s() * d.length)];
      const x = e * 16 + (cell % 16);
      const y = t * 16 + (Math.floor(cell / 16) % 16);
      const z = n * 16 + Math.floor(cell / 256);
      const g = u.groundBelow(x, z, y + 0.5, 2);
      if (g === null) continue;
      const f = new THREE.Vector3(x, g, z);
      if (!this.standableSpot(f) || liquidAt(f.x, f.y + 0.1, f.z)?.liquid === `lava`) continue;
      if (FOES_BIOME_ONLY && !biomeAt(f)) continue; // the ground can sit just past the cavern edge
      const p = cavernAtWorld(f.x, f.y, f.z);
      if (p?.beast && cavernMetric(p, f.x, f.y + 1, f.z) < 1.1) {
        const lair = bossLair(p);
        if (Math.hypot(f.x - lair.x, f.z - lair.z) < 28) continue;
      }
      return [
        {
          key: chunkKey(e, t, n),
          pos: f,
          kind: this.pickKind(a - f.y, s(), biomeAt(f)),
          state: `dormant`,
          depth: a - f.y,
        },
      ];
    }
    return [];
  }
  /** Open above (density <= 108 at +1.1 and +2.1) and at least 3 of 4 neighbours at the same height. */
  standableSpot(e: XYZ): boolean {
    const t = this.world;
    if (t.sample(e.x, e.y + 1.1, e.z) > 108 || t.sample(e.x, e.y + 2.1, e.z) > 108) return false;
    let n = 0;
    for (const [r, i] of [
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
      [0, -1.5],
    ]) {
      const a = t.groundBelow(e.x + r, e.z + i, e.y + 1.2, 2.5);
      if (a !== null && Math.abs(a - e.y) < 1) n++;
    }
    return n >= 3;
  }
  /** Weighted kind pick for a depth; inside a biome cavern 66% of rolls pick that biome's own kinds. */
  pickKind(e: number, t: number, n: string | null = null): FoeKind {
    const r = !!n && t < 0.66;
    if (r) t /= 0.66;
    else if (n) t = (t - 0.66) / 0.34;
    const i = (Object.keys(FOE_TYPES) as FoeKind[]).filter(
      (k) =>
        e >= FOE_TYPES[k].minDepth && FOE_TYPES[k].weight > 0 && (r ? FOE_TYPES[k].biome === n : !FOE_TYPES[k].biome),
    );
    let a = 0;
    for (const k of i) a += FOE_TYPES[k].weight;
    let o = t * a;
    for (const k of i) {
      o -= FOE_TYPES[k].weight;
      if (o <= 0) return k;
    }
    return i[0] ?? `miner`;
  }
  /** Scans the 3x3x3 chunks around each player for spots, stopping after 4 ms. */
  scan(e: SimPlayer[]): void {
    const t = performance.now();
    for (const p of e) {
      if (!p.ok) continue;
      const cx = Math.floor(p.pos.x / 16);
      const cy = Math.floor(p.pos.y / 16);
      const cz = Math.floor(p.pos.z / 16);
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const s = chunkKey(cx + dx, cy + dy, cz + dz);
            if (!this.spots.has(s)) {
              if (performance.now() - t > 4) return;
              this.spots.set(s, this.scanChunk(cx + dx, cy + dy, cz + dz));
            }
          }
    }
  }
  /** Ambush heat for deep players; at the heat line a pack of 3-5 claws out of the rock around them. */
  ambushes(e: SimPlayer[], t: number): void {
    for (const n of e) {
      let r = this.ambushHeat.get(n.id);
      if (!r) this.ambushHeat.set(n.id, (r = { heat: 0, line: AMBUSH_LINE * (0.8 + Math.random() * 0.5), calm: 0 }));
      if (this.activeNear(n.pos) === 0) r.calm += t;
      const i = surfaceHeight(n.pos.x, n.pos.z) - n.pos.y;
      const a = Math.max(0, n.fortune ?? 0);
      if (!n.ok || this.hooks.calm?.(n) || i < Math.max(30, AMBUSH_DEPTH - a * 0.3)) {
        r.heat = Math.max(0, r.heat - t);
        continue;
      }
      r.heat +=
        t *
        (1 + Math.min(1.5, Math.max(0, i - AMBUSH_DEPTH) / 300)) *
        (n.digging ? 1.3 : 1) *
        (1 + a / 150);
      if (r.heat < r.line || r.calm < summonCooldown(this.crew(n, e)) || this.activeNear(n.pos) > 5) continue;
      const o: THREE.Vector3[] = [];
      for (let k = 0; k < 28 && o.length < 5; k++) {
        const ang = Math.random() * Math.PI * 2;
        const d = 5 + Math.random() * 4;
        const x = n.pos.x + Math.cos(ang) * d;
        const z = n.pos.z + Math.sin(ang) * d;
        const g = this.world.groundBelow(x, z, n.pos.y + 2.5, 5);
        if (g === null || Math.abs(g - n.pos.y) > 2.5) continue;
        const s = new THREE.Vector3(x, g, z);
        if (!this.standableSpot(s) || o.some((q) => q.distanceTo(s) < 1.6)) continue;
        if (FOES_BIOME_ONLY && !biomeAt(s)) continue; // MINEAR: ambushes come only inside a biome cavern
        // MINEAR: an ambusher claws out of natural cave floor in sight of the player, never inside a dug tunnel
        // and never behind rock (so a player deep in their own tunnel gets no ambush)
        if (inTunnel(this.world, Math.round(x), Math.floor(g) + 1, Math.round(z))) continue;
        if (!this.sightLine({ x, y: g + 1.2, z }, { x: n.pos.x, y: n.pos.y + 0.95, z: n.pos.z })) continue;
        o.push(s);
      }
      if (o.length < 3) {
        r.heat = r.line * 0.85;
        continue;
      }
      r.heat = 0;
      r.line = AMBUSH_LINE * (0.8 + Math.random() * 0.5);
      r.calm = 0;
      const s = Math.min(o.length, i > 400 || a >= 500 ? 5 : 4);
      for (let k = 0; k < s; k++)
        this.wake(
          {
            key: -1,
            pos: o[k],
            kind: this.pickKind(i, Math.random(), biomeAt(o[k])),
            state: `dormant`,
            depth: i,
          },
          n,
          false,
          k === 0 && (i > 250 || a >= 300),
        );
      this.hooks.ambush(n.id, new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z));
      return;
    }
  }
  /** Dev: the next ambush check fires for this player. */
  ambushSoon(e: string): void {
    this.ambushHeat.set(e, { heat: 1e6, line: 1, calm: 1e6 });
  }
  forget(e: string): void {
    this.ambushHeat.delete(e);
  }
  wakeGolems(e: SimPlayer[]): void {
    for (const t of this.golemSpots) {
      if (t.state !== `dormant` || (this.spent.get(t.key) ?? 0) > this.time) continue;
      const n = e.find(
        (p) => Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < GOLEM_WAKE_R && Math.abs(p.pos.y - t.pos.y) <= 90,
      );
      if (!n) continue;
      const r = (t.home ??= t.pos.clone());
      let i: THREE.Vector3 | null = null;
      for (let k = 0; k < 12 && !i; k++) {
        const ang = k * 2.4;
        const d = k ? 3 + k * 1.2 : 0;
        const x = r.x + Math.cos(ang) * d;
        const z = r.z + Math.sin(ang) * d;
        const s = surfaceHeight(x, z);
        const c = this.world.groundBelow(x, z, s + 4, 8);
        if (c !== null && s - c < 2.5) i = new THREE.Vector3(x, c, z);
      }
      if (i) {
        t.pos.copy(i);
        this.wake(t, n, false);
      }
    }
  }
  wakeNear(e: SimPlayer[]): void {
    for (const t of this.spots.values())
      for (const n of t)
        if (!(n.state !== `dormant` || (this.spent.get(n.key) ?? 0) > this.time)) {
          for (const p of e) {
            if (
              !p.ok ||
              Math.hypot(n.pos.x - p.pos.x, n.pos.z - p.pos.z) >= SPOT_WAKE_R ||
              Math.abs(n.pos.y - p.pos.y) >= 7
            )
              continue;
            // MINEAR: a camp wakes only when it can see the player, not through rock
            if (!this.sightLine({ x: n.pos.x, y: n.pos.y + 1.2, z: n.pos.z }, { x: p.pos.x, y: p.pos.y + 0.95, z: p.pos.z }))
              continue;
            if (this.activeNear(p.pos) < MAX_ACTIVE_NEAR) this.wake(n, p);
            break;
          }
        }
  }
  /** Drops scanned chunks far from every player (128 horizontal, 96 vertical) and expired spent marks. */
  prune(e: SimPlayer[]): void {
    for (const [t, n] of this.spots) {
      if (n.some((s) => s.state === `up`)) continue;
      const r = (t % 8192) - 4096;
      const i = Math.floor(t / 8192);
      const a = (i % 65536) - 32768;
      const o = (Math.floor(i / 65536) - 32768) * 16 + 8;
      const s = r * 16 + 8;
      const c = a * 16 + 8;
      if (
        !e.some(
          (p) => Math.abs(p.pos.x - o) < 128 && Math.abs(p.pos.z - c) < 128 && Math.abs(p.pos.y - s) < 96,
        )
      )
        this.spots.delete(t);
    }
    for (const [k, t] of this.spent) if (t <= this.time) this.spent.delete(k);
  }
  /** Players (ok) within 48 m horizontally of e, at least 1. */
  crew(e: SimPlayer, t: SimPlayer[]): number {
    let n = 0;
    for (const r of t) if (r.ok && Math.hypot(r.pos.x - e.pos.x, r.pos.z - e.pos.z) < CREW_R) n++;
    return Math.max(1, n);
  }
  activeNear(e: XYZ): number {
    let t = 0;
    for (const n of this.foes) if (n.state !== `dead` && Math.hypot(n.pos.x - e.x, n.pos.z - e.z) < CREW_R) t++;
    return t;
  }
  /** Spawns one foe of a kind at a point (boss adds, dev). Returns it. */
  summon(e: FoeKind, t: THREE.Vector3, n: SimPlayer, r?: SummonOverride): Foe | null {
    const i = surfaceHeight(t.x, t.z) - t.y;
    this.wake({ key: -1, pos: t.clone(), kind: e, state: `dormant`, depth: i }, n, false);
    const a = this.foes[this.foes.length - 1] ?? null;
    if (a && r) {
      if (r.hp) a.maxHp = a.hp = Math.round(r.hp);
      if (r.dmg !== void 0) a.dmg = Math.round(r.dmg);
      if (r.speed) a.def = { ...a.def, speed: r.speed };
    }
    return a;
  }
  /** Raises the foe of a spot facing the player; a camp spot may bring 1-2 extra members. */
  wake(e: FoeSpot, t: SimPlayer, n = true, r = false): void {
    const i = FOE_TYPES[e.kind];
    const a = 1 + Math.max(0, e.depth - i.minDepth) / 55;
    const o = new Foe(this.nextId++, e.kind, i, e, a);
    if (r) {
      o.champion = true;
      o.maxHp = o.hp = Math.round(o.hp * CHAMPION_HP);
      o.dmg = Math.round(o.dmg * CHAMPION_DMG);
    }
    o.pos.copy(e.pos);
    o.yaw = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    o.target = t.id;
    e.state = `up`;
    this.foes.push(o);
    this.hooks.rose(o);
    if (!n || e.key < 0) return;
    let s =
      +(Math.random() < clamp((e.depth - 25) / 90, 0, 0.8)) + +(Math.random() < clamp((e.depth - 70) / 160, 0, 0.6));
    for (let k = 0; s > 0 && k < 10 && this.activeNear(t.pos) < MAX_ACTIVE_NEAR; k++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 1.8 + Math.random() * 1.6;
      const x = e.pos.x + Math.cos(ang) * d;
      const z = e.pos.z + Math.sin(ang) * d;
      const g = this.world.groundBelow(x, z, e.pos.y + 1.2, 2.5);
      if (g === null || Math.abs(g - e.pos.y) > 1 || !this.standableSpot(new THREE.Vector3(x, g, z))) continue;
      this.wake(
        {
          key: -1,
          pos: new THREE.Vector3(x, g, z),
          kind: this.pickKind(e.depth, Math.random(), biomeAt(e.pos)),
          state: `dormant`,
          depth: e.depth,
        },
        t,
        false,
      );
      s--;
    }
  }
  remove(e: Foe): void {
    const t = this.foes.indexOf(e);
    if (t < 0) return;
    this.foes.splice(t, 1);
    e.gone = true;
    if (e.spot.state === `up`) e.spot.state = `dormant`;
    this.hooks.removed(e);
  }
  /**
   * Damage from a player: dmg, knock direction (kx, kz), knock strength, attacker id, slow (chill).
   * Returns true when it killed the foe.
   */
  damage(e: Foe, t: number, n: number, r: number, i: number, a?: string, o = 0): boolean {
    if (e.state === `dead`) return false;
    if (o > 0) {
      e.slowK = Math.max(e.slowT > 0 ? e.slowK : 0, Math.min(0.6, o));
      e.slowT = 1.6;
    }
    if (e.state === `rise` && e.t < 1.9 * 0.35) t *= 0.3;
    e.hp -= t;
    e.sinceHit = 0;
    if (a) e.hitters.add(a);
    const s = e.def.surface ? 5 : e.kind === `guard` ? 2 : 1;
    const c = i / s;
    e.vel.x += n * c;
    e.vel.z += r * c;
    if (i / s > 5 && e.grounded) e.vel.y = Math.min(6, i * 0.45);
    if (e.hp <= 0) {
      e.hp = 0;
      e.state = `dead`;
      e.t = 0;
      if (e.spot.key >= 0) this.spent.set(e.spot.key, this.time + SPOT_RESPAWN);
      this.hooks.died(e);
      return true;
    }
    let l = false;
    if (
      e.state !== `rise` &&
      !e.def.surface &&
      (i >= 4 || (e.state === `attack` && !e.fired && e.kind !== `guard` && i >= 1))
    ) {
      e.state = `hurt`;
      e.t = 0;
      e.stagger = 0.42;
      l = true;
    }
    this.hooks.hurt(e, l, a);
    return false;
  }
  /** One simulation step for all foes against the players. */
  update(e: number, t: SimPlayer[]): void {
    this.time += e;
    this.scanT -= e;
    if (this.scanT <= 0) {
      this.scanT = 0.4;
      if (!this.quiet) {
        this.scan(t);
        this.wakeNear(t);
        this.wakeGolems(t);
        this.ambushes(t, 0.4);
      }
    }
    this.pruneT -= e;
    if (this.pruneT <= 0) {
      this.pruneT = 5;
      this.prune(t);
    }
    this.navBudget = Math.max(1, Math.round(e * 60));
    for (let k = this.foes.length - 1; k >= 0; k--) {
      const r = this.foes[k];
      r.t += e;
      r.sinceHit += e;
      r.cd -= r.slowT > 0 ? e * (1 - r.slowK * 0.5) : e;
      if (r.burrowed) r.burrowT += e;
      else if (r.digRest > 0) r.digRest -= e;
      r.hurlCd -= e;
      r.mendCd -= e;
      r.slowT -= e;
      const i = this.pick(r, t);
      if (!i || (r.state !== `dead` && !i.near)) {
        this.remove(r);
        continue;
      }
      const retarget = r.target !== i.p.id;
      r.target = i.p.id;
      // MINEAR: line of sight to the target, 4 checks a second. A foe hunts only what it saw in the last
      // LOSE_TRACK_S seconds (no tracking through rock, smoke or a knocked-out player).
      r.seeCd -= e;
      r.homeT -= e;
      if (r.seeCd <= 0 || retarget) {
        r.seeCd = SIGHT_CHECK_S;
        r.seen = i.p.ok && this.clearShot(r, i.p.pos);
      }
      r.lostT = r.seen ? 0 : r.lostT + e;
      if (r.def.ghost) this.haunt(r, e, i.p, i.dist);
      else {
        setWadeLava(!!r.def.wades);
        this.think(r, e, i.p, i.dist);
        this.physics(r, e);
        setWadeLava(false);
      }
      if (r.state === `dead` && r.t > 2.2) {
        r.pos.y -= e * 0.9;
        if (r.t > 3.6) this.remove(r);
      }
    }
    // separation between foes, and foes pushed out of players
    for (let a = 0; a < this.foes.length; a++) {
      const n = this.foes[a];
      if (n.state === `dead`) continue;
      for (let b = a + 1; b < this.foes.length; b++) {
        const o = this.foes[b];
        if (o.state === `dead`) continue;
        Xw.set(o.pos.x - n.pos.x, 0, o.pos.z - n.pos.z);
        const r = Xw.length();
        const i = n.def.radius + o.def.radius;
        if (r < i && r > 1e-4 && Math.abs(n.pos.y - o.pos.y) < 1.5) {
          Xw.multiplyScalar(((i - r) / r) * 0.5);
          this.nudge(n, -Xw.x, -Xw.z);
          this.nudge(o, Xw.x, Xw.z);
        }
      }
      for (const p of t) {
        if (p.ko) continue;
        Xw.set(n.pos.x - p.pos.x, 0, n.pos.z - p.pos.z);
        const d = Xw.length();
        const r = n.def.radius + 0.65;
        if (d < r && d > 1e-4 && Math.abs(n.pos.y - p.pos.y) < 1.5) {
          Xw.multiplyScalar((r - d) / d);
          this.nudge(n, Xw.x, Xw.z);
        }
      }
    }
  }
  /** Idle wander around home (golems out of a fight). */
  roam(e: Foe, t: number): void {
    const n = e.spot.home ?? e.spot.pos;
    if (this.mend(e)) return;
    e.state = `idle`;
    if (!e.wander || e.t > 11) {
      const ang = Math.random() * Math.PI * 2;
      const d = Math.random() * 12;
      e.wander = new THREE.Vector3(n.x + Math.cos(ang) * d, n.y, n.z + Math.sin(ang) * d);
      e.t = 0;
    }
    const r = e.wander.x - e.pos.x;
    const i = e.wander.z - e.pos.z;
    const a = Math.hypot(r, i);
    if (a < 1.2 || e.t > 9) {
      e.loop = `idle`;
      return;
    }
    const o = Math.hypot(e.pos.x - n.x, e.pos.z - n.z) > 18;
    const s = e.def.speed * (o ? 0.42 : 0.26);
    e.yaw += wrapAngle(Math.atan2(r, i) - e.yaw) * Math.min(1, t * 2.5);
    if (this.walk(e, r / a, i / a, s * t)) {
      e.loop = `walk`;
      e.rate = clamp(s / 3.2, 0.55, 1);
    } else {
      e.loop = `idle`;
      e.wander = null;
    }
  }
  /** Target choice: nearest by dist + |dy| * 0.5 (current target x0.75, not-ok +1000); near = inside the leash. */
  pick(e: Foe, t: SimPlayer[]): { p: SimPlayer; dist: number; near: boolean } | null {
    let n: SimPlayer | null = null;
    let r = 1 / 0;
    let i = 1 / 0;
    let a = false;
    const o = e.def.surface ? 150 : CREW_R;
    const s = e.def.surface ? 90 : 30;
    for (const c of t) {
      const d = Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
      if (d <= o && Math.abs(c.pos.y - e.pos.y) <= s) a = true;
      const l = (d + Math.abs(c.pos.y - e.pos.y) * 0.5) * (c.id === e.target ? 0.75 : 1) + (c.ok ? 0 : 1e3);
      if (l < r) {
        r = l;
        i = d;
        n = c;
      }
    }
    return n ? { p: n, dist: i, near: a } : null;
  }
  /** The state machine of a walking foe (target n at horizontal distance r). */
  think(e: Foe, t: number, n: SimPlayer, r: number): void {
    const i = e.def;
    const a = (x: number, z: number, rate: number) => {
      const ang = Math.atan2(x - e.pos.x, z - e.pos.z);
      e.yaw += wrapAngle(ang - e.yaw) * Math.min(1, t * rate);
    };
    if (i.surface && (e.state === `hunt` || e.state === `idle`)) {
      const home = e.spot.home ?? e.spot.pos;
      const onTop = surfaceHeight(n.pos.x, n.pos.z) - n.pos.y < 3.5 && n.pos.y < W.y - 12;
      const inRange =
        Math.hypot(n.pos.x - home.x, n.pos.z - home.z) < GOLEM_LEASH_R &&
        Math.hypot(n.pos.x - W.x, n.pos.z - W.z) > GOLEM_TOWN_KEEP;
      if (
        !(
          n.ok &&
          onTop &&
          inRange &&
          (e.state === `hunt` ? r < GOLEM_AGGRO_R * 1.6 : r < GOLEM_AGGRO_R) &&
          this.clearShot(e, n.pos)
        )
      ) {
        this.roam(e, t);
        return;
      }
      if (e.state === `idle`) {
        e.state = `hunt`;
        e.t = 0;
        e.loop = `walk`;
        e.wander = null;
      }
    }
    // MINEAR: a cave foe that lost sight of its target (or gave up) wanders back home; it hunts again only
    // when it sees the target. Out of sight and out of the open cave means out of mind.
    if (!i.surface && n.ok && (e.state === `hunt` || e.state === `idle`)) {
      if (e.homeT > 0 || e.lostT > LOSE_TRACK_S) {
        this.roam(e, t);
        return;
      }
      if (e.state === `idle`) {
        e.state = `hunt`;
        e.t = 0;
        e.loop = `walk`;
        e.wander = null;
      }
    }
    switch (e.state) {
      case `rise`:
        if (e.t >= 1.9) {
          e.state = `hunt`;
          e.t = 0;
          e.loop = `walk`;
        }
        return;
      case `dead`:
        return;
      case `hurt`:
        e.stagger -= t;
        if (e.stagger <= 0) {
          e.state = e.burrowed ? `dig` : `hunt`;
          e.t = 0;
          e.loop = `walk`;
        }
        return;
      case `attack`: {
        a(n.pos.x, n.pos.z, 5);
        const len = e.attackLen;
        if (i.surface && !e.fired) {
          const dx = n.pos.x - e.pos.x;
          const dz = n.pos.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > i.range * 0.6) this.walk(e, dx / d, dz / d, i.speed * 1.1 * t);
        }
        if (!e.fired && e.t >= len * i.hitAt) {
          e.fired = true;
          if (i.attack === `melee`) {
            Xw.set(n.pos.x - e.pos.x, 0, n.pos.z - e.pos.z);
            const d = Xw.length();
            const fwd = Zw.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
            const reachY = (i.height ?? 1.9) > 2.5 ? 2.6 : 1.6;
            // MINEAR: no melee hit through a rock wall (KR checked this for the golem only)
            const blocked = !this.clearShot(e, n.pos);
            if (
              n.ok &&
              !blocked &&
              d < i.range + 0.35 &&
              Math.abs(n.pos.y - e.pos.y) < reachY &&
              (d < 0.6 || Xw.divideScalar(d).dot(fwd) > 0.35)
            )
              this.hooks.melee(e, n.id, e.dmg);
          } else if (n.ok) {
            const from = e.center(new THREE.Vector3());
            from.y += 0.35;
            this.shoot(e, n, from);
          }
        }
        if (e.t >= len * 0.92) {
          e.state = e.burrowed ? `dig` : `hunt`;
          e.t = 0;
          e.cd = i.cooldown * (0.8 + Math.random() * 0.4);
          e.loop = `walk`;
        }
        return;
      }
      case `idle`:
        if (n.ok) {
          e.state = `hunt`;
          e.t = 0;
          e.loop = `walk`;
        }
        return;
      case `hunt`: {
        if (!n.ok) {
          e.state = `idle`;
          e.t = 0;
          e.loop = Math.random() < 0.5 ? `taunt` : `idle`;
          return;
        }
        const o = n.pos.y - e.pos.y;
        const s = i.attack !== `melee`;
        const c = s
          ? r < i.range && Math.abs(o) < 12 && this.clearShot(e, n.pos)
          : r < i.range && Math.abs(o) < ((i.height ?? 1.9) > 2.5 ? 2.4 : 1.6);
        if (this.mend(e)) return;
        if (FOE_DIGGING && i.digger && e.digRest <= 0 && this.outOfReach(e, n, r, o, t) && !inTownZone(n.pos)) {
          e.state = `dig`;
          e.t = 0;
          e.loop = `walk`;
          e.path = null;
          e.burrowed = true;
          e.burrowT = 0;
          e.digAt.set(1e9, 0, 0);
          this.hooks.windup(e);
          return;
        }
        if (c && e.cd <= 0) {
          e.state = `attack`;
          e.t = 0;
          e.fired = false;
          e.attackLen = i.swingLen / i.swingRate;
          this.hooks.windup(e);
          if (!s && r > i.range * 0.5) {
            const lunge = i.surface ? 8.5 : 5.5;
            e.vel.x += ((n.pos.x - e.pos.x) / r) * lunge;
            e.vel.z += ((n.pos.z - e.pos.z) / r) * lunge;
          }
          return;
        }
        const l = i.hurl;
        if (l && e.hurlCd <= 0 && r >= l.min && r <= l.max && Math.abs(o) < 14 && this.clearShot(e, n.pos)) {
          e.state = `hurl`;
          e.t = 0;
          e.fired = false;
          e.attackLen = l.len / l.rate;
          e.hurlCd = l.cooldown * (0.8 + Math.random() * 0.5);
          e.loop = `idle`;
          this.hooks.windup(e);
          return;
        }
        let u = n.pos.x - e.pos.x;
        let d = n.pos.z - e.pos.z;
        const f = !s && r < i.range * 0.8 && Math.abs(o) < 1.2;
        const p = this.steer(e, Zw.set(n.pos.x, n.pos.y, n.pos.z), t, f);
        if (p) {
          u = p.x - e.pos.x;
          d = p.z - e.pos.z;
        }
        const m = Math.hypot(u, d) || 1;
        u /= m;
        d /= m;
        let h = i.speed * (!s && !i.surface && r > 9 ? 1.2 : 1);
        if (s) {
          if (r < i.keep - 2) {
            u = -u;
            d = -d;
            h *= 0.8;
          } else if (r < i.keep + 3 && c) {
            const side = Math.sin(e.t * 0.7 + e.maxHp) > 0 ? 1 : -1;
            [u, d] = [-d * side, u * side];
            h *= 0.5;
          }
        } else if (f) h = 0;
        // MINEAR: a melee foe that cannot get any closer (its target is in a tunnel, or across a gap) gives up
        if (!s && h > 0) {
          if (this.stalled(e, t)) {
            this.roam(e, t);
            return;
          }
        } else e.stallT = 0;
        a(n.pos.x, n.pos.z, 6);
        if (h > 0 && !this.walk(e, u, d, h * t)) {
          if (e.t > 3) {
            e.t = 0;
            e.loop = `taunt`;
          }
        } else if (h > 0 && i.run) {
          e.loop = `run`;
          e.rate = clamp(h / (i.runPace ?? 6), 0.45, 1.3);
        } else if (h > 0) {
          e.loop = `walk`;
          e.rate = (s && r < i.keep - 2 ? -0.8 : 1) * clamp(h / 4.4, 0.7, 1.25);
        } else e.loop = `idle`;
        return;
      }
      case `hurl`: {
        const l = i.hurl!;
        a(n.pos.x, n.pos.z, 4);
        if (!e.fired && e.t >= e.attackLen * l.at) {
          e.fired = true;
          if (n.ok) this.hurlRock(e, n);
        }
        if (e.t >= e.attackLen * 0.95) {
          e.state = `hunt`;
          e.t = 0;
          e.cd = Math.max(e.cd, 0.5);
          e.loop = `run`;
        }
        return;
      }
      case `dig`: {
        const o = i.digger!;
        if (!n.ok || e.burrowT > 25 || inTownZone(n.pos)) {
          this.surface(e, 4);
          return;
        }
        if (r < i.range + 0.2 && Math.abs(n.pos.y - e.pos.y) < 1.5) {
          a(n.pos.x, n.pos.z, 8);
          if (!n.burrowing) {
            const g = this.world.groundBelow(e.pos.x, e.pos.z, e.pos.y + 1, 3);
            if (g !== null && e.pos.y - g < 1.3) {
              e.pos.y = g;
              this.surface(e, 1.5);
              return;
            }
          }
          if (e.cd <= 0) {
            e.state = `attack`;
            e.t = 0;
            e.fired = false;
            e.attackLen = i.swingLen / i.swingRate;
            this.hooks.windup(e);
          }
          return;
        }
        const s = n.pos.x - e.pos.x;
        const c = n.pos.y + 0.15 - e.pos.y;
        const l = n.pos.z - e.pos.z;
        const u = Math.hypot(s, c, l) || 1;
        const d = Math.min(u, o.speed * (e.slowT > 0 ? 1 - e.slowK : 1) * t);
        const f = e.pos.x + (s / u) * d;
        const p = e.pos.y + (c / u) * d;
        const m = e.pos.z + (l / u) * d;
        if (inTownZone({ x: f, y: p, z: m })) {
          this.surface(e, 4);
          return;
        }
        e.pos.set(f, p, m);
        a(n.pos.x, n.pos.z, 6);
        e.loop = `walk`;
        if (e.pos.distanceToSquared(e.digAt) > 0.3) {
          e.digAt.copy(e.pos);
          const at = { x: round2(e.pos.x), y: round2(e.pos.y + 0.95), z: round2(e.pos.z) };
          if (
            this.world.sample(at.x, at.y, at.z) > 88 ||
            this.world.sample(at.x + s / u, at.y + c / u, at.z + l / u) > 88
          )
            this.hooks.dig({ ...at, r: o.r, a: 600, p: 6 });
        }
        return;
      }
      case `mend`: {
        const m = i.mend!;
        e.hp = Math.min(e.maxHp, e.hp + (e.maxHp * m.frac * t) / m.time);
        if (e.t >= m.time) {
          e.state = `hunt`;
          e.t = 0;
          e.cd = Math.max(e.cd, 0.4);
          e.loop = `run`;
        }
        return;
      }
    }
  }
  /** A burrower comes up: back to hunting, no digging for t seconds. */
  surface(e: Foe, t: number): void {
    e.state = `hunt`;
    e.t = 0;
    e.loop = `walk`;
    e.burrowed = false;
    e.blockedT = 0;
    e.digRest = t;
  }
  /** Burrower test: has the target been unreachable on foot for more than 0.9 s? */
  outOfReach(e: Foe, t: SimPlayer, n: number, r: number, i: number): boolean {
    const a = !this.clearShot(e, t.pos);
    const o = e.stuckT > 0.7 || (e.path === null && e.pathT > 0 && a);
    const s = Math.abs(r) > 1.5;
    e.blockedT =
      (a && (o || s || t.burrowing)) || (s && o) || (t.burrowing && n < 14) || (n > 5 && e.stuckT > 1.6)
        ? e.blockedT + i
        : Math.max(0, e.blockedT - i * 2);
    return e.blockedT > 0.9;
  }
  /** Golem self-heal when below 85% HP and off cooldown. */
  mend(e: Foe): boolean {
    const t = e.def.mend;
    if (!t || e.mendCd > 0 || e.hp >= e.maxHp * 0.85) return false;
    e.state = `mend`;
    e.t = 0;
    e.loop = `idle`;
    e.wander = null;
    e.mendCd = t.every * (0.85 + Math.random() * 0.3);
    this.hooks.windup(e);
    return true;
  }
  /** Golem rock: ballistic shot that lands at the target's lead position. */
  hurlRock(e: Foe, t: SimPlayer): void {
    const n = e.def.hurl!;
    const r = Math.sin(e.yaw);
    const i = Math.cos(e.yaw);
    const a = new THREE.Vector3(e.pos.x + r * 0.9, e.pos.y + (e.def.height ?? 1.9) * 1.02, e.pos.z + i * 0.9);
    const o = clamp(0.5 + Math.hypot(t.pos.x - a.x, t.pos.z - a.z) / 40, 0.65, 1.15);
    const s = new THREE.Vector3(t.pos.x + t.vel.x * o, t.pos.y + 0.5, t.pos.z + t.vel.z * o);
    const c = FOE_SHOTS.rock.gravity;
    const l = new THREE.Vector3((s.x - a.x) / o, (s.y - a.y) / o + 0.5 * c * o, (s.z - a.z) / o);
    this.hooks.shoot(e, t.id, a, l, `rock`, Math.round(e.dmg * n.dmg));
  }
  /**
   * MINEAR: true once a hunting foe has wanted to move but stayed within 1 m of one point for STALL_GIVE_UP_S
   * seconds (it cannot get closer); it then stays home for HOME_CALM_S seconds.
   */
  stalled(e: Foe, t: number): boolean {
    if (e.pos.distanceToSquared(e.stallPos) > 1) {
      e.stallPos.copy(e.pos);
      e.stallT = 0;
      return false;
    }
    e.stallT += t;
    if (e.stallT <= STALL_GIVE_UP_S) return false;
    e.stallT = 0;
    e.stallPos.set(1e9, 0, 0);
    e.homeT = HOME_CALM_S;
    return true;
  }
  /**
   * MINEAR: moves a hovering foe by (dx, dz) and dy through open cave only (no rock, no dug tunnel), sliding
   * along walls. A foe already caught in rock may move out. Returns true when it moved horizontally.
   */
  hover(e: Foe, dx: number, dz: number, dy: number): boolean {
    const w = this.world;
    const h = e.def.height ?? 1.9;
    const p = e.pos;
    const caught = !hoverFits(w, p.x, p.y, p.z, h);
    let moved = false;
    if (dx || dz) {
      if (caught || hoverFits(w, p.x + dx, p.y, p.z + dz, h)) {
        p.x += dx;
        p.z += dz;
        moved = true;
      } else if (dx && hoverFits(w, p.x + dx, p.y, p.z, h)) {
        p.x += dx;
        moved = true;
      } else if (dz && hoverFits(w, p.x, p.y, p.z + dz, h)) {
        p.z += dz;
        moved = true;
      }
    }
    if (dy && (caught || hoverFits(w, p.x, p.y + dy, p.z, h))) p.y += dy;
    return moved;
  }
  /**
   * The ghost (wraith) AI: hovers at the target's height, drains life. KR let it fly through rock; in MINEAR it
   * moves through open cave only (hover) and hunts only a target it saw in the last LOSE_TRACK_S seconds.
   */
  haunt(e: Foe, t: number, n: SimPlayer, r: number): void {
    const i = e.def;
    if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.01) {
      this.hover(e, e.vel.x * t, e.vel.z * t, 0);
      const k = Math.exp(-t * 5);
      e.vel.x *= k;
      e.vel.z *= k;
    }
    e.vel.y = 0;
    e.grounded = true;
    const a = (x: number, z: number, rate: number) => {
      const ang = Math.atan2(x - e.pos.x, z - e.pos.z);
      e.yaw += wrapAngle(ang - e.yaw) * Math.min(1, t * rate);
    };
    switch (e.state) {
      case `rise`:
        if (e.t >= 1.9) {
          e.state = `hunt`;
          e.t = 0;
          e.loop = `walk`;
        }
        return;
      case `dead`:
        return;
      case `hurt`:
        e.stagger -= t;
        if (e.stagger <= 0) {
          e.state = `hunt`;
          e.t = 0;
          e.loop = `walk`;
        }
        return;
      case `attack`:
        a(n.pos.x, n.pos.z, 6);
        if (!e.fired && e.t >= e.attackLen * i.hitAt) {
          e.fired = true;
          if (n.ok && r < i.range + 0.6 && Math.abs(n.pos.y - e.pos.y) < 2) {
            this.hooks.melee(e, n.id, e.dmg);
            e.hp = Math.min(e.maxHp, e.hp + e.dmg * (i.drain ?? 0));
          }
        }
        if (e.t >= e.attackLen * 0.92) {
          e.state = `hunt`;
          e.t = 0;
          e.cd = i.cooldown * (0.8 + Math.random() * 0.4);
          e.loop = `walk`;
        }
        return;
      default: {
        const o = cavernAtWorld(e.spot.pos.x, e.spot.pos.y, e.spot.pos.z);
        const s = !o || cavernMetric(o, n.pos.x, n.pos.y + 1, n.pos.z) < 1.2;
        if (!n.ok || !s || e.homeT > 0 || e.lostT > LOSE_TRACK_S) {
          e.state = `idle`;
          e.loop = `idle`;
          e.stallT = 0;
          const dx = e.spot.pos.x - e.pos.x;
          const dz = e.spot.pos.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 2)
            this.hover(
              e,
              (dx / d) * i.speed * 0.5 * t,
              (dz / d) * i.speed * 0.5 * t,
              (e.spot.pos.y + 0.4 - e.pos.y) * Math.min(1, t),
            );
          return;
        }
        if (e.state === `idle`) {
          e.state = `hunt`;
          e.t = 0;
        }
        if (r < i.range && Math.abs(n.pos.y - e.pos.y) < 1.6 && e.cd <= 0) {
          e.state = `attack`;
          e.t = 0;
          e.fired = false;
          e.attackLen = i.swingLen / i.swingRate;
          this.hooks.windup(e);
          return;
        }
        const c = n.pos.x - e.pos.x;
        const l = n.pos.z - e.pos.z;
        const u = Math.hypot(c, l) || 1;
        const d = r > i.range * 0.8 ? i.speed * (r > 12 ? 1.35 : 1) * (e.slowT > 0 ? 1 - e.slowK : 1) : 0;
        // a wraith that cannot get closer (its target is in a tunnel, or behind a wall) gives up
        if (d > 0) {
          if (this.stalled(e, t)) return;
        } else e.stallT = 0;
        const f = n.pos.y + 0.35 + Math.sin(e.t * 2.1 + e.id) * 0.25;
        this.hover(e, (c / u) * d * t, (l / u) * d * t, (f - e.pos.y) * Math.min(1, t * 2.5));
        a(n.pos.x, n.pos.z, 5);
        e.loop = `walk`;
        e.rate = 1;
      }
    }
  }
  /** Bolt / orb: lead 0.55 of the flight time, gravity compensation and a small jitter. */
  shoot(e: Foe, t: SimPlayer, n: THREE.Vector3): void {
    const r: FoeShotKind = e.def.attack === `orb` ? `orb` : `bolt`;
    const { speed: i, gravity: a } = FOE_SHOTS[r];
    const o = new THREE.Vector3(t.pos.x, t.pos.y + 0.95, t.pos.z);
    const s = n.distanceTo(o) / i;
    o.x += t.vel.x * s * 0.55;
    o.y += t.vel.y * s * 0.55 + a * s * s * 0.5;
    o.z += t.vel.z * s * 0.55;
    const c = o.sub(n).normalize();
    c.x += (Math.random() - 0.5) * 0.05;
    c.y += (Math.random() - 0.5) * 0.03;
    c.z += (Math.random() - 0.5) * 0.05;
    c.normalize().multiplyScalar(i);
    this.hooks.shoot(e, t.id, n, c, r, e.dmg);
  }
  /**
   * Steering toward t: walk straight when the way is open, else follow an A* path (repath on stuck, every
   * 0.9-1.3 s or when the goal moved > 3). r = holding still (no stuck detection). Returns the waypoint or null.
   */
  steer(e: Foe, t: THREE.Vector3, n: number, r: boolean): THREE.Vector3 | null {
    e.pathT -= n;
    e.detourT -= n;
    e.avoidT -= n;
    if (e.avoidT <= 0) e.avoid.length = 0;
    if (!r && e.pos.distanceToSquared(e.lastPos) < 0.04) e.stuckT += n;
    else {
      e.stuckT = 0;
      e.lastPos.copy(e.pos);
    }
    const i = e.stuckT > 0.8;
    if (!i && e.detourT <= 0 && this.openWay(e, t)) {
      e.path = null;
      return null;
    }
    if ((i || e.pathT <= 0 || e.pathGoal.distanceToSquared(t) > 9) && this.navBudget > 0) {
      this.navBudget--;
      if (i) {
        e.detourT = 3;
        if (e.path && e.pathI < e.path.length) {
          const w = e.path[e.pathI];
          e.avoid.push(navKey(Math.round(w.x), Math.round(w.y + 0.5), Math.round(w.z)));
          if (e.avoid.length > 12) e.avoid.shift();
          e.avoidT = 8;
        }
      }
      e.path = findPath(this.world, e.pos, t, e.avoid);
      e.pathI = 0;
      e.pathT = 0.9 + Math.random() * 0.4;
      if (!e.path && e.avoid.length) {
        e.avoid.length = 0;
        e.pathT = 0;
      }
      e.pathGoal.copy(t);
      e.stuckT = 0;
      e.lastPos.copy(e.pos);
    }
    const a = e.path;
    if (!a) return null;
    while (e.pathI < a.length) {
      const w = a[e.pathI];
      if (Math.hypot(w.x - e.pos.x, w.z - e.pos.z) < 0.7 && Math.abs(w.y - e.pos.y) < 1.4) e.pathI++;
      else break;
    }
    if (e.pathI >= a.length) {
      e.path = null;
      return null;
    }
    let o = e.pathI;
    while (o + 1 < a.length && o < e.pathI + 4 && Math.abs(a[o + 1].y - e.pos.y) < 0.6 && this.clearLine(e.pos, a[o + 1]))
      o++;
    e.pathI = o;
    return a[o];
  }
  openWay(e: Foe, t: XYZ): boolean {
    return Math.abs(t.y - e.pos.y) > 1.3 || Math.hypot(t.x - e.pos.x, t.z - e.pos.z) > 26
      ? false
      : this.clearLine(e.pos, t);
  }
  /** Walkable cell line from e to t (0.25 steps). */
  clearLine(e: XYZ, t: XYZ): boolean {
    const n = this.world;
    let r = Math.round(e.x);
    let i = Math.round(e.z);
    let a = groundCell(n, e);
    if (Number.isNaN(a)) return false;
    const o = Math.max(1, Math.ceil(Math.hypot(t.x - e.x, t.z - e.z) / 0.25));
    for (let k = 1; k <= o; k++) {
      const s = k / o;
      const c = Math.round(e.x + (t.x - e.x) * s);
      const l = Math.round(e.z + (t.z - e.z) * s);
      if (c === r && l === i) continue;
      const u = this.stepTo(r, a, i, c, l);
      if (Number.isNaN(u)) return false;
      r = c;
      i = l;
      a = u;
    }
    return true;
  }
  /** Step from cell (e, t, n) to column (r, i): no corner cutting through rock. */
  stepTo(e: number, t: number, n: number, r: number, i: number): number {
    const a = this.world;
    return r !== e && i !== n && (a.solid(r, t, n) || a.solid(r, t + 1, n) || a.solid(e, t, i) || a.solid(e, t + 1, i))
      ? NaN
      : stepCell(a, e, t, n, r, i);
  }
  /** Moves e along (t, n) by r, trying deflected angles; step-up jumps. False when no way was found. */
  walk(e: Foe, t: number, n: number, r: number): boolean {
    if (e.slowT > 0) r *= 1 - e.slowK;
    const i = this.world;
    const a = Math.round(e.pos.x);
    const o = Math.round(e.pos.z);
    let s = groundCell(i, e.pos);
    if (Number.isNaN(s)) s = groundCell(i, e.pos, true);
    for (const c of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const l = Math.cos(c);
      const u = Math.sin(c);
      const d = t * l - n * u;
      const f = t * u + n * l;
      const p = e.pos.x + d * r * (c ? 0.8 : 1);
      const m = e.pos.z + f * r * (c ? 0.8 : 1);
      const h = Math.round(p);
      const g = Math.round(m);
      let _ = s;
      if (h !== a || g !== o) {
        _ = Number.isNaN(s) ? groundCell(i, Zw.set(p, e.pos.y, m)) : this.stepTo(a, s, o, h, g);
        if (Number.isNaN(_)) continue;
      } else if (Number.isNaN(s)) {
        e.pos.x = p;
        e.pos.z = m;
        return true;
      }
      const v = i.groundBelow(p, m, _ + 0.5, 2);
      if (v === null || (e.def.surface && surfaceHeight(p, m) - v > 3)) continue;
      const y = v - e.pos.y;
      if (y > 0.55) {
        if (e.grounded) {
          e.vel.y = Math.sqrt(44 * (y + 0.35));
          e.grounded = false;
        }
        if (e.pos.y < v - 0.25) return true;
      }
      e.pos.x = p;
      e.pos.z = m;
      return true;
    }
    return false;
  }
  /** Horizontal push that will not move a foe into rock. */
  nudge(e: Foe, t: number, n: number): void {
    const r = e.pos.x + t;
    const i = e.pos.z + n;
    const a = Math.round(e.pos.x);
    const o = Math.round(e.pos.z);
    const s = Math.round(r);
    const c = Math.round(i);
    if (s !== a || c !== o) {
      const g = groundCell(this.world, e.pos);
      if (Number.isNaN(g) ? this.world.sample(r, e.pos.y + 0.8, i) > 128 : !(this.stepTo(a, g, o, s, c) <= g)) return;
    }
    e.pos.x = r;
    e.pos.z = i;
  }
  /** Knockback damping, gravity 22 and ground snap. */
  physics(e: Foe, t: number): void {
    if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.01) {
      this.nudge(e, e.vel.x * t, e.vel.z * t);
      const k = Math.exp(-t * 7);
      e.vel.x *= k;
      e.vel.z *= k;
    }
    if (e.state === `rise` || (e.state === `dead` && e.t > 2.2)) return;
    if (e.state === `dig` || e.burrowed) {
      e.vel.y = 0;
      e.grounded = true;
      return;
    }
    const n = this.world;
    const r = n.groundBelow(e.pos.x, e.pos.z, e.pos.y + 0.6, 40) ?? n.groundBelow(e.pos.x, e.pos.z, e.pos.y + 1.8, 3);
    if (r === null) {
      const g = n.groundBelow(e.pos.x, e.pos.z, e.pos.y + 3.5, 3.5);
      if (g !== null && g > e.pos.y) e.pos.y = g;
      e.vel.y = 0;
      e.grounded = true;
      return;
    }
    if (e.vel.y > 0 || e.pos.y > r + 0.05) {
      e.vel.y -= 22 * t;
      e.pos.y += e.vel.y * t;
      e.grounded = false;
      if (e.pos.y <= r) {
        e.pos.y = r;
        e.vel.y = 0;
        e.grounded = true;
      }
    } else {
      e.pos.y += (r - e.pos.y) * Math.min(1, t * 14);
      e.vel.y = 0;
      e.grounded = true;
    }
  }
  /** Line of sight from the foe's chest to the target's chest (samples every 0.7, blocked above 148). */
  clearShot(e: Foe, t: XYZ): boolean {
    const n = e.center(Qw);
    n.y += 0.35;
    return this.sightLine(n, { x: t.x, y: t.y + 0.95, z: t.z });
  }
  /** Open line from point n to point t: no density sample above 148 every 0.7 along it. */
  sightLine(n: XYZ, t: XYZ): boolean {
    const o = Math.hypot(t.x - n.x, t.y - n.y, t.z - n.z);
    const s = Math.ceil(o / 0.7);
    for (let k = 1; k < s; k++) {
      const f = k / s;
      if (this.world.sample(n.x + (t.x - n.x) * f, n.y + (t.y - n.y) * f, n.z + (t.z - n.z) * f) > 148) return false;
    }
    return true;
  }
}
