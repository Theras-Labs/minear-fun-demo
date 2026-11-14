// Port of play-inUT-NSi.js lines 36991-37351 and 37559-37565: the shared leaf texture, the foliage card
// cloud builder, the tube trunk builder, the seeded vegetation recipes (oak, giant oak, giant pine, pine,
// bush / blossom bush, rock) and the biome field. The recipes are deterministic from integer seeds, so the
// far impostor bake (farForest.ts) and the near decor (decor.ts) build the same trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from '../world/rng';

/** One sphere of a crown: centre, radius and base colour. */
export interface FoliageBlob {
  c: THREE.Vector3;
  r: number;
  col: THREE.Color;
}

/** What a recipe returns: an optional trunk (or rock) geometry, the leaf card crown and a footprint radius. */
export interface VegetationRecipe {
  trunk: THREE.BufferGeometry | null;
  crown: THREE.BufferGeometry;
  radius: number;
}

let leafTextureCache: THREE.CanvasTexture | null = null; // Bb (36991)

/** The 256x256 grey leaf-cluster texture shared by every leaf card (painted once, then cached). */
export function leafTexture(): THREE.CanvasTexture { // Vb (36992)
  if (leafTextureCache) return leafTextureCache;
  const canvas = document.createElement(`canvas`);
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext(`2d`)!;
  const rand = seededRandom(77);
  const leaf = (x: number, y: number, angle: number, length: number, halfWidth: number, tone: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, -halfWidth, 0, halfWidth);
    const c = Math.round(200 + tone * 55);
    const l = Math.round(160 + tone * 60);
    grad.addColorStop(0, `rgb(${l},${l},${l})`);
    grad.addColorStop(0.5, `rgb(${c},${c},${c})`);
    grad.addColorStop(1, `rgb(${l - 20},${l - 20},${l - 20})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(length * 0.45, -halfWidth, length, 0);
    ctx.quadraticCurveTo(length * 0.45, halfWidth, 0, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,0.35)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(length * 0.08, 0);
    ctx.lineTo(length * 0.85, 0);
    ctx.stroke();
    ctx.restore();
  };
  for (let k = 0; k < 26; k++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 256 * 0.2;
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d;
    // (argument order is the order of the random calls)
    leaf(x, y, Math.atan2(y - 128, x - 128) + (rand() - 0.5) * 1.3, 256 * (0.2 + rand() * 0.1), 256 * (0.06 + rand() * 0.03), rand());
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  leafTextureCache = tex;
  return tex;
}

const tmpV = new THREE.Vector3(); // Hb (37044)
const tmpQ = new THREE.Quaternion(); // Ub (37045)
const tmpE = new THREE.Euler(); // Wb (37046)

const CARD_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];
const CARD_UVS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * Scatters `count` leaf cards over the blobs (blob picked with weight r^2). Attributes: position, normal
 * (spherical, for soft light), uv, color, aSway (height weight, phase) and aLeaf (shade, height fraction,
 * kind: 0 broadleaf, 1 pine, 2 bush, 3 blossom). tilt > 0 hangs the cards down (conifers).
 */
export function foliageCards( // Gb (37047)
  blobs: FoliageBlob[],
  count: number,
  size: readonly [number, number],
  seed: number,
  tilt = 0,
  leafKind = 0,
  innerFrac = 0,
): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const centroid = new THREE.Vector3();
  let wsum = 0;
  for (const b of blobs) {
    centroid.addScaledVector(b.c, b.r);
    wsum += b.r;
  }
  centroid.multiplyScalar(1 / wsum);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    minY = Math.min(minY, b.c.y - b.r);
    maxY = Math.max(maxY, b.c.y + b.r);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const leafAttr: number[] = [];
  const index: number[] = [];
  const weights = blobs.map((b) => b.r * b.r);
  const wtotal = weights.reduce((a, w) => a + w, 0);
  for (let n = 0; n < count; n++) {
    let pick = rand() * wtotal;
    let bi = 0;
    for (; bi < blobs.length - 1 && pick > weights[bi]; ) pick -= weights[bi++];
    const blob = blobs[bi];
    const cy = rand() * 2 - 1;
    const az = rand() * Math.PI * 2;
    const ring = Math.sqrt(1 - cy * cy);
    const dir = new THREE.Vector3(ring * Math.cos(az), cy, ring * Math.sin(az));
    if (dir.y < -0.35) dir.y *= 0.5;
    dir.normalize();
    const inner = innerFrac > 0 && rand() < innerFrac;
    const at = blob.c.clone().addScaledVector(dir, blob.r * (inner ? 0.3 + rand() * 0.4 : 0.72 + rand() * 0.3));
    const cardSize = size[0] + rand() * (size[1] - size[0]);
    tmpE.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
    tmpQ.setFromEuler(tmpE);
    if (tilt > 0) {
      const hang = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2 + (rand() - 0.5) * tilt, Math.atan2(dir.x, dir.z), 0, `YXZ`),
      );
      tmpQ.slerp(hang, 0.7);
    }
    const out = at.clone().sub(centroid).normalize();
    const normal = dir.clone().multiplyScalar(0.45).addScaledVector(out, 0.75).normalize();
    const heightFrac = (at.y - minY) / Math.max(0.01, maxY - minY);
    const radialFrac = at.distanceTo(blob.c) / blob.r;
    const shade = THREE.MathUtils.clamp(0.55 + heightFrac * 0.35 + (radialFrac - 0.75) * 0.8, 0.45, 1.08);
    const c = blob.col.clone().multiplyScalar(shade * (0.92 + rand() * 0.16));
    const base = pos.length / 3;
    const phase = rand() * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      tmpV.set(CARD_CORNERS[k][0] * cardSize, CARD_CORNERS[k][1] * cardSize, 0).applyQuaternion(tmpQ).add(at);
      pos.push(tmpV.x, tmpV.y, tmpV.z);
      nor.push(normal.x, normal.y, normal.z);
      uv.push(CARD_UVS[k][0], CARD_UVS[k][1]);
      col.push(c.r, c.g, c.b);
      sway.push(THREE.MathUtils.clamp((tmpV.y - minY * 0.6) / (maxY || 1), 0, 1.4), phase);
      leafAttr.push(shade, heightFrac, leafKind);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute(`position`, new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(`normal`, new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute(`uv`, new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute(`color`, new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute(`aSway`, new THREE.Float32BufferAttribute(sway, 2));
  g.setAttribute(`aLeaf`, new THREE.Float32BufferAttribute(leafAttr, 3));
  g.setIndex(index);
  return g;
}

export interface TrunkOptions {
  color?: number;
  sides?: number;
  roots?: number;
  fork?: readonly [number, number];
}

/**
 * A tree trunk: a tube along a slightly leaning curve, bezier branches toward the crown points, optional
 * splayed roots, merged, with a vertical brightness gradient baked into the vertex colours (no uv).
 */
export function trunkGeometry( // Kb (37131)
  height: number,
  baseR: number,
  topR: number,
  seed: number,
  branchTargets: THREE.Vector3[] = [],
  options: TrunkOptions = {},
): THREE.BufferGeometry {
  const { color = 8016435, sides = 8, roots = 0, fork = [0.55, 0.85] } = options;
  const rand = seededRandom(seed);
  const parts: THREE.BufferGeometry[] = [];
  const lean = new THREE.Vector3((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5);
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.3, 0),
    new THREE.Vector3(lean.x * 0.3, height * 0.35, lean.z * 0.3),
    new THREE.Vector3(lean.x, height * 0.75, lean.z),
    new THREE.Vector3(lean.x * 0.8, height, lean.z * 0.8),
  ]);
  const tube = (curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segments: number) => {
    const g = new THREE.TubeGeometry(curve, segments, 1, sides, false);
    const position = g.getAttribute(`position`) as THREE.BufferAttribute;
    const normal = g.getAttribute(`normal`) as THREE.BufferAttribute;
    const ring = sides + 1;
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const radius = THREE.MathUtils.lerp(r0, r1, s) * (i === 0 ? 1.25 : 1);
      const p = curve.getPointAt(s);
      for (let k = 0; k < ring; k++) {
        const t = i * ring + k;
        position.setXYZ(t, p.x + normal.getX(t) * radius, p.y + normal.getY(t) * radius, p.z + normal.getZ(t) * radius);
      }
    }
    g.deleteAttribute(`uv`);
    return g;
  };
  parts.push(tube(spine, baseR, topR, 8));
  for (const target of branchTargets) {
    const from = spine.getPointAt(fork[0] + rand() * (fork[1] - fork[0]));
    const mid = from.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.25, 0));
    parts.push(tube(new THREE.QuadraticBezierCurve3(from, mid, target), topR * 0.9, topR * 0.35, 5));
  }
  for (let n = 0; n < roots; n++) {
    const a = (n / roots) * Math.PI * 2 + rand() * 0.7;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const reach = baseR * (1.9 + rand() * 0.8);
    const start = new THREE.Vector3(ca * baseR * 0.3, height * 0.12 + rand() * 0.5, sa * baseR * 0.3);
    const mid = new THREE.Vector3(ca * baseR * 1.05, 0.3, sa * baseR * 1.05);
    parts.push(tube(new THREE.QuadraticBezierCurve3(start, mid, new THREE.Vector3(ca * reach, -0.4, sa * reach)), baseR * 0.5, baseR * 0.12, 5));
  }
  const merged = mergeGeometries(parts);
  const base = new THREE.Color(color);
  const position = merged.getAttribute(`position`);
  const colors = new Float32Array(position.count * 3);
  for (let t = 0; t < position.count; t++) {
    const k = 0.75 + Math.min(1, position.getY(t) / height) * 0.3 + Math.sin(t * 12.9898) * 0.04;
    colors[t * 3] = base.r * k;
    colors[t * 3 + 1] = base.g * k;
    colors[t * 3 + 2] = base.b * k;
  }
  merged.setAttribute(`color`, new THREE.BufferAttribute(colors, 3));
  return merged;
}

export const hexColor = (hex: number): THREE.Color => new THREE.Color(hex); // qb (37186)

/** Broadleaf oak (tall = taller trunk, six sub-blobs and a top blob). */
export function oakRecipe(seed: number, tall = false): VegetationRecipe { // Jb (37187)
  const rand = seededRandom(seed * 31 + 7);
  const trunkH = tall ? 3.6 + rand() * 0.8 : 2.4 + rand() * 0.6;
  const cr = tall ? 1.55 : 1.85;
  const palette = [hexColor(6268988), hexColor(7124292), hexColor(5216826), hexColor(7912778)];
  const blobs: FoliageBlob[] = [{ c: new THREE.Vector3(0, trunkH + cr * 0.55, 0), r: cr, col: palette[0] }];
  const subs = tall ? 6 : 5;
  const branches: THREE.Vector3[] = [];
  for (let e = 0; e < subs; e++) {
    const a = (e / subs) * Math.PI * 2 + rand() * 0.8;
    const r = cr * (0.55 + rand() * 0.25);
    const y = trunkH + cr * (tall ? (e % 2 ? 1.1 : 0.2) : 0.15 + rand() * 0.6);
    const c = new THREE.Vector3(Math.cos(a) * cr * 0.8, y, Math.sin(a) * cr * 0.8);
    blobs.push({ c, r, col: palette[(e + 1) % palette.length] });
    if (e % 2 === 0) branches.push(c.clone().multiplyScalar(0.7).setY(y - r * 0.2));
  }
  if (tall) blobs.push({ c: new THREE.Vector3(0, trunkH + cr * 1.7, 0), r: cr * 0.75, col: palette[3] });
  const crown = foliageCards(blobs, tall ? 300 : 280, [0.95, 1.45], seed);
  return { trunk: trunkGeometry(trunkH + cr * 0.5, 0.28, 0.14, seed, branches), crown, radius: cr * 1.3 };
}

/** Giant broadleaf: 12-14 tall trunk with roots, 1150 cards, crown squashed about the trunk top. */
export function giantOakRecipe(seed: number): VegetationRecipe { // Yb (37213)
  const rand = seededRandom(seed * 43 + 11);
  const trunkH = 12 + rand() * 2;
  const cr = 5.4;
  const palette = [hexColor(6268988), hexColor(7124292), hexColor(5216826), hexColor(7912778)];
  const blobs: FoliageBlob[] = [{ c: new THREE.Vector3(0, trunkH + cr * 0.5, 0), r: cr, col: palette[0] }];
  const branches: THREE.Vector3[] = [];
  for (let e = 0; e < 8; e++) {
    const a = (e / 8) * Math.PI * 2 + rand() * 0.5;
    const r = cr * (0.5 + rand() * 0.25);
    const y = trunkH + cr * (-0.1 + rand() * 0.6);
    const d = cr * (0.8 + rand() * 0.35);
    const c = new THREE.Vector3(Math.cos(a) * d, y, Math.sin(a) * d);
    blobs.push({ c, r, col: palette[(e + 1) % palette.length] });
    branches.push(c.clone().multiplyScalar(0.75).setY(y - r * 0.35));
  }
  blobs.push({ c: new THREE.Vector3(0, trunkH + cr * 1.3, 0), r: cr * 0.7, col: palette[3] });
  const crown = foliageCards(blobs, 1150, [1.9, 2.8], seed, 0, 0, 0.12);
  const position = crown.getAttribute(`position`);
  for (let e = 0; e < position.count; e++) position.setY(e, trunkH + (position.getY(e) - trunkH) * 0.85);
  return {
    trunk: trunkGeometry(trunkH + cr * 0.35, 1.3, 0.6, seed, branches, { sides: 12, roots: 6, fork: [0.5, 0.75] }),
    crown,
    radius: cr * 1.3,
  };
}

/** Giant pine: 21-24 tall, 8 stacked tapering blobs, 1150 hanging cards. */
export function giantPineRecipe(seed: number): VegetationRecipe { // Xb (37244)
  const height = 21 + seededRandom(seed * 29 + 13)() * 3;
  const palette = [hexColor(3111509), hexColor(3836510), hexColor(4494698)];
  const blobs: FoliageBlob[] = [];
  for (let e = 0; e < 8; e++) {
    const f = e / 7;
    const r = THREE.MathUtils.lerp(3.9, 0.9, f);
    blobs.push({ c: new THREE.Vector3(0, 6 + f * (height - 6.5), 0), r, col: palette[e % 3] });
  }
  const crown = foliageCards(blobs, 1150, [1.5, 2.2], seed, 0.9, 1, 0.3);
  const position = crown.getAttribute(`position`);
  for (let e = 0; e < position.count; e++) {
    const y = position.getY(e);
    const taper = 1 - Math.max(0, Math.min(1, (y - 5) / height)) * 0.55;
    position.setXYZ(e, position.getX(e) * taper, y, position.getZ(e) * taper);
  }
  return {
    trunk: trunkGeometry(height * 0.8, 1.05, 0.12, seed, [], { color: 7031347, sides: 12, roots: 5 }),
    crown,
    radius: 4,
  };
}

/** Pine: 5.2-6.6 tall, 5 stacked tapering blobs. */
export function pineRecipe(seed: number): VegetationRecipe { // Zb (37266)
  const height = 5.2 + seededRandom(seed * 17 + 3)() * 1.4;
  const palette = [hexColor(3111509), hexColor(3836510), hexColor(4494698)];
  const blobs: FoliageBlob[] = [];
  for (let e = 0; e < 5; e++) {
    const f = e / 4;
    const r = THREE.MathUtils.lerp(1.45, 0.45, f);
    blobs.push({ c: new THREE.Vector3(0, 1.3 + f * (height - 1.6), 0), r, col: palette[e % 3] });
  }
  const crown = foliageCards(blobs, 230, [0.8, 1.2], seed, 0.9, 1);
  const position = crown.getAttribute(`position`);
  for (let e = 0; e < position.count; e++) {
    const y = position.getY(e);
    const taper = 1 - Math.max(0, Math.min(1, (y - 1) / height)) * 0.55;
    position.setXYZ(e, position.getX(e) * taper, y, position.getZ(e) * taper);
  }
  return { trunk: trunkGeometry(height * 0.9, 0.22, 0.08, seed, [], { color: 7031347 }), crown, radius: 1.6 };
}

/** Bush (no trunk). The blossom variant tints some top cards pink / white / yellow (aLeaf.z = 3). */
export function bushRecipe(seed: number, blossom = false): VegetationRecipe { // Qb (37284)
  const rand = seededRandom(seed * 13 + 5);
  const palette = blossom ? [hexColor(5940798), hexColor(6861383)] : [hexColor(5217852), hexColor(6072898), hexColor(6992968)];
  const blobs: FoliageBlob[] = [];
  const n = 3 + Math.floor(rand() * 2);
  for (let e = 0; e < n; e++) {
    const a = rand() * Math.PI * 2;
    const r = 0.55 + rand() * 0.35;
    blobs.push({ c: new THREE.Vector3(Math.cos(a) * 0.45, r * 0.7, Math.sin(a) * 0.45), r, col: palette[e % palette.length] });
  }
  const crown = foliageCards(blobs, 70, [0.6, 0.85], seed, 0, 2);
  if (blossom) {
    const color = crown.getAttribute(`color`);
    const position = crown.getAttribute(`position`);
    const leaf = crown.getAttribute(`aLeaf`);
    const tint = [hexColor(16757711), hexColor(16773878), hexColor(16765803)][seed % 3];
    for (let e = 0; e < color.count; e += 4)
      if (position.getY(e) > 0.7 && rand() < 0.3)
        for (let k = 0; k < 4; k++) {
          color.setXYZ(e + k, tint.r, tint.g, tint.b);
          leaf.setZ(e + k, 3);
        }
  }
  return { trunk: null, crown, radius: 1 };
}

/** A faceted rock: icosahedron (detail 3) cut by planes, grey to darker below, moss on top; aRock = 1. */
export function rockGeometry(seed: number, scale = 1): THREE.BufferGeometry { // $b (37310)
  const rand = seededRandom(seed * 7 + 1);
  const g = new THREE.IcosahedronGeometry(1, 3);
  const position = g.getAttribute(`position`);
  const cuts = Array.from({ length: 5 }, () => ({
    n: new THREE.Vector3(rand() - 0.5, rand() * 0.8 - 0.1, rand() - 0.5).normalize(),
    d: 0.72 + rand() * 0.18,
  }));
  cuts.push({ n: new THREE.Vector3(0, 1, 0), d: 0.55 + rand() * 0.15 });
  const phase = rand() * 10;
  for (let e = 0; e < position.count; e++) {
    tmpV.set(position.getX(e), position.getY(e), position.getZ(e));
    const wobble = 1 + Math.sin(tmpV.x * 3.1 + phase) * 0.05 + Math.cos(tmpV.z * 2.7 + phase) * 0.05;
    tmpV.multiplyScalar(wobble);
    for (const cut of cuts) {
      const t = tmpV.dot(cut.n);
      if (t > cut.d) tmpV.addScaledVector(cut.n, -(t - cut.d) * 0.85);
    }
    position.setXYZ(e, tmpV.x * 1.25 * scale, Math.max(-0.35, tmpV.y) * 0.8 * scale, tmpV.z * 1.05 * scale);
  }
  g.computeVertexNormals();
  const normal = g.getAttribute(`normal`);
  const colors = new Float32Array(position.count * 3);
  const top = hexColor(10134453);
  const low = hexColor(8160410);
  const moss = hexColor(6989892);
  for (let e = 0; e < position.count; e++) {
    const up = normal.getY(e);
    const c = top.clone().lerp(low, THREE.MathUtils.clamp(0.4 - position.getY(e) / scale, 0, 1));
    c.lerp(moss, THREE.MathUtils.smoothstep(up, 0.62, 0.85));
    colors[e * 3] = c.r;
    colors[e * 3 + 1] = c.g;
    colors[e * 3 + 2] = c.b;
  }
  g.setAttribute(`color`, new THREE.BufferAttribute(colors, 3));
  g.setAttribute(`aRock`, new THREE.Float32BufferAttribute(new Float32Array(position.count).fill(1), 1));
  g.deleteAttribute(`uv`);
  g.translate(0, 0.12 * scale, 0);
  return g;
}

/** Is (x, z) forest, and is the forest there pine? Shared by the far impostors and the near decor. */
export function forestAt(x: number, z: number): { forest: boolean; pine: boolean } { // ox (37560)
  return {
    forest: Math.sin(x * 0.021 + 1.3) + Math.cos(z * 0.017 - 0.4) + Math.sin((x + z) * 0.011) > 1,
    pine: Math.sin(x * 0.009 - z * 0.012) > 0.35,
  };
}
