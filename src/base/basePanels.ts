// MINEAR base: the panels of the base sites, drawn inside the building sheet of the Trading Post
// (src/menus/tradingPost.ts, #building in index.html) so they share its look, its close keys (E / Esc) and the
// "a panel is open" rules. Themes: refinery, forge, board, capsule, site (a locked or coming-soon site) and haul
// (the expedition summary after Back to Base). The Forge "Make gear" steps (slot tiles, slot detail, reveal)
// are drawn by minear-r3f/src/base/forgeView.ts.
// MINEAR rules (user, 2026-11-14): the Refinery, the Forge and rerolls spend materials ON CHAIN only (the vault,
// minear-r3f/src/economy/vault.ts). A signed-in player's trips are saved on chain when they end, with no Claim step.
// Their sheets open with the save bar: what still waits in this browser (over a limit, or a failed save) with Save
// now, or, for a demo player (whose trips are not kept), Sign in with Google (minear-r3f/src/menus/signIn.ts).
import { gearIcons, gearTile } from '../menus/gearIcons';
import { statList } from '../menus/tradingPost';
import { GEAR_BY_ID, SLOT_LABELS, type GearItem, type GearSlotType } from '../state/gear';
import { GOALS } from '../state/goals';
import { rewardHTML } from '../ui/goalReward';
import type { PlayerState } from '../state/playerState';
import { TIER_COLORS, TIER_DARK, TIER_NAMES } from '../state/progression';
import { ITEMS, RARITY_COLORS, type ItemDef } from '../world/items';
import { ForgeReveal, forgeMakeHTML, forgePickHTML, runForge } from './forgeView';
import { ORE_IDS } from './run';
import { SITE_BY_ID, siteStatus, type SiteId, type UnlockView } from './sites';
import {
  CAPSULE_COIN_PRICE,
  CAPSULE_ODDS,
  FORGE_GRADES,
  REFINE,
  SALVAGE,
  heldGear,
  oreHave,
  prizeText,
  refine,
  rerollCost,
  rerollEnchants,
  salvage,
  salvageChain,
  spinCapsule,
  type CapsulePrize,
} from './workshop';
import type { Haul } from './backToBase';
import { localMaterials, savedText, unsavedCount, vault } from '../economy/vault';
import { tokenName } from '../economy/catalog';
import { CHEAT } from '../game/entry';
import { session } from '../near/session';
import { openSignIn } from '../menus/signIn';

const ITEM = ITEMS as Record<string, ItemDef>;

export type BaseTheme = 'refinery' | 'forge' | 'board' | 'capsule' | 'site' | 'haul' | 'home';
export const BASE_THEMES: BaseTheme[] = [`refinery`, `forge`, `board`, `capsule`, `site`, `haul`, `home`];
export const isBaseTheme = (t: unknown): t is BaseTheme => BASE_THEMES.includes(t as BaseTheme);

const num = (n: number): string => Math.floor(n).toLocaleString();
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;` })[c as '&']);
const hex = (n: number): string => `#${n.toString(16).padStart(6, `0`)}`;

/** The sheet parts this module draws into (the Trading Post panel). */
export interface BaseSheet {
  el: HTMLElement;
  content: HTMLElement;
  tabsEl: HTMLElement;
  state: PlayerState;
  burst(r: DOMRect, color: string, n?: number, big?: boolean): void;
  celebrate(r: DOMRect, color: string): void;
  fit(): void;
}

/** What the panels need from the game. */
export interface BaseDeskHost {
  state: PlayerState;
  audio: {
    click(): void;
    deny(): void;
    deposit(v: number): void;
    purchase(): void;
    loot(tier: number): void;
    diceRoll(): void;
    equip(): void;
    /** The Forge reveal (src/base/forgeView.ts): an anvil hit, the rarity chord, the legendary fanfare. */
    clang?(): void;
    cardFlip?(tier: number): void;
    levelUp?(): void;
  };
  ui: { bumpCoins(): void };
  onStatsChanged(): void;
  inv?: { refresh(): void } | null;
  unlockView(): UnlockView;
  /** Closes the sheet (the haul's button, the confirm's Stay). */
  closeSheet(): void;
  /** Back to Base, after the confirm. */
  goHome(): void;
  /** True on the island. */
  atBase(): boolean;
}

// ---- crests ---------------------------------------------------------------------------------------------

