// MINEAR base: the Forge "Make gear" flow (folder: minear-r3f/src/base). Step 1 is a grid of big slot tiles
// (Claws, Gauntlet, Jet Pump, Head, Back, Launcher, Pack, Charm). Step 2 is one slot: the piece on the anvil, the odds bar, one
// tile per metal (the piece in iron, gold or mythril), the list of required materials, Make and x10, and the
// compare against the worn piece. A make gives exactly that piece in that metal (the metal sets the item, like
// theras-rpg-template; the Claws slot has three tiles: Claws, Gauntlet, Jet Pump). Step 3 is the
// reveal over the sheet: one piece in a ring, or (x10) an even grid of every piece over a hammered anvil,
// with Equip and Keep.
// MINEAR rules (user, 2026-11-14): no gear limit (gear is in the wallet), no forge level, no level text.
// The layout and the reveal follow the Make Gear flow of the theras-rpg-template game; the look is MINEAR's own (Fredoka,
// cream sheets, ink outlines). The rules stay in minear-r3f/src/base/workshop.ts; the clicks and the step state
// live in minear-r3f/src/base/basePanels.ts.
import './forge.css';
import { METAL_DYE, gearIcons } from '../menus/gearIcons';
import { TOOL_NOTE, toolOf } from '../game/digTools';
import { FORGE_METAL, GEAR_BY_ID, GEAR_SLOTS, SLOT_LABELS, SLOT_TYPE, STATS_PER_TIER, type GearItem, type GearSlotType } from '../state/gear';
import { STATS, statLabel } from '../state/gearStats';
import type { PlayerState } from '../state/playerState';
import { TIER_COLORS, TIER_DARK, TIER_NAMES, luckCurve } from '../state/progression';
import { ITEMS, type ItemDef } from '../world/items';
import {
  FORGE_GRADES,
  FORGE_SLOTS,
  canForge,
  forgeCost,
  forgeCount,
  forgeRoll,
  forgeKind,
  forgeLevel,
  forgeNeeds,
  forgeShort,
  oreHave,
  type ForgeGrade,
  type ForgeKind,
} from './workshop';
import { starsHTML } from '../ui/stars';
import { vault } from '../economy/vault';

const ITEM = ITEMS as Record<string, ItemDef>;

const num = (n: number): string => Math.floor(n).toLocaleString();
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;` })[c as '&']);
const hex = (n: number): string => `#${n.toString(16).padStart(6, `0`)}`;
const pct = (p: number): string => (p <= 0 ? `0%` : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);
const lower = (slot: GearSlotType): string => SLOT_LABELS[slot].toLowerCase();
const oreName = (id: string): string => ITEM[id]?.name ?? id;

/** A gear icon: the Claws-slot kinds are drawings (minear-r3f/src/menus/toolIcons.ts), the rest rendered models;
 *  a forged piece shows its metal. */
const iconOf = (it: string | { base: string; ore?: string }): string => gearIcons.html(it);
/** The kind's piece in a metal (the metal tiles, the anvil): exactly what a make gives. */
const pieceIcon = (k: ForgeKind, ore: string): string => iconOf({ base: k.base, ore });
/** "Iron Knight Helm". */
const pieceName = (k: ForgeKind, ore: string): string => `${FORGE_METAL[ore] ?? oreName(ore)} ${GEAR_BY_ID[k.base]?.name ?? k.name}`;
/** The dig-tool line of a Claws-slot piece (Gauntlet: strong in ore veins), or empty. */
const toolLine = (it: GearItem): string => (GEAR_BY_ID[it.base]?.slot === `drill` ? TOOL_NOTE[toolOf(it.base)] : ``);

/** The anvil the piece stands on in the preview (MINEAR ink outline, steel grey). */
const ANVIL = `<svg class="fv-anvil" viewBox="0 0 140 76" aria-hidden="true">
  <path d="M6 13 Q25 13 37 6 H118 V25 H94 Q86 31 86 41 H55 Q55 31 46 27 Q25 24 6 13 Z" fill="#8d97a6" stroke="#1c130c" stroke-width="4" stroke-linejoin="round"/>
  <path d="M40 10 H114 V15 H40 Z" fill="#c9d1db"/>
  <path d="M57 41 H84 L90 59 H51 Z" fill="#6f7886" stroke="#1c130c" stroke-width="4" stroke-linejoin="round"/>
  <path d="M41 59 H100 Q105 59 105 65 V72 H36 V65 Q36 59 41 59 Z" fill="#5d6573" stroke="#1c130c" stroke-width="4" stroke-linejoin="round"/>
</svg>`;

