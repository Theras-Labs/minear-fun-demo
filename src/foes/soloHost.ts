// Solo adapter for the foes. Port of the foe parts of:
// - the monster host ET (play-inUT-NSi.js 45238-45503): bT / xT / ST / TT, the rT hooks -> messages, foe
//   visibility per player (sight), snapshot, hitFoe, smoke bombs, boulder, drop, clear, summon;
// - the multiplayer session EO (48805-49297): EO.simulate (48941) runs `this.local` (an ET) for the local
//   player each frame and posts the snapshot; EO's send filter (48923) delivers only messages for me;
// - KR.onSim (72389-72517): the foe message cases, which call the foe views wF (combat.foes).
// In the original, solo play runs the same message protocol a server sends, so the views only ever see
// info / snapshot tuples. This adapter keeps that path.
//
// Wiring in a solo game (KR order, 71762-71784):
//   const host = new SoloFoeHost(world, (to, msg) => { if (to === myId) applyFoeMessage(combat.foes, msg, myId, handlers); },
//                                undefined, (d) => { const n = world.applyDig(d.x, d.y, d.z, d.r, d.a, d.p, 0); remoteDig(d, n, true); });
//   per frame: combat.update(t, input); host.simulate(t, simPlayer()); combat.foes.eye.set(p.x, p.y + 1.4, p.z); combat.updateFoes(t);
//   world.onDig with a fill (boulder): host.boulder(center, r)   (EO.localDig 49121)
//   combat hook hitFoe(id, dmg, dx, dz, knock, chill) -> host.hitFoe(myId, id, dmg, dx, dz, knock, chill)   (EO.hitFoe 49043)
import * as THREE from 'three';
import { FoeManager, type FoeDig, type SimPlayer, type SummonOverride } from './foeManager';
import type { Foe, FoeInfo, FoeSnap } from './foe';
import type { FoeViews } from './foeViews';
import { FOE_STATES, type FoeKind, type FoeShotKind } from './types';
import type { FoeWorld } from './nav';

/** bT (45238): biome display names (boss wake news). */
export const BIOME_NEWS_NAMES = { // bT (45238)
  ember: `the Ember Fields`,
  bog: `the Bog`,
  frost: `the Frozen Lake`,
  haunt: `the Haunted Hollow`,
};
/** xT (45244): "THE NAME" -> "The name". */
export const capitalize = (e: string): string => e.charAt(0) + e.slice(1).toLowerCase(); // xT (45244)
/** ST (45245): foe sight radius (horizontal). */
export const FOE_SIGHT_R = 70; // ST (45245)
/** CT (45246): worm sight radius. TODO [worm]: used by the worm part of sight(). */
export const WORM_SIGHT_R = 110; // CT (45246)
/** wT (45247): boss sight (cavern metric). TODO [bosses]: used by bossSight(). */
export const BOSS_SIGHT = 2.1; // wT (45247)

export type Vec3Tuple = [number, number, number];
/** TT (45248): a position rounded to 0.01 as a tuple. */
export const roundTuple = (e: { x: number; y: number; z: number }): Vec3Tuple => [ // TT (45248)
  Math.round(e.x * 100) / 100,
  Math.round(e.y * 100) / 100,
  Math.round(e.z * 100) / 100,
];

/** The foe messages of the protocol (ET -> player). */
export type FoeHostMsg =
  | { t: `foe`; f: FoeInfo }
  | { t: `foes`; list: FoeSnap[] }
  | { t: `foeWind`; id: number; s?: number }
  | { t: `hurt`; src: `foe`; by: number; dmg: number; p: Vec3Tuple; knock: number }
  | { t: `foeShot`; id: number; k: FoeShotKind; p: Vec3Tuple; v: Vec3Tuple; dmg: number; to: string }
  | { t: `foeHurt`; id: number; hp: number; fl: number; by: string | undefined }
  | { t: `foeDie`; id: number; by: string[] }
  | { t: `foeGone`; id: number }
  | { t: `ambush`; to: string; p: Vec3Tuple };

/** ET news (undefined in solo: EO passes void 0 at 48926). */
export interface MonsterNews {
  say(text: string): void;
  slain?(what: `foe` | `worm` | `beast`, by: string[]): void;
  nameOf(id: string): string;
}

/**
 * The worm (_T), worm director (yT) and boss manager (iC) parts of ET. TODO [worm]/[bosses]: the owners of
 * those modules fill this in; every call is optional and the foe part works without it.
 */
export interface MonsterHostParts {
  /** ET.update after foes.update when not quiet: director.update(dt, worm, playersNotInBossFight); worm.update(dt, players); bosses.update(dt, seen). */
  update?(dt: number, players: SimPlayer[], seen: SimPlayer[]): void;
  /** ET.sight worm part (45427-45433) and ET.bossSight (45403) when not quiet. */
  sight?(players: SimPlayer[], quiet: boolean): void;
  /** ET.snapshot worm / boss parts for a player: posted as {t:`worm`, w} and {t:`bosses`, list}. */
  snapshot?(playerId: string): { worm: unknown | null; bosses: unknown[] };
  /** ET.inBossFight (45398): no ambush heat while in a boss fight. */
  inBossFight?(player: SimPlayer): boolean;
  /** ET.drop worm / director / boss parts. */
  drop?(playerId: string): void;
  /** ET.clear worm / boss parts. */
  clear?(): void;
}

