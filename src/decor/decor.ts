// Port of play-inUT-NSi.js lines 37792-38256: the multi-part instance pool cx and the decor manager Sx.
// Decor puts instanced trees, bushes and rocks on the surface of the 16x16 world columns near the player
// (seeded per column, slope-checked), keeps them within a 7-column radius and drops far ones. It pushes the
// player out of trunks and rocks, lets digging and attacks remove small props (returned for the dust) and chop
// giant trees with HP (shake, fall, land, crumble events), and regrows removed props with a grow animation.
import * as THREE from 'three';
import type { ChunkManager } from '../world/chunkManager';
import { seededRandom, hash3 } from '../world/rng';
import { WORLD_SEED } from '../world/constants';
import {
  bushRecipe,
  forestAt,
  giantOakRecipe,
  giantPineRecipe,
  oakRecipe,
  pineRecipe,
  rockGeometry,
  type VegetationRecipe,
} from './vegetation';
import { createLeafDepthMaterial, createLeafMaterial, createPropMaterial, vegetationTime } from './vegetationMaterials';

/** One part of a pooled prop kind (trunk, crown or rock). */
export interface PoolPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  shadow: boolean;
  depth?: THREE.Material;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // lx (37837)
const WHITE = new THREE.Color(1, 1, 1); // ux (37838)

