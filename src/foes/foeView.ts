// Port of play-inUT-NSi.js 62525-62530 (scratch tF / nF / rF / iF / aF / oF) and 62696-62938: the foe view CF.
// One drawn foe: a cloned (skeleton-aware) model with per-foe material copies (stylized, look-tinted or
// ghost), weapons in the hand slots, an AnimationMixer with cross-fades driven by the foe state, client-side
// HP prediction, hit flash and squash, frost / champion / mend emissive tints, the spinning burrower drill
// bit, the golem's held rock and the wraith ghost fade.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { stylizeMaterial } from '../miner/stylize';
import type { FoeDef, FoeKind, FoeLoop, FoeState } from './types';
import {
  applyLook,
  CHAMPION_SCALE,
  clampF,
  FOE_SCALE,
  ghostMaterial,
  GLOW_MATERIALS,
  mergeRigid,
  PREDICT_WINDOW,
  rockMesh,
  widenBounds,
} from './looks';

const rF = new THREE.Color(16777215); // rF (62527)
const iF = new THREE.Color(); // iF (62528)
const aF = new THREE.Color(); // aF (62529)
const oF = new THREE.Color(); // oF (62530)

/** One interpolation sample of the foe transform. */
export interface FoeViewSnap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PlayOptions {
  fade?: number;
  once?: boolean;
  rate?: number;
  from?: number;
}

