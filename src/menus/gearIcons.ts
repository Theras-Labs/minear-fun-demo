// Port of play-inUT-NSi.js 57518-57679: the gear GLB loader pM (/models/gear.glb) and the offscreen icon
// "studio" _M, which renders each gear base and each loot item into a 128x128 PNG data URL for the UI, plus
// the tile HTML helpers vM (gear), yM (gem bag slot) and bM (supply).
// The studio renders into a float multisampled target with its own lights and camera, then unpremultiplies,
// tone-maps (x / (1 + 0.18x)) and sRGB-encodes the pixels by hand, and draws a dark outline by stamping the
// image 12 times around a 4 px circle.
//
// KR wiring (constructor 70535-70537), after the renderer is set up and pickups exist:
//   gearIcons.build(renderer, gearScene);                        // gearScene = await loadGear() (dz 75725)
//   gearIcons.buildLoot(renderer, (id) => lootModel(game, id));  // lootModel: src/pickups/collect.ts
//   ui.icons = gearIcons;                                        // the HUD reads _M through Hud.icons
//   model.setWardrobe(gearScene); syncLook();                    // the wardrobe (inventory owner)
//
// The no-image fallbacks (hM slot SVGs, the diamond loot SVG) are src/ui/hud.ts fallbackIcons, which holds
// the same strings; they are imported, not copied.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { fallbackIcons, type HudIcons } from '../ui/hud';
import { GEAR_BASES, GEAR_BY_ID, type GearItem, type GearSlotType } from '../state/gear';
import { TIER_COLORS } from '../state/progression';
import { ITEMS, RARITY_COLORS, type ItemDef } from '../world/items';
import { dyeMaterial } from '../miner/stylize';
import { starsHTML } from '../ui/stars';
import { FORGE_GRADES, FORGE_SLOTS } from '../base/workshop';
import { METAL_DYE, toolIconSVG } from './toolIcons';

export { METAL_DYE };

const ITEM = ITEMS as Record<string, ItemDef>;

/** fM (57518): icon size in pixels. */
export const ICON_SIZE = 128; // fM (57518)

/** pM (57519): loads /models/gear.glb (Draco); its scene, or null with a warning when it is missing. */
export async function loadGear(): Promise<THREE.Group | null> { // pM (57519)
  try {
    const e = new DRACOLoader().setDecoderPath(`/draco/`);
    const t = await new GLTFLoader().setDRACOLoader(e).loadAsync(`/models/gear.glb`);
    return (e.dispose(), t.scene);
  } catch (e) {
    return (console.warn(`gear models missing`, e), null);
  }
}

/** mM (57528): outline and stroke color. */
const OUTLINE = `#3a281c`; // mM (57528)

/** The no-image branches of _M.html / _M.lootHtml (57661, 57667), with QA[base].slot. */
const fallback = fallbackIcons((base) => GEAR_BY_ID[base]?.slot);

/** gM (57537): the empty-slot SVG of a slot type (hM[slot] in a 48x48 viewBox). */
export const slotIcon = (slot: GearSlotType): string => fallbackIcons(() => slot).html(``); // gM (57537)

/** A snapshot call inside studio(): renders obj with the view rotation (rx, ry) and returns a PNG data URL. */
export type StudioShot = (obj: THREE.Object3D, rx?: number, ry?: number) => string;

/** _M (57538): the icon cache. urls: gear base id -> data URL; loot: item id -> data URL. */
export class GearIcons implements HudIcons { // _M (57538)
  urls = new Map<string, string>();
  loot = new Map<string, string>();
  /** MINEAR Forge: "base@metal" -> data URL (gear in a Forge metal). The Forge face pieces render at build;
   *  any other base renders the first time it is asked for (metalUrl), with the kept renderer and scene. */
  metal = new Map<string, string>();
  private studioGl: THREE.WebGLRenderer | null = null;
  private gearScene: THREE.Object3D | null = null;

