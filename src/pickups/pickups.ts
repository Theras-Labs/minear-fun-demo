// Pickups: ore nuggets (one InstancedMesh of 400) and dropped items (their own meshes) that pop out of dug rock
// and dead foes, settle on the floor, then fly to the miner when there is room (magnet) and get collected.
// Bundle play-inUT-NSi.js lines 61893-62104 (wP), plus the nugget geometry IA (53077-53091).
import * as THREE from 'three';
import { ITEMS, type ItemDef } from '../world/items';

const ITEM = ITEMS as Record<string, ItemDef>;

/** IA (53077): a lumpy icosahedron (debris shard and ore nugget). */
export function nuggetGeometry(e = 0.12): THREE.BufferGeometry { // IA (53077)
  const t = new THREE.IcosahedronGeometry(e, 1),
    n = t.getAttribute(`position`) as THREE.BufferAttribute,
    r = new THREE.Vector3(),
    i = new Map<string, number>();
  for (let e = 0; e < n.count; e++) {
    r.fromBufferAttribute(n, e);
    const t = `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.z.toFixed(3)}`;
    let a = i.get(t);
    (a === void 0 && ((a = 0.78 + Math.random() * 0.4), i.set(t, a)),
      r.multiplyScalar(a),
      n.setXYZ(e, r.x * 1.15, r.y * 0.8, r.z));
  }
  return (t.deleteAttribute(`uv`), t.computeVertexNormals(), t);
}

const tmpMat = new THREE.Matrix4(); // yP (61893)
const tmpQuat = new THREE.Quaternion(); // bP (61894)
const tmpScale = new THREE.Vector3(); // xP (61895)
const tmpColor = new THREE.Color(); // SP (61896)
const tmpTo = new THREE.Vector3(); // CP (61897)

export type FlyerMode = 'pop' | 'rest' | 'home';

/** One loose pickup. Nuggets use an instance slot (slot >= 0); items carry their own mesh (slot -1). */
export interface Flyer {
  id: string;
  n: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Negative while waiting to appear (spawn delay). */
  age: number;
  slot: number;
  mesh?: THREE.Object3D;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  mode: FlyerMode;
  restY: number;
  /** Can fly to the miner (a gentle drop arms only once the miner stepped away). */
  armed: boolean;
  /** Waiting for the server's claim answer. */
  held: boolean;
  /** Claimed: flies in from up to 14 m. */
  eager: boolean;
}

/** room(id, incoming): how many more of id fit, given the pickups already flying in. */
export type RoomFn = (id: string, incoming: Map<string, number>) => number;
/** footGround(x, z, yHint): the floor height under a point, or null. */
export type FloorFn = (x: number, z: number, y: number) => number | null;

export class Pickups { // wP (61898)
  scene: THREE.Object3D;
  nuggets: THREE.InstancedMesh;
  free: number[] = [];
  flyers: Flyer[] = [];
  /** Id -> count already flying to the miner. */
  incoming = new Map<string, number>();
  /** Returns how many of n were taken (KR: collect). */
  onCollect: (id: string, pos: THREE.Vector3, n: number) => number = (_e, _t, n) => n;
  /** KR: backpackFull. */
  onFull: (id: string) => void = () => {};