/** The hammer that strikes the anvil in the x10 result. */
const HAMMER = `<svg class="fv-hammer" viewBox="0 0 100 60" aria-hidden="true">
  <path d="M40 22 H95" stroke="#1c130c" stroke-width="11" stroke-linecap="round"/>
  <path d="M40 22 H95" stroke="#b07a48" stroke-width="5.5" stroke-linecap="round"/>
  <rect x="17" y="4" width="25" height="40" rx="4" fill="#8d97a6" stroke="#1c130c" stroke-width="4" stroke-linejoin="round"/>
  <rect x="22" y="8" width="6" height="32" rx="2" fill="#c9d1db"/>
</svg>`;

// ---- odds and strength ----------------------------------------------------------------------------------

/** Tier odds of a grade after Fortune: pickTier (minear-r3f/src/state/gear.ts) may move a roll one tier up. */
export function forgeOdds(g: ForgeGrade, fortune: number): number[] {
  const sum = g.weights.reduce((a, b) => a + b, 0) || 1;
  const p = g.weights.map((w) => w / sum);
  const up = luckCurve(fortune);
  const last = p.length - 1;
  return p.map((v, i) => (i < last ? v * (1 - up) : v) + (i > 0 ? p[i - 1] * up : 0));
}

/** rollGear's level factor (minear-r3f/src/state/gear.ts): every scaled stat roll grows with it. */
const levelMul = (lvl: number): number => (lvl <= 110 ? 0.7 + lvl / 110 : 1.7 + (lvl - 110) / 600);
const SCALED = Object.values(STATS).filter((st) => st.cap > 2 && st.per[0] > 0);
/** How much a stat roll grows by tier, as the mean over the stats that roll at every tier. */
const TIER_GROWTH = [0, 1, 2, 3, 4].map((t) => SCALED.reduce((a, st) => a + st.per[t] / st.per[0], 0) / SCALED.length);
const perAt = (id: string, t: number): number => {
  const p = STATS[id].per;
  return p[t] || p[Math.max(2, t)] || p[4] || 1;
};

/** One number for the strength of a piece: each stat roll against the roll of its tier, times the tier growth. */
export function gearScore(it: GearItem): number {
  const grow = TIER_GROWTH[it.tier] ?? 1;
  return it.stats.reduce((a, [id, v], i) => {
    const st = STATS[id];
    if (!st || st.cap <= 2) return a + (i ? 0.75 : 1) * grow * levelMul(it.lvl);
    return a + (grow * v) / perAt(id, it.tier);
  }, 0);
}

/** The score of an average roll of a tier at a level (implicit at 1, the other stats at 0.75). */
const typicalScore = (t: number, lvl: number): number =>
  levelMul(lvl) * TIER_GROWTH[t] * (1 + 0.75 * (STATS_PER_TIER[t] - 1));
const averageScore = (odds: number[], lvl: number): number => odds.reduce((a, p, t) => a + p * typicalScore(t, lvl), 0);

/** What the player wears for a slot type: the weaker piece of the two charms; null when a slot is empty. */
export interface Worn {
  item: GearItem | null;
  /** Pieces worn in this slot type. */
  count: number;
}

export function wornFor(s: PlayerState, slot: GearSlotType): Worn {
  const on = GEAR_SLOTS.filter((g) => SLOT_TYPE[g] === slot).map((g) => s.gear[g]);
  const items = on.filter((e): e is GearItem => !!e);
  if (items.length < on.length) return { item: null, count: items.length };
  let item: GearItem | null = null;
  for (const e of items) if (!item || gearScore(e) < gearScore(item)) item = e;
  return { item, count: items.length };
}

type Verdict = { word: string; cls: 'up' | 'down' | 'same'; worn: number };

function verdict(score: number, w: Worn): Verdict {
  if (!w.item) return { word: `Stronger!`, cls: `up`, worn: 0 };
  const worn = gearScore(w.item);
  const r = score / Math.max(1e-6, worn);
  if (r > 1.04) return { word: `Stronger!`, cls: `up`, worn };
  if (r < 0.96) return { word: `Weaker`, cls: `down`, worn };
  return { word: `Same`, cls: `same`, worn };
}

// ---- step 1: the slot tiles -----------------------------------------------------------------------------

