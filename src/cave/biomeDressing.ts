// Port of play-inUT-NSi.js lines 41758-42373: the biome dressing placer (kC). It places biome props on the
// carved vertices inside a biome cavern, into the cave decor's instance pools: frost icicles, ice spikes and
// crystals; ember drips, rubble, charred stumps and lava-glow domes; bog vines, reeds, lily pads, giant
// mushrooms and shelf fungi; haunt graveyards (stone rows, fences, mounds, candles, lanterns, crypts, obelisks).
// The order of the random calls is the original's (the world is seeded).
import * as THREE from 'three';
import { BIOMES, hasLiquidSurface, type Cavern } from '../world/caverns';
import type { CaveDecor, DecorRecord } from './caveDecor';
import {
  biomeCharredMaterial,
  biomeGlowMaterial,
  biomeIceMaterial,
  biomePaintMaterial,
  type BiomeKit,
} from './biomeKit';

const HAUNT_TINT = new THREE.Color(0.64, 0.6, 0.76); // gC (41758)
const HAUNT_RIM = new THREE.Color(0.2, 0.16, 0.34); // _C (41759)
const tmpPos = new THREE.Vector3(); // vC (41760)
const tmpScale = new THREE.Vector3(); // yC (41761)
const tmpQuat = new THREE.Quaternion(); // bC (41762)
const tmpQuatB = new THREE.Quaternion(); // xC (41763)
const tmpEuler = new THREE.Euler(); // SC (41764)
const UP = new THREE.Vector3(0, 1, 0); // CC (41765)
const DOWN = new THREE.Vector3(0, -1, 0); // wC (41766)
/** Bog fungus colours. */
const BOG_COLORS = [10157898, 4915144, 15269722, 7004159]; // TC (41767)
/** Ember glow colours. */
const EMBER_COLORS = [16734746, 16747050, 16760896]; // EC (41768)
/** Frost crystal colours. */
const FROST_COLORS = [9431295, 13169919, 5949695]; // DC (41769)
/** Haunt ghost-light colours. */
const GHOST_COLORS = [11111167, 8060896, 12611839]; // OC (41770)

/** A biome prop: its body pool and its `~glow` pool (-1 = none; body -1 = the mesh is missing). */
export interface BiomeProp {
  body: number;
  glow: number;
}

type PropName =
  | 'crossBig'
  | 'obelisk'
  | 'urn'
  | 'crypt'
  | 'cryptSmall'
  | 'column'
  | 'rubble'
  | 'coffin'
  | 'mound'
  | 'fence'
  | 'fenceBroken'
  | 'stump'
  | 'stumpTall'
  | 'charred'
  | 'charredTall'
  | 'bogStump'
  | 'lantern'
  | 'candle'
  | 'candles'
  | 'candles5'
  | 'iceSpikes'
  | 'reeds1'
  | 'reeds2'
  | 'lily1'
  | 'lily2'
  | 'lily3'
  | 'vines1'
  | 'vines2';

type Rand = () => number;

export class BiomeDressing { // kC (41771)
  h: CaveDecor;
  stones: BiomeProp[] = [];
  props: Partial<Record<PropName, BiomeProp>> = {};
  plainRocks: number[] = [];
  plainDrips: number[] = [];
  icicles: BiomeProp[] = [];

