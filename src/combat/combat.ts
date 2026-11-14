// Port of play-inUT-NSi.js 63827-65519: the player combat system dI. HP, armor, i-frames, regen, knock-out and
// respawn, second wind, thorns, life leech, drill grinding on foes / other miners / the worm (with the periodic
// heavy kick and its splash), dash, aiming and firing rivets (crit, twin, bounce, muzzle speed, caliber,
// elements), guard deflect while the drill button is held, blast splash, burn / poison / chill on foes and on
// the player, lava / toxic scalding, stun, foe projectile simulation and hit tests, the landing telegraph of
// thrown rocks, foe auras per look, foe death effects and loot, and the foe health bars.
// It owns the foe view manager wF (FoeViews) and a ground telegraph layer NF.
// Worm, remote miners, multiplayer, pickups, gems, rings, gear loot are host hooks (optional where they are
// not ported yet); their call sites keep the original order and arguments.
import * as THREE from 'three';
import { FoeViews } from '../foes/foeViews';
import type { FoeView } from '../foes/foeView';
import { Telegraph } from '../foes/telegraph';
import { rockMesh } from '../foes/looks';
import { ROCK_SPLASH_R } from '../foes/types';
import type { MinerRig } from '../miner/rig';
import type { PlayerController } from '../player/controller';
import type { FollowCamera } from '../player/followCamera';
import type { Particles } from '../fx/particles';
import { surfaceHeight } from '../world/generate';
import { BIOME_GEM } from '../world/items';
import type { BiomeId } from '../world/caverns';
import { pickGemByDepth } from '../world/gemSpawn';
import { cheats } from '../game/cheats';
import type { CombatStats } from './statsNeeded';
import {
  DASH,
  ELEMENT_COLORS,
  ELEMENT_TRAILS,
  GRIND,
  KICK,
  KILLER_WINDOW_MS,
  PVP_GRIND,
  PVP_THORNS,
  ROCK_HIT_RADIUS,
  ROCK_SCALE,
  SHOTS,
  UP,
  WORM_CONTACT,
  clamp,
  dominantElement,
  netRound,
  type ElementKind,
  type Elements,
  type ShotKind,
} from './tuning';

// module scratch (63821-63824)
const tmpA = new THREE.Vector3(); // oI
const tmpB = new THREE.Vector3(); // Z
const tmpC = new THREE.Vector3(); // sI
const tmpD = new THREE.Vector3(); // cI

/** Remote miner id (multiplayer). */
export type MinerId = string;
/** [burn, poison, chill] share triple, as foe defs and network messages carry it. */
export type ElementTriple = [number, number, number] | number[];
export type PvpKind = `thorns` | `melee` | `grind` | `rivet`;
/** Effect message for the network (d.fx): [`shot`, pos, vel, extra?] or [`deflect`, pos, dir]. */
export type FxMessage = [string, ...unknown[]];

/** The input KR passes each frame (71768-71781). */
export interface CombatInput {
  controlling: boolean;
  burrow: boolean;
  lmb: boolean;
  rmb: boolean;
  dodge: boolean;
  fwd: number;
  str: number;
}

/** Audio methods dI calls (audio manager dM, not ported yet). k values are 0..1 loudness by distance. */
export interface CombatAudio {
  mend(k: number): void;
  grind(k?: number): void;
  golemWindup(k: number): void;
  cast(k: number): void;
  creak(k: number): void;
  rockfall(k: number): void;
  rise(): void;
  hurt(): void;
  secondWind(): void;
  ko(): void;
  hit(big: boolean): void;
  dash(): void;
  shoot(k?: number): void;
  twang(k: number): void;
  heave(k: number): void;
  deflect(k: number): void;
  blast(): void;
  ping(): void;
  bombBoom(dist: number): void;
  shatter(k: number): void;
}

export interface FoeBar {
  pos: THREE.Vector3;
  frac: number;
  name: string;
}

/** HUD methods dI calls (HUD controller EM, not ported yet). floater must copy pos: dI passes scratch vectors. */
export interface CombatUi {
  floater(pos: THREE.Vector3, text: string, color: string): void;
  banner(title: string, sub: string, color: string): void;
  flash(k: number): void;
  hitMarker(): void;
  foeBars(bars: FoeBar[], camera: THREE.Camera): void;
}

export interface RingPulseOptions {
  r0: number;
  r1: number;
  life: number;
  color: number;
  alpha?: number;
  thick?: number;
  speed?: number;
}

/** Ring pulse pool Hp (29365, not ported yet). */
export interface RingPulses {
  pulse(pos: THREE.Vector3, normal: THREE.Vector3, opts: RingPulseOptions): void;
}

/** The worm view TI (65535), or the worm + boss composite bL that KR sets as combat.worm (72367, 72632). */
export interface WormTarget {
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, max: number): { t: number; point: THREE.Vector3; weak: boolean } | null;
  sweep(a: THREE.Vector3, b: THREE.Vector3, pad: number): { point: THREE.Vector3; weak: boolean } | null;
  damage(dmg: number, point: THREE.Vector3, weak: boolean, crit: boolean): void;
  blast(pos: THREE.Vector3, radius: number, dmg: number): void;
}

export interface RemoteMinerHit {
  id: MinerId;
  pos?: THREE.Vector3;
  point: THREE.Vector3;
  t: number;
}

/** Remote miners mp.remotes (48335-48375, not ported yet). */
export interface RemoteMiners {
  position(id: MinerId, out?: THREE.Vector3): THREE.Vector3 | null;
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, max: number, pad?: number, veiled?: boolean): RemoteMinerHit | null;
  sweep(a: THREE.Vector3, b: THREE.Vector3, pad: number): RemoteMinerHit | null;
  inCone(pos: THREE.Vector3, dir: THREE.Vector3, range: number, minDot: number, veiled?: boolean): RemoteMinerHit[];
}

/** Pickups wP (61927, 61953; not ported yet). */
export interface CombatPickups {
  spawnOre(id: string, pos: THREE.Vector3, delay?: number): void;
  spawnGem(id: string, mesh: THREE.Object3D, pos: THREE.Vector3): void;
}

/** Gem meshes Rb.makeMesh (36685; not ported yet). */
export interface CombatGems {
  makeMesh(id: string): THREE.Object3D;
}

/** The host object d that KR passes to dI (70458-70532). */
export interface CombatHost {
  scene: THREE.Scene;
  world: { sample(x: number, y: number, z: number): number };
  state: CombatStats;
  player: PlayerController;
  model: MinerRig;
  cam: FollowCamera;
  audio: CombatAudio;
  ui: CombatUi;
  sparks: Particles;
  dust: Particles;
  /** Hp ring pulses (not ported yet). */
  rings?: RingPulses;
  /** wP pickups (not ported yet). */
  pickups?: CombatPickups;
  /** Rb gems (not ported yet). */
  gems?: CombatGems;
  /** KR: hitstop = max(hitstop, t). */
  hitstop(t: number): void;
  /** KR: inHaven(pos) || returning. */
  safe(pos: THREE.Vector3): boolean;
  /** KR: wakeAtHome(). */
  respawn(): void;
  /** KR 70477: rockfall sound, shake, debris; banner + goal when killed by me. */
  golemDown(foe: FoeView, killedByMe: boolean): void;
  /** KR 70492: goals and the seen.fought flag. */
  defeated(foe: FoeView): void;
  /** KR 70497: roll a gear item (gear system, not ported yet). */
  lootGear?(depth: number, pos: THREE.Vector3): void;
  /** KR: mp.hitFoe(id, dmg, dx, dz, knock, chill), the foe simulation takes the damage. */
  hitFoe?(id: FoeView[`id`], dmg: number, dx: number, dz: number, knock: number, chill: number): void;
  /** KR: mp.id. */
  me?(): MinerId | null;
  /** KR: mp.remotes.position(id). */
  minerAt?(id: MinerId): THREE.Vector3 | null;
  /** KR: mp.remotes. */
  miners?: RemoteMiners;
  /** KR: mp.pvp after the canFightAt check. */
  pvp?(id: MinerId, dmg: number, pos: THREE.Vector3, knock: number, kind: PvpKind, el?: ElementTriple): void;
  /** KR: mp.fx(msg). */
  fx?(msg: FxMessage): void;
  /** KR footGround(x, z, y): ground height for the telegraph decals. */
  ground: (x: number, z: number, y: number) => number | null;
  /** KR: debris.burst(pos, new Color(color), n, up, speed). */
  debris(pos: THREE.Vector3, color: number, n: number, speed: number): void;
  /** KR: ult?.dealt(). */
  dealt?(): void;
  /** KR 70524: koBy name, mp.ko, fortune reset, koAt save. */
  knockedOut(killer: MinerId | null): void;
  /** VP (62317): pickup mesh by id (deaddust, tonic, strength, cookie, ultjuice). Not ported yet. */
  pickupMesh?(id: string): THREE.Object3D;
  /** BM (58391): bomb mesh. Not ported yet. */
  bombMesh?(): THREE.Object3D;
}

type TelegraphDecal = ReturnType<Telegraph[`circle`]>;

interface Shot {
  kind: ShotKind;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  mine: boolean;
  ghost: boolean;
  mark: MinerId | null;
  bounces: number;
  grace: number;
  el: Elements | null;
  grav: number;
  pad: number;
  knock: number;
  decal?: TelegraphDecal;
}

interface FoeDot {
  f: FoeView;
  burn: number;
  burnT: number;
  poison: { dps: number; t: number }[];
  tick: number;
}

type BeamKind = Exclude<ShotKind, `rock`>;

