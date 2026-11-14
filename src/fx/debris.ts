// Port of play-inUT-NSi.js 53077-53188: debris rock shards IA (geometry) and LA (instanced pool that bounces on voxels).
import * as THREE from 'three';

const tmpColor = new THREE.Color();

/** IA (53077): a lumpy icosahedron shard. */
function shardGeometry(radius = 0.12) {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const lumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let s = lumps.get(key);
    if (s === undefined) {
      s = 0.78 + Math.random() * 0.4;
      lumps.set(key, s);
    }
    v.multiplyScalar(s);
    pos.setXYZ(i, v.x * 1.15, v.y * 0.8, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export interface SolidQuery {
  solid(x: number, y: number, z: number): boolean;
}

interface Shard {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  s: number;
}

/** LA (53092) */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private ds: (Shard | null)[] = [];
  private next = 0;
  private live = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new THREE.Vector3();

  constructor(readonly cap: number, readonly world: SolidQuery) {
    const mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(shardGeometry(), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) {
      this.ds.push(null);
      this.mesh.setColorAt(i, white);
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  burst(at: THREE.Vector3, color: number | THREE.Color, count: number, dir?: THREE.Vector3, speed = 4) {
    const c = typeof color === 'number' ? tmpColor.setHex(color) : color;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.3, (Math.random() - 0.5) * 2)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      if (dir) v.addScaledVector(dir, speed * 0.6);
      const life = 0.9 + Math.random() * 0.9;
      if (!this.ds[i]) this.live++;
      this.ds[i] = {
        p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)),
        v,
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        life,
        max: life,
        s: 0.45 + Math.random() * 0.9,
      };
      const shade = 0.75 + Math.random() * 0.35;
      this.mesh.setColorAt(i, tmpColor.copy(c).multiplyScalar(shade));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      const d = this.ds[i];
      if (!d) continue;
      d.life -= dt;
      if (d.life <= 0) {
        this.ds[i] = null;
        this.live--;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      d.v.y -= 22 * dt;
      d.p.addScaledVector(d.v, dt);
      if (this.world.solid(Math.round(d.p.x), Math.round(d.p.y), Math.round(d.p.z))) {
        d.p.addScaledVector(d.v, -dt);
        d.v.y = Math.abs(d.v.y) * 0.35;
        d.v.x *= 0.5;
        d.v.z *= 0.5;
        d.spin.multiplyScalar(0.6);
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      const k = d.life / d.max;
      const s = d.s * Math.min(1, k * 4);
      this.q.setFromEuler(d.rot);
      this.m.compose(d.p, this.q, this.sv.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.live > 0;
  }
}
