// Port of play-inUT-NSi.js 40714-40848: the boss kinds, the action and mode lists sent as indexes on the wire,
// the boss table IS (titan only in this build) and the boss tuning (aim lead, leap window, sprint, perch,
// rest time, fighter memory, power by depth, small math helpers).
// MS (biome -> boss kind) and the lair finder tC / nC (40849-40892) are in src/foes/lair.ts and are
// re-exported here so the boss modules have one import site.
import type { BiomeId } from '../../world/caverns';
import { BOSS_OF_BIOME, bossLair, type BossKind } from '../../foes/lair';

export { BOSS_OF_BIOME, bossLair, type BossKind }; // MS (40715), tC (40850)

/** jS (40714): the boss kinds in their fixed order. */
export const BOSS_KINDS: BossKind[] = [`titan`]; // jS (40714)

export type BossAct =
  | 'sleep'
  | 'wake'
  | 'idle'
  | 'walk'
  | 'roar'
  | 'die'
  | 'punch'
  | 'slam'
  | 'throw'
  | 'nova'
  | 'leap';

/** NS (40716): every boss action; a message carries the index. */
export const BOSS_ACTS: BossAct[] = [`sleep`, `wake`, `idle`, `walk`, `roar`, `die`, `punch`, `slam`, `throw`, `nova`, `leap`]; // NS (40716)

/** PS (40720): the wire index of an action. */
export const bossActIndex = (e: BossAct): number => BOSS_ACTS.indexOf(e); // PS (40720)

export type BossMode = 'sleep' | 'fight' | 'home' | 'dying' | 'dead';

/** FS (40721): the boss modes; a message carries the index. */
export const BOSS_MODES: BossMode[] = [`sleep`, `fight`, `home`, `dying`, `dead`]; // FS (40721)

/** One attack of a boss: animation length, cooldown, range [min, max], facing cone (0 = any), pick weight. */
export interface BossMove {
  act: BossAct;
  len: number;
  cd: number;
  min: number;
  max: number;
  cone: number;
  w: number;
}

export interface BossDef {
  kind: BossKind;
  biome: BiomeId;
  name: string;
  title: string;
  color: string;
  hp: number;
  speed: number;
  turn: number;
  radius: number;
  height: number;
  wakeR: number;
  keep: number;
  lens: { wake: number; roar: number; die: number };
  moves: BossMove[];
}

/** IS (40722): the biome bosses. Only RIMEHEART, the frost titan, is in this build. */
export const BOSS_DEFS: Record<BossKind, BossDef> = { // IS (40722)
  titan: {
    kind: `titan`,
    biome: `frost`,
    name: `RIMEHEART`,
    title: `the Glacier Titan`,
    color: `#9fe8ff`,
    hp: 6400,
    speed: 2.6,
    turn: 1.05,
    radius: 3.4,
    height: 8.8,
    wakeR: 30,
    keep: 6,
    lens: { wake: 3.83, roar: 3, die: 2.63 },
    moves: [
      { act: `punch`, len: 1.17, cd: 2.4, min: 0, max: 9, cone: 0.7, w: 5 },
      { act: `slam`, len: 1.63, cd: 6, min: 3, max: 21, cone: 0.5, w: 4 },
      { act: `throw`, len: 1.37, cd: 4.5, min: 7, max: 46, cone: 1.2, w: 3 },
      { act: `nova`, len: 2.1, cd: 14, min: 0, max: 13, cone: 0, w: 2.5 },
      { act: `leap`, len: 2.33, cd: 8, min: 9, max: 40, cone: 0, w: 3 },
    ],
  },
};

/** LS (40812): leap flight window [start, end] in seconds of the leap action. */
export const LEAP_WINDOW: Partial<Record<BossKind, [number, number]>> = { titan: [0.55, 1.5] }; // LS (40812)

/** RS (40813): seconds of target velocity each move leads its aim by (default 0.25). */
export const AIM_LEAD: Partial<Record<BossAct, number>> = { // RS (40813)
  punch: 0.5,
  slam: 0.95,
  throw: 1.85,
  nova: 1.55,
};
/** zS (40826): global scale of the aim lead. */
export const AIM_LEAD_SCALE = 0.85; // zS (40826)
/** BS (40827): distance beyond keep + radius at which the boss sprints. */
export const SPRINT_GAP = 6; // BS (40827)
/** VS (40828): sprint speed multiplier. */
export const SPRINT_MUL = 1.9; // VS (40828)
/** HS (40829): height above ground at which a target counts as perched. */
export const PERCH_HEIGHT = 2.5; // HS (40829)
/** US (40830): move weight multipliers against a perched target. */
export const PERCH_WEIGHT: Partial<Record<BossAct, number>> = { throw: 3, nova: 2 }; // US (40830)
/** WS (40831): seconds a slain boss rests before it can come back. */
export const BOSS_REST_S = 1200; // WS (40831)
/** GS (40832): seconds a fighter is remembered for the crew size. */
export const FIGHTER_MEMORY_S = 15; // GS (40832)

/** KS (40833): boss power by lair depth below the surface. */
export function bossPower(e: number): number { // KS (40833)
  return 1 + Math.max(0, e - 80) / 140;
}

/** QS (40847): round to 0.01. */
export const round2 = (e: number): number => Math.round(e * 100) / 100; // QS (40847)

/** $S (40848): wrap an angle to [-pi, pi]. */
export const wrapAngle = (e: number): number => Math.atan2(Math.sin(e), Math.cos(e)); // $S (40848)