export class FoeView { // CF (62696)
  id: number;
  kind: FoeKind;
  def: FoeDef;
  champion: boolean;
  root: THREE.Object3D;
  pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  state: FoeState = `rise`;
  loop: FoeLoop = `walk`;
  rate = 1;
  sinceHit = 99;
  flash = 0;
  punch = 0;
  baseScale = 1;
  hpSaid: number;
  /** Locally predicted damage not yet confirmed by the simulation. */
  unheard: { t: number; dmg: number }[] = [];
  snaps: FoeViewSnap[] = [];
  mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  cur: THREE.AnimationAction | null = null;
  /** Materials that take the flash / frost / champion / mend emissive (F_Bones, G_Rock*). */
  skins: THREE.MeshStandardMaterial[] = [];
  /** Chill amount 0-1 (set by the combat system). */
  frost = 0;
  glowT = 0;
  attackT = 0;
  slammed = false;
  ghostU: { value: number }[] = [];
  ghostSeen = 1;
  rock: THREE.Mesh | null = null;
  thrown = false;
  mendK = 0;
  bit: THREE.Object3D | null = null;
  bitV = 0;
  skeleton: THREE.Skeleton | null = null;
  constructor(
    e: number,
    t: FoeKind,
    n: FoeDef,
    r: THREE.Object3D,
    i: Map<string, THREE.AnimationClip>,
    a: Map<string, THREE.Object3D>,
    o: number,
    s: number,
    c = false,
  ) {
    this.id = e;
    this.kind = t;
    this.def = n;
    this.champion = c;
    this.hp = this.hpSaid = o;
    this.maxHp = s;
    this.root = cloneSkinned(r);
    this.root.position.set(0, 0, 0);
    this.root.scale.setScalar(FOE_SCALE * (n.scale ?? 1) * (c ? CHAMPION_SCALE : 1));
    this.baseScale = this.root.scale.x;
    const l = new Map<THREE.Material, THREE.Material>();
    this.root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) widenBounds(m as THREE.SkinnedMesh);
      m.castShadow = true;
      const swap = (src: THREE.Material): THREE.Material => {
        let r2 = l.get(src);
        if (!r2) {
          if (n.look === `wraith`) {
            const g = ghostMaterial(GLOW_MATERIALS.has(src.name));
            r2 = g;
            l.set(src, g);
            this.ghostU.push(g.userData.ghost as { value: number });
            m.castShadow = false;
            return g;
          }
          r2 = src.clone();
          l.set(src, r2);
          const mat = r2 as THREE.MeshStandardMaterial;
          if (!GLOW_MATERIALS.has(mat.name)) stylizeMaterial(mat, 0.08, 1.6);
          if (n.look) applyLook(mat, n.look);
          if (mat.name === `F_Bones` || mat.name.startsWith(`G_Rock`)) this.skins.push(mat);
        }
        return r2;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    this.skeleton = mergeRigid(this.root, r);
    for (const [side, slot] of [
      [`r`, `handslotr`],
      [`l`, `handslotl`],
    ] as const) {
      const name = n.weapon[side];
      const hand = this.root.getObjectByName(slot);
      const src = name ? (a.get(name) ?? (name === `F_W_Drill` ? a.get(`F_W_Pick`) : void 0)) : void 0;
      if (!hand || !src) continue;
      const w = src.clone();
      w.position.set(0, 0, 0);
      w.quaternion.identity();
      w.traverse((k) => {
        if ((k as THREE.Mesh).isMesh) k.castShadow = true;
      });
      hand.add(w);
      this.bit ??= w.getObjectByName(`F_W_DrillBit`) ?? null;
    }
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [name, clip] of i) this.actions.set(name, this.mixer.clipAction(clip));
  }
  get height(): number {
    return (this.def.height ?? 1.9) * (this.champion ? CHAMPION_SCALE : 1);
  }
  get name(): string {
    return this.champion ? `${this.def.name} Champion` : this.def.name;
  }
  center(e: THREE.Vector3): THREE.Vector3 {
    return e.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
  }
  /** The simulation's HP; ack = this report answers one of my own predicted hits. */
  told(e: number, t = false): void {
    this.hpSaid = e;
    if (t) this.unheard.shift();
    this.heal();
  }
  /** A local hit, shown before the simulation confirms it. */
  predict(e: number): void {
    this.unheard.push({ t: performance.now(), dmg: e });
    this.heal();
  }
  /** hp = reported hp minus the predicted hits of the last PREDICT_WINDOW seconds. */
  heal(): void {
    const e = performance.now() - PREDICT_WINDOW * 1e3;
    while (this.unheard.length && this.unheard[0].t < e) this.unheard.shift();
    let t = 0;
    for (const u of this.unheard) t += u.dmg;
    this.hp = Math.max(0, this.hpSaid - t);
  }
  /** Plays a clip (cross-fade from the current one). Returns its duration at the given rate (0 if missing). */
  play(e: string, t: PlayOptions = {}): number {
    const n = this.actions.get(e);
    if (!n) return 0;
    const r = t.fade ?? 0.18;
    if (this.cur === n && !t.once) {
      n.timeScale = t.rate ?? 1;
      return n.getClip().duration / Math.abs(n.timeScale || 1);
    }
    n.reset();
    n.enabled = true;
    n.setLoop(t.once ? THREE.LoopOnce : THREE.LoopRepeat, 1 / 0);
    n.clampWhenFinished = !!t.once;
    n.timeScale = t.rate ?? 1;
    n.time = t.from ?? 0;
    n.setEffectiveWeight(1);
    if (this.cur && this.cur !== n) n.crossFadeFrom(this.cur, r, false);
    else n.fadeIn(r);
    n.play();
    this.cur = n;
    return n.getClip().duration / Math.abs(t.rate ?? 1);
  }
  /** Enters a state (force replays it); t0 = seconds already spent in it. */
  enter(e: FoeState, t = false, n = 0): void {
    if (this.state === e && !t) return;
    this.state = e;
    const r = this.def;
    if (e !== `hurl`) this.holdRock(false);
    if (e === `rise`) this.play(`Skeletons_Awaken_Floor`, { once: true, fade: 0, rate: 1.25, from: n * 1.25 });
    else if (e === `hurl` && r.hurl) {
      this.play(r.hurl.clip, { once: true, fade: 0.15, rate: r.hurl.rate, from: n * r.hurl.rate });
      this.attackT = n;
      this.thrown = n >= (r.hurl.len / r.hurl.rate) * r.hurl.at;
      this.holdRock(!this.thrown);
    } else if (e === `mend` && r.mend) {
      this.play(r.mend.clip, { fade: 0.3, rate: 0.7 });
      this.attackT = n;
    } else if (e === `dig` && r.digger) this.play(r.digger.clip, { fade: 0.15, rate: r.digger.rate });
    else if (e === `attack`) {
      this.play(r.swing, { once: true, fade: 0.12, rate: r.swingRate });
      this.attackT = 0;
      this.slammed = false;
    } else if (e === `hurt`) this.play(Math.random() < 0.5 ? `Hit_A` : `Hit_B`, { once: true, fade: 0.05, rate: 1.35 });
    else if (e === `dead`) {
      this.play(Math.random() < 0.5 ? `Skeletons_Death` : `Death_A`, { once: true, fade: 0.08 });
      this.attackT = 0;
    } else this.legs(true);
  }
  /** The leg loop of hunt / idle (taunt only when the loop changed). */
  legs(e = false): void {
    if (this.state !== `hunt` && this.state !== `idle`) return;
    const t = this.loop;
    if (t === `run`) this.play(this.def.run ?? this.def.walk, { fade: 0.2, rate: this.rate });
    else if (t === `walk`) this.play(this.def.walk, { fade: 0.2, rate: this.rate });
    else if (t === `idle`) this.play(`Skeletons_Idle`, { fade: 0.25 });
    else if (e) this.play(`Skeletons_Taunt`, { once: this.state === `hunt`, fade: 0.25 });
  }
  animate(e: number): void {
    this.attackT += e;
    if (this.unheard.length) this.heal();
    this.mixer.update(e);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    this.flash = Math.max(0, this.flash - e * 9);
    this.punch = Math.max(0, this.punch - e * 7);
    const t = this.punch * this.punch;
    this.root.scale.set(this.baseScale * (1 + t * 0.09), this.baseScale * (1 - t * 0.11), this.baseScale * (1 + t * 0.09));
    this.glowT += e;
    if (this.bit) {
      const spin = this.state === `dig` || this.state === `attack` ? 30 : this.state === `dead` ? 0 : 4;
      this.bitV += (spin - this.bitV) * Math.min(1, e * 5);
      this.bit.rotation.y += this.bitV * e;
    }
    if (this.ghostU.length) {
      const g =
        clampF(this.ghostSeen + this.flash, 0, 1.5) * (this.state === `dead` ? Math.max(0, 1 - this.attackT * 0.5) : 1);
      for (const u of this.ghostU) u.value = g;
    }
    const n = this.champion ? 0.16 + Math.sin(this.glowT * 3) * 0.05 : 0;
    this.mendK += (+(this.state === `mend`) - this.mendK) * Math.min(1, e * 4);
    const r = this.mendK > 0.01 ? this.mendK * (0.2 + Math.sin(this.glowT * 7) * 0.08) : 0;
    for (const s of this.skins)
      s.emissive
        .copy(rF)
        .multiplyScalar(this.flash * this.flash * 0.7)
        .add(iF.setRGB(0.05, 0.22, 0.42).multiplyScalar(this.frost))
        .add(aF.setRGB(1, 0.62, 0.12).multiplyScalar(n))
        .add(oF.setRGB(0.12, 0.85, 0.5).multiplyScalar(r));
  }
  /** Shows / hides the rock in the right hand (golem hurl). */
  holdRock(e: boolean): void {
    if (!e) {
      if (this.rock) this.rock.visible = false;
      return;
    }
    if (!this.rock) {
      const hand = this.root.getObjectByName(`handslotr`);
      if (!hand) return;
      this.rock = rockMesh();
      this.rock.scale.setScalar(0.6 / this.root.scale.x);
      hand.add(this.rock);
    }
    this.rock.visible = true;
  }
  /** The rock left the hand (the thrown rock is a combat shot). */
  letGo(): void {
    this.thrown = true;
    this.holdRock(false);
  }
  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    this.skeleton?.dispose();
  }
}
