// Port of the boss wiring of the game class KR (play-inUT-NSi.js 70056-75530): the boss fields and needBosses,
// makeBosses, flushBossDmg, bossWoke, updateBosses, bossSlain (72518-72775), the boss cases of onSim
// (72483-72515), the boss part of simReset (72385-72386), the boss lights (70550), bosses.me (70760), the boss
// part of warmUp (70973), calm (71289), the point scale of the boss particles (71302, 71322-71323) and the lazy
// load below 120 m (71636). updateBosses runs right after updateWorm (71794). Like WormClient, the game
// supplies the hooks below (ui, audio, camera shake, hitstop, combat, the hit route to the simulation, rewards).
import * as THREE from 'three';
import { BIOMES, cavernAtWorld, hasLiquidSurface, liquidAt } from '../../world/caverns';
import { surfaceHeight } from '../../world/generate';
import { pickGemByDepth } from '../../world/gemSpawn';
import { BIOME_GEM } from '../../world/items';
import type { Particles } from '../../fx/particles';
import type { Combat, CombatGems, CombatPickups, WormTarget } from '../../combat/combat';
import { loadBosses, type BossAsset } from '../view/assets';
import { BOSS_LIGHTS } from '../view/constants';
import type { BossView } from '../view/bossView';
import { BOSS_DEFS, BOSS_REST_S, type BossKind } from '../sim/defs';
import type { BossHostMsg } from '../sim/bossHost';
import { BossViews, wormAndBosses } from './bossViews';
import { TRIP_GIVES_COINS, TRIP_GIVES_GEAR } from '../../base/run';

// KR shared temp (70040)
const T0 = new THREE.Vector3(); // $

/** Audio manager dM methods the bosses use. */
export interface BossAudio {
  /** A boss voice (57275) at loudness k. */
  boss(kind: string, k?: number): void;
  /** The boss music layer (56398): 1 while the engaged boss fights; dt is the raw frame time. */
  setBoss(k: number, dt: number): void;
  gem(n: number): void;
}

/** HUD controller EM methods the bosses use. floater must copy pos. */
export interface BossUi {
  banner(title: string, sub: string, color: string): void;
  floater(pos: THREE.Vector3, text: string, color: string): void;
  flash(k: number): void;
  /** Boss HP bar (58199): fraction, `<name>, <TITLE>`, the boss kind as a class. */
  bossBarSet(frac: number, name?: string, kind?: string): void;
  noteToast(icon: string, html: string, ms?: number): void;
  itemToast?(item: unknown): void;
}

/** Player state Fj parts read and written when my boss kill pays out (not in PlayerStats yet). */
export interface BossStats {
  readonly fortuneNow: number;
  /** Boss id -> epoch ms when it may come back (offline play). */
  bossBack: Record<string, number>;
  seen: Record<string, boolean | undefined>;
  souls: string[];
  soulsGiven: string[];
  earn(coins: number): void;
  addItem(item: unknown): boolean;
  save(): void;
}

/** The beast souls sR (69861) and the soul pickup mesh uR (69882) of the Stranger chain (not ported yet). */
export interface BossSouls {
  /** sR[kind].id, or null when the kind has no soul. */
  id(kind: BossKind): string | null;
  /** uR(kind) */
  mesh(kind: BossKind): THREE.Object3D;
}

