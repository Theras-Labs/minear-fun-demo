// KR's item glue as a class over a small host (the game): the bombs and smoke bombs and their wiring
// (constructor 70407-70427), liquids footing (lava, toxic water, ice and snow), the consumables (tonic, strength
// flask, fortune cookie, ult juice), the smoke and bomb throws, the recall stone (useStone, stoneBroken,
// updateStone with the speed multiplier, recallShow), the bomb blast (terrain, ore, gems, decor, foes, worm and
// bosses, the miner) and its show, and floorAt. Bird song and the boulder are in src/pickups/collect.ts.
// Bundle play-inUT-NSi.js lines 70407-70427 (wiring), 71207-71208 (clear), 71675 (updateFooting call),
// 71944-71946 (update calls), 74191-74778 (the methods). KR.slamCrater (74609-74652) belongs to [ult].
import * as THREE from 'three';
import { Mat, MATERIALS } from '../world/materials';
import { BIOMES, cavernAtWorld, hasLiquidSurface, liquidAt, type LiquidKind } from '../world/caverns';
import type { ChunkManager } from '../world/chunkManager';
import { BURROW_CENTER_Y, type PlayerController } from '../player/controller';
import type { Combat, MinerId } from '../combat/combat';
import type { Gem } from '../gems/gemField';
import type { GlowSpot } from '../cave/caveDecor';
import type { RemovedProp } from '../decor/decor';
import { BUFF_MS, STRENGTH_MUL, JUICE_MS, JUICE_MUL } from '../state/playerState';
import { onHub } from '../ui/kr-hud';
import { spend, releaseGem, type PickupAudio, type PickupHost, type PickupUi } from '../pickups/collect';
import { Bombs, BLAST_R, blastDamage, wormBlastDamage } from './bombs';
import { SmokeBombs } from './smoke';

/** The audio methods used here (dM, src/audio/audio.ts Audio). */
export interface ItemsAudio extends PickupAudio {
  splash(big: boolean): void;
  sizzle(): void;
  gulp(): void;
  munch(): void;
  bombThrow(): void;
  bombTick(blink: number, dist: number): void;
  bombBoom(dist: number): void;
  smokePop(k?: number): void;
  recallStep(i: number): void;
  recallGo(k?: number): void;
}

/** The HUD methods used here (EM, src/ui/hud.ts Hud). */
export interface ItemsUi extends PickupUi {
  floater(pos: THREE.Vector3, text: string, color?: string, cls?: string): void;
  ultPop(): void;
  fortuneBump(): void;
}

/** The game (KR) as this glue reads and writes it. It is also the pickup host (spend, releaseGem). */
export interface ItemsHost extends PickupHost {
  scene: THREE.Object3D;
  world: PickupHost[`world`] & Pick<ChunkManager, `sample` | `dig` | `materialAt` | `groundBelow`>;
  player: PickupHost[`player`] & Pick<PlayerController, `onGround` | `grip` | `groundTimer` | `speedMul` | `thrust` | `dodging`>;
  cam: PickupHost[`cam`] & { camera: THREE.Camera };
  audio: ItemsAudio;
  ui: ItemsUi;
  combat: PickupHost[`combat`] &
    Pick<Combat, `hp` | `maxHp` | `aiming` | `slowFactor` | `heal` | `scald` | `hurt` | `foes` | `worm`>;
  gems: PickupHost[`gems`] & { release(pos: THREE.Vector3, r: number): Gem[] };
  /** eD MinerRig. */
  model: { attack(clip: string, opts?: { rate?: number; legs?: number }): unknown };
  /** UO Hub. */
  hub: { liftTop: THREE.Vector3 };
  /** rb GrassField. */
  grass: { markDirty(x?: number, z?: number): void };
  /** cw cave decor. */
  caveDecor: { removeNear(pos: THREE.Vector3, r: number): GlowSpot[] };
  /** Sx decor. */
  decor: { removeNear(pos: THREE.Vector3, r: number, dmg?: number): RemovedProp[] };
  /** ET monster host (solo: mp.local), for mp.puff's solo branch local.smoke(pos, mp.id) (48996-49001). */
  foeHost: { smoke(pos: { x: number; y: number; z: number }, owner: string): void };
  drilling: boolean;
  exitBurrow(toSurface: boolean): void;
}

