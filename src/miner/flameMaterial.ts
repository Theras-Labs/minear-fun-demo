// Port of play-inUT-NSi.js 29319-29351: jetpack flame cone material (only the miner rig uses it).
import * as THREE from 'three';

export type FlameMaterial = THREE.ShaderMaterial & {
  uniforms: { uTime: THREE.IUniform<number>; uPower: THREE.IUniform<number> };
};

/** Additive flame: hot white core, orange middle, red tip, 30 Hz flicker. Expects the flipped cone uv. */
export function createFlameMaterial(): FlameMaterial { // Bp (29319)
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uPower;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float facing = pow(abs(dot(normalize(vN), V)), 1.5);
        float t = 1.0 - vUv.y; // 1 at the nozzle, 0 at the tip (flipped cone uv)
        float flick = 0.75 + 0.25 * h(vec2(floor(uTime * 30.0), vUv.x * 7.0));
        vec3 hot = vec3(1.0, 0.95, 0.8), mid = vec3(1.0, 0.55, 0.15), tip = vec3(0.9, 0.2, 0.05);
        vec3 c = mix(tip, mid, smoothstep(0.1, 0.55, t));
        c = mix(c, hot, smoothstep(0.6, 0.95, t) * facing);
        float a = facing * smoothstep(0.0, 0.35, t * flick) * uPower;
        gl_FragColor = vec4(c * 3.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }) as FlameMaterial;
}
