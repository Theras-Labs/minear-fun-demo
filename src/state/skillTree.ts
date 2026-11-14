// MINEAR: the skill tree, its node data and its rules (folder: minear-r3f/src/state).
// The tree replaces the old Skills page of the inventory (view: minear-r3f/src/menus/skillTree.ts). Home sits in
// the middle; four branches grow from it: up = Digging, left = Fortune and loot, right = Survival, down = Travel
// and Combat. Each level of a node adds `per` points to its stat; PlayerState.recompute adds the tree points to
// the Wellspring card points (minear-r3f/src/state/playerState.ts). Node `belt` opens belt slots instead
// (minear-r3f/src/state/belt.ts). Levels are saved in PlayerState.tree (node id -> level). The user's rule
// (2026-11-13): abilities are paid in MATERIALS only (ore from the ore bin, gems from the gem bag; keys later).
// No coin fee: NEAR coins pay only the network gas of an on-chain action (or the relayer pays it for a wallet
// with no NEAR). The view lets the miner buy only at base.
import { ORE_IDS, type OreId } from '../base/run';
import { STATS } from './gearStats';
import { vault } from '../economy/vault';

export type TreeBranch = 'home' | 'dig' | 'loot' | 'live' | 'move';

export interface TreeNode {
  id: string;
  name: string;
  /** The STATS id each level adds to, or null for a special node (home, belt). */
  stat: string | null;
  special?: 'home' | 'belt';
  branch: TreeBranch;
  /** Grid position: x to the right, y down. Home is (0, 0). */
  gx: number;
  gy: number;
  /** Parent node id (null for home). */
  parent: string | null;
  /** Parent level needed before this node shows and can be bought. */
  req: number;
  max: number;
  /** Stat value per level. */
  per: number;
  /** A stat id for statIcon (minear-r3f/src/menus/inventoryStats.ts), or an inline <svg>. */
  icon: string;
  /** A capstone: drawn larger, costs one ore grade more. */
  big?: boolean;
  /** Cost multiplier (default 1). */
  mul?: number;
  /** Player-facing text for a special node (stat nodes use STATS[stat].blurb). */
  blurb?: string;
}

export const BRANCH_NAMES: Record<TreeBranch, string> = {
  home: `Root of the tree`,
  dig: `Digging`,
  loot: `Fortune and loot`,
  live: `Survival`,
  move: `Travel and Combat`,
};