/** The belt actions PickupHost.belt expects (KR.useBelt 74023 dispatches to them). */
export interface BeltActions {
  throwBomb(slot: number): void;
  drinkTonic(slot: number): void;
  drinkStrength(slot: number): void;
  eatCookie(slot: number): void;
  drinkJuice(slot: number): void;
  throwSmoke(slot: number): void;
  useStone(slot: number): void;
}

// KR module scratch ($, MR, 70040-70041)
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR

/** KR.floorAt (74653): the ground below (x, y, z) within r, or a lava / toxic surface above it. */
export function floorAt( // KR.floorAt (74653)
  w: Pick<ChunkManager, `groundBelow`>,
  e: number,
  t: number,
  n: number,
  r = 18,
): number | null {
  const i = w.groundBelow(e, t, n, r),
    a = cavernAtWorld(e, n, t);
  return a && BIOMES[a.biome].liquid && hasLiquidSurface(a, e, t) && (i === null || i < a.liquidY) ? a.liquidY : i;
}

export class Items { // KR item glue (70407-70427, 74191-74778)
  readonly h: ItemsHost;
  /** mp.id: the local miner (owner of my smoke clouds in the monster host). */
  readonly me: string;
  readonly bombs: Bombs; // KR.bombs (70407)
  readonly smokes: SmokeBombs; // KR.smokes (70422)
  /** Walk speed factor from liquids and snow (updateFooting), read by updateStone. */
  wadeMul = 1;
  wadeFx = 0;
  wasIn: LiquidKind | null = null;
  /** Recall stone charge 0..1, -1 when the stone is quiet. */
  stoneT = -1;
  stoneStep = 0;
  stoneHp = 0;
  /** The belt actions for PickupHost.belt. */
  readonly belt: BeltActions = {
    throwBomb: (e) => this.throwBomb(e),
    drinkTonic: (e) => this.drinkTonic(e),
    drinkStrength: (e) => this.drinkStrength(e),
    eatCookie: (e) => this.eatCookie(e),
    drinkJuice: (e) => this.drinkJuice(e),
    throwSmoke: (e) => this.throwSmoke(e),
    useStone: (e) => this.useStone(e),
  };

  /** KR 70407-70427: make the bombs and smoke bombs, wire their hooks, add them to the scene. */
  constructor(h: ItemsHost, me: string) {
    this.h = h;
    this.me = me;
    this.bombs = new Bombs(h.world, h.sparks);
    // 70408: mp.fx([`blast`, id, pos]) only sends when served (solo: nothing)
    this.bombs.onBlast = (e) => {
      this.blast(e);
    };
    this.bombs.onTick = (e, t) => h.audio.bombTick(t, e.distanceTo(h.player.pos));
    h.scene.add(this.bombs.group);
    this.smokes = new SmokeBombs(h.world, h.dust);
    h.scene.add(this.smokes.group);
    this.smokes.onPop = (e, t) => {
      // mp.puff(e, t): solo branch local.smoke(t, mp.id) (49000)
      (h.foeHost.smoke(t, this.me),
        h.audio.smokePop(THREE.MathUtils.clamp(1.2 - t.distanceTo(h.player.pos) / 40, 0.15, 1)));
    };
  }

  /** KR.endSandbox 71207-71208: no bombs or smoke left over. */
  clear(): void {
    (this.bombs.clear(), this.smokes.clear());
  }

  /** KR 71944-71946, after the pickups update: t = the hitstop-scaled step, dt = the frame step. */
  update(t: number, dt: number): void {
    (this.bombs.update(t), this.smokes.update(t), this.updateStone(dt));
  }

