// Port of play-inUT-NSi.js 50258-50590: treasure chests in the mine (tk), their tier roll WO, colours KO / nk,
// node names qO, the chest model loader JO (/models/chests.glb), and the open animation.
// Also the chest key helpers of the room client 43141-43169 (gw, _w, vw): only the chests use them in the solo
// port (the returned-chest list of the server is empty without multiplayer).
// GO (50259, chest names) is ported in src/ui/kr-hud.ts as CHEST_NAMES.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { WORLD_SEED, LIFT_POINT } from '../world/constants';
import { seededRandom, hash3 } from '../world/rng';
import { surfaceHeight } from '../world/generate';
import { cavernAtWorld, cavernMetric } from '../world/caverns';
import { chunkKey, type Chunk } from '../world/chunk';
import type { ChunkManager } from '../world/chunkManager';
import { stylizeMaterial } from '../miner/stylize';
import type { SonarBlip } from '../render/sonarRock';

const W = LIFT_POINT; // W (28758)

/** gw (43141): a chest key with its generation (generation 0 is the bare key). */
export const chestKeyGen = (e: string, t: number): string => (t ? `${e}.${t}` : e); // gw (43141)

/** A parsed chest key: base "cx,cy,cz,f|b", chunk coordinate, slot (f floor, b buried), generation. */
export interface ChestKey {
  base: string;
  c: [number, number, number];
  slot: string;
  g: number;
}

/** _w (43142): parses "cx,cy,cz,f" or "cx,cy,cz,b" with an optional ".generation". */
export function parseChestKey(e: string): ChestKey | null { // _w (43142)
  const t = /^(-?\d+),(-?\d+),(-?\d+),([fb])(?:\.(\d{1,6}))?$/.exec(e);
  return t
    ? {
        base: `${t[1]},${t[2]},${t[3]},${t[4]}`,
        c: [+t[1], +t[2], +t[3]],
        slot: t[4],
        g: t[5] ? +t[5] : 0,
      }
    : null;
}

/** Where a returned (respawned) chest of generation t, attempt n lies: a nearby chunk and a spot inside it. */
export interface ReturnedSpot {
  chunk: [number, number, number];
  x: number;
  y: number;
  z: number;
  yaw: number;
  r: number;
}

/** vw (43153): the seeded spot of a returned chest. */
export function returnedSpot(e: ChestKey, t: number, n: number): ReturnedSpot { // vw (43153)
  const r = seededRandom(
    hash3(e.c[0] * 59 + t, e.c[1] * 43 + n, e.c[2] * 37 + (e.slot === `f` ? 1 : 2), WORLD_SEED + 3150),
  );
  let i = 0,
    a = 0;
  for (; !i && !a; ) ((i = Math.floor(r() * 5) - 2), (a = Math.floor(r() * 5) - 2));
  const o: [number, number, number] = [e.c[0] + i, e.c[1] + Math.floor(r() * 3) - 1, e.c[2] + a];
  return {
    chunk: o,
    x: o[0] * 16 + 2 + r() * 12,
    y: o[1] * 16 + 2 + r() * 12,
    z: o[2] * 16 + 2 + r() * 12,
    yaw: r() * Math.PI * 2,
    r: r(),
  };
}

/** WO (50258): chest tier by depth and a roll: 2 gold, 1 iron, 0 wood. */
export const chestTier = (e: number, t: number): number => (e > 60 && t < 0.14 + e * 6e-4 ? 2 : +(e > 25 && t < 0.5)); // WO (50258)
/** KO (50260): chest light / accent colours by kind. */
export const CHEST_COLORS = [`#e0a86a`, `#9fc4e8`, `#ffc23d`]; // KO (50260)
/** qO (50261): chest node names in chests.glb by kind. */
export const CHEST_NODES = [`CH_Wood`, `CH_Iron`, `CH_Gold`]; // qO (50261)

/** JO (50262): loads /models/chests.glb (Draco); null when it is missing. */
export async function loadChests(): Promise<THREE.Group | null> { // JO (50262)
  try {
    const e = new DRACOLoader().setDecoderPath(`/draco/`),
      t = await new GLTFLoader().setDRACOLoader(e).loadAsync(`/models/chests.glb`);
    return (e.dispose(), t.scene);
  } catch (e) {
    return (console.warn(`chest models missing`, e), null);
  }
}

