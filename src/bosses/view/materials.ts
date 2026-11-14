// Port of play-inUT-NSi.js 63790-63801: the boss material patch. KF adds an icy blue fresnel rim to a material
// (titan ice, crystal and stone).
import * as THREE from 'three';

/** KF (63790): replaces the material's patch with an icy fresnel rim of the given strength. */
export function iceRim(e: THREE.Material, t: string, n = 0.9): void { // KF (63790)
  e.customProgramCacheKey = () => `boss-ice-${t}-${n}`;
  e.onBeforeCompile = (e) => {
    e.fragmentShader = e.fragmentShader.replace(
      `#include <emissivemap_fragment>`,
      `#include <emissivemap_fragment>
      float icyR = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.2);
      totalEmissiveRadiance += vec3(0.35, 0.72, 1.0) * icyR * ${n.toFixed(2)};`,
    );
  };
  e.needsUpdate = true;
}
