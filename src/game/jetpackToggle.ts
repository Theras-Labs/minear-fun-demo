// MINEAR: the jetpack can be taken off and put back on (the button in the dock, or the J key).
// Without it, Space only jumps, so some ledges are reached only by digging. The choice is kept in this browser.
import type { Game } from './Game';

const KEY = `minear.jetpack`;

/** The saved choice (on unless the player turned it off). */
export function savedJetpack(): boolean {
  try {
    return localStorage.getItem(KEY) !== `off`;
  } catch {
    return true;
  }
}

export function setupJetpackToggle(game: Game): void {
  const btn = document.getElementById(`jetbtn`) as HTMLButtonElement | null;
  const apply = (on: boolean) => {
    game.player.jetpackOn = on;
    game.model.setJetpack(on);
    if (btn) {
      btn.classList.toggle(`off`, !on);
      btn.setAttribute(`aria-pressed`, String(on));
      btn.querySelector(`b`)!.textContent = on ? `ON` : `OFF`;
    }
  };
  const toggle = () => {
    const on = !game.player.jetpackOn;
    apply(on);
    try {
      localStorage.setItem(KEY, on ? `on` : `off`);
    } catch {
      /* storage blocked */
    }
    game.ui.noteToast(``, on ? `Jetpack on: hold <kbd>Space</kbd> to fly` : `Jetpack off: <kbd>Space</kbd> only jumps`, 2200, `jetpack`);
  };
  btn?.addEventListener(`click`, (e) => {
    e.stopPropagation();
    toggle();
  });
  addEventListener(`keydown`, (e) => {
    if (e.code !== `KeyJ` || e.repeat || !game.started) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === `INPUT` || t.tagName === `TEXTAREA` || t.isContentEditable)) return;
    toggle();
  });
  apply(savedJetpack());
}
