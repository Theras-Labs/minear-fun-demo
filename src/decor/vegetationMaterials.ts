// Port of play-inUT-NSi.js lines 37352-37559: the vegetation material factories (onBeforeCompile patches of
// built-in materials) and the decor time uniform.
// - createLeafMaterial (nx): leaf cards. Lambert, alpha-tested, alpha-to-coverage, wind sway, painterly palette,
//   one broadleaf tree in six magenta (position hash), view-clear fade, sun back-light.
// - createLeafDepthMaterial (rx): the matching customDepthMaterial, so the shadows sway with the leaves.
// - createPropMaterial (ix): bark and rock. Lambert, painterly rock gradient, warmer bark, ground colour bleed
//   at the base, view-clear fade.
// The atmo* uniforms and atmoSightKeep() come from the global ShaderChunk.common patch (installAtmosphere,
// render/atmosphere.ts); they are not added here.
import * as THREE from 'three';
import { NOISE_GLSL } from '../render/glsl/noise';
import { attachGroundBleed, GROUND_BLEED_GLSL, PAINT_GROUND_GLSL } from '../render/painterly';
import { leafTexture } from './vegetation';

/** uLeafPal: -1 = magenta by position hash, 0 = never, 1 = always (the far-forest bake sets it per cell). */
export const leafPalette = { value: -1 }; // ex (37352)

/** Wind sway GLSL, inserted after <begin_vertex>: whole-crown sway that grows with height plus card flutter. */
export const WIND_SWAY_GLSL = `
  #ifdef USE_INSTANCING
    vec3 fIp = instanceMatrix[3].xyz;
  #else
    vec3 fIp = vec3(0.0);
  #endif
  float fT = atmoParams.x;
  float fWs = atmoWind.z;
  float fPh = fIp.x * 0.21 + fIp.z * 0.17;
  // whole-crown sway (grows with height) + per-card flutter
  float fSway = (sin(fT * 1.3 + fPh) * 0.6 + sin(fT * 2.1 + fPh * 1.7) * 0.3) * (0.25 + fWs * 1.4);
  vec3 fOff = vec3(atmoWind.x, 0.0, atmoWind.y) * fSway * 0.12 * aSway.x * aSway.x;
  fOff += vec3(sin(fT * 4.1 + aSway.y), cos(fT * 3.3 + aSway.y * 1.3), sin(fT * 3.7 + aSway.y * 0.7)) * 0.035 * (0.4 + fWs) * aSway.x;
  transformed += fOff;
`; // tx (37353)

/** Leaf card material (MeshLambertMaterial). */
export function createLeafMaterial(): THREE.MeshLambertMaterial { // nx (37368)
  const m = new THREE.MeshLambertMaterial({ map: leafTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  m.alphaToCoverage = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLeafPal = leafPalette;
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
attribute vec2 aSway;
attribute vec3 aLeaf;
uniform float uLeafPal;
varying vec3 vLeafW;
varying vec3 vLeafK;
varying float vLeafMag;`,
      )
      .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
        ${WIND_SWAY_GLSL}
        vLeafK = aLeaf;
        // (one broadleaf tree in six is magenta, by where it stands; photographed ones are told)
        #ifdef USE_INSTANCING
          vec3 lIp = instanceMatrix[3].xyz;
          float lMag = step(0.83, fract(sin(dot(floor(lIp.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453));
        #else
          float lMag = 0.0;
        #endif
        vLeafMag = (uLeafPal < -0.5 ? lMag : uLeafPal) * step(aLeaf.z, 0.5);`,
      )
      .replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vLeafW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
varying vec3 vLeafW;
varying vec3 vLeafK;
varying float vLeafMag;`,
      )
      .replace(
        `#include <map_fragment>`,
        `#include <map_fragment>
        float leafTexL = dot(diffuseColor.rgb, vec3(0.3333));
        {
          vec2 dx = dFdx(vMapUv * 256.0), dy = dFdy(vMapUv * 256.0);
          float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + lod * 0.28;
        }`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        // the painterly look: a painted crown, deep inside and underneath, bright out on top; green, a
        // cooler green for conifers, and now and then magenta (blossoms keep their own colour)
        if (atmoLook.x > 0.0 && vLeafK.z < 2.5) {
          float k = clamp(vLeafK.x * 0.95 + vLeafK.y * 0.45 - 0.35, 0.0, 1.0);
          float pine = step(0.5, vLeafK.z) * step(vLeafK.z, 1.5);
          vec3 c0 = mix(mix(vec3(0.03, 0.16, 0.05), vec3(0.02, 0.13, 0.1), pine), vec3(0.16, 0.02, 0.2), vLeafMag);
          vec3 c1 = mix(mix(vec3(0.1, 0.36, 0.06), vec3(0.05, 0.28, 0.17), pine), vec3(0.46, 0.07, 0.44), vLeafMag);
          vec3 c2 = mix(mix(vec3(0.32, 0.6, 0.08), vec3(0.18, 0.5, 0.24), pine), vec3(0.86, 0.32, 0.78), vLeafMag);
          vec3 pc = mix(c0, c1, smoothstep(0.0, 0.5, k));
          pc = mix(pc, c2, smoothstep(0.5, 1.0, k));
          pc *= 0.78 + 0.34 * leafTexL;
          diffuseColor.rgb = mix(diffuseColor.rgb, pc, atmoLook.x);
        }`,
      )
      .replace(
        `#include <normal_fragment_begin>`,
        `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`,
      )
      .replace(
        `#include <alphatest_fragment>`,
        `#include <alphatest_fragment>
        // leaves hugging the camera or hiding the miner fade out (via MSAA coverage) instead of blocking the view
        diffuseColor.a *= atmoSightKeep(vLeafW, 3.0);
        if (diffuseColor.a < 0.02) discard;`,
      )
      .replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vLeafW - cameraPosition);
          float back = pow(max(dot(vd, atmoSunDir), 0.0), 4.0);
          totalEmissiveRadiance += atmoSunColor * diffuseColor.rgb * back * 0.85 * (1.0 - atmoParams.w);
        }`,
      );
  };
  return m;
}

/** Leaf shadow material: RGBA-packed depth, leaf texture alpha test, the same wind sway. */
export function createLeafDepthMaterial(): THREE.MeshDepthMaterial { // rx (37469)
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture(), alphaTest: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
attribute vec2 aSway;`,
      )
      .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
