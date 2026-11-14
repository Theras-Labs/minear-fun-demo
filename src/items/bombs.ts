// Thrown bombs: ballistic motion with sub-steps against the world density field, bounce with friction, rest
// detection, rolling, a fuse blink that speeds up over 6 s (tick callback, spark particles), a red warning ring
// while resting; local bombs blow up at 6 s (onBlast), remote ones are removed at 8 s. Also the blast constants.
// Bundle play-inUT-NSi.js lines 58353-58567. The bomb mesh BM and its materials (58358-58406) are ported in
// src/pickups/supplyModels.ts (bombModel); MM is repeated here as BOMB_R because that file keeps it private.
import * as THREE from 'three';
import { bombModel } from '../pickups/supplyModels';
import type { EmitOptions } from '../fx/particles';
import type { DensityField } from './projectile';

/** DM (58353): dig radius of a blast (KR.blast world.dig). */
export const BLAST_R = 4.3; // DM (58353)
/** OM (58354): base blast damage to foes. */
export const BLAST_DMG = 340; // OM (58354)
/** kM (58355): blast damage growth per player level. */
export const BLAST_GROWTH = 0.2; // kM (58355)
/** AM (58356): blast damage to foes at a player level. */
export const blastDamage = (e: number): number => Math.round(BLAST_DMG * (1 + BLAST_GROWTH * Math.max(0, e - 1))); // AM (58356)
/** jM (58357): blast damage to the worm (and bosses) at a player level. */
export const wormBlastDamage = (e: number): number => Math.max(BLAST_DMG, Math.round(blastDamage(e) / 3)); // jM (58357)
/** MM (58358): bomb radius. */
export const BOMB_R = 0.26; // MM (58358)

/** VM (58407): the ground warning ring around a resting bomb (the blast reach, 7 m). */
const ringGeometry = new THREE.RingGeometry(6.82, 7, 64).rotateX(-Math.PI / 2); // VM (58407)
/** HM (58408): ring material (each bomb clones it for its own opacity). */
const ringMaterial = new THREE.MeshBasicMaterial({ // HM (58408)
  color: 16726830,
  transparent: !0,
  opacity: 0,
  depthWrite: !1,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});
const T0 = new THREE.Vector3(); // UM (58416)
const T1 = new THREE.Vector3(); // WM (58417)
const Q0 = new THREE.Quaternion(); // GM (58418)

/** One live bomb. owner = the thrower's miner id for a remote bomb, null for mine. */
export interface Bomb {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  resting: boolean;
  blinkOn: boolean;
  id: number;
  owner: string | null;
}

export class Bombs { // KM (58419)
  world: DensityField;
  sparks: { emit(o: EmitOptions): void };
  group = new THREE.Group();
  /** A local bomb blew up at pos (a clone), with its id. */
  onBlast: (pos: THREE.Vector3, id: number) => void = () => {};
  /** The fuse blinked on; blink = min(1, t / 6). pos is the bomb's own vector. */
  onTick: (pos: THREE.Vector3, blink: number) => void = () => {};
  live: Bomb[] = [];
  nextId = 1;

  constructor(e: DensityField, t: { emit(o: EmitOptions): void }) {
    ((this.world = e), (this.sparks = t));
  }

  get count(): number {
    return this.live.length;
  }

  /** throw (58433): a bomb at e with velocity t; n = owner (remote), r = its id. Returns the id. */
  throw(e: THREE.Vector3, t: THREE.Vector3, n: string | null = null, r = 0): number {
    const i = bombModel(!0);
    i.position.copy(e);
    const a = new THREE.Mesh(ringGeometry, ringMaterial.clone());
    return (
      (a.visible = !1),
      this.group.add(i, a),
      n || (r = this.nextId++),
      this.live.push({
        root: i,
        ring: a,
        pos: e.clone(),
        vel: t.clone(),
        t: 0,
        resting: !1,
        blinkOn: !1,
        id: r,
        owner: n,
      }),
      r
    );
  }

  clear(): void {
    for (; this.live.length; ) this.drop(this.live.length - 1);
  }

  /** defuse (58458): removes owner e's bomb t without a blast. */
  defuse(e: string | null, t: number): void {
    const n = this.live.findIndex((n) => n.owner === e && n.id === t);
    n >= 0 && this.drop(n);
  }