  /** Sets up the studio on the renderer, runs fn with the snapshot call, then restores the renderer. */
  studio(e: THREE.WebGLRenderer, t: (shot: StudioShot) => void): void {
    const fM = ICON_SIZE;
    const n = new THREE.Scene();
    n.add(new THREE.HemisphereLight(16774368, 5917290, 1.6));
    const r = new THREE.DirectionalLight(16777215, 2.6);
    r.position.set(2, 3, 4);
    const i = new THREE.DirectionalLight(10476799, 1.4);
    i.position.set(-3, 1, -2);
    n.add(r, i);
    const a = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    const o = new THREE.WebGLRenderTarget(fM, fM, { samples: 4, type: THREE.FloatType });
    const s = new Float32Array(65536);
    const c = document.createElement(`canvas`);
    c.width = c.height = fM;
    const l = c.getContext(`2d`)!;
    const u = document.createElement(`canvas`);
    u.width = u.height = fM;
    const d = u.getContext(`2d`)!;
    const f = e.getRenderTarget();
    const p = e.getClearColor(new THREE.Color());
    const m = e.getClearAlpha();
    e.setClearColor(0, 0);
    const h = (e: number) => (
      (e /= 1 + e * 0.18),
      (e = e <= 0.0031308 ? e * 12.92 : 1.055 * e ** (1 / 2.4) - 0.055),
      Math.max(0, Math.min(255, Math.round(e * 255)))
    );
    const _: StudioShot = (t, r = 0.35, i = -0.7) => {
      const f = new THREE.Group();
      f.add(t);
      f.updateMatrixWorld(true);
      const p = new THREE.Box3().setFromObject(t);
      t.position.sub(p.getCenter(new THREE.Vector3()));
      f.rotation.set(r, i, 0);
      n.add(f);
      const m = p.getSize(new THREE.Vector3()).length() / 2;
      a.position.set(0, 0, (m / Math.tan(THREE.MathUtils.degToRad(a.fov / 2))) * 1.02);
      a.lookAt(0, 0, 0);
      e.setRenderTarget(o);
      e.clear();
      e.render(n, a);
      e.readRenderTargetPixels(o, 0, 0, fM, fM, s);
      n.remove(f);
      const g = l.createImageData(fM, fM);
      for (let e = 0; e < fM; e++)
        for (let t = 0; t < fM; t++) {
          const n = ((127 - e) * fM + t) * 4;
          const r = (e * fM + t) * 4;
          const i = Math.min(1, s[n + 3]);
          const a = i > 0.001 ? 1 / i : 0;
          g.data[r] = h(s[n] * a);
          g.data[r + 1] = h(s[n + 1] * a);
          g.data[r + 2] = h(s[n + 2] * a);
          g.data[r + 3] = Math.round(i * 255);
        }
      l.putImageData(g, 0, 0);
      d.clearRect(0, 0, fM, fM);
      for (let e = 0; e < 12; e++) {
        const t = (e / 12) * Math.PI * 2;
        d.drawImage(c, Math.cos(t) * 4, Math.sin(t) * 4);
      }
      d.globalCompositeOperation = `source-in`;
      d.fillStyle = OUTLINE;
      d.fillRect(0, 0, fM, fM);
      d.globalCompositeOperation = `source-over`;
      d.drawImage(c, 0, 0);
      return u.toDataURL(`image/png`);
    };
    try {
      t(_);
    } finally {
      e.setRenderTarget(f);
      e.setClearColor(p, m);
      o.dispose();
    }
  }

  /** Renders one icon per gear base from the gear.glb scene (bases that share model, tint and dye share it). */
  build(e: THREE.WebGLRenderer, t: THREE.Object3D | null): void {
    if (!t) return;
    this.studioGl = e;
    this.gearScene = t;
    this.studio(e, (e) => {
      const n = new Map<string, string>();
      for (const r of GEAR_BASES) {
        const i = r.model + `:` + (r.tint ?? ``) + `:` + (r.dye ?? ``);
        const a = n.get(i);
        if (a) {
          this.urls.set(r.id, a);
          continue;
        }
        const o = t.getObjectByName(r.model);
        if (!o) continue;
        const s = o.clone(true);
        s.position.set(0, 0, 0);
        s.quaternion.identity();
        s.scale.setScalar(1);
        if (r.tint || r.dye !== undefined)
          s.traverse((e) => {
            const t = e as THREE.Mesh;
            if (!t.isMesh) return;
            const n = (t.material as THREE.MeshStandardMaterial).clone();
            if (r.tint && /Metal|Bit/.test(n.name)) n.color.setHex(r.tint);
            if (r.dye !== undefined) dyeMaterial(n, r.dye);
            t.material = n;
          });
        const c = e(s);
        n.set(i, c);
        this.urls.set(r.id, c);
      }
      // the Forge face pieces (the metal tiles) in each Forge metal; the Claws slot uses drawings instead
      for (const f of FORGE_SLOTS) for (const g of FORGE_GRADES) this.metalShot(e, t, f.base, g.ore);
    });
  }

