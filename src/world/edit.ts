// Dig sphere and fill sphere (placed boulder rock) across chunks. Bundle play-inUT-NSi.js lines 34024-34121.
// The chunk key Ey (34025) is owned by [terrain] (chunk.ts chunkKey) and is not used here.
import { MATERIALS, Mat } from './materials';

/** Chunk size used by the edit functions (same value as CHUNK). */
export const EDIT_CHUNK = 16; // Ty (34024)

/**
 * The chunk fields read or written by the world functions. The [terrain] Chunk class (_b, chunk.ts)
 * implements this interface.
 */
export interface ChunkLike {
  cx: number;
  cy: number;
  cz: number;
  /** 4096 densities, index x + 16 * (y + 16 * z). > 128 = solid. */
  density: Uint8Array;
  /** 4096 material ids. */
  material: Uint8Array;
  /** 0 = all empty, 1 = all solid, -1 = mixed. */
  uniform: number;
  /** Dug mask (1 = edited voxel), created on the first edit. */
  dug: Uint8Array | null;
  /** True after any edit. */
  modified: boolean;
  /** Natural (generated) copy kept for replays; written by the chunk manager. */
  nat?: { density: Uint8Array; material: Uint8Array } | null;
}

/** Chunk lookup by chunk coords; null/undefined = not loaded. */
export type GetChunk = (cx: number, cy: number, cz: number) => ChunkLike | null | undefined;

export interface EditResult {
  /** Dig: solid voxels made empty. Fill: empty voxels made solid. */
  removed: number;
  /** Sum of density change. */
  touched: number;
  /** Dig: material of the nearest solid voxel touched. Fill: the fill material. */
  mat: number;
  /** Dig: true when all touched voxels were too hard. Fill: always false. */
  tooHard: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * Remove density in a sphere, scaled by drill power vs material hardness.
 * Marks the dug mask and modified flag of each chunk it changes.
 */
export function digSphere(
  getChunk: GetChunk,
  x: number,
  y: number,
  z: number,
  radius: number,
  strength: number,
  drillPower: number,
  onRemoved?: (mat: number) => void,
  /** Per material: true = dug at the full rate whatever the power (MINEAR cheat, src/game/cheats.ts); a number
   *  = a Burrow Power factor (MINEAR dig tools, src/game/digTools.ts); false = the normal rate. */
  fast?: (mat: number) => boolean | number,
): EditResult { // Dy (34026)
  const c = radius + 0.5;
  const l: EditResult = {
    removed: 0,
    touched: 0,
    mat: Mat.Air,
    tooHard: false,
    x0: Math.floor(x - c),
    x1: Math.ceil(x + c),
    y0: Math.floor(y - c),
    y1: Math.ceil(y + c),
    z0: Math.floor(z - c),
    z1: Math.ceil(z + c),
  };
  let u = 1 / 0;
  let hard = 0;
  let soft = 0;
  for (let i = l.z0; i <= l.z1; i++)
    for (let p = l.y0; p <= l.y1; p++)
      for (let m = l.x0; m <= l.x1; m++) {
        const h = m - x;
        const g = p - y;
        const _ = i - z;
        const v = Math.sqrt(h * h + g * g + _ * _);
        if (v > c) continue;
        const ccx = Math.floor(m / EDIT_CHUNK);
        const ccy = Math.floor(p / EDIT_CHUNK);
        const ccz = Math.floor(i / EDIT_CHUNK);
        const S = getChunk(ccx, ccy, ccz);
        if (!S) continue;
        const C = m - ccx * EDIT_CHUNK + EDIT_CHUNK * (p - ccy * EDIT_CHUNK + EDIT_CHUNK * (i - ccz * EDIT_CHUNK));
        const w = S.density[C];
        if (w === 0) continue;
        const T = S.material[C];
        const E = MATERIALS[T] ?? MATERIALS[Mat.Stone];
        if (w > 128 && v < u) {
          u = v;
          l.mat = T;
        }
        if (!isFinite(E.hardness)) {
          hard++;
          continue;
        }
        const F = fast?.(T);
        let D = F === true ? 2.2 : (drillPower * (typeof F === `number` && F > 0 ? F : 1)) / E.hardness;
        if (D < 0.3) {
          D *= 0.08;
          hard++;
        } else soft++;
        const O = strength * Math.min(1, (c - v) / 1.2) * Math.min(D, 2.2);
        if (O <= 0) continue;
        const ee = Math.max(0, w - O);
        S.density[C] = ee; // Uint8 store truncates; the tests below use the float.
        S.dug ||= new Uint8Array(EDIT_CHUNK * EDIT_CHUNK * EDIT_CHUNK);
        S.dug[C] = 1;
        l.touched += w - ee;
        S.modified ||= true;
        if (w > 128 && ee <= 128) {
          l.removed++;
          onRemoved?.(T);
        }
      }
  l.tooHard = hard > 0 && soft === 0;
  return l;
}

/** Material of a placed boulder. */
export function boulderMat(): number { // Oy (34079)
  return Mat.Boulder;
}

/** Raise density in a sphere; voxels that become solid get material mat. */
export function fillSphere(
  getChunk: GetChunk,
  x: number,
  y: number,
  z: number,
  radius: number,
  mat: number,
): EditResult { // ky (34082)
  const o = radius + 0.5;
  const s: EditResult = {
    removed: 0,
    touched: 0,
    mat,
    tooHard: false,
    x0: Math.floor(x - o),
    x1: Math.ceil(x + o),
    y0: Math.floor(y - o),
    y1: Math.ceil(y + o),
    z0: Math.floor(z - o),
    z1: Math.ceil(z + o),
  };
  for (let c = s.z0; c <= s.z1; c++)
    for (let l = s.y0; l <= s.y1; l++)
      for (let u = s.x0; u <= s.x1; u++) {
        const d = u - x;
        const f = l - y;
        const p = c - z;
        const m = Math.sqrt(d * d + f * f + p * p);
        if (m > o) continue;
        const h = Math.floor(u / EDIT_CHUNK);
        const g = Math.floor(l / EDIT_CHUNK);
        const _ = Math.floor(c / EDIT_CHUNK);
        const v = getChunk(h, g, _);
        if (!v) continue;
        const idx = u - h * EDIT_CHUNK + EDIT_CHUNK * (l - g * EDIT_CHUNK + EDIT_CHUNK * (c - _ * EDIT_CHUNK));
        const b = v.density[idx];
        const xv = Math.min(255, Math.round(128 + (radius - m) * 70));
        if (xv <= b) continue;
        v.density[idx] = xv;
        if (b <= 128 && xv > 128) {
          v.material[idx] = mat;
          s.removed++;
        }
        v.dug ||= new Uint8Array(EDIT_CHUNK * EDIT_CHUNK * EDIT_CHUNK);
        v.dug[idx] = 1;
        s.touched += xv - b;
        v.modified ||= true;
      }
  return s;
}
