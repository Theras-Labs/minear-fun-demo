// Port of play-inUT-NSi.js lines 42640-43015 (and the temps of 42396-42410): the cave decor manager (cw).
// It decorates the carved cave surfaces of the loaded chunks near the player: ore nuggets on ore voxels,
// glowing mushroom clumps, rocks, stalagmites, ceiling drips, wall shelf fungi and crystals (palettes by depth),
// and hands the vertices inside a biome cavern to the biome dressing (kC). removeNear clears decor in a dig,
// nearestGlow feeds the biome glow light, pushOut keeps the miner out of solid props.
// Also KR's two closures for the constructor (70218-70224) as caveRoomTest / caveGroundProbe.
import * as THREE from 'three';
import { CAVE_TIME, caveCrystalMaterial, type CaveKit } from '../hub/caveKit';
import { surfaceHeight } from '../world/generate';
import { BIOMES, cavernAtWorld, cavernMetric } from '../world/caverns';
import { hash3, seededRandom } from '../world/rng';
import type { Chunk } from '../world/chunk';
import { bossLair } from '../foes/lair';
import { InstancePool } from './instancePool';
import {
  caveFungusMaterial,
  caveOreMaterial,
  caveRockMaterial,
  fallbackCrystalGeometry,
  fallbackCrystalMaterial,
} from './caveMaterials';
import { BIOME_TIME, type BiomeKit } from './biomeKit';
import { BiomeDressing } from './biomeDressing';

const tmpMatrix = new THREE.Matrix4(); // jC (42396)
const tmpQuatA = new THREE.Quaternion(); // NC (42398)
const tmpQuatB = new THREE.Quaternion(); // PC (42399)
const tmpScale = new THREE.Vector3(); // FC (42400)
const tmpDir = new THREE.Vector3(); // IC (42401)
const tmpSide = new THREE.Vector3(); // LC (42402)
const tmpUp = new THREE.Vector3(); // RC (42403)
const tmpFlat = new THREE.Vector3(); // zC (42404)
const tmpEuler = new THREE.Euler(); // BC (42405)
const tmpPos = new THREE.Vector3(); // VC (42406)
const UP = new THREE.Vector3(0, 1, 0); // UC (42408)
const DOWN = new THREE.Vector3(0, -1, 0); // WC (42409)

/** Fungus palettes by depth tier (< 45 m, < 100 m, deeper). */
const FUNGUS_PALETTES = [
  [1695910, 3130623, 9240410],
  [4881919, 10116351, 13921535],
  [16728004, 16751150, 16734810],
]; // aw (42640)

/** Crystal palettes by depth tier. */
const CRYSTAL_PALETTES = [
  [3135743, 4188344],
  [8019199, 4164863],
  [12865023, 16735386],
]; // ow (42645)

/** Rock colour from the voxel colour: saturated x1.4, then scaled by 0.9 * k. */
function rockColor(r: number, g: number, b: number, k: number): THREE.Color { // sw (42650)
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = 0.9 * k;
  return new THREE.Color(
    Math.max(0, l + (r - l) * 1.4) * s,
    Math.max(0, l + (g - l) * 1.4) * s,
    Math.max(0, l + (b - l) * 1.4) * s,
  );
}

/** One placed instance: pool index, slot, world position, colour, light source flag and solid radius. */
export interface DecorRecord {
  pool: number;
  slot: number;
  p: THREE.Vector3;
  color: THREE.Color;
  lit: boolean;
  solid: number;
}

/** A light source near a point (the biome glow light follows it). */
export interface GlowSpot {
  p: THREE.Vector3;
  color: THREE.Color;
}

/** Pool indices of the cave kit meshes. */
export interface CaveKitPools {
  dome: number;
  witch: number;
  trio: number;
  deceivers: number;
  inky: number;
  conk: number;
  shelf: number;
  rocks: number[];
  drips: number[];
  ores: number[];
  mythril: number;
  crystals: number[];
}

/** Open air above (x, y, z) up to `height`. */
export type RoomTest = (x: number, y: number, z: number, height: number) => boolean;
/** Ground height near (x, y, z), or null. */
export type GroundProbe = (x: number, y: number, z: number) => number | null;