interface Smoke {
  x: number;
  y: number;
  z: number;
  t: number;
  owner: string;
}

export class SoloFoeHost { // ET (45253), foe part
  send: (playerId: string, msg: FoeHostMsg) => void;
  news: MonsterNews | undefined;
  foes: FoeManager;
  /** TODO [worm]/[bosses]: the worm, director and boss parts of ET. */
  parts: MonsterHostParts = {};
  /** Foe ids each player knows about (got a `foe` message for). */
  known = new Map<string, Set<number>>();
  players: SimPlayer[] = [];
  smokes: Smoke[] = [];
  constructor(
    e: FoeWorld,
    t: (playerId: string, msg: FoeHostMsg) => void,
    n?: MonsterNews,
    r?: (d: FoeDig) => void,
  ) {
    this.send = t;
    this.news = n;
    this.foes = new FoeManager(e, {
      rose: () => {},
      windup: (f) =>
        this.toSeers(
          f.id,
          f.state === `attack` ? { t: `foeWind`, id: f.id } : { t: `foeWind`, id: f.id, s: FOE_STATES.indexOf(f.state) },
        ),
      melee: (f, to, dmg) =>
        this.send(to, { t: `hurt`, src: `foe`, by: f.id, dmg, p: roundTuple(f.pos), knock: f.def.surface ? 9 : 6 }),
      shoot: (f, to, from, vel, kind, dmg) =>
        this.toSeers(f.id, { t: `foeShot`, id: f.id, k: kind, p: roundTuple(from), v: roundTuple(vel), dmg, to }),
      hurt: (f, staggered, by) =>
        this.toSeers(f.id, { t: `foeHurt`, id: f.id, hp: Math.round(f.hp), fl: +!!staggered, by }),
      died: (f) => {
        this.toSeers(f.id, { t: `foeDie`, id: f.id, by: [...f.hitters] });
        this.news?.slain?.(`foe`, [...f.hitters]);
      },
      removed: (f) => {
        for (const [id, set] of this.known) if (set.delete(f.id)) this.send(id, { t: `foeGone`, id: f.id });
      },
      ambush: (to, pos) => {
        for (const p of this.players)
          if (p.id === to || Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z) < 60)
            this.send(p.id, { t: `ambush`, to, p: roundTuple(pos) });
      },
      dig: (d) => r?.(d),
      calm: (p) => this.inBossFight(p),
    });
  }
  /** Sends to every player who knows foe e. */
  toSeers(e: number, t: FoeHostMsg): void {
    for (const [id, set] of this.known) if (set.has(e)) this.send(id, t);
  }
  get quiet(): boolean {
    return this.foes.quiet;
  }
  set quiet(e: boolean) {
    this.foes.quiet = e;
  }
  /** ET.update (45382): smoke timers, the foe sim (players in smoke are not ok), the other parts, sight. */
  update(e: number, t: SimPlayer[]): void {
    this.players = t;
    if (this.smokes.length) {
      for (const s of this.smokes) s.t -= e;
      this.smokes = this.smokes.filter((s) => s.t > 0);
    }
    const n = this.smokes.length ? t.map((p) => (p.ok && this.inSmoke(p.pos) ? { ...p, ok: false } : p)) : t;
    this.foes.update(e, n);
    if (!this.quiet) {
      // TODO [worm]/[bosses]: director.update(e, worm, players not in a boss fight), worm.update(e, t), bosses.update(e, n)
      this.parts.update?.(e, t, n);
    }
    this.sight();
    // TODO [worm]/[bosses]: worm sight and bossSight (when not quiet)
    this.parts.sight?.(t, this.quiet);
  }
  /** ET.inBossFight (45398). TODO [bosses]: false until the boss manager is ported. */
  inBossFight(e: SimPlayer): boolean {
    return this.parts.inBossFight?.(e) ?? false;
  }
  /** ET.sight (45415), foe part: a foe becomes known within 70 m (|dy| < 40) and is forgotten past 82 m (|dy| > 52). */
  sight(): void {
    for (const p of this.players) {
      let n = this.known.get(p.id);
      if (!n) this.known.set(p.id, (n = new Set()));
      for (const f of this.foes.foes) {
        const r = Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
        const i = Math.abs(f.pos.y - p.pos.y);
        if (n.has(f.id)) {
          if (r > 82 || i > 52) {
            n.delete(f.id);
            this.send(p.id, { t: `foeGone`, id: f.id });
          }
        } else if (r < FOE_SIGHT_R && i < 40) {
          n.add(f.id);
          this.send(p.id, { t: `foe`, f: f.info() });
        }
      }
    }
  }
  /** ET.snapshot (45436), foe part: snap() of every foe the player knows. */
  snapshot(e: string): { foes: FoeSnap[] } {
    const t = this.known.get(e);
    const n: FoeSnap[] = [];
    if (t) for (const f of this.foes.foes) if (t.has(f.id)) n.push(f.snap());
    return { foes: n };
  }
  /**
   * EO.simulate (48941), foe part: runs the sim for the local player and posts its snapshot ({t:`foes`}) to it.
   * TODO [worm]/[bosses]: EO also posts {t:`worm`, w} and {t:`bosses`, list} from the same snapshot.
   */
  simulate(e: number, me: SimPlayer): void {
    this.update(e, [me]);
    const t = this.snapshot(me.id);
    if (t.foes.length) this.send(me.id, { t: `foes`, list: t.foes });
  }
  /** ET.hitFoe (45452): a player's hit on foe t. */
  hitFoe(e: string, t: number, n: number, r: number, i: number, a: number, o = 0): void {
    const s = this.foes.byId(t);
    if (s) this.foes.damage(s, n, r, i, a, e, o);
  }
  /** ET.smoke (45466): a smoke cloud (10 s, at most 2 per owner, 64 in all). */
  smoke(e: { x: number; y: number; z: number }, t: string): void {
    const n = this.smokes.filter((s) => s.owner === t);
    if (n.length >= 2) this.smokes.splice(this.smokes.indexOf(n[0]), 1);
    this.smokes.push({ x: e.x, y: e.y, z: e.z, t: 10, owner: t });
    if (this.smokes.length > 64) this.smokes.shift();
  }
  /** ET.inSmoke (45472): is a player at e hidden in a cloud? */
  inSmoke(e: { x: number; y: number; z: number }): boolean {
    for (const s of this.smokes) {
      const n = e.x - s.x;
      const r = e.y + 0.9 - (s.y + 1.2);
      const i = e.z - s.z;
      if (n * n + i * i + r * r * 1.8 < 30.25 && s.t > 0.4) return true;
    }
    return false;
  }
  /** ET.boulder (45481) */
  boulder(e: { x: number; y: number; z: number }, t: number): void {
    this.foes.boulder(e, t);
  }
  /** ET.drop (45484): a player left. */
  drop(e: string): void {
    this.foes.forget(e);
    this.known.delete(e);
    // TODO [worm]/[bosses]: wormSeen.delete(e), director.drop(e), bossSeen sets
    this.parts.drop?.(e);
  }
  /** ET.clear (45488) */
  clear(): void {
    this.foes.clear();
    // TODO [worm]/[bosses]: worm.despawn(), bosses.clear(), bossSeen.clear(), wormSeen.clear()
    this.parts.clear?.();
    for (const [id, set] of this.known) for (const f of set) this.send(id, { t: `foeGone`, id: f });
    this.known.clear();
  }
  /** ET.summon (45493): one foe of a kind at pos, facing player (dev, boss adds). */
  summon(e: FoeKind, t: THREE.Vector3, n: SimPlayer, r?: SummonOverride): Foe | null {
    return this.foes.summon(e, t, n, r);
  }
}

