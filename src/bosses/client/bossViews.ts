// Port of play-inUT-NSi.js 66782-68427: the client boss manager and attack scripts gL, the ray-sphere helper yL
// and the combined worm + boss target bL (with the module scratch _L / vL at 68398-68399).
// gL owns every boss view (QI) and the boss effect layer (telegraph decals, ice spikes, fire pillars, shockwave
// rings, lobbed missiles). It takes the boss messages of the monster
// simulation (bossAct and bossDie wait `delay` ms in a queue), moves the shared glow light to the nearest boss,
// fades the flash light, and plays each act as a client-side script: begin() paints the ground telegraph, then
// each frame titan() fires the timed effects and apply the damage to the local
// miner once per hit key (strike). It also answers the drill, shot and bomb hit tests against the boss bone
// spheres (sweep, rayHit, damage, blast). gL shares the scratch Q / BI / VI (tmpA / tmpB / tmpC) with the
// boss view, so the shared ones are used.
import * as THREE from 'three';
import { Telegraph } from '../../foes/telegraph';
import { Particles } from '../../fx/particles';
import type { WormTarget } from '../../combat/combat';
import type { BossAsset } from '../view/assets';
import { BossView, type BossPart, type BossScript, type BossViewHost } from '../view/bossView';
import {
  BOSS_COLORS,
  BOSS_LIGHTS,
  BOSS_REACH,
  CHILL_ELEMENTS,
  tmpA as Q,
  tmpB as BI,
  tmpC as VI,
} from '../view/constants';
import { IceSpikes, Missiles, Shockwaves } from '../view/vfx';
import { BOSS_ACTS, BOSS_KINDS, LEAP_WINDOW, type BossAct, type BossKind } from '../sim/defs';
import type { BossInfo } from '../sim/boss';
import type { BossHostMsg } from '../sim/bossHost';

/** hooks.me(): the local miner as the boss scripts see it (KR.makeBosses 72551). */
export interface BossMe {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  grounded: boolean;
  /** Started, not knocked out, not on the lift: only then do strikes land. */
  exposed: boolean;
}

/** Element triple [fire, poison, cold] of a boss hit, or null. */
export type BossElements = number[] | null;

/** The hooks KR.makeBosses (72542-72629) gives gL. */
export interface BossViewsHooks {
  /** Ground height below (x, yHint, z), or the liquid surface of a bog / lava pool (72544). */
  ground(x: number, z: number, yHint: number): number | null;
  me(): BossMe;
  /** Damage to the local miner from `from` with knock, elements and an upward velocity; true when it hurt. */
  hurt(dmg: number, from: THREE.Vector3, knock: number, el: BossElements, up: number): boolean;
  /** Knock the miner away from `from` by k (horizontal) and at least 4 up. */
  push(from: THREE.Vector3, k: number): void;
  /** Send my hit to the simulation (mp.hitBoss): raw damage, weak spot. */
  hit(id: number, dmg: number, weak: boolean): void;
  /** Show a damage number at point (shown damage, weak, crit, immune). */
  shown(point: THREE.Vector3, dmg: number, weak: boolean, crit: boolean, immune: boolean): void;
  /** A boss voice at pos, volume scale k (default 1). */
  sound(kind: string, pos: THREE.Vector3, k?: number): void;
  shake(k: number): void;
  debris(pos: THREE.Vector3, color: number, count: number, speed: number): void;
  sparks: Particles;
  dust: Particles;
}

/** A queued bossAct / bossDie: applied at local time `at` (ms). */
interface QueuedMsg {
  at: number;
  m: BossHostMsg;
}

/** A sphere hit on a boss (sweep). The point object is the key of hits; pass the same object to damage(). */
export interface BossSweepHit {
  point: THREE.Vector3;
  weak: boolean;
}

/** A ray hit on a boss (rayHit). */
export interface BossRayHit extends BossSweepHit {
  t: number;
}

// module scratch (68398-68399)
const _L = new THREE.Vector3(); // _L
const vL = new THREE.Vector3(); // vL

