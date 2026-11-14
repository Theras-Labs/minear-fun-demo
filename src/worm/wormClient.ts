// Port of the worm wiring of the game class KR (play-inUT-NSi.js 70056-75530): makeWorm (72320), the worm
// cases of onSim (72424-72479), the grin branch of hurtBy (72829-72853), flushWormDmg (72855), updateWorm
// (72868), grinSlain (72934), the worm part of simReset (72387) and warmUp (70977), and the worm part of the
// drill target (updateDrill 73651-73652). Fields wormHurtT, wormDmg, telegraphT and dread are KR fields
// (70203-70206). The game supplies the hooks below (ui, audio, camera shake, hitstop, damage to the player
// through combat.hurt, the hit route to the simulation, the rewards).
import * as THREE from 'three';
import { MATERIALS } from '../world/materials';
import { surfaceHeight } from '../world/generate';
import { pickGemByDepth } from '../world/gemSpawn';
import type { Particles } from '../fx/particles';
import type { DreadPass } from '../post/dreadPass';
import type { Combat, CombatGems, CombatPickups, WormTarget } from '../combat/combat';
import { WormView, type WormHit } from './wormView';
import type { WormAsset } from './wormAssets';
import type { WormMsg } from './wormHost';
import { TRIP_GIVES_COINS, TRIP_GIVES_GEAR } from '../base/run';

// KR shared temps (70040-70052)
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR

/** Audio manager dM methods the worm uses (57088-57260, 56529). k = 0..1 loudness by distance. */
export interface WormAudio {
  grinBreach(k?: number): void;
  grinHurt(weak: boolean): void;
  grinGiggle(k?: number): void;
  grinWindup(k?: number): void;
  grinLunge(k?: number): void;
  grinScreech(k?: number, die?: boolean): void;
  grinBite(): void;
  /** The grin drone and heartbeat from dread (0..1); dt is the raw frame time. */
  setGrin(dread: number, dt: number): void;
  /** 0..1, 1 on each beat, decays 3.2/s (dM 57087). */
  readonly heartbeat: number;
  gem(n: number): void;
}

/** HUD controller EM methods the worm uses. floater must copy pos. */
export interface WormUi {
  banner(title: string, sub: string, color: string): void;
  floater(pos: THREE.Vector3, text: string, color: string): void;
  flash(k: number): void;
  /** Boss HP bar: fraction 0..1, or -1 to hide. */
  bossBarSet(frac: number): void;
  itemToast?(item: unknown): void;
}

/** Player state Fj parts read and written when my worm kill pays out (not in PlayerStats yet). */
export interface WormStats {
  grinSlain: number;
  readonly fortuneNow: number;
  earn(coins: number): void;
  addItem(item: unknown): boolean;
  save(): void;
}

/** Gear weights by rarity for a worm kill: rj(sj(GRIN_GEAR_WEIGHTS, hk(fortuneNow)), depth) (73000). */
export const GRIN_GEAR_WEIGHTS: readonly number[] = [0, 0, 0, 60, 40];

/** The KR parts the worm wiring reads. */
export interface WormClientHost {
  scene: THREE.Scene;
  world: { sample(x: number, y: number, z: number): number; materialAt(x: number, y: number, z: number): number };
  player: { pos: THREE.Vector3 };
  cam: { addShake(k: number): void };
  sparks: Particles;
  dust: Particles;
  debris: { burst(at: THREE.Vector3, color: number | THREE.Color, count: number, dir?: THREE.Vector3, speed?: number): void };
  combat: Pick<Combat, `worm` | `hp` | `ko` | `hurt`>;
  audio: WormAudio;
  ui: WormUi;
  /** post.dread (dreadPass Fp, 70282). */
  dreadPass: DreadPass;
  headlamp: THREE.Light;
  /** KR: hitstop = max(hitstop, t). */
  hitstop(t: number): void;
  /** mp.id */
  me(): string;
  /** mp.nameOf(id) */
  nameOf(id: string): string;
  /** mp.hitWorm(dmg, weak); solo: wormHost.hitWorm(me, dmg, weak). */
  hitWorm(dmg: number, weak: boolean): void;
  /** goals.event(name): `grin` (it left), `grinSlain`. */
  goal?(name: string): void;
  stats?: WormStats;
  /** wP pickups (not ported yet). */
  pickups?: CombatPickups;
  /** Rb gems (not ported yet). */
  gems?: CombatGems;
  /** VP (62317) pickup mesh (not ported yet). */
  pickupMesh?(id: string): THREE.Object3D;
  /** rj(sj(weights, hk(fortune)), depth): a gear item (gear system, not ported yet). */
  rollGear?(weights: readonly number[], fortune: number, depth: number): unknown;
}