export class Combat { // dI (63827)
  d: CombatHost;
  foes: FoeViews;
  worm: WormTarget | null = null;
  hp: number;
  ko = false;
  aiming = false;
  /** HP floor in special modes (sandbox: 25% of max HP). */
  floor = 0;
  koT = 0;
  iframes = 0;
  regenWait = 0;
  hurtV = 0;
  dodgeCd = 0;
  shootCd = 0;
  grindT = 0;
  grindSum = 0;
  grindShow = 0;
  grindFoe: FoeView | null = null;
  contact: FoeView | MinerId | null = null;
  grindGap = 0;
  kickT = 0;
  bites = 0;
  grindCrit = false;
  grindN = 0;
  shots: Shot[] = [];
  pool: Record<ShotKind, THREE.Mesh[]> = { rivet: [], bolt: [], orb: [], rock: [] };
  geo: Record<BeamKind, THREE.BufferGeometry>;
  mat: Record<BeamKind, THREE.MeshBasicMaterial>;
  tele: Telegraph;
  havenHintT = 0;
  leechShow = 0;
  leechT = 0;
  elMat: Record<ElementKind, THREE.MeshBasicMaterial>;
  lmbHeld = false;
  dots: FoeDot[] = [];
  selfBurn = { dps: 0, t: 0 };
  selfPoison: { dps: number; t: number }[] = [];
  selfTick = 0.5;
  toxicT = 0;
  chillT = 0;
  chillK = 0;
  stunT = 0;
  healLeft = 0;
  healRate = 0;
  lastMiner: { id: MinerId; t: number } | null = null;
  grindAt = new THREE.Vector3();
  burrowGrindT = 0;
  grindFrame = -1;
  grindNear = 0;
  frameNo = 0;

  constructor(e: CombatHost, t: ConstructorParameters<typeof FoeViews>[0]) {
    this.d = e;
    this.hp = e.state.maxHp;
    this.geo = {
      rivet: new THREE.CapsuleGeometry(0.055, 0.26, 3, 6),
      bolt: new THREE.CapsuleGeometry(0.04, 0.5, 2, 5),
      orb: new THREE.IcosahedronGeometry(0.24, 1),
    };
    this.mat = {
      rivet: new THREE.MeshBasicMaterial({ color: SHOTS.rivet.color, toneMapped: true }),
      bolt: new THREE.MeshBasicMaterial({ color: SHOTS.bolt.color }),
      orb: new THREE.MeshBasicMaterial({ color: SHOTS.orb.color }),
    };
    this.elMat = {
      burn: new THREE.MeshBasicMaterial({ color: ELEMENT_COLORS.burn }),
      poison: new THREE.MeshBasicMaterial({ color: ELEMENT_COLORS.poison }),
      chill: new THREE.MeshBasicMaterial({ color: ELEMENT_COLORS.chill }),
    };
    this.tele = new Telegraph(e.ground);
    e.scene.add(this.tele.group);
    this.foes = new FoeViews(t, {
      windup: (t: FoeView) => {
        const n = t.pos.distanceTo(e.player.pos);
        const r = clamp(1.2 - n / 40, 0.2, 1);
        if (t.state === `mend`) {
          if (n < 60) {
            e.audio.mend(r);
            e.ui.floater(
              t.center(new THREE.Vector3()).setY(t.pos.y + t.height + 0.6),
              `+${Math.round(t.maxHp * (t.def.mend?.frac ?? 0))}`,
              `#8dffc0`,
            );
          }
        } else if (t.state === `dig`) {
          if (n < 40) e.audio.grind(r);
        } else if (t.state === `hurl`) {
          e.audio.golemWindup(r);
          const n = Math.sin(t.yaw);
          const i = Math.cos(t.yaw);
          e.dust.emit({
            pos: tmpA.set(t.pos.x + n * 1.4, t.pos.y + 0.3, t.pos.z + i * 1.4),
            vel: tmpB.set(0, 2.2, 0),
            spread: 2.2,
            color: 9337690,
            size: 0.6,
            sizeEnd: 1.7,
            alpha: 0.5,
            life: 1,
            drag: 2.5,
            count: 8,
          });
        } else if (t.def.attack === `orb`) e.audio.cast(r);
        else if (t.def.surface) e.audio.golemWindup(r);
        else e.audio.creak(r);
      },
      slam: (_t: FoeView, n: THREE.Vector3) => {
        const r = n.distanceTo(e.player.pos);
        if (r > 60) return;
        e.audio.rockfall(clamp(1.2 - r / 40, 0.15, 1));
        e.cam.addShake(Math.max(0, 0.55 - r * 0.03));
        for (let t = 0; t < 14; t++) {
          const r = (t / 14) * Math.PI * 2;
          e.dust.emit({
            pos: tmpA.set(n.x + Math.cos(r) * 0.8, n.y + 0.2, n.z + Math.sin(r) * 0.8),
            vel: tmpB.set(Math.cos(r) * 6, 0.8, Math.sin(r) * 6),
            spread: 0.5,
            color: t % 2 ? 12103070 : 9337690,
            size: 0.6,
            sizeEnd: 1.8,
            alpha: 0.6,
            life: 0.9,
            drag: 3.2,
            count: 1,
          });
        }
        e.dust.emit({
          pos: tmpA.set(n.x, n.y + 0.4, n.z),
          vel: tmpB.set(0, 5, 0),
          spread: 3,
          color: 7297600,
          size: 0.18,
          sizeEnd: 0.3,
          alpha: 0.9,
          life: 0.9,
          gravity: 14,
          drag: 0.5,
          count: 16,
        });
      },
      rose: (t: FoeView) => {
        const n = t.pos;
        if (n.distanceTo(e.player.pos) < 45) e.audio.rise();
        for (let t = 0; t < 3; t++)
          e.dust.emit({
            pos: tmpA.set(n.x, n.y + 0.2, n.z),
            vel: tmpB.set(0, 1.4, 0),
            spread: 2.2,
            color: t ? 8088156 : 10260354,
            size: 0.7,
            sizeEnd: 2.2,
            alpha: 0.5,
            life: 1.6,
            drag: 2,
            gravity: -0.3,
            count: 8,
          });
        e.sparks.emit({
          pos: tmpA.set(n.x, n.y + 0.4, n.z),
          vel: tmpB.set(0, 3, 0),
          spread: 1.6,
          color: 5898188,
          intensity: 2.2,
          size: 0.12,
          sizeEnd: 0.02,
          life: 1.2,
          gravity: -1,
          count: 14,
        });
        if (n.distanceTo(e.player.pos) < 10) e.cam.addShake(0.12);
      },
      died: (f: FoeView, mine: boolean) => this.foeDied(f, mine),
      hit: (t: FoeView, n: number, r: number, i: number, a: number, o: number) => e.hitFoe?.(t.id, n, r, i, a, o),
      aura: (f: FoeView, dt: number) => this.aura(f, dt),
      mending: (f: FoeView, dt: number) => this.mending(f, dt),
      burrowing: (f: FoeView, dt: number) => this.burrowing(f, dt),
    });
    e.scene.add(this.foes.group);
  }

  get maxHp(): number {
    return this.d.state.maxHp;
  }

  /** Take a hit. Returns false when the hit is ignored (KO, i-frames, lift, haven). (64002) */
  hurt(e: number, t: THREE.Vector3, n: number, r?: FoeView, i?: { id: MinerId; ranged: boolean }): boolean {
    const { player: a, state: o } = this.d;
    if (this.ko || this.iframes > 0 || a.lifting || this.d.safe(a.pos)) return false;
    if (cheats.god) return false; // MINEAR cheat: unlimited HP
    if (i) this.lastMiner = { id: i.id, t: performance.now() };
    const s = o.stat(`thorns`);
    if (r && s > 0 && r.state !== `dead`) {
      const t = Math.round((e * s) / 100);
      tmpB.set(r.pos.x - a.pos.x, 0, r.pos.z - a.pos.z).normalize();
      this.foes.damage(r, t, tmpB, 2.5);
      this.d.ui.floater(r.center(new THREE.Vector3()).setY(r.pos.y + 2), String(t), `#c9a4ff`);
      this.d.sparks.emit({
        pos: r.center(new THREE.Vector3()),
        spread: 3,
        color: 13214975,
        intensity: 3,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.4,
        gravity: 6,
        count: 10,
      });
    }
    const c = Math.round(((e * s) / 100) * PVP_THORNS);
    const l = i && !i.ranged && c >= 1 ? (this.d.miners?.position(i.id) ?? null) : null;
    if (l && i) {
      this.d.pvp?.(i.id, c, a.pos, 2.5, `thorns`);
      this.d.ui.floater(l.clone().setY(l.y + 2), String(c), `#c9a4ff`);
      this.d.sparks.emit({
        pos: l.setY(l.y + 1),
        spread: 3,
        color: 13214975,
        intensity: 3,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.4,
        gravity: 6,
        count: 10,
      });
    }
    const u = a.pos.x - t.x;
    const dz = a.pos.z - t.z;
    const f = Math.hypot(u, dz);
    if (f > 0.001) {
      a.vel.x += (u / f) * n;
      a.vel.z += (dz / f) * n;
      if (a.onGround) a.vel.y = Math.max(a.vel.y, 3.2);
    }
    const p = Math.max(1, Math.round(e * (1 - o.armor) * (0.9 + Math.random() * 0.2)));
    this.hp = this.floor > 0 ? Math.max(Math.min(this.hp, this.floor), this.hp - p) : this.hp - p;
    this.iframes = 0.35;
    this.regenWait = 6;
    this.hurtV = Math.min(1, 0.45 + (p / this.maxHp) * 2.5);
    this.d.model.attack(Math.random() < 0.5 ? `Hit_A` : `Hit_B`, { rate: 1.6, legs: 0.4 });
    this.d.audio.hurt();
    this.d.cam.addShake(0.32);
    this.d.ui.floater(new THREE.Vector3(a.pos.x, a.pos.y + 2.2, a.pos.z), `-${p}`, `#ff5a4f`);
    if (this.hp <= 0 && o.stat(`wind`) > 0 && !o.windUsed) {
      o.windUsed = true;
      this.hp = Math.max(1, Math.round(this.maxHp * 0.3));
      this.iframes = 1.6;
      this.d.ui.banner(`SECOND WIND!`, `Not today`, `#ffe08a`);
      this.d.ui.flash(0.45);
      this.d.audio.secondWind();
      this.d.hitstop(0.2);
      this.d.sparks.emit({
        pos: tmpA.set(a.pos.x, a.pos.y + 1, a.pos.z),
        vel: tmpB.set(0, 3, 0),
        spread: 5,
        color: 16769162,
        intensity: 3.5,
        size: 0.18,
        sizeEnd: 0.02,
        life: 1.2,
        gravity: -1,
        count: 60,
        drag: 1.5,
      });
      return true;
    }
    if (this.hp <= 0) this.knockOut();
    return true;
  }

