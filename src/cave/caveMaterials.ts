// Port of play-inUT-NSi.js lines 42476-42547 and 42563-42591: the cave decor materials that src/hub/caveKit.ts
// does not have: fungus (QC), rock ($C), ore (ew), the fallback crystal material (nw) and geometry (rw).
// The patch helper (ZC), its GLSL chunks, CAVE_TIME (GC) and the kit crystal material (tw) are in caveKit.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { caveMaterial, type CaveMaterial } from '../hub/caveKit';

/** Mushrooms: pale stalk, tinted cap (aMask.r), glowing gills (aMask.g), breathing emissive. */
export function caveFungusMaterial(): CaveMaterial { // QC (42476)
  return caveMaterial(
    `cave-fungus`,
    new THREE.MeshStandardMaterial({ roughness: 0.55 }),
    `vec3 stalk = vec3(0.8, 0.76, 0.7) * (0.8 + 0.2 * tint);
    diffuseColor.rgb = mix(stalk, tint * 0.28, vMask.r) * (0.3 + 0.7 * vMask.b) * (0.93 + 0.14 * cdNoise(vGrainP * 9.0));`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <emissivemap_fragment>`,
        `#include <emissivemap_fragment>
        float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        float breathe = 0.8 + 0.2 * sin(uTime * 1.25 + vPhase);
        totalEmissiveRadiance = (tint * vMask.r * (0.45 + rimK * rimK * 1.2) * 0.9 + mix(tint, vec3(1.0), 0.55) * vMask.g * 1.3) * breathe;`,
      );
    },
  );
}

/** Rocks and drips: grain, lit from above deep down, glowing moss on the tops (moss = false: plain). */
export function caveRockMaterial(moss = true): CaveMaterial { // $C (42493)
  return caveMaterial(
    moss ? `cave-rock` : `cave-rock-plain`,
    new THREE.MeshStandardMaterial({ roughness: 0.92 }),
    `float cvGrain = cdNoise(vGrainP * 7.0) * 0.6 + cdNoise(vGrainP * 23.0) * 0.4;
    vec3 cvC = tint * (0.28 + 0.72 * vMask.b) * (0.86 + 0.28 * cvGrain);
    // like the cave walls around it: lit from above (dusty tops, shadowed undersides), and the
    // glowing moss of the floor creeping over the tops
    float cvUp = normalize(vCaveN).y;
    float cvDeep = smoothstep(-1.0, -12.0, vCaveP.y);
    cvC *= mix(1.0, mix(0.62, 1.12, cvUp * 0.5 + 0.5), cvDeep);
    float cvMoss = smoothstep(0.35, 0.85, cvUp) * cvDeep * smoothstep(0.35, 0.65, cdNoise(vCaveP * 1.4));
    vec3 cvMossCol = mix(vec3(0.22, 0.9, 0.62), vec3(0.58, 0.46, 1.0), smoothstep(-24.0, -95.0, vCaveP.y));
    cvC = mix(cvC, cvC * 0.55 + cvMossCol * 0.1, cvMoss * (1.0 - vMask.g) * 0.85 * ${moss ? `1.0` : `0.0`});
    diffuseColor.rgb = cvC;`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(`#include <roughnessmap_fragment>`, `float roughnessFactor = mix(roughness, 0.3, vMask.g);`)
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += cvMossCol * vMask.g * vMask.g * 0.16 * cvDeep * ${moss ? `1.0` : `0.0`};`,
        );
    },
  );
}

/** Ore nuggets: dark rock with metallic, tinted ore (aMask.r) that glows by `glow` and flares up close. */
export function caveOreMaterial(glow: number): CaveMaterial { // ew (42522)
  return caveMaterial(
    `cave-ore-${glow}`,
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    `vec3 rockC = vec3(0.2, 0.185, 0.24) * (0.3 + 0.7 * vMask.b);
    diffuseColor.rgb = mix(rockC, tint * (0.5 + 0.5 * vMask.b), vMask.r);`,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(`#include <roughnessmap_fragment>`, `float roughnessFactor = mix(roughness, 0.36, vMask.r);`)
        .replace(`#include <metalnessmap_fragment>`, `float metalnessFactor = mix(metalness, 0.82, vMask.r);`)
        .replace(
          `#include <emissivemap_fragment>`,
          `#include <emissivemap_fragment>
          float facing = max(dot(normal, normalize(vViewPosition)), 0.0);
          float flare = pow(facing, 14.0) * vMask.g * (1.0 - smoothstep(4.0, 13.0, length(vViewPosition)));
          totalEmissiveRadiance = tint * vMask.r * (${glow.toFixed(3)} + flare * 0.45);`,
        );
    },
  );
}

/** Crystal material used when the cave kit is missing: glow by the instance colour and a rim. */
export function fallbackCrystalMaterial(): THREE.MeshStandardMaterial { // nw (42563)
  const material = new THREE.MeshStandardMaterial({
    color: 5921370,
    emissive: 16777215,
    emissiveIntensity: 0.7,
    roughness: 0.3,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <emissivemap_fragment>`,
      `#include <emissivemap_fragment>
      #ifdef USE_COLOR
      float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
      totalEmissiveRadiance *= vColor.rgb * (0.55 + rimK * rimK * 1.3);
      #endif`,
    );
  };
  return material;
}

/** Hex prism with a pointed top (no uv), the crystal used when the cave kit is missing. */
export function fallbackCrystalGeometry(): THREE.BufferGeometry { // rw (42585)
  const geometry = mergeGeometries([
    new THREE.CylinderGeometry(0.85, 1, 0.6, 6, 1).translate(0, 0.3, 0).toNonIndexed(),
    new THREE.ConeGeometry(0.85, 0.5, 6).translate(0, 0.85, 0).toNonIndexed(),
  ]);
  geometry.deleteAttribute(`uv`);
  geometry.computeVertexNormals();
  return geometry;
}
