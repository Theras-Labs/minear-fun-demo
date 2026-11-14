// Port of play-inUT-NSi.js 36583-36916: the gem field Rb (loose gems and reroll dice inside the voxel chunks).
// Spawns are deterministic per 16^3 chunk (resolveGemSpawns = ty) and stay in sync with the server through a
// taken set and a regrown generation map. Each gem is one Mesh with geometry and material shared per item id,
// tilted to face open air. Gems glow with an emissive pulse; three PointLights follow the nearest non-common gems.
// In burrow mode the materials draw through the rock (depthTest off, transparent, no fog), meshes beyond the
// lamp's sense radius hide, and update() returns halo blips (SonarBlips Np = KR.halos) plus sonar-ping hits.
// Gems cleared by digging or a remote blast wait 4 s in limbo, then resettle unless taken.
// The die mesh zb (36917-36990) is in ./dieMesh.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEMS, type ItemDef, type ItemId, type Rarity } from '../world/items';
import { seededRandom } from '../world/rng';
import { chunkKey, type Chunk } from '../world/chunk';
import { resolveGemSpawns, type GemSlotState, type GemSpawn } from '../world/gemSpawn';
import type { ChunkManager } from '../world/chunkManager';
import type { SonarBlip } from '../render/sonarRock';
import { createDieMesh } from './dieMesh';

/** K (33023) looked up by any string id, as the original does. */
const ITEM = ITEMS as Record<string, ItemDef>;

/** Seconds a cleared gem waits before it resettles. */
export const LIMBO_SECONDS = 4; // Mb (36583)

/** Emissive intensity by rarity (also the light and halo strength). */
export const GEM_GLOW: Record<Rarity, number> = { // Nb (36584)
  common: 0.35,
  uncommon: 0.7,
  rare: 1.1,
  epic: 1.6,
  legendary: 2.6,
  mythic: 3.4,
};

/** Mesh scale by rarity (the die is always 1). */
export const GEM_SCALE: Record<Rarity, number> = { // Pb (36585)
  common: 0.55,
  uncommon: 0.62,
  rare: 0.7,
  epic: 0.78,
  legendary: 0.9,
  mythic: 1,
};

/** Procedural crystal cluster: `count` hex prisms with cone tips, merged, flat normals. */
export function crystalGeometry(seed: number, count = 5): THREE.BufferGeometry { // Fb (36586)
  const rand = seededRandom(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let e = 0; e < count; e++) {
    const h = e === 0 ? 1.1 : 0.45 + rand() * 0.5;
    const r = e === 0 ? 0.22 : 0.1 + rand() * 0.1;
    const prism = new THREE.CylinderGeometry(r, r * 1.05, h, 6, 1);
    prism.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6, 1);
    tip.translate(0, h + r * 1.1, 0);
    const part = mergeGeometries([prism.toNonIndexed(), tip.toNonIndexed()]);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        e === 0 ? (rand() - 0.5) * 0.3 : (rand() - 0.5) * 1.6,
        rand() * Math.PI * 2,
        e === 0 ? (rand() - 0.5) * 0.3 : (rand() - 0.5) * 1.6,
      ),
    );
    part.applyQuaternion(q);
    if (e > 0) part.translate((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
    parts.push(part);
  }
  const out = mergeGeometries(parts);
  out.computeVertexNormals();
  return out;
}

/** Chunk coordinate [cx, cy, cz]. */
export type ChunkCoord = [number, number, number];

/** One gem (or die) in the world. `pos` is the placed mesh's position object. */
export class Gem { // Ib (36611)
  id: ItemId;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  chunkKey: number;
  chunk: ChunkCoord;
  /** Slot index in the chunk's spawn list (9000+ for planted gems). */
  i: number;
  /** Generation of the slot (0 = original spot). */
  gen: number;
  /** Released from the rock (the pickup system animates it from here). */
  free = false;
  vel = new THREE.Vector3();
  age = 0;
  /** Sonar ping highlight, 1 at the hit, decays 1.2 per second. */
  flash = 0;
  constructor(id: ItemId, mesh: THREE.Mesh, pos: THREE.Vector3, key: number, chunk: ChunkCoord, i: number, gen = 0) {
    this.id = id;
    this.mesh = mesh;
    this.pos = pos;
    this.chunkKey = key;
    this.chunk = chunk;
    this.i = i;
    this.gen = gen;
  }
}

