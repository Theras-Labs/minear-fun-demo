// JSON shapes of the items contract views and calls (minear-r3f/contracts/items/src/views.rs, game.rs).
// Amounts are strings (U128 / U64 in the contract); plain numbers are u32 / u64 counters.
import type { TokenId } from './catalog';

/** Counts over the last 24 h in 4 buckets of 6 h. Merchant flow: a = players bought, b = players sold.
 *  Token flow: a = minted, b = burned. */
export interface Flow {
  bucket: number;
  a: number[];
  b: number[];
}

export interface Loan {
  investor: string;
  owed: string;
}

export interface Export {
  above: string;
  per_day: number;
  price_bps: number;
  last_ms: number;
}

export interface MerchantState {
  account_id: string;
  name: string;
  closed: boolean;
  floor: string;
  reopen: string;
  coins: string;
  stock: [TokenId, string][];
  flows: [TokenId, Flow][];
  exports: [TokenId, Export][];
  loans: Loan[];
}

export interface TokenState {
  token_id: TokenId;
  supply: string;
  flow: Flow;
}

export interface Board {
  now_ms: number;
  merchants: MerchantState[];
  tokens: TokenState[];
}

export interface PlayerRecord {
  since_ms: number;
  last_save_ms: number;
  day: number;
  used: number;
  bonus: number;
  hour: number;
  minted: [TokenId, number][];
}

export interface PlayerView {
  account_id: string;
  known: boolean;
  balances: [TokenId, string][];
  player: PlayerRecord;
  free_left: number;
  free_limit: number;
  next_save_ms: number;
  now_ms: number;
  /** v2 contract: the trip record and the number of gear NFTs (absent on a v1 contract). */
  stats?: PlayerStats;
  gear?: number;
}

/** v2 contract (minear-r3f/contracts/items/src/trips.rs). */
export interface TripRow {
  account_id: string;
  depth_m: number;
  items: number;
  best: TokenId | null;
  at_ms: number;
  /** The new place on the Depth board when this trip moved the player up. */
  depth_rank: number | null;
}

export interface Leader {
  account_id: string;
  value: number;
  at_ms: number;
}

export interface PlayerStats {
  trips: number;
  best_depth: number;
  mined: number;
  last: TripRow[];
}

export interface LobbyFeed {
  now_ms: number;
  trips: TripRow[];
  top_depth: Leader[];
  top_mined: Leader[];
}

/** A gear NFT as the contract stores it (minear-r3f/contracts/items/src/gear.rs). */
export interface ChainGear {
  owner_id: string;
  base: string;
  ore: string;
  tier: number;
  lvl: number;
  seed: string;
  reroll: string | null;
  rerolls: number;
  made_ms: number;
}

export interface GearToken {
  token_id: string;
  gear: ChainGear;
}

export type Side = 'sell' | 'buy';

/** A price a merchant agent signed (side from the player's view). */
export interface Quote {
  merchant: string;
  player: string;
  token_id: TokenId;
  side: Side;
  amount: string;
  coins: string;
  expires_ms: string;
  nonce: string;
}

/** What the server returns for a quote request. */
export interface SignedQuote {
  quote: Quote;
  /** base64 ed25519 signature of quoteMessage(contract, quote). */
  signature: string;
  /** Plain-text reasoning for the tooltip. */
  reasons: string[];
}

/** The exact string a merchant signs. Must match quote_message in minear-r3f/contracts/items/src/game.rs. */
export const quoteMessage = (contract: string, q: Quote): string =>
  [`minear-quote-v1`, contract, q.merchant, q.player, q.token_id, q.side, q.amount, q.coins, q.expires_ms, q.nonce].join(`|`);

/** A deployment: account ids written by minear-r3f/server/tools/setup.ts. `local` is the NEAR sandbox chain on
 *  this machine (dev-local "Demo cheat" only; minear-r3f/server/.sandbox/deploy.local.json, served by GET /deploy). */
export interface Deployment {
  network: 'testnet' | 'mainnet' | 'local';
  rpc: string;
  root: string;
  contract: string;
  relayer: string;
  /** Merchant id (pricing.ts) -> account id. */
  merchants: Record<string, string>;
}
