// Port of the panel parts of the game class KR (play-inUT-NSi.js):
//   71249-71327  playing / paused / showPause / showRoster / resume / drawWorld / calm / anyPanel
//   71562-71583  the panel part of KR.run: freeze the frame behind a panel (backdrop xL), the inventory
//                portrait, and the 2 s shader compile check (which waits while the backdrop is on)
//   72171-72220  the panel keys of KR.handleKeys (M mute, keys of the open panel, Escape pause, Enter chat,
//                Tab / B / K inventory); the rest of handleKeys is src/ui/kr-hud.ts handleUseKeys
//   72250-72319  releaseLock, openMenu, closeMenu, openStash, stashMove, openShatter, closeShatter, openInv,
//                closeInv
//   70596-70680, 70794  the panel wiring of the KR constructor (pause sheet buttons, pause backdrop click,
//                pointer lock loss -> pause, input.relockOk, panel onClose hooks), and the menu nN (70627)
// Each KR method is a function that takes the game object through PanelHost.
//
// How the later panels plug in: the game holds them in the optional PanelHost fields (shatter = Wellspring
// pN, inv = inventory hP, loot = loot panel vP, leadersPanel = ZL, settingsPanel = yj, keysPanel = qL). Each
// one implements the small interface below. While one is missing, the functions here act as if it is closed,
// and a key or button that would open it does nothing.
import type * as THREE from 'three';
import { IS_TOUCH } from '../game/device';
import { saveSettings, type Settings } from '../game/settings';
import { stashCap, type PlayerState } from '../state/playerState';
import { ITEMS, type ItemDef } from '../world/items';
import type { Hud } from '../ui/hud';
import type { Backdrop } from './backdrop';
import { TradingPost, type StashEntry } from './tradingPost';
import { buy, restock, sellCrystal, sellItem, type EconomyHost } from './economy';

const ITEM = ITEMS as Record<string, ItemDef>;

/** Inventory pages (hP). */
export type InventoryPage = 'gear' | 'pack' | 'skills';

/** pN, the Wellspring panel ([wellspring], src/menus/wellspring/). locked: a shatter is playing out. */
export interface ShatterPanel {
  readonly open: boolean;
  readonly locked: boolean;
  show(state: PlayerState): void;
  hide(): void;
}

/** hP, the inventory panel ([inventory]). page undefined in show() keeps the page it had. */
export interface InventoryPanel {
  readonly open: boolean;
  readonly page: InventoryPage;
  show(state: PlayerState, page?: InventoryPage): void;
  hide(): void;
  setPage(page: InventoryPage): void;
  refresh(): void;
}

/** vP, the satchel / chest loot panel ([chests]). KR.closeLoot (74921) closes it. */
export interface LootPanel {
  readonly open: boolean;
  takeAll(): void;
}

/** ZL, the Mirror of Renown leaderboard ([inventory]). KR.openLeaders (75301) opens it. */
export interface LeadersPanel {
  readonly open: boolean;
  close(): void;
  onClose: () => void;
}

/** yj, the settings panel ([inventory]). */
export interface SettingsPanel {
  readonly open: boolean;
  show(): void;
  /** Re-reads the settings into the controls (after M mutes). */
  sync(): void;
  onClose: () => void;
}

/** qL, the controls sheet ([inventory]). */
export interface KeysPanel {
  readonly open: boolean;
  show(): void;
  onClose: () => void;
}

/** The audio methods used here (dM, src/audio/audio.ts). */
export interface PanelAudio {
  click(): void;
  deny(): void;
  creak(k?: number): void;
  setMuted(muted: boolean): void;
}

