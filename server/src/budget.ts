// Gas and storage budget of the relayer (folder: minear-r3f/server). Nothing here runs on a timer: every check
// happens inside a relay request. No database: one small JSON file per network.
//
// 1. The system daily cap. The relayer pays for at most DAILY_CAP game calls per UTC day, all players together
//    (each player also has the contract's own daily limit, `daily_free`). When the cap is used up, the relayer
//    refuses until 00:00 UTC: a player with NEAR can pay their own gas, a player with no NEAR waits, and the
//    trip's materials stay in the browser save until the next save. The count is kept in
//    minear-r3f/server/.state/budget-<network>.json, so a server restart does not reset it.
//
// 2. Automatic top-ups. On NEAR every stored byte locks 0.00001 NEAR in the account that stores it. The items
//    contract stores the gear NFTs, the players' balances and trip records, so it needs more NEAR as the game
//    grows (a player has no NEAR to pay for it). After a relay, at most once per CHECK_MS, the server reads the
//    balances of the contract, the relay account and the root account (3 RPC reads, no gas). When the contract's
//    free balance is under CONTRACT_MIN, or the relay balance under RELAY_MIN, the root account sends a top-up.
//    The root never goes under ROOT_KEEP, and all top-ups of one UTC day stay under TOPUP_DAY_MAX.
//    When the root cannot pay, the server logs it and GET /health shows `funds.low: true`: fund the root account
//    (testnet: a NEAR testnet faucet, or a transfer from another testnet account).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actions, nearToYocto } from 'near-api-js';
import type { Deployment } from '../../src/economy/types';
import { APP_DIR, LOCAL, NETWORK } from './env';
import { account, errorText, provider } from './near';

const DAY_MS = 86_400_000;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== `` && Number.isFinite(Number(v)) ? Number(v) : d);

/** Game calls the relayer pays for per UTC day, all players together. 0 = no cap (the local chain). */
export const DAILY_CAP = num(process.env.MINEAR_RELAY_DAILY_CAP, LOCAL ? 0 : NETWORK === `mainnet` ? 2_400 : 24_000);
const CHECK_MS = 10 * 60_000;
const NEAR = (n: string) => nearToYocto(n);
const CONTRACT_MIN = NEAR(process.env.MINEAR_CONTRACT_MIN_FREE ?? `1`);
const CONTRACT_TOPUP = NEAR(process.env.MINEAR_CONTRACT_TOPUP ?? `2`);
const RELAY_MIN = NEAR(process.env.MINEAR_RELAY_MIN ?? `1`);
const RELAY_TOPUP = NEAR(process.env.MINEAR_RELAY_TOPUP ?? `2`);
const ROOT_KEEP = NEAR(`0.5`);
const SMALLEST = NEAR(`0.1`);
const TOPUP_DAY_MAX = NEAR(process.env.MINEAR_TOPUP_DAY_MAX ?? `10`);
/** 1 byte of storage = 10^19 yoctoNEAR. */
const BYTE = 10n ** 19n;

const STATE_DIR = join(APP_DIR, `server`, `.state`);
const STATE_FILE = join(STATE_DIR, `budget-${NETWORK}.json`);

interface DayState {
  day: number;
  /** Game calls sent to the chain today (also the ones that failed: they cost gas too). */
  used: number;
  /** NEAR (yocto) sent as top-ups today. */
  topped: string;
}

const today = (now = Date.now()) => Math.floor(now / DAY_MS);
let state: DayState = load();

function load(): DayState {
  try {
    if (existsSync(STATE_FILE)) {
      const s = JSON.parse(readFileSync(STATE_FILE, `utf8`)) as DayState;
      if (s.day === today()) return { day: s.day, used: Number(s.used) || 0, topped: String(s.topped ?? `0`) };
    }
  } catch {
    /* a broken file starts a new count */
  }
  return { day: today(), used: 0, topped: `0` };
}

function roll(now: number): void {
  if (state.day !== today(now)) state = { day: today(now), used: 0, topped: `0` };
}

function save(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state) + `\n`);
  } catch (e) {
    console.warn(`[budget] cannot write ${STATE_FILE}: ${errorText(e)}`);
  }
}

const untilMidnight = (now: number) => (today(now) + 1) * DAY_MS - now;

