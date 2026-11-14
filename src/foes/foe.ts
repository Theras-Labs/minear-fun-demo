// Port of play-inUT-NSi.js 43741-43836: helpers $w / eT / tT and the foe entity nT (one live foe of the
// simulation: position, velocity, HP, state machine fields, path following, stuck detection, slow debuff,
// champion flag, golem hurl / mend cooldowns and burrower dig state).
import * as THREE from 'three';
import { FOE_LOOPS, FOE_STATES, type FoeDef, type FoeKind, type FoeLoop, type FoeState } from './types';

export const clamp = THREE.MathUtils.clamp; // $w (43744)
/** eT (43745): wrap an angle to [-pi, pi]. */
export const wrapAngle = (e: number): number => Math.atan2(Math.sin(e), Math.cos(e)); // eT (43745)
/** tT (43746): round to 0.01 (wire precision). */
export const round2 = (e: number): number => Math.round(e * 100) / 100; // tT (43746)

/** A foe spawn spot: a dormant cave spot, a golem spot or a one-off (key -1). */
export interface FoeSpot {
  key: number;
  pos: THREE.Vector3;
  kind: FoeKind;
  state: 'dormant' | 'up';
  depth: number;
  /** Golem home (set at the first wake). */
  home?: THREE.Vector3;
}

/** info() tuple: [id, kind, x, y, z, yaw, hp, maxHp, stateIdx (Ew), t, loopIdx (Dw), champion]. */
export type FoeInfo = [number, string, number, number, number, number, number, number, number, number, number, number];
/** snap() tuple: [id, x, y, z, yaw, stateIdx (Ew), loopIdx (Dw), rate, hp]. */
export type FoeSnap = [number, number, number, number, number, number, number, number, number];

export class Foe { // nT (43747)
  id: number;
  kind: FoeKind;
  def: FoeDef;
  spot: FoeSpot;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  dmg: number;
  state: FoeState = `rise`;
  gone = false;
  t = 0;
  cd: number;
  sinceHit = 99;
  fired = false;
  attackLen = 1;
  grounded = true;
  stagger = 0;
  loop: FoeLoop = `walk`;
  rate = 1;
  path: THREE.Vector3[] | null = null;
  pathI = 0;
  pathT = 0;
  pathGoal = new THREE.Vector3(1e9, 0, 0);
  stuckT = 0;
  lastPos = new THREE.Vector3();
  detourT = 0;
  avoid: number[] = [];
  avoidT = 0;
  target: string | null = null;
  wander: THREE.Vector3 | null = null;
  slowK = 0;
  slowT = 0;
  champion = false;
  hurlCd = 2;
  mendCd = 0;
  blockedT = 0;
  digAt = new THREE.Vector3(1e9, 0, 0);
  burrowed = false;
  burrowT = 0;
  digRest = 0;
  hitters = new Set<string>();
  /** MINEAR senses (src/foes/types.ts LOSE_TRACK_S..SIGHT_CHECK_S): seconds to the next line-of-sight check. */
  seeCd = 0;
  /** The last line-of-sight result to the target. */
  seen = true;
  /** Seconds since the foe last saw its target. */
  lostT = 0;
  /** Seconds the foe has wanted to move but stayed within 1 m of stallPos. */
  stallT = 0;
  stallPos = new THREE.Vector3(1e9, 0, 0);
  /** Seconds left of staying home after giving up. */
  homeT = 0;
  constructor(e: number, t: FoeKind, n: FoeDef, r: FoeSpot, i: number) {
    this.id = e;
    this.kind = t;
    this.def = n;
    this.spot = r;
    this.maxHp = this.hp = Math.round(n.hp * i ** 1.15);
    this.dmg = Math.round(n.dmg * (0.5 + i * 0.5));
    this.cd = 0.8 + Math.random();
    if (n.mend) this.mendCd = n.mend.every * 0.6;
  }
  get depth(): number {
    return this.spot.depth;
  }
  /** Mid-body point. */
  center(e: THREE.Vector3): THREE.Vector3 {
    return e.set(this.pos.x, this.pos.y + (this.def.height ?? 1.9) * 0.5, this.pos.z);
  }
  info(): FoeInfo {
    return [
      this.id,
      this.kind,
      round2(this.pos.x),
      round2(this.pos.y),
      round2(this.pos.z),
      round2(this.yaw),
      Math.round(this.hp),
      this.maxHp,
      FOE_STATES.indexOf(this.state),
      round2(this.t),
      FOE_LOOPS.indexOf(this.loop),
      +!!this.champion,
    ];
  }
  snap(): FoeSnap {
    return [
      this.id,
      round2(this.pos.x),
      round2(this.pos.y),
      round2(this.pos.z),
      round2(this.yaw),
      FOE_STATES.indexOf(this.state),
      FOE_LOOPS.indexOf(this.loop),
      round2(this.rate),
      Math.round(this.hp),
    ];
  }
}
