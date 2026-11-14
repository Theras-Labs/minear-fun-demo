// Port of play-inUT-NSi.js lines 34122-34284: the shared "atmo" uniforms, the GLSL prelude, the global
// THREE.ShaderChunk / THREE.ShaderLib patch (height fog + haze, toon ramp, opaque clamp) and the look switch.
// The original runs the patch at import (34276). Here installAtmosphere() must be called once by the app
// before the Canvas mounts (before any built-in material compiles).
import * as THREE from 'three';

/** Makes obj.clone() return obj, so UniformsUtils.clone() keeps one shared value object. */
export function shareOnClone<T extends object>(obj: T): T { // Ay (34122)
  (obj as unknown as { clone: () => T }).clone = () => obj;
  return obj;
}

/** The shared atmosphere values. Mutate them in place; every patched material reads them. */
export const ATMO = { // jy (34125)
  sunDir: shareOnClone(new THREE.Vector3(0.4, 0.7, 0.3).normalize()),
  sunColor: shareOnClone(new THREE.Color(1, 0.95, 0.85)),
  fogA: shareOnClone(new THREE.Vector4(0.012, 0.045, 0, 1)),
  fogB: shareOnClone(new THREE.Vector4(1, 6e-4, 0, 0)),
  fogHorizon: shareOnClone(new THREE.Color(13625077)),
  fogSun: shareOnClone(new THREE.Color(16769720)),
  params: shareOnClone(new THREE.Vector4(0, 0, 0, 0)),
  wind: shareOnClone(new THREE.Vector4(1, 0.3, 0.35, 0)),
  windScroll: shareOnClone(new THREE.Vector4(0, 0, 0, 0)),
  toon: shareOnClone(new THREE.Vector4(-0.08, 0.32, 0.72, 0)),
  focus: shareOnClone(new THREE.Vector4(0, 0, 0, 0)),
  look: shareOnClone(new THREE.Vector4(0, 0, 0, 0)),
};

export interface AtmoUniforms {
  [name: string]: THREE.IUniform;
  atmoSunDir: { value: THREE.Vector3 };
  atmoSunColor: { value: THREE.Color };
  atmoFogA: { value: THREE.Vector4 };
  atmoFogB: { value: THREE.Vector4 };
  atmoFogHorizon: { value: THREE.Color };
  atmoFogSun: { value: THREE.Color };
  atmoParams: { value: THREE.Vector4 };
  atmoWind: { value: THREE.Vector4 };
  atmoWindScroll: { value: THREE.Vector4 };
  atmoToon: { value: THREE.Vector4 };
  atmoFocus: { value: THREE.Vector4 };
  atmoLook: { value: THREE.Vector4 };
}

export const atmoUniforms: AtmoUniforms = { // My (34139)
  atmoSunDir: { value: ATMO.sunDir },
  atmoSunColor: { value: ATMO.sunColor },
  atmoFogA: { value: ATMO.fogA },
  atmoFogB: { value: ATMO.fogB },
  atmoFogHorizon: { value: ATMO.fogHorizon },
  atmoFogSun: { value: ATMO.fogSun },
  atmoParams: { value: ATMO.params },
  atmoWind: { value: ATMO.wind },
  atmoWindScroll: { value: ATMO.windScroll },
  atmoToon: { value: ATMO.toon },
  atmoFocus: { value: ATMO.focus },
  atmoLook: { value: ATMO.look },
};

/** Shallow copy of the atmo uniforms for custom ShaderMaterials. */
export function copyAtmoUniforms(): AtmoUniforms { // Ny (34153)
  return { ...atmoUniforms };
}