/** Callbacks for the foe messages that do not go to the views (KR.onSim 72413-72436, 72480). */
export interface FoeMessageHandlers {
  /** combat.foeShot(kind, pos, vel, dmg, mark, el) */
  shot?(kind: FoeShotKind, pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, to: string, el: [number, number, number] | undefined): void;
  /** KR.hurtBy (72799) for {t:`hurt`, src:`foe`} */
  hurt?(msg: Extract<FoeHostMsg, { t: `hurt` }>): void;
  /** The AMBUSH! banner, rise sound and shake (72427). */
  ambush?(msg: Extract<FoeHostMsg, { t: `ambush` }>, mine: boolean): void;
}

/**
 * KR.onSim (72389), foe cases: applies one foe message to the foe views (combat.foes).
 * Returns false for a message that is not a foe message.
 */
export function applyFoeMessage(
  views: FoeViews,
  e: FoeHostMsg | { t: string },
  me: string,
  on: FoeMessageHandlers = {},
  now = performance.now(),
): boolean {
  const m = e as FoeHostMsg;
  switch (m.t) {
    case `foe`:
      views.add(m.f, now);
      return true;
    case `foes`:
      views.snapshot(m.list, now);
      return true;
    case `foeWind`:
      views.windup(m.id, m.s);
      return true;
    case `foeHurt`:
      views.hurt(m.id, m.hp, !!m.fl, m.by, me);
      return true;
    case `foeDie`:
      views.died(m.id, m.by, me);
      return true;
    case `foeGone`:
      views.gone(m.id);
      return true;
    case `foeShot`:
      if (m.k === `rock`) views.byId(m.id)?.letGo();
      on.shot?.(
        m.k,
        new THREE.Vector3().fromArray(m.p),
        new THREE.Vector3().fromArray(m.v),
        m.dmg,
        m.to,
        views.byId(m.id)?.def.el,
      );
      return true;
    case `hurt`:
      on.hurt?.(m);
      return true;
    case `ambush`:
      on.ambush?.(m, m.to === me);
      return true;
  }
  return false;
}