  /** Renders base `base` dyed in metal `ore` into the metal cache (inside a studio() call). */
  private metalShot(shot: StudioShot, scene: THREE.Object3D, base: string, ore: string): void {
    const b = GEAR_BY_ID[base];
    const o = b && b.slot !== `drill` && scene.getObjectByName(b.model);
    const dye = METAL_DYE[ore];
    if (!o || dye === undefined) return;
    const s = o.clone(true);
    s.position.set(0, 0, 0);
    s.quaternion.identity();
    s.scale.setScalar(1);
    s.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      if (/Metal|Bit/.test(mat.name)) mat.color.setHex(dye);
      else dyeMaterial(mat, dye);
      m.material = mat;
    });
    this.metal.set(`${base}@${ore}`, shot(s));
  }

  /** Renders one icon per item (K) from make(id): gems at (0.2, -0.5), everything else at (0.55, -0.6). */
  buildLoot(e: THREE.WebGLRenderer, t: (id: string) => THREE.Object3D | null): void {
    this.studio(e, (e) => {
      for (const n in ITEMS) {
        const r = t(n);
        if (!r) continue;
        r.position.set(0, 0, 0);
        const i = ITEM[n].kind;
        this.loot.set(n, i === `gem` ? e(r, 0.2, -0.5) : e(r, 0.55, -0.6));
      }
    });
  }

  url(e: string): string | null {
    return this.urls.get(e) ?? null;
  }

  /** The icon of a gear base in a Forge metal (rendered on first use), or null. */
  metalUrl(base: string, ore: string): string | null {
    const k = `${base}@${ore}`;
    if (!this.metal.has(k) && this.studioGl && this.gearScene) {
      const scene = this.gearScene;
      this.metal.set(k, ``); // one try per key, even when the base has no model
      this.studio(this.studioGl, (shot) => this.metalShot(shot, scene, base, ore));
    }
    return this.metal.get(k) || null;
  }

  /** Gear icon tile content: a Claws-slot drawing (minear-r3f/src/menus/toolIcons.ts), the rendered icon (a
   *  forged piece in its metal), or the slot SVG. */
  html(e: string | { base: string; ore?: string }): string {
    const t = typeof e == `string` ? e : e.base;
    const ore = typeof e != `string` ? e.ore : undefined;
    const tool = toolIconSVG(t, ore);
    if (tool) return tool;
    const n = (ore && this.metalUrl(t, ore)) || this.url(t);
    return n ? `<img src="${n}" alt="" draggable="false">` : fallback.html(t);
  }

  /** Loot (gem, supply, ore, soul) icon content: the rendered icon, or a diamond in the item color. */
  lootHtml(e: string): string {
    const t = this.loot.get(e);
    return t ? `<img src="${t}" alt="" draggable="false">` : fallback.lootHtml(e);
  }
}

/** _M (57538): the one icon cache. */
export const gearIcons = new GearIcons(); // _M (57538)

/** vM (57670): a gear item tile (attrs is extra HTML attribute text). */
export function gearTile(e: GearItem, t = ``): string { // vM (57670)
  return `<div class="itile t${e.tier}${e.fresh ? ` fresh` : ``}" data-uid="${e.uid}" style="--tc:${TIER_COLORS[e.tier]}" ${t}>${gearIcons.html(e)}${starsHTML(e.tier, `tile`)}</div>`;
}

/** yM (57673): a gem bag slot tile (stack, slot index, over = past the bag's capacity). */
export function gemTile(e: { id: string; n: number }, t: number, n = false): string { // yM (57673)
  const r = ITEM[e.id];
  return `<div class="itile loot crystal r-${r.rarity}${n ? ` over` : ``}" data-i="${t}" style="--tc:${RARITY_COLORS[r.rarity]}">${gearIcons.lootHtml(e.id)}${e.n > 1 ? `<b class="qty">${e.n}</b>` : ``}</div>`;
}

/** bM (57677): a supply tile with its count (attrs is extra HTML attribute text). */
export function supplyTile(e: string, t: number, n = ``): string { // bM (57677)
  return `<div class="itile supply${t <= 0 ? ` out` : ``}" style="--tc:#ff7a5c" ${n}>${gearIcons.lootHtml(e)}<b class="qty">${t}</b></div>`;
}
