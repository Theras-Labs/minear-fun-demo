// Port of play-inUT-NSi.js 65520-65534: the worm asset loader fI. Loads /models/worm.glb with Draco and returns
// the head, segment (with the W_Spines child mesh) and tail nodes, or null when the model or a node is missing.
// The bootstrap dz loads it in parallel with the other models (75725) and passes it to the game, which builds
// the worm view only when it loaded (70549).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { downscaleTextures } from '../miner/textureDownscale';

export interface WormAsset {
  head: THREE.Object3D;
  segment: THREE.Object3D;
  tail: THREE.Object3D;
}

export async function loadWorm(): Promise<WormAsset | null> { // fI (65520)
  try {
    const e = new DRACOLoader().setDecoderPath(`/draco/`);
    const t = await new GLTFLoader().setDRACOLoader(e).loadAsync(`/models/worm.glb`);
    e.dispose();
    const n = t.scene;
    downscaleTextures(n);
    const r = n.getObjectByName(`W_Head`);
    const i = n.getObjectByName(`W_Segment`);
    const a = n.getObjectByName(`W_Tail`);
    return !r || !i || !a ? null : { head: r, segment: i, tail: a };
  } catch (e) {
    console.warn(`worm model missing`, e);
    return null;
  }
}
