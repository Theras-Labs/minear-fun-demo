// MINEAR base: what the Refinery, the Forge and the Capsule Machine do to the player state; the panels
// (src/base/basePanels.ts) call these and then play the sounds and redraw.
// MINEAR rule (user, 2026-11-14): the Refinery, the Forge and rerolls spend materials ON CHAIN only (the player's
// vault, minear-r3f/src/economy/vault.ts): a smelt is a `craft` on chain, a make or a reroll burns its materials on
// chain first. Salvage and the Capsule Machine put materials in the save game; the panel then saves them on chain
// at once, like a trip (vault.saveAll). A demo player (no account) has nothing on chain.
import { GEAR_BY_ID, gearName, pickTier, rollGear, rollLootGear, type GearItem, type GearSlotType } from '../state/gear';
import { luckCurve } from '../state/progression';
import type { PlayerState } from '../state/playerState';
import { ITEMS, SUPPLY_IDS, type ItemDef } from '../world/items';
import { pickGemByDepth } from '../world/gemSpawn';
import type { OreId } from './run';
import { vault } from '../economy/vault';
import { FORGE_GRADES, FORGE_SLOTS, SALVAGE, forgeNeeds, rerollCostOf, type ForgeGrade, type ForgeKind } from '../economy/forgeRules';

// The Forge tables live in minear-r3f/src/economy/forgeRules.ts (the contract's settings too)
export { FORGE_GRADES, FORGE_SLOTS, SALVAGE, forgeNeeds, type ForgeGrade, type ForgeKind };

const ITEM = ITEMS as Record<string, ItemDef>;

// ---- Refinery ------------------------------------------------------------------------------------------

export interface Recipe {
  from: OreId;
  to: OreId;
  n: number;
}

/** Five of an ore smelt into one of the next ore up. */
export const REFINE: Recipe[] = [
  { from: `copper`, to: `iron`, n: 5 },
  { from: `iron`, to: `gold`, n: 5 },
  { from: `gold`, to: `mythril`, n: 5 },
];

/** Ore of a kind ON CHAIN (the vault). Ore still in the save's ore bin does not count here. */
export const oreHave = (_s: PlayerState, id: string): number => vault.have(id);

/** Puts ore into the save's ore bin (salvage, the Capsule Machine); the panel then saves it on chain (vault.saveAll). */
const giveOre = (s: PlayerState, id: string, n: number): void => {
  if (n > 0) s.ores[id] = (s.ores[id] ?? 0) + n;
};

/** How many times recipe r can smelt now (ore on chain), at most `times`. */
export const refineCount = (s: PlayerState, r: Recipe, times: number): number => Math.min(times, Math.floor(oreHave(s, r.from) / r.n));

/** Smelts recipe r up to `times` times (Infinity = all) on chain (the contract's recipe smelt.<from>).
 *  Returns how many came out; throws with the chain's reason. */
export async function refine(s: PlayerState, r: Recipe, times: number): Promise<number> {
  const k = refineCount(s, r, times);
  if (k <= 0) return 0;
  await vault.smelt(`smelt.${r.from}`, k);
  return k;
}

// ---- Forge ---------------------------------------------------------------------------------------------

/** The first material of a grade the player has too little of for one make, or null. */
export const forgeShort = (s: PlayerState, g: ForgeGrade): { ore: OreId; n: number } | null =>
  forgeNeeds(g).find((m) => oreHave(s, m.ore) < m.n) ?? null;

/** The Forge kind of an id (the first one for an unknown id). */
export const forgeKind = (id: string): ForgeKind => FORGE_SLOTS.find((f) => f.id === id) ?? FORGE_SLOTS[0];

/** Internal stat scale of forged gear: as deep as the miner has been (10 m at least). Not shown to the player:
 *  MINEAR has no forge level (user, 2026-11-14). */
export const forgeLevel = (s: PlayerState): number => Math.max(10, Math.min(900, Math.round(s.deepest)));