/** The KR parts the boss wiring reads. */
export interface BossClientHost {
  scene: THREE.Scene;
  world: { groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null };
  player: { pos: THREE.Vector3; vel: THREE.Vector3; onGround: boolean; lifting: boolean; readonly dodging: boolean };
  cam: { addShake(k: number): void };
  sparks: Particles;
  dust: Particles;
  debris: { burst(at: THREE.Vector3, color: number | THREE.Color, count: number, dir?: THREE.Vector3, speed?: number): void };
  combat: Pick<Combat, `worm` | `hp` | `ko` | `hurt` | `afflict`>;
  /** state.stat(`resfire` | `respoison`) */
  state: { stat(id: string): number };
  audio: BossAudio;
  ui: BossUi;
  /** KR: hitstop = max(hitstop, t). */
  hitstop(t: number): void;
  /** KR.started */
  started(): boolean;
  /** mp.id */
  me(): string;
  /** mp.nameOf(id) */
  nameOf(id: string): string;
  /** mp.hitBoss(id, dmg, weak); solo: bossHost.hitBoss(me, id, dmg, weak). */
  hitBoss(id: number, dmg: number, weak: boolean): void;
  /** KR.worm: the worm view, or null (combat.worm becomes the worm + boss target). */
  worm(): WormTarget | null;
  /** combat.foes.delay (ms) */
  foesDelay(): number;
  /** KR.compileScene(obj) (70949): compileAsync of obj into the composer read buffer, 8 s timeout. */
  compileScene(obj: THREE.Object3D): Promise<void>;
  /** mp.served: a server keeps the boss rest timers (no state.bossBack). Solo: false. */
  served?(): boolean;
  /** goals.event(`boss`) */
  goal?(name: string): void;
  stats?: BossStats;
  /** wP pickups (not ported yet). */
  pickups?: CombatPickups;
  /** Rb gems (not ported yet). */
  gems?: CombatGems;
  /** VP (62317) pickup mesh (not ported yet). */
  pickupMesh?(id: string): THREE.Object3D;
  /** rj(sj(weights, hk(fortune)), depth, opts): a gear item (gear system, not ported yet). */
  rollGear?(weights: readonly number[], fortune: number, depth: number, opts?: { biome: string }): unknown;
  souls?: BossSouls;
}

/** Phase-2 banners (72670-72675). */
const PHASE_TWO: Record<BossKind, [string, string]> = {
  titan: [`RIMEHEART CALLS THE BLIZZARD`, `The cold is only getting worse`],
};

/** Gear weights by rarity of a boss kill (72750-72751): the biome item, then a second roll. */
export const BOSS_GEAR_WEIGHTS: readonly number[] = [0, 0, 0, 55, 45];
export const BOSS_GEAR_WEIGHTS_2: readonly number[] = [0, 0, 25, 55, 20];

type BossSpawnMsg = Extract<BossHostMsg, { t: `boss` }>;

export class BossClient {
  host: BossClientHost;
  /** KR.bosses: the client boss manager gL, or null until the boss models load. */
  bosses: BossViews | null = null; // 72518
  bossDmg = { sum: 0, at: new THREE.Vector3(), weak: false, crit: false, immune: false, t: 0 }; // 72519
  bossPhase = new Map<number, number>(); // 72520
  bossNoted = new Set<number>(); // 72521
  bossLoad: Promise<void> | null = null; // 72522
  /** `boss` messages that came before the models loaded, replayed after the load. */
  bossHeld = new Map<number, BossSpawnMsg>(); // 72523

  /** KR constructor 70550: `scene.add(kI.glow, kI.flash)` (both lights exist from the start). */
  constructor(host: BossClientHost) {
    this.host = host;
    host.scene.add(BOSS_LIGHTS.glow, BOSS_LIGHTS.flash);
  }

  /** The nearest boss within 90 m that is awake (KR.calm 71289), or null. */
  engaged(): BossView | null {
    return this.bosses?.engaged() ?? null;
  }

  /** KR.update 71636: the first time deeper than 120 m, load the bosses. */
  checkDepth(depth: number): void {
    if (!this.bosses && depth > 120) this.needBosses();
  }

  /** Loads the boss models once; a failed load may retry after 30 s. */
  needBosses(): void { // 72524
    if (this.bosses || this.bossLoad) return;
    const d = this.host;
    this.bossLoad = loadBosses().then((e) => {
      if (!e) {
        setTimeout(() => (this.bossLoad = null), 3e4);
        return;
      }
      if (this.bosses) return;
      this.makeBosses(e, false);
      const t = this.bosses!;
      t.me = d.me();
      t.delay = d.foesDelay();
      const n = performance.now();
      for (const m of this.bossHeld.values()) t.onMsg(m, n);
      this.bossHeld.clear();
      void t.warmUp(() => d.compileScene(t.group)).then(() => d.scene.add(t.group));
    });
  }

