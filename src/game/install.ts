// Port of play-inUT-NSi.js 75579-75641: the "add to home screen" card for touch devices that are not already
// running as an installed app. The beforeinstallprompt capture runs at import time (75589-75593), so import
// this module early (main.tsx). The bootstrap dz calls oz() at 75747 when ?autostart is absent.
// Dismissal is remembered for the session (sessionStorage `minear.install.later`).
import { IS_TOUCH } from './device';

/** The Chromium install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** QR (75579): already running full screen or as an installed app. */
export const IS_STANDALONE: boolean = // QR (75579)
  matchMedia(`(display-mode: standalone)`).matches ||
  matchMedia(`(display-mode: fullscreen)`).matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** $R (75583): iPhone, iPad or iPod (iPadOS reports a Mac with touch). */
export const IS_IOS: boolean = // $R (75583)
  /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** ez (75586): sessionStorage key of "Play in the browser". */
export const INSTALL_LATER_KEY = `minear.install.later`; // ez (75586)

let deferred: BeforeInstallPromptEvent | null = null; // tz (75587)
let card: HTMLDivElement | null = null; // nz (75588)

// 75589-75593: keep the browser's install prompt for the card's Install button
if (IS_TOUCH && !IS_STANDALONE)
  addEventListener(`beforeinstallprompt`, (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    card?.querySelector(`.go`)?.removeAttribute(`hidden`);
  });

/** rz (75594): share icon. */
const ICON_SHARE = `<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; // rz (75594)
/** iz (75595): add icon. */
const ICON_ADD = `<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; // iz (75595)
/** az (75596): menu dots icon. */
const ICON_MENU = `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>`; // az (75596)

/** oz (75597): builds and shows the install card in #ui (touch only, once, unless dismissed this session). */
export function showInstallPrompt(): void { // oz (75597)
  if (!IS_TOUCH || IS_STANDALONE || card) return;
  try {
    if (sessionStorage.getItem(INSTALL_LATER_KEY)) return;
  } catch {
    /* storage blocked */
  }
  card = document.createElement(`div`);
  card.id = `install`;
  card.innerHTML = `<div class="icard">
      <h3>Play it full screen</h3>
      <p>Add MINEAR to your home screen: it opens like an app, sideways, with nothing in the way.</p>
      <ol class="steps">${(IS_IOS
        ? [
            [ICON_SHARE, `Tap <b>Share</b>`],
            [ICON_ADD, `<b>Add to Home Screen</b>`],
            [`<img src="/minear-icon.svg" alt="">`, `Open it from there`],
          ]
        : [
            [ICON_MENU, `Open the browser menu`],
            [ICON_ADD, `<b>Add to Home screen</b> or <b>Install</b>`],
            [`<img src="/minear-icon.svg" alt="">`, `Open it from there`],
          ]
      )
        .map(([e, t]) => `<li><i>${e}</i><span>${t}</span></li>`)
        .join(``)}</ol>
      <div class="ibtns"><button class="go" type="button" ${deferred ? `` : `hidden`}>Install</button><button class="ghost later" type="button">Play in the browser</button></div>
    </div>`;
  document.getElementById(`ui`)!.append(card);
  const later = () => {
    card?.remove();
    try {
      sessionStorage.setItem(INSTALL_LATER_KEY, `1`);
    } catch {
      /* storage blocked */
    }
  };
  card.querySelector(`.later`)!.addEventListener(`click`, later);
  card.querySelector(`.go`)!.addEventListener(`click`, async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === `accepted`) {
      card!.querySelector(`.icard`)!.innerHTML =
        `<h3>Added</h3><p>Open <b>MINEAR</b> from your home screen to play it full screen.</p><div class="ibtns"><button class="ghost later" type="button">Play here anyway</button></div>`;
      card!.querySelector(`.later`)!.addEventListener(`click`, later);
    }
  });
}
