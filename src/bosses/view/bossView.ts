// Port of play-inUT-NSi.js 66051-66509: the boss view QI and the black colour $I. One drawn boss (the titan in
// this build): a skeleton-aware clone of its model, scaled and re-materialled (grain via the stylize patch, glow
// lists, the ice rim), one animation action per clip of the clip table, 20 interpolated snapshots, acts played
// with cross-fades, the walk rate matched to the real ground speed, the death sink, the phase / flash glow, and
// per-frame hit spheres from bones.
//
// STANDALONE USE (no boss fight client; for example a debug page that shows one boss alone)
//
//   const asset = await loadBosses();                            // ./assets (OI); null when a model is missing
//   const host = createBossViewHost(asset!);                     // stands in for the boss manager gL
//   const view = new BossView(1, `titan`, host, bossInfo(`titan`, { x: 0, y: 0, z: 0 }));
//   scene.add(view.root);
//   scene.add(BOSS_LIGHTS.glow, BOSS_LIGHTS.flash);              // optional (KR adds them, 70550)
//   // every frame (ms clock, delay 0):
//   view.update(dt, performance.now(), 0);
//
//   Acts (the clip table BOSS_CLIPS[kind], listBossActs(kind)): the act always comes from the newest snapshot,
//   so set it with tellBossView(view, { act: `punch` }) (also mode, phase, hp, actT).
//   To replay the act that is already playing: view.curAct = null, then tellBossView again.
//   Any loaded clip of the kind: view.play(`Melee_Unarmed_Attack_Punch_A`, { once: true, rate: 1, fade: 0.25 }) (stays until
//   the act changes; view.actions holds only the clips of BOSS_CLIPS[kind]).
//   Phase: tellBossView(view, { phase: 2 }) (or view.phase = 2 until the next snapshot).
//   Mode (sleep / fight / home / dying / dead): tellBossView(view, { mode: `sleep` }).
//   Flash: view.flash = 1 (or view.predict(dmg), or view.hurtBy(by, me) with by !== me).
//   view.dispose() at the end.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { stylizeMaterial } from '../../miner/stylize';
import { BOSS_ACTS, BOSS_DEFS, BOSS_KINDS, BOSS_MODES, type BossAct, type BossDef, type BossKind, type BossMode } from '../sim/defs';
import type { BossInfo, BossSnap } from '../sim/boss';
import type { BossAsset } from './assets';
import {
  BOSS_CLIPS,
  clamp,
  HUMANOID_HIT_BONES,
  lerpAngle,
  PREDICT_HOLD,
  TITAN_SCALE,
  tmpA,
  tmpQuat,
} from './constants';
import { iceRim } from './materials';

/** What a boss view needs of its manager (gL fits): the asset and its clips by name. */
export interface BossViewHost {
  asset: BossAsset;
  clips: Map<string, THREE.AnimationClip>;
}

/** One interpolation sample (t = local ms when told, at = seconds into the act then). */
export interface BossViewSnap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: BossMode;
  act: BossAct;
  at: number;
}

/** A hit sphere: centre, radius, weak spot. */
export interface BossPart {
  c: THREE.Vector3;
  r: number;
  weak: boolean;
}