  constructor(e: THREE.Object3D) {
    this.scene = e;
    const t = nuggetGeometry(0.1),
      n = new THREE.MeshLambertMaterial();
    ((n.onBeforeCompile = (e) => {
      e.fragmentShader = e.fragmentShader.replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * 0.28;`,
      );
    }),
      (this.nuggets = new THREE.InstancedMesh(t, n, 400)),
      (this.nuggets.frustumCulled = !1),
      (this.nuggets.castShadow = !0),
      this.nuggets.instanceMatrix.setUsage(THREE.DynamicDrawUsage));
    for (let e = 399; e >= 0; e--)
      (this.nuggets.setMatrixAt(e, tmpMat.makeScale(0, 0, 0)),
        this.nuggets.setColorAt(e, tmpColor.setRGB(1, 1, 1)),
        this.free.push(e));
    e.add(this.nuggets);
  }

  /** An ore nugget (stack of r) pops out at t after n seconds; gentle i = a soft drop that is not armed yet. */
  spawnOre(e: string, t: THREE.Vector3, n = 0, r = 1, i = !1): void {
    const a = this.free.pop();
    if (a === void 0) {
      this.onCollect(e, t, r);
      return;
    }
    (this.nuggets.setColorAt(a, tmpColor.setHex(ITEM[e].color)),
      (this.nuggets.instanceColor!.needsUpdate = !0));
    const o = Math.random() * Math.PI * 2,
      s = i ? 1.2 : 1.2 + Math.random() * 2.2;
    this.flyers.push({
      id: e,
      n: r,
      pos: t.clone(),
      vel: new THREE.Vector3(Math.cos(o) * s, i ? 3 : 3.5 + Math.random() * 2.5, Math.sin(o) * s),
      age: -n,
      slot: a,
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      mode: `pop`,
      restY: -1 / 0,
      armed: !i,
      held: !1,
      eager: !1,
    });
  }

  /** An item with its own mesh t pops out at n. r = gentle, i = held until the server's claim answer. */
  spawnGem(e: string, t: THREE.Object3D, n: THREE.Vector3, r = !1, i = !1): Flyer {
    (t.parent ? this.scene.attach(t) : this.scene.add(t), (t.visible = !0));
    const a = Math.random() * Math.PI * 2,
      o: Flyer = {
        id: e,
        n: 1,
        pos: n.clone(),
        vel: r
          ? new THREE.Vector3(Math.cos(a) * 1.4, 3.5, Math.sin(a) * 1.4)
          : new THREE.Vector3((Math.random() - 0.5) * 3, 6, (Math.random() - 0.5) * 3),
        age: 0,
        slot: -1,
        mesh: t,
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(0, 6, 0),
        mode: `pop`,
        restY: -1 / 0,
        armed: !r,
        held: i,
        eager: !1,
      };
    return (this.flyers.push(o), o);
  }

  /** The server answered a claim: t = mine (release it), else remove it and return where it was. */
  claim(e: Flyer, t: boolean): THREE.Vector3 | null {
    const n = e,
      r = this.flyers.indexOf(n);
    return r < 0
      ? null
      : t
        ? ((n.held = !1), (n.eager = !0), null)
        : (this.flyers.splice(r, 1),
          n.slot >= 0
            ? (this.nuggets.setMatrixAt(n.slot, tmpMat.makeScale(0, 0, 0)), this.free.push(n.slot))
            : n.mesh?.removeFromParent(),
          n.pos);
  }

  clear(): void {
    for (const e of this.flyers)
      e.slot >= 0
        ? (this.nuggets.setMatrixAt(e.slot, tmpMat.makeScale(0, 0, 0)), this.free.push(e.slot))
        : e.mesh?.removeFromParent();
    ((this.nuggets.instanceMatrix.needsUpdate = !0), (this.flyers = []), this.incoming.clear());
  }

  /** Adds t to the count of id e flying in. */
  pend(e: string, t: number): void {
    this.incoming.set(e, Math.max(0, (this.incoming.get(e) ?? 0) + t));
  }

  /**
   * Per frame. t = the miner's chest (pos + 1 up), n = room(id, incoming), r = floor height, i = pickup radius
   * (2.4 + magnet stat).
   */
  update(e: number, t: THREE.Vector3, n: RoomFn, r: FloorFn | null, i = 2.4): void {
    const a = this.flyers;
    let o = 0;
    for (let s = 0; s < a.length; s++) {
      const c = a[s];
      if (((c.age += e), c.age < 0)) {
        a[o++] = c;
        continue;
      }
      let l = !1;
      const u = c.pos.distanceTo(t);
      if ((!c.armed && u > i + 1.5 && (c.armed = !0), c.mode === `pop`))
        ((c.vel.y -= 16 * e),
          c.vel.multiplyScalar(Math.exp(-e * 0.6)),
          c.pos.addScaledVector(c.vel, e),
          c.age > 0.3 && c.armed && !c.held && n(c.id, this.incoming) >= 1
            ? ((c.mode = `home`), this.pend(c.id, c.n))
            : c.age > 0.3 && this.settle(c, e, r));
      else if (c.mode === `rest`)
        (this.settle(c, e, r),
          c.armed &&
            !c.held &&
            (u < i || (c.eager && u < 14)) &&
            n(c.id, this.incoming) >= 1 &&
            ((c.eager = !1),
            (c.mode = `home`),
            (c.age = 0.3),
            c.vel.set(0, 3, 0),
            this.pend(c.id, c.n)));
      else {
        const to = tmpTo.copy(t).sub(c.pos),
          dist = to.length();
        if (dist < 0.5) {
          this.pend(c.id, -c.n);
          const got = this.onCollect(c.id, c.pos, c.n);
          ((c.n -= got),
            c.n <= 0
              ? (l = !0)
              : ((c.mode = `pop`),
                (c.age = 0.31),
                c.vel.set((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3),
                (c.restY = -1 / 0),
                this.onFull(c.id)));
        } else {
          const speed = 7 + (c.age - 0.3) * 32;
          (c.vel.lerp(to.multiplyScalar(speed / dist), Math.min(1, e * 9)),
            c.pos.addScaledVector(c.vel, e));
        }
      }
      if (l) {
        c.slot >= 0
          ? (this.nuggets.setMatrixAt(c.slot, tmpMat.makeScale(0, 0, 0)), this.free.push(c.slot))
          : c.mesh && c.mesh.removeFromParent();
        continue;
      }
      const d = c.mode === `rest`,
        f = d ? 0.15 : 1;
      if (
        ((c.rot.x += c.spin.x * e * f),
        (c.rot.y += c.spin.y * e * (d ? 0.3 : 1)),
        (c.rot.z += c.spin.z * e * f),
        c.slot >= 0)
      ) {
        tmpQuat.setFromEuler(c.rot);
        const k =
          (c.n > 1 ? 1 + Math.min(1.3, Math.log2(c.n) * 0.3) : 1) *
          Math.min(1, (c.age + 0.1) * 6) *
          (c.mode === `home`
            ? Math.max(0.45, Math.min(1, tmpTo.copy(t).sub(c.pos).length() / 1.5))
            : 1);
        this.nuggets.setMatrixAt(c.slot, tmpMat.compose(c.pos, tmpQuat, tmpScale.set(k, k, k)));
      } else
        c.mesh &&
          (c.mesh.position.copy(c.pos),
          d && (c.mesh.position.y += 0.25 + Math.sin(c.age * 2) * 0.06),
          (c.mesh.rotation.y += e * (d ? 1.2 : 6)));
      a[o++] = c;
    }
    ((a.length = o),
      (this.nuggets.instanceMatrix.needsUpdate = !0),
      (this.nuggets.visible = this.free.length < this.nuggets.count));
  }

  /** Lands a flyer on the floor and bounces it to rest. */
  settle(e: Flyer, t: number, n: FloorFn | null): void {
    e.mode !== `rest` &&
      (e.mode === `pop` && e.restY === -1 / 0 && e.armed && !e.held && this.onFull(e.id),
      (e.mode = `rest`),
      (e.restY = n?.(e.pos.x, e.pos.z, e.pos.y + 0.5) ?? e.pos.y - 0.4));
    const r = e.restY + 0.07;
    if (
      (e.pos.y > r + 0.001 || e.vel.y > 0) &&
      ((e.vel.y -= 16 * t),
      (e.vel.x *= Math.exp(-t * 2)),
      (e.vel.z *= Math.exp(-t * 2)),
      e.pos.addScaledVector(e.vel, t),
      e.pos.y < r)
    ) {
      ((e.pos.y = r),
        e.vel.set(e.vel.x * 0.4, Math.abs(e.vel.y) > 1.5 ? -e.vel.y * 0.3 : 0, e.vel.z * 0.4));
      const k = n?.(e.pos.x, e.pos.z, e.pos.y + 0.5);
      k != null && (e.restY = k);
    }
  }

  /** True while any pickup is still in the air. */
  get flying(): boolean {
    return this.flyers.some((e) => e.mode !== `rest`);
  }
}
