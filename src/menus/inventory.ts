// Port of play-inUT-NSi.js 61055-61706: the inventory / character sheet hP (div#inv in index.html). Three pages:
// gear, cart (page id `pack`) and skills (folder: minear-r3f/src/menus).
// MINEAR gear page (the layout and flow of the theras-rpg-template equipment screen, MINEAR's own look): the portrait in the
// middle and the equipment slots as big tiles around it (Head, Back, Pack at the left; Claws, Launcher at the
// right), each with a red mark when the Cart holds a better piece for it. Under it the accessory row (the two charm
// slots, then 5 locked ones) and the ability row (the belt, keys 1-4: the open slots of
// minear-r3f/src/state/belt.ts, the rest locked). A click on an equipment slot opens its list page (Back returns) with the wallet's spare
// gear for it. Beside it the status: 4 highlight stats, then the stat groups as an accordion (the open groups are
// kept in localStorage).
// MINEAR Cart page (was the gem bag): one grid of everything the miner carries (gems, ore, supplies, spare gear,
// dice, Dead Dust). minear-r3f/src/state/cart.ts says how many slots show open. Only the view is merged: the
// storage rules stay in minear-r3f/src/state/playerState.ts.
// The skills page is the skill tree (minear-r3f/src/menus/skillTree.ts), bought only at base.
// Mouse: hover shows a tooltip, a click equips / belts / opens a chooser, a right-click opens the action menu (a
// rare+ gem's Destroy asks "Sure?" first). Touch: a tap shows the tooltip with the action buttons in it.
// Also KR's glue for it: the hooks object of the KR constructor (70650-70663), as makeInventory.
import '../brand/inventory2.css';
import { IS_PHONE, IS_TOUCH } from '../game/device';
import { ITEMS, RARITY_COLORS, SUPPLY_IDS, type ItemDef, type Rarity } from '../world/items';
import { GEAR_BY_ID, GEAR_SLOTS, SLOT_LABELS, SLOT_TYPE, gearSellPrice, type GearItem, type GearSlot } from '../state/gear';
import { STATS, STAT_IDS, displayRound, stackStat, statLabel } from '../state/gearStats';
import { PERCENT_WORDS, STAT_GROUPS, canDraft, shortValue } from '../state/statCards';
import { TIER_COLORS, TIER_DARK, TIER_NAMES, gemExp } from '../state/progression';
import type { PlayerState } from '../state/playerState';
import { BELT_MAX, beltSlots } from '../state/belt';
import { CART_COLS, CART_ROWS, cartSlots } from '../state/cart';
import { TREE_BY_ID, buyNode } from '../state/skillTree';
import { SkillTreeView } from './skillTree';
import { blastDamage } from '../items/bombs';
import { destroyFromPack } from '../pickups/collect';
import { dropGear, dropSupply, type ChestHost } from '../chests/krChests';
import { gearIcons, gemTile, slotIcon, supplyTile } from './gearIcons';
import { closeInv, type InventoryPage, type InventoryPanel, type PanelHost } from './panels';
import { equip, onStatsChanged, type EconomyHost } from './economy';
import {
  ACCESSORY_MAX,
  ACCESSORY_SLOTS,
  ASK_RARITIES,
  CART_ART,
  DOLL_COLUMNS,
  HIGHLIGHT_STATS,
  LOCK_SVG,
  PLUS_SVG,
  SHEET_STATS,
  STAT_SHEET,
  cardArt,
  escapeText,
  formatCount,
  gemOrder,
  qs,
  skillText,
  statIcon,
} from './inventoryStats';
import { starsHTML } from '../ui/stars';

const ITEM = ITEMS as Record<string, ItemDef>;
const J = IS_TOUCH; // J

/** What the inventory asks the game to do (KR builds them at 70650). Each returns true when it happened. */
export interface InventoryHooks {
  /** Puts on bag gear uid (into slot, when given). */
  equip(uid: number, slot?: GearSlot): boolean;
  /** Takes off the gear in a slot. */
  unequip(slot: GearSlot): boolean;
  /** Destroys n gems of gem slot i (PlayerState.pack). */
  destroy(i: number, n: number): boolean;
  /** Drops gear uid (from slot, or the bag) on the ground in a satchel. */
  dropGear(uid: number, slot?: GearSlot): boolean;
  /** Drops n of supply id. */
  dropSupply(id: string, n: number): boolean;
  /** Puts supply id on the belt (in slot, when given). */
  belt(id: string, slot?: number): boolean;
  /** Clears belt slot i. */
  unbelt(i: number): boolean;
  /** MINEAR: true while the miner is at base (the skill tree can be bought only there). */
  atBase(): boolean;
  /** MINEAR: buys one level of skill tree node id (stats, sound, save); plays deny when it cannot. */
  /** Buys one skill-tree level with materials on chain (an on-chain burn). */
  buyNode(id: string): Promise<boolean>;
  /** MINEAR: a skill tree sound (deny, arm = first click on a node, pop = new node k revealed). */
  treeSound(kind: 'deny' | 'arm' | 'pop', k?: number): void;
  close(): void;
}

/** A menu / tooltip action: label, run (true = re-render), danger (red button), ask (a second click confirms). */
type Act = [label: string, run: () => unknown, danger?: boolean, ask?: boolean];

/** Where a pop-up goes: beside the left / right edge of an anchor, from its top (a point: left = right). */
type Box = { left: number; right: number; top: number };

/** What the tooltip is about (one field set). */
interface Hover {
  slot?: GearSlot;
  belt?: number;
  sup?: string;
  uid?: number;
  loot?: number;
  lock?: boolean;
  stat?: string;
  gperk?: string;
  skill?: string;
  /** A locked belt slot. */
  blk?: boolean;
  /** MINEAR: a locked accessory slot. */
  acc?: boolean;
  /** MINEAR: a loose gem (PlayerState.crystals) in the Cart. */
  loose?: string;
  /** MINEAR: an ore of the ore bin (PlayerState.ores) in the Cart. */
  ore?: string;
  /** MINEAR: the reroll dice or the Dead Dust in the Cart. */
  pocket?: string;
}

/** MINEAR: rarity rank (the Cart shows the rarest gems first). */
const RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
/** MINEAR: a spare piece is "better" for a slot past this gain (in typical rolls, see unitOf). */
const BETTER = 0.2;
/** MINEAR: the localStorage key of the open stat groups. */
const OPEN_KEY = `minear.inv.statGroups`;
/** MINEAR: the name (and accordion key) of the gear perk group. */
const PERKS = `Gear perks`;
/** Touch: what a tap shows a tooltip for. */
const TAP = [
  `.gearpage .eqslot`,
  `.gearpage .acclock`,
  `.gearpage .abslot`,
  `.gearpage .hstat`,
  `.statlist [data-stat]`,
  `.statlist [data-gperk]`,
  ...[`i`, `loose`, `ore`, `sup`, `uid`, `pocket`, `lock`].map((e) => `.cart-grid .itile[data-${e}]`),
  `.skillspage [data-skill]`,
].join(`, `);

const hex = (n: number): string => `#${n.toString(16).padStart(6, `0`)}`;
const upper = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** MINEAR has no drill: claw gear (internal slot `drill`, model G_DrillBit) shows the mole-claw drawing, as in
 * minear-r3f/src/base/forgeView.ts iconOf. */
const iconOf = (it: GearItem): string => gearIcons.html(it); // Claws-slot kinds draw in minear-r3f/src/menus/toolIcons.ts

/** A gear tile (gearTile with the claw drawing for claws); attrs is extra HTML attribute text. */
const gearTileOf = (it: GearItem, attrs = ``): string =>
  `<div class="itile t${it.tier}${it.fresh ? ` fresh` : ``}" style="--tc:${TIER_COLORS[it.tier]}" ${attrs}>${iconOf(it)}${starsHTML(it.tier, `tile`)}</div>`;

/** A typical roll of a stat (its tier 2 value), so stats of different scales weigh alike when gear is compared. */
const unitOf = (id: string): number => {
  const p = STATS[id]?.per ?? [];
  return p[2] || p[4] || p[1] || 1;
};

/** The stats a swap touches: the new piece's and the worn piece's. */
const swapStats = (it: GearItem, worn: GearItem | null): Set<string> =>
  new Set([...it.stats.map((e) => e[0]), ...(worn?.stats.map((e) => e[0]) ?? [])]);

