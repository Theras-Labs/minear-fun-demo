// Port of play-inUT-NSi.js 43170-43195 (boulder push-out yw, town safe zone bw) and 43580-43740 (the
// "current foe wades lava" flag Cw and the voxel A* path finder: Hw, Uw, Ww, Gw, Kw, qw, Jw, Yw).
// A* on the voxel grid: 8 neighbours, step up 1, drop up to 3, headroom checked on the smooth density so
// foes fit under sloped ceilings.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { liquidAt } from '../world/caverns';
import type { ChunkManager } from '../world/chunkManager';

/** The world queries the foe code uses (ChunkManager wb). */
export type FoeWorld = Pick<ChunkManager, 'solid' | 'density' | 'sample' | 'groundBelow' | 'dug'>;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

const W = LIFT_POINT; // W (28758)

/**
 * yw (43170): a free spot to move an entity (feet at entityPos, given height and radius) out of a boulder
 * just placed at center with radius r, or null when the entity is not caught.
 */
export function boulderPushOut( // yw (43170)
  e: FoeWorld,
  t: XYZ,
  n: XYZ,
  r: number,
  i: number,
  a: number,
): XYZ | null {
  const o = (x: number, y: number, z: number) =>
    e.sample(x, y + 0.3, z) > 128 || e.sample(x, y + i * 0.55, z) > 128 || e.sample(x, y + i - 0.15, z) > 128;
  const s = t.x - n.x;
  const c = t.z - n.z;
  const l = n.y - Math.min(Math.max(n.y, t.y), t.y + i);
  if (s * s + l * l + c * c > (r + 0.5 + a) ** 2 || !o(t.x, t.y, t.z)) return null;
  const u = s * s + c * c > 0.02 ? Math.atan2(c, s) : 0;
  for (const ang of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI])
    for (const dist of [r + 0.6 + a, r + 1.2 + a, r + 2 + a]) {
      const x = n.x + Math.cos(u + ang) * dist;
      const z = n.z + Math.sin(u + ang) * dist;
      const g = e.groundBelow(x, z, t.y + i, i + 3);
      if (g !== null && !o(x, g, z)) return { x, y: g + 0.02, z };
    }
  const d = { x: n.x, y: n.y + r + 0.55, z: n.z };
  return o(d.x, d.y, d.z) ? null : d;
}

/** bw (43190): true inside the protected town zone around the hub (no burrowing, no foe digging). */
export function inTownZone(e: XYZ): boolean { // bw (43190)
  const t = e.x - W.x;
  const n = e.z - W.z;
  const r = Math.hypot(t, n);
  return (e.y > W.y - 4 && r < 24) || (r < 19 && e.y > -1);
}

/** Cw (43580): set while a lava-wading foe thinks, so standable() lets it stand in lava. */
let wadeLava = false; // Cw (43580)
export function setWadeLava(v: boolean): void {
  wadeLava = v;
}

export const NAV_EXPANSIONS = 2400; // Hw (43603) A* expansions (a third when the goal is not standable)
/** Uw (43604): the 8 neighbour directions. */
export const NAV_DIRS: ReadonlyArray<readonly [number, number]> = [ // Uw (43604)
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
export const HEADROOM = 1.4; // Ww (43614)

/**
 * MINEAR: is cell (x, y, z) inside a tunnel a player dug? The cell is dug and the cell two up is rock or dug
 * too. A crater dug in the floor of a natural cave has natural open air above it, so it is not a tunnel.
 * Foes keep out of tunnels: they live in the natural caves.
 */
export function inTunnel(e: FoeWorld, x: number, y: number, z: number): boolean {
  return e.dug(x, y, z) && (e.dug(x, y + 2, z) || e.solid(x, y + 2, z));
}

/**
 * MINEAR: can a hovering foe (a wraith; feet at y, height h) be at (x, y, z)? Not in rock and not in a
 * player-dug tunnel. Wraiths used to fly through rock (KR); now they move only through open cave.
 */
export function hoverFits(e: FoeWorld, x: number, y: number, z: number, h: number): boolean {
  if (e.sample(x, y + 0.3, z) > 128 || e.sample(x, y + h * 0.5, z) > 128 || e.sample(x, y + h - 0.15, z) > 128)
    return false;
  return !inTunnel(e, Math.round(x), Math.floor(y + 0.5), Math.round(z));
}

/** Gw (43615): can a foe stand in cell (x, y, z) (feet at y)? blocky = plain solid test. */
export function standable(e: FoeWorld, t: number, n: number, r: number, i = false): boolean { // Gw (43615)
  if (!wadeLava && liquidAt(t, n - 0.5, r)?.liquid === `lava`) return false;
  // MINEAR: never into a player-dug tunnel (A*, straight walks and knockback all use this)
  if (inTunnel(e, t, n, r)) return false;
  if (i) return e.solid(t, n - 1, r) && !e.solid(t, n, r) && !e.solid(t, n + 1, r);
  const a = e.density(t, n - 1, r);
  if (a <= 128) return false;
  const o = e.density(t, n, r);
  if (o > 128 || e.solid(t, n + 1, r)) return false;
  const s = n - 1 + (a - 128) / (a - o) + HEADROOM;
  if (s <= n + 1) return true;
  const c = s - (n + 1);
  return e.density(t, n + 1, r) * (1 - c) + e.density(t, n + 2, r) * c <= 128;
}

/** Kw (43627): numeric key of a nav cell. */
export const navKey = (e: number, t: number, n: number): number => ((e + 32768) * 65536 + (n + 32768)) * 4096 + (t + 2048); // Kw (43627)

/** qw (43628): the standable cell y near pos, or NaN. */
export function groundCell(e: FoeWorld, t: XYZ, n = false): number { // qw (43628)
  const r = Math.round(t.x);
  const i = Math.round(t.z);
  const a = Math.floor(t.y + 0.5);
  for (const d of [0, 1, -1, 2, -2, -3]) if (standable(e, r, a + d, i, n)) return a + d;
  return NaN;
}

/** Jw (43635): y of the step from cell (t, n, r) to neighbour column (i, a), or NaN. */
export function stepCell(e: FoeWorld, t: number, n: number, r: number, i: number, a: number): number { // Jw (43635)
  if (standable(e, i, n, a)) return n;
  if (standable(e, i, n + 1, a) && !e.solid(t, n + 2, r)) return n + 1;
  if (e.solid(i, n, a) || e.solid(i, n + 1, a)) return NaN;
  for (let d = 1; d <= 3; d++) {
    if (standable(e, i, n - d, a)) return n - d;
    if (e.solid(i, n - d, a)) return NaN;
  }
  return NaN;
}

interface NavNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: NavNode | null;
  closed: boolean;
}

