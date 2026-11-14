// Port of play-inUT-NSi.js 69358-69410: the slow-frame watch WL (KR.crawl, 70118).
// After 6 active frames in a row slower than 0.2 s it turns off the terrain batching (world.unbatch), which is the
// local fix the original applies. The original also reports these numbers to its server (mp.net.send `perf`);
// that report is multiplayer telemetry and is left out of this solo port (`tell` is a no-op by default).
const SLOW = 0.2; // zL
const RUN = 6; // BL
const TELL_GAP_MS = 6e4; // VL
const TELL_MAX = 5; // HL
const WATCH_MS = 15e3; // UL

export interface SlowFramesHost {
  /** world.batch ? (world.unbatch(), true) : false */
  unbatch(): boolean;
  snapshot(): Record<string, unknown>;
  tell(msg: Record<string, unknown>): void;
}

export class SlowFrames { // WL (69363)
  private run = 0;
  private real = 0;
  private upd = 0;
  private draw = 0;
  private told = 0;
  private toldAt = -Infinity;
  private until = 0;
  private n = 0;
  private t = 0;
  private worst = 0;

  constructor(readonly host: SlowFramesHost) {}

  /** dt raw seconds, update ms, draw ms, active (playing and visible), now ms. */
  frame(dt: number, updMs: number, drawMs: number, active: boolean, now: number) {
    if (this.until) {
      if (active) {
        this.n++;
        this.t += dt;
        this.worst = Math.max(this.worst, dt);
      }
      if (now >= this.until) {
        this.until = 0;
        this.host.tell({ k: 'after', fps: this.t > 0 ? Math.round(this.n / this.t) : 0, worstMs: Math.round(this.worst * 1e3) });
      }
    }
    if (!active || dt < SLOW) {
      this.run = this.real = this.upd = this.draw = 0;
      return;
    }
    this.run++;
    this.real += dt;
    this.upd += updMs;
    this.draw += drawMs;
    if (this.run < RUN) return;
    const k = this.run;
    const msg = {
      k: 'crawl',
      ms: Math.round((this.real / k) * 1e3),
      upd: Math.round(this.upd / k),
      draw: Math.round(this.draw / k),
      ...this.host.snapshot(),
      wd: 0,
    };
    this.run = this.real = this.upd = this.draw = 0;
    const unbatched = this.host.unbatch();
    if (unbatched) {
      this.until = now + WATCH_MS;
      this.n = this.t = this.worst = 0;
    }
    if (!(this.told >= TELL_MAX || (!unbatched && now - this.toldAt < TELL_GAP_MS))) {
      this.told++;
      this.toldAt = now;
      this.host.tell({ ...msg, unbatched: +!!unbatched });
    }
  }
}