/** YO (50271): no chests within this distance of the hub. */
const HUB_CLEAR = 24; // YO (50271)
/** XO (50272): sight target height above the chest base. */
const SIGHT_Y = 0.34; // XO (50272)
/** ZO (50273): seconds after opening when the chest starts to vanish. */
const VANISH_AT = 1.9; // ZO (50273)
/** QO (50274): seconds after opening when the chest is removed. */
const REMOVE_AT = 2.35; // QO (50274)
/** $O (50275): the glow column material (cloned per chest). */
const GLOW_MAT = new THREE.MeshBasicMaterial({ // $O (50275)
  color: 16767370,
  transparent: !0,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: !1,
  side: THREE.DoubleSide,
});
/** ek (50283): the glow column geometry. */
const GLOW_GEO = new THREE.CylinderGeometry(0.28, 0.5, 2.4, 16, 1, !0).translate(0, 1.54, 0); // ek (50283)

/** One chest in the world. */
export interface Chest {
  key: string;
  pos: THREE.Vector3;
  yaw: number;
  /** 0 wood, 1 iron, 2 gold. */
  kind: number;
  depth: number;
  buried: boolean;
  opened: boolean;
  root: THREE.Group;
  lid: THREE.Object3D;
  loot: THREE.Object3D | null;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  openT: number;
  sight: boolean;
  /** Waiting for the server's claim answer (KR.openChest). */
  pending?: boolean;
}

/** A server chest state: generation g, attempt a, open. */
export interface ChestState {
  g: number;
  a: number;
  open: boolean;
}

/** The world parts the chests read (wb ChunkManager). */
export type ChestWorld = Pick<ChunkManager, 'sample' | 'groundBelow' | 'chunks'>;