const INK = `stroke="#3a281c" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;
const CREST: Record<BaseTheme, string> = {
  refinery: `<svg viewBox="0 0 64 64"><rect x="40" y="6" width="10" height="24" fill="#a9573c" ${INK}/><path d="M10 26h40v30H10z" fill="#b2aaa0" ${INK}/><path d="M20 56V42a10 10 0 0 1 20 0v14z" fill="#3d434c" ${INK}/><path d="M24 56v-9a6 6 0 0 1 12 0v9z" fill="#ff7a2a"/><path d="M6 26h48" ${INK}/></svg>`,
  forge: `<svg viewBox="0 0 64 64"><path d="M10 26h34c0 6 6 8 12 8v4H40l-4 6h6v8H18v-8h6l-4-6c-6 0-10-5-10-12z" fill="#5c6470" ${INK}/><path d="M34 6l12 12-4 4-12-12z" fill="#c89a63" ${INK}/><path d="M28 10l8-6 6 6-8 6z" fill="#8a96a6" ${INK}/></svg>`,
  board: `<svg viewBox="0 0 64 64"><path d="M14 58V14M50 58V14" ${INK}/><rect x="8" y="16" width="48" height="32" rx="3" fill="#c89a63" ${INK}/><rect x="14" y="21" width="14" height="16" fill="#fff4dc" ${INK} transform="rotate(-6 21 29)"/><rect x="34" y="22" width="14" height="18" fill="#fff4dc" ${INK} transform="rotate(5 41 31)"/><circle cx="21" cy="21" r="2.5" fill="#e2484f"/><circle cx="41" cy="22" r="2.5" fill="#e2484f"/></svg>`,
  capsule: `<svg viewBox="0 0 64 64"><circle cx="32" cy="22" r="16" fill="#dff6ff" ${INK}/><circle cx="26" cy="22" r="5" fill="#ffd36b"/><circle cx="37" cy="18" r="5" fill="#5fc8ff"/><circle cx="35" cy="29" r="5" fill="#ff7aa8"/><rect x="16" y="36" width="32" height="22" rx="3" fill="#e2484f" ${INK}/><circle cx="27" cy="47" r="5" fill="#fff6e5" ${INK}/><rect x="37" y="42" width="5" height="9" fill="#3d434c"/></svg>`,
  site: `<svg viewBox="0 0 64 64"><path d="M20 30v-8a12 12 0 0 1 24 0v8" fill="none" ${INK} stroke-width="5"/><rect x="14" y="28" width="36" height="28" rx="6" fill="#ffc23d" ${INK}/><circle cx="32" cy="40" r="4" fill="#3a281c"/><path d="M32 42v7" ${INK}/></svg>`,
  home: `<svg viewBox="0 0 64 64"><path d="M8 34L32 12l24 22" fill="none" ${INK} stroke-width="5"/><path d="M14 30v24h36V30" fill="#fff6e5" ${INK}/><rect x="27" y="38" width="10" height="16" fill="#9a6a3f" ${INK}/><path d="M32 2v8" ${INK}/><path d="M33 3h10l-3 3 3 3H33z" fill="#2fa39a" ${INK}/></svg>`,
  haul: `<svg viewBox="0 0 64 64"><path d="M12 28c0-10 8-15 20-15s20 5 20 15z" fill="#c9823c" ${INK}/><rect x="10" y="28" width="44" height="24" rx="4" fill="#b06a2c" ${INK}/><path d="M10 28h44" stroke="#ffc23d" stroke-width="5"/><path d="M22 18l4-8 4 8M38 18l4-6 3 7" fill="#5fb4ff" ${INK}/><rect x="27" y="24" width="10" height="13" rx="2.5" fill="#ffc23d" ${INK}/></svg>`,
};

const TITLES: Record<Exclude<BaseTheme, 'site'>, [string, string]> = {
  refinery: [`Refinery`, `Smelt ore into the next ore up`],
  forge: [`Forge`, `Make gear, salvage it, reroll its enchants`],
  board: [`Requests Board`, `Jobs from the island, with rewards`],
  capsule: [`Capsule Machine`, `One Capsule Coin, one spin`],
  haul: [`Last mining trip`, `What the last trip brought home`],
  home: [`Finish mining trip`, `End this trip and see what you found`],
};

// ---- pieces ---------------------------------------------------------------------------------------------

const oreIcon = (id: string): string => `<span class="bz-ic">${gearIcons.lootHtml(id)}</span>`;

/** The ore on chain (the vault) and the Capsule Coins. */
function oreStrip(s: PlayerState): string {
  return `<div class="bz-ores" title="Your ore on chain, ready to use">${ORE_IDS.map(
    (id) =>
      `<span class="bz-ore" style="--c:${hex(ITEM[id].color)}">${oreIcon(id)}<b>${num(oreHave(s, id))}</b><small>${ITEM[id].name}</small></span>`,
  ).join(``)}<span class="bz-ore cap"><i class="bz-capcoin"></i><b>${num(s.capsules)}</b><small>Capsule</small></span></div>`;
}

const cost = (id: string, n: number, have: number): string =>
  `<span class="bz-cost${have < n ? ` short` : ``}">${oreIcon(id)}${num(n)}</span>`;
/** A coin cost chip; nothing for 0 (making and upgrading are paid in materials only). */
const coinCost = (n: number, have: number): string =>
  n > 0 ? `<span class="bz-cost${have < n ? ` short` : ``}"><i class="coin sm"></i>${num(n)}</span>` : ``;

/** The save bar on top of the Refinery and the Forge: what still waits in this browser and Save now; for a demo
 *  player, sign in. Buttons: data-bz="save", "signin", "cheatacct". */
function claimBar(s: PlayerState): string {
  const local = [...localMaterials(s)];
  const n = unsavedCount(s);
  const list = esc(local.map(([t, k]) => `${num(k)} ${tokenName(t)}`).join(`, `));
  if (!vault.signedIn)
    return CHEAT
      ? `<div class="bz-claim lock"><span>The Demo cheat keeps what you mine on a local testnet account.</span><button data-bz="cheatacct">Make my local testnet account</button></div>`
      : `<div class="bz-claim lock"><span>You make things with materials saved on NEAR. A demo trip is not kept: sign in with NEAR to keep what you mine.</span><button class="google" data-bz="signin">Sign in with Google</button></div>`;
  if (!vault.loaded) return `<div class="bz-claim"><span>Reading your materials on ${vault.chainName}…</span></div>`;
  if (vault.saving) return `<div class="bz-claim"><span>Saving what you mined on ${vault.chainName}…</span></div>`;
  if (!n) return ``;
  const why = vault.last?.left && vault.last.why ? ` ${esc(vault.last.why)}` : ``;
  return `<div class="bz-claim"><span><b title="${list}">${num(n)}</b> not saved on chain yet.${why}</span><button data-bz="save" ${vault.busy ? `disabled` : ``}>Save now</button></div>`;
}

function prizeHTML(p: CapsulePrize): string {
  let icon = ``;
  let color = `#ffc23d`;
  if (p.kind === `coins`) icon = `<i class="coin"></i>`;
  else if (p.kind === `ore` || p.kind === `supply` || p.kind === `gem`) {
    icon = gearIcons.lootHtml(p.id);
    color = p.kind === `gem` ? RARITY_COLORS[ITEM[p.id].rarity] : hex(ITEM[p.id].color);
  } else if (p.kind === `die`) icon = `<i class="die"></i>`;
  else if (p.kind === `gear`) return `<div class="bz-prize pop" style="--c:${TIER_COLORS[p.item.tier]}">${gearTile(p.item)}<b style="color:${TIER_DARK[p.item.tier]}">${esc(prizeText(p))}</b></div>`;
  else if (p.kind === `capsules`) icon = `<i class="bz-capcoin big"></i>`;
  return `<div class="bz-prize pop" style="--c:${color}"><div class="itile big" style="--tc:${color}">${icon}</div><b>${esc(prizeText(p))}</b></div>`;
}

