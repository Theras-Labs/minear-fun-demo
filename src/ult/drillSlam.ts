// Port of play-inUT-NSi.js 47718-48190: the Drill Slam controller wD (KR.ult). The charge fills from damage dealt
// (dealt); E (or the touch Ult key) arms the aim (key); while aiming, frame() marches the camera ray into the rock
// for a landing point, plans the arc and shows the ring; LMB casts, RMB cancels. During the leap step() drives the
// miner along the arc, with launch dust, the apex flash, trail sparks, then on landing the area damage to foes and
// the worm / bosses, the crater, the scar, hitstop, screen flash and camera kick. It also presses the grass down
// around the aim and the blast, and feeds the rig (slamPose), the dash lines (streak), the vortex (spinning) and
// the camera (fovKick, cam.extra).
import * as THREE from 'three';
import { MATERIALS } from '../world/materials';
import type { Combat, RingPulseOptions } from '../combat/combat';
import type { EmitOptions } from '../fx/particles';
import type { Hud } from '../ui/hud';
import type { Audio } from '../audio/audio';
import type { SlamPose } from '../miner/rig';
import type { SlamFx } from './slamFx';
import {
  SLAM,
  SLAM_TIMES,
  UP,
  S_AD,
  S_DD,
  S_ED,
  S_JD,
  S_KD,
  S_OD,
  evalLeap,
  leapDuration,
  planSlam,
  round2,
  surfaceNormal,
  type LeapPhase,
  type LeapPlan,
  type SlamField,
} from './planner';

const clamp = THREE.MathUtils.clamp; // iD (47189)

/** The replicated action tuple cast() sends (mp.act): [`ult`, x, y, z, h], 2 decimals. */
export type UltAct = [`ult`, number, number, number, number];

/** The rig pose the slam hands to MinerRig.update (st.slam). */
export interface SlamPoseBuf extends SlamPose {
  phase: LeapPhase;
  len: number;
}

/** The deps object d that KR passes to wD (70558-70583). */
export interface DrillSlamHost {
  world: SlamField & {
    groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null;
    materialAt(x: number, y: number, z: number): number;
  };
  /** Fj: ult charge 0..1, ultMul (Juice), meleeDamage, save(). */
  state: { ult: number; readonly ultMul: number; readonly meleeDamage: number; save(): void };
  player: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; thrust: number; onGround: boolean; cancelDodge(): void };
  model: { drillTip(out: THREE.Vector3): THREE.Vector3 };
  cam: { camera: THREE.Camera; dist: number; yaw: number; extra: number; addShake(k: number): void };
  input: { lmb: boolean; rmb: boolean; lmbPressed: boolean };
  combat: Pick<Combat, `ko` | `shield` | `foes` | `worm`>;
  audio: Pick<Audio, `ultArm` | `ultCancel` | `ultReady` | `deny` | `ultLeap` | `ultApex` | `ultDive` | `ultSlam`>;
  ui: Pick<Hud, `ultNudge` | `ultPop` | `flash` | `floater`>;
  sparks: { emit(o: EmitOptions): void };
  dust: { emit(o: EmitOptions): void };
  debris: { burst(at: THREE.Vector3, color: number | THREE.Color, count: number, dir?: THREE.Vector3, speed?: number): void };
  rings: { pulse(pos: THREE.Vector3, normal: THREE.Vector3, opts: RingPulseOptions): void };
  fx: SlamFx;
  /** KR.inHaven(pos). */
  safe(pos: THREE.Vector3): boolean;
  /** KR: hitstop = max(hitstop, t). */
  hitstop(t: number): void;
  /** KR.slamCrater(pos): carves the crater; the ground height under it, or null in the haven. */
  crater(pos: THREE.Vector3): number | null;
  /** gemBursts.flare(pos, hex, intensity). */
  flare(pos: THREE.Vector3, hex: number, intensity: number): void;
  /** mp.act(tuple); solo sends nothing. */
  act(tuple: UltAct): void;
  /** KR: playing && !burrow && !player.lifting && !arc. */
  free(): boolean;
  /** KR: the "Drill Slam charged" tip the first time (ultTipT = 6 until seen.slam). */
  onReady?(): void;
  /** grass.slam(x, y, z, r, k): presses the grass down. */
  grass?(x: number, y: number, z: number, r: number, k: number): void;
}