/** A client attack script of the boss manager (gL.start 67023). */
export interface BossScript {
  act: BossAct;
  t: number;
  aim: THREE.Vector3;
  q: THREE.Vector3[];
  done: Set<string>;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface BossPlayOptions {
  fade?: number;
  once?: boolean;
  rate?: number;
  from?: number;
}

interface Glow {
  m: THREE.MeshStandardMaterial;
  base: number;
}

const BLACK = new THREE.Color(0); // $I (66509)

export class BossView { // QI (66051)
  id: number;
  kind: BossKind;
  mgr: BossViewHost;
  def: BossDef;
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  mode: BossMode = `sleep`;
  act: BossAct = `sleep`;
  actT = 0;
  phase = 1;
  /** Damage multiplier (k). */
  power: number;
  lair = new THREE.Vector3();
  sinceHit = 99;
  pace = 0;
  lastPos = new THREE.Vector3();
  flash = 0;
  snaps: BossViewSnap[] = [];
  parts: BossPart[] = [];
  scripts: BossScript[] = [];
  hpSaid: number;
  predT = 0;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  cur: THREE.AnimationAction | null = null;
  curAct: BossAct | null = null;
  bones = new Map<string, THREE.Object3D>();
  /** Materials that take the hit flash on their emissive. */
  skins: THREE.MeshStandardMaterial[] = [];
  glows: Glow[] = [];
  /** Materials and geometry this view disposes. */
  owned: { dispose(): void }[] = [];
  t = 0;
  held: THREE.Object3D | null = null;
  sink = 0;
  constructor(e: number, t: BossKind, n: BossViewHost, r: BossInfo) {
    this.id = e;
    this.kind = t;
    this.mgr = n;
    this.def = BOSS_DEFS[t];
    this.hp = this.hpSaid = r.hp;
    this.maxHp = r.maxHp;
    this.power = r.k;
    this.lair.fromArray(r.lair);
    this.pos.set(r.x, r.y, r.z);
    this.yaw = r.yaw;
    this.phase = r.phase;
    const i = n.asset.scene.getObjectByName(`B_Titan`);
    this.model = cloneSkinned(i!);
    this.model.position.set(0, 0, 0);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) o.name = o.name.replace(/_\d+$/, ``);
      if ((o as THREE.Bone).isBone || o.type === `Object3D`) this.bones.set(o.name, o);
    });
    this.dress();
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const a = BOSS_CLIPS[t];
    for (const [, [clip]] of Object.entries(a)) {
      if (this.actions.has(clip)) continue;
      const c = n.clips.get(clip);
      if (c) this.actions.set(clip, this.mixer.clipAction(c));
    }
    const o = BOSS_ACTS[r.act] ?? `idle`;
    this.mode = BOSS_MODES[r.mode] ?? `sleep`;
    this.snaps.push({
      t: performance.now(),
      x: r.x,
      y: r.y,
      z: r.z,
      yaw: r.yaw,
      mode: this.mode,
      act: o,
      at: r.t,
    });
    this.enter(o, r.t);
  }
  /** Scale and per-view material copies. */
  dress(): void {
    const e = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.model.scale.setScalar(TITAN_SCALE);
    this.model.traverse((n) => {
      const r = n as THREE.Mesh;
      if (!r.isMesh) return;
      r.frustumCulled = false;
      r.castShadow = true;
      const swap = (src: THREE.Material): THREE.Material => {
        const had = e.get(src);
        if (had) return had;
        const i = (src as THREE.MeshStandardMaterial).clone();
        e.set(src, i);
        this.owned.push(i);
        const a = src.name;
        if (a === `B_TitanIce` || a === `B_TitanCrys`) {
          i.userData.em = new THREE.Color(a === `B_TitanCrys` ? 2783928 : 1456206);
          i.transparent = false;
          i.roughness = a === `B_TitanCrys` ? 0.1 : 0.2;
          i.emissive.setHex(a === `B_TitanCrys` ? 2783928 : 1456206);
          i.emissiveIntensity = a === `B_TitanCrys` ? 1.2 : 1;
          iceRim(i, a, 0.9);
          this.skins.push(i);
          if (a === `B_TitanCrys`) this.glows.push({ m: i, base: 1.2 });
        } else if (a === `B_TitanStone` || a === `B_TitanStone2`) {
          i.color.setHex(a === `B_TitanStone` ? 6978192 : 5134956);
          i.roughness = 0.75;
          i.emissive.setHex(660512);
          i.userData.em = i.emissive.clone();
          iceRim(i, a, 0.35);
          this.skins.push(i);
        } else if (a === `B_TitanGlow`) {
          i.emissiveIntensity = 3;
          this.glows.push({ m: i, base: i.emissiveIntensity });
        } else {
          stylizeMaterial(i, 0.08, 1.4);
          i.userData.em = i.emissive.clone();
          if (a.startsWith(`B_Titan`)) this.skins.push(i);
        }
        return i;
      };
      r.material = Array.isArray(r.material) ? r.material.map(swap) : swap(r.material);
    });
  }
  get name(): string {
    return `${this.def.name}, ${this.def.title}`;
  }
  get awake(): boolean {
    return this.mode === `fight` || this.mode === `home`;
  }
  get dead(): boolean {
    return this.mode === `dying` || this.mode === `dead`;
  }
  bone(e: string): THREE.Object3D | null {
    return this.bones.get(e) ?? null;
  }
  /** One snapshot tuple from {t:`bosses`} (t = local ms). */
  told(e: BossSnap, t: number): void {
    const [, n, r, i, a, o, s, c, l, u, d] = e;
    this.snaps.push({
      t,
      x: n,
      y: r,
      z: i,
      yaw: a,
      mode: BOSS_MODES[c] ?? `fight`,
      act: BOSS_ACTS[l] ?? `idle`,
      at: u,
    });
    if (this.snaps.length > 20) this.snaps.splice(0, this.snaps.length - 20);
    this.hpSaid = o;
    this.hp = this.predT <= 0 ? o : Math.min(this.hp, o);
    this.maxHp = s;
    this.phase = d;
  }
  /** {t:`bossHurt`}: flash unless the hit was mine (already predicted). */
  hurtBy(e: string | undefined, t: string | undefined): void {
    this.sinceHit = 0;
    if (e !== t) this.flash = 1;
  }
  /** A local hit shown before the simulation reports it. */
  predict(e: number): void {
    this.hp = Math.max(0, this.hp - e);
    this.predT = PREDICT_HOLD;
    this.flash = 1;
    this.sinceHit = 0;
  }
  /** Plays a clip of this kind (cross-fade from the current one). */
  play(e: string, t: BossPlayOptions = {}): void {
    const n = this.actions.get(e);
    if (!n) return;
    const r = t.fade ?? 0.25;
    if (this.cur === n && !t.once) {
      n.timeScale = t.rate ?? 1;
      return;
    }
    n.reset();
    n.enabled = true;
    n.setLoop(t.once ? THREE.LoopOnce : THREE.LoopRepeat, 1 / 0);
    n.clampWhenFinished = !!t.once;
    n.timeScale = t.rate ?? 1;
    n.time = Math.min(t.from ?? 0, n.getClip().duration - 0.01);
    n.setEffectiveWeight(1);
    if (this.cur && this.cur !== n) n.crossFadeFrom(this.cur, r, false);
    else n.fadeIn(r);
    n.play();
    this.cur = n;
  }
  /** Enters an act (t = seconds already spent in it). */
  enter(e: BossAct, t = 0): void {
    if (this.curAct === e) return;
    const n = this.curAct;
    this.curAct = e;
    this.act = e;
    const [r, i, a] = BOSS_CLIPS[this.kind][e] ?? BOSS_CLIPS[this.kind].idle;
    this.play(r, {
      once: !a,
      rate: i,
      from: t * i,
      fade: n === `sleep` ? 0.6 : e === `walk` || e === `idle` ? 0.35 : 0.14,
    });
  }
  /** dt (s), now (ms), the interpolation delay (ms). */
  update(e: number, t: number, n: number): void {
    this.t += e;
    this.sinceHit += e;
    this.predT -= e;
    if (this.predT <= 0 && this.hp !== this.hpSaid) this.hp = this.hpSaid;
    const r = t - n;
    const i = this.snaps;
    const a = i.length;
    if (a) {
      let s0 = i[a - 1];
      let s1 = i[a - 1];
      for (let k = a - 1; k >= 0; k--) {
        if (i[k].t <= r) {
          s0 = i[k];
          s1 = i[Math.min(a - 1, k + 1)];
          break;
        }
        if (k === 0) s0 = s1 = i[0];
      }
      const k = s1.t > s0.t ? clamp((r - s0.t) / (s1.t - s0.t), 0, 1) : 1;
      this.pos.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
      this.yaw = lerpAngle(s0.yaw, s1.yaw, k);
      this.mode = s0.mode;
      this.actT = s0.at + Math.max(0, (r - s0.t) / 1e3);
      if (s0.act !== this.curAct) this.enter(s0.act, this.actT);
    }
    if (e > 0) {
      const v = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) / e;
      this.pace += (Math.min(v, 20) - this.pace) * Math.min(1, e * 6);
      this.lastPos.copy(this.pos);
    }
    if (this.act === `walk` && this.cur && BOSS_DEFS[this.kind].speed > 0)
      this.cur.timeScale = (BOSS_CLIPS[this.kind].walk?.[1] ?? 1) * clamp(this.pace / BOSS_DEFS[this.kind].speed, 0.7, 2.2);
    this.mixer.update(e);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    if (this.mode === `dead` || this.mode === `dying`) {
      this.sink += e;
      if (this.sink > 4) this.root.position.y -= (this.sink - 4) * (this.sink - 4) * 0.8;
    } else this.sink = 0;
    this.shine(e);
    this.root.updateMatrixWorld(true);
    this.updateParts();
  }
  /** Hit flash and the glow pulse by phase, mode and act. */
  shine(e: number): void {
    this.flash = Math.max(0, this.flash - e * 7);
    const t = this.flash * this.flash;
    for (const s of this.skins) s.emissive.copy((s.userData.em as THREE.Color | undefined) ?? BLACK).addScalar(t * 0.5);
    const n = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    for (const g of this.glows)
      g.m.emissiveIntensity =
        g.base * (this.mode === `sleep` ? 0.35 : this.phase === 2 ? 1.5 : 1) * (0.85 + n * 0.3) * (this.dead ? 0.2 : 1);
  }
  /** Rebuilds the hit spheres (none while dying or dead). */
  updateParts(): void {
    this.parts.length = 0;
    if (this.dead) return;
    const e = (c: THREE.Vector3, r: number, weak: boolean) => this.parts.push({ c: c.clone(), r, weak });
    for (const [r, i, a] of HUMANOID_HIT_BONES) {
      const b = this.bones.get(r);
      if (b) {
        b.getWorldPosition(tmpA);
        e(tmpA, i * TITAN_SCALE * (r.startsWith(`hand`) ? 1.5 : 1), a);
      }
    }
  }
  hand(e: THREE.Vector3, t = `r`): THREE.Vector3 {
    const n = this.bones.get(`hand${t}`);
    if (n) n.getWorldPosition(e);
    else e.copy(this.pos).setY(this.pos.y + 3);
    return e;
  }
  shatter(): void {
    this.model.visible = false;
  }
  /** Puts an object in the right hand (the titan's boulder), or clears it. */
  hold(e: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = e;
    if (!e) return;
    const t = this.bones.get(`handslotr`) ?? this.bones.get(`handr`);
    if (t) {
      e.position.set(0, 0.35, 0);
      e.scale.setScalar(1 / TITAN_SCALE);
      t.add(e);
    }
  }
  /** keepShared = true (warm-up) keeps the materials and skeletons. */
  dispose(e = false): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    this.held?.removeFromParent();
    if (!e) {
      for (const o of this.owned) o.dispose();
      this.model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose();
      });
    }
    this.owned.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Standalone helpers (not in the original): the debug page uses them to show one boss without the fight client.

