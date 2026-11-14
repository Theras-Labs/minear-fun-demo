// Progression math: gem exp values, the level curve, depth tiers and rarity weights.
// Bundle play-inUT-NSi.js lines 50591-50633.
import { GEM_IDS } from '../world/items';

/** Wellspring exp per gem id. */
export const GEM_EXP: Record<string, number> = { // rk (50591)
  quartz: 10,
  amethyst: 25,
  emerald: 60,
  bogjade: 150,
  rime: 160,
  sapphire: 120,
  ruby: 260,
  fireopal: 340,
  soulpearl: 360,
  sunstone: 650,
  voidheart: 1600,
};

/** Exp a gem gives at the Wellspring (10 for an unknown id). */
export const gemExp = (id: string): number => GEM_EXP[id] ?? 10; // ik (50604)
/** Exp needed to go from level lvl to lvl + 1. */
export const expToNext = (lvl: number): number => 10 * lvl * lvl; // ak (50605)
/** The old (curve 1) exp per level. */
export const oldExpToNext = (lvl: number): number => 30 * lvl * lvl; // ok (50606)

/** Moves (level, exp) from the old curve to the current one. */
export function relevel(lvl: number, exp: number): { lvl: number; exp: number } { // sk (50607)
  let n = exp;
  for (let t = 1; t < lvl; t++) n += oldExpToNext(t);
  let r = 1;
  for (; n >= expToNext(r); ) ((n -= expToNext(r)), r++);
  return { lvl: r, exp: n };
}

/** The rarer of two gem ids (by GEM_IDS order); a null best always loses. */
export function rarerGem(best: string | null, id: string): string { // ck (50614)
  return best === null || GEM_IDS.indexOf(id as never) > GEM_IDS.indexOf(best as never) ? id : best;
}

export const depthRate = (e: number): number => (3 + 0.08 * Math.max(0, e)) / 60; // lk (50617)
export const BASE_RATE = 8 / 60; // uk (50618)
/** Depth tier: 25 m bands above 100 m, 100 m bands below. */
export const depthTier = (e: number): number => (e < 100 ? Math.floor(Math.max(0, e) / 25) : 3 + Math.floor(e / 100)); // dk (50619)
/** Start depth of a depth tier. */
export const tierStart = (e: number): number => (e <= 4 ? e * 25 : (e - 3) * 100); // fk (50620)
/** Base rarity weights: Common, Uncommon, Rare, Epic, Legendary. */
export const RARITY_WEIGHTS = [42, 24.5, 26, 6, 1.5]; // pk (50621)

/** Normalized rarity distribution for a luck (or level) value. */
export function rarityOdds(e: number): number[] { // mk (50622)
  const t = 1 + Math.max(0, e) / 100,
    n = RARITY_WEIGHTS.map((e, n) => e * t ** (n / 2)),
    r = n.reduce((e, t) => e + t, 0);
  return n.map((e) => e / r);
}

export const luckCurve = (e: number): number => Math.max(0, e) / (Math.max(0, e) + 200); // hk (50628)
export const luckBump = (e: number): number => luckCurve(e) ** 2 * 0.4; // gk (50629)
/** Gem ids sorted by GEM_IDS order. */
export const sortGems = <T extends string>(e: T[]): T[] => [...e].sort((e, t) => GEM_IDS.indexOf(e as never) - GEM_IDS.indexOf(t as never)); // _k (50630)
export const TIER_NAMES = [`Common`, `Uncommon`, `Rare`, `Epic`, `Legendary`]; // vk (50631)
export const TIER_COLORS = [`#e9eef5`, `#7be08f`, `#5fb4ff`, `#c38bff`, `#ffc23d`]; // yk (50632)
export const TIER_DARK = [`#7a6450`, `#23914a`, `#2a74c8`, `#8446d6`, `#c07f00`]; // bk (50633)
