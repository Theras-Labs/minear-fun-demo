// Port of play-inUT-NSi.js 53189-53270: third-person follow camera BA.
// Over-the-shoulder orbit camera driven by mouse/touch deltas. The pivot sits at head height pushed to the right
// shoulder; head->pivot and pivot->camera rays against nearby collision meshes snap the camera in when blocked
// and ease it back out. Burrow mode uses a lower pivot, a short max distance and no collision test.
// Owns the screen shake and the FOV kick.
import * as THREE from 'three';

/** RA (53189): shared raycaster; firstHitOnly is read by three-mesh-bvh acceleratedRaycast. */
const RA = new THREE.Raycaster(); // RA (53189)
RA.firstHitOnly = true;
const zA = new THREE.Box3(); // zA (53191)

/** The input fields the camera reads (Input, or the null input qR). */
export interface LookInput {
  mouseDX: number;
  mouseDY: number;
  wheel: number;
}

/** Returns the meshes inside the box (KR passes its `colliders`). */
export type CameraColliderQuery = (box: THREE.Box3) => readonly THREE.Object3D[];

export class FollowCamera { // BA (53192)
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = -0.28;
  dist = 5.4;
  targetDist = 5.4;
  shake = 0;
  fovKick = 0;
  extra = 0;
  pivot = new THREE.Vector3();
  dir = new THREE.Vector3();
  sensitivity = 0.0022;
  invertY = false;
  curDist = 5.4;
  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.08, 1500);
  }
  update(
    dt: number,
    input: LookInput,
    playerPos: THREE.Vector3,
    colliders: CameraColliderQuery,
    burrow = false,
  ): void {
    this.yaw -= input.mouseDX * this.sensitivity;
    this.pitch -= input.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, burrow ? 1.5 : 1.15);
    if (input.wheel) this.targetDist = THREE.MathUtils.clamp(this.targetDist + input.wheel * 0.8, 2.2, 13);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    if (burrow) {
      this.pivot.set(playerPos.x, playerPos.y + 0.95, playerPos.z).addScaledVector(right, 0.35);
      const want = Math.min(this.targetDist, 7);
      this.curDist += (want - this.curDist) * Math.min(1, dt * 4);
      this.dist = this.curDist;
      this.place(dt);
      return;
    }
    const head = new THREE.Vector3(playerPos.x, playerPos.y + 1.45, playerPos.z);
    const shoulder = 0.55 * THREE.MathUtils.clamp(this.targetDist / 6, 0.3, 1);
    this.pivot.copy(head).addScaledVector(right, shoulder);
    zA.setFromPoints([head, this.pivot]).expandByScalar(1);
    let meshes = colliders(zA);
    const toPivot = this.pivot.clone().sub(head);
    const pivotLen = toPivot.length();
    if (pivotLen > 0.01) {
      RA.set(head, toPivot.normalize());
      RA.far = pivotLen + 0.3;
      const hit = RA.intersectObjects(meshes as THREE.Object3D[], false)[0];
      if (hit) this.pivot.copy(head).addScaledVector(toPivot, Math.max(0, hit.distance - 0.3));
    }
    const back = this.dir.clone().negate();
    const full = this.targetDist + this.extra;
    const end = this.pivot.clone().addScaledVector(back, full);
    zA.setFromPoints([this.pivot, end]).expandByScalar(1);
    meshes = colliders(zA);
    RA.set(this.pivot, back);
    RA.far = full + 0.4;
    const hit = RA.intersectObjects(meshes as THREE.Object3D[], false)[0];
    const d = hit ? Math.max(0.35, hit.distance - 0.4) : full;
    if (d < this.curDist) this.curDist = d;
    else this.curDist += (d - this.curDist) * Math.min(1, dt * 3);
    this.dist = this.curDist;
    this.place(dt);
  }
  place(dt: number): void {
    const cam = this.camera;
    cam.position.copy(this.pivot).addScaledVector(this.dir, -this.curDist);
    const look = this.pivot.clone().addScaledVector(this.dir, 10);
    cam.lookAt(look);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.1;
    }
    const fov = 68 + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 5);
      cam.updateProjectionMatrix();
    }
  }
  addShake(amount: number): void {
    this.shake = Math.min(1, Math.max(this.shake, amount));
  }
}