/** Capsule spots inside the globe drawing (px, top-left of each 46 px ball). */
const GLOBE: [number, number][] = [
  [18, 92],
  [58, 104],
  [100, 96],
  [34, 58],
  [76, 66],
  [110, 56],
  [52, 26],
  [90, 30],
];

// ---- the desk -------------------------------------------------------------------------------------------

export class BaseDesk {
  host: BaseDeskHost;
  site: SiteId = `refinery`;
  forgeTab: 'make' | 'salvage' | 'reroll' = `make`;
  /** Make gear: `pick` shows the tiles, `make` the detail of forgeSlot (a Forge kind id, workshop FORGE_SLOTS). */
  forgeStep: 'pick' | 'make' = `pick`;
  forgeSlot = `claws`;
  /** Index in FORGE_GRADES of the chosen ore. */
  forgeOre = 0;
  haul: Haul | null = null;
  prize: CapsulePrize | null = null;
  private reveal = new ForgeReveal();
  private lastTheme: BaseTheme | null = null;
  private watching = false;
  /** A chain action (save, smelt, make, reroll) is on its way. */
  private busy = false;
  /** The line under the save bar: the last chain action's result or error. */
  private msg: { text: string; err: boolean } | null = null;
  private sheet: BaseSheet | null = null;

  constructor(host: BaseDeskHost) {
    this.host = host;
    // the vault changed (read, save, spend, sign-in): redraw an open Refinery or Forge, not under a reveal
    vault.onChange(() => {
      const sh = this.sheet;
      const t = this.lastTheme;
      if (!sh || !t || this.busy || this.reveal.open || sh.el.classList.contains(`hidden`)) return;
      if (t === `refinery` || t === `forge` || t === `haul`) {
        this.render(sh, t);
        sh.fit();
      }
    });
  }