/** The open stat groups saved in localStorage (Mining alone when none are saved or storage is blocked). */
function loadOpen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? `null`);
    if (Array.isArray(v)) return new Set(v.filter((e): e is string => typeof e == `string`));
  } catch {
    // storage blocked or bad data: the default below
  }
  return new Set([STAT_SHEET[0].name]);
}

function saveOpen(open: Set<string>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // storage blocked: the groups stay open for this visit only
  }
}

/** What an element of the sheet is about, from its data attributes (null: nothing). */
function hoverOf(n: HTMLElement): Hover | null {
  const d = n.dataset;
  return d.skill
    ? { skill: d.skill }
    : d.gperk
      ? { gperk: d.gperk }
      : d.stat
        ? { stat: d.stat }
        : d.slot
          ? { slot: d.slot as GearSlot }
          : d.acclock !== void 0
            ? { acc: !0 }
            : d.blk !== void 0
              ? { blk: !0 }
              : d.b !== void 0
                ? { belt: +d.b }
                : d.sup
                  ? { sup: d.sup }
                  : d.uid
                    ? { uid: +d.uid }
                    : d.i !== void 0
                      ? { loot: +d.i }
                      : d.loose
                        ? { loose: d.loose }
                        : d.ore
                          ? { ore: d.ore }
                          : d.pocket
                            ? { pocket: d.pocket }
                            : d.lock
                              ? { lock: !0 }
                              : null;
}

export class Inventory implements InventoryPanel { // hP (61055)
  hooks: InventoryHooks;
  el = document.getElementById(`inv`)!;
  open = !1;
  page: InventoryPage = `gear`;
  sheet = qs(this.el, `.sheet`);
  tip = qs(this.el, `.tip`);
  ctx = qs(this.el, `.ctx`);
  state!: PlayerState;
  hover: Hover | null = null;
  /** The miner portrait on the gear page (KR.renderPortrait draws it, src/menus/portrait.ts). */
  portrait = document.createElement(`canvas`);
  ctxI = -1;
  tipX = 0;
  tipY = 0;
  /** While true, refresh() does not redraw (a skill tree buy redraws only the tree). */
  quiet = !1;
  /** MINEAR: the slot list page open on the gear page (a gear slot or a belt slot), or null. */
  slotView: { kind: 'gear'; slot: GearSlot } | { kind: 'belt'; b: number } | null = null;
  /** MINEAR: the box of the slot list page (in the gear page, in place of the doll while open). */
  slotBox = document.createElement(`div`);
  /** MINEAR: the open stat groups of the status accordion. */
  statOpen = loadOpen();
  /** MINEAR: the element (selector) that pops after the next render (a piece just put on, a supply just belted). */
  pop: string | null = null;
  /** MINEAR: the skill tree on the skills page. */
  tree = new SkillTreeView({
    atBase: () => this.hooks.atBase(),
    buy: (id) => this.buyTree(id),
    sound: (kind, k) => this.hooks.treeSound(kind, k),
  });

  constructor(e: InventoryHooks) {
    this.hooks = e;
    qs(this.el, `.portrait`).prepend(this.portrait);
    qs(this.el, `.cart-art`).innerHTML = CART_ART;
    this.slotBox.className = `slotview`;
    qs(this.el, `.gearpage`).insertBefore(this.slotBox, qs(this.el, `.gearpage .status`));
    qs(this.el, `.close`).addEventListener(`click`, () => this.hooks.close());
    window.addEventListener(`resize`, () => this.open && this.fit());
    this.el.addEventListener(`mousedown`, (e) => {
      (this.ctx.contains(e.target as Node) || this.hideCtx(), e.target === this.el && this.hooks.close());
    });
    this.el.addEventListener(`contextmenu`, (e) => e.preventDefault());
    this.el.addEventListener(`mousemove`, (e) => this.moveTip(e.clientX, e.clientY));
    this.el
      .querySelectorAll<HTMLElement>(`.tabs [data-page]`)
      .forEach((e) => e.addEventListener(`click`, () => this.setPage(e.dataset.page as InventoryPage)));
    J && this.el.addEventListener(`click`, (e) => this.tapped(e), !0);
  }

  show(e: PlayerState, t?: InventoryPage): void {
    this.state = e;
    this.open = !0;
    t && (this.page = t);
    this.tree.recenter();
    this.el.classList.remove(`hidden`);
    this.sheet.classList.remove(`enter`);
    void this.sheet.offsetWidth;
    this.sheet.classList.add(`enter`);
    this.render();
  }

  hide(): void {
    if (this.open) {
      this.open = !1;
      this.slotView = null;
      this.el.classList.add(`hidden`);
      this.hideTip();
      this.hideCtx();
      this.tree.stop();
      for (const e of this.state.items) e.fresh = !1;
    }
  }

  setPage(e: InventoryPage): void {
    this.page !== e && ((this.page = e), (this.slotView = null), e === `skills` && this.tree.recenter(), this.hideTip(), this.hideCtx(), this.render());
  }

  refresh(): void {
    this.open && !this.quiet && this.render();
  }

  /** The header counters (coins, dice, gems). */
  renderRes(): void {
    const e = this.state;
    qs(this.el, `[data-coins]`).textContent = e.coins.toLocaleString();
    qs(this.el, `[data-dice]`).textContent = String(e.dice);
    qs(this.el, `[data-crystals]`).textContent = String(e.stashCount() + e.gemCount());
  }

  /** MINEAR: buys one level of a skill tree node. The stat refresh skips the full redraw; the tree redraws itself. */
  async buyTree(id: string): Promise<boolean> {
    let ok = !1;
    this.quiet = !0;
    try {
      ok = await this.hooks.buyNode(id);
    } finally {
      this.quiet = !1;
    }
    ok && this.renderRes();
    return ok;
  }

  render(): void {
    const e = this.state;
    this.sheet.dataset.page = this.page;
    this.el
      .querySelectorAll<HTMLElement>(`.tabs [data-page]`)
      .forEach((e) => e.classList.toggle(`on`, e.dataset.page === this.page));
    this.renderRes();
    const t = e.items.filter((e) => e.fresh).length;
    qs(this.el, `[data-newgear]`).textContent = t ? String(t) : ``;
    // the Cart tab badge: the gem slots in use (gems are the only part of the Cart with a limit)
    const n = qs(this.el, `[data-packbadge]`);
    n.textContent = `${e.used}/${e.capacity}`;
    n.classList.toggle(`full`, e.packFull);
    this.renderGear();
    this.renderStatus();
    this.renderPack();
    this.renderSkills();
    this.fit();
    this.pop && (this.el.querySelector(this.pop)?.classList.add(`pop`), (this.pop = null));
    this.hover && this.showTip();
  }

  /** Scales the sheet down to fit the window (24 px margin, none on a phone). */
  fit(): void {
    const e = this.sheet,
      t = IS_PHONE ? 0 : 24, // kT
      n = Math.min(1, (innerHeight - t) / e.offsetHeight, (innerWidth - t) / e.offsetWidth);
    e.style.scale = n < 0.999 ? n.toFixed(3) : ``;
  }

  // ---- gear page: equipment, accessories, ability -------------------------------------------------------------

  renderGear(): void {
    const e = this.state;
    qs(this.el, `[data-power]`).textContent = e.power.toLocaleString();
    qs(this.el, `[data-lvl]`).textContent = String(e.level);
    const better = this.betterSlots();
    for (const t of [`l`, `r`] as const)
      qs(this.el, `.eqcol.${t}`).innerHTML = DOLL_COLUMNS[t].map((t) => this.slotHtml(t, `big`, better.has(t))).join(``);
    qs(this.el, `[data-acccount]`).textContent = `${ACCESSORY_SLOTS.filter((t) => e.gear[t]).length}/${ACCESSORY_MAX}`;
    qs(this.el, `.accrow`).innerHTML =
      ACCESSORY_SLOTS.map((t) => this.slotHtml(t, `acc`, better.has(t))).join(``) +
      `<div class="acclock" data-acclock="1"><div class="itile locked">${LOCK_SVG}</div></div>`.repeat(
        Math.max(0, ACCESSORY_MAX - ACCESSORY_SLOTS.length),
      );
    this.el.querySelectorAll<HTMLElement>(`.gearpage .eqslot`).forEach((e) => {
      const t = e.dataset.slot as GearSlot;
      e.addEventListener(`click`, () => this.gearChooser(t, e.getBoundingClientRect()));
      e.addEventListener(`contextmenu`, (e) => {
        e.preventDefault();
        const n = this.state.gear[t];
        n &&
          this.menu(e.clientX, e.clientY, n.name, TIER_COLORS[n.tier], [
            [`Take it off`, () => this.hooks.unequip(t)],
            [`Drop it here`, () => this.hooks.dropGear(n.uid, t), !0],
          ]);
      });
      this.hoverable(e, { slot: t });
    });
    this.el.querySelectorAll<HTMLElement>(`.gearpage .acclock`).forEach((e) => this.hoverable(e, { acc: !0 }));
    this.renderAbility();
    this.renderSlotView();
  }

