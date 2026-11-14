// Port of play-inUT-NSi.js 43196-43614: the foe type table xw ("the Lost"), the biome-at-point helper Sw,
// the foe projectile table ww, the rock splash radius Tw, the state and loop name lists Ew / Dw and the foe
// tuning constants Ow..Bw, Vw. The A* constants Hw, Uw, Ww live in ./nav.
import { cavernAtWorld, cavernMetric, type BiomeId } from '../world/caverns';

export type FoeKind =
  | 'miner'
  | 'scout'
  | 'guard'
  | 'caller'
  | 'burrower'
  | 'golem'
  | 'cinder'
  | 'pyre'
  | 'drowned'
  | 'spitter'
  | 'wight'
  | 'rimecaller'
  | 'wraith';

export type FoeAttack = 'melee' | 'bolt' | 'orb';
export type FoeLook = 'cinder' | 'drowned' | 'rime' | 'wraith' | 'dust';
export type FoeShotKind = 'bolt' | 'orb' | 'rock';
export type FoeState = 'rise' | 'hunt' | 'attack' | 'hurt' | 'idle' | 'dead' | 'hurl' | 'mend' | 'dig';
export type FoeLoop = 'walk' | 'idle' | 'taunt' | 'run';

export interface FoeHurl {
  min: number;
  max: number;
  cooldown: number;
  /** Damage multiplier of the thrown rock. */
  dmg: number;
  clip: string;
  rate: number;
  len: number;
  /** Release point as a fraction of the clip. */
  at: number;
}

export interface FoeMend {
  every: number;
  frac: number;
  time: number;
  clip: string;
}

export interface FoeDigger {
  speed: number;
  r: number;
  clip: string;
  rate: number;
}

export interface FoeDef {
  node: string;
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  attack: FoeAttack;
  range: number;
  keep: number;
  cooldown: number;
  hitAt: number;
  walk: string;
  run?: string;
  runPace?: number;
  swing: string;
  swingRate: number;
  swingLen: number;
  weapon: { r?: string; l?: string };
  minDepth: number;
  weight: number;
  ore: [string, number][];
  gem: number;
  gear: number;
  radius: number;
  height?: number;
  scale?: number;
  surface?: boolean;
  hurl?: FoeHurl;
  mend?: FoeMend;
  look?: FoeLook;
  digger?: FoeDigger;
  biome?: BiomeId;
  /** Element weights [burn, poison, chill] of the foe's hits. */
  el?: [number, number, number];
  wades?: boolean;
  burst?: number;
  ghost?: boolean;
  drain?: number;
}

