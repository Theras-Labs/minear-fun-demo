// Tutorial step lists, the coach text table and the layout constants of the sandbox tutorial.
// Bundle play-inUT-NSi.js lines 59932-60036.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { touchIcon } from '../ui/touch';
import { FORGE_GRADES } from '../economy/forgeRules';

/** Stone one Stone forging takes (the `forge` step's hint). */
const STONE_MAKE = FORGE_GRADES.find((g) => g.id === `stone`)?.n ?? 10;

/** A tutorial step name: the sandbox steps, then the after steps (`quota`, `forge`, `ready`; `spring` only from
 *  the HUD's Wellspring hint). */
export type TutorialStep = 'move' | 'fly' | 'dash' | 'dig' | 'gem' | 'finish' | 'quota' | 'forge' | 'spring' | 'ready';

/** The sandbox steps in order. MINEAR (user, 2026-11-15): after the gem the first trip ends with Finish trip, or
 *  when the claws wear out. The old steps after it (back up to the surface, shoot, burrow into a foe, Burrow Slam,
 *  ride the light home) are gone. */
export const SANDBOX_STEPS: TutorialStep[] = [`move`, `fly`, `dash`, `dig`, `gem`, `finish`]; // mN (59932)

/** A key cap. */
export const kbd = (e: string): string => `<kbd>${e}</kbd>`; // hN (59933)
/** The four move keys. */
export const WASD = `${kbd(`W`)}${kbd(`A`)}${kbd(`S`)}${kbd(`D`)}`; // gN (59934)
/** The separator between two hints. */
export const SEP = `<i class="sep"></i>`; // _N (59935)
/** A mouse icon: `m` move (look), `l` left button, `r` right button. */
export const mouseIcon = (e: 'm' | 'l' | 'r'): string => // vN (59936)
  `<i class="ms ${e}"><svg viewBox="${e === `m` ? `-9 0 38 26` : `0 0 20 26`}"><rect x="2" y="2" width="16" height="22" rx="8"/>${e === `m` ? `<path class="mv" d="M-3 9l-4 4 4 4M23 9l4 4-4 4"/>` : `<path class="b" d="${e === `l` ? `M10 3V11H3V10A7 7 0 0 1 10 3Z` : `M10 3V11H17V10A7 7 0 0 0 10 3Z`}"/>`}<path d="M10 2v9M2 11h16"/></svg></i>`;

export interface StepText {
  /** The headline. */
  say: string;
  /** Desktop hint html. */
  keys: string;
  /** Touch hint html. */
  thumbs: string;
  /** Touch buttons to highlight. */
  buttons?: string[];
  /** [desktop nudge, touch nudge, seconds before it shows]. */
  nudge?: [string, string, number];
}

