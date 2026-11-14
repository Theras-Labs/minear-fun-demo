// The gas relayer (folder: minear-r3f/server). Players sign a NEP-366 delegate action with their
// session key; this server wraps it in a transaction from the relay account, which pays the gas.
//
// It pays for two kinds of request, from any NEAR account (a MINEAR account <name>.<root> made with Google, or a
// player's own wallet account such as alice.testnet):
//   1. a game call: one function call, to the items contract, of a game method, with no deposit;
//   2. the one-time game key of a wallet player (relayKey): one AddKey on the player's own account, a function-call
//      key for the items contract only, signed by the player's wallet. At most KEYS_PER_DAY per account.
// It refuses (HTTP 429, `useOwnGas: true`):
//   - an account that holds NEAR (GAME_CONFIG.ownGasAbove, the user's rule of 2026-11-13: free gas is only for a
//     wallet with no NEAR). Its session key pays its own gas, so the player still sees no popup,
//   - a player with no gas-free actions left today (the contract also enforces this),
//   - a save_trip sooner than the contract's cooldown,
//   - a request less than MIN_GAP_MS after the same player's last one (bot speed),
//   - the same call repeated within DUP_MS,
//   - any call when the system daily cap (all players together) is used up (minear-r3f/server/src/budget.ts).
// Each refusal for bot speed or a repeat is a strike; strikes block the player from the relayer for
// 10 s, 20 s, 40 s... up to 1 h. A blocked player can still play by paying their own gas.
// After a relay, budget.ts also checks the contract and relay balances (at most once per 10 min) and tops them
// up from the root account.
// Nothing here runs on a timer: all checks happen when a request comes in.
//
// It also keeps the last EVENTS_MAX successful relays in memory (GET /events in minear-r3f/server/src/main.ts):
// the merchant dialog's Activity feed (minear-r3f/src/menus/merchantDialog.ts). No database, no timer;
// a restart empties it.
import { createHash } from 'node:crypto';
import { KeyPair, decodeSignedDelegate, type SignedDelegate } from 'near-api-js';
import { GAME_CONFIG, type TokenId } from '../../src/economy/catalog';
import { quoteMessage, type Deployment, type PlayerView, type Quote, type Side } from '../../src/economy/types';
import { afterRelay, takeOne } from './budget';
import { GAME_METHODS, loadKey } from './env';
import { account, errorText, provider, view } from './near';

const MIN_GAP_MS = 2_500;
const DUP_MS = 10_000;
const BLOCK_BASE_MS = 10_000;
const BLOCK_MAX_MS = 3_600_000;
const VIEW_TTL_MS = 20_000;
/** Methods that do not use a gas-free action. */
const FREE_METHODS = new Set([`register`, `buy_actions`]);

interface Guard {
  last: number;
  strikes: number;
  blockedUntil: number;
  recent: Map<string, number>;
}

const guards = new Map<string, Guard>();
const views = new Map<string, { at: number; v: PlayerView; spend: bigint }>();
/** One storage byte locks 10^19 yoctoNEAR. */
const BYTE = 10n ** 19n;
const OWN_GAS_ABOVE = BigInt(GAME_CONFIG.ownGasAbove);
const KEY_ALLOWANCE_MAX = BigInt(GAME_CONFIG.sessionAllowance);
/** Game keys the relayer adds for one account per UTC day (a wallet player signing in on new devices). */
const KEYS_PER_DAY = 3;
const keysToday = new Map<string, { day: number; n: number }>();

export interface RelayResult {
  status: number;
  body: Record<string, unknown>;
}

const refuse = (error: string, retryMs = 0, status = 429): RelayResult => ({
  status,
  body: { ok: false, error, retryMs, useOwnGas: status === 429 },
});

function guard(sender: string, key: string, now: number): RelayResult | null {
  let g = guards.get(sender);
  if (!g) {
    g = { last: 0, strikes: 0, blockedUntil: 0, recent: new Map() };
    guards.set(sender, g);
    if (guards.size > 20_000) for (const [k, v] of guards) if (now - v.last > 3_600_000) guards.delete(k);
  }
  if (now < g.blockedUntil) return refuse(`Too fast: the relayer is paused for you`, g.blockedUntil - now);
  if (now - g.last > 600_000) g.strikes = 0;
  for (const [k, t] of g.recent) if (now - t > DUP_MS) g.recent.delete(k);
  const dup = g.recent.has(key);
  const fast = now - g.last < MIN_GAP_MS;
  if (dup || fast) {
    g.strikes += 1;
    const ms = Math.min(BLOCK_MAX_MS, BLOCK_BASE_MS * 2 ** (g.strikes - 1));
    g.blockedUntil = now + ms;
    return refuse(dup ? `Same request twice: looks like a bot` : `Requests too close together: looks like a bot`, ms);
  }
  g.last = now;
  g.recent.set(key, now);
  return null;
}

