// The tutorial coach VN: decides whether the tutorial runs, walks the sandbox steps (move, fly, dash, dig, gem,
// up, shoot, drill, slam, home) and the after steps (spring, ready), places the props, the practice gem and the
// practice foes, draws the #coach card and the #tut-mark arrow, and reports progress to /api/tut.
// Bundle play-inUT-NSi.js lines 60332-60848.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { surfaceHeight } from '../world/generate';
import { inTownZone } from '../foes/nav';
import { IS_TOUCH } from '../game/device';
import { touchIcon } from '../ui/touch';
import type { Foe } from '../foes/foe';
import type { FoeKind } from '../foes/types';
import type { SummonOverride } from '../foes/foeManager';
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

/** What the coach reads of the game (KR passes it at 70802). */
export interface CoachHost {
  scene: THREE.Scene;
  player: { pos: THREE.Vector3; dodging: boolean; onGround: boolean; lifting: boolean };
  cam: { camera: THREE.Camera; yaw: number };
  state: { ult: number; gemCount(): number };
  ult: { leap: unknown };
  hub: { spots: { fountain: THREE.Vector3 } };
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
  /** mp.summon(kind, pos, override): solo, the monster host's summon for the local player. */
  summon(kind: FoeKind, pos: THREE.Vector3, over: SummonOverride): Foe | null;
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
  /** The lift works in the sandbox (from the `home` step on). */
  liftOpen = !1;
  steps: TutorialStep[] = [];
  i = -1;
  t = 0;
  clock = 0;
  doneT = -1;
  props: TutorialProp[] = [];
  prop: TutorialProp | null = null;
  target: THREE.Vector3 | null = null;
  foes: Foe[] = [];
  raised = 0;
  gem: Gem | null = null;
  gemT = -1;
  dashes = 0;
  wasDashing = !1;
  retryT = 0;
  slammed = !1;
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
    (this.tell(`done`), (this.phase = `after`), (this.steps = this.first ? [`spring`, `ready`] : [`ready`]), (this.i = -1), this.next());
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
    if ((this.el.classList.toggle(`show`, !!n && !this.h.away && (n !== `ready` || this.readyT > 0)), this.doneT >= 0)) {
      ((this.doneT += e), this.doneT > 0.95 && this.next(), this.marker());
      return;
    }
    n && (t && (this.t += e), this.check(n, e, t), this.render(n), this.marker());
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
      case `up`:
        !this.h.burrow && surfaceHeight(r.pos.x, r.pos.z) - r.pos.y < 1.3 && r.onGround && this.complete();
        break;
      case `shoot`:
      case `drill`:
      case `slam`: {
        this.h.ult.leap && (this.slammed = !0);
        for (const t of this.foes) t.gone && t.state !== `dead` && this.raised < (e === `slam` ? 10 : 4) && this.raise(e, 1);
        ((this.foes = this.foes.filter((e) => !e.gone || e.state === `dead`)),
          this.foes.length || ((this.retryT -= t), this.retryT <= 0 && ((this.retryT = 1), this.raise(e, e === `slam` ? 4 : 1))));
        const n = this.foes.filter((e) => e.state !== `dead`);
        !n.length && this.foes.length && this.complete();
        let i: Foe | null = null,
          a = 1 / 0;
        for (const e of n) {
          const t = e.pos.distanceToSquared(r.pos);
          t < a && ((a = t), (i = e));
        }
        this.target = i ? (this.target ?? new THREE.Vector3()).set(i.pos.x, i.pos.y + 1.2, i.pos.z) : null;
        break;
      }
      case `home`:
        r.lifting && this.complete();
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
      this.h.audio.tutDone(e === `home` || e === `spring`),
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
      (this.foes = []),
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
      case `shoot`:
      case `drill`:
      case `slam`:
        ((this.foes = []),
          (this.raised = 0),
          (this.slammed = !1),
          e === `slam` && (this.h.state.ult = 1),
          this.raise(e, e === `slam` ? 4 : 1));
        break;
      case `home`: {
        this.liftOpen = !0;
        const e = new THREE.Vector3(LIFT_POINT.x, 3.2, LIFT_POINT.z);
        this.target = e.clone().setY(e.y + 2);
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
  /** Raises t practice miners of the Lost in front of the miner (out of the haven, on open ground). */
  raise(e: TutorialStep, t: number): void {
    const n = this.h.player.pos,
      r = this.h.cam.yaw,
      i: SummonOverride =
        e === `shoot` ? { hp: 64, speed: 2.6, dmg: 4 } : e === `drill` ? { hp: 120, speed: 3.4, dmg: 5 } : { hp: 95, speed: 3, dmg: 5 },
      a = e === `shoot` ? 13 : e === `drill` ? 5.5 : 8;
    let o = 0;
    for (let e = 0; e < 24 && o < t; e++) {
      const s =
          r +
          (t > 1 ? (o - (t - 1) / 2) * 0.32 : 0) +
          (e >= t ? (e % 2 ? 1 : -1) * Math.ceil((e - t + 1) / 2) * 0.35 : 0),
        c = a + (e >= t ? (e % 3) * 1.5 - 1.5 : 0),
        l = n.x + Math.sin(s) * c,
        u = n.z + Math.cos(s) * c,
        d = surfaceHeight(l, u),
        f = this.h.floor(l, u, d + 3);
      if (f === null || d - f > 1.5) continue;
      const p = new THREE.Vector3(l, f, u);
      if (inTownZone(p)) continue;
      const m = this.h.summon(`miner`, p, i);
      m && (this.foes.push(m), this.raised++, o++);
    }
  }
  render(e: TutorialStep): void {
    const t = STEP_TEXT[e];
    let n = t.say,
      r = IS_TOUCH ? t.thumbs : t.keys;
    if ((e === `dash` && (n = `Dash <span class="count">${this.dashes} / 2</span>`), e === `dig`)) {
      const e = this.h.player.pos;
      n = `Mine down <span class="count">${THREE.MathUtils.clamp(Math.floor(surfaceHeight(e.x, e.z) - e.y), 0, DIG_DEPTH)} / ${DIG_DEPTH} m</span>`;
    }
    (e === `gem` && !this.h.burrow && (r = IS_TOUCH ? `Hold ${touchIcon(`drill`)} to burrow to it` : `Hold ${mouseIcon(`l`)} to burrow to it`),
      e === `slam` &&
        this.slammed &&
        !this.h.ult.leap &&
        ((n = `Finish them off`),
        (r = IS_TOUCH ? `${touchIcon(`drill`)} or ${touchIcon(`shoot`)}` : `${mouseIcon(`l`)} or ${mouseIcon(`r`)}`)),
      e === `spring` && this.h.state.gemCount() > 1 && (n = `Send your gems into the Wellspring`),
      e === `spring` && this.h.player.pos.y < LIFT_POINT.y - 6 && ((n = `Ride the light up to the haven`), (r = ``)),
      this.layout &&
        !IS_TOUCH &&
        (r = r.replace(
          /<kbd>([A-Z])<\/kbd>/g,
          (_e, t: string) => `<kbd>${(this.layout!.get(`Key${t}`) ?? t).toUpperCase()}</kbd>`,
        )));
    let i = t.nudge && this.t > t.nudge[2] ? (IS_TOUCH ? t.nudge[1] : t.nudge[0]) : ``;
    if (e === `shoot` || e === `drill` || e === `slam`) {
      const e = this.h.player.pos;
      inTownZone(e)
        ? (i = `Nobody fights in the haven: step out onto the grass`)
        : (this.h.burrow || surfaceHeight(e.x, e.z) - e.y > 2.5) &&
          (i = IS_TOUCH ? `Back up to the surface first: hold the jump button` : `Back up to the surface first: hold Space`);
    }
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
  /** The #tut-mark arrow: on the target when it is on screen and far (or always for the gem), else at the edge. */
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
    if (!l && u < 30 && this.step !== `gem`) {
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
