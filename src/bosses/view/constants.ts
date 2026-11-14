// Port of play-inUT-NSi.js 65943-66050: the boss view constants. The two boss lights kI (made at import time,
// KR adds them to the scene at 70550), model scales, theme colours, element arrays of the boss hits, module
// scratch shared by the boss view QI and the boss manager gL, the vertical attack reach,
// the bone hit-sphere table and the per-boss act -> clip table ZI.
// 65961 `P.smoothstep;` is a dead expression statement (minifier artifact) and is not ported.
import * as THREE from 'three';
import type { BossKind } from '../sim/defs';

/** kI (65943): glow light (orange, moved to the nearest boss) and flash light (white, boss hit flashes). */
export const BOSS_LIGHTS = { // kI (65943)
  glow: new THREE.PointLight(16742954, 0, 26, 1.4),
  flash: new THREE.PointLight(16777215, 0, 30, 1.5),
};
/** NI (65947): titan model scale. */
export const TITAN_SCALE = 4; // NI (65947)
/** PI (65948): king model scale. */
export const KING_SCALE = 4.2; // PI (65948)
/** FI (65949): seconds a predicted hit holds the HP below the reported HP. */
export const PREDICT_HOLD = 0.7; // FI (65949)
/** II (65950): theme colour per boss (telegraphs, rings, pillars). */
export const BOSS_COLORS: Record<BossKind, number> = { titan: 9430271 }; // II (65950)
/** RI (65952): elements of the titan ice spikes. */
export const CHILL_ELEMENTS: [number, number, number] = [0, 0, 0.4]; // RI (65952)

// module scratch (65954-65959), shared by QI, eL and gL
export const tmpA = new THREE.Vector3(); // Q (65954)
export const tmpB = new THREE.Vector3(); // BI (65955)
export const tmpC = new THREE.Vector3(); // VI (65956)
export const tmpQuat = new THREE.Quaternion(); // HI (65957)
export const tmpMat = new THREE.Matrix4(); // UI (65958)
export const UP = new THREE.Vector3(0, 1, 0); // WI (65959)
export const clamp = THREE.MathUtils.clamp; // GI (65960)
/** KI (65962): shortest-path angle lerp. */
export const lerpAngle = (e: number, t: number, n: number): number => e + Math.atan2(Math.sin(t - e), Math.cos(t - e)) * n; // KI (65962)
/** qI (65963): smoothstep of x in 0-1. */
export const smooth = (e: number): number => e * e * (3 - 2 * e); // qI (65963)
/** JI (65964): vertical reach of the boss attacks. */
export const BOSS_REACH: Record<BossKind, number> = { titan: 6.2 }; // JI (65964)

/** A hit-sphere bone: [bone name, radius (times the model scale), weak spot]. */
export type HitBone = [string, number, boolean];

/** YI (65965): titan hit bones. */
export const HUMANOID_HIT_BONES: HitBone[] = [ // YI (65965)
  [`head`, 0.34, true],
  [`chest`, 0.42, false],
  [`spine`, 0.36, false],
  [`hips`, 0.32, false],
  [`upperarml`, 0.2, false],
  [`upperarmr`, 0.2, false],
  [`lowerarml`, 0.22, false],
  [`lowerarmr`, 0.22, false],
  [`handl`, 0.22, false],
  [`handr`, 0.22, false],
  [`upperlegl`, 0.2, false],
  [`upperlegr`, 0.2, false],
  [`lowerlegl`, 0.18, false],
  [`lowerlegr`, 0.18, false],
];
/** One act of the clip table: [clip name, time scale, loops]. */
export type ActClip = [string, number, boolean];

/** ZI (65997): per boss, act -> [clip, rate, loop]. Every boss has sleep, wake, idle, walk, roar and die. */
export const BOSS_CLIPS: Record<BossKind, Record<string, ActClip>> = { // ZI (65997)
  titan: {
    sleep: [`Skeletons_Inactive_Floor_Pose`, 1, true],
    wake: [`Skeletons_Awaken_Floor_Long`, 1, false],
    idle: [`Melee_Unarmed_Idle`, 0.8, true],
    walk: [`Walking_A`, 0.64, true],
    roar: [`Skeletons_Taunt_Longer`, 1, false],
    die: [`Death_B`, 1, false],
    punch: [`Melee_Unarmed_Attack_Punch_A`, 1, false],
    slam: [`Melee_2H_Attack_Chop`, 1, false],
    throw: [`Throw`, 1, false],
    nova: [`Ranged_Magic_Raise`, 1, false],
    leap: [`Jump_Full_Long`, 1, false],
  },
};
