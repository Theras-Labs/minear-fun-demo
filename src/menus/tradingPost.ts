// Port of play-inUT-NSi.js 58568-58937: the Trading Post and Storage Chest panel nN (KR.menu) and its helpers
// qM, JM, YM, XM, ZM, QM, $M, eN, tN, rN.
// One modal (#building in index.html) with two themes: the Trading Post (Buy / Sell tabs, rotating stock with
// a countdown, paid restock, a "Wearing" column with a stat compare on hover or tap, gem and gear selling) and
// the home Storage Chest (move gems, gear and supplies between you and the chest; Shift-click moves one).
// Purchases throw DOM spark bursts and shake the sheet. The sheet scales down to fit small screens.
// KR makes it at 70627 with its act callbacks (createMenu in src/menus/panels.ts), opens it with show()
// (openMenu / openStash), calls update(dt) every frame (71949) and refresh() after each trade.
import { IS_PHONE, IS_TOUCH } from '../game/device';
import { STATS, statLabel } from '../state/gearStats';
import {
  GEAR_BY_ID,
  GEAR_SLOTS,
  SLOT_LABELS,
  SLOT_TYPE,
  gearSellPrice,
  type GearItem,
  type GearSlot,
} from '../state/gear';
import { TIER_COLORS, TIER_DARK, TIER_NAMES } from '../state/progression';
import {
  GEODES,
  SHOP_PERIOD,
  isGeode,
  stashCap,
  type GeodeKind,
  type PlayerState,
} from '../state/playerState';
import { GEM_IDS, ITEMS, RARITY_COLORS, type ItemDef } from '../world/items';
import { gearIcons, gearTile, slotIcon } from './gearIcons';
import type { BaseDesk, BaseTheme } from '../base/basePanels';

const ITEM = ITEMS as Record<string, ItemDef>;

/** qM (58568): the supply accent color. */
const SUPPLY_COLOR = `#ff7a5c`; // qM (58568)

/** JM (58569): how each geode looks on its card. */
const GEODE_LOOK: Record<GeodeKind, { col: string; tier: string; cls: string }> = { // JM (58569)
  geode: { col: `#5fb4ff`, tier: `t2`, cls: `` },
  deepgeode: { col: `#ffc23d`, tier: `t4`, cls: `deep` },
  heartgeode: { col: `#d64dff`, tier: `t4`, cls: `heart` },
};

