// The sign-in sheet (folder: minear-r3f/src/menus; styles in minear-r3f/src/brand/signin.css). The one place for
// "Continue with Google" (NEAR Auth on NEAR testnet, minear-r3f/src/near/session.ts): the lobby, the trip summary's
// save row, the Forge, Refinery and skill-tree locks, the merchants and the market. Steps:
//   1. the Google popup (opened inside the click, so the browser does not block it),
//   2. a new player picks a name: <name>.<root> is made with the NEAR Auth key (the game pays the gas),
//   3. the sheet closes and onDone gets the player.
// Or "Connect a NEAR wallet" (session.wallet): the player's own testnet account; the wallet approves one game key
// per browser, then play has no popups.
// Not used in the Demo cheat: it plays with a local testnet account (session.cheatAccount).
import '../brand/signin.css';
import type { Player } from '../near/play';
import { openAuthPopup } from '../near/nearAuth';
import { session } from '../near/session';

export interface SignInOptions {
  /** One line on top: why sign in now (for example "Sign in with NEAR to keep what you mine"). */
  reason?: string;
  /** Start the Google popup at once. Only from a click handler (the popup must open inside the click). */
  start?: boolean;
  /** Start the NEAR wallet sign-in at once (its picker is part of the page, so no click is needed). */
  wallet?: boolean;
  onDone?(p: Player): void;
}

const NAME_RX = /^[a-z0-9]([a-z0-9_-]{1,30})[a-z0-9]$/;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

let el: HTMLElement | null = null;
let opts: SignInOptions = {};
let busy = false;
let msg: { text: string; err: boolean } | null = null;
let email = ``;
let draft = ``;
/** True while NEAR Connect's wallet picker or a wallet asks the player: keys must reach it. */
let walletBusy = false;

const isOpen = () => !!el && !el.classList.contains(`hidden`);

function make(): HTMLElement {
  const root = document.createElement(`div`);
  root.id = `signin`;
  root.className = `hidden`;
  root.innerHTML = `<div class="si-sheet" role="dialog" aria-label="Sign in"></div>`;
  document.body.appendChild(root);
  root.addEventListener(`click`, (e) => {
    if (e.target === root && !busy) close();
    const b = (e.target as HTMLElement).closest<HTMLElement>(`[data-si]`);
    if (!b || busy) return;
    if (b.dataset.si === `google`) google();
    else if (b.dataset.si === `wallet`) void wallet();
    else if (b.dataset.si === `create`) void create();
    else if (b.dataset.si === `close`) close();
  });
  root.addEventListener(`input`, (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.siName !== undefined) draft = t.value.trim().toLowerCase();
  });
  return root;
}

// While open, keys belong to the sheet: typing a name must not move the miner, nor reach the trip summary, the
// merchant dialog or a base sheet (they use E, C, Space and Esc). Registered when this module loads, so it runs
// before their window listeners (capture listeners on window run in the order they were added).
if (typeof window !== `undefined`)
  window.addEventListener(
    `keydown`,
    (e) => {
      if (!isOpen() || walletBusy) return;
      if (e.key === `Escape` && !busy) {
        e.preventDefault();
        close();
      } else if (e.key === `Enter` && session.needName && !busy) {
        e.preventDefault();
        void create();
      }
      e.stopImmediatePropagation();
    },
    true,
  );

function render(): void {
  if (!el) return;
  const sheet = el.querySelector<HTMLElement>(`.si-sheet`)!;
  const root = esc(session.deploy.root);
  const reason = opts.reason ? `<p class="si-why">${esc(opts.reason)}</p>` : ``;
  const note = msg ? `<p class="si-msg${msg.err ? ` err` : ``}" aria-live="polite">${esc(msg.text)}</p>` : ``;
  const body = session.needName
    ? `<p>Signed in${email ? ` as <b>${esc(email)}</b>` : ``}. Pick a name for your MINEAR account.</p>
       <label class="si-name"><input data-si-name maxlength="32" placeholder="your name" autocomplete="off" spellcheck="false" value="${esc(draft)}" ${busy ? `disabled` : ``} /><span>.${root}</span></label>
       <button class="si-go" data-si="create" type="button" ${busy ? `disabled` : ``}>${busy ? `Making your account…` : `Create my account`}</button>`
    : `<button class="si-google" data-si="google" type="button" ${busy ? `disabled` : ``}>${GOOGLE}<span>${busy && !walletBusy ? `Waiting for Google…` : `Continue with Google`}</span></button>
       <p class="soft">Also Apple, email or a passkey in the same window. No seed phrase, no wallet popup, no gas: the game pays the gas.</p>
       <p class="si-or">or</p>
       <button class="si-wallet" data-si="wallet" type="button" ${busy ? `disabled` : ``}>${NEAR}<span>${walletBusy ? `Waiting for your wallet…` : `Connect a NEAR wallet`}</span></button>
       <p class="soft">Your own NEAR testnet account. The wallet approves one game key per browser (it can only make game moves); after that, no popups. No NEAR in the account: the game pays the gas.</p>`;
  sheet.innerHTML = `<header><h2>Sign in</h2><button class="si-x" data-si="close" type="button" title="Close (Esc)" ${busy ? `disabled` : ``}>✕</button></header>
    ${reason}${body}${note}
    <p class="si-fine">With Google, your account is <b>&lt;name&gt;.${root}</b> on NEAR ${esc(session.network)}. Its key stays in NEAR's MPC network.</p>`;
  if (session.needName && !busy) sheet.querySelector<HTMLInputElement>(`[data-si-name]`)?.focus();
}

