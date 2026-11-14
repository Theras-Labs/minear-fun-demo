// MINEAR cheats: switches that make the deep world quick to explore and test.
//   god     the player takes no damage (foe hits, bombs, burn and poison)
//   hidden  foes, bosses and the worm do not see the player (no targets, no camp wake-ups, no ambush heat)
//   claws   claw endurance never goes down (src/game/clawEndurance.ts)
//   jet     the jetpack fuel never runs out (Game.update tops it up each frame)
//   fast    burrow at full speed through each rock that is ticked in `rocks`, at `speed` times the burrow speed
// MINEAR rule (user, 2026-11-14): cheats exist ONLY in the dev-local "Demo cheat" entry (CHEAT in
// minear-r3f/src/game/entry.ts: ?mode=cheat on the Vite dev server on this machine). In the demo and the
// signed-in game every switch is off and setCheat does nothing; the Cheats panel is not made.
// The panel is src/ui/cheatPanel.ts (the Cheats chip under the FPS meter, or the ` key).
// In the Demo cheat all of them are on by default and saved in this browser (localStorage minear.cheats).
// URL overrides for one visit (nothing is saved during that visit):
//   ?cheats=off      every cheat off
//   ?claws=limited   only the claw cheat off
import { MATERIALS, Mat } from '../world/materials';
import { CHEAT } from './entry';

export interface CheatRock {
  id: string;
  name: string;
  /** Material ids; the first one gives the panel swatch colour. */
  mats: number[];
}

/** The rock groups the fast burrow can unlock, from the surface down, then the ores and the biome rock. */
export const CHEAT_ROCKS: CheatRock[] = [
  { id: `dirt`, name: `Grass and Dirt`, mats: [Mat.Dirt, Mat.Grass] },
  { id: `sand`, name: `Sandstone`, mats: [Mat.Sand, Mat.SandStripe] },
  { id: `stone`, name: `Stone`, mats: [Mat.Stone] },
  { id: `slate`, name: `Slate`, mats: [Mat.Slate] },
  { id: `abyss`, name: `Abyssal Rock`, mats: [Mat.Abyss] },
  { id: `obsidian`, name: `Obsidian`, mats: [Mat.Obsidian] },
  { id: `ember`, name: `Emberstone`, mats: [Mat.Ember] },
  { id: `void`, name: `Voidstone`, mats: [Mat.Void] },
  { id: `heart`, name: `Heartstone`, mats: [Mat.Heart] },
  {
    id: `ore`,
    name: `Ore veins`,
    mats: [Mat.Copper, Mat.Iron, Mat.Gold, Mat.Mythril],
  },
  {
    id: `biome`,
    name: `Biome rock and boulders`,
    mats: [
      Mat.Basalt,
      Mat.Magma,
      Mat.Mud,
      Mat.Bogmoss,
      Mat.Frostrock,
      Mat.Ice,
      Mat.Snow,
      Mat.Ashstone,
      Mat.Bonestone,
      Mat.Boulder,
    ],
  },
];

/** The hardest material of a rock group. */
export const rockHardness = (r: CheatRock): number => Math.max(...r.mats.map((m) => MATERIALS[m]?.hardness ?? 1));

/** Burrow speed choices (times the normal burrow and bore speed). */
export const BURROW_SPEEDS = [1, 2, 3] as const;

export interface Cheats {
  god: boolean;
  hidden: boolean;
  claws: boolean;
  jet: boolean;
  fast: boolean;
  speed: number;
  rocks: Record<string, boolean>;
}

const KEY = `minear.cheats`;

const defaults = (): Cheats => ({
  god: CHEAT,
  hidden: CHEAT,
  claws: CHEAT,
  jet: CHEAT,
  fast: CHEAT,
  speed: 3,
  rocks: Object.fromEntries(CHEAT_ROCKS.map((r) => [r.id, true])),
});

const url = typeof location === `undefined` ? null : new URLSearchParams(location.search);
const allOff = url?.get(`cheats`) === `off`;
const clawsOff = url?.get(`claws`) === `limited`;
/** False while a URL override is active: changes in the panel then last for this visit only. */
export const CHEATS_SAVED = !allOff && !clawsOff;

