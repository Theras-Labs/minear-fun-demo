// NEAR sign-in for MINEAR (folder: /Users/Shared/march-2026/minear-r3f/src/near).
// It uses NEAR Connect (@hot-labs/near-connect): each wallet's code runs in a sandboxed frame.
// The connector loads only when the player asks for it, so the game start never waits for it.
// Network: testnet unless VITE_NEAR_NETWORK=mainnet is set at build time.
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';

export type NearNetwork = 'mainnet' | 'testnet';
export const NEAR_NETWORK: NearNetwork = import.meta.env.VITE_NEAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

/** The last signed-in account, so the lobby can show it at once on the next visit. */
const KEY = `minear.near.account.${NEAR_NETWORK}`;

let connector: Promise<NearConnector> | null = null;
let accountId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function store(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

function set(id: string | null) {
  if (id === accountId) return;
  accountId = id;
  store(id);
  for (const f of listeners) f(id);
}

function load(): Promise<NearConnector> {
  connector ??= import('@hot-labs/near-connect').then(({ NearConnector }) => {
    const c = new NearConnector({ network: NEAR_NETWORK });
    c.on('wallet:signIn', (t) => set(t.accounts[0]?.accountId ?? null));
    c.on('wallet:signOut', () => set(null));
    return c;
  });
  return connector;
}

export const near = {
  network: NEAR_NETWORK,

  /** The signed-in account id, or null. */
  get account(): string | null {
    return accountId;
  },

  /** The account remembered from the last visit (not yet checked with the wallet). */
  remembered(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },

  /** Checks a remembered account with its wallet. Loads the connector only when there is one to check. */
  async restore(): Promise<string | null> {
    if (!this.remembered()) return null;
    try {
      const { accounts } = await (await load()).getConnectedWallet();
      set(accounts[0]?.accountId ?? null);
    } catch {
      set(null);
    }
    return accountId;
  },

  /** Opens the wallet picker and returns the wallet and its account. Throws when the player closes it. */
  async connectWallet(): Promise<{ wallet: NearWalletBase; accountId: string }> {
    const wallet = await (await load()).connect();
    const accounts = await wallet.getAccounts({ network: NEAR_NETWORK });
    const id = accounts[0]?.accountId;
    if (!id) throw new Error(`The wallet did not share a NEAR ${NEAR_NETWORK} account`);
    set(id);
    return { wallet, accountId: id };
  },

  /** Opens the wallet picker. Resolves with the account id, or null when the player closes it. */
  async signIn(): Promise<string | null> {
    try {
      await (await load()).connect();
    } catch {
      /* closed or refused */
    }
    return accountId;
  },

  async signOut(): Promise<void> {
    try {
      await (await load()).disconnect();
    } catch {
      /* no wallet connected */
    }
    set(null);
  },

  /** Calls f with the account id each time it changes. Returns the unsubscribe function. */
  onChange(f: (id: string | null) => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
