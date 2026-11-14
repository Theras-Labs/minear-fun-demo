// KR's goal and tutorial glue, as functions over a small host (the game):
//   70428-70451 the goal card and its GOAL COMPLETE banner (makeGoals)
//   70616-70623 the pause menu's Skip tutorial button (wireTutorialButtons)
//   70802-70837 the tutorial coach and its host (makeTutorial)
//   70870-70899 the intro camera (updateIntro)
//   71052-71114 start, 71168-71187 beginSandbox, 71188-71235 endSandbox, 71236-71245 afterLoad, 71246 showSkip
//   71685-71693 the `leave` / `home` goal events (updateHavenGoals)
//   48935-48937 EO.setSandbox, solo branch (setMonsterSandbox)
// Bundle play-inUT-NSi.js lines as above. mp.setName / mp.connect (71089-71090, 71233) are multiplayer and not ported.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import type { PlayerState } from '../state/playerState';
import type { GemFieldSnapshot } from '../gems/gemField';
import type { Chunk } from '../world/chunk';
import type { Settings } from '../game/settings';
import type { WeatherMode } from '../sky/weather';
import type { Foe } from '../foes/foe';
import type { FoeKind } from '../foes/types';
import type { SimPlayer, SummonOverride } from '../foes/foeManager';
import type { EmitOptions } from '../fx/particles';
import { GoalCard } from './goalCard';
import { giveReward } from '../state/goals';
import { rewardText } from '../ui/goalReward';
import { TutorialCoach, type CoachHost } from './coach';
import { HavenFlyIn } from './havenFlyIn';
import { PRACTICE_GEM } from './steps';
import { tutorialAccount } from './account';
import { itemDef } from '../world/items';
import { startRun } from '../base/backToBase';

/** The frozen time of day in the sandbox. */
export const SANDBOX_TIME = 0.36; // bR (69992)

const T0 = new THREE.Vector3(); // $ (70040)
const T1 = new THREE.Vector3(); // MR (70041)
const T2 = new THREE.Vector3(); // NR (70042)
const E0 = new THREE.Euler(0, 0, 0, `YXZ`); // IR (70046)
const E1 = new THREE.Euler(0, 0, 0, `YXZ`); // LR (70047)

/** KR.intro: the camera flight from the title orbit to the follow camera. */
export interface Intro {
  t: number;
  from: THREE.Vector3;
  fromQ: THREE.Quaternion;
  /** Runs when the flight ends (the sandbox's first step). */
  then: (() => void) | null;
  /** The haven fly-in path (sandbox), else a short arc. */
  around: HavenFlyIn | null;
  /** MINEAR: seconds of the short arc (1.2; longer from the lobby's cave). */
  len?: number;
}

/** The KR members the goal card wiring uses. */
export interface GoalsHost {
  state: PlayerState;
  player: { pos: THREE.Vector3 };
  ui: { banner(title: string, sub: string, color: string): void; bumpCoins(): void };
  audio: { purchase(): void };
  sparks: { emit(e: EmitOptions): void };
}