export class BossViews implements BossViewHost { // gL (66782)
  asset: BossAsset;
  hooks: BossViewsHooks;
  group = new THREE.Group();
  views = new Map<number, BossView>();
  /** Interpolation delay in ms (combat.foes.delay: 0 in solo). */
  delay = 0;
  clips = new Map<string, THREE.AnimationClip>();
  tele: Telegraph;
  spikes = new IceSpikes();
  rings = new Shockwaves();
  missiles = new Missiles();
  glow = BOSS_LIGHTS.glow;
  flashLight = BOSS_LIGHTS.flash;
  flashK = 0;
  queue: QueuedMsg[] = [];
  hits = new WeakMap<THREE.Vector3, { v: BossView }>();
  boulder: THREE.Mesh;
  /** My miner id (mp.id). */
  me = ``;

  constructor(e: BossAsset, t: BossViewsHooks) { // 66809
    this.asset = e;
    this.hooks = t;
    for (const c of e.clips) this.clips.set(c.name, c);
    this.tele = new Telegraph(t.ground);
    this.group.add(
      this.tele.group,
      this.spikes.mesh,
      this.rings.group,
      this.missiles.group,
    );
    this.boulder = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1, 1),
      new THREE.MeshStandardMaterial({
        color: 12576511,
        roughness: 0.2,
        emissive: 2779802,
        emissiveIntensity: 0.6,
        flatShading: true,
      }),
    );
  }

  /** A boss message; bossAct and bossDie wait for the interpolation delay (max 80 queued). */
  onMsg(e: BossHostMsg, t: number): void { // 66844
    if (e.t === `bossAct` || e.t === `bossDie`) {
      this.queue.push({ at: t + this.delay, m: e });
      if (this.queue.length > 80) this.queue.splice(0, this.queue.length - 80);
      return;
    }
    this.apply(e, t);
  }

  apply(e: BossHostMsg, t: number): void { // 66852
    switch (e.t) {
      case `boss`: {
        this.drop(e.b.id);
        const v = new BossView(e.b.id, e.b.kind, this, e.b);
        this.views.set(v.id, v);
        this.group.add(v.root);
        break;
      }
      case `bosses`:
        for (const n of e.list) this.views.get(n[0])?.told(n, t);
        break;
      case `bossAct`: {
        const v = this.views.get(e.id);
        if (v) this.start(v, BOSS_ACTS[e.a] ?? `idle`, e.p, e.q ?? []);
        break;
      }
      case `bossHurt`:
        this.views.get(e.id)?.hurtBy(e.by, this.me);
        break;
      case `bossDie`: {
        const v = this.views.get(e.id);
        if (v) {
          for (const s of v.scripts) s.done.add(`*`);
          this.hooks.sound(`die`, v.pos);
        }
        break;
      }
      case `bossGone`:
        this.drop(e.id);
    }
  }

  drop(e: number): void { // 66884
    const t = this.views.get(e);
    if (t) {
      t.dispose();
      this.views.delete(e);
    }
  }

  clear(): void { // 66888
    for (const e of this.views.values()) e.dispose();
    this.views.clear();
    this.queue.length = 0;
    this.tele.clear();
    this.spikes.clear();
    this.rings.clear();
    this.missiles.clear();
  }

  /** The script clock: the raw frame time when served (delay > 0), else the hitstop time. */
  clock(e: number, t: number): number { // 66899
    return this.delay > 0 ? t : e;
  }

  /** Spawns each boss kind and one of each effect at y -5000, draws once (e), then removes them. */
  async warmUp(e: () => Promise<void>): Promise<void> { // 66902
    const t = new THREE.Vector3(0, -5e3, 0);
    const n = BOSS_KINDS.map((k: BossKind, i) => {
      const d: BossInfo = {
        id: -1 - i,
        kind: k,
        x: 0,
        y: -5e3,
        z: 0,
        yaw: 0,
        hp: 1,
        maxHp: 1,
        mode: 1,
        act: 2,
        t: 0,
        phase: 1,
        k: 1,
        lair: [0, -5e3, 0],
      };
      const r = new BossView(d.id, k, this, d);
      this.group.add(r.root);
      return r;
    });
    this.tele.circle(t, 2, 16777215, 1, 0);
    this.rings.spawn(t, 1, 2, 1, 16777215);
    this.spikes.spawn(t, 1);
    this.spikes.update(0.05);
    await e();
    for (const v of n) v.dispose(true);
    this.tele.clear();
    this.rings.clear();
    this.spikes.clear();
  }

  /** The nearest boss within 90 m that is not asleep or dead (HP bar, boss music, calm()). */
  engaged(): BossView | null { // 66945
    const e = this.hooks.me();
    let t: BossView | null = null;
    let n = 1 / 0;
    for (const r of this.views.values()) {
      if (r.mode === `sleep` || r.mode === `dead`) continue;
      const i = r.pos.distanceTo(e.pos);
      if (i < 90 && i < n) {
        n = i;
        t = r;
      }
    }
    return t;
  }

  /** e = hitstop dt, t = now (ms), n = raw dt (KR.updateBosses passes (simDt, now, dt)). */
  update(e: number, t: number, n = e): void { // 66956
    const r = this.clock(e, n);
    for (let k = 0; k < this.queue.length; ) {
      const q = this.queue[k];
      if (q.at <= t) {
        if (!(q.m.t === `bossAct` && t - q.at > 600)) this.apply(q.m, t);
        this.queue.splice(k, 1);
      } else k++;
    }
    let i = 0;
    const a = this.hooks.me();
    for (const v of this.views.values()) {
      v.update(r, t, this.delay);
      this.runScripts(v, r, a);
      this.aura(v, r, a);
      const d = v.pos.distanceTo(a.pos);
      if (d < 70 && !v.dead) {
        const k = 1 - d / 70;
        if (v.kind === `titan` && v.mode !== `sleep`) {
          const c = v.bone(`chest`);
          if (c) c.getWorldPosition(this.glow.position);
          this.glow.color.setHex(7331071);
          i = Math.max(i, 18 * k);
        }
      }
    }
    this.glow.intensity += (i - this.glow.intensity) * Math.min(1, r * 6);
    this.flashK = Math.max(0, this.flashK - r * 4);
    this.flashLight.intensity = this.flashK * this.flashK * 120;
    this.tele.update(r);
    this.spikes.update(r);
    this.rings.update(r);
    this.missiles.update(r);
  }

  /** The flash light at pos + 2 up, colour t, strength n. */
  flash(e: THREE.Vector3, t: number, n = 1): void { // 67011
    this.flashLight.position.copy(e).setY(e.y + 2);
    this.flashLight.color.setHex(t);
    this.flashK = Math.max(this.flashK, n);
  }

  /** A new act t of view e aimed at n with extra points r. */
  start(e: BossView, t: BossAct, n: number[], r: number[][]): void { // 67016
    if (t === `die`) for (const s of e.scripts) s.done.add(`*`);
    const a = new THREE.Vector3().fromArray(n);
    const o = new THREE.Vector3(a.x - e.pos.x, 0, a.z - e.pos.z);
    if (o.lengthSq() < 1e-4) o.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    o.normalize();
    const s: BossScript = {
      act: t,
      t: 0,
      aim: a,
      q: r.map((p) => new THREE.Vector3().fromArray(p)),
      done: new Set(),
      from: e.pos.clone(),
      dir: o,
      len: 0,
      data: {},
    };
    e.scripts.push(s);
    this.begin(e, s);
  }

  /** The ground telegraph and the opening sound of a script. */
  begin(e: BossView, t: BossScript): void { // 67037
    const n = BOSS_COLORS[e.kind];
    const r = this.tele;
    const i = t.from;
    switch (e.kind) {
      case `titan`:
        switch (t.act) {
          case `punch`:
            r.wedge(i, t.dir, 9.6, 0.85, 0, n, 0.5, 0.1);
            break;
          case `slam`:
            r.strip(Q.copy(i).addScaledVector(t.dir, 2), t.dir, 21, 1.8, n, 0.95, 0.9);
            for (const p of t.q) r.strip(Q.copy(i), BI.subVectors(p, i).setY(0).normalize(), 19, 1.8, n, 0.95, 0.9);
            this.hooks.sound(`growl`, i, 0.6);
            break;
          case `throw`:
            r.circle(t.aim, 3.9, n, 1.85, 0.1);
            break;
          case `nova`:
            r.circle(i, 13.5, n, 1.55, 0.15);
            this.hooks.sound(`inhale`, i, 0.8);
            break;
          case `leap`:
            r.circle(t.q[0] ?? t.aim, 8, n, LEAP_WINDOW.titan![1], 0.1);
            break;
          case `wake`:
            for (let k = 0; k < 14; k++) {
              const a = (k / 14) * Math.PI * 2;
              this.spikes.spawn(
                Q.set(i.x + Math.cos(a) * (3 + Math.random() * 2), i.y, i.z + Math.sin(a) * (3 + Math.random() * 2)),
                1.2 + Math.random() * 1.5,
                1.8,
              );
            }
            this.hooks.sound(`shatter`, i);
            this.hooks.sound(`roar`, i, 0.9);
            this.hooks.shake(0.5);
            break;
          case `roar`:
            this.hooks.sound(`roar`, i);
        }
        break;
    }
  }

  /** Advances every script of e by t; a script ends on `end`, or after 8 s. */
  runScripts(e: BossView, t: number, n: BossMe): void { // 67173
    for (let r = e.scripts.length - 1; r >= 0; r--) {
      const i = e.scripts[r];
      i.t += t;
      if (!i.done.has(`*`)) this.step(e, i, t, n);
      if (i.t > 8 || i.done.has(`end`)) e.scripts.splice(r, 1);
    }
  }

  /** True once, the first frame the script passes time t (key n). */
  once(e: BossScript, t: number, n: string): boolean { // 67181
    if (e.t < t || e.done.has(n)) return false;
    e.done.add(n);
    return true;
  }

  /** Hurts the miner once per key t: dmg i x boss power, from a, knock o, elements s, up velocity c. */
  strike(
    e: BossScript,
    t: string,
    n: BossMe,
    r: BossView,
    i: number,
    a: THREE.Vector3,
    o: number,
    s: BossElements,
    c = 0,
  ): boolean { // 67184
    if (e.done.has(`hit:` + t) || !n.exposed || r.dead) return false;
    e.done.add(`hit:` + t);
    return this.hooks.hurt(Math.round(i * r.power), a, o, s, c);
  }

  /** The vertical reach of a boss kind (JI). */
  reach(e: BossView): number { // 67189
    return BOSS_REACH[e.kind];
  }

  /** Cylinder test: the miner within n of t horizontally, less than r above and i below. */
  near(e: BossMe, t: THREE.Vector3, n: number, r = 3, i = 2): boolean { // 67192
    const a = e.pos.x - t.x;
    const o = e.pos.z - t.z;
    const s = e.pos.y - t.y;
    return a * a + o * o < n * n && s < r && s > -i;
  }

  step(e: BossView, t: BossScript, n: number, r: BossMe): void { // 67198
    this.titan(e, t, n, r);
  }

  /** Rimeheart: punch, slam, throw, nova, leap, die, wake / roar. */
  titan(e: BossView, t: BossScript, n: number, r: BossMe): void { // 67477
    const i = t.t;
    const a = this.hooks;
    switch (t.act) {
      case `punch`:
        if (this.once(t, 0.5, `hit`)) {
          e.hand(Q, `r`);
          a.sound(`thud`, Q);
          a.sparks.emit({ pos: Q, spread: 3, color: 13628159, intensity: 3, size: 0.14, sizeEnd: 0.02, life: 0.5, gravity: 6, count: 20 });
          const dx = r.pos.x - e.pos.x;
          const dz = r.pos.z - e.pos.z;
          const dy = r.pos.y - e.pos.y;
          const s = Math.hypot(dx, dz);
          if (
            s < 9.8 &&
            (s < 2.5 || (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / s > Math.cos(0.9)) &&
            dy < this.reach(e) &&
            dy > -3
          )
            this.strike(t, `fist`, r, e, 40, e.pos, 13, [0, 0, 0.3]);
        }
        if (i > 1.2) t.done.add(`end`);
        break;
      case `slam`:
        if (this.once(t, 0.95, `slam`)) {
          a.sound(`boom`, e.pos);
          a.sound(`crack`, e.pos);
          a.shake(Math.max(0, 0.8 - e.pos.distanceTo(r.pos) * 0.02));
          this.flash(e.pos, 10479871, 0.6);
        }
        if (i > 0.95) {
          const dirs = [t.dir, ...t.q.map((p) => BI.subVectors(p, t.from).setY(0).normalize().clone())];
          const o = (i - 0.95) * 30;
          dirs.forEach((d, k) => {
            for (let s = 3; s < 22 && s < o; s += 1.25) {
              const key = `s${k}:${s}`;
              if (t.done.has(key)) continue;
              t.done.add(key);
              const c = Q.copy(t.from).addScaledVector(d, s);
              c.y = a.ground(c.x, c.z, t.from.y + 5) ?? t.from.y;
              this.spikes.spawn(c, 1.6 + Math.random() * 1.6 + (s < 6 ? 0.8 : 0), 1.1);
              a.dust.emit({ pos: c, vel: VI.set(0, 2, 0), spread: 1, color: 15398655, size: 0.7, sizeEnd: 1.8, alpha: 0.45, life: 0.8, drag: 2, count: 2 });
              if (this.near(r, c, 2.1, 5, 1.5)) this.strike(t, `spike`, r, e, 44, c, 5, CHILL_ELEMENTS, 10);
            }
          });
        }
        if (i > 2) t.done.add(`end`);
        break;
      case `throw`:
        if (this.once(t, 0.2, `grab`)) e.hold(this.boulder.clone());
        if (this.once(t, 0.75, `release`)) {
          e.hold(null);
          e.hand(Q, `r`);
          const m = this.boulder.clone();
          m.scale.setScalar(1.3);
          this.missiles.throw(
            m,
            Q,
            t.aim,
            1.1,
            7,
            (p) => {
              a.sound(`shatter`, p);
              a.shake(Math.max(0, 0.4 - p.distanceTo(r.pos) * 0.02));
              this.flash(p, 10479871, 0.5);
              for (let k = 0; k < 7; k++) {
                const g = (k / 7) * Math.PI * 2;
                this.spikes.spawn(Q.set(p.x + Math.cos(g) * 1.6, p.y, p.z + Math.sin(g) * 1.6), 0.8 + Math.random(), 0.8);
              }
              a.sparks.emit({ pos: p, vel: BI.set(0, 5, 0), spread: 6, color: 14218495, intensity: 3, size: 0.14, sizeEnd: 0.03, life: 0.8, gravity: 12, count: 36 });
              a.dust.emit({ pos: p, vel: BI.set(0, 1, 0), spread: 2.4, color: 15398655, size: 1, sizeEnd: 3, alpha: 0.5, life: 1.2, drag: 1.5, count: 10 });
              if (this.near(r, p, 3.9, 4, 2)) this.strike(t, `boulder`, r, e, 46, p, 11, [0, 0, 0.35]);
            },
            (p) => {
              if (Math.random() < 0.5)
                a.dust.emit({ pos: p, spread: 0.4, color: 15398655, size: 0.5, sizeEnd: 1.2, alpha: 0.4, life: 0.6, count: 1 });
            },
          );
        }
        if (i > 2.2) t.done.add(`end`);
        break;
      case `nova`:
        if (i < 1.55 && Math.random() < n * 60) {
          const g = Math.random() * Math.PI * 2;
          const d = 4 + Math.random() * 7;
          Q.set(e.pos.x + Math.cos(g) * d, e.pos.y + 0.3 + Math.random() * 3, e.pos.z + Math.sin(g) * d);
          a.dust.emit({
            pos: Q,
            vel: BI.set(e.pos.x - Q.x, 1.5, e.pos.z - Q.z).multiplyScalar(0.8),
            spread: 0.3,
            color: 15398655,
            size: 0.25,
            sizeEnd: 0.6,
            alpha: 0.8,
            life: 1,
            count: 1,
          });
        }
        if (this.once(t, 1.55, `burst`)) {
          a.sound(`shatter`, e.pos);
          a.sound(`boom`, e.pos, 0.7);
          a.shake(Math.max(0, 0.7 - e.pos.distanceTo(r.pos) * 0.02));
          this.rings.spawn(e.pos, 1, 17, 26, BOSS_COLORS.titan, 2);
          this.flash(e.pos, 10479871, 1);
          for (let k = 0; k < 16; k++) {
            const g = (k / 16) * Math.PI * 2;
            const d = 4.5 + Math.random() * 8;
            this.spikes.spawn(Q.set(e.pos.x + Math.cos(g) * d, e.pos.y, e.pos.z + Math.sin(g) * d), 1 + Math.random() * 1.4, 1);
          }
          a.dust.emit({
            pos: Q.copy(e.pos).setY(e.pos.y + 1),
            vel: BI.set(0, 1, 0),
            spread: 8,
            color: 15923455,
            size: 1.5,
            sizeEnd: 4,
            alpha: 0.4,
            life: 1.6,
            drag: 2,
            count: 24,
          });
          if (this.near(r, e.pos, 13.8, 7, 3)) this.strike(t, `nova`, r, e, 30, e.pos, 8, [0, 0, 0.7], 3);
        }
        if (i > 2.2) t.done.add(`end`);
        break;
      case `leap`: {
        const p = t.q[0] ?? t.aim;
        if (this.once(t, LEAP_WINDOW.titan![1], `land`)) {
          a.sound(`boom`, p);
          a.sound(`crack`, p, 0.8);
          a.shake(Math.max(0, 1 - p.distanceTo(r.pos) * 0.025));
          this.rings.spawn(p, 2, 14, 24, BOSS_COLORS.titan, 1.5);
          this.flash(p, 10479871, 0.8);
          for (let k = 0; k < 12; k++) {
            const g = (k / 12) * Math.PI * 2;
            const d = 3 + Math.random() * 3;
            this.spikes.spawn(Q.set(p.x + Math.cos(g) * d, p.y, p.z + Math.sin(g) * d), 1.2 + Math.random() * 1.2, 1.1);
          }
          a.dust.emit({ pos: p, vel: BI.set(0, 2, 0), spread: 6, color: 15398655, size: 1.4, sizeEnd: 3.5, alpha: 0.5, life: 1.4, drag: 2, count: 16 });
          if (this.near(r, p, 8.2, 5, 2)) this.strike(t, `land`, r, e, 52, p, 16, [0, 0, 0.3], 6);
        }
        if (i > 2.4) t.done.add(`end`);
        break;
      }
      case `die`:
        if (this.once(t, 1.5, `shatter`)) {
          e.shatter();
          a.debris(Q.copy(e.pos).setY(e.pos.y + 3), 12576511, 40, 9);
          a.debris(Q.copy(e.pos).setY(e.pos.y + 2), 5134956, 24, 7);
          a.sound(`shatter`, e.pos);
          a.shake(Math.max(0, 0.6 - e.pos.distanceTo(r.pos) * 0.015));
          for (let k = 0; k < 18; k++) {
            const g = Math.random() * Math.PI * 2;
            const d = Math.random() * 5;
            this.spikes.spawn(Q.set(e.pos.x + Math.cos(g) * d, e.pos.y, e.pos.z + Math.sin(g) * d), 0.8 + Math.random() * 1.6, 3);
          }
          a.sparks.emit({
            pos: Q.copy(e.pos).setY(e.pos.y + 3),
            vel: BI.set(0, 4, 0),
            spread: 7,
            color: 14218495,
            intensity: 3,
            size: 0.2,
            sizeEnd: 0.03,
            life: 1.4,
            gravity: 10,
            count: 70,
          });
          a.dust.emit({ pos: Q, vel: BI.set(0, 1, 0), spread: 6, color: 15923455, size: 1.6, sizeEnd: 4.5, alpha: 0.45, life: 2.4, drag: 1.2, count: 20 });
          this.flash(e.pos, 10479871, 1);
        }
        if (i > 6) t.done.add(`end`);
        break;
      case `wake`:
      case `roar`:
        if (this.once(t, t.act === `wake` ? 2.6 : 0.8, `push`)) {
          a.shake(Math.max(0, 0.6 - e.pos.distanceTo(r.pos) * 0.012));
          if (this.near(r, e.pos, 12, 5, 3) && r.exposed) a.push(e.pos, 12);
          a.dust.emit({
            pos: Q.copy(e.pos).setY(e.pos.y + 4),
            vel: BI.set(0, 1, 0),
            spread: 6,
            color: 15923455,
            size: 1.2,
            sizeEnd: 3.4,
            alpha: 0.35,
            life: 1.8,
            drag: 1.5,
            count: 20,
          });
        }
        if (i > 4) t.done.add(`end`);
        break;
      default:
        if (i > 4) t.done.add(`end`);
    }
  }

  /** Ambient frost particles off the bones of a boss within 80 m. */
  aura(e: BossView, t: number, n: BossMe): void { // 68261
    if (e.pos.distanceTo(n.pos) > 80 || e.dead) return;
    const r = this.hooks;
    if (e.kind === `titan` && e.mode !== `sleep` && Math.random() < t * 10) {
      const b = e.bone([`chest`, `upperarml`, `upperarmr`, `head`][Math.floor(Math.random() * 4)]);
      if (b) {
        b.getWorldPosition(Q);
        r.dust.emit({ pos: Q, vel: BI.set(0, -0.6, 0), spread: 1.2, color: 15923455, size: 0.5, sizeEnd: 1.6, alpha: 0.3, life: 1.6, drag: 1, count: 1 });
      }
    }
  }

  /** Calls e for every hit sphere of every live boss; stops when e returns true. */
  each(e: (v: BossView, p: BossPart) => boolean | void): void { // 68324
    for (const t of this.views.values())
      if (!t.dead) {
        for (const n of t.parts) if (e(t, n)) return;
      }
  }

  /** Remembers which boss the hit point e belongs to; returns e. */
  mark(e: THREE.Vector3, t: BossView): THREE.Vector3 { // 68330
    this.hits.set(e, { v: t });
    return e;
  }

  /** Swept sphere of radius n from e to t: the nearest boss part. */
  sweep(e: THREE.Vector3, t: THREE.Vector3, n: number): BossSweepHit | null { // 68333
    const r = vL.subVectors(t, e);
    const i = r.length();
    if (i < 1e-5) return null;
    r.divideScalar(i);
    let a: BossSweepHit | null = null;
    let o = 1 / 0;
    this.each((v, s) => {
      const c = raySphere(e, r, s.c, s.r + n);
      if (c !== null && c <= i && c < o) {
        o = c;
        a = { point: this.mark(e.clone().addScaledVector(r, c), v), weak: s.weak };
      }
    });
    return a;
  }

  /** Ray from e along t up to n: the nearest boss part. */
  rayHit(e: THREE.Vector3, t: THREE.Vector3, n: number): BossRayHit | null { // 68352
    let r: BossRayHit | null = null;
    this.each((v, a) => {
      const o = raySphere(e, t, a.c, a.r);
      if (o !== null && o <= n && (!r || o < r.t))
        r = { t: o, point: this.mark(e.clone().addScaledVector(t, o), v), weak: a.weak };
    });
    return r;
  }

  /** True when the point came from sweep / rayHit / blast of this manager. */
  owns(e: THREE.Vector3): boolean { // 68365
    return this.hits.has(e);
  }

  /** My hit of dmg e at point t (weak n, crit r): predicted HP, damage number, and the hit to the simulation. */
  damage(e: number, t: THREE.Vector3, n: boolean, r: boolean): void { // 68368
    const i = this.hits.get(t);
    if (!i) return;
    const a = i.v;
    if (a.dead) return;
    const o = Math.max(1, Math.round(e * (n ? 1.3 : 1)));
    a.predict(o);
    this.hooks.shown(t, o, n, r, false);
    this.hooks.hit(a.id, e, n);
  }

  /** Bomb splash: dmg n to every boss with a part within radius t of e. */
  blast(e: THREE.Vector3, t: number, n: number): void { // 68383
    for (const r of this.views.values()) {
      if (r.dead) continue;
      let i: BossPart | null = null;
      for (const p of r.parts)
        if (p.c.distanceTo(e) - p.r < t) {
          i = p;
          break;
        }
      if (!i) continue;
      const a = this.mark(i.c.clone(), r);
      this.damage(n, a, false, false);
    }
  }
}

