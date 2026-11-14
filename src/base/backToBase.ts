// MINEAR: Finish mining trip. Ends the trip: the miner lands at the lift with the whole haul, the dug ground
// grows back (ChunkManager.restore), surface props come back, and the gems take a new trip seed so they
// sit in new spots (still picked by depth, src/world/gemSpawn.ts). Then the trip summary (src/base/haulShow.ts)
// shows what came home while the base loads behind it; it ends with "Upgrade at base" (stay on the base) or
// "Continue mining" (teleport down to the land beside the lift). Worn-out claws end the trip at once (no confirm).
// Chests are left as they are (their keys and orbs come in a later update).
// The dock button (#homebtn), the H key and the pause sheet's "Finish mining trip" open the confirm first.
// MINEAR rule (user, 2026-11-14): the trip result is kept only with an account. Signed in (NEAR Auth, or the Demo
// cheat's local testnet account): the materials are saved on chain at once (vault.saveAll,
// minear-r3f/src/economy/vault.ts). Demo (no account): the result is not kept: the materials are dropped and the
// Capsule Coin bonus is not paid. The summary still shows what the trip found.
import type * as THREE from 'three';
import type { PlayerState } from '../state/playerState';
import { ITEMS, type ItemDef } from '../world/items';
import { GOALS } from '../state/goals';
import { setGemRunSeed } from '../world/gemSpawn';
import { newRun, type RunLog } from './run';
import type { BaseTheme } from './basePanels';
import { recordTrip } from '../menus/lobbyData';
import { playerName } from '../menus/lobby';
import { dropAll, vault } from '../economy/vault';
import { session } from '../near/session';

const ITEM = ITEMS as Record<string, ItemDef>;

/** What one mining trip brought home. A trip gives materials only: no gear, no coins (src/base/run.ts). */
export interface Haul {
  /** Deepest metres this trip. */
  deep: number;
  /** The deepest record before this trip. */
  best0: number;
  /** Damage dealt this trip. */
  dmg: number;
  /** The best damage of one trip before this one. */
  dmgBest0: number;
  minutes: number;
  capsules: number;
  gems: [string, number][];
  ores: [string, number][];
  other: [string, number][];
  /** Requests (goals) finished during this trip. */
  goalsDone: number;
  /** False for a demo trip (no account): nothing of it is kept. */
  kept: boolean;
  /** MINEAR: a tutorial replay's practice trip: nothing of it is kept. */
  practice?: boolean;
}

/** Every gear uid the player holds (worn, bag, storage chest). */
export function allUids(s: PlayerState): number[] {
  const out: number[] = [];
  for (const it of Object.values(s.gear)) if (it) out.push(it.uid);
  for (const it of s.items) out.push(it.uid);
  for (const it of s.stash.items) out.push(it.uid);
  return out;
}

export const startRun = (s: PlayerState): RunLog =>
  newRun({ earned: s.earned, uids: allUids(s), best: s.deepest, dmgBest: s.bestDmg, goal: s.goal.i });

/** Counts damage the miner dealt toward this trip (Game.ts calls it from the foe, worm and boss hits). */
export function runDealt(s: PlayerState, dmg: number): void {
  if (!(dmg > 0)) return;
  const r = (s.run ??= startRun(s));
  r.dmg += dmg;
}

/** Counts a pickup toward this expedition (src/pickups/collect.ts calls it). */
export function runTook(s: PlayerState, id: string, n: number): void {
  if (n <= 0) return;
  const r = (s.run ??= startRun(s));
  r.took[id] = (r.took[id] ?? 0) + n;
}

/** Capsule Coins an expedition earns: one per 250 m of depth reached, four at most. */
export const capsuleBonus = (deep: number): number => Math.min(4, Math.floor(deep / 250));

export function computeHaul(s: PlayerState): Haul {
  const r = s.run;
  const gems: [string, number][] = [];
  const ores: [string, number][] = [];
  const other: [string, number][] = [];
  for (const [id, n] of Object.entries(r?.took ?? {})) {
    const k = ITEM[id]?.kind;
    if (!k || n <= 0) continue;
    (k === `gem` ? gems : k === `ore` ? ores : other).push([id, n]);
  }
  const byValue = (a: [string, number], b: [string, number]) => (ITEM[b[0]].value ?? 0) - (ITEM[a[0]].value ?? 0);
  gems.sort(byValue);
  ores.sort(byValue);
  const deep = Math.round(r?.deep ?? 0);
  // requests finished since the trip started (taken-out goals do not count)
  let goalsDone = 0;
  if (r && r.goal0 >= 0) for (let i = r.goal0; i < s.goal.i; i++) if (GOALS[i] && !GOALS[i].gone) goalsDone++;
  return {
    deep,
    best0: Math.round(r?.best0 ?? deep),
    dmg: Math.round(r?.dmg ?? 0),
    dmgBest0: Math.round(r?.dmgBest0 ?? 0),
    minutes: r ? (Date.now() - r.at) / 6e4 : 0,
    capsules: capsuleBonus(deep),
    gems,
    ores,
    other,
    goalsDone,
    kept: !!session.player,
  };
}