/** Step 1: one big tile per forgeable slot; a red dot when a forge is affordable now. */
export function forgePickHTML(s: PlayerState): string {
  const lvl = forgeLevel(s);
  const best = [...FORGE_GRADES].reverse().find((g) => canForge(s, g)) ?? null;
  const avg = best ? averageScore(forgeOdds(best, s.fortuneNow), lvl) : 0;
  const tiles = FORGE_SLOTS.map((k) => {
    const { slot, name } = k;
    const w = wornFor(s, slot);
    const up = !!best && verdict(avg, w).cls === `up`;
    const sub = w.item
      ? `<small style="color:${TIER_DARK[w.item.tier]}">${TIER_NAMES[w.item.tier]} worn</small>`
      : `<small>${w.count ? `One slot free` : `Nothing worn`}</small>`;
    return `<button class="fv-slot" data-bz="fslot" data-slot="${k.id}" title="${esc(GEAR_BY_ID[k.base]?.name ?? name)}">
      ${best ? `<i class="fv-dot"></i>` : ``}${up ? `<em class="fv-up">▲ Upgrade</em>` : ``}
      <span class="fv-sic">${iconOf(k.base)}</span><b>${name}</b>${sub}</button>`;
  }).join(``);
  return `<span class="lbl fv-lbl">PICK WHAT TO MAKE</span><div class="fv-pick">${tiles}</div>`;
}

// ---- step 2: one slot -----------------------------------------------------------------------------------

/** Step 2: the piece on the anvil, the odds bar, the metal tiles, the required materials, Make, x10 and Back. */
export function forgeMakeHTML(s: PlayerState, kindId: string, ore: number): string {
  const k = forgeKind(kindId);
  const slot = k.slot;
  const g = FORGE_GRADES[ore] ?? FORGE_GRADES[0];
  const lvl = forgeLevel(s);
  const fortune = Math.round(s.fortuneNow);
  const odds = forgeOdds(g, s.fortuneNow);
  let top = odds.length - 1;
  while (top > 0 && odds[top] <= 0) top--;
  const w = wornFor(s, slot);
  const avg = averageScore(odds, lvl);
  const v = verdict(avg, w);
  const max = Math.max(avg, v.worn) * 1.08 || 1;
  const ok = canForge(s, g);
  const short = forgeShort(s, g);
  const why = short
    ? `You need ${num(short.n - oreHave(s, short.ore))} more ${oreName(short.ore).toLowerCase()} on chain.`
    : s.coins < g.coins
      ? `You need ${num(g.coins - s.coins)} more coins.`
      : ``;
  const vsText = w.item ? `Average make vs your ${esc(w.item.name)}` : w.count ? `One ${lower(slot)} slot is free` : `Nothing worn in this slot yet`;

  const band = `<div class="fv-band">
      <i class="fv-rays"></i>
      <div class="fv-forge">
        <div class="fv-big">${pieceIcon(k, g.ore)}${v.cls === `up` ? `<em class="fv-arrow">▲</em>` : ``}</div>
        ${ANVIL}
      </div>
      <small class="fv-type">${SLOT_LABELS[slot]}</small>
      <h3 class="fv-name">${esc(pieceName(k, g.ore))}</h3>
      <div class="fv-cmp ${v.cls}">
        <b>${v.word}</b>
        <div class="fv-cbar"><i class="new" style="width:${((avg / max) * 100).toFixed(1)}%"></i>${
          w.item ? `<i class="now" style="left:${((v.worn / max) * 100).toFixed(1)}%"></i>` : ``
        }</div>
        <small>${vsText}</small>
      </div>
    </div>`;

  const oddsBar = odds
    .map((p, t) => (p > 0 ? `<i style="flex:${p.toFixed(4)};background:${TIER_COLORS[t]}" title="${TIER_NAMES[t]} ${pct(p)}"></i>` : ``))
    .join(``);
  const metals = FORGE_GRADES.map(
    (gr, i) => `<button class="fv-mat${i === ore ? ` on` : ``}" data-bz="fore" data-i="${i}" style="--c:${hex(METAL_DYE[gr.ore] ?? ITEM[gr.ore].color)}" title="${esc(pieceName(k, gr.ore))}">
      ${canForge(s, gr) ? `<i class="fv-dot"></i>` : ``}<span class="fv-mic">${pieceIcon(k, gr.ore)}</span><b>${oreName(gr.ore)}</b></button>`,
  ).join(``);
  const needs = forgeNeeds(g)
    .map((m) => {
      const have = oreHave(s, m.ore);
      return `<li class="fv-need" title="${oreName(m.ore)}"><span class="bz-ic">${gearIcons.lootHtml(m.ore)}</span><b>${num(m.n)}</b><span class="fv-nm">${oreName(m.ore)}</span><small class="${have >= m.n ? `ok` : `short`}">Have ${num(have)}</small></li>`;
    })
    .join(``);
  const side = `<div class="fv-side">
      <div class="fv-head"><span class="lbl">ODDS WITH ${oreName(g.ore).toUpperCase()}${fortune > 0 ? ` · FORTUNE ${fortune}` : ``}</span>
        <b style="color:${TIER_DARK[top]}">${TIER_NAMES[top]} ${pct(odds[top])}</b></div>
      <div class="fv-odds">${oddsBar}</div>
      <div class="fv-mats">${metals}</div>
      <div class="fv-buy">
        <ul class="fv-needs">${needs}${
          g.coins ? `<li class="fv-need"><i class="coin sm"></i><b>${num(g.coins)}</b><small class="${s.coins >= g.coins ? `ok` : `short`}">Have ${num(s.coins)}</small></li>` : ``
        }</ul>
        <span class="fv-btns">
          <button class="fv-go" data-bz="forge" ${ok ? `` : `disabled`}>Make</button>
          <button class="fv-go x10" data-bz="forge10" ${ok ? `` : `disabled`} title="Makes up to 10 while you have the materials">x10</button>
        </span>
      </div>
      <p class="fv-why">${why}</p>
    </div>`;
  return `<div class="fv-make">${band}${side}</div><button class="fv-back" data-bz="fback">Back</button>`;
}

