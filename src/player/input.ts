// Port of play-inUT-NSi.js 53271-53384: keyboard / mouse / pointer-lock input WA (and the null input qR, 75532).
// Collects held keys, keys pressed this frame, double-taps (dash), mouse buttons, wheel and mouse-look deltas.
// Mouse look counts only while pointer-locked or while RMB is held. Any key press (except the menu keys)
// re-requests pointer lock when relockOk() allows it. endFrame() clears the per-frame state.
// Touch mode (IS_TOUCH = J) skips the real pointer lock and fakes "locked".
//
// Difference from the original: the original binds its DOM listeners in the constructor. Here the constructor
// binds nothing; attach(element) binds the same listeners and detach() removes them.
//
// Touch hooks (written by the touch controller lM, 55592-55863, ported later): moveX/moveY (virtual stick,
// read by PlayerController), mouseDX/mouseDY (look drag), lmb/rmb/lmbPressed, hold(code, on), tap(code)
// (codes include the fake key `Ult`, KeyE, KeyQ, Escape), dash() (adds a double KeyW).
import { IS_TOUCH } from '../game/device';

/** VA (53271): keys that never trigger a re-lock. */
const NO_RELOCK = new Set([`Escape`, `Tab`, `KeyB`, `KeyM`, `Enter`, `NumpadEnter`]); // VA (53271)
/** HA (53272): double-tap window in ms. */
const DOUBLE_TAP_MS = 300; // HA (53272)
/** UA (53273): max hold of the first tap in ms. */
const TAP_HOLD_MS = 220; // UA (53273)

interface Tap {
  down: number;
  up: number;
}

export class Input { // WA (53274)
  el: HTMLElement | null = null;
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  wheel = 0;
  locked = false;
  enabled = false;
  /** Touch stick, -1..1 (moveY = forward). */
  moveX = 0;
  moveY = 0;
  relockOk: () => boolean = () => false;
  doubles = new Set<string>();
  taps = new Map<string, Tap>();
  everLocked = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === `INPUT` || t.tagName === `TEXTAREA` || t.isContentEditable)) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
    const now = performance.now();
    const tap = this.taps.get(e.code);
    if (tap && tap.up && now - tap.down < DOUBLE_TAP_MS && tap.up - tap.down < TAP_HOLD_MS) {
      this.doubles.add(e.code);
      this.taps.delete(e.code);
    } else this.taps.set(e.code, { down: now, up: 0 });
    if ([`Space`, `Tab`].includes(e.code)) e.preventDefault();
    if (this.enabled && !this.locked && !NO_RELOCK.has(e.code) && this.relockOk()) this.requestLock();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const tap = this.taps.get(e.code);
    if (tap && !tap.up) tap.up = performance.now();
  };
  private onBlur = (): void => {
    this.keys.clear();
    this.taps.clear();
    this.lmb = this.rmb = false;
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || IS_TOUCH) return;
    // A first click while unlocked only requests the lock once the user has locked before.
    if (!this.locked) {
      this.requestLock();
      if (this.everLocked) return;
    }
    if (e.button === 0) {
      this.lmb = true;
      this.lmbPressed = true;
    }
    if (e.button === 2) this.rmb = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };
  private onContextMenu = (e: Event): void => e.preventDefault();
  private onMouseMove = (e: MouseEvent): void => {
    if (this.enabled && (this.locked || this.rmb)) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };
  private onWheel = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };
  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.el;
    if (this.locked) this.everLocked = true;
  };

  /** Binds the listeners of the original constructor (window, element, document). */
  attach(el: HTMLElement): void {
    if (this.el) this.detach();
    this.el = el;
    window.addEventListener(`keydown`, this.onKeyDown);
    window.addEventListener(`keyup`, this.onKeyUp);
    window.addEventListener(`blur`, this.onBlur);
    el.addEventListener(`mousedown`, this.onMouseDown);
    window.addEventListener(`mouseup`, this.onMouseUp);
    el.addEventListener(`contextmenu`, this.onContextMenu);
    window.addEventListener(`mousemove`, this.onMouseMove);
    el.addEventListener(`wheel`, this.onWheel, { passive: true });
    document.addEventListener(`pointerlockchange`, this.onPointerLockChange);
  }
  /** Removes every listener bound by attach(). */
  detach(): void {
    const el = this.el;
    if (!el) return;
    window.removeEventListener(`keydown`, this.onKeyDown);
    window.removeEventListener(`keyup`, this.onKeyUp);
    window.removeEventListener(`blur`, this.onBlur);
    el.removeEventListener(`mousedown`, this.onMouseDown);
    window.removeEventListener(`mouseup`, this.onMouseUp);
    el.removeEventListener(`contextmenu`, this.onContextMenu);
    window.removeEventListener(`mousemove`, this.onMouseMove);
    el.removeEventListener(`wheel`, this.onWheel);
    document.removeEventListener(`pointerlockchange`, this.onPointerLockChange);
    this.el = null;
  }
  requestLock(): void {
    if (IS_TOUCH) {
      this.locked = this.everLocked = true;
      return;
    }
    try {
      const p = this.el?.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch == `function`) (p as Promise<void>).catch(() => {});
    } catch {}
  }
  down(code: string): boolean {
    return this.keys.has(code);
  }
  hit(code: string): boolean {
    return this.pressed.has(code);
  }
  doubled(code: string): boolean {
    return this.doubles.has(code);
  }
  /** Touch: hold a key code on or off (pressed this frame on the first hold). */
  hold(code: string, on: boolean): void {
    if (on) {
      if (!this.keys.has(code)) {
        this.keys.add(code);
        this.pressed.add(code);
      }
    } else this.keys.delete(code);
  }
  /** Touch: press a key code for this frame only. */
  tap(code: string): void {
    this.pressed.add(code);
  }
  /** Touch: dash (a double KeyW). */
  dash(): void {
    this.doubles.add(`KeyW`);
  }
  /** Clears the per-frame state. KR calls it once per frame after drawing. */
  endFrame(): void {
    this.pressed.clear();
    this.doubles.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
  }
}

/** qR (75532): input stand-in used while the game does not accept input (panels open, paused, KO, chat). */
export const NULL_INPUT = { // qR (75532)
  keys: new Set<string>(),
  pressed: new Set<string>(),
  mouseDX: 0,
  mouseDY: 0,
  moveX: 0,
  moveY: 0,
  lmb: false,
  rmb: false,
  wheel: 0,
  down: (_code: string) => false,
  hit: (_code: string) => false,
};