/** The `hurt` message with src `grin` (a bite). */
export type GrinHurt = Extract<WormMsg, { t: `hurt` }>;

export class WormClient {
  host: WormClientHost;
  /** KR.worm: the view, or null when worm.glb did not load. */
  worm: WormView | null = null;
  dread = 0; // 70203
  wormHurtT = 0; // 70204
  wormDmg = { sum: 0, t: 0, at: new THREE.Vector3(), weak: false, crit: false }; // 70205
  telegraphT = 0; // 70206

  /** KR constructor 70549: `a && this.makeWorm(a)`. */
  constructor(host: WormClientHost, asset: WormAsset | null) {
    this.host = host;
    if (asset) this.makeWorm(asset);
  }

  /** True while the worm is up (KR.calm 71289, playSong 74168). */
  get active(): boolean {
    return !!this.worm?.active;
  }

  makeWorm(e: WormAsset): void { // 72320
    const d = this.host;
    const t = new WormView(e, d.world, {
      breach: (e, t, n) => {
        const r = e.distanceTo(d.player.pos);
        const i = THREE.MathUtils.clamp(1 - r / 60, 0.1, 1);
        d.audio.grinBreach(i * (n ? 1 : 0.7));
        if (r < 30) d.cam.addShake((n ? 0.6 : 0.3) * (1 - r / 30));
        const a = MATERIALS[d.world.materialAt(Math.round(e.x), Math.round(e.y), Math.round(e.z))]?.color ?? 9075306;
        d.debris.burst(e.clone(), a, n ? 26 : 14, t.clone(), n ? 9 : 5);
        for (let k = 0; k < 3; k++)
          d.dust.emit({
            pos: e,
            vel: t.clone().multiplyScalar(n ? 5 : 2),
            spread: 3.5,
            color: k ? 6969932 : 10127992,
            size: 1.2,
            sizeEnd: 3.6,
            alpha: 0.55,
            life: 1.6,
            drag: 2,
            count: n ? 10 : 6,
          });
      },
      hurt: (e, t, n, r) => {
        this.wormDmg.sum += t;
        this.wormDmg.at.copy(e);
        this.wormDmg.weak ||= n;
        this.wormDmg.crit ||= r;
        if (this.wormDmg.t <= 0) this.flushWormDmg();
        d.sparks.emit({
          pos: e,
          spread: 4,
          color: n ? 16773336 : 11898111,
          intensity: 3,
          size: 0.13,
          sizeEnd: 0.02,
          life: 0.4,
          gravity: 8,
          count: n ? 12 : 6,
        });
        --this.wormHurtT;
        if (this.wormHurtT <= 0) {
          this.wormHurtT = 3;
          d.audio.grinHurt(n);
        }
      },
      hit: (e, t) => d.hitWorm(e, t),
    });
    this.worm = t;
    d.scene.add(t.group);
    d.combat.worm = t;
  }

  /** The worm cases of KR.onSim (72389). Returns false for messages that are not the worm's. */
  onSim(e: WormMsg): boolean {
    const t = performance.now();
    const d = this.host;
    const r = this.worm;
    const i = d.me();
    switch (e.t) {
      case `worm`:
        r?.seen(e.w, t);
        return true;
      case `wormSpawn`:
        if (e.to === i) d.ui.banner(`SOMETHING STIRS BELOW`, `The rock is shivering. Mine fast or get up top.`, `#ff6b5f`);
        else d.ui.banner(`SOMETHING STIRS BELOW`, `It's hunting ${d.nameOf(e.to)}. The rock is shivering.`, `#ff6b5f`);
        d.cam.addShake(0.35);
        return true;
      case `wormCue`: {
        const p = T0.fromArray(e.p);
        const n = THREE.MathUtils.clamp(1 - p.distanceTo(d.player.pos) / 70, 0.15, 1);
        if (e.k === `giggle`) d.audio.grinGiggle(n);
        else if (e.k === `windup`) d.audio.grinWindup(n);
        else if (e.k === `lunge`) {
          d.audio.grinLunge(n);
          d.cam.addShake(0.4 * n);
        } else if (e.k === `screech`) d.audio.grinScreech(n);
        else if (e.k === `die`) d.audio.grinScreech(1, true);
        return true;
      }
      case `wormHurt`:
        r?.hurtBy(e.by, i);
        return true;
      case `wormLeft`:
        if (!d.combat.ko) {
          d.ui.banner(`IT SINKS AWAY`, `The worm sinks into the deep... for now`, `#c9b8a8`);
          d.goal?.(`grin`);
        }
        return true;
      case `wormDie`:
        this.grinSlain(T0.fromArray(e.p).clone(), e.by.includes(i));
        return true;
      case `wormGone`:
        r?.gone();
        return true;
      case `hurt`:
        // KR.hurtBy (72799) branches on src; only the grin branch is the worm's.
        if ((e as { src?: string }).src !== `grin`) return false;
        this.hurtBy(e);
        return true;
    }
    return false;
  }

