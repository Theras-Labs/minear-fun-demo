// MINEAR entry modes (folder: minear-r3f/src/game). The lobby (minear-r3f/src/menus/lobby.ts) offers three ways in
// (MINEAR rules, user 2026-11-14):
//   google  Continue with Google: NEAR Auth on the real NEAR testnet (the way production runs). Each finished mining
//           trip is saved on chain at once (minear-r3f/src/economy/vault.ts), within the chain's limits, and the
//           Forge, rerolls, the skill tree and the Refinery spend those on-chain materials.
//   demo    Play demo: no account. Mining and the trip summary work, but the trip result is not kept, so nothing
//           can be forged or upgraded.
//   cheat   Demo cheat: ONLY on a dev run opened on this machine (localhost, 127.0.0.1). The cheats are on, the
//           player gets a device account on the NEAR local chain (npm run dev:local:
//           minear-r3f/server/tools/localChain.ts, server on 127.0.0.1:8788), Stock up mints there, and it has its
//           own save game. Everything else takes the same code path as testnet. Google sign-in does not work on the
//           local chain: NEAR Auth runs on testnet only.
// The page runs on one chain, chosen by the URL before the save game loads: ?mode=cheat is the local chain, no mode
// is NEAR testnet. The lobby shows all three buttons on a dev run; a button of the other chain reloads the page
// with that mode and ?entry=<google|demo|cheat>, and the lobby carries the choice on (minear-r3f/src/menus/lobby.ts).
// A production build has import.meta.env.DEV false, so the cheat mode and its code paths cannot switch on there.

const LOCAL_HOSTS = new Set([`localhost`, `127.0.0.1`, `[::1]`]);

/** True on the Vite dev server opened on this machine. */
export const DEV_LOCAL: boolean = import.meta.env.DEV && typeof location !== `undefined` && LOCAL_HOSTS.has(location.hostname);

/** True in the Demo cheat entry (dev-local runs only): this page runs on the NEAR local chain. */
export const CHEAT: boolean = DEV_LOCAL && new URLSearchParams(location.search).get(`mode`) === `cheat`;

/** The MINEAR server of the local chain (npm run dev:local). */
export const LOCAL_SERVER = (import.meta.env.VITE_MINEAR_LOCAL_SERVER as string | undefined) ?? `http://127.0.0.1:8788`;

export type EntryId = `google` | `wallet` | `demo` | `cheat`;

/** The entry a reload carries on (?entry=), or null. Read once; the lobby drops it from the URL. */
export const ENTRY: EntryId | null = (() => {
  if (typeof location === `undefined`) return null;
  const e = new URLSearchParams(location.search).get(`entry`);
  return e === `google` || e === `wallet` || e === `demo` || e === `cheat` ? e : null;
})();

/** This page's URL on the local chain (cheat) or on NEAR testnet, carrying `entry` on. */
export function modeUrl(cheat: boolean, entry?: EntryId): string {
  const u = new URL(location.href);
  if (cheat) u.searchParams.set(`mode`, `cheat`);
  else u.searchParams.delete(`mode`);
  if (entry) u.searchParams.set(`entry`, entry);
  else u.searchParams.delete(`entry`);
  return u.toString();
}

/** Drops ?entry= from the address bar, so a reload does not carry the choice on again. */
export function clearEntry(): void {
  const u = new URL(location.href);
  if (!u.searchParams.has(`entry`)) return;
  u.searchParams.delete(`entry`);
  history.replaceState(history.state, ``, u.toString());
}

/** Dev runs on NEAR testnet: is the local chain's server up? One request when the lobby opens (no polling). */
export async function localChainUp(): Promise<boolean> {
  if (!DEV_LOCAL) return false;
  try {
    const r = await fetch(`${LOCAL_SERVER}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok && ((await r.json()) as { network?: string }).network === `local`;
  } catch {
    return false;
  }
}
