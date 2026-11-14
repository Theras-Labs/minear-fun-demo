// Port of play-inUT-NSi.js 54081-54153 (settings storage, quality ladder, GPU class guess)
// and the per-quality tables of 69993-70055 (xR, SR, CR, wR, TR, GR).
// The settings panel yj (54154-54293) is ported later with the menus.
import { IS_TOUCH } from './device';

export type Quality = 'lite' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
  quality: Quality;
  autoQuality: boolean;
  time: string;
  weather: string;
  sensitivity: number;
  invertY: boolean;
  look: 'painterly' | 'classic';
  v: number;
}

const SETTINGS_KEY = 'minear.settings.v1'; // cj (54081)

export const DEFAULT_SETTINGS: Settings = { // lj (54082)
  master: 0.9,
  music: 0.85,
  sfx: 0.9,
  ambience: 0.25,
  muted: false,
  quality: 'high',
  autoQuality: true,
  time: 'cycle',
  weather: 'dynamic',
  sensitivity: 1,
  invertY: false,
  look: 'painterly',
  v: 2,
};

function readStored(): Partial<Settings> | null { // uj (54097)
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function readLegacy(): Partial<Settings> | null { // dj (54105)
  try {
    const s = localStorage.getItem('minear.save.v1');
    const t = s ? JSON.parse(s).settings : null;
    return t && typeof t === 'object' ? t : null;
  } catch {
    return null;
  }
}

/** fj (54114): true when the player has saved settings before. */
export function hasSettings() {
  return (readStored() ?? readLegacy()) !== null;
}

/** pj (54117): load and migrate. */
export function loadSettings(): Settings {
  try {
    const e = readStored() ?? readLegacy();
    if (e) {
      const t: Settings = { ...DEFAULT_SETTINGS, ...e };
      if (e.autoQuality === undefined) t.autoQuality = false;
      if (!IS_TOUCH && t.quality === 'lite') t.quality = 'low';
      if (!((e.v ?? 1) >= 2)) {
        if (t.ambience === 0.7) t.ambience = DEFAULT_SETTINGS.ambience;
        t.v = 2;
      }
      return t;
    }
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

/** gj (54149) */
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** mj (54132) */
export const QUALITY_LADDER: Quality[] = IS_TOUCH ? ['lite', 'low', 'medium', 'high', 'ultra'] : ['low', 'medium', 'high', 'ultra'];

/** hj (54133): GPU class guess from the WebGL renderer string. */
export function guessQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    if (/(swiftshader|llvmpipe|microsoft basic|software)/.test(name)) return 'low';
    if (/(intel|uhd|iris|mali|adreno|powervr|apple|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics)/.test(name))
      return 'medium';
  } catch {
    /* unknown */
  }
  return 'high';
}

export const PIXEL_RATIO: Record<Quality, number> = { lite: 1, low: 1, medium: 1.25, high: 1.5, ultra: 2 }; // xR (69993)
/**
 * MINEAR: most drawing-buffer pixels. The frame is GPU-bound (the base costs about 18 ms of GPU at 1.8 M pixels
 * in a test window, and a full-screen Retina window at the high quality's 1.5 ratio draws 4.3 M), so the pixel
 * ratio drops on big windows until the buffer fits this budget. It never drops below 1 or rises above the
 * quality's own ratio, so small and normal windows look the same as before.
 */
export const PIXEL_BUDGET = 3.0e6;

/** The drawing pixel ratio for a quality, inside PIXEL_BUDGET for the current window size (0.05 steps). */
export function cappedPixelRatio(q: Quality): number {
  const want = Math.min(window.devicePixelRatio, PIXEL_RATIO[q] ?? 1.5);
  const css = Math.max(1, window.innerWidth * window.innerHeight);
  const fit = Math.floor(Math.sqrt(PIXEL_BUDGET / css) * 20) / 20;
  return Math.max(Math.min(1, want), Math.min(want, fit));
}
export const SHADOW_SIZE: Record<Quality, number> = { lite: 1024, low: 1024, medium: 1536, high: 2048, ultra: 3072 }; // SR
export const MSAA: Record<Quality, number> = { lite: 0, low: 0, medium: 2, high: 4, ultra: 4 }; // CR
export const SOFT_SHADOWS: Record<Quality, boolean> = { lite: false, low: false, medium: true, high: true, ultra: true }; // wR
export const DETAIL: Record<Quality, number> = { lite: 0.35, low: 0.5, medium: 0.8, high: 1, ultra: 1 }; // TR
export const DECOR_DENSITY: Record<Quality, number> = { lite: 0.22, low: 0.35, medium: 0.55, high: 0.75, ultra: 1 }; // GR (70055)

/**
 * The start quality as KR's constructor picks it (70239-70247): without saved settings, `lite` on touch,
 * else the GPU guess, one step lower above 4.2 million drawing-buffer pixels; touch + autoQuality forces `lite`.
 */
export function pickStartQuality(settings: Settings, gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  let q = settings.quality;
  if (!hasSettings()) {
    q = IS_TOUCH ? 'lite' : guessQuality(gl);
    const pr = Math.min(window.devicePixelRatio, PIXEL_RATIO[q] ?? 1.5);
    const i = QUALITY_LADDER.indexOf(q);
    if (window.innerWidth * window.innerHeight * pr * pr > 4.2e6 && i > 0) q = QUALITY_LADDER[i - 1];
  }
  if (IS_TOUCH && settings.autoQuality) q = 'lite';
  return q;
}