  /** Creates gL with KR's hooks; t = add the group to the scene now. combat.worm becomes the worm + bosses. */
  makeBosses(e: BossAsset, t = true): void { // 72542
    const d = this.host;
    const n = new BossViews(e, {
      ground: (x, z, y) => {
        const r = d.world.groundBelow(x, z, y, 18);
        const i = cavernAtWorld(x, y, z);
        return i && BIOMES[i.biome].liquid && hasLiquidSurface(i, x, z) && (r === null || r < i.liquidY) ? i.liquidY : r;
      },
      me: () => {
        const p = d.player;
        return {
          pos: p.pos,
          vel: p.vel,
          grounded: p.onGround,
          exposed: d.started() && !d.combat.ko && !p.lifting,
        };
      },
      hurt: (e, t, n, r, i) => {
        const a = r
          ? Math.min(0.9, (r[0] > 0 ? d.state.stat(`resfire`) : r[1] > 0 ? d.state.stat(`respoison`) : 0) / 100)
          : 0;
        const o = Math.round(e * (1 - a));
        const s = d.combat.hp;
        const c = d.player.dodging;
        if (o <= 0 || !d.combat.hurt(o, t, n)) {
          if (c && !d.combat.ko && d.combat.hp === s && e >= 20)
            d.ui.floater(d.player.pos.clone().setY(d.player.pos.y + 2.4), `DODGED!`, `#fff1d6`);
          return false;
        }
        if (r) d.combat.afflict(e, r);
        if (i) d.player.vel.y = Math.max(d.player.vel.y, i);
        if (e >= 30) {
          d.hitstop(0.09);
          d.cam.addShake(0.45);
          d.ui.flash(0.18);
        } else d.cam.addShake(0.12);
        return true;
      },
      push: (e, t) => {
        const p = d.player;
        const r = p.pos.x - e.x;
        const i = p.pos.z - e.z;
        const a = Math.hypot(r, i) || 1;
        p.vel.x += (r / a) * t;
        p.vel.z += (i / a) * t;
        p.vel.y = Math.max(p.vel.y, 4);
      },
      hit: (e, t, n) => d.hitBoss(e, t, n),
      shown: (e, t, n, r, i) => {
        const a = this.bossDmg;
        a.sum += t;
        a.at.copy(e);
        a.weak ||= n;
        a.crit ||= r;
        a.immune ||= i;
        if (a.t <= 0) this.flushBossDmg();
        d.sparks.emit({
          pos: e,
          spread: 4,
          color: i ? 10132122 : n ? 16773336 : 16763024,
          intensity: 3,
          size: 0.13,
          sizeEnd: 0.02,
          life: 0.4,
          gravity: 8,
          count: n ? 12 : 6,
        });
      },
      sound: (e, t, n = 1) => d.audio.boss(e, THREE.MathUtils.clamp(1.15 - t.distanceTo(d.player.pos) / 70, 0.08, 1) * n),
      shake: (e) => d.cam.addShake(e),
      debris: (e, t, n, r) => d.debris.burst(e.clone(), t, n, T0.set(0, 1, 0), r),
      sparks: d.sparks,
      dust: d.dust,
    });
    this.bosses = n;
    if (t) d.scene.add(n.group);
    d.combat.worm = wormAndBosses(d.worm(), n);
  }

  /** One damage number per 0.25 s with the summed hits (IMMUNE when only immune hits). */
  flushBossDmg(): void { // 72634
    const e = this.bossDmg;
    if (e.sum <= 0 && !e.immune) return;
    const t = Math.round(e.sum);
    if (e.immune && t <= 0) this.host.ui.floater(e.at.clone().setY(e.at.y + 0.8), `IMMUNE`, `#b8b8c8`);
    else
      this.host.ui.floater(
        e.at.clone().setY(e.at.y + 0.8),
        e.weak ? `${t}!` : String(t),
        e.weak ? `#ffd23c` : e.crit ? `#ffe0b0` : `#ffffff`,
      );
    e.sum = 0;
    e.weak = e.crit = e.immune = false;
    e.t = 0.25;
  }