  /** A fresh open of the Forge starts at the slot tiles; a closed sheet drops the reveal. */
  private watch(sh: BaseSheet, theme: BaseTheme): void {
    if (!this.watching) {
      this.watching = true;
      new MutationObserver(() => {
        if (!sh.el.classList.contains(`hidden`)) return;
        this.reveal.close(true);
        this.forgeStep = `pick`;
        this.lastTheme = null;
      }).observe(sh.el, { attributes: true, attributeFilter: [`class`] });
    }
    if (theme === this.lastTheme) return;
    this.lastTheme = theme;
    this.reveal.close(true);
    this.msg = null;
    if (theme === `forge`) this.forgeStep = `pick`;
    // one vault read when a sheet that spends materials on chain opens (no timer)
    if ((theme === `refinery` || theme === `forge` || theme === `haul`) && vault.signedIn) void vault.refresh();
  }

  /** Draws the theme into the sheet. */
  render(sh: BaseSheet, theme: BaseTheme): void {
    const s = this.host.state;
    this.sheet = sh;
    this.watch(sh, theme);
    const q = <T extends Element = HTMLElement>(sel: string) => sh.el.querySelector(sel) as T;
    q(`.crest`).innerHTML = CREST[theme];
    if (theme === `site`) {
      const d = SITE_BY_ID[this.site];
      q(`h2`).textContent = d.name;
      q(`.sub`).textContent = d.blurb;
      q(`.sheet`).style.setProperty(`--accent`, d.color);
    } else {
      q(`h2`).textContent = TITLES[theme][0];
      q(`.sub`).textContent = TITLES[theme][1];
      q(`.sheet`).style.removeProperty(`--accent`);
    }
    sh.tabsEl.innerHTML = ``;
    let html = ``;
    if (theme === `refinery`) html = this.refineryHTML(s);
    else if (theme === `forge`) {
      sh.tabsEl.innerHTML = (
        [
          [`make`, `Make gear`],
          [`salvage`, `Salvage`],
          [`reroll`, `Reroll enchants`],
        ] as const
      )
        .map(([k, t]) => `<button class="${k === this.forgeTab ? `on` : ``}" data-ftab="${k}">${t}</button>`)
        .join(``);
      html = this.forgeHTML(s);
    } else if (theme === `board`) html = this.boardHTML(s);
    else if (theme === `capsule`) html = this.capsuleHTML(s);
    else if (theme === `site`) html = this.siteHTML();
    else if (theme === `home`) html = this.homeHTML();
    else html = this.haulHTML();
    if (theme === `refinery` || theme === `forge` || theme === `haul`) {
      const note = this.msg ? `<p class="bz-msg${this.msg.err ? ` err` : ``}" aria-live="polite">${esc(this.msg.text)}</p>` : ``;
      html = claimBar(s) + note + html;
    }
    sh.content.innerHTML = `<div class="bz bz-t-${theme}${this.busy ? ` busy` : ``}">${html}</div>`;
    this.wire(sh, theme);
  }

