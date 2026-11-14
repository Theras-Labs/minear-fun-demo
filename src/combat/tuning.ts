// Port of play-inUT-NSi.js 63802-63826: player combat tuning constants (drill grind, kick, dash, PvP grind,
// element colors, projectile table) used by the combat system dI (src/combat/combat.ts).
import * as THREE from 'three';
import { FOE_SHOTS } from '../foes/types';

/** Killer attribution window in ms: a KO credits the last miner who hit you within this time. */
export const KILLER_WINDOW_MS = 12e3; // qF (63802)

/** Round to 0.01 before a value goes on the network. */
export const netRound = (e: number) => Math.round(e * 100) / 100; // JF (63803)

/** Drill grind tick on a foe. */
export const GRIND = { every: 0.12, mult: 0.45, knock: 0.8 }; // YF (63804)

/** Drill "kick": the heavy hit after 1.2 s of contact, with splash to foes near the contact point. */
export const KICK = { every: 1.2, mult: 1, knock: 10, reach: 2.2, splash: 0.5, shove: 7 }; // XF (63805)

/** Dash (double-tap dodge). */
export const DASH = { speed: 21, len: 0.36 }; // ZF (63806)

/** PvP drill grind on another miner. */
export const PVP_GRIND = { every: 0.36, mult: 1.3, knock: 2, kick: 10 }; // QF (63807)

/** Thrown rock mesh scale. */
export const ROCK_SCALE = 0.55; // $F (63808)

/** Rock hit radius against the player. */
export const ROCK_HIT_RADIUS = 0.95; // eI (63809)

export type ElementKind = 'burn' | 'poison' | 'chill';
export interface Elements {
  burn: number;
  poison: number;
  chill: number;
}

/** HDR shot colors per element. */
export const ELEMENT_COLORS: Record<ElementKind, THREE.Color> = { // tI (63810)
  burn: new THREE.Color(3.4, 1, 0.25),
  poison: new THREE.Color(0.8, 2.8, 0.7),
  chill: new THREE.Color(1.1, 2.4, 3.4),
};

/** Shot trail spark colors per element. */
export const ELEMENT_TRAILS: Record<ElementKind, number> = { burn: 16742954, poison: 8118415, chill: 10479871 }; // nI (63811)

/** The dominant element of a mix. */
export const dominantElement = (e: Elements): ElementKind => // rI (63812)
  e.burn >= e.poison && e.burn >= e.chill ? `burn` : e.poison >= e.chill ? `poison` : `chill`;

export type ShotKind = 'rivet' | 'bolt' | 'orb' | 'rock';
export interface ShotDef {
  speed: number;
  gravity: number;
  life: number;
  color: THREE.Color;
  trail: number;
}

/** Projectile table. */
export const SHOTS: Record<ShotKind, ShotDef> = { // iI (63814)
  rivet: { speed: 44, gravity: 3, life: 1.6, color: new THREE.Color(3.2, 1.6, 0.5), trail: 16757850 },
  bolt: { speed: 24, gravity: 5, life: 2.2, color: new THREE.Color(0.7, 2.6, 2.1), trail: 8388576 },
  orb: { speed: 10, gravity: 0, life: 4.5, color: new THREE.Color(1.6, 0.9, 3), trail: 11898111 },
  rock: { speed: 0, gravity: FOE_SHOTS.rock.gravity, life: 3.5, color: new THREE.Color(1, 1, 1), trail: 10129022 },
};

/** World up. */
export const UP = new THREE.Vector3(0, 1, 0); // aI (63820)

/** Contact key prefix for the worm (grind contact tracking). */
export const WORM_CONTACT = `worm:`; // lI (63825)

export const clamp = THREE.MathUtils.clamp; // uI (63826)

/** PvP thorns factor: thorns reflect only this share against another miner (gear perk table). */
export const PVP_THORNS = 0.2; // wk (51088)
