// Port of the Drill Slam wiring of the game class KR (play-inUT-NSi.js 70056-75530): the construction of KR.ultFx
// and KR.ult with their deps (70556-70583), KR.slamCrater (74609-74652), KR.floorAt (74653-74659, the ground probe
// of the slam decals; nothing else in KR calls it) and the ult part of KR.warmUp (70978-70980).
//
// KR call sites the game keeps in its own code (t = hitstop-scaled dt, e = raw dt, a = controlling, n = input):
//   70523 combat host          dealt: () => this.ult?.dealt()
//   70556 constructor          const { ultFx, ult } = makeUlt(this)   (after the worm, before the touch budgets)
//   70978 warmUp               await warmUlt(this.ultFx, render)      (after the worm warm, before the burrow mat)
//   71196 endSandbox(`skip`)   this.ult.stop()                        (tutorial owner)
//   70807 tutorial host        ult: this.ult                          (tutorial owner)
//   71645 burrow switch        ... && this.modeCooldown <= 0 && !this.ult.leap && !this.returning && (...)
//   71655 player step          if (!this.ult.step(t) && !this.updateArc(t)) { burrow / p.update }
//   71746 fov kick             kick = thrust*5 + lifting*8 + burrow*thrust*4 + dodging*7 + this.ult.fovKick
//   71765 after mp.update      this.ult.frame(e, t, a)                (before tutorial.update and updateDrill)
//   71767 drill                this.updateDrill(t, a && !this.ult.holdsLmb)
//   71771-71776 combat input   lmb: a && n.lmb && !ult.holdsLmb, rmb: a && n.rmb && !ult.holdsRmb,
//                              dodge: a && !burrow && !ult.owns && doubled(WASD)
//   71843 rig                  model.update(t, { ..., slam: this.ult.slamPose() })
//   71847-71856 dash lines     const s = this.ult.streak(PR); const m = (p.dodging && !this.burrow) || !!s;
//                              if (m && !wasDashing) dashLines.start(s ?? $.set(vel.x, 0, vel.z), trail, !!s)
//                              else if (s) dashLines.turn(s); wasDashing = m; dashLines.update(t, m, ...)
//   71915 vortex               vortex.update(t, this.pointing || this.ult.spinning, ...)
//   72078 after rings.update   this.ultFx.update(t)
//   72221-72243 keys           src/ui/kr-hud.ts handleUseKeys (belt only when !ult.owns, `Ult` key, E)
//   75031/75066/75097/75138    src/ui/kr-hud.ts updateTouch / updateHud (ult meter, aim hint, charged tip)
// The remote-miner slamFx hooks (70765-70791) and mp.act are multiplayer: solo sends nothing.
import * as THREE from 'three';
import { BIOMES, cavernAtWorld, hasLiquidSurface } from '../world/caverns';
import type { ChunkManager } from '../world/chunkManager';
import type { PlayerState } from '../state/playerState';
import type { PlayerController } from '../player/controller';
import type { FollowCamera } from '../player/followCamera';
import type { Input } from '../player/input';
import type { MinerRig } from '../miner/rig';
import type { Combat } from '../combat/combat';
import type { Audio } from '../audio/audio';
import type { Hud } from '../ui/hud';
import type { Particles } from '../fx/particles';
import type { Debris } from '../fx/debris';
import type { RingPulsePool } from '../fx/rings';
import type { GemBursts } from '../fx/gemBursts';
import type { GrassField } from '../render/grass';
import type { Gem } from '../gems/gemField';
import type { CaveDecor } from '../cave/caveDecor';
import type { Decor } from '../decor/decor';
import { releaseGem, type PickupHost } from '../pickups/collect';
import { SlamFx } from './slamFx';
import { DrillSlam, type UltAct } from './drillSlam';

// KR shared temp (70040)
const T0 = new THREE.Vector3(); // $

/** What KR.slamCrater reads and writes; KR.releaseGem is pickups/collect.ts releaseGem(game, gem). */
export type CraterHost = PickupHost & {
  world: Pick<ChunkManager, `dig` | `remeshNear` | `groundBelow`>;
  state: PlayerState;
  grass: Pick<GrassField, `markDirty`>;
  gems: { release(pos: THREE.Vector3, r: number): Gem[] };
  caveDecor: Pick<CaveDecor, `removeNear`>;
  decor: Pick<Decor, `removeNear`>;
  sparks: Particles;
  dust: Particles;
  hasDug: boolean;
  ultTipT: number;
  inHaven(pos: THREE.Vector3): boolean;
};