/** Taken / regrown key of a slot: "cx,cy,cz,i". */
export const gemKey = (c: ChunkCoord, i: number): string => `${c[0]},${c[1]},${c[2]},${i}`; // Lb (36633)

/** Server slot state tuple [cx, cy, cz, i, generation, attempt, taken] (setStates). */
export type GemStateTuple = [number, number, number, number, number, number, unknown];

/** Rollback copy of the server-synced state (sandbox). */
export interface GemFieldSnapshot {
  taken: Set<string>;
  regrown: Map<string, GemSlotState>;
}

interface LimboEntry {
  c: ChunkCoord;
  i: number;
  at: number;
}

/** The six axis directions probed around a gem to find open air (36715-36722). */
const AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class GemField { // Rb (36634)
  world: ChunkManager;
  readonly group = new THREE.Group();
  geos: Record<string, THREE.BufferGeometry> = {};
  mats: Record<string, THREE.MeshStandardMaterial> = {};
  byChunk = new Map<number, Gem[]>();
  lights: THREE.PointLight[] = [];
  burrow = false;
  taken = new Set<string>();
  regrown = new Map<string, GemSlotState>();
  time = 0;
  cullT = 0;
  limbo: LimboEntry[] = [];
  /** Reused halo list returned by update() (KR also lets chests and satchels push into it). */
  halos: SonarBlip[] = [];
  haloColors: Record<string, THREE.Color> = {};
  planted: Gem[] = [];

  /** Burrow mode: gem materials draw through the rock. Recompiles the materials (needsUpdate). */
  setBurrow(on: boolean): void {
    if (this.burrow === on) return;
    this.burrow = on;
    for (const id in this.mats) {
      const m = this.mats[id];
      m.depthTest = !on;
      m.transparent = on;
      m.fog = !on;
      m.needsUpdate = true;
    }
    this.cullT = 0;
  }

  constructor(world: ChunkManager) {
    this.world = world;
    let seed = 11;
    for (const id of Object.keys(ITEMS)) {
      const def = ITEM[id];
      if (def.kind === `die`) {
        const die = createDieMesh();
        this.geos[id] = die.geometry;
        this.mats[id] = die.material;
        continue;
      }
      if (def.kind === `gem`) {
        this.geos[id] = crystalGeometry(seed++ * 7919);
        this.mats[id] = new THREE.MeshStandardMaterial({
          color: def.color,
          emissive: def.color,
          emissiveIntensity: GEM_GLOW[def.rarity],
          roughness: 0.18,
          metalness: 0.05,
          flatShading: true,
        });
      }
    }
    for (let k = 0; k < 3; k++) {
      const light = new THREE.PointLight(16777215, 0, 7, 1.6);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  /** A new mesh of an item (shared geometry and material). Also used for pickups, loot and warm-up. */
  makeMesh(id: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geos[id], this.mats[id]);
    const s = ITEM[id].kind === `die` ? 1 : GEM_SCALE[ITEM[id].rarity];
    mesh.scale.setScalar(s);
    mesh.castShadow = false;
    mesh.renderOrder = 20;
    return mesh;
  }

  spawnsOf(cx: number, cy: number, cz: number): GemSpawn[] {
    return resolveGemSpawns(
      cx,
      cy,
      cz,
      (x, y, z) => this.world.solid(x, y, z),
      (i) => this.regrown.get(gemKey([cx, cy, cz], i)),
      (x, y, z) => this.world.dug(x, y, z),
    );
  }

  /** KR world.onChunkMeshed: places the chunk's gems once. */
  spawnForChunk(chunk: Chunk): void {
    if (chunk.gemsSpawned) return;
    chunk.gemsSpawned = true;
    const key = chunkKey(chunk.cx, chunk.cy, chunk.cz);
    const spawns = this.spawnsOf(chunk.cx, chunk.cy, chunk.cz);
    if (!spawns.length) return;
    const list: Gem[] = [];
    for (const s of spawns)
      if (!this.taken.has(gemKey([chunk.cx, chunk.cy, chunk.cz], s.i)))
        list.push(this.place(s, [chunk.cx, chunk.cy, chunk.cz]));
    this.byChunk.set(key, list);
  }

  /** Makes the mesh, points it toward the open neighbours (random when buried), random yaw. */
  place(s: GemSpawn, c: ChunkCoord): Gem {
    const mesh = this.makeMesh(s.id);
    const rand = seededRandom(s.seed);
    const up = new THREE.Vector3();
    for (const [dx, dy, dz] of AXES)
      if (!this.world.solid(Math.round(s.x + dx * 1.6), Math.round(s.y + dy * 1.6), Math.round(s.z + dz * 1.6)))
        up.add(new THREE.Vector3(dx, dy, dz));
    if (up.lengthSq() < 0.01) up.set(rand() - 0.5, rand() - 0.5, rand() - 0.5);
    up.normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    mesh.rotateY(rand() * Math.PI * 2);
    mesh.position.set(s.x, s.y, s.z);
    this.group.add(mesh);
    return new Gem(s.id, mesh, mesh.position, chunkKey(c[0], c[1], c[2]), c, s.i, s.g);
  }

  /** Server gem states (KR loot hook `found`). */
  setStates(list: Iterable<GemStateTuple>): void {
    for (const [cx, cy, cz, i, g, a, taken] of list) {
      const key = gemKey([cx, cy, cz], i);
      if (g > 0) this.regrown.set(key, { g, a });
      if (taken) this.taken.add(key);
      else this.taken.delete(key);
      this.resettle([cx, cy, cz], i);
    }
  }

  /** Marks a slot taken and lifts its gem. Null when gen is given and differs from the slot's generation. */
  take(c: ChunkCoord, i: number, gen?: number): Gem | null {
    const key = gemKey(c, i);
    if (gen !== undefined && gen !== (this.regrown.get(key)?.g ?? 0)) return null;
    this.taken.add(key);
    return this.lift(c, i);
  }

  /** The slot regrew (KR loot hook `gemBack`). */
  back(c: ChunkCoord, i: number, g: number, a: number): void {
    const key = gemKey(c, i);
    this.regrown.set(key, { g, a });
    this.taken.delete(key);
    this.resettle(c, i);
  }

  /** Removes the slot's gem from its chunk list and from the scene. */
  lift(c: ChunkCoord, i: number): Gem | null {
    const list = this.byChunk.get(chunkKey(c[0], c[1], c[2]));
    const k = list?.findIndex((e) => e.i === i) ?? -1;
    if (!list || k < 0) return null;
    const g = list.splice(k, 1)[0];
    g.mesh.removeFromParent();
    return g;
  }

  /** Re-places one slot of a spawned chunk unless it is taken. */
  resettle(c: ChunkCoord, i: number): void {
    const key = chunkKey(c[0], c[1], c[2]);
    if (!this.world.chunks.get(key)?.gemsSpawned) return;
    this.lift(c, i);
    if (this.taken.has(gemKey(c, i))) return;
    const s = this.spawnsOf(c[0], c[1], c[2]).find((e) => e.i === i);
    if (!s) return;
    let list = this.byChunk.get(key);
    if (!list) this.byChunk.set(key, (list = []));
    list.push(this.place(s, c));
  }

  snapshot(): GemFieldSnapshot {
    return { taken: new Set(this.taken), regrown: new Map(this.regrown) };
  }

  /** Sandbox rollback: rebuilds the neighbourhood of the restored chunks and every chunk whose taken state changed. */
  restore(snap: GemFieldSnapshot, chunks: Iterable<{ cx: number; cy: number; cz: number }>): void {
    for (const g of [...this.planted]) this.unplant(g);
    const keys = new Set<number>();
    for (const c of chunks)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) keys.add(chunkKey(c.cx + dx, c.cy + dy, c.cz + dz));
    for (const k of this.taken) {
      if (snap.taken.has(k)) continue;
      const [x, y, z] = k.split(`,`).map(Number);
      keys.add(chunkKey(x, y, z));
    }
    this.taken = new Set(snap.taken);
    this.regrown = new Map(snap.regrown);
    for (const k of keys) {
      const c = this.world.chunks.get(k);
      if (c) {
        this.unloadChunk(c, true);
        if (c.meshed) this.spawnForChunk(c);
      }
    }
  }

  /**
   * MINEAR Back to Base: forgets every taken and regrown slot and places the gems of every loaded chunk again.
   * Call after the world was restored and the gem run seed changed (src/world/gemSpawn.ts setGemRunSeed).
   */
  reshuffle(): void {
    for (const g of [...this.planted]) this.unplant(g);
    this.taken.clear();
    this.regrown.clear();
    this.limbo = [];
    for (const c of this.world.chunks.values()) {
      this.unloadChunk(c, true);
      if (c.meshed) this.spawnForChunk(c);
    }
  }

  /** Drops a gem at a world position (the tutorial's practice gem). */
  plant(id: ItemId, pos: THREE.Vector3): Gem {
    const c: ChunkCoord = [Math.floor(pos.x / 16), Math.floor(pos.y / 16), Math.floor(pos.z / 16)];
    const chunk = this.world.getChunk(c[0], c[1], c[2]);
    this.spawnForChunk(chunk);
    const key = chunkKey(c[0], c[1], c[2]);
    let list = this.byChunk.get(key);
    if (!list) this.byChunk.set(key, (list = []));
    const g = this.place({ id, x: pos.x, y: pos.y, z: pos.z, i: 9e3 + list.length, seed: 4242 + list.length, g: 0 }, c);
    list.push(g);
    this.planted.push(g);
    return g;
  }

  unplant(g: Gem): void {
    this.planted = this.planted.filter((e) => e !== g);
    const list = this.byChunk.get(g.chunkKey);
    const k = list?.indexOf(g) ?? -1;
    if (list && k >= 0) {
      list.splice(k, 1);
      g.mesh.removeFromParent();
    }
  }

  /** Remote dig: releases the gems in reach and parks them in limbo. Returns them (KR sparks at each). */
  clearNear(pos: THREE.Vector3, r: number): Gem[] {
    const out = this.release(pos, r);
    for (const g of out) {
      g.mesh.removeFromParent();
      this.limbo.push({ c: g.chunk, i: g.i, at: this.time + LIMBO_SECONDS });
    }
    return out;
  }

  /** A chunk's edits arrived from the server: gems now in open air go to limbo. */
  clearChunk(cx: number, cy: number, cz: number): void {
    const list = this.byChunk.get(chunkKey(cx, cy, cz));
    if (!list) return;
    for (let k = list.length - 1; k >= 0; k--) {
      const g = list[k];
      if (this.world.sample(g.pos.x, g.pos.y, g.pos.z) >= 100) continue;
      list.splice(k, 1);
      g.mesh.removeFromParent();
      this.limbo.push({ c: g.chunk, i: g.i, at: this.time + LIMBO_SECONDS });
    }
  }

  settleLimbo(): void {
    if (!this.limbo.length) return;
    const due = this.limbo.filter((e) => e.at <= this.time);
    if (!due.length) return;
    this.limbo = this.limbo.filter((e) => e.at > this.time);
    for (const e of due) if (!this.taken.has(gemKey(e.c, e.i))) this.resettle(e.c, e.i);
  }

  /** KR world.onChunkUnloaded(chunk, deleted): only a deleted chunk drops its gems. */
  unloadChunk(chunk: Chunk, deleted: boolean): void {
    if (!deleted) return;
    const key = chunkKey(chunk.cx, chunk.cy, chunk.cz);
    const list = this.byChunk.get(key);
    if (list) for (const g of list) this.group.remove(g.mesh);
    this.byChunk.delete(key);
    chunk.gemsSpawned = false;
  }

  /** Gems within r + 0.45 of pos, or whose cell is now air, leave the field (free = true) and are returned. */
  release(pos: THREE.Vector3, r: number): Gem[] {
    const out: Gem[] = [];
    const rr = r + 1;
    for (let cz = Math.floor((pos.z - rr) / 16); cz <= Math.floor((pos.z + rr) / 16); cz++)
      for (let cy = Math.floor((pos.y - rr) / 16); cy <= Math.floor((pos.y + rr) / 16); cy++)
        for (let cx = Math.floor((pos.x - rr) / 16); cx <= Math.floor((pos.x + rr) / 16); cx++) {
          const list = this.byChunk.get(chunkKey(cx, cy, cz));
          if (!list) continue;
          for (let k = list.length - 1; k >= 0; k--) {
            const g = list[k];
            if (g.pos.distanceTo(pos) < r + 0.45 || this.world.sample(g.pos.x, g.pos.y, g.pos.z) < 100) {
              list.splice(k, 1);
              g.free = true;
              out.push(g);
            }
          }
        }
    return out;
  }

  /**
   * Per frame (KR 71989). sightR = lamp sense radius in burrow (else 0), pingR = sonar ping radius in burrow
   * (else -1). onPing fires for a seen gem the ping shell passes. Returns the halo list (empty outside burrow).
   */
  update(dt: number, playerPos: THREE.Vector3, sightR = 0, pingR = -1, onPing?: (g: Gem) => void): SonarBlip[] {
    this.time += dt;
    this.settleLimbo();
    for (const id in this.mats) {
      const base = (ITEM[id].kind === `die` ? 0.3 : GEM_GLOW[ITEM[id].rarity]) * (this.burrow ? 1.5 : 1);
      this.mats[id].emissiveIntensity = base * (0.85 + 0.15 * Math.sin(this.time * 2.2 + base * 3));
    }
    this.cullT -= dt;
    const cull = this.cullT <= 0;
    if (cull) this.cullT = this.burrow ? 0.1 : 0.25;
    const near: { g: Gem; d: number }[] = [];
    const halos = this.halos;
    halos.length = 0;
    const sight2 = sightR * sightR;
    for (const list of this.byChunk.values())
      for (const g of list) {
        const d2 = g.pos.distanceToSquared(playerPos);
        if (this.burrow) {
          const seen = d2 < sight2;
          if (cull) g.mesh.visible = seen;
          if (pingR > 0) {
            const d = Math.sqrt(d2);
            if (d < pingR && d > pingR - 2.5 && g.flash < 0.5) {
              g.flash = 1;
              if (seen) onPing?.(g);
            }
          }
          g.flash = Math.max(0, g.flash - dt * 1.2);
          if (seen) {
            const def = ITEM[g.id];
            const k = 1 - Math.sqrt(d2) / sightR;
            const glow = GEM_GLOW[def.rarity];
            let color = this.haloColors[g.id];
            if (!color) color = this.haloColors[g.id] = new THREE.Color(def.color);
            halos.push({
              p: g.pos,
              color,
              size:
                (0.9 + glow * 0.35) *
                (0.55 + 0.45 * k) *
                (1 + g.flash * 1.4) *
                (0.92 + Math.sin(this.time * 3 + g.pos.x) * 0.08),
            });
          }
        } else if (cull) g.mesh.visible = d2 < 1156;
        if (ITEM[g.id].rarity !== `common` && d2 < 196) near.push({ g, d: d2 });
      }
    near.sort((a, b) => a.d - b.d);
    for (let k = 0; k < this.lights.length; k++) {
      const light = this.lights[k];
      const n = near[k];
      if (n) {
        light.position.copy(n.g.pos);
        light.color.setHex(ITEM[n.g.id].color);
        const target = 2.2 * GEM_GLOW[ITEM[n.g.id].rarity];
        light.intensity += (target - light.intensity) * Math.min(1, dt * 4);
      } else light.intensity *= 0.9;
    }
    return halos;
  }
}