  /** At least t seconds of i-frames. */
  shield(e: number) {
    this.iframes = Math.max(this.iframes, e);
  }

  /** Heal e HP over t seconds. */
  heal(e: number, t: number) {
    this.healLeft += e;
    this.healRate = Math.max(this.healRate, e / t);
  }

  /** Life leech: vamp% of dealt damage. */
  leech(e: number) {
    const t = this.d.state.stat(`vamp`);
    if (t <= 0 || this.ko) return;
    const n = (e * t) / 100;
    this.hp = Math.min(this.maxHp, this.hp + n);
    this.leechShow += n;
  }

  knockOut() {
    this.hp = 0;
    this.ko = true;
    this.koT = 0;
    this.healLeft = this.healRate = 0;
    this.aiming = false;
    this.d.model.die();
    this.d.audio.ko();
    this.d.hitstop(0.18);
    this.d.cam.addShake(0.5);
    const e = this.lastMiner;
    this.d.knockedOut(e && performance.now() - e.t < KILLER_WINDOW_MS ? e.id : null);
    this.lastMiner = null;
  }

  impact(e: THREE.Vector3, t: THREE.Vector3, n: boolean) {
    const r = t.clone().multiplyScalar(n ? 5 : 3.5);
    r.y += 2;
    this.d.sparks.emit({
      pos: e,
      vel: r,
      spread: 4.5,
      color: 16767392,
      intensity: 3,
      size: 0.12,
      sizeEnd: 0.02,
      life: 0.35,
      gravity: 14,
      count: n ? 14 : 8,
    });
    this.d.dust.emit({
      pos: e,
      vel: new THREE.Vector3(0, 0.8, 0),
      spread: 1.4,
      color: 15261903,
      size: 0.3,
      sizeEnd: 1,
      alpha: 0.7,
      life: 0.5,
      drag: 3,
      count: n ? 5 : 3,
    });
    this.hitFlash(e, t, n ? 1.4 : 1);
  }

  hitFlash(e: THREE.Vector3, t: THREE.Vector3, n = 1) {
    this.d.sparks.emit({
      pos: e,
      color: 16774882,
      intensity: 3.2 * n,
      size: 0.55 * n,
      sizeEnd: 0.2,
      life: 0.07,
      count: 1,
    });
    tmpC.copy(t).negate();
    if (tmpC.lengthSq() < 1e-6) tmpC.set(0, 0, 1);
    this.d.rings?.pulse(e, tmpC, {
      r0: 0.08 * n,
      r1: 0.62 * n,
      life: 0.24,
      color: 16770232,
      alpha: 0.55,
      thick: 0.45,
    });
    this.d.ui.hitMarker();
  }

  /** Grind contact tracking; true when this is a new contact (resets the kick timer and bite count). */
  touch(e: FoeView | MinerId) {
    const t = this.contact !== e || this.grindGap <= 0;
    if (t) {
      this.kickT = 0;
      this.bites = 0;
    }
    this.contact = e;
    this.grindGap = 0.25;
    return t;
  }

  rollCrit() {
    return Math.random() < 0.1 + this.d.state.crit;
  }

  /** Drill grind on a foe (64174). */
  grind(e: FoeView, t: THREE.Vector3, n: number) {
    if (this.ko) return;
    const r = this.touch(e);
    this.grindFoe = e;
    this.grindAt.copy(t);
    this.kickT += n;
    this.grindT -= n;
    if (this.grindT > 0) return;
    this.grindT = GRIND.every;
    const i = this.d.player;
    const a = this.kickT >= KICK.every;
    if (a) this.kickT = 0;
    const o = this.rollCrit();
    const s = this.d.state.meleeDamage * (a ? KICK.mult : GRIND.mult) * (o ? 1.5 : 1);
    tmpA.set(e.pos.x - i.pos.x, 0, e.pos.z - i.pos.z).normalize();
    const c = this.foes.damage(e, s, tmpA, a ? KICK.knock : GRIND.knock);
    this.d.dealt?.();
    this.leech(s);
    this.grindSum += s;
    this.grindCrit ||= o;
    this.d.sparks.emit({
      pos: t,
      vel: tmpB.copy(tmpA).multiplyScalar(-4).setY(2.5),
      spread: 5,
      color: 16773320,
      intensity: 3.2,
      size: 0.1,
      sizeEnd: 0.02,
      life: 0.3,
      gravity: 14,
      count: a ? 18 : 7,
    });
    this.d.dust.emit({
      pos: t,
      spread: 0.8,
      color: 15261903,
      size: 0.25,
      sizeEnd: 0.7,
      alpha: 0.5,
      life: 0.4,
      count: a ? 4 : 1,
    });
    if (a) {
      this.kickShow(t, tmpA);
      this.kickSplash(t, e);
    } else {
      this.hitFlash(t, tmpA, this.grindN++ % 2 ? 0.7 : 1);
      this.d.audio.grind();
      this.d.cam.addShake(r ? 0.14 : 0.07);
    }
    if (r || c || a) this.d.hitstop(c ? 0.07 : a ? 0.06 : 0.04);
  }

  kickShow(e: THREE.Vector3, t: THREE.Vector3) {
    this.hitFlash(e, t, 1.7);
    this.d.rings?.pulse(e, tmpC.copy(t).negate(), {
      r0: 0.2,
      r1: 1.5,
      life: 0.34,
      color: 16773846,
      alpha: 0.6,
      thick: 0.28,
    });
    this.d.audio.hit(true);
    this.d.cam.addShake(0.3);
    this.d.model.recoil();
  }

  /** Kick splash: half melee damage to up to 4 other foes within 2.2 m of the contact point. */
  kickSplash(e: THREE.Vector3, t: FoeView) {
    let n = 0;
    for (const r of this.foes.foes as FoeView[]) {
      if (r === t || r.state === `dead`) continue;
      const i = r.center(tmpD);
      if (i.distanceTo(e) > KICK.reach) continue;
      tmpB.set(i.x - e.x, 0, i.z - e.z);
      if (tmpB.lengthSq() < 1e-4) tmpB.set(i.x - this.d.player.pos.x, 0, i.z - this.d.player.pos.z);
      tmpB.normalize();
      const a = this.rollCrit();
      const o = this.d.state.meleeDamage * KICK.splash * (a ? 1.5 : 1);
      this.foes.damage(r, o, tmpB, KICK.shove);
      this.leech(o);
      this.d.ui.floater(
        i.clone().setY(i.y + 1.1),
        a ? `${Math.round(o)}!` : String(Math.round(o)),
        a ? `#ffd23c` : `#ffffff`,
      );
      this.hitFlash(i, tmpB, 0.9);
      if (++n >= 4) break;
    }
  }

  /** PvP drill grind on another miner (64265). */
  grindMiner(e: MinerId, t: THREE.Vector3, n: number) {
    if (this.ko || this.d.safe(this.d.player.pos)) return;
    const r = this.touch(e);
    this.grindFoe = null;
    this.grindT -= n;
    if (this.grindT > 0) return;
    this.grindT = PVP_GRIND.every;
    const i = this.d.player;
    const a = ++this.bites % 3 == 0;
    const o = this.rollCrit();
    const s = this.d.state.meleeDamage * PVP_GRIND.mult * (o ? 1.5 : 1);
    this.d.pvp?.(e, s, i.pos, a ? PVP_GRIND.kick : PVP_GRIND.knock, a ? `melee` : `grind`);
    this.d.dealt?.();
    this.leech(s);
    this.grindSum += s;
    this.grindCrit ||= o;
    this.grindAt.copy(t);
    tmpA.subVectors(i.pos, t).setY(0).normalize();
    this.d.sparks.emit({
      pos: t,
      vel: tmpB.copy(tmpA).multiplyScalar(4).setY(2.5),
      spread: 5,
      color: 16773320,
      intensity: 3.2,
      size: 0.1,
      sizeEnd: 0.02,
      life: 0.3,
      gravity: 14,
      count: a ? 18 : 7,
    });
    tmpB.copy(tmpA).negate();
    if (a) this.kickShow(t, tmpB);
    else {
      this.hitFlash(t, tmpB);
      this.d.audio.grind();
      this.d.cam.addShake(r ? 0.14 : 0.08);
    }
  }

  /** Drill grind on the worm (64299). weak = hit on the weak side (x2 damage in the worm). */
  grindWorm(e: THREE.Vector3, t: boolean, n: number) {
    if (this.ko || !this.worm) return;
    const r = this.touch(WORM_CONTACT);
    this.grindFoe = null;
    this.kickT += n;
    this.grindT -= n;
    if (this.grindT > 0) return;
    this.grindT = GRIND.every;
    const i = this.kickT >= KICK.every;
    if (i) this.kickT = 0;
    const a = this.rollCrit();
    const o = this.d.state.meleeDamage * (i ? KICK.mult : GRIND.mult) * (a ? 1.5 : 1);
    this.worm.damage(o, e, t, a);
    this.d.dealt?.();
    this.leech(o);
    tmpA.subVectors(this.d.player.pos, e).setY(0).normalize();
    this.d.sparks.emit({
      pos: e,
      vel: tmpB.copy(tmpA).multiplyScalar(4).setY(2.5),
      spread: 5,
      color: t ? 16773336 : 11898111,
      intensity: 3.2,
      size: 0.1,
      sizeEnd: 0.02,
      life: 0.3,
      gravity: 14,
      count: i ? 18 : 7,
    });
    tmpB.copy(tmpA).negate();
    if (i) this.kickShow(e, tmpB);
    else {
      this.hitFlash(e, tmpB, (this.grindN++ % 2 ? 0.8 : 1.1) * (t ? 1.25 : 1));
      this.d.audio.grind();
      this.d.cam.addShake(r ? 0.12 : t ? 0.1 : 0.07);
    }
  }

