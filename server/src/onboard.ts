// Account setup for new players (folder: minear-r3f/server). The root account creates
// <name>.<root> in one transaction, with two keys:
//   - a full-access key: the player's NEAR Auth key (Google, Apple, email, passkey) or, for a quick
//     testnet account, a key kept on the device;
//   - a session key: function calls to the items contract only, made in the browser, used for every
//     game action without a popup. It cannot attach a deposit, so it cannot transfer items away.
// The new account holds no NEAR: it fits NEP-448's free storage (770 bytes). The relayer pays its gas.
// Limits: 5 new accounts per IP per hour, and names are first come, first served.
import { PublicKey, actions } from 'near-api-js';
import type { Deployment } from '../../src/economy/types';
import { MERCHANTS } from '../../src/economy/pricing';
import { rootTx } from './budget';
import { LOCAL } from './env';
import { account, errorText, exists } from './near';

const PER_IP_HOUR = 5;
/** What a session key may spend on gas if the player pays their own gas (0.25 NEAR). */
const SESSION_ALLOWANCE = 250_000_000_000_000_000_000_000n;
const RESERVED = new Set([`items`, `relay`, `root`, `admin`, `minear`, ...MERCHANTS.map((m) => m.id)]);
const byIp = new Map<string, number[]>();

export interface OnboardBody {
  name?: string;
  sessionKey?: string;
  fullKey?: string;
}

export function nameError(name: string): string | null {
  if (!/^[a-z0-9]([a-z0-9_-]{1,30})[a-z0-9]$/.test(name)) return `Use 3 to 32 lower-case letters, digits, - or _`;
  if (RESERVED.has(name) || name.startsWith(`bot`)) return `That name is reserved`;
  return null;
}

const keyOk = (k: unknown): k is string => typeof k === `string` && /^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(k);

export async function onboard(
  deploy: Deployment,
  body: OnboardBody,
  ip: string,
  opts: { skipIpLimit?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const name = String(body.name ?? ``).toLowerCase();
  const bad = nameError(name);
  if (bad && !opts.skipIpLimit) return { status: 400, body: { ok: false, error: bad } };
  if (!keyOk(body.sessionKey) || !keyOk(body.fullKey))
    return { status: 400, body: { ok: false, error: `sessionKey and fullKey must be ed25519 public keys` } };
  const now = Date.now();
  // the local chain (dev only) has no per-IP limit: every account there comes from this machine
  if (!opts.skipIpLimit && !LOCAL) {
    const list = (byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= PER_IP_HOUR) return { status: 429, body: { ok: false, error: `Too many new accounts from here: try in an hour` } };
    list.push(now);
    byIp.set(ip, list);
  }
  const accountId = `${name}.${deploy.root}`;
  if (await exists(accountId)) return { status: 409, body: { ok: false, error: `${accountId} is taken` } };
  try {
    const fullKey = body.fullKey;
    const sessionKey = body.sessionKey;
    await rootTx(() =>
      account(deploy.root).signAndSendTransaction({
        receiverId: accountId,
        actions: [
          actions.createAccount(),
          actions.addFullAccessKey(PublicKey.fromString(fullKey)),
          actions.addFunctionCallAccessKey(PublicKey.fromString(sessionKey), deploy.contract, [], SESSION_ALLOWANCE),
        ],
      }),
    );
    return { status: 200, body: { ok: true, accountId } };
  } catch (e) {
    return { status: 422, body: { ok: false, error: errorText(e) } };
  }
}
