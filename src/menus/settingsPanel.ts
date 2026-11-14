// Port of play-inUT-NSi.js 54154-54293: the settings panel yj (div#settings in index.html) with its audio sliders
// _j and its choices vj (quality, time of day, weather). Every change is applied at once and saved (gj); "Start
// over" needs a second click within 4 s.
// Plus KR's glue for it:
//   70590-70595  the panel made with its onChange (applySettings, then a save) and onReset (makeSettingsPanel)
//   71000-71051  KR.applySettings, whole (src/game/Game.ts applySettings holds only a part of it)
//   70840-70848  KR.liteLights (touch, Lite quality: the point lights off, except the aura and the hub's)
// The settings storage itself (pj / gj) is src/game/settings.ts.
import * as THREE from 'three';
import { IS_TOUCH } from '../game/device';
import {
  cappedPixelRatio,
  DECOR_DENSITY,
  DETAIL,
  MSAA,
  PIXEL_RATIO,
  SHADOW_SIZE,
  SOFT_SHADOWS,
  saveSettings,
  type Quality,
  type Settings,
} from '../game/settings';
import type { AudioMix } from '../audio/audio';
import type { WeatherMode } from '../sky/weather';
import { setLook } from '../render/atmosphere';
import { terrainUniforms } from '../render/terrainMaterial';
import { SANDBOX_TIME } from '../tutorial/krTutorial';

const J = IS_TOUCH; // J

/** _j (54154): the audio sliders (0-100 %). */
const AUDIO_SLIDERS: { key: keyof Settings; label: string }[] = [ // _j (54154)
  { key: `master`, label: `Master` },
  { key: `music`, label: `Music` },
  { key: `sfx`, label: `Effects` },
  { key: `ambience`, label: `Ambience` },
];

/** vj (54160): the segmented choices (Lite only on touch). */
const CHOICES: { key: `quality` | `time` | `weather`; label: string; options: [string, string][] }[] = [ // vj (54160)
  {
    key: `quality`,
    label: `Quality`,
    options: [
      [`auto`, `Auto`],
      ...(J ? ([[`lite`, `Lite`]] as [string, string][]) : []),
      [`low`, `Low`],
      [`medium`, `Medium`],
      [`high`, `High`],
      [`ultra`, `Ultra`],
    ],
  },
  {
    key: `time`,
    label: `Time of day`,
    options: [
      [`cycle`, `Cycle`],
      [`day`, `Day`],
      [`sunset`, `Sunset`],
      [`night`, `Night`],
    ],
  },
  {
    key: `weather`,
    label: `Weather`,
    options: [
      [`dynamic`, `Dynamic`],
      [`clear`, `Clear`],
      [`rain`, `Rain`],
      [`storm`, `Storm`],
    ],
  },
];

/** The settings object read and written by its data-key names. */
type Bag = Record<string, unknown>;

export class SettingsPanel { // yj (54194)
  s: Settings;
  onChange: (s: Settings) => void;
  el: HTMLElement;
  onClose: () => void = () => {};
  onReset: () => void | Promise<void> = () => {};
  onTutorial: () => void = () => {};

