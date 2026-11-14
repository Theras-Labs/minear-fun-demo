// Player stats the combat system dI (play-inUT-NSi.js 63827-65519) reads from the player state Fj
// (54340-55309) that the phase-1 PlayerStats (src/game/playerStats.ts) does not have yet.
// The formulas are the Fj getters, for the lead to add to PlayerStats.
// dmgMul (54505) = buffs.strength > Date.now() ? 1.3 (Oj 54314) : 1.

export interface CombatStats {
  /** 100 + round(stat('hp')) (Fj 54521). */
  readonly maxHp: number;
  /** stat('armor') / 100 (Fj 54524). */
  readonly armor: number;
  /** stat('crit') / 100 (Fj 54527). */
  readonly crit: number;
  /** (16 + stat('melee')) * dmgMul (Fj 54499). */
  readonly meleeDamage: number;
  /** (8 + stat('ranged')) * dmgMul (Fj 54502). */
  readonly rangedDamage: number;
  /** Seconds between shots: 0.34 / (1 + stat('rate') / 100) (Fj 54518). */
  readonly fireRate: number;
  /** Second wind already used since the last haven visit (Fj field, 54379, default false). Combat writes it. */
  windUsed: boolean;
  /**
   * Stat totals. Ids combat reads: thorns, wind, vamp, nimble, muzzle, bounce, caliber, twin, ember, venom,
   * frost, resfire, respoison, blast, regen.
   */
  stat(id: string): number;
}
