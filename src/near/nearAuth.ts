// NEAR Auth sign-in (folder: minear-r3f/src/near): Google, Apple, email or passkey through Auth0,
// with the key held by NEAR's MPC network. No seed phrase.
// It does what @fast-auth-near/javascript-provider and browser-sdk do for login, with only the official
// Auth0 SDK: an Auth0 popup on NEAR Auth's tenant, then the player's key is
//   v1.signer-prod.testnet . derived_public_key({ path: "jwt#https://<domain>/#<sub>", predecessor: "fast-auth.testnet", domain_id: 1 })
// That key becomes the full-access key of the player's MINEAR account. Signing with it later (for
// example to add a new device) goes through NEAR Auth's MPC signer and one more Auth0 popup.
// Testnet uses NEAR's shared development client id; mainnet needs our own approved Auth0 client.
import { JsonRpcProvider } from 'near-api-js';

const NETS = {
  testnet: {
    domain: `login.testnet.fast-auth.com`,
    clientId: `np8paqIpMWmNbzT4xAvOOapZBjsOpptl`,
    mpc: `v1.signer-prod.testnet`,
    fastAuth: `fast-auth.testnet`,
    lookup: `https://test.api.fastnear.com/v0/public_key/`,
  },
  mainnet: {
    domain: `login.auth.near.org`,
    clientId: ``,
    mpc: `v1.signer`,
    fastAuth: `fast-auth.near`,
    lookup: `https://api.fastnear.com/v0/public_key/`,
  },
} as const;

export interface NearAuthUser {
  /** Auth0 user id, for example google-oauth2|123. */
  sub: string;
  email?: string;
  /** The player's NEAR Auth key (ed25519:...). */
  publicKey: string;
}

/** Loads the Auth0 SDK ahead of the click (the lobby calls it), so the popup opens at once. */
export function preloadNearAuth(): void {
  void import('@auth0/auth0-spa-js').catch(() => undefined);
}

/** Opens the sign-in popup window. Call it inside the click handler, before any await: a popup opened after an
 *  await can be blocked by the browser. Pass the window to nearAuthLogin. */
export function openAuthPopup(): Window | null {
  const w = 400;
  const h = 600;
  const left = window.screenX + (window.innerWidth - w) / 2;
  const top = window.screenY + (window.innerHeight - h) / 2;
  return window.open(``, `auth0:authorize:popup`, `left=${left},top=${top},width=${w},height=${h},resizable,scrollbars=yes,status=1`);
}

/** The one page address NEAR's shared testnet client returns to. Checked 2026-11-15: with
 *  redirect_uri http://localhost:3000 its login page opens; http://localhost:5187 and :5188 answer "Callback URL
 *  mismatch". `npm run dev:testnet` serves the game there (minear-r3f/server/tools/devTestnet.ts). */
export const SHARED_TESTNET_PAGE = `http://localhost:3000`;

const OWN_CLIENT = (import.meta.env.VITE_NEAR_AUTH_CLIENT_ID as string | undefined) || ``;

/** Null when Google sign-in can work on this page; else the page address where it works. */
export function nearAuthPageFix(network: 'testnet' | 'mainnet'): string | null {
  if (network !== `testnet` || OWN_CLIENT || typeof location === `undefined`) return null;
  return location.origin === SHARED_TESTNET_PAGE ? null : SHARED_TESTNET_PAGE;
}

/**
 * Opens the NEAR Auth popup and returns the player's derived key.
 * The Auth0 client must allow this page's origin as a callback URL and web origin. NEAR's shared testnet client
 * (np8paq…) allows only SHARED_TESTNET_PAGE. For any other address (a deployed site, mainnet), set
 * VITE_NEAR_AUTH_CLIENT_ID to our own client id (NEAR Auth gives one: https://docs.auth.near.org/home/apply.md).
 */
export async function nearAuthLogin(network: 'testnet' | 'mainnet', rpc: string, popup?: Window | null): Promise<NearAuthUser> {
  const n = NETS[network];
  const fix = nearAuthPageFix(network);
  if (fix) {
    popup?.close();
    throw new Error(`Google sign-in on NEAR testnet works only at ${fix} (this page is ${location.origin}). Open ${fix}${location.pathname}.`);
  }
  const clientId = OWN_CLIENT || n.clientId;
  if (!clientId) {
    popup?.close();
    throw new Error(`NEAR Auth on ${network} needs an approved Auth0 client id (VITE_NEAR_AUTH_CLIENT_ID)`);
  }
  const { Auth0Client } = await import('@auth0/auth0-spa-js');
  const client = new Auth0Client({ domain: n.domain, clientId, authorizationParams: {} });
  try {
    await client.loginWithPopup({ authorizationParams: { prompt: `login` } }, popup ? { popup } : {});
  } catch (e) {
    const code = (e as { error?: string }).error ?? ``;
    popup?.close();
    if (code === `popup_open`) throw new Error(`The browser blocked the sign-in popup. Allow popups for this page and try again.`);
    if (code === `cancelled` || code === `timeout`)
      throw new Error(
        `Google sign-in did not finish.` +
          (import.meta.env.DEV ? ` If the popup said "Callback URL mismatch", the sign-in client does not allow ${location.origin} (VITE_NEAR_AUTH_CLIENT_ID).` : ``),
      );
    throw e;
  }
  const claims = await client.getIdTokenClaims();
  if (!claims?.sub) throw new Error(`NEAR Auth did not return a user`);
  const publicKey = (await new JsonRpcProvider({ url: rpc }).callFunction({
    contractId: n.mpc,
    method: `derived_public_key`,
    args: { path: `jwt#https://${n.domain}/#${claims.sub}`, predecessor: n.fastAuth, domain_id: 1 },
  })) as string;
  return { sub: claims.sub, email: claims.email, publicKey };
}

/** Accounts that have this public key (FastNEAR index). */
export async function accountsWithKey(network: 'testnet' | 'mainnet', publicKey: string): Promise<string[]> {
  try {
    const r = await fetch(NETS[network].lookup + publicKey);
    if (!r.ok) return [];
    return ((await r.json()) as { account_ids?: string[] }).account_ids ?? [];
  } catch {
    return [];
  }
}