  constructor(e: Settings, t: (s: Settings) => void) {
    this.s = e;
    this.onChange = t;
    this.el = document.getElementById(`settings`)!;
    const n = this.el.querySelector<HTMLElement>(`.body`)!;
    n.innerHTML = `
      <section><h3>Audio</h3>${AUDIO_SLIDERS.map((e) => `<label class="slider"><span>${e.label}</span><input type="range" min="0" max="100" step="1" data-key="${e.key}"><em></em></label>`).join(``)}
      <label class="check"><input type="checkbox" data-key="muted"><span>Mute everything <kbd>M</kbd></span></label></section>
      <section><h3>World &amp; Graphics</h3>${CHOICES.map((e) => `<div class="choice" data-key="${String(e.key)}"><span>${e.label}</span><div class="seg">${e.options.map(([e, t]) => `<button type="button" data-v="${e}">${t}</button>`).join(``)}</div></div>`).join(``)}</section>
      <section><h3>Controls</h3>
      <label class="slider"><span>${J ? `Look speed` : `Mouse`}</span><input type="range" min="25" max="200" step="5" data-key="sensitivity"><em></em></label>
      <label class="check"><input type="checkbox" data-key="invertY"><span>Invert look up/down</span></label>
      <div class="replay"><span>Tutorial</span><button type="button" class="ghost" data-tutorial>Play it again</button></div></section>
      <section class="danger"><h3>Progress</h3>
      <div class="startover"><span>Start over as a brand-new miner: no coins, gems, cards or gear. Your settings stay.</span>
      <button type="button" class="ghost" data-reset>Start over</button></div></section>`;
    n.querySelectorAll<HTMLInputElement>(`input[type=range]`).forEach((e) => {
      e.addEventListener(`input`, () => {
        const t = e.dataset.key!;
        (((this.s as unknown as Bag)[t] = +e.value / 100), this.commit());
      });
    });
    n.querySelectorAll<HTMLInputElement>(`input[type=checkbox]`).forEach((e) => {
      e.addEventListener(`change`, () => {
        (((this.s as unknown as Bag)[e.dataset.key!] = e.checked), this.commit());
      });
    });
    n.querySelectorAll<HTMLElement>(`.choice`).forEach((e) => {
      e.querySelectorAll<HTMLElement>(`button`).forEach((t) => {
        t.addEventListener(`click`, () => {
          (e.dataset.key === `quality`
            ? ((this.s.autoQuality = t.dataset.v === `auto`),
              t.dataset.v !== `auto` && (this.s.quality = t.dataset.v as Quality))
            : ((this.s as unknown as Bag)[e.dataset.key!] = t.dataset.v),
            this.commit());
        });
      });
    });
    n.querySelector(`[data-tutorial]`)!.addEventListener(`click`, () => this.onTutorial());
    const r = n.querySelector<HTMLElement>(`[data-reset]`)!;
    let i = 0;
    r.addEventListener(`click`, () => {
      if (performance.now() - i < 4e3) {
        ((r.textContent = `Starting over…`), this.onReset());
        return;
      }
      i = performance.now();
      r.textContent = J ? `Tap again to wipe it` : `Click again to wipe it`;
      r.classList.add(`armed`);
      setTimeout(() => {
        performance.now() - i >= 3900 && ((r.textContent = `Start over`), r.classList.remove(`armed`));
      }, 4e3);
    });
    this.el.querySelector(`.close`)!.addEventListener(`click`, () => this.close());
    window.addEventListener(`keydown`, (e) => {
      e.code === `Escape` && this.open && this.close();
    });
    this.el.addEventListener(`click`, (e) => {
      e.target === this.el && this.close();
    });
    this.sync();
  }