/** Takes one call from today's system cap. Returns the refusal text and the wait when the cap is used up. */
export function takeOne(now = Date.now()): { error: string; retryMs: number } | null {
  roll(now);
  if (DAILY_CAP > 0 && state.used >= DAILY_CAP) {
    const ms = untilMidnight(now);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.ceil((ms % 3_600_000) / 60_000);
    return {
      error: `The game's free gas for today is used up (${DAILY_CAP.toLocaleString(`en-US`)} actions for all players). It comes back at 00:00 UTC, in ${h} h ${m} min.`,
      retryMs: ms,
    };
  }
  state.used += 1;
  save();
  return null;
}

// ---- automatic top-ups ----

interface Funds {
  contractFree: string;
  relay: string;
  root: string;
  checkedAt: number;
  low: boolean;
  note: string;
}

let funds: Funds | null = null;
let lastCheck = 0;
let checking = false;

async function balance(id: string): Promise<{ amount: bigint; storage: bigint }> {
  const a = (await provider.viewAccount({ accountId: id })) as unknown as { amount: string | bigint; storage_usage: number | bigint };
  return { amount: BigInt(a.amount), storage: BigInt(a.storage_usage) * BYTE };
}

const fmt = (y: bigint) => (Number(y / 10n ** 20n) / 1e4).toFixed(4);

/** Called after each relay. Reads the balances at most once per CHECK_MS and tops up from the root when needed.
 *  Runs after the player's answer is sent: the player never waits for it. */
export function afterRelay(deploy: Deployment, now = Date.now()): void {
  if (checking || now - lastCheck < CHECK_MS) return;
  lastCheck = now;
  checking = true;
  void check(deploy)
    .catch((e) => console.warn(`[budget] balance check failed: ${errorText(e)}`))
    .finally(() => {
      checking = false;
    });
}

/** One send from the root at a time (the root also creates player accounts: minear-r3f/server/src/onboard.ts). */
let rootQueue: Promise<unknown> = Promise.resolve();
export function rootTx<T>(f: () => Promise<T>): Promise<T> {
  const p = rootQueue.then(f, f);
  rootQueue = p.catch(() => undefined);
  return p;
}

async function check(deploy: Deployment): Promise<void> {
  const [c, r, root] = await Promise.all([balance(deploy.contract), balance(deploy.relayer), balance(deploy.root)]);
  const contractFree = c.amount - c.storage;
  let rootFree = root.amount - root.storage - ROOT_KEEP;
  roll(Date.now());
  let low = false;
  const notes: string[] = [];
  const send = async (to: string, want: bigint, why: string) => {
    const room = TOPUP_DAY_MAX - BigInt(state.topped);
    const amount = [want, rootFree, room].reduce((a, b) => (b < a ? b : a));
    if (amount < SMALLEST) {
      low = true;
      notes.push(`${why}: no top-up (root ${deploy.root} has ${fmt(root.amount)} NEAR, today's top-ups ${fmt(BigInt(state.topped))} NEAR)`);
      return;
    }
    await rootTx(() => account(deploy.root).signAndSendTransaction({ receiverId: to, actions: [actions.transfer(amount)] }));
    rootFree -= amount;
    state.topped = String(BigInt(state.topped) + amount);
    save();
    notes.push(`${why}: sent ${fmt(amount)} NEAR from ${deploy.root} to ${to}`);
  };
  if (contractFree < CONTRACT_MIN) await send(deploy.contract, CONTRACT_TOPUP, `contract storage ${fmt(contractFree)} NEAR free`);
  if (r.amount < RELAY_MIN) await send(deploy.relayer, RELAY_TOPUP, `relay gas ${fmt(r.amount)} NEAR`);
  if (rootFree < CONTRACT_TOPUP + RELAY_TOPUP) {
    low = true;
    notes.push(`root ${deploy.root} has ${fmt(root.amount)} NEAR: fund it before the next top-ups`);
  }
  funds = { contractFree: fmt(contractFree), relay: fmt(r.amount), root: fmt(root.amount), checkedAt: Date.now(), low, note: notes.join(`; `) };
  for (const n of notes) console.log(`[budget] ${n}`);
}

/** For GET /health. */
export function budgetStatus(now = Date.now()) {
  roll(now);
  return {
    day: new Date(state.day * DAY_MS).toISOString().slice(0, 10),
    used: state.used,
    cap: DAILY_CAP,
    resetsInMs: untilMidnight(now),
    toppedToday: fmt(BigInt(state.topped)),
    funds,
  };
}
