// Port of play-inUT-NSi.js lines 29072-29111: the color grade post pass (vibrance, log contrast around
// 0.18 grey, split toning, soft vignette).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export interface GradePassUniforms {
  [name: string]: THREE.IUniform;
  tDiffuse: { value: THREE.Texture | null };
  uSat: { value: number };
  uVibrance: { value: number };
  uContrast: { value: number };
  uShadowTint: { value: THREE.Color };
  uHighTint: { value: THREE.Color };
  uVignette: { value: number };
}

export type GradePass = ShaderPass & { uniforms: GradePassUniforms };

export function createGradePass(): GradePass { // Pp (29072)
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSat: { value: 1 },
      uVibrance: { value: 0.12 },
      uContrast: { value: 1.06 },
      uShadowTint: { value: new THREE.Color(0.92, 0.97, 1.1) },
      uHighTint: { value: new THREE.Color(1.05, 1, 0.94) },
      uVignette: { value: 0.18 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uSat; uniform float uVibrance; uniform float uContrast;
      uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uVignette;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // vibrance: boost muted colors more than already-saturated ones
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float sat = (mx - mn) / max(mx, 1e-4);
        c = mix(vec3(l), c, uSat + uVibrance * (1.0 - sat));
        // contrast in log-ish space around mid grey
        vec3 lc = log2(max(c, vec3(1e-5)));
        lc = (lc - log2(0.18)) * uContrast + log2(0.18);
        c = exp2(lc);
        // split toning
        float k = smoothstep(0.0, 0.6, l);
        c *= mix(uShadowTint, uHighTint, k);
        // vignette
        vec2 d = vUv - 0.5;
        c *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(d * vec2(1.25, 1.0)));
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }`,
  }) as GradePass;
}