export const ATMO_GLSL = `
uniform vec3 atmoSunDir;
uniform vec3 atmoSunColor;
uniform vec4 atmoFogA;
uniform vec4 atmoFogB;
uniform vec3 atmoFogHorizon;
uniform vec3 atmoFogSun;
uniform vec4 atmoParams;
uniform vec4 atmoWind;
uniform vec4 atmoWindScroll;
uniform vec4 atmoToon;
uniform vec4 atmoFocus;
uniform vec4 atmoLook;

// 1 = keep, 0 = dissolve: props hugging the camera or blocking the view of the player fade out
float atmoSightKeep(vec3 wp, float nearR) {
  float keep = smoothstep(nearR * 0.35, nearR, length(wp - cameraPosition));
  if (atmoFocus.w > 0.5) {
    vec3 toF = atmoFocus.xyz - cameraPosition;
    float L2 = max(dot(toF, toF), 1e-4);
    float t = dot(wp - cameraPosition, toF) / L2;
    if (t > 0.0 && t < 0.97) {
      float d = length(cameraPosition + toF * t - wp);
      keep = min(keep, smoothstep(0.8, 1.9, d));
    }
  }
  return keep;
}
// interleaved gradient noise for screen-door fades (pass gl_FragCoord.xy; fragment stage only)
float atmoDither(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}

// Height fog (analytic integral of exp(-falloff * height)) + uniform distance haze.
// Fog color leans toward warm in-scattered sunlight when looking toward the sun.
vec3 atmoFog(vec3 col, vec3 wp) {
  vec3 ro = cameraPosition;
  vec3 d = wp - ro;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-4);
  float a = atmoFogA.x, b = atmoFogA.y;
  float oy = ro.y - atmoFogA.z;
  float k = b * rd.y;
  // (the height term is capped: deep underground exp(-b * oy) runs to 1e20 and more, so even a
  // whisker of surface fog left on would swallow the whole view)
  float amt = a > 0.0 ? a * exp(min(-b * oy, 4.0)) * (abs(k) > 1e-4 ? (1.0 - exp(min(-dist * k, 30.0))) / k : dist) : 0.0;
  amt = max(amt, 0.0) + atmoFogB.y * max(dist - atmoFogB.z, 0.0);
  float f = min(1.0 - exp(-amt), atmoFogB.x);
  float s = max(dot(rd, atmoSunDir), 0.0);
  vec3 fc = mix(atmoFogHorizon, atmoFogSun, (s * s * s * s * 0.55 + pow(s, 24.0) * 0.45) * atmoFogA.w);
  return mix(col, fc, f);
}

// Soft cel ramp for direct light: mostly two-tone with a gentle terminator.
float toonNL(float x) {
  return mix(clamp(x, 0.0, 1.0), smoothstep(atmoToon.x, atmoToon.y, x), atmoToon.z);
}
`; // Py (34156)

let patched = false; // Fy (34214)

/**
 * Patches THREE.ShaderChunk (common, fog_*, opaque_fragment, lights_lambert_pars_fragment,
 * lights_physical_pars_fragment) and adds the atmo uniforms to every THREE.ShaderLib entry.
 * Idempotent. Call once before the Canvas mounts.
 */
export function installAtmosphere(): void { // Iy (34215)
  if (patched) return;
  patched = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.common = chunks.common + '\n' + ATMO_GLSL;
  chunks.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vFogWorld;
  varying float vFogDepth;
#endif`;
  chunks.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  chunks.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  chunks.fog_fragment = `
#ifdef USE_FOG
  gl_FragColor.rgb = atmoFog(gl_FragColor.rgb, vFogWorld);
#endif`;
  chunks.opaque_fragment += `
gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(2048.0));`;
  const patch = (name: string, find: string, replace: string): void => {
    if (!chunks[name].includes(find)) console.warn(`atmosphere: could not patch ${name}`);
    chunks[name] = chunks[name].replace(find, replace);
  };
  patch(
    `lights_lambert_pars_fragment`,
    `float dotNL = saturate( dot( geometryNormal, directLight.direction ) );`,
    `#ifdef NO_TOON
  float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
#else
  float dotNL = toonNL( dot( geometryNormal, directLight.direction ) );
#endif`,
  );
  patch(
    `lights_physical_pars_fragment`,
    `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`,
    `#ifdef NO_TOON
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
#else
  reflectedLight.directDiffuse += toonNL( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
#endif`,
  );
  for (const shader of Object.values(THREE.ShaderLib)) Object.assign(shader.uniforms, atmoUniforms);
}

let currentLook = `classic`; // Ly (34277)
export const lookListeners: Array<(look: string) => void> = []; // Ry (34278)

/** Sets ATMO.look.x (1 = painterly) and tells the listeners when the look changes. */
export function setLook(look: string): void { // zy (34279)
  ATMO.look.x = +(look === `painterly`);
  if (look !== currentLook) {
    currentLook = look;
    for (const listener of lookListeners) listener(look);
  }
}
