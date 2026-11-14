// Port of play-inUT-NSi.js 55592-55863: touch controls lM (and rM, iM, aM, oM, sM, cM).
// In touch mode KR builds the #touch overlay (prepended into #ui): a floating left-thumb stick (it appears where
// the thumb lands on the left 42% of the screen), drag-to-look on the rest, and the buttons drill, shoot, jump,
// down, dash, use, echo, ult, pause and chat. They write into the Input object WA (src/player/input.ts):
//   stick  -> moveX / moveY (dead zone 0.14), hold ShiftLeft (run) past 1.1 stick radii
//   look   -> mouseDX / mouseDY (2.6 x the finger movement)
//   drill  -> lmb (+ lmbPressed)      shoot -> rmb
//   jump   -> hold Space              down  -> hold KeyC
//   dash   -> dash()                  use   -> tap KeyE      echo -> tap KeyQ
//   ult    -> tap `Ult`               pause -> tap Escape    chat -> hooks.chat() on release
// It also wires #belt .bslot -> Digit1..4 and the two #vitals .key labels -> Tab / KeyB, and rewrites the
// keyboard wording of the page for touch (#play, #pause footer, #chat-input, #controls sheet).
// KR: `if (J) touch = new lM(input, { chat })` (70585), touch.fullscreen() in start (71054), touch.update(...)
// from updateTouch (75019), cM(hint) in updateHud (75137).
//
// Differences from the original: the stat card table Sk and the goal list GA are not ported yet, so the two
// text rewrites the constructor makes on them (Sk.echo.blurb, GA[].text) run on hooks.skills / hooks.goals when
// they are given. dispose() is added (the original never removes its listeners) for React remounts.
import type { Input } from '../player/input';

/** rM (55592): look drag multiplier. */
export const LOOK_DRAG = 2.6; // rM (55592)
/** iM (55593): stick radius in px. */
export const STICK_R = 46; // iM (55593)
/** aM (55594): stick dead zone (fraction of the radius). */
export const STICK_DEAD = 0.14; // aM (55594)

/** Wj (55482) and X (55483): the stat icon outline. Copied for Gj.power. */
const STAT_OUTLINE = `#3a281c`; // Wj (55482)
const STAT_STROKE = `stroke="${STAT_OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`; // X (55483)
/** Gj.power (55485): the Burrow Power stat icon (the stat icon table Gj is not ported yet). */
const POWER_ICON = `<path d="M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z" fill="#fff1d6" ${STAT_STROKE}/><path d="M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z" fill="#fff1d6" ${STAT_STROKE}/><path d="M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z" fill="#fff1d6" ${STAT_STROKE}/><ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" ${STAT_STROKE}/><ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/>`; // Gj.power (55485); MINEAR: a mole claw, no drill

export type TouchButton = `drill` | `shoot` | `jump` | `down` | `dash` | `use` | `echo` | `ult` | `pause` | `chat`;