/** YM (58574): querySelector. */
const pick = <T extends Element = HTMLElement>(e: ParentNode, t: string): T => e.querySelector(t) as T; // YM (58574)
/** XM (58575): number with thousands separators. */
const num = (e: number): string => e.toLocaleString(); // XM (58575)
/** ZM (58576): 24-bit int -> #rrggbb. */
const hex = (e: number): string => `#` + e.toString(16).padStart(6, `0`); // ZM (58576)
/** QM (58577): HTML escape (&, <, >, "). */
const esc = (e: string): string => // QM (58577)
  e.replace(/[&<>"]/g, (e) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;` })[e as '&']);

/** $M (58579): the Trading Post crest (a coin). MINEAR: a NEAR coin (dark disc, white NEAR mark, green ring),
 *  the same face as every coin icon (minear-r3f/src/brand/nearcoin.css). */
const COIN_CREST = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="#1d1d23" stroke="#3a281c" stroke-width="4"/><circle cx="32" cy="32" r="16.5" fill="none" stroke="#00ec97" stroke-width="2" opacity="0.8"/><path transform="translate(22.5 22.5) scale(0.211)" fill="#fff" d="M72.2 4.6L53.4 32.5c-1.3 1.9 1.2 4.2 3 2.6L74.9 19c.5-.4 1.2-.1 1.2.6v50.3c0 .7-.9 1-1.3.5l-56-67C17 1.2 14.4 0 11.5 0h-2C4.3 0 0 4.3 0 9.6v70.8C0 85.7 4.3 90 9.6 90c3.3 0 6.4-1.7 8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6L15.1 70.8c-.5.4-1.2.1-1.2-.6V20.1c0-.7.9-1 1.3-.5l56 67c1.8 2.2 4.5 3.4 7.3 3.4h2c5.3 0 9.6-4.3 9.6-9.6V9.6c0-5.3-4.3-9.6-9.6-9.6-3.4 0-6.5 1.7-8.3 4.6z"/></svg>`; // $M (58579)
/** eN (58580): the Storage Chest crest. */
const CHEST_CREST = `<svg viewBox="0 0 64 64"><path d="M12 30 C12 18 20 13 32 13 C44 13 52 18 52 30 Z" fill="#c9823c" stroke="#3a281c" stroke-width="4" stroke-linejoin="round"/><rect x="10" y="30" width="44" height="22" rx="4" fill="#b06a2c" stroke="#3a281c" stroke-width="4"/><path d="M10 30 H54" stroke="#ffc23d" stroke-width="5"/><rect x="27" y="26" width="10" height="13" rx="2.5" fill="#ffc23d" stroke="#3a281c" stroke-width="3"/><circle cx="32" cy="33" r="2" fill="#3a281c"/></svg>`; // eN (58580)

/**
 * AM (58356): bomb blast damage at a level. It belongs to the bombs (58353-58357, [items] owner); this
 * private copy is only for the supply card text until that export exists.
 */
const blastAt = (e: number): number => Math.round(340 * (1 + 0.2 * Math.max(0, e - 1))); // AM (58356)

/** tN (58581): a gear item's stats as <li> lines (perks get class perk). */
export function statList(e: GearItem): string { // tN (58581)
  return e.stats.map(([e, t]) => `<li class="${STATS[e].perk ? `perk` : ``}">${statLabel(e, t)}</li>`).join(``);
}

/** rN (58934): milliseconds as m:ss. */
export function clockText(e: number): string { // rN (58934)
  const t = Math.max(0, Math.ceil(e / 1e3));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`;
}

/** What a stash click moves: a gear item by uid, a supply or a gem by id (KR.stashMove 72272). */
export interface StashEntry {
  uid?: number;
  supply?: string;
  gem?: string;
}

/** The act callbacks KR passes (70627-70634); each returns true when it worked. */
export interface TradingPostActions {
  sellItem(uid: number): boolean;
  sellCrystal(id: string): boolean;
  buy(index: number): boolean;
  restock(): boolean;
  /** toChest: stow (true) or take out (false); all: the whole stack (false = just one). */
  stash(entry: StashEntry, toChest: boolean, all: boolean): boolean;
  close(): void;
  /** MINEAR: opened the Market Town merchants from a "Merchants" tab. The merchants are NPCs on the floating
   *  islands now (src/menus/merchantDialog.ts), so the sheet no longer calls it; kept so callers still compile. */
  market?(): void;
}

/** MINEAR base: the base sites draw their own themes into the same sheet (src/base/basePanels.ts). */
export type TradingPostTheme = 'trade' | 'stash' | BaseTheme;

export class TradingPost { // nN (58586)
  act: TradingPostActions;
  el = document.getElementById(`building`) as HTMLElement;
  sheet = pick(this.el, `.sheet`);
  content = pick(this.el, `.content`);
  tabsEl = pick(this.el, `.tabs`);
  fx = pick(this.el, `.fx`);
  current: TradingPostTheme | null = null;
  tab: 'buy' | 'sell' = `buy`;
  state!: PlayerState;
  timerT = 0;
  /** MINEAR base: draws the base themes (set by the game). */
  base: BaseDesk | null = null;

  constructor(e: TradingPostActions) {
    this.act = e;
    pick(this.el, `.close`).addEventListener(`click`, () => this.act.close());
    this.el.addEventListener(`click`, (e) => {
      if (e.target === this.el) this.act.close();
    });
    window.addEventListener(`resize`, () => this.current && this.fit());
  }

  get open(): boolean {
    return this.current !== null;
  }

  show(e: PlayerState, t: TradingPostTheme = `trade`): void {
    this.current = t;
    this.state = e;
    this.tab = `buy`;
    this.el.classList.remove(`hidden`);
    this.sheet.dataset.theme = t;
    this.sheet.style.removeProperty(`--accent`);
    this.sheet.classList.remove(`enter`);
    void this.sheet.offsetWidth;
    this.sheet.classList.add(`enter`);
    this.render();
  }

  hide(): void {
    this.current = null;
    this.el.classList.add(`hidden`);
  }

  refresh(): void {
    if (this.current) this.render();
  }

  /** Every frame (KR.update 71949): every 0.5 s the stock countdown, and a fresh stock when it runs out. */
  update(e: number): void {
    if (this.current !== `trade` || ((this.timerT -= e), this.timerT > 0)) return;
    this.timerT = 0.5;
    if (this.state.ensureShop()) this.render();
    const t = this.content.querySelector(`[data-timer]`);
    if (t && this.state.shop) t.textContent = clockText(SHOP_PERIOD - (Date.now() - this.state.shop.at));
  }

  render(): void {
    const e = this.state;
    pick(this.el, `[data-coins]`).textContent = num(e.coins);
    pick(this.el, `[data-dice]`).textContent = num(e.dice);
    if (this.current !== `trade` && this.current !== `stash` && this.current) {
      this.base?.render(this, this.current);
      this.fit();
      return;
    }
    if (this.current === `stash`) {
      pick(this.el, `.crest`).innerHTML = CHEST_CREST;
      pick(this.el, `h2`).textContent = `Storage Chest`;
      pick(this.el, `.sub`).textContent = `Safe at home: nothing in here is lost when you're knocked out`;
      this.tabsEl.innerHTML = ``;
      this.content.innerHTML = this.stashHTML(e);
      this.wire();
      this.fit();
      return;
    }
    pick(this.el, `.crest`).innerHTML = COIN_CREST;
    pick(this.el, `h2`).textContent = `Trading Post`;
    pick(this.el, `.sub`).textContent = ``;
    // MINEAR: no "Merchants" tab: each merchant is an NPC on its floating island (src/menus/merchantDialog.ts).
    this.tabsEl.innerHTML = ([`buy`, `sell`] as const)
      .map((e) => `<button class="${e === this.tab ? `on` : ``}" data-tab="${e}">${e === `buy` ? `Buy` : `Sell`}</button>`)
      .join(``);
    this.tabsEl.querySelectorAll<HTMLElement>(`button`).forEach((e) =>
      e.addEventListener(`click`, () => {
        this.tab = e.dataset.tab as 'buy' | 'sell';
        this.render();
      }),
    );
    e.ensureShop();
    this.content.innerHTML = `<div class="tpage buy${this.tab === `buy` ? ` on` : ``}">${this.buyHTML(e)}</div><div class="tpage sell${this.tab === `sell` ? ` on` : ``}">${this.sellHTML(e)}</div>`;
    this.wire();
    this.fit();
  }

  /** Scales the sheet down to fit the window (24 px margin, none on a phone). */
  fit(): void {
    const e = this.sheet;
    const t = IS_PHONE ? 0 : 24;
    const n = Math.min(1, (innerHeight - t) / e.offsetHeight, (innerWidth - t) / e.offsetWidth);
    e.style.scale = n < 0.999 ? n.toFixed(3) : ``;
  }

  sellHTML(e: PlayerState): string {
    const t = e.gemsHeld();
    const n = Object.keys(t).sort((e, t) => ITEM[t].value - ITEM[e].value);
    const r = n.length
      ? `<div class="crow">${n
          .map(
            (n) => `<div class="cchip" style="--c:${hex(ITEM[n].color)}">
          <span class="g">${gearIcons.lootHtml(n)}</span><span class="nm">${ITEM[n].name} <b>×${t[n]}</b></span>
          <button data-act="sellcrystal" data-id="${n}"><i class="coin sm"></i>${num(e.crystalPrice(n))}</button></div>`,
          )
          .join(``)}</div>
        <p class="soft">Gems are also experience at the Wellspring.</p>`
      : `<div class="empty small"><p>No gems on you.</p></div>`;
    const i = e.items;
    return `<div class="sell">
      <h4>Gems</h4>${r}
      <h4>Gear</h4>${
        i.length
          ? `<div class="sgrid">${i
              .map(
                (e) => `<div class="srow" data-uid="${e.uid}">
          ${gearTile(e)}
          <div class="info"><b style="color:${TIER_DARK[e.tier]}">${esc(e.name)}</b><span>${TIER_NAMES[e.tier]} ${SLOT_LABELS[GEAR_BY_ID[e.base].slot].toLowerCase()} · lvl ${e.lvl}</span><ul>${statList(e)}</ul></div>
          <button data-act="sellitem" data-uid="${e.uid}"><i class="coin sm"></i>${num(gearSellPrice(e))}</button>
        </div>`,
              )
              .join(``)}</div>`
          : `<p class="soft">No spare gear.</p>`
      }
    </div>`;
  }

  buyHTML(e: PlayerState): string {
    const t = e.shop!;
    const n = t.stock
      .map((t, n) => {
        const r =
          !t.sold &&
          e.coins >= t.price &&
          !(t.kind === `item` && e.bagFull) &&
          !(t.kind === `supply` && e.room(t.supply!) < 1) &&
          !(isGeode(t.kind) && e.packFull);
        const i = t.sold
          ? `<div class="soldout">SOLD</div>`
          : `<button data-act="buy" data-i="${n}" ${r ? `` : `disabled`}><i class="coin sm"></i>${num(t.price)}</button>`;
        if (t.kind === `item`) {
          const e = t.item!;
          return `<div class="card stock item ${t.sold ? `sold` : ``}" data-i="${n}" style="--tc:${TIER_COLORS[e.tier]}">
          ${gearTile(e)}
          <b style="color:${TIER_DARK[e.tier]}">${esc(e.name)}</b>
          <span class="kind">${TIER_NAMES[e.tier]} ${SLOT_LABELS[GEAR_BY_ID[e.base].slot].toLowerCase()} · lvl ${e.lvl}</span>
          <ul>${statList(e)}</ul>${i}</div>`;
        }
        if (t.kind === `supply`) {
          const n = ITEM[t.supply!];
          const r = e.supplies[n.id] ?? 0;
          const a = t.sold ? `sold out` : `${t.left ?? 1} on the shelf`;
          return `<div class="card stock supply ${t.sold ? `sold` : ``}" style="--tc:${SUPPLY_COLOR}">
          <div class="itile big t2" style="--tc:${SUPPLY_COLOR}">${gearIcons.lootHtml(n.id)}</div>
          <b>${n.name}</b><span class="kind">${a} · you have ${r}/${n.stack}</span>
          <ul><li>${n.blurb}</li>${n.id === `bomb` ? `<li>Blast <b>${num(blastAt(e.level))}</b> at your level</li>` : ``}</ul>${i}</div>`;
        }
        if (t.kind === `dust`) {
          const n = ITEM.deaddust;
          return `<div class="card stock dust ${t.sold ? `sold` : ``}" style="--tc:#ffc23d">
          <div class="itile big t4" style="--tc:#ffc23d">${gearIcons.lootHtml(n.id)}</div>
          <b>${n.name}</b><span class="kind">legendary · you have ${e.dust}</span>
          <ul><li>${n.blurb}</li></ul>${i}</div>`;
        }
        if (t.kind === `die`)
          return `<div class="card stock ${t.sold ? `sold` : ``}" style="--tc:#c38bff">
          <div class="itile big t3" style="--tc:#c38bff"><i class="die huge"></i></div>
          <b>Reroll Die</b><span class="kind">redraw the Wellspring's cards</span>
          <ul><li>Spend at the Wellspring for three fresh cards</li></ul>${i}</div>`;
        const a = GEODES[t.kind];
        const o = GEODE_LOOK[t.kind];
        return `<div class="card stock ${t.sold ? `sold` : ``}" style="--tc:${o.col}">
        <div class="itile big ${o.tier}" style="--tc:${o.col}"><span class="geode ${o.cls}"></span></div>
        <b>${a.name}</b><span class="kind">a gem inside${e.packFull && !t.sold ? ` · <em class="full">cart full</em>` : ``}</span>
        <ul><li>${a.blurb}</li></ul>${i}</div>`;
      })
      .join(``);
    return `<div class="shopwrap">
      <h4 class="whead">Wearing</h4>
      <div class="shophead"><span>Fresh stock in <b data-timer>${clockText(SHOP_PERIOD - (Date.now() - t.at))}</b></span>
        <button class="ghost" data-act="restock" ${e.coins >= e.restockCost ? `` : `disabled`}>Restock now <i class="coin sm"></i>${num(e.restockCost)}</button></div>
      <aside class="wearing">${this.wearingHTML(e)}</aside>
      <div class="stockgrid">${n}</div>
    </div>`;
  }

  wearingHTML(e: PlayerState): string {
    return GEAR_SLOTS.map((t) => {
      const n = e.gear[t];
      const r = SLOT_TYPE[t];
      return `<div class="wrow" data-slot="${t}">${n ? gearTile(n) : `<div class="itile empty">${slotIcon(r)}</div>`}
        <div class="info">${n ? `<b style="color:${TIER_DARK[n.tier]}">${esc(n.name)}</b><ul class="now">${statList(n)}</ul>` : `<span class="none">${SLOT_LABELS[r]}</span>`}<ul class="cmp"></ul></div>
      </div>`;
    }).join(``);
  }

  /** Highlights the Wearing row the item would go into and lists the stat changes (null clears). */
  compare(e: GearItem | null): void {
    this.content.querySelectorAll(`.wearing .wrow`).forEach((e) => e.classList.remove(`hl`));
    if (!e) return;
    const t = this.state;
    const n = GEAR_SLOTS.filter((t) => SLOT_TYPE[t] === GEAR_BY_ID[e.base].slot);
    const r = n.find((e) => !t.gear[e]) ?? n[0];
    const i = this.content.querySelector(`.wearing .wrow[data-slot="${r}"]`);
    if (!i) return;
    const a = t.gear[r];
    const o = new Set([...e.stats.map((e) => e[0]), ...(a?.stats.map((e) => e[0]) ?? [])]);
    const s: string[] = [];
    for (const n of o) {
      const i = t.statWith(n, r, e) - t.stat(n);
      if (Math.abs(i) < 1e-6) continue;
      s.push(
        `<li class="${i > 0 ? `inc` : `dec`}">${i > 0 ? `▲` : `▼`} ${statLabel(n, Math.abs(i)).replace(`+`, i > 0 ? `+` : `−`)}</li>`,
      );
    }
    i.querySelector(`.cmp`)!.innerHTML = s.join(``);
    i.classList.add(`hl`);
  }

  stashHTML(e: PlayerState): string {
    const t = (e: GearItem[], t: boolean) =>
      e.map((e) => gearTile(e, `data-act="${t ? `stow` : `unstow`}" title="${esc(e.name)}"`)).join(``);
    const n = (e: Record<string, number>, t: boolean) =>
      Object.keys(e)
        .filter((t) => e[t] > 0 && ITEM[t])
        .map(
          (n) =>
            `<div class="itile supply t2" style="--tc:${SUPPLY_COLOR}" data-act="${t ? `stow` : `unstow`}" data-sup="${n}" title="${esc(ITEM[n].name)}">${gearIcons.lootHtml(n)}<b class="qty">${e[n]}</b></div>`,
        )
        .join(``);
    const r = (t: Record<string, number>, n: boolean) =>
      Object.keys(t)
        .filter((e) => t[e] > 0 && ITEM[e])
        .sort((e, t) => GEM_IDS.indexOf(t as never) - GEM_IDS.indexOf(e as never))
        .map((r) => {
          const i = ITEM[r];
          const a = stashCap(r);
          const o = n && (e.stash.gems[r] ?? 0) >= a;
          const s = o ? `${i.name}: the chest has the ${a} it keeps` : `${i.name}: the chest keeps up to ${a}`;
          return `<div class="itile loot crystal r-${i.rarity}${o ? ` capped` : ``}" style="--tc:${RARITY_COLORS[i.rarity]}" data-act="${n ? `stow` : `unstow`}" data-gem="${r}" title="${esc(s)}">${gearIcons.lootHtml(r)}<b class="qty">${t[r]}${n ? `` : `<small>/${a}</small>`}</b></div>`;
        })
        .join(``);
    const i: Record<string, number> = {};
    for (const t of e.pack) if (ITEM[t.id]?.kind === `gem`) i[t.id] = (i[t.id] ?? 0) + t.n;
    const a = (e: string, t: string, n: string[], r: string, i = ``) => `<div class="scol ${i}">
        <h4>${e}${t}</h4>
        ${n.some((e) => e) ? n.map((e) => (e ? `<div class="stiles">${e}</div>` : ``)).join(``) : `<p class="soft">${r}</p>`}
      </div>`;
    return `<div class="stash">
      ${a(`You carry`, ``, [r(i, true), t(e.items, true), n(e.supplies, true)], `No gems, spare gear or supplies on you (what you wear stays on you).`)}
      ${a(`In the chest`, ` <small>${e.stash.items.length}/36 gear</small>`, [r(e.stash.gems, false), t(e.stash.items, false), n(e.stash.supplies, false)], `Empty. Put gems, spare gear and supplies in here to keep them safe.`, `chest`)}
    </div>
    <p class="soft">${IS_TOUCH ? `Tap to move it across` : `Click to move it across · <kbd>Shift</kbd>-click a gem or a supply to move just one`}</p>`;
  }

  /** Binds the buttons and tiles of the content just rendered. */
  wire(): void {
    this.content.querySelectorAll<HTMLElement>(`[data-act]`).forEach((e) =>
      e.addEventListener(`click`, (t) => {
        t.stopPropagation();
        const n = e.dataset.act;
        const r = e.getBoundingClientRect();
        if (n === `sellitem`) {
          if (this.act.sellItem(+e.dataset.uid!)) this.burst(r, `#ffc23d`, 18);
        } else if (n === `sellcrystal`) {
          if (this.act.sellCrystal(e.dataset.id!)) this.burst(r, `#ffc23d`, 18);
        } else if (n === `buy`) {
          const t = +e.dataset.i!;
          const n = this.state.shop?.stock[t];
          const i = n?.item
            ? TIER_COLORS[n.item.tier]
            : n?.kind === `dust`
              ? `#ffc23d`
              : n?.kind === `die`
                ? `#c38bff`
                : n?.kind === `supply`
                  ? SUPPLY_COLOR
                  : n && n.kind in GEODE_LOOK
                    ? GEODE_LOOK[n.kind as GeodeKind].col
                    : `#5fb4ff`;
          if (this.act.buy(t)) this.celebrate(r, i);
        } else if (n === `restock`) {
          if (this.act.restock()) this.celebrate(r, `#2fa39a`);
        } else if (n === `stow` || n === `unstow`) {
          const i = n === `stow`;
          const a = t.shiftKey;
          const moved = e.dataset.sup
            ? this.act.stash({ supply: e.dataset.sup }, i, !a)
            : e.dataset.gem
              ? this.act.stash({ gem: e.dataset.gem }, i, !a)
              : this.act.stash({ uid: +e.dataset.uid! }, i, true);
          if (moved) {
            this.render();
            this.burst(r, i ? `#ffc23d` : `#2fa39a`, 12);
          }
        }
      }),
    );
    if (!IS_TOUCH) {
      this.content.querySelectorAll<HTMLElement>(`.stock.item[data-i]`).forEach((e) => {
        const t = this.state.shop?.stock[+e.dataset.i!];
        e.addEventListener(`pointerenter`, () => this.compare(t?.item ?? null));
        e.addEventListener(`pointerleave`, () => this.compare(null));
      });
      return;
    }
    // touch: a tap peeks at a stock card (and, on a phone, lists the compare inside the card)
    const peek = (e: HTMLElement | null) => {
      this.content.querySelectorAll(`.stock.peek`).forEach((t) => t !== e && t.classList.remove(`peek`));
      this.content.querySelectorAll(`.stock ul .vs, .stock ul .inc, .stock ul .dec`).forEach((e) => e.remove());
      const t = !!e && !e.classList.contains(`peek`);
      e?.classList.toggle(`peek`, t);
      const n = t && e!.dataset.i !== undefined ? this.state.shop?.stock[+e!.dataset.i] : undefined;
      this.compare(n?.item ?? null);
      const r = this.content.querySelector<HTMLElement>(`.wearing .wrow.hl`);
      if (IS_PHONE && n?.item && r) {
        const t = this.state.gear[r.dataset.slot as GearSlot];
        e!.querySelector(`ul`)?.insertAdjacentHTML(
          `beforeend`,
          `<li class="vs">${t ? `vs. your ${esc(t.name)}` : `if you put it on`}</li>${r.querySelector(`.cmp`)!.innerHTML}`,
        );
      }
    };
    this.content.querySelectorAll<HTMLElement>(`.stock`).forEach((t) =>
      t.addEventListener(`click`, (n) => {
        n.stopPropagation();
        peek(t);
      }),
    );
    this.content.onclick = () => peek(null);
  }

  /** A purchase: re-render, a star burst and a sheet shake. */
  celebrate(e: DOMRect, t: string): void {
    this.render();
    this.burst(e, t, 34, true);
    this.sheet.classList.remove(`shake`);
    void this.sheet.offsetWidth;
    this.sheet.classList.add(`shake`);
  }

  /** n DOM sparks (stars when r) flying out of the middle of rect e. */
  burst(e: DOMRect, t: string, n = 24, r = false): void {
    const i = e.left + e.width / 2;
    const a = e.top + e.height / 2;
    for (let e = 0; e < n; e++) {
      const n = document.createElement(`i`);
      n.className = r ? `spark star` : `spark`;
      const o = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 140;
      n.style.left = `${i}px`;
      n.style.top = `${a}px`;
      n.style.setProperty(`--dx`, `${Math.cos(o) * s}px`);
      n.style.setProperty(`--dy`, `${Math.sin(o) * s - 40}px`);
      n.style.setProperty(`--r`, `${Math.random() * 720 - 360}deg`);
      n.style.setProperty(`--c`, e % 3 == 0 ? `#fff` : t);
      n.style.animationDelay = `${Math.random() * 0.08}s`;
      this.fx.appendChild(n);
      setTimeout(() => n.remove(), 1100);
    }
  }
}
