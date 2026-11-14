// Port of play-inUT-NSi.js lines 34285-34370: painterly ground shading GLSL, the ground bleed for prop
// bases (reads the grass height capture), and the "paintable ground" wrapper for built-in materials.
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise';

export const PAINT_GROUND_GLSL = `
vec3 paintGround(vec3 wp, float up) {
  vec2 p = wp.xz;
  float big = nzFbm2(p * 0.014 + 5.3);
  float mid = nzFbm2(p * 0.05 - 2.1);
  // strokes drawn out long along one slant, and short dabs criss-crossed like painted grass
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float st = nzValue2(vec2(q.x * 0.6, q.y * 4.0));
  float dab = nzValue2(vec2(p.x * 3.1, p.y * 0.9) + 3.3) * 0.5 + nzValue2(vec2(p.x * 0.9, p.y * 3.1) - 7.1) * 0.5;
  vec3 deep = vec3(0.04, 0.22, 0.05);
  vec3 green = vec3(0.12, 0.42, 0.05);
  vec3 lime = vec3(0.26, 0.56, 0.04);
  vec3 sunny = vec3(0.46, 0.6, 0.08);
  float k = big + (mid - 0.5) * 0.4;
  vec3 c = mix(deep, green, smoothstep(0.2, 0.45, k));
  c = mix(c, lime, smoothstep(0.45, 0.7, k));
  c = mix(c, sunny, smoothstep(0.72, 0.92, k));
  c *= 0.93 + 0.1 * st + 0.06 * dab;
  // slopes a touch deeper
  c = mix(c * vec3(0.8, 0.88, 0.9), c, smoothstep(0.6, 0.92, up));
  return c;
}
`; // By (34285)

export const PAINT_STROKES_GLSL = `
float paintStrokes(vec2 p) {
  // short dashes in two slants, criss-crossed, broken up so they don't line up
  vec2 a = mat2(0.94, -0.34, 0.34, 0.94) * p;
  vec2 b = mat2(0.94, 0.34, -0.34, 0.94) * p;
  float s1 = nzValue2(vec2(a.x * 9.0 + nzValue2(p * 1.7) * 2.5, a.y * 1.6));
  float s2 = nzValue2(vec2(b.x * 9.0 - nzValue2(p * 1.3 + 4.0) * 2.5, b.y * 1.6) + 11.0);
  float s = mix(s1, s2, step(0.5, nzValue2(p * 0.9 + 2.0)));
  float fade = 1.0 - smoothstep(0.35, 1.2, fwidth(p.x * 9.0));
  return 1.0 + (s - 0.5) * 0.16 * fade;
}
`; // Vy (34308)

/** Shared ground capture uniforms; GrassField fills them with its height capture texture and view-projection. */
export const groundCaptureUniforms: { tex: { value: THREE.Texture | null }; vp: { value: THREE.Matrix4 } } = { // Hy (34320)
  tex: { value: null },
  vp: { value: new THREE.Matrix4() },
};

export const GROUND_BLEED_GLSL = `
uniform sampler2D uGroundTex; uniform mat4 uGroundVP;
vec3 groundBleed(vec3 col, vec3 wp) {
  if (atmoLook.x <= 0.0) return col;
  vec4 c = uGroundVP * vec4(wp.x, 0.0, wp.z, 1.0);
  vec2 uv = c.xy * 0.5 + 0.5;
  if (uv.x < 0.01 || uv.y < 0.01 || uv.x > 0.99 || uv.y > 0.99) return col;
  vec2 g = texture2D(uGroundTex, uv).rg;
  float k = (1.0 - smoothstep(-0.1, 1.3, wp.y - g.x)) * smoothstep(0.3, 0.8, g.y);
  return mix(col, paintGround(wp, 1.0) * 1.05, k * 0.85 * atmoLook.x);
}
`; // Uy (34321)

/** Attaches uGroundTex / uGroundVP (shared objects) to a shader's uniforms. */
export function attachGroundBleed(shader: { uniforms: { [name: string]: THREE.IUniform } }): void { // Wy (34333)
  shader.uniforms.uGroundTex = groundCaptureUniforms.tex;
  shader.uniforms.uGroundVP = groundCaptureUniforms.vp;
}

/**
 * Chains an onBeforeCompile on a built-in material: in the painterly look the up-facing faces show the
 * painted ground instead of the diffuse color. customProgramCacheKey "paintable-ground".
 */
export function makePaintableGround<T extends THREE.Material>(material: T): T { // Gy (34336)
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `#include <common>
varying vec3 vPaintW; varying vec3 vPaintN;`,
      )
      .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
vPaintW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vPaintN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `#include <common>\n${NOISE_GLSL}\n${PAINT_GROUND_GLSL}\n${PAINT_STROKES_GLSL}\nvarying vec3 vPaintW; varying vec3 vPaintN;`,
      )
      .replace(
        `#include <color_fragment>`,
        `#include <color_fragment>
        if (atmoLook.x > 0.0) {
          float pUp = normalize(vPaintN).y;
          diffuseColor.rgb = mix(diffuseColor.rgb, paintGround(vPaintW, pUp) * paintStrokes(vPaintW.xz), atmoLook.x * smoothstep(0.3, 0.6, pUp));
        }`,
      );
  };
  material.customProgramCacheKey = () => `paintable-ground`;
  return material;
}
