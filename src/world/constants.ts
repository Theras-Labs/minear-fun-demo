// Global game constants. Bundle play-inUT-NSi.js lines 28757-28766 (CHUNK is q at 35442).

/** World seed base. Every simplex instance and hash uses WORLD_SEED + offset. */
export const WORLD_SEED = 1337; // bp (28757)

/** Hub / lift anchor point. The lift pulls the player toward x/z and warps to it. */
export const LIFT_POINT = { x: 0, y: 40, z: 0 }; // W (28758)

/**
 * Name from the port plan. The bundle uses this value as the lift beam radius
 * (CylinderGeometry radius at 49883, portal ring radius + 0.7 at 49912).
 */
export const NEAR_LIGHT_R = 3.2; // xp (28759)
/** Alias of NEAR_LIGHT_R, named by its use in the bundle. */
export const LIFT_RADIUS = NEAR_LIGHT_R; // xp (28759)

/** Burrow move speed (m/s); scaled by burrowMul and x1.45 with Shift (71340). */
export const BURROW_SPEED = 7.5; // Sp (28760)

/** Summon cooldown / calm time in seconds by crew size: 60, 45, 30, then 15 (41090, 44010). */
export const summonCooldown = (e: number): number => Math.max(15, 60 - 15 * Math.max(0, e - 1)); // Cp (28761)

/** No use found in the bundle outside its declaration. */
export const SMOKE_RADIUS = 5.5; // wp (28762): the smoke bomb cloud radius (smoke XP 62485-62488)

export const CAPSULE_RADIUS = 0.42; // Tp (28763)
export const CAPSULE_HEIGHT = 1.55; // Ep (28764)
export const WALK_SPEED = 6.2; // Dp (28765)
export const JUMP_SPEED = 8.5; // Op (28766)

/** Voxels per chunk edge. */
export const CHUNK = 16; // q (35442)
