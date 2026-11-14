// Port of play-inUT-NSi.js 51722-51901: procedural sky dome (gradient, sun/moon, stars, cloud deck,
// horizon cumulus towers, storm tint, lightning flash, cave colour underground).
import * as THREE from 'three';
import { copyAtmoUniforms } from '../render/atmosphere';

function createSkyUniforms() {
  return {
    ...copyAtmoUniforms(), // Ny()
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uMoon: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uNight: { value: 0 },
    uCover: { value: 0.45 },
    uStorm: { value: 0 },
    uTime: { value: 0 },
    uCloudOff: { value: new THREE.Vector2() },
    uUnder: { value: 0 },
    uCave: { value: new THREE.Color(0x221c38) },
    uFlash: { value: 0 },
  };
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

export class SkyDome { // sA (51722)
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  mat: THREE.ShaderMaterial;
  u: SkyUniforms;

  constructor() {
    this.u = createSkyUniforms();
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 uSun; uniform vec3 uMoon;
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uGlow; uniform vec3 uSunCol;
        uniform vec3 uCloudLit; uniform vec3 uCloudShade;
        uniform float uNight; uniform float uCover; uniform float uStorm; uniform float uTime; uniform vec2 uCloudOff;
        uniform float uUnder; uniform vec3 uCave; uniform float uFlash;
        uniform vec4 atmoLook;
        varying vec3 vDir;

        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
          for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p; a *= 0.5; }
          return s;
        }

        // 2D cloud deck density: warped fbm for the big shapes + billowy detail for puffy edges
        float deck(vec2 uv) {
          vec2 w = vec2(fbm(uv * 0.45 + 3.1), fbm(uv * 0.45 - 7.7)) - 0.5;
          float n = fbm(uv * 0.8 + w * 1.2);
          float b = 1.0 - abs(vnoise(uv * 3.1 + w * 2.0) * 2.0 - 1.0);
          float c = 1.0 - uCover;
          return smoothstep(c - 0.02, c + 0.14, n + (b - 0.5) * 0.12);
        }

        void main() {
          vec3 rd = normalize(vDir);
          float e = rd.y;
          float sd = dot(rd, uSun);

          // --- gradient
          float hz = pow(1.0 - clamp(e, 0.0, 1.0), 3.2);
          vec3 sky = mix(uZenith, uHorizon, hz);
          // brighter, warmer horizon toward the sun; cooler away from it
          float toward = pow(max(sd * 0.5 + 0.5, 0.0), 3.0);
          sky = mix(sky, uGlow, hz * hz * toward * 0.55);
          if (e < 0.0) sky = mix(uHorizon, uGround, smoothstep(0.0, -0.18, e));

          // --- stars + moon (fade in at night, hidden below the horizon)
          if (uNight > 0.01 && e > -0.05) {
            vec3 p = rd * 220.0;
            vec3 cell = floor(p);
            float h = h13(cell);
            if (h > 0.985) {
              vec3 c = cell + 0.5 + (vec3(h13(cell + 7.1), h13(cell + 3.3), h13(cell + 1.7)) - 0.5) * 0.7;
              float d = length(p - c);
              float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
              float star = smoothstep(0.32, 0.0, d) * tw * (h > 0.997 ? 1.6 : 0.7);
              sky += vec3(0.85, 0.9, 1.0) * star * uNight * smoothstep(-0.02, 0.25, e);
            }
            // soft milky band
            float band = exp(-pow(dot(rd, normalize(vec3(0.3, 0.2, 1.0))) * 3.2, 2.0));
            sky += vec3(0.16, 0.18, 0.3) * band * fbm(rd.xz * 6.0 + rd.y * 3.0) * uNight * 0.6 * smoothstep(0.0, 0.3, e);
            float md = dot(rd, uMoon);
            float moon = smoothstep(0.99935, 0.99955, md);
            // craters: darker blotches on the disc
            float cr = fbm((rd.xy - uMoon.xy) * 900.0);
            sky += vec3(0.95, 0.96, 1.0) * moon * (1.6 - cr * 0.7) * uNight;
            sky += vec3(0.35, 0.45, 0.75) * (pow(max(md, 0.0), 200.0) * 0.5 + pow(max(md, 0.0), 12.0) * 0.12) * uNight;
          }

          // --- sun disc + glow
          float day = 1.0 - uNight;
          float disc = smoothstep(0.99955, 0.9998, sd);
          sky += uSunCol * disc * 30.0 * smoothstep(-0.03, 0.02, e);
          sky += uGlow * (pow(max(sd, 0.0), 220.0) * 2.2 + pow(max(sd, 0.0), 14.0) * 0.28) * day;

          // --- cloud deck (a plane high overhead), fading into the horizon haze
          if (e > 0.0) {
            float dist = 1.0 / max(e, 0.035);
            vec2 uv = rd.xz * dist * 0.9 + uCloudOff;
            if (atmoLook.x > 0.5) {
              // painterly: the same clouds, flat and puffy like cut paper: crisp edges, two tones (sunlit
              // white, and a soft blue-grey underneath)
              float dp = deck(uv);
              float pd = smoothstep(0.3, 0.5, dp);
              if (pd > 0.001) {
                vec2 toSun = normalize(uSun.xz + 1e-4) * 0.22;
                float d2 = deck(uv + toSun);
                float lit = smoothstep(0.4, 0.6, clamp(1.0 - (d2 - dp * 0.35) * 1.6, 0.0, 1.0));
                vec3 cc = mix(mix(uCloudShade, vec3(0.85, 0.9, 0.98), 0.5), uCloudLit, lit);
                cc = mix(cc, cc * vec3(0.42, 0.45, 0.52), uStorm);
                sky = mix(sky, cc, pd * smoothstep(0.02, 0.2, e));
              }
            }
            float dens = atmoLook.x > 0.5 ? 0.0 : deck(uv);
            if (dens > 0.001) {
              vec2 toSun = normalize(uSun.xz + 1e-4) * 0.22;
              float d2 = deck(uv + toSun);
              // sun-facing rims bright, thick cores and shadowed sides darker (stylized 3-tone)
              float lit = clamp(1.0 - (d2 - dens * 0.35) * 1.6, 0.0, 1.0);
              lit = smoothstep(0.15, 0.85, lit) * 0.8 + 0.2 * (1.0 - dens * 0.6);
              vec3 cc = mix(uCloudShade, uCloudLit, lit);
              // thin edges light up when backlit
              cc += uSunCol * pow(max(sd, 0.0), 8.0) * (1.0 - dens) * 1.4 * day;
              cc = mix(cc, cc * vec3(0.42, 0.45, 0.52), uStorm);
              float fade = smoothstep(0.02, 0.22, e);
              sky = mix(sky, cc, dens * fade * 0.95);
            }
          }

          // --- cumulus towers along the horizon (angular space)
          if (e > -0.02 && e < 0.34) {
            float az = atan(rd.z, rd.x);
            float x = az * 5.0 + uCloudOff.x * 0.05;
            float top = 0.05 + fbm(vec2(x, 1.7)) * 0.2 * (0.55 + uCover * 0.9) - 0.035;
            // (painterly: calmer, softer-edged banks)
            float puff = fbm(vec2(x * 4.0, e * 16.0 + 2.0)) * mix(0.06, 0.025, atmoLook.x);
            float edge = top + puff - e;
            float body = smoothstep(0.0, mix(0.02, 0.045, atmoLook.x), edge);
            if (body > 0.001) {
              float hgt = clamp(e / max(top + puff, 1e-3), 0.0, 1.0);
              vec2 sunAz = normalize(uSun.xz + 1e-4);
              float facing = dot(normalize(rd.xz + 1e-4), sunAz) * 0.5 + 0.5;
              float lit = clamp(hgt * 0.75 + facing * 0.35 + fbm(vec2(x * 7.0, e * 40.0)) * 0.25 - 0.1, 0.0, 1.0);
              // (painterly: two flat tones)
              if (atmoLook.x > 0.5) lit = smoothstep(0.3, 0.7, lit);
              vec3 cc = mix(uCloudShade, uCloudLit, lit);
              cc += uSunCol * pow(max(sd, 0.0), 6.0) * smoothstep(0.02, 0.0, edge - 0.01) * 1.2 * day;
              cc = mix(cc, cc * vec3(0.45, 0.47, 0.55), uStorm);
              // far towers sink into the haze near the horizon
              cc = mix(cc, uHorizon, (1.0 - hgt) * 0.45);
              sky = mix(sky, cc, body * 0.92);
            }
          }

          sky += vec3(0.75, 0.8, 1.0) * uFlash;
          sky = mix(sky, uCave, uUnder);
          gl_FragColor = vec4(sky, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
}
