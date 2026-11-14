// The player's MINEAR account on NEAR in this browser (folder: minear-r3f/src/near).
// Every way in ends with the same thing: a session key in this browser, so every game action is signed here
// with no popup, and the relayer (minear-r3f/server) pays the gas.
//   - NEAR Auth (Google, Apple, email, passkey) on testnet: the account's full key is the player's NEAR Auth key.
//   - A NEAR wallet on testnet (NEAR Connect, minear-r3f/src/near/wallet.ts): a MINEAR account <name>.<root> owned
//     by the wallet's key, made after the wallet signs one free message. No NEAR needed.
//   - Demo cheat (dev-local only, minear-r3f/src/game/entry.ts): a device account on the NEAR local chain
//     (minear-r3f/server/tools/localChain.ts), made on the first Play. Its full key is kept on this device.
// The network follows the entry mode: the local chain in the Demo cheat, testnet otherwise.
import deployJson from '../economy/deploy.testnet.json';
import { MERCHANTS } from '../economy/pricing';
import type { Deployment } from '../economy/types';
import { CHEAT, LOCAL_SERVER } from '../game/entry';
import { KeyPair } from 'near-api-js';
import { GAME_CONFIG } from '../economy/catalog';
import { accountsWithKey, nearAuthLogin, type NearAuthUser } from './nearAuth';
import { GameError, Player, createAccount, hasAccessKey, providerFor, spendable, type KeyString, type PlayerKeys } from './play';
import { near } from './wallet';

/** The local chain's accounts as minear-r3f/server/tools/setup.ts makes them (root test.near). Checked against
 *  the local server's GET /deploy before the first account is made. */
const LOCAL_DEPLOY: Deployment = {
  network: `local`,
  rpc: `http://127.0.0.1:3030`,
  root: `test.near`,
  contract: `items.test.near`,
  relayer: `relay.test.near`,
  merchants: Object.fromEntries(MERCHANTS.map((m) => [m.id, `${m.id}.test.near`])),
};

export const DEPLOY: Deployment = CHEAT ? LOCAL_DEPLOY : (deployJson as Deployment);
export const SERVER = CHEAT ? LOCAL_SERVER : ((import.meta.env.VITE_MINEAR_SERVER as string | undefined) ?? `http://127.0.0.1:8787`);

interface Saved extends PlayerKeys {
  via: 'nearauth' | 'device' | 'wallet';
  email?: string;
  /** The NEAR wallet account that owns this MINEAR account (via `wallet`). */
  wallet?: string;
}

const KEY = `minear.near.session.${DEPLOY.network}`;
/** A signed-out account's keys: kept, so signing in again with the same NEAR Auth login finds its game key. */
const OUT_KEY = `${KEY}.out`;
/** Wallet players' MINEAR accounts and game keys in this browser, by wallet id: kept after sign-out, so signing in
 *  again with the same wallet needs no new account. */
const LINKED = `minear.near.linked.${DEPLOY.network}`;

function linkedKeys(): Record<string, { accountId: string; sessionKey: KeyString }> {
  try {
    return JSON.parse(localStorage.getItem(LINKED) ?? `{}`) as Record<string, { accountId: string; sessionKey: KeyString }>;
  } catch {
    return {};
  }
}

function keepLinked(walletId: string, v: { accountId: string; sessionKey: KeyString }): void {
  try {
    localStorage.setItem(LINKED, JSON.stringify({ ...linkedKeys(), [walletId]: v }));
  } catch {
    /* storage blocked: the account lasts until the page closes */
  }
}
let current: Player | null = null;
let saved: Saved | null = null;
/** Play demo while signed in: this page plays with no account (not stored; a reload ends it). */
let guest = false;
/** The NEAR Auth user between the login popup and choosing a name. */
let pending: NearAuthUser | null = null;
const listeners = new Set<(p: Player | null) => void>();

function read(key = KEY): Saved | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as Saved) : null;
  } catch {
    return null;
  }
}

function write(s: Saved | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session lasts until the page closes */
  }
}

function set(s: Saved | null) {
  if (s) guest = false; // signing in ends a demo run on this page
  saved = s;
  write(s);
  current = s ? new Player(DEPLOY, SERVER, s) : null;
  for (const f of listeners) f(current);
}

