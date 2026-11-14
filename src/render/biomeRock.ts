// Port of play-inUT-NSi.js lines 35046-35279: biome cavern rock surface GLSL (basalt, magma, bog mud,
// mossrock, frostrock, ice, snow, ashstone, bonestone). Inserted into the terrain material
// (terrainMaterial.ts) when vMat > 18.5. BIOME_ROCK_GLSL reads c, wp, n, up, big, mid, fine and writes
// c and biomeGlow, all declared by the host shader.
import * as THREE from 'three';
import { MATERIALS } from '../world/materials';

/** Shared biome uniforms. uLiquidKind: 0 none, 1 lava, 2 toxic. */
export const biomeUniforms = { // ib (35046)
  uTime: { value: 0 },
  uLiquidY: { value: -1e5 },
  uLiquidKind: { value: 0 },
};

/** GLSL vec3 literal of a material's base color (working color space, 4 decimals). */
export const biomeColorGLSL = (matId: number): string => { // ab (35047)
  const t = new THREE.Color(MATERIALS[matId].color);
  return `vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`;
};

export const BIOME_ROCK_PRELUDE_GLSL = `
uniform float uTime;
uniform float uLiquidY;
uniform float uLiquidKind;
// each biome rock's own color (the vertex color is that times the cavity shade; an if-chain, not a
// const array: some drivers stumble over those, and every bit of terrain shares this shader)
vec3 bmBase(int i) {
${[19, 20, 21, 22, 23, 24, 25, 26].map((e, t) => `  if (i == ${t}) return ${biomeColorGLSL(e)};`).join(`
`)}
  return ${biomeColorGLSL(27)};
}

// cellular noise: x the distance to the nearest point, y to the next (y - x is small along the cracks)
vec2 bmCell2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + nzHash22(i + o) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  return sqrt(vec2(d1, d2));
}
// ...laid onto any surface (the projections blended by the normal)
vec2 bmCellTri(vec3 p, vec3 n) {
  vec3 w = n * n; w *= w;
  w /= w.x + w.y + w.z;
  vec2 r = vec2(0.0);
  if (w.x > 0.03) r += w.x * bmCell2(p.zy + 3.1);
  if (w.y > 0.03) r += w.y * bmCell2(p.xz);
  if (w.z > 0.03) r += w.z * bmCell2(p.xy - 5.7);
  return r;
}
// a sparse glitter: tiny facets that flash as they turn toward the lamp (which rides with you)
float bmGlint(vec3 wp, vec3 n, vec3 vd, float scale, float amount) {
  vec3 sp = wp * scale;
  vec3 si = floor(sp);
  if (nzHash13(si + 0.7) > amount) return 0.0;
  vec3 jp = si + 0.2 + 0.6 * vec3(nzHash13(si + 1.7), nzHash13(si + 5.3), nzHash13(si + 9.1));
  float d = length(sp - jp);
  vec3 fn = normalize(vec3(nzHash13(si + 3.3), nzHash13(si + 7.7), nzHash13(si + 11.1)) - 0.5 + n * 0.8);
  float flash = pow(max(dot(reflect(vd, fn), -vd), 0.0), 30.0);
  return smoothstep(0.2, 0.02, d) * flash;
}
// light rippling across the ice overhead, as if through water above it (the Frozen Lake's vault)
float bmCaustic(vec3 wp) {
  vec2 cp = wp.xz * 0.16 + vec2(uTime * 0.045, uTime * 0.028);
  vec2 c1 = bmCell2(cp);
  vec2 c2 = bmCell2(cp * 1.7 + vec2(-uTime * 0.035, uTime * 0.02) + 3.0);
  return pow(1.0 - clamp(c1.y - c1.x, 0.0, 1.0), 7.0) + 0.6 * pow(1.0 - clamp(c2.y - c2.x, 0.0, 1.0), 7.0);
}
// round specks of light (the bog's glowing spores in the moss)
float bmSpecks(vec3 wp, float scale, float amount) {
  vec3 sp = wp * scale;
  vec3 si = floor(sp);
  float s = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 cc = si + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 jp = cc + vec3(nzHash13(cc + 3.1), nzHash13(cc + 17.3), nzHash13(cc + 29.9));
    s = max(s, smoothstep(0.22, 0.06, length(sp - jp)) * step(1.0 - amount, nzHash13(cc + 7.7)));
  }
  return s;
}
`; // ob (35051)