/** oM (55595): button icons. */
export const TOUCH_ICONS: Record<TouchButton, string> = { // oM (55595)
  drill: `<svg viewBox="0 0 48 48"><g transform="rotate(-28 24 25)">${POWER_ICON}</g></svg>`,
  shoot: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="12" cy="12" r="2.1" fill="#fff"/><path d="M12 1.8v4.6M12 17.6v4.6M1.8 12h4.6M17.6 12h4.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  jump: `<svg viewBox="0 0 24 24"><path d="M12 3.5 L19.5 12 H15 V20 H9 V12 H4.5 Z" fill="#fff"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M12 20.5 L19.5 12 H15 V4 H9 V12 H4.5 Z" fill="#fff"/></svg>`,
  dash: `<svg viewBox="0 0 24 24"><path d="M4.5 6 L11 12 L4.5 18 M12.5 6 L19 12 L12.5 18" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  use: `<svg viewBox="0 0 24 24"><path d="M8 11V5.5a1.6 1.6 0 0 1 3.2 0V10m0-1.2a1.6 1.6 0 0 1 3.2 0V11m0-.8a1.6 1.6 0 0 1 3.2 0v1.6m0-.6a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L5 15.5a1.6 1.6 0 0 1 2.7-1.7L8 14.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  echo: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4" fill="#fff"/><path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2M4.4 4.4a10.7 10.7 0 0 0 0 15.2M19.6 4.4a10.7 10.7 0 0 1 0 15.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  ult: `<svg viewBox="0 0 48 48"><g transform="rotate(90 24 22) translate(0 -3)">${POWER_ICON}</g><path d="M6 43h36" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M11 37l-4-3M37 37l4-3M15 31l-5-2M33 31l5-2" stroke="#ffe7a6" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M8.5 5.5v13M15.5 5.5v13" stroke="#3a281c" stroke-width="3.4" stroke-linecap="round"/></svg>`,
  chat: `<svg viewBox="0 0 24 24"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 20 17H10l-4.5 3.5V17H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5z" fill="none" stroke="#3a281c" stroke-width="2.2" stroke-linejoin="round"/><path d="M7 10h10M7 13h6" stroke="#3a281c" stroke-width="2" stroke-linecap="round"/></svg>`,
};

/** sM (55607): an inline touch icon for hint text. */
export const touchIcon = (name: string): string => // sM (55607)
  `<i class="tk ${name}">${(TOUCH_ICONS as Record<string, string>)[name] ?? ``}</i>`;

/** cM (55608): rewrites keyboard hints (<kbd>...) into touch wording and icons. */
export function touchText(html: string): string { // cM (55608)
  return html.includes(`<kbd>`)
    ? html
        .replace(
          `Burrowing! <kbd>WASD</kbd> fly · <kbd>E</kbd> up · <kbd>C</kbd> down`,
          `Burrowing! ${touchIcon(`jump`)} up · ${touchIcon(`down`)} down`,
        )
        .replace(/<kbd>B<\/kbd> opens (it|your gem bag|your cart), right-click a gem to destroy it/, `tap <b>cart</b> to destroy a gem`)
        .replace(/Press <kbd>E<\/kbd>/g, `Tap ${touchIcon(`use`)}`)
        .replace(/<kbd>Ult<\/kbd>/g, touchIcon(`ult`))
        .replace(/<kbd>LMB<\/kbd>/g, touchIcon(`drill`))
        .replace(/<kbd>RMB<\/kbd>/g, touchIcon(`shoot`))
        .replace(/<kbd>Space<\/kbd>/g, touchIcon(`jump`))
        .replace(/<kbd>E<\/kbd>/g, touchIcon(`use`))
        .replace(/<kbd>B<\/kbd>/g, `<b>cart</b>`)
        .replace(/<kbd>Tab<\/kbd>/g, `<b>gear</b>`)
    : html;
}

/** The second constructor argument: KR passes { chat: () => !sandbox && mp.chat.open() } (70585). */
export interface TouchHooks {
  chat: () => unknown;
  /** Sk (50635), the stat card table: the constructor rewrites Sk.echo.blurb. Not ported yet. */
  skills?: { echo?: { blurb?: string } };
  /** GA (53385), the goal list: the constructor rewrites the drill / shoot wording. Not ported yet. */
  goals?: { text: string }[];
}

/** update() input (75019-75032). */
export interface TouchFrame {
  /** Controls shown: started and no panel, pause, settings, controls sheet, knockout or chat. */
  play: boolean;
  burrow: boolean;
  /** Echo button shown. */
  echo: boolean;
  /** The use button's word (Wellspring, Shop, Chest, Talk, Mirror, Open, Pick up) or null to hide it. */
  use: string | null;
  ult: { k: number; ready: boolean; aiming: boolean };
}

type FingerRole = TouchButton | `stick` | `look`;

interface Finger {
  role: FingerRole;
  x: number;
  y: number;
  ox: number;
  oy: number;
}

