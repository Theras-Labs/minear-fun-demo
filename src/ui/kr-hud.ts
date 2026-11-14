// Port of play-inUT-NSi.js 74986-75264: the HUD part of the game class KR (screenMarker, updateTouch,
// updateHud; updateFortune, updateStrength, canFightAt), and the tail of KR.handleKeys 72221-72248 (belt digits,
// the touch `Ult` key, E to use / talk-skip, Q echo), which the touch buttons drive.
// Each KR method is a function here that takes the game object through KrHudHost. KR calls them:
//   handleKeys()            71626  (after the panel keys of 72173-72220 returned nothing)
//   updateFortune(dt, depth) 71954 (skipped in the sandbox), updateStrength(dt) 71955
//   updateHud(dt, depth)    72169  (last thing in update)
// Small helpers that only these KR methods use are ported here: uw, dw, lk, uk, dk, fk, GO, JR, onHub.
//
// Members of KrHudHost marked "not ported yet" are optional: when one is missing its branch acts as in the
// original with that system idle (no stranger nearby, no tutorial running, no satchel, no ult charge ...).
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { surfaceHeight } from '../world/generate';
import { IS_TOUCH } from '../game/device';
import type { HubSpot } from '../hub/hub';
import { isSiteId, type SiteId } from '../base/sites';
import type { EmitOptions } from '../fx/particles';
import type { Hud, HudCompass, HudState } from './hud';
import { touchText, type TouchControls } from './touch';

const W = LIFT_POINT; // W (28758)

/** uw (43017): the PvP level band at a depth. */
export const pvpBand = (depth: number): number => 3 + Math.floor(Math.max(0, depth) / 40); // uw (43017)
/** dw (43018): two miners may fight when their levels are within the band of the shallower one. */
export const canFight = (levelA: number, levelB: number, depthA: number, depthB: number): boolean => // dw (43018)
  Math.abs(levelA - levelB) <= pvpBand(Math.min(depthA, depthB));
/** lk (50617): Fortune gained per second underground at a depth. */
export const fortuneGain = (depth: number): number => (3 + 0.08 * Math.max(0, depth)) / 60; // lk (50617)
/** uk (50618): Fortune lost per second up top. */
export const FORTUNE_DECAY = 8 / 60; // uk (50618)
/** dk (50619): the Fortune mark index (25% steps to 75%, then 100% steps). */
export const fortuneMarkOf = (f: number): number => (f < 100 ? Math.floor(Math.max(0, f) / 25) : 3 + Math.floor(f / 100)); // dk (50619)
/** fk (50620): the percent a mark index stands for. */
export const fortuneMarkPercent = (m: number): number => (m <= 4 ? m * 25 : (m - 3) * 100); // fk (50620)
/** GO (50259): chest names by kind. */
export const CHEST_NAMES = [`Wooden Chest`, `Iron Chest`, `Golden Chest`]; // GO (50259)

