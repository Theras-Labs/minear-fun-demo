// MINEAR: the depth bar on the right edge of the game screen. It shows the rock layers from the surface
// (flag) to Heartstone (gold base), each layer the same height, the boss lairs, your deepest record and
// where you are now (white line). A DEMO tag under the base: the full game goes deeper.
import { BOSS_OF_BIOME } from '../bosses/sim/defs';
import { BEAST_DEPTHS, BIOMES } from '../world/caverns';
import { MATERIALS, Mat } from '../world/materials';

/** Rock layers by depth below the surface (world/generate.ts materialAt, without the strata wobble of +-5 m). */
export const DEPTH_LAYERS = [
  { name: `Topsoil`, mat: Mat.Grass, top: 0, bottom: 4 },
  { name: `Sandstone`, mat: Mat.Sand, top: 4, bottom: 30 },
  { name: `Stone`, mat: Mat.Stone, top: 30, bottom: 72 },
  { name: `Slate`, mat: Mat.Slate, top: 72, bottom: 135 },
  { name: `Abyssal Rock`, mat: Mat.Abyss, top: 135, bottom: 260 },
  { name: `Obsidian`, mat: Mat.Obsidian, top: 260, bottom: 420 },
  { name: `Emberstone`, mat: Mat.Ember, top: 420, bottom: 620 },
  { name: `Voidstone`, mat: Mat.Void, top: 620, bottom: 900 },
  // Heartstone has no floor; the bar ends below the last boss lair (1000 m)
  { name: `Heartstone`, mat: Mat.Heart, top: 900, bottom: 1100 },
] as const;

/** Bar position of a depth: 0 at the surface (and above it) to 1 at the bottom. */
export function depthToBar(depth: number): number {
  const n = DEPTH_LAYERS.length;
  if (!(depth > 0)) return 0;
  for (let i = 0; i < n; i++) {
    const layer = DEPTH_LAYERS[i];
    if (depth < layer.bottom) return (i + (depth - layer.top) / (layer.bottom - layer.top)) / n;
  }
  return 1;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, `0`)}`;
const pct = (k: number) => `${(k * 100).toFixed(2)}%`;

export class DepthBar {
  el: HTMLDivElement;
  private you: HTMLElement;
  private best: HTMLElement;
  private youK = -1;
  private bestK = -1;

  constructor(parent: HTMLElement = document.getElementById(`ui`) ?? document.body) {
    const el = document.createElement(`div`);
    el.id = `depthbar`;
    const segs = DEPTH_LAYERS.map((l) => `<b style="--c:${hex(MATERIALS[l.mat].color)}"></b>`).join(``);
    const lairs = BEAST_DEPTHS.filter((b) => BOSS_OF_BIOME[b.biome]).map(
      (b) => `<s style="top:${pct(depthToBar(b.depth))};--c:${BIOMES[b.biome].color}"></s>`,
    ).join(``);
    el.innerHTML =
      `<i class="flag"><svg viewBox="0 0 16 16"><path d="M3 15V2" stroke="#3a281c" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M4 2.5h9l-2.6 3.2L13 9H4z" fill="#fff6e5" stroke="#3a281c" stroke-width="1.6" stroke-linejoin="round"/></svg></i>` +
      `<div class="track">${segs}${lairs}<u></u><em><i></i></em></div><span class="base"></span>` +
      // MINEAR: this build stops at the demo floor; the full game goes deeper
      `<span class="demo" title="Demo: the full game goes deeper than Heartstone">DEMO</span>`;
    parent.appendChild(el);
    this.el = el;
    this.you = el.querySelector(`em`)!;
    this.best = el.querySelector(`u`)!;
  }

  /** depth: metres below the surface now; deepest: the record in metres. */
  update(depth: number, deepest: number): void {
    const k = depthToBar(depth);
    if (Math.abs(k - this.youK) > 0.0004) {
      this.youK = k;
      this.you.style.top = pct(k);
    }
    const b = depthToBar(deepest);
    if (Math.abs(b - this.bestK) > 0.0004) {
      this.bestK = b;
      this.best.style.top = pct(b);
      this.best.style.display = deepest > 4 ? `` : `none`;
    }
  }
}