/** The KR members the tutorial glue uses. */
export interface TutorialHost extends GoalsHost {
  started: boolean;
  sandbox: boolean;
  sandboxWas: { gems: GemFieldSnapshot; decor: Set<number> } | null;
  intro: Intro | null;
  burrow: boolean;
  arc: unknown;
  hasDug: boolean;
  fortuneMark: number;
  leftHub: boolean;
  goals: GoalCard;
  tutorial: TutorialCoach;
  readonly scene: THREE.Scene;
  readonly settings: Settings;
  readonly player: CoachHost['player'] & { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; fuel: number; stopLift(): void };
  readonly cam: {
    camera: THREE.PerspectiveCamera;
    yaw: number;
    pitch: number;
    pivot: THREE.Vector3;
  };
  readonly input: { enabled: boolean; requestLock(): void };
  readonly audio: GoalsHost['audio'] & CoachHost['audio'] & { start(): void };
  readonly ui: GoalsHost['ui'] & {
    startEl: HTMLElement;
    pauseEl: HTMLElement;
    noteToast(icon: string, html: string, ms?: number): void;
  };
  readonly hub: CoachHost['hub'];
  readonly gems: CoachHost['gems'] & {
    snapshot(): GemFieldSnapshot;
    restore(snap: GemFieldSnapshot, chunks: Iterable<Chunk>): void;
  };
  readonly decor: { snapshot(): Set<number>; restore(snap: Set<number>): void; clear(x: number, z: number, r: number): void };
  readonly world: {
    restore(): Chunk[];
    groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null;
    solid(x: number, y: number, z: number): boolean;
  };
  readonly grass: { slam(x: number, y: number, z: number, r: number, k: number): void };
  readonly caveDecor: { unloadChunk(c: Chunk): void };
  /** tk chests ([chests]). */
  readonly chests?: { unloadChunk(c: Chunk): void } | null;
  /** wP pickups. */
  readonly pickups: { clear(): void };
  /** The bombs and smoke bombs (KR.bombs.clear(), KR.smokes.clear()). */
  readonly items: { clear(): void };
  readonly combat: { floor: number; hp: number; readonly maxHp: number };
  readonly env: { clock: { frozen: number | null } };
  readonly weather: { setMode(mode: WeatherMode): void };
  /** The local monster host (EO.local, an ET): quiet and clear are EO.setSandbox, summon is mp.summon. */
  readonly foeHost: {
    quiet: boolean;
    clear(): void;
    summon(kind: FoeKind, pos: THREE.Vector3, player: SimPlayer, over?: SummonOverride): Foe | null;
  };
  /** The worm part of ET keeps its own copy of ET.quiet. */
  readonly wormHost?: { quiet: boolean } | null;
  readonly ult: { leap?: unknown; stop(): void };
  /** MINEAR: the claws' endurance (src/game/clawEndurance.ts). */
  readonly claws: { value: number; readonly max: number };
  readonly touch: (NonNullable<CoachHost['touch']> & { fullscreen(): void }) | null;
  /** KR.anyPanel */
  readonly anyPanel: boolean;
  /** KR.paused */
  readonly paused: boolean;
  /** yj settings panel ([inventory]): its replay button. */
  readonly settingsPanel?: { open: boolean; onTutorial?: () => void } | null;
  /** qL controls panel ([inventory]). */
  readonly keysPanel?: { open: boolean } | null;
  /** mp.id */
  readonly myId?: string;
  inHaven(pos: THREE.Vector3): boolean;
  /** KR.beginReturn (71115). */
  beginReturn(w: number[]): void;
  exitBurrow(toSurface: boolean): void;
  spawnAtHub(): void;
  /** KR.liftWarp (70900); it starts with `this.sandbox && endSandbox(this, 'done')`. */
  liftWarp(): void;
  applySettings(settings: Settings): void;
  /** KR.simPlayer (72369) */
  simPlayer(): SimPlayer;
  /** KR.onStatsChanged (73248, src/menus/economy.ts). */
  onStatsChanged?(): void;
  /** KR.syncSatchels (74844, src/chests/krChests.ts). */
  syncSatchels?(): void;
}

/** KR 70428-70451: the goal card, and its banner, sound, coin bump and sparks when a goal is met. */
export function makeGoals(h: GoalsHost): GoalCard {
  const g = new GoalCard(h.state);
  g.onComplete = (e, t) => {
    const n = rewardText(t); // MINEAR: materials, dice, rarely coins
    (h.ui.banner(`GOAL COMPLETE!`, `${e} · ${n}`, `#9fe870`),
      h.audio.purchase(),
      t.coins && h.ui.bumpCoins(),
      h.sparks.emit({
        pos: h.player.pos.clone().setY(h.player.pos.y + 1.6),
        vel: new THREE.Vector3(0, 5, 0),
        spread: 4,
        color: 10479728,
        intensity: 2.6,
        size: 0.16,
        sizeEnd: 0.03,
        life: 1,
        gravity: 9,
        count: 30,
      }));
  };
  return g;
}