  drop(e: number): void {
    const t = this.live[e];
    (t.root.removeFromParent(),
      t.ring.removeFromParent(),
      (t.root.userData.body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.dispose(),
      t.ring.material.dispose(),
      this.live.splice(e, 1));
  }

  solid(e: THREE.Vector3): boolean {
    return this.world.sample(e.x, e.y, e.z) > 128;
  }

  normal(e: THREE.Vector3, t: THREE.Vector3): THREE.Vector3 {
    const n = this.world,
      r = 0.5;
    return (
      t.set(
        n.sample(e.x - r, e.y, e.z) - n.sample(e.x + r, e.y, e.z),
        n.sample(e.x, e.y - r, e.z) - n.sample(e.x, e.y + r, e.z),
        n.sample(e.x, e.y, e.z - r) - n.sample(e.x, e.y, e.z + r),
      ),
      t.lengthSq() < 1e-6 && t.set(0, 1, 0),
      t.normalize()
    );
  }

  update(e: number): void {
    for (let t = this.live.length - 1; t >= 0; t--) {
      const n = this.live[t];
      if (
        ((n.t += e),
        n.resting && (this.solid(T1.set(n.pos.x, n.pos.y - BOMB_R - 0.12, n.pos.z)) || (n.resting = !1)),
        n.resting)
      )
        n.root.quaternion.slerp(Q0.identity(), Math.min(1, e * 3));
      else {
        n.vel.y -= 22 * e;
        const t = Math.min(30, Math.max(1, Math.ceil((n.vel.length() * e) / 0.2))),
          r = e / t;
        for (let e = 0; e < t && !n.resting; e++) {
          const e = T1.copy(n.pos).addScaledVector(n.vel, r),
            t = e.clone().addScaledVector(n.vel.lengthSq() > 1e-6 ? T0.copy(n.vel).normalize() : T0.set(0, -1, 0), BOMB_R),
            i = e.clone().setY(e.y - BOMB_R),
            a = this.solid(t) ? t : this.solid(i) ? i : null;
          if (!a) {
            n.pos.copy(e);
            continue;
          }
          const o = this.normal(a, T0),
            s = n.vel.dot(o);
          if (s < 0) {
            n.vel.addScaledVector(o, -s * 1.38);
            const e = n.vel.clone().addScaledVector(o, -n.vel.dot(o));
            n.vel.addScaledVector(e, -0.28);
          }
          (n.pos.addScaledVector(o, 0.02), n.vel.length() < 1.1 && o.y > 0.45 && ((n.resting = !0), n.vel.set(0, 0, 0)));
        }
        const i = Math.hypot(n.vel.x, n.vel.z);
        i > 0.05 &&
          (T1.set(n.vel.z, 0, -n.vel.x).normalize(), n.root.quaternion.premultiply(Q0.setFromAxisAngle(T1, (i * e) / BOMB_R)));
      }
      n.root.position.copy(n.pos);
      const r = Math.min(1, n.t / 6),
        i = 2.2 + r * r * 12,
        a = Math.sin(n.t * i * Math.PI * 2) > 0.2,
        o = n.root.userData.body as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      ((o.material.emissiveIntensity = a ? 1.4 + r * 2.2 : 0.05), a && !n.blinkOn && this.onTick(n.pos, r), (n.blinkOn = a));
      const s = n.root.userData.spark as THREE.Mesh;
      if (
        (s.scale.setScalar(0.8 + Math.random() * 0.8),
        s.getWorldPosition(T1),
        Math.random() < 0.7 &&
          this.sparks.emit({
            pos: T1,
            vel: T0.set(0, 1.2, 0),
            spread: 1.6,
            color: 16765562,
            intensity: 3,
            size: 0.07,
            sizeEnd: 0.01,
            life: 0.35,
            gravity: 5,
            count: 1,
          }),
        (n.ring.visible = n.resting),
        n.resting &&
          (n.ring.position.set(n.pos.x, n.pos.y - BOMB_R + 0.06, n.pos.z),
          (n.ring.material.opacity = (a ? 0.55 : 0.2) * Math.min(1, n.t * 2))),
        n.owner)
      )
        n.t >= 8 && this.drop(t);
      else if (n.t >= 6) {
        const e = n.pos.clone();
        (this.drop(t), this.onBlast(e, n.id));
      }
    }
  }
}