/** Ray (origin e, unit dir t) against the sphere (n, r): entry distance, 0 from inside, or null. */
export function raySphere(e: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, r: number): number | null { // yL (68400)
  const i = e.x - n.x;
  const a = e.y - n.y;
  const o = e.z - n.z;
  const s = i * t.x + a * t.y + o * t.z;
  const c = i * i + a * a + o * o - r * r;
  const l = s * s - c;
  if (l < 0) return null;
  const u = Math.sqrt(l);
  const d = -s - u;
  return d >= 0 ? d : -s + u >= 0 ? 0 : null;
}

/**
 * The worm (or null) and the bosses as one combat target with the worm's interface: the nearest hit wins,
 * damage goes to the bosses when they own the point. KR sets combat.worm to this in makeBosses (72632).
 */
export function wormAndBosses(e: WormTarget | null, t: BossViews): WormTarget { // bL (68412)
  const n = <H extends { point: THREE.Vector3 }>(a: H | null, b: H | null, p: THREE.Vector3): H | null =>
    a ? (b ? (a.point.distanceToSquared(p) <= b.point.distanceToSquared(p) ? a : b) : a) : b;
  return {
    sweep: (r, i, a) => n(e?.sweep(r, i, a) ?? null, t.sweep(r, i, a), r),
    rayHit: (n, r, i) => {
      const a = e?.rayHit(n, r, i) ?? null;
      const o = t.rayHit(n, r, i);
      return a ? (o ? (a.t <= o.t ? a : o) : a) : o;
    },
    damage: (n, r, i, a) => (t.owns(r) ? t.damage(n, r, i, a) : e?.damage(n, r, i, a)),
    blast: (n, r, i) => {
      e?.blast(n, r, i);
      t.blast(n, r, i);
    },
  };
}
