// MINEAR base: procedural building models for the island sites (src/base/sites.ts). Each site is built in its
// own local frame (origin on the ground at the site centre, front toward +z), baked with the hub's material
// pipeline (forceColor4 + bakeLook, src/hub/hubAssets.ts) and merged into one mesh drawn with a per-vertex
// stylized material, so it matches the rest of the island. Locked sites show a roped-off plot with a sign and a
// bare roped-off spot with a sign until they unlock; the sign text and the floating marker follow the status.
import * as THREE from 'three';
import { bakeLook, forceColor4, mergeHub } from '../hub/hubAssets';
import { stylizePerVertex } from '../miner/stylize';
import { CAPTURE_LAYER_HUB_DRESSING } from '../render/grass';
import { sitePlace, type SiteDef, type SiteId, type SiteStatus } from './sites';

type Mat = THREE.MeshStandardMaterial;

const mat = (name: string, color: number, roughness = 0.85, metalness = 0, glow = 0): Mat => {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
  if (glow) {
    m.emissive.setHex(color);
    m.emissiveIntensity = glow;
  }
  return m;
};

/** The base palette. Names pick the grain (HUB_GRAIN) and the glow rule (HUB_GLOW_MATERIALS). */
const M = {
  woodDark: mat(`H2_WoodDark`, 0x6b4429),
  wood: mat(`H2_Wood`, 0x9a6a3f),
  woodLight: mat(`H2_WoodLight`, 0xc89a63),
  stone: mat(`H2_Stone`, 0xb2aaa0),
  stoneDark: mat(`H2_StoneDark`, 0x7a736d),
  cobble: mat(`H2_Cobble`, 0x9c9286),
  brick: mat(`H2_Stone`, 0xa9573c),
  iron: mat(`H2_Iron`, 0x6a7380, 0.45, 0.6),
  ironDark: mat(`H2_IronDark`, 0x3d434c, 0.5, 0.5),
  gold: mat(`H2_Iron`, 0xffc23d, 0.35, 0.7),
  copper: mat(`H2_Iron`, 0xe07a3a, 0.4, 0.55),
  canvas: mat(`H2_Canvas`, 0xf6ead0),
  canvasTeal: mat(`H2_Canvas`, 0x2fa39a),
  canvasOrange: mat(`H2_Awning`, 0xf08a2a),
  roofRed: mat(`H2_RoofRed`, 0xb5483a),
  roofSlate: mat(`H2_RoofIndigo`, 0x55607a),
  paper: mat(`H2_Plaster`, 0xfff4dc),
  rope: mat(`H2_Rope`, 0xcaa56c),
  soil: mat(`H2_Soil`, 0x6e4a2e),
  soilDark: mat(`H2_Soil`, 0x553821),
  burlap: mat(`H2_Burlap`, 0xc7a578),
  tarp: mat(`H2_Canvas`, 0x5f86a8),
  red: mat(`H2_PlasterWarm`, 0xe2484f, 0.6),
  cream: mat(`H2_Plaster`, 0xfff6e5, 0.6),
  water: mat(`H2_Iron`, 0x4fa7e8, 0.2, 0.1),
  coal: mat(`H2_Coal`, 0x2b2522),
  fire: mat(`H2_Fire`, 0xff7a2a, 1, 0, 2.4),
  ember: mat(`H2_Ember`, 0xff4a1a, 1, 0, 1.6),
  lamp: mat(`H2_Window`, 0xffd36b, 1, 0, 1.8),
  rune: mat(`H2_Crystal`, 0x7af7c9, 1, 0, 0.35),
  gemA: mat(`H2_Crystal`, 0x5fb4ff, 0.2, 0, 0.6),
  gemB: mat(`H2_Crystal`, 0xd64dff, 0.2, 0, 0.6),
  gemC: mat(`H2_Crystal`, 0x7af7c9, 0.2, 0, 0.6),
  ballA: mat(`H2_Plaster`, 0xffd36b, 0.5),
  ballB: mat(`H2_Plaster`, 0x5fc8ff, 0.5),
  ballC: mat(`H2_Plaster`, 0xff7aa8, 0.5),
  ballD: mat(`H2_Plaster`, 0x8be36a, 0.5),
};

const T = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();

