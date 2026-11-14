// Deterministic per-chunk gem / loot spawn placement. Bundle play-inUT-NSi.js lines 33740-33831.
import { WORLD_SEED } from './constants';
import { cavernAtWorld, cavernMetric } from './caverns';
import { surfaceHeight } from './generate';
import { BIOME_GEM, GEM_DEPTH_TABLE, type ItemId } from './items';
import { hash3, seededRandom } from './rng';

export interface GemSlot {
  /** Slot index in the chunk list. */
  i: number;
  /** Item id; null = pick a gem by depth later (pickGemByDepth). */
  id: ItemId | null;
  x: number;
  y: number;
  z: number;
  seed: number;
  r: number;
  /** Minimum depth below the surface for the spot to be valid. */
  minDepth: number;
}

export interface GemSpot {
  x: number;
  y: number;
  z: number;
  seed: number;
  r: number;
}

export interface GemSpawn {
  id: ItemId;
  x: number;
  y: number;
  z: number;
  seed: number;
  i: number;
  /** Generation counter of the slot (0 = original spot). */
  g: number;
}

/** Slot state from the server: g = generation, a = attempt of the current spot. */
export interface GemSlotState {
  g: number;
  a: number;
}

/**
 * MINEAR: the expedition seed. Back to Base (src/base/backToBase.ts) picks a new one, so the gems move to new
 * spots while the depth tables stay the same. 0 is the original layout.
 */
let runSalt = 0;
export function setGemRunSeed(seed: number): void {
  runSalt = Number.isFinite(seed) ? Math.floor(seed) % 1e6 : 0;
}
export const gemRunSeed = (): number => runSalt;

/** Gem slots of chunk (cx, cy, cz). Count falls with depth; reroll die and biome gem are rare extras. */
export function gemSlotsForChunk(cx: number, cy: number, cz: number): GemSlot[] { // Qv (33740)
  const r = cy * 16;
  if (r > 16) return [];
  const rand = seededRandom(hash3(cx, cy, cz, WORLD_SEED + runSalt * 7919));
  const a = surfaceHeight(cx * 16 + 8, cz * 16 + 8);
  const o = Math.min(16, a - 3 - r);
  if (o <= 0) return [];
  const s = Math.max(0, a - (r + 8));
  const c = 0.1 + 0.8 * Math.exp(-s / 70);
  const count = Math.floor(c) + +(rand() < c % 1);
  const out: GemSlot[] = [];
  const add = (id: ItemId | null, minDepth: number) => {
    const x = cx * 16 + rand() * 16;
    const y = r + rand() * o;
    const z = cz * 16 + rand() * 16;
    const seed = Math.floor(rand() * 1e9);
    const rr = rand();
    out.push({ i: out.length, id, x, y, z, seed, r: rr, minDepth });
  };
  for (let e = 0; e < count; e++) add(null, 3);
  if (rand() < 0.006 + Math.min(s, 200) * 2e-5) add(`die`, 8);
  const cav = cavernAtWorld(cx * 16 + 8, r + 8, cz * 16 + 8);
  if (cav) {
    const t = cavernMetric(cav, cx * 16 + 8, r + 8, cz * 16 + 8);
    if (t < 2 && rand() < (t < 1.3 ? 0.25 : 0.1)) add(BIOME_GEM[cav.biome], 0);
  }
  return out;
}

/** Alternate spot for slot i of a chunk, for generation g and attempt a. */
export function altGemSpot(cx: number, cy: number, cz: number, i: number, g: number, a: number): GemSpot { // $v (33768)
  const rand = seededRandom(hash3(cx * 61 + i, cy * 53 + g, cz * 47 + a, WORLD_SEED + 1766 + runSalt * 7919));
  return {
    x: cx * 16 + rand() * 16,
    y: cy * 16 + rand() * 16,
    z: cz * 16 + rand() * 16,
    seed: Math.floor(rand() * 1e9),
    r: rand(),
  };
}

/** Try alternate spots from attempt a up to 23; the first deep and open one wins. */
export function findGemSpot(
  cx: number,
  cy: number,
  cz: number,
  slot: GemSlot,
  g: number,
  a: number,
  isOpen: (x: number, y: number, z: number) => boolean,
): GemSpot | null { // ey (33778)
  for (; a < 24; a++) {
    const s = altGemSpot(cx, cy, cz, slot.i, g, a);
    if (surfaceHeight(s.x, s.z) - s.y >= slot.minDepth && isOpen(Math.round(s.x), Math.round(s.y), Math.round(s.z)))
      return s;
  }
  return null;
}

/** Resolve the gem spawns of a chunk against open space, server slot state and the dug mask. */
export function resolveGemSpawns(
  cx: number,
  cy: number,
  cz: number,
  isOpen: (x: number, y: number, z: number) => boolean,
  getState?: (i: number) => GemSlotState | null | undefined,
  isDug?: (x: number, y: number, z: number) => boolean,
): GemSpawn[] { // ty (33786)
  const out: GemSpawn[] = [];
  const push = (slot: GemSlot, spot: GemSpot, g: number) =>
    out.push({
      id: slot.id ?? pickGemByDepth(surfaceHeight(spot.x, spot.z) - spot.y, spot.r),
      x: spot.x,
      y: spot.y,
      z: spot.z,
      seed: spot.seed,
      i: slot.i,
      g,
    });
  for (const slot of gemSlotsForChunk(cx, cy, cz)) {
    const c = getState?.(slot.i);
    if (c && c.g > 0) {
      const alt = altGemSpot(cx, cy, cz, slot.i, c.g, c.a);
      const spot = isOpen(Math.round(alt.x), Math.round(alt.y), Math.round(alt.z))
        ? alt
        : findGemSpot(cx, cy, cz, slot, c.g, c.a + 1, isOpen);
      if (spot) push(slot, spot, c.g);
      continue;
    }
    if (surfaceHeight(slot.x, slot.z) - slot.y < slot.minDepth) continue;
    const l = Math.round(slot.x);
    const u = Math.round(slot.y);
    const d = Math.round(slot.z);
    if (isOpen(l, u, d)) push(slot, slot, 0);
    else if (isDug?.(l, u, d)) {
      const spot = findGemSpot(cx, cy, cz, slot, 0, 0, isOpen);
      if (spot) push(slot, spot, 0);
    }
  }
  return out;
}

/** Pick a gem id by depth; weights shift toward rarer gems deeper. */
export function pickGemByDepth(depth: number, r: number = Math.random()): ItemId { // ny (33820)
  const n = 1 + Math.min(depth, 900) / 90;
  const weight = (k: number) => GEM_DEPTH_TABLE[k].weight * n ** (0.45 * k);
  let total = 0;
  GEM_DEPTH_TABLE.forEach((t, k) => {
    if (depth >= t.minDepth) total += weight(k);
  });
  let a = r * total;
  for (let t = 0; t < GEM_DEPTH_TABLE.length; t++)
    if (!(depth < GEM_DEPTH_TABLE[t].minDepth) && ((a -= weight(t)), a <= 0)) return GEM_DEPTH_TABLE[t].id;
  return `quartz`;
}
