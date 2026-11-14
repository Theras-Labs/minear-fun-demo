// MINEAR lobby data (folder: minear-r3f/src/menus): the sample miners and trips the lobby board shows until
// an online board exists, and the player's own trip log (saved in this browser by Back to Base).
// The sample data is seeded, so it is the same on every visit; new sample trips keep arriving while the
// lobby is open (src/menus/lobby.ts adds one every few seconds). The board marks it as sample data.
import { ITEMS } from '../world/items';
import { DEPTH_LAYERS } from '../ui/depthBar';

/** One finished trip: who, how deep, how many things came home, the best find (an item id). */
export interface TripRow {
  name: string;
  deep: number;
  items: number;
  best: string | null;
  /** Up to 3 item ids found on the trip, best first (older saved trips have none). */
  finds?: string[];
  /** Date.now() ms when the trip ended. */
  at: number;
  you?: boolean;
}

export interface MinerRow {
  name: string;
  deepest: number;
  /** Where the deepest point is (a layer or biome name). */
  where: string;
  you?: boolean;
}

const TRIPS_KEY = `minear.trips`;
const MAX_SAVED = 30;

/** A small seeded random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = [`Dusty`, `Rusty`, `Lucky`, `Sleepy`, `Brave`, `Mossy`, `Sooty`, `Gritty`, `Shiny`, `Rocky`, `Muddy`, `Jolly`, `Quiet`, `Tiny`, `Grumpy`, `Swift`];
const NOUN = [`Mole`, `Digger`, `Miner`, `Burrow`, `Pebble`, `Nugget`, `Shovel`, `Tunnel`, `Claw`, `Geode`];
const ACCOUNTS = [`pebble`, `deepclaw`, `orewhale`, `molemama`, `quartzqueen`, `tunnelrat`, `nearmole`, `gemhunter`, `sootfoot`, `rimewalker`];

/** Rock layer names by depth (m), the same layers as the in-game depth bar, for the Depth board's "where". */
export const placeAt = (deep: number): string =>
  (DEPTH_LAYERS.find((l) => deep < l.bottom) ?? DEPTH_LAYERS[DEPTH_LAYERS.length - 1]).name;

/** Best-find gem by depth, from the game's gem drop table (world/items.ts GEM_DEPTH_TABLE minDepth):
 * [below this depth, gem]. Deeper trips find rarer gems. */
const FINDS: [number, string][] = [
  [3, `copper`],
  [12, `quartz`],
  [28, `amethyst`],
  [48, `emerald`],
  [75, `sapphire`],
  [150, `ruby`],
  [300, `sunstone`],
  [99999, `voidheart`],
];

/** The sample miners: 36 names (guest names and NEAR accounts) with their deepest point. */
export const SAMPLE_MINERS: MinerRow[] = (() => {
  const r = rng(20261113);
  const out: MinerRow[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 36; i++) {
    let name = ``;
    do {
      name =
        i % 4 === 1
          ? `${ACCOUNTS[Math.floor(r() * ACCOUNTS.length)]}${r() < 0.4 ? Math.floor(r() * 90 + 10) : ``}.minear.testnet`
          : // a NEAR testnet account of its own (the game creates <name>.minear.testnet; own wallets are <name>.testnet)
            `${ADJ[Math.floor(r() * ADJ.length)]}${NOUN[Math.floor(r() * NOUN.length)]}${Math.floor(r() * 90 + 10)}`.toLowerCase() + `.testnet`;
    } while (used.has(name));
    used.add(name);
    // a long tail: a few very deep miners, many shallow ones
    const deepest = Math.round(20 + 1080 * r() ** 2.4); // 20 m to 1,100 m: the depth bar's range
    out.push({ name, deepest, where: placeAt(deepest) });
  }
  return out.sort((a, b) => b.deepest - a.deepest);
})();

const tripRand = rng(7);

/** A made-up trip by a sample miner (`at` ms), its depth up to the miner's deepest. */
export function sampleTrip(at: number, r: () => number = tripRand): TripRow {
  const m = SAMPLE_MINERS[Math.floor(r() ** 1.3 * SAMPLE_MINERS.length)];
  const deep = Math.max(5, Math.round(m.deepest * (0.35 + 0.65 * r())));
  const items = Math.max(1, Math.round(4 + deep / 5 + (r() * deep) / 4));
  const roll = FINDS.findIndex(([d]) => deep < d);
  const k = Math.max(0, roll - (r() < 0.55 ? 1 : 0) - (r() < 0.2 ? 1 : 0));
  // 1-3 different finds: the best one and up to two from shallower bands
  const finds = [FINDS[k][1]];
  for (let n = Math.floor(r() * 3); n > 0 && k > 0; n--) {
    const f = FINDS[Math.floor(r() * k)][1];
    if (!finds.includes(f)) finds.push(f);
  }
  return { name: m.name, deep, items, best: FINDS[k][1], finds, at };
}

/** The first sample trips: 18 over the last 45 minutes, newest first. */
export function initialTrips(now = Date.now()): TripRow[] {
  const r = rng(Math.floor(now / 3_600_000)); // the same list within an hour
  const out: TripRow[] = [];
  let t = now - 20_000;
  for (let i = 0; i < 18; i++) {
    out.push(sampleTrip(t, r));
    t -= 40_000 + r() * 190_000;
  }
  return out;
}

/** The player's own finished trips (newest first), saved in this browser. */
export function loadTrips(): TripRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(TRIPS_KEY) ?? `[]`) as TripRow[];
    return Array.isArray(v) ? v.filter((t) => t && typeof t.name === `string` && Number.isFinite(t.deep)).map((t) => ({ ...t, you: true })) : [];
  } catch {
    return [];
  }
}

/** Back to Base adds the finished trip (src/base/backToBase.ts). */
export function recordTrip(t: TripRow): void {
  try {
    const list = [t, ...loadTrips()].slice(0, MAX_SAVED).map(({ you: _you, ...rest }) => rest);
    localStorage.setItem(TRIPS_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

/** Item colour (hex) for the chips. */
export const itemColor = (id: string | null): string =>
  `#${(((ITEMS as Record<string, { color: number }>)[id ?? ``]?.color ?? 0x9a7650) >>> 0).toString(16).padStart(6, `0`)}`;
export const itemName = (id: string | null): string => (ITEMS as Record<string, { name: string }>)[id ?? ``]?.name ?? ``;
export const itemKind = (id: string | null): string => (ITEMS as Record<string, { kind: string }>)[id ?? ``]?.kind ?? `ore`;

/** "now", "40 s", "3 min", "2 h". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return `now`;
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}
