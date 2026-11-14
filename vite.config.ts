import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  optimizeDeps: {
    include: [
      'three',
      'three-mesh-bvh',
      'three/addons/controls/OrbitControls.js',
      'three/addons/lights/SunLight.js',
      'three/addons/lights/SunLightShadow.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/DRACOLoader.js',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/postprocessing/EffectComposer.js',
      'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/ShaderPass.js',
      'three/addons/postprocessing/Pass.js',
      'three/addons/postprocessing/UnrealBloomPass.js',
      'three/addons/postprocessing/OutputPass.js',
    ],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