` + WIND_SWAY_GLSL,
      );
  };
  return m;
}

/** Bark and rock material (MeshLambertMaterial, vertex colours). */
export function createPropMaterial(): THREE.MeshLambertMaterial { // ix (37488)
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.alphaToCoverage = true;
  m.onBeforeCompile = (shader) => {
    attachGroundBleed(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
attribute float aRock;
varying vec3 vPropW;
varying float vPropUp;
varying float vPropH;
varying float vPropRock;`,
      )
      .replace(
        `#include <beginnormal_vertex>`,
        `#include <beginnormal_vertex>
        if (aRock > 0.5) objectNormal = normalize(mix(objectNormal, normalize(position - vec3(0.0, 0.1, 0.0)), atmoLook.x * 0.85));`,
      )
      .replace(
        `#include <defaultnormal_vertex>`,
        `#include <defaultnormal_vertex>
        #ifdef USE_INSTANCING
          vPropUp = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz).y;
          // (a rock's paint follows how high up it the point is, not its facets: a smooth gradient)
          vPropH = clamp((position.y + 0.25) / 1.05, 0.0, 1.0);
        #else
          vPropUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;
          vPropH = clamp((position.y + 0.25) / 1.05, 0.0, 1.0);
        #endif
        vPropRock = aRock;`,
      )
      .replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vPropW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vPropW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>\n${NOISE_GLSL}\n${PAINT_GROUND_GLSL}\n${GROUND_BLEED_GLSL}\nvarying vec3 vPropW;\nvarying float vPropUp;\nvarying float vPropH;\nvarying float vPropRock;`,
      )
      .replace(`#include <clipping_planes_fragment>`, `#include <clipping_planes_fragment>`)
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        // the painterly look: rock a pale blue-grey on top, deepening down its sides; bark warmer and brighter
        if (atmoLook.x > 0.0) {
          vec3 pc;
          if (vPropRock > 0.5) {
            float t = clamp(vPropH * 0.75 + smoothstep(-0.35, 0.95, vPropUp) * 0.35, 0.0, 1.0);
            pc = mix(vec3(0.2, 0.28, 0.46), vec3(0.33, 0.47, 0.69), smoothstep(0.0, 0.5, t));
            pc = mix(pc, vec3(0.6, 0.74, 0.9), smoothstep(0.55, 1.0, t));
            pc *= 0.92 + 0.16 * nzValue2(vPropW.xz * 1.3 + vPropW.y);
          } else pc = diffuseColor.rgb * vec3(1.45, 1.3, 1.15);
          diffuseColor.rgb = mix(diffuseColor.rgb, pc, atmoLook.x);
        }
        diffuseColor.rgb = groundBleed(diffuseColor.rgb, vPropW);
        diffuseColor.a = atmoSightKeep(vPropW, 1.8);
        if (diffuseColor.a < 0.02) discard;`,
      );
  };
  return m;
}

/** Decor time uniform: advanced by Decor.update, read by no shader (dead in the original too). */
export const vegetationTime = { uTime: { value: 0 } }; // ax (37559)