/** xw (43196): every regular foe. Key order matters (pickKind and warmUp iterate it). */
export const FOE_TYPES: Record<FoeKind, FoeDef> = { // xw (43196)
  miner: {
    node: `F_Miner`,
    name: `Lost Miner`,
    hp: 150,
    speed: 5.6,
    dmg: 24,
    attack: `melee`,
    range: 2,
    keep: 0,
    cooldown: 1.15,
    hitAt: 0.42,
    walk: `Running_A`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 1.15,
    swingLen: 1.0667,
    weapon: { r: `F_W_Pick` },
    minDepth: 10,
    weight: 10,
    ore: [
      [`copper`, 6],
      [`iron`, 4],
    ],
    gem: 0.14,
    gear: 0.03,
    radius: 0.5,
  },
  scout: {
    node: `F_Scout`,
    name: `Lost Scout`,
    hp: 110,
    speed: 4.9,
    dmg: 20,
    attack: `bolt`,
    range: 24,
    keep: 10,
    cooldown: 1.7,
    hitAt: 0.42,
    walk: `Running_A`,
    swing: `Ranged_1H_Shoot`,
    swingRate: 1,
    swingLen: 1.0667,
    weapon: { r: `F_W_Crossbow` },
    minDepth: 22,
    weight: 6,
    ore: [
      [`iron`, 6],
      [`gold`, 2],
    ],
    gem: 0.2,
    gear: 0.04,
    radius: 0.5,
  },
  guard: {
    node: `F_Guard`,
    name: `Lost Guard`,
    hp: 440,
    speed: 4.6,
    dmg: 48,
    attack: `melee`,
    range: 2.2,
    keep: 0,
    cooldown: 1.6,
    hitAt: 0.5,
    walk: `Running_B`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 0.95,
    swingLen: 1.0667,
    weapon: { r: `F_W_Blade`, l: `F_W_Shield` },
    minDepth: 40,
    weight: 4,
    ore: [
      [`gold`, 6],
      [`iron`, 6],
    ],
    gem: 0.32,
    gear: 0.1,
    radius: 0.58,
  },
  caller: {
    node: `F_Caller`,
    name: `Deep Caller`,
    hp: 250,
    speed: 3.4,
    dmg: 38,
    attack: `orb`,
    range: 26,
    keep: 12,
    cooldown: 2.3,
    hitAt: 0.55,
    walk: `Running_B`,
    swing: `Ranged_Magic_Shoot`,
    swingRate: 1,
    swingLen: 0.9333,
    weapon: { r: `F_W_Staff` },
    minDepth: 65,
    weight: 3,
    ore: [
      [`gold`, 6],
      [`mythril`, 2],
    ],
    gem: 0.45,
    gear: 0.1,
    radius: 0.5,
  },
  burrower: {
    node: `F_Miner`,
    name: `Lost Burrower`,
    hp: 230,
    speed: 5,
    dmg: 26,
    attack: `melee`,
    range: 2,
    keep: 0,
    cooldown: 1.2,
    hitAt: 0.42,
    walk: `Running_A`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 1.15,
    swingLen: 1.0667,
    weapon: { r: `F_W_Drill` },
    minDepth: 18,
    weight: 5,
    ore: [
      [`iron`, 6],
      [`copper`, 4],
    ],
    gem: 0.22,
    gear: 0.05,
    radius: 0.5,
    look: `dust`,
    digger: { speed: 4.4, r: 1.3, clip: `Melee_1H_Attack_Stab`, rate: 1.6 },
  },
  golem: {
    node: `F_Golem`,
    name: `Stone Golem`,
    hp: 2600,
    speed: 7.8,
    dmg: 60,
    attack: `melee`,
    range: 3.6,
    keep: 0,
    cooldown: 1.8,
    hitAt: 0.52,
    walk: `Skeletons_Walking`,
    run: `Running_B`,
    runPace: 11,
    swing: `Melee_2H_Attack_Chop`,
    swingRate: 0.9,
    swingLen: 1.6333,
    weapon: {},
    minDepth: 0,
    weight: 0,
    ore: [
      [`iron`, 10],
      [`gold`, 8],
    ],
    gem: 1,
    gear: 0.35,
    radius: 1.3,
    height: 3.4,
    scale: 2.6,
    surface: true,
    hurl: {
      min: 7,
      max: 34,
      cooldown: 5.5,
      dmg: 0.8,
      clip: `Throw`,
      rate: 0.8,
      len: 1.3667,
      at: 0.5,
    },
    mend: { every: 15, frac: 0.15, time: 2.6, clip: `Ranged_Magic_Spellcasting` },
  },
  cinder: {
    node: `F_Miner`,
    name: `Cinder Husk`,
    hp: 190,
    speed: 6.3,
    dmg: 26,
    attack: `melee`,
    range: 2,
    keep: 0,
    cooldown: 1.05,
    hitAt: 0.42,
    walk: `Running_A`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 1.25,
    swingLen: 1.0667,
    weapon: { r: `F_W_Axe` },
    minDepth: 0,
    weight: 10,
    ore: [
      [`iron`, 4],
      [`gold`, 3],
    ],
    gem: 0.2,
    gear: 0.04,
    radius: 0.5,
    biome: `ember`,
    el: [0.35, 0, 0],
    wades: true,
    burst: 32,
    look: `cinder`,
  },
  pyre: {
    node: `F_Caller`,
    name: `Pyre Caller`,
    hp: 260,
    speed: 3.6,
    dmg: 34,
    attack: `orb`,
    range: 24,
    keep: 11,
    cooldown: 2.1,
    hitAt: 0.55,
    walk: `Running_B`,
    swing: `Ranged_Magic_Shoot`,
    swingRate: 1,
    swingLen: 0.9333,
    weapon: { r: `F_W_Staff` },
    minDepth: 0,
    weight: 5,
    ore: [
      [`gold`, 5],
      [`iron`, 3],
    ],
    gem: 0.38,
    gear: 0.08,
    radius: 0.5,
    biome: `ember`,
    el: [0.5, 0, 0],
    wades: true,
    look: `cinder`,
  },
  drowned: {
    node: `F_Guard`,
    name: `Bog Drowned`,
    hp: 360,
    speed: 3.9,
    dmg: 30,
    attack: `melee`,
    range: 2.1,
    keep: 0,
    cooldown: 1.4,
    hitAt: 0.5,
    walk: `Running_B`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 0.95,
    swingLen: 1.0667,
    weapon: { r: `F_W_Axe` },
    minDepth: 0,
    weight: 9,
    ore: [
      [`copper`, 6],
      [`iron`, 5],
    ],
    gem: 0.25,
    gear: 0.06,
    radius: 0.58,
    biome: `bog`,
    el: [0, 0.3, 0],
    look: `drowned`,
  },
  spitter: {
    node: `F_Scout`,
    name: `Bog Spitter`,
    hp: 140,
    speed: 4.6,
    dmg: 18,
    attack: `bolt`,
    range: 22,
    keep: 10,
    cooldown: 1.8,
    hitAt: 0.42,
    walk: `Running_A`,
    swing: `Ranged_1H_Shoot`,
    swingRate: 1,
    swingLen: 1.0667,
    weapon: { r: `F_W_Crossbow` },
    minDepth: 0,
    weight: 6,
    ore: [[`iron`, 5]],
    gem: 0.22,
    gear: 0.05,
    radius: 0.5,
    biome: `bog`,
    el: [0, 0.45, 0],
    look: `drowned`,
  },
  wight: {
    node: `F_Guard`,
    name: `Frost Wight`,
    hp: 480,
    speed: 4.2,
    dmg: 42,
    attack: `melee`,
    range: 2.3,
    keep: 0,
    cooldown: 1.7,
    hitAt: 0.5,
    walk: `Running_B`,
    swing: `Melee_1H_Attack_Chop`,
    swingRate: 0.9,
    swingLen: 1.0667,
    weapon: { r: `F_W_Blade`, l: `F_W_Shield` },
    minDepth: 0,
    weight: 8,
    ore: [
      [`iron`, 6],
      [`gold`, 4],
    ],
    gem: 0.35,
    gear: 0.1,
    radius: 0.62,
    height: 2.1,
    scale: 1.12,
    biome: `frost`,
    el: [0, 0, 0.45],
    look: `rime`,
  },
  rimecaller: {
    node: `F_Caller`,
    name: `Rime Caller`,
    hp: 240,
    speed: 3.4,
    dmg: 30,
    attack: `orb`,
    range: 24,
    keep: 12,
    cooldown: 2.2,
    hitAt: 0.55,
    walk: `Running_B`,
    swing: `Ranged_Magic_Shoot`,
    swingRate: 1,
    swingLen: 0.9333,
    weapon: { r: `F_W_Staff` },
    minDepth: 0,
    weight: 5,
    ore: [
      [`gold`, 5],
      [`mythril`, 1],
    ],
    gem: 0.38,
    gear: 0.08,
    radius: 0.5,
    biome: `frost`,
    el: [0, 0, 0.6],
    look: `rime`,
  },
  wraith: {
    node: `F_Scout`,
    name: `Hollow Wraith`,
    hp: 170,
    speed: 4.6,
    dmg: 22,
    attack: `melee`,
    range: 1.8,
    keep: 0,
    cooldown: 1.3,
    hitAt: 0.45,
    walk: `Skeletons_Idle`,
    swing: `Melee_1H_Attack_Slice_Diagonal`,
    swingRate: 1.2,
    swingLen: 1.0667,
    weapon: {},
    minDepth: 0,
    weight: 10,
    ore: [[`gold`, 3]],
    gem: 0.3,
    gear: 0.06,
    radius: 0.5,
    biome: `haunt`,
    el: [0, 0, 0.2],
    ghost: true,
    drain: 0.5,
    look: `wraith`,
  },
};