  /** KR.updateFooting (74194): lava and toxic pools (scald, wade, float on lava, splashes), ice and snow. */
  updateFooting(e: number): void {
    const h = this.h,
      t = h.player;
    if (((this.wadeMul = 1), (t.grip = 1), !h.started || h.burrow || t.lifting || h.combat.ko)) {
      this.wasIn = null;
      return;
    }
    const n = liquidAt(t.pos.x, t.pos.y, t.pos.z);
    if (n) {
      const r = n.liquid === `lava`,
        i = Math.min(0.9, h.state.stat(r ? `resfire` : `respoison`) / 100);
      (h.combat.scald(n.liquid, e, 1 - i),
        (this.wadeMul = r ? 0.55 : 0.62),
        r &&
          n.depth > 0.45 &&
          ((t.pos.y += Math.min(n.depth - 0.45, e * 5)), t.vel.y < 0 && (t.vel.y = 0), (t.groundTimer = 0.12)));
      const a = n.r.liquidY;
      if (this.wasIn !== n.liquid) {
        const e = r ? 16747050 : 9429082;
        ((r ? h.sparks : h.dust).emit({
          pos: T0.set(t.pos.x, a, t.pos.z),
          vel: T1.set(0, 3, 0),
          spread: 2,
          color: e,
          intensity: 2.8,
          size: r ? 0.14 : 0.3,
          sizeEnd: 0.05,
          alpha: 0.8,
          life: 0.6,
          gravity: 9,
          count: 18,
        }),
          h.audio.splash(r),
          r
            ? h.ui.floater(t.pos.clone().setY(t.pos.y + 2.3), `Lava! Get out!`, `#ff8a3c`)
            : h.state.seen.toxic ||
              ((h.state.seen.toxic = !0),
              h.ui.floater(t.pos.clone().setY(t.pos.y + 2.3), `Toxic water: it poisons you`, `#9fe870`)));
      }
      ((this.wadeFx -= e * (1 + Math.hypot(t.vel.x, t.vel.z) * 0.8)),
        this.wadeFx <= 0 &&
          ((this.wadeFx = 0.12),
          r
            ? (h.sparks.emit({
                pos: T0.set(t.pos.x, a + 0.1, t.pos.z),
                vel: T1.set(0, 2.2, 0),
                spread: 0.8,
                color: Math.random() < 0.5 ? 16738842 : 16760906,
                intensity: 3,
                size: 0.1,
                sizeEnd: 0.02,
                life: 0.6,
                gravity: -1,
                count: 3,
              }),
              h.dust.emit({
                pos: T0.set(t.pos.x, a + 0.4, t.pos.z),
                vel: T1.set(0, 1.4, 0),
                spread: 0.5,
                color: 6969941,
                size: 0.5,
                sizeEnd: 1.8,
                alpha: 0.35,
                life: 1.6,
                gravity: -0.3,
                drag: 0.8,
                count: 1,
              }),
              h.audio.sizzle())
            : h.dust.emit({
                pos: T0.set(t.pos.x, a + 0.05, t.pos.z),
                vel: T1.set(0, 0.6, 0),
                spread: 0.9,
                color: 9420896,
                size: 0.25,
                sizeEnd: 0.9,
                alpha: 0.45,
                life: 0.7,
                drag: 2,
                count: 2,
              })),
        (this.wasIn = n.liquid));
      return;
    }
    if (((this.wasIn = null), t.onGround)) {
      const e = h.world.materialAt(Math.round(t.pos.x), Math.floor(t.pos.y - 0.35), Math.round(t.pos.z));
      e === Mat.Ice && h.state.stat(`grip`) <= 0 ? (t.grip = 0.1) : e === Mat.Snow && (this.wadeMul = 0.85);
    }
  }

  /** KR.drinkTonic (74298): heals 45% of max HP over 2.2 s. */
  drinkTonic(e: number): void {
    const h = this.h,
      t = h.combat,
      n = h.player.pos;
    if (t.hp >= t.maxHp - 0.5) {
      (h.ui.floater(n.clone().setY(n.y + 2.2), `You're already in good health`, `#9fe870`), h.audio.deny());
      return;
    }
    if (!spend(h, e)) return;
    const r = Math.round(t.maxHp * 0.45);
    (t.heal(r, 2.2),
      h.audio.gulp(),
      h.model.attack(`Use_Item`, { rate: 1.5, legs: 0.2 }),
      h.ui.floater(n.clone().setY(n.y + 2.3), `+${r}`, `#7be08f`),
      h.sparks.emit({
        pos: T0.set(n.x, n.y + 1.1, n.z),
        vel: T1.set(0, 2, 0),
        spread: 1.3,
        color: 16743066,
        intensity: 2.4,
        size: 0.12,
        sizeEnd: 0.03,
        life: 1.3,
        gravity: -1.2,
        count: 26,
        drag: 1.4,
      }));
  }