  /** The wake banner; t = who woke it. */
  bossWoke(e: BossView, t: string | undefined): void { // 72649
    const d = this.host;
    const n = t === d.me() ? `You woke it.` : t ? `${d.nameOf(t)} woke it.` : ``;
    d.ui.banner(e.def.name, `${e.def.title[0].toUpperCase()}${e.def.title.slice(1)} wakes! ${n}`, e.def.color);
    d.cam.addShake(0.5);
    this.bossPhase.set(e.id, 1);
  }

  /** KR.updateBosses(e, t) (72659): e = raw dt, t = hitstop dt. */
  update(e: number, t: number): void {
    const n = this.bosses;
    if (!n) return;
    const d = this.host;
    n.update(t, performance.now(), e);
    this.bossDmg.t -= e;
    if (this.bossDmg.t <= 0 && (this.bossDmg.sum > 0 || this.bossDmg.immune)) this.flushBossDmg();
    for (const v of n.views.values()) {
      const p = this.bossPhase.get(v.id) ?? v.phase;
      if (v.phase === 2 && p === 1 && !v.dead && v.pos.distanceTo(d.player.pos) < 120) {
        const [a, b] = PHASE_TWO[v.kind];
        d.ui.banner(a, b, v.def.color);
      }
      this.bossPhase.set(v.id, v.phase);
    }
    const r = n.engaged();
    if (r && !d.combat.ko) d.ui.bossBarSet(r.hp / r.maxHp, `${r.def.name}, ${r.def.title.toUpperCase()}`, r.kind);
    d.audio.setBoss(r && r.mode === `fight` && !d.combat.ko ? 1 : 0, e);
  }