/** KR's room test (70218-70221): no rock from 1.2 m up to `height` above the point. */
export function caveRoomTest(world: { sample(x: number, y: number, z: number): number }): RoomTest {
  return (x, y, z, height) => {
    for (let i = 1.2; i < height; i += 0.8) if (world.sample(x, y + i, z) > 128) return false;
    return world.sample(x, y + height, z) <= 128;
  };
}

/** KR's ground probe (70224): groundBelow from 2 m above, at most 4.5 m down. */
export function caveGroundProbe(world: {
  groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null;
}): GroundProbe {
  return (x, y, z) => world.groundBelow(x, z, y + 2, 4.5);
}

export class CaveDecor { // cw (42659)
  room: RoomTest;
  density: number;
  ground: GroundProbe;
  group = new THREE.Group();
  pools: InstancePool<DecorRecord>[] = [];
  /** Pool of the fallback crystals (capacity 1 when the kit is there). */
  crystal: number;
  kit: CaveKitPools | null = null;
  byChunk = new Map<Chunk, DecorRecord[]>();
  timer = 0;
  dressing: BiomeDressing | null = null;

  /**
   * caveKit: cave.glb (loadCaveKit). room / ground: KR's closures (caveRoomTest / caveGroundProbe).
   * density: DECOR_DENSITY[quality] (GR). biomeKit: biome.glb (loadBiomeKit).
   */
  constructor(
    caveKit: CaveKit | null,
    room: RoomTest = () => true,
    density = 1,
    biomeKit: BiomeKit | null = null,
    ground: GroundProbe = () => null,
  ) {
    this.room = room;
    this.density = density;
    this.ground = ground;
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, cap: number) => this.addPool(geometry, material, cap);
    this.crystal = add(fallbackCrystalGeometry(), fallbackCrystalMaterial(), caveKit ? 1 : 1500);
    if (!caveKit) return;
    const fungus = caveFungusMaterial();
    const rock = caveRockMaterial();
    const need = (name: string) => {
      if (!caveKit[name]) throw Error(`cave kit: ${name} missing`);
      return caveKit[name];
    };
    try {
      this.kit = {
        dome: add(need(`CV_Dome`), fungus, 500),
        witch: add(need(`CV_Witch`), fungus, 300),
        trio: add(need(`CV_Trio`), fungus, 60),
        deceivers: add(need(`CV_Deceivers`), fungus, 400),
        inky: add(need(`CV_Inky`), fungus, 500),
        conk: add(need(`CV_Conk`), fungus, 400),
        shelf: add(need(`CV_Shelf`), fungus, 160),
        rocks: [`CV_Rock1`, `CV_Rock2`, `CV_Rock3`].map((n) => add(need(n), rock, 350)),
        drips: [`CV_Drip1`, `CV_Drip2`, `CV_Drip3`].map((n) => add(need(n), rock, 260)),
        ores: [`CV_Ore1`, `CV_Ore2`].map((n) => add(need(n), caveOreMaterial(0.06), 500)),
        mythril: add(need(`CV_Ore3`), caveOreMaterial(0.3), 200),
        crystals: [1, 2, 3, 4, 5, 6].map((n) => add(need(`CV_Crys${n}`), caveCrystalMaterial(), 260)),
      };
    } catch (e) {
      console.warn(e);
      this.kit = null;
    }
    this.dressing = new BiomeDressing(this, biomeKit, caveRockMaterial(false));
  }

  addPool(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number): number {
    const pool = new InstancePool<DecorRecord>(geometry, material, cap);
    this.pools.push(pool);
    this.group.add(pool.mesh);
    return this.pools.length - 1;
  }

  geometryOf(pool: number): THREE.BufferGeometry {
    return this.pools[pool].mesh.geometry;
  }

  /** Places one instance into `list`. False when the pool is full. */
  put(
    list: DecorRecord[],
    pool: number,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    scale: THREE.Vector3,
    color: THREE.Color,
    lit: boolean,
    solid = 0,
  ): boolean {
    tmpMatrix.compose(pos, quat, scale);
    const rec: DecorRecord = { pool, slot: -1, p: pos.clone(), color, lit, solid };
    rec.slot = this.pools[pool].alloc(tmpMatrix, color, rec);
    if (rec.slot < 0) return false;
    list.push(rec);
    return true;
  }

  /** Up tilted toward `normal` by `tilt`, turned by `yaw` (a shared temp quaternion). */
  stand(normal: THREE.Vector3, tilt: number, yaw: number): THREE.Quaternion {
    tmpDir.copy(UP).lerp(normal, tilt).normalize();
    tmpQuatA.setFromUnitVectors(UP, tmpDir);
    tmpQuatB.setFromAxisAngle(UP, yaw);
    return tmpQuatA.multiply(tmpQuatB);
  }

  spawnForChunk(chunk: Chunk): void {
    if (this.byChunk.has(chunk) || !chunk.mesh) return;
    const list: DecorRecord[] = [];
    this.byChunk.set(chunk, list);
    const surf = surfaceHeight(chunk.cx * 16 + 8, chunk.cz * 16 + 8);
    const deep = chunk.cy * 16 + 16 <= surf - 8;
    const kit = this.kit;
    if (!deep && !kit) return;
    const geo = chunk.mesh.geometry;
    const position = geo.getAttribute(`position`);
    const normal = geo.getAttribute(`normal`);
    const carved = geo.getAttribute(`carved`);
    const color = geo.getAttribute(`color`);
    const ore = geo.getAttribute(`ore`) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const oreCol = geo.getAttribute(`oreCol`);
    const origin = chunk.mesh.position;
    const rand = seededRandom(hash3(chunk.cx, chunk.cy, chunk.cz, 4242));
    const mx = chunk.cx * 16 + 8;
    const my = chunk.cy * 16 + 8;
    const mz = chunk.cz * 16 + 8;
    let region = this.dressing ? cavernAtWorld(mx, my, mz) : null;
    if (region && cavernMetric(region, mx, my, mz) > 2.3) region = null;
    const lair = region?.beast ? bossLair(region) : null;
    const ores: THREE.Vector3[] = [];
    const n = new THREE.Vector3();
    for (let v = 0; v < position.count; v++) {
      if (carved.getX(v) > 0.5 || position.getX(v) < 0 || position.getY(v) < 0 || position.getZ(v) < 0) continue;
      n.set(normal.getX(v), normal.getY(v), normal.getZ(v)).normalize();
      const ny = n.y;
      const x = origin.x + position.getX(v);
      const y = origin.y + position.getY(v);
      const z = origin.z + position.getZ(v);
      const roll = hash3(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2), 77) / 4294967296;
      const at = tmpPos.set(x, y, z);
      const oreK = ore ? ore.getX(v) : 0;
      if (kit && oreK > 0.45 && roll < 0.16 && ores.every((o) => o.distanceToSquared(at) > 2.2 * 2.2)) {
        const tint = new THREE.Color(oreCol.getX(v) / oreK, oreCol.getY(v) / oreK, oreCol.getZ(v) / oreK);
        const pool = tint.b > tint.r && tint.b > 0.8 ? kit.mythril : kit.ores[Math.floor(rand() * 2)];
        const s = 0.75 + rand() * 0.6 + oreK * 0.3;
        tmpScale.set(s, s * (0.8 + rand() * 0.4), s);
        const q = this.stand(n, 0.85, rand() * Math.PI * 2);
        if (this.put(list, pool, at.clone().addScaledVector(n, -0.06 * s), q, tmpScale, tint, true)) ores.push(at.clone());
        continue;
      }
      if (!deep) continue;
      const depth = surf - y;
      if (depth < 8) continue;
      if (region && cavernMetric(region, x, y, z) < 1.1) {
        if (
          ny > 0.3 &&
          lair &&
          Math.hypot(x - lair.x, z - lair.z) < (region.biome === `bog` ? 11 : 15) &&
          Math.abs(y - lair.y) < 8
        )
          continue;
        this.dressing!.vertex(list, region, at, n, roll / this.density, rand);
        continue;
      }
      const tier = depth < 45 ? 0 : depth < 100 ? 1 : 2;
      const palette = FUNGUS_PALETTES[tier];
      const r = roll / this.density;
      const rockCol = () => rockColor(color.getX(v), color.getY(v), color.getZ(v), 0.8 + rand() * 0.35);
      if (ny > 0.75) {
        if (kit && r < 0.024) this.clump(list, at, n, palette, rand);
        else if (kit && r < 0.04) {
          const count = 1 + Math.floor(rand() * 3);
          for (let k = 0; k < count; k++) {
            const a = rand() * Math.PI * 2;
            const d = k ? 0.35 + rand() * 0.5 : 0;
            const s = (k ? 0.16 : 0.26) + rand() * (k ? 0.18 : 0.34);
            const p = new THREE.Vector3(x + Math.cos(a) * d, y - s * 0.22, z + Math.sin(a) * d);
            tmpEuler.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5);
            tmpQuatA.setFromEuler(tmpEuler);
            tmpScale.set(s, s * (0.7 + rand() * 0.5), s);
            this.put(list, kit.rocks[Math.floor(rand() * 3)], p, tmpQuatA, tmpScale, rockCol(), false);
          }
        } else if (kit && r < 0.046) {
          const s = 0.55 + rand() * 0.7;
          const which = Math.floor(rand() * 3);
          if (this.room(x, y, z, (which === 2 ? 2.4 : 1.8) * s + 0.3)) {
            tmpScale.set(s, s * (0.85 + rand() * 0.4), s);
            this.put(
              list,
              kit.drips[which],
              at.clone().setY(y - 0.12),
              this.stand(n, 0.25, rand() * Math.PI * 2),
              tmpScale,
              rockCol(),
              false,
            );
          }
        } else if (kit && r < 0.05) this.crystals(list, at, n, tier, rand, true);
      } else if (ny < -0.6) {
        if (kit && r < 0.016) {
          const s = 0.5 + rand() * 0.75;
          tmpScale.set(s, s * (0.8 + rand() * 0.5), s);
          tmpDir.copy(DOWN).lerp(n, 0.2).normalize();
          tmpQuatA.setFromUnitVectors(UP, tmpDir);
          tmpQuatB.setFromAxisAngle(UP, rand() * Math.PI * 2);
          this.put(
            list,
            kit.drips[Math.floor(rand() * 3)],
            at.clone().addScaledVector(n, -0.14),
            tmpQuatA.multiply(tmpQuatB),
            tmpScale,
            rockCol(),
            false,
          );
        } else if (r < 0.028) this.crystals(list, at, n, tier, rand);
      } else if (Math.abs(ny) < 0.45) {
        if (kit && r < 0.01) {
          const out = tmpFlat.set(n.x, 0, n.z).normalize();
          tmpUp.copy(UP);
          tmpSide.crossVectors(tmpUp, out).normalize();
          tmpMatrix.makeBasis(tmpSide, tmpUp, out);
          const q = new THREE.Quaternion().setFromRotationMatrix(tmpMatrix);
          const shelf = rand() < 0.35;
          const s = shelf ? 0.7 + rand() * 0.45 : 0.75 + rand() * 0.6;
          tmpScale.set(s, s, s);
          const tint = new THREE.Color(palette[Math.floor(rand() * 3)]).multiplyScalar(0.85 + rand() * 0.3);
          this.put(list, shelf ? kit.shelf : kit.conk, at.clone().addScaledVector(out, -0.06), q, tmpScale, tint, true);
        } else if (r < 0.017) this.crystals(list, at, n, tier, rand);
      }
    }
    if (
      region &&
      BIOMES[region.biome].liquid &&
      region.liquidY >= chunk.cy * 16 &&
      region.liquidY < chunk.cy * 16 + 16
    )
      this.dressing!.pools(list, region, chunk.cx * 16, chunk.cz * 16, 16, rand, this.density);
  }

  /** The nearest light source (lit decor) within r of pos, or null. */
  nearestGlow(pos: THREE.Vector3, r: number): GlowSpot | null {
    let best: DecorRecord | null = null;
    let bestD = r * r;
    for (const [chunk, list] of this.byChunk) {
      if (
        Math.abs(chunk.cx * 16 + 8 - pos.x) > 16 + r ||
        Math.abs(chunk.cy * 16 + 8 - pos.y) > 16 + r ||
        Math.abs(chunk.cz * 16 + 8 - pos.z) > 16 + r
      )
        continue;
      for (const rec of list) {
        if (!rec.lit) continue;
        const d = rec.p.distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          best = rec;
        }
      }
    }
    return best ? { p: best.p, color: best.color } : null;
  }

  /** Pushes pos (and the inward part of vel) out of the solid props' cylinders. True when it moved. */
  pushOut(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean {
    let moved = false;
    for (const [chunk, list] of this.byChunk) {
      if (
        Math.abs(chunk.cx * 16 + 8 - pos.x) > 16 ||
        Math.abs(chunk.cy * 16 + 8 - pos.y) > 16 ||
        Math.abs(chunk.cz * 16 + 8 - pos.z) > 16
      )
        continue;
      for (const rec of list) {
        if (!rec.solid) continue;
        const dy = pos.y - rec.p.y;
        if (dy < -1.6 || dy > 2.2) continue;
        const dx = pos.x - rec.p.x;
        const dz = pos.z - rec.p.z;
        const reach = rec.solid + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= reach * reach || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        pos.x = rec.p.x + nx * reach;
        pos.z = rec.p.z + nz * reach;
        const into = vel.x * nx + vel.z * nz;
        if (into < 0) {
          vel.x -= into * nx;
          vel.z -= into * nz;
        }
        moved = true;
      }
    }
    return moved;
  }

  /** A clump of glowing mushrooms (one of six recipes). */
  clump(list: DecorRecord[], at: THREE.Vector3, normal: THREE.Vector3, palette: number[], rand: () => number): void {
    const kit = this.kit!;
    const colA = palette[Math.floor(rand() * 3)];
    const colB = palette[Math.floor(rand() * 3)];
    const tint = (hex: number) => new THREE.Color(hex).multiplyScalar(0.85 + rand() * 0.3);
    const one = (pool: number, dx: number, dz: number, s: number, color: THREE.Color, tilt = 0.25) => {
      tmpScale.set(s, s * (0.85 + rand() * 0.35), s);
      const p = new THREE.Vector3(at.x + dx, at.y - 0.04, at.z + dz);
      const q = this.stand(normal, tilt, rand() * Math.PI * 2);
      tmpQuatB.setFromEuler(tmpEuler.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25));
      q.multiply(tmpQuatB);
      this.put(list, pool, p, q, tmpScale, color, true);
    };
    const ring = (count: number, r0: number, r1: number, fn: (dx: number, dz: number) => void) => {
      for (let k = 0; k < count; k++) {
        const a = rand() * Math.PI * 2;
        const d = r0 + rand() * (r1 - r0);
        fn(Math.cos(a) * d, Math.sin(a) * d);
      }
    };
    const pick = rand();
    if (pick < 0.07 && this.room(at.x, at.y, at.z, 3.4)) {
      one(kit.trio, 0, 0, 0.85 + rand() * 0.45, tint(colA), 0.1);
      ring(2 + Math.floor(rand() * 3), 0.9, 1.5, (dx, dz) => one(rand() < 0.5 ? kit.inky : kit.dome, dx, dz, 0.35 + rand() * 0.3, tint(colB)));
    } else if (pick < 0.36) {
      one(kit.dome, 0, 0, 0.7 + rand() * 0.6, tint(colA));
      ring(Math.floor(rand() * 3.5), 0.45, 0.8, (dx, dz) => one(kit.dome, dx, dz, 0.3 + rand() * 0.3, tint(rand() < 0.7 ? colA : colB)));
    } else if (pick < 0.55)
      ring(1 + Math.floor(rand() * 3), 0, 0.55, (dx, dz) => one(kit.deceivers, dx, dz, 0.75 + rand() * 0.6, tint(colA), 0.15));
    else if (pick < 0.72) ring(2 + Math.floor(rand() * 3), 0, 0.5, (dx, dz) => one(kit.inky, dx, dz, 0.7 + rand() * 0.6, tint(colA)));
    else if (pick < 0.88) {
      one(kit.witch, 0, 0, 0.65 + rand() * 0.55, tint(colA));
      if (rand() < 0.5) ring(1, 0.4, 0.6, (dx, dz) => one(kit.witch, dx, dz, 0.35 + rand() * 0.2, tint(colA)));
    } else {
      one(kit.dome, 0, 0, 0.6 + rand() * 0.4, tint(colA));
      ring(2, 0.4, 0.7, (dx, dz) => one(kit.deceivers, dx, dz, 0.6 + rand() * 0.4, tint(colB), 0.15));
    }
  }

  /** A kit crystal (floor: the squat ones), or 2-4 fallback prisms when there is no kit. */
  crystals(
    list: DecorRecord[],
    at: THREE.Vector3,
    normal: THREE.Vector3,
    tier: number,
    rand: () => number,
    floor = false,
  ): void {
    const palette = CRYSTAL_PALETTES[tier];
    const tint = new THREE.Color(palette[Math.floor(rand() * 2)]);
    const kit = this.kit;
    if (kit) {
      const pool = kit.crystals[floor ? 4 + Math.floor(rand() * 2) : Math.floor(rand() * 4)];
      const s = floor ? 0.35 + rand() * 0.4 : 0.45 + rand() * 0.6;
      tmpScale.set(s, s * (0.85 + rand() * 0.4), s);
      this.put(
        list,
        pool,
        at.clone().addScaledVector(normal, -0.1 * s),
        this.stand(normal, floor ? 0.3 : 0.9, rand() * Math.PI * 2),
        tmpScale,
        tint,
        true,
      );
      return;
    }
    const count = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      tmpDir
        .copy(normal)
        .add(new THREE.Vector3((rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8))
        .normalize();
      tmpQuatA.setFromUnitVectors(UP, tmpDir);
      const a = (k ? 0.25 : 0.5) + rand() * 0.45;
      tmpScale.set(a * 0.2, a, a * 0.2);
      const p = new THREE.Vector3(
        at.x + (rand() - 0.5) * 0.4,
        at.y + (rand() - 0.5) * 0.4,
        at.z + (rand() - 0.5) * 0.4,
      ).addScaledVector(normal, -0.12);
      if (!this.put(list, this.crystal, p, tmpQuatA, tmpScale, tint, true)) break;
    }
  }

  /**
   * Per frame (KR 72061, after decor.update): advances the cave and biome material time, and every 0.4 s
   * decorates up to 24 new chunks within 38 m (nearest first) and drops chunks beyond 50 m.
   */
  update(dt: number, pos: THREE.Vector3, chunks: Iterable<Chunk>): void {
    CAVE_TIME.value += dt;
    BIOME_TIME.value += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const fresh: Chunk[] = [];
    for (const c of chunks) {
      if (!c.mesh) continue;
      const dx = c.cx * 16 + 8 - pos.x;
      const dy = c.cy * 16 + 8 - pos.y;
      const dz = c.cz * 16 + 8 - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1444) {
        if (!this.byChunk.has(c)) fresh.push(c);
      } else if (d2 > 2500 && this.byChunk.has(c)) this.unloadChunk(c);
    }
    fresh.sort(
      (a, b) =>
        (a.cx * 16 - pos.x) ** 2 +
        (a.cy * 16 - pos.y) ** 2 +
        (a.cz * 16 - pos.z) ** 2 -
        ((b.cx * 16 - pos.x) ** 2 + (b.cy * 16 - pos.y) ** 2 + (b.cz * 16 - pos.z) ** 2),
    );
    for (const c of fresh.slice(0, 24)) this.spawnForChunk(c);
  }

  /** Frees the decor of a chunk (KR world.onChunkUnloaded, and the chunks a sandbox restore returns). */
  unloadChunk(chunk: Chunk): void {
    const list = this.byChunk.get(chunk);
    if (!list) return;
    for (const rec of list) this.pools[rec.pool].release(rec.slot);
    this.byChunk.delete(chunk);
  }

  /** Removes the decor within r + 0.4 of pos; returns the light sources lost (for sparks). */
  removeNear(pos: THREE.Vector3, r: number): GlowSpot[] {
    const lost: GlowSpot[] = [];
    const r2 = (r + 0.4) ** 2;
    for (const [, list] of this.byChunk)
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i];
        if (rec.p.distanceToSquared(pos) > r2) continue;
        this.pools[rec.pool].release(rec.slot);
        if (rec.lit) lost.push({ p: rec.p, color: rec.color });
        list.splice(i, 1);
      }
    return lost;
  }
}
