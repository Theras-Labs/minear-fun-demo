// Port of play-inUT-NSi.js 57680-58352: the in-game HUD controller EM (and its helpers xM, SM, CM, wM, TM).
// It drives the DOM HUD that index.html already holds (#wallet, #compass, #dock, #hp, #floaters, #foebars,
// #toasts, #banner, #flash, #hurtfx, #vignette, #crosshair, #hint, markers, #jet, #ult, #belt, #buffs, #talk,
// #bossbar, #ko, #pause .roster) from a state object and a per-frame info object: coin counter, gem bag count,
// compass strip and pips, depth, Fortune and PvP band, buffs, belt, jetpack ring, ult meter, crosshair, HP bar,
// hurt / KO overlays, hint line, vignette, flash, edge markers, floating text, foe bars, boss bar, toasts,
// banner, roster, the Stranger's talk box (typewriter) and the lodestone flight.
// KR makes it once (ui = new EM(), 70096) and calls update(dt, state, frame) from updateHud (75141).
//
// The gear / loot icon cache _M (57538-57669, offscreen icon studio) is not ported here: the HUD reads it
// through `icons` (HudIcons). Until it is set, `icons` gives the no-image fallbacks of _M.html / _M.lootHtml.
import { beltSlots } from '../state/belt';
import * as THREE from 'three';
import { IS_TOUCH } from '../game/device';
import { ITEMS, type Rarity } from '../world/items';
import type { CombatUi, FoeBar } from '../combat/combat';
import { starsHTML } from './stars';

/** xM (57680): querySelector. */
const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T; // xM (57680)

/** SM (57681): HTML escape. */
export const escapeHtml = (s: unknown): string => // SM (57681)
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;`, "'": `&#39;` })[c as '&'],
  );

/** MINEAR: the padlock drawn in a locked belt slot. */
const BELT_LOCK =
  `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="#8a7560" stroke="#3a281c" stroke-width="2"/>` +
  `<path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="#3a281c" stroke-width="2.2"/></svg>`;
/** CM (57686): most toasts on screen. */
const MAX_TOASTS = 5; // CM (57686)

/** wM (57687): gem toast rarity label and color. */
const RARITY_LABEL: Record<Rarity, [string, string]> = { // wM (57687)
  common: [`gem`, ``],
  uncommon: [`Uncommon`, `#17703a`],
  rare: [`Rare`, `#1d58a6`],
  epic: [`Epic`, `#6a31b5`],
  legendary: [`Legendary`, `#875300`],
  mythic: [`Mythic`, `#93226f`],
};

/** TM (57695): gear tier text colors on toasts. */
const TIER_TEXT = [`#3a281c`, `#17703a`, `#1d58a6`, `#6a31b5`, `#875300`]; // TM (57695)

// Copies of small constants owned by modules not ported yet (the gear tables and the player state Fj).
/** vk (50631): gear tier names. */
const TIER_NAMES = [`Common`, `Uncommon`, `Rare`, `Epic`, `Legendary`]; // vk (50631)
/** yk (50632): gear tier colors. */
const TIER_COLORS = [`#e9eef5`, `#7be08f`, `#5fb4ff`, `#c38bff`, `#ffc23d`]; // yk (50632)
/** Dj (54313): Flask of Strength / Fortune Cookie length, ms. */
const STRENGTH_MS = 12e4; // Dj (54313)
/** Oj (54314): Flask of Strength damage multiplier. */
const STRENGTH_MUL = 1.3; // Oj (54314)
/** kj (54315): Ult Juice charge multiplier. */
const JUICE_MUL = 1.5; // kj (54315)
/** Aj (54316): Ult Juice length, ms. */
const JUICE_MS = 3e5; // Aj (54316)

/** The parts of the gear icon cache _M (57538) that the HUD calls. */
export interface HudIcons {
  /** _M.html(itemOrBaseId) (57656): gear icon tile content. */
  html(item: string | { base: string }): string;
  /** _M.lootHtml(itemId) (57663): loot (gem, supply) icon content. */
  lootHtml(id: string): string;
}