const STROKE = `stroke="#3a281c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
/** The home node: a dirt mound with the burrow hole. */
const HOME_ICON = `<svg viewBox="0 0 48 48"><path d="M4 40 C8 22 16 13 24 13 C32 13 40 22 44 40 Z" fill="#a8703f" ${STROKE}/><path d="M16 40 C16 31 19 27 24 27 C29 27 32 31 32 40 Z" fill="#2a1a10" ${STROKE}/><path d="M14 22 L17 20 M31 19 L34 22 M24 17 V19" ${STROKE}/></svg>`;
/** The Belt Loops node: a belt with a buckle and a pouch. */
const BELT_ICON = `<svg viewBox="0 0 48 48"><rect x="3" y="18" width="42" height="11" rx="3" fill="#9a6338" ${STROKE}/><rect x="17" y="14" width="13" height="19" rx="3" fill="#ffc23d" ${STROKE}/><rect x="21" y="19" width="5" height="9" fill="#9a6338" stroke="none"/><path d="M33 29 H42 V38 C42 41 33 41 33 38 Z" fill="#c9854a" ${STROKE}/></svg>`;

const node = (n: Omit<TreeNode, 'req' | 'stat' | 'icon'> & Partial<Pick<TreeNode, 'req' | 'stat' | 'icon'>>): TreeNode => ({
  req: 1,
  stat: null,
  icon: n.stat ?? `power`,
  ...n,
});

/** Every node; home first, then each branch from the centre out. */
export const TREE: TreeNode[] = [
  node({ id: `home`, name: `Home Burrow`, special: `home`, branch: `home`, gx: 0, gy: 0, parent: null, req: 0, max: 1, per: 0, icon: HOME_ICON, blurb: `Your home burrow. Every branch grows from here.` }),

  // Up: Digging
  node({ id: `claws`, name: `Sharp Claws`, stat: `power`, branch: `dig`, gx: 0, gy: -1, parent: `home`, max: 5, per: 1 }),
  node({ id: `wide`, name: `Wide Bite`, stat: `bore`, branch: `dig`, gx: 0, gy: -2, parent: `claws`, max: 5, per: 5 }),
  node({ id: `sense`, name: `Keen Nose`, stat: `sense`, branch: `dig`, gx: -1, gy: -2, parent: `wide`, max: 4, per: 1 }),
  node({ id: `tunnel`, name: `Tunnel Runner`, stat: `burrow`, branch: `dig`, gx: 1, gy: -2, parent: `wide`, max: 5, per: 8 }),
  node({ id: `oresight`, name: `Ore Sight`, stat: `oresight`, branch: `dig`, gx: 0, gy: -3, parent: `wide`, req: 2, max: 2, per: 1, big: true }),
  node({ id: `echo`, name: `Echo`, stat: `echo`, branch: `dig`, gx: 0, gy: -4, parent: `oresight`, max: 1, per: 1, big: true }),

  // Left: Fortune and loot
  node({ id: `veins`, name: `Rich Veins`, stat: `fortune`, branch: `loot`, gx: -1, gy: 0, parent: `home`, max: 5, per: 4 }),
  node({ id: `bag`, name: `Deep Pockets`, stat: `pack`, branch: `loot`, gx: -2, gy: 0, parent: `veins`, max: 4, per: 1 }),
  node({ id: `magnet`, name: `Magnet Paws`, stat: `magnet`, branch: `loot`, gx: -2, gy: -1, parent: `bag`, max: 4, per: 1 }),
  node({ id: `luck`, name: `Lucky Paw`, stat: `luck`, branch: `loot`, gx: -2, gy: 1, parent: `bag`, max: 5, per: 2 }),
  node({ id: `goldrush`, name: `Gold Rush`, stat: `gold`, branch: `loot`, gx: -3, gy: 0, parent: `bag`, req: 2, max: 5, per: 5 }),
  node({ id: `lode`, name: `Mother Lode`, stat: `fortune`, branch: `loot`, gx: -4, gy: 0, parent: `goldrush`, req: 2, max: 3, per: 6 }),
  node({ id: `hoard`, name: `Bottomless Bag`, stat: `pack`, branch: `loot`, gx: -5, gy: 0, parent: `lode`, max: 2, per: 2, big: true }),

  // Right: Survival
  node({ id: `hide`, name: `Thick Hide`, stat: `hp`, branch: `live`, gx: 1, gy: 0, parent: `home`, max: 5, per: 10 }),
  node({ id: `shell`, name: `Hard Shell`, stat: `armor`, branch: `live`, gx: 2, gy: 0, parent: `hide`, max: 5, per: 2 }),
  node({ id: `mend`, name: `Quick Mend`, stat: `regen`, branch: `live`, gx: 2, gy: -1, parent: `shell`, max: 4, per: 0.3 }),
  node({ id: `heat`, name: `Heat Shield`, stat: `resfire`, branch: `live`, gx: 2, gy: 1, parent: `shell`, max: 4, per: 8 }),
  node({ id: `toxin`, name: `Antitoxin`, stat: `respoison`, branch: `live`, gx: 3, gy: 0, parent: `shell`, req: 2, max: 4, per: 8 }),
  node({ id: `grip`, name: `Ice Grip`, stat: `grip`, branch: `live`, gx: 3, gy: 1, parent: `heat`, max: 1, per: 1 }),
  node({ id: `wind`, name: `Second Wind`, stat: `wind`, branch: `live`, gx: 4, gy: 0, parent: `toxin`, req: 2, max: 1, per: 1, big: true }),

  // Down: Travel and Combat
  node({ id: `feet`, name: `Quick Feet`, stat: `speed`, branch: `move`, gx: 0, gy: 1, parent: `home`, max: 5, per: 3 }),
  node({ id: `belt`, name: `Belt Loops`, special: `belt`, branch: `move`, gx: 1, gy: 1, parent: `feet`, max: 2, per: 1, mul: 2, icon: BELT_ICON, blurb: `One more belt slot for each level: carry more supplies on keys 1 to 4.` }),
  node({ id: `tank`, name: `Big Tank`, stat: `fuel`, branch: `move`, gx: 0, gy: 2, parent: `feet`, max: 5, per: 15 }),
  node({ id: `dash`, name: `Nimble`, stat: `nimble`, branch: `move`, gx: -1, gy: 2, parent: `tank`, max: 4, per: 5 }),
  node({ id: `strike`, name: `Heavy Paws`, stat: `melee`, branch: `move`, gx: 0, gy: 3, parent: `tank`, req: 2, max: 5, per: 3 }),
  node({ id: `aim`, name: `Steady Aim`, stat: `ranged`, branch: `move`, gx: -1, gy: 3, parent: `strike`, max: 5, per: 2 }),
  node({ id: `crit`, name: `Keen Eye`, stat: `crit`, branch: `move`, gx: 1, gy: 3, parent: `strike`, max: 5, per: 2 }),
];

export const TREE_BY_ID: Record<string, TreeNode> = Object.fromEntries(TREE.map((n) => [n.id, n]));

/** What the tree reads and writes on the player state (PlayerState has all of it). */
export interface TreeHolder {
  tree: Record<string, number>;
  coins: number;
  /** The ore bin. */
  ores: Record<string, number>;
  /** Gems kept out of the bag, and the gem bag stacks. */
  crystals: Record<string, number>;
  pack: { id: string; n: number }[];
  recompute?(): void;
}

export interface TreeCost {
  /** Always 0: no coin cost (NEAR coins pay only network gas). Kept so callers stay simple. */
  coins: number;
  /** [item id, count]: ore first, then a gem from the second ring out. */
  mats: [string, number][];
}

/** Steps from home on the grid (1 for the nodes next to home). */
export const nodeRing = (n: TreeNode): number => Math.abs(n.gx) + Math.abs(n.gy);

/** Ore grade of a node: rings 1-2 copper, 3 iron, 4 gold, 5 mythril; a capstone one grade up. */
export const nodeOreTier = (n: TreeNode): number =>
  Math.min(ORE_IDS.length - 1, Math.max(0, nodeRing(n) - 2) + (n.big ? 1 : 0));

/** Main ore count at level 0 per grade (copper, iron, gold, mythril). */
const ORE_BASE = [8, 5, 3, 2];
/** The gem a node also needs, by ring (ring 1 needs none); a capstone needs the next gem up. */
export const TREE_GEMS = [`quartz`, `amethyst`, `emerald`, `sapphire`, `ruby`] as const;

/**
 * The cost of buying level `level` + 1 of node n (level = the level the node has now).
 * Materials (the price): main ore = ORE_BASE[grade] * 1.4^level (copper also x(1 + 0.5 * (ring - 1))); from iron
 * up, also 2.5x that count of the ore one grade down; from ring 2 out (or a capstone), gems:
 * TREE_GEMS[ring - 2 (+1 for a capstone)], count (ring 2: 2, else 1) * 1.35^level. All x mul.
 * No coins. Home and a full node cost nothing.
 */
export function nodeCost(n: TreeNode, level: number): TreeCost {
  if (!n.parent || level >= n.max) return { coins: 0, mats: [] };
  const r = Math.max(1, nodeRing(n)),
    l = Math.max(0, Math.floor(level)),
    mul = n.mul ?? 1,
    tier = nodeOreTier(n),
    main = Math.max(1, Math.round(ORE_BASE[tier] * 1.4 ** l * (tier === 0 ? 1 + 0.5 * (r - 1) : 1) * mul)),
    mats: [string, number][] = [[ORE_IDS[tier], main]];
  if (tier > 0) mats.push([ORE_IDS[tier - 1], Math.max(2, Math.round(main * 2.5))]);
  const g = r - 2 + (n.big ? 1 : 0);
  if (g >= 0) mats.push([TREE_GEMS[Math.min(TREE_GEMS.length - 1, g)], Math.max(1, Math.round((r === 2 ? 2 : 1) * 1.35 ** l * mul))]);
  return { coins: 0, mats };
}

/** How many of a material the miner holds ON CHAIN (the on-chain vault, minear-r3f/src/economy/vault.ts).
 *  MINEAR rule (user, 2026-11-14): only materials on chain count; ore and gems still in the save do not. */
export function matHeld(_s: TreeHolder, id: string): number {
  return vault.have(id);
}

/** Level of node id (home is always 1; unknown ids are 0). */
export function treeLevel(s: { tree?: Record<string, number> }, id: string): number {
  const n = TREE_BY_ID[id];
  if (!n) return 0;
  if (!n.parent) return n.max;
  const v = Math.floor(s.tree?.[id] ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(n.max, v)) : 0;
}

/** True when the node shows on the tree: home, a node with levels, or a node whose parent has `req` levels. */
export function nodeShown(s: { tree?: Record<string, number> }, n: TreeNode): boolean {
  return !n.parent || treeLevel(s, n.id) > 0 || treeLevel(s, n.parent) >= n.req;
}

/** True when the miner holds the materials for the next level (false at max). */
export function canAfford(s: TreeHolder, n: TreeNode): boolean {
  const l = treeLevel(s, n.id);
  if (!n.parent || l >= n.max) return false;
  const c = nodeCost(n, l);
  return s.coins >= c.coins && c.mats.every(([id, k]) => matHeld(s, id) >= k);
}

/** True when the next level can be bought now: shown, not full, affordable. */
export function canBuy(s: TreeHolder, n: TreeNode): boolean {
  return nodeShown(s, n) && canAfford(s, n);
}

/** Buys one level of node id: checks max, the parent level and the cost, burns the materials on chain,
 *  then adds the level. False when it cannot buy; throws with the chain's reason. */
export async function buyNode(s: TreeHolder, id: string): Promise<boolean> {
  const n = TREE_BY_ID[id];
  if (!n || !canBuy(s, n)) return false;
  const l = treeLevel(s, id),
    c = nodeCost(n, l);
  await vault.spend(c.mats, `skill`);
  s.coins -= c.coins;
  s.tree[id] = l + 1;
  s.recompute?.();
  return true;
}

/** Stat points the tree gives: stat id -> level x per, summed over the nodes. */
export function treeStatPoints(s: { tree?: Record<string, number> }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of TREE) {
    if (!n.stat) continue;
    const l = treeLevel(s, n.id);
    if (l > 0) out[n.stat] = (out[n.stat] ?? 0) + l * n.per;
  }
  return out;
}

/** Validates saved tree levels: known non-home ids only, integer levels clamped to 0..max (missing = {}). */
export function readTree(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== `object`) return out;
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = TREE_BY_ID[id];
    if (!n?.parent) continue;
    const l = Math.max(0, Math.min(n.max, Math.floor(Number(raw) || 0)));
    if (l > 0) out[id] = l;
  }
  return out;
}

/** Player-facing text of what a node does (the stat blurb, or the special node's own text). */
export const nodeBlurb = (n: TreeNode): string => n.blurb ?? (n.stat ? STATS[n.stat]?.blurb ?? `` : ``);