  private wire(sh: BaseSheet, theme: BaseTheme): void {
    const h = this.host;
    const s = h.state;
    sh.tabsEl.querySelectorAll<HTMLElement>(`[data-ftab]`).forEach((b) =>
      b.addEventListener(`click`, () => {
        const tab = b.dataset.ftab as BaseDesk['forgeTab'];
        // a second click on Make gear goes back to the slot tiles
        if (tab === `make` && this.forgeTab === `make`) this.forgeStep = `pick`;
        this.forgeTab = tab;
        h.audio.click();
        this.render(sh, theme);
        sh.fit();
      }),
    );
    sh.content.querySelectorAll<HTMLElement>(`[data-bz]`).forEach((b) =>
      b.addEventListener(`click`, (ev) => {
        ev.stopPropagation();
        const r = b.getBoundingClientRect();
        const act = b.dataset.bz;
        // Forge "Make gear" steps: open a slot, go back, choose the ore (no state change to save)
        if (act === `fslot` || act === `fback` || act === `fore`) {
          if (act === `fslot`) {
            this.forgeSlot = b.dataset.slot ?? `claws`;
            this.forgeStep = `make`;
          } else if (act === `fback`) this.forgeStep = `pick`;
          else this.forgeOre = Math.max(0, Math.min(FORGE_GRADES.length - 1, +b.dataset.i! || 0));
          h.audio.click();
          this.render(sh, theme);
          sh.fit();
          return;
        }
        // sign in (Google) or the Demo cheat's local account; then the vault is read and the sheet redraws
        if (act === `signin`) {
          openSignIn({ start: true, reason: `Sign in with NEAR to keep what you mine, then make and upgrade.` });
          return;
        }
        if (act === `cheatacct`) {
          void this.chainAct(sh, theme, r, async () => (await session.cheatAccount(), null), `Making your local testnet account`);
          return;
        }
        if (act === `save`) {
          void this.chainAct(
            sh,
            theme,
            r,
            async () => {
              const res = await vault.saveAll(s);
              h.inv?.refresh();
              if (res.err) throw new Error(res.why ?? `The save failed.`);
              if (!res.items.length) {
                if (res.why) this.msg = { text: res.why, err: false };
                return null;
              }
              h.audio.deposit(40);
              this.msg = { text: `Saved ${savedText(res.items)}.${res.why ? ` ${res.why}` : ``}`, err: false };
              return `#37c27a`;
            },
            `Saving on ${vault.chainName}`,
          );
          return;
        }
        // Make (one) and x10 (up to ten while the materials on chain last): burn on chain, then the reveal
        if (act === `forge` || act === `forge10`) {
          if (this.busy) return;
          this.busy = true;
          this.msg = { text: `Forging: burning the materials on ${vault.chainName}…`, err: false };
          this.render(sh, theme);
          void runForge(s, FORGE_GRADES[this.forgeOre], this.forgeSlot, act === `forge10` ? 10 : 1).then(
            (run) => {
              this.busy = false;
              this.msg = null;
              if (run) this.showRun(sh, theme, run);
              else {
                h.audio.deny();
                this.render(sh, theme);
                this.shake(sh);
              }
            },
            (e) => {
              this.busy = false;
              this.msg = { text: e instanceof Error ? e.message : String(e), err: true };
              h.audio.deny();
              this.render(sh, theme);
              this.shake(sh);
            },
          );
          return;
        }
        if (act === `refine` || act === `reroll`) {
          void this.chainAct(
            sh,
            theme,
            r,
            async () => {
              if (act === `refine`) {
                const rec = REFINE[+b.dataset.i!];
                const made = await refine(s, rec, b.dataset.n === `all` ? Infinity : 1);
                if (made < 1) return null;
                h.audio.deposit(made * 8);
                return hex(ITEM[rec.to].color);
              }
              const uid = +b.dataset.uid!;
              if (!(await rerollEnchants(s, uid))) return null;
              h.audio.equip();
              h.onStatsChanged();
              const it = heldGear(s).find((e) => e.item.uid === uid);
              return it ? TIER_COLORS[it.item.tier] : `#ffc23d`;
            },
            act === `refine` ? `Smelting on ${vault.chainName}` : `Rerolling: burning the ore on ${vault.chainName}`,
          );
          return;
        }
        // salvage of a gear NFT (v2 contract): the chain burns it and mints its ore
        if (act === `salvage` && vault.chainGear && s.items.find((e) => e.uid === +b.dataset.uid!)?.chain) {
          void this.chainAct(
            sh,
            theme,
            r,
            async () => {
              const out = await salvageChain(s, +b.dataset.uid!);
              h.inv?.refresh();
              if (!out) return null;
              h.audio.deposit(20);
              return `#ffc23d`;
            },
            `Salvaging on ${vault.chainName}`,
          );
          return;
        }
        let ok = false;
        let color = `#ffc23d`;
        if (act === `salvage`) {
          const out = salvage(s, +b.dataset.uid!);
          ok = !!out;
          if (ok) h.audio.deposit(20);
          h.inv?.refresh();
        } else if (act === `buycoin`) {
          ok = s.coins >= CAPSULE_COIN_PRICE;
          if (ok) {
            s.coins -= CAPSULE_COIN_PRICE;
            s.capsules++;
            h.audio.purchase();
          }
        } else if (act === `spin`) {
          const p = spinCapsule(s);
          ok = !!p;
          if (p) {
            this.prize = p;
            h.audio.diceRoll();
            if (p.kind === `gear`) h.audio.loot(p.item.tier);
            color = p.kind === `gear` ? TIER_COLORS[p.item.tier] : `#ff5a7a`;
            h.inv?.refresh();
          }
        } else if (act === `close`) {
          h.closeSheet();
          return;
        } else if (act === `home`) {
          h.goHome();
          return;
        }
        if (!ok) {
          h.audio.deny();
          this.shake(sh);
          return;
        }
        s.save();
        // a salvage or a spin that gave materials: saved on chain at once, like a trip (the bar redraws)
        if ((act === `salvage` || act === `spin`) && vault.signedIn && unsavedCount(s)) void vault.saveAll(s).then(() => h.inv?.refresh());
        h.ui.bumpCoins();
        this.render(sh, theme);
        sh.fit();
        if (color) {
          if (act === `spin`) sh.celebrate(r, color);
          else sh.burst(r, color, 16);
        }
      }),
    );
  }

