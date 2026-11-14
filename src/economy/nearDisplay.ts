// Display-only NEAR prices (folder: minear-r3f/src/economy).
// The contract and the merchant agents still trade in game coins (minear-r3f/src/economy/pricing.ts).
// For the demo every price and balance is SHOWN in NEAR. Nothing here changes a quote or a trade.
//
// The two rates, in one place:
//   1. NEAR_REF: a reference NEAR price per item. Ores are 0.000x NEAR; gems go from 0.02 (Quartz) up to
//      tens of NEAR for the top grade. A price in coins becomes NEAR with
//          nearPrice(token, coins) = NEAR_REF[token] x coins / base
//      so the on-chain factors (stock, 24 h demand, world supply, cash, spread) still move it.
//   2. COIN_NEAR: one rate for coin BALANCES (merchant cash, player coins, investments): 1 coin = 0.01 NEAR.
//      It is chosen so each merchant's starting cash covers the NEAR value of its target stock:
//          Brann     80 NEAR cash for about  1 NEAR of goods
//          Pip      120              about  8
//          Opaline  300              about 67
//          Moss     150              about 20
//          Quill     30              about  2
//          Ossian   120              about 66
//      Because NEAR_REF is not proportional to the coin base (ore is cheap, top gems are dear), a trade's
//      NEAR amount and the change of a coin balance shown in NEAR do not match exactly. Display only.
import { COIN, TOKEN_BY_ID, type TokenId } from './catalog';

/** One game coin, in NEAR, for balances. */
export const COIN_NEAR = 0.01;

/** Reference NEAR price per item, at its base coin price. */
export const NEAR_REF: Record<TokenId, number> = {
  'ore.copper': 0.0003,
  'ore.iron': 0.0008,
  'ore.gold': 0.0025,
  'ore.mythril': 0.009,
  'gem.quartz': 0.02,
  'gem.amethyst': 0.06,
  'gem.emerald': 0.18,
  'gem.sapphire': 0.4,
  'gem.bogjade': 0.5,
  'gem.rime': 0.55,
  'gem.ruby': 1.2,
  'gem.fireopal': 1.6,
  'gem.soulpearl': 1.9,
  'gem.sunstone': 12,
  'gem.voidheart': 38,
};

/** The reference NEAR price of one unit (an unknown item falls back to its base at COIN_NEAR). */
export function nearRef(token: TokenId): number {
  if (token === COIN) return COIN_NEAR;
  return NEAR_REF[token] ?? (TOKEN_BY_ID[token]?.base ?? 0) * COIN_NEAR;
}

/** A coin price (one unit or a total) of `token`, in NEAR. */
export function nearPrice(token: TokenId, coinPrice: number): number {
  if (token === COIN) return coinPrice * COIN_NEAR;
  const base = TOKEN_BY_ID[token]?.base ?? 0;
  return base > 0 ? (nearRef(token) * coinPrice) / base : coinPrice * COIN_NEAR;
}

/** A coin balance in NEAR (merchant cash, player coins, investments). */
export function coinsToNear(coins: number): number {
  return coins * COIN_NEAR;
}

/** NEAR to whole coins (what an investment sends on chain). */
export function nearToCoins(near: number): number {
  return Math.max(0, Math.round(near / COIN_NEAR));
}

/** NEAR as text: 4 significant digits below 1 (at least 4 decimals: 0.0003, 0.0360, 0.2000), 2 decimals
 *  from 1 up (1.20, 38.00, 1,234.50). No unit. */
export function fmtNear(n: number): string {
  if (!Number.isFinite(n) || n === 0) return `0`;
  const a = Math.abs(n);
  if (a >= 1) return n.toLocaleString(`en-US`, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let s = a.toPrecision(4);
  if (s.includes(`e`)) s = a.toFixed(8);
  s = s.replace(/0+$/, ``);
  const dec = s.split(`.`)[1]?.length ?? 0;
  if (dec < 4) s = a.toFixed(4);
  return n < 0 ? `-${s}` : s;
}

/** The NEAR coin icon (styled by minear-r3f/src/brand/nearcoin.css). */
export const NEAR_ICON = `<i class="coin sm" aria-hidden="true"></i>`;

/** "0.0360 NEAR" with the coin icon in front, as HTML. */
export function nearHTML(n: number): string {
  return `<span class="near-amt">${NEAR_ICON}<b>${fmtNear(n)}</b> NEAR</span>`;
}
