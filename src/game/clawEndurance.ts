// MINEAR: claw endurance. nearmol has no drill: its claws wear down as they dig rock, and worn-out claws dig
// as slowly as rock that is too hard. They rest back to full on the surface, and slowly underground when they
// are not digging. Claw tiers (bare, copper, iron, gold, mythril) set the most endurance; only bare claws are
// in the game until the claw upgrade comes. The values live in the player state (saved): clawTier and
// clawEndurance (-1 = full).

// Dev and cheat phase: the claws cheat (src/game/cheats.ts, on by default) keeps them from wearing out. Untick it
// in the Cheats panel, or add ?claws=limited to the URL, to play with the real endurance.
import { cheats } from './cheats';

export interface ClawTier {
  id: string;
  name: string;
  /** Most endurance. */
  max: number;
  /** HUD colour of the claws. */
  color: string;
}

export const CLAW_TIERS: ClawTier[] = [
  { id: `bare`, name: `Bare Claws`, max: 50, color: `#fff1d6` },
  { id: `copper`, name: `Copper Claws`, max: 80, color: `#ff8a4a` },
  { id: `iron`, name: `Iron Claws`, max: 120, color: `#e8dccb` },
  { id: `gold`, name: `Gold Claws`, max: 170, color: `#ffd23c` },
  { id: `mythril`, name: `Mythril Claws`, max: 240, color: `#6ff3ff` },
];

/**
 * Endurance one dig hit costs in rock of this hardness (a hit every 0.06 s while digging):
 * Dirt 0.08, Sandstone 0.09, Stone 0.14, Slate 0.2, Abyssal Rock 0.28, Obsidian 0.4.
 */
export const digCost = (hardness: number): number => 0.06 * (1 + Math.min(hardness, 44) / 3);
/** Endurance per second while resting on the surface (bare claws fill in 2 s). */
export const REST_SURFACE = 25;
/** Endurance per second underground, after REST_DELAY seconds without digging (bare claws: about 2 minutes). */
export const REST_DEEP = 0.4;
export const REST_DELAY = 1.5;
/** Dig strength with worn-out claws (the same factor as rock that is too hard, world/edit.ts). */
export const WORN_DIG = 0.08;

export class ClawEndurance {
  /** Seconds since the last dig hit. */
  idleT = 99;

  constructor(private s: { clawTier: number; clawEndurance: number }) {}

  get tier(): ClawTier {
    return CLAW_TIERS[Math.max(0, Math.min(CLAW_TIERS.length - 1, Math.floor(this.s.clawTier) || 0))];
  }
  get max(): number {
    return this.tier.max;
  }
  /** No wear at all (the claws cheat). */
  get unlimited(): boolean {
    return cheats.claws;
  }
  get value(): number {
    if (this.unlimited) return this.max;
    const v = this.s.clawEndurance;
    return v < 0 ? this.max : Math.min(v, this.max);
  }
  set value(v: number) {
    this.s.clawEndurance = v >= this.max ? -1 : Math.max(0, v);
  }
  /** No endurance left: digging is as slow as in rock that is too hard. */
  get worn(): boolean {
    return this.value <= 0;
  }

  /** A dig hit took rock of this hardness. */
  use(hardness: number): void {
    this.idleT = 0;
    if (this.unlimited) return;
    this.value = this.value - digCost(hardness);
  }

  /** Rest: fast on the surface, slow underground after a short pause. */
  update(dt: number, onSurface: boolean): void {
    this.idleT += dt;
    if (this.s.clawEndurance < 0) return;
    const rate = onSurface ? REST_SURFACE : this.idleT > REST_DELAY ? REST_DEEP : 0;
    if (rate > 0) this.value = this.value + rate * dt;
  }
}
