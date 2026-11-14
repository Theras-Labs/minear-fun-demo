// Port of play-inUT-NSi.js 36917-36990: the reroll die mesh zb.
// A rounded cube (RoundedBoxGeometry, the library class jb at 36507) with a 3 x 2 canvas pip atlas: cream faces,
// one red pip on face 1, dark pips elsewhere. The atlas is also the emissive map, so the die glows softly.
// GemField (Rb) calls it once for the `die` item and shares the geometry and material between every die.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Pip layouts for faces 1..6, in normalized cell coordinates (36921-36953). */
const PIPS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0.5, 0.5]],
  [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  [
    [0.27, 0.22],
    [0.73, 0.22],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.78],
    [0.73, 0.78],
  ],
];

/** Box face (+x, -x, +y, -y, +z, -z) -> atlas cell, so opposite faces sum to 7 (36973). */
const FACE_CELL = [0, 5, 1, 4, 2, 3];

export interface DieMesh {
  geometry: RoundedBoxGeometry;
  material: THREE.MeshStandardMaterial;
}

/** Builds the die geometry (UVs remapped into the atlas) and its glowing material. */
export function createDieMesh(): DieMesh { // zb (36917)
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  for (let f = 0; f < 6; f++) {
    const x = (f % 3) * 128;
    const y = Math.floor(f / 3) * 128;
    const g = ctx.createRadialGradient(x + 64, y + 64, 12.8, x + 64, y + 64, 96);
    g.addColorStop(0, `#fffaf0`);
    g.addColorStop(1, `#d9c7a4`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 128, 128);
    for (const [px, py] of PIPS[f]) {
      ctx.beginPath();
      ctx.arc(x + px * 128, y + py * 128, 128 * (f === 0 ? 0.13 : 0.085), 0, Math.PI * 2);
      ctx.fillStyle = f === 0 ? `#c2263b` : `#2a1b14`;
      ctx.fill();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.07);
  const uv = geometry.getAttribute('uv');
  const perFace = uv.count / 6;
  for (let k = 0; k < uv.count; k++) {
    const cell = FACE_CELL[Math.min(5, Math.floor(k / perFace))];
    const u = THREE.MathUtils.clamp(uv.getX(k), 0, 1);
    const v = THREE.MathUtils.clamp(uv.getY(k), 0, 1);
    uv.setXY(k, ((cell % 3) + 0.04 + u * 0.92) / 3, (1 - Math.floor(cell / 3) + 0.04 + v * 0.92) / 2);
  }
  return {
    geometry,
    material: new THREE.MeshStandardMaterial({
      map,
      roughness: 0.45,
      emissive: 16773328,
      emissiveMap: map,
      emissiveIntensity: 0.35,
    }),
  };
}
