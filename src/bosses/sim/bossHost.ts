// Port of the boss parts of the monster host ET (play-inUT-NSi.js 45238-45503): the boss manager iC with its
// hooks turned into per-player messages (45329-45365), toBossSeers, inBossFight (45398), bossSight (45403:
// a player sees a boss inside cavern metric 2.1 and loses it beyond 2.5), the boss part of snapshot (45441),
// hitBoss (45449), drop / clear boss parts, pokeBoss (45496). Also the solo session EO boss calls
// (48805-49297): EO.restBosses (49063) and the {t:`bosses`, list} post of EO.simulate (48947).
// It is the same message protocol a server sends; solo play builds it in the browser.
// ET.update runs, in order: smoke tick, foes.update, then (when not quiet) director.update, worm.update,
// bosses.update(dt, smoke-filtered players), then sight() and (when not quiet) bossSight().
import type { SimPlayer } from '../../foes/foeManager';
import {
  BIOME_NEWS_NAMES,
  BOSS_SIGHT,
  capitalize,
  roundTuple,
  type MonsterHostParts,
  type MonsterNews,
  type Vec3Tuple,
} from '../../foes/soloHost';
import { cavernMetric } from '../../world/caverns';
import { Boss, type BossInfo, type BossSnap, type BossWorld } from './boss';
import { BossManager } from './bossManager';
import { bossActIndex } from './defs';

/** Distance (cavern metric) beyond which a player stops seeing a boss (45410). */
export const BOSS_SIGHT_LOST = 2.5;

/** The boss messages of the protocol (ET -> player). `bosses` comes from the client sim loop (48947). */
export type BossHostMsg =
  | { t: `boss`; b: BossInfo }
  | { t: `bosses`; list: BossSnap[] }
  | { t: `bossAct`; id: number; a: number; p: Vec3Tuple; q?: Vec3Tuple[] }
  | { t: `bossWake`; id: number; by: string | undefined }
  | { t: `bossHurt`; id: number; n: number; by: string | undefined }
  | { t: `bossDie`; id: number; p: Vec3Tuple; by: string[] }
  | { t: `bossGone`; id: number };

export class BossHost { // ET (45253), boss parts
  send: (playerId: string, msg: BossHostMsg) => void;
  news: MonsterNews | undefined;
  bosses: BossManager;
  /** Player ids that know each boss (got a `boss` message). */
  bossSeen = new Map<number, Set<string>>();
  players: readonly SimPlayer[] = [];

  constructor(e: BossWorld, t: (playerId: string, msg: BossHostMsg) => void, n?: MonsterNews) {
    this.send = t;
    this.news = n;
    this.bosses = new BossManager(e, {
      act: (b, act, aim, pts) => {
        const a: Extract<BossHostMsg, { t: `bossAct` }> = { t: `bossAct`, id: b.id, a: bossActIndex(act), p: roundTuple(aim) };
        if (pts.length) a.q = pts.map((v) => roundTuple(v));
        this.toBossSeers(b, a);
      },
      woke: (b, by) => {
        this.toBossSeers(b, { t: `bossWake`, id: b.id, by });
        this.news?.say(
          `${capitalize(b.def.name)}, ${b.def.title}, has woken in ${BIOME_NEWS_NAMES[b.def.biome]}!`,
        );
      },
      hurt: (b, n, by) => this.toBossSeers(b, { t: `bossHurt`, id: b.id, n, by }),
      died: (b, pos, by) => {
        this.toBossSeers(b, { t: `bossDie`, id: b.id, p: roundTuple(pos), by });
        this.news?.slain?.(`beast`, by);
        if (this.news && by.length) {
          const news = this.news;
          const names = by.slice(0, 6).map((id) => news.nameOf(id));
          const r = names.length > 1 ? `${names.slice(0, -1).join(`, `)} and ${names[names.length - 1]}` : names[0];
          news.say(`${r} slew ${capitalize(b.def.name)}!`);
        }
      },
      gone: (b) => {
        for (const id of this.bossSeen.get(b.id) ?? []) this.send(id, { t: `bossGone`, id: b.id });
        this.bossSeen.delete(b.id);
      },
    });
  }

  /** Sends to every player who knows boss e (45367). */
  toBossSeers(e: Boss, t: BossHostMsg): void {
    for (const id of this.bossSeen.get(e.id) ?? []) this.send(id, t);
  }

  /** The boss part of ET.update (45394): bosses.update with the smoke-filtered players. Not called when quiet. */
  update(dt: number, seen: readonly SimPlayer[]): void {
    this.bosses.update(dt, seen);
  }

