// KR's glue for the Mirror of Renown, the Stranger, the beast souls quest and the lodestone, as a class over a
// small host (the game). Bundle play-inUT-NSi.js lines 75265-75502 (updateMirror, openLeaders, updateStranger,
// talkToStranger, lodestoneArrives, lodestoneT, nextBeast), 70137-70141 (fields), 70237 (new oR), 70350 (scene
// add), 71548-71551 (colliders), 72057-72058 (update calls). The E key (72233-72238) and the HUD hint, touch
// word and compass beast pip (75012-75014, 75084-75086, 75119-75128) are in src/ui/kr-hud.ts; they call the
// game's stranger / mirror / talkToStranger / openLeaders / nextBeast, which forward to this class.
import * as THREE from 'three';
import { LIFT_POINT } from '../world/constants';
import { beastCaverns, cavernAt } from '../world/caverns';
import { BOSS_OF_BIOME, bossLair } from '../bosses/sim/defs';
import { SOULS, SOUL_KINDS, hexColor, type SoulKind } from '../pickups/souls';
import type { EmitOptions } from '../fx/particles';
import type { PlayerState } from '../state/playerState';
import type { Hud, HudSoul, HudTalkOptions } from '../ui/hud';
import type { Audio } from '../audio/audio';
import { Mirror } from './mirror';
import { Stranger } from './stranger';
import { STRANGER_LINES, STRANGER_OFFSET, MIRROR_OFFSET, REMAIN_LINES, type StrangerTalkKey } from './dialogue';

const W = LIFT_POINT; // W (28758)

// KR module scratch ($ and MR, 70040-70041)
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR

/** The game object (KR) as this glue reads and writes it. */
export interface NpcHost {
  player: { pos: THREE.Vector3 };
  hub: { collider: THREE.Mesh };
  grass: { markDirty(x?: number, z?: number): void };
  sparks: { emit(o: EmitOptions): void };
  cam: { addShake(k: number): void };
  state: Pick<PlayerState, 'souls' | 'soulsGiven' | 'skyOpen' | 'lodestone' | 'deepest' | 'seen' | 'strangerTalk' | 'save'>;
  ui: Pick<Hud, 'talk' | 'talkHide' | 'talking' | 'lodestone' | 'flash' | 'banner'>;
  audio: Pick<Audio, 'whisper' | 'murmur' | 'lodeRise' | 'lodeLand' | 'gem' | 'click'>;
  /** KR.lodestoneT (75490): the compass beast pip pulses while > 0; kr-hud updateHud counts it down. */
  lodestoneT: number;
  /** KR.releaseLock (72250): leaves pointer lock. */
  releaseLock(): void;
  /** ZL leaderboard panel (69466), ported by another owner; absent until then. */
  leadersPanel?: { readonly open: boolean; show(online: boolean): void } | null;
  /** mp.askLeaders (49102). Solo: false (the net is not online). */
  askLeaders?(): boolean;
}

export class KrNpc {
  readonly mirror = new Mirror(); // KR.mirror tR (70137)
  mirrorPlaced = false; // 70138
  leadersT = 0; // 70139
  readonly stranger: Stranger; // KR.stranger oR (70140, built at 70237)
  strangerPlaced = false; // 70141

  constructor(
    private readonly host: NpcHost,
    strangerScene: THREE.Object3D | null,
  ) {
    this.stranger = new Stranger(strangerScene); // 70237
  }

  /** mp.askLeaders() as KR sees it; solo returns false (49103). */
  private askLeaders(): boolean {
    return this.host.askLeaders?.() ?? false;
  }

  /** KR.colliders (71548-71551): the Stranger's then the Mirror's collider when their boxes meet `box`. */
  colliders(box: THREE.Box3, list: THREE.Mesh[]): THREE.Mesh[] {
    if (this.stranger.collider && box.intersectsBox(this.stranger.box)) list.push(this.stranger.collider);
    if (this.mirror.collider && box.intersectsBox(this.mirror.box)) list.push(this.mirror.collider);
    return list;
  }

  /** KR.update 72057-72058: updateStranger, then updateMirror (right after hub.update). */
  update(dt: number): void {
    this.updateStranger(dt);
    this.updateMirror(dt);
  }

