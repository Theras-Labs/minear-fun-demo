// Port of the worm parts of the monster host ET (play-inUT-NSi.js 45238-45503): the Grin worm _T and the worm
// director yT, the worm hooks turned into per-player messages, the worm sight set (who sees the worm: enter
// within 110, leave beyond 125), the worm snapshot, player hits on the worm, the calming song, drop, clear and
// the dev call. It is the same message protocol a server sends; solo play builds it in the browser with
// send = (id, msg) => id === me && game.onSim(msg) (48921-48925).
// The foe parts of ET (foe manager, foe sight, smoke) are in src/foes/soloHost.ts; the boss parts come with
// the bosses. ET.update runs, in order: smoke tick, foes.update, then (when not quiet) director.update,
// worm.update, bosses.update, then sight() (foes, then worm per player) and bossSight().
import type { SimPlayer } from '../foes/foeManager';
import type { MonsterHostParts } from '../foes/soloHost';
import { GrinWorm, type WormCue, type WormSnap, type WormWorld } from './grinWorm';
import { WormDirector } from './wormDirector';

/** Distance (3D) within which a player starts to see the worm. */
export const WORM_SIGHT = 110; // CT (45246)
/** Distance (3D) beyond which a player stops seeing the worm (45432). */
export const WORM_SIGHT_LOST = 125;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

export type XYZArray = [number, number, number];

/** [x, y, z] rounded to 0.01 for the wire. */
const roundXYZ = (e: XYZ): XYZArray => [
  Math.round(e.x * 100) / 100,
  Math.round(e.y * 100) / 100,
  Math.round(e.z * 100) / 100,
]; // TT (45248)

/** Worm messages to a player (all {t: ...}). `worm` comes from the client sim loop (48946), not from ET. */
export type WormMsg =
  | { t: `wormSpawn`; to: string }
  | { t: `wormCue`; k: WormCue; p: XYZArray }
  | { t: `hurt`; src: `grin`; by: ``; dmg: number; p: XYZArray; knock: number }
  | { t: `wormHurt`; n: number; weak: number; by: string | undefined }
  | { t: `wormLeft` }
  | { t: `wormDie`; p: XYZArray; by: string[] }
  | { t: `wormGone` }
  | { t: `worm`; w: WormSnap };

/** ET news (say, slain, nameOf); the worm only reports kills. */
export interface WormNews {
  slain?(kind: string, hitters: string[]): void;
}

export class WormHost { // ET (45253), worm parts
  send: (playerId: string, msg: WormMsg) => void;
  news: WormNews | undefined;
  worm: GrinWorm;
  director = new WormDirector();
  wormSeen = new Set<string>();
  players: readonly SimPlayer[] = [];
  /** ET.quiet (= foes.quiet, sandbox): no director and no worm while set. */
  quiet = false;
  /** ET.inBossFight (45398), from the boss manager: a player in a boss fight builds no worm heat. */
  inBossFight: (player: SimPlayer) => boolean = () => false;

  constructor(world: WormWorld, send: (playerId: string, msg: WormMsg) => void, news?: WormNews) {
    this.send = send;
    this.news = news;
    this.worm = new GrinWorm(world, {
      spawned: (e) => {
        const t = this.players.find((p) => p.id === e);
        for (const n of this.players)
          if (n.id === e || (t && Math.hypot(n.pos.x - t.pos.x, n.pos.y - t.pos.y, n.pos.z - t.pos.z) < 60))
            this.send(n.id, { t: `wormSpawn`, to: e });
      },
      cue: (e, t) => this.toWormSeers({ t: `wormCue`, k: e, p: roundXYZ(t) }),
      bite: (e, t, n) => this.send(e, { t: `hurt`, src: `grin`, by: ``, dmg: t, p: roundXYZ(n), knock: 16 }),
      hurt: (e, t, n) => this.toWormSeers({ t: `wormHurt`, n: e, weak: +!!t, by: n }),
      left: () => this.toWormSeers({ t: `wormLeft` }),
      died: (e, t) => {
        this.director.slain();
        this.toWormSeers({ t: `wormDie`, p: roundXYZ(e), by: t });
        this.news?.slain?.(`worm`, t);
      },
      gone: () => {
        for (const e of this.wormSeen) this.send(e, { t: `wormGone` });
        this.wormSeen.clear();
      },
    });
  }

