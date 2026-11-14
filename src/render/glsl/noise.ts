// Port of play-inUT-NSi.js lines 28767-28795: the shared GLSL noise library (hashes, value noise, fbm).
// Injected with ${NOISE_GLSL} into the rock, grass, painterly and terrain shaders.

export const NOISE_GLSL = `
float nzHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float nzHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 nzHash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec4 nzHash42(vec2 p) { vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
float nzValue2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(nzHash12(i), nzHash12(i + vec2(1, 0)), u.x), mix(nzHash12(i + vec2(0, 1)), nzHash12(i + vec2(1, 1)), u.x), u.y);
}
float nzValue3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(nzHash13(i), nzHash13(i + vec3(1, 0, 0)), u.x), mix(nzHash13(i + vec3(0, 1, 0)), nzHash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(nzHash13(i + vec3(0, 0, 1)), nzHash13(i + vec3(1, 0, 1)), u.x), mix(nzHash13(i + vec3(0, 1, 1)), nzHash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float nzFbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * nzValue2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s / 0.9375;
}
float nzFbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * nzValue3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
`; // kp (28767)
