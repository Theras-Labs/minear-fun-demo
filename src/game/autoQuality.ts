// Port of play-inUT-NSi.js 69293-69357: the auto quality tuner RL. It watches frame times while playing and steps
// the graphics quality down when the game is slow, and up once when it is very smooth. It climbs at most once
// per session and never above TOP_AUTO_QUALITY; a drop after a climb locks further climbs.
// KR makes it at 70109-70117 (level = settings.quality; set = write settings.quality, applySettings, save with
// gj, settingsPanel?.sync()) and feeds it in run() at 71593: settings.autoQuality && tuner.frame(rawDt, active),
// where rawDt is the uncapped frame time and active = started && !document.hidden && !anyPanel &&
// !settingsPanel.open && !keysPanel.open && !combat.ko && !paused (71585-71592).
import { IS_TOUCH } from './device';
import { QUALITY_LADDER, type Quality } from './settings';

/** PL (69293): sample window in seconds. */
export const SAMPLE_WINDOW = 2.5; // PL (69293)
/** FL (69294): median fps under this is slow. */
export const SLOW_FPS = 48; // FL (69294)
/** IL (69295): median fps at or over this is smooth. */
export const SMOOTH_FPS = 57; // IL (69295)
/** LL (69296): the highest level the tuner climbs to. */
export const TOP_AUTO_QUALITY: Quality = IS_TOUCH ? `lite` : `high`; // LL (69296)

export class AutoQuality { // RL (69297)
  level: () => Quality;
  set: (q: Quality) => void;
  frames: number[] = [];
  t = 0;
  settle = 8;
  slow = 0;
  smooth = 0;
  climbed = false;
  climbFailed = false;
  crawl = 0;
  grace = 0;
  trial = 0;

  constructor(level: () => Quality, set: (q: Quality) => void) {
    this.level = level;
    this.set = set;
  }

  /** frame (69313): one frame of `dt` seconds (uncapped); `active` false resets the window. */
  frame(dt: number, active: boolean): void {
    if (!active) {
      this.reset();
      return;
    }
    this.grace -= dt;
    if (dt > 0.25) {
      if (this.grace <= 0 && ++this.crawl >= 3) {
        this.crawl = 0;
        this.step(-1);
      }
      return;
    }
    this.crawl = 0;
    if (this.trial > 0) this.trial -= dt;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    this.frames.push(dt);
    this.t += dt;
    if (this.t < SAMPLE_WINDOW) return;
    const n = this.frames.sort((a, b) => a - b);
    const median = 1 / n[Math.floor(n.length / 2)];
    const low = 1 / n[Math.floor(n.length * 0.9)];
    this.frames.length = 0;
    this.t = 0;
    if (median < (this.trial > 0 ? 54 : SLOW_FPS)) {
      this.smooth = 0;
      if (++this.slow >= 2) this.step(-1);
    } else if (median >= SMOOTH_FPS && low >= 47) {
      this.slow = 0;
      if (++this.smooth >= 8) this.step(1);
    } else {
      this.slow = 0;
      this.smooth = 0;
    }
  }

  /** step (69338): one level down (-1) or up (1) on the quality ladder mj. */
  step(dir: number): void {
    const i = QUALITY_LADDER.indexOf(this.level());
    const up = dir > 0;
    if (up && (this.climbed || this.climbFailed || i >= QUALITY_LADDER.indexOf(TOP_AUTO_QUALITY))) return;
    if (!up && i <= 0) return;
    if (!up && this.climbed) this.climbFailed = true;
    if (up) this.climbed = true;
    this.set(QUALITY_LADDER[i + dir]);
    this.settle = 5;
    this.grace = 1.5;
    this.trial = up ? 30 : 0;
    this.slow = this.smooth = 0;
  }

  /** reset (69351) */
  reset(): void {
    this.frames.length = 0;
    this.t = 0;
    this.slow = this.smooth = 0;
    this.settle = Math.max(this.settle, 1.5);
  }
}
