// MERCHANT PRICING RULES: the one file (minear-r3f/src/economy/pricing.ts).
//
// Who reads it:
//   - each merchant agent (minear-r3f/server/src/merchants.ts) when it signs a quote,
//   - the market panel tooltip (minear-r3f/src/menus/market.ts) to show the merchant's reasoning,
//   - the fast-forward simulation and the bots.
// So the price a player sees, the reasoning, and the price the merchant signs can never disagree.
//
// A merchant is a shop with its own NEAR account. It holds stock and coins (balances in the items
// contract) and is always ready to buy and to sell. There is no order book: the merchant itself sets
// a price from what it knows. For each item, every time someone asks:
//
//   price = base x STOCK x DEMAND x WORLD
//
//   STOCK   I want to hold `target` units. More than that: I pay less. Less than that: I pay more.
//           (target / stock) ^ elasticity, kept between x0.25 and x4.
//           Players flood me with iron -> my iron stock grows -> iron gets cheap.
//   DEMAND  What miners bought from me minus what they sold me in the last 24 h, compared with my
//           target. More buying -> price up. More selling -> price down. Up to +-demandWeight.
//   WORLD   For the whole game, in the last 24 h: how much the item's total supply grew (units mined
//           minus units used up by crafting, the Wellspring and caravans), as a share of the supply.
//           Supply grows by half in a day -> -25%. Crafting burns more than miners bring -> up to +25%.
//
//   What I PAY you (bid) = price x (1 - spread/2) x CASH
//   What I ASK you (ask) = price x (1 + spread/2)
//
//   CASH    A merchant with little cash pays less: x0.4 when broke, x1 at its starting capital.
//   LIMITS  I never pay less than 10% of base, and never ask more than 6x base.
//   BUDGET  One sale to me may take at most `budgetShare` of my cash.
//   BROKE   When my cash falls below `floor`, my shop closes (the contract enforces it). It opens
//           again when investors bring my cash up to `reopen`; they get 125% back from later sales.
//   CARAVAN The outside world buys my surplus: stock above 1.5x target leaves at up to 0.5x target
//           per day, for 60% of base. That brings coins into the game and clears gluts. The contract
//           settles it at the next trade, from the time that passed.
//
// A quote for many units walks the price one unit at a time, so a big sale moves the price as it goes.
import { TOKEN_BY_ID, type TokenId } from './catalog';
import type { Board, Flow, MerchantState, Side, TokenState } from './types';

// ---- the knobs ----

export const RULES = {
  /** Lowest bid, as a share of base. */
  bidFloor: 0.1,
  /** Highest ask, as a multiple of base. */
  askCeil: 6,
  /** STOCK factor limits. */
  stockMin: 0.25,
  stockMax: 4,
  /** WORLD factor weight (+-25%)... */
  worldWeight: 0.25,
  /** ...reached when supply changes by this share in 24 h. */
  worldScale: 0.5,
  /** CASH factor when broke. */
  cashMin: 0.4,
  /** Caravan: surplus starts at this multiple of target... */
  caravanAbove: 1.5,
  /** ...and this multiple of target leaves per day... */
  caravanPerDay: 0.5,
  /** ...for this share of base (basis points). */
  caravanPriceBps: 6000,
  /** A quote is valid this long. */
  quoteMs: 20_000,
};

export interface MerchantRules {
  /** Account prefix: `smelter` -> smelter.<root>.testnet */
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** Units it wants to hold, per item it trades. Also its starting stock. */
  target: Record<TokenId, number>;
  /** Gap between what it asks and what it pays (0.2 = 10% each way). */
  spread: number;
  /** How hard stock moves the price. */
  elasticity: number;
  /** How hard 24 h demand moves the price. */
  demandWeight: number;
  /** Starting coins. */
  capital: number;
  /** Closes below this cash. */
  floor: number;
  /** Opens again at this cash. */
  reopen: number;
  /** Largest share of its cash one sale may take. */
  budgetShare: number;
}