/** JR (75545): seconds as m:ss. */
export function clockText(sec: number): string { // JR (75545)
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, `0`)}`;
}

/** KR.onHub (74583): on the floating hub island. */
export function onHub(p: { x: number; y: number; z: number }): boolean { // KR.onHub (74583)
  return p.y > W.y - 2 && Math.hypot(p.x - W.x, p.z - W.z) < 22;
}

/** The satchel fields KR reads (Uk satchels, 51xxx). exp is a performance.now() time. */
export interface SatchelLike {
  exp?: number;
  mine?: boolean;
}

/** The player state Fj (54340-55309) fields these functions read, on top of what Hud.update reads. */
export interface KrHudState extends HudState {
  /** Drill Slam charge 0..1. */
  ult: number;
  shattered: number;
  packFull: boolean;
  fortune: number;
  readonly fortuneNow: number;
  fortuneBest: number;
  readonly dmgMul: number;
  seen: { spring?: boolean };
  jet: { fuelMax: number };
  stashCount(): number;
  gemCount(): number;
  stat(id: string): number;
  save(): void;
}

/** The audio methods used here (dM, src/audio). */
export interface KrHudAudio {
  lodeLand(k: number): void;
  sonar(): void;
}

/** The game object (KR) as these functions read and write it. */
export interface KrHudHost {
  started: boolean;
  sandbox: boolean;
  burrow: boolean;
  paused: boolean;
  /** menu / shatter / inv / leaders panel open (KR getter 71299). */
  anyPanel: boolean;
  hasDug: boolean;
  drilling: boolean;
  crossState: string;
  hintOverride: string;
  // timers and marks KR keeps; written here
  hardHintT: number;
  fullHintT: number;
  burrowTipT: number;
  ultTipT: number;
  lodestoneT: number;
  /** Starts at -1 (70164). */
  fortuneMark: number;
  fortuneSaveT: number;
  echoT: number;

  player: { pos: THREE.Vector3; fuel: number; onGround: boolean; lifting: boolean };
  cam: { camera: THREE.Camera; yaw: number };
  input: { locked: boolean; everLocked: boolean; hit(code: string): boolean };
  env: { underground: number };
  sparks: { emit(o: EmitOptions): void };
  ui: Hud;
  /** lM, only in touch mode. */
  touch?: TouchControls | null;
  state: KrHudState;
  combat: { ko: boolean; hp: number; maxHp: number; hurtLevel: number; koLevel: number };
  hub: { near(pos: THREE.Vector3): HubSpot | null };
  inHaven(pos: THREE.Vector3): boolean;
  /** MINEAR base: opens a base site's panel (not the Trade Post, which is openMenu). */
  openSite?(id: SiteId): void;
  /** MINEAR base: the hint line next to a base site (keys), and its word on the touch use button. */
  siteHint?(id: SiteId): string;
  siteWord?(id: SiteId): string;

  // not ported yet (optional)
  audio?: KrHudAudio;
  /** wD drill slam. */
  ult?: { ready: boolean; aiming: boolean; leap?: unknown; owns?: boolean; key(): void };
  /** VN tutorial. */
  tutorial?: { phase: string; springOnly(): void };
  /** oR the Stranger. */
  stranger?: { near(pos: THREE.Vector3): boolean };
  /** MINEAR: the merchants on the floating islands (src/npc/merchants.ts) and their dialog. */
  merchants?: { near(pos: THREE.Vector3): { id: string; name: string; title: string } | null };
  openMerchant?(id: string): void;
  /** tR the Mirror of Renown. */
  mirror?: { near(pos: THREE.Vector3): boolean };
  /** vP loot panel. */
  loot?: { open: boolean };
  /** yj settings panel. */
  settingsPanel?: { open: boolean };
  /** qL controls sheet. */
  keysPanel?: { open: boolean };
  /** EO multiplayer chat. */
  mp?: { chat: { isOpen: boolean } };
  /** The chest in reach (tk chests). */
  chestHint?: { kind: number } | null;
  /** The satchel in reach. */
  satchelHint?: SatchelLike | null;
  /** Uk satchels: mine() = my satchel position, place() = its world-space label. */
  satchels?: {
    mine(): { x: number; y: number; z: number; exp?: number } | null;
    place(camera: THREE.Camera, w: number, h: number, hint: SatchelLike | null): void;
  };
  /** Mk (51162): what a satchel holds, as HTML. */
  describeSatchel?(s: SatchelLike): { one: boolean; what: string };
  /** KA goals card. */
  goals?: { update(depth: number, started: boolean): void };
  /** KR.nextBeast (75491): the next lair for the lodestone. */
  nextBeast?(): { x: number; z: number; color: string } | null;
  /** Mp sonar ping. */
  ping?: { fire(): void };
  // KR actions that handleUseKeys calls
  useBelt?(slot: number): void;
  openShatter?(): void;
  openMenu?(): void;
  openStash?(): void;
  openLeaders?(): void;
  talkToStranger?(): void;
  openChest?(chest: { kind: number }): void;
  lootSatchel?(s: SatchelLike): void;
}

// KR module scratch ($ and MR, 70040-70041) and the vectors updateHud allocated per frame
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR
const markTmp = new THREE.Vector3();
const homeAt = new THREE.Vector3();
const satchelAt = new THREE.Vector3();
const jetAt = new THREE.Vector3();

const describe = (g: KrHudHost, s: SatchelLike) => g.describeSatchel?.(s) ?? { one: false, what: `` };

/** KR.screenMarker (74987): screen point of a world point, clamped to the edge with an arrow angle. */
export function screenMarker(g: KrHudHost, pos: THREE.Vector3, w: number, h: number) { // KR.screenMarker (74987)
  const r = markTmp.copy(pos).project(g.cam.camera);
  let x = r.x;
  let y = r.y;
  const behind = r.z > 1;
  if (behind) {
    x = -x;
    y = -y;
  }
  let angle = Math.PI;
  const c = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.8);
  if (behind || c > 1) {
    const k = 1 / Math.max(c, 0.001);
    x *= k;
    y *= k;
    angle = Math.atan2(x, y);
  }
  return { x: (x * 0.5 + 0.5) * w, y: (-y * 0.5 + 0.5) * h, angle };
}

/** KR.updateTouch (75001): the use button's word and the touch controls state. */
export function updateTouch(g: KrHudHost, near: HubSpot | null): void { // KR.updateTouch (75001)
  const p = g.player;
  let use: string | null = null;
  if (g.started && !p.lifting) {
    if (near === `fountain`) use = `Wellspring`;
    else if (near === `trade`) use = `Shop`;
    else if (near === `stash`) use = `Chest`;
    else if (near && isSiteId(near)) use = g.siteWord?.(near) ?? `Use`;
    else if (!g.burrow && g.merchants?.near(p.pos)) use = `Trade`;
    else if (!g.burrow && g.stranger?.near(p.pos)) use = `Talk`;
    else if (!g.burrow && g.mirror?.near(p.pos)) use = `Mirror`;
    else if (g.chestHint) use = `Open`;
    else if (g.satchelHint) use = describe(g, g.satchelHint).one ? `Pick up` : `Open`;
  }
  g.touch!.update({
    play:
      g.started &&
      !g.anyPanel &&
      !g.paused &&
      !g.settingsPanel?.open &&
      !g.keysPanel?.open &&
      !g.combat.ko &&
      !g.mp?.chat.isOpen,
    burrow: g.burrow,
    use,
    echo: g.burrow && g.state.stat(`echo`) > 0 && g.echoT <= 0,
    ult: { k: g.state.ult, ready: !!g.ult?.ready, aiming: !!g.ult?.aiming },
  });
}

/** KR.updateHud (75034): picks the hint, builds compass / marker / jet data and runs Hud.update. */
export function updateHud(g: KrHudHost, dt: number, depth: number): void { // KR.updateHud (75034)
  const p = g.player;
  const st = g.state;
  const w = window.innerWidth;
  const h = window.innerHeight;
  g.hardHintT -= dt;
  g.fullHintT -= dt;
  g.burrowTipT -= dt;
  g.ultTipT -= dt;
  let hint = ``;
  let merchant: { name: string; title: string } | null = null;
  const keys = !g.touch;
  const fresh = st.deepest < 3;
  const onTop = p.pos.y > W.y - 2 && Math.hypot(p.pos.x - W.x, p.pos.z - W.z) < 22;
  const near = g.started && !g.burrow ? g.hub.near(p.pos) : null;
  const toSend = st.stashCount() + st.gemCount();
  const tutPhase = g.tutorial?.phase ?? `off`;
  if (
    g.started &&
    onTop &&
    !g.sandbox &&
    g.tutorial &&
    tutPhase === `off` &&
    st.shattered === 0 &&
    st.gemCount() > 0 &&
    !st.seen.spring
  ) {
    st.seen.spring = true;
    st.save();
    g.tutorial.springOnly();
  }
  if (!g.started) hint = ``;
  else if (g.anyPanel || g.loot?.open) hint = ``;
  else if (!g.input.locked && g.input.everLocked && !g.paused && !g.mp?.chat.isOpen && !g.combat.ko)
    hint = `Click to look around`;
  else if (g.ult?.aiming) hint = IS_TOUCH ? `<kbd>LMB</kbd> to slam` : `Click to slam · <kbd>E</kbd> to cancel`;
  else if (g.hardHintT > 0) hint = g.hintOverride;
  else if (g.sandbox) hint = depth > 4 && p.fuel < 1 && !p.onGround && !g.burrow ? `Out of fuel! Land to refuel` : ``;
  else if (g.burrow && g.burrowTipT > 0)
    hint = `Burrowing! <kbd>WASD</kbd> fly · <kbd>E</kbd> up · <kbd>C</kbd> down · push into rock to mine`;
  else if (g.chestHint && keys) hint = `Press <kbd>E</kbd> to open the ${CHEST_NAMES[g.chestHint.kind]}`;
  else if (g.satchelHint) {
    const s = g.satchelHint;
    const left = s.exp === undefined ? null : (s.exp - performance.now()) / 1e3;
    const d = describe(g, s);
    hint = `Press <kbd>E</kbd> to ${d.one ? `pick up ${d.what}` : `open ${s.mine ? `your` : `the`} satchel`}${left === null ? `` : ` <small>(gone in ${clockText(left)})</small>`}`;
  } else if (st.packFull && !onTop)
    hint = `Cart full of gems! Head home, or make room: <kbd>B</kbd> opens your cart, right-click a gem to destroy it`;
  else if (keys && !g.burrow && (merchant = g.merchants?.near(p.pos) ?? null))
    hint = `Press <kbd>E</kbd> to trade with <b>${merchant.name}</b> the ${merchant.title}`;
  else if (keys && !g.burrow && g.stranger?.near(p.pos) && !g.ui.talking) hint = `Press <kbd>E</kbd> to speak with the Stranger`;
  else if (keys && !g.burrow && g.mirror?.near(p.pos))
    hint = `Press <kbd>E</kbd> to look into the <b>Mirror of Renown</b>: the best miners of this world`;
  else if (keys && near === `fountain`)
    hint =
      toSend > 0
        ? `Press <kbd>E</kbd> to send your <b>${toSend} gem${toSend > 1 ? `s` : ``}</b> into the Wellspring`
        : `Press <kbd>E</kbd> to visit the Wellspring`;
  else if (keys && near === `trade`) hint = `Press <kbd>E</kbd> to trade: sell gems and gear, buy supplies, dice and geodes`;
  else if (keys && near === `stash`) hint = `Press <kbd>E</kbd> to open your storage chest (what's in it is safe from knockouts)`;
  else if (keys && near && isSiteId(near)) hint = g.siteHint?.(near) ?? ``;
  else if (g.ultTipT > 0 && g.ult?.ready && !g.burrow && !g.inHaven(p.pos))
    hint = IS_TOUCH
      ? `Burrow Slam charged! <kbd>Ult</kbd>, then <kbd>LMB</kbd> where to land`
      : `Burrow Slam charged! <kbd>E</kbd>, then click where to land`;
  else if (onTop && !g.hasDug && fresh && tutPhase === `off`) hint = `Jump off the edge to reach the mine site ▼`;
  else if (!onTop && !g.hasDug && fresh && depth > -3) hint = `Aim at the ground and hold <kbd>LMB</kbd> to burrow`;
  else if (depth > 4 && p.fuel < 1 && !p.onGround) hint = `Out of fuel! Land to refuel`;

  const home = homeAt.set(W.x, depth > 3 ? 4 : W.y + 2, W.z);
  const homeDist = home.distanceTo(p.pos);
  const homeShow = g.started && !onTop && homeDist > 12;
  const homeMark = screenMarker(g, home, w, h);
  const mine = g.satchels?.mine() ?? null;
  const loot = mine ? satchelAt.set(mine.x, mine.y + 1, mine.z) : null;
  const lootDist = loot ? loot.distanceTo(p.pos) : 0;
  const lootMark = loot ? screenMarker(g, loot, w, h) : null;
  const yaw = g.cam.yaw;
  const bearing = (x: number, z: number) => THREE.MathUtils.radToDeg(Math.atan2(x - p.pos.x, -(z - p.pos.z)));
  g.lodestoneT = Math.max(0, g.lodestoneT - dt);
  const beast = g.started ? (g.nextBeast?.() ?? null) : null;
  const compass: HudCompass = {
    heading: THREE.MathUtils.radToDeg(Math.atan2(Math.sin(yaw), -Math.cos(yaw))),
    home: homeShow ? bearing(home.x, home.z) : null,
    loot: loot && lootDist > 5 ? bearing(loot.x, loot.z) : null,
    beast:
      beast && Math.hypot(beast.x - p.pos.x, beast.z - p.pos.z) > 6
        ? { b: bearing(beast.x, beast.z), color: beast.color, pulse: g.lodestoneT > 0 }
        : null,
  };
  const jet = jetAt.set(p.pos.x + Math.cos(yaw) * 1.05, p.pos.y + 0.55, p.pos.z - Math.sin(yaw) * 1.05).project(g.cam.camera);
  g.satchels?.place(g.cam.camera, w, h, g.satchelHint ?? null);
  if (g.touch) updateTouch(g, near);
  if (g.touch) hint = touchText(hint);
  g.ui.ultMeter(st.ult, !!g.ult?.ready, !!g.ult?.aiming);
  document.body.classList.toggle(`panel`, g.anyPanel);
  g.goals?.update(depth, g.started);
  g.ui.update(dt, st, {
    fuel: p.fuel,
    fuelMax: st.jet.fuelMax,
    jet: {
      x: (jet.x * 0.5 + 0.5) * w,
      y: (-jet.y * 0.5 + 0.5) * h,
      show: g.started && !g.anyPanel && !g.burrow && !p.lifting && jet.z < 1,
    },
    compass,
    depth,
    fortune: st.fortuneNow,
    pvp: g.started && !g.inHaven(p.pos) && !onHub(p.pos) ? pvpBand(depth) : null,
    underground: g.env.underground,
    cross: g.started ? g.crossState : `none`,
    drilling: g.drilling,
    hint,
    home: { ...homeMark, show: homeShow, dist: homeDist },
    loot: {
      x: lootMark?.x ?? 0,
      y: lootMark?.y ?? 0,
      angle: lootMark?.angle ?? 0,
      show: !!lootMark && g.started && lootDist > 5,
      dist: lootDist,
      left: mine?.exp === undefined ? undefined : (mine.exp - performance.now()) / 1e3,
    },
    hp: g.combat.hp,
    hpMax: g.combat.maxHp,
    hurt: g.combat.hurtLevel,
    ko: g.combat.koLevel,
    camera: g.cam.camera,
    w,
    h,
  });
}