  /** Dash (64331). fwd / strafe are the move axes; no input dashes backward. */
  dodge(e: boolean, t: number, n: number): boolean {
    const { player: r, model: i, cam: a } = this.d;
    if (this.ko || e || r.lifting || this.dodgeCd > 0 || !r.onGround) return false;
    const o = Math.sin(a.yaw);
    const s = Math.cos(a.yaw);
    let c = o * t - s * n;
    let l = s * t + o * n;
    if (!t && !n) {
      c = -o;
      l = -s;
    }
    const u = Math.hypot(c, l) || 1;
    c /= u;
    l /= u;
    r.dodge(c, l, DASH.speed * Math.sqrt(r.speedMul), DASH.len);
    const d = Math.sin(r.yaw);
    const f = Math.cos(r.yaw);
    i.dash(c * f - l * d, c * d + l * f, DASH.len);
    const p = this.d.state.stat(`nimble`) / 100;
    this.iframes = Math.max(this.iframes, DASH.len + p * 0.3);
    this.dodgeCd = 0.6 * (1 - p);
    this.d.audio.dash();
    this.d.dust.emit({
      pos: tmpA.set(r.pos.x, r.pos.y + 0.12, r.pos.z),
      vel: tmpB.set(-c * 2.2, 0.5, -l * 2.2),
      spread: 0.9,
      color: 13483942,
      size: 0.35,
      sizeEnd: 1.1,
      alpha: 0.34,
      life: 0.45,
      drag: 3,
      count: 4,
    });
    return true;
  }

  /** Fire a rivet along the camera aim (64364). */
  fire(e: boolean) {
    const { cam: t, model: n, player: r, state: i } = this.d;
    const a = t.camera;
    const o = e ? t.pivot : a.position;
    const s = a.getWorldDirection(tmpB).clone();
    let c = 70;
    const l = this.foes.rayHit(o, s, c);
    const u = this.rayRock(o, s, c, e ? 1.8 : 0.5);
    if (l) c = l.t;
    const d = this.d.miners?.rayHit(o, s, c, 0, true) ?? null;
    if (d) c = d.t;
    if (u !== null && u < c) c = u;
    const f = o.clone().addScaledVector(s, c);
    const p = n.launcherTip(new THREE.Vector3()) ?? n.drillTip(new THREE.Vector3());
    const m = f.sub(p);
    if (m.lengthSq() < 0.01) m.copy(s);
    m.normalize();
    m.x += (Math.random() - 0.5) * 0.012;
    m.y += (Math.random() - 0.5) * 0.012;
    const h = 1 + i.stat(`muzzle`) / 100;
    m.normalize().multiplyScalar(SHOTS.rivet.speed * h);
    const g = +(Math.random() * 100 < i.stat(`bounce`));
    const _ = e ? 1.2 : 0;
    const v = this.elements();
    const y = 1 + i.stat(`caliber`) / 100;
    this.spawnShot(`rivet`, p, m, i.rangedDamage, true, g, _, false, null, v, y, h);
    const b =
      v || y > 1 || h > 1
        ? [netRound(h), netRound(y), v ? [`burn`, `poison`, `chill`].indexOf(dominantElement(v)) + 1 : 0]
        : null;
    this.d.fx?.(
      b
        ? [`shot`, [netRound(p.x), netRound(p.y), netRound(p.z)], [netRound(m.x), netRound(m.y), netRound(m.z)], b]
        : [`shot`, [netRound(p.x), netRound(p.y), netRound(p.z)], [netRound(m.x), netRound(m.y), netRound(m.z)]],
    );
    if (Math.random() * 100 < i.stat(`twin`)) {
      const e = m.clone().applyAxisAngle(UP, (Math.random() < 0.5 ? -1 : 1) * 0.035);
      e.y += 0.3;
      this.spawnShot(`rivet`, p, e, i.rangedDamage, true, g, _, false, null, v, y, h);
      this.d.fx?.(
        b
          ? [`shot`, [netRound(p.x), netRound(p.y), netRound(p.z)], [netRound(e.x), netRound(e.y), netRound(e.z)], b]
          : [`shot`, [netRound(p.x), netRound(p.y), netRound(p.z)], [netRound(e.x), netRound(e.y), netRound(e.z)]],
      );
    }
    this.d.audio.shoot();
    t.addShake(0.04);
    this.d.sparks.emit({
      pos: p,
      vel: m.clone().multiplyScalar(0.12),
      spread: 2.2,
      color: 16760944,
      intensity: 3.2,
      size: 0.16,
      sizeEnd: 0.02,
      life: 0.12,
      count: 5,
    });
    r.vel.x -= m.x * 0.004;
    r.vel.z -= m.z * 0.004;
  }

  /** March a ray through the density field; distance to the first solid sample, or null. */
  rayRock(e: THREE.Vector3, t: THREE.Vector3, n: number, r = 0.5): number | null {
    const i = this.d.world;
    for (let a = r; a < n; a += 0.45) if (i.sample(e.x + t.x * a, e.y + t.y * a, e.z + t.z * a) > 128) return a;
    return null;
  }

  /** A foe projectile from the simulation (64432). mark = target miner id (orbs home on it). */
  foeShot(e: ShotKind, t: THREE.Vector3, n: THREE.Vector3, r: number, i: MinerId | null, a?: ElementTriple | null) {
    const o = this.spawnShot(e, t, n, r, false, 0, 0, false, i, a ? { burn: a[0], poison: a[1], chill: a[2] } : null);
    const s = clamp(1.3 - t.distanceTo(this.d.player.pos) / 40, 0.15, 1);
    if (e === `bolt`) this.d.audio.twang(s);
    else if (e === `rock`) {
      this.d.audio.heave(s);
      const e = this.landing(o.pos, o.vel, o.grav, o.life);
      if (e) o.decal = this.tele.circle(e.at, ROCK_SPLASH_R, 16734762, e.t, 0.05);
    }
  }

  /** Simulate a ballistic path at 60 Hz; where and when it first enters rock. */
  landing(e: THREE.Vector3, t: THREE.Vector3, n: number, r: number): { at: THREE.Vector3; t: number } | null {
    const i = e.clone();
    const a = t.clone();
    const o = 1 / 60;
    for (let e = o; e < r; e += o) {
      a.y -= n * o;
      i.addScaledVector(a, o);
      if (this.d.world.sample(i.x, i.y, i.z) > 128) return { at: i, t: e };
    }
    return null;
  }

  /** A thrown rock lands (64462). direct = it already hit the player. */
  rockLands(e: Shot, t: THREE.Vector3, n: boolean) {
    const r = this.d.player.pos;
    if (!n && !this.ko) {
      const n = Math.hypot(r.x - t.x, r.z - t.z);
      if (n < 3.2 && Math.abs(r.y + 0.9 - t.y) < 2.8)
        this.hurt(Math.round(e.dmg * (0.75 - (0.4 * n) / ROCK_SPLASH_R)), t, 7);
    }
    const i = t.distanceTo(r);
    if (i < 70) {
      this.d.audio.rockfall(clamp(1.25 - i / 45, 0.12, 1));
      this.d.cam.addShake(Math.max(0, 0.45 - i * 0.02));
    }
    this.d.debris(tmpC.copy(t).setY(t.y + 0.4), 8221286, 16, 6.5);
    for (let e = 0; e < 12; e++) {
      const n = (e / 12) * Math.PI * 2;
      this.d.dust.emit({
        pos: tmpA.set(t.x + Math.cos(n) * 0.7, t.y + 0.25, t.z + Math.sin(n) * 0.7),
        vel: tmpB.set(Math.cos(n) * 5.5, 0.7, Math.sin(n) * 5.5),
        spread: 0.5,
        color: e % 2 ? 12103070 : 9337690,
        size: 0.55,
        sizeEnd: 1.6,
        alpha: 0.55,
        life: 0.85,
        drag: 3.2,
        count: 1,
      });
    }
    this.d.dust.emit({
      pos: tmpA.set(t.x, t.y + 0.4, t.z),
      vel: tmpB.set(0, 2.5, 0),
      spread: 1.8,
      color: 9337690,
      size: 1,
      sizeEnd: 2.6,
      alpha: 0.5,
      life: 1.2,
      drag: 2.2,
      count: 6,
    });
  }

  /** Foe in the dig state: dirt spray and one grind sound per frame for the nearest digger (64507). */
  burrowing(e: FoeView, t: number) {
    const n = e.pos.distanceTo(this.d.player.pos);
    if (n > 45) return;
    const r = Math.sin(e.yaw);
    const i = Math.cos(e.yaw);
    if (Math.random() < t * 16)
      this.d.dust.emit({
        pos: tmpA.set(e.pos.x + r * 0.7, e.pos.y + 0.9, e.pos.z + i * 0.7),
        vel: tmpB.set(-r * 2, 1.4, -i * 2),
        spread: 1.4,
        color: Math.random() < 0.5 ? 12098166 : 9337690,
        size: 0.35,
        sizeEnd: 1.1,
        alpha: 0.5,
        life: 0.8,
        drag: 2.5,
        gravity: 3,
        count: 2,
      });
    if (n >= 34) return;
    const a = clamp(1.15 - n / 30, 0.08, 0.9);
    if (this.grindFrame === this.frameNo) this.grindNear = Math.max(this.grindNear, a);
    else {
      this.grindFrame = this.frameNo;
      this.grindNear = a;
      this.burrowGrindT -= t;
    }
    if (this.burrowGrindT <= 0) {
      this.burrowGrindT = 0.11 + Math.random() * 0.05;
      this.d.audio.grind(this.grindNear);
    }
  }