/** Runs the Google popup. Call only from a click handler. */
function google(): void {
  const popup = openAuthPopup();
  busy = true;
  msg = null;
  render();
  session
    .nearAuth(undefined, popup)
    .then((r) => {
      if (r.player) return done(r.player);
      email = r.email ?? ``;
      msg = null;
    })
    .catch((e) => {
      msg = { text: e instanceof Error ? e.message : String(e), err: true };
    })
    .finally(() => {
      busy = false;
      render();
    });
}

async function create(): Promise<void> {
  const name = (el?.querySelector<HTMLInputElement>(`[data-si-name]`)?.value ?? draft).trim().toLowerCase();
  if (!NAME_RX.test(name)) {
    msg = { text: `Use 3 to 32 lower-case letters, digits, - or _.`, err: true };
    return render();
  }
  busy = true;
  msg = null;
  render();
  try {
    const r = await session.nearAuth(name);
    if (r.player) done(r.player);
  } catch (e) {
    msg = { text: e instanceof Error ? e.message : String(e), err: true };
  } finally {
    busy = false;
    render();
  }
}

function done(p: Player): void {
  const f = opts.onDone;
  close();
  f?.(p);
}

function close(): void {
  el?.classList.add(`hidden`);
  msg = null;
}

/** NEAR wallet sign-in: NEAR Connect's picker, then the one-time game key (session.wallet). */
async function wallet(): Promise<void> {
  busy = true;
  walletBusy = true;
  msg = null;
  render();
  try {
    const p = await session.wallet((text) => {
      msg = { text, err: false };
      render();
    });
    walletBusy = false;
    busy = false;
    done(p);
  } catch (e) {
    msg = { text: e instanceof Error ? e.message : String(e), err: true };
  } finally {
    walletBusy = false;
    busy = false;
    render();
  }
}

/** Opens the sign-in sheet (with `start`, the Google popup too: call it from a click handler; with `wallet`, the
 *  NEAR wallet sign-in). */
export function openSignIn(o: SignInOptions = {}): void {
  el ??= make();
  opts = o;
  msg = null;
  el.classList.remove(`hidden`);
  if (o.start && !session.needName) google();
  else if (o.wallet && !session.needName) void wallet();
  else render();
}

export const signInOpen = isOpen;

const GOOGLE = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#ffc107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#ff3d00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4caf50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976d2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

/** The Google mark, for other buttons (the lobby). */
export const GOOGLE_ICON = GOOGLE;

/** The NEAR mark (white on the dark wallet buttons). */
const NEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.9 2.1 13.6 8.4c-.3.4.3.9.6.6l4.3-3.7c.1-.1.3 0 .3.1v11.4c0 .1-.2.2-.2.1L5.8 2.6A1.8 1.8 0 0 0 4.5 2h-.4A1.9 1.9 0 0 0 2.2 3.9v16.2C2.2 21.1 3 22 4.1 22c.7 0 1.3-.3 1.6-.9l4.3-6.3c.3-.4-.3-.9-.6-.6l-4.3 3.7c-.1.1-.3 0-.3-.1V6.4c0-.1.2-.2.2-.1l12.8 14.5c.4.5.9.7 1.3.7h.4c1 0 1.9-.9 1.9-1.9V3.9C21.4 2.9 20.6 2 19.5 2c-.7 0-1.3.3-1.6.9z"/></svg>`;
export const NEAR_ICON = NEAR;