  /** After a make: save, redraw, then the reveal over the sheet (Equip puts the chosen piece on). */
  private showRun(sh: BaseSheet, theme: BaseTheme, run: NonNullable<Awaited<ReturnType<typeof runForge>>>): void {
    const h = this.host;
    const s = h.state;
    s.save();
    h.ui.bumpCoins();
    h.inv?.refresh();
    this.render(sh, theme);
    sh.fit();
    const sheet = sh.el.querySelector<HTMLElement>(`.sheet`);
    if (!sheet) return;
    this.reveal.show(
      sheet,
      run,
      h.audio,
      () => sh.fit(),
      (uid) => {
        // Equip in the result: put the chosen piece on (the one it replaces stays in the wallet)
        if (!s.equip(uid)) return;
        h.audio.equip();
        h.onStatsChanged();
        h.inv?.refresh();
        this.render(sh, theme);
      },
    );
    sh.fit();
  }

  /** One chain action (save, smelt, reroll, the local account): one at a time, a waiting line, then a burst in
   *  the returned colour, a deny for null, or the chain's reason under the save bar. */
  private async chainAct(sh: BaseSheet, theme: BaseTheme, r: DOMRect, f: () => Promise<string | null>, label: string): Promise<void> {
    if (this.busy) return;
    const h = this.host;
    this.busy = true;
    this.msg = { text: `${label}…`, err: false };
    this.render(sh, theme);
    let color: string | null = null;
    try {
      color = await f();
      if (this.msg?.text === `${label}…`) this.msg = null;
    } catch (e) {
      this.msg = { text: e instanceof Error ? e.message : String(e), err: true };
    }
    this.busy = false;
    h.state.save();
    h.ui.bumpCoins();
    this.render(sh, theme);
    sh.fit();
    if (color) sh.burst(r, color, 16);
    else if (this.msg?.err) {
      h.audio.deny();
      this.shake(sh);
    }
  }

  private shake(sh: BaseSheet): void {
    const el = sh.el.querySelector<HTMLElement>(`.sheet`);
    if (!el) return;
    el.classList.remove(`shake`);
    void el.offsetWidth;
    el.classList.add(`shake`);
  }

  // ---- Refinery ----
  private refineryHTML(s: PlayerState): string {
    const cards = REFINE.map((rec, i) => {
      const have = oreHave(s, rec.from);
      const k = Math.floor(have / rec.n);
      return `<div class="card bz-recipe">
        <div class="bz-io">
          <span class="bz-in" style="--c:${hex(ITEM[rec.from].color)}">${oreIcon(rec.from)}<b>${ITEM[rec.from].name} ×${rec.n}</b></span>
          <span class="bz-arrow">→</span>
          <span class="bz-in" style="--c:${hex(ITEM[rec.to].color)}">${oreIcon(rec.to)}<b>${ITEM[rec.to].name} ×1</b></span>
        </div>
        <p class="bz-note">You have <b>${num(have)}</b> ${ITEM[rec.from].name.toLowerCase()} on chain: enough for <b>${num(k)}</b></p>
        <div class="bz-btns">
          <button data-bz="refine" data-i="${i}" data-n="1" ${k < 1 ? `disabled` : ``}>Smelt 1</button>
          <button data-bz="refine" data-i="${i}" data-n="all" ${k < 2 ? `disabled` : ``}>Smelt all${k > 1 ? ` (${num(k)})` : ``}</button>
        </div>
      </div>`;
    }).join(``);
    return `${oreStrip(s)}<div class="bz-row3">${cards}</div>
      <p class="soft">Smelting uses your ore on chain and happens on chain. Ore you mine is saved there when the trip ends. The Forge needs iron, gold and mythril.</p>`;
  }

  // ---- Forge ----
  private forgeHTML(s: PlayerState): string {
    if (this.forgeTab === `salvage`) return oreStrip(s) + this.salvageHTML(s);
    if (this.forgeTab === `reroll`) return oreStrip(s) + this.rerollHTML(s);
    if (this.forgeStep === `pick`) return oreStrip(s) + forgePickHTML(s);
    return oreStrip(s) + forgeMakeHTML(s, this.forgeSlot, this.forgeOre);
  }

