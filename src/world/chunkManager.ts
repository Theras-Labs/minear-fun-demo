// Port of play-inUT-NSi.js 35644-36185: terrain chunk manager wb and the ore yield constant Cb.
// Generates chunks on demand inside a per-frame time budget, meshes dirty chunks nearest first inside a time
// budget, unloads far chunks (keeps modified ones, 5% random chance per frame), digs and fills with ore yields,
// applies server snapshots and remote digs, restores the natural world, swaps materials, culls buried chunks and
// returns the collider meshes for the player controller.
// The three-mesh-bvh prototype install (35439-35441) runs on import of ./chunk.
import * as THREE from 'three';
import { Chunk, chunkKey, PAD_DENSITY, PAD_DUG, PAD_MATERIAL } from './chunk';
import { TerrainPager } from './terrainPager';
import { CHUNK } from './constants';
import { MATERIALS } from './materials';
import { generateChunk, surfaceHeight } from './generate';
import { MESH_GRID, surfaceNets } from './surfaceNets';
import { boulderMat, digSphere, fillSphere } from './edit';
import { createTerrainMaterial } from '../render/terrainMaterial';

/** Cb (35644): ore items gained per removed ore voxel (fractional carry). */
export const ORE_YIELD = 0.3; // Cb (35644)

const q = CHUNK; // q (35442) = 16
const ry = MESH_GRID; // ry (33832) = 20
const iy = MESH_GRID * MESH_GRID; // iy (33833) = 400

type ChunkMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface DigResult {
  yields: Record<string, number>;
  removed: number;
  touched: number;
  mat: number;
  tooHard: boolean;
}

