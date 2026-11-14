// NEAR access for the server (folder: minear-r3f/server): one RPC provider, accounts signed with the
// keys in minear-r3f/server/.keys, view calls, and readable error text.
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { RPC, loadKey } from './env';

export const provider = new JsonRpcProvider({ url: RPC });

const accounts = new Map<string, Account>();

/** An account this server holds the key for. */
export function account(id: string): Account {
  let a = accounts.get(id);
  if (!a) {
    a = new Account(id, provider, KeyPairSigner.fromSecretKey(loadKey(id)));
    accounts.set(id, a);
  }
  return a;
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

/** True when the account exists on chain. */
export async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

/** The contract's panic message when there is one, else the error message. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? `${e.message} ${JSON.stringify((e as { cause?: unknown }).cause ?? ``)}` : String(e);
  const m = raw.match(/[Pp]anicked: ([^"\\]+)/) ?? raw.match(/panic_msg["\\:]+([^"\\]+)/);
  return (m?.[1] ?? (e instanceof Error ? e.message : raw)).trim().slice(0, 300);
}