  /** KR.drinkStrength (74326): the strength buff for 2 minutes. */
  drinkStrength(e: number): void {
    const h = this.h;
    if (!spend(h, e)) return;
    const t = h.player.pos;
    ((h.state.buffs.strength = Date.now() + BUFF_MS),
      h.state.save(),
      h.audio.gulp(),
      h.model.attack(`Use_Item`, { rate: 1.5, legs: 0.2 }),
      h.ui.floater(t.clone().setY(t.y + 2.3), `+${Math.round((STRENGTH_MUL - 1) * 100)}% damage`, `#ff7a5c`),
      h.sparks.emit({
        pos: T0.set(t.x, t.y + 1.1, t.z),
        vel: T1.set(0, 2.4, 0),
        spread: 1.6,
        color: 16730682,
        intensity: 3,
        size: 0.14,
        sizeEnd: 0.03,
        life: 1.2,
        gravity: -1.2,
        count: 34,
        drag: 1.4,
      }),
      h.cam.addShake(0.15));
  }

  /** KR.drinkJuice (74353): the Drill Slam charges faster for 5 minutes. */
  drinkJuice(e: number): void {
    const h = this.h;
    if (!spend(h, e)) return;
    const t = h.player.pos;
    ((h.state.buffs.juice = Date.now() + JUICE_MS),
      h.state.save(),
      h.audio.gulp(),
      h.model.attack(`Use_Item`, { rate: 1.5, legs: 0.2 }),
      h.ui.floater(t.clone().setY(t.y + 2.3), `Burrow Slam charges ${Math.round((JUICE_MUL - 1) * 100)}% faster`, `#ffd36a`),
      h.sparks.emit({
        pos: T0.set(t.x, t.y + 1.1, t.z),
        vel: T1.set(0, 2.6, 0),
        spread: 1.8,
        color: 16764762,
        intensity: 3,
        size: 0.14,
        sizeEnd: 0.03,
        life: 1.2,
        gravity: -1.2,
        count: 34,
        drag: 1.4,
      }),
      h.sparks.emit({
        pos: T0.set(t.x, t.y + 1.1, t.z),
        vel: T1.set(0, 1.6, 0),
        spread: 1.2,
        color: 11902207,
        intensity: 2.6,
        size: 0.1,
        sizeEnd: 0.02,
        life: 0.9,
        gravity: -0.8,
        count: 14,
        drag: 1.4,
      }),
      h.ui.ultPop(),
      h.cam.addShake(0.12));
  }

  /** KR.eatCookie (74394): +35% Fortune for 2 minutes, two at once at most. */
  eatCookie(e: number): void {
    const h = this.h,
      t = h.state,
      n = h.player.pos;
    if (t.cookiesOn >= 2) {
      (h.ui.floater(n.clone().setY(n.y + 2.2), `Two at once is the most`, `#ffd36b`), h.audio.deny());
      return;
    }
    if (!spend(h, e)) return;
    const r = Date.now();
    ((t.buffs.cookies = t.buffs.cookies.filter((e) => e > r)),
      t.buffs.cookies.push(r + BUFF_MS),
      t.save(),
      h.audio.munch(),
      h.model.attack(`Use_Item`, { rate: 1.5, legs: 0.2 }),
      h.ui.floater(n.clone().setY(n.y + 2.3), `+35% Fortune`, `#ffd36b`));
    for (let e = 0; e < 2; e++)
      h.sparks.emit({
        pos: T0.set(n.x, n.y + 1.1, n.z),
        vel: T1.set(0, 2.6, 0),
        spread: 2.4,
        color: e ? 16774084 : 16765803,
        intensity: 3,
        size: 0.13,
        sizeEnd: 0.02,
        life: 1.3,
        gravity: 1.2,
        count: 26,
        drag: 1.4,
      });
    h.ui.fortuneBump();
  }