/** Collects baked parts and collider boxes of one site in its local frame. */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  cols: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, m: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== `position` && k !== `normal`) g.deleteAttribute(k);
    T.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz, `YXZ`)), S.set(sx, sy, sz));
    g.applyMatrix4(T);
    forceColor4(g);
    this.parts.push(bakeLook(g, m));
  }
  /** Box with its base at y (not its centre). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: Mat, ry = 0, rx = 0, rz = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, rx, ry, rz);
  }
  /** Cylinder with its base at y. */
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, m: Mat, rx = 0, rz = 0, ry = 0): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y + h / 2, z, rx, ry, rz);
  }
  ball(r: number, x: number, y: number, z: number, m: Mat, sy = 1, detail = 1): void {
    this.add(new THREE.IcosahedronGeometry(r, detail), m, x, y, z, 0, 0, 0, 1, sy, 1);
  }
  /** Collider box (base at y). */
  solid(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(T.compose(V.set(x, y + h / 2, z), Q.setFromEuler(E.set(0, ry, 0, `YXZ`)), S.set(1, 1, 1)));
    this.cols.push(g);
  }
  /** A post with a small foot. */
  post(x: number, z: number, h: number, m = M.wood, r = 0.13): void {
    this.cyl(r, r * 1.1, h, 6, x, 0, z, m);
  }
  /** A low stone plinth under the whole footprint (hides uneven ground). */
  plinth(w: number, d: number, h = 0.32, m = M.cobble): void {
    this.box(w, h + 0.4, d, 0, -0.4, 0, m);
    this.solid(w, h + 0.4, d, 0, -0.4, 0);
  }
  crate(x: number, y: number, z: number, s = 0.7, ry = 0): void {
    this.box(s, s, s, x, y, z, M.woodLight, ry);
    this.box(s + 0.04, 0.08, s + 0.04, x, y + s * 0.1, z, M.woodDark, ry);
    this.box(s + 0.04, 0.08, s + 0.04, x, y + s * 0.82, z, M.woodDark, ry);
  }
  barrel(x: number, y: number, z: number, r = 0.36, h = 0.9, top = M.wood): void {
    this.cyl(r * 0.92, r * 0.86, h, 10, x, y, z, M.wood);
    this.cyl(r * 0.95, r * 0.95, 0.07, 10, x, y + h * 0.18, z, M.ironDark);
    this.cyl(r * 0.95, r * 0.95, 0.07, 10, x, y + h * 0.78, z, M.ironDark);
    this.cyl(r * 0.88, r * 0.88, 0.04, 10, x, y + h - 0.02, z, top);
  }
}

/** A plank sign with canvas text. Drawn again by setText. */
export class SignBoard {
  readonly canvas = document.createElement(`canvas`);
  readonly tex: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private shown = ``;
  constructor(w: number, h: number) {
    this.canvas.width = 512;
    this.canvas.height = Math.round((512 * h) / w);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.18 }),
    );
  }
  setText(title: string, line: string, accent: string, icon: 'lock' | 'soon' | 'none' = `none`): void {
    const key = `${title}|${line}|${accent}|${icon}`;
    if (key === this.shown) return;
    this.shown = key;
    const c = this.canvas;
    const g = c.getContext(`2d`)!;
    const W = c.width;
    const H = c.height;
    g.fillStyle = `#f3e2bf`;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = `#3a281c`;
    g.lineWidth = 10;
    g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = accent;
    g.fillRect(10, H - 30, W - 20, 20);
    const ix = icon === `none` ? 0 : 74;
    if (icon === `lock`) drawLock(g, 26, H / 2 - 40, 56, `#3a281c`, `#ffc23d`);
    if (icon === `soon`) drawHammer(g, 22, H / 2 - 40, 60);
    g.fillStyle = `#3a281c`;
    g.textAlign = `center`;
    g.textBaseline = `middle`;
    const cx = (W + ix) / 2;
    g.font = `700 ${line ? 52 : 64}px Fredoka, "Trebuchet MS", sans-serif`;
    fitText(g, title, W - ix - 40);
    g.fillText(title, cx, line ? H * 0.36 : H * 0.46);
    if (line) {
      g.font = `600 34px Fredoka, "Trebuchet MS", sans-serif`;
      g.fillStyle = `#7a5c45`;
      fitText(g, line, W - ix - 40);
      g.fillText(line, cx, H * 0.68);
    }
    this.tex.needsUpdate = true;
  }
}