/** NEAR the account can spend: balance minus what its storage locks (0 when it is not on chain). */
async function spendable(accountId: string): Promise<bigint> {
  try {
    const a = (await provider.viewAccount({ accountId })) as unknown as { amount: bigint | string; storage_usage: number | bigint };
    const free = BigInt(a.amount) - BigInt(a.storage_usage) * BYTE;
    return free > 0n ? free : 0n;
  } catch {
    return 0n;
  }
}

/** The player's contract view and their spendable NEAR, read together and kept VIEW_TTL_MS. */
async function playerView(contract: string, sender: string, now: number): Promise<{ v: PlayerView; spend: bigint }> {
  const c = views.get(sender);
  if (c && now - c.at < VIEW_TTL_MS) return c;
  const [v, spend] = await Promise.all([view<PlayerView>(contract, `player_view`, { account_id: sender }), spendable(sender)]);
  const e = { at: now, v: { ...v, now_ms: now }, spend };
  views.set(sender, e);
  return e;
}

const ownGas = () =>
  refuse(`This account holds NEAR, so it pays its own gas (the game's free gas is for accounts with no NEAR)`);

const merchantKeys = new Map<string, KeyPair>();

/** A trade the contract would refuse costs gas for nothing: check the quote here first. */
function checkQuote(deploy: Deployment, sender: string, raw: Uint8Array, now: number): string | null {
  let a: { quote?: Quote; signature?: string };
  try {
    a = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return `trade arguments are not JSON`;
  }
  const q = a.quote;
  if (!q || !a.signature) return `trade needs a quote and a signature`;
  if (q.player !== sender) return `This quote is for another player`;
  if (Number(q.expires_ms) < now) return `Quote expired: ask the merchant again`;
  if (!Object.values(deploy.merchants).includes(q.merchant)) return `Unknown merchant`;
  let k = merchantKeys.get(q.merchant);
  if (!k) {
    k = KeyPair.fromString(loadKey(q.merchant));
    merchantKeys.set(q.merchant, k);
  }
  const sig = Buffer.from(a.signature, `base64`);
  if (sig.length !== 64 || !k.verify(new TextEncoder().encode(quoteMessage(deploy.contract, q)), sig))
    return `Bad merchant signature: the quote was changed`;
  return null;
}

// ---- the activity ring buffer ----

/** One successful relayed game call. Only the fields of its method are set. */
export interface RelayEvent {
  at: number;
  sender: string;
  method: string;
  /** Transaction hash (testnet explorer: https://testnet.nearblocks.io/txns/<tx>). */
  tx: string;
  /** trade and invest: the merchant account. */
  merchant?: string;
  /** trade */
  token?: TokenId;
  side?: Side;
  amount?: number;
  /** trade: total coins; invest: coins invested. */
  coins?: number;
  /** save_trip and burn */
  items?: [TokenId, number][];
  memo?: string;
  /** craft */
  recipe?: string;
  times?: number;
}

const EVENTS_MAX = 200;
const events: RelayEvent[] = [];
/** Methods that change the world supply (shown in every merchant's feed with `world=1`). */
const WORLD_METHODS = new Set([`save_trip`, `craft`, `burn`]);

function remember(sender: string, method: string, raw: Uint8Array, tx: string): void {
  const e: RelayEvent = { at: Date.now(), sender, method, tx };
  try {
    const a = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    const items = (v: unknown) => (Array.isArray(v) ? v.map(([t, n]: [string, string]) => [String(t), Number(n)] as [TokenId, number]) : undefined);
    if (method === `trade`) {
      const q = (a.quote ?? {}) as Partial<Quote>;
      Object.assign(e, { merchant: q.merchant, token: q.token_id, side: q.side, amount: Number(q.amount), coins: Number(q.coins) });
    } else if (method === `invest`) Object.assign(e, { merchant: String(a.merchant ?? ``), coins: Number(a.amount ?? 0) });
    else if (method === `save_trip`) e.items = items(a.items);
    else if (method === `burn`) Object.assign(e, { items: items(a.items), memo: String(a.memo ?? ``) });
    else if (method === `craft`) Object.assign(e, { recipe: String(a.recipe_id ?? ``), times: Number(a.times ?? 1) });
  } catch {
    /* arguments are not JSON: keep the bare event */
  }
  events.push(e);
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
}