  /** KR.throwSmoke (74426): throws a smoke pot where the camera looks. */
  throwSmoke(e: number): void {
    const h = this.h,
      t = h.player;
    if (t.lifting) {
      h.audio.deny();
      return;
    }
    if (!spend(h, e)) return;
    const n = h.cam.camera.getWorldDirection(new THREE.Vector3()),
      r = new THREE.Vector3(t.pos.x, t.pos.y + (h.burrow ? BURROW_CENTER_Y : 1.3), t.pos.z).addScaledVector(n, 0.7),
      i = n.clone().multiplyScalar(h.burrow ? 8 : 11);
    ((i.y += h.burrow ? 1.5 : 3.5), i.addScaledVector(t.vel, 0.5));
    this.smokes.throw(r, i);
    // mp.fx([`smoke`, id, pos, vel]) only sends when served (solo: nothing)
    ((t.yaw = Math.atan2(n.x, n.z)), h.model.attack(`Throw`, { rate: 1.6, legs: 0.2 }), h.audio.bombThrow());
  }

  /** KR.useStone (74451): the recall stone starts to wake (3 s, walk and do not fight). */
  useStone(e: number): void {
    const h = this.h,
      t = h.player;
    if (!(this.stoneT >= 0)) {
      if (!h.state.supplies.recall) {
        spend(h, e);
        return;
      }
      if (t.lifting || onHub(t.pos)) {
        (h.ui.floater(t.pos.clone().setY(t.pos.y + 2.2), `You're home already`, `#8ff0ff`), h.audio.deny());
        return;
      }
      ((this.stoneT = 0),
        (this.stoneStep = 0),
        (this.stoneHp = h.combat.hp),
        h.model.attack(`Use_Item`, { rate: 1.2, legs: 0.2 }),
        h.ui.floater(t.pos.clone().setY(t.pos.y + 2.3), `The stone wakes... (walk, don't fight)`, `#9ff4ff`));
    }
  }

  /** KR.stoneBroken (74474): the stone goes quiet, with the reason e. */
  stoneBroken(e: string): void {
    const h = this.h;
    this.stoneT = -1;
    const t = h.player.pos;
    (h.ui.floater(t.clone().setY(t.y + 2.3), e, `#ffb0a0`),
      h.audio.deny(),
      h.dust.emit({
        pos: t.clone().setY(t.y + 1),
        spread: 0.8,
        color: 10482943,
        size: 0.3,
        sizeEnd: 0.9,
        alpha: 0.5,
        life: 0.6,
        drag: 2,
        count: 8,
      }));
  }

  /** KR.updateStone (74491): the walk speed multiplier, then the stone's charge and the trip home. */
  updateStone(e: number): void {
    const h = this.h,
      t = h.player;
    if (
      ((t.speedMul = h.state.moveMul * (this.stoneT >= 0 ? 0.45 : 1) * h.combat.slowFactor * this.wadeMul),
      this.stoneT < 0)
    )
      return;
    if (h.combat.ko || t.lifting) {
      this.stoneT = -1;
      return;
    }
    if (h.combat.hp < this.stoneHp - 0.01) return this.stoneBroken(`The blow broke the stone's spell`);
    if (t.thrust > 0.05 || t.dodging || h.drilling || (h.burrow && t.vel.lengthSq() > 9))
      return this.stoneBroken(`Too much moving: the stone went quiet`);
    if (h.combat.aiming) return this.stoneBroken(`No fighting while the stone wakes`);
    if (onHub(t.pos)) {
      this.stoneT = -1;
      return;
    }
    ((this.stoneHp = Math.max(this.stoneHp, h.combat.hp)), (this.stoneT += e / 3));
    const n = this.stoneT;
    for (let e = 0; e < 2; e++) {
      const r = this.stoneT * 40 + e * Math.PI,
        i = 0.9 - n * 0.3;
      h.sparks.emit({
        pos: T0.set(t.pos.x + Math.cos(r) * i, t.pos.y + 0.1, t.pos.z + Math.sin(r) * i),
        vel: T1.set(0, 2 + n * 3, 0),
        spread: 0.15,
        color: e ? 10482943 : 15269375,
        intensity: 2 + n * 2,
        size: 0.09,
        sizeEnd: 0.02,
        life: 0.7,
        drag: 0.5,
        count: 1,
      });
    }
    for (; this.stoneStep < Math.min(9, this.stoneT * 9); ) h.audio.recallStep(this.stoneStep++);
    if (this.stoneT < 1 || ((this.stoneT = -1), !h.state.takeSupply(`recall`, 1))) return;
    h.inv?.refresh();
    const r = t.pos.clone();
    // mp.fx([`recall`, pos]) only sends when served (solo: nothing)
    (this.recallShow(r, !0),
      h.burrow && h.exitBurrow(!1),
      t.pos.copy(h.hub.liftTop).add(new THREE.Vector3(0, 0.5, 2.5)),
      t.vel.set(0, 0, 0),
      this.recallShow(t.pos.clone(), !0),
      h.ui.flash(0.5, `#c9f6ff`),
      h.ui.banner(`HOME`, `The Recall Stone carried you home, haul and all`, `#9ff4ff`));
  }