// ---- making ---------------------------------------------------------------------------------------------

/** One Make or x10: the pieces made, the best one, and why an x10 stopped early. */
export interface ForgeRun {
  items: GearItem[];
  best: number;
  grade: ForgeGrade;
  slot: GearSlotType;
  stop: string;
  /** What was worn in the slot before the make. */
  worn: Worn;
}

/** Forges up to `times` pieces of kind `kindId` while the materials on chain last; null for none. On a v2 contract
 *  the chain makes them: one `forge` call burns the materials, rolls the rarity and mints gear NFTs
 *  (minear-r3f/contracts/items/src/gear.rs); the stats come from each NFT's seed. On a v1 contract the materials
 *  burn on chain and the pieces roll here.
 *  Throws with the chain's reason (nothing is made then).
 *  MINEAR rule (user, 2026-11-14): one x10 gives one Legendary at most; after it, a Legendary roll comes out Epic. */
export async function runForge(s: PlayerState, g: ForgeGrade, kindId: string, times: number): Promise<ForgeRun | null> {
  const k = forgeKind(kindId);
  const slot = k.slot;
  const worn = wornFor(s, slot);
  const n = forgeCount(s, g, times);
  if (n < 1) return null;
  let items: GearItem[] = [];
  if (vault.chainGear) {
    // v2: the contract burns the materials, rolls the rarity and mints the NFTs in one call
    items = await vault.forge(s, k.base, g.id, n);
  } else {
    // v1 contract: burn on chain, roll in this browser
    await vault.spend(forgeCost(g, n), `forge`);
    for (let i = 0; i < n; i++) {
      const it = forgeRoll(s, g, k, items.some((e) => e.tier >= 4) ? 3 : 4);
      if (it) items.push(it);
    }
  }
  if (!items.length) return null;
  let best = 0;
  items.forEach((it, i) => {
    const b = items[best];
    if (it.tier > b.tier || (it.tier === b.tier && gearScore(it) > gearScore(b))) best = i;
  });
  let stop = ``;
  const out = forgeNeeds(g).find((m) => oreHave(s, m.ore) < m.n);
  if (times > 1 && items.length < times && out) stop = `Out of ${oreName(out.ore).toLowerCase()} on chain`;
  return { items, best, grade: g, slot, stop, worn };
}

// ---- step 3: the reveal ---------------------------------------------------------------------------------

/** The sounds the reveal plays (minear-r3f/src/audio/sfx.ts through the BaseDesk host). */
export interface RevealAudio {
  loot(tier: number): void;
  clang?(): void;
  cardFlip?(tier: number): void;
  levelUp?(): void;
}