  /** The grin branch of KR.hurtBy (72829): a bite, ignored when the head is more than 11.28 away. */
  hurtBy(e: GrinHurt): void {
    const d = this.host;
    const t = T1.fromArray(e.p).clone();
    const n = d.player.pos;
    const r = this.worm;
    if (r?.active && r.pos.distanceTo(T0.set(n.x, n.y + 0.9, n.z)) > 11.2825) return;
    const i = d.combat.hp;
    d.combat.hurt(e.dmg, t, e.knock);
    if (d.combat.hp < i) {
      d.audio.grinBite();
      d.hitstop(0.16);
      d.cam.addShake(0.8);
      d.ui.flash(0.3);
      d.sparks.emit({
        pos: T0.set(n.x, n.y + 1, n.z),
        spread: 4,
        color: 16726564,
        intensity: 3,
        size: 0.16,
        sizeEnd: 0.02,
        life: 0.6,
        gravity: 8,
        count: 30,
      });
    } else if (!d.combat.ko) {
      d.ui.floater(n.clone().setY(n.y + 2.4), `DODGED!`, `#fff1d6`);
      d.hitstop(0.08);
    }
  }

  /** One damage floater per 0.25 s with the summed hits. */
  flushWormDmg(): void { // 72855
    const e = this.wormDmg;
    if (e.sum <= 0) return;
    const t = Math.round(e.sum);
    this.host.ui.floater(e.at.clone().setY(e.at.y + 0.8), e.weak ? `${t}!` : String(t), e.weak ? `#ffd23c` : e.crit ? `#ffe0b0` : `#ffffff`);
    e.sum = 0;
    e.weak = e.crit = false;
    e.t = 0.25;
  }

  /** KR.updateWorm(e, t) (72868): e = raw dt, t = hitstop dt. */
  update(e: number, t: number): void {
    const n = this.worm;
    if (!n) return;
    const d = this.host;
    const r = d.player;
    n.update(t, performance.now(), r.pos);
    this.wormDmg.t -= e;
    if (this.wormDmg.t <= 0 && this.wormDmg.sum > 0) this.flushWormDmg();
    if (n.state === `windup` && n.emergeK > 0.05 && ((this.telegraphT -= e), this.telegraphT <= 0)) {
      this.telegraphT = 0.05;
      const k = n.emergeK;
      d.sparks.emit({
        pos: n.emerge,
        spread: 1.5 + k * 2,
        color: 16726564,
        intensity: 2 + k * 2,
        size: 0.14,
        sizeEnd: 0.02,
        life: 0.5,
        gravity: -2,
        count: 2 + Math.floor(k * 4),
      });
      d.dust.emit({
        pos: n.emerge,
        spread: 1.6,
        color: 9073762,
        size: 0.6,
        sizeEnd: 1.8,
        alpha: 0.35 * k,
        life: 0.9,
        drag: 2,
        count: 1,
      });
      d.dust.emit({
        pos: T0.set(r.pos.x + (Math.random() - 0.5) * 6, r.pos.y + 4, r.pos.z + (Math.random() - 0.5) * 6),
        vel: T1.set(0, -2, 0),
        spread: 0.3,
        color: 12101004,
        size: 0.08,
        alpha: 0.8,
        life: 1.2,
        gravity: 6,
        count: 3,
      });
      d.cam.addShake(0.05 + k * 0.12);
    }
    const i = n.active ? n.threat : 0;
    this.dread += (i - this.dread) * Math.min(1, e * 2);
    d.audio.setGrin(this.dread, e);
    d.dreadPass.enabled = this.dread > 0.02;
    const a = d.dreadPass.uniforms;
    a.uDread.value = this.dread;
    a.uTime.value += e;
    a.uBeat.value = d.audio.heartbeat;
    d.ui.bossBarSet(n.active && !n.dead && (n.threat > 0.3 || n.sinceHit < 10) ? n.hp / n.maxHp : -1);
    // KR sets the headlamp intensity again later in the same frame (71926), so this flicker is overwritten.
    if (this.dread > 0.55 && Math.random() < (this.dread - 0.55) * 0.5) d.headlamp.intensity *= 0.2;
  }

