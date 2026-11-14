// The merchant agents (folder: minear-r3f/server). Each merchant has its own NEAR account and key.
// When a player asks for a price, the merchant reads the market (one cached view call), runs the
// rules in minear-r3f/src/economy/pricing.ts, and signs a quote the items contract will accept for
// 20 seconds. The agents only act when asked: no timers, no polling.
import { KeyPair } from 'near-api-js';
import { TOKEN_BY_ID } from '../../src/economy/catalog';
import { MERCHANT_BY_ID, RULES, quote, snapshot } from '../../src/economy/pricing';
import { quoteMessage, type Board, type Deployment, type Quote, type Side, type SignedQuote } from '../../src/economy/types';
import { loadKey } from './env';
import { view } from './near';

const BOARD_TTL_MS = 4_000;
let cache: { at: number; board: Board } | null = null;
let inflight: Promise<Board> | null = null;

/** The market board, read at most once per BOARD_TTL_MS however many players ask. */
export async function getBoard(deploy: Deployment): Promise<Board> {
  const now = Date.now();
  if (cache && now - cache.at < BOARD_TTL_MS) return cache.board;
  inflight ??= view<Board>(deploy.contract, `market_board`)
    .then((board) => {
      cache = { at: Date.now(), board };
      return board;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** After a trade, save_trip, craft or invest the board is out of date. */
export function invalidateBoard(): void {
  cache = null;
}

const keys = new Map<string, KeyPair>();
function keyOf(accountId: string): KeyPair {
  let k = keys.get(accountId);
  if (!k) {
    k = KeyPair.fromString(loadKey(accountId));
    keys.set(accountId, k);
  }
  return k;
}

export async function quoteFor(
  deploy: Deployment,
  p: URLSearchParams,
): Promise<{ status: number; body: SignedQuote | Record<string, unknown> }> {
  const id = p.get(`merchant`) ?? ``;
  const token = p.get(`token`) ?? ``;
  const side = p.get(`side`) as Side;
  const amount = Math.floor(Number(p.get(`amount`) ?? 0));
  const player = p.get(`player`) ?? ``;
  const rules = MERCHANT_BY_ID[id];
  const merchant = deploy.merchants[id];
  if (!rules || !merchant) return { status: 404, body: { ok: false, error: `No merchant ${id}` } };
  if (!TOKEN_BY_ID[token]) return { status: 400, body: { ok: false, error: `No item ${token}` } };
  if (side !== `sell` && side !== `buy`) return { status: 400, body: { ok: false, error: `side must be sell or buy` } };
  if (!(amount >= 1 && amount <= 1000)) return { status: 400, body: { ok: false, error: `amount must be 1 to 1000` } };
  if (!player.endsWith(`.${deploy.root}`)) return { status: 400, body: { ok: false, error: `Not a MINEAR player` } };

  const [board, nonce] = await Promise.all([
    getBoard(deploy),
    view<string>(deploy.contract, `merchant_nonce`, { merchant, player }),
  ]);
  const m = board.merchants.find((x) => x.account_id === merchant);
  if (!m) return { status: 404, body: { ok: false, error: `${merchant} is not on the board` } };
  const r = quote(rules, token, side, amount, snapshot(board, m, token));
  if (r.refusal) return { status: 409, body: { ok: false, error: r.refusal, reasons: r.reasons } };

  const q: Quote = {
    merchant,
    player,
    token_id: token,
    side,
    amount: String(r.amount),
    coins: String(r.coins),
    expires_ms: String(Date.now() + RULES.quoteMs),
    nonce: String(nonce),
  };
  const sig = keyOf(merchant).sign(new TextEncoder().encode(quoteMessage(deploy.contract, q)));
  return { status: 200, body: { quote: q, signature: Buffer.from(sig.signature).toString(`base64`), reasons: r.reasons } };
}