/** The merchants. Items overlap on purpose: two buyers for one item means a second price to check. */
export const MERCHANTS: MerchantRules[] = [
  {
    id: `smelter`,
    name: `Brann`,
    title: `Smelter`,
    blurb: `Buys any ore by the cartload. Thin margins, deep coal bins.`,
    target: { 'ore.copper': 400, 'ore.iron': 300, 'ore.gold': 120, 'ore.mythril': 40 },
    spread: 0.12,
    elasticity: 0.6,
    demandWeight: 0.3,
    capital: 8000,
    floor: 800,
    reopen: 2400,
    budgetShare: 0.25,
  },
  {
    id: `gemcutter`,
    name: `Pip`,
    title: `Gem Cutter`,
    blurb: `Cuts the everyday stones. Pays fair, sells fast.`,
    target: { 'gem.quartz': 60, 'gem.amethyst': 30, 'gem.emerald': 12, 'gem.sapphire': 6 },
    spread: 0.18,
    elasticity: 0.7,
    demandWeight: 0.3,
    capital: 12000,
    floor: 1200,
    reopen: 3600,
    budgetShare: 0.25,
  },
  {
    id: `jeweler`,
    name: `Opaline`,
    title: `Jeweler`,
    blurb: `Only the finest. Rich, patient, and charges for it.`,
    target: { 'ore.gold': 60, 'gem.ruby': 4, 'gem.sunstone': 2, 'gem.voidheart': 1 },
    spread: 0.3,
    elasticity: 0.5,
    demandWeight: 0.2,
    capital: 30000,
    floor: 3000,
    reopen: 9000,
    budgetShare: 0.2,
  },
  {
    id: `wanderer`,
    name: `Moss`,
    title: `Biome Trader`,
    blurb: `Walks the ember, bog, frost and haunted caves. Wants their stones.`,
    target: { 'gem.bogjade': 6, 'gem.rime': 6, 'gem.fireopal': 4, 'gem.soulpearl': 4 },
    spread: 0.22,
    elasticity: 0.8,
    demandWeight: 0.35,
    capital: 15000,
    floor: 1500,
    reopen: 4500,
    budgetShare: 0.25,
  },
  {
    id: `quartermaster`,
    name: `Quill`,
    title: `Quartermaster`,
    blurb: `Makes bombs and tonics from cheap ore and stone. Small purse: easy to break.`,
    target: { 'ore.copper': 200, 'ore.iron': 150, 'gem.quartz': 30, 'gem.amethyst': 15 },
    spread: 0.15,
    elasticity: 0.6,
    demandWeight: 0.4,
    capital: 3000,
    floor: 300,
    reopen: 900,
    budgetShare: 0.35,
  },
  {
    id: `relics`,
    name: `Ossian`,
    title: `Relic Broker`,
    blurb: `Deals in the rarest finds. Thin market, wild prices.`,
    target: { 'ore.mythril': 20, 'gem.sunstone': 2, 'gem.voidheart': 1, 'gem.soulpearl': 2 },
    spread: 0.35,
    elasticity: 1,
    demandWeight: 0.4,
    capital: 12000,
    floor: 1200,
    reopen: 3600,
    budgetShare: 0.3,
  },
];

export const MERCHANT_BY_ID: Record<string, MerchantRules> = Object.fromEntries(MERCHANTS.map((m) => [m.id, m]));

// ---- reading the chain ----

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BUCKET_MS = 6 * 3_600_000;

/** Sums of a 24 h flow at `nowMs` (buckets older than 24 h do not count). */
export function last24(f: Flow | undefined, nowMs: number): { a: number; b: number } {
  if (!f) return { a: 0, b: 0 };
  const nowB = Math.floor(nowMs / BUCKET_MS);
  let a = 0;
  let b = 0;
  for (let k = 0; k < 4; k++) {
    const bucket = f.bucket - k;
    if (bucket < 0 || nowB - bucket >= 4) continue;
    a += f.a[bucket % 4] ?? 0;
    b += f.b[bucket % 4] ?? 0;
  }
  return { a, b };
}

/** What one merchant knows about one item, right now. */
export interface Snapshot {
  nowMs: number;
  closed: boolean;
  coins: number;
  stock: number;
  /** Players bought from this merchant / sold to it, last 24 h. */
  bought: number;
  sold: number;
  /** The whole game, last 24 h, and the total that exists now. */
  minted: number;
  burned: number;
  supply: number;
}

export function snapshot(board: Board, m: MerchantState, token: TokenId): Snapshot {
  const flow = m.flows.find(([t]) => t === token)?.[1];
  const tf: TokenState | undefined = board.tokens.find((t) => t.token_id === token);
  const own = last24(flow, board.now_ms);
  const world = last24(tf?.flow, board.now_ms);
  return {
    nowMs: board.now_ms,
    closed: m.closed,
    coins: Number(m.coins),
    stock: Number(m.stock.find(([t]) => t === token)?.[1] ?? 0),
    bought: own.a,
    sold: own.b,
    minted: world.a,
    burned: world.b,
    supply: Number(tf?.supply ?? 0),
  };
}

// ---- the price ----

export interface Price {
  /** What the merchant pays per unit. */
  bid: number;
  /** What the merchant asks per unit. */
  ask: number;
  /** Before the spread and cash. */
  mid: number;
  factors: { stock: number; demand: number; world: number; cash: number };
}