/** The foe kinds in table order (Object.keys(xw)). */
export const FOE_KINDS = Object.keys(FOE_TYPES) as FoeKind[];

/** Sw (43576): biome of the cavern at a point when inside it (metric < 1.05), else null. */
export function biomeAt(e: { x: number; y: number; z: number }): BiomeId | null { // Sw (43576)
  const t = cavernAtWorld(e.x, e.y, e.z);
  return t && cavernMetric(t, e.x, e.y, e.z) < 1.05 ? t.biome : null;
}

/** ww (43581): foe projectile speed and gravity. */
export const FOE_SHOTS: Record<FoeShotKind, { speed: number; gravity: number }> = { // ww (43581)
  bolt: { speed: 24, gravity: 5 },
  orb: { speed: 10, gravity: 0 },
  rock: { speed: 0, gravity: 20 },
};

/** Tw (43586): splash radius of a golem rock. */
export const ROCK_SPLASH_R = 3.2; // Tw (43586)
/** Ew (43587): foe state names; the index is sent on the wire. */
export const FOE_STATES: FoeState[] = [`rise`, `hunt`, `attack`, `hurt`, `idle`, `dead`, `hurl`, `mend`, `dig`]; // Ew (43587)
/** Dw (43588): leg loop names; the index is sent on the wire. */
export const FOE_LOOPS: FoeLoop[] = [`walk`, `idle`, `taunt`, `run`]; // Dw (43588)