  /** Foe in the mend state: green sparks drawn in (64537). */
  mending(e: FoeView, t: number) {
    e.sinceHit = Math.min(e.sinceHit, 1);
    if (e.pos.distanceTo(this.d.player.pos) > 60 || Math.random() > t * 22) return;
    const n = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 1.1;
    this.d.sparks.emit({
      pos: tmpA.set(e.pos.x + Math.cos(n) * r, e.pos.y + Math.random() * e.height * 0.9, e.pos.z + Math.sin(n) * r),
      vel: tmpB.set(-Math.cos(n) * 1.3, 1.6, -Math.sin(n) * 1.3),
      spread: 0.3,
      color: Math.random() < 0.6 ? 7208880 : 5898188,
      intensity: 3,
      size: 0.12,
      sizeEnd: 0.03,
      life: 0.9,
      gravity: -0.6,
      count: 1,
    });
  }

  /** A remote miner's rivet, replayed without damage (64562). n = [muzzle, caliber, elementIdx]. */
  ghostShot(e: THREE.Vector3, t: THREE.Vector3, n?: number[] | null) {
    this.spawnShot(
      `rivet`,
      e,
      t,
      0,
      false,
      0,
      1.2,
      true,
      null,
      n
        ? ([
            null,
            { burn: 1, poison: 0, chill: 0 },
            { burn: 0, poison: 1, chill: 0 },
            { burn: 0, poison: 0, chill: 1 },
          ][n[2]] ?? null)
        : null,
      n?.[1] ?? 1,
      n?.[0] ?? 1,
    );
    this.d.audio.shoot(clamp(1 - e.distanceTo(this.d.player.pos) / 45, 0.1, 0.8));
  }

  spawnShot(
    e: ShotKind,
    t: THREE.Vector3,
    n: THREE.Vector3,
    r: number,
    i: boolean,
    a = 0,
    o = 0,
    s = false,
    c: MinerId | null = null,
    l: Elements | null = null,
    u = 1,
    d = 1,
  ): Shot {
    const f: THREE.Mesh = this.pool[e].pop() ?? (e === `rock` ? rockMesh() : new THREE.Mesh(this.geo[e], this.mat[e]));
    f.visible = true;
    f.position.copy(t);
    if (e !== `rock`) f.material = l ? this.elMat[dominantElement(l)] : this.mat[e];
    f.scale.setScalar(e === `rock` ? ROCK_SCALE : Math.sqrt(u));
    this.d.scene.add(f);
    const p: Shot = {
      kind: e,
      mesh: f,
      pos: t.clone(),
      vel: n.clone(),
      life: SHOTS[e].life,
      dmg: r,
      mine: i,
      ghost: s,
      mark: c,
      bounces: a,
      grace: o,
      el: l,
      grav: SHOTS[e].gravity / d,
      pad: 0.08 + (u - 1) * 0.14,
      knock: 2.2 * (0.6 + 0.4 * u),
    };
    this.shots.push(p);
    return p;
  }

  /** The player's shot elements from the ember / venom / frost stats, or null. */
  elements(): Elements | null {
    const e = this.d.state;
    const t = e.stat(`ember`) / 100;
    const n = e.stat(`venom`) / 100;
    const r = e.stat(`frost`) / 100;
    return t > 0 || n > 0 || r > 0 ? { burn: t, poison: n, chill: r } : null;
  }

  afflictFoe(e: FoeView, t: number, n: Elements) {
    if (n.burn > 0 || n.poison > 0) {
      let r = this.dots.find((t) => t.f === e);
      if (!r) this.dots.push((r = { f: e, burn: 0, burnT: 0, poison: [], tick: 0.5 }));
      if (n.burn > 0) {
        r.burn = Math.max(r.burnT > 0 ? r.burn : 0, t * n.burn);
        r.burnT = 3;
      }
      if (n.poison > 0) {
        r.poison.push({ dps: t * n.poison, t: 5 });
        if (r.poison.length > 3) r.poison.shift();
      }
    }
    if (n.chill > 0) e.frost = 1;
  }

  updateAfflictions(e: number) {
    for (let t = this.dots.length - 1; t >= 0; t--) {
      const n = this.dots[t];
      n.burnT -= e;
      for (const t of n.poison) t.t -= e;
      n.poison = n.poison.filter((e) => e.t > 0);
      if (n.f.state === `dead` || !(this.foes.foes as FoeView[]).includes(n.f) || (n.burnT <= 0 && !n.poison.length)) {
        this.dots.splice(t, 1);
        continue;
      }
      const r = n.f.center(tmpA);
      if (n.burnT > 0 && Math.random() < e * 16)
        this.d.sparks.emit({
          pos: r,
          vel: tmpB.set(0, 2.2, 0),
          spread: 0.8,
          color: Math.random() < 0.5 ? 16742954 : 16760906,
          intensity: 3,
          size: 0.13,
          sizeEnd: 0.02,
          life: 0.5,
          gravity: -2,
          count: 1,
        });
      if (n.poison.length && Math.random() < e * 9)
        this.d.dust.emit({
          pos: r,
          vel: tmpB.set(0, 0.8, 0),
          spread: 0.6,
          color: 8118415,
          size: 0.18,
          sizeEnd: 0.42,
          alpha: 0.75,
          life: 0.8,
          drag: 1,
          count: 1,
        });
      n.tick -= e;
      if (n.tick > 0) continue;
      n.tick = 0.5;
      const i = n.burnT > 0 ? n.burn * 0.5 : 0;
      const a = n.poison.reduce((e, t) => e + t.dps, 0) * 0.5;
      const o = Math.max(1, Math.round(i + a));
      this.foes.damage(n.f, o, tmpB.set(0, 0, 0), 0);
      this.d.dealt?.();
      this.d.ui.floater(n.f.center(tmpA).setY(n.f.pos.y + n.f.height + 0.3), String(o), i >= a ? `#ff9a4a` : `#7be08f`);
    }
    for (const t of this.foes.foes as FoeView[]) {
      if (t.frost <= 0) continue;
      t.frost = Math.max(0, t.frost - e / 1.6);
      if (Math.random() < e * 10)
        this.d.sparks.emit({
          pos: t.center(tmpA),
          vel: tmpB.set(0, 0.5, 0),
          spread: 0.9,
          color: 10479871,
          intensity: 2.2,
          size: 0.1,
          sizeEnd: 0.02,
          life: 0.6,
          count: 1,
        });
    }
    const { player: t, state: n } = this.d;
    this.chillT -= e;
    this.stunT -= e;
    this.selfBurn.t -= e;
    for (const t of this.selfPoison) t.t -= e;
    this.selfPoison = this.selfPoison.filter((e) => e.t > 0);
    const r = this.selfBurn.t > 0;
    const i = this.selfPoison.length > 0;
    if (this.ko || this.d.safe(t.pos) || (!r && !i)) {
      if (this.d.safe(t.pos)) {
        this.selfBurn.t = 0;
        this.selfPoison.length = 0;
      }
      this.selfTick = 0.5;
      return;
    }
    const a = tmpA.set(t.pos.x, t.pos.y + 1, t.pos.z);
    if (r && Math.random() < e * 16)
      this.d.sparks.emit({
        pos: a,
        vel: tmpB.set(0, 2.2, 0),
        spread: 0.7,
        color: Math.random() < 0.5 ? 16742954 : 16760906,
        intensity: 3,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.5,
        gravity: -2,
        count: 1,
      });
    if (i && Math.random() < e * 9)
      this.d.dust.emit({
        pos: a,
        vel: tmpB.set(0, 0.8, 0),
        spread: 0.5,
        color: 8118415,
        size: 0.16,
        sizeEnd: 0.4,
        alpha: 0.75,
        life: 0.8,
        drag: 1,
        count: 1,
      });
    this.selfTick -= e;
    if (this.selfTick > 0) return;
    this.selfTick = 0.5;
    if (cheats.god) return; // MINEAR cheat: unlimited HP
    const o = (r ? this.selfBurn.dps * 0.5 : 0) + this.selfPoison.reduce((e, t) => e + t.dps, 0) * 0.5;
    const s = Math.max(1, Math.round(o * (1 - n.armor)));
    this.hp = this.floor > 0 ? Math.max(Math.min(this.hp, this.floor), this.hp - s) : this.hp - s;
    this.regenWait = 6;
    this.d.ui.floater(new THREE.Vector3(t.pos.x, t.pos.y + 2.2, t.pos.z), `-${s}`, r ? `#ff9a4a` : `#7be08f`);
    if (this.hp <= 0) this.knockOut();
  }

  /** Burn / poison / chill on the player. t = [burn, poison, chill] shares of e. */
  afflict(e: number, t: ElementTriple) {
    if (this.ko || this.d.safe(this.d.player.pos)) return;
    const n = this.d.state;
    const r = 1 - Math.min(0.9, n.stat(`resfire`) / 100);
    const i = 1 - Math.min(0.9, n.stat(`respoison`) / 100);
    if (t[0] > 0) {
      this.selfBurn.dps = Math.max(this.selfBurn.t > 0 ? this.selfBurn.dps : 0, e * t[0] * r);
      this.selfBurn.t = 3;
    }
    if (t[1] > 0) {
      this.selfPoison.push({ dps: e * t[1] * i, t: 5 });
      if (this.selfPoison.length > 3) this.selfPoison.shift();
    }
    if (t[2] > 0) {
      this.chillK = Math.max(this.chillT > 0 ? this.chillK : 0, Math.min(0.6, t[2]));
      this.chillT = 1.6;
    }
  }

  get afflicted() {
    return { burn: this.selfBurn.t > 0, poison: this.selfPoison.length > 0 };
  }

