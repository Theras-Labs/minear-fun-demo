// Voxel terrain generator: density (Uint8, iso 128) and material per 16^3 chunk.
// Bundle play-inUT-NSi.js lines 33574-33739.
import { WORLD_SEED } from './constants';
import {
  type Cavern,
  cavernAtWorld,
  cavernFloorY,
  cavernMetric,
  cavernPillar,
  emberColumn,
} from './caverns';
import { Mat } from './materials';
import { Simplex } from './simplex';

export const terrainNoise = new Simplex(WORLD_SEED); // zv (33574)
export const tunnelNoiseA = new Simplex(WORLD_SEED + 101); // Bv (33575)
export const tunnelNoiseB = new Simplex(WORLD_SEED + 202); // Vv (33576)
export const oreNoise = new Simplex(WORLD_SEED + 303); // Hv (33577)
export const oreKindNoise = new Simplex(WORLD_SEED + 404); // Uv (33578)

export const smoothstepGen = (e: number, t: number, n: number): number => { // Wv (33579)
  const r = Math.min(1, Math.max(0, (n - e) / (t - e)));
  return r * r * (3 - 2 * r);
};

/** Surface height at (x, z): flat plaza near the origin, max 15. */
export function surfaceHeight(x: number, z: number): number { // Gv (33583)
  let n =
    2 +
    terrainNoise.fbm2(x * 0.011, z * 0.011, 3) * 4.5 +
    Math.max(0, tunnelNoiseA.noise2(x * 0.0055, z * 0.0055)) * 9;
  const r = smoothstepGen(10, 23, Math.hypot(x, z));
  n = 3 + (n - 3) * r;
  return Math.min(n, 15);
}

/** Strata offset at (x, z). */
export function strataOffset(x: number, z: number): number { // Kv (33591)
  return tunnelNoiseB.noise2(x * 0.018, z * 0.018) * 5;
}

/** Material by depth below the surface, strata offset and ore veins. */
export function materialAt(x: number, y: number, z: number, surfY: number, strata: number): number { // qv (33594)
  const a = surfY - y;
  const i = strata;
  if (Math.hypot(x, z) < 9.5 && a < 2.6) return Mat.Plaza;
  if (a < 1.3) return Mat.Grass;
  if (a < 4 + i * 0.3) return Mat.Dirt;
  let o: number =
    a < 30 + i
      ? (((y + i * 0.6) % 6) + 6) % 6 < 1.3
        ? Mat.SandStripe
        : Mat.Sand
      : a < 72 + i
        ? Mat.Stone
        : a < 135 + i
          ? Mat.Slate
          : a < 260 + i * 2
            ? Mat.Abyss
            : a < 420 + i * 2
              ? Mat.Obsidian
              : a < 620 + i * 2
                ? Mat.Ember
                : a < 900 + i * 2
                  ? Mat.Void
                  : Mat.Heart;
  const s = oreNoise.noise3(x * 0.14, y * 0.14, z * 0.14);
  if (s > 0.63) {
    const r = (oreKindNoise.noise3(x * 0.035, y * 0.035 + 50, z * 0.035) + 1) * 0.5;
    o =
      a > 100 && r > 0.7 && s > 0.66
        ? Mat.Mythril
        : a > 40 && r > 0.52 && s > 0.63
          ? Mat.Gold
          : a > 16 && r > 0.32
            ? Mat.Iron
            : a < 80
              ? Mat.Copper
              : Mat.Iron;
  }
  return o;
}

/** Density inside a cavern's influence: blends the cavern carve with the base density. */
export function cavernDensity(
  cav: Cavern,
  x: number,
  y: number,
  z: number,
  density: number,
  metric: number,
): number { // Jv (33634)
  if (metric > 1.3) return density;
  let o = 128 + (metric - 1) * 700;
  const s = cavernFloorY(cav, x, z);
  o = Math.max(o, 128 + (s - y) * 70);
  const c = cavernPillar(cav, x, y, z);
  o = Math.max(o, 128 + c * 30);
  const l = emberColumn(cav, x, z);
  if (l) o = Math.max(o, 128 + Math.min(l.inside, l.top - y) * 60);
  if (cav.biome === `frost`) o = Math.max(o, 128 + (cav.liquidY - y) * 70);
  const u = metric < 0.88 ? 0 : metric > 1.02 ? 1 : (metric - 0.88) / 0.14;
  const d = o - u * (o - Math.min(density, o));
  return Math.max(0, Math.min(255, d));
}

/** Cavern wall material, or -1 to keep the base material. */
export function cavernMaterial(cav: Cavern, x: number, y: number, z: number, metric: number): number { // Yv (33648)
  if (metric > 1.55) return -1;
  const a = metric < 1.08;
  switch (cav.biome) {
    case `ember`:
      return a && y < cav.liquidY + 0.45 ? Mat.Magma : Mat.Basalt;
    case `bog`:
      return a && y < cavernFloorY(cav, x, z) + 0.4 ? Mat.Mud : Mat.Bogmoss;
    case `frost`: {
      if ((a && y <= cav.liquidY + 0.05) || (a && cavernPillar(cav, x, y, z) > 0)) return Mat.Ice;
      const i = cavernFloorY(cav, x, z);
      return a && y < i + 0.4 && y > i - 2 ? Mat.Snow : Mat.Frostrock;
    }
    case `haunt`:
      return oreNoise.noise3(x * 0.09, y * 0.12, z * 0.09) > 0.5 && y > cavernFloorY(cav, x, z) + 0.8
        ? Mat.Bonestone
        : Mat.Ashstone;
  }
}

