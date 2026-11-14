// Port of play-inUT-NSi.js lines 69924-69984: the painterly depth-edge outline pass. It darkens pixels at
// depth discontinuities. It reads readBuffer.depthTexture, so the composer render target needs a DepthTexture.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class OutlinePass extends Pass { // fR (69924)
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  quad: FullScreenQuad;
  mat: THREE.ShaderMaterial;
  constructor(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
    super();
    this.camera = camera;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1e3 },
        uTexel: { value: new THREE.Vector2() },
        uStrength: { value: 0.75 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth;
        uniform float uNear; uniform float uFar; uniform vec2 uTexel; uniform float uStrength;
        varying vec2 vUv;
        float linDepth(vec2 uv) {
          float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float d0 = linDepth(vUv);
          // the furthest of the neighbours (a pixel and a half out), behind this one
          vec2 o = uTexel * 1.5;
          float dMax = max(max(linDepth(vUv + vec2(o.x, 0.0)), linDepth(vUv - vec2(o.x, 0.0))),
                           max(linDepth(vUv + vec2(0.0, o.y)), linDepth(vUv - vec2(0.0, o.y)))) - d0;
          float rel = dMax / max(d0, 1e-3);
          float edge = smoothstep(0.22, 0.55, rel) * smoothstep(1.2, 3.5, dMax);
          // (nothing right at the lens; and fading off far away, where the land is only haze)
          edge *= smoothstep(1.0, 3.0, d0) * (1.0 - smoothstep(220.0, 600.0, d0));
          col.rgb = mix(col.rgb, col.rgb * vec3(0.34, 0.42, 0.38), edge * uStrength);
          gl_FragColor = col;
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.needsSwap = true;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
