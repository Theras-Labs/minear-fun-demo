// Port of play-inUT-NSi.js lines 28925-28956: the murk post pass (chromatic aberration, brown tint,
// vignette, film grain) used while burrowing inside rock.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface MurkPassUniforms {
  [name: string]: THREE.IUniform;
  tDiffuse: { value: THREE.Texture | null };
  uMurk: { value: number };
  uTime: { value: number };
  uTint: { value: THREE.Color };
}

export type MurkPass = ShaderPass & { uniforms: MurkPassUniforms };

export function createMurkPass(): MurkPass { // jp (28925)
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uMurk: { value: 0 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(9072472) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uMurk; uniform float uTime; uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c);
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        if (uMurk > 0.001) {
          float ca = uMurk * 0.006 * r;
          col.r = texture2D(tDiffuse, vUv + c * ca).r;
          col.b = texture2D(tDiffuse, vUv - c * ca).b;
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(l) * uTint * 1.7, uMurk * 0.38);
          col *= mix(1.0, smoothstep(0.92, 0.18, r), uMurk * 0.75);
          float n = fract(sin(dot(floor(vUv * vec2(960.0, 540.0)) + fract(uTime * 13.0) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
          col += (n - 0.5) * 0.085 * uMurk * (0.25 + l);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }) as MurkPass;
}
