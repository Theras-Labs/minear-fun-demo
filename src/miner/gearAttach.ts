// Port of play-inUT-NSi.js 45835-45892: miner rig constants, shared scratch math objects, gear fit tables.
import * as THREE from 'three';

export const RUN_THIGH_GAIN = 0.5; // $T (45835) run thigh correction gain
export const BODY_PIVOT_Y = 0.72; // eE (45836) flip / tumble pivot height
export const TUMBLE_HOP = 0.3; // tE (45837) tumble hop height

// Shared scratch objects (module level in the original, shared by every rig).
export const tmpQuatA = new THREE.Quaternion(); // nE (45838)
export const tmpQuatB = new THREE.Quaternion(); // rE (45839)
export const tmpQuatC = new THREE.Quaternion(); // iE (45840)
export const tmpVecA = new THREE.Vector3(); // aE (45841)
export const tmpVecB = new THREE.Vector3(); // oE (45842)
export const tmpEuler = new THREE.Euler(); // sE (45843)
export const ikHip = new THREE.Vector3(); // cE (45844)
export const ikKnee = new THREE.Vector3(); // lE (45845)
export const ikFoot = new THREE.Vector3(); // uE (45846)
export const ikGoal = new THREE.Vector3(); // dE (45847)
export const ikTmpA = new THREE.Vector3(); // fE (45848)
export const ikTmpB = new THREE.Vector3(); // pE (45849)
export const IDENTITY_QUAT = new THREE.Quaternion(); // mE (45850)
export const AXIS_X = new THREE.Vector3(1, 0, 0); // hE (45851)
export const AXIS_Y = new THREE.Vector3(0, 1, 0); // gE (45852)
export const AXIS_Z = new THREE.Vector3(0, 0, 1); // _E (45853)

/** Head point of the gear bind pose that hats are authored around. */
export const HEAD_BIND_ANCHOR = new THREE.Vector3(0, 1.73, 0.02); // vE (45854)
/** Default head anchor of the miner (classic body). */
export const HEAD_ANCHOR = new THREE.Vector3(0, 1.612, -0.014); // yE (45855)
/** Default hat scale of the miner (classic body). */
export const HEAD_SCALE = 0.84; // bE (45856)

export interface ItemFit {
  s?: number;
  rx?: number;
  y?: number;
  z?: number;
}
/** Per-item fit overrides. */
export const ITEM_FIT: Record<string, ItemFit> = { G_HardHat: { s: 1 / HEAD_SCALE } }; // xE (45857)

export interface CharmFit {
  rot: [number, number, number];
  s: number;
  y?: number;
}
/** Held / hip charm transforms. */
export const CHARM_FIT: Record<string, CharmFit> = { // SE (45858)
  G_Mug: { rot: [0, -0.5, 0], s: 0.42 },
  G_Tome: { rot: [0, 0, 0.15], s: 0.5 },
  G_SmokeBomb: { rot: [0, 0, 0], s: 0.5 },
  G_ShieldRound: { rot: [0, Math.PI / 2, 0], s: 0.42 },
  G_ShieldSpikes: { rot: [0, Math.PI / 2, 0], s: 0.38 },
  G_ShieldBadge: { rot: [0, Math.PI / 2, 0], s: 0.4 },
  G_BoneShield: { rot: [0, Math.PI / 2, 0], s: 0.42 },
  G_Dagger: { rot: [0.15, 0, Math.PI], s: 0.5, y: -0.05 },
  G_Axe: { rot: [0, Math.PI / 2, Math.PI], s: 0.45 },
  G_Arrows: { rot: [0.3, 0, 0.2], s: 0.5, y: 0.1 },
};

/** Local forward (muzzle) axis of launcher items. */
export const MUZZLE_AXIS: Record<string, THREE.Vector3> = { // CE (45870)
  G_Crossbow1H: new THREE.Vector3(0, 0, 1),
  G_Crossbow2H: new THREE.Vector3(0, 0, 1),
  G_BoneCrossbow: new THREE.Vector3(0, 0, 1),
  G_Wand: new THREE.Vector3(0, 1, 0),
  G_Staff: new THREE.Vector3(0, 1, 0),
};

export const tmpMatA = new THREE.Matrix4(); // wE (45877)
export const tmpMatB = new THREE.Matrix4(); // TE (45878)
export const tmpQuatD = new THREE.Quaternion(); // EE (45879)
export const LAUNCHER_FLIP_AXIS = new THREE.Vector3(0, 0, 1); // DE (45880)
export const REST_FOREARM_DIR = new THREE.Vector3(0.3, 0.08, 1).normalize(); // OE (45881)
export const REST_HAND_DIR = new THREE.Vector3(-0.15, 1, 0.8).normalize(); // kE (45882)
export const STAFF_FOREARM_DIR = new THREE.Vector3(0.3, -0.12, 1).normalize(); // AE (45883)
export const STAFF_WALK_DIR = new THREE.Vector3(0.2, 1, 0.06).normalize(); // jE (45884)
export const STAFF_RUN_DIR = new THREE.Vector3(0.24, 1, 0.38).normalize(); // ME (45885)
export const tmpQuatE = new THREE.Quaternion(); // NE (45886)
export const JUMP_IDLE_POSE_T = 0.4; // PE (45887) fixed Jump_Idle time
export const IDLE_A_POSE_T = 0.3; // FE (45888) fixed Idle_A time
export const AIMING_POSE_T = 0.7; // IE (45889) fixed Ranged_1H_Aiming time

/** Layered sine noise: 0.55, 0.3 and 0.15 weighted sines. */
export const layeredSine = (t: number, phase: number, f1: number, f2: number, f3: number): number => // LE (45890)
  Math.sin(t * f1 + phase) * 0.55 + Math.sin(t * f2 + phase * 1.7) * 0.3 + Math.sin(t * f3 + phase * 2.3) * 0.15;

/** Node name of an animation track ("hips.quaternion" -> "hips"). */
export const trackNode = (track: { name: string }): string => track.name.slice(0, track.name.lastIndexOf(`.`)); // RE (45892)
