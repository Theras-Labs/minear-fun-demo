// Port of play-inUT-NSi.js 45189-45237: the worm director yT. A per-player heat meter decides when the worm
// spawns. Heat rises while a player is targetable and at least 22 below the surface (faster when deeper, when
// digging and with fortune); past a random threshold a small per-frame chance spawns the worm on that player.
// At least 90 s between worms. Each worm killed raises the level (stronger worm); the level drops by one after
// 20 minutes without a kill.
import { surfaceHeight } from '../world/generate';
import type { SimPlayer } from '../foes/foeManager';
import type { GrinWorm } from './grinWorm';

/** Random heat threshold 1140-1920. */
export const wormThreshold = (): number => 1140 + Math.random() * 780; // vT (45189)

export interface WormHeat {
  heat: number;
  threshold: number;
}

export class WormDirector { // yT (45190)
  heat = new Map<string, WormHeat>();
  cooldown = 0;
  level = 0;
  forget = 0;

  /** A worm was killed. */
  slain(): void {
    this.level++;
    this.forget = 0;
  }

  of(e: string): WormHeat {
    let t = this.heat.get(e);
    if (!t) this.heat.set(e, (t = { heat: 0, threshold: wormThreshold() }));
    return t;
  }

  drop(e: string): void {
    this.heat.delete(e);
  }

  /** The calming song: heat to 0 and no worm for t seconds. */
  calm(e: string, t: number): void {
    this.of(e).heat = 0;
    this.cooldown = Math.max(this.cooldown, t);
  }

  update(e: number, t: GrinWorm, n: readonly SimPlayer[]): void {
    this.forget += e;
    if (this.level > 0 && this.forget > 1200) {
      this.level--;
      this.forget = 0;
    }
    if (t.active) return;
    this.cooldown -= e;
    for (const r of n) {
      const h = this.of(r.id);
      const i = surfaceHeight(r.pos.x, r.pos.z) - r.pos.y;
      if (!r.ok || i < 22) {
        h.heat = Math.max(0, h.heat - e * 0.5);
        continue;
      }
      const a = Math.max(0, r.fortune ?? 0);
      h.heat += e * (0.7 + Math.min(1.2, (i - 22) / 80)) * (r.digging ? 1.25 : 1) * (1 + a / 100);
      if (!(this.cooldown > 0 || h.heat < h.threshold) && Math.random() < e * 0.08) {
        h.heat = 0;
        h.threshold = wormThreshold();
        this.cooldown = Math.max(90, 200 / (1 + a / 300));
        t.spawn(r.pos, r.id, 48, this.level + a / 100);
        return;
      }
    }
  }
}
