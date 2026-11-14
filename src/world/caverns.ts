// Biome caverns: large ellipsoid caverns in a 240 x 150 x 240 m cell grid, beast (boss) caverns,
// floor height, pillars, ember hex columns and liquid queries. Bundle play-inUT-NSi.js lines 33360-33573.
import { WORLD_SEED } from './constants';
import { hash3, seededRandom } from './rng';
import { Simplex } from './simplex';

export type BiomeId = 'ember' | 'bog' | 'frost' | 'haunt';
export type LiquidKind = 'lava' | 'toxic';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  blurb: string;
  color: string;
  liquid: LiquidKind | null;
}

export const BIOMES: Record<BiomeId, BiomeDef> = { // hv (33360)
  ember: {
    id: `ember`,
    name: `THE EMBER FIELDS`,
    blurb: `Lakes of lava under a burning sky of stone. Mind your feet.`,
    color: `#ff8a3c`,
    liquid: `lava`,
  },
  bog: {
    id: `bog`,
    name: `THE BOG`,
    blurb: `Warm, wet and poisonous: stay out of the water.`,
    color: `#9fe870`,
    liquid: `toxic`,
  },
  frost: {
    id: `frost`,
    name: `THE FROZEN LAKE`,
    blurb: `Ice as far as your lamp reaches. It is slippery.`,
    color: `#9fe8ff`,
    liquid: null,
  },
  haunt: {
    id: `haunt`,
    name: `THE HAUNTED HOLLOW`,
    blurb: `Old graves, cold lights, and something watching.`,
    color: `#c7a8ff`,
    liquid: null,
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[]; // gv (33390)

/** Beast (boss) cavern depths below the surface. */
export const BEAST_DEPTHS: ReadonlyArray<{ biome: BiomeId; depth: number }> = [ // _v (33391)
  { biome: `haunt`, depth: 250 },
  { biome: `frost`, depth: 500 },
  { biome: `bog`, depth: 750 },
  { biome: `ember`, depth: 1e3 },
];

export interface BeastCavern {
  biome: BiomeId;
  ix: number;
  iy: number;
  iz: number;
  cx: number;
  cy: number;
  cz: number;
}

export interface Cavern {
  key: number;
  biome: BiomeId;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  floorY: number;
  liquidY: number;
  seed: number;
  beast: boolean;
}

let beastCache: BeastCavern[] | null = null; // vv (33397)

/** Cached list of the four beast caverns. */
export function beastCaverns(): BeastCavern[] { // yv (33398)
  if (beastCache) return beastCache;
  const rand = seededRandom(hash3(5, 7, 11, WORLD_SEED + 5151));
  const base = rand() * Math.PI * 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  beastCache = BEAST_DEPTHS.map((r, i) => {
    const a = base + (Math.PI / 2) * i + (rand() - 0.5) * 1.1;
    const o = 130 + i * 90 + rand() * 110;
    const s = Math.cos(a) * o;
    const c = Math.sin(a) * o;
    const l = 8 - r.depth + (rand() - 0.5) * 30;
    const u = Math.floor(s / 240);
    const d = Math.floor(l / 150);
    const f = Math.floor(c / 240);
    return {
      biome: r.biome,
      ix: u,
      iy: d,
      iz: f,
      cx: clamp(s, (u + 0.36) * 240, (u + 0.64) * 240),
      cy: clamp(l, (d + 0.34) * 150, (d + 0.66) * 150),
      cz: clamp(c, (f + 0.36) * 240, (f + 0.64) * 240),
    };
  });
  return beastCache;
}

export const cavernShapeNoise = new Simplex(WORLD_SEED + 909); // bv (33426)
export const cavernFloorNoise = new Simplex(WORLD_SEED + 919); // xv (33427)
export const cavernPillarNoise = new Simplex(WORLD_SEED + 929); // Sv (33428)

/** Cavern per cell (null = no cavern). */
export const cavernCache = new Map<number, Cavern | null>(); // Cv (33429)

export const cavernCellKey = (ix: number, iy: number, iz: number): number =>
  ((ix + 4096) * 8192 + (iz + 4096)) * 512 + (iy + 256); // wv (33430)

/** Biome weights [none, ember, bog, frost, haunt] for a cell row. */
export function biomeWeights(iy: number): number[] { // Tv (33431)
  return iy >= 0
    ? [1, 0, 0, 0, 0]
    : iy === -1
      ? [45, 0, 25, 20, 10]
      : iy === -2
        ? [35, 15, 15, 20, 15]
        : iy === -3
          ? [30, 25, 10, 15, 20]
          : [30, 35, 5, 5, 25];
}

const STARTER_BIOMES: BiomeId[] = [`bog`, `frost`, `haunt`, `ember`];

/** Cavern of a cell (ix, iy, iz), or null. Cached. */
export function cavernAt(ix: number, iy: number, iz: number): Cavern | null { // Ev (33442)
  const key = cavernCellKey(ix, iy, iz);
  const hit = cavernCache.get(key);
  if (hit !== undefined) return hit;
  const rand = seededRandom(hash3(ix, iy, iz, WORLD_SEED + 4711));
  const beast = iy <= -2 ? beastCaverns().find((b) => b.ix === ix && b.iy === iy && b.iz === iz) : undefined;
  let biome: BiomeId | null = null;
  if (beast) biome = beast.biome;
  else if (iy === -1 && ix >= -1 && ix <= 0 && iz >= -1 && iz <= 0) biome = STARTER_BIOMES[ix + 1 + (iz + 1) * 2];
  else {
    const w = biomeWeights(iy);
    let roll = rand() * w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < w.length; k++) {
      roll -= w[k];
      if (roll <= 0) {
        biome = k === 0 ? null : BIOME_IDS[k - 1];
        break;
      }
    }
  }
  if (!biome) {
    cavernCache.set(key, null);
    return null;
  }
  let cx = (ix + 0.36 + rand() * 0.28) * 240;
  let cz = (iz + 0.36 + rand() * 0.28) * 240;
  let cy = (iy + 0.34 + rand() * 0.32) * 150;
  if (beast) ({ cx, cy, cz } = beast);
  const rx = 52 + rand() * 14;
  const ry = 20 + rand() * 7;
  const floorY = cy - ry * 0.55;
  const liquidY =
    biome === `ember` ? floorY - 0.4 : biome === `bog` ? floorY + 0.15 : biome === `frost` ? floorY - 0.6 : floorY - 99;
  const cav: Cavern = {
    key,
    biome,
    cx,
    cy,
    cz,
    rx,
    ry,
    floorY,
    liquidY,
    seed: Math.floor(rand() * 1e9),
    beast: !!beast,
  };
  cavernCache.set(key, cav);
  return cav;
}

/** Cavern of the cell that holds world position (x, y, z), or null. */
export function cavernAtWorld(x: number, y: number, z: number): Cavern | null { // Dv (33485)
  return cavernAt(Math.floor(x / 240), Math.floor(y / 150), Math.floor(z / 240));
}

/** Ellipsoid metric plus noise: < 1 is inside the cavern. */
export function cavernMetric(cav: Cavern, x: number, y: number, z: number): number { // Ov (33488)
  const i = (x - cav.cx) / cav.rx;
  const a = (y - cav.cy) / cav.ry;
  const o = (z - cav.cz) / cav.rx;
  return i * i + a * a + o * o + cavernShapeNoise.noise3(x * 0.03, y * 0.045, z * 0.03) * 0.22;
}

/** Cavern floor height at (x, z). */
export function cavernFloorY(cav: Cavern, x: number, z: number): number { // kv (33494)
  const r = cavernFloorNoise.noise2(x * 0.055, z * 0.055);
  const i = cavernFloorNoise.noise2(x * 0.16 + 31, z * 0.16 - 17);
  switch (cav.biome) {
    case `ember`:
      return cav.floorY + r * 1.9 + i * 0.5;
    case `bog`:
      return cav.floorY + r * 1.1 + i * 0.6;
    case `frost`: {
      const a = 1 - smoothstep(0.25, 0.7, Math.hypot((x - cav.cx) / cav.rx, (z - cav.cz) / cav.rx));
      return cav.floorY + r * 0.9 + i * 0.35 - a * 3.2;
    }
    case `haunt`:
      return cav.floorY + r * 1.6 + i * 0.9;
  }
}

/** Pillar field: > 0 is inside a pillar. Returns -9 where no pillar can be. */
export function cavernPillar(cav: Cavern, x: number, y: number, z: number): number { // Av (33510)
  const i = cavernPillarNoise.noise2(x * 0.042 + (cav.seed % 97), z * 0.042 - (cav.seed % 89));
  if (i < 0.2) return -9;
  const a = (y - cav.floorY) / (cav.cy + cav.ry - cav.floorY);
  const o = 4.5 * (2 * a - 1) * (2 * a - 1) - 1.4;
  const s =
    cav.biome === `frost`
      ? cavernShapeNoise.noise2(x * 0.5, z * 0.5) * 1.6
      : cavernShapeNoise.noise2(x * 0.3, z * 0.3) * 0.8;
  return (i - 0.66) * 14 + o + s - (cav.biome === `ember` ? 2.2 : 0);
}

export const emberColumnNoise = new Simplex(WORLD_SEED + 939); // jv (33518)
const SQRT3 = Math.sqrt(3); // Mv (33519)
/** Ember hex column size. */
export const HEX_SIZE = 2.3; // Nv (33520)

export interface EmberColumn {
  /** > 0 inside the column. */
  inside: number;
  /** Column top height. */
  top: number;
}

/** Ember hex basalt column at (x, z), or null (not ember, or no column field). */
export function emberColumn(cav: Cavern, x: number, z: number): EmberColumn | null { // Pv (33521)
  if (cav.biome !== `ember`) return null;
  const r = emberColumnNoise.noise2(x * 0.028 + (cav.seed % 53), z * 0.028 - (cav.seed % 41));
  if (r < 0.25) return null;
  const i = ((2 / 3) * x) / HEX_SIZE;
  const a = ((-1 / 3) * x + (SQRT3 / 3) * z) / HEX_SIZE;
  const o = -i - a;
  let s = Math.round(i);
  let c = Math.round(a);
  const l = Math.round(o);
  const u = Math.abs(s - i);
  const d = Math.abs(c - a);
  const f = Math.abs(l - o);
  if (u > d && u > f) s = -c - l;
  else if (d > f) c = -s - l;
  const p = x - HEX_SIZE * 1.5 * s;
  const m = z - HEX_SIZE * SQRT3 * (c + s / 2);
  const h = Math.max(Math.abs(m), Math.abs(p * 0.866 + m * 0.5), Math.abs(-p * 0.866 + m * 0.5));
  const g = HEX_SIZE * 0.866 * 0.78 - h;
  const _ = hash3(s, c, cav.key & 65535, 777) / 4294967296;
  return { inside: g, top: cav.liquidY + 0.6 + (r - 0.25) * 12 * (0.2 + _ * 1.1) };
}

export const smoothstep = (e: number, t: number, n: number): number => { // Fv (33542)
  const r = Math.min(1, Math.max(0, (n - e) / (t - e)));
  return r * r * (3 - 2 * r);
};

/** True when the cavern shows a liquid surface at (x, z). */
export function hasLiquidSurface(cav: Cavern, x: number, z: number): boolean { // Iv (33546)
  if (
    !BIOMES[cav.biome].liquid ||
    cavernMetric(cav, x, cav.liquidY, z) > 0.97 ||
    cavernFloorY(cav, x, z) >= cav.liquidY - 0.05 ||
    cavernPillar(cav, x, cav.liquidY, z) > 0
  )
    return false;
  const r = emberColumn(cav, x, z);
  return !r || r.inside < 0;
}

export interface LiquidHit {
  r: Cavern;
  liquid: LiquidKind;
  depth: number;
}

/** Player-in-liquid query: cavern, liquid kind and depth below the surface, or null. */
export function liquidAt(x: number, y: number, z: number): LiquidHit | null { // Lv (33557)
  const r = cavernAtWorld(x, y, z);
  if (!r) return null;
  const i = BIOMES[r.biome].liquid;
  return !i ||
    y > r.liquidY - 0.02 ||
    y < r.liquidY - 8 ||
    cavernMetric(r, x, y, z) > 1 ||
    y < cavernFloorY(r, x, z) - 0.6 ||
    !hasLiquidSurface(r, x, z)
    ? null
    : { r, liquid: i, depth: r.liquidY - y };
}

/** Vertical falloff 1 - n^2 across the cavern height (0 outside). */
export function cavernVerticalFalloff(cav: Cavern, y: number): number { // Rv (33570)
  const n = (y - cav.cy) / cav.ry;
  return Math.max(0, 1 - n * n);
}