/** One InstancedMesh per part; the parts share slot indices. */
export class InstancePool { // cx (37792)
  meshes: THREE.InstancedMesh[] = [];
  used: Uint8Array;
  high = 0;
  constructor(parts: PoolPart[], capacity: number) {
    for (const part of parts) {
      const m = new THREE.InstancedMesh(part.geo, part.mat, capacity);
      m.frustumCulled = false;
      m.castShadow = part.shadow;
      m.receiveShadow = true;
      if (part.depth) m.customDepthMaterial = part.depth;
      m.count = 0;
      m.visible = false;
      for (let n = 0; n < capacity; n++) m.setMatrixAt(n, HIDDEN);
      m.setColorAt(0, WHITE);
      this.meshes.push(m);
    }
    this.used = new Uint8Array(capacity);
  }
  /** Takes the first free slot (or -1) and writes the matrix and colour to every part. */
  alloc(matrix: THREE.Matrix4, color: THREE.Color): number {
    const n = this.used.indexOf(0);
    if (n < 0) return -1;
    this.used[n] = 1;
    for (const m of this.meshes) {
      m.setMatrixAt(n, matrix);
      m.setColorAt(n, color);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    }
    if (n + 1 > this.high) {
      this.high = n + 1;
      for (const m of this.meshes) {
        m.count = this.high;
        m.visible = this.high > 0;
      }
    }
    return n;
  }
  setMatrix(slot: number, matrix: THREE.Matrix4): void {
    for (const m of this.meshes) {
      m.setMatrixAt(slot, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
  }
  /** Hides the slot (zero scale) and shrinks the draw count to the highest used slot. */
  release(slot: number): void {
    this.used[slot] = 0;
    for (const m of this.meshes) {
      m.setMatrixAt(slot, HIDDEN);
      m.instanceMatrix.needsUpdate = true;
    }
    if (slot + 1 === this.high) {
      for (; this.high > 0 && !this.used[this.high - 1]; ) this.high--;
      for (const m of this.meshes) {
        m.count = this.high;
        m.visible = this.high > 0;
      }
    }
  }
}

export const REGROW_S = 240; // dx (37839) regrow seconds for normal trees and bushes
export const GIANT_REGROW_S = 900; // fx (37840) regrow seconds for a felled giant tree
export const GROW_S = 30; // px (37841) grow animation seconds
export const FALL_S = 2.2; // mx (37842) fall duration
export const REST_S = 1.4; // hx (37843) rest after landing before the crumble
export const CRUMBLE_S = 0.6; // gx (37844) crumble shrink seconds
export const HIT_COOLDOWN_S = 0.4; // _x (37845) hit cooldown for giant trees

const tmpM = new THREE.Matrix4(); // vx (37846)
const tmpQ = new THREE.Quaternion(); // yx (37847)
const tmpS = new THREE.Vector3(); // bx (37848)

/** Prop kind -> pool indices. */
export const POOL_KINDS = { // xx (37849)
  oak: [0, 1, 2],
  tall: [3, 4],
  pine: [5, 6],
  bush: [7, 8, 9],
  rock: [10, 11, 12],
  giant: [13, 15],
  giantPine: [14],
};

const isRock = (pool: number): boolean => pool >= POOL_KINDS.rock[0] && pool <= POOL_KINDS.rock[POOL_KINDS.rock.length - 1];
const isGiant = (pool: number): boolean => POOL_KINDS.giant.includes(pool) || POOL_KINDS.giantPine.includes(pool);

/** One placed prop. */
export interface DecorItem {
  pool: number;
  slot: number;
  pos: THREE.Vector3;
  id: number;
  radius: number;
  color: number;
  big: boolean;
  solid: number;
  q: THREE.Quaternion;
  s: THREE.Vector3;
  hp: number;
  hitT: number;
  gone?: boolean;
}

export interface DecorAnim {
  it: DecorItem;
  kind: `shake` | `fall` | `grow`;
  t: number;
  axis: THREE.Vector3;
}

/** Events for KR.decorEvents (73070): a giant tree was hit, landed after its fall, or crumbled away. */
export type DecorEvent =
  | { kind: `hit`; pos: THREE.Vector3; size: number }
  | { kind: `land`; pos: THREE.Vector3; from: THREE.Vector3; size: number }
  | { kind: `crumble`; pos: THREE.Vector3; from: THREE.Vector3; size: number };

/** A small prop removed by removeNear (for the dust and debris). */
export interface RemovedProp {
  pos: THREE.Vector3;
  color: number;
  big: boolean;
}

export class Decor { // Sx (37858)
  world: ChunkManager;
  group = new THREE.Group();
  pools: InstancePool[];
  cols = new Map<string, DecorItem[]>();
  removed = new Map<number, { at: number; col: string }>();
  events: DecorEvent[] = [];
  anims: DecorAnim[] = [];
  clock = 0;
  timer = 0;
  painterly = false;
  sparse = 1;
  lastPlayer = new THREE.Vector3(1e9, 0, 1e9);

  setPainterly(on: boolean): void {
    if (on !== this.painterly) {
      this.painterly = on;
      this.redecorate();
    }
  }
  setSparse(k: number): void {
    if (k !== this.sparse) {
      this.sparse = k;
      this.redecorate();
    }
  }
  redecorate(): void {
    for (const items of this.cols.values()) for (const it of items) this.drop(it);
    for (const a of this.anims) if (a.kind === `fall`) this.drop(a.it);
    this.anims = [];
    this.cols.clear();
    if (this.lastPlayer.x > 1e8) return;
    const cx = Math.floor(this.lastPlayer.x / 16);
    const cz = Math.floor(this.lastPlayer.z / 16);
    for (let n = -7; n <= 7; n++) for (let r = -7; r <= 7; r++) if (r * r + n * n <= 50) this.decorateColumn(cx + r, cz + n);
  }

  constructor(world: ChunkManager) {
    this.world = world;
    const leaf = createLeafMaterial();
    const leafDepth = createLeafDepthMaterial();
    const prop = createPropMaterial();
    const tree = (recipe: VegetationRecipe, capacity: number) =>
      new InstancePool(
        [
          ...(recipe.trunk ? [{ geo: recipe.trunk, mat: prop, shadow: true }] : []),
          { geo: recipe.crown, mat: leaf, depth: leafDepth, shadow: true },
        ],
        capacity,
      );
    this.pools = [
      tree(oakRecipe(1), 260),
      tree(oakRecipe(2), 260),
      tree(oakRecipe(3), 260),
      tree(oakRecipe(4, true), 200),
      tree(oakRecipe(5, true), 200),
      tree(pineRecipe(6), 220),
      tree(pineRecipe(7), 220),
      tree(bushRecipe(8), 500),
      tree(bushRecipe(9), 500),
      tree(bushRecipe(10, true), 400),
      new InstancePool([{ geo: rockGeometry(11, 0.8), mat: prop, shadow: true }], 400),
      new InstancePool([{ geo: rockGeometry(12, 1.3), mat: prop, shadow: true }], 300),
      new InstancePool([{ geo: rockGeometry(13, 0.5), mat: prop, shadow: true }], 500),
      tree(giantOakRecipe(20), 50),
      tree(giantPineRecipe(21), 60),
      tree(giantOakRecipe(22), 50),
    ];
    for (const p of this.pools) for (const m of p.meshes) this.group.add(m);
  }

  /** Places the props of one 16x16 column (once; seeded by the column). */
  decorateColumn(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.cols.has(key)) return;
    const items: DecorItem[] = [];
    this.cols.set(key, items);
    const rand = seededRandom(hash3(cx, 777, cz, WORLD_SEED));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const tint = new THREE.Color();
    const place = (
      pools: number[],
      count: number,
      minScale: number,
      maxScale: number,
      radiusK: number,
      color: number,
      maxSlope = 0.8,
      solidK = 0,
    ) => {
      for (let k = 0; k < count; k++) {
        const pool = pools[Math.floor(rand() * pools.length)];
        const x = cx * 16 + rand() * 16;
        const z = cz * 16 + rand() * 16;
        const v = rand();
        const y = rand();
        const b = rand();
        const id = hash3(Math.floor(x * 10), pool, Math.floor(z * 10), 5);
        if (
          this.removed.has(id) ||
          (this.sparse < 1 && (pools === POOL_KINDS.bush || pools === POOL_KINDS.rock) && ((id >>> 0) % 1e3) / 1e3 >= this.sparse) ||
          Math.hypot(x, z) < (radiusK > 4 ? 37 : 11.5)
        )
          continue;
        const ground = this.world.groundBelow(x, z, 17, 28);
        if (ground === null) continue;
        const gx = this.world.groundBelow(x + 1, z, 17, 28);
        const gz = this.world.groundBelow(x, z + 1, 17, 28);
        if (gx === null || gz === null || Math.abs(gx - ground) > maxSlope || Math.abs(gz - ground) > maxSlope) continue;
        const sc = minScale + v * (maxScale - minScale);
        q.setFromEuler(new THREE.Euler(0, y * Math.PI * 2, 0));
        s.set(sc, sc * (0.92 + b * 0.16), sc);
        const pos = new THREE.Vector3(x, ground - 0.08, z);
        m.compose(pos, q, s);
        tint.setRGB(0.9 + b * 0.18, 0.92 + v * 0.14, 0.88 + y * 0.1);
        const slot = this.pools[pool].alloc(m, tint);
        const giant = POOL_KINDS.giant.includes(pool) || POOL_KINDS.giantPine.includes(pool);
        if (slot >= 0)
          items.push({
            pool,
            slot,
            pos,
            id,
            radius: radiusK * sc,
            color,
            big: true,
            solid: solidK * sc,
            q: q.clone(),
            s: s.clone(),
            hp: giant ? (sc >= 0.9 ? 8 : 4) : 0,
            hitT: -9,
          });
      }
    };
    const { forest, pine } = forestAt(cx * 16 + 8, cz * 16 + 8);
    const K = POOL_KINDS;
    if (this.painterly) {
      if (forest) {
        const giants = pine ? K.giantPine : K.giant;
        const r = rand();
        if (r < 0.08) place(giants, 1, 0.95, 1.2, pine ? 5 : 7, 6268988, 0.6, pine ? 1.05 : 1.3);
        else if (r < 0.3) place(giants, 1, 0.55, 0.8, pine ? 5 : 7, 6268988, 0.6, pine ? 1.05 : 1.3);
        place(pine ? K.pine : K.oak, Math.floor(rand() * 1.8), 1, pine ? 1.7 : 1.9, 1.8, 6268988, 0.8, 0.32);
        if (rand() < 0.25) place(pine ? K.oak : K.tall, 1, 1, 1.8, 1.8, 6268988, 0.8, 0.32);
        place(K.bush, Math.floor(rand() * 1.6), 1, 1.5, 1, 6072898);
      } else {
        const r = rand();
        if (r < 0.02) place(K.giant, 1, 0.95, 1.15, 7, 6268988, 0.6, 1.3);
        else if (r < 0.08) place(K.giant, 1, 0.55, 0.75, 7, 6268988, 0.6, 1.3);
        if (rand() < 0.35) place(rand() < 0.5 ? K.oak : K.tall, 1, 1, 1.8, 1.8, 6268988, 0.8, 0.32);
        place(K.bush, Math.floor(rand() * 1.2), 1, 1.4, 1, 6072898);
      }
      place(K.rock, Math.floor(rand() * 1.8), 0.85, 1.7, 1.1, 10134453, 1.4, 0.95);
      return;
    }
    if (forest) {
      place(pine ? K.pine : K.oak, 2 + Math.floor(rand() * 2), 0.9, 1.3, 1.8, 6268988, 0.8, 0.32);
      place(pine ? K.oak : K.tall, Math.floor(rand() * 1.6), 0.85, 1.2, 1.8, 6268988, 0.8, 0.32);
      place(K.bush, 1 + Math.floor(rand() * 2), 0.8, 1.3, 1, 6072898);
    } else {
      place(rand() < 0.5 ? K.oak : K.tall, Math.floor(rand() * 1.3), 0.9, 1.25, 1.8, 6268988, 0.8, 0.32);
      place(K.bush, Math.floor(rand() * 1.6), 0.8, 1.2, 1, 6072898);
    }
    place(K.rock, Math.floor(rand() * 1.8), 0.7, 1.4, 1.1, 10134453, 1.4, 0.95);
  }

  /** Pushes a capsule of `radius` out of trunks and rocks (and removes the velocity into them). */
  pushOut(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean {
    if (pos.y > 22) return false;
    const cx0 = Math.floor((pos.x - 3) / 16);
    const cx1 = Math.floor((pos.x + 3) / 16);
    const cz0 = Math.floor((pos.z - 3) / 16);
    const cz1 = Math.floor((pos.z + 3) / 16);
    let pushed = false;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const items = this.cols.get(`${cx},${cz}`);
        if (items)
          for (const it of items) {
            if (!it.solid) continue;
            const dy = pos.y - it.pos.y;
            const rock = isRock(it.pool);
            const giant = isGiant(it.pool);
            if (dy < -1.5 || dy > (rock ? it.solid * 0.9 : giant ? 10 : 4)) continue;
            const dx = pos.x - it.pos.x;
            const dz = pos.z - it.pos.z;
            const r = it.solid + radius;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const nz = dz / d;
            pos.x = it.pos.x + nx * r;
            pos.z = it.pos.z + nz * r;
            const into = vel.x * nx + vel.z * nz;
            if (into < 0) {
              vel.x -= into * nx;
              vel.z -= into * nz;
            }
            pushed = true;
          }
      }
    return pushed;
  }

  /**
   * Digging / attack at pos with radius r. Giant trees (hp > 0) take `dmg` (0.4 s cooldown), shake, and fall
   * when hp runs out; small props within r + radius / 2 are removed and returned.
   */
  removeNear(pos: THREE.Vector3, r: number, dmg = 1): RemovedProp[] {
    const out: RemovedProp[] = [];
    if (pos.y > 20) return out;
    const cx0 = Math.floor((pos.x - r - 2) / 16);
    const cx1 = Math.floor((pos.x + r + 2) / 16);
    const cz0 = Math.floor((pos.z - r - 2) / 16);
    const cz1 = Math.floor((pos.z + r + 2) / 16);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cz}`;
        const items = this.cols.get(key);
        if (items)
          for (let k = items.length - 1; k >= 0; k--) {
            const it = items[k];
            const dx = it.pos.x - pos.x;
            const dz = it.pos.z - pos.z;
            const dy = it.pos.y - pos.y;
            if (dy <= -r - 1 || dy >= r + 0.6) continue;
            if (it.hp > 0) {
              const reach = r + it.solid + 0.4;
              if (dx * dx + dz * dz >= reach * reach || this.clock - it.hitT < HIT_COOLDOWN_S) continue;
              it.hitT = this.clock;
              it.hp -= dmg;
              this.events.push({ kind: `hit`, pos: it.pos.clone().setY(it.pos.y + 13 * it.s.y), size: it.s.x });
              const a = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2;
              const axis = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
              if (it.hp > 0) {
                this.anims = this.anims.filter((e) => e.it !== it);
                this.anims.push({ it, kind: `shake`, t: 0, axis });
                continue;
              }
              items.splice(k, 1);
              this.removed.set(it.id, { at: this.clock + GIANT_REGROW_S, col: key });
              this.anims = this.anims.filter((e) => e.it !== it);
              this.anims.push({ it, kind: `fall`, t: 0, axis });
              continue;
            }
            if (dx * dx + dz * dz < (r + it.radius * 0.5) ** 2) {
              this.drop(it);
              const rock = isRock(it.pool);
              this.removed.set(it.id, { at: rock ? Infinity : this.clock + REGROW_S, col: key });
              items.splice(k, 1);
              out.push({ pos: it.pos.clone(), color: it.color, big: it.big });
            }
          }
      }
    return out;
  }

  /** Permanently clears every prop whose footprint reaches within r of (x, z). */
  clear(x: number, z: number, r: number): void {
    const cx0 = Math.floor((x - r - 8) / 16);
    const cx1 = Math.floor((x + r + 8) / 16);
    const cz0 = Math.floor((z - r - 8) / 16);
    const cz1 = Math.floor((z + r + 8) / 16);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cz}`;
        const items = this.cols.get(key);
        if (items)
          for (let k = items.length - 1; k >= 0; k--) {
            const it = items[k];
            if (Math.hypot(it.pos.x - x, it.pos.z - z) >= r + it.radius) continue;
            this.drop(it);
            this.anims = this.anims.filter((e) => e.it !== it);
            this.removed.set(it.id, { at: Infinity, col: key });
            items.splice(k, 1);
          }
      }
  }

  /** The removed prop ids (for the sandbox rollback). */
  snapshot(): Set<number> {
    return new Set(this.removed.keys());
  }

  /** Brings back every prop removed since the snapshot (rebuilds their columns). */
  restore(snap: Set<number>): void {
    const cols = new Set<string>();
    const ids = new Set<number>();
    for (const [id, rec] of this.removed)
      if (!snap.has(id)) {
        ids.add(id);
        cols.add(rec.col);
        this.removed.delete(id);
      }
    if (cols.size) {
      this.anims = this.anims.filter((e) => e.kind !== `fall` || !ids.has(e.it.id) || (this.drop(e.it), false));
      for (const key of cols) {
        const items = this.cols.get(key);
        if (!items) continue;
        for (const it of items) this.drop(it);
        this.anims = this.anims.filter((e) => !items.includes(e.it));
        this.cols.delete(key);
        const [cx, cz] = key.split(`,`).map(Number);
        this.decorateColumn(cx, cz);
      }
    }
  }

  drop(it: DecorItem): void {
    if (!it.gone) {
      it.gone = true;
      this.pools[it.pool].release(it.slot);
    }
  }

  /** Shake, fall (then land, rest, crumble) and grow animations. */
  animate(dt: number): void {
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const anim = this.anims[k];
      const it = anim.it;
      if (it.gone) {
        this.anims.splice(k, 1);
        continue;
      }
      anim.t += dt;
      let scale = 1;
      let angle = 0;
      if (anim.kind === `shake`) {
        const f = anim.t / 0.7;
        angle = f < 1 ? Math.sin(anim.t * 26) * 0.035 * (1 - f) : 0;
        if (f >= 1) this.anims.splice(k, 1);
      } else if (anim.kind === `fall`) {
        const max = Math.PI * 0.48;
        const top = () =>
          it.pos
            .clone()
            .addScaledVector(new THREE.Vector3(0, 1, 0).applyAxisAngle(anim.axis, max), 13 * it.s.y)
            .setY(it.pos.y + 1.2);
        if (anim.t < FALL_S) angle = (anim.t / FALL_S) ** 2.4 * max;
        else {
          const c = anim.t - FALL_S;
          if (c - dt < 0) this.events.push({ kind: `land`, pos: top(), from: it.pos.clone(), size: it.s.x });
          angle = max - 0.035 * Math.sin(c * 13) * Math.exp(-c * 4);
          if (c > REST_S) {
            if (c - dt <= REST_S) this.events.push({ kind: `crumble`, pos: top(), from: it.pos.clone(), size: it.s.x });
            const n = Math.min(1, (c - REST_S) / CRUMBLE_S);
            scale = 1 - n * n;
            if (n >= 1) {
              this.anims.splice(k, 1);
              this.drop(it);
              continue;
            }
          }
        }
      } else {
        const e = Math.min(1, anim.t / GROW_S);
        scale = 0.12 + 0.88 * (1 - (1 - e) ** 3);
        if (e >= 1) this.anims.splice(k, 1);
      }
      tmpQ.setFromAxisAngle(anim.axis, angle).multiply(it.q);
      this.pools[it.pool].setMatrix(it.slot, tmpM.compose(it.pos, tmpQ, tmpS.copy(it.s).multiplyScalar(scale)));
    }
  }

  /** Regrows at most one due prop: rebuilds its column and starts the grow animation on it. */
  regrow(): void {
    for (const [id, rec] of this.removed) {
      if (rec.at > this.clock) continue;
      const items = this.cols.get(rec.col);
      if (!items) {
        this.removed.delete(id);
        continue;
      }
      if (items.some((e) => e.hp > 0 && this.clock - e.hitT < 30)) continue;
      this.removed.delete(id);
      for (const it of items) this.drop(it);
      this.cols.delete(rec.col);
      const [cx, cz] = rec.col.split(`,`).map(Number);
      this.decorateColumn(cx, cz);
      const back = this.cols.get(rec.col)?.find((e) => e.id === id);
      if (back) {
        const axis = new THREE.Vector3(1, 0, 0);
        this.anims.push({ it: back, kind: `grow`, t: 0, axis });
        this.pools[back.pool].setMatrix(back.slot, tmpM.compose(back.pos, back.q, tmpS.copy(back.s).multiplyScalar(0.12)));
      }
      return;
    }
  }

  /** Per frame (raw dt): animations every frame; regrow, up to 6 new columns and far-column drops every 0.25 s. */
  update(dt: number, playerPos: THREE.Vector3): void {
    this.lastPlayer.copy(playerPos);
    vegetationTime.uTime.value += dt;
    this.clock += dt;
    if (this.anims.length) this.animate(dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    this.regrow();
    const pcx = Math.floor(playerPos.x / 16);
    const pcz = Math.floor(playerPos.z / 16);
    let budget = 6;
    for (let n = -7; n <= 7 && budget > 0; n++)
      for (let r = -7; r <= 7 && budget > 0; r++) {
        if (r * r + n * n > 50) continue;
        const key = `${pcx + r},${pcz + n}`;
        if (!this.cols.has(key)) {
          this.decorateColumn(pcx + r, pcz + n);
          budget--;
        }
      }
    for (const [key, items] of this.cols) {
      const [cx, cz] = key.split(`,`).map(Number);
      if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > 81) {
        for (const it of items) this.drop(it);
        this.cols.delete(key);
      }
    }
  }
}