/** The coach text of each step. */
export const STEP_TEXT: Record<TutorialStep, StepText> = { // yN (59938)
  move: {
    say: `Walk to the light`,
    keys: `${WASD} move ${SEP} ${mouseIcon(`m`)} look`,
    thumbs: `${touchIcon(`stickic`)} move ${SEP} ${touchIcon(`lookic`)} look`,
    buttons: [`stick`],
  },
  fly: {
    say: `Fly up through the ring`,
    keys: `Stand under it, hold ${kbd(`Space`)}`,
    thumbs: `Stand under it, hold ${touchIcon(`jump`)}`,
    buttons: [`jump`],
    nudge: [`Hold it down to keep climbing`, `Hold it down to keep climbing`, 9],
  },
  dash: {
    say: `Dash`,
    keys: `Double-tap ${WASD}`,
    thumbs: `Tap ${touchIcon(`dash`)}`,
    buttons: [`dash`],
    nudge: [`Tap a key twice, quickly`, ``, 8],
  },
  dig: {
    say: `Mine down`,
    keys: `Aim at the ground, hold ${mouseIcon(`l`)}`,
    thumbs: `Aim at the ground, hold ${touchIcon(`drill`)}`,
    buttons: [`drill`],
    nudge: [`Walk into the hole as you mine`, `Walk into the hole as you mine`, 10],
  },
  gem: {
    say: `Find the gem`,
    keys: `${WASD} burrow ${SEP} ${kbd(`Space`)} up ${SEP} ${kbd(`C`)} down`,
    thumbs: `${touchIcon(`stickic`)} burrow ${SEP} ${touchIcon(`jump`)} up ${SEP} ${touchIcon(`down`)} down`,
    buttons: [`stick`],
    nudge: [
      `It glows through the rock: follow the arrow`,
      `It glows through the rock: follow the arrow`,
      12,
    ],
  },
  finish: {
    say: `Finish trip, or keep mining until your claws wear out`,
    keys: `${kbd(`H`)} finish trip ${SEP} ${mouseIcon(`l`)} keep mining`,
    thumbs: `Tap finish trip ${SEP} hold ${touchIcon(`drill`)} to keep mining`,
    buttons: [`drill`],
    nudge: [
      `Mining wears your claws down. When they wear out, the trip ends`,
      `Mining wears your claws down. When they wear out, the trip ends`,
      12,
    ],
  },
  quota: {
    say: `Free trips: the game pays your gas`,
    keys: ``,
    thumbs: ``,
  },
  forge: {
    say: `Make Stone Claws at the Forge`,
    keys: `${kbd(`E`)} at the Forge ${SEP} Claws ${SEP} Stone ${SEP} Make`,
    thumbs: `${touchIcon(`use`)} at the Forge ${SEP} Claws ${SEP} Stone ${SEP} Make`,
    buttons: [`use`],
    nudge: [
      `Stone forging takes ${STONE_MAKE} stone. Short? Mine more on your next trip`,
      `Stone forging takes ${STONE_MAKE} stone. Short? Mine more on your next trip`,
      25,
    ],
  },
  spring: {
    say: `Send your gem into the Wellspring`,
    keys: `${kbd(`E`)} at the fountain`,
    thumbs: `${touchIcon(`use`)} at the fountain`,
    buttons: [`use`],
  },
  ready: {
    say: `You're ready`,
    keys: `Better claws last longer. Mine deeper, forge better gear.`,
    thumbs: `Better claws last longer. Mine deeper, forge better gear.`,
  },
};

/** The tutorial heading from the haven: 100 degrees. */
export const TUT_YAW = (100 * Math.PI) / 180; // bN (60020)
export const FWD_X = Math.sin(TUT_YAW); // xN (60021)
export const FWD_Z = Math.cos(TUT_YAW); // SN (60022)
export const SIDE_X = -Math.cos(TUT_YAW); // CN (60023)
export const SIDE_Z = Math.sin(TUT_YAW); // wN (60024)
/** A point fwd metres along the tutorial heading from the lift and side metres across it. */
export const tutPoint = (e: number, t: number): { x: number; z: number } => ({ // TN (60025)
  x: LIFT_POINT.x + FWD_X * e + SIDE_X * t,
  z: LIFT_POINT.z + FWD_Z * e + SIDE_Z * t,
});
/** Where the sandbox starts. */
export const START_SPOT = tutPoint(24, 0); // EN (60026)
/** The `move` beacon. */
export const BEACON_SPOT = tutPoint(33, 2); // DN (60027)
/** The `fly` ring. */
export const RING_SPOT = tutPoint(39, 4); // ON (60028)
/** The `dig` marker. */
export const DIG_SPOT = tutPoint(50, 8); // kN (60029)
/** Metres to dig down in the `dig` step. */
export const DIG_DEPTH = 6; // AN (60030)
/** The practice gem of the `gem` step (also the gem a first tutorial gives). */
export const PRACTICE_GEM = `sapphire`; // jN (60031)
/** sessionStorage key: run the tutorial again on the next load. */
export const AGAIN_KEY = `minear.tutorial.again`; // MN (60032)
/** localStorage key: this browser has finished a tutorial. */
export const DONE_KEY = `minear.tutorial.done`; // NN (60033)
/** Shared scratch vectors of the tutorial module. */
export const TMP_A = new THREE.Vector3(); // PN (60034)
export const TMP_B = new THREE.Vector3(); // FN (60035)
export const TMP_C = new THREE.Vector3(); // IN (60036)
