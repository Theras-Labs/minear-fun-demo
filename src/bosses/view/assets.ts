// Port of play-inUT-NSi.js 65923-65942: the boss asset loader OI. Loads bosses.glb (B_Titan) and boss_anims.glb
// (the shared humanoid clips) with Draco and returns the scene with all clips, or null (with a warning) when a
// model is missing.
// Asset paths are absolute paths under public/ (/models, /draco).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { downscaleTextures } from '../../miner/textureDownscale';

/** The boss scene (B_Titan) and every boss animation clip. */
export interface BossAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export async function loadBosses(): Promise<BossAsset | null> { // OI (65923)
  try {
    const e = new DRACOLoader().setDecoderPath(`/draco/`);
    const t = new GLTFLoader().setDRACOLoader(e);
    const [n, i] = await Promise.all([t.loadAsync(`/models/bosses.glb`), t.loadAsync(`/models/boss_anims.glb`)]);
    e.dispose();
    downscaleTextures(n.scene, 768);
    return { scene: n.scene, clips: [...i.animations] };
  } catch (e) {
    console.warn(`boss models missing`, e);
    return null;
  }
}