export class ChunkManager { // wb (35645)
  chunks = new Map<number, Chunk>();
  oreCarry: Record<string, number> = {};
  group = new THREE.Group();
  material = createTerrainMaterial();
  activeMaterial: THREE.Material = this.material;
  meshes: ChunkMesh[] = [];
  onChunkMeshed: (chunk: Chunk) => void = () => {};
  /** deleted = the chunk record was dropped (false = a modified chunk kept without its mesh). */
  onChunkUnloaded: (chunk: Chunk, deleted: boolean) => void = () => {};
  keepDug = true;
  onMeshChanged: (chunk: Chunk) => void = () => {};
  onChunkCreated: (chunk: Chunk) => void = () => {};
  onDig:
    | ((x: number, y: number, z: number, radius: number, strength: number, power: number, isFill?: number) => void)
    | null = null;
  extraUp = 0;
  queue: Chunk[] = [];
  want = new Map<number, number>();
  wantKeys: number[] = [];
  backlog = 0;
  boost = false;
  meshBudget = 7;
  genBudget = 3;
  loadFar = 7;
  unloadRadius = 9;
  drawR = Infinity;
  drawCX = 0;
  drawCZ = 0;
  batch: TerrainPager | null = null;
  lastCx = NaN;
  lastCy = NaN;
  lastCz = NaN;
  constructor() {
    this.group.name = `terrain`;
    this.group.matrixAutoUpdate = false;
  }
  useBatch(): void {
    if (!this.batch) {
      this.batch = new TerrainPager(this.group, this.activeMaterial, 2);
      for (const m of this.meshes) {
        this.group.remove(m);
        this.batch.put(m.userData.chunk as Chunk, m.geometry, m.position.x, m.position.y, m.position.z);
      }
    }
  }
  unbatch(): void {
    const batch = this.batch;
    if (batch) {
      this.batch = null;
      for (const c of this.chunks.values()) {
        c.page = null;
        c.room = c.inst = -1;
      }
      for (const m of this.meshes) this.group.add(m);
      batch.dispose();
    }
  }
  keepNat(chunk: Chunk): void {
    if (!chunk.modified && !chunk.nat)
      chunk.nat = { density: chunk.density.slice(), material: chunk.material.slice() };
  }
  keepNatOf(cx: number, cy: number, cz: number): Chunk {
    const c = this.getChunk(cx, cy, cz);
    this.keepNat(c);
    return c;
  }
  getChunk(cx: number, cy: number, cz: number): Chunk {
    const key = chunkKey(cx, cy, cz);
    let c = this.chunks.get(key);
    if (!c) {
      const g = generateChunk(cx, cy, cz);
      c = new Chunk(cx, cy, cz, g.density, g.material, g.uniform);
      this.chunks.set(key, c);
      this.onChunkCreated(c);
    }
    return c;
  }
  density(x: number, y: number, z: number): number {
    const cx = Math.floor(x / q);
    const cy = Math.floor(y / q);
    const cz = Math.floor(z / q);
    return this.getChunk(cx, cy, cz).density[x - cx * q + q * (y - cy * q + q * (z - cz * q))];
  }
  materialAt(x: number, y: number, z: number): number {
    const cx = Math.floor(x / q);
    const cy = Math.floor(y / q);
    const cz = Math.floor(z / q);
    return this.getChunk(cx, cy, cz).material[x - cx * q + q * (y - cy * q + q * (z - cz * q))];
  }
  solid(x: number, y: number, z: number): boolean {
    return this.density(x, y, z) > 128;
  }
  dug(x: number, y: number, z: number): boolean {
    const cx = Math.floor(x / q);
    const cy = Math.floor(y / q);
    const cz = Math.floor(z / q);
    const c = this.getChunk(cx, cy, cz);
    return !!c.dug && c.dug[x - cx * q + q * (y - cy * q + q * (z - cz * q))] === 1;
  }
  /** Trilinear density sample. */
  sample(x: number, y: number, z: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    const d = (dx: number, dy: number, dz: number) => this.density(x0 + dx, y0 + dy, z0 + dz);
    const c00 = d(0, 0, 0) * (1 - fx) + d(1, 0, 0) * fx;
    const c10 = d(0, 1, 0) * (1 - fx) + d(1, 1, 0) * fx;
    const c01 = d(0, 0, 1) * (1 - fx) + d(1, 0, 1) * fx;
    const c11 = d(0, 1, 1) * (1 - fx) + d(1, 1, 1) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  }
  /** Surface height below (x, y, z) within maxDrop, or null (also null when (x, y, z) is inside rock). */
  groundBelow(x: number, z: number, y: number, maxDrop = 40): number | null {
    const ix = Math.round(x);
    const iz = Math.round(z);
    let above = this.density(ix, Math.floor(y), iz);
    if (above > 128) return null;
    for (let yy = Math.floor(y) - 1; yy > y - maxDrop; yy--) {
      const d = this.density(ix, yy, iz);
      if (d > 128) {
        const t = (128 - d) / (above - d);
        return yy + t;
      }
      above = d;
    }
    return null;
  }
  wanted(cx: number, cy: number, cz: number, pcx: number, pcy: number, pcz: number): void {
    const key = chunkKey(cx, cy, cz);
    if (this.want.has(key)) return;
    const dx = cx - pcx;
    const dy = cy - pcy;
    const dz = cz - pcz;
    this.want.set(key, dx * dx + dy * dy * 1.5 + dz * dz);
  }
  /** True when all 26 neighbours exist; queues the missing ones. */
  neighboursMade(chunk: Chunk, pcx: number, pcy: number, pcz: number): boolean {
    let all = true;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy || dz) {
            if (!this.chunks.has(chunkKey(chunk.cx + dx, chunk.cy + dy, chunk.cz + dz))) {
              this.wanted(chunk.cx + dx, chunk.cy + dy, chunk.cz + dz, pcx, pcy, pcz);
              all = false;
            }
          }
    return all;
  }
  /** Generates wanted chunks nearest first inside genBudget ms (no limit when forced or boosted). Returns the rest. */
  makeWanted(force: boolean): number {
    const want = this.want;
    if (!want.size) return 0;
    const keys = this.wantKeys;
    keys.length = 0;
    for (const k of want.keys()) keys.push(k);
    keys.sort((a, b) => want.get(a)! - want.get(b)!);
    const budget = force || this.boost ? Infinity : this.genBudget;
    const t0 = performance.now();
    let made = 0;
    for (const k of keys) {
      if (performance.now() - t0 > budget) break;
      const cy = (k % 8192) - 4096;
      const rest = Math.floor(k / 8192);
      const cz = (rest % 65536) - 32768;
      const cx = Math.floor(rest / 65536) - 32768;
      this.getChunk(cx, cy, cz);
      made++;
    }
    want.clear();
    return keys.length - made;
  }
  /** Fills PAD_DENSITY/PAD_MATERIAL/PAD_DUG; false when the 27 chunks are all uniform and equal (nothing to mesh). */
  gather(chunk: Chunk): boolean {
    const nb: Chunk[] = Array(27);
    let mixed = chunk.uniform === -1 || chunk.modified;
    let first = -2;
    let differ = false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const c = this.getChunk(chunk.cx + dx, chunk.cy + dy, chunk.cz + dz);
          nb[dx + 1 + 3 * (dy + 1 + 3 * (dz + 1))] = c;
          if (c.uniform === -1 || c.modified) mixed = true;
          if (first === -2) first = c.uniform;
          else if (c.uniform !== first) differ = true;
        }
    if (!mixed && !differ) return false;
    let anyDug = false;
    for (const c of nb) if (c.dug) anyDug = true;
    for (let gz = 0; gz < ry; gz++) {
      const lz = gz - 2;
      const oz = lz < 0 ? -1 : +(lz >= q);
      const z = lz - oz * q;
      for (let gy = 0; gy < ry; gy++) {
        const ly = gy - 2;
        const oy = ly < 0 ? -1 : +(ly >= q);
        const y = ly - oy * q;
        for (let gx = 0; gx < ry; gx++) {
          const lx = gx - 2;
          const ox = lx < 0 ? -1 : +(lx >= q);
          const x = lx - ox * q;
          const c = nb[ox + 1 + 3 * (oy + 1 + 3 * (oz + 1))];
          const src = x + q * (y + q * z);
          const dst = gx + gy * ry + gz * iy;
          PAD_DENSITY[dst] = c.density[src];
          PAD_MATERIAL[dst] = c.material[src];
          if (anyDug) PAD_DUG[dst] = c.dug ? c.dug[src] : 0;
        }
      }
    }
    this.gatheredDug = anyDug;
    return true;
  }
  gatheredDug = false;
  buildMesh(chunk: Chunk): void {
    const wx = chunk.cx * q;
    const wy = chunk.cy * q;
    const wz = chunk.cz * q;
    let out: ReturnType<typeof surfaceNets> | null = null;
    if (this.gather(chunk)) out = surfaceNets(PAD_DENSITY, PAD_MATERIAL, this.gatheredDug ? PAD_DUG : null, wx, wy, wz);
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.disposeBoundsTree();
      chunk.mesh.geometry.dispose();
      const i = this.meshes.indexOf(chunk.mesh);
      if (i >= 0) this.meshes.splice(i, 1);
      chunk.mesh = null;
    }
    chunk.dirty = false;
    chunk.meshed = true;
    if (!out) this.batch?.drop(chunk);
    this.onMeshChanged(chunk);
    if (!out) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute(`position`, new THREE.BufferAttribute(out.position, 3));
    g.setAttribute(`normal`, new THREE.BufferAttribute(out.normal, 3));
    g.setAttribute(`color`, new THREE.BufferAttribute(out.color, 3));
    g.setAttribute(`aMat`, new THREE.BufferAttribute(out.mat, 1));
    g.setAttribute(`glow`, new THREE.BufferAttribute(out.glow, 1));
    g.setAttribute(`carved`, new THREE.BufferAttribute(out.carved, 1));
    g.setAttribute(`ore`, new THREE.BufferAttribute(out.ore, 1));
    g.setAttribute(`oreCol`, new THREE.BufferAttribute(out.oreCol, 3));
    g.setIndex(new THREE.BufferAttribute(out.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.computeBoundsTree();
    const mesh: ChunkMesh = new THREE.Mesh(g, this.activeMaterial);
    mesh.position.set(wx, wy, wz);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [ox, oz] of [
      [0, 0],
      [q, 0],
      [0, q],
      [q, q],
      [q / 2, q / 2],
      [q / 2, 0],
      [0, q / 2],
      [q, q / 2],
      [q / 2, q],
    ]) {
      const h = surfaceHeight(wx + ox, wz + oz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    chunk.surface = hi > wy - 3 && lo < wy + q + 3;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.layers.enable(2);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.userData.chunk = chunk;
    chunk.mesh = mesh;
    if (this.batch) this.batch.put(chunk, g, wx, wy, wz);
    else this.group.add(mesh);
    this.meshes.push(mesh);
  }
  /**
   * Per-frame streaming around `pos`. Returns true when the 3x3x3 chunks around the player (up to the top chunk
   * row) are meshed. force = no time budgets and no neighbour wait (used once at boot with (0, 3, 0)).
   */
  update(pos: XYZ, force = false): boolean {
    const pcx = Math.floor(pos.x / q);
    const pcy = Math.floor(pos.y / q);
    const pcz = Math.floor(pos.z / q);
    if (Math.abs(pcx - this.lastCx) + Math.abs(pcy - this.lastCy) + Math.abs(pcz - this.lastCz) > 3)
      this.unload(pcx, pcy, pcz);
    this.lastCx = pcx;
    this.lastCy = pcy;
    this.lastCz = pcz;
    const top = Math.floor(17 / q);
    const queue = this.queue;
    queue.length = 0;
    const onSurface = pos.y > -24;
    const radius = onSurface ? this.loadFar : 5;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius + 1) continue;
        let lo = pcy - 2;
        let hi = Math.min(pcy + 2 + this.extraUp, top);
        if (d2 > 26) {
          lo = -1;
          hi = top;
        } else if (onSurface) {
          lo = Math.min(lo, -1);
          hi = Math.max(hi, top);
        }
        while (lo > pcy - 2 - 3 && this.chunks.get(chunkKey(pcx + dx, lo, pcz + dz))?.modified) lo--;
        for (let cy = lo; cy <= hi; cy++) {
          const c = this.chunks.get(chunkKey(pcx + dx, cy, pcz + dz));
          if (c) {
            if (c.dirty && (force || this.neighboursMade(c, pcx, pcy, pcz))) queue.push(c);
          } else this.wanted(pcx + dx, cy, pcz + dz, pcx, pcy, pcz);
        }
      }
    const genLeft = this.makeWanted(force);
    const dist = (c: Chunk) => {
      const dx = c.cx - pcx;
      const dy = c.cy - pcy;
      const dz = c.cz - pcz;
      return dx * dx + dy * dy * 1.5 + dz * dz;
    };
    queue.sort((a, b) => dist(a) - dist(b));
    const t0 = performance.now();
    const budget = this.boost ? 35 : this.meshBudget;
    let built = 0;
    for (const c of queue) {
      this.buildMesh(c);
      this.onChunkMeshed(c);
      built++;
      if (!force && performance.now() - t0 > budget) break;
    }
    this.backlog = queue.length - built + genLeft;
    if (Math.random() < 0.05) this.unload(pcx, pcy, pcz);
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (pcy + dy > top) continue;
          const c = this.chunks.get(chunkKey(pcx + dx, pcy + dy, pcz + dz));
          if (!c || !c.meshed) return false;
        }
    return true;
  }
  /** Removes one chunk's mesh and record (as unload does for a chunk that is not kept). */
  private drop(key: number, c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.disposeBoundsTree();
      c.mesh.geometry.dispose();
      const i = this.meshes.indexOf(c.mesh);
      if (i >= 0) this.meshes.splice(i, 1);
      c.mesh = null;
    }
    this.batch?.drop(c);
    c.dirty = true;
    c.meshed = false;
    c.modified = false;
    c.dug = null;
    this.onChunkUnloaded(c, true);
    this.chunks.delete(key);
  }
  /** Drops meshes beyond unloadRadius (or more than 5 rows away below cy -2); keeps modified chunk data when keepDug. */
  unload(pcx: number, pcy: number, pcz: number): void {
    const r2 = this.unloadRadius * this.unloadRadius;
    for (const [key, c] of this.chunks) {
      const dx = c.cx - pcx;
      const dz = c.cz - pcz;
      const dy = c.cy - pcy;
      if (!(dx * dx + dz * dz > r2 || (Math.abs(dy) > 5 && c.cy < -2))) continue;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.disposeBoundsTree();
        c.mesh.geometry.dispose();
        const i = this.meshes.indexOf(c.mesh);
        if (i >= 0) this.meshes.splice(i, 1);
        c.mesh = null;
      }
      this.batch?.drop(c);
      c.dirty = true;
      c.meshed = false;
      const deleted = !c.modified || !this.keepDug;
      this.onChunkUnloaded(c, deleted);
      if (deleted) this.chunks.delete(key);
      else c.nat = null;
    }
  }
  /** Local dig. Ore voxels removed add ORE_YIELD to a carry per ore id (common rock: its `stone` rate to the stone
   *  carry); whole numbers become yields. */
  dig(pos: XYZ, radius: number, strength: number, drillPower: number, fast?: (mat: number) => boolean | number): DigResult {
    const yields: Record<string, number> = {};
    const r = digSphere(
      (cx: number, cy: number, cz: number) => this.keepNatOf(cx, cy, cz),
      pos.x,
      pos.y,
      pos.z,
      radius,
      strength,
      drillPower,
      (mat: number) => {
        const def = MATERIALS[mat];
        // MINEAR: common rock gives stone at its own rate; ore voxels give their ore at ORE_YIELD
        const ore = def?.ore ?? (def?.stone ? `stone` : undefined);
        if (!ore) return;
        const carry = (this.oreCarry[ore] ?? Math.random()) + (def.ore ? ORE_YIELD : def.stone!);
        const whole = Math.floor(carry);
        this.oreCarry[ore] = carry - whole;
        if (whole) yields[ore] = (yields[ore] ?? 0) + whole;
      },
      fast,
    );
    if (r.touched > 0) {
      this.markDirty(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1);
      this.onDig?.(pos.x, pos.y, pos.z, radius, strength, drillPower);
    }
    return { yields, removed: r.removed, touched: r.touched, mat: r.mat, tooHard: r.tooHard };
  }
  /** Places boulder rock in a sphere. Returns the number of voxels made solid. */
  fill(pos: XYZ, radius: number): number {
    const r = fillSphere((cx: number, cy: number, cz: number) => this.keepNatOf(cx, cy, cz), pos.x, pos.y, pos.z, radius, boulderMat());
    if (r.touched > 0) {
      this.markDirty(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1);
      this.onDig?.(pos.x, pos.y, pos.z, radius, 0, 0, 1);
    }
    return r.removed;
  }
  /** Remote edit: only touches loaded chunks. Returns the density touched. */
  applyDig(x: number, y: number, z: number, radius: number, strength: number, power: number, isFill = 0): number {
    const get = (cx: number, cy: number, cz: number) => {
      const c = this.chunks.get(chunkKey(cx, cy, cz)) ?? null;
      if (c) this.keepNat(c);
      return c;
    };
    const r = isFill ? fillSphere(get, x, y, z, radius, boulderMat()) : digSphere(get, x, y, z, radius, strength, power);
    if (r.touched > 0) this.markDirty(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1);
    return r.touched;
  }
  /** Server chunk state. Rebuilds the dug mask and the modified flag from the natural copy. */
  applySnapshot(
    cx: number,
    cy: number,
    cz: number,
    density: ArrayLike<number>,
    material: ArrayLike<number>,
    afterSet?: (chunk: Chunk) => void,
  ): void {
    const c = this.chunks.get(chunkKey(cx, cy, cz));
    if (!c || density.length !== c.density.length || material.length !== c.material.length) return;
    this.keepNat(c);
    if (!c.nat) {
      const g = generateChunk(cx, cy, cz);
      c.nat = { density: g.density, material: g.material };
    }
    const nat = c.nat;
    const prevD = c.density.slice();
    const prevM = c.material.slice();
    c.density.set(density);
    c.material.set(material);
    c.dug = null;
    c.modified = true;
    afterSet?.(c);
    const oldDug = c.dug as Uint8Array | null;
    const d = c.density;
    const m = c.material;
    let dug: Uint8Array | null = null;
    let changed = false;
    let x0 = q;
    let y0 = q;
    let z0 = q;
    let x1 = -1;
    let y1 = -1;
    let z1 = -1;
    for (let i = 0; i < d.length; i++) {
      if (d[i] < nat.density[i] || oldDug?.[i]) (dug ??= new Uint8Array(d.length))[i] = 1;
      if (d[i] !== nat.density[i] || m[i] !== nat.material[i]) changed = true;
      if (d[i] === prevD[i] && m[i] === prevM[i]) continue;
      const x = i % q;
      const y = Math.floor(i / q) % q;
      const z = Math.floor(i / (q * q));
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      z1 = Math.max(z1, z);
    }
    c.dug = dug;
    c.modified = changed;
    if (x1 >= 0) this.markDirty(cx * q + x0, cy * q + y0, cz * q + z0, cx * q + x1, cy * q + y1, cz * q + z1);
  }
  /**
   * Resets every edited chunk to its generated state. Returns the restored chunks.
   * MINEAR: with `near` (a world position, Back to Base passes the lift), only the edited chunks within
   * `keepR` chunks of it are generated again and re-meshed; the others are dropped (mesh and record), so
   * they generate fresh the next time the miner comes near. A long trip leaves hundreds of edited chunks
   * deep down: generating them all again blocked the teleport for 0.1-0.5 s and re-meshed rock nobody sees.
   */
  restore(near?: XYZ, keepR = this.loadFar + 1): Chunk[] {
    const out: Chunk[] = [];
    const ncx = near ? Math.floor(near.x / q) : 0;
    const ncy = near ? Math.floor(near.y / q) : 0;
    const ncz = near ? Math.floor(near.z / q) : 0;
    for (const [key, c] of this.chunks) {
      if (!c.modified && !c.dug) continue;
      if (near) {
        const dx = c.cx - ncx;
        const dz = c.cz - ncz;
        if (dx * dx + dz * dz > keepR * keepR || Math.abs(c.cy - ncy) > keepR) {
          this.drop(key, c);
          continue;
        }
      }
      const g = generateChunk(c.cx, c.cy, c.cz);
      c.density.set(g.density);
      c.material.set(g.material);
      c.dug = null;
      c.modified = false;
      out.push(c);
    }
    for (const c of out)
      this.markDirty(c.cx * q, c.cy * q, c.cz * q, c.cx * q + q - 1, c.cy * q + q - 1, c.cz * q + q - 1);
    return out;
  }
  setMaterial(material: THREE.Material): void {
    if (this.activeMaterial !== material) {
      this.activeMaterial = material;
      for (const m of this.meshes) m.material = material;
      this.batch?.setMaterial(material);
    }
  }
  /**
   * Shadow distance and visibility culling. hideBuried: KR passes `camera.y > surfaceHeight(camera.x, camera.z) - 3`
   * (camera above ground), which hides far buried chunks.
   */
  cullBuried(pos: XYZ, hideBuried: boolean): void {
    const pits: ChunkMesh[] = [];
    const buried: ChunkMesh[] = [];
    for (const m of this.meshes) {
      const c = m.userData.chunk as Chunk;
      const dx = m.position.x + q / 2 - pos.x;
      const dy = m.position.y + q / 2 - pos.y;
      const dz = m.position.z + q / 2 - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      m.castShadow = d2 < 3136;
      m.visible = !hideBuried || c.surface || c.modified || d2 < 676;
      if (hideBuried && m.visible && this.drawR !== Infinity) {
        const ex = c.cx - this.drawCX;
        const ez = c.cz - this.drawCZ;
        if (ex * ex + ez * ez > this.drawR * this.drawR) m.visible = false;
      }
      if (this.pitsOnly && hideBuried && !c.surface && c.modified && d2 >= 676) pits.push(m);
      else if (hideBuried && !m.visible && !c.modified) buried.push(m);
    }
    pits.sort((a, b) => (b.userData.chunk as Chunk).cy - (a.userData.chunk as Chunk).cy);
    for (const m of pits) {
      const c = m.userData.chunk as Chunk;
      const above = this.chunks.get(chunkKey(c.cx, c.cy + 1, c.cz));
      m.visible = !!above && above.modified && !!above.mesh?.visible;
    }
    for (const m of buried) {
      const c = m.userData.chunk as Chunk;
      const above = this.chunks.get(chunkKey(c.cx, c.cy + 1, c.cz));
      if (above?.modified && above.mesh?.visible) m.visible = true;
    }
    this.mirror(true);
  }
  mirror(shadows: boolean): void {
    this.batch?.mirror(this.meshes, shadows);
  }
  pitsOnly = false;
  /** Burrow view: show only chunks within radius (+16) of pos; null shows all. */
  cullBeyond(pos: XYZ, radius: number | null): void {
    const r2 = radius === null ? Infinity : (radius + q) * (radius + q);
    for (const m of this.meshes) {
      if (radius === null) {
        m.visible = true;
        continue;
      }
      const dx = m.position.x + q / 2 - pos.x;
      const dy = m.position.y + q / 2 - pos.y;
      const dz = m.position.z + q / 2 - pos.z;
      m.visible = dx * dx + dy * dy + dz * dz < r2;
    }
    this.mirror(false);
  }
  /** Marks loaded chunks touching the voxel box (3-voxel margin) dirty and mixed. */
  markDirty(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const cx0 = Math.floor((x0 - 3) / q);
    const cx1 = Math.floor((x1 + 3) / q);
    const cy0 = Math.floor((y0 - 3) / q);
    const cy1 = Math.floor((y1 + 3) / q);
    const cz0 = Math.floor((z0 - 3) / q);
    const cz1 = Math.floor((z1 + 3) / q);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = this.chunks.get(chunkKey(cx, cy, cz));
          if (c) {
            c.dirty = true;
            if (c.uniform !== -1) c.uniform = -1;
          }
        }
  }
  /** Rebuilds dirty, already meshed chunks within r of pos right now (outside the budget). */
  remeshNear(pos: XYZ, r = 4): void {
    const cx0 = Math.floor((pos.x - r) / q);
    const cx1 = Math.floor((pos.x + r) / q);
    const cy0 = Math.floor((pos.y - r) / q);
    const cy1 = Math.floor((pos.y + r) / q);
    const cz0 = Math.floor((pos.z - r) / q);
    const cz1 = Math.floor((pos.z + r) / q);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = this.chunks.get(chunkKey(cx, cy, cz));
          if (c && c.dirty && (c.meshed || c.mesh)) this.buildMesh(c);
        }
  }
  /** Chunk meshes whose chunk cells touch the box (the query used by PlayerController.collide). */
  collidersIn(box: THREE.Box3, out: THREE.Mesh[] = []): THREE.Mesh[] {
    out.length = 0;
    const cx0 = Math.floor(box.min.x / q);
    const cx1 = Math.floor(box.max.x / q);
    const cy0 = Math.floor(box.min.y / q);
    const cy1 = Math.floor(box.max.y / q);
    const cz0 = Math.floor(box.min.z / q);
    const cz1 = Math.floor(box.max.z / q);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = this.chunks.get(chunkKey(cx, cy, cz));
          if (c?.mesh) out.push(c.mesh);
        }
    return out;
  }
}