interface HeapItem {
  n: NavNode;
  f: number;
}

/**
 * Yw (43645): A* path from `from` to `to` (avoiding the nav keys in `avoid`). Returns the waypoints (cell
 * floor y - 0.5), the best partial path when the goal is not reached, or null.
 */
export function findPath(e: FoeWorld, t: XYZ, n: XYZ, r?: number[]): THREE.Vector3[] | null { // Yw (43645)
  let i = groundCell(e, t);
  if (Number.isNaN(i)) i = groundCell(e, t, true);
  if (Number.isNaN(i)) return null;
  const a = Math.round(t.x);
  const o = Math.round(t.z);
  const s = Math.round(n.x);
  const c = Math.round(n.z);
  let l = groundCell(e, n);
  const u = Number.isNaN(l) ? NAV_EXPANSIONS / 3 : NAV_EXPANSIONS;
  if (Number.isNaN(l)) l = Math.floor(n.y + 0.5);
  const d = (x: number, y: number, z: number) => (x - a + 1024) * 4194304 + (y - i + 1024) * 2048 + (z - o + 1024);
  const f = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - s);
    const dz = Math.abs(z - c);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - l) * 0.6;
  };
  const p = new Map<number, NavNode>();
  const m: HeapItem[] = [];
  const h = (node: NavNode) => {
    const item: HeapItem = { n: node, f: node.f };
    m.push(item);
    let k = m.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (m[up].f <= item.f) break;
      m[k] = m[up];
      k = up;
    }
    m[k] = item;
  };
  const g = (): HeapItem => {
    const top = m[0];
    const last = m.pop()!;
    if (m.length) {
      let k = 0;
      for (;;) {
        const lc = k * 2 + 1;
        const rc = lc + 1;
        let best = -1;
        let bf = last.f;
        if (lc < m.length && m[lc].f < bf) {
          best = lc;
          bf = m[lc].f;
        }
        if (rc < m.length && m[rc].f < bf) best = rc;
        if (best < 0) break;
        m[k] = m[best];
        k = best;
      }
      m[k] = last;
    }
    return top;
  };
  const start: NavNode = { x: a, y: i, z: o, g: 0, f: f(a, i, o), parent: null, closed: false };
  p.set(d(a, i, o), start);
  h(start);
  let v = start;
  let y = start.f;
  let b = 0;
  while (m.length && b < u) {
    const top = g();
    const node = top.n;
    if (node.closed || top.f !== node.f) continue;
    node.closed = true;
    b++;
    const hh = node.f - node.g;
    if (hh < y) {
      y = hh;
      v = node;
    }
    if (node.x === s && node.z === c && Math.abs(node.y - l) <= 1) {
      v = node;
      break;
    }
    for (const [dx, dz] of NAV_DIRS) {
      const nx = node.x + dx;
      const nz = node.z + dz;
      if (
        dx &&
        dz &&
        (e.solid(node.x + dx, node.y, node.z) ||
          e.solid(node.x + dx, node.y + 1, node.z) ||
          e.solid(node.x, node.y, node.z + dz) ||
          e.solid(node.x, node.y + 1, node.z + dz))
      )
        continue;
      const ny = stepCell(e, node.x, node.y, node.z, nx, nz);
      if (Number.isNaN(ny) || (r?.length && r.includes(navKey(nx, ny, nz)))) continue;
      const cost = node.g + (dx && dz ? 1.414 : 1) + (ny > node.y ? 0.6 : ny < node.y ? 0.2 * (node.y - ny) : 0);
      const key = d(nx, ny, nz);
      let nb = p.get(key);
      if (nb && (nb.closed || nb.g <= cost)) continue;
      if (!nb) {
        nb = { x: nx, y: ny, z: nz, g: cost, f: 0, parent: node, closed: false };
        p.set(key, nb);
      }
      nb.g = cost;
      nb.parent = node;
      nb.f = cost + f(nx, ny, nz);
      h(nb);
    }
  }
  if (v === start) return null;
  const x: THREE.Vector3[] = [];
  for (let k: NavNode | null = v; k && k !== start; k = k.parent) x.push(new THREE.Vector3(k.x, k.y - 0.5, k.z));
  return x.reverse();
}
