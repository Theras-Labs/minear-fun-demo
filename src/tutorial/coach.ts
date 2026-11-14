// The tutorial coach VN: decides whether the tutorial runs, walks the sandbox steps (move, fly, dash, dig, gem,
// finish) and the after steps (quota, forge, ready; spring from the HUD), places the props and the practice gem,
// draws the #coach card and the #tut-mark arrow, and reports progress to /api/tut.
// Bundle play-inUT-NSi.js lines 60332-60848.
// MINEAR (user, 2026-11-15): after the gem the first trip ends: Finish trip, or mine on until the claws wear out
// (the claws do not wear before that step). Then, for a wallet with no NEAR, the free-actions quota; then the
// first gear, Stone Claws, at the Forge. The old steps (back up, shoot, burrow into a foe, Burrow Slam, ride the
// light home) are gone.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { surfaceHeight } from '../world/generate';
import { inTownZone } from '../foes/nav';
import { IS_TOUCH } from '../game/device';
import { touchIcon } from '../ui/touch';
import type { Gem } from '../gems/gemField';
import type { ItemId } from '../world/items';
import { Beacon, DigMarker, RingGate, type PropSparks, type TutorialProp } from './props';
import {
  AGAIN_KEY,
  BEACON_SPOT,
  DIG_DEPTH,
  DIG_SPOT,
  DONE_KEY,
  FWD_X,
  FWD_Z,
  PRACTICE_GEM,
  RING_SPOT,
  SANDBOX_STEPS,
  START_SPOT,
  STEP_TEXT,
  TMP_A,
  TMP_B,
  TMP_C,
  TUT_YAW,
  mouseIcon,
  type TutorialStep,
} from './steps';

/** The player's account as the after steps see it (src/tutorial/account.ts). */
export interface TutorialAccount {
  /** Signed in (NEAR Auth, or the Demo cheat's local account): the trip is kept and the Forge works. */
  signedIn: boolean;
  /** True when the wallet has no NEAR for gas (the relayer pays); null while not known yet. */
  zeroGas: boolean | null;
  /** Gas-free actions left today and the daily limit, from the contract; null while not read yet. */
  freeLeft: number | null;
  freeLimit: number | null;
}

/** What the coach reads of the game (KR passes it at 70802). */
export interface CoachHost {
  scene: THREE.Scene;
  player: { pos: THREE.Vector3; dodging: boolean; onGround: boolean; lifting: boolean };
  cam: { camera: THREE.Camera; yaw: number };
  state: { gemCount(): number };
  hub: { spots: { fountain: THREE.Vector3; forge: THREE.Vector3 } };
  audio: { tutNext(): void; tutDone(big?: boolean): void };
  sparks: PropSparks;
  gems: { plant(id: ItemId, pos: THREE.Vector3): Gem; unplant(g: Gem): void };
  touch?: { point(names: string[]): void } | null;
  /** KR.burrow */
  readonly burrow: boolean;
  /** Not playing: before start, a panel, paused, settings, controls, the intro camera, chat. */
  readonly away: boolean;
  /** mp.id (sent with the progress reports). */
  readonly id: string;
  /** world.groundBelow(x, z, y, 40) */
  floor(x: number, z: number, y: number): number | null;
  /** world.solid(x, y, z) */
  solid(x: number, y: number, z: number): boolean;
  /** grass.slam(x, y, z, r, k): flattens the grass (k 0 lets it stand again). */
  grass(x: number, y: number, z: number, r: number, k: number): void;
  /** decor.clear(x, z, r) */
  clear(x: number, z: number, r: number): void;
  /** KR.endSandbox(why) */
  leave(why: 'skip' | 'done'): void;
  /** MINEAR: fills the claws (the `finish` step starts with full claws). */
  fillClaws(): void;
  /** MINEAR: the account, for the after steps. */
  account(): TutorialAccount;
}

export type TutorialPhase = 'off' | 'sandbox' | 'after';

interface KeyboardLayoutMap {
  get(code: string): string | undefined;
}

