// THE FORGE RULES (folder: minear-r3f/src/economy): one file for the game and the chain.
// The items contract runs the Forge (minear-r3f/contracts/items/src/gear.rs: forge, reroll, salvage). These
// tables are its settings: minear-r3f/server/tools/setup.ts sends forgeChainConfig() to `set_forge`, and the
// game's Forge panels (minear-r3f/src/base/workshop.ts, forgeView.ts) read the same tables for costs and odds.
// No imports with runtime code, so the bun setup tool can read it too.
import type { OreId } from '../base/run';
import type { GearSlotType } from '../state/gear';

export interface ForgeGrade {
  id: OreId;
  name: string;
  ore: OreId;
  n: number;
  coins: number;
  /** More materials the recipe needs besides `ore` (the list under the metal tiles). */
  also?: { ore: OreId; n: number }[];
  /** Tier weights [common, uncommon, rare, epic, legendary]. */
  weights: number[];
}

/** MINEAR rule (the user, 2026-11-13): making, refining and upgrading are paid in MATERIALS only. NEAR coins
 *  pay only the network gas of an on-chain action (or the relayer pays it for a wallet with no NEAR), so the
 *  coin costs here are 0. The fields stay for old saves and the panel code. */
export const FORGE_GRADES: ForgeGrade[] = [
  { id: `iron`, name: `Iron forging`, ore: `iron`, n: 20, coins: 0, weights: [55, 35, 9, 1, 0] },
  { id: `gold`, name: `Gold forging`, ore: `gold`, n: 12, coins: 0, also: [{ ore: `iron`, n: 10 }], weights: [8, 40, 40, 10, 2] },
  { id: `mythril`, name: `Mythril forging`, ore: `mythril`, n: 6, coins: 0, also: [{ ore: `gold`, n: 6 }], weights: [0, 6, 42, 40, 12] },
];

/** Every material one make of a grade takes: its own metal first, then the others. */
export const forgeNeeds = (g: ForgeGrade): { ore: OreId; n: number }[] => [{ ore: g.ore, n: g.n }, ...(g.also ?? [])];

/** One thing the Forge makes: a piece (gear base) for a slot. A make gives exactly that piece in the chosen
 *  metal (an Iron Knight Helm, a Gold Jetpack), like theras-rpg-template's Copper or Iron Helmet: the metal sets the item
 *  (user, 2026-11-14). The Claws slot has three tools (minear-r3f/src/game/digTools.ts). */
export interface ForgeKind {
  id: string;
  slot: GearSlotType;
  name: string;
  base: string;
  /** The piece's name in the NFT title on chain ("Legendary Iron Knight Helm"). */
  title: string;
}

/** The Forge's step-1 tiles, in order. */
export const FORGE_SLOTS: ForgeKind[] = [
  { id: `claws`, slot: `drill`, name: `Claws`, base: `bit`, title: `Burrow Claws` },
  { id: `gauntlet`, slot: `drill`, name: `Gauntlet`, base: `gauntlet`, title: `Mining Gauntlet` },
  { id: `jetpump`, slot: `drill`, name: `Jet Pump`, base: `jetpump`, title: `Jet Pump` },
  { id: `head`, slot: `head`, name: `Head`, base: `knighthelm`, title: `Knight Helm` },
  { id: `back`, slot: `body`, name: `Back`, base: `knightcape`, title: `Knight Cape` },
  { id: `launcher`, slot: `launcher`, name: `Launcher`, base: `heavyxbow`, title: `Heavy Crossbow` },
  { id: `pack`, slot: `pack`, name: `Pack`, base: `jetpack`, title: `Jetpack` },
  { id: `charm`, slot: `charm`, name: `Charm`, base: `shield`, title: `Round Shield` },
];

/** What salvaging a piece of gear gives back, by tier. */
export const SALVAGE: Record<number, Partial<Record<OreId, number>>> = {
  0: { copper: 6, iron: 2 },
  1: { iron: 8 },
  2: { iron: 6, gold: 4 },
  3: { gold: 6, mythril: 2 },
  4: { mythril: 6 },
};

/** Rerolling a piece's enchants (every stat but the first, built-in one): ore by tier (no coins). */
export function rerollCostOf(tier: number): { ore: OreId; n: number; coins: number } {
  return tier >= 3 ? { ore: `mythril`, n: tier === 4 ? 4 : 2, coins: 0 } : { ore: `gold`, n: 2 + tier * 2, coins: 0 };
}

/** Most pieces one Forge call makes (the x10 button). */
export const FORGE_MAX_MAKE = 10;
/** The stat level range: the owner's best trip depth is kept within it. */
export const FORGE_LVL: [number, number] = [10, 900];
/** The deepest a trip report may say: the world's bottom (Heartstone, 1,100 m) with a margin. */
export const MAX_TRIP_DEPTH_M = 1200;

const ORE_NAME: Record<string, string> = { copper: `Copper`, iron: `Iron`, gold: `Gold`, mythril: `Mythril` };
const tok = (ore: string) => `ore.${ore}`;

/** The contract's ForgeConfig (gear.rs), for setup.ts `set_forge`. */
export function forgeChainConfig() {
  return {
    grades: FORGE_GRADES.map((g) => ({
      id: g.id,
      name: ORE_NAME[g.ore] ?? g.ore,
      inputs: forgeNeeds(g).map((m) => [tok(m.ore), String(m.n)]),
      weights: g.weights,
    })),
    kinds: FORGE_SLOTS.map((k) => ({ base: k.base, name: k.title })),
    salvage: [0, 1, 2, 3, 4].map((t) => Object.entries(SALVAGE[t] ?? {}).map(([ore, n]) => [tok(ore), String(n)])),
    reroll: [0, 1, 2, 3, 4].map((t) => (t === 0 ? [] : [[tok(rerollCostOf(t).ore), String(rerollCostOf(t).n)]])),
    max_make: FORGE_MAX_MAKE,
    lvl_min: FORGE_LVL[0],
    lvl_max: FORGE_LVL[1],
    max_depth_m: MAX_TRIP_DEPTH_M,
  };
}
