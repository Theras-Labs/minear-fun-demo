// Surface Nets chunk mesher: padded 20^3 density grid -> smooth indexed mesh with per-vertex color,
// glow, ore fraction, ore color, carved flag and baked AO. Iso level 128.
// Bundle play-inUT-NSi.js lines 33832-34023.
import * as THREE from 'three';
import { hash3 } from './rng';
import { GRASS_SIDE_COLOR, MATERIALS, Mat } from './materials';

/** Padded grid edge: a 16^3 chunk plus a 2-voxel border on each side. */
export const MESH_GRID = 20; // ry (33832)
/** MESH_GRID^2. */
export const MESH_GRID2 = MESH_GRID * MESH_GRID; // iy (33833)

/** Ore vertex colors (linear RGB). */
export const ORE_VERTEX_COLORS: Partial<Record<number, readonly [number, number, number]>> = { // ay (33834)
  [Mat.Copper]: [1, 0.36, 0.12],
  [Mat.Iron]: [0.86, 0.78, 0.66],
  [Mat.Gold]: [1, 0.72, 0.08],
  [Mat.Mythril]: [0.3, 0.95, 1],
};

/** Material id -> THREE.Color of MATERIALS[id].color (built with the active ColorManagement). */
export const MATERIAL_COLORS: Partial<Record<number, THREE.Color>> = {}; // oy (33840)
for (const e of Object.keys(MATERIALS)) MATERIAL_COLORS[+e] = new THREE.Color(MATERIALS[+e].color);
/** Grass side color for steep grass faces. */
export const GRASS_SIDE = new THREE.Color(GRASS_SIDE_COLOR); // sy (33842)