type TouchInput = Pick<Input, `mouseDX` | `mouseDY` | `moveX` | `moveY` | `lmb` | `rmb` | `lmbPressed` | `hold` | `tap` | `dash`>;

export class TouchControls { // lM (55629)
  input: TouchInput;
  hooks: TouchHooks;
  root = document.createElement(`div`);
  stick: HTMLElement;
  knob: HTMLElement;
  useWord: HTMLElement;
  fingers = new Map<number, Finger>();
  shown = false;
  use: string | null = null;
  ultBtn: HTMLElement;
  ultShown = ``;
  pointed = ``;
  private bound: [EventTarget, string, EventListener][] = [];

  constructor(input: TouchInput, hooks: TouchHooks) {
    this.input = input;
    this.hooks = hooks;
    const root = this.root;
    root.id = `touch`;
    root.className = `off`;
    const button = (name: TouchButton, cls = ``) =>
      `<div class="tb ${name} ${cls}" data-b="${name}">${TOUCH_ICONS[name]}${name === `use` ? `<small></small>` : ``}</div>`;
    root.innerHTML = `<div class="stick"><i></i></div>${([`drill`, `shoot`, `jump`, `down`, `dash`, `use`, `echo`, `ult`] as const).map((n) => button(n)).join(``)}${button(`pause`, `top`)}${button(`chat`, `top`)}`;
    this.ultBtn = root.querySelector(`.ult`) as HTMLElement;
    document.getElementById(`ui`)!.prepend(root);
    this.stick = root.querySelector(`.stick`) as HTMLElement;
    this.knob = this.stick.querySelector(`i`) as HTMLElement;
    this.useWord = root.querySelector(`.use small`) as HTMLElement;
    const onTouch = (e: Event) => this.on(e as TouchEvent);
    for (const type of [`touchstart`, `touchmove`, `touchend`, `touchcancel`]) this.listen(root, type, onTouch);
    const tapOn = (el: Element | undefined, code: string) => {
      if (!el) return;
      this.listen(el, `touchstart`, (e) => {
        e.preventDefault();
        this.input.tap(code);
      });
    };
    document.querySelectorAll(`#belt .bslot`).forEach((el, i) => tapOn(el, `Digit${i + 1}`));
    const keys = document.querySelectorAll(`#vitals .key`);
    tapOn(keys[0], `Tab`);
    tapOn(keys[1], `KeyB`);
    const echo = hooks.skills?.echo;
    if (echo) echo.blurb = `Tap the Echo button while burrowing to send a sonar ping whenever you like.`;
    for (const g of hooks.goals ?? []) g.text = g.text.replace(`(hold LMB to burrow, RMB to shoot)`, `(Burrow into them, or Shoot)`);
    const set = (sel: string, html: string) => {
      const el = document.querySelector(sel);
      if (el) el.innerHTML = html;
    };
    set(`#play`, `Tap to play`);
    set(`#pause footer`, `Tap outside to resume`);
    const chatInput = document.getElementById(`chat-input`) as HTMLInputElement;
    chatInput.placeholder = `Say something…`;
    chatInput.enterKeyHint = `send`;
    const sheet = document.querySelector(`#controls .sheet`);
    const header = sheet?.querySelector(`header`);
    if (sheet && header) {
      sheet.replaceChildren(header);
      sheet.insertAdjacentHTML(
        `beforeend`,
        `
      <h3>On foot</h3>
      <div class="keygrid touchkeys">
        <div><i class="tk stickic"></i> left thumb: move (push to the edge to run)</div>
        <div><i class="tk lookic"></i> drag on the right: look</div>
        <div>${touchIcon(`drill`)} hold: burrow (mine, fight, turn bolts away)</div>
        <div>${touchIcon(`shoot`)} hold: shoot</div>
        <div>${touchIcon(`jump`)} jump, hold to fly</div>
        <div>${touchIcon(`dash`)} dash (the way the stick points)</div>
        <div>${touchIcon(`use`)} use, open chests (it shows up when you can)</div>
        <div>${touchIcon(`ult`)} slam (when it's charged), then ${touchIcon(`drill`)} to land it</div>
        <div>Belt: tap a slot · <b>gear</b> and <b>cart</b> on the bottom bar</div>
      </div>
      <h3>Burrowing <small>deep in the rock</small></h3>
      <div class="keygrid touchkeys">
        <div><i class="tk stickic"></i> fly · push into rock to mine</div>
        <div>${touchIcon(`jump`)} up · ${touchIcon(`down`)} down</div>
        <div>${touchIcon(`drill`)} burrow into the Lost · ${touchIcon(`shoot`)} shoot</div>
      </div>`,
      );
    }
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn, { passive: false });
    this.bound.push([target, type, fn]);
  }

  /** point (55706): tutorial highlight (`tut`) on the named buttons (`stick` for the stick). */
  point(names: string[]): void {
    const key = names.join(`,`);
    if (key === this.pointed) return;
    this.pointed = key;
    this.root.querySelectorAll(`.tut`).forEach((el) => el.classList.remove(`tut`));
    for (const n of names) this.root.querySelector(n === `stick` ? `.stick` : `.tb.${n}`)?.classList.add(`tut`);
  }

  /** update (55716): shows / hides the controls, burrow / echo / use state and the ult ring. */
  update(f: TouchFrame): void {
    if (f.play !== this.shown) {
      this.shown = f.play;
      this.root.classList.toggle(`off`, !f.play);
      if (!f.play) this.letGo();
    }
    if (!f.play) return;
    this.root.classList.toggle(`burrow`, f.burrow);
    this.root.classList.toggle(`echo`, f.echo);
    if (f.use !== this.use) {
      this.use = f.use;
      this.root.classList.toggle(`canuse`, !!f.use);
      if (f.use) this.useWord.textContent = f.use;
    }
    const u = f.ult;
    const key = `${Math.round(u.k * 120)}:${+!!u.ready}:${+!!u.aiming}`;
    if (key !== this.ultShown) {
      this.ultShown = key;
      this.ultBtn.style.setProperty(`--p`, u.k.toFixed(3));
      this.ultBtn.classList.toggle(`ready`, u.ready);
      this.ultBtn.classList.toggle(`aim`, u.aiming);
    }
  }

  /** fullscreen (55739): fullscreen without browser UI, then lock landscape. */
  fullscreen(): void {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen)
      el.requestFullscreen({ navigationUI: `hide` })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(`landscape`))
        .catch(() => {});
  }

  /** on (55748) */
  on(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches))
      if (e.type === `touchstart`) this.down(t);
      else if (e.type === `touchmove`) this.move(t);
      else this.up(t);
  }

  /** has (55753): a finger already holds this role. */
  has(role: FingerRole): boolean {
    for (const f of this.fingers.values()) if (f.role === role) return true;
    return false;
  }

  /** down (55757): a button, the stick (left 42%), or look. */
  down(t: Touch): void {
    const x = t.clientX;
    const y = t.clientY;
    const btn = (t.target as Element).closest?.(`[data-b]`) as HTMLElement | null | undefined;
    let role: FingerRole;
    let ox = x;
    let oy = y;
    if (btn) {
      role = btn.dataset.b as TouchButton;
      btn.classList.add(`on`);
      this.press(role, true);
    } else if (x < innerWidth * 0.42 && !this.has(`stick`)) {
      role = `stick`;
      ox = Math.max(58, Math.min(innerWidth - STICK_R - 12, x));
      oy = Math.max(58, Math.min(innerHeight - STICK_R - 12, y));
      this.stick.classList.add(`live`);
      this.stick.style.left = `${ox}px`;
      this.stick.style.top = `${oy}px`;
      this.setStick(x - ox, y - oy);
    } else if (!this.has(`look`)) role = `look`;
    else return;
    this.fingers.set(t.identifier, { role, x, y, ox, oy });
  }

  /** move (55777): the stick base follows past 1.6 radii; look adds to the mouse deltas. */
  move(t: Touch): void {
    const f = this.fingers.get(t.identifier);
    if (!f) return;
    const x = t.clientX;
    const y = t.clientY;
    if (f.role === `stick`) {
      let dx = x - f.ox;
      let dy = y - f.oy;
      const d = Math.hypot(dx, dy);
      const max = STICK_R * 1.6;
      if (d > max) {
        f.ox += dx * (1 - max / d);
        f.oy += dy * (1 - max / d);
        dx = x - f.ox;
        dy = y - f.oy;
        this.stick.style.left = `${f.ox}px`;
        this.stick.style.top = `${f.oy}px`;
      }
      this.setStick(dx, dy);
    } else {
      this.input.mouseDX += (x - f.x) * LOOK_DRAG;
      this.input.mouseDY += (y - f.y) * LOOK_DRAG;
    }
    f.x = x;
    f.y = y;
  }

  /** up (55798) */
  up(t: Touch): void {
    const f = this.fingers.get(t.identifier);
    if (!f) return;
    this.fingers.delete(t.identifier);
    this.release(f.role);
  }

  /** release (55802) */
  release(role: FingerRole): void {
    if (role === `stick`) {
      this.input.moveX = this.input.moveY = 0;
      this.input.hold(`ShiftLeft`, false);
      this.stick.classList.remove(`live`);
      this.stick.style.left = this.stick.style.top = ``;
      this.knob.style.transform = ``;
    } else if (role !== `look`) {
      this.root.querySelector(`.tb.${role}`)?.classList.remove(`on`);
      this.press(role, false);
    }
  }

  /** setStick (55812): knob offset, dead zone, move vector, run past 1.1 radii. */
  setStick(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy);
    const r = Math.min(1, d / STICK_R);
    const nx = d > 0 ? dx / d : 0;
    const ny = d > 0 ? dy / d : 0;
    this.knob.style.transform = `translate(${(nx * r * STICK_R).toFixed(1)}px, ${(ny * r * STICK_R).toFixed(1)}px)`;
    const k = r < STICK_DEAD ? 0 : (r - STICK_DEAD) / 0.86;
    this.input.moveX = k ? nx * k : 0;
    this.input.moveY = k ? -ny * k : 0;
    this.input.hold(`ShiftLeft`, d > STICK_R * 1.1);
  }

  /** press (55823): a button down / up into the input. */
  press(name: TouchButton, on: boolean): void {
    const n = this.input;
    switch (name) {
      case `drill`:
        n.lmb = on;
        if (on) n.lmbPressed = true;
        break;
      case `shoot`:
        n.rmb = on;
        break;
      case `jump`:
        n.hold(`Space`, on);
        break;
      case `down`:
        n.hold(`KeyC`, on);
        break;
      case `dash`:
        if (on) n.dash();
        break;
      case `use`:
        if (on) n.tap(`KeyE`);
        break;
      case `echo`:
        if (on) n.tap(`KeyQ`);
        break;
      case `ult`:
        if (on) n.tap(`Ult`);
        break;
      case `pause`:
        if (on) n.tap(`Escape`);
        break;
      case `chat`:
        if (!on) this.hooks.chat();
    }
  }

  /** letGo (55857): releases every finger and every held input. */
  letGo(): void {
    for (const f of this.fingers.values()) if (f.role !== `chat`) this.release(f.role);
    this.fingers.clear();
    this.input.lmb = this.input.rmb = false;
    for (const code of [`Space`, `KeyC`, `ShiftLeft`]) this.input.hold(code, false);
    this.input.moveX = this.input.moveY = 0;
  }

  /** Not in the original: removes the overlay and every listener the constructor added. */
  dispose(): void {
    for (const [target, type, fn] of this.bound) target.removeEventListener(type, fn);
    this.bound.length = 0;
    this.root.remove();
  }
}
