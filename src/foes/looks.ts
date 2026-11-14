// Port of play-inUT-NSi.js 62522-62695: foe view constants (QP, $P, eF, sF, cF, lF), the shared look time
// uniform uF, the per-look material variants (dF bone colours, fF glow colours, pF GLSL, mF apply), the
// additive ghost material hF of the wraiths, the noisy rock mesh (vF geometry, _F material, bF) held and
// thrown by golems, the bounds widener yF and SF, which merges many rigid meshes parented to bones into one
// SkinnedMesh per material (plan cached per template in xF).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FoeLook } from './types';

/** QP (62522): base scale of every foe model. */
export const FOE_SCALE = 0.75; // QP (62522)
/** $P (62523): glow material names (eyes / lamp lens). */
export const GLOW_MATERIALS = new Set([`F_Glow`, `F_LostLens`]); // $P (62523)
/** eF (62524): seconds a locally predicted hit is kept before the server HP must confirm it. */
export const PREDICT_WINDOW = 1; // eF (62524)
/** sF (62531): champion scale. */
export const CHAMPION_SCALE = 1.25; // sF (62531)
export const clampF = THREE.MathUtils.clamp; // cF (62532)
/** lF (62533): shortest-path angle lerp. */
export const lerpAngle = (e: number, t: number, n: number): number => e + Math.atan2(Math.sin(t - e), Math.cos(t - e)) * n; // lF (62533)
/** uF (62534): shared look time uniform (advanced by the foe views each frame). */
export const LOOK_TIME = { value: 0 }; // uF (62534)

/** dF (62535): bone colour per look. */
export const LOOK_BONE_COLOR: Record<FoeLook, number> = { cinder: 2825496, drowned: 7173704, rime: 13822202, wraith: 0, dust: 10257763 }; // dF (62535)
/** fF (62536): glow colour per look. */
export const LOOK_GLOW_COLOR: Record<FoeLook, number> = { // fF (62536)
  cinder: 16747050,
  drowned: 13958986,
  rime: 11070719,
  wraith: 14731519,
  dust: 16754240,
};
/** pF (62537): F_Bones emissive GLSL per look (after #include <emissivemap_fragment>). */
export const LOOK_GLSL: Record<FoeLook, string> = { // pF (62537)
  cinder: `float lkN = gNoise(vGrainPos * 9.0) * 0.7 + gNoise(vGrainPos * 23.0) * 0.3;
    float lkC = smoothstep(0.86, 0.96, 1.0 - abs(lkN * 2.0 - 1.0));
    totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * lkC * (1.4 + 0.6 * sin(uLookT * 3.0 + lkN * 9.0));`,
  drowned: `totalEmissiveRadiance += vec3(0.25, 0.4, 0.08) * pow(max(dot(normal, normalize(vViewPosition)), 0.0), 10.0) * 0.35;`,
  rime: `totalEmissiveRadiance += vec3(0.35, 0.65, 0.95) * pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.5) * 0.7;`,
  wraith: ``,
  dust: ``,
};

/**
 * mF (62546): recolours a (cloned, stylized) foe material for a look; on F_Bones it chains the existing
 * onBeforeCompile (from stylizeMaterial, which defines vGrainPos / gNoise) with the look GLSL.
 */
export function applyLook(e: THREE.MeshStandardMaterial, t: FoeLook): void { // mF (62546)
  if (e.name === `F_Bones`) {
    e.color.setHex(LOOK_BONE_COLOR[t]);
    if (t === `drowned`) e.roughness = 0.35;
  } else if (GLOW_MATERIALS.has(e.name)) {
    e.color.setHex(LOOK_GLOW_COLOR[t]);
    e.emissive.setHex(LOOK_GLOW_COLOR[t]);
  } else if (t === `cinder`) e.color.multiplyScalar(0.35);
  else if (t === `drowned`) e.color.lerp(new THREE.Color(4872746), 0.55);
  else if (t === `rime`) e.color.lerp(new THREE.Color(12574975), 0.5);
  else if (t === `dust`) e.color.lerp(new THREE.Color(5915440), 0.45);
  if (e.name !== `F_Bones` || !LOOK_GLSL[t]) return;
  const n = e.onBeforeCompile;
  e.customProgramCacheKey = () => `foe-look-${t}-${e.name}`;
  e.onBeforeCompile = (r, i) => {
    n.call(e, r, i);
    r.uniforms.uLookT = LOOK_TIME;
    r.fragmentShader = r.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
uniform float uLookT;`,
      )
      .replace(`#include <emissivemap_fragment>`, `#include <emissivemap_fragment>\n${LOOK_GLSL[t]}`);
  };
}

/** hF (62579): the additive ghost material of wraith parts (eyes brighter). userData.ghost = {value} fade. */
export function ghostMaterial(e: boolean): THREE.MeshStandardMaterial { // hF (62579)
  const t = new THREE.MeshStandardMaterial({
    color: 0,
    emissive: e ? 15786239 : 9071359,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 1,
  });
  const n = { value: 1 };
  t.userData.ghost = n;
  t.customProgramCacheKey = () => (e ? `foe-ghost-eyes` : `foe-ghost`);
  t.onBeforeCompile = (r) => {
    r.uniforms.uLookT = LOOK_TIME;
    r.uniforms.uGhost = n;
    r.fragmentShader = r.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
uniform float uLookT; uniform float uGhost;`,
      )
      .replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        float gRim = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 1.6);
        totalEmissiveRadiance *= (0.25 + gRim * 1.6) * uGhost * (0.82 + 0.18 * sin(uLookT * 9.0 + vViewPosition.y * 3.0));
        totalEmissiveRadiance += vec3(0.3, 0.9, 0.85) * gRim * gRim * 0.4 * uGhost;`,
      );
  };
  return t;
}