function fitText(g: CanvasRenderingContext2D, text: string, max: number): void {
  const w = g.measureText(text).width;
  if (w <= max) return;
  const m = /(\d+)px/.exec(g.font);
  if (m) g.font = g.font.replace(`${m[1]}px`, `${Math.floor((+m[1] * max) / w)}px`);
}

function drawLock(g: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string, fill: string): void {
  g.save();
  g.lineWidth = s * 0.12;
  g.strokeStyle = ink;
  g.beginPath();
  g.arc(x + s / 2, y + s * 0.42, s * 0.26, Math.PI, 0);
  g.lineTo(x + s * 0.76, y + s * 0.55);
  g.moveTo(x + s * 0.24, y + s * 0.55);
  g.lineTo(x + s * 0.24, y + s * 0.42);
  g.stroke();
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x + s * 0.1, y + s * 0.5, s * 0.8, s * 0.55, s * 0.1);
  g.fill();
  g.stroke();
  g.fillStyle = ink;
  g.beginPath();
  g.arc(x + s / 2, y + s * 0.74, s * 0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawHammer(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.rotate(-0.6);
  g.lineWidth = s * 0.08;
  g.strokeStyle = `#3a281c`;
  g.fillStyle = `#9a6a3f`;
  g.beginPath();
  g.roundRect(-s * 0.07, -s * 0.1, s * 0.14, s * 0.6, s * 0.05);
  g.fill();
  g.stroke();
  g.fillStyle = `#8a96a6`;
  g.beginPath();
  g.roundRect(-s * 0.32, -s * 0.36, s * 0.64, s * 0.26, s * 0.06);
  g.fill();
  g.stroke();
  g.restore();
}

/** The floating marker over a locked or coming-soon site (a padlock or a hammer on a round badge). */
function markerSprite(icon: 'lock' | 'soon', accent: string): THREE.Sprite {
  const c = document.createElement(`canvas`);
  c.width = c.height = 128;
  const g = c.getContext(`2d`)!;
  g.fillStyle = `#fff6e5`;
  g.strokeStyle = `#3a281c`;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = accent;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 42, 0, Math.PI * 2);
  g.stroke();
  if (icon === `lock`) drawLock(g, 36, 30, 56, `#3a281c`, `#ffc23d`);
  else drawHammer(g, 30, 30, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.95);
  s.renderOrder = 7;
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// The open buildings

function refinery(k: Kit): THREE.Vector3[] {
  k.plinth(5, 4.4);
  // the furnace: a stone block with a stepped top and an arched mouth
  k.box(3.2, 2.4, 2.6, -0.4, 0.32, -0.6, M.stone);
  k.box(3.4, 0.3, 2.8, -0.4, 2.72, -0.6, M.stoneDark);
  k.box(2.4, 0.9, 1.8, -0.4, 3.02, -0.6, M.stone);
  for (let i = 0; i < 5; i++) k.box(0.5, 0.22, 0.12, -1.6 + i * 0.6, 0.6 + (i % 2) * 0.9, 0.72, M.stoneDark);
  k.box(1.3, 1.1, 0.2, -0.4, 0.5, 0.62, M.ironDark);
  k.cyl(0.65, 0.65, 0.2, 14, -0.4, 1.6, 0.62, M.ironDark, Math.PI / 2);
  k.box(1.0, 0.85, 0.12, -0.4, 0.6, 0.74, M.fire);
  k.cyl(0.5, 0.5, 0.12, 14, -0.4, 1.45, 0.74, M.fire, Math.PI / 2);
  k.box(1.1, 0.16, 0.5, -0.4, 0.5, 0.95, M.coal);
  for (let i = 0; i < 4; i++) k.ball(0.11, -0.75 + i * 0.22, 0.7, 0.95 + (i % 2) * 0.1, M.ember);
  // the hopper on top and the chimney
  k.add(new THREE.CylinderGeometry(0.9, 0.35, 0.9, 4), M.iron, -0.4, 4.36, -0.6, 0, Math.PI / 4, 0);
  k.box(1.3, 0.12, 1.3, -0.4, 4.78, -0.6, M.ironDark, Math.PI / 4);
  k.box(0.95, 5.6, 0.95, 1.55, 0.32, -1.35, M.brick);
  k.box(1.15, 0.3, 1.15, 1.55, 5.6, -1.35, M.stoneDark);
  for (const y of [1.6, 3.4]) k.box(1.02, 0.12, 1.02, 1.55, y, -1.35, M.stoneDark);
  // the pipe from the furnace to a cooling trough
  k.cyl(0.14, 0.14, 1.4, 8, 1.4, 1.9, 0.0, M.copper, 0, Math.PI / 2);
  k.cyl(0.14, 0.14, 1.0, 8, 2.1, 1.0, 0.0, M.copper);
  k.box(0.8, 0.5, 1.6, 2.1, 0.32, 0.9, M.woodDark);
  k.box(0.66, 0.05, 1.46, 2.1, 0.78, 0.9, M.water);
  // the ore cart on a short track
  for (const x of [-2.3, -1.5]) k.box(0.08, 0.06, 1.8, x, 0.32, 1.25, M.ironDark);
  k.box(0.9, 0.5, 0.75, -1.9, 0.58, 1.3, M.ironDark);
  for (const z of [1.0, 1.6]) for (const x of [-2.32, -1.48]) k.cyl(0.16, 0.16, 0.06, 10, x, 0.52, z, M.iron, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) k.ball(0.17, -2.15 + (i % 3) * 0.24, 1.14 + Math.floor(i / 3) * 0.12, 1.2 + (i % 2) * 0.2, M.copper, 0.8, 0);
  k.solid(3.4, 3.2, 2.8, -0.4, 0, -0.6);
  k.solid(1.0, 5.8, 1.0, 1.55, 0, -1.35);
  k.solid(0.9, 0.9, 1.7, 2.1, 0, 0.9);
  k.solid(1.0, 1.0, 0.9, -1.9, 0, 1.3);
  return [new THREE.Vector3(1.55, 6.1, -1.35)];
}

function forge(k: Kit): THREE.Vector3[] {
  k.plinth(5.4, 4.4);
  // the back wall with the hearth
  k.box(5.0, 2.8, 0.6, 0, 0.32, -1.8, M.stone);
  k.box(2.0, 1.2, 1.2, -0.9, 0.32, -1.2, M.stoneDark);
  k.box(1.5, 0.12, 0.8, -0.9, 1.52, -1.2, M.coal);
  for (let i = 0; i < 6; i++) k.ball(0.14, -1.45 + (i % 3) * 0.5, 1.64, -1.4 + Math.floor(i / 3) * 0.35, M.ember, 0.6, 0);
  k.box(1.2, 0.5, 0.1, -0.9, 1.0, -0.58, M.fire);
  // hood and chimney over the hearth
  k.add(new THREE.CylinderGeometry(0.45, 1.1, 0.9, 4), M.stoneDark, -0.9, 3.0, -1.35, 0, Math.PI / 4, 0);
  k.box(0.7, 2.6, 0.7, -0.9, 3.4, -1.45, M.brick);
  k.box(0.9, 0.24, 0.9, -0.9, 6.0, -1.45, M.stoneDark);
  // the bellows
  k.box(0.7, 0.18, 1.0, 0.55, 1.1, -1.2, M.woodDark, 0, 0.25);
  k.box(0.6, 0.3, 0.9, 0.55, 0.8, -1.2, M.burlap);
  // roof on four posts, open at the front
  for (const x of [-2.4, 2.4]) for (const z of [-1.9, 1.7]) k.post(x, z, 3.3, M.woodDark, 0.15);
  k.box(5.2, 0.2, 0.3, 0, 3.3, 1.7, M.woodDark);
  k.box(5.2, 0.2, 0.3, 0, 3.3, -1.9, M.woodDark);
  k.add(new THREE.BoxGeometry(5.8, 0.22, 4.6), M.roofRed, 0, 3.95, -0.1, -0.22, 0, 0);
  for (let i = 0; i < 6; i++) k.add(new THREE.BoxGeometry(0.12, 0.1, 4.6), M.woodDark, -2.5 + i, 4.1, -0.1, -0.22, 0, 0);
  // anvil on a stump
  k.cyl(0.42, 0.48, 0.6, 9, 0.5, 0.32, 0.6, M.wood);
  k.box(0.5, 0.3, 0.3, 0.5, 0.92, 0.6, M.ironDark);
  k.box(0.9, 0.25, 0.42, 0.5, 1.2, 0.6, M.ironDark);
  k.add(new THREE.ConeGeometry(0.2, 0.5, 4), M.ironDark, 1.12, 1.33, 0.6, 0, 0, -Math.PI / 2);
  k.box(0.12, 0.08, 0.6, 0.35, 1.48, 0.6, M.wood, 0.5);
  k.box(0.22, 0.18, 0.18, 0.35, 1.47, 0.32, M.iron, 0.5);
  // quench barrel and a rack of blades
  k.barrel(-2.0, 0.32, 1.1, 0.4, 0.85, M.water);
  k.box(1.6, 0.12, 0.12, 1.6, 2.1, -1.45, M.woodDark);
  for (let i = 0; i < 4; i++) {
    k.box(0.1, 0.9, 0.04, 1.0 + i * 0.4, 1.15, -1.42, M.iron);
    k.box(0.22, 0.06, 0.06, 1.0 + i * 0.4, 2.05, -1.42, M.gold);
  }
  k.crate(2.0, 0.32, 1.2, 0.6, 0.4);
  k.solid(5.0, 2.8, 0.8, 0, 0, -1.8);
  k.solid(2.0, 1.4, 1.2, -0.9, 0, -1.2);
  k.solid(0.9, 1.2, 0.9, 0.5, 0, 0.6);
  k.solid(0.9, 1.0, 0.9, -2.0, 0, 1.1);
  for (const x of [-2.4, 2.4]) k.solid(0.35, 3.3, 0.35, x, 0, 1.7);
  return [new THREE.Vector3(-0.9, 6.3, -1.45)];
}

function board(k: Kit): THREE.Vector3[] {
  k.plinth(3.8, 1.4, 0.2);
  for (const x of [-1.6, 1.6]) k.post(x, 0, 3.0, M.woodDark, 0.14);
  k.box(3.3, 1.8, 0.16, 0, 0.9, 0, M.wood);
  k.box(3.5, 0.14, 0.24, 0, 2.7, 0, M.woodDark);
  k.box(3.5, 0.14, 0.24, 0, 0.8, 0, M.woodDark);
  k.add(new THREE.BoxGeometry(4.0, 0.14, 0.9), M.roofRed, 0, 3.2, 0.2, -0.4, 0, 0);
  k.add(new THREE.BoxGeometry(4.0, 0.14, 0.9), M.roofRed, 0, 3.2, -0.25, 0.4, 0, 0);
  const notes: [number, number, number, Mat][] = [
    [-1.15, 1.86, 0.08, M.paper],
    [-0.4, 1.8, -0.05, M.cream],
    [0.4, 1.88, 0.06, M.paper],
    [1.15, 1.78, -0.1, M.paper],
    [-0.8, 1.25, -0.04, M.cream],
    [0.15, 1.22, 0.1, M.paper],
    [0.95, 1.27, 0.03, M.cream],
  ];
  for (const [x, y, r, m] of notes) {
    k.add(new THREE.BoxGeometry(0.5, 0.55, 0.03), m, x, y, 0.1, 0, 0, r);
    k.add(new THREE.BoxGeometry(0.08, 0.08, 0.03), M.red, x, y + 0.2, 0.12, 0, 0, 0);
  }
  // lantern on a bracket
  k.box(0.5, 0.06, 0.06, 1.85, 2.5, 0.0, M.ironDark);
  k.box(0.22, 0.3, 0.22, 2.05, 2.1, 0.0, M.lamp);
  k.box(0.28, 0.06, 0.28, 2.05, 2.4, 0.0, M.ironDark);
  k.solid(3.6, 3.0, 0.5, 0, 0, 0);
  return [];
}

function capsuleMachine(k: Kit, x = 0, z = 0): void {
  k.box(1.3, 0.25, 1.1, x, 0.32, z, M.ironDark);
  k.box(1.2, 1.15, 1.0, x, 0.57, z, M.red);
  k.box(1.24, 0.1, 1.04, x, 1.68, z, M.cream);
  k.cyl(0.24, 0.24, 0.1, 16, x - 0.18, 1.1, z + 0.5, M.cream, Math.PI / 2);
  k.box(0.32, 0.06, 0.06, x - 0.18, 1.1, z + 0.56, M.red);
  k.box(0.2, 0.32, 0.06, x + 0.32, 1.05, z + 0.5, M.ironDark);
  k.box(0.08, 0.2, 0.04, x + 0.32, 1.1, z + 0.54, M.gold);
  k.box(0.5, 0.32, 0.14, x - 0.05, 0.67, z + 0.48, M.coal);
  k.cyl(0.18, 0.18, 0.06, 12, x + 0.42, 1.4, z + 0.5, M.gold, Math.PI / 2);
  // capsules inside the dome (the dome itself is a separate glass mesh)
  const balls = [M.ballA, M.ballB, M.ballC, M.ballD];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    const r = 0.18 + (i % 3) * 0.12;
    k.ball(0.14, x + Math.cos(a) * r, 1.95 + Math.floor(i / 5) * 0.2, z + Math.sin(a) * r, balls[i % 4], 1, 1);
  }
  k.cyl(0.08, 0.12, 0.25, 8, x, 2.6, z, M.red);
  k.ball(0.13, x, 2.92, z, M.lamp);
}

