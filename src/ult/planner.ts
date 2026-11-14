// Port of play-inUT-NSi.js 47175-47294: the Drill Slam tuning and leap planner (the arc from the miner to the
// landing point: crouch, rise, hang at the apex, dive, land), the path clearance test against the density field,
// and the density-gradient surface normal. Also the module scratch vectors 48191-48197 (TD, ED, DD, OD, kD, AD,
// jD) that the planner, the slam controller wD and the slam FX share.
import * as THREE from 'three';

/** The density field the planner reads (ChunkManager.sample, 0-255, solid above 128). */
export interface SlamField {
  sample(x: number, y: number, z: number): number;
}

/** tD (47175): Drill Slam tuning. */
export const SLAM = { // tD (47175)
  fill: 120,
  gap: 0.75,
  range: 15,
  up: 7,
  down: 30,
  radius: 4.5,
  mult: 15,
  share: { light: 0.75, heavy: 0.35, golem: 0.2 },
  beast: 20,
  knock: 14,
};

/** nD (47187): the fixed phase lengths (s); `free` is how long after the land starts the slam still owns the miner. */
export const SLAM_TIMES = { crouch: 0.14, hang: 0.09, land: 0.4, free: 0.22 }; // nD (47187)

/** rD (47188): the slam aim colour 0xFFCF5A. */
export const SLAM_COLOR = 16764762; // rD (47188)

const clamp = THREE.MathUtils.clamp; // iD (47189)

/** aD (47190): rounds to 0.01 (network tuples). */
export const round2 = (e: number): number => Math.round(e * 100) / 100; // aD (47190)

// scratch (48191-48197)
export const UP = new THREE.Vector3(0, 1, 0); // TD
export const S_ED = new THREE.Vector3(); // ED
export const S_DD = new THREE.Vector3(); // DD
export const S_OD = new THREE.Vector3(); // OD
export const S_KD = new THREE.Vector3(); // kD
export const S_AD = new THREE.Vector3(); // AD
export const S_JD = new THREE.Vector3(); // jD

export type LeapPhase = `crouch` | `rise` | `hang` | `dive` | `land` | `done`;

/** A planned leap (oD). `t` is the time since the cast; `landY` may sink into the crater. */
export interface LeapPlan {
  from: THREE.Vector3;
  apex: THREE.Vector3;
  to: THREE.Vector3;
  rise: number;
  dive: number;
  h: number;
  t: number;
  landY: number;
}

export interface LeapMoment {
  phase: LeapPhase;
  k: number;
  len: number;
}

/** oD (47191): the arc from `from` to `to` with the apex `h` above the higher end, pulled back from the target. */
export function planLeap(e: THREE.Vector3, t: THREE.Vector3, n: number): LeapPlan { // oD (47191)
  const r = t.x - e.x,
    i = t.z - e.z,
    a = Math.hypot(r, i),
    o = Math.min(1.4, a * 0.3),
    s = new THREE.Vector3(
      t.x - (a > 0.001 ? (r / a) * o : 0),
      Math.max(e.y, t.y) + n,
      t.z - (a > 0.001 ? (i / a) * o : 0),
    );
  return {
    from: e.clone(),
    apex: s,
    to: t.clone(),
    rise: clamp(0.3 + e.distanceTo(s) * 0.016, 0.3, 0.52),
    dive: clamp(s.distanceTo(t) / 58, 0.09, 0.26),
    h: n,
    t: 0,
    landY: t.y,
  };
}

/** sD (47212): crouch + rise + hang + dive. */
export const leapDuration = (e: LeapPlan): number => SLAM_TIMES.crouch + e.rise + SLAM_TIMES.hang + e.dive; // sD (47212)