/** KR 70802-70837: the tutorial coach over the game, and the settings panel's replay. */
export function makeTutorial(h: TutorialHost): TutorialCoach {
  const tutorial = new TutorialCoach({
    scene: h.scene,
    player: h.player,
    cam: h.cam,
    state: h.state,
    hub: h.hub,
    audio: h.audio,
    sparks: h.sparks,
    gems: h.gems,
    get touch() {
      return h.touch;
    },
    get burrow() {
      return h.burrow;
    },
    get away() {
      return (
        !h.started || h.anyPanel || h.paused || !!h.settingsPanel?.open || !!h.keysPanel?.open || !!h.intro // || mp.chat.isOpen
      );
    },
    get id() {
      return h.myId ?? ``;
    },
    floor: (e, t, n) => h.world.groundBelow(e, t, n, 40),
    solid: (e, t, n) => h.world.solid(e, t, n),
    grass: (e, t, n, r, i) => h.grass.slam(e, t, n, r, i),
    clear: (e, t, n) => h.decor.clear(e, t, n),
    leave: (e) => endSandbox(h, e),
    fillClaws: () => {
      h.claws.value = h.claws.max;
    },
    account: tutorialAccount,
  });
  h.settingsPanel && (h.settingsPanel.onTutorial = () => TutorialCoach.again());
  return tutorial;
}

/** KR 70616-70623: the pause menu's Skip tutorial button. */
export function wireTutorialButtons(h: Pick<TutorialHost, 'ui' | 'tutorial' | 'input'>): void {
  document.querySelectorAll(`.open-tutorial`).forEach((e) =>
    e.addEventListener(`click`, (e) => {
      (e.stopPropagation(), h.ui.pauseEl.classList.add(`hidden`), h.tutorial.skip(), h.input.requestLock());
    }),
  );
}

/** EO.setSandbox (48935), solo: the local monster host goes quiet (no ambush, worm, bosses) and is cleared. */
export function setMonsterSandbox(h: Pick<TutorialHost, 'foeHost' | 'wormHost'>, e: boolean): void {
  e !== h.foeHost.quiet && ((h.foeHost.quiet = e), h.wormHost && (h.wormHost.quiet = e), h.foeHost.clear());
}

/** KR.start (71052): the Play button. Starts the intro camera, then the sandbox tutorial or the way back. */
export function startGame(h: TutorialHost): void {
  if (h.started) return;
  h.touch?.fullscreen();
  const e = h.cam.camera;
  ((h.intro = {
    t: 0,
    from: e.position.clone(),
    fromQ: e.quaternion.clone(),
    then: null,
    around: null,
  }),
    (h.started = !0),
    h.ui.startEl.classList.add(`hidden`),
    document.body.classList.remove(`title`),
    (h.input.enabled = !0),
    h.audio.start(),
    h.input.requestLock());
  const t = TutorialCoach.wanted(h.state);
  if (t) beginSandbox(h, t === `first`);
  else {
    ((h.cam.yaw = Math.PI), (h.cam.pitch = -0.25));
    const e = h.state.where;
    // KR.beginReturn starts with `this.intro = null` (71117)
    e && !h.inHaven(T0.set(e[0], e[1], e[2])) && ((h.intro = null), h.beginReturn(e));
  }
  try {
    localStorage.getItem(`minear.fresh`) &&
      (localStorage.removeItem(`minear.fresh`),
      setTimeout(() => h.ui.banner(`A NEW WORLD`, `The world was wiped: everyone starts afresh. Start mining!`, `#9fe870`), 1200));
  } catch {
    /* storage blocked */
  }
  // 71089-71090: mp.setName(#player-name), and mp.connect() unless in the sandbox (multiplayer)
  if (h.state.refunded > 0) {
    const e = h.state.refunded;
    ((h.state.refunded = 0),
      h.state.save(),
      setTimeout(() => {
        (h.ui.noteToast(
          `<i class="coin"></i>`,
          `+${e.toLocaleString()} coins <small>for your Flares, Antidotes and Frost Flasks (gone from the game)</small>`,
          7e3,
        ),
          h.ui.bumpCoins());
      }, 1400));
  }
  const r = h.state.migrated;
  r &&
    ((h.state.migrated = null),
    setTimeout(() => {
      (h.ui.banner(
        `THE WELLSPRING HAS CHANGED`,
        `Old upgrades melted down: +${r.coins.toLocaleString()} coins, ${r.crystals} gems to shatter, ${r.dice} reroll dice`,
        `#8ff0ff`,
      ),
        h.ui.bumpCoins());
    }, 900));
}