/** Reads the local server's deployment once and adopts it (a local chain set up with another root). */
let localChecked: Promise<void> | null = null;
function checkLocal(): Promise<void> {
  localChecked ??= fetch(`${SERVER}/deploy`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      Object.assign(DEPLOY, (await r.json()) as Deployment);
    })
    .catch((e) => {
      localChecked = null;
      throw new GameError(`The local testnet is not running (${e instanceof Error ? e.message : e}). Start it with: npm run dev:local`);
    });
  return localChecked;
}

const rnd = () => Math.random().toString(36).slice(2, 8);
/** A 64-character wallet id (an implicit account) shortened for messages. */
const short = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 8)}…${id.slice(-6)}` : id);

/** Makes the player's record on the contract (starter coins) the first time; later sign-ins skip the call. */
async function registerOnce(p: Player): Promise<void> {
  const v = await p.view().catch(() => null);
  if (!v?.known) await p.register();
}

export const session = {
  deploy: DEPLOY,
  server: SERVER,
  /** `local` in the Demo cheat, else `testnet`. */
  network: DEPLOY.network,
  /** True when this build knows a deployed contract. */
  get live(): boolean {
    return !!DEPLOY.contract;
  },
  get player(): Player | null {
    if (guest) return null;
    if (!current && !saved) {
      const s = read();
      if (s) set(s);
    }
    return current;
  },
  /** True while this page plays the demo with no account (Play demo while signed in). */
  get guest(): boolean {
    return guest;
  },
  /** Play demo: no account for this page, without signing out (the account and its keys stay for the next visit). */
  playAsGuest(): void {
    if (guest) return;
    guest = true;
    for (const f of listeners) f(null);
  },
  get via(): Saved['via'] | null {
    return saved?.via ?? null;
  },
  get email(): string | undefined {
    return saved?.email;
  },

  /** Demo cheat: the device account on the local chain, made on the first call (cheat-xxxxxx.test.near). */
  async cheatAccount(): Promise<Player> {
    if (!CHEAT) throw new GameError(`The local testnet account exists only in the Demo cheat`);
    await checkLocal();
    const p = this.player;
    if (p) {
      // a local chain started over forgets the account: make a new one
      const known = await fetch(DEPLOY.rpc, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ jsonrpc: `2.0`, id: 1, method: `query`, params: { request_type: `view_account`, finality: `final`, account_id: p.id } }),
      })
        .then((r) => r.json() as Promise<{ result?: unknown }>)
        .then((b) => !!b.result, () => true);
      if (known) return p;
      set(null);
    }
    return this.quick(`cheat-${rnd()}`);
  },

  /** A device account named `name`, its full key kept on this device (the Demo cheat's local account). */
  async quick(name: string): Promise<Player> {
    const keys = await createAccount(DEPLOY, SERVER, name);
    set({ ...keys, via: `device` });
    await current!.register();
    return current!;
  },

  /**
   * NEAR Auth sign-in on testnet. Returns the player when this browser can play at once, or `needName` when the
   * player has no MINEAR account yet (call again with a name). `popup`: a window opened in the click handler
   * (openAuthPopup in minear-r3f/src/near/nearAuth.ts), so the browser does not block it.
   */
  async nearAuth(name?: string, popup?: Window | null): Promise<{ player?: Player; needName?: boolean; email?: string }> {
    if (CHEAT) throw new GameError(`Google sign-in is for NEAR testnet. The Demo cheat uses a local testnet account.`);
    const user = name && pending ? pending : await nearAuthLogin(DEPLOY.network as 'testnet' | 'mainnet', DEPLOY.rpc, popup);
    pending = user;
    const mine = (await accountsWithKey(DEPLOY.network as 'testnet' | 'mainnet', user.publicKey)).filter((a) => a.endsWith(`.${DEPLOY.root}`));
    if (mine.length) {
      const prev = [read(), read(OUT_KEY)].find((k) => k && mine.includes(k.accountId));
      if (prev) {
        try {
          localStorage.removeItem(OUT_KEY);
        } catch {
          /* storage blocked */
        }
        set({ ...prev, via: `nearauth`, email: user.email });
        return { player: current! };
      }
      throw new GameError(
        `${mine[0]} is yours, but this browser has no game key for it yet. Use the browser you signed up on; adding a new device is the next step.`,
      );
    }
    if (!name) return { needName: true, email: user.email };
    const keys = await createAccount(DEPLOY, SERVER, name, user.publicKey);
    set({ ...keys, via: `nearauth`, email: user.email });
    await current!.register();
    return { player: current!, email: user.email };
  },

  /**
   * NEAR wallet sign-in on testnet (Meteor, Intear, Nightly... through NEAR Connect). The user's choice
   * (2026-11-15): a MINEAR account linked to the wallet. In one wallet window the player connects and signs a free
   * message (no transaction, no NEAR). The server checks it and creates <name>.<root> owned by the wallet's key, with
   * a game key in this browser (minear-r3f/server/src/onboard.ts walletOnboard). The wallet account itself needs no
   * NEAR and may not exist on chain yet (a new wallet's 64-character id). `step` gets a line to show meanwhile.
   */
  async wallet(step?: (text: string) => void): Promise<Player> {
    if (CHEAT) throw new GameError(`NEAR wallets are for NEAR testnet. The Demo cheat uses a local testnet account.`);
    step?.(`Pick your wallet, then approve the sign-in (free, no transaction)…`);
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const message = `MINEAR sign-in ${new Date().toISOString()}`;
    const recipient = `MINEAR`;
    let w: Awaited<ReturnType<typeof near.connectAndSign>>;
    try {
      w = await near.connectAndSign({ message, recipient, nonce });
    } catch (e) {
      const why = e instanceof Error ? e.message : ``;
      throw new GameError(
        /reject|clos|cancel/i.test(why) || !why ? `The wallet picker was closed. Connect a NEAR wallet to try again.` : `Wallet sign-in did not finish: ${why}`,
      );
    }
    const { accountId: walletId, signed } = w;
    const rpc = providerFor(DEPLOY);
    // this browser already plays the wallet's MINEAR account: no server step
    const known = linkedKeys()[walletId];
    if (known && (await hasAccessKey(rpc, known.accountId, KeyPair.fromString(known.sessionKey).getPublicKey().toString()))) {
      set({ accountId: known.accountId, sessionKey: known.sessionKey, via: `wallet`, wallet: walletId });
      await registerOnce(current!);
      return current!;
    }
    if (!signed) throw new GameError(`${w.wallet.manifest.name} signed in but did not sign the MINEAR message. Pick another wallet, or use Continue with Google.`);
    step?.(`Making your MINEAR account…`);
    const kp = KeyPair.fromRandom(`ed25519`);
    let nb = ``;
    for (let i = 0; i < nonce.length; i++) nb += String.fromCharCode(nonce[i]);
    const res = await fetch(`${SERVER}/onboard-wallet`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ walletId, publicKey: signed.publicKey, signature: signed.signature, message, nonce: btoa(nb), recipient, sessionKey: kp.getPublicKey().toString() }),
    });
    const body = (await res.json()) as { ok: boolean; accountId?: string; error?: string };
    if (!body.ok || !body.accountId) throw new GameError(body.error ?? `Could not make your MINEAR account`);
    keepLinked(walletId, { accountId: body.accountId, sessionKey: kp.toString() as KeyString });
    set({ accountId: body.accountId, sessionKey: kp.toString() as KeyString, via: `wallet`, wallet: walletId });
    await registerOnce(current!);
    return current!;
  },

  /** True between a NEAR Auth popup that found no account and the Create with a name. */
  get needName(): boolean {
    return !!pending && !current;
  },

  /** Signs out on this page. The game keys are kept aside (not deleted): signing in again with the same NEAR
   *  Auth login finds them, so this browser can still play that account. */
  signOut(): void {
    pending = null;
    if (saved?.via === `wallet`) void near.signOut(); // the account and its game key stay in this browser (LINKED)
    if (saved?.via === `nearauth`)
      try {
        localStorage.setItem(OUT_KEY, JSON.stringify(saved));
      } catch {
        /* storage blocked */
      }
    set(null);
  },

  onChange(f: (p: Player | null) => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
