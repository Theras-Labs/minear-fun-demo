// The goal / quest chain card KA: counts events toward the current goal of GOALS (src/state/goals.ts), pays the
// reward, and draws the #goal card (text, reward, bar, count).
// Bundle play-inUT-NSi.js lines 53537-53612 (the GA table, 53385-53536, is src/state/goals.ts).
import { GOALS, giveReward, type GoalDef } from '../state/goals';
import type { PlayerState } from '../state/playerState';
import { rewardHTML } from '../ui/goalReward';

/** The state the goal card reads and pays into. */
export type GoalState = Pick<
  PlayerState,
  'goal' | 'seen' | 'earn' | 'dice' | 'save' | 'level' | 'lodestone' | 'soulsGiven' | 'crystals' | 'room' | 'put'
>;

export class GoalCard { // KA (53537)
  s: GoalState;
  el = document.getElementById(`goal`)!;
  textEl = this.el.querySelector(`.text`) as HTMLElement;
  barEl = this.el.querySelector(`.bar i`) as HTMLElement;
  countEl = this.el.querySelector(`.count`) as HTMLElement;
  shown = -1;
  /** A goal was met: its text and reward (KR shows the banner, 70429). */
  onComplete: (text: string, reward: GoalDef['reward']) => void = () => {};
  /** While set (the sandbox tutorial) nothing counts and the card hides. */
  muted = !1;
  constructor(e: GoalState) {
    this.s = e;
  }
  /** The current goal (goals that were taken out are skipped), or null when all are done. */
  get current(): GoalDef | null {
    for (; GOALS[this.s.goal.i]?.gone; ) (this.s.goal.i++, (this.s.goal.c = 0));
    return GOALS[this.s.goal.i] ?? null;
  }
  /** Draws the card text again on the next update. */
  refresh(): void {
    this.shown = -1;
  }
  /** An event: counts t toward the current goal when its `on` is e. */
  event(e: string, t = 1): void {
    if (this.muted) return;
    const n = this.current;
    n && n.on === e && ((this.s.goal.c += t), this.check());
  }
  /** Per frame (KR.updateHud 75140): e the depth, t started. */
  update(e: number, t: boolean): void {
    if (this.muted) {
      this.el.classList.remove(`show`);
      return;
    }
    const n = this.current;
    (n?.depth !== void 0 && e >= n.depth && ((this.s.goal.c = n.depth), this.check()),
      n?.biomes !== void 0 &&
        ((this.s.goal.c = Object.keys(this.s.seen).filter((e) => e.startsWith(`biome:`)).length), this.check()),
      n?.slain !== void 0 &&
        ((this.s.goal.c = Object.keys(this.s.seen).filter((e) => e.startsWith(`slain:`)).length), this.check()),
      n?.check && ((this.s.goal.c = n.check(this.s)), this.check()),
      this.el.classList.toggle(`show`, t && !!this.current),
      this.render(e));
  }
  /** Pays and moves on when the count reaches the need. */
  check(): void {
    const e = this.current;
    if (!e) return;
    const t = e.need ?? e.depth ?? e.biomes ?? e.slain ?? 1;
    this.s.goal.c < t ||
      (this.s.goal.i++,
      (this.s.goal.c = 0),
      giveReward(this.s, e.reward), // MINEAR: materials, dice, rarely coins (src/state/goals.ts)
      this.s.save(),
      this.onComplete(e.text, e.reward),
      this.el.classList.remove(`done`),
      void this.el.offsetWidth,
      this.el.classList.add(`done`),
      (this.shown = -1));
  }
  render(e: number): void {
    const t = this.current;
    if (!t) return;
    const n = t.need ?? t.depth ?? t.biomes ?? t.slain ?? 1,
      r = t.depth === void 0 ? Math.min(n, this.s.goal.c) : Math.max(0, Math.min(t.depth, Math.floor(e)));
    if (this.shown !== this.s.goal.i) {
      ((this.shown = this.s.goal.i), (this.textEl.textContent = t.text));
      (this.el.querySelector(`.reward`) as HTMLElement).innerHTML = rewardHTML(t.reward);
    }
    ((this.barEl.style.width = `${(r / n) * 100}%`),
      (this.countEl.textContent = n > 1 ? `${r} / ${n}${t.depth === void 0 ? `` : ` m`}` : ``));
  }
}