  /** An equipment slot: a big tile (or a small accessory tile) with its name, the worn piece's tier as the frame,
   * and the red mark when the Cart holds a better piece for it. */
  slotHtml(t: GearSlot, size: 'big' | 'acc', better: boolean): string {
    const n = this.state.gear[t],
      r = SLOT_TYPE[t];
    return `<div class="eqslot ${size}${better ? ` better` : ``}" data-slot="${t}">${
      n ? gearTileOf(n) : `<div class="itile empty">${size === `acc` ? PLUS_SVG : slotIcon(r)}</div>`
    }${better ? `<i class="mark"></i>` : ``}${size === `big` ? `<span class="cap">${SLOT_LABELS[r]}</span>` : ``}</div>`;
  }

  /** The ability row: the belt slots (keys 1-4); the slots past beltSlots are locked. A click on a filled slot
   * takes the supply off the belt, on an empty one it opens the supply chooser. */
  renderAbility(): void {
    const e = this.state,
      t = qs(this.el, `.abrow`),
      open = beltSlots(e);
    t.innerHTML = Array.from({ length: BELT_MAX }, (_t, n) => {
      if (n >= open)
        return `<div class="abslot lockd" data-blk="${n}"><kbd>${n + 1}</kbd><div class="itile locked">${LOCK_SVG}</div><span class="cap">Locked</span></div>`;
      const r = e.belt[n];
      return `<div class="abslot" data-b="${n}"><kbd>${n + 1}</kbd>${
        r ? supplyTile(r, e.supplies[r] ?? 0) : `<div class="itile empty">${PLUS_SVG}</div>`
      }<span class="cap">${r ? escapeText(ITEM[r].name) : `Empty`}</span></div>`;
    }).join(``);
    t.querySelectorAll<HTMLElement>(`.abslot[data-blk]`).forEach((e) => this.hoverable(e, { blk: !0 }));
    t.querySelectorAll<HTMLElement>(`.abslot[data-b]`).forEach((e) => {
      const t = +e.dataset.b!;
      e.addEventListener(`click`, () => {
        this.state.belt[t]
          ? this.hooks.unbelt(t) && (this.hideTip(), this.render())
          : this.beltChooser(t, e.getBoundingClientRect());
      });
      e.addEventListener(`contextmenu`, (n) => {
        n.preventDefault();
        const r = this.state.belt[t];
        if (!r) return this.beltChooser(t, e.getBoundingClientRect());
        const i: Act[] = [[`Take it off the belt`, () => this.hooks.unbelt(t)]];
        this.supplyIds().some((e) => e !== r) &&
          i.unshift([`Swap it`, () => (this.beltChooser(t, e.getBoundingClientRect()), !1)]);
        this.menu(n.clientX, n.clientY, `Belt ${t + 1}: ${ITEM[r].name}`, `#ff9a7a`, i);
      });
      this.hoverable(e, { belt: t });
    });
  }

  /** The supplies the miner has (count above 0), in the shop order. */
  supplyIds(): string[] {
    const e = this.state.supplies,
      t = (e: string) => {
        const t = SUPPLY_IDS.indexOf(e as never);
        return t < 0 ? 99 : t;
      };
    return Object.keys(e)
      .filter((t) => (e[t] ?? 0) > 0 && ITEM[t])
      .sort((e, n) => t(e) - t(n));
  }

  /** How much better (above 0) or worse the miner gets with spare piece it in slot t: the change of every stat the
   * swap touches (PlayerState.statWith, as the tooltip compare), in typical rolls of that stat, summed. */
  gain(it: GearItem, t: GearSlot): number {
    const e = this.state;
    let n = 0;
    for (const r of swapStats(it, e.gear[t])) n += (e.statWith(r, t, it) - e.stat(r)) / unitOf(r);
    return n;
  }

  /** The Cart's spare pieces that fit slot t, best first, with their gain. */
  spareFor(t: GearSlot): { it: GearItem; g: number }[] {
    const e = SLOT_TYPE[t];
    return this.state.items
      .filter((t) => GEAR_BY_ID[t.base]?.slot === e)
      .map((e) => ({ it: e, g: this.gain(e, t) }))
      .sort((e, t) => t.g - e.g);
  }

  /** The slots the Cart holds a better piece for (the red marks). */
  betterSlots(): Set<GearSlot> {
    const e = new Set<GearSlot>();
    for (const t of this.state.items) {
      const n = GEAR_BY_ID[t.base]?.slot;
      for (const r of GEAR_SLOTS) SLOT_TYPE[r] === n && !e.has(r) && this.gain(t, r) > BETTER && e.add(r);
    }
    return e;
  }

  /** The stat changes of putting it into slot t (the biggest 3), as short lines. */
  deltaHtml(it: GearItem, t: GearSlot): string {
    const e = this.state,
      n: [string, number][] = [];
    for (const r of swapStats(it, e.gear[t])) {
      const i = e.statWith(r, t, it) - e.stat(r);
      Math.abs(i) < 1e-6 || n.push([r, i]);
    }
    n.sort((e, t) => Math.abs(t[1]) / unitOf(t[0]) - Math.abs(e[1]) / unitOf(e[0]));
    return `<span class="chd">${
      n.length
        ? n
            .slice(0, 3)
            .map(([e, t]) => `<i class="${t > 0 ? `inc` : `dec`}">${statLabel(e, Math.abs(t)).replace(`+`, t > 0 ? `+` : `−`)}</i>`)
            .join(``) + (n.length > 3 ? `<i>${n.length - 3} more</i>` : ``)
        : `<i>No change</i>`
    }</span>`;
  }

  /** A chooser's HTML: the title, the rows (acts 0..rows-1), a note, then a button for each act after the rows. */
  chooserHtml(title: string, color: string, rows: string, note: string, acts: Act[], first: number): string {
    return `<b style="color:${color}">${escapeText(title)}</b>${rows ? `<div class="chrows">${rows}</div>` : ``}${
      note ? `<p class="chnote">${note}</p>` : ``
    }${acts
      .slice(first)
      .map(([e, , t], n) => `<button type="button" data-k="${first + n}" class="${t ? `danger` : ``}">${e}</button>`)
      .join(``)}`;
  }

  /** MINEAR (user, 2026-11-14): a click on an equipment or accessory slot opens that slot's list page (the worn
   * piece, then every spare piece in the wallet, best first) in place of the gear doll, with a Back button. */
  gearChooser(t: GearSlot, _r?: Box): void {
    this.hideTip();
    this.hideCtx();
    this.slotView = { kind: `gear`, slot: t };
    this.render();
  }

  /** The same list page for belt slot t: the supplies to put in it. */
  beltChooser(t: number, _r?: Box): void {
    this.hideTip();
    this.hideCtx();
    this.slotView = { kind: `belt`, b: t };
    this.render();
  }

  /** The slot list page title. */
  slotTitle(t: GearSlot): string {
    const i = ACCESSORY_SLOTS.indexOf(t as never);
    return i >= 0 ? `Accessory ${i + 1}` : SLOT_LABELS[SLOT_TYPE[t]];
  }

