// MINEAR: the skill tree on the inventory's Skills page (folder: minear-r3f/src/menus; styles in
// minear-r3f/src/brand/skilltree.css). The nodes, costs and rules are in minear-r3f/src/state/skillTree.ts; the
// inventory (minear-r3f/src/menus/inventory.ts) mounts this view on its `.skillspage` and buys through its hooks.
// Drawn with DOM in the MINEAR sheet style: rounded tiles like the inventory's item tiles on a grid, soft rounded
// connectors (one SVG) behind them, level pips under each tile, one accent colour per branch, a branch label at
// the outer end of each branch, and a cream tooltip card. Drag (or scroll) to pan.
// Mouse: hover selects a node and shows its tooltip; at base the first click arms it and the second click buys
// one level (each further click buys one more). Touch: the first tap selects and arms, the second tap buys.
// Away from base the tree is view-only: a buy click shakes the node and flashes the banner.
// Upgrades cost materials only (ore and gems). No coin cost shows anywhere; the tooltip has one small gas note.
import '../brand/skilltree.css';
import { IS_PHONE, IS_TOUCH } from '../game/device';
import { ITEMS, type ItemDef } from '../world/items';
import { ORE_IDS } from '../base/run';
import { STATS, displayRound } from '../state/gearStats';
import { BELT_MAX, beltSlots } from '../state/belt';
import {
  BRANCH_NAMES,
  TREE,
  TREE_BY_ID,
  canBuy,
  nodeBlurb,
  matHeld,
  nodeCost,
  TREE_GEMS,
  nodeRing,
  nodeShown,
  treeLevel,
  type TreeBranch,
  type TreeNode,
} from '../state/skillTree';
import type { PlayerState } from '../state/playerState';
import { gearIcons } from './gearIcons';
import { escapeText, statIcon } from './inventoryStats';
import { vault } from '../economy/vault';

const ITEM = ITEMS as Record<string, ItemDef>;

/** Reveal after a buy: wait before the first new node pops in, then one node every REVEAL_STEP (ms). */
const REVEAL_WAIT = 380;
const REVEAL_STEP = 140;
/** Pointer travel (CSS px) that turns a press into a drag. */
const DRAG_PX = 6;
/** How long a buy or reveal effect element lives (ms). */
const FX_MS = 900;
/** The small gas note of the tooltip (upgrades cost materials; NEAR coins pay only network gas). */
const GAS_NOTE = `No coin cost. On chain, an upgrade pays only network gas (free for a new wallet).`;

/** Sizes in CSS px; the view sets them as CSS variables on .stree. */
interface Dims {
  /** Grid step between node centres. */
  cell: number;
  /** Tile size of a normal node. */
  node: number;
  /** Tile size of a capstone and of home. */
  big: number;
  /** Tile outline. */
  ol: number;
  /** Tile drop shadow. */
  drop: number;
  /** Level pip size and the gap between pips. */
  dot: number;
  pg: number;
  /** Connector width. */
  line: number;
  /** Tooltip width. */
  tip: number;
  /** Tooltip tail: side of the square that is turned 45 degrees. */
  tail: number;
  /** How far the buy sparkles fly. */
  spark: number;
}
const DESK: Dims = { cell: 76, node: 50, big: 58, ol: 3, drop: 3, dot: 7, pg: 3, line: 7, tip: 262, tail: 16, spark: 44 };
const PHONE: Dims = { cell: 54, node: 38, big: 44, ol: 2.5, drop: 2, dot: 5, pg: 2, line: 5, tip: 222, tail: 13, spark: 30 };

/** Outward direction of each branch from home (grid steps) and the side its label sits on. */
const BRANCH_DIR: [Exclude<TreeBranch, 'home'>, number, number, string][] = [
  [`dig`, 0, -1, `up`],
  [`loot`, -1, 0, `left`],
  [`live`, 1, 0, `right`],
  [`move`, 0, 1, `down`],
];

/** What the tree asks the inventory to do. */
export interface TreeViewHooks {
  /** True while the miner is at base (only there can levels be bought). */
  atBase(): boolean;
  /** Buys one level of node id: state, stats, sound, save. True when it happened (it plays deny when not). */
  /** Buys one level (burns materials on chain). Resolves false when refused (the reason is shown). */
  buy(id: string): Promise<boolean>;
  /** deny = refused, arm = first click on a node, pop = new node k revealed. */
  sound(kind: 'deny' | 'arm' | 'pop', k?: number): void;
}

