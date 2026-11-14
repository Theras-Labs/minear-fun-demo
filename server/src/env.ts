// MINEAR server settings (folder: minear-r3f/server). Run with bun: `bun server/src/main.ts`.
// Secrets (account keys) live in minear-r3f/server/.keys/<network>/ and are never committed.
// Public account ids live in minear-r3f/src/economy/deploy.<network>.json (the client reads them too).
// Network `local` (MINEAR_NETWORK=local) is the NEAR sandbox chain on this machine (127.0.0.1:3030), used only by
// the dev-local "Demo cheat" entry. Its keys and deployment live in minear-r3f/server/.sandbox/ (gitignored), so
// a fresh local chain never touches the testnet keys in minear-r3f/server/.keys/.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Deployment } from '../../src/economy/types';

export const APP_DIR = join(import.meta.dir, `..`, `..`);
const NET_ENV = process.env.MINEAR_NETWORK;
export const NETWORK = (NET_ENV === `mainnet` ? `mainnet` : NET_ENV === `local` ? `local` : `testnet`) as Deployment['network'];
/** True on the NEAR sandbox chain on this machine (dev only). */
export const LOCAL = NETWORK === `local`;
/** The local chain: binary, chain data, keys and deployment (minear-r3f/server/tools/localChain.ts). */
export const SANDBOX_DIR = join(APP_DIR, `server`, `.sandbox`);
export const RPC =
  process.env.MINEAR_RPC ??
  (LOCAL ? `http://127.0.0.1:3030` : NETWORK === `testnet` ? `https://test.rpc.fastnear.com` : `https://free.rpc.fastnear.com`);
/** 8787 for testnet; 8788 for the local chain, so both servers can run side by side. */
export const PORT = Number(process.env.MINEAR_SERVER_PORT ?? (LOCAL ? 8788 : 8787));
export const HOST = process.env.MINEAR_SERVER_HOST ?? `127.0.0.1`;
export const DEPLOY_FILE = LOCAL ? join(SANDBOX_DIR, `deploy.local.json`) : join(APP_DIR, `src`, `economy`, `deploy.${NETWORK}.json`);
export const KEYS_DIR = LOCAL ? join(SANDBOX_DIR, `keys`) : join(APP_DIR, `server`, `.keys`, NETWORK);

// NEAR AI Cloud (OpenAI-compatible) gives the merchants a voice: minear-r3f/server/src/talk.ts.
// The key comes from MINEAR_AI_KEY or minear-r3f/server/.keys/near-ai.json ({ "api_key": "..." }).
// No key: the merchants stay silent and everything else works the same.
export const AI_URL = (process.env.MINEAR_AI_URL ?? `https://cloud-api.near.ai/v1`).replace(/\/+$/, ``);
export const AI_MODEL = process.env.MINEAR_AI_MODEL ?? `Qwen/Qwen3.8-27B`;
/** Hard ceiling on LLM calls per hour for the whole server, whatever players do. */
export const AI_MAX_PER_HOUR = Number(process.env.MINEAR_AI_MAX_PER_HOUR ?? 600);
const AI_KEY_FILE = join(APP_DIR, `server`, `.keys`, `near-ai.json`);

export function loadAiKey(): string | null {
  if (process.env.MINEAR_AI_KEY) return process.env.MINEAR_AI_KEY;
  if (!existsSync(AI_KEY_FILE)) return null;
  try {
    return (JSON.parse(readFileSync(AI_KEY_FILE, `utf8`)) as { api_key?: string }).api_key || null;
  } catch {
    return null;
  }
}

/** Methods the relayer pays gas for. Session keys may call only these with no deposit. */
export const GAME_METHODS = [`register`, `save_trip`, `burn`, `craft`, `trade`, `invest`, `buy_actions`, `forge`, `reroll`, `salvage`];

export function loadDeploy(): Deployment {
  if (!existsSync(DEPLOY_FILE)) throw new Error(`No ${DEPLOY_FILE}: run bun server/tools/setup.ts first`);
  const d = JSON.parse(readFileSync(DEPLOY_FILE, `utf8`)) as Deployment;
  if (!d.contract) throw new Error(`${DEPLOY_FILE} has no contract: run bun server/tools/setup.ts first`);
  return d;
}

export function saveDeploy(d: Deployment): void {
  writeFileSync(DEPLOY_FILE, JSON.stringify(d, null, 2) + `\n`);
}

interface KeyFile {
  account_id: string;
  public_key: string;
  private_key: string;
}

const keyPath = (accountId: string) => join(KEYS_DIR, `${accountId}.json`);

export function hasKey(accountId: string): boolean {
  return existsSync(keyPath(accountId));
}

/** The secret key string (ed25519:...) of an account this server controls. */
export function loadKey(accountId: string): `ed25519:${string}` {
  const f = JSON.parse(readFileSync(keyPath(accountId), `utf8`)) as KeyFile;
  return f.private_key as `ed25519:${string}`;
}

export function saveKey(accountId: string, publicKey: string, privateKey: string): void {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const p = keyPath(accountId);
  writeFileSync(p, JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: privateKey }, null, 2));
  chmodSync(p, 0o600);
}