  toWormSeers(e: WormMsg): void { // 45373
    for (const t of this.wormSeen) this.send(t, e);
  }

  /** The worm part of ET.update (45382) in its order: simulate (unless quiet), then sight. */
  update(dt: number, players: readonly SimPlayer[]): void {
    this.players = players;
    if (!this.quiet) this.simulate(dt, players);
    this.sight();
  }

  /**
   * 45391-45394: director (boss fighters marked not ok), then the worm with the raw player list.
   * Also keeps the list for the spawned hook and sight() (ET sets players first in update).
   */
  simulate(e: number, t: readonly SimPlayer[]): void {
    this.players = t;
    const r = t.some((p) => this.inBossFight(p)) ? t.map((p) => (this.inBossFight(p) ? { ...p, ok: false } : p)) : t;
    this.director.update(e, this.worm, r);
    this.worm.update(e, t);
  }

  /** The worm part of ET.sight (45427-45433), per player after its foes. Runs also when quiet. */
  sight(players: readonly SimPlayer[] = this.players): void {
    this.players = players;
    const e = this.worm;
    for (const t of this.players) {
      if (!e.active) continue;
      const r = Math.hypot(e.pos.x - t.pos.x, e.pos.y - t.pos.y, e.pos.z - t.pos.z);
      if (!this.wormSeen.has(t.id) && r < WORM_SIGHT) this.wormSeen.add(t.id);
      else if (this.wormSeen.has(t.id) && r > WORM_SIGHT_LOST) {
        this.wormSeen.delete(t.id);
        this.send(t.id, { t: `wormGone` });
      }
    }
  }

  /** The worm field of ET.snapshot(playerId) (45445). */
  snapshot(e: string): WormSnap | null {
    return this.worm.active && this.wormSeen.has(e) ? this.worm.snap() : null;
  }

  /** A player hit the worm (face = weak side). */
  hitWorm(e: string, t: number, n: boolean): void { // 45456
    this.worm.damage(t, n, e);
  }

  /** The calming song (45459): the worm flees if within 90; no worm for this player for 180 s. */
  song(e: SimPlayer): void {
    const t = this.worm;
    if (t.active && Math.hypot(t.pos.x - e.pos.x, t.pos.y - e.pos.y, t.pos.z - e.pos.z) < 90) t.flee();
    this.director.calm(e.id, 180);
  }

  /** A player left (45484), worm parts. */
  drop(e: string): void {
    this.wormSeen.delete(e);
    this.director.drop(e);
  }

  /** ET.clear (45488), worm parts. */
  clear(): void {
    this.worm.despawn();
    this.wormSeen.clear();
  }

  /** Dev: call the worm on a player now (45499). */
  callWorm(e: SimPlayer, t = 30): void {
    if (this.worm.active) this.worm.despawn();
    this.worm.spawn(e.pos, e.id, t, this.director.level);
  }
}

/**
 * Plugs the worm into SoloFoeHost.parts (src/foes/soloHost.ts) so ET keeps its order: parts.update after
 * foes.update when not quiet, parts.sight after the foe sight. Merge with the boss parts when they exist
 * (and set host.inBossFight from them). The {t:`worm`, w} post of EO.simulate (48946) is the game's:
 * after the foe post, `const w = host.snapshot(me.id); if (w) send(me.id, { t: 'worm', w })`.
 */
export function wormHostParts(host: WormHost): MonsterHostParts {
  return {
    update: (dt, players) => host.simulate(dt, players),
    sight: (players) => host.sight(players),
    snapshot: (id) => ({ worm: host.snapshot(id), bosses: [] }),
    drop: (id) => host.drop(id),
    clear: () => host.clear(),
  };
}
