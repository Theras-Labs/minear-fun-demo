// MINEAR: how many belt slots (quick items, keys 1-4) the miner has (folder: minear-r3f/src/state).
// The belt starts small and grows with the "Belt Loops" node of the skill tree (minear-r3f/src/state/skillTree.ts,
// node id `belt`). The HUD (minear-r3f/src/ui/kr-hud.ts) shows the open slots and the locked ones.

/** Belt slots at the start. */
export const BELT_BASE = 2;
/** Most belt slots (PlayerState.belt has 4 entries). */
export const BELT_MAX = 4;

/** Open belt slots for a player state (reads the skill tree level of `belt`). */
export function beltSlots(s: { tree?: Record<string, number> }): number {
  return Math.max(1, Math.min(BELT_MAX, BELT_BASE + Math.floor(s.tree?.belt ?? 0)));
}