/** tk (50284): places, shows and opens the treasure chests of the loaded chunks. */
export class Chests { // tk (50284)
  world: ChestWorld;
  isOpened: (key: string) => boolean;
  turnedUp: () => Iterable<[string, ChestState]>;
  group = new THREE.Group();
  onVanish: (pos: THREE.Vector3, kind: number) => void = () => {};
  byChunk = new Map<Chunk, Chest[]>();
  scanT = 0;
  sightT = 0;
  time = 0;
  lights: THREE.PointLight[] = [];
  models: (THREE.Object3D | null)[] = [null, null, null];
  constructor(
    e: ChestWorld,
    t: (key: string) => boolean,
    n: THREE.Object3D | null,
    r: () => Iterable<[string, ChestState]> = () => [],
  ) {
    ((this.world = e), (this.isOpened = t), (this.turnedUp = r));
    for (let e = 0; e < 2; e++) {
      const e = new THREE.PointLight(16765562, 0, 6, 1.6);
      (this.lights.push(e), this.group.add(e));
    }
    if (!n) return;
    const i = new Set<THREE.Material>();
    CHEST_NODES.forEach((e, t) => {
      const r = n.getObjectByName(e);
      r &&
        (r.position.set(0, 0, 0),
        r.traverse((e) => {
          const n = e as THREE.Mesh;
          if (!n.isMesh) return;
          ((n.castShadow = !0), (n.receiveShadow = !0));
          let r = n.material as THREE.MeshStandardMaterial;
          (r.name === `CH_Metal` &&
            t === 2 &&
            ((r = r.clone()), r.emissive.setHex(6963200), (r.emissiveIntensity = 0.4), (n.material = r)),
            !i.has(r) &&
              (i.add(r),
              r.name === `CH_Coins`
                ? (r.emissive.setHex(16753178), (r.emissiveIntensity = 0.55), stylizeMaterial(r, 0.04))
                : stylizeMaterial(r, r.name === `CH_Paint` ? 0.22 : 0.05)));
        }),
        (this.models[t] = r));
    });
  }
  /** The server's returned chests that are not open yet, with their seeded spots. */
  returned(): { key: string; t: ReturnedSpot }[] {
    const e: { key: string; t: ReturnedSpot }[] = [];
    for (const [t, n] of this.turnedUp()) {
      const r = !n.open && n.g > 0 ? parseChestKey(t) : null;
      r && e.push({ key: chestKeyGen(t, n.g), t: returnedSpot(r, n.g, n.a) });
    }
    return e;
  }
  /** Makes the chests of chunk e: returned ones, a floor chest and a buried chest (seeded by the chunk). */
  scan(e: Chunk, t = this.returned()): void {
    const n: Chest[] = [];
    this.byChunk.set(e, n);
    for (const { key: r, t: i } of t) {
      if (i.chunk[0] !== e.cx || i.chunk[1] !== e.cy || i.chunk[2] !== e.cz) continue;
      const t = surfaceHeight(i.x, i.z) - i.y,
        a = this.make(r, new THREE.Vector3(i.x, i.y, i.z), i.yaw, chestTier(t, i.r), t, !0);
      a && n.push(a);
    }
    if (!e.mesh) return;
    const r = e.cx * 16 + 8,
      i = e.cz * 16 + 8;
    if (Math.hypot(r - W.x, i - W.z) < HUB_CLEAR) return;
    const a = surfaceHeight(r, i),
      o = a - (e.cy * 16 + 8);
    if (o < 8) return;
    const s = seededRandom(hash3(e.cx, e.cy, e.cz, 4711)),
      c = cavernAtWorld(r, e.cy * 16 + 8, i),
      l = !!c && cavernMetric(c, r, e.cy * 16 + 8, i) < 1.2;
    if (s() < Math.min(0.011, 0.0045 + o * 5e-5) * (l ? 5 : 1)) {
      const t = e.mesh.geometry,
        r = t.getAttribute(`position`),
        i = t.getAttribute(`normal`),
        o = t.getAttribute(`carved`),
        c = e.mesh.position,
        l: number[] = [];
      for (let e = 0; e < r.count; e++) i.getY(e) > 0.9 && o.getX(e) < 0.5 && l.push(e);
      for (let tries = 0; tries < 6 && l.length; tries++) {
        const t = l[Math.floor(s() * l.length)],
          i = new THREE.Vector3(c.x + r.getX(t), c.y + r.getY(t), c.z + r.getZ(t));
        if (!this.standable(i)) continue;
        const o = a - i.y,
          u = this.make(`${e.cx},${e.cy},${e.cz},f`, i, s() * Math.PI * 2, chestTier(o, s()), o, !1);
        u && n.push(u);
        break;
      }
    }
    if (s() < Math.min(0.007, 0.0025 + o * 3e-5)) {
      const t = e.cx * 16 + 2 + s() * 12,
        r = e.cy * 16 + 2 + s() * 12,
        i = e.cz * 16 + 2 + s() * 12,
        a = s() * Math.PI * 2,
        o = s();
      if (this.world.sample(t, r + 0.4, i) > 158) {
        const s = surfaceHeight(t, i) - r,
          c = this.make(`${e.cx},${e.cy},${e.cz},b`, new THREE.Vector3(t, r, i), a, chestTier(s, o), s, !0);
        c && n.push(c);
      }
    }
  }
  /** A fresh copy of the chest model of a kind (the hub stash uses the gold one). */
  modelOf(e: number): THREE.Object3D | null {
    return this.models[e]?.clone(!0) ?? null;
  }
  /** Builds a chest (hidden until the update shows it); null when the model is missing or it was opened. */
  make(e: string, t: THREE.Vector3, n: number, r: number, i: number, a: boolean): Chest | null {
    const o = this.models[r];
    if (!o || this.isOpened(e)) return null;
    const s = new THREE.Group(),
      c = o.clone(!0);
    s.add(c);
    const l = c.getObjectByName(`${CHEST_NODES[r]}_Lid`) ?? new THREE.Object3D(),
      u = c.getObjectByName(`${CHEST_NODES[r]}_Loot`) ?? null,
      d = new THREE.Mesh(GLOW_GEO, GLOW_MAT.clone());
    return (
      (d.visible = !1),
      s.add(d),
      s.position.copy(t),
      (s.rotation.y = n),
      (s.visible = !1),
      this.group.add(s),
      {
        key: e,
        pos: t,
        yaw: n,
        kind: r,
        depth: i,
        buried: a,
        opened: !1,
        root: s,
        lid: l,
        loot: u,
        glow: d,
        openT: 0,
        sight: !1,
      }
    );
  }
  /** Head room above e and ground under 3 of 4 neighbours within 0.5 m. */
  standable(e: THREE.Vector3): boolean {
    const t = this.world;
    if (t.sample(e.x, e.y + 1, e.z) > 108 || t.sample(e.x, e.y + 1.8, e.z) > 108) return !1;
    let n = 0;
    for (const [r, i] of [
      [0.8, 0],
      [-0.8, 0],
      [0, 0.8],
      [0, -0.8],
    ]) {
      const a = t.groundBelow(e.x + r, e.z + i, e.y + 0.8, 1.6);
      a !== null && Math.abs(a - e.y) < 0.5 && n++;
    }
    return n >= 3;
  }
  unloadChunk(e: Chunk): void {
    const t = this.byChunk.get(e);
    if (t) {
      for (const e of t) e.root.removeFromParent();
      this.byChunk.delete(e);
    }
  }
  /** Drops every chest so the next scans make them again (the server's chest states changed). */
  rescan(): void {
    for (const e of [...this.byChunk.keys()]) this.unloadChunk(e);
  }
  /** A chest came back (server): rescans the chunk it lies in. */
  back(e: string, t: number, n: number): void {
    const r = parseChestKey(e);
    if (!r) return;
    const i = returnedSpot(r, t, n).chunk,
      a = this.world.chunks.get(chunkKey(i[0], i[1], i[2]));
    a && this.unloadChunk(a);
  }
  /** The closed, shown chest nearest to e within t (height counts 0.8). */
  nearest(e: THREE.Vector3, t = 2.6): Chest | null {
    let n: Chest | null = null,
      r = t;
    for (const t of this.byChunk.values())
      for (const i of t) {
        if (i.opened || i.pending || !i.root.visible) continue;
        const t = Math.hypot(i.pos.x - e.x, (i.pos.y + 0.4 - (e.y + 0.8)) * 0.8, i.pos.z - e.z);
        t < r && ((r = t), (n = i));
      }
    return n;
  }
  open(e: Chest): void {
    e.opened || ((e.opened = !0), (e.openT = 0), (e.glow.visible = !0));
  }
  find(e: string): Chest | null {
    for (const t of this.byChunk.values()) for (const n of t) if (n.key === e && !n.opened) return n;
    return null;
  }
  /** Sonar halos of the unburied closed chests within t of e, pushed onto n. */
  halos(e: THREE.Vector3, t: number, n: SonarBlip[]): void {
    for (const r of this.byChunk.values())
      for (const i of r) {
        if (i.opened || i.buried) continue;
        const r = i.pos.distanceTo(e);
        r > t ||
          n.push({
            p: i.pos,
            color: HALO_COLORS[i.kind],
            size: (1.6 + i.kind * 0.4) * (0.6 + 0.4 * (1 - r / t)) * (0.9 + Math.sin(this.time * 4 + i.pos.x) * 0.1),
          });
      }
  }
  /**
   * Per frame: scans chunks within 48 m and unloads beyond 64 m (every 0.5 s), shows chests in range (and in
   * sight when a sight range a is given), pushes the player (t, velocity n) out when r, runs the open
   * animations and moves the two lights onto the nearest chests.
   */
  update(e: number, t: THREE.Vector3, n: THREE.Vector3, r: boolean, i: Iterable<Chunk>, a = 0): void {
    if (((this.time += e), (this.scanT -= e), this.scanT <= 0)) {
      this.scanT = 0.5;
      const e = this.returned(),
        n = new Set(e.map(({ t: e }) => chunkKey(e.chunk[0], e.chunk[1], e.chunk[2])));
      for (const r of i) {
        if (!r.mesh && !n.has(chunkKey(r.cx, r.cy, r.cz))) continue;
        const i = r.cx * 16 + 8 - t.x,
          a = r.cy * 16 + 8 - t.y,
          o = r.cz * 16 + 8 - t.z,
          s = i * i + a * a + o * o;
        s < 2304 ? this.byChunk.has(r) || this.scan(r, e) : s > 4096 && this.unloadChunk(r);
      }
    }
    const o = a > 0 ? a * a : 676;
    this.sightT -= e;
    const s = a > 0 && this.sightT <= 0;
    s && (this.sightT = 0.2);
    const c: Chest[] = [];
    for (const i of this.byChunk.values())
      for (let l = i.length - 1; l >= 0; l--) {
        const u = i[l],
          d = u.pos.distanceToSquared(t);
        if (u.opened) {
          this.animateOpen(u, e) && i.splice(l, 1);
          continue;
        }
        if (
          (s && d < o && (u.sight = this.inSight(t, u)),
          (u.root.visible = d < o && (a <= 0 || u.sight)),
          u.root.visible && !u.buried && d < 196 && c.push(u),
          r && u.root.visible && Math.abs(t.y - u.pos.y) < 0.8)
        ) {
          const e = t.x - u.pos.x,
            r = t.z - u.pos.z,
            i = Math.hypot(e, r),
            a = 0.8;
          if (i < a && i > 1e-4) {
            ((t.x = u.pos.x + (e / i) * a), (t.z = u.pos.z + (r / i) * a));
            const o = (n.x * e + n.z * r) / i;
            o < 0 && ((n.x -= (e / i) * o), (n.z -= (r / i) * o));
          }
        }
      }
    (c.sort((e, n) => e.pos.distanceToSquared(t) - n.pos.distanceToSquared(t)),
      this.lights.forEach((t, n) => {
        const r = c[n];
        r
          ? (t.position.set(r.pos.x, r.pos.y + 0.9, r.pos.z),
            t.color.set(CHEST_COLORS[r.kind]),
            (t.intensity += (1.4 + r.kind * 0.6 + Math.sin(this.time * 3 + n) * 0.3 - t.intensity) * Math.min(1, e * 3)))
          : (t.intensity *= 0.9);
      }));
  }
  /** Voxel line of sight from the eye (e + 0.9) to the chest. */
  inSight(e: THREE.Vector3, t: Chest): boolean {
    const n = e.x,
      r = e.y + 0.9,
      i = e.z,
      a = t.pos.x - n,
      o = t.pos.y + SIGHT_Y - r,
      s = t.pos.z - i,
      c = Math.hypot(a, o, s);
    if (c < 1.8) return !0;
    for (let e = 0.6; e < c - 0.9; e += 0.45) {
      const t = e / c;
      if (this.world.sample(n + a * t, r + o * t, i + s * t) > 158) return !1;
    }
    return !0;
  }
  /** Lid, glow column, loot shrink, shake, poof and removal; true when the chest is gone. */
  animateOpen(e: Chest, t: number): boolean {
    e.openT += t;
    const n = e.openT;
    e.root.visible = !0;
    const r = Math.min(1, n * 3.4),
      i = 1 - (1 - r) ** 3;
    e.lid.rotation.x = -1.95 * i - Math.sin(r * Math.PI) * 0.3 * Math.max(0, 1 - n);
    const a = e.glow,
      o = Math.min(1, n / 1.1);
    if (
      ((a.material.opacity = Math.sin(o * Math.PI) * 0.6),
      a.scale.set(1 + o * 0.6, 0.4 + o * 1.2, 1 + o * 0.6),
      (a.visible = o < 1),
      e.loot)
    ) {
      const t = Math.max(0.01, 1 - Math.max(0, n - 0.15) * 1.6);
      (e.loot.scale.set(1, t, 1), (e.loot.visible = t > 0.02));
    }
    if (n > 1.5499999999999998) { // ZO - 0.35
      const t = (n - 1.5499999999999998) / 0.35;
      e.root.rotation.z = Math.sin(n * 60) * 0.04 * Math.min(1, t);
    }
    if (n >= VANISH_AT) {
      const t = Math.min(1, (n - VANISH_AT) / 0.4500000000000002); // QO - ZO
      e.root.userData.poofed || ((e.root.userData.poofed = !0), this.onVanish(e.pos, e.kind));
      const r = t * t;
      e.root.scale.set(1 + r * 0.35, Math.max(0.01, 1 - r), 1 + r * 0.35);
    }
    return n >= REMOVE_AT && (e.root.removeFromParent(), !0);
  }
}

/** nk (50590): sonar halo colours by chest kind. */
export const HALO_COLORS = [new THREE.Color(16757594), new THREE.Color(13625087), new THREE.Color(16765500)]; // nk (50590)