  /** The worm died at e; t = I hit it. Within 80 a banner; my kill pays gems, dice, coins and a gear item. */
  grinSlain(e: THREE.Vector3, t: boolean): void { // 72934
    const d = this.host;
    const n = e.distanceTo(d.player.pos) < 80;
    if (!t) {
      if (n) {
        d.ui.banner(`THE WORM IS SLAIN`, `Someone put it down! It will come back hungrier.`, `#ffd23c`);
        d.cam.addShake(0.4);
        for (let k = 0; k < 3; k++)
          d.sparks.emit({
            pos: e,
            vel: new THREE.Vector3(0, 6, 0),
            spread: 10,
            color: [16765500, 16726564, 16777215][k],
            intensity: 3.6,
            size: 0.28,
            sizeEnd: 0.03,
            life: 1.8,
            gravity: 6,
            count: 40,
            drag: 1,
          });
      }
      return;
    }
    const r = Math.max(40, surfaceHeight(e.x, e.z) - e.y);
    const st = d.stats;
    if (st) st.grinSlain++;
    d.goal?.(`grinSlain`);
    d.ui.banner(`THE WORM IS SLAIN`, `It bursts into gems! (It will come back hungrier.)`, `#ffd23c`);
    d.ui.flash(0.6);
    d.hitstop(0.3);
    d.cam.addShake(0.9);
    const i: [string, number][] = [
      [`emerald`, 30],
      [`sapphire`, 35],
      [`ruby`, 24],
      [`sunstone`, 9.5],
      [`voidheart`, 1.5],
    ];
    const a = (): string => {
      let x = Math.random() * 100;
      for (const [id, w] of i) if ((x -= w) <= 0) return id;
      return `sapphire`;
    };
    const fortune = st?.fortuneNow ?? 0;
    const o = 1 + Math.min(1, fortune / 400);
    const s = Math.round((15 + Math.floor(Math.random() * 7)) * o);
    for (let k = 0; k < s; k++) {
      const id = k < Math.round(5 * o) ? a() : pickGemByDepth(r + 60);
      const mesh = d.gems?.makeMesh(id);
      const at = e.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
      if (mesh) d.pickups?.spawnGem(id, mesh, at);
    }
    for (let k = 0; k < 3; k++) {
      const mesh = d.gems?.makeMesh(`die`);
      if (mesh) d.pickups?.spawnGem(`die`, mesh, e.clone());
    }
    if (Math.random() < 0.12) {
      const mesh = d.pickupMesh?.(`deaddust`);
      if (mesh) d.pickups?.spawnGem(`deaddust`, mesh, e.clone().setY(e.y + 1));
    }
    // MINEAR: a mining trip pays no coins and gives no gear (src/base/run.ts); the gems and dice above stay
    if (TRIP_GIVES_COINS) {
      const c = Math.round((900 + Math.floor(Math.random() * 750)) * o);
      st?.earn(c);
      d.ui.floater(e.clone().setY(e.y + 2), `+${c} coins`, `#ffc23d`);
    }
    const l = TRIP_GIVES_GEAR ? d.rollGear?.(GRIN_GEAR_WEIGHTS, fortune, r) : undefined;
    if (l !== undefined && st?.addItem(l)) d.ui.itemToast?.(l);
    st?.save();
    for (let k = 0; k < 4; k++)
      d.sparks.emit({
        pos: e,
        vel: new THREE.Vector3(0, 6, 0),
        spread: 10,
        color: [16765500, 16726564, 16777215, 12815359][k],
        intensity: 3.6,
        size: 0.28,
        sizeEnd: 0.03,
        life: 1.8,
        gravity: 6,
        count: 50,
        drag: 1,
      });
    d.audio.gem(5);
  }

  /** Worm part of KR.simReset(delay) (72387): hide the view and set the snapshot delay (ms). */
  simReset(e: number): void {
    if (this.worm) {
      this.worm.gone();
      this.worm.delay = e;
    }
  }

  /** Worm part of KR.warmUp (70977): draw once with the worm visible so its programs compile. */
  async warmUp(draw: () => Promise<void>): Promise<void> {
    if (this.worm) {
      this.worm.group.visible = true;
      await draw();
      this.worm.group.visible = false;
    }
  }
}

/**
 * The worm part of the drill target (KR.updateDrill 73651-73652): only when no foe was hit, a worm part along
 * the drill ray within reach + 1.2 of the chest and nearer than the terrain hit.
 */
export function wormDrillHit(
  worm: WormTarget | null,
  foeHit: unknown,
  from: THREE.Vector3,
  dir: THREE.Vector3,
  far: number,
  chest: THREE.Vector3,
  reach: number,
  terrain: THREE.Intersection | null,
): WormHit | null {
  const m = foeHit || !worm ? null : worm.rayHit(from, dir, far);
  return m && m.point.distanceTo(chest) <= reach + 1.2 && (!terrain || m.t < terrain.distance) ? m : null;
}
