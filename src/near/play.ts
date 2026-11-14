// A MINEAR player on NEAR (folder: minear-r3f/src/near). Used by the game client, and by the smoke
// test and bots in minear-r3f/server/tools, so all three take the same path:
//   1. sign a NEP-366 delegate action with the session key (no popup: the key is in this program),
//   2. send it to the relayer (minear-r3f/server), which pays the gas,
//   3. if the relayer refuses with `useOwnGas` (no free actions left, too fast), send the same call
//      as a normal transaction paid from the player's own NEAR, when the player has some.
// Calls go one at a time per player: each delegate action takes the session key's next nonce.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, encodeSignedDelegate, teraToGas } from 'near-api-js';
import { GAME_CONFIG, type TokenId } from '../economy/catalog';
import type { Board, Deployment, GearToken, PlayerView, Side, SignedQuote } from '../economy/types';

export type KeyString = `ed25519:${string}`;

export interface PlayerKeys {
  accountId: string;
  /** Function-call key for the items contract. */
  sessionKey: KeyString;
  /** Full-access key kept on this device (the Demo cheat's local testnet account only; NEAR Auth keeps its own). */
  fullKey?: KeyString;
}

export type PaidBy = 'relayer' | 'player';

export interface CallResult {
  paidBy: PaidBy;
  tx: string;
  /** The call's return value (JSON), when it has one (forge returns the new gear). */
  value?: unknown;
}