/** The game object (KR) as the panel functions read and write it. */
export interface PanelHost {
  /** MINEAR: a full-screen overlay outside the KR panels is up (the haul show, a merchant dialog). */
  overlayOpen?(): boolean;
  started: boolean;
  sandbox: boolean;
  state: PlayerState;
  settings: Settings;
  renderer: Pick<THREE.WebGLRenderer, 'domElement' | 'shadowMap'>;
  post: { composer: { render(): void } };
  /** A shadow map refresh is due on the next draw (KR.update sets it). */
  shadowDue: boolean;
  input: { hit(code: string): boolean; requestLock(): void; relockOk: () => boolean };
  audio: PanelAudio;
  ui: Pick<Hud, 'pauseEl' | 'roster' | 'noteToast'>;
  hub: { setStashOpen(open: boolean): void };
  player: { pos: THREE.Vector3 };
  combat: { ko: boolean; foes: { foes: { state: string; pos: THREE.Vector3 }[] } };
  /** KR.worm?.active (src/worm/wormClient.ts WormClient.active). */
  wormClient: { readonly active: boolean };
  /** KR.bosses?.engaged() (src/bosses/client/bossClient.ts). */
  bossClient: { engaged(): unknown };
  inHaven(pos: THREE.Vector3): boolean;
  /** KR.compileScene (70949). */
  compileScene(): Promise<void>;
  /** nN (createMenu). */
  menu: TradingPost;
  /** xL (new Backdrop(renderer.domElement), first in the constructor, 70213). */
  backdrop: Backdrop;
  // KR fields (70124-70142, 70179)
  /** performance.now() when the pause sheet opened. */
  pauseAt: number;
  /** Until this time the world keeps drawing behind a panel (snapshot + 280 ms). Starts at 0. */
  stillAt: number;
  /** Starts true. */
  calmNow: boolean;
  /** The pointer was locked since the last releaseLock. Starts false. */
  lockWasActive: boolean;
  /** Starts false. */
  compiling: boolean;
  /** Starts 0. */
  compiledAt: number;

  // later owners (optional)
  shatter?: ShatterPanel | null;
  inv?: InventoryPanel | null;
  loot?: LootPanel | null;
  leadersPanel?: LeadersPanel | null;
  settingsPanel?: SettingsPanel | null;
  keysPanel?: KeysPanel | null;
  /** EO multiplayer chat (not ported: solo has none). */
  mp?: { chat: { isOpen: boolean; open(): void } } | null;
  /** KR.closeLoot (74921, [chests]). */
  closeLoot?(): void;
  /** KR.renderPortrait (73502, [inventory]): the miner portrait on the inventory gear page. */
  renderPortrait?(dt: number): void;
}

/** KR.anyPanel (71299): the Trading Post / chest, the Wellspring, the inventory or the leaderboard is open. */
export function anyPanelOpen(g: PanelHost): boolean { // KR.anyPanel (71299)
  // MINEAR: the haul show and the merchant dialog count as panels too (Game.overlayOpen)
  return g.menu.open || !!g.shatter?.open || !!g.inv?.open || !!g.leadersPanel?.open || !!g.overlayOpen?.();
}

/** KR.paused (71260): the pause sheet is up. */
export function isPaused(g: Pick<PanelHost, 'ui'>): boolean { // KR.paused (71260)
  return !g.ui.pauseEl.classList.contains(`hidden`);
}

/** KR.playing (71249): started and nothing in the way of play. */
export function isPlaying(g: PanelHost): boolean { // KR.playing (71249)
  return (
    g.started &&
    !isPaused(g) &&
    !anyPanelOpen(g) &&
    !g.settingsPanel?.open &&
    !g.keysPanel?.open &&
    !g.combat.ko &&
    !g.mp?.chat.isOpen
  );
}

/** KR.showPause (71263). The account nudge after it (state.lvl >= 2 && gO.nudge()) is not ported (accounts). */
export function showPause(g: PanelHost): void { // KR.showPause (71263)
  showRoster(g);
  g.ui.pauseEl.classList.remove(`hidden`);
  g.pauseAt = performance.now();
}

/** KR.showRoster (71269): the players online on the pause sheet; solo (mp.online false) hides it. */
export function showRoster(g: Pick<PanelHost, 'ui'>): void { // KR.showRoster (71269)
  g.ui.roster(null);
}

/** KR.resume (71276) */
export function resume(g: PanelHost): void { // KR.resume (71276)
  g.ui.pauseEl.classList.add(`hidden`);
  g.input.requestLock();
}

/** KR.drawWorld (71279): the portrait (first on touch, last on desktop), a due shadow refresh, the composer. */
export function drawWorld(g: PanelHost, dt: number): void { // KR.drawWorld (71279)
  if (IS_TOUCH) g.renderPortrait?.(dt);
  if (g.shadowDue) {
    g.renderer.shadowMap.needsUpdate = true;
    g.shadowDue = false;
  }
  g.post.composer.render();
  if (!IS_TOUCH) g.renderPortrait?.(dt);
}