export function canForge(s: PlayerState, g: ForgeGrade): boolean {
  return !forgeShort(s, g) && s.coins >= g.coins;
}

/** How many makes of grade g the materials on chain pay for, at most `times`. */
export const forgeCount = (s: PlayerState, g: ForgeGrade, times: number): number =>
  Math.max(0, Math.min(times, ...forgeNeeds(g).map((m) => Math.floor(oreHave(s, m.ore) / m.n))));

/** Every material `times` makes of grade g burn: [game item id, count]. */
export const forgeCost = (g: ForgeGrade, times: number): [string, number][] => forgeNeeds(g).map((m) => [m.ore, m.n * times]);

/** Rolls one piece of kind k in the grade's metal and puts it in the wallet (no limit). The materials are paid
 *  BEFORE, on chain (forgeView.ts runForge burns forgeCost). maxTier caps the rarity (x10 gives one Legendary at
 *  most). Null only when the wallet refuses the piece. */
export function forgeRoll(s: PlayerState, g: ForgeGrade, k: ForgeKind, maxTier = 4): GearItem | null {
  const tier = Math.min(maxTier, pickTier(g.weights, luckCurve(s.fortuneNow)));
  const item = rollGear(tier, forgeLevel(s), { base: k.base });
  item.ore = g.ore;
  item.name = gearName(item);
  item.fresh = true;
  return s.addItem(item) ? item : null;
}

/** A gear NFT on a v2 contract: salvage burns it on chain and mints its ore there. Returns the ore given. */
export async function salvageChain(s: PlayerState, uid: number): Promise<Partial<Record<OreId, number>> | null> {
  const item = s.items.find((e) => e.uid === uid);
  if (!item?.chain) return null;
  const out = await vault.salvage(s, item);
  return Object.fromEntries(out.map(([t, n]) => [t.replace(/^ore\./, ``), n])) as Partial<Record<OreId, number>>;
}

/** Breaks a spare (not worn) piece of gear that lives only in this browser into ore (saved on chain next, by the
 *  panel). Returns the ore given, or null. */
export function salvage(s: PlayerState, uid: number): Partial<Record<OreId, number>> | null {
  const i = s.items.findIndex((e) => e.uid === uid);
  if (i < 0) return null;
  const [item] = s.items.splice(i, 1);
  const out = SALVAGE[item.tier] ?? SALVAGE[0];
  for (const [id, n] of Object.entries(out)) giveOre(s, id, n ?? 0);
  return out;
}

/** Rerolling a piece's enchants (every stat but the first, built-in one): ore by tier (no coins). */
export const rerollCost = (item: GearItem): { ore: OreId; n: number; coins: number } => rerollCostOf(item.tier);

/** Every piece of gear the player holds (worn first, then the bag). */
export function heldGear(s: PlayerState): { item: GearItem; worn: boolean }[] {
  const out: { item: GearItem; worn: boolean }[] = [];
  for (const it of Object.values(s.gear)) if (it) out.push({ item: it, worn: true });
  for (const it of s.items) out.push({ item: it, worn: false });
  return out;
}

/** Rerolls the enchants of a held piece; the built-in stat stays. Burns the ore on chain first. False when
 *  it cannot pay or has none; throws with the chain's reason. */
export async function rerollEnchants(s: PlayerState, uid: number): Promise<boolean> {
  const held = heldGear(s).find((e) => e.item.uid === uid);
  if (!held || held.item.stats.length < 2) return false;
  const item = held.item;
  const c = rerollCost(item);
  if (oreHave(s, c.ore) < c.n || s.coins < c.coins) return false;
  // a gear NFT on a v2 contract: the chain burns the cost and writes the new enchant seed
  if (item.chain && vault.chainGear) {
    await vault.reroll(s, item);
    return true;
  }
  const fresh = rollGear(item.tier, item.lvl, { base: item.base });
  if (fresh.stats.length < 2) return false;
  await vault.spend([[c.ore, c.n]], `reroll`);
  s.coins -= c.coins;
  item.stats = [item.stats[0], ...fresh.stats.slice(1)];
  item.name = gearName(item);
  if (held.worn) s.recompute();
  return true;
}