export function price(m: MerchantRules, token: TokenId, s: Snapshot): Price {
  const base = TOKEN_BY_ID[token]?.base ?? 1;
  const target = m.target[token] ?? 1;
  const stock = clamp((target / Math.max(s.stock, 1)) ** m.elasticity, RULES.stockMin, RULES.stockMax);
  const demand = 1 + m.demandWeight * clamp((s.bought - s.sold) / target, -1, 1);
  const growth = (s.minted - s.burned) / Math.max(s.supply, 1);
  const world = 1 - RULES.worldWeight * clamp(growth / RULES.worldScale, -1, 1);
  const cash = clamp(RULES.cashMin + (1 - RULES.cashMin) * (s.coins / m.capital), RULES.cashMin, 1);
  const mid = base * stock * demand * world;
  const floor = Math.max(1, Math.round(base * RULES.bidFloor));
  const bid = Math.max(floor, Math.round(mid * (1 - m.spread / 2) * cash));
  const ask = Math.max(bid + 1, Math.min(Math.round(base * RULES.askCeil), Math.round(mid * (1 + m.spread / 2))));
  return { bid, ask, mid, factors: { stock, demand, world, cash } };
}

export interface QuoteResult {
  /** Units the merchant takes (may be less than asked: budget or stock). */
  amount: number;
  /** Total coins. */
  coins: number;
  /** Why the price is what it is (first unit), for the tooltip. */
  reasons: string[];
  /** Set when the merchant refuses. */
  refusal?: string;
}

/** How much the last 24 h of mining, crafting and trading moved this merchant's bid: the bid now against the bid
 *  with the 24 h flows taken out (no mints, burns, buys or sells), as a share (-0.03 = 3% lower). The lobby shows
 *  it as the price impact of the trips (minear-r3f/src/menus/lobby.ts). */
export function impact24(m: MerchantRules, token: TokenId, s: Snapshot): number {
  const still = price(m, token, { ...s, minted: 0, burned: 0, bought: 0, sold: 0 }).mid;
  return still > 0 ? price(m, token, s).mid / still - 1 : 0;
}

/** The price for `amount` units, one unit at a time (each unit moves stock, demand and cash). */
export function quote(m: MerchantRules, token: TokenId, side: Side, amount: number, s0: Snapshot): QuoteResult {
  const first = price(m, token, s0);
  const reasons = explain(m, token, s0, first);
  if (s0.closed) return { amount: 0, coins: 0, reasons, refusal: `Closed: ${m.name} is broke until someone invests.` };
  if (!(m.target[token] > 0)) return { amount: 0, coins: 0, reasons, refusal: `${m.name} does not trade that.` };
  const s = { ...s0 };
  let total = 0;
  let n = 0;
  for (; n < amount; n++) {
    const p = price(m, token, s);
    if (side === `sell`) {
      if (total + p.bid > s0.coins * m.budgetShare) break;
      total += p.bid;
      s.stock += 1;
      s.sold += 1;
      s.coins -= p.bid;
    } else {
      if (s.stock < 1) break;
      total += p.ask;
      s.stock -= 1;
      s.bought += 1;
      s.coins += p.ask;
    }
  }
  if (n === 0)
    return {
      amount: 0,
      coins: 0,
      reasons,
      refusal: side === `sell` ? `${m.name} cannot afford even one right now.` : `${m.name} has none left.`,
    };
  return { amount: n, coins: total, reasons };
}

const pct = (k: number) => {
  const v = Math.round((k - 1) * 100);
  return v === 0 ? `no change` : `${v > 0 ? `+` : `−`}${Math.abs(v)}%`;
};

/** The merchant's reasoning in plain words (the market tooltip). */
export function explain(m: MerchantRules, token: TokenId, s: Snapshot, p: Price): string[] {
  const t = TOKEN_BY_ID[token];
  const name = t?.name ?? token;
  const target = m.target[token] ?? 0;
  const out = [
    `${name}: base price ${t?.base ?? `?`}c.`,
    `I hold ${s.stock}, I want about ${target}: ${pct(p.factors.stock)}.`,
    `Miners sold me ${s.sold} and bought ${s.bought} in 24 h: ${pct(p.factors.demand)}.`,
    `Whole world: ${s.supply.toLocaleString()} exist; in 24 h ${s.minted} mined, ${s.burned} used up: ${pct(p.factors.world)}.`,
    `My cash: ${s.coins.toLocaleString()} of ${m.capital.toLocaleString()}: I pay ${pct(p.factors.cash)}.`,
    `I pay ${p.bid}c each and sell at ${p.ask}c each.`,
  ];
  if (s.closed) out.push(`My shop is CLOSED: I need ${m.reopen.toLocaleString()} cash to open. Invest to open it.`);
  return out;
}

/** Caravan settings per (merchant, item), written to the contract at setup. */
export function caravan(m: MerchantRules, token: TokenId): { above: number; perDay: number; priceBps: number } {
  const target = m.target[token] ?? 0;
  return {
    above: Math.ceil(target * RULES.caravanAbove),
    perDay: Math.max(1, Math.round(target * RULES.caravanPerDay)),
    priceBps: RULES.caravanPriceBps,
  };
}