  /** KR.updateMirror (75265): places the Mirror on the hub once, then sparkles and leaderboard refresh. */
  updateMirror(dt: number): void {
    const g = this.host;
    const t = this.mirror;
    if (!this.mirrorPlaced) {
      const x = W.x + MIRROR_OFFSET.x;
      const z = W.z + MIRROR_OFFSET.z;
      g.hub.collider.updateMatrixWorld();
      const hit = new THREE.Raycaster(new THREE.Vector3(x, W.y + 12, z), new THREE.Vector3(0, -1, 0), 0, 30).intersectObject(
        g.hub.collider,
        false,
      )[0];
      if (!hit) return;
      t.place(hit.point, Math.atan2(W.x - x, W.z - z));
      this.mirrorPlaced = true;
      g.grass.markDirty(x, z);
    }
    t.update(dt);
    if (g.player.pos.distanceToSquared(t.pos) < 1600 && Math.random() < dt * 2)
      g.sparks.emit({
        pos: T0.copy(t.glassAt).add(T1.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 1, 0)),
        vel: T1.set(0, 0.3, 0),
        spread: 0.1,
        color: Math.random() < 0.5 ? 10454783 : 7333631,
        intensity: 1.8,
        size: 0.05,
        sizeEnd: 0.01,
        life: 1.6,
        gravity: -0.12,
        count: 1,
      });
    if (g.leadersPanel?.open) {
      this.leadersT -= dt;
      if (this.leadersT <= 0) {
        this.leadersT = 10;
        this.askLeaders();
      }
    }
  }

  /** KR.openLeaders (75301): E at the Mirror. */
  openLeaders(): void {
    const g = this.host;
    g.leadersPanel?.show(this.askLeaders());
    this.leadersT = 10;
    g.audio.click();
    g.releaseLock();
  }

  /** KR.updateStranger (75307): places the Stranger on the hub once, then breath, talk range and motes. */
  updateStranger(dt: number): void {
    const g = this.host;
    const t = this.stranger;
    if (!t.loaded) return;
    const n = g.player.pos;
    if (!this.strangerPlaced) {
      const x = W.x + STRANGER_OFFSET.x;
      const z = W.z + STRANGER_OFFSET.z;
      g.hub.collider.updateMatrixWorld();
      const hit = new THREE.Raycaster(new THREE.Vector3(x, W.y + 12, z), new THREE.Vector3(0, -1, 0), 0, 30).intersectObject(
        g.hub.collider,
        false,
      )[0];
      if (!hit) return;
      t.place(hit.point, Math.atan2(W.x - x, W.z - z));
      this.strangerPlaced = true;
      g.grass.markDirty(x, z);
      if (g.state.skyOpen) t.openSky();
    }
    t.update(dt, g.state.soulsGiven.length);
    if (g.ui.talking && !t.near(n, 7)) g.ui.talkHide();
    if (n.distanceToSquared(t.pos) < 2025) {
      if (Math.random() < dt * 2.5) {
        t.mark(`ST_Head`, T0);
        g.sparks.emit({
          pos: T0.set(T0.x + (Math.random() - 0.5) * 0.3, T0.y + 0.1, T0.z + (Math.random() - 0.5) * 0.3),
          vel: T1.set(0, 0.35, 0),
          spread: 0.12,
          color: 6966015,
          intensity: 1.4,
          size: 0.05,
          sizeEnd: 0.01,
          life: 2,
          gravity: -0.15,
          count: 1,
        });
      }
      if (Math.random() < dt * (1.2 + g.state.soulsGiven.length * 1.5)) {
        t.bladeAt(T0);
        g.sparks.emit({
          pos: T0.set(T0.x + (Math.random() - 0.5) * 1.3, T0.y + 0.05, T0.z + (Math.random() - 0.5) * 1.3),
          vel: T1.set(0, 0.5, 0),
          spread: 0.15,
          color: 10474751,
          intensity: 2.2,
          size: 0.05,
          sizeEnd: 0.01,
          life: 1.4,
          gravity: -0.3,
          count: 1,
        });
      }
    }
  }

  /** KR.talkToStranger (75365): deliver souls, give the lodestone, open the sky, or the next idle line. */
  talkToStranger(): void {
    const g = this.host;
    const e = g.state;
    const carried = e.souls.filter((s) => !e.soulsGiven.includes(s)) as SoulKind[];
    const awake =
      carried.length > 0 || e.soulsGiven.length > 0 || e.deepest >= 700 || SOUL_KINDS.some((k) => e.seen[`slain:${k}`]);
    const speaks = awake || e.lodestone || e.deepest >= 70;
    let text: string;
    let cue: HudTalkOptions['cue'];
    if (carried.length) {
      e.soulsGiven.push(...carried);
      e.souls = [];
      e.lodestone = true;
      const left = SOUL_KINDS.length - e.soulsGiven.length;
      text = `${carried.map((k) => SOULS[k].line).join(` `)} ${left ? `${REMAIN_LINES[left]} ${STRANGER_LINES.retune[0]}` : `It is done. Look up.`}`;
      const blade = this.stranger.bladeAt(new THREE.Vector3());
      const from = g.player.pos.clone().setY(g.player.pos.y + 1.2);
      for (const k of carried) {
        g.sparks.emit({
          pos: from,
          vel: blade.clone().sub(from).multiplyScalar(1.4),
          spread: 1.2,
          color: SOULS[k].color,
          intensity: 3.2,
          size: 0.16,
          sizeEnd: 0.03,
          life: 0.7,
          count: 24,
          drag: 0.4,
        });
        g.sparks.emit({
          pos: blade,
          spread: 3,
          color: SOULS[k].color,
          intensity: 3.6,
          size: 0.2,
          sizeEnd: 0.02,
          life: 0.9,
          count: 30,
          gravity: -1,
        });
      }
      g.audio.gem(5);
      g.ui.flash(0.25, hexColor(SOULS[carried[0]].color));
      if (!left && !e.skyOpen) {
        e.skyOpen = true;
        this.stranger.openSky();
        g.ui.banner(`THE SKY OPENS`, `The Stranger has the soul`, `#9fc3ff`);
        g.ui.flash(0.6, `#cfe0ff`);
        g.cam.addShake(0.5);
        g.sparks.emit({
          pos: blade,
          vel: new THREE.Vector3(0, 14, 0),
          spread: 4,
          color: 12572415,
          intensity: 4,
          size: 0.3,
          sizeEnd: 0.04,
          life: 2.2,
          count: 80,
          gravity: -2,
        });
      }
    } else if (speaks && !e.lodestone) {
      e.lodestone = true;
      text = STRANGER_LINES.gift[0];
      const at = text.indexOf(`Take this.`);
      cue = { at: at >= 0 ? at + 10 : text.length, fn: () => this.lodestoneArrives() };
      const blade = this.stranger.bladeAt(new THREE.Vector3());
      g.sparks.emit({
        pos: blade,
        vel: g.player.pos.clone().setY(g.player.pos.y + 1.2).sub(blade).multiplyScalar(1.2),
        spread: 0.8,
        color: 13084927,
        intensity: 3,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.8,
        count: 26,
        drag: 0.4,
      });
    } else {
      const key: StrangerTalkKey = speaks
        ? e.soulsGiven.length >= SOUL_KINDS.length
          ? `done`
          : e.soulsGiven.length
            ? `waiting`
            : awake
              ? `awake`
              : `stone`
        : `silent`;
      const lines = STRANGER_LINES[key];
      const n = e.strangerTalk[key] ?? 0;
      text = lines[n % lines.length];
      e.strangerTalk[key] = n + 1;
    }
    e.seen.stranger = true;
    e.save();
    if (speaks) g.audio.whisper(0.6);
    const souls: HudSoul[] | null = awake
      ? SOUL_KINDS.map((k) => ({
          color: hexColor(SOULS[k].color),
          state: e.soulsGiven.includes(k) ? 2 : +!!e.souls.includes(k),
        }))
      : null;
    g.ui.talk(text, souls, { voice: (low) => g.audio.murmur(low), cue });
  }

  /** KR.lodestoneArrives (75471): the lodestone mote flies to the compass. */
  lodestoneArrives(): void {
    const g = this.host;
    g.audio.lodeRise();
    g.ui.lodestone({
      land: (inView) => {
        g.lodestoneT = 6;
        g.audio.lodeLand();
        g.ui.banner(
          `THE LODESTONE`,
          inView ? `Your compass points the way to the next mythical beast` : `Turn to find it on your compass`,
          `#c7a8ff`,
        );
      },
      seen: () => {
        g.lodestoneT = Math.max(g.lodestoneT, 4);
        g.audio.lodeLand(0.5);
      },
    });
  }

  /** KR.nextBeast (75491): the lair of the next beast whose soul is not yet given, for the compass pip. */
  nextBeast(): { x: number; z: number; color: string } | null {
    const e = this.host.state;
    if (!e.lodestone) return null;
    for (const t of beastCaverns()) {
      const kind = BOSS_OF_BIOME[t.biome];
      if (!kind || e.soulsGiven.includes(kind)) continue;
      if (e.souls.includes(kind)) return null;
      const lair = bossLair(cavernAt(t.ix, t.iy, t.iz)!);
      return { x: lair.x, z: lair.z, color: hexColor(SOULS[kind].color) };
    }
    return null;
  }
}