/** The boss kinds in their fixed order (jS). */
export function listBossKinds(): BossKind[] {
  return [...BOSS_KINDS];
}

/** The acts of a kind that have a clip (the keys of BOSS_CLIPS[kind], ZI). */
export function listBossActs(kind: BossKind): BossAct[] {
  return Object.keys(BOSS_CLIPS[kind]) as BossAct[];
}

/** A BossViewHost without the boss manager: clips by name. */
export type StandaloneBossHost = BossViewHost;

export function createBossViewHost(asset: BossAsset): StandaloneBossHost {
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of asset.clips) clips.set(c.name, c);
  const host: StandaloneBossHost = { asset, clips };
  return host;
}

/** A spawn record (the {t:`boss`} payload) for a standalone view; defaults as gL.warmUp (66905-66921). */
export function bossInfo(
  kind: BossKind,
  o: { id?: number; x?: number; y?: number; z?: number; yaw?: number; mode?: BossMode; act?: BossAct; phase?: number; k?: number } = {},
): BossInfo {
  const x = o.x ?? 0;
  const y = o.y ?? 0;
  const z = o.z ?? 0;
  const hp = BOSS_DEFS[kind].hp;
  return {
    id: o.id ?? 1,
    kind,
    x,
    y,
    z,
    yaw: o.yaw ?? 0,
    hp,
    maxHp: hp,
    mode: BOSS_MODES.indexOf(o.mode ?? `fight`),
    act: BOSS_ACTS.indexOf(o.act ?? `idle`),
    t: 0,
    phase: o.phase ?? 1,
    k: o.k ?? 1,
    lair: [x, y, z],
  };
}

/**
 * Sends one snapshot tuple (the {t:`bosses`} format) to a standalone view: unset fields keep the newest
 * snapshot's values. actT = seconds into the act (default 0 when the act changes).
 */
export function tellBossView(
  view: BossView,
  s: { act?: BossAct; actT?: number; mode?: BossMode; phase?: number; hp?: number; pos?: THREE.Vector3; yaw?: number },
  now = performance.now(),
): void {
  const last = view.snaps[view.snaps.length - 1];
  const act = s.act ?? last?.act ?? view.act;
  const changed = act !== (last?.act ?? view.act);
  const actT = s.actT ?? (changed ? 0 : (last ? last.at + Math.max(0, (now - last.t) / 1e3) : 0));
  const p = s.pos ?? view.pos;
  const yaw = s.yaw ?? view.yaw;
  const tuple: BossSnap = [
    view.id,
    p.x,
    p.y,
    p.z,
    yaw,
    s.hp ?? view.hpSaid,
    view.maxHp,
    BOSS_MODES.indexOf(s.mode ?? last?.mode ?? view.mode),
    BOSS_ACTS.indexOf(act),
    actT,
    s.phase ?? view.phase,
  ];
  view.told(tuple, now);
}