/** KR.calm (71285): nothing dangerous near (no worm up, no boss fight, no live foe within 28 / 36 m). */
export function calm(g: PanelHost): boolean { // KR.calm (71285)
  const e = g.player.pos;
  if (g.inHaven(e)) return (g.calmNow = true);
  const t = g.calmNow ? 28 : 36;
  let n = g.wormClient.active || !!g.bossClient.engaged();
  if (!n)
    for (const r of g.combat.foes.foes)
      if (r.state !== `dead` && r.pos.distanceToSquared(e) < t * t) {
        n = true;
        break;
      }
  return (g.calmNow = !n);
}

/**
 * The draw part of KR.run (71562-71574), after update(dt). now is the performance.now() taken at the start of
 * the frame (before update). Behind an open panel in calm: the first frame draws the world and snapshots it
 * into the backdrop (touch with the Wellspring open: no snapshot), the world keeps drawing for 280 ms, then
 * only the inventory portrait renders. Otherwise the backdrop goes and the world draws.
 */
export function presentFrame(g: PanelHost, dt: number, now: number): void { // KR.run (71562-71574)
  const a = g.started && anyPanelOpen(g) && calm(g);
  if (a && !g.backdrop.on) {
    const e = IS_TOUCH && !!g.shatter?.open;
    if (!e) {
      drawWorld(g, dt);
      g.backdrop.take(g.renderer.domElement);
    }
    g.backdrop.show();
    g.stillAt = e ? now : now + 280;
  } else if (a && now < g.stillAt) drawWorld(g, dt);
  else if (a) g.renderPortrait?.(dt);
  else {
    if (g.backdrop.on) g.backdrop.hide();
    drawWorld(g, dt);
  }
}

/** KR.run (71576-71583): every 2 s, while no backdrop is up, compile the shader programs that are new. */
export function compileTick(g: PanelHost, now: number): void { // KR.run (71576-71583)
  if (g.started && !g.compiling && !g.backdrop.on && now - g.compiledAt > 2e3) {
    g.compiling = true;
    g.compileScene().finally(() => {
      g.compiling = false;
      g.compiledAt = performance.now();
    });
  }
}

/**
 * The panel keys of KR.handleKeys (72171-72220). Returns true when a key went to a panel (KR returns there);
 * on false the game runs the use keys (src/ui/kr-hud.ts handleUseKeys, 72221-72248).
 * KR calls handleKeys from update (71626) only when started and the chat is closed.
 */
export function handlePanelKeys(g: PanelHost): boolean { // KR.handleKeys (72171-72220)
  const e = g.input;
  if (e.hit(`KeyM`)) {
    g.settings.muted = !g.settings.muted;
    g.audio.setMuted(g.settings.muted);
    saveSettings(g.settings); // gj
    g.settingsPanel?.sync();
  }
  if (g.shatter?.open) {
    if ((e.hit(`KeyE`) || e.hit(`Escape`)) && !g.shatter.locked) closeShatter(g);
    return true;
  }
  if (g.loot?.open) {
    if (e.hit(`KeyE`)) g.loot.takeAll();
    else if (e.hit(`Escape`)) g.closeLoot?.();
    return true;
  }
  const inv = g.inv;
  if (inv?.open) {
    // MINEAR: Tab is the gear key: from another page it goes to the gear page, on the gear page it closes
    if (e.hit(`Tab`) && inv.page !== `gear`) inv.setPage(`gear`);
    else if (
      e.hit(`Tab`) ||
      e.hit(`Escape`) ||
      (e.hit(`KeyB`) && inv.page === `pack`) ||
      (e.hit(`KeyK`) && inv.page === `skills`)
    )
      closeInv(g);
    else if (e.hit(`Digit1`)) inv.setPage(`gear`);
    else if (e.hit(`Digit2`) || e.hit(`KeyB`)) inv.setPage(`pack`);
    else if (e.hit(`Digit3`) || e.hit(`KeyK`)) inv.setPage(`skills`);
    return true;
  }
  if (g.menu.open) {
    if (e.hit(`KeyE`) || e.hit(`Escape`)) closeMenu(g);
    return true;
  }
  if (g.leadersPanel?.open) {
    if (e.hit(`KeyE`) || e.hit(`Escape`)) g.leadersPanel.close();
    return true;
  }
  if (e.hit(`Escape`) && !g.settingsPanel?.open && !g.keysPanel?.open) {
    if (isPaused(g)) {
      if (performance.now() - g.pauseAt > 250) resume(g);
    } else showPause(g);
    return true;
  }
  if ((e.hit(`Enter`) || e.hit(`NumpadEnter`)) && !g.sandbox) {
    g.mp?.chat.open();
    return true;
  }
  if ((e.hit(`Tab`) || e.hit(`KeyB`) || e.hit(`KeyK`)) && !g.combat.ko) {
    openInv(g, e.hit(`KeyB`) ? `pack` : e.hit(`KeyK`) ? `skills` : `gear`); // MINEAR: Tab always opens the gear page
    return true;
  }
  return false;
}

