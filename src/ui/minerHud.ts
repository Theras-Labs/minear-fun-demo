// MINEAR: the top-left HUD. A big title for where you are ("Surface", or the depth and its rock layer), the
// claws' endurance bar, then coins, gems and the ore taken on this trip, and the goal card below it as
// "Requests". The coin, gem, Fortune and PvP rows are the original #wallet rows (src/ui/hud.ts fills them).
import type { ClawEndurance } from '../game/clawEndurance';
import { ITEMS } from '../world/items';
import { DEPTH_LAYERS } from './depthBar';

/** Ore ids in the order the HUD lists them. */
const ORES = [`stone`, `copper`, `iron`, `gold`, `mythril`] as const;
/** Below this depth (m) a trip starts; on the surface the last trip's haul stays on show. */
const TRIP_DEPTH = 4;

const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;

/** The mole claw (the same drawing as the Burrow Power icon), its claws in the tier colour. */
const CLAW_SVG =
  `<svg viewBox="0 0 48 48">` +
  [`M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z`, `M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z`, `M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z`]
    .map((d) => `<path d="${d}" fill="var(--claw)" stroke="#3a281c" stroke-width="3" stroke-linejoin="round"/>`)
    .join(``) +
  `<ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" stroke="#3a281c" stroke-width="3"/>` +
  `<ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/></svg>`;

export class MinerHud {
  private place: HTMLElement;
  private layer: HTMLElement;
  private claw: HTMLElement;
  private fill: HTMLElement;
  private num: HTMLElement;
  private den: HTMLElement;
  private ores: HTMLElement;
  private shown = { place: ``, layer: ``, fill: -1, num: ``, den: ``, tier: ``, band: ``, ores: `` };
  /** Ore taken since the trip started (id -> count). */
  trip: Record<string, number> = {};
  private onTrip = false;

  constructor() {
    const wallet = document.getElementById(`wallet`)!;
    // one column at the top left: this panel, then the goal card
    const col = document.createElement(`div`);
    col.id = `hudl`;
    wallet.parentElement!.insertBefore(col, wallet);
    col.appendChild(wallet);
    const goal = document.getElementById(`goal`);
    if (goal) col.appendChild(goal);

    const top = document.createElement(`div`);
    top.className = `mn-top`;
    top.innerHTML =
      `<div class="where"><b class="place">Surface</b><span class="layer"></span></div>` +
      `<div class="claw" title="Claw endurance: mining rock wears your claws down. They rest on the surface.">` +
      `<span class="cbox">${CLAW_SVG}</span>` +
      `<div class="ebar"><i></i><span class="tks"></span><b><span class="n"></span><small class="d"></small></b></div></div>`;
    wallet.prepend(top);
    const ores = document.createElement(`div`);
    ores.className = `ores`;
    wallet.querySelector(`.stats`)!.after(ores);

    this.place = top.querySelector(`.place`)!;
    this.layer = top.querySelector(`.layer`)!;
    this.claw = top.querySelector(`.claw`)!;
    this.fill = top.querySelector(`.ebar i`)!;
    this.num = top.querySelector(`.ebar .n`)!;
    this.den = top.querySelector(`.ebar .d`)!;
    this.ores = ores;
  }

  /** Ore reached the miner (pickups/collect.ts). */
  addOre(id: string, n: number): void {
    this.trip[id] = (this.trip[id] ?? 0) + n;
  }

  /** depth: metres below the surface; burrow: in burrow mode. */
  update(depth: number, burrow: boolean, claws: ClawEndurance): void {
    const deep = burrow || depth >= TRIP_DEPTH;
    if (deep && !this.onTrip) this.trip = {}; // a new trip starts
    this.onTrip = deep;

    const place = deep ? `${Math.max(0, Math.round(depth))} m` : `Surface`;
    if (place !== this.shown.place) this.place.textContent = this.shown.place = place;
    const layer = deep ? `/ ${(DEPTH_LAYERS.find((l) => depth < l.bottom) ?? DEPTH_LAYERS[DEPTH_LAYERS.length - 1]).name}` : ``;
    if (layer !== this.shown.layer) this.layer.textContent = this.shown.layer = layer;

    const max = claws.max;
    const v = claws.value;
    const k = Math.round((v / max) * 1000) / 1000;
    if (k !== this.shown.fill) {
      this.shown.fill = k;
      this.fill.style.width = `${k * 100}%`;
    }
    const band = v <= 0 ? `worn` : k < 0.25 ? `low` : k < 0.5 ? `mid` : `ok`;
    if (band !== this.shown.band) {
      this.claw.classList.remove(`worn`, `low`, `mid`, `ok`);
      this.claw.classList.add((this.shown.band = band));
    }
    const num = claws.unlimited ? `∞` : String(Math.ceil(v)); // dev and cheat phase: no wear
    if (num !== this.shown.num) this.num.textContent = this.shown.num = num;
    const den = claws.unlimited ? `` : `/${max}`;
    if (den !== this.shown.den) this.den.textContent = this.shown.den = den;
    const tier = claws.tier;
    if (tier.id !== this.shown.tier) {
      this.shown.tier = tier.id;
      this.claw.style.setProperty(`--claw`, tier.color);
      this.claw.title = `${tier.name}: mining rock wears them down (harder rock, faster). They rest on the surface.`;
    }

    const rows = ORES.filter((id) => this.trip[id] > 0)
      .map((id) => {
        const it = ITEMS[id];
        return `<div class="hrow ore" title="${it.name} taken on this trip"><i class="chip" style="--c:${hex(it.color)}"></i><b>${this.trip[id].toLocaleString()}</b></div>`;
      })
      .join(``);
    if (rows !== this.shown.ores) this.ores.innerHTML = this.shown.ores = rows;
  }
}