/** KR.updateFortune (75175): Fortune sparkles, gain underground / decay at home, a banner at each new mark. */
export function updateFortune(g: KrHudHost, dt: number, depth: number): void { // KR.updateFortune (75175)
  const n = g.player.pos;
  const r = g.state;
  if (g.fortuneMark < 0) g.fortuneMark = fortuneMarkOf(r.fortune);
  if (!g.started || g.combat.ko) return;
  const before = r.fortune;
  const now = r.fortuneNow;
  if (now >= 1 && Math.random() < dt * Math.min(30, 2 + now * 0.14)) {
    const a = Math.random() * Math.PI * 2;
    const rad = 0.45 + Math.random() * 0.45;
    const tier = now >= 300 ? 2 : +(now >= 100);
    g.sparks.emit({
      pos: T0.set(n.x + Math.cos(a) * rad, n.y + 0.15 + Math.random() * 1.6, n.z + Math.sin(a) * rad),
      vel: T1.set(-Math.sin(a) * 0.5, 0.35 + Math.random() * 0.4, Math.cos(a) * 0.5),
      spread: 0.15,
      color: Math.random() < 0.75 ? [16765803, 16757575, 16742973][tier] : [16774084, 16769162, 16761963][tier],
      intensity: Math.min(5, 2 + now / 45),
      size: Math.min(0.2, 0.08 + now / 900),
      sizeEnd: 0.015,
      life: 1.1 + Math.random() * 0.5,
      gravity: -0.25,
      drag: 0.6,
    });
  }
  if (!onHub(n) && !g.inHaven(n) && depth >= 4) {
    r.fortune = before + dt * fortuneGain(depth);
    if (r.fortune > r.fortuneBest) r.fortuneBest = r.fortune;
  } else if (before > 0) r.fortune = Math.max(0, before - dt * FORTUNE_DECAY);
  else return;
  g.fortuneSaveT -= dt;
  if (g.fortuneSaveT <= 0) {
    g.fortuneSaveT = 20;
    r.save();
  }
  const mark = fortuneMarkOf(r.fortune);
  if (mark < g.fortuneMark) g.fortuneMark = mark;
  if (mark > g.fortuneMark) {
    g.fortuneMark = mark;
    const pct = fortuneMarkPercent(mark);
    g.audio?.lodeLand(Math.min(1.2, 0.4 + mark * 0.12));
    for (let i = 0; i < 2; i++)
      g.sparks.emit({
        pos: T0.set(n.x, n.y + 1, n.z),
        vel: T1.set(0, 2.5, 0),
        spread: 4,
        color: i ? 16774084 : 16765803,
        intensity: 3,
        size: 0.14,
        sizeEnd: 0.02,
        life: 1.3,
        gravity: 1.5,
        count: 30,
        drag: 1.4,
      });
    g.ui.fortuneBump();
    if (pct >= 200) g.ui.banner(`FORTUNE +${pct}%`, `The deep grows restless`, `#ffb347`);
    else if (pct >= 100) g.ui.banner(`FORTUNE +${pct}%`, ``, `#ffd36b`);
    else g.ui.noteToast(``, `Fortune +${pct}%`, 0, `fortune`);
    r.save();
  }
}