/** cD (47213): position and velocity at time `t` into the leap, written to `n` and `r`; returns the phase. */
export function evalLeap(e: LeapPlan, t: number, n: THREE.Vector3, r: THREE.Vector3): LeapMoment { // cD (47213)
  const { from: i, apex: a, to: o } = e;
  if (t < SLAM_TIMES.crouch) {
    n.copy(i);
    r.set(0, 0, 0);
    return { phase: `crouch`, k: t / SLAM_TIMES.crouch, len: SLAM_TIMES.crouch };
  }
  t -= SLAM_TIMES.crouch;
  if (t < e.rise) {
    const k = t / e.rise,
      s = k * (1.45 - 0.45 * k),
      c = 1 - (1 - k) * (1 - k);
    n.set(i.x + (a.x - i.x) * s, i.y + (a.y - i.y) * c, i.z + (a.z - i.z) * s);
    const l = (1.45 - 0.9 * k) / e.rise,
      u = (2 - 2 * k) / e.rise;
    r.set((a.x - i.x) * l, (a.y - i.y) * u, (a.z - i.z) * l);
    return { phase: `rise`, k, len: e.rise };
  }
  t -= e.rise;
  if (t < SLAM_TIMES.hang) {
    const k = t / SLAM_TIMES.hang;
    n.copy(a).setY(a.y + Math.sin(k * Math.PI) * 0.12);
    r.set(0, 0, 0);
    return { phase: `hang`, k, len: SLAM_TIMES.hang };
  }
  t -= SLAM_TIMES.hang;
  if (t < e.dive) {
    const k = t / e.dive,
      s = k * k;
    n.lerpVectors(a, o, s);
    r.subVectors(o, a).multiplyScalar((2 * k) / e.dive);
    return { phase: `dive`, k, len: e.dive };
  }
  t -= e.dive;
  n.copy(o).setY(o.y + (e.landY - o.y) * Math.min(1, t / 0.08));
  r.set(0, 0, 0);
  return t < SLAM_TIMES.land
    ? { phase: `land`, k: t / SLAM_TIMES.land, len: SLAM_TIMES.land }
    : { phase: `done`, k: 1, len: SLAM_TIMES.land };
}

/** lD (47255): free height above (x, y, z), probed every 0.5 m up to `max`. */
export function headroom(e: SlamField, t: number, n: number, r: number, i: number): number { // lD (47255)
  for (let a = 1; a < i; a += 0.5) if (e.sample(t, n + a, r) > 128) return a;
  return i;
}

/** uD (47259): the body (y + 0.95 and y + 1.65) stays out of rock along 18 steps of the arc. */
export function pathClear(e: SlamField, t: LeapPlan): boolean { // uD (47259)
  const n = S_ED,
    r = S_DD,
    i = leapDuration(t) - t.dive * 0.25;
  for (let a = 1; a <= 18; a++) {
    evalLeap(t, SLAM_TIMES.crouch + ((i - SLAM_TIMES.crouch) * a) / 18, n, r);
    if (e.sample(n.x, n.y + 0.95, n.z) > 153 || e.sample(n.x, n.y + 1.65, n.z) > 153) return false;
  }
  return true;
}

/** dD (47271): a clear arc under the ceiling at the target, lowering the apex 4 times by 0.6; null when none fits. */
export function planSlam(e: SlamField, t: THREE.Vector3, n: THREE.Vector3): LeapPlan | null { // dD (47271)
  const r = Math.hypot(n.x - t.x, n.z - t.z),
    i = Math.max(t.y, n.y);
  let a = clamp(3.4 + r * 0.24, 3.4, 7.2);
  const o = headroom(e, n.x, n.y, n.z, i - n.y + a + 3);
  a = Math.min(a, o - 2.3 - (i - n.y));
  for (let k = 0; k < 4; k++) {
    const plan = planLeap(t, n, Math.max(0.6, a));
    if (pathClear(e, plan)) return plan;
    a *= 0.6;
  }
  return null;
}

/** fD (47284): the surface normal at `t` from the density gradient (step 0.6), up when flat. */
export function surfaceNormal(e: SlamField, t: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 { // fD (47284)
  const r = 0.6;
  n.set(
    e.sample(t.x - r, t.y, t.z) - e.sample(t.x + r, t.y, t.z),
    e.sample(t.x, t.y - r, t.z) - e.sample(t.x, t.y + r, t.z),
    e.sample(t.x, t.y, t.z - r) - e.sample(t.x, t.y, t.z + r),
  );
  return n.lengthSq() > 1e-9 ? n.normalize() : n.set(0, 1, 0);
}