// Static scratch buffers, reused across calls. Results are sliced copies.
const cellVertex = new Int32Array(MESH_GRID * MESH_GRID * MESH_GRID); // cy (33843)
const corner = new Float32Array(8); // ly (33844)
/** The 12 cube edges as corner pairs. */
export const CUBE_EDGES: ReadonlyArray<readonly [number, number]> = [ // uy (33845)
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
/** The 8 cube corner offsets (bit 0 = x, bit 1 = y, bit 2 = z). */
export const CUBE_CORNERS: ReadonlyArray<readonly [number, number, number]> = [ // dy (33859)
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
/** Corner offsets flattened into grid indices. */
const CORNER_OFFSETS = CUBE_CORNERS.map(([e, t, n]) => e + t * MESH_GRID + n * MESH_GRID2); // fy (33869)
/** Max vertices (17^3). */
export const MAX_VERTS = 4913; // py (33870)
const sPosition = new Float32Array(MAX_VERTS * 3); // my (33871)
const sColor = new Float32Array(MAX_VERTS * 3); // hy (33872)
const sNormal = new Float32Array(MAX_VERTS * 3); // gy (33873)
const sMat = new Float32Array(MAX_VERTS); // _y (33874)
const sGlow = new Float32Array(MAX_VERTS); // vy (33875)
const sCarved = new Float32Array(MAX_VERTS); // yy (33876)
const sOre = new Float32Array(MAX_VERTS); // by (33877)
const sOreCol = new Float32Array(MAX_VERTS * 3); // xy (33878)
const sIndex = new Uint16Array(73728); // Sy (33879)

/** Trilinear density sample of a 20^3 grid, coords clamped to the grid. */
export function sampleGrid(grid: ArrayLike<number>, x: number, y: number, z: number): number { // Cy (33880)
  const i = MESH_GRID - 1.001;
  x = x < 0 ? 0 : x > i ? i : x;
  y = y < 0 ? 0 : y > i ? i : y;
  z = z < 0 ? 0 : z > i ? i : z;
  const a = x | 0;
  const o = y | 0;
  const s = z | 0;
  const c = x - a;
  const l = y - o;
  const u = z - s;
  const d = a + o * MESH_GRID + s * MESH_GRID2;
  const f = grid[d] + (grid[d + 1] - grid[d]) * c;
  const p = grid[d + MESH_GRID] + (grid[d + MESH_GRID + 1] - grid[d + MESH_GRID]) * c;
  const m = grid[d + MESH_GRID2] + (grid[d + MESH_GRID2 + 1] - grid[d + MESH_GRID2]) * c;
  const h = grid[d + MESH_GRID + MESH_GRID2] + (grid[d + MESH_GRID + MESH_GRID2 + 1] - grid[d + MESH_GRID + MESH_GRID2]) * c;
  const g = f + (p - f) * l;
  return g + (m + (h - m) * l - g) * u;
}

export interface SurfaceMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Material id of the solid corner with the lowest density. */
  mat: Float32Array;
  glow: Float32Array;
  /** 1 where any corner is in the dug mask. */
  carved: Float32Array;
  /** Fraction of solid corners that are ore. */
  ore: Float32Array;
  oreCol: Float32Array;
  index: Uint16Array;
}

/**
 * Mesh a padded 20^3 grid. Grid index = x + y * 20 + z * 400; chunk voxel (0,0,0) is grid (2,2,2).
 * ox, oy, oz are the chunk's world voxel origin (cx * 16, ...), used for the per-vertex jitter hash.
 * Returns null when there is no surface.
 */
export function surfaceNets(
  density: Uint8Array,
  material: Uint8Array,
  dug: Uint8Array | null,
  ox: number,
  oy: number,
  oz: number,
): SurfaceMesh | null { // wy (33899)
  let o = 0;
  let s = 0;
  for (let gz = 1; gz <= 17; gz++)
    for (let gy = 1; gy <= 17; gy++)
      for (let gx = 1; gx <= 17; gx++) {
        const u = gx + gy * MESH_GRID + gz * MESH_GRID2;
        let d = 0;
        let f = -1;
        let p = 256;
        for (let t = 0; t < 8; t++) {
          const n = density[u + CORNER_OFFSETS[t]];
          corner[t] = n;
          if (n > 128) {
            d |= 1 << t;
            if (n < p) {
              p = n;
              f = t;
            }
          }
        }
        if (d === 0 || d === 255) {
          cellVertex[u] = -1;
          continue;
        }
        let m = 0;
        let h = 0;
        let g = 0;
        let _ = 0;
        for (let e = 0; e < 12; e++) {
          const t = CUBE_EDGES[e][0];
          const n = CUBE_EDGES[e][1];
          if (((d >> t) & 1) == ((d >> n) & 1)) continue;
          const r = corner[t];
          const i = corner[n];
          const a = (128 - r) / (i - r);
          const c0 = CUBE_CORNERS[t];
          const c1 = CUBE_CORNERS[n];
          m += c0[0] + a * (c1[0] - c0[0]);
          h += c0[1] + a * (c1[1] - c0[1]);
          g += c0[2] + a * (c1[2] - c0[2]);
          _++;
        }
        m /= _;
        h /= _;
        g /= _;
        const v = gx - 2 + m;
        const y = gy - 2 + h;
        const b = gz - 2 + g;
        const x = o++;
        cellVertex[u] = x;
        sPosition[x * 3] = v;
        sPosition[x * 3 + 1] = y;
        sPosition[x * 3 + 2] = b;
        const S = corner[1] + corner[3] + corner[5] + corner[7] - corner[0] - corner[2] - corner[4] - corner[6];
        const C = corner[2] + corner[3] + corner[6] + corner[7] - corner[0] - corner[1] - corner[4] - corner[5];
        const w = corner[4] + corner[5] + corner[6] + corner[7] - corner[0] - corner[1] - corner[2] - corner[3];
        const T = Math.hypot(S, C, w) || 1;
        const E = -C / T;
        sNormal[x * 3] = -S / T;
        sNormal[x * 3 + 1] = E;
        sNormal[x * 3 + 2] = -w / T;
        const D = material[u + CORNER_OFFSETS[f]];
        let O = D;
        let ee = 0;
        let k = 0;
        let te = 0;
        let ne = 0;
        let re = 0;
        let A = 0;
        for (let e = 0; e < 8; e++) {
          if (corner[e] <= 128) continue;
          k++;
          const n = material[u + CORNER_OFFSETS[e]];
          const r = ORE_VERTEX_COLORS[n];
          if (r) {
            ee++;
            te += r[0];
            ne += r[1];
            re += r[2];
            A = Math.max(A, MATERIALS[n].glow);
          } else if (ORE_VERTEX_COLORS[O]) O = n;
        }
        if (ORE_VERTEX_COLORS[O]) O = Mat.Stone;
        const ie = k ? ee / k : 0;
        sOre[x] = ie;
        const j = ee ? ie / ee : 0;
        sOreCol[x * 3] = te * j;
        sOreCol[x * 3 + 1] = ne * j;
        sOreCol[x * 3 + 2] = re * j;
        const ae: THREE.Color =
          O === Mat.Grass ? (E > 0.45 ? MATERIAL_COLORS[Mat.Grass]! : GRASS_SIDE) : (MATERIAL_COLORS[O] ?? MATERIAL_COLORS[Mat.Stone]!);
        const oe = gx + m;
        const se = gy + h;
        const ce = gz + g;
        let le = 0;
        for (let t = 0; t < 8; t++)
          le += sampleGrid(density, oe + (t & 1 ? 1.5 : -1.5), se + (t & 2 ? 1.5 : -1.5), ce + (t & 4 ? 1.5 : -1.5));
        let ue = 1 - (le / 2040 - 0.42) * 1.3;
        ue = ue < 0.5 ? 0.5 : ue > 1.06 ? 1.06 : ue;
        const de = 0.95 + ((hash3(ox + gx - 2, oy + gy - 2, oz + gz - 2) & 255) / 255) * 0.1;
        const fe = ue * de;
        sColor[x * 3] = ae.r * fe;
        sColor[x * 3 + 1] = ae.g * fe;
        sColor[x * 3 + 2] = ae.b * fe;
        sGlow[x] = ee ? A : (MATERIALS[O]?.glow ?? 0);
        sMat[x] = D;
        let pe = 0;
        if (dug) for (let e = 0; e < 8; e++) pe |= dug[u + CORNER_OFFSETS[e]];
        sCarved[x] = pe;
      }
  if (o === 0) return null;
  const quad = (solid: boolean, t: number, n: number, r: number, i: number) => {
    if (solid) {
      sIndex[s++] = t;
      sIndex[s++] = n;
      sIndex[s++] = r;
      sIndex[s++] = t;
      sIndex[s++] = r;
      sIndex[s++] = i;
    } else {
      sIndex[s++] = t;
      sIndex[s++] = i;
      sIndex[s++] = r;
      sIndex[s++] = t;
      sIndex[s++] = r;
      sIndex[s++] = n;
    }
  };
  const G = MESH_GRID;
  const G2 = MESH_GRID2;
  const cv = cellVertex;
  for (let t = 2; t <= 17; t++)
    for (let n = 2; n <= 17; n++)
      for (let r = 2; r <= 17; r++) {
        const i = r + n * G + t * G2;
        const a = density[i] > 128;
        if (a !== density[i + 1] > 128) quad(a, cv[i - G - G2], cv[i - G2], cv[i], cv[i - G]);
        if (a !== density[i + G] > 128) quad(a, cv[i - G2 - 1], cv[i - 1], cv[i], cv[i - G2]);
        if (a !== density[i + G2] > 128) quad(a, cv[i - 1 - G], cv[i - G], cv[i], cv[i - 1]);
      }
  return s === 0
    ? null
    : {
        position: sPosition.slice(0, o * 3),
        normal: sNormal.slice(0, o * 3),
        color: sColor.slice(0, o * 3),
        mat: sMat.slice(0, o),
        glow: sGlow.slice(0, o),
        carved: sCarved.slice(0, o),
        ore: sOre.slice(0, o),
        oreCol: sOreCol.slice(0, o * 3),
        index: sIndex.slice(0, s),
      };
}