  /** KR.recallShow (74554): sparks and sound where a miner recalled (t = mine). */
  recallShow(e: THREE.Vector3, t: boolean): void {
    const h = this.h,
      n = e.distanceTo(h.player.pos);
    n > 70 ||
      (h.sparks.emit({
        pos: T0.set(e.x, e.y + 1, e.z),
        vel: T1.set(0, 3, 0),
        spread: 2.2,
        color: 10482943,
        intensity: 3,
        size: 0.14,
        sizeEnd: 0.03,
        life: 0.9,
        drag: 1.5,
        count: 40,
      }),
      h.sparks.emit({
        pos: T0.set(e.x, e.y + 1, e.z),
        vel: T1.set(0, 6, 0),
        spread: 0.5,
        color: 16777215,
        intensity: 3.5,
        size: 0.1,
        sizeEnd: 0.02,
        life: 0.7,
        drag: 0.6,
        count: 20,
      }),
      h.audio.recallGo(t ? 1 : THREE.MathUtils.clamp(1.1 - n / 70, 0.1, 0.8)));
  }

  /** KR.throwBomb (74586): throws a bomb where the camera looks. */
  throwBomb(e: number): void {
    const h = this.h,
      t = h.player,
      n = t.pos.clone().setY(t.pos.y + 2.2);
    if (t.lifting || h.inHaven(t.pos)) {
      (h.ui.floater(n, `No bombs in the haven`, `#8ff0ff`), h.audio.deny());
      return;
    }
    if (!spend(h, e)) return;
    const r = h.cam.camera.getWorldDirection(new THREE.Vector3()),
      i = new THREE.Vector3(t.pos.x, t.pos.y + (h.burrow ? BURROW_CENTER_Y : 1.3), t.pos.z).addScaledVector(r, 0.7),
      a = r.clone().multiplyScalar(h.burrow ? 8 : 11.5);
    ((a.y += h.burrow ? 1.5 : 4.5), a.addScaledVector(t.vel, 0.5));
    this.bombs.throw(i, a);
    // mp.fx([`bomb`, id, pos, vel]) only sends when served (solo: nothing)
    ((t.yaw = Math.atan2(r.x, r.z)), h.model.attack(`Throw`, { rate: 1.6, legs: 0.2 }), h.audio.bombThrow());
  }

  // KR.slamCrater (74609-74652) is the Drill Slam's crater hook (wD `crater`, 70575): owned by [ult].

  /** KR.floorAt (74653) on the host's world. */
  floorAt(e: number, t: number, n: number, r = 18): number | null {
    return floorAt(this.h.world, e, t, n, r);
  }

