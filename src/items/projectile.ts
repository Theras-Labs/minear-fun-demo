// Voxel projectile helpers: a surface normal from the world density field, and one step of a thrown body
// (gravity, sub-steps, bounce off solid density, rest on flat ground). Used by the smoke bombs (XP).
// Bundle play-inUT-NSi.js lines 62338-62379.
import * as THREE from 'three';

/** The world as these helpers read it (wb ChunkManager.sample: density 0-255, solid above 128). */
export interface DensityField {
  sample(x: number, y: number, z: number): number;
}

/** A thrown body: position, velocity and whether it rests on the ground. */
export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  resting: boolean;
}

// module scratch
const T0 = new THREE.Vector3(); // HP (62338)
const T1 = new THREE.Vector3(); // UP (62339)
const T2 = new THREE.Vector3(); // WP (62340)

/** GP (62341): surface normal at t by central differences of the density (+-0.5), written to n. */
export function densityNormal(e: DensityField, t: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 { // GP (62341)
  const r = 0.5;
  return (
    n.set(
      e.sample(t.x - r, t.y, t.z) - e.sample(t.x + r, t.y, t.z),
      e.sample(t.x, t.y - r, t.z) - e.sample(t.x, t.y + r, t.z),
      e.sample(t.x, t.y, t.z - r) - e.sample(t.x, t.y, t.z + r),
    ),
    n.lengthSq() < 1e-6 && n.set(0, 1, 0),
    n.normalize()
  );
}

/**
 * KP (62353): moves body t through the density field e for n seconds with radius r.
 * Returns false when the body rests (and did not move), true when it moved.
 */
export function stepProjectile(e: DensityField, t: Projectile, n: number, r: number): boolean { // KP (62353)
  const i = (t: THREE.Vector3) => e.sample(t.x, t.y, t.z) > 128;
  if ((t.resting && !i(T1.set(t.pos.x, t.pos.y - r - 0.12, t.pos.z)) && (t.resting = !1), t.resting)) return !1;
  t.vel.y -= 22 * n;
  const a = Math.min(30, Math.max(1, Math.ceil((t.vel.length() * n) / 0.2))),
    o = n / a;
  for (let n = 0; n < a && !t.resting; n++) {
    const n = T1.copy(t.pos).addScaledVector(t.vel, o),
      a = T2.copy(n).addScaledVector(t.vel.lengthSq() > 1e-6 ? T0.copy(t.vel).normalize() : T0.set(0, -1, 0), r);
    if (!i(a)) {
      t.pos.copy(n);
      continue;
    }
    const s = densityNormal(e, a, T0),
      c = t.vel.dot(s);
    (c < 0 && t.vel.addScaledVector(s, -c * 1.3).multiplyScalar(0.6),
      t.pos.addScaledVector(s, 0.02),
      t.vel.length() < 1.2 && s.y > 0.4 && ((t.resting = !0), t.vel.set(0, 0, 0)));
  }
  return !0;
}