const TITLE = [``, `Great!`, `Rare!`, `Epic!`, `LEGEND!`];
/** Seconds after the reveal before a key closes it, by tier. */
const HOLD = [0.3, 0.4, 0.55, 0.7, 1.0];
const rnd = (a: number, b: number, d = 2): string => (a + Math.random() * (b - a)).toFixed(d);
/** One make: seconds between hammer hits. x10: seconds between hits, one piece flies out per hit. */
const HIT_ONE = 0.3;
const HIT_TEN = 0.24;
/** A hit lands this long after the swing starts (the hammer's down stroke). */
const STRIKE = 0.11;

/**
 * The Forge result (user, 2026-11-14, after the theras-rpg-template video): a dark overlay over the whole screen with
 * the anvil. The hammer strikes the glowing material over the anvil.
 *   One make: 3 to 5 hits (more for the rarer pieces), then the piece bursts out of the material with a ring and
 *   rays, its name, stars and stats under the anvil, then Equip and Keep.
 *   x10: an empty 5 x 2 grid over the anvil; each hit sends one finished piece flying into the next slot and
 *   counts "3 / 10"; after the last one the title, the rays, the name and stats of the best piece and the
 *   "Made 10" counts. No piece is singled out in the grid; a click on a tile shows that piece instead.
 * A click or a key during the hits skips to the end. Keep (or a key) closes; Equip puts the shown piece on.
 */
export class ForgeReveal {
  private el: HTMLElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readyAt = 0;
  private done: (() => void) | null = null;
  private run: ForgeRun | null = null;
  private audio: RevealAudio | null = null;
  /** The piece the info line shows and Equip puts on (the best one until a tile is clicked). */
  private sel = 0;
  /** True once the hits are over and the result shows. */
  private finished = false;
  /** x10: how many pieces are in their slots. */
  private landed = 0;

  get open(): boolean {
    return !!this.el;
  }

  /** equip: puts on a piece of the run (Equip button); without it only Keep is shown. */
  show(_sheet: HTMLElement, run: ForgeRun, audio: RevealAudio, done?: () => void, equip?: (uid: number) => void): void {
    this.close(true);
    const calm = matchMedia(`(prefers-reduced-motion: reduce)`).matches;
    const it = run.items[run.best];
    const t = Math.max(0, Math.min(4, it.tier));
    const n = run.items.length;
    const multi = n > 1;
    const el = document.createElement(`div`);
    el.className = `fv-rv t${t} ${multi ? `multi` : `one`}${calm ? ` calm` : ``}`;
    el.style.cssText = `--tc:${TIER_COLORS[t]};--td:${TIER_DARK[t]};--d:0s;--r:0.45s`;
    el.innerHTML = this.stageHTML(run, multi, !!equip);
    el.addEventListener(`click`, (e) => {
      e.stopPropagation();
      if (!this.finished) return this.finish();
      const b = (e.target as HTMLElement).closest<HTMLElement>(`[data-rv], [data-k]`);
      if (!b) return;
      if (b.dataset.k !== undefined) return this.pick(+b.dataset.k);
      if (b.dataset.rv === `equip` && equip) equip(run.items[this.sel].uid);
      this.close();
    });
    document.body.appendChild(el);
    this.el = el;
    this.run = run;
    this.audio = audio;
    this.done = done ?? null;
    this.sel = run.best;
    this.finished = false;
    this.landed = 0;
    this.readyAt = Infinity;
    window.addEventListener(`keydown`, this.onKey, true);
    if (calm) return this.finish();

    const at = (sec: number, fn: () => void) => this.timers.push(setTimeout(fn, Math.max(0, sec) * 1000));
    if (multi) {
      for (let i = 0; i < n; i++) at(0.35 + i * HIT_TEN, () => this.swing(i));
      at(0.35 + (n - 1) * HIT_TEN + STRIKE + 0.75, () => this.finish());
    } else {
      const hits = 3 + (t >= 3 ? 2 : t >= 2 ? 1 : 0);
      for (let i = 0; i < hits; i++) at(0.3 + i * HIT_ONE, () => this.swing(-1));
      at(0.3 + (hits - 1) * HIT_ONE + STRIKE + 0.3, () => this.finish());
    }
  }

  /** One hammer swing; when it lands: the clang, the sparks, the anvil bump and (x10) piece k flies out. */
  private swing(k: number): void {
    const el = this.el;
    if (!el || this.finished) return;
    const restart = (sel: string, cls: string) => {
      const x = el.querySelector(sel);
      if (!x) return;
      x.classList.remove(cls);
      void (x as HTMLElement).offsetWidth;
      x.classList.add(cls);
    };
    restart(`.fv-hammer`, `swing`);
    this.timers.push(
      setTimeout(() => {
        if (this.finished || !this.el) return;
        this.audio?.clang?.();
        restart(`.fv-anvil`, `bump`);
        restart(`.fv-rv-mat`, `hit`);
        this.sparks();
        if (k >= 0) this.fly(k);
      }, STRIKE * 1000),
    );
  }

