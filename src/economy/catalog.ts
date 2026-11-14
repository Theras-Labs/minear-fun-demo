// MINEAR on-chain item catalog (folder: minear-r3f/src/economy).
// Which game items live in the NEP-245 items contract (minear-r3f/contracts/items), their token ids,
// tiers, base prices (the item's value in minear-r3f/src/world/items.ts) and hourly save caps.
// Shared by the game client, the server (minear-r3f/server) and its setup and bot tools.
// Supplies, boss souls and gear stay in the local save for now.
import { ITEMS } from '../world/items';

export type TokenId = string;

/** The game coin: a token in the items contract, not NEAR. */
export const COIN: TokenId = `coin`;

export interface TokenDef {
  /** On-chain token id, for example `ore.iron`. */
  id: TokenId;
  /** Game item id in ITEMS, for example `iron`. */
  item: string;
  name: string;
  kind: 'ore' | 'gem';
  /** 1 (common) to 6 (mythic). */
  tier: number;
  /** Reference price in coins (the item's value in the game). */
  base: number;
  /** Most one player can save from trips in one hour. */
  capPerHour: number;
  /** 24-bit color. */
  color: number;
}

const RARITY_TIER: Record<string, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };

/** [game item id, hourly save cap]. Caps sit well above what a good miner digs in an hour. */
const ORE_CAPS: [string, number][] = [
  [`stone`, 600], // MINEAR (user, 2026-11-15): the first material, from common rock
  [`copper`, 400],
  [`iron`, 300],
  [`gold`, 150],
  [`mythril`, 60],
];
const GEM_CAPS: [string, number][] = [
  [`quartz`, 120],
  [`amethyst`, 60],
  [`emerald`, 30],
  [`sapphire`, 20],
  [`bogjade`, 12],
  [`rime`, 12],
  [`ruby`, 10],
  [`fireopal`, 8],
  [`soulpearl`, 8],
  [`sunstone`, 4],
  [`voidheart`, 2],
];

const def = (item: string, kind: 'ore' | 'gem', cap: number, i: number): TokenDef => {
  const it = (ITEMS as Record<string, { name: string; value: number; color: number; rarity: string }>)[item];
  return {
    id: `${kind}.${item}`,
    item,
    name: it.name,
    kind,
    // stone (index 0) shares tier 1 with copper, so copper..mythril keep their tiers 1..4 on chain
    tier: kind === `ore` ? Math.max(1, i) : RARITY_TIER[it.rarity],
    base: it.value,
    capPerHour: cap,
    color: it.color,
  };
};

export const TOKENS: TokenDef[] = [
  ...ORE_CAPS.map(([id, cap], i) => def(id, `ore`, cap, i)),
  ...GEM_CAPS.map(([id, cap], i) => def(id, `gem`, cap, i)),
];

export const TOKEN_BY_ID: Record<TokenId, TokenDef> = Object.fromEntries(TOKENS.map((t) => [t.id, t]));
const TOKEN_BY_ITEM: Record<string, TokenDef> = Object.fromEntries(TOKENS.map((t) => [t.item, t]));

/** Token id of a game item id, or null when the item is not on-chain. */
export const tokenOf = (item: string): TokenId | null => TOKEN_BY_ITEM[item]?.id ?? null;
/** Game item id of a token id. */
export const itemOf = (token: TokenId): string | null => TOKEN_BY_ID[token]?.item ?? null;
export const tokenName = (token: TokenId): string => (token === COIN ? `Coins` : (TOKEN_BY_ID[token]?.name ?? token));

/** The Refinery on chain: five of an ore smelt into one of the next ore up, the same ratios as the
 *  local Refinery (REFINE in minear-r3f/src/base/workshop.ts). */
export interface RecipeDef {
  id: string;
  name: string;
  inputs: [TokenId, number][];
  fee: number;
  outputs: [TokenId, number][];
}

export const RECIPES: RecipeDef[] = [
  { id: `smelt.copper`, name: `Smelt copper into iron`, inputs: [[`ore.copper`, 5]], fee: 0, outputs: [[`ore.iron`, 1]] },
  { id: `smelt.iron`, name: `Smelt iron into gold`, inputs: [[`ore.iron`, 5]], fee: 0, outputs: [[`ore.gold`, 1]] },
  { id: `smelt.gold`, name: `Smelt gold into mythril`, inputs: [[`ore.gold`, 5]], fee: 0, outputs: [[`ore.mythril`, 1]] },
];

/** Contract settings (minear-r3f/contracts/items Config); the relayer id is added at setup. */
export const GAME_CONFIG = {
  /** Gas-free actions per player per UTC day on testnet (the user's rule, 2026-11-13: 240 on testnet, 24 on
   *  mainnet). A trip's save is 1; a sale, a buy, a forge are 1 each. The relayer also has a system cap for all
   *  players together (minear-r3f/server/src/budget.ts DAILY_CAP). */
  dailyFree: 240,
  /** One pack adds this many actions for the rest of the day... */
  packSize: 300,
  /** ...and costs this many coins (burned). */
  packPrice: 250,
  /** Shortest time between two saves of one player (a real trip takes minutes). */
  saveCooldownMs: 30_000,
  starterCoins: 200,
  /** Investors get back 125%... */
  returnBps: 2500,
  /** ...from 40% of each later sale. */
  repayBps: 4000,
  /** The user's rule (2026-11-13): free gas only for a wallet with no NEAR. An account with at least this much
   *  NEAR to spend (balance minus what its storage locks), in yoctoNEAR (0.15 NEAR), pays its own gas. Its session
   *  key signs, so it still sees no popup. The relayer (minear-r3f/server/src/relayer.ts) and the client
   *  (minear-r3f/src/near/play.ts hasGas) use the same line.
   *  Why 0.15, not 0.01: NEAR makes the payer hold the full prepaid gas cost of a call, about 0.05 NEAR for 50 Tgas
   *  and 0.1 NEAR for a 100 Tgas forge (measured on testnet 2026-11-15), though only about 0.0005 NEAR is burned.
   *  An account with 0.02 NEAR could not pay a 50 Tgas call, so below this line the relayer pays. */
  ownGasAbove: `150000000000000000000000`,
  /** Gas a session key may spend when its player pays their own gas (0.25 NEAR, yoctoNEAR). */
  sessionAllowance: `250000000000000000000000`,
};
