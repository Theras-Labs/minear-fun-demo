// Account setup for new players (folder: minear-r3f/server). The root account creates
// <name>.<root> in one transaction, with two keys:
//   - a full-access key: the player's NEAR Auth key (Google, Apple, email, passkey) or, for a quick
//     testnet account, a key kept on the device;
//   - a session key: function calls to the items contract only, made in the browser, used for every
//     game action without a popup. It cannot attach a deposit, so it cannot transfer items away.
// The new account holds no NEAR: it fits NEP-448's free storage (770 bytes). The relayer pays its gas.
// Limits: 5 new accounts per IP per hour, and names are first come, first served.
import { createHash } from 'node:crypto';
import { PublicKey, actions, baseDecode } from 'near-api-js';
import type { Deployment } from '../../src/economy/types';
import { MERCHANTS } from '../../src/economy/pricing';
import { rootTx } from './budget';
import { LOCAL } from './env';
import { account, errorText, exists, provider } from './near';

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

// ---- NEAR wallet players: a MINEAR account linked to the wallet (the user's choice, 2026-11-15) ----
// The wallet signs one free NEP-413 message during sign-in (no transaction, no NEAR). This proves the wallet holds
// `publicKey`. The root then creates <name>.<root> with that public key as its full-access key (so the wallet's key
// owns it) and the browser's game key as its session key. The wallet account itself needs no NEAR and may not even
// exist on chain yet (a new wallet's 64-character implicit id).

const SIGN_MAX_AGE_MS = 10 * 60_000;
const usedNonces = new Map<string, number>();

export interface WalletOnboardBody {
  walletId?: string;
  publicKey?: string;
  signature?: string;
  message?: string;
  /** base64 of the 32-byte nonce */
  nonce?: string;
  recipient?: string;
  sessionKey?: string;
}

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(s, `utf8`);
  return Buffer.concat([u32(b.length), b]);
};

/** NEP-413: sha256(borsh(2^31 + 413) || borsh({ message, nonce, recipient, callbackUrl: None })). */
function nep413Hash(message: string, nonce: Buffer, recipient: string): Uint8Array {
  const data = Buffer.concat([u32(2 ** 31 + 413), str(message), nonce, str(recipient), Buffer.from([0])]);
  return new Uint8Array(createHash(`sha256`).update(data).digest());
}

function sigBytes(s: string): Uint8Array | null {
  const raw = s.replace(/^ed25519:/, ``);
  try {
    const b = Buffer.from(raw, `base64`);
    if (b.length === 64) return new Uint8Array(b);
  } catch {
    /* not base64 */
  }
  try {
    const b = baseDecode(raw);
    if (b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  return null;
}

/** True when `publicKey` is a full-access key of `walletId`, or `walletId` is that key's implicit account. */
async function walletOwnsKey(walletId: string, pk: PublicKey): Promise<boolean> {
  if (/^[0-9a-f]{64}$/.test(walletId)) return Buffer.from(pk.data).toString(`hex`) === walletId;
  try {
    const k = (await provider.viewAccessKey({ accountId: walletId, publicKey: pk.toString() })) as unknown as { permission?: unknown };
    return k.permission === `FullAccess` || (typeof k.permission === `object` && k.permission !== null && `FullAccess` in k.permission);
  } catch {
    return false;
  }
}

/** The MINEAR account names this wallet key already owns (FastNEAR public-key index). */
async function linkedOf(deploy: Deployment, pk: string): Promise<string[]> {
  const base = deploy.network === `mainnet` ? `https://api.fastnear.com` : `https://test.api.fastnear.com`;
  try {
    const r = await fetch(`${base}/v0/public_key/${pk}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    return (((await r.json()) as { account_ids?: string[] }).account_ids ?? []).filter((a) => a.endsWith(`.${deploy.root}`));
  } catch {
    return [];
  }
}

export async function walletOnboard(deploy: Deployment, body: WalletOnboardBody, ip: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const walletId = String(body.walletId ?? ``);
  const message = String(body.message ?? ``);
  const recipient = String(body.recipient ?? ``);
  if (!walletId || !message || !recipient || !body.publicKey || !body.signature || !body.nonce || !keyOk(body.sessionKey))
    return { status: 400, body: { ok: false, error: `walletId, publicKey, signature, message, nonce, recipient and sessionKey are needed` } };
  // the message the game asked for: "MINEAR sign-in <ISO time>", for this server's game, fresh and used once
  const m = message.match(/^MINEAR sign-in (\S+)$/);
  const at = m ? Date.parse(m[1]) : NaN;
  if (!m || !Number.isFinite(at) || Math.abs(Date.now() - at) > SIGN_MAX_AGE_MS)
    return { status: 400, body: { ok: false, error: `The signed message is old or not MINEAR's: sign in again` } };
  if (recipient !== `MINEAR`) return { status: 400, body: { ok: false, error: `The signed message is for another app` } };
  const nonce = Buffer.from(body.nonce, `base64`);
  if (nonce.length !== 32) return { status: 400, body: { ok: false, error: `The nonce must be 32 bytes` } };
  const nk = nonce.toString(`hex`);
  const now = Date.now();
  for (const [k, t] of usedNonces) if (now - t > SIGN_MAX_AGE_MS) usedNonces.delete(k);
  if (usedNonces.has(nk)) return { status: 400, body: { ok: false, error: `This signed message was used already: sign in again` } };
  let pk: PublicKey;
  try {
    pk = PublicKey.fromString(body.publicKey);
  } catch {
    return { status: 400, body: { ok: false, error: `Not a NEAR public key` } };
  }
  const sig = sigBytes(body.signature);
  if (!sig || !pk.verify(nep413Hash(message, nonce, recipient), sig))
    return { status: 401, body: { ok: false, error: `The wallet signature does not match` } };
  if (!(await walletOwnsKey(walletId, pk))) return { status: 401, body: { ok: false, error: `That key is not a full-access key of ${walletId}` } };
  usedNonces.set(nk, now);

  const linked = await linkedOf(deploy, pk.toString());
  if (linked.length) return { status: 409, body: { ok: false, existing: linked[0], error: `This wallet already has ${linked[0]}. Play it in the browser you first signed in on (adding a new browser is not built yet).` } };
  const pkHex = Buffer.from(pk.data).toString(`hex`);
  let name: string | null = null;
  const base = /^[0-9a-f]{64}$/.test(walletId)
    ? `w-${walletId.slice(0, 8)}`
    : walletId.split(`.`)[0].toLowerCase().replace(/[^a-z0-9_-]/g, `-`).replace(/^[-_]+|[-_]+$/g, ``).slice(0, 24);
  for (const n of [base, `w-${base}`.slice(0, 26), `${base}-${pkHex.slice(0, 4)}`, `w-${pkHex.slice(0, 10)}`]) {
    if (!nameError(n) && !(await exists(`${n}.${deploy.root}`))) {
      name = n;
      break;
    }
  }
  if (!name) return { status: 409, body: { ok: false, error: `No free MINEAR name for this wallet` } };
  const r = await onboard(deploy, { name, fullKey: pk.toString(), sessionKey: body.sessionKey }, ip);
  return r.status === 200 ? { status: 200, body: { ...r.body, walletId } } : r;
}