  /** A burst of hot bits from the material. */
  private sparks(): void {
    const box = this.el?.querySelector(`.fv-rv-bits`);
    if (!box) return;
    const bits = Array.from({ length: 9 }, () => {
      const a = -Math.PI * (0.05 + Math.random() * 0.9);
      const r = 40 + Math.random() * 60;
      return `<i style="--dx:${(Math.cos(a) * r).toFixed(0)}px;--dy:${(Math.sin(a) * r).toFixed(0)}px"></i>`;
    }).join(``);
    const g = document.createElement(`div`);
    g.className = `burst`;
    g.innerHTML = bits;
    box.appendChild(g);
    setTimeout(() => g.remove(), 600);
  }

  /** x10: piece k flies from the material over the anvil into slot k. */
  private fly(k: number): void {
    const el = this.el;
    const run = this.run;
    const slot = el?.querySelector<HTMLElement>(`.fv-rv-grid [data-k="${k}"]`);
    const mat = el?.querySelector<HTMLElement>(`.fv-rv-mat`);
    if (!el || !run || !slot || !mat) return;
    const it = run.items[k];
    const a = mat.getBoundingClientRect();
    const b = slot.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const f = document.createElement(`div`);
    f.className = `itile t${it.tier} fv-fly`;
    f.style.cssText = `--tc:${TIER_COLORS[it.tier]};left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px`;
    f.innerHTML = iconOf(it);
    el.appendChild(f);
    const anim = f.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(-40deg)`, opacity: 0.5 },
        { transform: `translate(${(dx * 0.5).toFixed(0)}px, ${(dy * 0.55 - 80).toFixed(0)}px) scale(0.85) rotate(150deg)`, opacity: 1, offset: 0.55 },
        { transform: `none`, opacity: 1 },
      ],
      { duration: 380, easing: `cubic-bezier(0.3, 0.6, 0.4, 1)` },
    );
    anim.onfinish = () => {
      f.remove();
      this.land(k);
    };
  }

  /** x10: piece k is in its slot (its tile, its stars, a pop) and the counter goes up. */
  private land(k: number): void {
    const el = this.el;
    const run = this.run;
    const slot = el?.querySelector<HTMLElement>(`.fv-rv-grid [data-k="${k}"]`);
    if (!el || !run || !slot || slot.classList.contains(`full`)) return;
    const it = run.items[k];
    slot.className = `itile t${it.tier} full`;
    slot.style.setProperty(`--tc`, TIER_COLORS[it.tier]);
    slot.title = it.name;
    slot.innerHTML = `${iconOf(it)}${starsHTML(it.tier, `tile`)}`;
    this.landed++;
    const c = el.querySelector(`.fv-rv-count`);
    if (c) c.textContent = `${this.landed} / ${run.items.length}`;
  }

  /** The end of the hits (or a skip): every piece in place, then the result. */
  private finish(): void {
    const el = this.el;
    const run = this.run;
    if (!el || !run || this.finished) return;
    this.finished = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    el.querySelectorAll(`.fv-fly`).forEach((f) => f.remove());
    run.items.forEach((_, k) => this.land(k));
    const it = run.items[run.best];
    const t = Math.max(0, Math.min(4, it.tier));
    const multi = run.items.length > 1;
    const calm = el.classList.contains(`calm`);
    el.classList.add(`done`);
    const fx = el.querySelector(`.fv-rv-fx`);
    if (fx) fx.innerHTML = this.fxHTML(t, calm, multi);
    const title = el.querySelector(`.fv-rv-titlebox`);
    const word = TITLE[t] || `Forged!`;
    if (title && multi)
      title.innerHTML = `<h3 class="fv-rv-title">${[...word].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join(``)}</h3>`;
    const info = el.querySelector(`.fv-rv-info`);
    if (info) info.innerHTML = this.infoHTML(run, run.best);
    if (!multi) {
      const forge = el.querySelector(`.fv-rv-forge`);
      if (forge && t >= 1) forge.insertAdjacentHTML(`afterbegin`, `<i class="fv-rv-rays"></i>${t >= 3 ? `<i class="fv-rv-rays b"></i>` : ``}`);
    } else this.burst(run, t);
    const a = this.audio;
    if (a) {
      if (t >= 2 && a.cardFlip) a.cardFlip(t);
      else a.loot(t);
      if (t >= 4) this.timers.push(setTimeout(() => a.levelUp?.(), 200));
    }
    if (t >= 3 && !calm) {
      const st = el.querySelector(`.fv-rv-stage`);
      st?.classList.add(`shake`);
    }
    this.readyAt = performance.now() + HOLD[t] * 1000;
  }

  /** x10, as in the theras-rpg-template video: a flash, then gold rings and a many-coloured sunburst come out of the best
   *  tile (the one Legendary, when there is one). The rays sit under the tiles, the rings over them. */
  private burst(run: ForgeRun, t: number): void {
    const el = this.el;
    const tile = el?.querySelector<HTMLElement>(`.fv-rv-grid [data-k="${run.best}"]`);
    if (!el || !tile) return;
    const r = tile.getBoundingClientRect();
    const at = `left:${(r.left + r.width / 2).toFixed(0)}px;top:${(r.top + r.height / 2).toFixed(0)}px`;
    // the rays take the colours of the rarities made, best first
    const cols = [...new Set([...run.items].sort((a, b) => b.tier - a.tier).map((e) => TIER_COLORS[e.tier]))];
    const seg = 15;
    const stops = Array.from({ length: 360 / seg }, (_, i) => {
      const c = cols[i % cols.length];
      return `color-mix(in srgb, ${c} 40%, transparent) ${i * seg}deg ${i * seg + 8}deg, transparent ${i * seg + 8}deg ${(i + 1) * seg}deg`;
    }).join(`, `);
    el.querySelector(`.fv-rv-burst`)?.remove();
    el.querySelector(`.fv-rv-rings`)?.remove();
    el.insertAdjacentHTML(
      `beforeend`,
      `<div class="fv-rv-burst t${t}" style="${at}"><i class="sun" style="background:conic-gradient(${stops})"></i><i class="glow"></i></div>
       <div class="fv-rv-rings" style="${at}"><i></i><i></i><i></i><b class="flash"></b></div>`,
    );
  }

  /** Removes the overlay (now: no fade, for a sheet that closed under it). */
  close(now = false): void {
    window.removeEventListener(`keydown`, this.onKey, true);
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const el = this.el;
    const done = this.done;
    this.el = this.run = this.audio = this.done = null;
    if (!el) return;
    const end = () => {
      el.remove();
      done?.();
    };
    if (now) end();
    else {
      el.classList.add(`out`);
      setTimeout(end, 160);
    }
  }

  /** During the hits a key skips to the end; after, any key closes (Keep). Keys do not reach the game. */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.el || !this.el.isConnected) {
      this.close(true);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (!this.finished) this.finish();
    else if (performance.now() >= this.readyAt) this.close();
  };

  /** x10: a click on a tile shows that piece in the info line and makes it the one Equip puts on. */
  private pick(k: number): void {
    const run = this.run;
    const el = this.el;
    if (!run || !el || !run.items[k]) return;
    this.sel = k;
    el.querySelectorAll(`.fv-rv-grid .itile`).forEach((x, i) => x.classList.toggle(`sel`, i === k));
    const info = el.querySelector(`.fv-rv-info`);
    if (info) info.innerHTML = this.infoHTML(run, k);
  }

  /** The name, rarity, stats, tool line and compare of piece k (and, x10, the "Made 10" counts). */
  private infoHTML(run: ForgeRun, k: number): string {
    const it = run.items[k];
    const n = run.items.length;
    const tool = toolLine(it);
    const made =
      n > 1
        ? `<p class="fv-rv-made">Made ${n}${[4, 3, 2, 1, 0]
            .map((t) => [t, run.items.filter((e) => e.tier === t).length] as const)
            .filter(([, c]) => c > 0)
            .map(([t, c]) => `<span style="--tc:${TIER_COLORS[t]}">${c} ${TIER_NAMES[t]}</span>`)
            .join(``)}</p>`
        : ``;
    const spent = `<p class="fv-rv-spent">Spent ${forgeNeeds(run.grade)
      .map((m) => `<span class="bz-ic">${gearIcons.lootHtml(m.ore)}</span>${num(m.n * n)}`)
      .join(` `)}${run.stop ? `<em>${esc(run.stop)}</em>` : ``}</p>`;
    return `<b class="nm" style="color:${TIER_COLORS[it.tier]}">${esc(it.name)}!</b>${made}
      <span class="rk" style="color:${TIER_COLORS[it.tier]}">${starsHTML(it.tier)} ${TIER_NAMES[it.tier]} ${lower(run.slot)}</span>
      <span class="st">${it.stats.map(([id, v]) => statLabel(id, v)).join(` · `)}</span>${tool ? `<span class="tl">${esc(tool)}</span>` : ``}
      ${this.cmpHTML(run, it)}${spent}`;
  }

  /** The compare line against what was worn in the slot before the make. */
  private cmpHTML(run: ForgeRun, it: GearItem): string {
    const w = run.worn;
    if (!w.item) return `<p class="fv-rv-cmp up">▲ Fills an empty ${lower(run.slot)} slot</p>`;
    const r = gearScore(it) / Math.max(1e-6, gearScore(w.item));
    const nm = esc(w.item.name);
    return r > 1.04
      ? `<p class="fv-rv-cmp up">▲ Stronger than your ${nm}</p>`
      : r < 0.96
        ? `<p class="fv-rv-cmp down">▼ Weaker than your ${nm}</p>`
        : `<p class="fv-rv-cmp same">About the same as your ${nm}</p>`;
  }

  /** The stage before the hits: (x10) the empty grid, the anvil with the hot material and the hammer. */
  private stageHTML(run: ForgeRun, multi: boolean, canEquip: boolean): string {
    const it = run.items[run.best];
    const n = run.items.length;
    const slots = multi
      ? `<div class="fv-rv-gridbox"><div class="fv-rv-grid" style="--cols:${Math.min(5, n)}">${run.items
          .map((_, i) => `<div class="itile slot" role="button" data-k="${i}"></div>`)
          .join(``)}</div></div>`
      : ``;
    return `<i class="fv-rv-bg"></i>
      <div class="fv-rv-fx"></div>
      <div class="fv-rv-stage">
        <div class="fv-rv-titlebox"></div>
        ${slots}
        <div class="fv-rv-forge">
          <i class="fv-rv-heat"></i>
          <div class="fv-rv-mat">${gearIcons.lootHtml(run.grade.ore)}</div>
          ${multi ? `` : `<div class="fv-rv-item"><i class="shock"></i><i class="shock b"></i>${iconOf(it)}</div>`}
          ${HAMMER}${ANVIL}
          <div class="fv-rv-bits"></div>
        </div>
        ${multi ? `<p class="fv-rv-count">0 / ${n}</p>` : ``}
        <div class="fv-rv-info"></div>
        <div class="fv-rv-acts">${canEquip ? `<button type="button" class="eq" data-rv="equip">Equip</button>` : ``}<button type="button" class="keep" data-rv="keep">Keep</button></div>
      </div>`;
  }

  /** Confetti and twinkles for the rarer results (inserted when the result shows). */
  private fxHTML(t: number, calm: boolean, multi: boolean): string {
    const gold = [`#ffc23d`, `#fff6e5`, `#ffe08a`, TIER_COLORS[t], `#ff7aa8`];
    const mixed = [TIER_COLORS[t], `#ffc23d`, `#fff6e5`, `#ff7aa8`, `#5fc8ff`];
    const confN = calm ? 0 : [0, 0, 18, 34, 56][t];
    const conf = Array.from({ length: confN }, (_, i) => {
      const c = (t >= 4 ? gold : mixed)[i % 5];
      return `<i style="--x:${rnd(0, 100, 1)}%;--s:${rnd(6, 14, 1)}px;--c:${c};--t:${rnd(1.8, 3.4)}s;--w:${rnd(0, t >= 3 ? 2.4 : 0.5)}s;--dx:${rnd(-70, 70, 0)}px;--n:${t >= 3 ? `infinite` : 1}"></i>`;
    }).join(``);
    const sparkN = calm ? 0 : [2, 5, 9, 13, 18][t];
    const sparks = Array.from(
      { length: sparkN },
      () => `<i style="--x:${rnd(6, 94, 1)}%;--y:${rnd(6, 88, 1)}%;--s:${rnd(10, 24, 0)}px;--w:${rnd(0, 1.2)}s"></i>`,
    ).join(``);
    return `<div class="fv-rv-spark">${sparks}</div><div class="fv-rv-conf">${conf}</div>${t >= 2 && !multi ? `<i class="fv-rv-flash"></i>` : ``}`;
  }
}
