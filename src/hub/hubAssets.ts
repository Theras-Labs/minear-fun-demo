// Port of play-inUT-NSi.js lines 49425-49539: hub town asset tables and helpers. The per-material grain table,
// the glow materials that are not baked, the hub2.glb loader, the spirit water shader, and the bakers that put
// material values into vertex attributes so the whole town merges into a few meshes.
// (BO, VO, HO at 49540-49542 are in hub.ts, beside their only user.)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from '../render/glsl/noise';
import { copyAtmoUniforms } from '../render/atmosphere';

/** Height of the town ground above the island centre (the hub asset root sits at y = 0.5). */
export const HUB_GROUND_Y = 0.5; // MO (49425)

/** Albedo grain per hub material; materials not listed use 0.06. */
export const HUB_GRAIN: Record<string, number> = { // NO (49426)
  H2_Stone: 0.12,
  H2_StoneDark: 0.12,
  H2_Cobble: 0.12,
  H2_Plaster: 0.08,
  H2_PlasterWarm: 0.08,
  H2_Wood: 0.18,
  H2_WoodLight: 0.16,
  H2_WoodDark: 0.16,
  H2_RoofTeal: 0.1,
  H2_RoofRed: 0.1,
  H2_RoofIndigo: 0.1,
  H2_Awning: 0.12,
  H2_AwningRed: 0.12,
  H2_Straw: 0.22,
  H2_Canvas: 0.18,
  H2_Burlap: 0.2,
  H2_Rope: 0.2,
  H2_Bark: 0.2,
  H2_Banner: 0.14,
  H2_BannerBlue: 0.14,
  H2_Iron: 0.06,
  H2_IronDark: 0.06,
  H2_Coal: 0.2,
  H2_Soil: 0.2,
};

/** Glowing materials: not stylized and not baked into the surfaces mesh (H2_Interior is baked anyway). */
export const HUB_GLOW_MATERIALS = new Set([ // PO (49452)
  `H2_Window`,
  `H2_Fire`,
  `H2_Ember`,
  `H2_Crystal`,
  `H2_Spirit`,
  `H2_PadGlow`,
  `H2_LiftGlow`,
  `H2_Interior`,
]);

/** Loads the hub town GLB (Draco) and returns its scene. */
export async function loadHub(url = `/models/hub2.glb`): Promise<THREE.Group> { // FO (49462)
  const draco = new DRACOLoader().setDecoderPath(`/draco/`);
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
  draco.dispose();
  return gltf.scene;
}

export interface SpiritWaterUniforms {
  uTime: { value: number };
  uPulse: { value: number };
  uCenter: { value: THREE.Vector3 };
}

export interface SpiritWater {
  m: THREE.ShaderMaterial;
  u: SpiritWaterUniforms;
}

/** The Wellspring water: rings around the centre, caustic flow, pulse glow and atmosphere fog. */
export function spiritWaterMaterial(center: THREE.Vector3): SpiritWater { // IO (49467)
  const u: SpiritWaterUniforms = { uTime: { value: 0 }, uPulse: { value: 0 }, uCenter: { value: center } };
  return {
    m: new THREE.ShaderMaterial({
      uniforms: { ...u, ...copyAtmoUniforms() },
      vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
      fragmentShader: `
      #include <common>
      ${NOISE_GLSL}
      uniform float uTime; uniform float uPulse; uniform vec3 uCenter;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz - uCenter.xz;
        float r = length(p);
        float rings = sin(r * 7.0 - uTime * 1.8) * 0.5 + 0.5;
        vec2 q = p * 1.6 + vec2(uTime * 0.12, -uTime * 0.09);
        float c1 = nzValue2(q * 1.7 + nzValue2(q + uTime * 0.2) * 1.5);
        float caustic = pow(1.0 - abs(c1 * 2.0 - 1.0), 6.0);
        vec3 deep = vec3(0.04, 0.2, 0.3), shallow = vec3(0.16, 0.62, 0.72), glow = vec3(0.55, 1.0, 1.0);
        vec3 c = mix(deep, shallow, 0.35 + 0.35 * rings * (1.0 - smoothstep(0.5, 3.0, r)));
        c += glow * (caustic * 0.45 + uPulse * 0.9 * (0.6 + 0.4 * rings));
        gl_FragColor = vec4(atmoFog(c, vW), 1.0);
      }`,
    }),
    u,
  };
}

/** Makes the colour attribute a Float32 vec4 (white when missing), so every hub geometry merges. */
export function forceColor4(geo: THREE.BufferGeometry): void { // LO (49500)
  const color = geo.getAttribute(`color`);
  const count = geo.getAttribute(`position`).count;
  if (!color) {
    geo.setAttribute(`color`, new THREE.Float32BufferAttribute(new Float32Array(count * 4).fill(1), 4));
    return;
  }
  if (color.itemSize === 4 && color.array instanceof Float32Array) return;
  const out = new Float32Array(color.count * 4);
  for (let e = 0; e < color.count; e++) {
    out[e * 4] = color.getX(e);
    out[e * 4 + 1] = color.getY(e);
    out[e * 4 + 2] = color.getZ(e);
    out[e * 4 + 3] = color.itemSize > 3 ? color.getW(e) : 1;
  }
  geo.setAttribute(`color`, new THREE.Float32BufferAttribute(out, 4));
}

/**
 * Bakes a material into the geometry: multiplies the vertex colour by the material colour and adds
 * aLook (roughness, metalness, grain, rim flag) and aGlow (emissive * intensity). Needs forceColor4 first.
 */
export function bakeLook(geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial): THREE.BufferGeometry { // RO (49516)
  const count = geo.getAttribute(`position`).count;
  const color = geo.getAttribute(`color`).array as Float32Array;
  for (let e = 0; e < count * 4; e += 4) {
    color[e] *= mat.color.r;
    color[e + 1] *= mat.color.g;
    color[e + 2] *= mat.color.b;
  }
  const stylized = !HUB_GLOW_MATERIALS.has(mat.name);
  const grain = stylized ? (HUB_GRAIN[mat.name] ?? 0.06) : 0;
  const glow = mat.emissive.clone().multiplyScalar(mat.emissiveIntensity);
  const look = new Float32Array(count * 4);
  const glowArr = new Float32Array(count * 3);
  for (let e = 0; e < count; e++) {
    look[e * 4] = mat.roughness;
    look[e * 4 + 1] = mat.metalness;
    look[e * 4 + 2] = grain;
    look[e * 4 + 3] = +!!stylized;
    glowArr[e * 3] = glow.r;
    glowArr[e * 3 + 1] = glow.g;
    glowArr[e * 3 + 2] = glow.b;
  }
  geo.setAttribute(`aLook`, new THREE.BufferAttribute(look, 4));
  geo.setAttribute(`aGlow`, new THREE.BufferAttribute(glowArr, 3));
  return geo;
}

/** Merges hub geometries (all indexed, or all made non-indexed); warns and returns an empty geometry on failure. */
export function mergeHub(geos: THREE.BufferGeometry[]): THREE.BufferGeometry { // zO (49536)
  const merged = mergeGeometries(
    geos.every((g) => g.index) ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  ) as THREE.BufferGeometry | null;
  if (!merged) console.warn(`hub: could not merge`);
  return merged ?? new THREE.BufferGeometry();
}