/** KR.beginSandbox (71168): the tutorial plays in a copy of the world that is put back afterwards. */
export function beginSandbox(h: TutorialHost, e: boolean): void {
  ((h.sandbox = !0),
    (h.state.hold = !0),
    (h.goals.muted = !0),
    setMonsterSandbox(h, !0),
    (h.combat.floor = Math.max(1, Math.round(h.combat.maxHp * 0.25))),
    (h.sandboxWas = { gems: h.gems.snapshot(), decor: h.decor.snapshot() }),
    // MINEAR: the tutorial is the first mining trip: a fresh trip log (state.reload puts the saved one back)
    (h.state.run = startRun(h.state)),
    (h.env.clock.frozen = SANDBOX_TIME),
    h.weather.setMode(`clear`));
  const t = h.tutorial.startAt(h.player.pos);
  (h.player.vel.set(0, 0, 0),
    (h.player.yaw = h.cam.yaw = t.yaw),
    (h.cam.pitch = -0.18),
    showSkip(!0),
    document.body.classList.add(`tut`),
    h.tutorial.prepare(e),
    h.intro ? ((h.intro.around = new HavenFlyIn()), (h.intro.then = () => h.tutorial.begin())) : h.tutorial.begin());
}

/**
 * KR.endSandbox (71188): `done` (the trip ended) or `skip`. Puts the world and the save back; a first tutorial pays.
 * MINEAR: `carry` is what the tutorial trip found (Finish trip or worn-out claws, src/base/backToBase.ts goHome).
 * A first tutorial keeps it (in place of the practice gem it used to give); a replay keeps nothing.
 */
export function endSandbox(h: TutorialHost, e: 'skip' | 'done', carry?: Record<string, number> | null): void {
  if (!h.sandbox) return;
  h.sandbox = !1;
  const t = h.tutorial.first && e === `done`;
  ((h.intro = null),
    e === `skip` &&
      (h.burrow && h.exitBurrow(!1), (h.arc = null), h.ult.stop(), h.player.stopLift(), h.spawnAtHub(), h.liftWarp()));
  const n = h.world.restore();
  h.sandboxWas && (h.gems.restore(h.sandboxWas.gems, n), h.decor.restore(h.sandboxWas.decor));
  for (const e of n) (h.caveDecor.unloadChunk(e), h.chests?.unloadChunk(e));
  if (
    ((h.sandboxWas = null),
    h.pickups.clear(),
    h.items.clear(),
    setMonsterSandbox(h, !1),
    (h.combat.floor = 0),
    (h.goals.muted = !1),
    (h.state.hold = !1),
    h.state.reload(),
    t)
  )
    for (
      carry
        ? keepCarry(h.state, carry)
        : h.state.put(PRACTICE_GEM, 1) || (h.state.crystals[PRACTICE_GEM] = (h.state.crystals[PRACTICE_GEM] ?? 0) + 1);
      h.state.goal.i < 4 && h.goals.current;

    )
      (giveReward(h.state, h.goals.current.reward), (h.state.goal = { i: h.state.goal.i + 1, c: 0 }));
  for (const e of [`tutorial`, `burrow`, `slam`, `fought`]) h.state.seen[e] = !0;
  (t && (h.state.seen.spring = !0), h.state.save(), TutorialCoach.remember());
  try {
    localStorage.getItem(`minear.world`) || localStorage.setItem(`minear.world`, `?`);
  } catch {
    /* storage blocked */
  }
  (afterLoad(h), h.applySettings(h.settings), showSkip(!1), /* mp.connect() */ h.tutorial.afterward(e));
}