/** KR.updateStrength (75242): red motes around the miner while a Flask of Strength runs. */
export function updateStrength(g: KrHudHost, dt: number): void { // KR.updateStrength (75242)
  if (!g.started || g.combat.ko || g.state.dmgMul <= 1 || Math.random() > dt * 9) return;
  const t = g.player.pos;
  const a = Math.random() * Math.PI * 2;
  const r = 0.3 + Math.random() * 0.35;
  g.sparks.emit({
    pos: T0.set(t.x + Math.cos(a) * r, t.y + 0.4 + Math.random() * 1.2, t.z + Math.sin(a) * r),
    vel: T1.set(0, 1.2, 0),
    spread: 0.2,
    color: Math.random() < 0.6 ? 16730682 : 16752736,
    intensity: 2.4,
    size: 0.07,
    sizeEnd: 0.01,
    life: 0.7,
    gravity: -0.6,
    drag: 0.8,
  });
}

/** KR.canFightAt (75261): PvP allowed between me and a miner of `level` at `pos`. */
export function canFightAt(g: KrHudHost, level: number, pos: { x: number; y: number; z: number }): boolean { // KR.canFightAt (75261)
  const n = g.player.pos;
  return canFight(g.state.level, level, surfaceHeight(n.x, n.z) - n.y, surfaceHeight(pos.x, pos.z) - pos.y);
}