  /** Standing in lava (kind `lava`) or a toxic pool; k = 1 - resistance. */
  scald(e: string, t: number, n: number) {
    if (this.ko || n <= 0 || this.d.safe(this.d.player.pos)) return;
    const r = this.maxHp;
    if (e === `lava`) {
      this.selfBurn.dps = Math.max(this.selfBurn.t > 0 ? this.selfBurn.dps : 0, (20 + r * 0.14) * n);
      this.selfBurn.t = Math.max(this.selfBurn.t, 1.6);
      this.regenWait = 6;
      return;
    }
    this.toxicT -= t;
    if (!(this.toxicT > 0)) {
      this.toxicT = 1.5;
      this.selfPoison.push({ dps: (1 + r * 0.01) * n, t: 5 });
      if (this.selfPoison.length > 3) this.selfPoison.shift();
    }
  }

  /** Stun for e seconds. */
  daze(e: number) {
    if (!this.ko) this.stunT = Math.max(this.stunT, e);
  }

  get slowFactor() {
    return (this.chillT > 0 ? 1 - this.chillK : 1) * (this.stunT > 0 ? 0.55 : 1);
  }

  /** Holding the drill button (not aiming, not stunned) guards: frontal shots are deflected. */
  get guarding() {
    const e = this.d.player;
    return !this.ko && !e.lifting && !this.aiming && this.stunT <= 0 && this.lmbHeld;
  }

  facing(e: THREE.Vector3) {
    const t = this.d.player;
    const n = e.x - t.pos.x;
    const r = e.z - t.pos.z;
    const i = Math.hypot(n, r);
    return i < 0.3 || (n * Math.sin(t.yaw) + r * Math.cos(t.yaw)) / i > 0.45;
  }

  /** A remote miner's rivet hits a guarding player: send it back at 125% damage (64816). */
  deflectRivet(e: THREE.Vector3, t: THREE.Vector3 | null | undefined, n: number) {
    if (!this.guarding || !this.facing(e)) return false;
    const r = this.d.player.pos;
    const i = new THREE.Vector3(r.x, r.y + 1.2, r.z);
    const a = (t ? new THREE.Vector3(t.x, t.y + 1, t.z) : e.clone()).sub(i);
    if (a.lengthSq() < 0.01) a.set(Math.sin(this.d.player.yaw), 0, Math.cos(this.d.player.yaw));
    a.normalize();
    i.addScaledVector(a, 0.7);
    a.multiplyScalar(SHOTS.rivet.speed);
    this.spawnShot(`rivet`, i, a, Math.round(n * 1.25), true, 0, 1.2);
    this.d.fx?.([`shot`, [netRound(i.x), netRound(i.y), netRound(i.z)], [netRound(a.x), netRound(a.y), netRound(a.z)]]);
    this.deflectShow(i, a, true);
    return true;
  }

  deflectShow(e: THREE.Vector3, t: THREE.Vector3, n: boolean) {
    this.d.sparks.emit({
      pos: e,
      vel: tmpB.copy(t).setLength(3),
      spread: 5,
      color: 16773312,
      intensity: 4,
      size: 0.14,
      sizeEnd: 0.02,
      life: 0.35,
      gravity: 8,
      count: 16,
    });
    this.d.sparks.emit({
      pos: e,
      color: 16774882,
      intensity: 3.5,
      size: 0.75,
      sizeEnd: 0.25,
      life: 0.08,
      count: 1,
    });
    this.d.rings?.pulse(e, tmpC.copy(t), {
      r0: 0.1,
      r1: 1,
      life: 0.3,
      color: 16773312,
      alpha: 0.65,
      thick: 0.35,
    });
    this.d.audio.deflect(clamp(1.2 - e.distanceTo(this.d.player.pos) / 40, 0.15, 1));
    if (n) {
      this.d.ui.floater(e.clone().setY(e.y + 1.1), `DEFLECTED!`, `#ffe08a`);
      this.d.cam.addShake(0.16);
      this.d.hitstop(0.05);
      this.d.fx?.([`deflect`, [netRound(e.x), netRound(e.y), netRound(e.z)], [netRound(t.x), netRound(t.y), netRound(t.z)]]);
    }
  }

  /** Blast stat splash around a hit (64869). */
  blast(e: THREE.Vector3, t: number, n: FoeView | null, r?: MinerId) {
    const i = this.d.state.stat(`blast`) / 100;
    if (i <= 0) return;
    const a = 2.4;
    for (const r of this.foes.foes as FoeView[]) {
      if (r === n || r.state === `dead`) continue;
      const o = r.center(tmpA);
      const s = o.distanceTo(e);
      if (s > a) continue;
      const c = Math.round(t * i * (1 - (s / a) * 0.5));
      tmpB.subVectors(o, e).setY(0).normalize();
      this.foes.damage(r, c, tmpB, 3);
      this.d.ui.floater(o.clone().setY(o.y + 1.2), String(c), `#ffb45a`);
    }
    if (!this.d.safe(this.d.player.pos))
      for (const n of this.d.miners?.inCone(e, UP, a, -1) ?? []) {
        if (n.id === r) continue;
        const o = Math.round(t * i * (1 - Math.min(1, n.t / a) * 0.5));
        this.d.pvp?.(n.id, o, e, 3, `rivet`);
        this.d.ui.floater(n.point.clone().setY(n.point.y + 1.2), String(o), `#ffb45a`);
      }
    this.worm?.blast(e, a, t * i);
    this.d.sparks.emit({
      pos: e,
      spread: 7,
      color: 16757850,
      intensity: 3.6,
      size: 0.22,
      sizeEnd: 0.03,
      life: 0.45,
      gravity: 4,
      count: 26,
      drag: 2,
    });
    this.d.sparks.emit({
      pos: e,
      spread: 1.5,
      color: 16773312,
      intensity: 5,
      size: 0.6,
      sizeEnd: 0.1,
      life: 0.15,
      count: 4,
    });
    this.d.dust.emit({
      pos: e,
      spread: 1.6,
      color: 6969930,
      size: 0.8,
      sizeEnd: 2.2,
      alpha: 0.45,
      life: 0.8,
      drag: 2.5,
      count: 5,
    });
    this.d.audio.blast();
  }

