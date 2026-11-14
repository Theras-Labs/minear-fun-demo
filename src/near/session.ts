// The player's MINEAR account on NEAR in this browser (folder: minear-r3f/src/near).
// Every way in ends with the same thing: a session key in this browser, so every game action is signed here
// with no popup, and the relayer (minear-r3f/server) pays the gas.
//   - NEAR Auth (Google, Apple, email, passkey) on testnet: the account's full key is the player's NEAR Auth key.
//   - A NEAR wallet on testnet (NEAR Connect, minear-r3f/src/near/wallet.ts): the player's own account. The wallet
//     adds a game key (a function-call key for the items contract only) once per browser: paid by the wallet when
//     the account holds NEAR, else signed as a delegate action that the relayer sends (no NEAR needed).
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
}

const KEY = `minear.near.session.${DEPLOY.network}`;
/** A signed-out account's keys: kept, so signing in again with the same NEAR Auth login finds its game key. */
const OUT_KEY = `${KEY}.out`;
/** Wallet players' game keys in this browser, by account: kept after sign-out, so signing in again needs no new key. */
const WALLET_KEYS = `minear.near.walletkeys.${DEPLOY.network}`;

function walletKeys(): Record<string, KeyString> {
  try {
    return JSON.parse(localStorage.getItem(WALLET_KEYS) ?? `{}`) as Record<string, KeyString>;
  } catch {
    return {};
  }
}

function keepWalletKey(accountId: string, key: KeyString): void {
  try {
    localStorage.setItem(WALLET_KEYS, JSON.stringify({ ...walletKeys(), [accountId]: key }));
  } catch {
    /* storage blocked: the key lasts until the page closes */
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
   * NEAR wallet sign-in on testnet (HOT, Meteor, MyNearWallet... through NEAR Connect). The player's own account
   * plays. The first time in a browser the wallet approves one game key (a function-call key for the items
   * contract only: it cannot move NEAR or gear). After that every game action is signed here with no popup.
   * `step` gets a line to show while the wallet waits for the player.
   */
  async wallet(step?: (text: string) => void): Promise<Player> {
    if (CHEAT) throw new GameError(`NEAR wallets are for NEAR testnet. The Demo cheat uses a local testnet account.`);
    step?.(`Pick your wallet…`);
    let w: Awaited<ReturnType<typeof near.connectWallet>>;
    try {
      w = await near.connectWallet();
    } catch (e) {
      const why = e instanceof Error ? e.message : ``;
      throw new GameError(
        /reject|clos|cancel/i.test(why) || !why ? `The wallet picker was closed. Connect a NEAR wallet to try again.` : `Wallet sign-in did not finish: ${why}`,
      );
    }
    const { wallet, accountId } = w;
    const rpc = providerFor(DEPLOY);
    // a game key this browser already has for the account: no wallet step at all
    const known = walletKeys()[accountId];
    if (known && (await hasAccessKey(rpc, accountId, KeyPair.fromString(known).getPublicKey().toString()))) {
      set({ accountId, sessionKey: known, via: `wallet` });
      await registerOnce(current!);
      return current!;
    }
    const kp = KeyPair.fromRandom(`ed25519`);
    const publicKey = kp.getPublicKey().toString();
    const pays = (await spendable(rpc, accountId)) >= BigInt(GAME_CONFIG.ownGasAbove);
    // An account that pays its own gas gets a key with no allowance cap: NEAR takes each call's full prepaid gas
    // (about 0.05 NEAR) from a capped allowance and does not give the unused part back, so 0.25 NEAR would stop the
    // key after about 5 actions. The key still reaches only the items contract, with no deposit: it cannot move
    // NEAR or gear; the most it can spend is gas. A key the relayer pays for keeps the 0.25 NEAR cap (relayer.ts).
    const addKey = {
      type: `AddKey` as const,
      params: {
        publicKey,
        accessKey: {
          permission: pays
            ? { receiverId: DEPLOY.contract, methodNames: [] }
            : { receiverId: DEPLOY.contract, allowance: GAME_CONFIG.sessionAllowance, methodNames: [] },
        },
      },
    };
    try {
      if (pays) {
        step?.(`Approve the game key in your wallet (once per browser, about 0.002 NEAR)…`);
        await wallet.signAndSendTransaction({ network: near.network, signerId: accountId, receiverId: accountId, actions: [addKey] });
      } else if (wallet.manifest.features?.signDelegateActions) {
        step?.(`Approve the game key in your wallet (once per browser; the game pays the gas)…`);
        const r = await wallet.signDelegateActions({ network: near.network, signerId: accountId, delegateActions: [{ receiverId: accountId, actions: [addKey] }] });
        const signed = r.signedDelegateActions?.[0];
        if (!signed) throw new Error(`the wallet returned no signed request`);
        const res = await fetch(`${SERVER}/relay`, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ signedDelegate: signed }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!body.ok) throw new Error(body.error ?? `the relayer refused the game key`);
      } else {
        throw new GameError(
          `${accountId} has no NEAR for the one-time game key, and ${wallet.manifest.name} cannot let the game pay for it. ` +
            `Add about 0.01 testnet NEAR to the account, pick another wallet, or use Continue with Google.`,
        );
      }
    } catch (e) {
      if (e instanceof GameError) throw e;
      throw new GameError(`The game key was not added: ${e instanceof Error ? e.message : String(e)}`);
    }
    step?.(`Waiting for the game key on chain…`);
    let on = false;
    for (let i = 0; i < 20 && !on; i++) {
      on = await hasAccessKey(rpc, accountId, publicKey);
      if (!on) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!on) throw new GameError(`The wallet said yes, but the game key is not on ${accountId} yet. Try again in a minute.`);
    keepWalletKey(accountId, kp.toString() as KeyString);
    set({ accountId, sessionKey: kp.toString() as KeyString, via: `wallet` });
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
    if (saved?.via === `wallet`) void near.signOut(); // the game key stays in this browser (WALLET_KEYS) for next time
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