// ---------------------------------------------------------------------------------------------------------
// Locked plots: only the spot (a roped-off patch of soil and the name sign); nothing of the building shows

function plot(k: Kit, s: SiteDef): void {
  const hw = s.w / 2 - 0.2;
  const hd = s.d / 2 - 0.2;
  k.box(s.w - 0.3, 0.08, s.d - 0.3, 0, 0.42, 0, M.soilDark);
  const stakes: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  for (const [x, z] of stakes) {
    k.cyl(0.07, 0.09, 0.9, 6, x, 0.3, z, M.woodLight);
    k.add(new THREE.ConeGeometry(0.09, 0.16, 6), M.woodLight, x, 1.28, z);
  }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = stakes[i];
    const [bx, bz] = stakes[(i + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    k.add(new THREE.CylinderGeometry(0.025, 0.025, len, 4), M.rope, (ax + bx) / 2, 1.0, (az + bz) / 2, Math.PI / 2, Math.atan2(bx - ax, bz - az), 0);
    // little warning flags
    for (let f = 1; f < 3; f++) {
      const t = f / 3;
      k.add(new THREE.ConeGeometry(0.09, 0.2, 3), f % 2 ? M.canvasOrange : M.cream, ax + (bx - ax) * t, 0.9, az + (bz - az) * t, Math.PI, 0, 0);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------

/** Where a site's name sign goes (centre y), and how it is held up. */
function signPlace(s: SiteDef): { x: number; y: number; z: number; w: number; mode: 'post' | 'hang' | 'flat'; top: number } {
  if (s.id === `forge`) return { x: 0, y: 2.75, z: 1.82, w: 2.4, mode: `hang`, top: 3.3 };
  if (s.id === `board`) return { x: 0, y: 2.45, z: 0.14, w: 1.6, mode: `flat`, top: 0 };
  if (s.id === `refinery`) return { x: 1.7, y: 1.35, z: 2.05, w: 1.9, mode: `post`, top: 0 };
  return { x: -s.w / 2 + 0.8, y: 1.35, z: s.d / 2 - 0.05, w: 1.9, mode: `post`, top: 0 };
}

/** One site on the island: its meshes, collider parts, sign and marker. */
export class SiteView {
  readonly group = new THREE.Group();
  readonly def: SiteDef;
  /** Island-local smoke anchors (chimney tops). */
  readonly smoke: THREE.Vector3[] = [];
  readonly cols: THREE.BufferGeometry[] = [];
  private openPart: THREE.Object3D | null = null;
  /** Island-local circle that pushes the player out (the Capsule Machine once it stands), or null. */
  blocker: { x: number; z: number; r: number } | null = null;
  private sign!: SignBoard;
  private marker: THREE.Sprite | null = null;
  private markerIcon: 'lock' | 'soon' | null = null;
  private status: SiteStatus | null = null;
  private t = Math.random() * 6;

  constructor(def: SiteDef, groundY: number, material: Mat) {
    this.def = def;
    const p = sitePlace(def);
    this.group.position.set(p.x, groundY - 0.05, p.z);
    this.group.rotation.y = p.yaw;
    this.group.scale.setScalar(def.scale ?? 1);
    this.group.name = `site:${def.id}`;
    this.group.updateMatrix();

    const base = new Kit();
    let smoke: THREE.Vector3[] = [];
    if (def.id === `refinery`) smoke = refinery(base);
    else if (def.id === `forge`) smoke = forge(base);
    else if (def.id === `board`) smoke = board(base);
    else plot(base, def);
    this.group.add(this.bake(base, material));
    for (const v of smoke) this.smoke.push(v.clone().applyMatrix4(this.group.matrix));

    // the Capsule Machine stands on its plot only once it is open (until then the plot is bare)
    if (def.unlock) {
      if (def.id === `capsule`) {
        const m = new Kit();
        capsuleMachine(m);
        const machine = new THREE.Group();
        machine.add(this.bake(m, material));
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.62, 20, 14),
          new THREE.MeshPhysicalMaterial({ color: 0xdff6ff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.32, depthWrite: false }),
        );
        dome.position.set(0, 2.08, 0);
        dome.renderOrder = 5;
        machine.add(dome);
        machine.visible = false;
        this.openPart = machine;
        this.group.add(machine);
      }
    }

    // the sign: hanging from the front beam (stall, forge), over the notes (board), or on a post (the rest)
    const at = signPlace(def);
    const signH = at.w * 0.34;
    this.sign = new SignBoard(at.w, signH);
    const sk = new Kit();
    if (at.mode === `post`) sk.post(at.x, at.z - 0.08, at.y + signH / 2 + 0.12, M.woodDark, 0.08);
    if (at.mode === `hang`)
      for (const s of [-1, 1]) sk.box(0.04, at.top - (at.y + signH / 2), 0.04, at.x + s * at.w * 0.38, at.y + signH / 2, at.z - 0.06, M.rope);
    sk.box(at.w + 0.16, signH + 0.16, 0.1, at.x, at.y - signH / 2 - 0.08, at.z - 0.06, M.woodDark);
    this.group.add(this.bake(sk, material));
    this.sign.mesh.position.set(at.x, at.y, at.z + 0.005);
    this.group.add(this.sign.mesh);

    for (const g of base.cols) this.cols.push(g.applyMatrix4(this.group.matrix));
  }

  private bake(k: Kit, material: Mat): THREE.Mesh {
    const mesh = new THREE.Mesh(mergeHub(k.parts), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.enable(CAPTURE_LAYER_HUB_DRESSING);
    for (const g of k.parts) g.dispose();
    return mesh;
  }

  /** Shows the state of the site (sign text, the machine when open, the floating marker). */
  setStatus(status: SiteStatus): void {
    if (status === this.status) return;
    this.status = status;
    const d = this.def;
    if (!d.unlock) this.sign.setText(d.name, ``, d.color);
    else if (status === `locked`) this.sign.setText(d.name, `Locked`, d.color, `lock`);
    else if (status === `soon`) this.sign.setText(d.name, `Opening soon`, d.color, `soon`);
    else this.sign.setText(d.name, `Open`, d.color);
    const machineUp = status === `open` && !!this.openPart;
    if (this.openPart) this.openPart.visible = machineUp;
    this.blocker = machineUp ? { x: this.group.position.x, z: this.group.position.z, r: 0.95 } : null;
    const icon = status === `locked` ? `lock` : status === `soon` ? `soon` : null;
    if (icon !== this.markerIcon) {
      this.markerIcon = icon;
      if (this.marker) {
        this.group.remove(this.marker);
        this.marker.material.map?.dispose();
        this.marker.material.dispose();
        this.marker = null;
      }
      if (icon) {
        this.marker = markerSprite(icon, d.color);
        this.marker.position.set(0, 3.6, 0);
        this.group.add(this.marker);
      }
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.marker) this.marker.position.y = 3.6 + Math.sin(this.t * 1.8) * 0.15;
  }
}

/** One stylized per-vertex material for every site (the same look as the hub surfaces). */
export function siteMaterial(): Mat {
  const m = new THREE.MeshStandardMaterial();
  stylizePerVertex(m);
  return m;
}