export class DrillSlam { // wD (47718)
  d: DrillSlamHost;
  aiming = false;
  leap: LeapPlan | null = null;
  clock = 0;
  lastHit = -99;
  target = new THREE.Vector3();
  targetOk = false;
  plan: LeapPlan | null = null;
  lmbLock = false;
  rmbLock = false;
  wasReady = false;
  /** One-shot event bits: 1 launch, 2 apex, 4 dive, 8 land. */
  ev = 0;
  yaw = 0;
  zoom = 0;
  kick = 0;
  pose: SlamPoseBuf | null = null;
  poseBuf: SlamPoseBuf = { phase: `crouch`, k: 0, len: 1, dir: new THREE.Vector3() };
  posePhase: LeapPhase = `done`;
  spinning = false;
  streakDir = new THREE.Vector3();
  streaking = false;
  press = 0;
  blastT = -1;
  blastMine = false;
  craterDue = false;
  blastAt = new THREE.Vector3();

  constructor(e: DrillSlamHost) {
    this.d = e;
    this.wasReady = e.state.ult >= 1;
  }

  get ready(): boolean {
    return this.d.state.ult >= 1;
  }

  /** The leap drives the miner (until `free` s into the land). */
  get owns(): boolean {
    return !!this.leap && this.leap.t < leapDuration(this.leap) + SLAM_TIMES.free;
  }

  get holdsLmb(): boolean {
    return this.aiming || this.lmbLock || this.owns;
  }

  get holdsRmb(): boolean {
    return this.aiming || this.rmbLock || this.owns;
  }

  /** Combat hook (KR 70523): damage dealt charges the slam by the time since the last hit (at most `gap`). */
  dealt(): void {
    const e = Math.min(SLAM.gap, Math.max(0, this.clock - this.lastHit));
    this.lastHit = this.clock;
    const t = this.d.state;
    if (!(t.ult >= 1 || this.leap)) t.ult = Math.min(1, t.ult + (e * t.ultMul) / SLAM.fill);
  }

  /** The E / Ult key: arms the aim, or cancels it. */
  key(): void {
    if (this.leap) return;
    if (this.aiming) {
      this.cancel();
      return;
    }
    if (this.d.free() && !this.d.safe(this.d.player.pos)) {
      if (!this.ready) {
        this.d.ui.ultNudge();
        return;
      }
      this.aiming = true;
      this.lmbLock = this.d.input.lmb;
      this.rmbLock = this.d.input.rmb;
      this.d.audio.ultArm();
    }
  }

  cancel(): void {
    if (this.aiming) {
      this.aiming = false;
      this.d.fx.hideAim();
      this.d.audio.ultCancel();
    }
  }

  stop(): void {
    this.cancel();
    if (this.leap) this.end();
  }

