// Port of play-inUT-NSi.js lines 42374-42475 and 42548-42562: the cave kit loader (AC, cave.glb CV_* meshes)
// and the cave material factory (ZC) with its GLSL chunks and the crystal material (tw).
// The hub uses the kit crystals; the cave decor (cw, not ported yet) uses the same exports.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/** CV_* mesh name -> geometry (vertex colour moved to aMask, uv removed). */
export type CaveKit = Record<string, THREE.BufferGeometry>;

/** Loads cave.glb. Returns null (with a warning) when the kit is missing. */
export async function loadCaveKit(): Promise<CaveKit | null> { // AC (42374)
  try {
    const draco = new DRACOLoader().setDecoderPath(`/draco/`);
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`/models/cave.glb`);
    draco.dispose();
    const kit: CaveKit = {};
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.name.startsWith(`CV_`)) return;
      const geo = mesh.geometry;
      const color = geo.getAttribute(`color`);
      if (color) {
        geo.setAttribute(`aMask`, color);
        geo.deleteAttribute(`color`);
      }
      if (geo.getAttribute(`uv`)) geo.deleteAttribute(`uv`);
      kit[mesh.name] = geo;
    });
    return kit;
  } catch (e) {
    console.warn(`cave kit missing`, e);
    return null;
  }
}

/** Shared time of every cave material (the cave decor advances it). */
export const CAVE_TIME = { value: 0 }; // GC (42410)

export const CAVE_VERTEX_COMMON = `#include <common>
attribute vec3 aMask;
varying vec3 vMask;
varying float vPhase;
varying vec3 vGrainP;
varying vec3 vCaveP;
varying vec3 vCaveN;`; // KC (42411)

export const CAVE_VERTEX_BEGIN = `#include <begin_vertex>
vMask = aMask;
vGrainP = position * 3.0;
#ifdef USE_INSTANCING
  vPhase = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2832;
  vGrainP += instanceMatrix[3].xyz;
  vCaveP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  vCaveN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vPhase = 0.0;
  vCaveP = (modelMatrix * vec4(position, 1.0)).xyz;
  vCaveN = normalize(mat3(modelMatrix) * objectNormal);
#endif`; // qC (42418)

export const CAVE_FRAGMENT_COMMON = `#include <common>
uniform float uTime;
uniform vec3 uTint;
varying vec3 vMask;
varying float vPhase;
varying vec3 vGrainP;
varying vec3 vCaveP;
varying vec3 vCaveN;
float cdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cdNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cdHash(i), cdHash(i + vec3(1,0,0)), f.x), mix(cdHash(i + vec3(0,1,0)), cdHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cdHash(i + vec3(0,0,1)), cdHash(i + vec3(1,0,1)), f.x), mix(cdHash(i + vec3(0,1,1)), cdHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`; // JC (42431)

export const CAVE_TINT = `vec3 tint = uTint;
#ifdef USE_COLOR
  tint *= vColor.rgb;
#endif`; // YC (42445)

export const CAVE_RIM = `outgoingLight += vec3(0.32, 0.3, 0.28) * 0.55 * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
#include <opaque_fragment>`; // XC (42449)

/** A cave material: userData.tint is the uTint uniform (multiplied by the instance colour when present). */
export type CaveMaterial = THREE.MeshStandardMaterial & { userData: { tint: { value: THREE.Color } } };

/**
 * Patches a MeshStandardMaterial with the cave chunks: aMask (r = glow mask, g = flare, b = shade), tint,
 * grain noise, a rim light, and the given colour code; `extra` edits the shader after that.
 */
export function caveMaterial(
  key: string,
  material: THREE.MeshStandardMaterial,
  colorCode: string,
  extra: (shader: THREE.WebGLProgramParametersWithUniforms) => void = () => {},
): CaveMaterial { // ZC (42451)
  material.customProgramCacheKey = () => key;
  material.userData.tint = { value: new THREE.Color(1, 1, 1) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = CAVE_TIME;
    shader.uniforms.uTint = material.userData.tint;
    shader.vertexShader = shader.vertexShader
      .replace(`#include <common>`, CAVE_VERTEX_COMMON)
      .replace(`#include <begin_vertex>`, CAVE_VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace(`#include <common>`, CAVE_FRAGMENT_COMMON)
      .replace(
        `#include <color_fragment>`,
        CAVE_TINT +
          `
` +
          colorCode,
      )
      .replace(`#include <opaque_fragment>`, CAVE_RIM);
    extra(shader);
  };
  return material as CaveMaterial;
}

/** Glowing crystal material; emissiveIntensity is the glow strength. */
export function caveCrystalMaterial(glow = 0.75): CaveMaterial { // tw (42548)
  return caveMaterial(
    `cave-crystal`,
    new THREE.MeshStandardMaterial({ roughness: 0.25, emissive: 16777215, emissiveIntensity: glow, flatShading: true }),
    `diffuseColor.rgb = tint * (0.16 + 0.2 * vMask.b);`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        totalEmissiveRadiance *= tint * (0.3 + 0.7 * vMask.b) * (0.5 + rimK * rimK * 1.25) + mix(tint, vec3(1.0), 0.6) * vMask.g * 0.5;`,
      );
    },
  );
}
