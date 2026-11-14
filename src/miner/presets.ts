// Port of play-inUT-NSi.js 45718-45805: miner body presets, per-material grain and rig bone tables.
import * as THREE from 'three';

/** Paint settings of the painted (MI_*) bodies: normal map scale, blurred-map mix and flat fill light. */
export interface BodyPaint {
  normal: number;
  soft: number;
  fill: number;
}

/** One miner body variant (HT, UT, WT, GT, KT). */
export interface MinerBody {
  scale: number;
  gearK: number;
  hip: THREE.Vector3;
  hats: boolean;
  cloaks: boolean;
  paint?: BodyPaint;
  /** Retarget factors for clips from the shared animation rig (zE). */
  clipK?: { leg: number; arm: number; hand: number };
  /** Arm inward rotation (degrees) and elbow relax for the retarget (zE). */
  arms?: { inward: number; elbow: number };
  /** Head anchor and scale for worn hats. */
  head?: { at: THREE.Vector3; k: number };
  /**
   * Burrowing and digging rock play the KayKit Crawling clip (it lies face down), with the body turned along
   * the dig direction. Model units: `lift` raises the lying body so a thick belly rests on the ground;
   * `center` is the middle of the lying body (it turns about this point while burrowed); `nose` is the front
   * of the head on the ground (it turns about this point to dig down from open ground); `tail` is the rear
   * on the ground (it turns about this point to dig up).
   */
  crawl?: { lift: number; center: THREE.Vector3; nose: THREE.Vector3; tail: THREE.Vector3 };
  /**
   * The body burrows with its claws and has no drill model: no drill hold while it walks, no drill aim pose
   * (Ranged_1H_Aiming and the aimed right arm) on the surface or underground.
   */
  claws?: boolean;
}

export const DEFAULT_TANK_TINTS = [0xc9824a]; // BT (45718)
export const DEFAULT_BIT_TINTS = [0xa7a09a]; // VT (45719)

/** The live body: miner4.glb. */
export const BODY_CLASSIC: MinerBody = { // HT (45720)
  scale: 0.75,
  gearK: 1,
  hip: new THREE.Vector3(0.45, 0.55, 0.04),
  hats: true,
  cloaks: true,
};

export const BODY_BASE: MinerBody = { // UT (45721)
  scale: 1,
  gearK: 0.75,
  hip: new THREE.Vector3(0.28, 0.62, 0.06),
  hats: false,
  cloaks: false,
  paint: { normal: 0.5, soft: 0.45, fill: 0.08 },
};

export const BODY_JET: MinerBody = { // WT (45729)
  ...BODY_BASE,
  hip: new THREE.Vector3(0.28, 0.56, 0.05),
  paint: { normal: 1, soft: 0, fill: 0.05 },
  clipK: { leg: 0.915, arm: 0.621, hand: 1.139 },
  hats: true,
  head: { at: new THREE.Vector3(0, 1.22, 0), k: 0.47 },
};

export const BODY_V5: MinerBody = { // GT (45737)
  ...BODY_BASE,
  hip: new THREE.Vector3(0.3, 0.55, 0.06),
  paint: { normal: 0, soft: 0, fill: 0.05 },
  clipK: { leg: 0.994, arm: 0.667, hand: 1.132 },
  arms: { inward: 15, elbow: 0.6 },
  hats: true,
  head: { at: new THREE.Vector3(0, 1.4, 0), k: 0.6 },
};

export const BODY_SOFT: MinerBody = { // KT (45746)
  ...BODY_BASE,
  paint: { normal: 1, soft: 0, fill: 0.05 },
  clipK: { leg: 1.003, arm: 0.692, hand: 0.957 },
  hats: true,
  head: { at: new THREE.Vector3(0, 1.25, 0.02), k: 0.48 },
};

/**
 * MINEAR's default player, nearmol (public/minear/nearmol.glb).
 * KayKit Rig_Medium skeleton: KayKit clips play as they are; the hips track is re-based on its hips
 * (0.4245 / 0.4057 = 1.046). It wears its hard hat in `hatslot` (gear helmets are not fitted to it yet).
 */
export const BODY_NEARMOL: MinerBody = {
  scale: 0.85,
  gearK: 1,
  hip: new THREE.Vector3(0.66, 0.5, 0.05),
  hats: false,
  cloaks: false,
  clipK: { leg: 1.046, arm: 1, hand: 1 },
  claws: true,
  // nearmol is about 1.56 thick: lying down, its middle is 0.78 up and its head reaches about 1.0 forward
  crawl: {
    lift: 0.5,
    center: new THREE.Vector3(0, 0.78, 0.25),
    nose: new THREE.Vector3(0, 0.08, 0.95),
    tail: new THREE.Vector3(0, 0.08, -0.7),
  },
};

/** Grain strength per material name. */
export const MATERIAL_GRAIN: Record<string, number> = { // qT (45753)
  M3_Coat: 0.16,
  M3_Pants: 0.16,
  M3_Scarf: 0.22,
  M3_Glove: 0.14,
  M3_Pouch: 0.14,
  M3_Belt: 0.12,
  M3_Boot: 0.12,
  M3_Sole: 0.1,
  M3_Helmet: 0.05,
  M3_HelmetBand: 0.08,
  M3_Tank: 0.06,
  M3_TankMetal: 0.08,
  M3_DrillBody: 0.06,
  M4_Outfit: 0.12,
};

/** Bones whose tracks go to the upper-body ("/U") action layer. */
export const UPPER_BODY_BONES = new Set([ // JT (45769)
  'spine',
  'spine1',
  'chest',
  'neck',
  'head',
  'shoulderl',
  'upperarml',
  'lowerarml',
  'wristl',
  'handl',
  'shoulderr',
  'upperarmr',
  'lowerarmr',
  'wristr',
  'handr',
]);

/** Ordered bones the rig turns procedurally. */
export const RIG_BONES = [ // YT (45786)
  'hips',
  'spine',
  'chest',
  'head',
  'upperarmr',
  'upperarml',
  'lowerarmr',
  'lowerarml',
  'handr',
  'scarf1',
  'scarf2',
  'upperlegl',
  'lowerlegl',
  'footl',
  'upperlegr',
  'lowerlegr',
  'footr',
] as const;
export type RigBoneName = (typeof RIG_BONES)[number];

/** Bones of RIG_BONES that may be missing; a placeholder Object3D stands in for them. */
export const OPTIONAL_BONES = new Set<string>(['scarf1', 'scarf2', 'lowerarmr', 'lowerarml', 'handr']); // XT (45805)