/**
 * The tail of KR.handleKeys (72221-72248): belt digits (touch belt taps send Digit1-4), the touch `Ult` key,
 * E (use: Wellspring, shop, stash, talk or skip the typewriter, mirror, chest, satchel, else the slam) and
 * Q (echo while burrowing). KR runs it only when none of the panel keys before it (72173-72220) returned.
 */
export function handleUseKeys(g: KrHudHost): void { // KR.handleKeys (72221-72248)
  const e = g.input;
  if (!g.ult?.owns) for (let i = 0; i < 4; i++) if (e.hit(`Digit${i + 1}`)) g.useBelt?.(i);
  const near = g.started && !g.burrow ? g.hub.near(g.player.pos) : null;
  if (e.hit(`Ult`)) g.ult?.key();
  if (e.hit(`KeyE`)) {
    if (g.ult?.aiming || g.ult?.leap) g.ult!.key();
    else if (near === `fountain`) g.openShatter?.();
    else if (near === `trade`) g.openMenu?.();
    else if (near === `stash`) g.openStash?.();
    else if (near && isSiteId(near)) g.openSite?.(near);
    else if (!g.burrow && g.merchants?.near(g.player.pos)) g.openMerchant?.(g.merchants.near(g.player.pos)!.id);
    else if (!g.burrow && g.stranger?.near(g.player.pos)) {
      if (g.ui.typing) g.ui.talkSkip();
      else g.talkToStranger?.();
    } else if (!g.burrow && g.mirror?.near(g.player.pos)) g.openLeaders?.();
    else if (g.chestHint) g.openChest?.(g.chestHint);
    else if (g.satchelHint) g.lootSatchel?.(g.satchelHint);
    else g.ult?.key();
  }
  if (e.hit(`KeyQ`) && g.burrow && g.state.stat(`echo`) > 0 && g.echoT <= 0) {
    g.echoT = 6;
    g.ping?.fire();
    g.audio?.sonar();
  }
}
