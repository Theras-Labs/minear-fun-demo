// MINEAR: the mining-trip log. A trip runs from one "Finish mining trip" to the next. It keeps what the miner
// picked up (gems, ore, dice, supplies, souls), the deepest point reached, the damage dealt, and the records and
// the request index at the start, so the trip summary (src/base/haulShow.ts) can show what is new.
// Saved with the player (src/state/playerState.ts).

/**
 * MINEAR trip rules (user, 2026-11-14): a mining trip gives materials only (ore, gems, dice, supplies).
 * Gear comes from the Forge at base, never from underground, and a trip pays no coins.
 * Foes, chests, the worm and the bosses read these two flags before they hand out gear or coins.
 */
export const TRIP_GIVES_GEAR = false;
export const TRIP_GIVES_COINS = false;

/** Ore ids from the cheapest up (the Refinery smelts each into the next; the skill tree prices by this order). */
export const ORE_IDS = [`copper`, `iron`, `gold`, `mythril`] as const;
/** MINEAR (user, 2026-11-15): every material a trip brings home and the Forge uses, cheapest first: stone (from
 *  common rock), then the ores. Stone is not an ore of the Refinery or the skill tree, so ORE_IDS leaves it out. */
export const MATERIAL_IDS = [`stone`, ...ORE_IDS] as const;
export type OreId = (typeof MATERIAL_IDS)[number];
export const isOreId = (v: unknown): v is OreId => (MATERIAL_IDS as readonly unknown[]).includes(v);

export interface RunLog {
  /** Date.now() when the expedition started. */
  at: number;
  /** Deepest metres below the surface this expedition. */
  deep: number;
  /** The player's earned-coins counter at the start. */
  earned0: number;
  /** What the miner picked up: item id -> count. */
  took: Record<string, number>;
  /** Gear uids held (worn, carried, stashed) at the start. */
  uids0: number[];
  /** The deepest record (m) at the start, for "New record". */
  best0: number;
  /** Damage the miner dealt this trip (foes, the worm, bosses). */
  dmg: number;
  /** The best damage of one trip at the start, for "New record". */
  dmgBest0: number;
  /** The request (goal) index at the start; -1 when not known (an older save). */
  goal0: number;
}

export interface RunStart {
  earned: number;
  uids: number[];
  best: number;
  dmgBest: number;
  goal: number;
}

export const newRun = (r: RunStart): RunLog => ({
  at: Date.now(),
  deep: 0,
  earned0: r.earned,
  took: {},
  uids0: r.uids.slice(-400),
  best0: r.best,
  dmg: 0,
  dmgBest0: r.dmgBest,
  goal0: r.goal,
});

/** Validates a saved run log (null when missing or broken). */
export function readRun(v: unknown): RunLog | null {
  if (!v || typeof v !== `object`) return null;
  const r = v as Partial<RunLog>;
  const fin = (n: unknown, d: number) => (Number.isFinite(n) ? Math.max(0, n as number) : d);
  const deep = fin(r.deep, 0);
  const took: Record<string, number> = {};
  if (r.took && typeof r.took === `object`)
    for (const [k, n] of Object.entries(r.took)) if (Number.isFinite(n) && (n as number) > 0) took[k] = Math.floor(n as number);
  return {
    at: Number.isFinite(r.at) ? (r.at as number) : Date.now(),
    deep,
    earned0: fin(r.earned0, 0),
    took,
    uids0: Array.isArray(r.uids0) ? r.uids0.filter((n) => Number.isFinite(n)).slice(-400) : [],
    // an older save has no start records: no "New record" for that trip
    best0: fin(r.best0, deep),
    dmg: fin(r.dmg, 0),
    dmgBest0: fin(r.dmgBest0, Number.isFinite(r.dmg) ? (r.dmg as number) : 0),
    goal0: Number.isFinite(r.goal0) ? Math.floor(r.goal0 as number) : -1,
  };
}