  /** KR update 71765: frame(dt, simDt, controlling). */
  frame(e: number, t: number, n: boolean): void {
    const { input: r, player: i, state: a } = this.d;
    this.clock += t;
    if (!r.lmb) this.lmbLock = false;
    if (!r.rmb) this.rmbLock = false;
    const o = a.ult >= 1;
    if (o && !this.wasReady) {
      this.d.audio.ultReady();
      this.d.ui.ultPop();
      this.d.onReady?.();
    }
    this.wasReady = o;
    if (this.aiming) {
      const p = i.pos;
      if (!n || !this.d.free() || this.d.safe(p) || !o) {
        this.aiming = false;
        this.d.fx.hideAim();
      } else {
        this.targetOk = this.findTarget(this.target);
        this.plan = null;
        if (this.targetOk) {
          const g = this.target;
          if (g.y > p.y + SLAM.up || g.y < p.y - SLAM.down || this.d.safe(g)) this.targetOk = false;
          else {
            this.plan = planSlam(this.d.world, p, g);
            this.targetOk = !!this.plan;
          }
        }
        this.d.fx.aim(this.target, this.targetOk);
        if (r.rmb && !this.rmbLock) {
          this.rmbLock = true;
          this.cancel();
        } else if (r.lmbPressed) {
          this.lmbLock = true;
          if (this.targetOk) this.cast();
          else this.d.audio.deny();
        }
      }
    }
    if (this.blastT >= 0) {
      this.blastT += e;
      const s = this.blastT,
        k = Math.min(1, s / 0.3),
        w = s < 0.3 ? 1 : Math.max(0, 1 - (s - 0.3) / 1.6);
      this.d.grass?.(this.blastAt.x, this.blastAt.y, this.blastAt.z, (SLAM.radius + 2.5) * (1 - (1 - k) * (1 - k)), w);
      if (w <= 0) this.blastT = -1;
    } else if (this.aiming || this.press > 0.002) {
      this.press += ((this.aiming ? 0.85 : 0) - this.press) * Math.min(1, e * (this.aiming ? 8 : 5));
      this.d.grass?.(this.target.x, this.target.y, this.target.z, SLAM.radius + 0.3, this.press > 0.002 ? this.press : 0);
    }
    const s = !!this.leap && this.posePhase !== `done` && this.posePhase !== `crouch`;
    this.zoom += ((s ? 2.2 : 0) - this.zoom) * Math.min(1, e * (s ? 5 : 1.6));
    this.d.cam.extra = this.zoom;
    this.kick = Math.max(0, this.kick - e * 30);
  }

  /** KR update 71746: added to the camera fov kick. */
  get fovKick(): number {
    return (this.posePhase === `dive` ? 9 : 0) + this.kick;
  }

  /** KR update 71655: drives the miner along the leap; true while it owns the miner (skip the player update). */
  step(e: number): boolean {
    const t = this.leap;
    if (!t) {
      this.pose = null;
      this.spinning = this.streaking = false;
      return false;
    }
    const { player: n, combat: r } = this.d;
    if (r.ko) {
      if (this.owns) n.vel.set(0, 0, 0);
      this.end();
      return false;
    }
    const i = this.owns;
    t.t += e;
    if (i) {
      const m = evalLeap(t, t.t, n.pos, n.vel);
      this.moment(t, m.phase, m.k, m.len);
      n.yaw = this.yaw;
      n.thrust = 0;
      n.onGround = m.phase === `crouch` || m.phase === `land`;
      if (!this.owns) {
        n.vel.set(0, 0, 0);
        n.onGround = true;
      }
      return true;
    }
    const a = evalLeap(t, t.t, S_ED, S_DD),
      o = Math.hypot(n.vel.x, n.vel.z) > 0.6 || !n.onGround;
    if (a.phase === `done` || o) this.end();
    else this.moment(t, a.phase, a.k, a.len);
    return false;
  }

  /** KR update 71843: the rig pose (MinerRig.update st.slam). */
  slamPose(): SlamPoseBuf | null {
    return this.pose;
  }

  /** KR update 71847: the streak direction for the dash lines while rising or diving, else null. */
  streak(e: THREE.Vector3): THREE.Vector3 | null {
    return this.streaking ? e.copy(this.streakDir) : null;
  }

  end(): void {
    if (this.craterDue && this.leap) {
      this.craterDue = false;
      this.d.crater(this.leap.to);
      this.d.fx.relay();
    }
    this.leap = null;
    this.pose = null;
    this.posePhase = `done`;
    this.spinning = this.streaking = false;
  }

  cast(): void {
    const { player: e, state: t, cam: n } = this.d,
      r = this.target.clone(),
      i = this.plan!;
    e.cancelDodge();
    e.thrust = 0;
    this.aiming = false;
    this.d.fx.hideAim();
    t.ult = 0;
    this.wasReady = false;
    this.leap = i;
    i.t = 0;
    this.ev = 0;
    this.posePhase = `crouch`;
    const a = r.x - e.pos.x,
      o = r.z - e.pos.z;
    this.yaw = Math.hypot(a, o) > 0.4 ? Math.atan2(a, o) : n.yaw;
    this.d.combat.shield(leapDuration(i) + SLAM_TIMES.land);
    this.d.act([`ult`, round2(r.x), round2(r.y), round2(r.z), round2(i.h)]);
    this.d.audio.ultLeap();
    t.save();
  }