  private salvageHTML(s: PlayerState): string {
    if (!s.items.length) return `<div class="empty small"><p>No spare gear to salvage. Worn gear stays safe.</p></div>`;
    const rows = s.items
      .map((it) => {
        const out = SALVAGE[it.tier] ?? SALVAGE[0];
        const gives = Object.entries(out)
          .map(([id, n]) => `<span class="bz-cost">${oreIcon(id)}${n}</span>`)
          .join(``);
        return `<div class="bz-gear">${gearTile(it)}
          <div class="info"><b style="color:${TIER_DARK[it.tier]}">${esc(it.name)}</b><span>${TIER_NAMES[it.tier]} ${SLOT_LABELS[GEAR_BY_ID[it.base].slot].toLowerCase()}</span></div>
          <div class="bz-costs">${gives}</div>
          <button data-bz="salvage" data-uid="${it.uid}">Salvage</button></div>`;
      })
      .join(``);
    return `<div class="bz-list">${rows}</div><p class="soft">Salvage breaks spare gear into ore, saved on chain at once (a forged NFT is burned on chain). Worn gear is not listed.</p>`;
  }

  private rerollHTML(s: PlayerState): string {
    const held = heldGear(s).filter((e) => e.item.stats.length > 1);
    if (!held.length) return `<div class="empty small"><p>No gear with enchants yet. Uncommon gear and better carry them.</p></div>`;
    const rows = held
      .map(({ item, worn }) => {
        const c = rerollCost(item);
        const ok = oreHave(s, c.ore) >= c.n && s.coins >= c.coins;
        return `<div class="bz-gear">${gearTile(item)}
          <div class="info"><b style="color:${TIER_DARK[item.tier]}">${esc(item.name)}${worn ? ` <em class="bz-worn">worn</em>` : ``}</b><ul class="bz-stats">${statList(item as GearItem)}</ul></div>
          <div class="bz-costs">${cost(c.ore, c.n, oreHave(s, c.ore))}${coinCost(c.coins, s.coins)}</div>
          <button data-bz="reroll" data-uid="${item.uid}" ${ok ? `` : `disabled`}>Reroll</button></div>`;
      })
      .join(``);
    return `<div class="bz-list">${rows}</div><p class="soft">A reroll keeps the first, built-in stat and rolls the enchants under it again.</p>`;
  }

  // ---- Requests Board ----
  private boardHTML(s: PlayerState): string {
    const live = GOALS.map((g, i) => ({ g, i })).filter((e) => !e.g.gone);
    const cur = s.goal.i;
    const done = live.filter((e) => e.i < cur);
    const next = live.filter((e) => e.i > cur);
    const now = GOALS[cur] && !GOALS[cur].gone ? GOALS[cur] : null;
    const reward = rewardHTML; // MINEAR: materials, dice, rarely coins (src/ui/goalReward.ts)
    let current = `<div class="card bz-job now"><b>Every request is done.</b><p>New jobs come with the next update.</p></div>`;
    if (now) {
      const need = now.need ?? now.depth ?? now.biomes ?? now.slain ?? 1;
      const c = now.depth !== undefined ? 0 : Math.min(need, s.goal.c);
      current = `<div class="card bz-job now"><span class="lbl">NOW</span><b>${esc(now.text)}</b>
        <div class="bz-bar"><i style="width:${(c / need) * 100}%"></i></div>
        <div class="bz-jfoot"><span>${need > 1 && now.depth === undefined ? `${c} / ${need}` : now.depth !== undefined ? `Reach ${now.depth} m` : ``}</span><span class="bz-rew">${reward(now.reward)}</span></div></div>`;
    }
    const upcoming = next
      .slice(0, 3)
      .map((e) => `<li><span>${esc(e.g.text)}</span><span class="bz-rew">${reward(e.g.reward)}</span></li>`)
      .join(``);
    const more = next.length > 3 ? `<li class="more">and ${next.length - 3} more…</li>` : ``;
    const past = done
      .slice(-4)
      .reverse()
      .map((e) => `<li class="done"><span>${esc(e.g.text)}</span></li>`)
      .join(``);
    return `<div class="bz-board">
      <div class="bz-col">${current}<p class="soft">Rewards pay out the moment a request is done: ore goes to the ore bin, gems to your cart (or the gem store when it is full).</p></div>
      <div class="bz-col"><h4>Next up</h4><ul class="bz-jobs">${upcoming || `<li class="more">Nothing more for now.</li>`}${more}</ul>
      <h4>Done <small>${done.length} of ${live.length}</small></h4><ul class="bz-jobs">${past || `<li class="more">None yet.</li>`}</ul></div></div>`;
  }