/** Base density with worm tunnels (below 6 m) and big open caves (below 35 m). Float in [0, 255]. */
export function baseDensity(x: number, y: number, z: number, surfY: number): number { // Xv (33667)
  let i = 128 + (surfY - y) * 70;
  const a = surfY - y;
  if (a > 6) {
    const r = 0.03;
    const o = tunnelNoiseA.noise3(x * r, y * r * 1.5, z * r);
    const s = tunnelNoiseB.noise3(x * r + 31.7, y * r * 1.5 - 7.1, z * r - 12.3);
    const c = 0.01 + Math.min(a, 150) * 8e-5;
    const l = smoothstepGen(6, 14, a);
    const u = 128 + (o * o + s * s - c) * 4200 + (1 - l) * 400;
    if (u < i) i = u;
    if (a > 35) {
      const r2 =
        128 + (0.52 - terrainNoise.noise3(x * 0.016, y * 0.028, z * 0.016)) * 900 + (1 - smoothstepGen(35, 60, a)) * 300;
      if (r2 < i) i = r2;
    }
  }
  return i < 0 ? 0 : i > 255 ? 255 : i;
}

export interface GeneratedChunk {
  /** 4096 densities, index x + 16 * (y + 16 * z). > 128 = solid. */
  density: Uint8Array;
  /** 4096 material ids (0 where not solid). */
  material: Uint8Array;
  /** 0 = all empty, 1 = all solid, -1 = mixed. */
  uniform: number;
}

export interface GenerateOptions {
  /** false skips the biome caverns. */
  biomes?: boolean;
}

/** Generate one 16^3 chunk at chunk coords (cx, cy, cz). Pure function of the coords and the seed. */
export function generateChunk(cx: number, cy: number, cz: number, opts?: GenerateOptions): GeneratedChunk { // Zv (33685)
  const density = new Uint8Array(4096);
  const material = new Uint8Array(4096);
  const oy = cy * 16;
  if (oy > 17) return { density, material, uniform: 0 };
  const ox = cx * 16;
  const oz = cz * 16;
  let cav = opts?.biomes === false ? null : cavernAtWorld(ox + 8, oy + 8, oz + 8);
  if (cav) {
    const px = Math.max(ox, Math.min(cav.cx, ox + 16));
    const py = Math.max(oy, Math.min(cav.cy, oy + 16));
    const pz = Math.max(oz, Math.min(cav.cz, oz + 16));
    const r = (px - cav.cx) / cav.rx;
    const i = (py - cav.cy) / cav.ry;
    const a = (pz - cav.cz) / cav.rx;
    if (r * r + i * i + a * a > 1.9) cav = null;
  }
  // Float32 on purpose: the generator reads these back rounded to float32.
  const surf = new Float32Array(256);
  const strata = new Float32Array(256);
  for (let e = 0; e < 16; e++)
    for (let t = 0; t < 16; t++) {
      surf[t + e * 16] = surfaceHeight(ox + t, oz + e);
      strata[t + e * 16] = strataOffset(ox + t, oz + e);
    }
  let solid = 0;
  for (let e = 0; e < 16; e++)
    for (let t = 0; t < 16; t++)
      for (let n = 0; n < 16; n++) {
        const x = ox + n;
        const y = oy + t;
        const z = oz + e;
        const m = surf[n + e * 16];
        const h = n + 16 * (t + 16 * e);
        const g = y > m + 2 ? 0 : baseDensity(x, y, z, m);
        density[h] = g; // Uint8 store truncates; the test below uses the float.
        if (g > 128) {
          material[h] = materialAt(x, y, z, m, strata[n + e * 16]);
          solid++;
        }
      }
  if (cav)
    for (let e = 0; e < 16; e++)
      for (let t = 0; t < 16; t++)
        for (let n = 0; n < 16; n++) {
          const x = ox + n;
          const y = oy + t;
          const z = oz + e;
          const h = n + 16 * (t + 16 * e);
          const g = density[h];
          const metric = cavernMetric(cav, x, y, z);
          const v = Math.round(cavernDensity(cav, x, y, z, g, metric));
          density[h] = v;
          if (v > 128) {
            const wall = cavernMaterial(cav, x, y, z, metric);
            const prev = g > 128 ? material[h] : 0;
            const keepOre =
              metric > 1.08 &&
              (prev === Mat.Copper || prev === Mat.Iron || prev === Mat.Gold || prev === Mat.Mythril);
            material[h] =
              wall >= 0 && !keepOre ? wall : prev || materialAt(x, y, z, surf[n + e * 16], strata[n + e * 16]);
            if (g <= 128) solid++;
          } else if (g > 128) {
            material[h] = 0;
            solid--;
          }
        }
  return { density, material, uniform: solid === 0 ? 0 : solid === 4096 ? 1 : -1 };
}
