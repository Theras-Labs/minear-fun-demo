// Port of the post chain built in KR's constructor (play-inUT-NSi.js 70256-70283):
// RenderPass -> outline (painterly only) -> UnrealBloom (with an HDR firefly clamp) -> grade -> murk -> OutputPass -> dread.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OutlinePass } from './outlinePass';
import { createGradePass } from './gradePass';
import { createMurkPass } from './murkPass';
import { createDreadPass } from './dreadPass';
import { MSAA, type Quality } from '../game/settings';

export interface PostChain {
  composer: EffectComposer;
  outline: OutlinePass;
  bloom: UnrealBloomPass;
  grade: ReturnType<typeof createGradePass>;
  murk: ReturnType<typeof createMurkPass>;
  dread: ReturnType<typeof createDreadPass>;
}

export function createPostChain(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality): PostChain {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: MSAA[quality] ?? 4,
    depthTexture: new THREE.DepthTexture(size.x, size.y),
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(camera);
  outline.enabled = false;
  composer.addPass(outline);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.25, 0.4, 1.1);
  // 70268-70275: clamp HDR fireflies to a max channel of 4 before the bright pass
  const high = bloom.materialHighPassFilter;
  high.fragmentShader = high.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    `vec4 texel = texture2D( tDiffuse, vUv );
texel.rgb = min(texel.rgb, vec3(6.0e4));
texel.rgb *= min(1.0, 4.0 / max(max(texel.r, max(texel.g, texel.b)), 1e-4));`,
  );
  high.needsUpdate = true;
  composer.addPass(bloom);
  const grade = createGradePass();
  composer.addPass(grade);
  const murk = createMurkPass();
  composer.addPass(murk);
  composer.addPass(new OutputPass());
  const dread = createDreadPass();
  composer.addPass(dread);
  return { composer, outline, bloom, grade, murk, dread };
}