/** The game parts Back to Base uses. */
export interface HomeHost {
  started: boolean;
  sandbox: boolean;
  burrow: boolean;
  returning: unknown;
  arc: unknown;
  state: PlayerState;
  combat: { ko: boolean };
  player: { pos: THREE.Vector3; lifting: boolean; stopLift(): void };
  ult: { stop(): void; leap?: unknown };
  world: { restore(near?: { x: number; y: number; z: number }): { cx: number; cy: number; cz: number }[] };
  gems: { reshuffle(): void };
  decor: { restore(snap: Set<number>): void };
  caveDecor: { unloadChunk(c: never): void };
  chests?: { unloadChunk(c: never): void } | null;
  pickups: { clear(): void };
  items: { clear(): void };
  exitBurrow(toSurface: boolean): void;
  spawnAtHub(): void;
  liftWarp(): void;
  inHaven(pos: THREE.Vector3): boolean;
  openBase(theme: BaseTheme): void;
  closeAnyPanel(): void;
  setHaul(h: Haul): void;
  /** MINEAR: the trip summary overlay (src/base/haulShow.ts); `why` is the reason line (claws worn out). */
  showHaul(h: Haul, why?: string): void;
  /** MINEAR: the trip's save on chain finished (refresh the HUD and the bag). */
  afterSave?(): void;
  /** MINEAR: the tutorial's `finish` step is on: its trip may end (Finish trip, or worn-out claws). */
  readonly tutorialTrip?: boolean;
  /** MINEAR: ends the tutorial sandbox with what its trip found; true when a first tutorial keeps it. */
  endTutorialTrip?(took: Record<string, number>): boolean;
  ui: { banner(title: string, sub: string, color: string): void };
}

/** Finish mining trip may start now (not in the tutorial before its `finish` step, not knocked out, not while the
 *  land loads in). */
export function canGoHome(g: HomeHost): boolean {
  return g.started && (!g.sandbox || !!g.tutorialTrip) && !g.combat.ko && !g.returning && !g.player.lifting;
}

/** Opens the confirm sheet. */
export function askHome(g: HomeHost): void {
  if (!canGoHome(g)) return;
  g.openBase(`home`);
}

/** Ends the mining trip: home, reset, new gem seed, then the trip summary. `why`: the reason line (no confirm). */
export function goHome(g: HomeHost, why?: string): void {
  if (!canGoHome(g)) return;
  g.closeAnyPanel();
  const s = g.state;
  const haul = computeHaul(s);

  // stop what the miner is doing and land at the lift
  if (g.burrow) g.exitBurrow(false);
  g.arc = null;
  g.ult.stop();
  g.player.stopLift();
  // MINEAR: the tutorial's trip: the sandbox ends first (the world and the save are put back). A first tutorial
  // keeps what the trip found; a replay keeps nothing.
  if (g.sandbox && g.endTutorialTrip && !g.endTutorialTrip(s.run?.took ?? {})) {
    haul.kept = false;
    haul.practice = true;
  }
  g.spawnAtHub();
  g.liftWarp();

  // the mine grows back, the gems take a new seed. Only the dug chunks near the lift are generated again;
  // the deep ones are dropped and generate fresh when the miner gets there (ChunkManager.restore).
  const restored = g.world.restore(g.player.pos);
  for (const c of restored) {
    g.caveDecor.unloadChunk(c as never);
    g.chests?.unloadChunk(c as never);
  }
  g.decor.restore(new Set());
  s.runSeed = 1 + Math.floor(Math.random() * 999998);
  setGemRunSeed(s.runSeed);
  g.gems.reshuffle();
  g.pickups.clear();
  g.items.clear();

  // pay the trip bonus, keep the damage record, start the next trip. Demo: the result is not kept.
  // (a tutorial replay drops nothing: the save it put back holds the player's real materials)
  if (haul.kept) s.capsules += haul.capsules;
  else if (!haul.practice) dropAll(s);
  s.bestDmg = Math.max(s.bestDmg, haul.dmg);
  s.where = null;
  s.run = startRun(s);
  s.save();
  // signed in: save the materials on chain now, with the trip report (depth) for the record and the boards
  // (the summary shows how it went)
  if (haul.kept) void vault.saveAll(s, { depth_m: haul.deep }).then(() => g.afterSave?.());

  // the lobby's Trips log keeps this trip (src/menus/lobbyData.ts)
  const items = [...haul.gems, ...haul.ores, ...haul.other].reduce((a, [, n]) => a + n, 0);
  if (!haul.practice && (haul.deep > 0 || items > 0))
    recordTrip({
      name: playerName(),
      deep: haul.deep,
      items,
      best: haul.gems[0]?.[0] ?? haul.ores[0]?.[0] ?? null,
      finds: [...haul.gems, ...haul.ores].map(([id]) => id).slice(0, 3),
      at: Date.now(),
    });

  g.setHaul(haul);
  g.showHaul(haul, why);
}
