// Port of play-inUT-NSi.js lines 41623-41757: the biome kit loader (aC, biome.glb BM_* meshes) and the
// biome dressing materials: the shared uTime (oC), the GLSL chunks (sC, cC, lC, uC), the patch helper (dC),
// tinted paint (fC), charred wood with embers (pC), ice (mC) and the flickering flame glow (hC).
// The cave decor (CaveDecor.update) advances BIOME_TIME.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/** BM_* mesh name -> geometry (uv removed; the materials are procedural). */
export type BiomeKit = Record<string, THREE.BufferGeometry>;

/** Loads biome.glb. Returns null (with a warning) when the kit is missing. */
export async function loadBiomeKit(): Promise<BiomeKit | null> { // aC (41623)
  try {
    const draco = new DRACOLoader().setDecoderPath(`/draco/`);
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`/models/biome.glb`);
    draco.dispose();
    const kit: BiomeKit = {};
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name.startsWith(`BM_`)) {
        if (mesh.geometry.getAttribute(`uv`)) mesh.geometry.deleteAttribute(`uv`);
        kit[mesh.name] = mesh.geometry;
      }
    });
    return kit;
  } catch (e) {
    console.warn(`biome kit missing`, e);
    return null;
  }
}

/** Shared time of every biome dressing material. */
export const BIOME_TIME = { value: 0 }; // oC (41643)

const BIOME_VERTEX_COMMON = `#include <common>
varying float vPhase;
varying float vObjY;
varying vec3 vBW;`; // sC (41644)

const BIOME_VERTEX_BEGIN = `#include <begin_vertex>
vObjY = position.y;
#ifdef USE_INSTANCING
  vPhase = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2832;
  vBW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
#else
  vPhase = 0.0;
  vBW = (modelMatrix * vec4(position, 1.0)).xyz;
#endif`; // cC (41648)

const BIOME_FRAGMENT_COMMON = `#include <common>
uniform float uTime;
varying float vPhase;
varying float vObjY;
varying vec3 vBW;
float bdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bdNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bdHash(i), bdHash(i + vec3(1,0,0)), f.x), mix(bdHash(i + vec3(0,1,0)), bdHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bdHash(i + vec3(0,0,1)), bdHash(i + vec3(1,0,1)), f.x), mix(bdHash(i + vec3(0,1,1)), bdHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`; // lC (41657)

/** Rim light of the given GLSL colour, added before opaque_fragment. */
const biomeRim = (
  color: string,
): string => `outgoingLight += ${color} * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
#include <opaque_fragment>`; // uC (41668)

type ShaderEdit = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** Installs the biome patch on a material: shared uTime, the chunks, the colour code and `extra`. */
function biomeMaterial<M extends THREE.Material>(key: string, material: M, colorCode: string, extra: ShaderEdit = () => {}): M { // dC (41672)
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = BIOME_TIME;
    shader.vertexShader = shader.vertexShader
      .replace(`#include <common>`, BIOME_VERTEX_COMMON)
      .replace(`#include <begin_vertex>`, BIOME_VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace(`#include <common>`, BIOME_FRAGMENT_COMMON)
      .replace(`#include <color_fragment>`, colorCode);
    extra(shader);
  };
  return material;
}

/** Painted prop: vertex colour desaturated, tinted, noise and ground grime, with a rim light. */
export function biomePaintMaterial(
  name: string,
  saturation: number,
  tint: THREE.Color,
  rim: THREE.Color,
  grime = 0.35,
): THREE.MeshStandardMaterial { // fC (41688)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  return biomeMaterial(
    `bm-paint-${name}`,
    material,
    `vec3 pc = vec3(1.0);
    #ifdef USE_COLOR
      pc = vColor.rgb;
    #endif
    float pl = dot(pc, vec3(0.3, 0.59, 0.11));
    pc = mix(vec3(pl), pc, ${saturation.toFixed(3)}) * vec3(${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)});
    pc *= 0.86 + 0.28 * bdNoise(vBW * 2.3);
    // grime creeping up from the ground
    pc *= mix(1.0 - ${grime.toFixed(3)}, 1.0, smoothstep(0.0, 0.6, vObjY));
    diffuseColor.rgb = pc;`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <opaque_fragment>`,
        biomeRim(`vec3(${rim.r.toFixed(3)}, ${rim.g.toFixed(3)}, ${rim.b.toFixed(3)})`),
      );
    },
  );
}

/** Charred wood: near black with glowing, breathing embers. */
export function biomeCharredMaterial(): THREE.MeshStandardMaterial { // pC (41711)
  return biomeMaterial(
    `bm-charred`,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    `float cn = bdNoise(vBW * vec3(3.0, 0.8, 3.0));
    diffuseColor.rgb = vec3(0.03, 0.022, 0.02) * (0.7 + 0.6 * bdNoise(vBW * 6.0));
    float ember = smoothstep(0.62, 0.72, cn) * (1.0 - smoothstep(0.0, 2.4, vObjY) * 0.6);`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * ember * (1.2 + 0.6 * sin(uTime * 1.7 + vPhase + cn * 8.0));`,
      );
    },
  );
}

/** Ice: glossy blue with a glowing rim and a lit underside. */
export function biomeIceMaterial(): THREE.MeshStandardMaterial { // mC (41727)
  return biomeMaterial(
    `bm-ice`,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0 }),
    `vec3 pc = vec3(1.0);
    #ifdef USE_COLOR
      pc = vColor.rgb;
    #endif
    diffuseColor.rgb = pc * vec3(0.32, 0.5, 0.62);`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
          float iceRim = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.2);
          totalEmissiveRadiance += vec3(0.35, 0.7, 0.95) * (0.05 + iceRim * 0.55) + vec3(0.7, 0.9, 1.0) * smoothstep(-0.6, -2.2, vObjY) * 0.12;`,
        )
        .replace(`#include <opaque_fragment>`, biomeRim(`vec3(0.3, 0.45, 0.55)`));
    },
  );
}

/** Unlit glow (the `~glow` companion meshes) of the given brightness, flickering by `flicker`. */
export function biomeGlowMaterial(name: string, brightness: number, flicker: number): THREE.MeshBasicMaterial { // hC (41748)
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(brightness, brightness, brightness) });
  return biomeMaterial(
    `bm-glow-${name}`,
    material,
    `#include <color_fragment>
    float fl = 1.0 - ${flicker.toFixed(3)} * (0.5 + 0.5 * sin(uTime * 13.0 + vPhase * 3.0) * sin(uTime * 7.3 + vPhase));
    diffuseColor.rgb *= fl;`,
  );
}
