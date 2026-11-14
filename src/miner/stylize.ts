// Port of play-inUT-NSi.js 45595-45717: character stylize shader patches (grain, rim, soft map, fill, per-vertex look, dye).
import * as THREE from 'three';

/** Shared warm rim colour of every stylized character material. */
export const RIM_UNIFORM = { value: new THREE.Color(0xfff1dc).multiplyScalar(0.32) }; // FT (45595)

/** Value-noise grain GLSL (gHash, gNoise). IT (45596) */
export const GRAIN_GLSL = `
  float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

export interface StylizeOptions {
  /** Mix toward a blurred map sample (only when the material has a map). */
  soft?: number;
  /** Flat fill light added to the diffuse colour. */
  fill?: number;
}

type MaybeMapped = THREE.Material & { map?: THREE.Texture | null };

/** Patches a built-in material with value-noise grain on the albedo, a warm rim and optional soft map / fill. */
export function stylizeMaterial(material: MaybeMapped, grain: number, rimK = 1, opts: StylizeOptions = {}): void { // LT (45603)
  const soft = opts.soft && material.map ? opts.soft : 0;
  const fill = opts.fill ?? 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = RIM_UNIFORM;
    shader.uniforms.uGrain = { value: grain };
    shader.uniforms.uRimK = { value: rimK };
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
varying vec3 vGrainPos;`,
      )
      .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
vGrainPos = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
        uniform vec3 uRim; uniform float uGrain; uniform float uRimK; varying vec3 vGrainPos;
        ${GRAIN_GLSL}`,
      )
      .replace(
        `#include <map_fragment>`,
        soft
          ? `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(map, vMapUv, 2.5).rgb * diffuse, ${soft.toFixed(3)});`
          : `#include <map_fragment>`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        float gn = gNoise(vGrainPos * 55.0) * 0.6 + gNoise(vGrainPos * 13.0) * 0.4;
        diffuseColor.rgb *= 1.0 + (gn - 0.5) * uGrain;`,
      )
      .replace(
        `#include <opaque_fragment>`,
        `outgoingLight += uRim * uRimK * pow(1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition))), 3.0);
        ${fill ? `outgoingLight += diffuseColor.rgb * vec3(${fill.toFixed(3)}, ${fill.toFixed(3)}, ${(fill * 1.12).toFixed(3)});` : ``}
        #include <opaque_fragment>`,
      );
  };
  if (soft || fill) material.customProgramCacheKey = () => `stylize:${soft}:${fill}`;
  material.needsUpdate = true;
}

/**
 * Per-vertex stylize for merged character meshes: roughness, metalness, grain and rim come from aLook,
 * emissive from aGlow, and with tints the aPart attribute picks tint slot A or B and a violet haze amount.
 */
export function stylizePerVertex(material: THREE.MeshStandardMaterial, tints?: [THREE.Color, THREE.Color]): void { // RT (45651)
  material.vertexColors = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = RIM_UNIFORM;
    if (tints) {
      shader.uniforms.uTintA = { value: tints[0] };
      shader.uniforms.uTintB = { value: tints[1] };
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
        attribute vec4 aLook; attribute vec3 aGlow; varying vec4 vLook; varying vec3 vGlow; varying vec3 vGrainPos;
        ${tints ? `attribute vec2 aPart; varying vec2 vPart;` : ``}`,
      )
      .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
        vGrainPos = position; vLook = aLook; vGlow = aGlow;${tints ? ` vPart = aPart;` : ``}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
        uniform vec3 uRim; varying vec4 vLook; varying vec3 vGlow; varying vec3 vGrainPos;
        ${tints ? `uniform vec3 uTintA; uniform vec3 uTintB; varying vec2 vPart;` : ``}
        ${GRAIN_GLSL}`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        ${tints ? `diffuseColor.rgb *= mix(vec3(1.0), vPart.x < 1.5 ? uTintA : uTintB, step(0.5, vPart.x));` : ``}
        float gn = gNoise(vGrainPos * 55.0) * 0.6 + gNoise(vGrainPos * 13.0) * 0.4;
        diffuseColor.rgb *= 1.0 + (gn - 0.5) * vLook.z;`,
      )
      .replace(`#include <roughnessmap_fragment>`, `float roughnessFactor = vLook.x;`)
      .replace(`#include <metalnessmap_fragment>`, `float metalnessFactor = vLook.y;`)
      .replace(`#include <emissivemap_fragment>`, `totalEmissiveRadiance = vGlow;`)
      .replace(
        `#include <opaque_fragment>`,
        `outgoingLight += uRim * vLook.w * pow(1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition))), 3.0);
        ${tints ? `outgoingLight += vec3(0.3, 0.18, 0.62) * pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.4) * 0.5 * vPart.y;` : ``}
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => (tints ? `stylize-each-tints` : `stylize-each`);
  material.needsUpdate = true;
}

/** Chains a dye recolour onto the material's current onBeforeCompile patch. */
export function dyeMaterial(material: THREE.Material, dyeHex: number): void { // zT (45696)
  const dye = { value: new THREE.Color(dyeHex) };
  const previous = material.onBeforeCompile;
  const key = previous.toString() + `|dye`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uDye = dye;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
uniform vec3 uDye;`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
{ float dl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, uDye * (0.4 + dl * 1.4), 0.78); }`,
      );
  };
  material.needsUpdate = true;
}
