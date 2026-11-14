// Port of play-inUT-NSi.js 61707-61892: the loot satchel panel vP (div#loot in #ui): one tile per coin pile,
// gear piece, supply stack and gem stack; click a tile to take just that, Take all (E) takes everything.
// The tile helpers vM (57670, gear tile) and bM (57677, supply tile) belong to the gear icon studio _M (57518-57679,
// [shop]); small copies are here, reading the icons through `icons` (the HUD's _M stand-in, src/ui/hud.ts HudIcons).
import { IS_TOUCH } from '../game/device';
import { ITEMS, RARITY_COLORS, type ItemDef, type Rarity } from '../world/items';
import { gemExp, TIER_COLORS, TIER_NAMES } from '../state/progression';
import { GEAR_BY_ID, SLOT_LABELS, type GearItem } from '../state/gear';
import { statLabel } from '../state/gearStats';
import type { PlayerState, SatchelPick } from '../state/playerState';
import type { HudIcons } from '../ui/hud';
import type { SatchelData } from './satchels';
import { starsHTML } from '../ui/stars';

const ITEM = ITEMS as Record<string, ItemDef>;
const J = IS_TOUCH; // J

/** gP (61707): HTML escape. */
export const escapeLoot = (e: unknown): string => // gP (61707)
  String(e).replace(
    /[&<>"']/g,
    (e) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;`, "'": `&#39;` })[e]!,
  );

/** _P (61712): rarity order for sorting gem tiles. */
const RARITY_ORDER = [`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`]; // _P (61712)

/** vM (57670): gear tile HTML (copy; [shop] owns the original with _M). */
function gearTile(icons: HudIcons, e: GearItem, t = ``): string { // vM (57670)
  return `<div class="itile t${e.tier}${e.fresh ? ` fresh` : ``}" data-uid="${e.uid}" style="--tc:${TIER_COLORS[e.tier]}" ${t}>${icons.html(e)}${starsHTML(e.tier, `tile`)}</div>`;
}

/** bM (57677): supply tile HTML (copy; [shop] owns the original with _M). */
function supplyTile(icons: HudIcons, e: string, t: number, n = ``): string { // bM (57677)
  return `<div class="itile supply${t <= 0 ? ` out` : ``}" style="--tc:#ff7a5c" ${n}>${icons.lootHtml(e)}<b class="qty">${t}</b></div>`;
}

/** The panel's hooks into the game: take (pick null = all) and close. */
export interface LootHooks {
  take(satchel: SatchelData, pick: SatchelPick | null): void;
  close(): void;
}

interface LootTile {
  key: string;
  html: string;
  pick: SatchelPick;
  says: string;
  /** Why it cannot be taken ('' when it can). */
  full: string;
}

/** vP (61713): the loot satchel panel. */
export class LootPanel { // vP (61713)
  state: PlayerState;
  hooks: LootHooks;
  /** _M (57538) stand-in: the gear and loot icons. */
  icons: () => HudIcons;
  el: HTMLElement = document.createElement(`div`);
  open = !1;
  sd: SatchelData | null = null;
  busy = !1;
  tiles: LootTile[] = [];
  chosen = ``;
  lastLeft = ``;
  constructor(e: PlayerState, t: LootHooks, icons: () => HudIcons) {
    ((this.state = e), (this.hooks = t), (this.icons = icons));
    // drives #loot when the page has it, else builds it as the original does
    const n = document.getElementById(`loot`);
    n && (this.el = n);
    ((this.el.id = `loot`),
      (this.el.className = `hidden`),
      n || document.getElementById(`ui`)!.appendChild(this.el),
      this.el.addEventListener(`click`, (e) => this.clicked(e)),
      this.el.addEventListener(`mouseover`, (e) => this.pointed(e)),
      this.el.addEventListener(`mouseleave`, () => this.say(null)),
      this.el.addEventListener(`contextmenu`, (e) => e.preventDefault()));
  }
  show(e: SatchelData): void {
    ((this.sd = e),
      (this.open = !0),
      (this.busy = !1),
      (this.chosen = ``),
      this.el.classList.remove(`hidden`),
      document.body.classList.add(`looting`),
      this.el.classList.remove(`enter`),
      void this.el.offsetWidth,
      this.el.classList.add(`enter`),
      this.render());
  }
  hide(): void {
    ((this.open = !1), (this.sd = null), this.el.classList.add(`hidden`), document.body.classList.remove(`looting`));
  }
  /** The satchel changed (e) or is gone (null: the panel closes). */
  update(e: SatchelData | null): void {
    if (this.open) {
      if (!e) return this.hooks.close();
      ((this.sd = e), (this.busy = !1), this.render());
    }
  }
  takeAll(): void {
    this.sd && !this.busy && ((this.busy = !0), this.el.classList.add(`busy`), this.hooks.take(this.sd, null));
  }
  /** Per frame while open: the countdown text. */
  tick(): void {
    const e = this.leftWords();
    if (e !== this.lastLeft) {
      this.lastLeft = e;
      const t = this.el.querySelector(`.lleft`);
      t && (t.textContent = e);
    }
  }
  leftWords(): string {
    const e = this.sd?.exp;
    if (e === void 0) return ``;
    const t = Math.max(0, Math.round((e - performance.now()) / 1e3));
    return `gone in ${Math.floor(t / 60)}:${String(t % 60).padStart(2, `0`)}`;
  }
  render(): void {
    const e = this.sd;
    if (!e) return;
    this.tiles = this.tilesOf(e);
    const t = e.mine ? `Your satchel` : e.by ? `${escapeLoot(e.by)}'s satchel` : `A satchel`;
    ((this.lastLeft = this.leftWords()),
      this.el.classList.toggle(`busy`, this.busy),
      (this.el.innerHTML = `
      <div class="lcard">
        <header><b>${t}</b><span class="lleft">${this.lastLeft}</span><button class="ghost close" type="button" title="Close (Esc)">✕</button></header>
        <div class="ltiles">${this.tiles.map((e) => `<div class="ltile${e.full ? ` full` : ``}${e.key === this.chosen ? ` chosen` : ``}" data-k="${e.key}">${e.html}</div>`).join(``)}</div>
        <p class="lsay"></p>
        <footer><button class="takeall" type="button">${J ? `` : `<kbd>E</kbd>`}Take all</button></footer>
      </div>`),
      this.say(this.tiles.find((e) => e.key === this.chosen) ?? null));
  }
  tilesOf(e: SatchelData): LootTile[] {
    const t = this.state,
      n = t.lootRoom(),
      r: LootTile[] = [],
      icons = this.icons();
    e.coins > 0 &&
      r.push({
        key: `coins`,
        html: `<div class="itile coins"><i class="coin"></i><b class="qty">${e.coins.toLocaleString()}</b></div>`,
        pick: { coins: !0 },
        says: `<b>${e.coins.toLocaleString()} coins</b>`,
        full: ``,
      });
    const i = ``; // gear goes to the wallet: never full
    for (const t of [...e.items].sort((e, t) => t.tier - e.tier))
      r.push({
        key: `g${t.uid}`,
        html: gearTile(icons, t),
        pick: { items: [t.uid] },
        says: this.gearWords(t),
        full: i,
      });
    for (const [t, i] of Object.entries(e.supplies ?? {})) {
      const e = ITEM[t];
      !e ||
        i <= 0 ||
        r.push({
          key: `s${t}`,
          html: supplyTile(icons, t, i),
          pick: { supplies: { [t]: i } },
          says: `<b>${escapeLoot(e.name)}</b>${i > 1 ? ` ×${i}` : ``} · supply`,
          full: (n.supplies[t] ?? 0) > 0 ? `` : `you can't carry more ${escapeLoot(e.name)}s`,
        });
    }
    const a = new Map<string, number>();
    for (const t of e.crystals) a.set(t, (a.get(t) ?? 0) + 1);
    const o = n.crystals > 0 ? `` : `your cart is full`;
    for (const [e, t] of [...a].sort(
      (e, t) => RARITY_ORDER.indexOf(ITEM[t[0]]?.rarity as string) - RARITY_ORDER.indexOf(ITEM[e[0]]?.rarity as string),
    )) {
      const n = ITEM[e];
      if (!n) continue;
      const i = RARITY_COLORS[n.rarity as Rarity];
      r.push({
        key: `c${e}`,
        html: `<div class="itile loot crystal r-${n.rarity}" style="--tc:${i}">${icons.lootHtml(e)}${t > 1 ? `<b class="qty">${t}</b>` : ``}</div>`,
        pick: { crystals: { [e]: t } },
        says: `<b style="color:${i}">${escapeLoot(n.name)}</b>${t > 1 ? ` ×${t}` : ``} · ${n.rarity} gem · +${gemExp(e)} xp each at the Wellspring`,
        full: o,
      });
    }
    return r;
  }
  gearWords(e: GearItem): string {
    const t = SLOT_LABELS[GEAR_BY_ID[e.base]?.slot ?? `charm`] ?? ``,
      n = e.stats
        .slice(0, 3)
        .map(([e, t]) => statLabel(e, t))
        .join(`, `);
    return `<b style="color:${TIER_COLORS[e.tier]}">${escapeLoot(e.name)}</b> · ${TIER_NAMES[e.tier]} ${t.toLowerCase()}${n ? ` · ${n}` : ``}`;
  }
  say(e: LootTile | null): void {
    const t = this.el.querySelector(`.lsay`);
    t &&
      (t.innerHTML = e
        ? e.says + (e.full ? ` · <em>${e.full}</em>` : ``)
        : J
          ? `Tap something to see it, again to take it`
          : `Click something to take just that`);
  }
  pointed(e: Event): void {
    if (J) return;
    const t = (e.target as Element).closest<HTMLElement>(`.ltile`);
    this.say(t ? (this.tiles.find((e) => e.key === t.dataset.k) ?? null) : null);
  }
  clicked(e: Event): void {
    const t = e.target as Element;
    if (t.closest(`.close`)) return this.hooks.close();
    if (t.closest(`.takeall`)) return this.takeAll();
    const n = t.closest<HTMLElement>(`.ltile`),
      r = n && this.tiles.find((e) => e.key === n.dataset.k);
    if (r && this.sd) {
      if (J && this.chosen !== r.key) {
        ((this.chosen = r.key),
          this.el.querySelectorAll(`.ltile.chosen`).forEach((e) => e.classList.remove(`chosen`)),
          n.classList.add(`chosen`),
          this.say(r));
        return;
      }
      if (r.full) {
        (n.classList.remove(`nope`), void n.offsetWidth, n.classList.add(`nope`), this.say(r));
        return;
      }
      this.busy ||
        ((this.busy = !0), (this.chosen = ``), this.el.classList.add(`busy`), this.hooks.take(this.sd, r.pick));
    }
  }
}