  /** The boss part of ET.sight: bossSight() unless quiet (45396). */
  sight(players: readonly SimPlayer[], quiet = false): void {
    this.players = players;
    if (!quiet) this.bossSight();
  }

  /** ET.inBossFight (45398): the player is in the arena of a fighting or homing boss. */
  inBossFight(e: SimPlayer): boolean {
    for (const b of this.bosses.bosses.values()) if ((b.mode === `fight` || b.mode === `home`) && b.inArena(e)) return true;
    return false;
  }

  /** ET.bossSight (45403) */
  bossSight(): void {
    for (const b of this.bosses.bosses.values()) {
      let t = this.bossSeen.get(b.id);
      if (!t) this.bossSeen.set(b.id, (t = new Set()));
      for (const p of this.players) {
        const r = cavernMetric(b.region, p.pos.x, p.pos.y + 1, p.pos.z);
        if (t.has(p.id)) {
          if (r > BOSS_SIGHT_LOST) {
            t.delete(p.id);
            this.send(p.id, { t: `bossGone`, id: b.id });
          }
        } else if (r < BOSS_SIGHT) {
          t.add(p.id);
          this.send(p.id, { t: `boss`, b: b.info() });
        }
      }
    }
  }

  /** The bosses field of ET.snapshot(playerId) (45441): snap() of each boss the player knows. */
  snapshot(e: string): BossSnap[] {
    const r: BossSnap[] = [];
    for (const b of this.bosses.bosses.values()) if (this.bossSeen.get(b.id)?.has(e)) r.push(b.snap());
    return r;
  }

  /** ET.hitBoss (45449): player e hits boss t for n (r = crit / weak spot). */
  hitBoss(e: string, t: number, n: number, r: boolean): void {
    this.bosses.hit(t, n, r, e);
  }

  /** ET.pokeBoss (45496), EO.devBoss (49067) in solo: the boss of the player's cavern now. */
  pokeBoss(e: SimPlayer): Boss | null {
    return this.bosses.poke(e);
  }

  /** EO.restBosses (49063): rest timers from the save (state.bossBack: boss id -> epoch ms it may return). */
  restBosses(e: Record<string, number>): void {
    const t = Date.now();
    for (const [n, r] of Object.entries(e)) this.bosses.rest(Number(n), (r - t) / 1e3);
  }

  /** ET.drop (45484), boss part: a player left. */
  drop(e: string): void {
    for (const t of this.bossSeen.values()) t.delete(e);
  }

  /** ET.clear (45488), boss part: every boss goes (bossGone to its seers). */
  clear(): void {
    this.bosses.clear();
    this.bossSeen.clear();
  }
}

/**
 * Plugs the bosses into SoloFoeHost.parts (src/foes/soloHost.ts) in ET's order: parts.update after foes.update
 * when not quiet (bosses get the smoke-filtered players), parts.sight after the foe sight (bossSight only when
 * not quiet). Merge with the worm: mergeHostParts(wormHostParts(worm), bossHostParts(bosses)).
 */
export function bossHostParts(host: BossHost): MonsterHostParts {
  return {
    update: (dt, _players, seen) => host.update(dt, seen),
    sight: (players, quiet) => host.sight(players, quiet),
    snapshot: (id) => ({ worm: null, bosses: host.snapshot(id) }),
    inBossFight: (player) => host.inBossFight(player),
    drop: (id) => host.drop(id),
    clear: () => host.clear(),
  };
}

/**
 * Joins several MonsterHostParts into one, calling each part in the order given (pass the worm first, then the
 * bosses: ET runs director + worm before bosses in update, worm sight before bossSight, worm before bosses in
 * drop and clear). snapshot: the first non-null worm and all bosses; inBossFight: any part says yes.
 */
export function mergeHostParts(...parts: MonsterHostParts[]): MonsterHostParts {
  return {
    update: (dt, players, seen) => {
      for (const p of parts) p.update?.(dt, players, seen);
    },
    sight: (players, quiet) => {
      for (const p of parts) p.sight?.(players, quiet);
    },
    snapshot: (id) => {
      let worm: unknown | null = null;
      const bosses: unknown[] = [];
      for (const p of parts) {
        const s = p.snapshot?.(id);
        if (!s) continue;
        if (worm === null && s.worm != null) worm = s.worm;
        bosses.push(...s.bosses);
      }
      return { worm, bosses };
    },
    inBossFight: (player) => parts.some((p) => p.inBossFight?.(player) ?? false),
    drop: (id) => {
      for (const p of parts) p.drop?.(id);
    },
    clear: () => {
      for (const p of parts) p.clear?.();
    },
  };
}