  /** host: the cave decor. kit: biome.glb (null = no biome props). plainRock: the moss-less rock material. */
  constructor(host: CaveDecor, kit: BiomeKit | null, plainRock: THREE.Material) {
    this.h = host;
    const caveKit = host.kit;
    if (caveKit) {
      this.plainRocks = caveKit.rocks.map((p) => host.addPool(host.geometryOf(p), plainRock, 220));
      this.plainDrips = caveKit.drips.map((p) => host.addPool(host.geometryOf(p), plainRock, 260));
    }
    if (!kit) return;
    const haunt = biomePaintMaterial(`haunt`, 0.4, HAUNT_TINT, HAUNT_RIM);
    const wood = biomePaintMaterial(`wood`, 0.25, new THREE.Color(0.42, 0.36, 0.38), HAUNT_RIM, 0.5);
    const iron = biomePaintMaterial(`iron`, 0.2, new THREE.Color(0.32, 0.3, 0.36), HAUNT_RIM, 0.2);
    const bog = biomePaintMaterial(`bog`, 1, new THREE.Color(1, 1, 1), new THREE.Color(0.08, 0.16, 0.05), 0.4);
    const ice = biomeIceMaterial();
    const charred = biomeCharredMaterial();
    const flame = biomeGlowMaterial(`flame`, 3.2, 0.35);
    const soft = biomeGlowMaterial(`soft`, 2.2, 0.12);
    const prop = (name: string, material: THREE.Material, cap: number, glowMaterial: THREE.Material = flame): BiomeProp => {
      const body = kit[name];
      if (!body) {
        console.warn(`biome kit: ${name} missing`);
        return { body: -1, glow: -1 };
      }
      const glow = kit[name + `~glow`];
      return { body: host.addPool(body, material, cap), glow: glow ? host.addPool(glow, glowMaterial, cap) : -1 };
    };
    for (let i = 1; i <= 7; i++) this.stones.push(prop(`BM_Stone${i}`, haunt, 110));
    const p = this.props;
    p.crossBig = prop(`BM_CrossBig`, haunt, 40);
    p.obelisk = prop(`BM_Obelisk`, haunt, 16);
    p.urn = prop(`BM_Urn`, haunt, 60);
    p.crypt = prop(`BM_Crypt`, haunt, 10);
    p.cryptSmall = prop(`BM_CryptSmall`, haunt, 12);
    p.column = prop(`BM_Column`, haunt, 16);
    p.rubble = prop(`BM_Rubble`, haunt, 80);
    p.coffin = prop(`BM_Coffin`, wood, 40);
    p.mound = prop(`BM_Mound`, wood, 80);
    p.fence = prop(`BM_Fence`, iron, 90);
    p.fenceBroken = prop(`BM_FenceBroken`, iron, 60);
    p.stump = prop(`BM_Stump`, wood, 50);
    p.stumpTall = prop(`BM_StumpTall`, wood, 30);
    p.charred = prop(`BM_Stump`, charred, 40);
    p.charredTall = prop(`BM_StumpTall`, charred, 30);
    p.bogStump = prop(`BM_StumpTall`, bog, 30);
    p.lantern = prop(`BM_Lantern`, iron, 60);
    p.candle = prop(`BM_Candle`, bog, 200);
    p.candles = prop(`BM_Candles`, bog, 160);
    p.candles5 = prop(`BM_Candles5`, bog, 100);
    for (let i = 1; i <= 3; i++) this.icicles.push(prop(`BM_Icicles${i}`, ice, 320));
    p.iceSpikes = prop(`BM_IceSpikes`, ice, 160);
    p.reeds1 = prop(`BM_Reeds1`, bog, 260);
    p.reeds2 = prop(`BM_Reeds2`, bog, 260);
    p.lily1 = prop(`BM_Lily1`, bog, 160, soft);
    p.lily2 = prop(`BM_Lily2`, bog, 120, soft);
    p.lily3 = prop(`BM_Lily3`, bog, 160, soft);
    p.vines1 = prop(`BM_Vines1`, bog, 200, soft);
    p.vines2 = prop(`BM_Vines2`, bog, 200, soft);
  }

  /** Places a prop body (and its glow, lit, in glowColor or color). False when it has no body or the pool is full. */
  place(
    list: DecorRecord[],
    prop: BiomeProp,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    scale: THREE.Vector3,
    color: THREE.Color,
    glowColor: THREE.Color | null,
    solid = 0,
  ): boolean {
    if (prop.body < 0 || !this.h.put(list, prop.body, pos, quat, scale, color, false, solid)) return false;
    if (prop.glow >= 0) this.h.put(list, prop.glow, pos, quat, scale, glowColor ?? color, true);
    return true;
  }