let rockGeo: THREE.IcosahedronGeometry | null = null; // gF (62612)
let rockMat: THREE.MeshStandardMaterial | null = null; // _F (62613)

/** _F: the golem rock material (set from the golem's G_Rock by the foe views; bF falls back to plain rock). */
export function setRockMaterial(m: THREE.MeshStandardMaterial): void {
  rockMat = m;
}
export function getRockMaterial(): THREE.MeshStandardMaterial | null {
  return rockMat;
}

/** vF (62614): cached noisy icosahedron (radius 1, flattened 0.88). */
export function rockGeometry(): THREE.IcosahedronGeometry { // vF (62614)
  if (rockGeo) return rockGeo;
  const e = new THREE.IcosahedronGeometry(1, 1);
  const t = e.attributes.position as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < t.count; i++) {
    n.fromBufferAttribute(t, i);
    const r = 1 + 0.17 * Math.sin(n.x * 5.1 + n.y * 3.7) * Math.cos(n.z * 4.3 - n.x * 2.2);
    t.setXYZ(i, n.x * r, n.y * r * 0.88, n.z * r);
  }
  e.computeVertexNormals();
  return (rockGeo = e);
}

/** yF (62626): own bounding sphere 1.75x the bind-pose sphere, frustum culling on (skinned meshes). */
export function widenBounds(e: THREE.SkinnedMesh): void { // yF (62626)
  const t = e.geometry;
  if (!t.boundingSphere) t.computeBoundingSphere();
  e.boundingSphere = t.boundingSphere!.clone();
  e.boundingSphere.radius *= 1.75;
  e.frustumCulled = true;
}

/** bF (62633): a rock mesh (golem hand rock, thrown rock). */
export function rockMesh(): THREE.Mesh { // bF (62633)
  rockMat ??= new THREE.MeshStandardMaterial({ color: 7037272, roughness: 0.95, flatShading: true });
  const e = new THREE.Mesh(rockGeometry(), rockMat);
  e.castShadow = true;
  e.frustumCulled = false;
  return e;
}

interface MergePlan {
  groups: { mat: string; geo: THREE.BufferGeometry }[];
  bones: string[];
  inverses: THREE.Matrix4[];
}

const mergePlans = new WeakMap<THREE.Object3D, MergePlan | null>(); // xF (62638)

/**
 * SF (62639): replaces the rigid meshes parented to bones (at least 12) under root by one SkinnedMesh per
 * material, each vertex bound to its old parent bone with weight 1. The plan is cached per template.
 * Returns the new Skeleton, or null when nothing was merged.
 */
export function mergeRigid(e: THREE.Object3D, t: THREE.Object3D): THREE.Skeleton | null { // SF (62639)
  const n: THREE.Mesh[] = [];
  e.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && (m.parent as THREE.Bone | null)?.isBone && !Array.isArray(m.material))
      n.push(m);
  });
  if (n.length < 12) return null;
  e.updateMatrixWorld(true);
  let r = mergePlans.get(t);
  if (r === void 0) {
    const i = e.matrixWorld.clone().invert();
    const a: THREE.Object3D[] = [];
    for (const m of n) if (!a.includes(m.parent!)) a.push(m.parent!);
    const o = new Map<string, THREE.BufferGeometry[]>();
    const s = new THREE.Matrix4();
    for (const m of n) {
      const g = m.geometry.clone();
      g.applyMatrix4(s.multiplyMatrices(i, m.matrixWorld));
      const count = g.getAttribute(`position`).count;
      const si = new Uint16Array(count * 4);
      const sw = new Float32Array(count * 4);
      const bone = a.indexOf(m.parent!);
      for (let k = 0; k < count; k++) {
        si[k * 4] = bone;
        sw[k * 4] = 1;
      }
      g.setAttribute(`skinIndex`, new THREE.BufferAttribute(si, 4));
      g.setAttribute(`skinWeight`, new THREE.BufferAttribute(sw, 4));
      const name = (m.material as THREE.Material).name;
      if (!o.has(name)) o.set(name, []);
      o.get(name)!.push(g);
    }
    const c = [...o].map(([mat, geos]) => ({ mat, geo: mergeGeometries(geos) }));
    const l = new Set(n.map((m) => m.material));
    r =
      c.every((g) => g.geo) && o.size === l.size && new Set(a.map((b) => b.name)).size === a.length
        ? {
            groups: c as { mat: string; geo: THREE.BufferGeometry }[],
            bones: a.map((b) => b.name),
            inverses: a.map((b) => new THREE.Matrix4().multiplyMatrices(i, b.matrixWorld).invert()),
          }
        : null;
    mergePlans.set(t, r);
  }
  if (!r) return null;
  const i = r.bones.map((name) => e.getObjectByName(name));
  if (i.some((b) => !b)) return null;
  const a = new THREE.Skeleton(
    i as THREE.Bone[],
    r.inverses.map((m) => m.clone()),
  );
  for (const { mat, geo } of r.groups) {
    const material = n.find((m) => (m.material as THREE.Material).name === mat)!.material as THREE.Material;
    const o = new THREE.SkinnedMesh(geo, material);
    o.name = mat;
    o.castShadow = true;
    widenBounds(o);
    e.add(o);
    o.bind(a, new THREE.Matrix4());
  }
  for (const m of n) m.removeFromParent();
  return a;
}