  /** Draws the slot list page (or hides it) and wires its buttons. */
  renderSlotView(): void {
    const v = this.slotView;
    const box = this.slotBox;
    if (!v || this.page !== `gear`) {
      delete this.sheet.dataset.slotview;
      box.innerHTML = ``;
      return;
    }
    this.sheet.dataset.slotview = v.kind;
    const e = this.state;
    const acts: (() => boolean)[] = [];
    const btn = (label: string, fn: () => boolean, cls = ``) => {
      acts.push(fn);
      return `<button type="button" class="sv-btn ${cls}" data-sv="${acts.length - 1}">${label}</button>`;
    };
    let html = ``;
    if (v.kind === `gear`) {
      // like the theras-rpg-template list (user, 2026-11-14): a plain card per piece; the rarity colour only on the item
      // box; the stars (rarity colour, the rest empty) right after the name and no rarity word; the worn piece
      // first as a green "Equipped" row; "Best" on the best spare when it beats the worn one
      const t = v.slot;
      const worn = e.gear[t];
      const spare = this.spareFor(t);
      const name = (it: GearItem) =>
        `<b class="sv-title" style="--tc:${TIER_COLORS[it.tier]}"><span>${escapeText(it.name)}</span> ${starsHTML(it.tier)}</b>`;
      const wornHtml = worn
        ? `<div class="sv-row equipped">${gearTileOf(worn)}<div class="sv-nm">${name(worn)}<span class="sv-st">${worn.stats
            .map(([id, n]) => statLabel(id, n))
            .join(`, `)}</span></div><em class="sv-tag eq">Equipped</em><div class="sv-acts">${btn(`Take it off`, () =>
            this.hooks.unequip(t),
          )}${btn(`Drop it here`, () => this.hooks.dropGear(worn.uid, t), `danger`)}</div></div>`
        : ``;
      const rows = spare
        .map(({ it, g }, i) => {
          const put = btn(
            worn ? `Swap` : `Put on`,
            () => ((this.pop = `.eqslot[data-slot="${t}"] .itile`), this.hooks.equip(it.uid, t)),
            `go`,
          );
          return `<div class="sv-row">${gearTileOf(it)}<div class="sv-nm">${name(it)}${this.deltaHtml(it, t)}</div>${
            i === 0 && g > BETTER ? `<em class="sv-tag best">Best</em>` : ``
          }${put}</div>`;
        })
        .join(``);
      const count = spare.length + (worn ? 1 : 0);
      html = `<div class="sv-head">${btn(`◀ Back`, () => ((this.slotView = null), !0), `back`)}<b>${escapeText(this.slotTitle(t))} (${count})</b></div>
        <div class="sv-list">${wornHtml}${rows}${
          rows ? `` : `<p class="sv-empty">${worn ? `No other piece for this slot in your wallet.` : `Nothing for this slot yet.`} The Forge, treasure chests and the Trading Post have more.</p>`
        }</div>`;
    } else {
      const t = v.b;
      const cur = e.belt[t];
      const onBelt = e.belt.slice(0, beltSlots(e));
      const ids = this.supplyIds().filter((id) => id !== cur);
      const wornHtml = cur
        ? `<div class="sv-worn" style="--tc:#ff7a5c">${supplyTile(cur, e.supplies[cur] ?? 0)}<div class="sv-nm"><b>${escapeText(ITEM[cur].name)}</b><small>On key ${t + 1}</small></div><div class="sv-acts">${btn(
            `Take it off the belt`,
            () => this.hooks.unbelt(t),
          )}</div></div>`
        : `<div class="sv-worn none">This belt slot is empty.</div>`;
      const rows = ids
        .map((id) => {
          const k = onBelt.indexOf(id);
          const put = btn(`Put it here`, () => ((this.pop = `.abslot[data-b="${t}"] .itile`), this.hooks.belt(id, t)), `go`);
          return `<div class="sv-row" style="--tc:#ff7a5c">${supplyTile(id, e.supplies[id] ?? 0)}<div class="sv-nm"><b>${escapeText(ITEM[id].name)} × ${
            e.supplies[id] ?? 0
          }</b><small>${k >= 0 ? `On key ${k + 1} now` : `In your cart`}</small></div>${put}</div>`;
        })
        .join(``);
      html = `<div class="sv-head">${btn(`◀ Back`, () => ((this.slotView = null), !0), `back`)}<b>Belt ${t + 1}</b><small>key ${t + 1}</small></div>
        <span class="lbl">ON THE BELT</span>${wornHtml}
        <span class="lbl">SUPPLIES</span>
        <div class="sv-list">${rows || `<p class="sv-empty">No other supplies. The Trading Post sells bombs, tonics and more.</p>`}</div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll<HTMLElement>(`[data-sv]`).forEach((b) =>
      b.addEventListener(`click`, (ev) => {
        ev.stopPropagation();
        const fn = acts[+b.dataset.sv!];
        const back = b.classList.contains(`back`);
        if (fn() || back) {
          this.slotView = null; // after an action the gear page shows the result
          this.render();
        }
      }),
    );
  }

  // ---- gear page: status ----------------------------------------------------------------------------------------

  /** The status: 4 highlight stats, then the stat groups (and the gear perks) as an accordion. */
  renderStatus(): void {
    const e = this.state,
      t = STAT_SHEET.flatMap((e) => e.rows),
      n = qs(this.el, `.hstats`);
    n.innerHTML = HIGHLIGHT_STATS.map((n) => {
      const r = t.find((e) => e.stat === n)!;
      return `<div class="hstat${e.stat(n) > 0 ? ` boost` : ``}" data-stat="${n}">${statIcon(n)}<b>${r.get(e)}</b><span>${r.label}</span></div>`;
    }).join(``);
    const r = (e: string, t: string, n: string, r: string): string => {
      const i = this.statOpen.has(e);
      return `<div class="sacc${i ? ` open` : ``}" data-g="${e}"><button type="button" class="sahead" aria-expanded="${i}">${statIcon(t)}<b>${e}</b><span class="sasum">${n}</span><i class="chev"></i></button><div class="sabody"><div>${r}</div></div></div>`;
    };
    const i = STAT_IDS.filter((t) => !SHEET_STATS.has(t) && e.gearPoints(t) > 0),
      a = qs(this.el, `.statlist`);
    a.innerHTML =
      STAT_SHEET.map((t) =>
        r(
          t.name,
          t.icon,
          t.rows
            .filter((e) => !HIGHLIGHT_STATS.includes(e.stat))
            .slice(0, 2)
            .map((t) => `${t.short} <b>${t.get(e)}</b>`)
            .join(` · `),
          t.rows
            .map(
              (t) =>
                `<div class="srow2${e.stat(t.stat) > 0 ? ` boost` : ``}" data-stat="${t.stat}"><span>${t.label}</span><b>${t.get(e)}</b></div>`,
            )
            .join(``),
        ),
      ).join(``) +
      (i.length
        ? r(
            PERKS,
            `blast`,
            `${i.length} from your gear`,
            i
              .map((t) => {
                const n = e.gearPoints(t),
                  r = PERCENT_WORDS[t];
                return `<div class="srow2 gperk" data-gperk="${t}"><span>${STATS[t].name}</span><b>${shortValue(t, n)}${r ? `<small>${r}</small>` : ``}</b></div>`;
              })
              .join(``),
          )
        : ``);
    a.querySelectorAll<HTMLElement>(`.sacc`).forEach((e) =>
      qs(e, `.sahead`).addEventListener(`click`, () => this.toggleGroup(e)),
    );
    [n, a].forEach((e) => e.querySelectorAll<HTMLElement>(`[data-stat]`).forEach((e) => this.hoverable(e, { stat: e.dataset.stat })));
    a.querySelectorAll<HTMLElement>(`[data-gperk]`).forEach((e) => this.hoverable(e, { gperk: e.dataset.gperk }));
  }

  /** Opens or closes a stat group (and keeps the open groups in localStorage). */
  toggleGroup(e: HTMLElement): void {
    const t = e.dataset.g!,
      n = !this.statOpen.has(t);
    n ? this.statOpen.add(t) : this.statOpen.delete(t);
    e.classList.toggle(`open`, n);
    e.querySelector(`.sahead`)?.setAttribute(`aria-expanded`, String(n));
    saveOpen(this.statOpen);
    this.hideTip();
    e.querySelector(`.sabody`)?.addEventListener(`transitionend`, () => this.fit(), { once: !0 });
    this.fit();
  }

  /** MINEAR: the skills page is the skill tree (minear-r3f/src/menus/skillTree.ts). */
  renderSkills(): void {
    this.tree.render(qs(this.el, `.skillspage`), this.state);
  }

  // ---- Cart page ------------------------------------------------------------------------------------------------

  /** The Cart: one grid of everything carried, in this order: gems (gem slots and loose gems, rarest first), ore
   * stacks in the gem slots (old saves), the ore bin (one tile per ore), supplies (one tile per kind), then the
   * reroll dice and the Dead Dust. Equipment is not in the Cart (the user, 2026-11-13): spare gear is chosen
   * from the Gear page's slots. The first cartSlots(s) tiles are open, the rest locked. */
  renderPack(): void {
    const e = this.state;
    e.pack.sort((e, t) => {
      const n = ITEM[e.id].kind === `gem`;
      return n === (ITEM[t.id].kind === `gem`)
        ? n
          ? gemOrder(t.id) - gemOrder(e.id)
          : ITEM[t.id].value - ITEM[e.id].value || t.n - e.n
        : n
          ? -1
          : 1;
    });
    const t = e.capacity,
      open = cartSlots(e),
      gems: { i?: number; id: string; n: number }[] = [],
      cells: string[] = [],
      rest: string[] = [];
    e.pack.forEach((n, r) => (ITEM[n.id].kind === `gem` ? gems.push({ i: r, id: n.id, n: n.n }) : rest.push(gemTile(n, r, r >= t))));
    for (const t in e.crystals) e.crystals[t] > 0 && ITEM[t] && gems.push({ id: t, n: e.crystals[t] });
    gems.sort(
      (e, t) =>
        RANK[ITEM[t.id].rarity] - RANK[ITEM[e.id].rarity] ||
        gemOrder(t.id) - gemOrder(e.id) ||
        +(e.i === void 0) - +(t.i === void 0),
    );
    for (const n of gems)
      cells.push(
        n.i === void 0
          ? `<div class="itile loot crystal loose r-${ITEM[n.id].rarity}" data-loose="${n.id}" style="--tc:${RARITY_COLORS[ITEM[n.id].rarity]}">${gearIcons.lootHtml(n.id)}${n.n > 1 ? `<b class="qty">${n.n}</b>` : ``}</div>`
          : gemTile(n, n.i, n.i >= t),
      );
    cells.push(...rest);
    const ores = Object.keys(e.ores)
      .filter((t) => (e.ores[t] ?? 0) > 0 && ITEM[t])
      .sort((e, t) => ITEM[t].value - ITEM[e].value);
    for (const t of ores)
      cells.push(
        `<div class="itile loot ore" data-ore="${t}" style="--tc:${hex(ITEM[t].color)}">${gearIcons.lootHtml(t)}<b class="qty">${formatCount(e.ores[t])}</b></div>`,
      );
    const belt = e.belt.slice(0, beltSlots(e)),
      sups = this.supplyIds();
    for (const t of sups) {
      const n = belt.indexOf(t);
      cells.push(
        supplyTile(t, e.supplies[t] ?? 0, `data-sup="${t}"`).replace(
          /<\/div>$/,
          n >= 0 ? `<kbd class="onbelt">${n + 1}</kbd></div>` : `</div>`,
        ),
      );
    }
    // equipment is not cart goods: spare gear lives in its own gear bag (the Gear page's slot chooser)
    e.dice > 0 &&
      cells.push(
        `<div class="itile loot pocket" data-pocket="die" style="--tc:#fff1d6">${gearIcons.lootHtml(`die`)}${e.dice > 1 ? `<b class="qty">${e.dice}</b>` : ``}</div>`,
      );
    e.dust > 0 &&
      cells.push(
        `<div class="itile loot pocket" data-pocket="deaddust" style="--tc:${RARITY_COLORS.legendary}">${gearIcons.lootHtml(`deaddust`)}${e.dust > 1 ? `<b class="qty">${e.dust}</b>` : ``}</div>`,
      );
    // the grid: 6 x 5 at least, wider (8, then 10 columns) and taller when more must show; one locked tile at least
    const need = Math.max(cells.length, open),
      cols = need <= CART_COLS * CART_ROWS ? CART_COLS : need <= 40 ? 8 : 10,
      total = Math.max(CART_ROWS, Math.ceil((need + 1) / cols)) * cols;
    let html = ``;
    for (let n = 0; n < total; n++)
      html +=
        cells[n] ?? (n < open ? `<div class="itile none"></div>` : `<div class="itile locked" data-lock="1">${LOCK_SVG}</div>`);
    const grid = qs(this.el, `.cart-grid`);
    grid.style.setProperty(`--cols`, String(cols));
    grid.innerHTML = html;
    // the header: slots in use, the worth of the gems, what kinds the cart holds
    qs(this.el, `[data-used]`).textContent = `${cells.length} / ${open}`;
    qs(this.el, `.cart-head`).classList.toggle(`full`, e.packFull);
    // every gem the cart shows: the gem-slot stacks and the loose gems
    const loose = Object.entries(e.crystals).filter(([, k]) => k > 0);
    const n = e.gemCount() + loose.reduce((a, [, k]) => a + k, 0);
    const worth = e.packWorth() + loose.reduce((a, [id, k]) => a + k * e.crystalPrice(id), 0);
    qs(this.el, `.pworth`).innerHTML = n
      ? `<b class="cry">${n}</b> gem${n > 1 ? `s` : ``} · worth <b><i class="coin sm"></i>${formatCount(worth)}</b>`
      : `No gems yet`;
    const sum = (e: Record<string, number>, t: string[]) => t.reduce((t, n) => t + (e[n] ?? 0), 0);
    qs(this.el, `.cart-kinds`).innerHTML = (
      [
        [`Gems`, `${e.used}/${t}`, `#8446d6`, e.packFull],
        [`Ore`, formatCount(sum(e.ores, ores)), `#ff8a4a`, !1],
        [`Supplies`, String(sum(e.supplies, sups)), `#ff7a5c`, !1],
      ] as const
    )
      .map(([e, t, n, r]) => `<span class="${r ? `full` : ``}" style="--tc:${n}"><i></i>${e} <b>${t}</b></span>`)
      .join(``);
    qs(this.el, `.cart-hint`).textContent = J
      ? `Tap a tile to see it and what you can do with it.`
      : `Click a supply to put it on your belt. Right-click a tile for more. Gear is on the Gear page.`;
    grid.querySelectorAll<HTMLElement>(`.itile[data-lock], .itile[data-loose], .itile[data-ore], .itile[data-pocket]`).forEach((e) => {
      const t = hoverOf(e);
      t && this.hoverable(e, t);
    });
    grid.querySelectorAll<HTMLElement>(`.itile[data-i]`).forEach((e) => {
      const t = +e.dataset.i!;
      e.addEventListener(`contextmenu`, (e) => {
        (e.preventDefault(), this.openCtx(t, e.clientX, e.clientY));
      });
      e.addEventListener(`click`, (e) => this.openCtx(t, e.clientX, e.clientY));
      this.hoverable(e, { loot: t });
    });
    grid.querySelectorAll<HTMLElement>(`.itile[data-sup]`).forEach((e) => {
      const t = e.dataset.sup!;
      e.addEventListener(`click`, () => {
        this.hooks.belt(t) && ((this.pop = `.cart-grid .itile[data-sup="${t}"]`), this.hideTip(), this.render());
      });
      e.addEventListener(`contextmenu`, (e) => {
        e.preventDefault();
        const n = this.state.supplies[t] ?? 0,
          r: Act[] = [];
        this.state.belt.slice(0, beltSlots(this.state)).includes(t) || r.push([`Put it on the belt`, () => this.hooks.belt(t)]);
        n > 0 && r.push([n > 1 ? `Drop one` : `Drop it`, () => this.hooks.dropSupply(t, 1), !0]);
        n > 1 && r.push([`Drop all ${n}`, () => this.hooks.dropSupply(t, n), !0]);
        r.length && this.menu(e.clientX, e.clientY, `${ITEM[t].name} × ${n}`, `#ff9a7a`, r);
      });
      this.hoverable(e, { sup: t });
    });
    grid.querySelectorAll<HTMLElement>(`.itile[data-uid]`).forEach((e) => {
      const t = +e.dataset.uid!;
      e.addEventListener(`click`, () => {
        this.hooks.equip(t) && (this.hideTip(), this.render());
      });
      e.addEventListener(`contextmenu`, (e) => {
        e.preventDefault();
        const n = this.state.items.find((e) => e.uid === t);
        n &&
          this.menu(e.clientX, e.clientY, n.name, TIER_COLORS[n.tier], [
            [`Put it on`, () => this.hooks.equip(t)],
            [`Drop it here`, () => this.hooks.dropGear(t), !0],
          ]);
      });
      this.hoverable(e, { uid: t });
    });
  }

  openCtx(e: number, t: number, n: number): void {
    const r = this.state.pack[e];
    if (!r) return;
    const i = ITEM[r.id];
    this.menu(t, n, `${i.name}${r.n > 1 ? ` × ${r.n}` : ``}`, RARITY_COLORS[i.rarity], this.destroyActs(e));
    this.ctxI = e;
  }

  /** The right-click menu at (x, y): a title in color, then one button per action. */
  menu(e: number, t: number, n: string, r: string, i: Act[]): void {
    this.popup(
      `<b style="color:${r}">${escapeText(n)}</b>${i.map(([e, , t], n) => `<button type="button" data-k="${n}" class="${t ? `danger` : ``}">${e}</button>`).join(``)}`,
      i,
      { left: e, right: e, top: t + 4 },
    );
  }

  /** MINEAR: shows the pop-up (a menu or a chooser) beside box r: right of it, or left of it when there is no room.
   * Each [data-k] button runs acts[k] (true = re-render). */
  popup(e: string, t: Act[], r: Box, n = ``): void {
    this.hideTip();
    this.ctxI = 0;
    const c = this.ctx;
    c.className = `ctx${n ? ` ${n}` : ``}`;
    c.innerHTML = e;
    c.querySelectorAll<HTMLElement>(`[data-k]`).forEach((e) =>
      e.addEventListener(`click`, () => {
        const n = t[+e.dataset.k!];
        this.askFirst(e, n) || (this.hideCtx(), n[1]() && this.render());
      }),
    );
    const a = c.getBoundingClientRect();
    let x = r.right + 4;
    x + a.width > innerWidth - 8 && (x = Math.max(8, r.left - a.width - 4));
    c.style.transform = `translate(${Math.min(innerWidth - a.width - 8, x)}px, ${Math.max(8, Math.min(innerHeight - a.height - 8, r.top))}px)`;
  }

  /** Destroy all / Destroy 1 of gem slot e (a rare+ gem asks first). */
  destroyActs(e: number): Act[] {
    const t = this.state.pack[e];
    if (!t) return [];
    const n = ASK_RARITIES.has(ITEM[t.id].rarity),
      r = (n: number) => () => {
        const r = this.state.pack[e]?.id === t.id ? e : this.state.pack.findIndex((e) => e.id === t.id);
        return r >= 0 && this.hooks.destroy(r, n);
      };
    return t.n > 1
      ? [
          [`Destroy all ${t.n}`, r(t.n), !0, n],
          [`Destroy 1`, r(1), !0, n],
        ]
      : [[`Destroy it`, r(1), !0, n]];
  }

  /** An "ask" action's first click turns the button into "Sure? ..."; true while it waits for the second. */
  askFirst(e: HTMLElement, t: Act): boolean {
    return !t[3] || e.classList.contains(`sure`) ? !1 : (e.classList.add(`sure`), (e.textContent = `Sure? ${t[0]}`), !0);
  }

  hideCtx(): void {
    this.ctxI = -1;
    this.ctx.classList.add(`hidden`);
  }

  hoverable(e: HTMLElement, t: Hover): void {
    J ||
      (e.addEventListener(`mouseenter`, (e) => {
        this.ctxI >= 0 || ((this.hover = t), (this.tipX = e.clientX), (this.tipY = e.clientY), this.showTip());
      }),
      e.addEventListener(`mouseleave`, () => this.hideTip()));
  }

  moveTip(e: number, t: number): void {
    if (((this.tipX = e), (this.tipY = t), this.tip.classList.contains(`hidden`))) return;
    const n = this.tip.getBoundingClientRect(),
      r = Math.min(innerWidth - n.width - 12, e + 18),
      i = Math.min(innerHeight - n.height - 12, t + 12);
    this.tip.style.transform = `translate(${r}px, ${i}px)`;
  }

  hideTip(): void {
    this.tip.classList.add(`hidden`);
    this.hover = null;
    this.el.querySelector(`.picked`)?.classList.remove(`picked`);
  }

  /** Touch: a tap on a tile, slot, stat or skill shows its tooltip (with the actions); a second tap hides it. */
  tapped(e: MouseEvent): void {
    const t = e.target as Element;
    if (this.tip.contains(t)) return;
    const n = t.closest<HTMLElement>(TAP),
      i = n && this.sheet.contains(n) ? hoverOf(n) : null;
    if (!n || !i) {
      this.hideTip();
      return;
    }
    (e.stopPropagation(), e.preventDefault());
    const r = n.matches(`.itile, .hstat, [data-skill], [data-gperk]`) ? n : n.querySelector(`.itile`);
    if (r?.classList.contains(`picked`)) {
      this.hideTip();
      return;
    }
    (this.hideTip(), r?.classList.add(`picked`));
    const a = n.getBoundingClientRect();
    this.hover = i;
    this.tipX = a.right - 8;
    this.tipY = a.top - 10;
    this.showTip();
  }

  /** The actions the touch tooltip offers for what it shows. */
  acts(e: Hover): Act[] {
    const t = this.state,
      at: Box = { left: this.tipX, right: this.tipX, top: this.tipY };
    if (e.slot) {
      const r = e.slot,
        n = t.gear[r],
        i: Act[] = [];
      this.spareFor(r).length && i.push([n ? `Swap it` : `Pick gear`, () => (this.gearChooser(r, at), !1)]);
      n && i.push([`Take it off`, () => this.hooks.unequip(r)], [`Drop it`, () => this.hooks.dropGear(n.uid, r), !0]);
      return i;
    }
    if (e.belt !== void 0) {
      const r = e.belt,
        n = t.belt[r],
        i: Act[] = [];
      this.supplyIds().some((e) => e !== n) &&
        i.push([n ? `Swap it` : `Put a supply here`, () => (this.beltChooser(r, at), !1)]);
      n && i.push([`Take it off the belt`, () => this.hooks.unbelt(r)]);
      return i;
    }
    if (e.sup) {
      const n = e.sup,
        r = t.supplies[n] ?? 0,
        i: Act[] = [];
      return (
        t.belt.slice(0, beltSlots(t)).includes(n) || i.push([`Put it on the belt`, () => this.hooks.belt(n)]),
        r > 0 && i.push([r > 1 ? `Drop one` : `Drop it`, () => this.hooks.dropSupply(n, 1), !0]),
        r > 1 && i.push([`Drop all ${r}`, () => this.hooks.dropSupply(n, r), !0]),
        i
      );
    }
    return e.uid === void 0
      ? e.loot === void 0
        ? []
        : t.pack[e.loot]
          ? this.destroyActs(e.loot)
          : []
      : [
          [`Put it on`, () => this.hooks.equip(e.uid!)],
          [`Drop it`, () => this.hooks.dropGear(e.uid!), !0],
        ];
  }

  showTip(): void {
    const e = this.hover;
    if (!e) return;
    let t: string | null = null;
    if (
      ((t = e.lock
        ? `<div class="tsimple"><b>Locked slot</b><span>Cart Slots open more room: Deep Pockets in the skill tree, cards at the Wellspring, or gear that carries them.</span></div>`
        : e.blk
          ? `<div class="tsimple"><b>Locked belt slot</b><span>Buy Belt Loops in the skill tree (Skills page, at base) to open it.</span></div>`
          : e.acc
            ? `<div class="tsimple"><b>Locked accessory slot</b><span>More accessory slots come in a later update.</span></div>`
            : e.skill
              ? this.skillTip(e.skill)
              : e.gperk
                ? this.gearPerkTip(e.gperk)
                : e.stat
                  ? this.statTip(e.stat)
                  : e.loose
                    ? this.looseTip(e.loose)
                    : e.ore
                      ? this.oreTip(e.ore)
                      : e.pocket
                        ? this.pocketTip(e.pocket)
                        : e.loot === void 0
                          ? e.sup || e.belt !== void 0
                            ? this.supplyTip(e.sup ?? this.state.belt[e.belt!] ?? null, e.belt)
                            : this.gearTip(e.uid, e.slot)
                          : this.lootTip(e.loot)),
      !t)
    ) {
      this.tip.classList.add(`hidden`);
      return;
    }
    const n = J ? this.acts(e) : [];
    n.length &&
      (t += `<div class="tacts">${n.map(([e, , t], n) => `<button type="button" data-k="${n}" class="${t ? `danger` : ``}">${e}</button>`).join(``)}</div>`);
    this.tip.innerHTML = t;
    this.tip.querySelectorAll<HTMLElement>(`.tacts button`).forEach((e) =>
      e.addEventListener(`click`, () => {
        const t = n[+e.dataset.k!];
        if (this.askFirst(e, t)) return;
        const r = t[1]();
        (this.hideTip(), r && this.render());
      }),
    );
    this.tip.classList.remove(`hidden`);
    this.moveTip(this.tipX, this.tipY);
  }

  /** Worn gear (slot t) or Cart gear (uid e, with what it changes against the gear it would replace). */
  gearTip(e: number | undefined, t: GearSlot | undefined): string | null {
    const n = this.state;
    let r: GearItem | null = null,
      i: GearItem | null = null,
      a: GearSlot | null = null;
    if (t) {
      if (((r = n.gear[t]), (a = t), !r))
        return `<div class="tsimple"><b>${SLOT_LABELS[SLOT_TYPE[t]]}</b><span>Empty. ${
          this.spareFor(t).length
            ? `Click to pick a piece from your cart.`
            : `Find gear in treasure chests, at the Forge or at the Trading Post.`
        }</span></div>`;
    } else {
      if (((r = n.items.find((t) => t.uid === e) ?? null), !r)) return null;
      const t = GEAR_BY_ID[r.base].slot,
        o = GEAR_SLOTS.filter((e) => SLOT_TYPE[e] === t);
      a = o.find((e) => !n.gear[e]) ?? o[0];
      i = n.gear[a];
    }
    const o = GEAR_BY_ID[r.base];
    let s = ``;
    if (!t) {
      const e = new Set([...r.stats.map((e) => e[0]), ...(i?.stats.map((e) => e[0]) ?? [])]),
        t: string[] = [];
      for (const i of e) {
        const e = n.statWith(i, a, r) - n.stat(i);
        Math.abs(e) < 1e-6 ||
          t.push(
            `<li class="${e > 0 ? `inc` : `dec`}">${e > 0 ? `▲` : `▼`} ${statLabel(i, Math.abs(e)).replace(`+`, e > 0 ? `+` : `−`)}</li>`,
          );
      }
      s = t.length
        ? `<div class="cmp"><span>${i ? `vs. your ${escapeText(i.name)}` : `if you put it on`}</span><ul>${t.join(``)}</ul></div>`
        : ``;
    } else if ((this.spareFor(t)[0]?.g ?? 0) > BETTER) s = `<p class="tline better">Your cart holds a better piece for this slot.</p>`;
    return `
      <div class="thead" style="--tc:${TIER_COLORS[r.tier]}">${iconOf(r)}<div><b>${escapeText(r.name)}</b><span>${starsHTML(r.tier)} ${TIER_NAMES[r.tier]} ${SLOT_LABELS[o.slot].toLowerCase()} · lvl ${r.lvl}</span></div></div>
      <ul class="lines">${r.stats.map(([e, t], n) => `<li class="${n === 0 ? `imp` : ``} ${STATS[e].perk ? `perk` : ``}">${statLabel(e, t)}${STATS[e].perk ? `<em>${STATS[e].blurb}</em>` : ``}</li>`).join(``)}</ul>
      ${s}
      <div class="tfoot"><span>${t ? `Click to swap or take it off` : `Click to put it on`} · right-click to drop</span><span>sells for <i class="coin sm"></i>${gearSellPrice(r)}</span></div>`;
  }

  /** A supply (e) in the Cart, or belt slot t (empty when e is null). */
  supplyTip(e: string | null, t: number | undefined): string | null {
    if (!e)
      return t === void 0
        ? null
        : `<div class="tsimple"><b>Belt slot ${t + 1}</b><span>Empty: click it to pick a supply from your cart (bombs, boulders, tonics...), then press ${t + 1} to use it.</span></div>`;
    const n = this.state,
      r = n.supplies[e] ?? 0,
      i = n.belt.slice(0, beltSlots(n)).indexOf(e),
      a = ITEM[e],
      o =
        e === `bomb`
          ? `Toss it where you're looking. It rolls to a stop and fizzes for 6 s (run!), then blows a crater in the rock (tougher rock than you can burrow through) and hurts everything close by, you included.`
          : (a.blurb ?? ``);
    return `
      <div class="thead" style="--tc:#ff9a7a">${gearIcons.lootHtml(e)}<div><b>${a.name} × ${r}</b><span>Supply · carry up to ${a.stack}</span></div></div>
      <p class="tline">${o}</p>${
        e === `bomb`
          ? `
      <p class="tline">Blast <b>${formatCount(blastDamage(n.level))}</b> at the middle (grows with your level)</p>`
          : ``
      }
      <div class="tfoot"><span>${t === void 0 ? (i >= 0 ? `On your belt: press ${i + 1}` : `Click to put it on your belt`) : `Click to take it off the belt`}</span><span>${r > 0 ? `` : `none left`}</span></div>`;
  }

  /** Gem slot e: a gem, or an ore stack (old saves). */
  lootTip(e: number): string | null {
    const t = this.state.pack[e];
    if (!t) return null;
    const n = ITEM[t.id];
    return n.kind === `gem`
      ? `
        <div class="thead" style="--tc:${RARITY_COLORS[n.rarity]}">${gearIcons.lootHtml(t.id)}<div><b>${n.name}</b><span>${upper(n.rarity)} gem</span></div></div>
        <p class="tline">At the Wellspring: <b>+${gemExp(t.id)} xp</b></p>
        <div class="tfoot"><span>${J ? `` : `Right-click to destroy`}</span><span>sells for <i class="coin sm"></i>${formatCount(n.value)}</span></div>`
      : `
      <div class="thead" style="--tc:#d9c7a4">${gearIcons.lootHtml(t.id)}<div><b>${n.name} × ${t.n}</b><span>Ore · a stack holds ${n.stack}</span></div></div>
      <p class="tline">Sells for <i class="coin sm"></i>${n.value} a nugget at the Trading Post: this stack, <i class="coin sm"></i><b>${formatCount(t.n * n.value)}</b>.</p>
      <div class="tfoot"><span>${J ? `` : `Right-click to destroy`}</span><span>${t.n}/${n.stack}</span></div>`;
  }

  /** MINEAR: a loose gem (kept out of the gem slots: geode leftovers, old saves). */
  looseTip(e: string): string | null {
    const t = this.state.crystals[e] ?? 0,
      n = ITEM[e];
    return !n || t <= 0
      ? null
      : `
      <div class="thead" style="--tc:${RARITY_COLORS[n.rarity]}">${gearIcons.lootHtml(e)}<div><b>${n.name}${t > 1 ? ` × ${t}` : ``}</b><span>${upper(n.rarity)} gem · kept aside</span></div></div>
      <p class="tline">It takes no gem slot. At the Wellspring: <b>+${gemExp(e)} xp</b> each.</p>
      <div class="tfoot"><span></span><span>sells for <i class="coin sm"></i>${formatCount(n.value)}</span></div>`;
  }

  /** MINEAR: an ore of the ore bin. */
  oreTip(e: string): string | null {
    const t = this.state.ores[e] ?? 0,
      n = ITEM[e];
    return !n || t <= 0
      ? null
      : `
      <div class="thead" style="--tc:${hex(n.color)}">${gearIcons.lootHtml(e)}<div><b>${n.name} × ${formatCount(t)}</b><span>Ore · in your ore bin</span></div></div>
      <p class="tline">Material for the Forge and the Refinery at base. Ore takes no gem slot.</p>`;
  }

  /** MINEAR: the reroll dice or the Dead Dust. */
  pocketTip(e: string): string | null {
    const t = e === `die` ? this.state.dice : this.state.dust,
      n = ITEM[e];
    return !n || t <= 0
      ? null
      : `
      <div class="thead" style="--tc:${e === `die` ? `#fff1d6` : RARITY_COLORS.legendary}">${gearIcons.lootHtml(e)}<div><b>${n.name} × ${t}</b><span>In your pocket · takes no gem slot</span></div></div>
      <p class="tline">${e === `die` ? `Redraw the Wellspring's cards.` : (n.blurb ?? ``)}</p>`;
  }

  /** A stat sheet row: base, Wellspring part, gear part, soft cap / ceiling / cap notes. */
  statTip(e: string): string {
    const t = this.state,
      n = STATS[e],
      r = STAT_SHEET.flatMap((e) => e.rows).find((t) => t.stat === e),
      c = t.cards[e] ?? 0,
      k = t.treePts[e] ?? 0,
      i = c + k,
      a = t.gearPoints(e),
      o = n.soft ? stackStat(e, c, 0) : c,
      s = [
        r ? `<li>Base <b>${r.base}</b></li>` : ``,
        c ? `<li class="inc">From the Wellspring <b>${statLabel(e, displayRound(o), !1)}</b></li>` : ``,
        k ? `<li class="inc">From the skill tree <b>${statLabel(e, displayRound(k), !1)}</b></li>` : ``,
        a ? `<li class="inc">From your gear <b>${statLabel(e, a, !1)}</b></li>` : ``,
        n.soft && i > n.soft ? `<li class="dec">Cards and tree points past ${statLabel(e, n.soft, !1)} count for less and less</li>` : ``,
        n.ceil && i + a > n.ceil[0]
          ? `<li class="dec">Counts as ${statLabel(e, displayRound(t.stat(e)), !1)}: it creeps toward ${statLabel(e, n.ceil[1], !1)}, never reaching it</li>`
          : ``,
        t.stat(e) >= n.cap ? `<li class="dec">At the cap (${statLabel(e, n.cap, !1)})</li>` : ``,
      ].join(``);
    return `<div class="tsimple"><b>${r?.label ?? n.name}</b><span>${n.blurb}</span></div><ul class="lines src">${s}</ul>`;
  }

  /** A skill on the skills page: what it does now, where it comes from, your picks, what a card of it adds. */
  skillTip(e: string): string {
    const t = this.state,
      n = STATS[e],
      r = t.stat(e),
      i = t.cards[e] ?? 0,
      a = t.gearPoints(e),
      o = t.banned.includes(e),
      s = STAT_GROUPS.find((t) => t.ids.includes(e))?.name ?? ``,
      c = `<div class="thead" style="--tc:#ffd98a"><img src="${cardArt(e)}" alt=""><div><b>${n.name}</b><span>${s}${n.perk ? ` · special` : ``}</span></div></div>`,
      l =
        r > 0
          ? `<p class="tline">${skillText(e, r)}</p>`
          : `<p class="tline">${n.blurb}</p><p class="tline dim">${o ? `Banished with Dead Dust: it never comes up at the Wellspring again.` : canDraft(e) ? `Not learned yet: a card of it can come up at the Wellspring.` : `Only gear gives it.`}</p>`,
      u = (t: number) =>
        n.cap <= 2 ? (e === `oresight` ? `level ${t >= 2 ? `II` : `I`}` : `yes`) : statLabel(e, displayRound(t), !1),
      d = [
        i ? `<li class="inc">From the Wellspring <b>${u(n.soft ? stackStat(e, i, 0) : i)}</b></li>` : ``,
        a ? `<li class="inc">From your gear <b>${u(a)}</b></li>` : ``,
        n.soft && i > n.soft ? `<li class="dec">Cards past ${statLabel(e, n.soft, !1)} count for less and less</li>` : ``,
        n.ceil && i + a > n.ceil[0] ? `<li class="dec">Creeps toward ${statLabel(e, n.ceil[1], !1)}, never reaching it</li>` : ``,
        n.cap !== 1 / 0 && n.cap > 2 && r >= n.cap ? `<li class="dec">At its most (${statLabel(e, n.cap, !1)})</li>` : ``,
      ].join(``),
      f = t.picks.filter((t) => t[0] === e),
      p = f.length
        ? `<div class="tpicks"><span>Your picks</span>${f
            .slice(-6)
            .map(([, e, t, n]) => `<i style="--tc:${TIER_COLORS[e]}">Lv ${n} · ${TIER_NAMES[e]} ${u(t)}</i>`)
            .join(``)}</div>`
        : ``;
    let m = ``;
    return (
      canDraft(e) &&
        !o &&
        (m =
          n.cap !== 1 / 0 && r >= n.cap
            ? `<p class="tline dim">At its most: no more cards of it come up.</p>`
            : n.cap <= 2
              ? r > 0
                ? `<p class="tline dim">A card can sharpen it once more.</p>`
                : ``
              : `<div class="tnext"><span>A card of it now</span>${[0, 1, 2, 3, 4]
                  .filter((e) => n.per[e] > 0)
                  .map(
                    (i) =>
                      `<i style="--tc:${TIER_COLORS[i]}">${TIER_NAMES[i]} <b>${statLabel(e, displayRound(t.statWithGift(e, n.per[i]) - r), !1)}</b></i>`,
                  )
                  .join(``)}</div>`),
      `${c}${l}${d ? `<ul class="lines src">${d}</ul>` : ``}${p}${m}`
    );
  }

  /** A gear perk row: what it does, and which worn gear gives it. */
  gearPerkTip(e: string): string {
    const t = this.state,
      n = STATS[e],
      r = GEAR_SLOTS.map((e) => t.gear[e])
        .filter((t): t is GearItem => !!t && t.stats.some(([t]) => t === e))
        .map(
          (t) =>
            `<li class="inc">${escapeText(t.name)} <b>${n.cap <= 2 ? `` : statLabel(e, t.stats.find(([t]) => t === e)![1], !1)}</b></li>`,
        )
        .join(``),
      i = t.cards[e] ? `<p class="tline dim">Your Wellspring cards add to it: see Skills.</p>` : ``;
    return `<div class="thead" style="--tc:#d7b8ff"><img src="${cardArt(e)}" alt=""><div><b>${n.name}</b><span>Gear perk</span></div></div><p class="tline">${skillText(e, t.gearPoints(e))}</p><ul class="lines src">${r}</ul>${i}`;
  }
}

/** The game (KR) as the inventory hooks use it: the panels, the economy and the chest / pickup glue hosts, and the
 * two sounds the skill tree adds (minear-r3f/src/audio/sfx.ts). */
export type InventoryHost = PanelHost & EconomyHost & ChestHost & { audio: { levelUp(): void; cardHover(i: number): void } };

/**
 * KR constructor 70650-70663: the inventory with its hooks. Assign the result to the game's `inv`
 * (PanelHost.inv, EconomyHost.inv, PickupHost.inv). Call it after the state, audio and HUD exist.
 */
export function makeInventory(g: InventoryHost): Inventory { // KR constructor (70650)
  return new Inventory({
    equip: (e, t) => equip(g, e, t),
    unequip: (e) =>
      g.state.unequip(e) ? (g.audio.click(), onStatsChanged(g), !0) : (g.audio.deny(), !1),
    destroy: (e, t) => destroyFromPack(g, e, t),
    dropGear: (e, t) => dropGear(g, e, t),
    dropSupply: (e, t) => dropSupply(g, e, t),
    belt: (e, t) => (g.state.beltEquip(e, t) ? (g.audio.equip(), !0) : (g.audio.deny(), !1)),
    unbelt: (e) => (g.state.beltClear(e) ? (g.audio.click(), !0) : !1),
    atBase: () => g.inHaven(g.player.pos),
    // MINEAR: a level burns materials on chain first (minear-r3f/src/economy/vault.ts)
    buyNode: async (id) => {
      if (!g.inHaven(g.player.pos)) return (g.audio.deny(), !1);
      try {
        if (!(await buyNode(g.state, id))) return (g.audio.deny(), !1);
      } catch (e) {
        g.audio.deny();
        g.ui.noteToast(``, `<b>Upgrade failed</b> ${String(e instanceof Error ? e.message : e).replace(/[&<>]/g, ``)}`, 0, `tree`);
        return !1;
      }
      TREE_BY_ID[id]?.big ? g.audio.levelUp() : g.audio.purchase();
      onStatsChanged(g);
      g.ui.bumpCoins();
      g.state.save();
      return !0;
    },
    treeSound: (kind, k = 0) => (kind === `deny` ? g.audio.deny() : kind === `arm` ? g.audio.click() : g.audio.cardHover(k)),
    close: () => closeInv(g),
  });
}
