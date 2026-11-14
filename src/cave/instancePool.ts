// Port of play-inUT-NSi.js lines 42592-42639 (and the temps jC, MC, HC of 42396-42407): the fixed-capacity
// InstancedMesh pool of the cave decor (iw). Swap-remove allocation: each slot keeps its owner record, and
// the owner's slot index moves with the last instance when a slot is freed.
import * as THREE from 'three';

const tmpMatrix = new THREE.Matrix4(); // jC (42396)
const tmpColor = new THREE.Color(); // MC (42397)
/** Zero-scale matrix: a hidden instance. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // HC (42407)

/** An instance owner: `slot` is updated when the pool moves the instance. */
export interface PoolOwner {
  slot: number;
}

export class InstancePool<O extends PoolOwner = PoolOwner> { // iw (42592)
  cap: number;
  mesh: THREE.InstancedMesh;
  owner: (O | null)[] = [];
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, HIDDEN);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }
  /** Adds an instance; returns its slot, or -1 when the pool is full. */
  alloc(matrix: THREE.Matrix4, color: THREE.Color, owner: O): number {
    const slot = this.mesh.count;
    if (slot >= this.cap) return -1;
    this.mesh.setMatrixAt(slot, matrix);
    this.mesh.setColorAt(slot, color);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.owner[slot] = owner;
    this.mesh.count = slot + 1;
    this.mesh.visible = true;
    return slot;
  }
  /** Frees a slot: the last instance moves into it. */
  release(slot: number): void {
    const last = this.mesh.count - 1;
    if (slot < 0 || slot > last) return;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, tmpMatrix);
      this.mesh.setMatrixAt(slot, tmpMatrix);
      this.mesh.getColorAt(last, tmpColor);
      this.mesh.setColorAt(slot, tmpColor);
      this.mesh.instanceColor!.needsUpdate = true;
      const moved = this.owner[last]!;
      this.owner[slot] = moved;
      moved.slot = slot;
    }
    this.owner[last] = null;
    this.mesh.setMatrixAt(last, HIDDEN);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = last;
    this.mesh.visible = last > 0;
  }
}
