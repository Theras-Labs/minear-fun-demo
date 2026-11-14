// Port of play-inUT-NSi.js 46046-47174: miner avatar rig eD (visuals only). Splits every clip into a
// lower-body (/L) and upper-body (/U) action, blends locomotion / idle / sit / jump / fly / burrow / drill /
// attack / emote / death each frame, then adds procedural bone turns, foot IK, squash, hat spring, blink,
// drill spin and jetpack flames. Rigid parts and worn gear merge into one skinned mesh (M4_Pieces).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFlameMaterial } from './flameMaterial';
import {
  AIMING_POSE_T,
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  BODY_PIVOT_Y,
  CHARM_FIT,
  HEAD_ANCHOR,
  HEAD_BIND_ANCHOR,
  HEAD_SCALE,
  IDENTITY_QUAT,
  IDLE_A_POSE_T,
  ITEM_FIT,
  JUMP_IDLE_POSE_T,
  LAUNCHER_FLIP_AXIS,
  MUZZLE_AXIS,
  REST_FOREARM_DIR,
  REST_HAND_DIR,
  RUN_THIGH_GAIN,
  STAFF_FOREARM_DIR,
  STAFF_RUN_DIR,
  STAFF_WALK_DIR,
  TUMBLE_HOP,
  ikFoot,
  ikGoal,
  ikHip,
  ikKnee,
  ikTmpA,
  ikTmpB,
  layeredSine,
  tmpEuler,
  tmpMatA,
  tmpMatB,
  tmpQuatA,
  tmpQuatB,
  tmpQuatC,
  tmpQuatD,
  tmpQuatE,
  tmpVecA,
  tmpVecB,
  trackNode,
} from './gearAttach';
import {
  acquireGeometry,
  bakePiece,
  clamp,
  isMergeable,
  memoMerged,
  type Piece,
  releaseGeometry,
  replaceWithNode,
  WEAR_SLOTS,
  type WearSlot,
  wrapAngle,
} from './pieces';
import {
  BODY_CLASSIC,
  DEFAULT_BIT_TINTS,
  DEFAULT_TANK_TINTS,
  MATERIAL_GRAIN,
  type MinerBody,
  OPTIONAL_BONES,
  RIG_BONES,
  type RigBoneName,
  UPPER_BODY_BONES,
} from './presets';
import { dyeMaterial, stylizeMaterial, stylizePerVertex } from './stylize';
import { BURROW_CENTER_Y } from '../player/controller';

// Scratch objects for the crawl pose (MINEAR).
const crawlTmpA = new THREE.Vector3();
const crawlTmpB = new THREE.Vector3();
const crawlTmpC = new THREE.Vector3();
const crawlTmpL = new THREE.Vector3();
const crawlQ = new THREE.Quaternion();
/** Piece nodes that belong to the jetpack (hidden when the jetpack is off). */
const JETPACK_PIECE = /^M[34]_(Tanks|TankMetal|Straps)$/;

/** Slam pose from the ultimate controller (wD.slamPose()). */
export interface SlamPose {
  phase: string; // crouch | rise | hang | dive | land
  k: number;
  len?: number;
  dir: THREE.Vector3;
}

/** Per-frame state the game passes to MinerRig.update. */
export interface MinerAnimState {
  /** Body yaw (radians). */
  yaw: number;
  /** Horizontal speed. */
  speed: number;
  onGround: boolean;
  /** Jetpack thrust 0..1. */
  thrust: number;
  /** Drill aim pose on (drilling, pointing or combat aiming). */
  drilling: boolean;
  /** Drill points at a target (smaller drill jitter). */
  point?: boolean;
  /** Combat aiming with a launcher. */
  aiming?: boolean;
  /** Boring underground (drill spin and body shake). */
  bore?: boolean;
  /** The drill (or claws) engages a target: rock, a foe or the worm. A crawling body digs toward it. */
  dig?: boolean;
  /** Burrowed and the player pushes a direction (moving through rock, not falling or drifting). */
  burrowPush?: boolean;
  /** Aim pitch (radians). */
  aimPitch: number;
  /** Vertical velocity. */
  vy: number;
  /** Full velocity; the last value is kept when missing. */
  vel?: THREE.Vector3;
  /** Burrowing (swimming through rock). */
  burrow: boolean;
  /** Camera yaw, for glance and wave. */
  lookYaw?: number;
  /** Ground height probe (x, z, y) -> height or null, for foot IK. */
  ground?: ((x: number, z: number, y: number) => number | null) | null;
  slam?: SlamPose | null;
}

/** Replication tuples sent through onAct. */
export type MinerAct =
  | [`attack`, string, number, number, number]
  | [`dash`, number, number, number]
  | [`tumble`, string, number, number]
  | [`emote`, string];

export interface MinerRigInit {
  body?: MinerBody;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

interface Gait {
  stride: number;
  offset: number;
  dur: number;
  thighMid: [number, number];
}

interface Shot {
  name: string;
  t: number;
  from: number;
  len: number;
  rate: number;
  air: boolean;
}

interface Act {
  name: string;
  t: number;
  from: number;
  len: number;
  rate: number;
  legs: number;
  full: boolean;
}

interface Worn {
  model: string | null | undefined;
  obj: THREE.Object3D;
  y: number;
  dyed: THREE.Material[];
  pieces: Piece[];
}

interface Fit {
  bone: string;
  m: THREE.Matrix4;
  local?: boolean;
}

export class MinerRig { // eD (46046)
  root = new THREE.Group();
  flames: THREE.Mesh[] = [];
  lampAnchor: THREE.Object3D;
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  acts = new Map<string, THREE.AnimationAction>();
  live: THREE.AnimationAction[] = [];
  lw = new Map<string, number>();
  uw = new Map<string, number>();
  tm = new Map<string, number>();
  bone = {} as Record<RigBoneName, THREE.Object3D>;
  procQ: THREE.Quaternion[] = [];
  drillBit: THREE.Object3D;
  flyPose = 0;
  recoilK = 0;
  dashT = -1;
  dashLen = 0.36;
  dashDir = new THREE.Vector3();
  dashK = 0;
  hat: THREE.Object3D;
  trailNodes: THREE.Object3D[] = [];
  hatBase: THREE.Vector3;
  eyes: THREE.Mesh | null = null;
  blinkIndex = -1;
  tankMats: THREE.MeshStandardMaterial[] = [];
  bitMats: THREE.MeshStandardMaterial[] = [];
  tints: { tank: THREE.Color; bit: THREE.Color } | null = null;
  shadows = true;
  pieces: Piece[] = [];
  piecesMesh: THREE.SkinnedMesh | null = null;
  piecesSig = ``;
  flameMat = createFlameMaterial();
  walk: Gait;
  run: Gait;
  ankleH = 0.1;
  time = 0;
  yaw = 0;
  tilt = 0;
  bank = 0;
  lastYaw = 0;
  squash = 0;
  hatBounce = 0;
  hatVel = 0;
  blinkT = 2.5;
  wGround = 1;
  wDrill = 0;
  shotW = 0;
  wBurrow = 0;
  fly = 0;
  /** Crawl weight 0..1, crawl pitch (radians, + is head down) and clip time (crawling bodies only). */
  crawlW = 0;
  crawlPitch = 0;
  crawlTime = 0;
  /** Jetpack worn (false hides the tank and nozzles). */
  jetpack = true;
  loco = 0;
  runK = 0;
  phase = 0;
  wasGround = true;
  shot: Shot | null = null;
  act: Act | null = null;
  actW = 0;
  deadT = -1;
  roll: { axis: THREE.Vector3; dir: number; t: number; len: number } | null = null;
  idleT = 0;
  sitT = -1;
  sitW = 0;
  fidgetT = 10;
  waveCool = 6;
  glance = 0;
  glanceUp = 0;
  drop = 0;
  footOff = [0, 0];
  scarf = [0, 0, 0, 0];
  scarfV = [0, 0, 0, 0];
  lastVel = new THREE.Vector3();
  rest = new Map<string, THREE.Matrix4>();
  wardrobe: THREE.Object3D | null = null;
  worn: Partial<Record<WearSlot, Worn>> = {};
  muzzleAxis = new THREE.Vector3(0, 0, 1);
  muzzle: THREE.Vector3 | null = null;
  pointer: { q: THREE.Quaternion; p: THREE.Vector3; c: THREE.Vector3 } | null = null;
  wAimL = 0;
  longStaff = false;
  staffW = 0;
  kickPh = 0;
  floatPh = 0;
  floatBob = 0;
  staffRest: THREE.Quaternion | null = null;
  kind: MinerBody;
  slamW = 0;
  slamPhase = ``;
  flip = 0;
  slamCrouch = 0;
  /** Replication hook: called with ['attack' | 'dash' | 'tumble' | 'emote', ...] tuples. */
  onAct: ((act: MinerAct) => void) | null = null;