export const gearBaseName = (item: GearItem): string => GEAR_BY_ID[item.base]?.name ?? item.name;

// ---- Capsule Machine -----------------------------------------------------------------------------------

/** Coins for one Capsule Coin at the machine. */
export const CAPSULE_COIN_PRICE = 300;

export type CapsulePrize =
  | { kind: 'coins'; n: number }
  | { kind: 'ore'; id: OreId; n: number }
  | { kind: 'supply'; id: string; n: number }
  | { kind: 'gem'; id: string }
  | { kind: 'die'; n: number }
  | { kind: 'gear'; item: GearItem }
  | { kind: 'capsules'; n: number };

/** The prize table: [weight, kind]. */
const PRIZES: [number, CapsulePrize['kind']][] = [
  [34, `coins`],
  [18, `ore`],
  [16, `supply`],
  [14, `gem`],
  [8, `die`],
  [8, `gear`],
  [2, `capsules`],
];

export const CAPSULE_ODDS = PRIZES.map(([w, k]) => ({ kind: k, pct: w }));

/** Spends one Capsule Coin and pays out one prize; null when there is no coin. */
export function spinCapsule(s: PlayerState): CapsulePrize | null {
  if (s.capsules < 1) return null;
  s.capsules--;
  let r = Math.random() * PRIZES.reduce((a, [w]) => a + w, 0);
  let kind: CapsulePrize['kind'] = `coins`;
  for (const [w, k] of PRIZES) if ((r -= w) <= 0) {
    kind = k;
    break;
  }
  const deep = Math.max(20, s.deepest);
  let prize: CapsulePrize;
  switch (kind) {
    case `ore`: {
      const id: OreId = deep > 400 && Math.random() < 0.35 ? `mythril` : deep > 120 && Math.random() < 0.5 ? `gold` : `iron`;
      prize = { kind, id, n: id === `mythril` ? 3 : id === `gold` ? 8 : 18 };
      giveOre(s, prize.id, prize.n);
      break;
    }
    case `supply`: {
      const ids = SUPPLY_IDS.filter((id) => s.room(id) > 0);
      if (!ids.length) return payCoins(s, deep);
      const id = ids[Math.floor(Math.random() * ids.length)];
      prize = { kind, id, n: s.put(id, 1) };
      break;
    }
    case `gem`: {
      const id = pickGemByDepth(deep * 0.9);
      if (s.room(id) < 1) {
        s.crystals[id] = (s.crystals[id] ?? 0) + 1;
      } else s.put(id, 1);
      prize = { kind, id };
      break;
    }
    case `die`:
      s.dice += 1;
      prize = { kind, n: 1 };
      break;
    case `gear`: {
      if (s.bagFull) return payCoins(s, deep);
      const item = rollLootGear([40, 38, 17, 4.5, 0.5], s.fortuneNow, deep);
      item.fresh = true;
      s.addItem(item);
      prize = { kind, item };
      break;
    }
    case `capsules`:
      s.capsules += 3;
      prize = { kind, n: 3 };
      break;
    default:
      return payCoins(s, deep);
  }
  return prize;
}

function payCoins(s: PlayerState, deep: number): CapsulePrize {
  const n = Math.round((120 + Math.random() * 220) * (1 + deep / 500));
  s.earn(n);
  return { kind: `coins`, n };
}

/** A prize in words, for the panel and toasts. */
export function prizeText(p: CapsulePrize): string {
  switch (p.kind) {
    case `coins`:
      return `${p.n.toLocaleString()} coins`;
    case `ore`:
      return `${p.n} ${ITEM[p.id].name}`;
    case `supply`:
      return `${ITEM[p.id].name}`;
    case `gem`:
      return ITEM[p.id].name;
    case `die`:
      return `a reroll die`;
    case `gear`:
      return p.item.name;
    case `capsules`:
      return `3 Capsule Coins`;
  }
}