/** The return value of the receipt that ran on `contract` (a self-paid transaction's outcome). */
function outcomeValue(res: unknown, contract: string): unknown {
  const o = res as { receipts_outcome?: { outcome?: { executor_id?: string; status?: { SuccessValue?: string } } }[] };
  for (const x of o.receipts_outcome ?? []) {
    const v = x.outcome?.status?.SuccessValue;
    if (x.outcome?.executor_id !== contract || !v) continue;
    try {
      return JSON.parse(atob(v));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class GameError extends Error {
  constructor(
    message: string,
    public retryMs = 0,
    public useOwnGas = false,
  ) {
    super(message);
  }
}

const b64 = (u: Uint8Array): string => {
  let s = ``;
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};

const panicText = (e: unknown): string => {
  const raw = e instanceof Error ? `${e.message} ${JSON.stringify((e as { cause?: unknown }).cause ?? ``)}` : String(e);
  return (raw.match(/[Pp]anicked: ([^"\\]+)/)?.[1] ?? (e instanceof Error ? e.message : raw)).trim().slice(0, 300);
};

export function providerFor(d: Deployment): JsonRpcProvider {
  return new JsonRpcProvider({ url: d.rpc });
}

/** 1 byte of storage locks 10^19 yoctoNEAR. */
const BYTE_COST = 10n ** 19n;

/** NEAR an account can spend: its balance minus what its storage locks. 0 when the account is not there. */
export async function spendable(p: JsonRpcProvider, accountId: string): Promise<bigint> {
  try {
    const a = (await p.viewAccount({ accountId })) as unknown as { amount: bigint | string; storage_usage: number | bigint };
    const free = BigInt(a.amount) - BigInt(a.storage_usage) * BYTE_COST;
    return free > 0n ? free : 0n;
  } catch {
    return 0n;
  }
}

/** True when `publicKey` is an access key of `accountId` on chain. */
export async function hasAccessKey(p: JsonRpcProvider, accountId: string, publicKey: string): Promise<boolean> {
  try {
    await p.viewAccessKey({ accountId, publicKey });
    return true;
  } catch {
    return false;
  }
}

export async function viewCall<T>(d: Deployment, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await providerFor(d).callFunction({ contractId: d.contract, method, args })) as T;
}

/** Makes a session key (and a device full key, unless `fullPublicKey` is given, for example the
 *  player's NEAR Auth key) and asks the server to create <name>.<root> with them. */
export async function createAccount(d: Deployment, server: string, name: string, fullPublicKey?: string): Promise<PlayerKeys> {
  const full = fullPublicKey ? null : KeyPair.fromRandom(`ed25519`);
  const session = KeyPair.fromRandom(`ed25519`);
  const r = await fetch(`${server}/onboard`, {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({
      name,
      fullKey: fullPublicKey ?? full!.getPublicKey().toString(),
      sessionKey: session.getPublicKey().toString(),
    }),
  });
  const body = (await r.json()) as { ok: boolean; accountId?: string; error?: string };
  if (!body.ok || !body.accountId) throw new GameError(body.error ?? `Could not create the account`);
  return {
    accountId: body.accountId,
    sessionKey: session.toString() as KeyString,
    ...(full ? { fullKey: full.toString() as KeyString } : {}),
  };
}

export class Player {
  readonly account: Account;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly deploy: Deployment,
    readonly server: string,
    readonly keys: PlayerKeys,
  ) {
    this.account = new Account(keys.accountId, providerFor(deploy), KeyPairSigner.fromSecretKey(keys.sessionKey));
  }

  get id(): string {
    return this.keys.accountId;
  }

  /** One game call: relayer first, own gas when the relayer says so (and `selfPay` allows it). */
  call(method: string, args: object, opts: { tgas?: number; selfPay?: boolean } = {}): Promise<CallResult> {
    const run = () => this.callNow(method, args, opts);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async callNow(method: string, args: object, opts: { tgas?: number; selfPay?: boolean }): Promise<CallResult> {
    const action = actions.functionCall(method, args, teraToGas(opts.tgas ?? 50), 0n);
    const { signedDelegate } = await this.account.createSignedMetaTransaction({
      receiverId: this.deploy.contract,
      actions: [action],
      blockHeightTtl: 120,
    });
    const r = await fetch(`${this.server}/relay`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ signedDelegate: b64(encodeSignedDelegate(signedDelegate)) }),
    });
    const body = (await r.json()) as { ok: boolean; tx?: string; value?: unknown; error?: string; retryMs?: number; useOwnGas?: boolean };
    if (body.ok) return { paidBy: `relayer`, tx: body.tx ?? ``, value: body.value ?? undefined };
    if (!body.useOwnGas || opts.selfPay === false) throw new GameError(body.error ?? `Relayer error`, body.retryMs, body.useOwnGas);
    if (!(await this.hasGas())) throw new GameError(body.error ?? `Relayer refused`, body.retryMs, true);
    try {
      const res = await this.account.signAndSendTransaction({ receiverId: this.deploy.contract, actions: [action] });
      return {
        paidBy: `player`,
        tx: (res as { transaction?: { hash?: string } }).transaction?.hash ?? ``,
        value: outcomeValue(res, this.deploy.contract),
      };
    } catch (e) {
      throw new GameError(panicText(e));
    }
  }

  /** NEAR the player can spend on their own gas (above what storage needs). */
  async nearBalance(): Promise<bigint> {
    return spendable(providerFor(this.deploy), this.id);
  }

  /** True when the player pays their own gas (GAME_CONFIG.ownGasAbove: the same line the relayer uses). */
  async hasGas(): Promise<boolean> {
    return (await this.nearBalance()) >= BigInt(GAME_CONFIG.ownGasAbove);
  }

  view(): Promise<PlayerView> {
    return viewCall<PlayerView>(this.deploy, `player_view`, { account_id: this.id });
  }

  async board(): Promise<Board> {
    try {
      const r = await fetch(`${this.server}/board`);
      if (r.ok) return (await r.json()) as Board;
    } catch {
      /* server down: read the chain directly */
    }
    return viewCall<Board>(this.deploy, `market_board`);
  }

  register(): Promise<CallResult> {
    return this.call(`register`, {}, { tgas: 20 });
  }

  /** Saves a trip's haul on chain. `trip`: the trip report (v2 contract: the record, the feed and the boards). */
  saveTrip(items: [TokenId, number][], trip?: { depth_m: number }): Promise<CallResult> {
    return this.call(`save_trip`, { items: items.map(([t, n]) => [t, String(n)]), ...(trip ? { trip } : {}) });
  }

  /** The Forge on chain: burns the grade's materials and mints `times` gear NFTs. Returns the new pieces. */
  async forge(kind: string, grade: string, times: number): Promise<GearToken[]> {
    const r = await this.call(`forge`, { kind, grade, times }, { tgas: 100 });
    if (!Array.isArray(r.value)) throw new GameError(`The Forge did not answer with the new gear`);
    return r.value as GearToken[];
  }

  async reroll(tokenId: string): Promise<GearToken> {
    const r = await this.call(`reroll`, { token_id: tokenId });
    return r.value as GearToken;
  }

  async salvage(tokenId: string): Promise<[TokenId, string][]> {
    const r = await this.call(`salvage`, { token_id: tokenId });
    return (r.value as [TokenId, string][]) ?? [];
  }

  /** Every gear NFT this player owns (raw fields). */
  gearOf(): Promise<GearToken[]> {
    return viewCall<GearToken[]>(this.deploy, `gear_of`, { account_id: this.id });
  }

  burn(items: [TokenId, number][], memo: string): Promise<CallResult> {
    return this.call(`burn`, { items: items.map(([t, n]) => [t, String(n)]), memo });
  }

  craft(recipeId: string, times = 1): Promise<CallResult> {
    return this.call(`craft`, { recipe_id: recipeId, times });
  }

  invest(merchantAccount: string, coins: number): Promise<CallResult> {
    return this.call(`invest`, { merchant: merchantAccount, amount: String(coins) });
  }

  buyActions(): Promise<CallResult> {
    return this.call(`buy_actions`, {}, { tgas: 20 });
  }

  /** A signed price from a merchant agent. Throws with the merchant's refusal when there is one. */
  async quote(merchantId: string, token: TokenId, side: Side, amount: number): Promise<SignedQuote> {
    const q = new URLSearchParams({ merchant: merchantId, token, side, amount: String(amount), player: this.id });
    const r = await fetch(`${this.server}/quote?${q}`);
    const body = (await r.json()) as SignedQuote & { ok?: boolean; error?: string };
    if (!r.ok) throw new GameError(body.error ?? `No quote`);
    return body;
  }

  /** One line the merchant says about a trade or a refusal, written by NEAR AI on the server.
   *  Never a price. Null when the server has no AI key, is down, or chose the canned line. */
  async talk(merchantId: string, token: TokenId, side: Side, outcome: string): Promise<string | null> {
    try {
      const q = new URLSearchParams({ merchant: merchantId, token, side, player: this.id, outcome });
      const r = await fetch(`${this.server}/talk?${q}`);
      if (!r.ok) return null;
      const body = (await r.json()) as { line?: string; source?: string };
      return body.source === `ai` && body.line ? body.line : null;
    } catch {
      return null;
    }
  }

  trade(q: SignedQuote): Promise<CallResult> {
    return this.call(`trade`, { quote: q.quote, signature: q.signature }, { tgas: 60 });
  }
}