  get open(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  show(): void {
    (this.sync(), this.el.classList.remove(`hidden`));
  }

  close(): void {
    this.open && (this.el.classList.add(`hidden`), this.onClose());
  }

  /** Puts the settings into the controls (also after M mutes, src/menus/panels.ts handlePanelKeys). */
  sync(): void {
    const e = this.el.querySelector<HTMLElement>(`.body`)!;
    e.querySelectorAll<HTMLInputElement>(`input[type=range]`).forEach((e) => {
      const t = (this.s as unknown as Bag)[e.dataset.key!] as number;
      e.value = String(Math.round(t * 100));
      e.nextElementSibling!.textContent = `${Math.round(t * 100)}%`;
    });
    e.querySelectorAll<HTMLInputElement>(`input[type=checkbox]`).forEach((e) => {
      e.checked = !!(this.s as unknown as Bag)[e.dataset.key!];
    });
    e.querySelectorAll<HTMLElement>(`.choice`).forEach((e) => {
      const t = e.dataset.key === `quality` && this.s.autoQuality,
        n = t ? `auto` : (this.s as unknown as Bag)[e.dataset.key!];
      e.querySelectorAll<HTMLElement>(`button`).forEach((e) => {
        e.classList.toggle(`on`, e.dataset.v === n);
        e.classList.toggle(`auto`, t && e.dataset.v === this.s.quality);
      });
    });
  }

  commit(): void {
    (this.sync(), saveSettings(this.s), this.onChange(this.s));
  }
}

/** yR (69991): the frozen day-clock time per "Time of day" choice (null: the clock runs). */
const TIME_FROZEN: Record<string, number | null> = { cycle: null, day: 0.42, sunset: 0.735, night: 0.96 }; // yR (69991)

/**
 * The game (KR) as applySettings reads and writes it. The optional members are optional in KR too (the original
 * guards them with `this.x &&` / `this.x?.`, because the tuner can call applySettings while the constructor runs).
 */
export interface SettingsHost {
  settings: Settings;
  sandbox: boolean;
  state: { save(): void; reset(): void };
  audio: { setMix(s: AudioMix): void };
  renderer?: THREE.WebGLRenderer | null;
  scene: THREE.Object3D;
  /** The post chain (src/post/composer.ts): KR.outline, KR.bloom, KR.composer. */
  post?: {
    outline: { enabled: boolean };
    bloom: { enabled: boolean };
    composer: { renderTarget1: THREE.WebGLRenderTarget; renderTarget2: THREE.WebGLRenderTarget };
  } | null;
  decor?: { setPainterly(on: boolean): void; setSparse(k: number): void } | null;
  farForest?: { setPainterly(on: boolean): void } | null;
  grass?: { setQuality(q: string): void; setStyle(s: string): void; farRadius: number } | null;
  weather?: { setMode(m: WeatherMode): void } | null;
  caveDecor?: { density: number } | null;
  biomes?: { density: number } | null;
  world: { pitsOnly: boolean; drawR: number };
  env?: { clock: { frozen: number | null }; sun: { shadow: { mapSize: THREE.Vector2 } } } | null;
  cam: { sensitivity: number; invertY: boolean };
  /** The aura point light (liteLights leaves it on). */
  aura: THREE.Object3D;
  hub: { group: THREE.Object3D };
  /** KR.resize (71303), with the size it reads: the canvas client size, or the window's. */
  resize(w: number, h: number): void;
}

/** KR.liteLights (70840): on = every point light off except the aura and the hub's own lights. */
export function liteLights(g: Pick<SettingsHost, 'aura' | 'hub' | 'scene'>, e: boolean): void { // KR.liteLights (70840)
  const t = new Set<THREE.Object3D>([g.aura]);
  g.hub.group.traverse((e) => {
    (e as THREE.Light).isLight && t.add(e);
  });
  g.scene.traverse((n) => {
    (n as THREE.PointLight).isPointLight && !t.has(n) && (n.visible = !e);
  });
}

/** KR.applySettings (71000): puts settings e into effect. */
export function applySettings(g: SettingsHost, e: Settings): void { // KR.applySettings (71000)
  g.audio.setMix(e);
  const t = new URLSearchParams(location.search).get(`look`),
    n = t === `painterly` || t === `classic` ? t : `painterly`;
  setLook(n); // zy
  const p = g.post;
  p && (p.outline.enabled = n === `painterly`);
  g.decor?.setPainterly(n === `painterly`);
  g.farForest?.setPainterly(n === `painterly`);
  g.grass &&
    (g.grass.setQuality(e.quality), g.grass.setStyle(n), (terrainUniforms.uGrassR.value = g.grass.farRadius)); // xb
  g.weather?.setMode(g.sandbox ? `clear` : (e.weather as WeatherMode));
  g.caveDecor && (g.caveDecor.density = DECOR_DENSITY[e.quality] ?? 1); // GR
  g.biomes && (g.biomes.density = DECOR_DENSITY[e.quality] ?? 1); // GR
  g.decor?.setSparse(DETAIL[e.quality] ?? 1); // TR
  p && (p.bloom.enabled = SOFT_SHADOWS[e.quality] ?? !0); // wR: bloom on from Medium up
  g.world.pitsOnly = e.quality === `lite` || e.quality === `low`;
  document.documentElement.classList.toggle(`lite`, J || e.quality === `lite` || e.quality === `low`);
  g.world.drawR = J && e.quality === `lite` ? 5 : 1 / 0;
  J &&
    g.renderer &&
    g.renderer.shadowMap.enabled !== (e.quality !== `lite`) &&
    ((g.renderer.shadowMap.enabled = e.quality !== `lite`),
    liteLights(g, e.quality === `lite`),
    g.scene.traverse((e) => {
      const t = (e as THREE.Mesh).material;
      if (t) for (const e of Array.isArray(t) ? t : [t]) e.needsUpdate = !0;
    }));
  if (p) {
    const t = MSAA[e.quality] ?? 4; // CR
    for (const e of [p.composer.renderTarget1, p.composer.renderTarget2])
      e.samples !== t && ((e.samples = t), e.dispose());
  }
  if (g.env) {
    g.env.clock.frozen = g.sandbox ? SANDBOX_TIME : TIME_FROZEN[e.time];
    const t = SHADOW_SIZE[e.quality] ?? 2048, // SR
      n = g.env.sun.shadow;
    n.mapSize.x !== t && n.mapSize.set(t, t);
  }
  const r = cappedPixelRatio(e.quality); // xR; MINEAR: inside the pixel budget (src/game/settings.ts)
  if (g.renderer && Math.abs(g.renderer.getPixelRatio() - r) > 0.01) {
    g.renderer.setPixelRatio(r);
    const c = g.renderer.domElement;
    g.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
  }
  g.cam.sensitivity = 0.0022 * e.sensitivity;
  g.cam.invertY = e.invertY;
}

/**
 * KR constructor 70590-70595: the settings panel; a change is applied and the miner saved; Start over wipes the
 * save and reloads. In the original, onReset also awaits gO.startOver(new Fj().snapshot()), which writes the fresh
 * save to the account and returns at once for a guest; solo has no account, so that call is left out.
 * The rest of its wiring is elsewhere: onClose (70596) in src/menus/panels.ts wirePanels; onTutorial (70837:
 * VN.again()) in src/tutorial/krTutorial.ts makeTutorial, which sets it only when settingsPanel already exists
 * (KR makes the panel at 70590, before the tutorial at 70802).
 */
export function makeSettingsPanel(g: SettingsHost): SettingsPanel { // KR constructor (70590)
  const p = new SettingsPanel(g.settings, (e) => {
    (applySettings(g, e), g.state.save());
  });
  p.onReset = async () => {
    (g.state.reset(), location.reload());
  };
  return p;
}