  moment(e: LeapPlan, t: LeapPhase, n: number, r: number): void {
    if (t === `done`) {
      this.pose = null;
      return;
    }
    this.posePhase = t;
    if (t !== `crouch` && !(this.ev & 1)) {
      this.ev |= 1;
      this.launch(e.from, true);
    }
    if ((t === `hang` || t === `dive` || t === `land`) && !(this.ev & 2)) {
      this.ev |= 2;
      this.d.audio.ultApex();
      const tip = this.d.model.drillTip(S_ED);
      this.d.sparks.emit({ pos: tip, color: 16774882, intensity: 4, size: 1.1, sizeEnd: 0.2, life: 0.12, count: 1 });
    }
    if ((t === `dive` || t === `land`) && !(this.ev & 4)) {
      this.ev |= 4;
      this.d.audio.ultDive();
    }
    if (t === `land` && !(this.ev & 8)) {
      this.ev |= 8;
      this.slam(e);
    } else if (this.craterDue) {
      this.craterDue = false;
      const y = this.d.crater(e.to);
      if (y !== null && y < e.to.y) e.landY = Math.max(y, e.to.y - 1.6);
      this.d.fx.relay();
    }
    if (t === `rise` || t === `dive`) {
      const tip = this.d.model.drillTip(S_ED);
      this.d.sparks.emit({
        pos: tip,
        vel: S_DD.copy(this.d.player.vel).multiplyScalar(-0.08),
        spread: 1.2,
        color: t === `dive` ? 16765562 : 16757850,
        intensity: 3,
        size: 0.13,
        sizeEnd: 0.02,
        life: 0.35,
        gravity: 4,
        count: t === `dive` ? 3 : 1,
      });
    }
    this.spinning = t === `hang` || t === `dive`;
    this.streaking = t === `rise` || t === `dive`;
    if (t === `rise`) this.streakDir.subVectors(e.apex, e.from).normalize();
    else if (t === `dive`) this.streakDir.subVectors(e.to, e.apex).normalize();
    const i = this.poseBuf;
    i.phase = t;
    i.k = n;
    i.len = r;
    i.dir.subVectors(e.to, e.apex).normalize();
    this.pose = i;
  }