export const MAX_ACTIVE_NEAR = 9; // Ow (43589) max live foes near a player before dormant spots stop waking
export const GOLEM_SPOT_COUNT = 6; // kw (43590)
export const GOLEM_WAKE_R = 130; // Aw (43591)
export const GOLEM_AGGRO_R = 30; // jw (43592)
export const GOLEM_LEASH_R = 60; // Mw (43593) golem chases only targets within this of its home
export const GOLEM_TOWN_KEEP = 26; // Nw (43594) golem ignores targets within this of the town
export const AMBUSH_DEPTH = 120; // Pw (43595)
export const AMBUSH_LINE = 240; // Fw (43596) base heat line
export const CHAMPION_HP = 3; // Iw (43597)
export const CHAMPION_DMG = 1.35; // Lw (43598)
export const SPOT_WAKE_R = 16; // Rw (43599)
export const CREW_R = 48; // zw (43600) crew / activeNear / leash radius
export const TOWN_NO_SPAWN_R = 26; // Bw (43601)
export const SPOT_RESPAWN = 300; // Vw (43602) seconds a spot stays spent after a kill

// MINEAR foe senses. A foe sees a player only along an open line (no rock between their chests).
/** Seconds a foe keeps hunting without seeing its target; then it gives up and wanders back home. */
export const LOSE_TRACK_S = 4;
/** Seconds a hunting melee foe (or wraith) may stay within 1 m of one point (it cannot get closer) before it gives up. */
export const STALL_GIVE_UP_S = 6;
/** Seconds a foe that gave up stays home and ignores its target. */
export const HOME_CALM_S = 8;
/** How often (seconds) a foe checks its line of sight to its target. */
export const SIGHT_CHECK_S = 0.25;
/**
 * KR burrowers dig straight through rock to a player they cannot reach. That is a specialized-monster
 * behavior, so it is off: the Lost Burrower fights like the other Lost. Set true to bring the digging back.
 */
export const FOE_DIGGING = false;
/**
 * MINEAR: cave foes (camps and deep ambushes) spawn only inside the biome caverns (the great caverns). In a
 * cavern, 66% of rolls are its own kinds and the rest are the Lost. KR also camped the Lost in every natural
 * cave below 10 m. Surface golems, boss adds and the tutorial practice miners are not affected.
 */
export const FOES_BIOME_ONLY = true;
