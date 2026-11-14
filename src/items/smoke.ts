// Smoke bombs: thrown smoke pots that roll on the voxel field, then pop into a smoke cloud for 10 s. The cloud
// hides miners from the Lost (inSmoke) and is drawn with the dust particles. Remote pots pop through puff().
// Bundle play-inUT-NSi.js lines 62380-62506.
import * as THREE from 'three';
import { supplyModel } from '../pickups/supplyModels';
import { SMOKE_RADIUS as SMOKE_R } from '../world/constants'; // wp (28762): the smoke cloud radius, 5.5
import type { EmitOptions } from '../fx/particles';
import { stepProjectile, type DensityField } from './projectile';

/** qP (62380): smoke pot radius. */
export const POT_R = 0.2; // qP (62380)
/** JP (62381): the four smoke colors. */
export const SMOKE_COLORS = [10130096, 12169673, 8222102, 10985656]; // JP (62381)
/** YP (62382): cloud density over its 10 s life (fades in over 0.25 s, out over the last 2 s). */
export const cloudDensity = (e: number): number => Math.min(1, e * 4) * Math.min(1, (10 - e) / 2); // YP (62382)

const T1 = new THREE.Vector3(); // UP (62339)
const T2 = new THREE.Vector3(); // WP (62340)

/** A smoke pot in flight or rolling. owner = remote thrower's id, null for mine. */
export interface SmokePot {
  id: number;
  owner: string | null;
  root: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  restT: number;
  resting: boolean;
}

/** A smoke cloud; owe = particles owed to the emitter. */
export interface SmokeCloud {
  id: number;
  owner: string | null;
  pos: THREE.Vector3;
  t: number;
  owe: number;
}

export class SmokeBombs { // XP (62383)
  world: DensityField;
  dust: { emit(o: EmitOptions): void };
  group = new THREE.Group();
  pots: SmokePot[] = [];
  clouds: SmokeCloud[] = [];
  nextId = 1;
  /** One of my pots popped: id and the cloud position. */
  onPop: (id: number, pos: THREE.Vector3) => void = () => {};

  constructor(e: DensityField, t: { emit(o: EmitOptions): void }) {
    ((this.world = e), (this.dust = t));
  }

  /** throw (62394): a pot at e with velocity t; n = owner (remote), r = its id. Returns the id. */
  throw(e: THREE.Vector3, t: THREE.Vector3, n: string | null = null, r = 0): number {
    const i = supplyModel(`smoke`); // AP (62168)
    return (
      i.position.copy(e),
      this.group.add(i),
      n || (r = this.nextId++),
      this.pots.push({
        id: r,
        owner: n,
        root: i,
        pos: e.clone(),
        vel: t.clone(),
        t: 0,
        restT: 0,
        resting: !1,
      }),
      r
    );
  }

  clear(): void {
    for (const e of this.pots) e.root.removeFromParent();
    ((this.pots = []), (this.clouds = []));
  }

  /** puff (62417): owner e's pot t popped at n (remote). */
  puff(e: string | null, t: number, n: THREE.Vector3): void {
    const r = this.pots.findIndex((n) => n.owner === e && n.id === t);
    r >= 0 && (this.pots[r].root.removeFromParent(), this.pots.splice(r, 1));
    const i = this.clouds.find((n) => n.owner === e && n.id === t);
    i ? i.pos.copy(n) : this.pop(e, t, n);
  }

  /** pop (62423): a cloud of owner e, id t at n (at most 12 clouds); onPop for my own. */
  pop(e: string | null, t: number, n: THREE.Vector3): void {
    const r = n.clone();
    (this.clouds.push({ id: t, owner: e, pos: r, t: 0, owe: 0 }), this.clouds.length > 12 && this.clouds.shift());
    for (let e = 0; e < 4; e++)
      this.dust.emit({
        pos: T1.set(r.x, r.y + 0.8, r.z),
        vel: T2.set(0, 0.8, 0),
        spread: 3.4,
        color: SMOKE_COLORS[e],
        size: 1.3,
        sizeEnd: 3.6,
        alpha: 0.95,
        life: 2.6,
        drag: 1.6,
        count: 12,
      });
    e || this.onPop(t, r);
  }

  /** inSmoke (62442): is e inside a thick enough cloud? */
  inSmoke(e: { x: number; y: number; z: number }): boolean {
    for (const t of this.clouds) {
      if (cloudDensity(t.t) < 0.5) continue;
      const n = e.x - t.pos.x,
        r = e.y - (t.pos.y + 1.2),
        i = e.z - t.pos.z;
      if (n * n + i * i + r * r * 1.8 < (5.5 * 0.92) ** 2) return !0;
    }
    return !1;
  }

  update(e: number): void {
    for (let t = this.pots.length - 1; t >= 0; t--) {
      const n = this.pots[t];
      ((n.t += e),
        stepProjectile(this.world, n, e, POT_R)
          ? ((n.root.rotation.x += e * 7), (n.root.rotation.z += e * 4))
          : (n.restT += e),
        n.root.position.copy(n.pos),
        Math.random() < 0.5 &&
          this.dust.emit({
            pos: T1.set(n.pos.x, n.pos.y + 0.25, n.pos.z),
            vel: T2.set(0, 0.7, 0),
            spread: 0.2,
            color: 12169673,
            size: 0.15,
            sizeEnd: 0.6,
            alpha: 0.45,
            life: 0.8,
            count: 1,
          }));
      const r = n.owner ? 0.6 : 0;
      (n.restT > 0.35 + r || n.t > 2.2 + r) &&
        (n.root.removeFromParent(), this.pots.splice(t, 1), this.pop(n.owner, n.id, n.pos));
    }
    for (let t = this.clouds.length - 1; t >= 0; t--) {
      const n = this.clouds[t];
      if (((n.t += e), n.t >= 10)) {
        this.clouds.splice(t, 1);
        continue;
      }
      for (n.owe += e * 40 * cloudDensity(n.t); n.owe >= 1; ) {
        n.owe--;
        const e = Math.random() * Math.PI * 2,
          t = Math.sqrt(Math.random()) * SMOKE_R * 0.8;
        (T1.set(n.pos.x + Math.cos(e) * t, n.pos.y + 0.5 + Math.random() * SMOKE_R * 0.55, n.pos.z + Math.sin(e) * t),
          this.dust.emit({
            pos: T1,
            vel: T2.set(0, 0.25, 0),
            spread: 0.35,
            color: SMOKE_COLORS[(Math.random() * 4) | 0],
            size: 1.9,
            sizeEnd: 3.4,
            alpha: 0.9,
            life: 2.4,
            drag: 0.8,
            count: 1,
          }));
      }
    }
  }
}
