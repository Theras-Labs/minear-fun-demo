// Port of play-inUT-NSi.js 29866-30055: kinematic player movement controller Jm.
// Walk relative to the camera yaw, sprint, jump with coyote time, jetpack with fuel, dodge dash, burrow mode
// (free 3D swim with a smaller sphere) and the lift to the hub with a portal warp. Collision is a capsule
// shapecast against the three-mesh-bvh bounds trees of nearby chunk meshes.
import * as THREE from 'three';
import type { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';
import { CAPSULE_HEIGHT, CAPSULE_RADIUS, JUMP_SPEED, LIFT_POINT, WALK_SPEED } from '../world/constants';

const Rm = CAPSULE_RADIUS; // Rm (29866) = Tp = 0.42
/** zm (29867): collision sphere radius in burrow mode. */
export const BURROW_RADIUS = 0.62; // zm (29867)
/** Bm (29868): body centre height above pos used by the game in burrow mode (drill origin, openness probe). */
export const BURROW_CENTER_Y = 0.85; // Bm (29868)

const Vm = new THREE.Line3(); // capsule segment in mesh space
const Hm = new THREE.Vector3(); // closest point on the triangle
const Um = new THREE.Vector3(); // closest point on the segment
const Wm = new THREE.Box3(); // query box
const Gm = new THREE.Matrix4(); // inverse mesh matrix
const Km = new THREE.Vector3();
const qm = new THREE.Vector3();

/** Jet stats (game state `jet`: fuelMax 100+fuel, thrust 38+min(20, fuel*0.025), burn 24, regen 32+fuel*0.3). */
export interface JetStats {
  fuelMax: number;
  regen: number;
  thrust: number;
  burn: number;
}

/** The input fields the controller reads (Input, or the null input qR when the game is not accepting input). */
export interface MoveInput {
  moveX?: number;
  moveY?: number;
  down(code: string): boolean;
  hit(code: string): boolean;
}

/** A mesh the controller can collide with: geometry.boundsTree from computeBoundsTree. */
export type ColliderMesh = THREE.Mesh & { geometry: THREE.BufferGeometry & { boundsTree?: MeshBVH } };
/** Returns the meshes inside the box (KR passes its `colliders` = world.collidersIn + hub/stranger/mirror colliders). */
export type ColliderQuery = (box: THREE.Box3) => readonly THREE.Mesh[];

export class PlayerController { // Jm (29876)
  stats: JetStats;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  onGround = false;
  groundTimer = 0;
  yaw = 0;
  fuel = 100;
  /** 0..1 visual jet/burrow thrust. */
  thrust = 0;
  lifting = false;
  liftPortalY = Infinity;
  onLiftWarp: () => void = () => {};
  warped = false;
  /** Largest landing impact speed since the game last read and cleared it. */
  landed = 0;
  speedMul = 1;
  grip = 1;
  jumpHeld = 0;
  airTime = 0;
  lastVy = 0;
  dodgeT = 0;
  dodgeLen = 1;
  dodgeV = new THREE.Vector3();
  /** Jetpack worn (MINEAR: the player can take it off; without it Space only jumps). */
  jetpackOn = true;
  constructor(stats: JetStats) {
    this.stats = stats;
    this.fuel = stats.fuelMax;
  }
  dodge(dx: number, dz: number, speed: number, duration: number): void {
    const len = Math.hypot(dx, dz) || 1;
    this.dodgeV.set((dx / len) * speed, 0, (dz / len) * speed);
    this.dodgeT = this.dodgeLen = duration;
  }
  get dodging(): boolean {
    return this.dodgeT > 0;
  }
  cancelDodge(): void {
    this.dodgeT = 0;
  }
  stopLift(): void {
    this.lifting = false;
    this.warped = false;
  }
  updateBurrow(dt: number, targetVel: THREE.Vector3, colliders: ColliderQuery, frozen: boolean): void {
    this.onGround = false;
    this.lifting = false;
    if (frozen) return;
    const k = 1 - Math.exp(-dt * 5.5);
    this.vel.lerp(targetVel, k);
    this.thrust = Math.min(1, this.vel.length() / 7);
    const step = dt / 4;
    for (let i = 0; i < 4; i++) {
      this.pos.addScaledVector(this.vel, step);
      this.collide(colliders, BURROW_RADIUS, true);
    }
    this.fuel = Math.min(this.stats.fuelMax, this.fuel + this.stats.regen * dt);
  }
  update(
    dt: number,
    input: MoveInput,
    cameraYaw: number,
    colliders: ColliderQuery,
    inLiftZone: (pos: THREE.Vector3) => boolean,
    liftTopY: number,
    frozen: boolean,
  ): void {
    if (frozen) return;
    const sx = input.moveX ?? 0;
    const sy = input.moveY ?? 0;
    const stick = sx !== 0 || sy !== 0;
    const fwd = stick ? sy : Number(input.down(`KeyW`)) - Number(input.down(`KeyS`));
    const side = stick ? sx : Number(input.down(`KeyD`)) - Number(input.down(`KeyA`));
    const s = Math.sin(cameraYaw);
    const c = Math.cos(cameraYaw);
    const rx = -c;
    const rz = s;
    let wx = s * fwd + rx * side;
    let wz = c * fwd + rz * side;
    const wlen = Math.hypot(wx, wz);
    const sprint = input.down(`ShiftLeft`) ? 1.35 : 1;
    const mag = stick ? Math.min(1, Math.hypot(sx, sy)) : 1;
    if (wlen > 0) {
      wx = (wx / wlen) * WALK_SPEED * sprint * this.speedMul * mag;
      wz = (wz / wlen) * WALK_SPEED * sprint * this.speedMul * mag;
      if (this.dodgeT <= 0) this.yaw = Math.atan2(wx, wz);
    }
    if (!this.lifting && inLiftZone(this.pos) && this.pos.y < liftTopY - 2) this.lifting = true;
    if (this.lifting) {
      const tx = LIFT_POINT.x - this.pos.x;
      const tz = LIFT_POINT.z - this.pos.z;
      this.vel.x += (tx * 6 - this.vel.x) * Math.min(1, dt * 5);
      this.vel.z += (tz * 6 - this.vel.z) * Math.min(1, dt * 5);
      this.vel.y += ((this.warped ? 5 : 18) - this.vel.y) * Math.min(1, dt * 3);
      this.pos.addScaledVector(this.vel, dt);
      this.thrust = 0;
      if (!this.warped && this.pos.y + 3.4 > this.liftPortalY) {
        this.warped = true;
        this.pos.set(LIFT_POINT.x, liftTopY - 1.4, LIFT_POINT.z);
        this.vel.set(0, 9, 0);
        this.onLiftWarp();
      }
      if (this.pos.y > liftTopY + 1.4) {
        this.lifting = false;
        this.warped = false;
        this.vel.set(0, 3, 0);
      }
      this.fuel = Math.min(this.stats.fuelMax, this.fuel + this.stats.fuelMax * dt);
      this.onGround = false;
      return;
    }
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const f = 0.45 + 0.55 * Math.max(0, this.dodgeT / this.dodgeLen);
      this.vel.x = this.dodgeV.x * f;
      this.vel.z = this.dodgeV.z * f;
    } else {
      const accel = this.onGround ? 55 : 14;
      const air = Math.min(1, (accel * dt) / Math.max(1, Math.hypot(wx - this.vel.x, wz - this.vel.z)));
      this.vel.x += (wx - this.vel.x) * (this.onGround ? Math.min(1, dt * 14 * this.grip) : air);
      this.vel.z += (wz - this.vel.z) * (this.onGround ? Math.min(1, dt * 14 * this.grip) : air);
    }
    const space = input.down(`Space`);
    if (input.hit(`Space`) && this.groundTimer > 0) {
      this.vel.y = JUMP_SPEED;
      this.groundTimer = 0;
      this.jumpHeld = 0;
    }
    if (space) this.jumpHeld += dt;
    else this.jumpHeld = 0;
    const jet = this.jetpackOn && space && this.fuel > 0 && (!this.onGround || this.jumpHeld > 0.2) && this.airTime > 0.12;
    if (jet) {
      const t = this.vel.y < 0 ? this.stats.thrust * 1.6 : this.stats.thrust;
      this.vel.y += t * dt;
      if (this.vel.y > 11) this.vel.y = 11;
      this.fuel = Math.max(0, this.fuel - this.stats.burn * dt);
      this.thrust = Math.min(1, this.thrust + dt * 8);
    } else this.thrust = Math.max(0, this.thrust - dt * 6);
    this.vel.y -= 24 * dt;
    if (this.vel.y < -42) this.vel.y = -42;
    const sub = dt / 5;
    let grounded = false;
    this.lastVy = this.vel.y;
    for (let i = 0; i < 5; i++) {
      this.pos.addScaledVector(this.vel, sub);
      if (this.collide(colliders)) grounded = true;
    }
    if (!grounded && this.onGround && this.vel.y <= 0.5 && !jet) {
      const y0 = this.pos.y;
      for (let i = 0; i < 7 && !grounded; i++) {
        this.pos.y -= 0.09;
        if (this.collide(colliders)) grounded = true;
      }
      if (grounded) this.vel.y = Math.min(this.vel.y, 0);
      else this.pos.y = y0;
    }
    if (grounded && !this.onGround && this.airTime > 0.25) this.landed = Math.max(this.landed, -this.lastVy);
    this.onGround = grounded;
    if (grounded) {
      this.groundTimer = 0.12;
      this.airTime = 0;
      this.fuel = Math.min(this.stats.fuelMax, this.fuel + this.stats.regen * dt);
    } else {
      this.groundTimer -= dt;
      this.airTime += dt;
    }
  }
  /**
   * Capsule (or burrow sphere-ish segment) vs bounds trees. Pushes pos out, removes velocity into the surface.
   * Returns true when a hit normal had y > 0.5 (standing on ground).
   */
  collide(colliders: ColliderQuery, r = Rm, burrow = false): boolean {
    let grounded = false;
    const lo = burrow ? 0.84 : r;
    const hi = burrow ? 0.86 : CAPSULE_HEIGHT - r;
    Wm.min.set(this.pos.x - r - 0.5, this.pos.y + lo - r - 0.5, this.pos.z - r - 0.5);
    Wm.max.set(this.pos.x + r + 0.5, this.pos.y + hi + r + 0.5, this.pos.z + r + 0.5);
    const meshes = colliders(Wm);
    for (const mesh of meshes as readonly ColliderMesh[]) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;
      Gm.copy(mesh.matrixWorld).invert();
      Km.set(this.pos.x, this.pos.y + lo, this.pos.z);
      Vm.start.copy(Km).applyMatrix4(Gm);
      Vm.end.set(this.pos.x, this.pos.y + hi, this.pos.z).applyMatrix4(Gm);
      const box = new THREE.Box3().setFromPoints([Vm.start, Vm.end]).expandByScalar(r);
      let hit = false;
      bvh.shapecast({
        intersectsBounds: (b: THREE.Box3) => b.intersectsBox(box),
        intersectsTriangle: (tri: ExtendedTriangle) => {
          const d = tri.closestPointToSegment(Vm, Hm, Um);
          if (d < r) {
            const depth = r - d;
            const n = Um.sub(Hm).normalize();
            if (!burrow && n.y > 0.6) {
              const up = Math.min(depth / n.y, r);
              Vm.start.y += up;
              Vm.end.y += up;
            } else {
              Vm.start.addScaledVector(n, depth);
              Vm.end.addScaledVector(n, depth);
            }
            if (n.y > 0.5) grounded = true;
            hit = true;
          }
          return false;
        },
      });
      if (!hit) continue;
      Vm.start.applyMatrix4(mesh.matrixWorld);
      qm.subVectors(Vm.start, Km);
      this.pos.add(qm);
      const len = qm.length();
      if (len > 1e-6) {
        qm.multiplyScalar(1 / len);
        const into = this.vel.dot(qm);
        if (into < 0) this.vel.addScaledVector(qm, -into);
      }
    }
    return grounded;
  }
}