  /** The biome rule of one carved vertex. roll = vertex hash / density. */
  vertex(list: DecorRecord[], region: Cavern, pos: THREE.Vector3, normal: THREE.Vector3, roll: number, rand: Rand): void {
    const ny = normal.y;
    const kit = this.h.kit;
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
    const liquid = BIOMES[region.biome].liquid;
    if (liquid && pos.y < region.liquidY + 0.08) return;
    const props = this.props;
    switch (region.biome) {
      case `frost`:
        if (ny < -0.55) {
          if (roll < 0.08 && this.icicles.length) {
            const s = rand() < 0.12 ? 1.8 + rand() * 1.4 : 0.6 + rand() * 0.8;
            tmpScale.set(s, s * (0.8 + rand() * 0.5), s);
            tmpQuat
              .setFromUnitVectors(DOWN, tmpPos.copy(DOWN).lerp(normal, 0.15).normalize())
              .multiply(tmpQuatB.setFromAxisAngle(UP, rand() * Math.PI * 2));
            this.place(
              list,
              pick(this.icicles),
              tmpPos.copy(pos).addScaledVector(normal, -0.12),
              tmpQuat,
              tmpScale,
              new THREE.Color(1, 1, 1).multiplyScalar(0.9 + rand() * 0.2),
              null,
            );
          } else if (roll < 0.1 && kit) this.crystal(list, pos, normal, FROST_COLORS, rand, false);
        } else if (ny > 0.75) {
          if (roll < 0.012 && props.iceSpikes && this.h.room(pos.x, pos.y, pos.z, 2.6)) {
            const s = 0.6 + rand() * 0.9;
            tmpScale.set(s, s * (0.8 + rand() * 0.6), s);
            this.place(
              list,
              props.iceSpikes,
              tmpPos.copy(pos).setY(pos.y - 0.1),
              this.h.stand(normal, 0.25, rand() * 6.28),
              tmpScale,
              new THREE.Color(1, 1, 1),
              null,
              0.4 * s,
            );
          } else if (roll < 0.024 && kit) this.crystal(list, pos, normal, FROST_COLORS, rand, true);
          else if (roll < 0.045 && this.plainRocks.length) {
            const s = 0.45 + rand() * 0.9;
            tmpScale.set(s * 1.3, s * 0.55, s * 1.1);
            tmpEuler.set(0, rand() * Math.PI * 2, 0);
            this.h.put(
              list,
              pick(this.plainRocks),
              tmpPos.copy(pos).setY(pos.y - s * 0.18),
              tmpQuat.setFromEuler(tmpEuler),
              tmpScale,
              new THREE.Color(0.95, 0.98, 1.05).multiplyScalar(1.6),
              false,
            );
          }
        } else if (Math.abs(ny) < 0.45 && roll < 0.03 && kit) this.crystal(list, pos, normal, FROST_COLORS, rand, false);
        return;
      case `ember`: {
        const rockTint = () => new THREE.Color(0.1, 0.075, 0.075).multiplyScalar(0.8 + rand() * 0.4);
        if (ny < -0.55) {
          if (roll < 0.03 && this.plainDrips.length) {
            const s = 0.7 + rand() * 1.1;
            tmpScale.set(s, s * (0.9 + rand() * 0.6), s);
            tmpQuat
              .setFromUnitVectors(UP, tmpPos.copy(DOWN).lerp(normal, 0.2).normalize())
              .multiply(tmpQuatB.setFromAxisAngle(UP, rand() * 6.28));
            this.h.put(
              list,
              pick(this.plainDrips),
              tmpPos.copy(pos).addScaledVector(normal, -0.14),
              tmpQuat,
              tmpScale,
              rockTint(),
              false,
            );
          } else if (roll < 0.045 && kit) this.crystal(list, pos, normal, EMBER_COLORS, rand, false);
        } else if (ny > 0.75) {
          if (roll < 0.01 && kit) this.crystal(list, pos, normal, EMBER_COLORS, rand, true);
          else if (roll < 0.028 && this.plainRocks.length) {
            const count = 1 + Math.floor(rand() * 3);
            for (let k = 0; k < count; k++) {
              const a = rand() * Math.PI * 2;
              const d = k ? 0.4 + rand() * 0.6 : 0;
              const s = (k ? 0.2 : 0.35) + rand() * (k ? 0.25 : 0.5);
              tmpEuler.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5);
              tmpScale.set(s, s * (0.7 + rand() * 0.5), s);
              this.h.put(
                list,
                pick(this.plainRocks),
                tmpPos.set(pos.x + Math.cos(a) * d, pos.y - s * 0.22, pos.z + Math.sin(a) * d),
                tmpQuat.setFromEuler(tmpEuler),
                tmpScale,
                rockTint(),
                false,
                k ? 0 : s * 0.5,
              );
            }
          } else if (roll < 0.038 && this.plainDrips.length) {
            const s = 0.9 + rand() * 1.3;
            const which = Math.floor(rand() * 3);
            if (this.h.room(pos.x, pos.y, pos.z, 2.4 * s + 0.3)) {
              tmpScale.set(s, s * (1 + rand() * 0.6), s);
              this.h.put(
                list,
                this.plainDrips[which],
                tmpPos.copy(pos).setY(pos.y - 0.15),
                this.h.stand(normal, 0.2, rand() * 6.28),
                tmpScale,
                rockTint(),
                false,
                0.3 * s,
              );
            }
          } else if (roll < 0.043 && props.charred) {
            const tall = rand() < 0.4;
            const s = 0.8 + rand() * 0.5;
            if (!tall || this.h.room(pos.x, pos.y, pos.z, 2.8 * s)) {
              tmpScale.setScalar(s);
              this.place(
                list,
                tall ? props.charredTall! : props.charred,
                tmpPos.copy(pos).setY(pos.y - 0.08),
                this.h.stand(normal, 0.15, rand() * 6.28),
                tmpScale,
                new THREE.Color(1, 1, 1),
                null,
                0.35 * s,
              );
            }
          } else if (roll < 0.05 && kit) {
            const tint = new THREE.Color(pick(EMBER_COLORS)).multiplyScalar(0.9 + rand() * 0.3);
            const count = 1 + Math.floor(rand() * 3);
            for (let k = 0; k < count; k++) {
              const a = rand() * Math.PI * 2;
              const d = k ? 0.3 + rand() * 0.4 : 0;
              const s = (k ? 0.3 : 0.5) + rand() * 0.3;
              tmpScale.set(s, s * 0.8, s);
              this.h.put(
                list,
                kit.dome,
                tmpPos.set(pos.x + Math.cos(a) * d, pos.y - 0.04, pos.z + Math.sin(a) * d),
                this.h.stand(normal, 0.2, rand() * 6.28),
                tmpScale,
                tint,
                true,
              );
            }
          }
        } else if (Math.abs(ny) < 0.45 && roll < 0.009 && kit) this.crystal(list, pos, normal, EMBER_COLORS, rand, false);
        return;
      }
      case `bog`: {
        const rockTint = () => new THREE.Color(0.16, 0.26, 0.1).multiplyScalar(0.8 + rand() * 0.4);
        if (ny < -0.55) {
          if (roll < 0.07 && props.vines1) {
            const s = 0.8 + rand() * 0.8;
            tmpScale.set(s, s * (0.8 + rand() * 0.7), s);
            tmpEuler.set(0, rand() * Math.PI * 2, 0);
            this.place(
              list,
              rand() < 0.5 ? props.vines1 : props.vines2!,
              tmpPos.copy(pos).addScaledVector(normal, -0.08),
              tmpQuat.setFromEuler(tmpEuler),
              tmpScale,
              new THREE.Color(1, 1, 1),
              new THREE.Color(pick(BOG_COLORS)),
            );
          }
        } else if (ny > 0.75) {
          if (liquid && pos.y < region.liquidY + 0.7 && roll < 0.09 && props.reeds1) {
            const s = 0.8 + rand() * 0.6;
            tmpScale.set(s, s * (0.85 + rand() * 0.4), s);
            tmpEuler.set(0, rand() * Math.PI * 2, 0);
            this.place(
              list,
              rand() < 0.6 ? props.reeds1 : props.reeds2!,
              tmpPos.copy(pos).setY(pos.y - 0.05),
              tmpQuat.setFromEuler(tmpEuler),
              tmpScale,
              new THREE.Color(1, 1, 1).multiplyScalar(0.8 + rand() * 0.3),
              null,
            );
          } else if (roll < 0.009 && kit) this.giantShroom(list, pos, normal, rand);
          else if (roll < 0.05 && kit) this.shrooms(list, pos, normal, rand);
          else if (roll < 0.062 && this.plainRocks.length) {
            const s = 0.35 + rand() * 0.6;
            tmpEuler.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
            tmpScale.set(s, s * (0.6 + rand() * 0.5), s);
            this.h.put(
              list,
              pick(this.plainRocks),
              tmpPos.copy(pos).setY(pos.y - s * 0.2),
              tmpQuat.setFromEuler(tmpEuler),
              tmpScale,
              rockTint(),
              false,
              s * 0.45,
            );
          } else if (roll < 0.066 && props.bogStump && this.h.room(pos.x, pos.y, pos.z, 3)) {
            const s = 0.7 + rand() * 0.4;
            tmpScale.setScalar(s);
            this.place(
              list,
              props.bogStump,
              tmpPos.copy(pos).setY(pos.y - 0.1),
              this.h.stand(normal, 0.15, rand() * 6.28),
              tmpScale,
              new THREE.Color(0.45, 0.55, 0.3),
              null,
              0.35 * s,
            );
          }
        } else if (Math.abs(ny) < 0.45 && roll < 0.03 && kit) {
          const out = new THREE.Vector3(normal.x, 0, normal.z).normalize();
          const side = new THREE.Vector3().crossVectors(UP, out).normalize();
          const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, UP, out));
          const shelf = rand() < 0.4;
          const s = shelf ? 0.8 + rand() * 0.6 : 0.8 + rand() * 0.7;
          tmpScale.setScalar(s);
          this.h.put(
            list,
            shelf ? kit.shelf : kit.conk,
            tmpPos.copy(pos).addScaledVector(out, -0.06),
            q,
            tmpScale,
            new THREE.Color(pick(BOG_COLORS)).multiplyScalar(0.85 + rand() * 0.3),
            true,
          );
        }
        return;
      }
      case `haunt`:
        if (ny < -0.55) {
          if (roll < 0.025 && this.plainDrips.length) {
            const s = 0.6 + rand() * 0.9;
            tmpScale.set(s, s * (0.9 + rand() * 0.6), s);
            tmpQuat
              .setFromUnitVectors(UP, tmpPos.copy(DOWN).lerp(normal, 0.2).normalize())
              .multiply(tmpQuatB.setFromAxisAngle(UP, rand() * 6.28));
            this.h.put(
              list,
              pick(this.plainDrips),
              tmpPos.copy(pos).addScaledVector(normal, -0.14),
              tmpQuat,
              tmpScale,
              new THREE.Color(0.2, 0.18, 0.24),
              false,
            );
          }
        } else if (ny > 0.8) {
          if (roll < 0.028 && this.stones.length) this.graves(list, pos, normal, rand);
          else if (roll < 0.04 && props.candle) this.candles(list, pos, normal, rand);
          else if (roll < 0.043 && props.lantern) {
            tmpScale.setScalar(0.9 + rand() * 0.4);
            this.place(
              list,
              props.lantern,
              tmpPos.copy(pos).setY(pos.y - 0.03),
              this.h.stand(normal, 0.1, rand() * 6.28),
              tmpScale,
              new THREE.Color(1, 1, 1),
              this.ghostLight(rand, 0.35),
            );
          } else if (roll < 0.047) {
            const t = rand();
            const what = t < 0.35 ? props.mound : t < 0.55 ? props.coffin : t < 0.78 ? props.urn : props.rubble;
            if (!what) return;
            tmpScale.setScalar(0.85 + rand() * 0.35);
            this.place(
              list,
              what,
              tmpPos.copy(pos).setY(pos.y - 0.04),
              this.h.stand(normal, 0.3, rand() * 6.28),
              tmpScale,
              new THREE.Color(1, 1, 1).multiplyScalar(0.85 + rand() * 0.25),
              null,
              what === props.urn ? 0.25 : 0,
            );
          } else if (roll < 0.0485 && props.obelisk) {
            const t = rand();
            const what = t < 0.4 ? props.obelisk : t < 0.62 ? props.crypt! : t < 0.84 ? props.cryptSmall! : props.column!;
            const height = what === props.column ? 3.6 : what === props.obelisk ? 3.1 : 3.2;
            if (!this.h.room(pos.x, pos.y, pos.z, height)) return;
            tmpScale.setScalar(0.9 + rand() * 0.25);
            const solid = what === props.crypt ? 1.6 : what === props.cryptSmall ? 1.3 : 0.55;
            this.place(
              list,
              what,
              tmpPos.copy(pos).setY(pos.y - 0.12),
              this.h.stand(normal, 0.05, rand() * 6.28),
              tmpScale,
              new THREE.Color(1, 1, 1),
              null,
              solid,
            );
            if (what !== props.column && props.candle)
              for (let k = 0; k < 3; k++)
                this.candles(list, tmpPos.set(pos.x + (rand() - 0.5) * 3, pos.y, pos.z + (rand() - 0.5) * 3), normal, rand, true);
          } else if (roll < 0.052 && props.stump) {
            const tall = rand() < 0.45;
            if (!tall || this.h.room(pos.x, pos.y, pos.z, 2.8)) {
              tmpScale.setScalar(0.8 + rand() * 0.4);
              this.place(
                list,
                tall ? props.stumpTall! : props.stump,
                tmpPos.copy(pos).setY(pos.y - 0.08),
                this.h.stand(normal, 0.12, rand() * 6.28),
                tmpScale,
                new THREE.Color(0.55, 0.5, 0.6),
                null,
                0.3,
              );
            }
          } else if (roll < 0.058 && kit) {
            const tint = new THREE.Color(pick(GHOST_COLORS)).multiplyScalar(0.8 + rand() * 0.3);
            const s = 0.5 + rand() * 0.5;
            tmpScale.set(s, s * (0.9 + rand() * 0.3), s);
            this.h.put(
              list,
              kit.witch,
              tmpPos.copy(pos).setY(pos.y - 0.04),
              this.h.stand(normal, 0.2, rand() * 6.28),
              tmpScale,
              tint,
              true,
            );
          }
        } else if (Math.abs(ny) < 0.45 && roll < 0.006 && kit) this.crystal(list, pos, normal, GHOST_COLORS, rand, false);
        return;
    }
  }

  /** Lily pads on the bog water of a chunk: floor(10 * density) tries. */
  pools(list: DecorRecord[], region: Cavern, x0: number, z0: number, size: number, rand: Rand, density: number): void {
    if (region.biome !== `bog` || !this.props.lily1) return;
    const tries = Math.floor(10 * density);
    for (let i = 0; i < tries; i++) {
      const x = x0 + rand() * size;
      const z = z0 + rand() * size;
      if (!hasLiquidSurface(region, x, z)) continue;
      const t = rand();
      const lily = t < 0.45 ? this.props.lily1 : t < 0.7 ? this.props.lily2! : this.props.lily3!;
      tmpScale.setScalar(0.8 + rand() * 0.5);
      tmpEuler.set(0, rand() * Math.PI * 2, 0);
      this.place(
        list,
        lily,
        tmpPos.set(x, region.liquidY + 0.005, z),
        tmpQuat.setFromEuler(tmpEuler),
        tmpScale,
        new THREE.Color(1, 1, 1).multiplyScalar(0.8 + rand() * 0.3),
        new THREE.Color(1, 1, 1),
      );
    }
  }

  /** A kit crystal in a colour of `colors` (floor: the squat ones). */
  crystal(list: DecorRecord[], pos: THREE.Vector3, normal: THREE.Vector3, colors: number[], rand: Rand, floor: boolean): void {
    const kit = this.h.kit!;
    const tint = new THREE.Color(colors[Math.floor(rand() * colors.length)]);
    const pool = kit.crystals[floor ? 4 + Math.floor(rand() * 2) : Math.floor(rand() * 4)];
    const s = floor ? 0.4 + rand() * 0.6 : 0.5 + rand() * 0.7;
    tmpScale.set(s, s * (0.85 + rand() * 0.4), s);
    this.h.put(
      list,
      pool,
      tmpPos.copy(pos).addScaledVector(normal, -0.1 * s),
      this.h.stand(normal, floor ? 0.3 : 0.9, rand() * Math.PI * 2),
      tmpScale,
      tint,
      true,
    );
  }

  /** A giant bog mushroom (dome, witch or trio) with three small ones around it. */
  giantShroom(list: DecorRecord[], pos: THREE.Vector3, normal: THREE.Vector3, rand: Rand): void {
    const kit = this.h.kit!;
    const t = rand();
    const pool = t < 0.45 ? kit.dome : t < 0.75 ? kit.witch : kit.trio;
    const s = pool === kit.trio ? 2.6 + rand() * 1.6 : 3.2 + rand() * 2.8;
    const height = (pool === kit.trio ? 3.3 : pool === kit.witch ? 1.9 : 1.5) * s;
    if (!this.h.room(pos.x, pos.y, pos.z, height)) return;
    const tint = new THREE.Color(BOG_COLORS[Math.floor(rand() * BOG_COLORS.length)]).multiplyScalar(0.85 + rand() * 0.25);
    tmpScale.set(s, s * (0.9 + rand() * 0.3), s);
    tmpQuat
      .setFromUnitVectors(UP, tmpPos.copy(UP).lerp(normal, 0.1).normalize())
      .multiply(tmpQuatB.setFromEuler(tmpEuler.set((rand() - 0.5) * 0.18, rand() * 6.28, (rand() - 0.5) * 0.18)));
    this.h.put(list, pool, tmpPos.copy(pos).setY(pos.y - 0.1), tmpQuat, tmpScale, tint, true, 0.16 * s);
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const d = 0.9 + rand() * 1.2;
      const x = pos.x + Math.cos(a) * d;
      const z = pos.z + Math.sin(a) * d;
      const g = this.h.ground(x, pos.y, z);
      if (g === null) continue;
      const k = 0.4 + rand() * 0.4;
      tmpScale.set(k, k, k);
      this.h.put(
        list,
        rand() < 0.5 ? kit.dome : kit.inky,
        tmpPos.set(x, g - 0.04, z),
        this.h.stand(UP, 0, rand() * 6.28),
        tmpScale,
        tint,
        true,
      );
    }
  }

  /** A small group (1-4) of one glowing mushroom kind. */
  shrooms(list: DecorRecord[], pos: THREE.Vector3, normal: THREE.Vector3, rand: Rand): void {
    const kit = this.h.kit!;
    const tint = new THREE.Color(BOG_COLORS[Math.floor(rand() * BOG_COLORS.length)]).multiplyScalar(0.85 + rand() * 0.3);
    const t = rand();
    const pool = t < 0.35 ? kit.dome : t < 0.55 ? kit.deceivers : t < 0.8 ? kit.inky : kit.witch;
    const count = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = i ? 0.35 + rand() * 0.5 : 0;
      const s = (i ? 0.4 : 0.7) + rand() * 0.5;
      tmpScale.set(s, s * (0.85 + rand() * 0.35), s);
      this.h.put(
        list,
        pool,
        tmpPos.set(pos.x + Math.cos(a) * d, pos.y - 0.04, pos.z + Math.sin(a) * d),
        this.h.stand(normal, 0.25, rand() * 6.28),
        tmpScale,
        tint,
        true,
      );
    }
  }

  /** A grave row (70%: 2-5 stones, spaced 1.7), with mounds, candles and sometimes a fence behind it. */
  graves(list: DecorRecord[], pos: THREE.Vector3, _normal: THREE.Vector3, rand: Rand): void {
    const count = rand() < 0.7 ? 2 + Math.floor(rand() * 4) : 1;
    const a = rand() * Math.PI * 2;
    const sx = Math.cos(a) * 1.7;
    const sz = -Math.sin(a) * 1.7;
    for (let n = 0; n < count; n++) {
      const x = pos.x + sx * n + (rand() - 0.5) * 0.35;
      const z = pos.z + sz * n + (rand() - 0.5) * 0.35;
      const y = n === 0 ? pos.y : this.h.ground(x, pos.y, z);
      if (y === null || Math.abs(y - pos.y) > 1.2) break;
      const stone =
        rand() < 0.1 && this.props.crossBig ? this.props.crossBig : this.stones[Math.floor(rand() * this.stones.length)];
      const s = 0.85 + rand() * 0.3;
      tmpScale.setScalar(s);
      tmpQuat.setFromEuler(tmpEuler.set((rand() - 0.5) * 0.3, a + (rand() - 0.5) * 0.25 + Math.PI / 2, (rand() - 0.5) * 0.3));
      this.place(
        list,
        stone,
        tmpPos.set(x, y - 0.1, z),
        tmpQuat,
        tmpScale,
        new THREE.Color(1, 1, 1).multiplyScalar(0.75 + rand() * 0.35),
        null,
        0.3,
      );
      if (rand() < 0.3 && this.props.mound) {
        const mx = x + Math.sin(a + Math.PI / 2) * 0.9;
        const mz = z + Math.cos(a + Math.PI / 2) * 0.9;
        const my = this.h.ground(mx, y, mz);
        if (my !== null)
          this.place(
            list,
            this.props.mound,
            tmpPos.set(mx, my - 0.03, mz),
            tmpQuat.setFromEuler(tmpEuler.set(0, a, 0)),
            tmpScale.setScalar(0.9),
            new THREE.Color(0.9, 0.9, 0.9),
            null,
          );
      }
      if (rand() < 0.3) this.candles(list, tmpPos.set(x + (rand() - 0.5) * 0.8, y, z + (rand() - 0.5) * 0.8), UP, rand, true);
    }
    if (count >= 3 && rand() < 0.35 && this.props.fence) {
      const off = 1.3;
      for (let c = 0; c < count; c++) {
        const x = pos.x + sx * c + Math.sin(a) * off;
        const z = pos.z + sz * c + Math.cos(a) * off;
        const g = this.h.ground(x, pos.y, z);
        if (g === null) continue;
        tmpQuat.setFromEuler(tmpEuler.set(0, a, (rand() - 0.5) * 0.15));
        this.place(
          list,
          rand() < 0.3 ? this.props.fenceBroken! : this.props.fence,
          tmpPos.set(x, g - 0.05, z),
          tmpQuat,
          tmpScale.setScalar(1),
          new THREE.Color(1, 1, 1),
          null,
        );
      }
    }
  }

  /** Flame colour: a ghost colour (x1.4) with the given chance, else warm white. */
  ghostLight(rand: Rand, chance: number): THREE.Color {
    return rand() < chance
      ? new THREE.Color(GHOST_COLORS[Math.floor(rand() * GHOST_COLORS.length)]).multiplyScalar(1.4)
      : new THREE.Color(1, 0.92, 0.8);
  }

  /** One candle, three or five; onGround: drop it onto the ground near pos. */
  candles(list: DecorRecord[], pos: THREE.Vector3, normal: THREE.Vector3, rand: Rand, onGround = false): void {
    const t = rand();
    const what = t < 0.4 ? this.props.candle : t < 0.75 ? this.props.candles : this.props.candles5;
    let y: number | null = pos.y;
    if (onGround) y = this.h.ground(pos.x, pos.y + 0.5, pos.z);
    if (y === null || !what) return;
    tmpScale.setScalar(1.3 + rand() * 0.9);
    this.place(
      list,
      what,
      tmpPos.set(pos.x, y - 0.02, pos.z),
      this.h.stand(normal, 0.2, rand() * 6.28),
      tmpScale,
      new THREE.Color(1, 1, 1),
      this.ghostLight(rand, 0.3),
    );
  }
}
