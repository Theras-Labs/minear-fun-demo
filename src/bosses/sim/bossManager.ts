// Port of play-inUT-NSi.js 41555-41622: the boss manager iC.
// Keeps the live bosses by cavern key. Once a second it checks the cavern of each player: a beast cavern with
// a player near (metric <= 2.6) and no rest timer gets its boss. A dead boss is removed 7 s after death and
// rests BOSS_REST_S (1200 s); a boss with no player near (metric < 3) for 90 s is removed.
import type { SimPlayer } from '../../foes/foeManager';
import { cavernAtWorld, cavernMetric } from '../../world/caverns';
import { Boss, type BossHooks, type BossWorld } from './boss';
import { BOSS_OF_BIOME, BOSS_REST_S } from './defs';

export class BossManager { // iC (41555)
  world: BossWorld;
  hooks: BossHooks;
  bosses = new Map<number, Boss>();
  /** Rest timers (s) by boss id: no boss while one runs. */
  back = new Map<number, number>();
  /** Seconds without a player near, by boss id. */
  quiet = new Map<number, number>();
  scanT = 0;
  /** Bosses made this tick: they skip their first update. */
  fresh = new Set<number>();

  constructor(e: BossWorld, t: BossHooks) {
    this.world = e;
    this.hooks = t;
  }

  byId(e: number): Boss | null {
    return this.bosses.get(e) ?? null;
  }

  update(e: number, t: readonly SimPlayer[]): void {
    for (const [id, left] of this.back) {
      if (left - e <= 0) this.back.delete(id);
      else this.back.set(id, left - e);
    }
    this.scanT -= e;
    if (this.scanT <= 0) {
      this.scanT = 1;
      for (const p of t) {
        const c = cavernAtWorld(p.pos.x, p.pos.y, p.pos.z);
        if (
          c &&
          c.beast &&
          BOSS_OF_BIOME[c.biome] &&
          !this.bosses.has(c.key) &&
          !this.back.has(c.key) &&
          !(cavernMetric(c, p.pos.x, p.pos.y + 1, p.pos.z) > 2.6)
        ) {
          this.bosses.set(c.key, new Boss(c, this.world, this.hooks));
          this.fresh.add(c.key);
        }
      }
    }
    for (const b of [...this.bosses.values()]) {
      if (this.fresh.delete(b.id)) continue;
      b.update(e, t);
      const r = t.some((p) => cavernMetric(b.region, p.pos.x, p.pos.y + 1, p.pos.z) < 3)
        ? 0
        : (this.quiet.get(b.id) ?? 0) + e;
      this.quiet.set(b.id, r);
      if (b.mode === `dead` && b.actT > 7) {
        this.remove(b);
        this.back.set(b.id, BOSS_REST_S);
        continue;
      }
      if (r > 90 && b.mode !== `dying` && b.mode !== `dead`) this.remove(b);
    }
  }

  remove(e: Boss): void {
    this.bosses.delete(e.id);
    this.quiet.delete(e.id);
    this.hooks.gone(e);
  }

  /** A player's hit: t = damage, n = crit (weak spot), r = player id. */
  hit(e: number, t: number, n: boolean, r: string | undefined): void {
    this.bosses.get(e)?.damage(t, n, r);
  }

  clear(): void {
    for (const b of [...this.bosses.values()]) this.remove(b);
    this.fresh.clear();
  }

  /** Rests boss e for t seconds (a sleeping boss goes away now). */
  rest(e: number, t: number): void {
    if (t <= 0) return;
    this.back.set(e, Math.max(this.back.get(e) ?? 0, t));
    const n = this.bosses.get(e);
    if (n && n.mode === `sleep`) this.remove(n);
  }

  resting(e: number): number {
    return this.back.get(e) ?? 0;
  }

  /** Dev: the boss of the player's cavern now (any cavern; clears its rest unless t is false). */
  poke(e: SimPlayer, t = true): Boss | null {
    const n = cavernAtWorld(e.pos.x, e.pos.y, e.pos.z);
    if (!n || !BOSS_OF_BIOME[n.biome]) return null;
    if (t) this.back.delete(n.key);
    let r = this.bosses.get(n.key);
    if (!r) {
      r = new Boss(n, this.world, this.hooks);
      this.bosses.set(n.key, r);
    }
    return r;
  }
}