export const BIOME_ROCK_GLSL = `
{
  int bi = int(vMat + 0.5) - 19;
  vec3 base = bmBase(bi);
  // the cavity shade the mesher baked into the vertex color
  float ao = clamp(dot(c, vec3(0.333)) / max(dot(base, vec3(0.333)), 1e-3), 0.45, 1.15);
  vec3 vd = normalize(wp - cameraPosition);
  float camD = length(wp - cameraPosition);
  float near = 1.0 - smoothstep(10.0, 24.0, camD);
  float facing = max(dot(n, -vd), 0.0);
  float fres = pow(1.0 - facing, 3.0);
  vec3 col = base;
  if (bi == 0) {
    // basalt: columns, their joints polygons on top and long seams down the walls
    vec2 cl = bmCell2(wp.xz * 0.62 + (nzValue2(wp.xz * 0.2) - 0.5) * 0.35);
    float joint = 1.0 - smoothstep(0.02, 0.07, cl.y - cl.x);
    // each column its own shade, broken across every so often
    float colH = nzHash12(floor(wp.xz * 0.62 + 0.5));
    float brk = 1.0 - smoothstep(0.0, 0.04, abs(fract(wp.y * 0.38 + colH * 3.0) - 0.5) - 0.46);
    col = base * (0.7 + 0.6 * colH) * (0.85 + 0.3 * fine);
    col = mix(col, base * 0.3, max(joint, brk * (1.0 - abs(up)) * 0.7));
    // a dusting of pale ash on the tops
    col = mix(col, vec3(0.11, 0.1, 0.1), smoothstep(0.55, 0.9, up) * smoothstep(0.45, 0.75, big) * 0.55);
    // the lava's heat: the joints glow over the last metre or two above it...
    float above = wp.y - uLiquidY;
    float heat = uLiquidKind == 1.0 ? 1.0 - smoothstep(0.0, 1.2, above) : 0.0;
    heat *= 0.7 + 0.3 * sin(uTime * 1.4 + colH * 6.28);
    biomeGlow += vec3(1.0, 0.26, 0.03) * joint * heat * 0.9;
    // ...and its light plays on the rock above it, strongest on what faces down toward it
    float lavaLit = uLiquidKind == 1.0 ? (1.0 - smoothstep(0.0, 14.0, above)) * step(-0.5, above) : 0.0;
    biomeGlow += col * vec3(1.0, 0.36, 0.1) * lavaLit * (max(-n.y, 0.0) * 1.6 + 0.35);
    // (a warm rim: the fields' glow outlines every spire and column against the dark)
    biomeGlow += vec3(0.5, 0.14, 0.04) * fres * 0.22;
    // the whole vault glows dull red with the lava's light (a burning sky of stone), smouldering in
    // slow patches
    float vault = max(-n.y, 0.0) * (uLiquidKind == 1.0 ? 1.0 : 0.0);
    float smoulder = 0.6 + 0.4 * sin(uTime * 0.35 + big * 9.0);
    biomeGlow += (col * vec3(1.0, 0.34, 0.1) * 1.1 + vec3(0.07, 0.014, 0.004) * smoulder) * vault;
  } else if (bi == 1) {
    // magma rock: black crust in broad plates, molten cracks between them (the hottest by the lava)
    vec2 warp = (vec2(nzValue2(wp.xz * 0.25), nzValue2(wp.xz * 0.25 + 7.1)) - 0.5) * 0.9;
    vec2 cl = abs(up) > 0.55 ? bmCell2(wp.xz * 0.34 + warp) : bmCellTri(wp * 0.34, n);
    float edge = cl.y - cl.x;
    // (only some of the seams have split open)
    float live = smoothstep(0.35, 0.6, nzValue2(wp.xz * 0.21 + 4.0));
    float crack = (1.0 - smoothstep(0.015, 0.09, edge)) * live;
    float core = (1.0 - smoothstep(0.0, 0.035, edge)) * live;
    float breathe = 0.7 + 0.3 * sin(uTime * 1.6 + nzValue2(wp.xz * 0.15) * 12.0);
    col = vec3(0.03, 0.02, 0.02) * (0.7 + 0.6 * fine) * (0.8 + 0.5 * cl.x);
    col = mix(col, vec3(0.35, 0.08, 0.02), crack * 0.6);
    float nearLava = uLiquidKind == 1.0 ? 1.0 - smoothstep(0.0, 1.5, wp.y - uLiquidY) : 0.5;
    biomeGlow += vec3(1.0, 0.25, 0.03) * (crack * 0.55 + core * 0.9) * breathe * (0.45 + 0.55 * nearLava);
    // a dull red heat through the crust right at the lava's edge
    biomeGlow += vec3(0.5, 0.08, 0.01) * nearLava * 0.12;
    // (and the lava lights it too)
    biomeGlow += col * vec3(1.0, 0.36, 0.1) * 0.6;
  } else if (bi == 2) {
    // bog mud: dark brown and wet, wetter in the hollows, strewn with rotting leaves
    float wet = smoothstep(0.35, 0.72, nzFbm2(wp.xz * 0.32));
    col = base * (0.7 + 0.5 * mid) * mix(1.0, 0.55, wet);
    col = mix(col, vec3(0.09, 0.06, 0.025), smoothstep(0.62, 0.78, nzValue2(wp.xz * 2.3)) * 0.6);
    // green scum along the waterline
    float scum = uLiquidKind == 2.0 ? smoothstep(0.5, 0.0, abs(wp.y - uLiquidY - 0.1)) * smoothstep(0.35, 0.65, nzValue2(wp.xz * 1.3)) : 0.0;
    col = mix(col, vec3(0.1, 0.2, 0.03), scum * 0.8);
    // the lamp's sheen on the wet
    float sheen = pow(facing, 8.0) * smoothstep(0.3, 0.9, up) * (0.35 + 0.65 * wet) * near;
    biomeGlow += vec3(0.5, 0.52, 0.4) * sheen * 0.06 + vec3(0.25, 0.6, 0.06) * scum * 0.05;
  } else if (bi == 3) {
    // mossrock: moss on every ledge (and a little way over the edge), streaks of it down the walls
    float mossy = smoothstep(0.15, 0.65, up + (nzFbm2(wp.xz * 0.4 + wp.y * 0.1) - 0.5) * 0.9);
    vec3 rock = vec3(0.04, 0.05, 0.035) * (0.75 + 0.5 * mid);
    vec3 moss = mix(vec3(0.07, 0.12, 0.03), vec3(0.2, 0.24, 0.05), nzValue3(wp * 0.7)) * (0.8 + 0.35 * fine);
    float streak = smoothstep(0.5, 0.8, nzValue2(vec2((wp.x + wp.z) * 1.6, wp.y * 0.12))) * (1.0 - abs(up));
    col = mix(rock, moss, max(mossy, streak * 0.75));
    float sp = bmSpecks(wp, 2.4, 0.3) * max(mossy, streak) * (1.0 - smoothstep(12.0, 26.0, camD));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + nzHash13(floor(wp * 2.4)) * 6.28);
    biomeGlow += vec3(0.55, 1.0, 0.2) * sp * tw * 1.4 + moss * mossy * 0.06;
  } else if (bi == 4) {
    // frostrock: blue-grey, frosted wherever it faces up, rime feathered over the walls
    col = base * (0.55 + 0.35 * mid) * vec3(0.8, 0.92, 1.05);
    float frost = smoothstep(0.35, 0.8, up + (nzFbm2(wp.xz * 0.5 + wp.y * 0.3) - 0.5) * 0.7);
    float rime = smoothstep(0.6, 0.8, nzFbm3(wp * vec3(1.4, 0.5, 1.4))) * (1.0 - frost);
    col = mix(col, vec3(0.72, 0.82, 0.92), frost * 0.85);
    col = mix(col, vec3(0.62, 0.74, 0.88), rime * 0.7);
    biomeGlow += vec3(0.9, 0.97, 1.0) * bmGlint(wp, n, vd, 5.0, 0.35) * (frost + rime) * near * 2.0;
    if (up < -0.2) biomeGlow += vec3(0.25, 0.72, 0.95) * bmCaustic(wp) * smoothstep(-0.2, -0.7, up) * 0.2;
  } else if (bi == 5) {
    // ice: look into it. Cracks and bubbles at different depths inside it shift as you move past
    float lake = smoothstep(0.8, 0.95, up);
    float depthIn = mix(0.45, 1.3, lake);
    float slant = 1.0 / max(facing, 0.3);
    vec3 in1 = wp + vd * depthIn * slant;
    vec3 in2 = wp + vd * depthIn * 2.4 * slant;
    // long wandering cracks (only some of the cell walls have split, and they fade in and out)
    vec2 w1 = in1.xz * 0.16 + (vec2(nzValue2(in1.xz * 0.11), nzValue2(in1.xz * 0.11 + 5.2)) - 0.5) * 1.6;
    vec2 ck = lake > 0.5 ? bmCell2(w1) : bmCellTri(in1 * 0.35, n);
    float crack = (1.0 - smoothstep(0.0, 0.028, ck.y - ck.x)) * smoothstep(0.42, 0.62, nzValue2(w1 * 1.3 + 3.0));
    // a finer web deeper in, fainter
    vec2 w2 = in2.xz * 0.5 + (vec2(nzValue2(in2.xz * 0.3 + 9.0), nzValue2(in2.xz * 0.3 + 2.0)) - 0.5) * 0.8;
    vec2 ck2 = bmCell2(w2);
    float web = (1.0 - smoothstep(0.0, 0.03, ck2.y - ck2.x)) * smoothstep(0.55, 0.75, nzValue2(w2 * 0.6 + 1.0)) * lake;
    // clear black-blue ice (deep water under it) in big patches, milky where it froze full of air
    float milky = smoothstep(0.38, 0.72, nzFbm2(in2.xz * 0.045 + 3.0));
    milky = max(milky, 1.0 - lake * 0.85);
    vec3 col0 = mix(vec3(0.006, 0.035, 0.085), vec3(0.2, 0.42, 0.58), milky);
    col0 *= 0.8 + 0.4 * nzFbm2(in2.xz * 0.2 + in2.y * 0.2);
    // bubbles caught in it, strings of them
    float bub = bmSpecks(in1 * vec3(1.0, 1.8, 1.0), 1.5, 0.15) * (0.4 + 0.6 * milky);
    col = col0 + vec3(0.45, 0.65, 0.78) * (crack * 0.6 + web * 0.18 + bub * 0.22);
    // now and then something frozen deep in the lake: a fish, dark against the ice
    vec2 fc = floor(in2.xz * 0.2);
    if (lake > 0.5 && nzHash12(fc + 17.0) > 0.8) {
      vec2 fo = (fc + 0.3 + 0.4 * nzHash22(fc + 3.0)) / 0.2;
      float fa = nzHash12(fc + 9.0) * 6.2832;
      vec2 fd = mat2(cos(fa), -sin(fa), sin(fa), cos(fa)) * (in2.xz - fo);
      float body = 1.0 - smoothstep(0.85, 1.0, length(fd / vec2(0.55, 0.19)));
      float tail = step(0.42, fd.x) * step(fd.x, 0.82) * step(abs(fd.y), (fd.x - 0.42) * 0.7);
      col = mix(col, vec3(0.006, 0.02, 0.04), max(body, tail) * 0.85 * (1.0 - milky * 0.4));
    }
    // snow dusted over it in drifts, and frosty scratches on the surface itself
    float drift = smoothstep(0.58, 0.8, nzFbm2(wp.xz * 0.09 + 17.0)) * lake;
    col = mix(col, vec3(0.62, 0.72, 0.84) * (0.9 + 0.2 * fine), drift * 0.75);
    col = mix(col, vec3(0.55, 0.7, 0.85), smoothstep(0.66, 0.9, nzFbm2(wp.xz * 1.4 + wp.y)) * 0.2 * (1.0 - drift));
    // (icefalls: long pale streaks down the pillars)
    col = mix(col, vec3(0.55, 0.75, 0.9), (1.0 - lake) * smoothstep(0.55, 0.85, nzValue2(vec2((wp.x + wp.z) * 2.1, wp.y * 0.07))) * 0.45);
    // a pale rim where it turns away, and a polished gleam in the lamp across the lake
    col = mix(col, vec3(0.7, 0.86, 1.0), fres * mix(0.5, 0.35, lake));
    biomeGlow += vec3(0.2, 0.5, 0.8) * (0.02 + crack * 0.06) + vec3(0.9, 0.97, 1.0) * bmGlint(wp, n, vd, 3.0, 0.2) * near * 1.6 * (0.3 + drift);
    biomeGlow += vec3(0.6, 0.8, 1.0) * pow(facing, 20.0) * lake * (1.0 - drift) * near * 0.1;
    if (up < -0.2) biomeGlow += vec3(0.25, 0.72, 0.95) * bmCaustic(wp) * smoothstep(-0.2, -0.7, up) * 0.28;
  } else if (bi == 6) {
    // snow: white, blue where it turns from the light, glittering
    col = vec3(0.78, 0.83, 0.9) * (0.9 + 0.12 * mid + 0.05 * fine);
    col = mix(col * vec3(0.62, 0.74, 0.95), col, smoothstep(-0.1, 0.8, up));
    biomeGlow += vec3(1.0) * bmGlint(wp, n, vd, 6.0, 0.4) * near * 2.2;
  } else if (bi == 7) {
    // ashstone: ash-grey, dusted pale on top; the floor is grave soil, the walls carry faint violet
    // veins that breathe
    col = base * (0.62 + 0.5 * mid) * (0.9 + 0.2 * fine);
    float floorK = smoothstep(0.5, 0.8, up);
    vec3 soil = vec3(0.075, 0.062, 0.07) * (0.75 + 0.5 * nzFbm2(wp.xz * 0.7)) * (0.9 + 0.2 * fine);
    col = mix(col, soil, floorK);
    float dust = floorK * smoothstep(0.45, 0.8, nzFbm2(wp.xz * 0.35 + 5.0));
    col = mix(col, vec3(0.16, 0.15, 0.17), dust * 0.6);
    // bits of old bone in the soil
    col = mix(col, vec3(0.36, 0.34, 0.3), bmSpecks(wp * vec3(1.0, 0.4, 1.0), 2.8, 0.14) * floorK * 0.8);
    vec3 wv = wp * 0.24 + (vec3(nzValue3(wp * 0.13), nzValue3(wp * 0.13 + 4.1), nzValue3(wp * 0.13 + 8.3)) - 0.5) * 1.1;
    vec2 cl = bmCellTri(wv, n);
    float vein = (1.0 - smoothstep(0.0, 0.022, cl.y - cl.x)) * smoothstep(0.6, 0.78, nzValue3(wp * 0.1)) * (1.0 - floorK);
    col = mix(col, vec3(0.08, 0.05, 0.13), vein * 0.5);
    biomeGlow += vec3(0.55, 0.32, 1.0) * vein * (0.28 + 0.2 * sin(uTime * 0.8 + wp.y * 0.35 + wp.x * 0.1));
  } else {
    // bonestone: pale old bone, finely pitted, yellowed in places
    col = vec3(0.42, 0.39, 0.34) * (0.85 + 0.3 * mid);
    vec2 pits = bmCellTri(wp * 3.2, n);
    col *= 1.0 - (1.0 - smoothstep(0.05, 0.12, pits.x)) * 0.35;
    col *= mix(vec3(1.0), vec3(0.85, 0.78, 0.62), smoothstep(0.45, 0.8, nzFbm3(wp * 0.35)));
  }
  // underground everything reads lit from above (like the rest of the rock)
  col *= mix(0.72, 1.1, up * 0.5 + 0.5);
  c = col * ao;
}
`; // sb (35117)