  /** Move every projectile, test hits, bounce, land (64926). */
  updateShots(e: number) {
    const { world: t, player: n } = this.d;
    for (let r = this.shots.length - 1; r >= 0; r--) {
      const i = this.shots[r];
      const a = SHOTS[i.kind];
      const o = tmpA.copy(i.pos);
      if (i.kind === `orb`) {
        const t =
          i.mark === this.d.me?.() ? (this.ko ? null : n.pos) : i.mark ? (this.d.minerAt?.(i.mark) ?? null) : null;
        if (t) {
          tmpB.set(t.x, t.y + 1, t.z).sub(i.pos).normalize().multiplyScalar(a.speed);
          i.vel.lerp(tmpB, Math.min(1, e * 0.9)).setLength(a.speed);
        }
      }
      i.vel.y -= i.grav * e;
      i.pos.addScaledVector(i.vel, e);
      i.life -= e;
      const s = i.grace > 0;
      i.grace -= i.vel.length() * e;
      i.mesh.position.copy(i.pos);
      if (i.kind === `orb`) i.mesh.scale.setScalar(1 + Math.sin(i.life * 18) * 0.12);
      else if (i.kind === `rock`) {
        i.mesh.rotateX(e * 4.2);
        i.mesh.rotateZ(e * 2.7);
      } else i.mesh.quaternion.setFromUnitVectors(UP, tmpB.copy(i.vel).normalize());
      if (i.kind === `rock`) {
        if (Math.random() < e * 30)
          this.d.dust.emit({
            pos: i.pos,
            vel: tmpB.set(0, 0, 0),
            spread: 0.4,
            color: a.trail,
            size: 0.3,
            sizeEnd: 0.8,
            alpha: 0.35,
            life: 0.5,
            drag: 1,
            count: 1,
          });
      } else
        this.d.sparks.emit({
          pos: i.pos,
          vel: tmpB.copy(i.vel).multiplyScalar(-0.05),
          spread: i.kind === `orb` ? 0.6 : 0.25,
          color: i.el ? ELEMENT_TRAILS[dominantElement(i.el)] : a.trail,
          intensity: 2.2,
          size: i.kind === `orb` ? 0.22 : 0.09,
          sizeEnd: 0.01,
          life: i.kind === `orb` ? 0.4 : 0.18,
          count: 1,
        });
      let c = i.life <= 0;
      if (!c && i.mine) {
        const e = this.foes.sweep(o, i.pos, i.pad) as FoeView | null;
        const t = !e && this.worm ? this.worm.sweep(o, i.pos, i.pad + 0.02) : null;
        const n = !e && !t ? (this.d.miners?.sweep(o, i.pos, i.pad) ?? null) : null;
        if (n) {
          const e = Math.random() < 0.08 + this.d.state.crit;
          const t = Math.round(i.dmg * (0.9 + Math.random() * 0.2) * (e ? 1.5 : 1));
          this.d.pvp?.(n.id, t, o, i.knock, `rivet`, i.el ? [i.el.burn, i.el.poison, i.el.chill] : undefined);
          this.d.dealt?.();
          tmpB.copy(i.vel).setY(0).normalize();
          this.impact(n.point, tmpB, false);
          this.d.ui.floater(n.point.clone().setY(n.point.y + 1.1), e ? `${t}!` : String(t), e ? `#ffd23c` : `#ffe0b0`);
          this.d.audio.hit(false);
          this.d.ui.hitMarker();
          this.blast(n.point, t, null, n.id);
          c = true;
        } else if (e) {
          tmpB.copy(i.vel).setY(0).normalize();
          const t = Math.random() < 0.08 + this.d.state.crit;
          const n = Math.round(i.dmg * (0.9 + Math.random() * 0.2) * (t ? 1.5 : 1));
          this.foes.damage(e, n, tmpB, i.knock, i.el?.chill ?? 0);
          this.d.dealt?.();
          if (i.el) this.afflictFoe(e, n, i.el);
          const r = e.center(new THREE.Vector3());
          this.impact(i.pos.clone(), tmpB, false);
          this.d.ui.floater(r.setY(r.y + 1.1), t ? `${n}!` : String(n), t ? `#ffd23c` : `#ffe0b0`);
          this.d.audio.hit(false);
          this.d.ui.hitMarker();
          this.blast(i.pos, n, e);
          c = true;
        } else if (t) {
          const e = Math.random() < 0.08 + this.d.state.crit;
          const n = Math.round(i.dmg * (0.9 + Math.random() * 0.2) * (e ? 1.5 : 1));
          this.worm!.damage(n, t.point, t.weak, e);
          this.d.dealt?.();
          tmpB.copy(i.vel).normalize();
          this.impact(t.point, tmpB, false);
          this.d.ui.hitMarker();
          this.blast(t.point, n, null);
          c = true;
        }
      } else if (!c && !i.ghost && !this.ko) {
        const e = i.kind === `rock` ? ROCK_HIT_RADIUS : i.kind === `orb` ? 0.62 : 0.45;
        if (i.kind !== `rock` && this.sweepPlayer(o, i.pos, e) && this.guarding && this.facing(o)) {
          i.vel.set(-i.vel.x, Math.abs(i.vel.y) * 0.2 + 1, -i.vel.z);
          if (i.kind === `orb`) i.vel.setLength(SHOTS.orb.speed * 1.8);
          i.pos.copy(o);
          const e = (this.foes.inCone(o, tmpB.copy(i.vel).normalize(), 32, 0.6) as FoeView[])[0];
          if (e) {
            const t = i.vel.length();
            const n = e.center(tmpB).sub(o);
            i.vel.copy(n).setLength(t);
            i.vel.y += i.grav * (n.length() / t) * 0.5;
          }
          i.mine = true;
          i.mark = null;
          i.life = SHOTS[i.kind].life;
          i.dmg = Math.round(i.dmg * 1.5 + this.d.state.rangedDamage);
          i.pad = 0.14;
          i.knock = 3;
          this.deflectShow(o.clone(), i.vel, true);
          continue;
        }
        if (this.sweepPlayer(o, i.pos, e)) {
          if (this.hurt(i.dmg, o, i.kind === `rock` ? 9 : i.kind === `orb` ? 5 : 3) && i.el && !i.mine)
            this.afflict(i.dmg, [i.el.burn, i.el.poison, i.el.chill]);
          if (i.kind === `rock`) this.rockLands(i, i.pos, true);
          else
            this.d.sparks.emit({
              pos: i.pos,
              spread: 3,
              color: a.trail,
              intensity: 3,
              size: 0.14,
              sizeEnd: 0.02,
              life: 0.35,
              gravity: 6,
              count: 10,
            });
          c = true;
        }
      }
      if (!c && !s && i.bounces > 0 && t.sample(i.pos.x, i.pos.y, i.pos.z) > 128) {
        const e = 0.6;
        const n = tmpB.set(
          t.sample(i.pos.x - e, i.pos.y, i.pos.z) - t.sample(i.pos.x + e, i.pos.y, i.pos.z),
          t.sample(i.pos.x, i.pos.y - e, i.pos.z) - t.sample(i.pos.x, i.pos.y + e, i.pos.z),
          t.sample(i.pos.x, i.pos.y, i.pos.z - e) - t.sample(i.pos.x, i.pos.y, i.pos.z + e),
        );
        if (n.lengthSq() > 1e-6) {
          n.normalize();
          i.vel.reflect(n).multiplyScalar(0.85);
          i.pos.copy(o).addScaledVector(n, 0.15);
          i.bounces--;
          i.life = Math.max(i.life, 0.6);
          this.d.sparks.emit({
            pos: i.pos,
            vel: n.clone().multiplyScalar(3),
            spread: 3,
            color: 16765578,
            intensity: 3,
            size: 0.1,
            sizeEnd: 0.02,
            life: 0.25,
            gravity: 10,
            count: 6,
          });
          this.d.audio.ping();
          continue;
        }
      }
      if (!c && !s && i.kind === `rock` && t.sample(i.pos.x, i.pos.y, i.pos.z) > 128) {
        this.rockLands(i, i.pos, false);
        c = true;
      }
      if (!c && !s && t.sample(i.pos.x, i.pos.y, i.pos.z) > 128) {
        if (i.mine) this.blast(i.pos, i.dmg, null);
        tmpB.copy(i.vel).normalize().multiplyScalar(-3);
        this.d.sparks.emit({
          pos: i.pos,
          vel: tmpB,
          spread: 4,
          color: a.trail,
          intensity: 2.6,
          size: 0.1,
          sizeEnd: 0.02,
          life: 0.3,
          gravity: 12,
          count: 7,
        });
        this.d.dust.emit({
          pos: i.pos,
          spread: 0.5,
          color: 11577496,
          size: 0.3,
          sizeEnd: 0.9,
          alpha: 0.45,
          life: 0.5,
          count: 1,
        });
        if (i.mine && i.pos.distanceTo(n.pos) < 30) this.d.audio.ping();
        c = true;
      }
      if (c) {
        i.mesh.visible = false;
        i.mesh.removeFromParent();
        if (i.kind !== `rock`) i.mesh.material = this.mat[i.kind];
        i.mesh.scale.setScalar(1);
        this.tele.drop(i.decal);
        this.pool[i.kind].push(i.mesh);
        this.shots.splice(r, 1);
      }
    }
  }

  /** Segment a-b against the player's vertical capsule (0.35..1.45 m above the feet), radius r. */
  sweepPlayer(e: THREE.Vector3, t: THREE.Vector3, n: number) {
    const r = this.d.player.pos;
    const i = Math.max(2, Math.ceil(e.distanceTo(t) / 0.2));
    for (let a = 0; a <= i; a++) {
      const o = a / i;
      const s = e.x + (t.x - e.x) * o;
      const c = e.y + (t.y - e.y) * o;
      const l = e.z + (t.z - e.z) * o;
      const u = clamp(c, r.y + 0.35, r.y + 1.45);
      const d = s - r.x;
      const f = c - u;
      const p = l - r.z;
      if (d * d + f * f + p * p < n * n) return true;
    }
    return false;
  }

  /** Foe look auras (cinder embers, drowned drips, rime frost, dust, wraith wisps) (65174). */
  aura(e: FoeView, t: number) {
    if (e.state === `dead` && e.def.look !== `wraith`) return;
    const n = e.pos.distanceTo(this.d.player.pos);
    if (n > 40 || Math.random() > t * (n < 15 ? 14 : 6)) return;
    const r = e.center(tmpA);
    const i = e.height;
    switch (e.def.look) {
      case `cinder`:
        this.d.sparks.emit({
          pos: tmpB.set(
            r.x + (Math.random() - 0.5) * 0.6,
            r.y + (Math.random() - 0.3) * i * 0.6,
            r.z + (Math.random() - 0.5) * 0.6,
          ),
          vel: tmpC.set(0, 1.6, 0),
          spread: 0.5,
          color: Math.random() < 0.6 ? 16738842 : 16757575,
          intensity: 3,
          size: 0.07,
          sizeEnd: 0.02,
          life: 0.9,
          gravity: -1,
          count: 1,
        });
        if (Math.random() < 0.3)
          this.d.dust.emit({
            pos: tmpB.set(r.x, r.y + i * 0.4, r.z),
            vel: tmpC.set(0, 1, 0),
            spread: 0.3,
            color: 3813420,
            size: 0.35,
            sizeEnd: 1.2,
            alpha: 0.35,
            life: 1.4,
            gravity: -0.4,
            drag: 0.8,
            count: 1,
          });
        break;
      case `drowned`:
        this.d.dust.emit({
          pos: tmpB.set(
            r.x + (Math.random() - 0.5) * 0.7,
            r.y + (Math.random() - 0.3) * i * 0.5,
            r.z + (Math.random() - 0.5) * 0.7,
          ),
          vel: tmpC.set(0, -1.2, 0),
          spread: 0.1,
          color: 8364106,
          size: 0.09,
          alpha: 0.8,
          life: 0.7,
          gravity: 6,
          count: 1,
        });
        break;
      case `rime`:
        this.d.dust.emit({
          pos: tmpB.set(r.x + (Math.random() - 0.5) * 0.8, e.pos.y + 0.3, r.z + (Math.random() - 0.5) * 0.8),
          vel: tmpC.set(0, 0.2, 0),
          spread: 0.4,
          color: 15267071,
          size: 0.4,
          sizeEnd: 1.2,
          alpha: 0.3,
          life: 1.2,
          drag: 1.2,
          count: 1,
        });
        if (Math.random() < 0.4)
          this.d.sparks.emit({
            pos: tmpB.set(r.x, r.y, r.z),
            spread: 0.6,
            color: 13168895,
            intensity: 2.4,
            size: 0.04,
            life: 0.6,
            count: 1,
          });
        break;
      case `dust`:
        if (e.state !== `dig` && Math.random() > 0.35) break;
        this.d.dust.emit({
          pos: tmpB.set(
            r.x + (Math.random() - 0.5) * 0.6,
            r.y + (Math.random() - 0.2) * i * 0.5,
            r.z + (Math.random() - 0.5) * 0.6,
          ),
          vel: tmpC.set(0, -0.5, 0),
          spread: 0.3,
          color: Math.random() < 0.5 ? 5915440 : 8020552,
          size: 0.07,
          alpha: 0.9,
          life: 0.8,
          gravity: 9,
          count: 1,
        });
        break;
      case `wraith`:
        if (e.ghostSeen < 0.05 && e.state !== `dead`) break;
        this.d.sparks.emit({
          pos: tmpB.set(
            r.x + (Math.random() - 0.5) * 0.5,
            r.y + (Math.random() - 0.5) * i * 0.5,
            r.z + (Math.random() - 0.5) * 0.5,
          ),
          vel: tmpC.set(0, 0.4, 0),
          spread: 0.3,
          color: Math.random() < 0.6 ? 11111167 : 8060896,
          intensity: 2.2 * Math.max(0.2, e.ghostSeen),
          size: 0.1,
          sizeEnd: 0.02,
          life: 1.1,
          drag: 0.8,
          count: 1,
        });
    }
  }