interface Press {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  /** Screen px per CSS px (the inventory sheet may be scaled down to fit). */
  k: number;
  node: string | null;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Restarts a CSS animation class (drop: other animation classes to remove first). */
function restart(el: Element, cls: string, ...drop: string[]): void {
  el.classList.remove(cls, ...drop);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const iconHtml = (n: TreeNode): string => (n.icon.startsWith(`<svg`) ? n.icon : statIcon(n.icon));

/** A stat total as the tooltip shows it: '+12%', '+1.5 m', '+10 HP', '+2 slots', 'yes', 'II'. */
function statText(id: string, v: number): string {
  const st = STATS[id];
  if (id === `oresight`) return v >= 2 ? `II` : v >= 1 ? `I` : `none`;
  if (st.cap === 1) return v >= 1 ? `yes` : `no`;
  const r = displayRound(v);
  return st.unit === `%` ? `+${r}%` : id === `pack` ? `+${r} slot${r === 1 ? `` : `s`}` : `+${r}${st.unit}`;
}

/** What the next level adds: '+5%', 'II', 'learned'. */
function deltaText(id: string, now: number, next: number): string {
  if (id === `oresight`) return next >= 2 ? `II` : `I`;
  if (STATS[id].cap === 1) return `learned`;
  return statText(id, Math.max(0, next - now));
}

/** SVG path of a connector from parent (x0, y0) to child (x1, y1): straight, or across then down with a round bend. */
function linkPath(x0: number, y0: number, x1: number, y1: number, bend: number): string {
  if (y0 === y1 || x0 === x1) return `M${x0} ${y0}L${x1} ${y1}`;
  const sx = Math.sign(x1 - x0),
    sy = Math.sign(y1 - y0),
    r = Math.min(bend, Math.abs(x1 - x0), Math.abs(y1 - y0));
  return `M${x0} ${y0}H${x1 - sx * r}Q${x1} ${y0} ${x1} ${y0 + sy * r}V${y1}`;
}

export class SkillTreeView {
  readonly root = document.createElement(`div`);
  hooks: TreeViewHooks;
  private host: HTMLElement | null = null;
  private head: HTMLElement;
  private view: HTMLElement;
  private world: HTMLElement;
  private lines: SVGSVGElement;
  private labels: HTMLElement;
  private nodes: HTMLElement;
  private fx: HTMLElement;
  private tipWrap: HTMLElement;
  private tip: HTMLElement;
  private tail: HTMLElement;
  private s: PlayerState | null = null;
  private d: Dims | null = null;
  private panX = 0;
  private panY = 0;
  /** Centre on home at the next layout. */
  private center = !0;
  private sel: string | null = null;
  /** The node the first click armed: the next click on it buys. */
  private armed: string | null = null;
  /** A level is on its way to the chain (one at a time). */
  private buying = false;
  private tipOn = !1;
  /** The node the tooltip last popped in for. */
  private tipFor: string | null = null;
  /** Node ids shown at the last render (null: the next render reveals nothing). */
  private known: Set<string> | null = null;
  /** Node id -> performance.now() when its reveal pops. */
  private freshAt = new Map<string, number>();
  private timers: number[] = [];
  private press: Press | null = null;

  constructor(hooks: TreeViewHooks) {
    this.hooks = hooks;
    const r = this.root;
    r.className = `stree`;
    r.innerHTML = `<div class="stree-head"></div><div class="stree-view"><div class="stree-world"><svg class="stree-lines" width="1" height="1" aria-hidden="true"></svg><div class="stree-labels"></div><div class="stree-nodes"></div><div class="stree-fx"></div></div><div class="stree-tipw hidden"><div class="stree-tip"></div><div class="stree-tail"></div></div></div>`;
    const q = (c: string) => r.querySelector(c) as HTMLElement;
    this.head = q(`.stree-head`);
    this.view = q(`.stree-view`);
    this.world = q(`.stree-world`);
    this.lines = r.querySelector(`.stree-lines`) as SVGSVGElement;
    this.labels = q(`.stree-labels`);
    this.nodes = q(`.stree-nodes`);
    this.fx = q(`.stree-fx`);
    this.tipWrap = q(`.stree-tipw`);
    this.tip = q(`.stree-tip`);
    this.tail = q(`.stree-tail`);
    this.bind();
    window.addEventListener(`resize`, () => this.host && this.s && this.root.isConnected && this.render(this.host, this.s));
  }

  /** The tree opens fresh: centred on home, nothing selected, no reveal of what is already there. */
  recenter(): void {
    this.center = !0;
    this.known = null;
    this.sel = null;
    this.armed = null;
    this.tipOn = !1;
  }

  /** Stops the effects and the timers (the inventory closed). */
  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.freshAt.clear();
    this.fx.replaceChildren();
    this.press = null;
    this.armed = null;
    this.tipOn = !1;
    this.tipWrap.classList.add(`hidden`);
    this.tipFor = null;
  }

  /** Draws the tree into host (the inventory's `.skillspage`) for player state s. */
  render(host: HTMLElement, s: PlayerState): void {
    this.s = s;
    this.host = host;
    this.root.parentElement !== host && host.replaceChildren(this.root);
    this.setDims();
    const now = performance.now(),
      shown = TREE.filter((n) => nodeShown(s, n)),
      ids = new Set(shown.map((n) => n.id));
    if (this.known) {
      const fresh = shown.filter((n) => !this.known!.has(n.id)).sort((a, b) => nodeRing(a) - nodeRing(b));
      fresh.forEach((n, k) => this.queueReveal(n, now + REVEAL_WAIT + k * REVEAL_STEP, k));
    }
    this.known = ids;
    for (const [id, t] of this.freshAt) now - t > 1500 && this.freshAt.delete(id);
    this.renderHead(s);
    this.renderLines(shown, ids, now);
    this.renderLabels(shown);
    this.renderNodes(shown, now);
    this.layout();
  }

  private setDims(): void {
    const d = IS_PHONE ? PHONE : DESK;
    if (d === this.d) return;
    this.d = d;
    const st = this.root.style,
      px = (k: string, v: number) => st.setProperty(`--${k}`, `${v}px`);
    px(`cell`, d.cell);
    px(`node`, d.node);
    px(`big`, d.big);
    px(`ol`, d.ol);
    px(`drop`, d.drop);
    px(`dot`, d.dot);
    px(`pg`, d.pg);
    px(`line`, d.line);
    px(`tipw`, d.tip);
    px(`tail`, d.tail);
    this.center = !0;
  }

  /** Half the tile size of node n in CSS px (capstones and home are larger). */
  private half(n: TreeNode): number {
    const d = this.d!;
    return (n.big || !n.parent ? d.big : d.node) / 2;
  }

  /** Distance from a tile's bottom edge to the bottom of its level pips. */
  private pipsBelow(): number {
    const d = this.d!;
    return d.drop + 1 + d.dot;
  }

  /** ms from now until node id pops in (negative: already popping), or null when it is not new. */
  private freshDelay(id: string, now: number): number | null {
    const t = this.freshAt.get(id);
    return t === undefined || now - t > 600 ? null : Math.round(t - now);
  }

  private renderHead(s: PlayerState): void {
    const base = this.hooks.atBase();
    this.head.innerHTML = `<div class="stree-banner ${base ? `base` : `away`}">${
      base ? `Upgrades: ${IS_TOUCH ? `tap` : `click`} a node twice to buy` : `View only. Go back to base to upgrade`
    }</div><div class="stree-res" title="Your materials on chain">${[...ORE_IDS, ...TREE_GEMS].map(
      (id) =>
        `<span class="stree-r" title="${ITEM[id].name}"><span class="stree-oi">${gearIcons.lootHtml(id)}</span><b>${matHeld(s, id).toLocaleString()}</b></span>`,
    ).join(``)}</div>`;
  }

  /** Connectors: a soft brown line for every link; a bought link also gets an ink edge and its branch colour. */
  private renderLines(shown: TreeNode[], ids: Set<string>, now: number): void {
    const s = this.s!,
      { cell } = this.d!,
      bend = Math.round(cell * 0.25);
    let base = ``,
      edge = ``,
      lit = ``;
    for (const n of shown) {
      if (!n.parent || !ids.has(n.parent)) continue;
      const p = TREE_BY_ID[n.parent],
        f = this.freshDelay(n.id, now),
        d = linkPath(p.gx * cell, p.gy * cell, n.gx * cell, n.gy * cell, bend);
      base += `<path class="stree-ln${f === null ? `` : ` fresh`}" d="${d}" pathLength="1"${f === null ? `` : ` style="--d:${f}ms"`}/>`;
      if (treeLevel(s, n.id) > 0) {
        edge += `<path class="stree-le" d="${d}"/>`;
        lit += `<path class="stree-lc b-${n.branch}" d="${d}"/>`;
      }
    }
    this.lines.innerHTML = base + edge + lit;
  }

  /** One label per branch, just past the outermost shown node on the branch's axis. */
  private renderLabels(shown: TreeNode[]): void {
    const { cell } = this.d!;
    let html = ``;
    for (const [b, dx, dy, side] of BRANCH_DIR) {
      let end: TreeNode | null = null;
      for (const n of shown)
        n.branch === b &&
          n.gx * dy === 0 &&
          n.gy * dx === 0 &&
          (!end || n.gx * dx + n.gy * dy > end.gx * dx + end.gy * dy) &&
          (end = n);
      if (!end) continue;
      const h = this.half(end) + 8,
        x = end.gx * cell + dx * h,
        y = end.gy * cell + (dy < 0 ? -h : dy > 0 ? h + this.pipsBelow() : 0);
      html += `<span class="stree-bl b-${b} ${side}" style="left:${x}px;top:${y}px">${BRANCH_NAMES[b]}</span>`;
    }
    this.labels.innerHTML = html;
  }

  private renderNodes(shown: TreeNode[], now: number): void {
    const s = this.s!,
      base = this.hooks.atBase(),
      { cell } = this.d!,
      sel = this.tipOn ? this.sel : null;
    this.nodes.innerHTML = shown
      .map((n) => {
        const l = treeLevel(s, n.id),
          f = this.freshDelay(n.id, now),
          cls = [
            `stree-node`,
            `b-${n.branch}`,
            n.parent ? (l > 0 ? `on` : ``) : `home`,
            n.parent && l >= n.max ? `max` : ``,
            n.big ? `big` : ``,
            base && n.parent && canBuy(s, n) ? `can` : ``,
            f === null ? `` : `fresh`,
            n.id === sel ? `sel` : ``,
            n.id === sel && n.id === this.armed ? `armed` : ``,
          ]
            .filter(Boolean)
            .join(` `),
          pips = n.parent
            ? `<span class="stree-pips">${Array.from({ length: n.max }, (_e, i) => `<i${i < l ? ` class="on"` : ``}></i>`).join(``)}</span>`
            : ``;
        return `<div class="${cls}" data-node="${n.id}" style="left:${n.gx * cell}px;top:${n.gy * cell}px${f === null ? `` : `;--d:${f}ms`}"><span class="stree-ic">${iconHtml(n)}</span>${pips}</div>`;
      })
      .join(``);
  }

  private layout(): void {
    const vw = this.view.clientWidth,
      vh = this.view.clientHeight;
    if (!vw || !vh) return;
    if (this.center) {
      this.center = !1;
      this.panX = vw / 2;
      this.panY = vh / 2;
    }
    this.panTo(this.panX, this.panY);
    this.showTip();
  }

  /** Pans so home is at (x, y) in the view, kept so the outermost shown node can reach the middle. */
  private panTo(x: number, y: number): void {
    const vw = this.view.clientWidth,
      vh = this.view.clientHeight,
      c = this.d!.cell;
    let lx = 0,
      hx = 0,
      ly = 0,
      hy = 0;
    for (const n of TREE)
      if (this.known?.has(n.id))
        ((lx = Math.min(lx, n.gx)), (hx = Math.max(hx, n.gx)), (ly = Math.min(ly, n.gy)), (hy = Math.max(hy, n.gy)));
    this.panX = Math.round(clamp(x, vw / 2 - (hx + 1) * c, vw / 2 - (lx - 1) * c));
    this.panY = Math.round(clamp(y, vh / 2 - (hy + 1) * c, vh / 2 - (ly - 1) * c));
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
    this.view.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
  }

  /** The selected node is lifted with a ring (an armed node gets the green ring). */
  private markSel(): void {
    for (const el of this.nodes.querySelectorAll(`.stree-node.sel`)) el.classList.remove(`sel`, `armed`);
    const id = this.tipOn ? this.sel : null,
      el = id ? this.nodes.querySelector(`[data-node="${id}"]`) : null;
    el?.classList.add(`sel`);
    el && this.armed === id && el.classList.add(`armed`);
  }

  /** Fills and places the tooltip for the selected node (it pops in when the node changed). */
  private showTip(): void {
    this.markSel();
    const s = this.s,
      n = this.tipOn && this.sel ? TREE_BY_ID[this.sel] : null;
    if (!s || !n || !this.known?.has(n.id)) {
      this.tipWrap.classList.add(`hidden`);
      this.tipFor = null;
      return;
    }
    this.tip.className = `stree-tip b-${n.branch}`;
    this.tip.innerHTML = this.tipHtml(s, n);
    this.tipWrap.classList.remove(`hidden`);
    this.placeTip();
    this.tipFor !== n.id && ((this.tipFor = n.id), restart(this.tipWrap, `pop`, `deny`));
  }

  /** Above the node with the tail pointing down; below it (under the pips) when there is no room. */
  private placeTip(): void {
    const n = this.sel ? TREE_BY_ID[this.sel] : null;
    if (!n || this.tipWrap.classList.contains(`hidden`)) return;
    const { cell, tail } = this.d!,
      vw = this.view.clientWidth,
      vh = this.view.clientHeight,
      ax = this.panX + n.gx * cell,
      ay = this.panY + n.gy * cell,
      half = this.half(n) + 4,
      w = this.tip.offsetWidth,
      h = this.tip.offsetHeight,
      hd = tail * Math.SQRT1_2,
      reach = Math.round(hd * 0.75),
      gap = 4,
      edge = 8,
      upY = ay - half - gap - reach - h,
      above = upY >= 4,
      x = Math.round(clamp(ax - w / 2, edge, Math.max(edge, vw - edge - w))),
      y = Math.round(clamp(above ? upY : ay + half + this.pipsBelow() + gap + reach, 4, Math.max(4, vh - h - 4))),
      tx = Math.round(clamp(ax, x + 22, x + w - 22)),
      cy = above ? y + h + reach - hd : y - reach + hd;
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
    this.tail.classList.toggle(`up`, !above);
    this.tail.style.transform = `translate(${Math.round(tx - tail / 2)}px, ${Math.round(cy - tail / 2)}px) rotate(45deg)`;
    this.tipWrap.style.transformOrigin = `${tx}px ${above ? y + h + reach : y - reach}px`;
  }

  private tipHtml(s: PlayerState, n: TreeNode): string {
    const l = treeLevel(s, n.id),
      full = l >= n.max,
      head = `<div class="stree-th"><span class="stree-ti">${iconHtml(n)}</span><div><b>${escapeText(n.name)}</b><span class="stree-lv">${BRANCH_NAMES[n.branch]}${
        n.parent ? ` · Level ${l}/${n.max}` : ``
      }</span></div></div>`,
      blurb = `<p class="stree-td">${escapeText(nodeBlurb(n))}</p>`;
    if (!n.parent) return `${head}${blurb}`;
    const base = this.hooks.atBase(),
      word = IS_TOUCH ? `Tap` : `Click`,
      c = nodeCost(n, l),
      item = (id: string, need: number) => {
        const have = matHeld(s, id);
        return `<span class="stree-c${have < need ? ` short` : ``}" title="${ITEM[id].name}: you have ${have.toLocaleString()} on chain, need ${need.toLocaleString()}"><span class="stree-oi">${gearIcons.lootHtml(id)}</span><b>${have.toLocaleString()}</b><small>/ ${need.toLocaleString()}</small></span>`;
      },
      cost = full
        ? `<p class="stree-max">Max level</p>`
        : `<div class="stree-k">On chain / need</div><div class="stree-cost">${c.mats.map(([o, k]) => item(o, k)).join(``)}</div><p class="stree-gas">${GAS_NOTE}</p>`,
      foot = !base
        ? `<p class="stree-tf no">View only. Go back to base to upgrade</p>`
        : full
          ? ``
          : !canBuy(s, n)
            ? `<p class="stree-tf no">${vault.signedIn ? `Not enough materials on chain yet. Mine more` : `Sign in with NEAR to keep your trips and upgrade`}</p>`
            : `<p class="stree-tf go">${this.armed === n.id ? `${word} again to buy` : `${word} twice to buy`}</p>`;
    return `${head}${blurb}${this.values(s, n, l)}${cost}${foot}`;
  }

  /** The "now -> next" line and the green line of what the next level adds. */
  private values(s: PlayerState, n: TreeNode, l: number): string {
    const full = l >= n.max;
    if (n.special === `belt`) {
      const now = beltSlots(s),
        next = Math.min(BELT_MAX, now + 1);
      return `<p class="stree-tv">Belt slots <b>${now}</b>${full ? `` : ` → <b>${next}</b>`}</p>${full ? `` : `<p class="stree-tg">Belt slots +${next - now}</p>`}`;
    }
    if (!n.stat) return ``;
    const id = n.stat,
      name = STATS[id].name,
      now = s.stat(id);
    if (full) return `<p class="stree-tv">${name} <b>${statText(id, now)}</b></p>`;
    const next = s.statWithGift(id, n.per);
    return `<p class="stree-tv">${name} <b>${statText(id, now)}</b> → <b>${statText(id, next)}</b></p><p class="stree-tg">${name} ${deltaText(id, now, next)}</p>`;
  }

  private bind(): void {
    const v = this.view,
      at = (t: EventTarget | null): string | null =>
        t instanceof Element ? (t.closest<HTMLElement>(`.stree-node`)?.dataset.node ?? null) : null;
    v.addEventListener(`pointerdown`, (e) => {
      if (e.pointerType === `mouse` && e.button !== 0) return;
      const r = v.getBoundingClientRect();
      this.press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        px: this.panX,
        py: this.panY,
        k: r.width / (v.offsetWidth || 1) || 1,
        node: at(e.target),
        moved: !1,
      };
    });
    v.addEventListener(`pointermove`, (e) => {
      const p = this.press;
      if (p && p.id === e.pointerId) {
        const dx = (e.clientX - p.x) / p.k,
          dy = (e.clientY - p.y) / p.k;
        if (!p.moved && Math.hypot(dx, dy) > DRAG_PX) {
          p.moved = !0;
          try {
            v.setPointerCapture(e.pointerId);
          } catch {
            /* the pointer is already gone */
          }
          v.classList.add(`drag`);
          this.armed = null;
          this.tipOn = !1;
          this.showTip();
        }
        if (p.moved) {
          this.panTo(p.px + dx, p.py + dy);
          return;
        }
      }
      e.pointerType === `mouse` && !p && this.hover(at(e.target));
    });
    const end = (e: PointerEvent) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      this.press = null;
      v.classList.remove(`drag`);
      if (!p.moved && e.type === `pointerup`) this.click(p.node);
      else e.pointerType === `mouse` && this.hover(at(document.elementFromPoint(e.clientX, e.clientY)));
    };
    v.addEventListener(`pointerup`, end);
    v.addEventListener(`pointercancel`, end);
    v.addEventListener(`pointerleave`, (e) => {
      e.pointerType === `mouse` && !this.press && this.hover(null);
    });
    v.addEventListener(
      `wheel`,
      (e) => {
        e.preventDefault();
        const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.view.clientHeight : 1;
        this.panTo(this.panX - e.deltaX * m, this.panY - e.deltaY * m);
        this.placeTip();
      },
      { passive: !1 },
    );
  }

  /** Mouse hover: selects the node under the pointer and shows its tooltip (null: hides the tooltip). */
  private hover(id: string | null): void {
    if (id) {
      if (id === this.sel && this.tipOn) return;
      id !== this.armed && (this.armed = null);
      this.sel = id;
      this.tipOn = !0;
      this.showTip();
    } else if (this.tipOn) {
      this.tipOn = !1;
      this.armed = null;
      this.showTip();
    }
  }

  /** A click or tap on node id (null: on the background). */
  private click(id: string | null): void {
    const s = this.s;
    if (!s) return;
    if (!id) {
      this.tipOn = !1;
      this.armed = null;
      this.showTip();
      return;
    }
    const n = TREE_BY_ID[id];
    this.sel = id;
    this.tipOn = !0;
    if (!n.parent) {
      this.armed = null;
      this.showTip();
      return;
    }
    const base = this.hooks.atBase();
    if (!base || !canBuy(s, n)) {
      this.armed = null;
      this.showTip();
      this.deny(id, !base);
      return;
    }
    if (this.armed !== id) {
      this.armed = id;
      this.hooks.sound(`arm`);
      this.showTip();
      return;
    }
    if (this.buying) return;
    this.buying = !0;
    void this.hooks.buy(id).then((ok) => {
      this.buying = !1;
      if (!ok) {
        this.armed = null;
        this.showTip();
        this.deny(id, !this.hooks.atBase(), !1);
        return;
      }
      treeLevel(s, id) >= n.max && (this.armed = null);
      this.host && this.render(this.host, s);
      const el = this.nodes.querySelector(`[data-node="${id}"]`);
      el && restart(el, `pop`, `fresh`, `deny`);
      this.flash(n);
      this.sparkle(n, n.big ? 12 : 8);
    });
  }

  /** Refused: the node and the tooltip shake; away from base the banner flashes too. */
  private deny(id: string, away: boolean, sound = !0): void {
    sound && this.hooks.sound(`deny`);
    const el = this.nodes.querySelector(`[data-node="${id}"]`);
    el && restart(el, `deny`, `fresh`, `pop`);
    this.tipWrap.classList.contains(`hidden`) || restart(this.tipWrap, `deny`, `pop`);
    if (away) {
      const b = this.head.querySelector(`.stree-banner`);
      b && restart(b, `flash`);
    }
  }

  /** A new node appears at time `at`: it pops in (CSS), then a ring, a few sparkles and a rising blip. */
  private queueReveal(n: TreeNode, at: number, k: number): void {
    this.freshAt.set(n.id, at);
    this.timers.push(
      window.setTimeout(
        () => {
          if (!this.root.isConnected || !this.known?.has(n.id)) return;
          this.flash(n);
          this.sparkle(n, 6);
          this.hooks.sound(`pop`, Math.min(k, 8));
        },
        Math.max(0, at - performance.now()),
      ),
    );
    this.timers.length > 64 && this.timers.splice(0, this.timers.length - 64);
  }

  /** A soft glow and a rounded ring that grows out of node n and fades, in the branch colour. */
  private flash(n: TreeNode): void {
    const { cell } = this.d!,
      pos = `left:${n.gx * cell}px;top:${n.gy * cell}px;--s:${Math.round(2 * this.half(n))}px`,
      g = document.createElement(`i`),
      r = document.createElement(`i`);
    g.className = `stree-glow b-${n.branch}`;
    g.style.cssText = pos;
    r.className = `stree-rg b-${n.branch}`;
    r.style.cssText = pos;
    this.fx.append(g, r);
    window.setTimeout(() => (g.remove(), r.remove()), FX_MS);
  }

  /** A few sparkles (small stars and dots) that fly out of node n and fade, in the branch colour. */
  private sparkle(n: TreeNode, count: number): void {
    const { cell, spark } = this.d!,
      x = n.gx * cell,
      y = n.gy * cell,
      h = this.half(n),
      a0 = Math.random() * Math.PI * 2,
      els: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const a = a0 + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
        r = h * 0.7 + spark * (0.55 + Math.random() * 0.5),
        e = document.createElement(`i`);
      e.className = `stree-sp b-${n.branch}${i % 3 === 2 ? ` dot` : ``}`;
      e.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r)}px;--r:${Math.round(90 + Math.random() * 180)}deg;--t:${Math.round(Math.random() * 90)}ms`;
      els.push(e);
    }
    this.fx.append(...els);
    window.setTimeout(() => els.forEach((e) => e.remove()), FX_MS);
  }
}
