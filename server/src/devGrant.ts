// Dev grant (folder: minear-r3f/server): the Cheats panel's "Stock up" in the dev-local "Demo cheat" entry.
// It exists ONLY on the local chain (MINEAR_NETWORK=local, minear-r3f/server/src/env.ts LOCAL): on testnet and
// mainnet main.ts never routes to it. The contract owner (the root account, test.near on the local chain) mints
// materials into the player's on-chain vault with owner_mint, so cheat testing uses the same chain path as a
// real player (claimed materials on chain, the Forge burns them). One transaction per click; no timers.
import { actions, teraToGas } from 'near-api-js';
import { TOKEN_BY_ID } from '../../src/economy/catalog';
import type { Deployment } from '../../src/economy/types';
import { LOCAL } from './env';
import { account, errorText } from './near';

/** The contract takes at most 24 token lines per call (MAX_LINES in minear-r3f/contracts/items). */
const MAX_LINES = 24;
/** Most of one token per click. */
const MAX_EACH = 100_000;

export async function devGrant(deploy: Deployment, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!LOCAL) return { status: 404, body: { ok: false, error: `Not found` } };
  const accountId = String(body.accountId ?? ``);
  const game = new Set([deploy.contract, deploy.relayer, ...Object.values(deploy.merchants)]);
  if (!accountId.endsWith(`.${deploy.root}`) || game.has(accountId))
    return { status: 400, body: { ok: false, error: `accountId must be a player of ${deploy.root}` } };
  const raw = Array.isArray(body.items) ? (body.items as unknown[]) : [];
  const items: [string, string][] = [];
  for (const it of raw) {
    if (!Array.isArray(it)) continue;
    const [t, n] = it as [unknown, unknown];
    const k = Math.floor(Number(n));
    if (typeof t === `string` && TOKEN_BY_ID[t] && k >= 1 && k <= MAX_EACH) items.push([t, String(k)]);
  }
  if (!items.length || items.length > MAX_LINES) return { status: 400, body: { ok: false, error: `1 to ${MAX_LINES} known token lines` } };
  try {
    await account(deploy.root).signAndSendTransaction({
      receiverId: deploy.contract,
      actions: [actions.functionCall(`owner_mint`, { account_id: accountId, items, memo: `dev-grant` }, teraToGas(60), 0n)],
    });
    return { status: 200, body: { ok: true, items } };
  } catch (e) {
    return { status: 422, body: { ok: false, error: errorText(e) } };
  }
}