  // ---- Capsule Machine ----
  private capsuleHTML(s: PlayerState): string {
    const odds = CAPSULE_ODDS.map((o) => `<li><span>${o.kind}</span><b>${o.pct}%</b></li>`).join(``);
    return `<div class="bz-capsule">
      <div class="bz-col bz-machine">
        <div class="bz-globe">${GLOBE.map(([x, y], i) => `<i style="--k:${i};left:${x}px;top:${y}px"></i>`).join(``)}</div>
        <div class="bz-coins"><i class="bz-capcoin big"></i><b>${num(s.capsules)}</b><span>Capsule Coins</span></div>
        <button data-bz="spin" ${s.capsules < 1 ? `disabled` : ``}>Spin (1 coin)</button>
        <button class="ghostish" data-bz="buycoin" ${s.coins < CAPSULE_COIN_PRICE ? `disabled` : ``}>Buy a Capsule Coin · <i class="coin sm"></i>${CAPSULE_COIN_PRICE}</button>
      </div>
      <div class="bz-col">${this.prize ? `<span class="lbl">LAST SPIN</span>${prizeHTML(this.prize)}` : `<div class="empty small"><p>Spin to see what the capsule holds.</p></div>`}
        <h4>Odds</h4><ul class="bz-odds">${odds}</ul>
        <p class="soft">Deeper miners pull better ore and gems. Capsule Coins also come home with long expeditions.</p></div>
    </div>`;
  }

  // ---- locked or coming-soon site ----
  private siteHTML(): string {
    const d = SITE_BY_ID[this.site];
    const v = this.host.unlockView();
    const st = siteStatus(d, v);
    const [n, k] = d.unlock ? d.unlock.progress(v) : [1, 1];
    const head =
      st === `locked`
        ? `<span class="lbl">LOCKED</span><b>${esc(d.unlock?.text ?? ``)}</b>`
        : `<span class="lbl">UNLOCKED</span><b>Opening soon</b>`;
    const bar =
      st === `locked`
        ? `<div class="bz-bar"><i style="width:${(n / k) * 100}%"></i></div><div class="bz-jfoot"><span>${num(n)} / ${num(k)}</span></div>`
        : `<p>You have earned this spot. It is still being built and opens in a later update.</p>`;
    return `<div class="bz-site"><div class="card bz-job now">${head}${bar}</div>
      <p class="bz-plan">${esc(d.plan)}</p></div>`;
  }

  // ---- Finish mining trip confirm ----
  private homeHTML(): string {
    const top = this.host.atBase();
    return `<div class="bz-home">
      <p class="bz-lead">${top ? `Start a fresh mine?` : `Finish this mining trip now, with everything you carry?`}</p>
      <ul class="bz-points">
        ${top ? `` : `<li>You keep your whole cart. Nothing is dropped.</li>`}
        <li>The tunnels you dug fill back in.</li>
        <li>The gems move to new spots (still by depth: the rarest stay deep).</li>
        <li>You see what this trip found, then pick: upgrade at base, or continue mining.</li>
      </ul>
      <div class="bz-btns"><button data-bz="home">${top ? `Reset the mine` : `Finish trip`}</button><button class="ghostish" data-bz="close">Keep mining</button></div>
    </div>`;
  }

  // ---- the last mining trip ----
  private haulHTML(): string {
    const h = this.haul;
    if (!h) return `<div class="empty small"><p>Nothing to show.</p></div>`;
    // MINEAR: a trip gives materials only (no gear, no coins); tiles show the icon and the count, no name
    const tile = (id: string, n: number) => {
      const it = ITEM[id];
      const c = it.kind === `gem` ? RARITY_COLORS[it.rarity] : hex(it.color);
      return `<div class="bz-took" style="--c:${c}" title="${esc(it.name)}"><div class="itile" style="--tc:${c}">${gearIcons.lootHtml(id)}</div><b>×${num(n)}</b></div>`;
    };
    const tiles = [...h.gems, ...h.ores, ...h.other].map(([id, n]) => tile(id, n)).join(``);
    const stat = (k: string, v: string) => `<div class="bz-stat"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="bz-haul">
      <div class="bz-stats-row">
        ${stat(`Deepest`, `${num(h.deep)} m`)}${stat(`Damage dealt`, num(h.dmg))}${h.capsules ? stat(`Capsule bonus`, `+${h.capsules}`) : ``}
      </div>
      ${tiles ? `<div class="bz-tooks">${tiles}</div>` : `<div class="empty small"><p>This trip found nothing.</p></div>`}
      <p class="soft">The mine is fresh: the tunnels you dug filled back in, and the gems moved to new spots.</p>
      <button class="big" data-bz="close">Close</button>
    </div>`;
  }
}