/** Newest first. `merchant`: only that merchant's trades and investments, plus the world supply events
 *  (save_trip, craft, burn) when `world` is true. No merchant: every event. */
export function recentEvents(merchant: string | null, world: boolean, limit: number): RelayEvent[] {
  const out: RelayEvent[] = [];
  const n = Math.max(1, Math.min(EVENTS_MAX, Math.floor(limit) || 50));
  for (let i = events.length - 1; i >= 0 && out.length < n; i--) {
    const e = events[i];
    if (!merchant || e.merchant === merchant || (world && WORLD_METHODS.has(e.method))) out.push(e);
  }
  return out;
}

/** Serializes relay transactions: one relay key, one nonce sequence. */
let queue: Promise<unknown> = Promise.resolve();
/** The contract's panic text when any receipt of the relayed transaction failed, else null. */
function receiptFailure(r: unknown): string | null {
  const o = r as { status?: { Failure?: unknown }; receipts_outcome?: { outcome?: { status?: { Failure?: unknown } } }[] };
  const fail = o.status?.Failure ?? o.receipts_outcome?.find((x) => x.outcome?.status?.Failure)?.outcome?.status?.Failure;
  if (!fail) return null;
  const raw = JSON.stringify(fail);
  const m = raw.match(/[Pp]anicked: ([^"\\]+)/);
  return (m?.[1] ?? `The game call failed on chain: ${raw.slice(0, 200)}`).trim();
}

/** The game call's return value (JSON) from the receipt that ran it on the contract, or null. */
function receiptValue(r: unknown, contract: string): unknown {
  const o = r as { receipts_outcome?: { outcome?: { executor_id?: string; status?: { SuccessValue?: string } } }[] };
  for (const x of o.receipts_outcome ?? []) {
    const v = x.outcome?.status?.SuccessValue;
    if (x.outcome?.executor_id !== contract || !v) continue;
    try {
      return JSON.parse(Buffer.from(v, `base64`).toString(`utf8`));
    } catch {
      return null;
    }
  }
  return null;
}

function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = queue.then(f, f);
  queue = p.catch(() => undefined);
  return p;
}

export async function relay(deploy: Deployment, base64: string, onDone: () => void): Promise<RelayResult> {
  let sd: SignedDelegate;
  try {
    sd = decodeSignedDelegate(Buffer.from(base64, `base64`));
  } catch {
    return refuse(`Not a signed delegate action`, 0, 400);
  }
  const da = sd.delegateAction;
  const sender = da.senderId;
  if (da.actions.length !== 1) return refuse(`One action per request`, 0, 400);
  const addKey = (da.actions[0] as { addKey?: AddKeyAction }).addKey;
  if (addKey) return relayKey(deploy, sd, addKey, onDone);
  if (da.receiverId !== deploy.contract) return refuse(`The relayer only pays for the MINEAR items contract`, 0, 403);
  const call = (da.actions[0] as { functionCall?: { methodName: string; args: Uint8Array | number[]; deposit: bigint } })
    .functionCall;
  if (!call) return refuse(`Only function calls`, 0, 400);
  const fc = { ...call, args: call.args instanceof Uint8Array ? call.args : Uint8Array.from(call.args) };
  if (!GAME_METHODS.includes(fc.methodName)) return refuse(`The relayer does not pay for ${fc.methodName}`, 0, 403);
  if (BigInt(fc.deposit ?? 0) !== 0n) return refuse(`No deposits through the relayer`, 0, 400);

  const now = Date.now();
  if (fc.methodName === `trade`) {
    const bad = checkQuote(deploy, sender, fc.args, now);
    if (bad) return refuse(bad, 0, 400);
  }
  const key = createHash(`sha256`).update(fc.methodName).update(fc.args).digest(`hex`);
  const g = guard(sender, key, now);
  if (g) return g;

  let pv: PlayerView;
  try {
    const r = await playerView(deploy.contract, sender, now);
    if (r.spend >= OWN_GAS_ABOVE) return ownGas();
    pv = r.v;
  } catch (e) {
    return refuse(`Could not read your account: ${errorText(e)}`, 2_000, 503);
  }
  const charged = !FREE_METHODS.has(fc.methodName);
  if (charged && pv.free_left <= 0) return refuse(`No gas-free actions left today: buy a pack or pay your own gas`);
  if (fc.methodName === `save_trip` && pv.next_save_ms > now)
    return refuse(`Save cooldown: wait ${Math.ceil((pv.next_save_ms - now) / 1000)} s`, pv.next_save_ms - now);
  // the system daily cap (all players together), taken last so a refused request does not use it
  const capped = takeOne(now);
  if (capped) return refuse(capped.error, capped.retryMs);
  afterRelay(deploy, now);

  try {
    const r = await serial(() => account(deploy.relayer).relayMetaTransaction(sd));
    // The outer transaction succeeds even when the game call inside it panics (not enough material, a cap):
    // read every receipt, or a failed burn or craft would look done to the player.
    const failed = receiptFailure(r);
    if (failed) {
      views.delete(sender);
      onDone();
      return { status: 422, body: { ok: false, error: failed } };
    }
    const c = views.get(sender);
    if (c) {
      if (charged) c.v.free_left = Math.max(0, c.v.free_left - 1);
      if (fc.methodName === `save_trip`) c.v.next_save_ms = Date.now() + GAME_CONFIG.saveCooldownMs;
    }
    onDone();
    const tx = (r as { transaction?: { hash?: string } }).transaction?.hash ?? ``;
    remember(sender, fc.methodName, fc.args, tx);
    return { status: 200, body: { ok: true, tx, value: receiptValue(r, deploy.contract) } };
  } catch (e) {
    views.delete(sender);
    onDone();
    return { status: 422, body: { ok: false, error: errorText(e) } };
  }
}

/** The AddKey action inside a decoded delegate action (near-api-js classes, read field by field). */
interface AddKeyAction {
  publicKey: { toString(): string };
  accessKey: { permission: { functionCall?: { allowance?: bigint | null; receiverId: string; methodNames: string[] }; fullAccess?: unknown } };
}

/**
 * A wallet player's one-time game key, gas paid by the relayer (the player has no NEAR to pay for it). The wallet
 * signs a delegate action that adds a function-call key to the player's own account: the items contract only, any
 * method, no deposit, an allowance of at most GAME_CONFIG.sessionAllowance. The key's storage fits in the free
 * storage of a NEAR account (NEP-448, 770 bytes), so the player needs no NEAR at all.
 */
async function relayKey(deploy: Deployment, sd: SignedDelegate, add: AddKeyAction, onDone: () => void): Promise<RelayResult> {
  const da = sd.delegateAction;
  const sender = da.senderId;
  if (da.receiverId !== sender) return refuse(`A game key can only be added to the player's own account`, 0, 400);
  const fc = add.accessKey?.permission?.functionCall;
  if (!fc) return refuse(`The relayer adds only a function-call key for the MINEAR items contract`, 0, 403);
  if (fc.receiverId !== deploy.contract) return refuse(`The game key must be for ${deploy.contract}`, 0, 403);
  if (fc.allowance == null || BigInt(fc.allowance) > KEY_ALLOWANCE_MAX)
    return refuse(`The game key's gas allowance must be at most 0.25 NEAR`, 0, 400);
  if (fc.methodNames.some((m) => !GAME_METHODS.includes(m))) return refuse(`The game key may only call game methods`, 0, 403);

  const now = Date.now();
  const g = guard(sender, `addkey:${add.publicKey.toString()}`, now);
  if (g) return g;
  const day = Math.floor(now / 86_400_000);
  const k = keysToday.get(sender);
  const n = k && k.day === day ? k.n : 0;
  if (n >= KEYS_PER_DAY) return refuse(`${KEYS_PER_DAY} new game keys today for this account: try again tomorrow`, 0, 429);
  if ((await spendable(sender)) >= OWN_GAS_ABOVE) return ownGas();
  const capped = takeOne(now);
  if (capped) return refuse(capped.error, capped.retryMs);
  afterRelay(deploy, now);
  keysToday.set(sender, { day, n: n + 1 });
  if (keysToday.size > 20_000) for (const [a, v] of keysToday) if (v.day !== day) keysToday.delete(a);
  try {
    const r = await serial(() => account(deploy.relayer).relayMetaTransaction(sd));
    const failed = receiptFailure(r);
    onDone();
    if (failed) return { status: 422, body: { ok: false, error: failed } };
    return { status: 200, body: { ok: true, tx: (r as { transaction?: { hash?: string } }).transaction?.hash ?? `` } };
  } catch (e) {
    onDone();
    return { status: 422, body: { ok: false, error: errorText(e) } };
  }
}