export class TutorialCoach { // VN (60332)
  h: CoachHost;
  phase: TutorialPhase = `off`;
  /** The first tutorial of a new player (not a replay). */
  first = !1;
  /** The lift works in the sandbox. MINEAR: never (the `home` step is gone; Finish trip ends the sandbox). */
  liftOpen = !1;
  steps: TutorialStep[] = [];
  i = -1;
  t = 0;
  clock = 0;
  doneT = -1;
  props: TutorialProp[] = [];
  prop: TutorialProp | null = null;
  target: THREE.Vector3 | null = null;
  gem: Gem | null = null;
  gemT = -1;
  dashes = 0;
  wasDashing = !1;
  /** MINEAR: the Forge made gear during the `forge` step. */
  forgedOk = !1;
  grassAt: THREE.Vector3 | null = null;
  sent = !1;
  readyT = 0;
  shown = ``;
  el = document.getElementById(`coach`)!;
  pipsEl = this.el.querySelector(`.pips`) as HTMLElement;
  sayEl = this.el.querySelector(`.say`) as HTMLElement;
  howEl = this.el.querySelector(`.how`) as HTMLElement;
  nudgeEl = this.el.querySelector(`.nudge`) as HTMLElement;
  skipEl = this.el.querySelector(`.skip`) as HTMLElement;
  mark = document.getElementById(`tut-mark`)!;
  markEm = this.mark.querySelector(`em`) as HTMLElement;
  markArrow = this.mark.querySelector(`.arrow`) as HTMLElement;
  layout: KeyboardLayoutMap | null = null;
  constructor(e: CoachHost) {
    ((this.h = e),
      (navigator as Navigator & { keyboard?: { getLayoutMap?(): Promise<KeyboardLayoutMap> } }).keyboard
        ?.getLayoutMap?.()
        .then((e) => (this.layout = e))
        .catch(() => {}));
  }
  /** `first` for a new player, `again` when asked for (?tut or the settings replay), else null. ?notut never. */
  static wanted(t: { seen: Record<string, boolean>; lvl: number; deepest: number; shattered: number }): 'first' | 'again' | null {
    const n = new URLSearchParams(location.search);
    if (n.has(`notut`)) return null;
    let r = n.has(`tut`);
    try {
      sessionStorage.getItem(AGAIN_KEY) && ((r = !0), sessionStorage.removeItem(AGAIN_KEY));
    } catch {
      /* storage blocked */
    }
    return !t.seen.tutorial && t.lvl <= 1 && t.deepest < 25 && t.shattered === 0 && !TutorialCoach.veteran()
      ? `first`
      : r
        ? `again`
        : null;
  }
  /** This browser finished a tutorial before, or kept an archived save. */
  static veteran(): boolean {
    try {
      if (localStorage.getItem(DONE_KEY)) return !0;
      for (let e = 0; e < localStorage.length; e++) if (localStorage.key(e)?.startsWith(`minear.save.v1.`)) return !0;
    } catch {
      /* storage blocked */
    }
    return !1;
  }
  static remember(): void {
    try {
      localStorage.setItem(DONE_KEY, `1`);
    } catch {
      /* storage blocked */
    }
  }
  /** The settings panel's replay: reloads the page into the tutorial. */
  static again(): void {
    const e = new URLSearchParams(location.search);
    (e.delete(`notut`), e.delete(`autostart`));
    try {
      sessionStorage.setItem(AGAIN_KEY, `1`);
    } catch {
      e.set(`tut`, ``);
    }
    const t = e.toString();
    location.href = location.pathname + (t ? `?${t}` : ``);
  }
  /** Adds (or removes) one of each prop at the lift so their shaders compile with the rest (KR.warmShaders). */
  warm(e: boolean): void {
    this.warmed.length || (this.warmed = [new Beacon(), new RingGate(), new DigMarker()]);
    for (const t of this.warmed)
      e ? (t.group.position.set(LIFT_POINT.x, 5, LIFT_POINT.z), this.h.scene.add(t.group)) : t.group.removeFromParent();
  }
  warmed: TutorialProp[] = [];
  /** The sandbox start spot (into e) and heading. */
  startAt(e: THREE.Vector3): { pos: THREE.Vector3; yaw: number } {
    const t = this.h.floor(START_SPOT.x, START_SPOT.z, 18) ?? surfaceHeight(START_SPOT.x, START_SPOT.z);
    return { pos: e.set(START_SPOT.x, t + 0.05, START_SPOT.z), yaw: TUT_YAW };
  }
  prepare(e: boolean): void {
    ((this.first = e),
      (this.phase = `sandbox`),
      (this.liftOpen = !1),
      (this.steps = SANDBOX_STEPS),
      (this.clock = 0),
      (this.i = -1),
      (this.doneT = -1),
      document.body.classList.add(`tut`),
      this.tell(`start`));
  }
  /** The first step (after the intro camera). */
  begin(): void {
    this.phase !== `sandbox` ||
      this.i >= 0 ||
      (this.h.clear(BEACON_SPOT.x, BEACON_SPOT.z, 2),
      this.h.clear(RING_SPOT.x, RING_SPOT.z, 4.5),
      this.h.clear(DIG_SPOT.x, DIG_SPOT.z, 2.5),
      this.next());
  }
  /** The sandbox ended (KR.endSandbox): `skip` ends it; `done` goes on to the after steps. */
  afterward(e: 'skip' | 'done'): void {
    this.clearStep();
    for (const e of this.props) e.dispose();
    if (((this.props = []), document.body.classList.remove(`tut`), this.h.touch?.point([]), e === `skip`))
      return (this.tell(`skip:${this.steps[this.i] ?? `?`}`), this.end());
    // MINEAR: the trip ended (Finish trip or worn-out claws). A first tutorial goes on to the free-actions quota
    // (only a wallet with no NEAR sees it, see check) and the first gear at the Forge; a demo has no Forge.
    const signedIn = this.h.account().signedIn;
    (this.tell(`done`),
      (this.phase = `after`),
      (this.steps = this.first && signedIn ? [`quota`, `forge`, `ready`] : [`ready`]),
      (this.i = -1),
      this.next());
  }
  /** MINEAR: the claws do not wear in the sandbox before the `finish` step (so the lessons cannot end the trip). */
  get noWear(): boolean {
    return this.phase === `sandbox` && this.step !== `finish`;
  }
  /** MINEAR: the Forge made gear (src/base/basePanels.ts onForged). */
  forged(_grade: string): void {
    this.step === `forge` && (this.forgedOk = !0);
  }
  /** Only the Wellspring step (KR.updateHud 75053: home with a gem, never shattered). */
  springOnly(): void {
    this.phase === `off` && ((this.phase = `after`), (this.first = !1), (this.steps = [`spring`]), (this.i = -1), this.next());
  }
  end(): void {
    (this.clearStep(),
      (this.phase = `off`),
      this.el.classList.remove(`show`, `done`),
      this.mark.classList.remove(`show`),
      document.body.classList.remove(`tut`),
      this.h.touch?.point([]));
  }
  /** A gem was picked up (KR.collect 73936). */
  collected(e: string): void {
    this.step === `gem` && this.gem?.free && e === this.gem.id && this.complete();
  }
  /** Gems went into the Wellspring (KR.onSent 73284). */
  sentGems(): void {
    this.sent = !0;
  }
  /** The pause menu's Skip tutorial (.open-tutorial). */
  skip(): void {
    this.phase === `sandbox` ? this.h.leave(`skip`) : this.phase === `after` && this.end();
  }
  get step(): TutorialStep | null {
    return this.steps[this.i] ?? null;
  }
  /** Per frame (KR.update 71766): e dt, t playing. */
  update(e: number, t: boolean): void {
    if (this.phase === `off`) return;
    this.clock += e;
    for (let t = this.props.length - 1; t >= 0; t--) {
      const n = this.props[t];
      (n instanceof DigMarker ? n.update(e, this.h.cam.camera) : n.update(e, this.h.sparks)) ||
        (n.dispose(), this.props.splice(t, 1));
    }
    this.grassAt && this.h.grass(this.grassAt.x, this.grassAt.y, this.grassAt.z, 1.9, 0.85);
    const n = this.step;
    const shown =
      !!n && !this.h.away && (n !== `ready` || this.readyT > 0) && (n !== `quota` || this.h.account().zeroGas === !0);
    if ((this.el.classList.toggle(`show`, shown), this.doneT >= 0)) {
      ((this.doneT += e), this.doneT > 0.95 && this.next(), this.marker());
      return;
    }
    if (!n) return;
    (t && (this.t += e), this.check(n, e, t));
    const m = this.step; // check may skip a step (quota)
    m && (this.render(m), this.marker());
  }
  check(e: TutorialStep, t: number, n: boolean): void {
    const r = this.h.player,
      i = TMP_C.set(r.pos.x, r.pos.y + 0.9, r.pos.z);
    switch (e) {
      case `move`:
        Math.hypot(r.pos.x - BEACON_SPOT.x, r.pos.z - BEACON_SPOT.z) < 2.3 && this.complete();
        break;
      case `fly`:
        (this.prop as RingGate).through(i) && this.complete();
        break;
      case `dash`: {
        const e = r.dodging;
        (e && !this.wasDashing && (this.dashes++, this.h.audio.tutNext(), this.dashes >= 2 && this.complete()),
          (this.wasDashing = e));
        break;
      }
      case `dig`:
        (this.h.burrow || surfaceHeight(r.pos.x, r.pos.z) - r.pos.y >= DIG_DEPTH) && this.complete();
        break;
      case `gem`:
        (this.gem?.free && (this.gemT < 0 && (this.gemT = 0), (this.gemT += t), this.gemT > 2.5 && this.complete()),
          (!this.gem || (!this.gem.free && (this.t > 75 || this.gem.pos.distanceTo(r.pos) > 40))) &&
            ((this.t = Math.min(this.t, 20)),
            this.gem && this.h.gems.unplant(this.gem),
            (this.gem = this.plantGem()),
            this.gem || this.complete()),
          this.gem && !this.gem.free && (this.target = this.gem.pos));
        break;
      case `finish`:
        // the trip ends from the game: Finish trip or worn-out claws (src/base/backToBase.ts goHome)
        break;
      case `quota`: {
        // MINEAR: only a wallet with no NEAR (the relayer pays its gas) sees the quota; others skip it
        const a = this.h.account();
        if (!a.signedIn || a.zeroGas === !1 || (a.zeroGas === null && this.t > 6)) {
          this.next();
          break;
        }
        a.zeroGas && !this.h.away && n && ((this.readyT += t), this.readyT > 9 && this.complete());
        break;
      }
      case `forge`:
        this.forgedOk && this.complete();
        break;
      case `spring`:
        this.sent
          ? this.complete()
          : surfaceHeight(r.pos.x, r.pos.z) - r.pos.y > 3 && (this.tell(`left`), this.end());
        break;
      case `ready`:
        !this.h.away && n && ((this.readyT += t), this.readyT > 5.5 && (this.tell(`end`), this.end()));
    }
  }
  complete(): void {
    if (this.doneT >= 0) return;
    const e = this.step;
    ((this.doneT = 0),
      this.el.classList.add(`done`),
      this.h.audio.tutDone(e === `forge` || e === `spring`),
      this.tell(e!),
      this.prop?.go(),
      (this.prop = null),
      (this.target = null),
      (this.grassAt &&= (this.h.grass(this.grassAt.x, this.grassAt.y, this.grassAt.z, 1.9, 0), null)),
      this.h.touch?.point([]));
    const t = this.h.player.pos;
    this.h.sparks.emit({
      pos: TMP_A.set(t.x, t.y + 1.3, t.z),
      vel: TMP_B.set(0, 3, 0),
      spread: 2.6,
      color: 16765803,
      intensity: 2.8,
      size: 0.13,
      sizeEnd: 0.02,
      life: 0.9,
      gravity: 5,
      count: 22,
      drag: 1.2,
    });
  }
  clearStep(): void {
    (this.prop?.go(),
      (this.prop = null),
      (this.target = null),
      (this.grassAt &&= (this.h.grass(this.grassAt.x, this.grassAt.y, this.grassAt.z, 1.9, 0), null)));
  }
  next(): void {
    (this.clearStep(), (this.doneT = -1), (this.t = 0), this.i++, this.el.classList.remove(`done`), (this.shown = ``));
    const e = this.step;
    if (!e) {
      this.phase === `after` && this.end();
      return;
    }
    (this.enter(e), this.h.audio.tutNext(), this.el.classList.remove(`in`), void this.el.offsetWidth, this.el.classList.add(`in`));
  }
  enter(e: TutorialStep): void {
    const t = this.h,
      n = (e: number, n: number) => t.floor(e, n, 18) ?? surfaceHeight(e, n);
    switch (e) {
      case `move`: {
        t.clear(BEACON_SPOT.x, BEACON_SPOT.z, 2);
        const e = new THREE.Vector3(BEACON_SPOT.x, n(BEACON_SPOT.x, BEACON_SPOT.z), BEACON_SPOT.z);
        (this.show(new Beacon().at(e)), (this.target = e.clone().setY(e.y + 2)));
        break;
      }
      case `fly`: {
        t.clear(RING_SPOT.x, RING_SPOT.z, 4.5);
        const e = new THREE.Vector3(RING_SPOT.x, n(RING_SPOT.x, RING_SPOT.z) + 6, RING_SPOT.z),
          r = 0.52;
        (this.show(new RingGate().at(e, new THREE.Vector3(-FWD_X * Math.sin(r), Math.cos(r), -FWD_Z * Math.sin(r)))),
          (this.target = e));
        break;
      }
      case `dash`:
        ((this.dashes = 0), (this.wasDashing = this.h.player.dodging));
        break;
      case `dig`: {
        t.clear(DIG_SPOT.x, DIG_SPOT.z, 2.5);
        const e = new THREE.Vector3(DIG_SPOT.x, n(DIG_SPOT.x, DIG_SPOT.z), DIG_SPOT.z);
        (this.show(new DigMarker().at(e)), (this.grassAt = e), (this.target = e.clone().setY(e.y + 1)));
        break;
      }
      case `gem`:
        ((this.gem = this.plantGem()), (this.gemT = -1), this.gem && (this.target = this.gem.pos));
        break;
      case `finish`:
        this.h.fillClaws();
        break;
      case `quota`:
        this.readyT = 0;
        break;
      case `forge`: {
        this.forgedOk = !1;
        const f = this.h.hub.spots.forge;
        this.target = f.clone().setY(f.y + 2.2);
        break;
      }
      case `spring`:
        ((this.sent = !1), (this.target = this.h.hub.spots.fountain.clone().setY(this.h.hub.spots.fountain.y + 2.2)));
        break;
      case `ready`:
        this.readyT = 0;
    }
    IS_TOUCH && this.h.touch?.point(STEP_TEXT[e].buttons ?? []);
  }
  show(e: TutorialProp): void {
    (this.h.scene.add(e.group), this.props.push(e), (this.prop = e));
  }
  /** Plants the practice gem in solid rock 4.6-5.8 m from the miner (at least 3.5 m down), toward the camera first. */
  plantGem(): Gem | null {
    const e = this.h.player.pos,
      t = this.h.cam.yaw;
    for (let n = 0; n < 16; n++) {
      const r = t + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * (Math.PI / 6),
        i = 4.6 + (n % 3) * 0.6,
        a = new THREE.Vector3(e.x + Math.sin(r) * i, e.y - 0.4, e.z + Math.cos(r) * i);
      surfaceHeight(a.x, a.z) - a.y < 3.5 && (a.y = surfaceHeight(a.x, a.z) - 3.5);
      let o = !0;
      for (const [e, t, n] of [
        [0, 0, 0],
        [1.2, 0, 0],
        [-1.2, 0, 0],
        [0, 1.2, 0],
        [0, -1.2, 0],
        [0, 0, 1.2],
        [0, 0, -1.2],
      ])
        this.h.solid(Math.round(a.x + e), Math.round(a.y + t), Math.round(a.z + n)) || (o = !1);
      if (o && !inTownZone(a)) return this.h.gems.plant(PRACTICE_GEM, a);
    }
    return null;
  }
  render(e: TutorialStep): void {
    const t = STEP_TEXT[e];
    let n = t.say,
      r = IS_TOUCH ? t.thumbs : t.keys;
    if ((e === `dash` && (n = `Dash <span class="count">${this.dashes} / 2</span>`), e === `dig`)) {
      const e = this.h.player.pos;
      n = `Mine down <span class="count">${THREE.MathUtils.clamp(Math.floor(surfaceHeight(e.x, e.z) - e.y), 0, DIG_DEPTH)} / ${DIG_DEPTH} m</span>`;
    }
    if (e === `quota`) {
      // MINEAR: the free-actions quota (the contract's daily_free; it resets at 00:00 UTC)
      const a = this.h.account();
      r =
        a.freeLeft !== null && a.freeLimit !== null
          ? `Your wallet has no NEAR, so the game pays the gas: <b>${a.freeLeft.toLocaleString()} of ${a.freeLimit.toLocaleString()}</b> free actions left today. They reset at 00:00 UTC.`
          : `Your wallet has no NEAR, so the game pays the gas for a daily number of actions. They reset at 00:00 UTC.`;
    }
    e === `ready` && !this.h.account().signedIn && (r = `Sign in to keep what you mine and make gear at the Forge.`);
    (e === `gem` && !this.h.burrow && (r = IS_TOUCH ? `Hold ${touchIcon(`drill`)} to burrow to it` : `Hold ${mouseIcon(`l`)} to burrow to it`),
      e === `spring` && this.h.state.gemCount() > 1 && (n = `Send your gems into the Wellspring`),
      e === `spring` && this.h.player.pos.y < LIFT_POINT.y - 6 && ((n = `Ride the light up to the haven`), (r = ``)),
      this.layout &&
        !IS_TOUCH &&
        (r = r.replace(
          /<kbd>([A-Z])<\/kbd>/g,
          (_e, t: string) => `<kbd>${(this.layout!.get(`Key${t}`) ?? t).toUpperCase()}</kbd>`,
        )));
    const i = t.nudge && this.t > t.nudge[2] ? (IS_TOUCH ? t.nudge[1] : t.nudge[0]) : ``;
    const a =
        this.phase === `sandbox`
          ? this.steps.map((_e, t) => `<i class="${t < this.i ? `done` : t === this.i ? `on` : ``}"></i>`).join(``)
          : ``,
      o = this.phase === `sandbox` && this.i < 2 ? (IS_TOUCH ? `Pause to skip` : `Esc to skip`) : ``,
      s = `${n}|${r}|${i}|${a}|${o}`;
    s !== this.shown &&
      ((this.shown = s),
      (this.pipsEl.innerHTML = a),
      (this.sayEl.innerHTML = n),
      (this.howEl.innerHTML = r),
      (this.nudgeEl.textContent = i),
      (this.skipEl.textContent = o));
  }
  /** The #tut-mark arrow: on the target when it is on screen and far (or always for the gem and the Forge), else at
   *  the edge. */
  marker(): void {
    const e = this.target,
      t = this.h.cam.camera;
    if (!e || this.h.away || this.doneT >= 0) {
      this.mark.classList.remove(`show`);
      return;
    }
    const n = window.innerWidth,
      r = window.innerHeight,
      i = TMP_A.copy(e).project(t);
    let a = i.x,
      o = i.y;
    const s = i.z > 1;
    s && ((a = -a), (o = -o));
    const c = Math.max(Math.abs(a) / 0.86, Math.abs(o) / 0.78),
      l = s || c > 1,
      u = e.distanceTo(this.h.player.pos);
    if (!l && u < 30 && this.step !== `gem` && this.step !== `forge`) {
      this.mark.classList.remove(`show`);
      return;
    }
    let d = 0;
    if (l) {
      const e = 1 / Math.max(c, 0.001);
      ((a *= e), (o *= e), (d = Math.atan2(a, o)));
    }
    (this.mark.classList.add(`show`),
      (this.mark.style.transform = `translate(${((a * 0.5 + 0.5) * n).toFixed(1)}px, ${((-o * 0.5 + 0.5) * r).toFixed(1)}px) translate(-50%, -50%)`),
      (this.markArrow.style.transform = l ? `rotate(${d.toFixed(3)}rad)` : `rotate(180deg)`),
      (this.markEm.textContent = `${Math.round(u)} m`));
  }
  /**
   * tell (60835): the original posts tutorial progress ({id, s, t, m, f}) to its server at /api/tut.
   * That is server analytics, which this solo port does not have, so the report is dropped.
   */
  tell(_e: string): void {}
}