/** MINEAR: what a first tutorial trip found goes into the save again after state.reload: gems to the cart (the
 *  gem store when it is full), everything else (stone, ore, dice) where put() keeps it. */
function keepCarry(s: PlayerState, carry: Record<string, number>): void {
  for (const [id, n] of Object.entries(carry)) {
    if (!(n > 0)) continue;
    const kind = itemDef(id)?.kind;
    if (kind === `gem`) giveReward(s, { items: { [id]: n } });
    else if (kind) s.put(id, n);
  }
}

/** KR.afterLoad (71236): after the save was read again. */
export function afterLoad(h: TutorialHost): void {
  ((h.hasDug = !1),
    h.onStatsChanged?.(),
    (h.player.fuel = h.state.jet.fuelMax),
    (h.combat.hp = h.combat.maxHp),
    h.goals.refresh(),
    (h.fortuneMark = -1),
    h.syncSatchels?.(),
    h.ui.bumpCoins());
}

/** KR.showSkip (71246): the pause menu's Skip tutorial button. */
export function showSkip(e: boolean): void {
  document.querySelectorAll<HTMLElement>(`.open-tutorial`).forEach((t) => (t.hidden = !e));
}

/** KR.updateIntro (70870): after cam.update, flies the camera from the title view into the follow camera. */
export function updateIntro(h: Pick<TutorialHost, 'intro' | 'cam'>, e: number): void {
  const t = h.intro;
  if (!t) return;
  const n = h.cam.camera,
    r = T0.copy(n.position),
    i = T1.copy(n.getWorldDirection(T2)).multiplyScalar(12).add(r),
    a = T2.set(0, 0, -1).applyQuaternion(t.fromQ).multiplyScalar(30).add(t.from);
  t.t += Math.min(e, 0.05);
  let o: boolean;
  if (t.around) o = t.around.update(t.t, n, t.from, a, r, i, h.cam.pivot);
  else {
    const e = Math.min(1, t.t / (t.len ?? 1.2)),
      i = e * e * (3 - 2 * e),
      a = (t.from.x + r.x) / 2,
      s = (t.from.z + r.z) / 2,
      c = Math.max(t.from.y, r.y) + 6,
      l = 1 - i;
    (n.position.set(
      l * l * t.from.x + 2 * l * i * a + i * i * r.x,
      l * l * t.from.y + 2 * l * i * c + i * i * r.y,
      l * l * t.from.z + 2 * l * i * s + i * i * r.z,
    ),
      E1.setFromQuaternion(n.quaternion, `YXZ`),
      E0.setFromQuaternion(t.fromQ, `YXZ`));
    const u = Math.atan2(Math.sin(E1.y - E0.y), Math.cos(E1.y - E0.y));
    (n.quaternion.setFromEuler(E0.set(E0.x + (E1.x - E0.x) * i, E0.y + u * i, 0, `YXZ`)), (o = e >= 1));
  }
  (n.updateMatrixWorld(), o && ((h.intro = null), t.then?.()));
}

/** KR 71685-71693 (after keepWhere): the `leave` goal when the miner drops off the island, `home` back on it. */
export function updateHavenGoals(h: Pick<TutorialHost, 'started' | 'player' | 'leftHub' | 'goals'>): void {
  if (!h.started) return;
  const r = h.player,
    e = r.pos.y > LIFT_POINT.y - 3 && Math.hypot(r.pos.x - LIFT_POINT.x, r.pos.z - LIFT_POINT.z) < 23;
  (!e && r.pos.y < LIFT_POINT.y - 8 && !h.leftHub && ((h.leftHub = !0), h.goals.event(`leave`)),
    e && r.onGround && h.leftHub && ((h.leftHub = !1), h.goals.event(`home`)));
}