/** mM (57528) */
const OUTLINE = `#3a281c`; // mM (57528)
/** hM (57529): fallback slot SVGs. */
const SLOT_SVG: Record<string, string> = { // hM (57529)
  head: `<path d="M8 30 C8 16 16 9 24 9 C32 9 40 16 40 30 Z" fill="#ffb23f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M4 30 H44 V35 H4 Z" fill="#e39a14" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="20" r="4" fill="#fff6c8" stroke="${OUTLINE}" stroke-width="2.5"/>`,
  body: `<path d="M14 8 H34 L42 42 H6 Z" fill="#5c60c8" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M18 8 C18 14 30 14 30 8" fill="none" stroke="${OUTLINE}" stroke-width="3"/>`,
  drill: `<path d="M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z" fill="#fff1d6" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z" fill="#fff1d6" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><path d="M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z" fill="#fff1d6" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/>`, // MINEAR: a mole claw
  launcher: `<path d="M8 20 H34 V28 H8 Z" fill="#8c5c37" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M34 12 C42 16 42 32 34 36" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M14 28 L12 38" stroke="${OUTLINE}" stroke-width="4" stroke-linecap="round"/>`,
  pack: `<rect x="10" y="10" width="12" height="28" rx="6" fill="#6fa3d6" stroke="${OUTLINE}" stroke-width="3"/><rect x="26" y="10" width="12" height="28" rx="6" fill="#6fa3d6" stroke="${OUTLINE}" stroke-width="3"/>`,
  charm: `<circle cx="24" cy="26" r="14" fill="#ffc23d" stroke="${OUTLINE}" stroke-width="3"/><path d="M24 4 V12" stroke="${OUTLINE}" stroke-width="3"/><path d="M18 26 L24 18 L30 26 L24 34 Z" fill="#fff6e5" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
};

/**
 * The no-image branches of _M.html and _M.lootHtml (57656-57668). `slotOf` stands for QA[base]?.slot (the gear
 * base table, not ported yet); without it every gear icon is the charm SVG.
 */
export function fallbackIcons(slotOf: (base: string) => string | undefined = () => undefined): HudIcons {
  return {
    html(item) {
      const base = typeof item == `string` ? item : item.base;
      return `<svg viewBox="0 0 48 48">${SLOT_SVG[slotOf(base) ?? `charm`]}</svg>`;
    },
    lootHtml(id) {
      const color = (ITEMS as Record<string, { color: number }>)[id]?.color ?? 16777215;
      return `<svg viewBox="0 0 48 48"><path d="M24 6 L36 18 L24 42 L12 18 Z" fill="${`#` + color.toString(16).padStart(6, `0`)}" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/></svg>`;
    },
  };
}

/** The player state fields EM.update reads (Fj, 54340-55309). */
export interface HudState {
  coins: number;
  /** Gem bag slots in use. */
  used: number;
  capacity: number;
  /** Gear items; `fresh` marks one not seen yet. */
  items: { fresh?: boolean }[];
  level: number;
  deepest: number;
  /** Belt slots 1-4: supply id or null. */
  belt: (string | null)[];
  /** MINEAR: skill tree levels (the `belt` node opens more belt slots, src/state/belt.ts). */
  tree?: Record<string, number>;
  supplies: Record<string, number>;
  /** Absolute end times (Date.now() ms). */
  buffs: { strength: number; cookies: number[]; juice: number };
}

/** The beast pip: compass bearing in degrees, CSS color, pulse while the lodestone shows the way. */
export interface HudBeast {
  b: number;
  color: string;
  pulse: boolean;
}

/** Compass input (updateCompass 57905): bearings in degrees, null hides a pip. */
export interface HudCompass {
  heading: number;
  home: number | null;
  loot: number | null;
  beast: HudBeast | null;
}

/** An edge marker (marker 58082). `left` (seconds) adds a countdown. */
export interface HudMarker {
  show: boolean;
  x: number;
  y: number;
  angle: number;
  dist: number;
  left?: number;
}

/** The frame object KR passes to EM.update (75141-75173). */
export interface HudFrame {
  fuel: number;
  fuelMax: number;
  jet: { x: number; y: number; show: boolean };
  compass: HudCompass;
  depth: number;
  fortune: number;
  /** PvP level band (uw) or null (safe). */
  pvp: number | null;
  underground: number;
  cross: string;
  drilling: boolean;
  hint: string;
  home: HudMarker;
  loot: HudMarker;
  hp: number;
  hpMax: number;
  hurt: number;
  ko: number;
  camera: THREE.Camera;
  w: number;
  h: number;
}

/** A gear item as the item toast reads it. */
export interface HudGearItem {
  uid: number | string;
  base: string;
  name: string;
  tier: number;
}

export interface HudSoul {
  color?: string;
  /** 2 given, 1 carried. */
  state?: number;
}

export interface HudTalkOptions {
  /** Calls fn once the typewriter reaches index `at` (or on skip / hide). */
  cue?: { at: number; fn: () => void };
  /** Voice blip: true for an ellipsis dot. */
  voice?: (ellipsis: boolean) => void;
  life?: number;
}

export interface HudToastOptions {
  add?: number;
  life?: number;
  cls?: string;
  tc?: string;
}

export interface HudRosterEntry {
  name: string;
  lvl?: number;
  you?: boolean;
}

/** lodestone(opts): land(inView) when the mote reaches the compass; seen() when the beast comes into view. */
export interface HudLodestoneOptions {
  land(inView: boolean): void;
  seen(): void;
}

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
}

interface LiveToast {
  el: HTMLElement;
  text: HTMLElement;
  n: number;
  t: number;
  label: (n: number) => string;
}

interface Lode extends HudLodestoneOptions {
  t: number;
  x0: number;
  y0: number;
  landed: boolean;
  wait: number;
  off: boolean;
}

interface BuffShown {
  id: `strength` | `cookie` | `ultjuice`;
  left: number;
  of: number;
}

const proj = new THREE.Vector3(); // the `new I()` of update (57823) and foeBars (57871)

export class Hud implements CombatUi { // EM (57696)
  /** The gear icon cache _M (57538); fallback SVGs until the lead sets it. */
  icons: HudIcons = fallbackIcons();

  coinsEl = $(`#coins b`);
  coinsBox = $(`#coins`);
  crystEl = $(`#crystals b`);
  crystBox = $(`#crystals`);
  shownGems = ``;
  compassStrip = $(`#compass .strip`);
  compassDeg = $(`#compass .deg`);
  compassBand = $(`#compass .band`);
  pipHome = $(`#compass .pip.home`);
  pipLoot = $(`#compass .pip.loot`);
  pipBeast = $(`#compass .pip.beast`);
  beastColor = ``;
  shownDeg = -1;
  tabNew = $(`#vitals .new`);
  shownNew = -1;
  boss = $(`#bossbar`);
  bossBar = $(`#bossbar .bar i`);
  bossLag = $(`#bossbar .bar s`);
  bossName = $(`#bossbar b`);
  depthEl = $(`#depth .now b`);
  depthBox = $(`#depth`);
  deepestShown = ``;
  fortEl = $(`#wallet .fort`);
  pvpEl = $(`#wallet .pvp`);
  fortShown = -1;
  pvpShown = -2;
  buffsEl = $(`#buffs`);
  buffsShown = ``;
  jetEl = $(`#jet`);
  jetFill = document.querySelector(`#jet .fill`) as SVGElement;
  jetShown = false;
  ultEl = $(`#ult`);
  ultShown = ``;
  cross = $(`#crosshair`);
  hintEl = $(`#hint`);
  toastsEl = $(`#toasts`);
  bannerEl = $(`#banner`);
  flashEl = $(`#flash`);
  vignette = $(`#vignette`);
  home = $(`#home-marker`);
  lootMark = $(`#loot-marker`);
  cards = [`#wallet`, `#goal`, `#dock`].map((s) => $(s));
  hpBox = $(`#hp`);
  hpFill = $(`#hp i`);
  hpLag = $(`#hp s`);
  hpText = $(`#hp b`);
  hurtFx = $(`#hurtfx`);
  koEl = $(`#ko`);
  foebarsEl = $(`#foebars`);
  foebarPool: HTMLElement[] = [];
  hitT = 0;
  shownHp = ``;
  floatersEl = $(`#floaters`);
  startEl = $(`#start`);
  pauseEl = $(`#pause`);
  rosterEl = $(`#pause .roster`);
  rosterKey = ``;
  shownCoins = 0;
  floaters: Floater[] = [];
  flashV = 0;
  hintText = ``;
  live = new Map<string, LiveToast>();

  /** update (57759): one HUD frame. */
  update(dt: number, s: HudState, f: HudFrame): void {
    this.uiDt = dt;
    if (this.shownCoins !== s.coins) {
      const diff = s.coins - this.shownCoins;
      const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 6)));
      this.shownCoins = Math.abs(step) >= Math.abs(diff) ? s.coins : this.shownCoins + step;
      this.coinsEl.textContent = this.shownCoins.toLocaleString();
    }
    const gems = `${s.used}/${s.capacity}`;
    if (gems !== this.shownGems) {
      this.shownGems = gems;
      this.crystEl.textContent = gems;
      this.crystBox.classList.toggle(`full`, s.used >= s.capacity);
    }
    this.updateCompass(f.compass);
    let fresh = 0;
    for (const it of s.items) if (it.fresh) fresh++;
    if (fresh !== this.shownNew) {
      this.shownNew = fresh;
      this.tabNew.textContent = fresh ? `${fresh} new` : ``;
    }
    const depth = String(Math.max(0, Math.round(f.depth)));
    if (this.depthEl.textContent !== depth) this.depthEl.textContent = depth;
    const fort = Math.floor(f.fortune);
    if (fort !== this.fortShown) {
      this.fortShown = fort;
      this.fortEl.querySelector(`b`)!.textContent = `+${fort}%`;
      this.fortEl.classList.toggle(`hot`, fort >= 100 && fort < 300);
      this.fortEl.classList.toggle(`blaze`, fort >= 300);
    }
    const band = f.pvp ?? -1;
    const pvpKey = band >= 0 ? band * 1e5 + s.level : -1;
    if (pvpKey !== this.pvpShown) {
      this.pvpShown = pvpKey;
      this.pvpEl.classList.toggle(`safe`, band < 0);
      this.pvpEl.querySelector(`b`)!.textContent = band >= 0 ? `lv ${Math.max(1, s.level - band)}–${s.level + band}` : `safe`;
    }
    const deepest = `Depth (the deepest you've been: ${Math.round(s.deepest)} m)`;
    if (deepest !== this.deepestShown) this.depthBox.title = this.deepestShown = deepest;
    this.updateBelt(s);
    this.updateBuffs(s);
    const fuel = Math.max(0, Math.min(1, f.fuel / f.fuelMax));
    const jetOn = f.jet.show && fuel < 0.995;
    if (jetOn !== this.jetShown) {
      this.jetShown = jetOn;
      this.jetEl.classList.toggle(`show`, jetOn);
    }
    this.jetEl.style.transform = `translate(${f.jet.x.toFixed(1)}px, ${f.jet.y.toFixed(1)}px)`;
    this.jetFill.style.strokeDashoffset = (106.8 * (1 - fuel)).toFixed(2);
    this.jetEl.classList.toggle(`low`, fuel < 0.25);
    this.jetEl.classList.toggle(`empty`, fuel <= 0.001);
    this.hitT -= dt;
    this.cross.className = `${f.cross}${f.drilling ? ` drilling` : ``}${this.hitT > 0 ? ` hit` : ``}`;
    const hp = Math.max(0, Math.ceil(f.hp));
    const hpText = `${hp} / ${f.hpMax}`;
    if (hpText !== this.shownHp) {
      this.shownHp = hpText;
      this.hpText.textContent = hpText;
      const w = `${Math.min(1, hp / f.hpMax) * 100}%`;
      this.hpFill.style.width = w;
      this.hpLag.style.width = w;
      this.hpBox.classList.toggle(`low`, hp / f.hpMax < 0.3);
    }
    this.hurtFx.style.opacity = f.hurt.toFixed(3);
    this.koEl.style.opacity = f.ko.toFixed(3);
    if (f.hint !== this.hintText) {
      this.hintText = f.hint;
      if (f.hint) this.hintEl.innerHTML = f.hint;
      this.hintEl.classList.toggle(`show`, !!f.hint);
    }
    this.vignette.style.opacity = String(f.underground * 0.9);
    this.flashV = Math.max(0, this.flashV - dt * 2.5);
    this.flashEl.style.opacity = String(this.flashV);
    this.marker(this.home, f.home);
    this.marker(this.lootMark, f.loot);
    const m = proj;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const r = this.floaters[i];
      r.age += dt;
      if (r.age > r.life) {
        r.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      m.copy(r.pos);
      m.y += r.age * (r.life > 1.5 ? 0.45 : 1.2);
      m.project(f.camera);
      if (m.z > 1) {
        r.el.style.opacity = `0`;
        continue;
      }
      const x = (m.x * 0.5 + 0.5) * f.w;
      const y = (-m.y * 0.5 + 0.5) * f.h;
      const k = r.age / r.life;
      const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, k - 0.15);
      r.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${sc})`;
      r.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
    if (this.talkT > 0) {
      if (this.talkN < this.talkFull.length) this.typeTalk(dt);
      else {
        this.talkT -= dt;
        if (this.talkT <= 0) this.talkEl.classList.remove(`show`);
      }
    }
    for (const [key, t] of this.live) {
      t.t -= dt;
      if (!(t.t > 0)) {
        this.live.delete(key);
        this.dismiss(t.el);
      }
    }
  }

  /** fortuneBump (57853): restarts the Fortune band's bump animation. */
  fortuneBump(): void {
    this.fortEl.classList.remove(`bump`);
    void this.fortEl.offsetWidth;
    this.fortEl.classList.add(`bump`);
  }

  /** hitMarker (57858): the crosshair `hit` class for 0.12 s. */
  hitMarker(): void {
    this.hitT = 0.12;
  }

  /** foeBars (57861): one bar per foe over its head, pooled. */
  foeBars(bars: FoeBar[], camera: THREE.Camera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    while (this.foebarPool.length < bars.length) {
      const el = document.createElement(`div`);
      el.className = `foebar`;
      el.appendChild(document.createElement(`i`));
      this.foebarsEl.appendChild(el);
      this.foebarPool.push(el);
    }
    const p = proj;
    this.foebarPool.forEach((el, i) => {
      const b = bars[i];
      if (!b) {
        el.style.display = `none`;
        return;
      }
      if ((p.copy(b.pos).project(camera), p.z > 1)) {
        el.style.display = `none`;
        return;
      }
      el.style.display = ``;
      el.style.transform = `translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      (el.firstElementChild as HTMLElement).style.width = `${Math.max(0, b.frac) * 100}%`;
    });
  }

  /** PPD (57887): compass pixels per degree. */
  static PPD = 4;
  compassBuilt = false;
  compassW = 0;

  /** buildCompass (57890): ticks every 5 degrees over -180..540, labels every 15 / 45 degrees. */
  buildCompass(): void {
    const dirs: Record<number, string> = { 0: `N`, 45: `NE`, 90: `E`, 135: `SE`, 180: `S`, 225: `SW`, 270: `W`, 315: `NW` };
    let html = ``;
    for (let d = -180; d <= 540; d += 5) {
      const x = (d + 180) * Hud.PPD;
      const a = ((d % 360) + 360) % 360;
      html += `<i class="tick${a % 45 == 0 ? ` big` : a % 15 == 0 ? ` mid` : ``}" style="left:${x}px"></i>`;
      if (a % 45 == 0)
        html += `<span class="lab dir${a % 90 == 0 ? ` cardinal` : ``}${a === 0 ? ` n` : ``}" style="left:${x}px">${dirs[a]}</span>`;
      else if (a % 15 == 0) html += `<span class="lab" style="left:${x}px">${a}</span>`;
    }
    this.compassStrip.innerHTML = html;
    this.compassBuilt = true;
    addEventListener(`resize`, () => (this.compassW = 0));
  }

  /** updateCompass (57905) */
  updateCompass(c: HudCompass): void {
    if (!this.compassBuilt) this.buildCompass();
    this.compassW ||= this.compassBand.clientWidth;
    const w = this.compassW;
    const ppd = Hud.PPD;
    const heading = ((c.heading % 360) + 360) % 360;
    this.compassStrip.style.transform = `translateX(${Math.round(w / 2 - (heading + 180) * ppd)}px)`;
    const deg = Math.round(heading) % 360;
    if (deg !== this.shownDeg) {
      this.shownDeg = deg;
      this.compassDeg.textContent = `${deg}°`;
    }
    const pip = (el: HTMLElement, b: number | null) => {
      const off = b === null ? 999 : ((((b - heading) % 360) + 540) % 360) - 180;
      const x = w / 2 + off * ppd;
      if (Math.abs(off) * ppd > w / 2 - 8) {
        el.style.display = `none`;
        return;
      }
      el.style.display = `block`;
      el.style.left = `${Math.round(x)}px`;
    };
    pip(this.pipHome, c.home);
    pip(this.pipLoot, c.loot);
    pip(this.pipBeast, c.beast ? c.beast.b : null);
    if (this.lode) this.updateLode(c.beast, heading, w);
    if (this.ringT > 0) {
      this.ringT -= this.uiDt;
      this.lodeRing!.style.left = `${Math.round(this.lodeAim(c.beast, heading, w).ax)}px`;
    }
    if (c.beast && c.beast.color !== this.beastColor) {
      this.beastColor = c.beast.color;
      this.pipBeast.style.setProperty(`--c`, c.beast.color);
    }
    this.pipBeast.classList.toggle(`pulse`, !!c.beast?.pulse);
  }

  lode: Lode | null = null;
  lodeMote: HTMLElement | null = null;
  lodeRing: HTMLElement | null = null;
  lodeEdge: HTMLElement | null = null;
  uiDt = 0;
  ringT = 0;

  /** lodeAim (57941): where on the compass band the beast mark sits (clamped to 30% of the width). */
  lodeAim(beast: HudBeast | null, heading: number, w: number) {
    const off = beast ? ((((beast.b - heading) % 360) + 540) % 360) - 180 : 0;
    const reach = w * 0.3;
    const inView = !!beast && Math.abs(off * Hud.PPD) <= reach;
    const side = off < 0 ? -1 : 1;
    return { ax: w / 2 + (beast ? (inView ? off * Hud.PPD : side * reach) : 0), inView, side, reach };
  }

  /** lodestone (57948): a mote flies from the talk box to the compass. */
  lodestone(opts: HudLodestoneOptions): void {
    const box = this.talkEl.getBoundingClientRect();
    const make = (cls: string, parent: Element) => {
      const el = document.createElement(`i`);
      el.className = cls;
      parent.appendChild(el);
      return el;
    };
    this.lodeMote ??= make(`lodemote`, document.body);
    this.lodeRing ??= make(`lodering`, $(`#compass`));
    this.lodeEdge ??= make(`lodeedge`, $(`#compass`));
    const color = this.beastColor || `#d8b8ff`;
    for (const el of [this.lodeMote, this.lodeRing, this.lodeEdge]) el.style.setProperty(`--c`, color);
    this.lodeMote.style.display = `block`;
    this.lode = {
      t: 0,
      x0: box.width ? box.left + box.width / 2 : innerWidth / 2,
      y0: box.height ? box.top + 6 : innerHeight * 0.7,
      landed: false,
      wait: 0,
      off: false,
      ...opts,
    };
  }

  /** updateLode (57970): the mote's Bezier flight, then the edge arrow until the beast is in view. */
  updateLode(beast: HudBeast | null, heading: number, w: number): void {
    const r = this.lode!;
    r.t += this.uiDt;
    const { ax, inView, side, reach } = this.lodeAim(beast, heading, w);
    const band = this.compassBand.getBoundingClientRect();
    const tx = band.left + ax;
    const ty = band.bottom - 6;
    const ring = () => {
      const el = this.lodeRing!;
      el.style.left = `${Math.round(ax)}px`;
      this.ringT = 1.2;
      el.classList.remove(`go`);
      void el.offsetWidth;
      el.classList.add(`go`);
    };
    if (!r.landed) {
      const t = Math.min(1, r.t / 1.55);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const sway = (beast ? side : 1) * innerWidth * 0.16;
      const c1x = r.x0 + sway;
      const c1y = r.y0 - innerHeight * 0.1;
      const c2x = tx + sway * 0.5;
      const c2y = ty + innerHeight * 0.3;
      const u = 1 - e;
      const x = u * u * u * r.x0 + 3 * u * u * e * c1x + 3 * u * e * e * c2x + e * e * e * tx;
      const y = u * u * u * r.y0 + 3 * u * u * e * c1y + 3 * u * e * e * c2y + e * e * e * ty;
      const mote = this.lodeMote!;
      mote.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(1.5 - 0.8 * e).toFixed(2)})`;
      const spark = document.createElement(`i`);
      spark.className = `lodespark`;
      spark.style.setProperty(`--c`, mote.style.getPropertyValue(`--c`));
      spark.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      spark.addEventListener(`animationend`, () => spark.remove());
      document.body.appendChild(spark);
      this.pipBeast.style.visibility = `hidden`;
      if (t < 1) return;
      r.landed = true;
      r.off = !inView;
      r.wait = 14;
      mote.style.display = `none`;
      this.pipBeast.style.visibility = ``;
      ring();
      r.land(inView);
      return;
    }
    r.wait -= this.uiDt;
    const edge = this.lodeEdge!;
    const showEdge = !inView && !!beast && r.wait > 0;
    edge.style.display = showEdge ? `block` : `none`;
    if (showEdge) {
      edge.style.left = `${Math.round(w / 2 + side * (reach + 16))}px`;
      edge.classList.toggle(`left`, side < 0);
    }
    if (inView && r.off) {
      ring();
      r.seen();
    }
    if (inView || r.wait <= 0) {
      edge.style.display = `none`;
      this.lode = null;
    }
  }

  beltEl = $(`#belt`);
  beltShown = ``;

  /** updateBelt (58029). MINEAR: the belt sits in the bottom bar and always shows; only the open slots
   *  (src/state/belt.ts) take items, the others show a lock until the skill tree opens them. */
  updateBelt(s: HudState): void {
    const open = beltSlots(s);
    const key = `${open}|` + s.belt.map((id) => (id ? `${id}:${s.supplies[id] ?? 0}` : `-`)).join(`|`);
    if (key === this.beltShown) return;
    this.beltShown = key;
    this.beltEl.classList.remove(`hidden`);
    this.beltEl.querySelectorAll<HTMLElement>(`.bslot`).forEach((slot, i) => {
      const locked = i >= open;
      const id = locked ? null : s.belt[i];
      const n = id ? (s.supplies[id] ?? 0) : 0;
      slot.classList.toggle(`locked`, locked);
      slot.classList.toggle(`empty`, !id);
      slot.classList.toggle(`out`, !!id && n <= 0);
      slot.title = locked ? `Locked belt slot: open it with Belt Loops in the skill tree (at base)` : id ? `` : `Empty belt slot: put a bomb or tonic here from your gear (Tab)`;
      slot.querySelector(`.ic`)!.innerHTML = locked ? BELT_LOCK : id ? this.icons.lootHtml(id) : ``;
      slot.querySelector(`b`)!.textContent = id ? String(n) : ``;
    });
  }

  /** updateBuffs (58046): an icon per running buff with its ring and m:ss countdown. */
  updateBuffs(s: HudState): void {
    const now = Date.now();
    const list: BuffShown[] = [];
    if (s.buffs.strength > now) list.push({ id: `strength`, left: s.buffs.strength - now, of: STRENGTH_MS });
    for (const end of s.buffs.cookies) if (end > now) list.push({ id: `cookie`, left: end - now, of: STRENGTH_MS });
    if (s.buffs.juice > now) list.push({ id: `ultjuice`, left: s.buffs.juice - now, of: JUICE_MS });
    const key = list.map((b) => `${b.id}:${Math.ceil(b.left / 1e3)}`).join(`|`);
    if (key === this.buffsShown) return;
    if (list.map((b) => b.id).join(`|`) !== this.buffsShown.replace(/:\d+/g, ``)) {
      const titles = {
        strength: `Flask of Strength: +${Math.round((STRENGTH_MUL - 1) * 100)}% damage`,
        cookie: `Fortune Cookie: +35% Fortune`,
        ultjuice: `Ult Juice: your Burrow Slam charges ${Math.round((JUICE_MUL - 1) * 100)}% faster`,
      };
      const colors = { strength: `#ff4a3a`, cookie: `#ffd36b`, ultjuice: `#b59cff` };
      this.buffsEl.innerHTML = list
        .map(
          (b) =>
            `<div class="buff" title="${titles[b.id]}" style="--c:${colors[b.id]}"><span class="ic">${this.icons.lootHtml(b.id)}</span><b></b></div>`,
        )
        .join(``);
    }
    this.buffsShown = key;
    this.buffsEl.querySelectorAll<HTMLElement>(`.buff`).forEach((el, i) => {
      const sec = Math.ceil(list[i].left / 1e3);
      el.style.setProperty(`--p`, (list[i].left / list[i].of).toFixed(3));
      el.classList.toggle(`ending`, sec <= 10);
      el.querySelector(`b`)!.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, `0`)}`;
    });
  }

  /** beltFlash (58078): restarts the `use` animation on belt slot i. */
  beltFlash(i: number): void {
    const slot = this.beltEl.querySelectorAll<HTMLElement>(`.bslot`)[i];
    if (!slot) return;
    slot.classList.remove(`use`);
    void slot.offsetWidth;
    slot.classList.add(`use`);
  }

  /** marker (58082): places an edge marker, pushed out of the HUD cards by 34 px. */
  marker(el: HTMLElement, m: HudMarker): void {
    el.style.opacity = m.show ? `1` : `0`;
    if (!m.show) return;
    let x = m.x;
    let y = m.y;
    for (const card of this.cards) {
      if (card.id === `goal` && !card.classList.contains(`show`)) continue;
      const r = card.getBoundingClientRect();
      if (x < r.left - 34 || x > r.right + 34 || y < r.top - 34 || y > r.bottom + 34) continue;
      const toLeft = x - (r.left - 34);
      const toRight = r.right + 34 - x;
      const toBottom = r.bottom + 34 - y;
      const toTop = y - (r.top - 34);
      const leftHalf = r.left + r.width / 2 < window.innerWidth / 2;
      const topHalf = r.top + r.height / 2 < window.innerHeight / 2;
      if ((leftHalf ? toRight : toLeft) < (topHalf ? toBottom : toTop)) x = leftHalf ? r.right + 34 : r.left - 34;
      else y = topHalf ? r.bottom + 34 : r.top - 34;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    (el.querySelector(`.arrow`) as HTMLElement).style.transform = `rotate(${m.angle}rad)`;
    let text = `${Math.round(m.dist)}m`;
    if (m.left !== undefined) {
      const sec = Math.max(0, Math.ceil(m.left));
      text += ` · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, `0`)}`;
    }
    el.querySelector(`em`)!.textContent = text;
    el.classList.toggle(`fading`, m.left !== undefined && m.left < 60);
  }

  talkEl = $(`#talk`);
  talkShown = document.createElement(`span`);
  talkRest = document.createElement(`span`);
  talkT = 0;
  talkFull = ``;
  talkN = 0;
  talkWait = 0;
  talkLife = 0;
  talkVoice: ((ellipsis: boolean) => void) | null = null;

  /** talk (58119): the Stranger's line with a typewriter; souls shows the four soul pips. */
  talk(text: string, souls?: HudSoul[] | null, opts: HudTalkOptions = {}): void {
    this.fireCue();
    this.talkCue = opts.cue ?? null;
    const line = this.talkEl.querySelector(`.line`)!;
    if (!this.talkRest.parentNode) {
      this.talkRest.className = `rest`;
      line.replaceChildren(this.talkShown, this.talkRest);
    }
    this.talkFull = text;
    this.talkN = 0;
    this.talkWait = 0.3;
    this.talkShown.textContent = ``;
    this.talkRest.textContent = text;
    this.talkVoice = opts.voice ?? null;
    this.talkLife = opts.life ?? 3.5 + text.length * 0.045;
    const box = this.talkEl.querySelector(`.souls`) as HTMLElement;
    box.style.display = souls ? `` : `none`;
    this.talkEl.querySelectorAll<HTMLElement>(`.souls i`).forEach((el, i) => {
      const soul = souls?.[i];
      el.style.display = soul ? `` : `none`;
      el.style.setProperty(`--c`, soul?.color ?? `#fff`);
      el.className = soul?.state === 2 ? `given` : soul?.state === 1 ? `carried` : ``;
    });
    this.talkEl.classList.add(`show`);
    this.talkT = Infinity;
  }

  get talking(): boolean {
    return this.talkT > 0;
  }

  get typing(): boolean {
    return this.talkT > 0 && this.talkN < this.talkFull.length;
  }

  /** talkSkip (58147): shows the whole line at once. */
  talkSkip(): void {
    this.fireCue();
    this.talkN = this.talkFull.length;
    this.talkShown.textContent = this.talkFull;
    this.talkRest.textContent = ``;
    this.talkT = this.talkLife;
  }

  /** talkHide (58154) */
  talkHide(): void {
    this.fireCue();
    this.talkT = 0;
    this.talkN = this.talkFull.length;
    this.talkEl.classList.remove(`show`);
  }

  talkCue: { at: number; fn: () => void } | null = null;

  /** fireCue (58161) */
  fireCue(): void {
    const cue = this.talkCue;
    this.talkCue = null;
    cue?.fn();
  }

  /** typeTalk (58165): the typewriter with pauses after punctuation and a voice blip every third letter. */
  typeTalk(dt: number): void {
    const t = this.talkFull;
    this.talkWait -= dt;
    let typed = false;
    while (this.talkWait <= 0 && this.talkN < t.length) {
      const i = this.talkN++;
      const ch = t[i];
      typed = true;
      const ellipsis = ch === `.` && (t[i + 1] === `.` || t[i - 1] === `.`);
      if (ellipsis) this.talkWait += 0.42;
      else if (ch === `.` || ch === `!` || ch === `?`) this.talkWait += 0.32;
      else if (ch === `,` || ch === `;` || ch === `:`) this.talkWait += 0.16;
      else this.talkWait += 0.034;
      if (ellipsis) this.talkVoice?.(true);
      else if (/[a-z0-9]/i.test(ch) && i % 3 == 0) this.talkVoice?.(false);
    }
    if (typed) {
      this.talkShown.textContent = t.slice(0, this.talkN);
      this.talkRest.textContent = t.slice(this.talkN);
    }
    if (this.talkCue && this.talkN >= this.talkCue.at) this.fireCue();
    if (this.talkN >= t.length) this.talkT = this.talkLife;
  }

  /** bumpCoins (58189) */
  bumpCoins(): void {
    this.coinsBox.classList.remove(`bump`);
    void this.coinsBox.offsetWidth;
    this.coinsBox.classList.add(`bump`);
  }

  /** bumpCrystals (58194) */
  bumpCrystals(): void {
    this.crystBox.classList.remove(`bump`);
    void this.crystBox.offsetWidth;
    this.crystBox.classList.add(`bump`);
  }

  /** bossBarSet (58199): frac < 0 hides the bar; kind is an extra class on #bossbar. */
  bossBarSet(frac: number, name = `THE WORM`, kind = ``): void {
    const show = frac >= 0;
    this.boss.classList.toggle(`show`, show);
    if (!show) return;
    if (this.boss.dataset.kind !== kind) {
      if (this.boss.dataset.kind) this.boss.classList.remove(this.boss.dataset.kind);
      if (kind) this.boss.classList.add(kind);
      this.boss.dataset.kind = kind;
    }
    this.bossName.textContent = name;
    const w = `${Math.max(0, frac) * 100}%`;
    this.bossBar.style.width = w;
    this.bossLag.style.width = w;
  }

  /** toast (58210): a toast per key; the same key again adds to its count and bumps it. */
  toast(key: string, icon: string, label: (n: number) => string, opts: HudToastOptions = {}): void {
    const add = opts.add ?? 1;
    const life = opts.life ?? 4;
    const live = this.live.get(key);
    if (live) {
      live.n += add;
      live.t = Math.max(live.t, life);
      live.text.innerHTML = live.label(live.n);
      live.el.classList.remove(`bump`);
      void live.el.offsetWidth;
      live.el.classList.add(`bump`);
      return;
    }
    const el = document.createElement(`div`);
    el.className = opts.cls ? `toast ${opts.cls}` : `toast`;
    if (opts.tc) el.style.setProperty(`--tc`, opts.tc);
    el.innerHTML = `${icon ? `<i class="ic">${icon}</i>` : ``}<span></span>`;
    const text = el.lastElementChild as HTMLElement;
    text.innerHTML = label(add);
    this.toastsEl.prepend(el);
    this.live.set(key, { el, text, n: add, t: life, label });
    while (this.toastsEl.children.length > MAX_TOASTS) {
      const last = this.toastsEl.lastElementChild!;
      for (const [k, t] of this.live) if (t.el === last) this.live.delete(k);
      last.remove();
    }
  }

  /** itemToast (58240): a gear find. */
  itemToast(item: HudGearItem): void {
    const tab = IS_TOUCH ? `` : ` · Tab to equip`;
    this.toast(
      `gear:${item.uid}`,
      this.icons.html(item),
      () => `<b style="color:${TIER_TEXT[item.tier]}">${escapeHtml(item.name)}</b><small>${starsHTML(item.tier)} ${TIER_NAMES[item.tier]}${tab}</small>`,
      { cls: `gear`, tc: TIER_COLORS[item.tier], life: 5 },
    );
  }

  /** coinsToast (58249) */
  coinsToast(n: number): void {
    if (n > 0)
      this.toast(`coins`, `<i class="coin"></i>`, (c) => `<b>+${c.toLocaleString()}</b> coins`, {
        add: n,
        life: 2.5,
      });
  }

  /** findToast (58256): a find with a count and an optional colored subline. */
  findToast(key: string, icon: string, name: string, sub = ``, color = ``): void {
    const small = sub ? `<small${color ? ` style="color:${color}"` : ``}>${sub}</small>` : ``;
    this.toast(key, icon, (n) => `<b>${escapeHtml(name)}</b>${n > 1 ? `<em>×${n}</em>` : ``}${small}`);
  }

  /** noteToast (58260): a message; life = max(ms, 4500 + 45 ms per character). */
  noteToast(icon: string, html: string, ms = 0, key = ``): void {
    const life = Math.max(ms, 4500 + html.replace(/<[^>]*>/g, ``).length * 45) / 1e3;
    const k = `note:${key || html}`;
    const live = this.live.get(k);
    if (live) live.label = () => html;
    this.toast(k, icon, () => html, { add: 0, life, cls: `note` });
  }

  /** floater (58266): world-space text; pos is copied. Words live longer and rise slower than numbers. */
  floater(pos: THREE.Vector3, text: string, color = `#fff`, cls = ``): void {
    const el = document.createElement(`div`);
    el.className = cls ? `floater ${cls}` : `floater`;
    el.textContent = text;
    el.style.color = color;
    this.floatersEl.appendChild(el);
    const words = /[a-z]{3}/i.test(text);
    this.floaters.push({
      el,
      pos: pos.clone(),
      age: 0,
      life: words ? Math.min(4.5, 2.2 + text.length * 0.035) : 1.1,
    });
    if (this.floaters.length > 24) {
      this.floaters[0].el.remove();
      this.floaters.shift();
    }
  }

  /** dismiss (58281) */
  dismiss(el: HTMLElement): void {
    el.classList.add(`out`);
    setTimeout(() => el.remove(), 320);
  }

  /** gemToast (58284) */
  gemToast(id: string): void {
    const def = (ITEMS as Record<string, { name: string; rarity: Rarity }>)[id];
    const [label, color] = RARITY_LABEL[def.rarity];
    this.findToast(`gem:${id}`, this.icons.lootHtml(id), def.name, label, color);
  }

  /** roster (58289): who is online, in the pause sheet (16 names, then "+N more"). */
  roster(list: HudRosterEntry[] | null): void {
    const key = list ? list.map((e) => `${e.name}:${e.lvl}:${+!!e.you}`).join(`|`) : ``;
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    this.rosterEl.classList.toggle(`hidden`, !list);
    if (!list) return;
    const n = list.length;
    this.rosterEl.querySelector(`.count span`)!.textContent = n > 1 ? `${n} miners online` : `Just you online`;
    const ul = this.rosterEl.querySelector(`ul`)!;
    const items = list.slice(0, 16).map((e) => {
      const li = document.createElement(`li`);
      li.classList.toggle(`you`, !!e.you);
      li.textContent = e.you ? `${e.name} (you)` : e.name;
      if (e.lvl) {
        const small = document.createElement(`small`);
        small.textContent = `Lv ${e.lvl}`;
        li.append(small);
      }
      return li;
    });
    if (n > 16) {
      const more = document.createElement(`li`);
      more.className = `more`;
      more.textContent = `+${n - 16} more`;
      items.push(more);
    }
    ul.replaceChildren(...items);
  }

  /** banner (58318): restarts the banner animation with a title, subline and title color. */
  banner(title: string, sub: string, color: string): void {
    const el = this.bannerEl;
    el.querySelector(`b`)!.textContent = title;
    (el.querySelector(`b`) as HTMLElement).style.color = color;
    el.querySelector(`span`)!.textContent = sub;
    el.classList.remove(`show`);
    void el.offsetWidth;
    el.classList.add(`show`);
  }

  /** ultMeter (58327): the Drill Slam ring (--p), ready and aim classes. */
  ultMeter(k: number, ready: boolean, aiming: boolean): void {
    const key = `${Math.round(k * 240)}:${+!!ready}:${+!!aiming}`;
    if (key === this.ultShown) return;
    this.ultShown = key;
    this.ultEl.style.setProperty(`--p`, k.toFixed(3));
    this.ultEl.classList.toggle(`ready`, ready);
    this.ultEl.classList.toggle(`aim`, aiming);
    if (ready) this.ultEl.classList.remove(`nudge`);
  }

  /** ultNudge (58336) */
  ultNudge(): void {
    for (const el of this.ultEls()) this.restart(el, `nudge`);
  }

  /** ultPop (58339) */
  ultPop(): void {
    for (const el of this.ultEls()) this.restart(el, `pop`);
  }

  /** ultEls (58342): #ult and, in touch mode, the touch ult button. */
  ultEls(): HTMLElement[] {
    const touch = document.querySelector<HTMLElement>(`#touch .tb.ult`);
    return touch ? [this.ultEl, touch] : [this.ultEl];
  }

  /** restart (58346): restarts a CSS animation class. */
  restart(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** flash (58349): a full-screen flash of v (decays 2.5/s) in a color. */
  flash(v = 0.8, color = `#fff`): void {
    this.flashV = Math.max(this.flashV, v);
    this.flashEl.style.background = color;
  }
}