/** KR.releaseLock (72250): frees the mouse without the "lock lost" pause. */
export function releaseLock(g: Pick<PanelHost, 'lockWasActive'>): void { // KR.releaseLock (72250)
  if (document.pointerLockElement) {
    g.lockWasActive = false;
    document.exitPointerLock();
  }
}

/** KR.openMenu (72253): the Trading Post. */
export function openMenu(g: PanelHost): void { // KR.openMenu (72253)
  g.menu.show(g.state);
  g.audio.click();
  if (!g.state.seen.trade) {
    g.state.seen.trade = true;
    g.state.save();
  }
  releaseLock(g);
}

/** KR.closeMenu (72259): closes the Trading Post or the chest (the chest lid shuts). */
export function closeMenu(g: PanelHost): void { // KR.closeMenu (72259)
  if (!g.menu.open) return;
  if (g.menu.current === `stash`) {
    g.hub.setStashOpen(false);
    g.audio.creak(0.6);
  }
  g.menu.hide();
  g.input.requestLock();
}

/** KR.openStash (72265): the home Storage Chest (the lid opens). */
export function openStash(g: PanelHost): void { // KR.openStash (72265)
  g.menu.show(g.state, `stash`);
  g.hub.setStashOpen(true);
  g.audio.creak(0.8);
  g.audio.click();
  releaseLock(g);
}

/** KR.stashMove (72272): moves an entry into the chest (toChest) or out; all = the whole stack. */
export function stashMove(g: PanelHost, e: StashEntry, t: boolean, n: boolean): boolean { // KR.stashMove (72272)
  const r = g.state;
  let i = false;
  if (e.uid === undefined) {
    if (e.supply) i = (t ? r.stowSupply(e.supply, n ? 1 / 0 : 1) : r.unstowSupply(e.supply, n ? 1 / 0 : 1)) > 0;
    else if (e.gem) i = (t ? r.stowGem(e.gem, n ? 1 / 0 : 1) : r.unstowGem(e.gem, n ? 1 / 0 : 1)) > 0;
  } else i = t ? r.stowItem(e.uid) : r.unstowItem(e.uid);
  if (i) {
    g.audio.click();
    g.inv?.refresh();
  } else {
    g.audio.deny();
    if (!t && e.supply) g.ui.noteToast(``, `You can't carry more ${ITEM[e.supply]?.name ?? ``}`);
    else if (!t && e.gem) g.ui.noteToast(``, `Your cart is full`);
    else if (t && e.gem) g.ui.noteToast(``, `${ITEM[e.gem]?.name ?? `That gem`}: the chest keeps ${stashCap(e.gem)} at most`);
    else if (t) g.ui.noteToast(``, `The chest is full`);
  }
  return i;
}

/** KR.openShatter (72303): the Wellspring. */
export function openShatter(g: PanelHost): void { // KR.openShatter (72303)
  if (!g.shatter) return;
  g.shatter.show(g.state);
  g.audio.click();
  releaseLock(g);
}

/**
 * KR.closeShatter (72306). The sign-in note after it (state.lvl >= 2 && gO.hint(): "Keep your miner on any
 * device") is not ported (accounts).
 */