function load(): Cheats {
  const c = defaults();
  if (!CHEAT) return c; // every switch off outside the Demo cheat, whatever this browser saved
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Cheats>;
      for (const k of [`god`, `hidden`, `claws`, `jet`, `fast`] as const) if (typeof s[k] === `boolean`) c[k] = s[k];
      if (typeof s.speed === `number` && (BURROW_SPEEDS as readonly number[]).includes(s.speed)) c.speed = s.speed;
      if (s.rocks && typeof s.rocks === `object`)
        for (const r of CHEAT_ROCKS) if (typeof s.rocks[r.id] === `boolean`) c.rocks[r.id] = s.rocks[r.id];
    }
  } catch {}
  if (allOff) c.god = c.hidden = c.claws = c.jet = c.fast = false;
  if (clawsOff) c.claws = false;
  return c;
}

/** The live cheat switches. Change them through setCheat so the rock table and the save stay current. */
export const cheats: Cheats = load();

/** fastMat[material id] = 1 when the fast burrow takes that material at full speed. */
const fastMat = new Uint8Array(64);
function indexRocks(): void {
  fastMat.fill(0);
  if (!cheats.fast) return;
  for (const r of CHEAT_ROCKS) if (cheats.rocks[r.id]) for (const m of r.mats) fastMat[m] = 1;
}
indexRocks();

/** True when the fast burrow cheat digs this material at the full rate (as if Burrow Power were high enough). */
export function fastRock(mat: number): boolean {
  return fastMat[mat] === 1;
}

/** The same test in the shape world.dig takes; undefined when the fast burrow is off. */
export function fastDig(): ((mat: number) => boolean) | undefined {
  return cheats.fast ? fastRock : undefined;
}

/** Burrow and bore speed factor (1 when the fast burrow is off). */
export function cheatSpeed(): number {
  return cheats.fast ? cheats.speed : 1;
}

/** True when at least one cheat is on. */
export function anyCheat(): boolean {
  return cheats.god || cheats.hidden || cheats.claws || cheats.jet || cheats.fast;
}

const listeners = new Set<(c: Cheats) => void>();
/** Calls fn after each change; returns the function that stops it. */
export function onCheats(fn: (c: Cheats) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Changes the switches, rebuilds the rock table, saves (when no URL override is active) and tells the listeners. */
export function setCheat(patch: Partial<Omit<Cheats, `rocks`>> & { rocks?: Record<string, boolean> }): void {
  if (!CHEAT) return;
  const { rocks, ...rest } = patch;
  Object.assign(cheats, rest);
  if (rocks) Object.assign(cheats.rocks, rocks);
  indexRocks();
  if (CHEATS_SAVED)
    try {
      localStorage.setItem(KEY, JSON.stringify(cheats));
    } catch {}
  for (const fn of listeners) fn(cheats);
}

// ---- Stock up (the Cheats panel's "Stock up" buttons) ----------------------------------------------------
// Ores and gems are minted on chain into the player's vault on the local chain (POST /dev/grant on
// the local server, minear-r3f/server/src/devGrant.ts), so the Forge and the skill tree spend them the same way
// as in the real game. Capsule Coins are not on chain: they go to the save game. Never on testnet.

/** What one Stock up click adds. */
export const STOCK_UP = { ore: 200, gem: 20, capsules: 10 } as const;
export type StockKind = `ore` | `gem` | `capsules` | `all`;

export interface StockPlan {
  /** Game item ids and counts to mint on the local chain. */
  items: [string, number][];
  capsules: number;
  /** The words for a toast. */
  words: string;
}

/** What a Stock up click of `kind` gives. */
export function stockPlan(kind: StockKind, oreIds: readonly string[], gemIds: readonly string[]): StockPlan {
  const items: [string, number][] = [];
  const got: string[] = [];
  if (kind === `ore` || kind === `all`) {
    for (const id of oreIds) items.push([id, STOCK_UP.ore]);
    got.push(`+${STOCK_UP.ore} of each ore`);
  }
  if (kind === `gem` || kind === `all`) {
    for (const id of gemIds) items.push([id, STOCK_UP.gem]);
    got.push(`+${STOCK_UP.gem} of each gem`);
  }
  const capsules = kind === `capsules` || kind === `all` ? STOCK_UP.capsules : 0;
  if (capsules) got.push(`+${capsules} Capsule Coins`);
  return { items, capsules, words: got.join(`, `) };
}
