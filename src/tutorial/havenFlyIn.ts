// The haven fly-in: the intro camera path of a sandbox tutorial. From the title orbit it circles the lift at the
// title radius, dips under the island, then rises behind the miner to the follow camera, on a uniform cubic
// B-spline walked at an eased constant speed.
// Bundle play-inUT-NSi.js lines 60849-60946.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';

const DEG = Math.PI / 180; // HN (60849)
/** The dive point sits this far round from the end angle, on the side the path comes from. */
const DIVE_ANGLE = 68 * DEG; // UN (60850)
/** Radius of the dive point from the lift. */
const DIVE_R = 33; // WN (60851)
/** Height of the dive point (under the island). */
const DIVE_Y = LIFT_POINT.y - 16; // GN (60852)
/** At most this much turn between two circling control points. */
const ARC_STEP = 40 * DEG; // KN (60853)
/** The rise point sits this far behind the end position ... */
const RISE_BACK = 9; // qN (60854)
/** ... and this far above it. */
const RISE_UP = 9; // JN (60855)
/** Path speed (m/s) for the duration. */
const SPEED = 19; // YN (60856)
/** Duration bounds, seconds. */
const DUR_MIN = 3.8; // XN (60857)
const DUR_MAX = 5.2; // ZN (60858)
/** Arc-length table samples. */
const SAMPLES = 128; // QN (60859)
/** Wraps an angle into -PI..PI. */
const wrapAngle = (e: number): number => Math.atan2(Math.sin(e), Math.cos(e)); // $N (60860)
/** The arc-length ease. */
const easePath = (e: number): number => 1 - (1 - e) ** 2.5 * (1 + 2.5 * e); // eP (60861)
const smoother = THREE.MathUtils.smootherstep; // tP (60862)
const T0 = new THREE.Vector3(); // nP (60863)
const T1 = new THREE.Vector3(); // rP (60864)
const T2 = new THREE.Vector3(); // iP (60865)

export class HavenFlyIn { // aP (60866)
  dur = 0;
  side = 0;
  n = -1;
  ctl: THREE.Vector3[] = [];
  lens = new Float32Array(129);
  /**
   * Places the camera at elapsed time e and aims it. t: the camera; n: where it started; r: the point it looked
   * at first; i: the follow camera position; a: the follow camera look point; o: the follow camera pivot.
   * Returns true at the end.
   */
  update(
    e: number,
    t: THREE.Camera,
    n: THREE.Vector3,
    r: THREE.Vector3,
    i: THREE.Vector3,
    a: THREE.Vector3,
    o: THREE.Vector3,
  ): boolean {
    const s = LIFT_POINT.x,
      c = LIFT_POINT.z,
      l = Math.atan2(n.x - s, n.z - c),
      u = Math.hypot(n.x - s, n.z - c),
      d = Math.atan2(i.x - s, i.z - c);
    this.side ||= wrapAngle(d - l) >= 0 ? 1 : -1;
    const f = d - this.side * DIVE_ANGLE,
      p = wrapAngle(f - l);
    this.n < 0 && (this.n = Math.abs(p) < 4 * DEG ? 0 : Math.max(1, Math.ceil(Math.abs(p) / ARC_STEP)));
    const m = this.ctl;
    let h = 0;
    const g = (e: number, t: number, n: number) => {
      ((m[h] ??= new THREE.Vector3()).set(e, t, n), h++);
    };
    for (let e = 0; e < 3; e++) g(n.x, n.y, n.z);
    for (let e = 1; e <= this.n; e++) {
      const t = l + (p * e) / this.n;
      g(s + Math.sin(t) * u, n.y, c + Math.cos(t) * u);
    }
    (g(s + Math.sin(f) * DIVE_R, DIVE_Y, c + Math.cos(f) * DIVE_R),
      T1.subVectors(a, i).setY(0).normalize(),
      g(i.x - T1.x * RISE_BACK, i.y + RISE_UP, i.z - T1.z * RISE_BACK));
    for (let e = 0; e < 3; e++) g(i.x, i.y, i.z);
    m.length = h;
    const _ = this.lens,
      v = this.point(0, t.position);
    let y = v.x,
      b = v.y,
      x = v.z;
    for (let e = 1; e <= SAMPLES; e++)
      (this.point(e / SAMPLES, T0),
        (_[e] = _[e - 1] + Math.hypot(T0.x - y, T0.y - b, T0.z - x)),
        (y = T0.x),
        (b = T0.y),
        (x = T0.z));
    this.dur ||= THREE.MathUtils.clamp(_[SAMPLES] / SPEED, DUR_MIN, DUR_MAX);
    const S = Math.min(1, e / this.dur),
      C = easePath(S),
      w = C * _[SAMPLES];
    let T = 1;
    for (; T < SAMPLES && _[T] < w; ) T++;
    const E = _[T] - _[T - 1];
    return (
      this.point((T - 1 + (E > 0 ? (w - _[T - 1]) / E : 0)) / SAMPLES, t.position),
      T2.set(s, LIFT_POINT.y - 10, c),
      T0.copy(r)
        .lerp(T2, smoother(C, 0, 0.35))
        .lerp(o, smoother(C, 0.05, 0.65))
        .lerp(a, smoother(C, 0.7, 1)),
      t.lookAt(T0),
      S >= 1
    );
  }
  /** The uniform cubic B-spline over the control points at e in 0..1, into t. */
  point(e: number, t: THREE.Vector3): THREE.Vector3 {
    const n = this.ctl,
      r = n.length - 3,
      i = Math.min(r - 1e-6, Math.max(0, e * r)),
      a = Math.floor(i),
      o = i - a,
      s = o * o,
      c = s * o,
      l = (1 - o) ** 3 / 6,
      u = (3 * c - 6 * s + 4) / 6,
      d = (-3 * c + 3 * s + 3 * o + 1) / 6,
      f = c / 6;
    return t
      .set(0, 0, 0)
      .addScaledVector(n[a], l)
      .addScaledVector(n[a + 1], u)
      .addScaledVector(n[a + 2], d)
      .addScaledVector(n[a + 3], f);
  }
}