  /** The landing point under the crosshair (or 15 m ahead on open ground), clamped to 15 m across. */
  findTarget(e: THREE.Vector3): boolean {
    const { world: t, cam: n, player: r } = this.d,
      i = n.camera.position,
      a = n.camera.getWorldDirection(S_OD),
      o = r.pos,
      s = n.dist + SLAM.range + 14;
    let c = -1;
    for (let k = Math.max(0.5, n.dist * 0.75); k < s; k += 0.35)
      if (t.sample(i.x + a.x * k, i.y + a.y * k, i.z + a.z * k) > 128) {
        c = k;
        break;
      }
    if (c > 0) {
      let lo = c - 0.35,
        hi = c;
      for (let k = 0; k < 5; k++) {
        const m = (lo + hi) / 2;
        if (t.sample(i.x + a.x * m, i.y + a.y * m, i.z + a.z * m) > 128) hi = m;
        else lo = m;
      }
      S_KD.set(i.x + a.x * lo, i.y + a.y * lo, i.z + a.z * lo);
      if (surfaceNormal(t, S_KD, S_AD).y > 0.55) e.copy(S_KD);
      else {
        let found = false;
        for (const back of [0.7, 1.4, 2.2, 3.2]) {
          S_ED.copy(S_KD).addScaledVector(a, -back);
          const y = t.groundBelow(S_ED.x, S_ED.z, S_ED.y + 0.3, 40);
          if (y !== null) {
            e.set(S_ED.x, y, S_ED.z);
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    } else {
      const h = Math.hypot(a.x, a.z);
      if (h < 0.05) return false;
      e.set(o.x + (a.x / h) * SLAM.range, o.y + 3, o.z + (a.z / h) * SLAM.range);
      const y = t.groundBelow(e.x, e.z, e.y, 40);
      if (y === null) return false;
      e.y = y;
    }
    const l = e.x - o.x,
      u = e.z - o.z,
      d = Math.hypot(l, u);
    if (d > SLAM.range) {
      e.x = o.x + (l / d) * SLAM.range;
      e.z = o.z + (u / d) * SLAM.range;
      const y = t.groundBelow(e.x, e.z, Math.max(o.y, e.y) + 3, 40);
      if (y === null) return false;
      e.y = y;
    }
    return true;
  }

  /** Take-off dust ring, ring pulse and sparks at `e`; `t` = mine (shake) or a remote miner (sound by distance). */
  launch(e: THREE.Vector3, t: boolean): void {
    const { dust: n, rings: r, sparks: i } = this.d;
    if (this.d.world.groundBelow(e.x, e.z, e.y + 0.6, 1.4) !== null)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        n.emit({
          pos: S_ED.set(e.x + Math.cos(a) * 0.5, e.y + 0.15, e.z + Math.sin(a) * 0.5),
          vel: S_DD.set(Math.cos(a) * 5, 0.6, Math.sin(a) * 5),
          spread: 0.5,
          color: k % 2 ? 14206888 : 12101002,
          size: 0.5,
          sizeEnd: 1.6,
          alpha: 0.5,
          life: 0.7,
          drag: 3,
          count: 1,
        });
      }
    r.pulse(S_ED.set(e.x, e.y + 0.12, e.z), UP, { r0: 0.3, r1: 2.6, life: 0.32, color: 16773320, alpha: 0.6, thick: 0.35 });
    i.emit({
      pos: S_ED.set(e.x, e.y + 0.3, e.z),
      vel: S_DD.set(0, 3, 0),
      spread: 2.5,
      color: 16765562,
      intensity: 2.6,
      size: 0.12,
      sizeEnd: 0.02,
      life: 0.4,
      gravity: 6,
      count: 10,
    });
    const a = e.distanceTo(this.d.player.pos);
    if (t) this.d.cam.addShake(0.18);
    else this.d.audio.ultLeap(clamp(1.2 - a / 45, 0.1, 1));
  }

  slam(e: LeapPlan): void {
    const t = e.to;
    this.hit(t);
    this.craterDue = true;
    this.show(t, true);
    this.d.hitstop(0.1);
    this.kick = 14;
    this.d.ui.flash(0.32, `#fff3d8`);
  }

  /** Area damage at `e` to foes in line of sight, then the worm / bosses (combat.worm). */
  hit(e: THREE.Vector3): void {
    const { combat: t, state: n, ui: r, world: i, player: a } = this.d,
      o = n.meleeDamage,
      s = SLAM.radius;
    for (const f of [...t.foes.foes]) {
      if (f.state === `dead`) continue;
      const c = f.center(S_JD),
        l = c.x - e.x,
        u = c.z - e.z,
        d = Math.max(0, Math.hypot(l, u) - f.def.radius * 0.5);
      if (d > s || c.y < e.y - 2.5 || f.pos.y > e.y + 3.2) continue;
      let blocked = false;
      for (let k = 1; k < 5 && !blocked; k++) {
        const m = k / 5;
        if (i.sample(e.x + l * m, e.y + 1 + (c.y - e.y - 1) * m, e.z + u * m) > 158) blocked = true;
      }
      if (blocked) continue;
      const p = f.def.surface ? `golem` : f.def.node === `F_Guard` ? `heavy` : `light`,
        m = SLAM.share[p] * (f.champion ? 0.5 : 1),
        h = 1 - 0.25 * THREE.MathUtils.smoothstep(d, s * 0.55, s),
        g = Math.round((SLAM.mult * o + m * f.maxHp) * h),
        _ = Math.hypot(l, u);
      if (_ > 0.2) S_OD.set(l / _, 0, u / _);
      else S_OD.set(e.x - a.pos.x, 0, e.z - a.pos.z).normalize();
      if (S_OD.lengthSq() < 0.5) S_OD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      t.foes.damage(f, g, S_OD, SLAM.knock);
      r.floater(c.clone().setY(c.y + 1.2), String(g), `#ffd36a`, `big`);
    }
    t.worm?.blast(e, s, SLAM.beast * o);
  }

  /** The landing effects at `e`; `t` = mine (strong shake, grass blast always), else a remote miner's slam. */
  show(e: THREE.Vector3, t: boolean): void {
    const { dust: n, sparks: r, debris: i, rings: a, world: o } = this.d;
    this.d.fx.slam(e);
    if (t || (!this.aiming && !(this.blastT >= 0 && this.blastMine))) {
      this.blastT = 0;
      this.blastAt.copy(e);
      this.blastMine = t;
    }
    this.d.flare(S_ED.set(e.x, e.y + 1.2, e.z), 16765066, 46);
    const s = o.materialAt(Math.round(e.x), Math.round(e.y - 0.6), Math.round(e.z));
    i.burst(S_ED.set(e.x, e.y + 0.4, e.z), MATERIALS[s]?.color ?? 9337700, 30, UP, 11);
    r.emit({ pos: S_ED.set(e.x, e.y + 0.5, e.z), spread: 2.5, color: 16773312, intensity: 4, size: 1.7, sizeEnd: 0.3, life: 0.14, count: 3 });
    r.emit({
      pos: S_ED.set(e.x, e.y + 0.4, e.z),
      vel: S_DD.set(0, 5, 0),
      spread: 9,
      color: 16757850,
      intensity: 3.8,
      size: 0.22,
      sizeEnd: 0.03,
      life: 0.7,
      gravity: 9,
      count: 60,
      drag: 1.4,
    });
    for (let k = 0; k < 26; k++) {
      const ang = (k / 26) * Math.PI * 2 + Math.random() * 0.2;
      n.emit({
        pos: S_ED.set(e.x + Math.cos(ang) * 0.9, e.y + 0.3, e.z + Math.sin(ang) * 0.9),
        vel: S_DD.set(Math.cos(ang) * 11, 0.9, Math.sin(ang) * 11),
        spread: 0.8,
        color: k % 2 ? 13154722 : 10126960,
        size: 0.9,
        sizeEnd: 2.8,
        alpha: 0.6,
        life: 1,
        drag: 3,
        count: 1,
      });
    }
    n.emit({
      pos: S_ED.set(e.x, e.y + 0.6, e.z),
      vel: S_DD.set(0, 6, 0),
      spread: 1.4,
      color: 9337700,
      size: 1.2,
      sizeEnd: 3.2,
      alpha: 0.5,
      life: 1.4,
      drag: 2.2,
      gravity: -0.3,
      count: 8,
    });
    n.emit({
      pos: S_ED.set(e.x, e.y + 0.8, e.z),
      spread: 3.5,
      color: 7298896,
      size: 2,
      sizeEnd: 4.5,
      alpha: 0.32,
      life: 2.6,
      drag: 1.5,
      gravity: -0.15,
      count: 6,
    });
    a.pulse(S_ED.set(e.x, e.y + 0.25, e.z), UP, { r0: 0.6, r1: SLAM.radius + 2.2, life: 0.42, color: 16773320, alpha: 0.75, thick: 0.3 });
    a.pulse(S_ED.set(e.x, e.y + 1.3, e.z), UP, { r0: 0.3, r1: SLAM.radius * 0.8, life: 0.3, color: 16765562, alpha: 0.6, thick: 0.4 });
    const c = e.distanceTo(this.d.player.pos);
    this.d.audio.ultSlam(c);
    if (t) this.d.cam.addShake(0.9);
    else if (c < 50) this.d.cam.addShake(Math.max(0.1, 0.7 - c * 0.02));
  }
}
