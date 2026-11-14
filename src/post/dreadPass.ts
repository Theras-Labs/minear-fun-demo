// Port of play-inUT-NSi.js lines 29112-29158: the dread post pass (chunky pixels, torn scanlines, sick
// palette, ordered-dither posterize, grain, heartbeat vignette). Disabled until dread rises.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface DreadPassUniforms {
  [name: string]: THREE.IUniform;
  tDiffuse: { value: THREE.Texture | null };
  uDread: { value: number };
  uTime: { value: number };
  uBeat: { value: number };
  uRes: { value: THREE.Vector2 };
}

export type DreadPass = ShaderPass & { uniforms: DreadPassUniforms };

export function createDreadPass(): DreadPass { // Fp (29112)
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uDread: { value: 0 },
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uRes: { value: new THREE.Vector2(1280, 720) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uDread; uniform float uTime; uniform float uBeat; uniform vec2 uRes;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        float d = clamp(uDread, 0.0, 1.0);
        // chunky pixels (1 -> 4 screen pixels a side)
        float px = floor(mix(1.0, 4.0, d * d) + 0.5);
        vec2 grid = uRes / px;
        vec2 cell = floor(vUv * grid);
        vec2 uv = (cell + 0.5) / grid;
        // a torn scanline now and then when it's right on top of you
        uv.x += (hash(vec2(cell.y, floor(uTime * 14.0))) - 0.5) * 0.006 * smoothstep(0.75, 1.0, d) * step(0.93, hash(vec2(floor(cell.y / 6.0), floor(uTime * 9.0))));
        vec3 col = texture2D(tDiffuse, px > 1.5 ? uv : vUv).rgb;
        // bleed toward the dealer's palette: dirty reds, olive, lifted blacks
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 sick = vec3(l) * vec3(1.28, 0.84, 0.7) + vec3(0.035, 0.012, 0.0);
        col = mix(col, sick, d * 0.62);
        // crush to a few levels with an ordered dither
        float levels = mix(40.0, 5.0, d);
        float b = bayer4(cell);
        col = floor(col * levels + b) / levels;
        // crawling grain
        col += (hash(cell + fract(uTime * 7.0) * 91.7) - 0.5) * 0.11 * d;
        // edges pulse dark with the heartbeat
        vec2 c = vUv - 0.5;
        float r = length(c * vec2(1.0, 0.82));
        col *= 1.0 - d * (0.3 + 0.35 * uBeat) * smoothstep(0.22, 0.78, r);
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  }) as DreadPass;
  pass.enabled = false;
  return pass;
}