export function closeShatter(g: PanelHost): void { // KR.closeShatter (72306)
  if (!g.shatter?.open) return;
  g.shatter.hide();
  g.input.requestLock();
}

/** KR.openInv (72314): the inventory, on a page (undefined keeps the last page). */
export function openInv(g: PanelHost, page?: InventoryPage): void { // KR.openInv (72314)
  if (!g.inv) return;
  g.inv.show(g.state, page);
  g.audio.click();
  releaseLock(g);
}

/** KR.closeInv (72317) */
export function closeInv(g: PanelHost): void { // KR.closeInv (72317)
  if (!g.inv?.open) return;
  g.inv.hide();
  g.input.requestLock();
}

/** The menu nN as KR makes it (70627-70634): trades go to the economy, stash moves to stashMove. */
export function createMenu(g: PanelHost & EconomyHost): TradingPost { // KR constructor (70627)
  return new TradingPost({
    sellItem: (e) => sellItem(g, e),
    sellCrystal: (e) => sellCrystal(g, e),
    buy: (e) => buy(g, e),
    restock: () => restock(g),
    stash: (e, t, n) => stashMove(g, e, t, n),
    close: () => closeMenu(g),
    // MINEAR: the NEAR merchants. Loaded on first use, so the NEAR code is not in the game's start bundle.
    market: () =>
      void import('./market').then(({ openMarket }) =>
        openMarket({
          state: g.state,
          onLocalChange: () => {
            g.ui.bumpCoins();
            g.ui.bumpCrystals();
            g.menu.refresh();
            g.inv?.refresh();
          },
        }),
      ),
  });
}

/**
 * The panel wiring of the KR constructor. Call it once, after the panels that exist are on the game
 * (settingsPanel / keysPanel / leadersPanel onClose are set here) and after input.attach. Returns a
 * function that removes the document listeners it added.
 *   70596-70601  settings / controls closed while started -> the pause sheet
 *   70602-70613  pause sheet buttons .open-controls / .open-settings
 *   70624-70626  a click on the pause backdrop resumes
 *   70664-70673  pointer lock lost (not by releaseLock, no panel open) -> pause
 *   70674-70680  input.relockOk: a key may re-lock the pointer only in play
 *   70794        leaderboard closed -> lock the pointer again
 * (.open-tutorial at 70616 belongs to the tutorial.)
 */
export function wirePanels(g: PanelHost): () => void { // KR constructor (70596-70680, 70794)
  if (g.settingsPanel) g.settingsPanel.onClose = () => g.started && showPause(g);
  if (g.keysPanel) g.keysPanel.onClose = () => g.started && showPause(g);
  const off: (() => void)[] = [];
  const on = (el: EventTarget, type: string, fn: (e: Event) => void) => {
    el.addEventListener(type, fn);
    off.push(() => el.removeEventListener(type, fn));
  };
  document.querySelectorAll(`.open-controls`).forEach((el) =>
    on(el, `click`, (e) => {
      if (!g.keysPanel) return;
      e.stopPropagation();
      g.ui.pauseEl.classList.add(`hidden`);
      g.keysPanel.show();
    }),
  );
  document.querySelectorAll(`.open-settings`).forEach((el) =>
    on(el, `click`, (e) => {
      if (!g.settingsPanel) return;
      e.stopPropagation();
      g.ui.pauseEl.classList.add(`hidden`);
      g.settingsPanel.show();
    }),
  );
  on(g.ui.pauseEl, `click`, (e) => {
    if (e.target === g.ui.pauseEl) resume(g);
  });
  on(document, `pointerlockchange`, () => {
    if (document.pointerLockElement === g.renderer.domElement) g.lockWasActive = true;
    else if (g.started && g.lockWasActive && !anyPanelOpen(g) && !g.settingsPanel?.open && !g.keysPanel?.open)
      showPause(g);
  });
  g.input.relockOk = () =>
    g.started && !isPaused(g) && !anyPanelOpen(g) && !g.settingsPanel?.open && !g.keysPanel?.open && !g.combat.ko;
  if (g.leadersPanel) g.leadersPanel.onClose = () => g.input.requestLock();
  return () => off.splice(0).forEach((f) => f());
}