  /** A foe died: burst explosion, death dust and, when I killed it, the loot (65296). */
  foeDied(e: FoeView, t: boolean) {
    const { audio: n, pickups: r, gems: i } = this.d;
    if (e.def.burst) {
      const t = e.center(new THREE.Vector3());
      this.d.sparks.emit({
        pos: t,
        vel: tmpB.set(0, 4, 0),
        spread: 6,
        color: 16742954,
        intensity: 3.6,
        size: 0.2,
        sizeEnd: 0.04,
        life: 0.8,
        gravity: 4,
        count: 46,
        drag: 1.2,
      });
      this.d.sparks.emit({
        pos: t,
        spread: 1.4,
        color: 16765066,
        intensity: 5,
        size: 0.8,
        sizeEnd: 0.1,
        life: 0.2,
        count: 5,
      });
      this.d.dust.emit({
        pos: t,
        vel: tmpB.set(0, 1.6, 0),
        spread: 1.8,
        color: 3812392,
        size: 1,
        sizeEnd: 3,
        alpha: 0.5,
        life: 1.8,
        gravity: -0.4,
        drag: 1,
        count: 10,
      });
      n.bombBoom(t.distanceTo(this.d.player.pos) * 1.6);
      const r = this.d.player.pos;
      const i = Math.hypot(r.x - t.x, r.y + 0.9 - t.y, r.z - t.z);
      if (i < 3.2 && !this.ko) {
        const n = Math.round(e.def.burst * (1 - i / 4.5) * (1 + Math.max(0, surfaceHeight(t.x, t.z) - t.y) / 110));
        if (this.hurt(n, t, 7)) this.afflict(n, [0.5, 0, 0]);
      }
    }
    n.shatter(clamp(1.3 - e.pos.distanceTo(this.d.player.pos) / 40, 0.15, 1));
    const a = e.center(new THREE.Vector3());
    const o = !!e.def.surface;
    for (let e = 0; e < 2; e++)
      this.d.dust.emit({
        pos: a,
        vel: tmpB.set(0, 1.5, 0),
        spread: o ? 5 : 2.8,
        color: o ? (e ? 12103070 : 7315270) : e ? 15261903 : 6971260,
        size: o ? 1.1 : 0.45,
        sizeEnd: o ? 3.2 : 1.6,
        alpha: 0.65,
        life: o ? 1.8 : 1.1,
        drag: 2.5,
        count: o ? 24 : 10,
      });
    this.d.sparks.emit({
      pos: a,
      vel: tmpB.set(0, 4, 0),
      spread: 3.5,
      color: 5898188,
      intensity: 2.6,
      size: 0.14,
      sizeEnd: 0.02,
      life: 0.9,
      gravity: -2,
      count: o ? 50 : 22,
    });
    if (o) this.d.golemDown(e, t);
    if (!t) return;
    if (this.floor > 0) return this.d.defeated(e);
    let s = 0;
    // surface golems count as depth 160
    const c = o ? 160 : surfaceHeight(e.pos.x, e.pos.z) - e.pos.y;
    const l = 1 + Math.min(1.5, c / 90);
    for (const [t, n] of e.def.ore) {
      const e = Math.max(1, Math.round(n * l * (0.6 + Math.random() * 0.8)));
      for (let n = 0; n < e; n++) r?.spawnOre(t, a, s++ * 0.05);
    }
    if (Math.random() < e.def.gem) {
      const t = e.def.biome && Math.random() < 0.6 ? BIOME_GEM[e.def.biome as BiomeId] : pickGemByDepth(c);
      if (r && i) r.spawnGem(t, i.makeMesh(t), a.clone());
    }
    if (Math.random() < 0.04 + c / 3e3 && r && i) r.spawnGem(`die`, i.makeMesh(`die`), a.clone());
    if (Math.random() < e.def.gear) this.d.lootGear?.(c, a);
    if (e.champion) {
      const t = pickGemByDepth(c + 80);
      if (r && i) r.spawnGem(t, i.makeMesh(t), a.clone());
      if (Math.random() < 0.6) this.d.lootGear?.(c + 40, a);
      for (let t = 0; t < 12; t++) r?.spawnOre(e.def.ore[0]?.[0] ?? `gold`, a, s++ * 0.05);
      if (Math.random() < 0.03 && r && this.d.pickupMesh) r.spawnGem(`deaddust`, this.d.pickupMesh(`deaddust`), a.clone());
    }
    const pm = this.d.pickupMesh;
    if (e.kind === `miner` && Math.random() < 0.1 && r && this.d.bombMesh) r.spawnGem(`bomb`, this.d.bombMesh(), a.clone());
    if (Math.random() < 0.05 && r && pm) r.spawnGem(`tonic`, pm(`tonic`), a.clone());
    if (Math.random() < 0.03 && r && pm) r.spawnGem(`strength`, pm(`strength`), a.clone());
    if (Math.random() < 0.025 && r && pm) r.spawnGem(`cookie`, pm(`cookie`), a.clone());
    if (Math.random() < 0.025 && r && pm) r.spawnGem(`ultjuice`, pm(`ultjuice`), a.clone());
    this.d.defeated(e);
  }

  /** Per frame (65409): i-frames, dodge, afflictions, KO and respawn, regen, heal, leech, aim and fire, grind
   *  floaters, shots and telegraphs. */
  update(e: number, t: CombatInput) {
    const { player: n, state: r } = this.d;
    const i = this.d.safe(n.pos);
    this.frameNo++;
    this.iframes -= e;
    this.dodgeCd -= e;
    if (t.controlling && t.dodge) this.dodge(t.burrow, t.fwd, t.str);
    this.lmbHeld = t.controlling && t.lmb;
    this.updateAfflictions(e);
    this.shootCd -= e;
    this.havenHintT -= e;
    this.hurtV = Math.max(0, this.hurtV - e * 1.6);
    if (this.ko) {
      this.koT += e;
      if (this.koT > 2.6) {
        this.ko = false;
        this.hp = this.maxHp;
        this.iframes = 2;
        this.d.model.revive();
        this.d.respawn();
      }
    } else {
      this.regenWait -= e;
      if (i) {
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5 * e);
        r.windUsed = false;
      } else if (this.regenWait <= 0)
        this.hp = Math.min(this.maxHp, this.hp + (this.maxHp * 0.035 + r.stat(`regen`)) * e);
      if (this.healLeft > 0) {
        const t = Math.min(this.healLeft, this.healRate * e);
        this.hp += t;
        this.healLeft -= t;
        if (this.healLeft <= 0) this.healRate = 0;
      }
      this.hp = Math.min(this.hp, this.maxHp);
      this.leechT -= e;
      if (this.leechShow >= 1 && this.leechT <= 0) {
        this.leechT = 0.35;
        this.d.ui.floater(tmpA.set(n.pos.x + 0.4, n.pos.y + 2.4, n.pos.z), `+${Math.round(this.leechShow)}`, `#7be08f`);
        this.leechShow = 0;
      }
    }
    const a = t.controlling && !this.ko && !n.lifting && this.stunT <= 0;
    this.aiming = a && t.rmb && !i;
    if (a && t.rmb && i && this.havenHintT <= 0) {
      this.havenHintT = 4;
      this.d.ui.floater(tmpA.copy(n.pos).setY(n.pos.y + 2.3), `No fighting in the haven`, `#8ff0ff`);
    }
    if (this.aiming) {
      n.yaw = this.d.cam.yaw;
      if (this.shootCd <= 0) {
        this.shootCd = r.fireRate;
        this.fire(t.burrow);
      }
    }
    this.grindShow -= e;
    this.grindGap -= e;
    if (!t.lmb) this.grindFoe = null;
    if (this.grindSum > 0 && (this.grindShow <= 0 || !t.lmb)) {
      const e = this.grindFoe;
      const t = e
        ? e.center(new THREE.Vector3()).setY(e.pos.y + e.height + 0.2)
        : this.grindAt.clone().setY(this.grindAt.y + 1.1);
      const n = Math.round(this.grindSum);
      this.d.ui.floater(t, this.grindCrit ? `${n}!` : String(n), this.grindCrit ? `#ffd23c` : `#fff0c8`);
      this.grindSum = 0;
      this.grindCrit = false;
      this.grindShow = 0.4;
    }
    this.updateShots(e);
    this.tele.update(e);
  }

  /** Foe views and health bars (65495). KR sets foes.eye to the player head before this. */
  updateFoes(e: number) {
    this.foes.update(e, performance.now());
    const t: FoeBar[] = [];
    for (const e of this.foes.foes as FoeView[])
      if (!(e.state === `dead` || e.sinceHit > 5 || e.hp >= e.maxHp))
        t.push({
          pos: e.center(new THREE.Vector3()).setY(e.pos.y + e.height + 0.05),
          frac: e.hp / e.maxHp,
          name: e.name,
        });
    this.d.cam.camera.updateMatrixWorld();
    this.d.ui.foeBars(t, this.d.cam.camera);
  }

  /** HUD hurt vignette: the hit flash, or a pulse below 30% HP. */
  get hurtLevel() {
    const e = this.hp / this.maxHp < 0.3 && !this.ko ? 0.35 + Math.sin(performance.now() / 180) * 0.15 : 0;
    return Math.max(this.hurtV, e);
  }

  /** HUD knock-out fade: in 0.6-1.8 s, out 2.35-2.6 s. */
  get koLevel() {
    return this.ko ? clamp((this.koT - 0.6) / 1.2, 0, 1) - clamp((this.koT - 2.35) / 0.25, 0, 1) : 0;
  }
}
