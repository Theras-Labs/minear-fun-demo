// Port of play-inUT-NSi.js lines 35473-35643: the terrain uniforms (xb) and the lit terrain material (Sb).
// The Chunk class (_b, 35442-35469) and the mesher scratch arrays (35470-35472) belong to src/world/chunk.ts.
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise';
import { PAINT_GROUND_GLSL, PAINT_STROKES_GLSL } from './painterly';
import { biomeUniforms, BIOME_ROCK_PRELUDE_GLSL, BIOME_ROCK_GLSL } from './biomeRock';

/** Shared terrain uniforms: uGrassR = grass far radius, uPlayerXZ = player x/z (set each frame). */
export const terrainUniforms = { // xb (35473)
  uGrassR: { value: 38 },
  uPlayerXZ: { value: new THREE.Vector2() },
};

/** The lit terrain MeshLambertMaterial (vertex colors) with the grass / strata / moss / ore / biome rock patch. */
export function createTerrainMaterial(): THREE.MeshLambertMaterial { // Sb (35474)
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassR = terrainUniforms.uGrassR;
    shader.uniforms.uPlayerXZ = terrainUniforms.uPlayerXZ;
    Object.assign(shader.uniforms, biomeUniforms);
    shader.vertexShader =
      `#undef USE_BATCHING
` +
      shader.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
        attribute float glow; attribute float carved; attribute float aMat; attribute float ore; attribute vec3 oreCol;
        varying float vGlow; varying float vCarved; flat varying float vMat; varying float vOre; varying vec3 vOreCol;
        varying vec3 vTWorld; varying vec3 vTNormal;`,
        )
        .replace(
          `#include <begin_vertex>`,
          `#include <begin_vertex>
        vGlow = glow; vCarved = carved; vMat = aMat; vOre = ore; vOreCol = oreCol;
        vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>
        ${NOISE_GLSL}
        ${PAINT_GROUND_GLSL}
        ${PAINT_STROKES_GLSL}
        ${BIOME_ROCK_PRELUDE_GLSL}
        uniform float uGrassR; uniform vec2 uPlayerXZ;
        varying float vGlow; varying float vCarved; flat varying float vMat; varying float vOre; varying vec3 vOreCol;
        varying vec3 vTWorld; varying vec3 vTNormal;`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        float oreGlow = 0.0, oreGlint = 0.0;
        vec3 oreCol = vec3(0.0);
        vec3 mossGlow = vec3(0.0);
        vec3 biomeGlow = vec3(0.0);
        {
          vec3 wp = vTWorld;
          float up = normalize(vTNormal).y;
          vec3 c = diffuseColor.rgb;
          float big = nzFbm2(wp.xz * 0.03);
          float mid = nzValue3(wp * 0.33);
          float fine = nzValue3(wp * 2.6);
          bool grassTop = ((vMat > 0.5 && vMat < 1.5) || (vMat > 7.5 && vMat < 8.5)) && up > 0.45;
          if (vMat > 18.5) {
            // a biome's own rock (biometerrain.ts)
            vec3 n = normalize(vTNormal);
            ${BIOME_ROCK_GLSL}
          } else if (grassTop) {
            vec3 lush = c * vec3(0.8, 0.98, 0.72);
            vec3 sunny = c * vec3(1.2, 1.1, 0.66);
            c = mix(lush, sunny, smoothstep(0.4, 0.78, big));
            // mottling from flat (xz) noise: 3D noise sliced by a gentle slope shows its lattice as
            // contour lines every few metres of height
            float midF = nzFbm2(wp.xz * 0.21 + 17.0);
            float fineF = nzValue2(wp.xz * 2.6 - 5.0);
            c *= 0.9 + 0.18 * midF + 0.06 * fineF;
            // under the blade field the ground reads as deep grass
            float dist = length(wp.xz - uPlayerXZ);
            c *= mix(0.6, 1.0, smoothstep(uGrassR * 0.5, uGrassR, dist));
            // the painterly look (look.ts): the painted ground instead, seated a little darker under the tufts
            if (atmoLook.x > 0.0) {
              vec3 pc = paintGround(wp, up) * paintStrokes(wp.xz) * mix(0.88, 1.0, smoothstep(uGrassR * 0.4, uGrassR, dist));
              c = mix(c, pc, atmoLook.x);
            }
            // dug-up ground (no blades grow here): plain loose soil, like the pit walls
            vec3 soil = vec3(0.3, 0.155, 0.07) * (0.86 + 0.2 * mid + 0.1 * fine);
            c = mix(c, soil, smoothstep(0.15, 0.8, vCarved));
          } else {
            float deepK = smoothstep(-1.0, -12.0, wp.y);
            // earth & rock laid down in wavy strata: each band its own shade and a touch warmer or
            // cooler, with a fine sediment line at its base (digging reveals the layers)
            float sy = (wp.y + (mid - 0.5) * 1.3 + (big - 0.5) * 3.2) / 1.7;
            float layer = floor(sy);
            float lh = nzHash13(vec3(layer, 7.1, 3.3));
            c *= 0.84 + 0.3 * lh;
            c *= mix(vec3(1.05, 0.98, 0.94), vec3(0.94, 0.99, 1.06), step(0.5, fract(lh * 7.0)));
            float lf = fract(sy);
            float fw = fwidth(sy);
            float seam = (1.0 - smoothstep(0.0, max(fw * 1.5, 0.035), lf)) * (1.0 - smoothstep(0.08, 0.3, fw));
            c *= 1.0 - seam * mix(0.18, 0.34, deepK);
            c *= 0.88 + 0.22 * mid;
            c *= 0.93 + 0.14 * fine;
            // underground: deeper, richer rock (pale stone would wash out to white under the lamp),
            // lit from above: dusty ledges, shadowed overhangs (reads the shape)
            float lumC = dot(c, vec3(0.299, 0.587, 0.114));
            c = mix(c, mix(vec3(lumC), c, 1.4) * 0.8, deepK);
            c *= mix(1.0, mix(0.66, 1.15, up * 0.5 + 0.5), deepK);
            // glowing moss creeps over natural cave floors
            if (up > 0.5 && vCarved < 0.5 && deepK > 0.01) {
              float patchN = nzFbm2(wp.xz * 0.11 + vec2(wp.y * 0.07, 0.0));
              float moss = smoothstep(0.5, 0.6, patchN) * smoothstep(0.5, 0.78, up) * deepK;
              vec3 mossCol = mix(vec3(0.22, 0.9, 0.62), vec3(0.58, 0.46, 1.0), smoothstep(-24.0, -95.0, wp.y));
              c = mix(c, c * 0.55 + mossCol * 0.1, moss * 0.85);
              // tiny round motes of light in the moss (faded with distance so they never shimmer)
              vec3 sp = wp * 3.2;
              vec3 si = floor(sp);
              float speck = 0.0;
              for (int k = 0; k < 8; k++) {
                vec3 cc = si + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
                vec3 jp = cc + vec3(nzHash13(cc + 3.1), nzHash13(cc + 17.3), nzHash13(cc + 29.9));
                speck = max(speck, smoothstep(0.2, 0.07, length(sp - jp)) * step(0.72, nzHash13(cc + 7.7)));
              }
              speck *= moss * (1.0 - smoothstep(9.0, 18.0, length(wp - cameraPosition)));
              mossGlow = mossCol * (moss * 0.05 + speck * 1.2);
            }
          }
          // ore veins: glinting nuggets set into the rock, thinning out toward the vein's edge
          float oreW = clamp(vOre, 0.0, 1.0);
          if (oreW > 0.02) {
            vec3 ore = vOreCol / max(vOre, 1e-3);
            float dens = smoothstep(0.2, 0.65, oreW + (nzValue3(wp * 1.1) - 0.5) * 0.5);
            // freshly cut rock shows the nuggets in section; natural cave walls have real ones
            // standing out of them (cavedecor.ts), so only a mineral stain here
            float cut = step(0.5, vCarved);
            c = mix(c, c * (0.55 + 0.7 * ore), 0.3 * dens * (1.0 - cut));
            dens *= cut;
            if (dens > 0.001) {
              vec3 cellP = wp * 3.6;
              vec3 ci = floor(cellP);
              float nug = 0.0, rim = 0.0, dome = 0.0, glint = 0.0;
              vec3 vd = normalize(wp - cameraPosition);
              for (int k = 0; k < 8; k++) {
                vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
                vec3 cc = ci + o;
                vec3 jp = cc + vec3(nzHash13(cc), nzHash13(cc + 11.1), nzHash13(cc + 23.7));
                float d = length(cellP - jp);
                float r = 0.2 + 0.2 * nzHash13(cc + 41.7);
                float on = step(1.0 - 0.75 * dens, nzHash13(cc + 5.3));
                float inside = smoothstep(r + 0.07, r, d) * on;
                // a dark setting around each nugget so it sits in the rock instead of on it
                rim = max(rim, smoothstep(r + 0.2, r + 0.06, d) * on);
                if (inside > nug) {
                  nug = inside;
                  dome = d / r;
                  // each nugget has a facet that catches the light as you move past it
                  vec3 fn = normalize(vec3(nzHash13(cc + 3.3), nzHash13(cc + 9.9), nzHash13(cc + 15.1)) - 0.5);
                  glint = pow(max(dot(reflect(vd, normalize(vTNormal)), fn), 0.0), 24.0);
                }
              }
              c *= 1.0 - 0.45 * rim * (1.0 - nug);
              // domed: bright crown, darker edge
              c = mix(c, ore * (1.2 - 0.55 * dome * dome) * (0.9 + 0.3 * fine), nug);
              oreGlow = nug;
              oreGlint = nug * glint * (1.0 - smoothstep(6.0, 16.0, length(wp - cameraPosition)));
              oreCol = ore;
            }
          }
          // rain darkens exposed ground
          c *= 1.0 - atmoParams.y * 0.3 * smoothstep(0.2, 0.9, up) * (1.0 - atmoParams.w);
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += oreCol * (oreGlow * (vGlow * 3.0 + 0.06) + oreGlint * 0.9) + mossGlow + biomeGlow + (vOre > 0.02 || vMat > 18.5 ? vec3(0.0) : vColor.rgb * vGlow);`,
      );
  };
  return material;
}
