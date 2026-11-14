// Port of play-inUT-NSi.js lines 49298-49424: floating island generators. islandUnderside (OO) builds the rocky
// underside as a displaced lathe, islandCap (kO) builds the flat grass top with a dirt skirt, and
// islandRockMaterial (jO) is the shared rock material of every island.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex } from '../world/simplex';
import { stylizeMaterial } from '../miner/stylize';

/** Underside profile [r, y] from the tip (0.001, -1) to the rim (1, 0), in units of radius and depth. */
export const ISLAND_PROFILE: ReadonlyArray<readonly [number, number]> = [ // DO (49298)
  [0.001, -1],
  [0.12, -0.857],
  [0.24, -0.714],
  [0.387, -0.571],
  [0.573, -0.429],
  [0.747, -0.286],
  [0.893, -0.162],
  [0.987, -0.057],
  [1, 0],
];

export interface IslandUnderside {
  /** Merged, vertex-coloured underside (position, normal, color). */
  geometry: THREE.BufferGeometry;
  /** The displaced lathe before the merge, position only. */
  collider: THREE.BufferGeometry;
}

/** Rocky island underside: radius, depth, noise seed, lathe segments. */
export function islandUnderside(radius: number, depth: number, seed: number, segments = 56): IslandUnderside { // OO (49309)
  const noise = new Simplex(seed);
  const a = 15 / radius;
  const lathe = new THREE.LatheGeometry(
    new THREE.CatmullRomCurve3(ISLAND_PROFILE.map(([r, y]) => new THREE.Vector3(r * radius, y * depth, 0)))
      .getPoints(Math.max(10, Math.round(28 * Math.min(1, radius / 10))))
      .map((p) => new THREE.Vector2(Math.max(0.01, p.x), p.y)),
    segments,
  );
  const pos = lathe.getAttribute(`position`);
  for (let e = 0; e < pos.count; e++) {
    const x = pos.getX(e);
    const y = pos.getY(e);
    const z = pos.getZ(e);
    if (y > -0.5 / a) continue;
    const ang = Math.atan2(z, x);
    const ridge = Math.abs(Math.sin(ang * 9 + noise.noise2(ang * 2, y * 0.05 * a) * 2)) * 0.08;
    const k =
      1 +
      (noise.noise3(x * 0.12 * a, y * 0.16 * a, z * 0.12 * a) * 0.16 +
        noise.noise3(x * 0.35 * a, y * 0.3 * a, z * 0.35 * a) * 0.05) -
      ridge;
    pos.setXYZ(e, x * k, y + (noise.noise3(x * 0.3 * a, 5, z * 0.3 * a) * 0.7) / a, z * k);
  }
  const geometry = mergeVertices(lathe.clone().deleteAttribute(`normal`).deleteAttribute(`uv`), 5e-4);
  geometry.computeVertexNormals();
  const gp = geometry.getAttribute(`position`);
  const colors = new Float32Array(gp.count * 3);
  const col = new THREE.Color();
  const soil = new THREE.Color(8018490);
  const sandA = new THREE.Color(14460010);
  const sandB = new THREE.Color(13208664);
  const deepA = new THREE.Color(10134456);
  const deepB = new THREE.Color(7568531);
  for (let e = 0; e < gp.count; e++) {
    const x = gp.getX(e);
    const y = gp.getY(e);
    const z = gp.getZ(e);
    const o = (y + (noise.noise3(x * 0.2 * a, y * 0.1 * a, z * 0.2 * a) * 1.2) / a) * a;
    if (o > -1.6) col.copy(soil);
    else if (o > -9)
      col
        .copy(sandA)
        .lerp(sandB, 0.5 + 0.5 * Math.sin(o * 2.2))
        .lerp(soil, THREE.MathUtils.smoothstep(o, -2.6, -1.6) * 0.6);
    else col.copy(deepA).lerp(deepB, THREE.MathUtils.smoothstep(-o, 10, 19));
    col.multiplyScalar(0.9 + noise.noise3(x * 0.7 * a, y * 0.7 * a, z * 0.7 * a) * 0.12);
    colors[e * 3] = col.r;
    colors[e * 3 + 1] = col.g;
    colors[e * 3 + 2] = col.b;
  }
  geometry.setAttribute(`color`, new THREE.BufferAttribute(colors, 3));
  const collider = lathe.clone();
  for (const name of Object.keys(collider.attributes)) if (name !== `position`) collider.deleteAttribute(name);
  return { geometry, collider };
}

/** Grass top cap: radius, top height, noise seed, dome height. 8 rings plus a two-row dirt skirt. */
export function islandCap(radius: number, y: number, seed: number, dome = 0): THREE.BufferGeometry { // kO (49366)
  const noise = new Simplex(seed + 7);
  const seg = Math.max(24, Math.round(radius * 3));
  const pos: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const grass = new THREE.Color(5212724);
  const skirtTop = new THREE.Color(7305788);
  const skirtBottom = new THREE.Color(6967860);
  const edge = (t: number) => radius * (1 + noise.noise2(Math.cos(t) * 1.3, Math.sin(t) * 1.3) * 0.05) + 0.4;
  pos.push(0, y + dome, 0);
  colors.push(grass.r, grass.g, grass.b);
  for (let ring = 1; ring <= 8; ring++) {
    const n = ring / 8;
    for (let e = 0; e < seg; e++) {
      const ang = (e / seg) * Math.PI * 2;
      const r = edge(ang) * n;
      pos.push(Math.cos(ang) * r, y + dome * (1 - n * n), Math.sin(ang) * r);
      colors.push(grass.r, grass.g, grass.b);
    }
  }
  for (let e = 0; e < seg; e++) index.push(0, 1 + ((e + 1) % seg), 1 + e);
  for (let ring = 1; ring < 8; ring++)
    for (let t = 0; t < seg; t++) {
      const a0 = 1 + (ring - 1) * seg + t;
      const a1 = 1 + (ring - 1) * seg + ((t + 1) % seg);
      const b0 = 1 + ring * seg + t;
      const b1 = 1 + ring * seg + ((t + 1) % seg);
      index.push(a0, a1, b1, a0, b1, b0);
    }
  const rim = 1 + 7 * seg;
  const skirt = pos.length / 3;
  for (let e = 0; e < seg; e++) {
    const ang = (e / seg) * Math.PI * 2;
    const r = edge(ang);
    pos.push(Math.cos(ang) * (r + 0.12), y - 0.35, Math.sin(ang) * (r + 0.12));
    colors.push(skirtTop.r, skirtTop.g, skirtTop.b);
    pos.push(Math.cos(ang) * (r - 0.25), y - 1.3, Math.sin(ang) * (r - 0.25));
    colors.push(skirtBottom.r, skirtBottom.g, skirtBottom.b);
  }
  for (let e = 0; e < seg; e++) {
    const t = (e + 1) % seg;
    const r0 = rim + e;
    const r1 = rim + t;
    const s0 = skirt + e * 2;
    const s1 = skirt + t * 2;
    index.push(r0, r1, s1, r0, s1, s0);
    index.push(s0, s1, s1 + 1, s0, s1 + 1, s0 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(`position`, new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

let rockMaterial: THREE.MeshStandardMaterial | null = null; // AO (49421)

/** Shared island rock material: vertex colours, rough, double sided, grain 0.22 and rim 0.3. */
export function islandRockMaterial(): THREE.MeshStandardMaterial { // jO (49422)
  if (rockMaterial) return rockMaterial;
  rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  stylizeMaterial(rockMaterial, 0.22, 0.3);
  return rockMaterial;
}