  /** The boss e died at t; n = I hit it. Within 120 a banner; my kill spills the hoard. */
  bossSlain(e: BossView, t: THREE.Vector3, n: boolean): void { // 72686
    const d = this.host;
    const r = e.def;
    const i = t.distanceTo(d.player.pos) < 120;
    if (!n) {
      if (i) {
        d.ui.banner(`${r.name} IS SLAIN`, `Someone put it down! It will be back in time.`, r.color);
        d.cam.addShake(0.4);
      }
      return;
    }
    const st = d.stats;
    if (!d.served?.() && st) {
      st.bossBack[String(e.id)] = Date.now() + BOSS_REST_S * 1e3;
      st.save();
    }
    const a = Math.max(60, surfaceHeight(t.x, t.z) - t.y);
    if (liquidAt(t.x, t.y + 0.2, t.z)) t = d.player.pos.clone().setY(d.player.pos.y + 0.5);
    const o = `slain:${e.kind}`;
    const s = !st?.seen[o];
    if (st) st.seen[o] = true;
    d.goal?.(`boss`);
    d.ui.banner(`${r.name} IS SLAIN`, s ? `Its hoard spills out! (It will return in time.)` : `Its hoard spills out again!`, r.color);
    d.ui.flash(0.6);
    d.hitstop(0.35);
    d.cam.addShake(1);
    const c = BIOME_GEM[r.biome];
    const l: [string, number][] = [
      [`emerald`, 26],
      [`sapphire`, 32],
      [`ruby`, 28],
      [`sunstone`, 11],
      [`voidheart`, 3],
    ];
    const u = (): string => {
      let x = Math.random() * 100;
      for (const [id, w] of l) if ((x -= w) <= 0) return id;
      return `sapphire`;
    };
    // pickups.spawnGem(id, gems.makeMesh(id), t + random offset): the mesh first, then the offset randoms
    const g = (id: string): void => {
      const mesh = d.gems?.makeMesh(id);
      const at = t.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.6 + Math.random(), (Math.random() - 0.5) * 3));
      if (mesh) d.pickups?.spawnGem(id, mesh, at);
    };
    const f = 3 + Math.floor(Math.random() * 2) + Math.floor(e.power - 1);
    for (let k = 0; k < f; k++) g(c);
    for (let k = 0; k < 3; k++) g(u());
    for (let k = 0; k < 5 + Math.floor(Math.random() * 3); k++) g(pickGemByDepth(a + 60));
    for (let k = 0; k < 2; k++) {
      const mesh = d.gems?.makeMesh(`die`);
      if (mesh) d.pickups?.spawnGem(`die`, mesh, t.clone().setY(t.y + 1));
    }
    if (Math.random() < 0.2) {
      const mesh = d.pickupMesh?.(`deaddust`);
      if (mesh) d.pickups?.spawnGem(`deaddust`, mesh, t.clone().setY(t.y + 1));
    }
    // MINEAR: a mining trip pays no coins and gives no gear (src/base/run.ts); the gems, dice and soul stay
    if (TRIP_GIVES_COINS) {
      const p = Math.round((1300 + Math.floor(Math.random() * 700)) * e.power);
      st?.earn(p);
      d.ui.floater(t.clone().setY(t.y + 3), `+${p} coins`, `#ffc23d`);
    }
    const fortune = st?.fortuneNow ?? 0;
    const items = TRIP_GIVES_GEAR
      ? [d.rollGear?.(BOSS_GEAR_WEIGHTS, fortune, a + 40, { biome: r.biome }), d.rollGear?.(BOSS_GEAR_WEIGHTS_2, fortune, a)]
      : [];
    for (const it of items) if (it !== undefined && st?.addItem(it)) d.ui.itemToast?.(it);
    const m = e.kind;
    const soul = d.souls?.id(m) ?? null;
    if (soul && st && !st.souls.includes(m) && !st.soulsGiven.includes(m))
      d.pickups?.spawnGem(soul, d.souls!.mesh(m), t.clone().setY(t.y + 1.5));
    st?.save();
    for (let k = 0; k < 4; k++)
      d.sparks.emit({
        pos: t.clone().setY(t.y + 2),
        vel: new THREE.Vector3(0, 7, 0),
        spread: 11,
        color: [16765500, 16777215, 12815359, 16747068][k],
        intensity: 3.6,
        size: 0.3,
        sizeEnd: 0.03,
        life: 2,
        gravity: 6,
        count: 60,
        drag: 1,
      });
    d.audio.gem(5);
  }

  /** The boss cases of KR.onSim (72483-72515). Returns false for messages that are not the bosses'. */
  onSim(msg: { t: string }): boolean {
    const t = performance.now();
    const d = this.host;
    const e = msg as BossHostMsg;
    switch (e.t) {
      case `boss`:
        this.bosses?.onMsg(e, t);
        if (!this.bosses) {
          this.bossHeld.set(e.b.id, e);
          this.needBosses();
        }
        if (e.b.mode === 0 && !this.bossNoted.has(e.b.id)) {
          this.bossNoted.add(e.b.id);
          const b = BOSS_DEFS[e.b.kind];
          d.ui.noteToast(``, `${b.name}, ${b.title}, sleeps in the heart of this cavern...`, 5200);
        }
        return true;
      case `bosses`:
      case `bossAct`:
      case `bossHurt`:
      case `bossGone`:
        this.bosses?.onMsg(e, t);
        if (e.t === `bossGone`) this.bossHeld.delete(e.id);
        return true;
      case `bossWake`: {
        this.bosses?.onMsg(e, t);
        const n = this.bosses?.views.get(e.id);
        if (n) this.bossWoke(n, e.by);
        return true;
      }
      case `bossDie`: {
        const n = this.bosses?.views.get(e.id);
        this.bosses?.onMsg(e, t);
        if (n) this.bossSlain(n, T0.fromArray(e.p).clone(), e.by.includes(d.me()));
        return true;
      }
    }
    return false;
  }

  /** Boss part of KR.simReset(delay) (72385-72386): clear the views, set the delay (ms), drop held spawns. */
  simReset(e: number): void {
    if (this.bosses) {
      this.bosses.clear();
      this.bosses.delay = e;
      this.bossPhase.clear();
    }
    this.bossHeld.clear();
  }

  /** KR 70760: bosses.me = mp.id once the session has an id. */
  setMe(id: string): void {
    if (this.bosses) this.bosses.me = id;
  }

  /** Boss part of KR.warmShaders (70973): compile every boss and boss effect when the bosses are loaded. */
  async warmUp(draw: () => Promise<void>): Promise<void> {
    if (this.bosses) await this.bosses.warmUp(draw);
  }
}