  /** KR.blast (74660): my bomb blew up at e. */
  blast(e: THREE.Vector3): void {
    const h = this.h,
      t = h.world.dig(e, BLAST_R, 320, 30);
    (h.world.remeshNear(e, BLAST_R + 3), h.grass.markDirty(e.x, e.z));
    let n = 0;
    for (const r in t.yields) {
      let i = t.yields[r];
      for (let e = 0; e < t.yields[r]; e++) Math.random() < h.state.oreBonus && i++;
      for (let t = 0; t < i; t++) h.pickups.spawnOre(r, e, n++ * 0.02);
    }
    for (const t of h.gems.release(e, BLAST_R)) releaseGem(h, t);
    for (const t of h.caveDecor.removeNear(e, BLAST_R))
      h.sparks.emit({
        pos: t.p,
        spread: 2.2,
        color: t.color.getHex(),
        intensity: 2.4,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.6,
        count: 6,
        drag: 2,
      });
    for (const t of h.decor.removeNear(e, BLAST_R, 3)) {
      const e = t.big ? 7126871 : t.color;
      h.dust.emit({
        pos: t.pos.clone().setY(t.pos.y + (t.big ? 2 : 0.3)),
        spread: t.big ? 2.5 : 0.8,
        color: e,
        size: t.big ? 0.8 : 0.3,
        sizeEnd: t.big ? 1.8 : 0.6,
        alpha: 0.8,
        life: 0.8,
        count: t.big ? 18 : 4,
        gravity: 2,
      });
    }
    const r = (e: number) => Math.max(0, 1 - e / 7) ** 0.7,
      i = blastDamage(h.state.level);
    for (const t of h.combat.foes.foes) {
      if (t.state === `dead`) continue;
      const n = t.center(T0),
        a = n.distanceTo(e);
      if (a > 7) continue;
      const o = Math.round(i * r(a)),
        s = T1.subVectors(n, e).setY(0).normalize();
      (h.combat.foes.damage(t, o, s, 12), h.ui.floater(n.clone().setY(n.y + 1.2), String(o), `#ffb45a`, `big`));
    }
    h.combat.worm?.blast(e, 7, wormBlastDamage(h.state.level));
    const a = T0.set(h.player.pos.x, h.player.pos.y + 0.9, h.player.pos.z).distanceTo(e);
    (a < 7 && h.combat.hurt(Math.round(95 * r(a)), e, 16), this.blastShow(e, a, t.mat));
  }

  /** KR.remoteBlast (74712): another miner's bomb blew up at e (multiplayer onFx only; not called solo). */
  remoteBlast(e: THREE.Vector3, t: MinerId): void {
    const h = this.h,
      n = T0.set(h.player.pos.x, h.player.pos.y + 0.9, h.player.pos.z).distanceTo(e);
    (n < 7 &&
      h.combat.hurt(Math.round(95 * Math.max(0, 1 - n / 7) ** 0.7), e, 16, void 0, {
        id: t,
        ranged: !0,
      }),
      this.blastShow(e, n, h.world.materialAt(Math.round(e.x), Math.round(e.y - 1), Math.round(e.z))));
  }

  /** KR.blastShow (74725): debris, fire, smoke, sound, shake, flash and hitstop; t = distance, n = rock. */
  blastShow(e: THREE.Vector3, t: number, n: number): void {
    const h = this.h,
      r = MATERIALS[n] ?? MATERIALS[Mat.Stone];
    (h.debris.burst(e, new THREE.Color(r.color), 24, void 0, 12),
      h.sparks.emit({
        pos: e,
        spread: 12,
        color: 16757850,
        intensity: 4,
        size: 0.34,
        sizeEnd: 0.04,
        life: 0.7,
        gravity: 6,
        count: 90,
        drag: 1.6,
      }),
      h.sparks.emit({
        pos: e,
        spread: 3,
        color: 16773312,
        intensity: 6,
        size: 1.6,
        sizeEnd: 0.2,
        life: 0.22,
        count: 6,
      }),
      h.dust.emit({
        pos: e,
        vel: new THREE.Vector3(0, 2.5, 0),
        spread: 5,
        color: 5917244,
        size: 1.6,
        sizeEnd: 4.2,
        alpha: 0.55,
        life: 2.2,
        drag: 1.6,
        gravity: -0.6,
        count: 26,
      }),
      h.dust.emit({
        pos: e,
        spread: 3,
        color: new THREE.Color(r.color).lerp(new THREE.Color(16777215), 0.3).getHex(),
        size: 0.9,
        sizeEnd: 2.6,
        alpha: 0.6,
        life: 1.3,
        drag: 2.4,
        count: 18,
      }),
      h.audio.bombBoom(t),
      t < 60 && h.cam.addShake(Math.max(0.15, 0.9 - t * 0.035)),
      t < 18 && h.ui.flash(0.45 * (1 - t / 18)),
      t < 30 && (h.hitstop = Math.max(h.hitstop, t < 12 ? 0.1 : 0.04)));
  }
}