  constructor(init: MinerRigInit) {
    this.kind = init.body ?? BODY_CLASSIC;
    this.body = init.scene;
    this.body.scale.setScalar(this.kind.scale);
    this.root.add(this.body);
    const names = new Set<string>();
    this.body.traverse((node) => names.add(node.name));
    const need = (name: string) => {
      const node = this.body.getObjectByName(name);
      if (!node) throw Error(`the miner model is missing node "${name}"`);
      return node;
    };
    const part = (name: string) => this.body.getObjectByName(`M4_` + name) ?? need(`M3_` + name);
    for (const name of RIG_BONES)
      this.bone[name] = OPTIONAL_BONES.has(name) ? (this.body.getObjectByName(name) ?? new THREE.Object3D()) : need(name);
    this.drillBit = part(`DrillBit`);
    this.hat = part(`Hat`);
    this.trailNodes = [this.body.getObjectByName(`handl`), this.body.getObjectByName(`handr`), this.hat].filter(
      (node): node is THREE.Object3D => !!node,
    );
    this.hatBase = this.hat.position.clone();
    this.lampAnchor = part(`LampAnchor`);
    part(`Eyes`).traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!this.eyes && mesh.isMesh && mesh.morphTargetDictionary?.Blink !== undefined) {
        this.eyes = mesh;
        this.blinkIndex = mesh.morphTargetDictionary.Blink;
      }
    });
    if (this.eyes?.morphTargetInfluences) this.eyes.morphTargetInfluences[this.blinkIndex] = 0;
    this.body.updateMatrixWorld(true);
    const toBody = tmpMatA.copy(this.body.matrixWorld).invert();
    for (const name of [`head`, `spine`, `chest`, `hips`, `handslotl`]) {
      const node = this.body.getObjectByName(name);
      if (node) this.rest.set(name, new THREE.Matrix4().multiplyMatrices(toBody, node.matrixWorld));
    }
    const seen = new Set<THREE.Material>();
    this.body.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const mat = material as THREE.MeshStandardMaterial;
        if (seen.has(mat)) continue;
        seen.add(mat);
        switch (mat.name) {
          case `M3_Eyes`:
            mat.color.setHex(0xfff2cf);
            mat.emissive.setHex(0xffd98a);
            mat.emissiveIntensity = 2.4;
            break;
          case `MI_Eyes`:
            mat.color.setHex(0xfffaf2);
            mat.emissive.setHex(0xffe6b8);
            mat.emissiveIntensity = 1.15;
            mat.roughness = 0.5;
            break;
          case `M3_LampLens`:
            mat.emissiveIntensity = 1.5;
            break;
          case `M3_Face`: {
            mat.roughness = 0.42;
            mat.metalness = 0;
            stylizeMaterial(mat, 0.02, 0.8);
            mat.userData.look = { grain: 0.02, rim: 0.8, haze: 1 };
            const stylized = mat.onBeforeCompile;
            mat.onBeforeCompile = (shader, renderer) => {
              stylized.call(mat, shader, renderer);
              shader.fragmentShader = shader.fragmentShader.replace(
                `#include <opaque_fragment>`,
                `outgoingLight += vec3(0.3, 0.18, 0.62) * pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.4) * 0.5;
#include <opaque_fragment>`,
              );
            };
            break;
          }
          case `MI_Body`:
          case `MI_Gear`: {
            const paint = this.kind.paint;
            if (paint) {
              mat.metalness = 0;
              mat.roughness = 1;
              mat.metalnessMap = null;
              mat.roughnessMap = null;
              mat.normalScale.setScalar(paint.normal);
            }
            if (mat.emissiveMap) {
              mat.emissive.setHex(0xffe6b8);
              mat.emissiveIntensity = 1;
            }
            stylizeMaterial(mat, 0.03, 1.2, paint ?? {});
            break;
          }
          default:
            stylizeMaterial(mat, MATERIAL_GRAIN[mat.name] ?? 0.06, 1.4);
            mat.userData.look = { grain: MATERIAL_GRAIN[mat.name] ?? 0.06, rim: 1.4 };
            if (mat.name === `M3_Tank`) {
              this.tankMats.push(mat);
              mat.userData.tint = 1;
            }
            if (mat.name === `M3_DrillMetal`) {
              this.bitMats.push(mat);
              mat.userData.tint = 2;
            }
        }
      }
    });
    for (const name of [`NozzleL`, `NozzleR`]) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.66, 14, 4, true).rotateX(Math.PI).translate(0, -0.33, 0),
        this.flameMat,
      );
      flame.visible = false;
      part(name).add(flame);
      this.flames.push(flame);
    }
    if (this.eyes) this.eyes.castShadow = false;
    this.merge();
    this.drillBit = part(`DrillBit`);
    this.mixer = new THREE.AnimationMixer(this.body);
    for (const clip of init.clips) {
      const tracks = clip.tracks.filter(
        (track) => names.has(trackNode(track)) && !(clip.name.startsWith(`Dodge`) && track.name === `root.position`),
      );
      for (const layer of [`L`, `U`]) {
        const layerTracks = tracks.filter((track) => UPPER_BODY_BONES.has(trackNode(track)) === (layer === `U`));
        const action = this.mixer.clipAction(new THREE.AnimationClip(`${clip.name}/${layer}`, clip.duration, layerTracks));
        action.weight = 0;
        action.play();
        this.acts.set(`${clip.name}/${layer}`, action);
      }
    }
    this.root.updateMatrixWorld(true);
    const foot = this.bone.footl.getWorldPosition(new THREE.Vector3());
    this.ankleH = foot.y;
    this.walk = this.measureGait(`Walking_A`);
    this.run = this.measureGait(`Running_A`);
    for (const action of this.acts.values()) action.weight = 0;
    this.mixer.update(0);
    for (const name of RIG_BONES) this.procQ.push(this.bone[name].quaternion.clone());
  }

  /** Merges skinned meshes that share material, map and skeleton; merges rigid parts into M4_Pieces. */
  merge(): void {
    this.body.updateMatrixWorld(true);
    const groups = new Map<string, THREE.SkinnedMesh[]>();
    const rigid: THREE.Mesh[] = [];
    this.body.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || mesh === this.eyes) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinned = mesh as THREE.SkinnedMesh;
        const key = `${mat.name}:${mat.map?.uuid ?? ``}:${skinned.skeleton.bones[0]?.uuid}:${skinned.skeleton.bones.length}`;
        let list = groups.get(key);
        if (!list) groups.set(key, (list = []));
        list.push(skinned);
      } else if (isMergeable(mesh)) rigid.push(mesh);
    });
    const merged: THREE.Mesh[] = [];
    for (const list of groups.values()) {
      const first = list[0];
      if (
        list.length < 2 ||
        !list.every(
          (mesh) =>
            mesh.parent === first.parent &&
            mesh.matrix.equals(first.matrix) &&
            mesh.bindMatrix.equals(first.bindMatrix) &&
            mesh.skeleton.bones.every((bone, i) => bone === first.skeleton.bones[i]),
        )
      )
        continue;
      const geo = memoMerged(
        list.map((mesh) => mesh.geometry),
        () => mergeGeometries(list.map((mesh) => mesh.geometry)),
      );
      if (!geo) continue;
      const mesh = new THREE.SkinnedMesh(geo, first.material);
      mesh.name = first.name;
      mesh.position.copy(first.position);
      mesh.quaternion.copy(first.quaternion);
      mesh.scale.copy(first.scale);
      first.parent!.add(mesh);
      mesh.bind(first.skeleton, first.bindMatrix);
      for (const old of list) old.removeFromParent();
      merged.push(mesh);
    }
    if (rigid.length >= 2) {
      this.pieces = rigid.map((mesh) => ({
        node: replaceWithNode(mesh),
        geo: mesh.geometry,
        mat: mesh.material as THREE.MeshStandardMaterial,
      }));
      const tank = new THREE.Color(DEFAULT_TANK_TINTS[0]);
      const bit = new THREE.Color(DEFAULT_BIT_TINTS[0]);
      this.tints = { tank, bit };
      const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
      stylizePerVertex(mat, [tank, bit]);
      const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), mat);
      mesh.name = `M4_Pieces`;
      this.body.add(mesh);
      this.piecesMesh = mesh;
      this.rebuildPieces();
      merged.push(mesh);
    }
    this.body.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.body.traverse((node) => {
      if ((node as THREE.Bone).isBone) box.expandByPoint(node.getWorldPosition(tmpVecA));
    });
    const sphere = box.expandByScalar(0.9).getBoundingSphere(new THREE.Sphere());
    this.body.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh)
        (mesh as THREE.SkinnedMesh).boundingSphere = sphere.clone().applyMatrix4(tmpMatA.copy(mesh.matrixWorld).invert());
    });
    for (const mesh of merged) mesh.castShadow = true;
  }

  /** Rebuilds the merged pieces geometry (body pieces + worn gear pieces) and rebinds its node skeleton. */
  rebuildPieces(): void {
    const mesh = this.piecesMesh;
    if (!mesh) return;
    const list: Piece[] = this.pieces.filter((p) => this.jetpack || !JETPACK_PIECE.test(p.node.name));
    for (const slot of WEAR_SLOTS) for (const piece of this.worn[slot]?.pieces ?? []) list.push(piece);
    const sig = list.map((p) => `${p.geo.uuid}:${p.mat.name}:${p.dye ?? ``}`).join(`|`);
    if (sig !== this.piecesSig) {
      const geo = acquireGeometry(sig, () => mergeGeometries(list.map((p, i) => bakePiece(p, i))));
      if (this.piecesSig) releaseGeometry(this.piecesSig);
      this.piecesSig = sig;
      mesh.geometry = geo ?? new THREE.BufferGeometry();
    }
    mesh.skeleton?.dispose();
    mesh.bind(
      new THREE.Skeleton(
        list.map((p) => p.node as THREE.Bone),
        list.map(() => new THREE.Matrix4()),
      ),
      new THREE.Matrix4(),
    );
  }

  /** Shows or hides the jetpack: its tank, metal and straps (the flames burn only with thrust). */
  setJetpack(on: boolean): void {
    if (this.jetpack === on) return;
    this.jetpack = on;
    this.body.traverse((node) => {
      if (JETPACK_PIECE.test(node.name)) node.visible = on;
    });
    this.rebuildPieces();
  }

  dispose(): void {
    if (this.piecesSig) releaseGeometry(this.piecesSig);
    this.piecesSig = ``;
    this.piecesMesh?.skeleton?.dispose();
  }

  setShadows(on: boolean): void {
    if (this.shadows === on) return;
    this.shadows = on;
    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh !== this.eyes && !this.flames.includes(mesh)) mesh.castShadow = on;
    });
  }

  /** Samples a locomotion clip 32 times: stride, phase offset of the forward foot, duration, mean thigh angles. */
  measureGait(clip: string): Gait {
    const action = this.acts.get(`${clip}/L`)!;
    const dur = action.getClip().duration;
    for (const a of this.acts.values()) a.weight = 0;
    action.weight = 1;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let offset = 0;
    const thighMid: [number, number] = [0, 0];
    for (let i = 0; i < 32; i++) {
      action.time = (i / 32) * dur;
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      const p = this.body.worldToLocal(this.bone.footl.getWorldPosition(tmpVecA));
      if (p.z > maxZ) {
        maxZ = p.z;
        offset = i / 32;
      }
      minZ = Math.min(minZ, p.z);
      thighMid[0] += this.thighAngle(this.bone.upperlegl) / 32;
      thighMid[1] += this.thighAngle(this.bone.upperlegr) / 32;
    }
    action.weight = 0;
    return { stride: Math.max(0.3, (maxZ - minZ) * 2 * this.kind.scale), offset, dur, thighMid };
  }

  thighAngle(bone: THREE.Object3D): number {
    tmpVecB.set(0, 1, 0).applyQuaternion(this.relQ(bone, tmpQuatB));
    return Math.atan2(tmpVecB.z, -tmpVecB.y);
  }

  /** Clip duration (1 when missing). */
  dur(clip: string): number {
    return this.acts.get(`${clip}/L`)?.getClip().duration ?? 1;
  }

  /** Drill bit and tank colours, and drill bit size from the drill level. */
  setLook(bitHex: number | null | undefined, tankHex: number | null | undefined, level: number): void {
    for (const mat of this.bitMats) mat.color.setHex(bitHex ?? DEFAULT_BIT_TINTS[0]);
    for (const mat of this.tankMats) mat.color.setHex(tankHex ?? DEFAULT_TANK_TINTS[0]);
    this.tints?.bit.setHex(bitHex ?? DEFAULT_BIT_TINTS[0]);
    this.tints?.tank.setHex(tankHex ?? DEFAULT_TANK_TINTS[0]);
    const s = 1 + Math.min(0.4, Math.max(0, level - 2) * 0.012);
    this.drillBit.scale.set(s, s, s);
  }

  /** The gear.glb scene that worn models are cloned from. */
  setWardrobe(scene: THREE.Object3D | null): void {
    this.wardrobe = scene;
    const seen = new Set<THREE.Material>();
    scene?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        if (!seen.has(mat)) {
          seen.add(mat);
          stylizeMaterial(mat, 0.1, 1.4);
          mat.userData.look = { grain: 0.1, rim: 1.4 };
        }
    });
  }

  /** Wears a model ("NodeName" or "NodeName#rrggbb" dye) in a slot; null / undefined takes it off. */
  wear(slot: WearSlot, model: string | null | undefined): void {
    if (this.worn[slot]?.model !== model) {
      this.dress(slot, model);
      this.rebuildPieces();
    }
  }

  dress(slot: WearSlot, model: string | null | undefined): void {
    const old = this.worn[slot];
    if (old) {
      old.obj.removeFromParent();
      for (const mat of old.dyed ?? []) mat.dispose();
      delete this.worn[slot];
    }
    if (slot === `launcher`) {
      this.muzzle = null;
      this.pointer = null;
      this.longStaff = false;
    }
    const [name, dyeText] = (model ?? ``).split(`#`);
    const src =
      (slot === `head` ? this.kind.hats : (slot !== `body` && slot !== `pack`) || this.kind.cloaks) &&
      name &&
      name !== `G_Jetpack`
        ? this.wardrobe?.getObjectByName(name)
        : null;
    if (slot === `head`) {
      this.hat.visible = !src;
      this.hat.scale.setScalar(src ? 0 : 1);
    }
    if (!src) return;
    const fit = this.fit(slot, name, src);
    const bone = this.body.getObjectByName(fit.bone);
    if (!bone) return;
    let obj = src.clone(true);
    const dyed: THREE.Material[] = [];
    if (dyeText && /^[0-9a-f]{6}$/.test(dyeText))
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.Material).clone();
        stylizeMaterial(mat, 0.1, 1.4);
        dyeMaterial(mat, parseInt(dyeText, 16));
        mesh.material = mat;
        dyed.push(mat);
      });
    (fit.local ? fit.m : tmpMatB.copy(this.rest.get(fit.bone)!).invert().multiply(fit.m)).decompose(
      obj.position,
      obj.quaternion,
      obj.scale,
    );
    obj.traverse((node) => {
      node.layers.mask = bone.layers.mask;
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = this.shadows;
    });
    bone.add(obj);
    const pieces: Piece[] = [];
    if (this.piecesMesh) {
      const meshes: THREE.Mesh[] = [];
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && isMergeable(mesh)) meshes.push(mesh);
      });
      const dye = dyeText && /^[0-9a-f]{6}$/.test(dyeText) ? parseInt(dyeText, 16) : undefined;
      for (const mesh of meshes) {
        const node = replaceWithNode(mesh);
        if (mesh === obj) obj = node;
        pieces.push({ node, geo: mesh.geometry, mat: mesh.material as THREE.MeshStandardMaterial, dye });
      }
    }
    this.worn[slot] = { model, obj, y: obj.position.y, dyed, pieces };
    if (slot === `launcher`) {
      const axis = MUZZLE_AXIS[name] ?? new THREE.Vector3(0, 0, 1);
      const box = new THREE.Box3();
      src.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!);
        }
      });
      this.muzzleAxis.copy(axis);
      if (axis.y > 0.5)
        this.pointer = {
          q: obj.quaternion.clone(),
          p: obj.position.clone(),
          c: obj.position.clone().applyQuaternion(obj.quaternion.clone().invert()),
        };
      this.longStaff = name === `G_Staff`;
      const handRest = this.longStaff ? this.rest.get(`handslotl`) : undefined;
      this.staffRest = null;
      if (handRest) {
        handRest.decompose(tmpVecA, tmpQuatA, tmpVecB);
        const q = this.body.quaternion.clone().multiply(tmpQuatA).multiply(obj.quaternion);
        tmpVecA.copy(axis).applyQuaternion(q).normalize();
        this.staffRest = new THREE.Quaternion().setFromUnitVectors(tmpVecA, AXIS_Y).multiply(q);
      }
      this.muzzle = axis.clone().multiplyScalar(box.getSize(new THREE.Vector3()).dot(axis) / 2);
    }
  }

  /** Bone and transform for a worn model in a slot. */
  fit(slot: WearSlot, name: string, node: THREE.Object3D): Fit {
    const bind = node.userData.bind as number[] | undefined;
    const p = bind ? new THREE.Vector3(bind[0], bind[2], -bind[1]) : new THREE.Vector3();
    const item = ITEM_FIT[name] ?? {};
    const s = (item.s ?? 1) * (slot === `launcher` || slot === `charm1` || slot === `charm2` ? this.kind.gearK : 1);
    const rx = new THREE.Quaternion().setFromAxisAngle(AXIS_X, item.rx ?? 0);
    const scale = new THREE.Vector3();
    if (slot === `head`) {
      const k = this.kind.head?.k ?? HEAD_SCALE;
      const at = p
        .sub(HEAD_BIND_ANCHOR)
        .multiplyScalar(k)
        .add(this.kind.head?.at ?? HEAD_ANCHOR);
      at.y += ((item.y ?? 0) * k) / HEAD_SCALE;
      at.z += ((item.z ?? 0) * k) / HEAD_SCALE;
      return { bone: `head`, m: new THREE.Matrix4().compose(at, rx, scale.setScalar(k * s)) };
    }
    if (slot === `body`) {
      p.y += item.y ?? 0;
      p.z += item.z ?? 0;
      return {
        bone: name === `G_GraveCloak` ? `chest` : `spine`,
        m: new THREE.Matrix4().compose(p, rx, scale.setScalar(s)),
      };
    }
    if (slot === `launcher`) {
      const q = new THREE.Quaternion().setFromRotationMatrix(
        tmpMatA.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)),
      );
      return {
        bone: `handslotl`,
        m: new THREE.Matrix4().compose(p.multiplyScalar(s).applyQuaternion(q), q, scale.setScalar(s)),
        local: true,
      };
    }
    if (slot === `pack`) {
      // tmpEuler keeps the rotation order of its last use (YXZ after the first update), as in the original.
      const q = new THREE.Quaternion().setFromEuler(tmpEuler.set(0.1, 0, 0.45));
      return {
        bone: `chest`,
        m: new THREE.Matrix4().compose(
          new THREE.Vector3(-0.28, 1 + (item.y ?? 0), -0.43 + (item.z ?? 0)),
          q,
          scale.setScalar(0.85 * s),
        ),
      };
    }
    const charm = CHARM_FIT[name] ?? { rot: [0, 0, 0], s: 0.45 };
    const side = slot === `charm1` ? 1 : -1;
    const q = new THREE.Quaternion().setFromEuler(tmpEuler.set(charm.rot[0], charm.rot[1] * side, charm.rot[2] * side));
    const hip = this.kind.hip;
    return {
      bone: `hips`,
      m: new THREE.Matrix4().compose(
        new THREE.Vector3(hip.x * side, hip.y + (charm.y ?? 0), hip.z),
        q,
        scale.setScalar(charm.s * s),
      ),
    };
  }

  /** World position of the worn launcher's muzzle, or null. */
  launcherTip(out: THREE.Vector3): THREE.Vector3 | null {
    const worn = this.worn.launcher;
    return !worn || !this.muzzle ? null : worn.obj.localToWorld(out.copy(this.muzzle));
  }

  /** Plays an upper-body (and optional legs) attack clip; returns its length in seconds (0 when missing). */
  attack(clip: string, opts: { from?: number; rate?: number; legs?: number; full?: boolean } = {}): number {
    if (!this.acts.has(`${clip}/U`)) return 0;
    const from = opts.from ?? 0;
    const rate = opts.rate ?? 1;
    const len = (this.dur(clip) - from) / rate;
    this.act = { name: clip, t: 0, from, len, rate, legs: opts.legs ?? 1, full: !!opts.full };
    this.shot = null;
    this.idleT = 0;
    this.sitT = -1;
    this.onAct?.([`attack`, clip, Math.round(rate * 100) / 100, opts.legs ?? 1, opts.full ? 1 : 0]);
    return len;
  }

  get attacking(): boolean {
    return this.act !== null;
  }

  drillTip(out: THREE.Vector3): THREE.Vector3 {
    return this.drillBit.localToWorld(out.set(0, 0.36, 0));
  }

  recoil(): void {
    this.recoilK = 1;
  }

  /** World points of the hands and hat (hat +0.12 y), for dash trails. */
  trailPoints(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = this.trailNodes.length;
    for (let i = 0; i < this.trailNodes.length; i++) {
      out[i] = this.trailNodes[i].getWorldPosition(out[i] ?? new THREE.Vector3());
      if (this.trailNodes[i] === this.hat) out[i].y += 0.12;
    }
    return out;
  }

  drillAxis(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).transformDirection(this.drillBit.matrixWorld);
  }

  dash(dx: number, dz: number, len: number): void {
    const d = Math.hypot(dx, dz) || 1;
    this.dashDir.set(dx / d, 0, dz / d);
    this.dashLen = len;
    this.dashT = 0;
    this.squash = Math.max(this.squash, 0.07);
    this.onAct?.([
      `dash`,
      Math.round((dx / d) * 100) / 100,
      Math.round((dz / d) * 100) / 100,
      Math.round(len * 100) / 100,
    ]);
  }

  tumble(axis: string, dir: number, len: number): void {
    this.roll = { axis: axis === `x` ? AXIS_X : AXIS_Z, dir, t: 0, len };
    this.onAct?.([`tumble`, axis, dir, len]);
  }

  die(): void {
    this.act = null;
    this.shot = null;
    this.deadT = 0;
  }

  revive(): void {
    this.deadT = -1;
  }

  slamLand(): void {
    this.squash = Math.max(this.squash, 0.24);
    this.hatVel -= 3.5;
  }

  land(impactSpeed: number): void {
    this.squash = Math.min(0.22, impactSpeed * 0.014);
    this.hatVel -= Math.min(4, impactSpeed * 0.25);
    if (impactSpeed > 8) this.startShot(`Jump_Land`, { from: 0.05, rate: 1.25 });
  }

  emote(clip: string): void {
    if (this.acts.has(`${clip}/L`)) {
      this.startShot(clip, {});
      this.onAct?.([`emote`, clip]);
    }
  }

  startShot(clip: string, opts: { from?: number; rate?: number; air?: boolean }): void {
    const from = opts.from ?? 0;
    const rate = opts.rate ?? 1;
    this.shot = { name: clip, t: 0, from, len: (this.dur(clip) - from) / rate, rate, air: !!opts.air };
  }

  put(weights: Map<string, number>, clip: string, w: number, time: number): void {
    if (w <= 1e-4) return;
    weights.set(clip, (weights.get(clip) ?? 0) + w);
    this.tm.set(clip, time);
  }

  both(clip: string, w: number, time: number): void {
    this.put(this.lw, clip, w, time);
    this.put(this.uw, clip, w, time);
  }

  /** Scales the other weights of a layer by (1 - w) and adds this clip at w. */
  over(weights: Map<string, number>, clip: string, w: number, time: number): void {
    if (w <= 1e-4) return;
    for (const [k, v] of weights) weights.set(k, v * (1 - w));
    this.put(weights, clip, w, time);
  }

  /** Rotation of a node relative to the rig root. */
  relQ(node: THREE.Object3D | null, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    for (let n = node; n && n !== this.root; n = n.parent) out.premultiply(n.quaternion);
    return out;
  }

  /** Applies a root-space rotation to a bone. */
  turnQ(bone: THREE.Object3D, q: THREE.Quaternion): void {
    this.relQ(bone.parent, tmpQuatB);
    tmpQuatC.copy(tmpQuatB).invert().multiply(q).multiply(tmpQuatB);
    bone.quaternion.premultiply(tmpQuatC);
  }

  /** Turns a bone about a root-space axis. */
  turn(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    this.turnQ(bone, tmpQuatA.setFromAxisAngle(axis, angle));
  }

  /** Aims the worn launcher's muzzle axis along a root-space direction with the left upper arm. */
  aimArmL(dir: THREE.Vector3, w: number): void {
    const worn = this.worn.launcher;
    if (!worn || w < 0.001) return;
    this.relQ(worn.obj, tmpQuatB);
    tmpVecB.copy(this.muzzleAxis).applyQuaternion(tmpQuatB).normalize();
    tmpQuatA.setFromUnitVectors(tmpVecB, dir);
    this.turnQ(this.bone.upperarml, tmpQuatA.slerp(IDENTITY_QUAT, 1 - w));
  }

  /** Points a bone's +Y along a root-space direction. */
  point(bone: THREE.Object3D, dir: THREE.Vector3, w: number): void {
    if (w < 0.001) return;
    this.relQ(bone, tmpQuatB);
    tmpVecB.set(0, 1, 0).applyQuaternion(tmpQuatB).normalize();
    tmpQuatA.setFromUnitVectors(tmpVecB, dir);
    this.turnQ(bone, tmpQuatA.slerp(IDENTITY_QUAT, 1 - w));
  }

  /** Aims the drill (+Y of the drill bit) along a root-space direction with the right upper arm. */
  aimArm(dir: THREE.Vector3, w: number): void {
    if (w < 0.001) return;
    this.relQ(this.drillBit, tmpQuatB);
    tmpVecB.set(0, 1, 0).applyQuaternion(tmpQuatB).normalize();
    tmpQuatA.setFromUnitVectors(tmpVecB, dir);
    this.turnQ(this.bone.upperarmr, tmpQuatA.slerp(IDENTITY_QUAT, 1 - w));
  }

  /**
   * Per-frame pose. The game sets root.position to the player position before this call, then calls
   * setOpacity and root.updateMatrixWorld(true) after it.
   */
  update(dt: number, st: MinerAnimState): void {
    this.time += dt;
    const time = this.time;
    const lerp = (a: number, b: number, rate: number) => a + (b - a) * Math.min(1, dt * rate);
    const slam = st.slam ?? null;
    this.slamW = lerp(this.slamW, slam ? 1 : 0, slam ? 18 : 6);
    if ((slam?.phase ?? ``) !== this.slamPhase) {
      this.slamPhase = slam?.phase ?? ``;
      if (slam?.phase === `crouch`) this.squash = Math.max(this.squash, 0.12);
      if (slam?.phase === `land`) this.slamLand();
    }
    if (slam) {
      this.shot = null;
      this.act = null;
    }
    const riseK = slam?.phase === `rise` ? clamp((slam.k - 0.06) / 0.86, 0, 1) : 0;
    this.flip = riseK > 0 && riseK < 1 ? Math.PI * 2 * riseK * riseK * riseK * (riseK * (riseK * 6 - 15) + 10) : 0;
    this.slamCrouch = slam
      ? (slam.phase === `crouch` ? slam.k : slam.phase === `land` ? 1 : 0) * this.slamW
      : lerp(this.slamCrouch, 0, 8);
    this.wBurrow = lerp(this.wBurrow, st.burrow ? 1 : 0, 6);
    const vel = st.vel ?? this.lastVel;
    const vlen = vel.length();
    // A clawed body (nearmol) has no drill: it crawls to burrow, else it holds the normal pose (no swim pose).
    const claws = !!this.kind.claws;
    this.fly = lerp(this.fly, st.burrow && !st.drilling && !claws ? clamp((vlen - 0.6) / 5, 0, 1) : 0, 5);
    let yawTarget = st.yaw;
    let burrowPitch = 0;
    if (st.burrow && vlen > 0.6 && !st.drilling) {
      yawTarget = Math.atan2(vel.x, vel.z);
      const climb = Math.asin(clamp(vel.y / vlen, -1, 1));
      if (Math.abs(climb) > 1.35) yawTarget = this.yaw;
      burrowPitch = (Math.PI / 2 - climb) * 0.92;
    }
    this.yaw += wrapAngle(yawTarget - this.yaw) * Math.min(1, dt * (st.burrow ? 7 : 12));
    // Crawling bodies (nearmol, no drill model) crawl whenever they dig: the claws on rock, a foe or the
    // worm (any direction, above or below ground), and pushing through rock. The body points along the dig
    // direction (the clip lies face down: level = 0, head down = +pi/2, head up = -pi/2).
    // Not digging, they go back to the normal pose.
    const crawl = this.kind.crawl;
    if (crawl) {
      let want = 0;
      let pitch = 0;
      const drillDig = (st.dig || (st.burrow && st.drilling)) && !slam && this.deadT < 0;
      if (drillDig) {
        want = 1;
        pitch = clamp(-st.aimPitch, -Math.PI / 2, Math.PI / 2);
      } else if (st.burrow && st.burrowPush && vlen > 0.4) {
        want = clamp((vlen - 0.4) / 0.8, 0, 1);
        pitch = -Math.asin(clamp(vel.y / vlen, -1, 1));
      }
      this.crawlW = lerp(this.crawlW, want, want > this.crawlW ? 6 : 4);
      this.crawlPitch = lerp(this.crawlPitch, want > 0 ? pitch : 0, 6);
      this.crawlTime += dt * (st.burrow && !drillDig ? clamp(vlen / 2.5, 0.6, 2.2) : 1.5);
    }
    const crawlW = this.crawlW;
    const slamTilt = slam
      ? slam.phase === `crouch`
        ? 0.3 * slam.k
        : slam.phase === `rise`
          ? 0.12
          : slam.phase === `hang`
            ? -0.2
            : slam.phase === `dive`
              ? 0.8
              : 0.32
      : 0;
    this.tilt = lerp(
      this.tilt,
      slam ? slamTilt : crawl ? this.crawlPitch * crawlW : burrowPitch * this.fly,
      slam ? 16 : 7,
    );
    const yawRate = wrapAngle(this.yaw - this.lastYaw) / Math.max(dt, 0.001);
    this.lastYaw = this.yaw;
    this.wGround = lerp(this.wGround, st.onGround ? 1 : 0, st.onGround ? 14 : 8);
    this.wDrill = lerp(this.wDrill, st.drilling ? 1 : 0, 12);
    const burrowW = this.wBurrow; // f
    const groundW = this.wGround * (1 - burrowW); // p
    const airW = (1 - this.wGround) * (1 - burrowW); // m
    this.bank = lerp(this.bank, clamp(-yawRate * st.speed * 0.008, -0.18, 0.18) * groundW, 8);
    this.root.quaternion.setFromEuler(tmpEuler.set(this.tilt + this.flip, this.yaw, this.bank, `YXZ`));
    if (this.flip !== 0) {
      tmpQuatA.setFromEuler(tmpEuler.set(this.tilt, this.yaw, this.bank, `YXZ`));
      tmpVecA.set(0, BODY_PIVOT_Y, 0).applyQuaternion(tmpQuatA);
      tmpVecB.set(0, BODY_PIVOT_Y, 0).applyQuaternion(this.root.quaternion);
      this.root.position.add(tmpVecA.sub(tmpVecB));
    }
    if (crawl && crawlW > 0.001) {
      // The lying body (raised by `lift`) turns about its nose on the ground (digging down from open
      // ground), its rear (digging up), or its middle, held at the burrow collision centre (burrowed).
      const s = this.kind.scale;
      const lift = crawlTmpL.set(0, crawl.lift * s, 0);
      crawlQ.setFromAxisAngle(AXIS_Y, this.yaw);
      const nose = crawlTmpA.copy(this.crawlPitch >= 0 ? crawl.nose : crawl.tail).multiplyScalar(s);
      const dig = crawlTmpB.copy(nose).applyQuaternion(crawlQ).sub(nose.sub(lift).applyQuaternion(this.root.quaternion));
      const mid = crawlTmpA.copy(crawl.center).multiplyScalar(s).sub(lift).applyQuaternion(this.root.quaternion);
      const swim = mid.negate().add(crawlTmpC.set(0, BURROW_CENTER_Y, 0));
      this.root.position.addScaledVector(dig.lerp(swim, this.wBurrow), crawlW);
    }
    if (!st.onGround && this.wasGround && st.vy > 2.5 && !st.burrow && !slam)
      this.startShot(`Jump_Start`, { from: 0.22, rate: 1.4, air: true });
    this.wasGround = st.onGround;
    if (this.dashT >= 0) {
      this.dashT += dt;
      if (this.dashT > this.dashLen + 0.2) this.dashT = -1;
    }
    this.dashK =
      this.dashT < 0
        ? 0
        : Math.min(1, this.dashT / 0.06) *
          (1 - THREE.MathUtils.smoothstep(this.dashT, this.dashLen * 0.55, this.dashLen + 0.2));
    const groundSpeed = st.onGround && !st.burrow && this.dashT < 0 ? st.speed : 0; // h
    this.loco = lerp(this.loco, groundSpeed > 0.4 ? 1 : 0, groundSpeed > 0.4 ? 10 : 7);
    this.runK = lerp(this.runK, clamp((groundSpeed - 2) / 2.6, 0, 1), 6);
    const loco = this.loco; // g
    const stride = THREE.MathUtils.lerp(this.walk.stride, this.run.stride * 1.5, this.runK);
    const cadence = THREE.MathUtils.lerp(1.9 / this.walk.dur, 2.5 / this.run.dur, this.runK);
    if (groundSpeed > 0.05) this.phase = (this.phase + dt * Math.min(groundSpeed / stride, cadence)) % 1;
    if (groundW * (1 - loco) * (1 - this.wDrill) > 0.9 && !st.drilling) this.idleT += dt;
    else this.idleT = 0;
    if (this.idleT === 0) this.sitT = -1;
    else if (this.idleT > 26 && this.sitT < 0 && !this.shot) this.sitT = 0;
    if (this.sitT >= 0) this.sitT += dt;
    this.sitW = lerp(this.sitW, this.sitT >= 0 ? 1 : 0, this.sitT >= 0 ? 4 : 9);
    this.fidgetT -= dt;
    this.waveCool -= dt;
    const lookOff = st.lookYaw === undefined ? 0 : wrapAngle(st.lookYaw - this.yaw); // y
    if (!this.shot && this.sitT < 0 && this.idleT > 2.5) {
      if (Math.abs(lookOff) > 2.5 && this.waveCool < 0) {
        this.startShot(`Waving`, { rate: 1.1 });
        this.waveCool = 25;
      } else if (this.fidgetT < 0) {
        this.startShot(`Idle_B`, {});
        this.fidgetT = 9 + Math.random() * 9;
      }
    }
    this.flyPose = lerp(this.flyPose, airW * (this.deadT >= 0 || this.roll ? 0 : 1), 6);
    this.lw.clear();
    this.uw.clear();
    this.tm.clear();

    // Base layers: idle, sit, walk, run, air.
    const standW = groundW * (1 - loco); // b
    const sitDownDur = this.dur(`Sit_Floor_Down`); // x
    const sitK = this.sitT >= 0 ? clamp((this.sitT - sitDownDur + 0.25) / 0.25, 0, 1) : 1; // S
    this.both(`Idle_A`, standW * (1 - this.sitW), time % this.dur(`Idle_A`));
    this.both(`Sit_Floor_Down`, standW * this.sitW * (1 - sitK), Math.max(0, this.sitT));
    this.both(`Sit_Floor_Idle`, standW * this.sitW * sitK, Math.max(0, this.sitT - sitDownDur) % this.dur(`Sit_Floor_Idle`));
    this.both(`Walking_A`, groundW * loco * (1 - this.runK), ((this.phase + this.walk.offset) % 1) * this.walk.dur);
    this.both(`Running_A`, groundW * loco * this.runK, ((this.phase + this.run.offset) % 1) * this.run.dur);
    this.put(this.lw, `Jump_Idle`, airW, JUMP_IDLE_POSE_T);
    this.put(this.uw, `Idle_A`, airW, IDLE_A_POSE_T);

    // One-shot clips (jump start / land, wave, fidget, emotes).
    const shot = this.shot;
    this.shotW = 0;
    if (shot) {
      shot.t += dt;
      if (shot.t >= shot.len || (shot.air ? st.onGround || burrowW > 0.5 : !st.onGround || loco > 0.6 || burrowW > 0.5))
        this.shot = null;
      else {
        const w =
          Math.min(1, shot.t / 0.12) *
          Math.min(1, (shot.len - shot.t) / 0.22) *
          (shot.air ? 1 - this.wGround : 1 - loco);
        const at = shot.from + shot.t * shot.rate;
        this.over(this.lw, shot.name, w, at);
        this.over(this.uw, shot.name, w, at);
        this.shotW = w;
      }
    }
    if (burrowW > 0.001) {
      this.over(this.lw, `Jump_Idle`, burrowW * (1 - this.fly * 0.75), JUMP_IDLE_POSE_T);
      this.over(this.lw, ``, burrowW * this.fly * 0.75, 0);
      if (claws) this.over(this.uw, `Idle_A`, burrowW, IDLE_A_POSE_T);
      else this.over(this.uw, `Ranged_1H_Aiming`, burrowW, AIMING_POSE_T);
    }
    if (!claws) this.over(this.uw, `Ranged_1H_Aiming`, this.wDrill * (1 - this.flyPose), AIMING_POSE_T);
    if (crawlW > 0.001) {
      const at = this.crawlTime % this.dur(`Crawling`);
      this.over(this.lw, `Crawling`, crawlW, at);
      this.over(this.uw, `Crawling`, crawlW, at);
    }

    // Attack clip.
    const act = this.act;
    this.actW = 0;
    if (act) {
      act.t += dt;
      if (act.t >= act.len) this.act = null;
      else {
        this.actW = Math.min(1, act.t / 0.05) * Math.min(1, (act.len - act.t) / 0.14);
        const at = act.from + act.t * act.rate;
        this.over(this.uw, act.name, this.actW, at);
        this.over(this.lw, act.name, this.actW * (act.full ? 1 : act.legs * (1 - loco)) * (1 - burrowW) * this.wGround, at);
      }
    }
    if (this.deadT >= 0) {
      this.deadT += dt;
      const deathDur = this.dur(`Death_A`);
      const at = Math.min(this.deadT * 1.1, deathDur - 0.001);
      this.over(this.lw, `Death_A`, 1, at);
      this.over(this.uw, `Death_A`, 1, at);
    }

    // Apply normalized layer weights to the actions.
    for (const action of this.live) action.weight = 0;
    this.live.length = 0;
    for (const [weights, layer] of [
      [this.lw, `L`],
      [this.uw, `U`],
    ] as const) {
      let sum = 0;
      for (const w of weights.values()) sum += w;
      if (sum < 1e-4) continue;
      for (const [clip, w] of weights) {
        const action = clip && this.acts.get(`${clip}/${layer}`);
        if (action) {
          action.weight = w / sum;
          action.time = clamp(this.tm.get(clip) ?? 0, 0, action.getClip().duration - 1e-4);
          this.live.push(action);
        }
      }
    }
    // Restore last frame's mixer pose (without procedural turns), evaluate, and keep the result.
    for (let i = 0; i < RIG_BONES.length; i++) this.bone[RIG_BONES[i]].quaternion.copy(this.procQ[i]);
    this.mixer.update(0);
    for (let i = 0; i < RIG_BONES.length; i++) this.procQ[i].copy(this.bone[RIG_BONES[i]].quaternion);

    const T = this.bone;
    const thighK = RUN_THIGH_GAIN * this.runK * loco * groundW * (this.act?.full ? 1 - this.actW : 1) * (1 - crawlW); // E
    if (thighK > 0.01) {
      this.turn(T.upperlegl, AXIS_X, -(this.thighAngle(T.upperlegl) - this.run.thighMid[0]) * thighK);
      this.turn(T.upperlegr, AXIS_X, -(this.thighAngle(T.upperlegr) - this.run.thighMid[1]) * thighK);
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const fwd = clamp((vel.x * sy + vel.z * cy) / 9, -0.5, 1); // ee
    const side = clamp((vel.x * cy - vel.z * sy) / 9, -1, 1); // k
    const flyW = this.flyPose * (1 - this.actW) * (this.shot ? 0.4 : 1) * (1 - this.slamW); // te
    if (flyW > 0.001) {
      const fall = clamp(-vel.y / 9, 0, 1) * (1 - 0.6 * st.thrust);
      const armNoise = layeredSine(time, 0.4, 1.13, 1.91, 3.07) * 0.06;
      const armOut = 0.3 + 0.12 * st.thrust;
      const armFwd = 0.12 + 0.5 * Math.max(0, fwd) + 0.12 * st.thrust;
      this.turn(T.upperarml, AXIS_Z, (armOut + armNoise) * flyW);
      this.turn(T.upperarml, AXIS_X, (armFwd + layeredSine(time, 2.1, 0.87, 1.53, 2.71) * 0.05) * flyW);
      this.turn(T.upperarmr, AXIS_Z, -(armOut - armNoise) * flyW);
      this.turn(T.upperarmr, AXIS_X, (armFwd + layeredSine(time, 4.6, 0.79, 1.67, 2.93) * 0.05) * flyW);
      const legFwd = (0.08 + 0.42 * Math.max(0, fwd)) * flyW;
      this.turn(T.upperlegl, AXIS_X, legFwd + (layeredSine(time, 1.3, 1.29, 2.17, 3.71) * 0.11 - fall * 0.3) * flyW);
      this.turn(T.upperlegr, AXIS_X, legFwd * 0.8 + (layeredSine(time, 3.8, 1.07, 2.39, 3.43) * 0.11 - fall * 0.24) * flyW);
      this.turn(T.lowerlegl, AXIS_X, (layeredSine(time, 5.2, 1.41, 2.53, 3.97) * 0.09 + fall * 0.35) * flyW);
      this.turn(T.lowerlegr, AXIS_X, (layeredSine(time, 0.9, 1.23, 2.61, 4.13) * 0.09 + fall * 0.3) * flyW);
      this.turn(T.spine, AXIS_X, layeredSine(time, 2.9, 0.71, 1.37, 2.33) * 0.03 * flyW);
      this.turn(T.hips, AXIS_X, 0.26 * fwd * flyW);
      this.turn(T.hips, AXIS_Z, (-side * 0.16 + layeredSine(time, 6.1, 0.63, 1.19, 2.07) * 0.025) * flyW);
      this.floatPh += ((2 * Math.PI) / 2.6) * dt;
      const bobW = flyW * (1 - clamp((vlen - 2) / 8, 0, 0.7));
      const ph = this.floatPh;
      this.floatBob = Math.sin(ph) * 0.035 * bobW;
      this.turn(T.upperlegl, AXIS_X, Math.sin(ph - 0.7) * 0.07 * bobW);
      this.turn(T.upperlegr, AXIS_X, Math.sin(ph - 1.2) * 0.07 * bobW);
      this.turn(T.lowerlegl, AXIS_X, (0.5 - 0.5 * Math.cos(ph - 0.9)) * 0.14 * bobW);
      this.turn(T.lowerlegr, AXIS_X, (0.5 - 0.5 * Math.cos(ph - 1.4)) * 0.14 * bobW);
      this.turn(T.upperarml, AXIS_Z, -Math.sin(ph) * 0.05 * bobW);
      this.turn(T.upperarmr, AXIS_Z, Math.sin(ph) * 0.05 * bobW);
      this.turn(T.spine, AXIS_X, Math.sin(ph - 0.5) * 0.025 * bobW);
    } else this.floatBob = 0;

    // Rest pose of the drill arm (none for a clawed body: its right hand swings free), and the long staff hold.
    const restW = // ne
      (claws ? 0 : 1) *
      (1 - Math.max(this.wDrill, burrowW)) *
      (1 - this.actW) *
      (1 - this.shotW) *
      (1 - this.slamW) *
      (this.deadT >= 0 ? 0 : 1);
    if (restW > 0.001) {
      this.turn(T.upperarmr, AXIS_X, -0.18 * restW);
      this.turn(T.upperarmr, AXIS_Z, 0.12 * restW);
      this.point(T.lowerarmr, REST_FOREARM_DIR, 0.9 * restW);
      this.point(T.handr, REST_HAND_DIR, restW);
    }
    this.staffW = this.longStaff
      ? (1 - this.wAimL) * (1 - this.actW) * (1 - this.shotW) * (1 - this.slamW) * (this.deadT >= 0 ? 0 : 1)
      : 0;
    if (this.staffW > 0.001) {
      this.turn(T.upperarml, AXIS_Z, 0.28 * this.staffW);
      this.point(T.lowerarml, STAFF_FOREARM_DIR, 0.85 * this.staffW);
    }

    // Drill aim.
    const aimW = claws ? 0 : Math.max(this.wDrill, burrowW) * (1 - this.actW) * (this.deadT >= 0 ? 0 : 1) * (1 - crawlW); // re
    if (aimW > 0.001) {
      const pitch = clamp(st.aimPitch, -1.25, 1.25);
      const dir = tmpVecA.set(0, Math.sin(pitch), Math.cos(pitch));
      dir.lerp(AXIS_Y, this.fly).normalize();
      this.aimArm(dir, aimW);
      this.turn(T.chest, AXIS_X, -pitch * 0.22 * this.wDrill * (1 - burrowW));
      if (st.drilling) {
        const jitter = st.point ? 0.3 : 1;
        this.turn(T.chest, AXIS_Z, (Math.random() - 0.5) * 0.05 * jitter);
        this.turn(T.upperarmr, AXIS_X, (Math.random() - 0.5) * 0.06 * jitter);
      }
    }

    // Dash lean.
    if (this.dashK > 0.001) {
      const k = this.dashK;
      tmpVecA.crossVectors(AXIS_Y, this.dashDir).normalize();
      this.turn(T.spine, tmpVecA, 0.3 * k);
      this.turn(T.chest, tmpVecA, 0.1 * k);
      const sideK = Math.abs(this.dashDir.x) * k;
      const fwdK = this.dashDir.z * k;
      this.turn(T.upperlegl, AXIS_Z, 0.24 * sideK);
      this.turn(T.upperlegr, AXIS_Z, -0.24 * sideK);
      this.turn(T.upperlegl, AXIS_X, -0.32 * fwdK);
      this.turn(T.upperlegr, AXIS_X, 0.32 * fwdK);
    }

    // Slam arm and body.
    const slamPoseW = this.slamW * (this.deadT >= 0 ? 0 : 1); // A
    if (slam && slamPoseW > 0.001) {
      let dir: THREE.Vector3;
      switch (slam.phase) {
        case `crouch`:
          dir = tmpVecA.set(0, -0.8, 0.6);
          break;
        case `rise`:
          dir = tmpVecA.set(0, 0.35, 1);
          break;
        case `hang`:
          dir = tmpVecA.set(0, 1, -0.4);
          break;
        case `dive`:
          dir = tmpVecA.copy(slam.dir).applyQuaternion(tmpQuatA.copy(this.root.quaternion).invert());
          break;
        default:
          dir = tmpVecA.set(0, -1, 0.45);
      }
      this.aimArm(dir.normalize(), slamPoseW);
      if (slam.phase === `crouch`) this.turn(T.spine, AXIS_X, 0.32 * slam.k * slamPoseW);
      else if (slam.phase === `hang`) {
        this.turn(T.chest, AXIS_X, -0.28 * slamPoseW);
        this.turn(T.upperarml, AXIS_Z, 1 * slamPoseW);
      } else if (slam.phase === `dive`) {
        this.turn(T.upperarml, AXIS_X, 0.9 * slamPoseW);
        this.turn(T.upperlegl, AXIS_X, 0.5 * slamPoseW);
        this.turn(T.upperlegr, AXIS_X, 0.35 * slamPoseW);
      } else if (slam.phase === `land`) {
        this.turn(T.spine, AXIS_X, 0.4 * slamPoseW);
        this.turn(T.head, AXIS_X, 0.25 * slamPoseW);
        this.turn(T.upperarml, AXIS_Z, 0.85 * slamPoseW);
        this.turn(T.upperarml, AXIS_X, 0.35 * slamPoseW);
      }
    }

    // Recoil.
    this.recoilK = Math.max(0, this.recoilK - dt * 6);
    if (this.recoilK > 0) {
      const k = this.recoilK * this.recoilK;
      this.turn(T.upperarmr, AXIS_X, -k * 0.55);
      this.turn(T.chest, AXIS_X, -k * 0.14);
    }

    // Launcher: flip while aiming, long staff carry, left arm aim.
    this.wAimL = lerp(this.wAimL, st.aiming && this.worn.launcher ? 1 : 0, 14);
    const launcher = this.worn.launcher;
    const pointer = this.pointer;
    if (launcher && pointer) {
      tmpQuatD.setFromAxisAngle(LAUNCHER_FLIP_AXIS, Math.PI * this.wAimL);
      launcher.obj.quaternion.copy(tmpQuatD).multiply(pointer.q);
      if (this.staffW > 0.001 && this.staffRest) {
        const carry = tmpVecA.copy(STAFF_WALK_DIR).lerp(STAFF_RUN_DIR, this.runK * loco).normalize();
        tmpQuatE.setFromUnitVectors(AXIS_Y, carry).multiply(this.staffRest);
        this.relQ(launcher.obj.parent, tmpQuatB);
        tmpQuatC.copy(tmpQuatB).multiply(launcher.obj.quaternion).slerp(tmpQuatE, this.staffW);
        launcher.obj.quaternion.copy(tmpQuatB.invert()).multiply(tmpQuatC);
      }
      launcher.obj.position.copy(pointer.c).applyQuaternion(launcher.obj.quaternion);
    }
    if (this.wAimL > 0.001) {
      const pitch = clamp(st.aimPitch, -1.25, 1.25);
      this.aimArmL(
        tmpVecA.set(0, Math.sin(pitch), Math.cos(pitch)),
        this.wAimL * (1 - this.actW) * (this.deadT >= 0 ? 0 : 1),
      );
    }

    // Burrow swim kick and sway.
    this.kickPh += dt * (6 + Math.min(vlen, 12) * 0.5);
    const swimW = burrowW * (1 - crawlW); // a crawling body swims with its clip instead
    if (this.fly > 0.01) {
      const kick = Math.sin(this.kickPh) * (0.2 + layeredSine(time, 2.4, 0.61, 1.17, 1.93) * 0.04) * this.fly * swimW;
      this.turn(T.upperlegl, AXIS_X, kick);
      this.turn(T.upperlegr, AXIS_X, -kick);
      this.turn(T.head, AXIS_X, -0.8 * this.fly * swimW);
    }
    if (swimW > 0.001) {
      this.turn(T.chest, AXIS_X, layeredSine(time, 1.7, 0.67, 1.29, 2.21) * 0.035 * swimW);
      this.turn(T.chest, AXIS_Y, layeredSine(time, 3.3, 0.53, 1.11, 1.97) * 0.045 * swimW);
      this.turn(T.upperlegl, AXIS_X, layeredSine(time, 5.1, 0.97, 1.83, 2.89) * 0.08 * swimW * (1 - this.fly));
      this.turn(T.upperlegr, AXIS_X, layeredSine(time, 0.7, 1.03, 1.71, 3.11) * 0.08 * swimW * (1 - this.fly));
    }

    // Glance toward the camera yaw and pitch.
    const glanceT = // ae
      clamp(lookOff, -0.85, 0.85) *
      (1 - loco * 0.6) *
      (1 - this.wDrill) *
      (1 - burrowW) *
      (Math.abs(lookOff) < 2.3 ? 1 : 0);
    this.glance = lerp(this.glance, glanceT, 4);
    this.glanceUp = lerp(this.glanceUp, clamp(-st.aimPitch * 0.3, -0.22, 0.28) * (1 - burrowW) * (1 - crawlW), 5);
    this.turn(T.head, AXIS_Y, this.glance * 0.65);
    this.turn(T.chest, AXIS_Y, this.glance * 0.18);
    this.turn(T.head, AXIS_X, this.glanceUp);

    // Scarf springs.
    const cy2 = Math.cos(this.yaw);
    const sy2 = Math.sin(this.yaw);
    const vFwd = vel.x * sy2 + vel.z * cy2; // ce
    const vSide = vel.x * cy2 - vel.z * sy2; // le
    const accel = tmpVecB.copy(vel).sub(this.lastVel).divideScalar(Math.max(dt, 0.001)); // ue
    this.lastVel.copy(vel);
    const flutter = Math.min(1, (Math.abs(vFwd) + Math.abs(vSide) + Math.abs(vel.y)) / 8 + st.thrust * 0.5); // de
    const lift = clamp(-vel.y * 0.07 + vFwd * 0.03 - accel.y * 0.002, -0.2, 1.2) * (1 - burrowW) + 0.9 * this.fly; // fe
    for (let s = 0; s < 2; s++) {
      const stiff = 60 - s * 18;
      const pitchT = -lift * (1 - s * 0.15) - Math.sin(time * 7 + s * 1.3) * 0.1 * flutter;
      const swayT = -vSide * 0.05 + (0.2 + Math.sin(time * 9.5 + s * 0.9) * 0.18) * flutter;
      for (const [i, target] of [
        [s * 2, pitchT],
        [s * 2 + 1, swayT],
      ]) {
        this.scarfV[i] += ((target - this.scarf[i]) * stiff - this.scarfV[i] * 8) * dt;
        this.scarf[i] += this.scarfV[i] * dt;
      }
      this.scarf[s * 2] = clamp(this.scarf[s * 2], -1.6, 0.15);
      const scarfBone = s === 0 ? T.scarf1 : T.scarf2;
      this.turn(scarfBone, AXIS_X, this.scarf[s * 2]);
      this.turn(scarfBone, AXIS_Z, this.scarf[s * 2 + 1]);
    }
    this.plantFeet(dt, st, groundW * (1 - crawlW));

    // Tumble roll about the body pivot.
    const roll = this.roll;
    if (roll) {
      roll.t += dt;
      const k = Math.min(1, roll.t / roll.len);
      const ease = k * k * (3 - 2 * k);
      tmpQuatA.setFromAxisAngle(roll.axis, ease * Math.PI * 2 * roll.dir);
      this.body.quaternion.copy(tmpQuatA);
      tmpVecA.set(0, BODY_PIVOT_Y, 0);
      tmpVecB.copy(tmpVecA).applyQuaternion(tmpQuatA);
      this.body.position.x = tmpVecA.x - tmpVecB.x;
      this.body.position.y += tmpVecA.y - tmpVecB.y + Math.sin(Math.PI * k) * TUMBLE_HOP;
      this.body.position.z = tmpVecA.z - tmpVecB.z;
      if (k >= 1) {
        this.roll = null;
        this.body.quaternion.identity();
        this.body.position.x = this.body.position.z = 0;
      }
    }

    // Squash and stretch.
    this.squash *= Math.exp(-dt * 9);
    const stretch = !st.onGround && !st.burrow ? clamp(st.vy * 0.004, -0.04, 0.05) : 0;
    const sq = this.squash;
    this.root.scale.set(1 + sq * 0.45 - stretch * 0.5, 1 - sq + stretch, 1 + sq * 0.45 - stretch * 0.5);

    // Hat spring.
    const runBob = loco * this.runK * Math.max(0, -Math.cos(this.phase * Math.PI * 4)) * 0.5;
    const hatAcc = -this.hatBounce * 220 - this.hatVel * 14 - runBob * 16;
    this.hatVel += hatAcc * dt;
    this.hatBounce += this.hatVel * dt;
    this.hat.position.copy(this.hatBase);
    this.hat.position.y += this.hatBounce * 0.035;
    const head = this.worn.head;
    if (head) head.obj.position.y = head.y + this.hatBounce * 0.035;

    // Drill spin, bore shake, blink.
    if (st.drilling || st.bore || this.act || (slam && slam.phase !== `crouch`)) this.drillBit.rotateY(dt * (slam ? 70 : 40));
    if (st.bore && !st.drilling) {
      this.root.position.x += (Math.random() - 0.5) * 0.03;
      this.root.position.y += (Math.random() - 0.5) * 0.03;
    }
    this.blinkT -= dt;
    if (this.blinkT <= 0) this.blinkT = 2.2 + Math.random() * 3.5;
    if (this.eyes?.morphTargetInfluences) {
      const sleepy = this.sitT > 20 ? 0.55 + Math.sin(time * 0.6) * 0.2 : 0;
      this.eyes.morphTargetInfluences[this.blinkIndex] = this.blinkT < 0.12 ? 1 : sleepy;
    }

    // Jetpack flames.
    this.flameMat.uniforms.uTime.value = time;
    this.flameMat.uniforms.uPower.value = Math.min(1, st.thrust * 1.3);
    for (const flame of this.flames) {
      flame.visible = st.thrust > 0.01;
      const n = st.thrust * (0.8 + Math.random() * 0.45);
      flame.scale.set(0.8 + n * 0.4, n * 1.4, 0.8 + n * 0.4);
    }
  }

  /** Foot IK on terrain (st.ground) and body drop; sets body.position.y. */
  plantFeet(dt: number, st: MinerAnimState, groundW: number): void {
    const lerp = (a: number, b: number, rate: number) => a + (b - a) * Math.min(1, dt * rate);
    const bone = this.bone;
    const feet = [bone.footl, bone.footr];
    const plant = !!(st.ground && st.onGround && groundW > 0.3 && this.deadT < 0 && !this.roll);
    if (plant) {
      this.body.position.y = 0;
      this.root.updateMatrixWorld(true);
      const rootPos = this.root.position;
      for (let i = 0; i < 2; i++) {
        feet[i].getWorldPosition(tmpVecA);
        const gy = st.ground!(tmpVecA.x, tmpVecA.z, rootPos.y);
        const off = gy === null ? 0 : clamp(gy - rootPos.y, -0.3, 0.3);
        this.footOff[i] = lerp(this.footOff[i], off, 16);
      }
    } else {
      this.footOff[0] = lerp(this.footOff[0], 0, 10);
      this.footOff[1] = lerp(this.footOff[1], 0, 10);
    }
    this.drop = lerp(this.drop, Math.min(0, this.footOff[0], this.footOff[1]) * groundW, 14);
    const crouch = plant ? 0.19 * this.dashK + 0.34 * this.slamCrouch : 0;
    this.body.position.y = this.drop - crouch + this.floatBob;
    if (!plant) return;
    this.root.updateMatrixWorld(true);
    const scale = this.kind.scale * this.root.scale.y;
    for (let i = 0; i < 2; i++) {
      const lift = (this.footOff[i] - this.drop) * groundW + crouch;
      if (lift < 0.004) continue;
      const footH = feet[i].getWorldPosition(tmpVecA).y - this.root.position.y - this.drop - this.ankleH;
      const gate = 1 - THREE.MathUtils.smoothstep(footH, 0.03, 0.14);
      if (gate < 0.01) continue;
      this.legIK(i === 0 ? bone.upperlegl : bone.upperlegr, i === 0 ? bone.lowerlegl : bone.lowerlegr, feet[i], (lift * gate) / scale);
    }
  }

  /** Two-bone leg IK (law of cosines): raises the foot by `lift` in body space, keeps the foot rotation. */
  legIK(upper: THREE.Object3D, lower: THREE.Object3D, foot: THREE.Object3D, lift: number): void {
    const local = (node: THREE.Object3D, out: THREE.Vector3) => this.body.worldToLocal(node.getWorldPosition(out));
    const footQ = this.relQ(foot, new THREE.Quaternion());
    local(upper, ikHip);
    local(lower, ikKnee);
    local(foot, ikFoot);
    ikGoal.copy(ikFoot);
    ikGoal.y += lift;
    const thigh = ikHip.distanceTo(ikKnee); // o
    const shin = ikKnee.distanceTo(ikFoot); // s
    const reach = clamp(ikHip.distanceTo(ikGoal), 0.01, (thigh + shin) * 0.999); // c
    const toFoot = tmpVecA.subVectors(ikFoot, ikHip).normalize(); // l
    const toKnee = tmpVecB.subVectors(ikKnee, ikHip).normalize(); // u
    const hipNow = Math.acos(clamp(toFoot.dot(toKnee), -1, 1)); // d
    const kneeNow = Math.acos(
      clamp(ikTmpB.subVectors(ikHip, ikKnee).normalize().dot(ikTmpA.subVectors(ikFoot, ikKnee).normalize()), -1, 1),
    ); // f
    const swing = Math.acos(clamp(toFoot.dot(ikTmpB.subVectors(ikGoal, ikHip).normalize()), -1, 1)); // p
    const hipGoal = Math.acos(clamp((shin * shin - thigh * thigh - reach * reach) / (-2 * thigh * reach), -1, 1)); // m
    const kneeGoal = Math.acos(clamp((reach * reach - thigh * thigh - shin * shin) / (-2 * thigh * shin), -1, 1)); // h
    ikTmpA.crossVectors(toFoot, toKnee);
    if (ikTmpA.lengthSq() < 1e-8) ikTmpA.set(-1, 0, 0);
    ikTmpA.normalize();
    ikTmpB.crossVectors(toFoot, ikTmpB.subVectors(ikGoal, ikHip).normalize());
    this.turn(upper, ikTmpA, hipGoal - hipNow);
    this.turn(lower, ikTmpA, kneeGoal - kneeNow);
    if (ikTmpB.lengthSq() > 1e-10) this.turn(upper, ikTmpB.normalize(), swing);
    foot.quaternion.copy(this.relQ(foot.parent, tmpQuatB).invert().multiply(footQ));
  }

  /** Hides the miner (first-person close camera). */
  setOpacity(hidden: boolean): void {
    this.root.visible = !hidden;
  }
}