/** The game object (KR) as the slam wiring reads it. */
export type UltHost = CraterHost & {
  scene: THREE.Scene;
  world: ChunkManager;
  player: PlayerController;
  model: MinerRig;
  cam: FollowCamera;
  input: Input;
  combat: Combat;
  audio: Audio;
  ui: Hud;
  debris: Debris;
  rings: RingPulsePool;
  gemBursts: GemBursts;
  grass: GrassField;
  /** KR getter 71249: started && !paused && !anyPanel && !settings/keys panel && !combat.ko && !chat. */
  readonly playing: boolean;
  burrow: boolean;
  /** The breach hop (KR.arc); truthy while hopping. */
  arc: unknown;
  hitstop: number;
  /** mp.act(tuple) (49007); solo: not served, sends nothing. */
  act?(tuple: UltAct): void;
};

/** KR.floorAt (74653): ground below (x, yTop, z) within maxDrop, or a liquid surface above it. */
export function floorAt( // KR.floorAt (74653)
  world: Pick<ChunkManager, `groundBelow`>,
  x: number,
  z: number,
  y: number,
  maxDrop = 18,
): number | null {
  const i = world.groundBelow(x, z, y, maxDrop),
    a = cavernAtWorld(x, y, z);
  return a && BIOMES[a.biome].liquid && hasLiquidSurface(a, x, z) && (i === null || i < a.liquidY) ? a.liquidY : i;
}

/** KR.slamCrater (74609): carves the crater (r 2.2, power x2), ore, gems, cave glow and props; ground under it. */
export function slamCrater(g: CraterHost, e: THREE.Vector3): number | null { // KR.slamCrater (74609)
  if (g.inHaven(e)) return null;
  const t = 2.2,
    n = T0.set(e.x, e.y + 1.45, e.z),
    r = g.world.dig(n, t, 220, g.state.drill.power * 2);
  g.world.remeshNear(n, 5.2);
  g.grass.markDirty(e.x, e.z);
  g.hasDug = true;
  if (!g.state.seen.slam) {
    g.state.seen.slam = true;
    g.ultTipT = 0;
  }
  let i = 0;
  for (const id in r.yields) {
    let c = r.yields[id];
    for (let k = 0; k < r.yields[id]; k++) if (Math.random() < g.state.oreBonus) c++;
    for (let k = 0; k < c; k++) g.pickups.spawnOre(id, n, i++ * 0.03);
  }
  for (const gem of g.gems.release(n, t)) releaseGem(g, gem);
  for (const s of g.caveDecor.removeNear(n, 2.6))
    g.sparks.emit({ pos: s.p, spread: 2.2, color: s.color.getHex(), intensity: 2.4, size: 0.12, sizeEnd: 0.02, life: 0.6, count: 6, drag: 2 });
  for (const d of g.decor.removeNear(n, 2.7, 2)) {
    const color = d.big ? 7126871 : d.color;
    g.dust.emit({
      pos: d.pos.clone().setY(d.pos.y + (d.big ? 2 : 0.3)),
      spread: d.big ? 2.5 : 0.8,
      color,
      size: d.big ? 0.8 : 0.3,
      sizeEnd: d.big ? 1.8 : 0.6,
      alpha: 0.8,
      life: 0.8,
      count: d.big ? 18 : 4,
      gravity: 2,
    });
  }
  return g.world.groundBelow(e.x, e.z, e.y + 1.2, 5);
}

/** KR constructor 70556-70583: the slam FX (added to the scene) and the Drill Slam controller with its deps. */
export function makeUlt(g: UltHost): { ultFx: SlamFx; ult: DrillSlam } { // KR 70556-70583
  const ultFx = new SlamFx((x, z, y) => floorAt(g.world, x, z, y, 7));
  g.scene.add(ultFx.group);
  const ult = new DrillSlam({
    world: g.world,
    state: g.state,
    player: g.player,
    model: g.model,
    cam: g.cam,
    input: g.input,
    combat: g.combat,
    audio: g.audio,
    ui: g.ui,
    sparks: g.sparks,
    dust: g.dust,
    debris: g.debris,
    rings: g.rings,
    fx: ultFx,
    safe: (e) => g.inHaven(e),
    hitstop: (e) => (g.hitstop = Math.max(g.hitstop, e)),
    crater: (e) => slamCrater(g, e),
    flare: (e, t, n) => g.gemBursts.flare(e, t, n),
    act: (e) => g.act?.(e),
    free: () => g.playing && !g.burrow && !g.player.lifting && !g.arc,
    onReady: () => {
      if (!g.state.seen.slam) g.ultTipT = 6;
    },
    grass: (e, t, n, r, i) => g.grass.slam(e, t, n, r, i),
  });
  return { ultFx, ult };
}

/** KR.warmUp 70978-70980: shows every slam mesh off-map for one render so the shaders compile. */
export async function warmUlt(fx: SlamFx, render: () => Promise<unknown>): Promise<void> { // KR.warmUp (70978)
  fx.warm(true);
  await render();
  fx.warm(false);
}
