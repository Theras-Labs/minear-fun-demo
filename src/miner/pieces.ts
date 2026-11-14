// Port of play-inUT-NSi.js 45943-46045: angle helpers, merged geometry caches, mesh helpers and the
// per-vertex character piece builder ($E) used to merge rigid parts into one skinned draw call.
import * as THREE from 'three';

export const clamp = THREE.MathUtils.clamp; // BE (45943)

/** Wraps an angle into [-PI, PI]. */
export const wrapAngle = (a: number): number => { // VE (45944)
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const mergedByFirst = new WeakMap<THREE.BufferGeometry, { from: THREE.BufferGeometry[]; geo: THREE.BufferGeometry | null }>(); // HE (45949)

/** Memoizes a merged geometry by its source geometry list (keyed by the first geometry). */
export function memoMerged( // UE (45950)
  list: THREE.BufferGeometry[],
  build: () => THREE.BufferGeometry | null,
): THREE.BufferGeometry | null {
  const hit = mergedByFirst.get(list[0]);
  if (hit && hit.from.length === list.length && hit.from.every((g, i) => g === list[i])) return hit.geo;
  const geo = build();
  mergedByFirst.set(list[0], { from: list, geo });
  return geo;
}

const shared = new Map<string, { geo: THREE.BufferGeometry | null; users: number }>(); // WE (45956)

/** Ref-counted shared geometry: builds once per key, counts one more user. */
export function acquireGeometry(key: string, build: () => THREE.BufferGeometry | null): THREE.BufferGeometry | null { // GE (45957)
  let entry = shared.get(key);
  if (!entry) shared.set(key, (entry = { geo: build(), users: 0 }));
  entry.users++;
  return entry.geo;
}

/** Releases one user of a shared geometry; disposes it at zero users. */
export function releaseGeometry(key: string): void { // KE (45961)
  const entry = shared.get(key);
  if (!entry || --entry.users > 0) return;
  entry.geo?.dispose();
  shared.delete(key);
}

/** True for a rigid mesh that can merge into the per-vertex pieces material. */
export function isMergeable(mesh: THREE.Mesh): boolean { // qE (45965)
  const mat = mesh.material as THREE.MeshStandardMaterial;
  return (
    !Array.isArray(mesh.material) &&
    !(mesh as THREE.SkinnedMesh).isSkinnedMesh &&
    mat.isMeshStandardMaterial &&
    !mat.map &&
    !mat.transparent &&
    !mesh.geometry.morphAttributes.position &&
    !!mesh.geometry.index &&
    !!mesh.geometry.getAttribute(`normal`)
  );
}

/** Replaces a node by a plain Object3D with the same name and transform, keeping its children. */
export function replaceWithNode(node: THREE.Object3D): THREE.Object3D { // JE (45978)
  const out = new THREE.Object3D();
  out.name = node.name;
  out.position.copy(node.position);
  out.quaternion.copy(node.quaternion);
  out.scale.copy(node.scale);
  node.parent?.add(out);
  for (const child of [...node.children]) out.add(child);
  node.removeFromParent();
  return out;
}

/** Wearable slots. */
export const WEAR_SLOTS = [`head`, `body`, `pack`, `launcher`, `charm1`, `charm2`] as const; // YE (45988)
export type WearSlot = (typeof WEAR_SLOTS)[number];

const tmpGlow = new THREE.Color(); // XE (45989)
const tmpDye = new THREE.Color(); // ZE (45990)
const WHITE = new THREE.Color(1, 1, 1); // QE (45991)

/** Look values a material carries in userData.look. */
export interface MaterialLook {
  grain?: number;
  rim?: number;
  haze?: number;
}

/** One rigid piece of the merged character mesh. */
export interface Piece {
  node: THREE.Object3D;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  dye?: number;
}

/**
 * Bakes one piece into a geometry for the per-vertex material: colour (material colour, or white when
 * tinted, times vertex colour, optional dye), aLook, aGlow, aPart and rigid skinning to bone `boneIndex`.
 */
export function bakePiece(piece: Pick<Piece, 'geo' | 'mat' | 'dye'>, boneIndex: number): THREE.BufferGeometry { // $E (45992)
  const { geo, mat } = piece;
  const count = geo.getAttribute(`position`).count;
  const out = new THREE.BufferGeometry();
  out.setAttribute(`position`, geo.getAttribute(`position`));
  out.setAttribute(`normal`, geo.getAttribute(`normal`));
  out.setIndex(geo.index);
  const look: MaterialLook = mat.userData.look ?? {};
  const tint: number = mat.userData.tint ?? 0;
  const base = tint ? WHITE : mat.color;
  const vcol = mat.vertexColors ? geo.getAttribute(`color`) : undefined;
  const dye = piece.dye === undefined ? null : tmpDye.setHex(piece.dye);
  const glow = tmpGlow.copy(mat.emissive).multiplyScalar(mat.emissiveIntensity);
  const color = new Float32Array(count * 3);
  const aLook = new Float32Array(count * 4);
  const aGlow = new Float32Array(count * 3);
  const aPart = new Float32Array(count * 2);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    let r = base.r;
    let g = base.g;
    let b = base.b;
    if (vcol) {
      r *= vcol.getX(v);
      g *= vcol.getY(v);
      b *= vcol.getZ(v);
    }
    if (dye) {
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      r += (dye.r * (0.4 + lum * 1.4) - r) * 0.78;
      g += (dye.g * (0.4 + lum * 1.4) - g) * 0.78;
      b += (dye.b * (0.4 + lum * 1.4) - b) * 0.78;
    }
    color[v * 3] = r;
    color[v * 3 + 1] = g;
    color[v * 3 + 2] = b;
    aLook[v * 4] = mat.roughness;
    aLook[v * 4 + 1] = mat.metalness;
    aLook[v * 4 + 2] = look.grain ?? 0;
    aLook[v * 4 + 3] = look.rim ?? 0;
    aGlow[v * 3] = glow.r;
    aGlow[v * 3 + 1] = glow.g;
    aGlow[v * 3 + 2] = glow.b;
    aPart[v * 2] = tint;
    aPart[v * 2 + 1] = look.haze ?? 0;
    skinIndex[v * 4] = boneIndex;
    skinWeight[v * 4] = 1;
  }
  out.setAttribute(`color`, new THREE.BufferAttribute(color, 3));
  out.setAttribute(`aLook`, new THREE.BufferAttribute(aLook, 4));
  out.setAttribute(`aGlow`, new THREE.BufferAttribute(aGlow, 3));
  out.setAttribute(`aPart`, new THREE.BufferAttribute(aPart, 2));
  out.setAttribute(`skinIndex`, new THREE.BufferAttribute(skinIndex, 4));
  out.setAttribute(`skinWeight`, new THREE.BufferAttribute(skinWeight, 4));
  return out;
}
