// Port of play-inUT-NSi.js 62507-62521: the foe asset loader ZP. Loads foes.glb and foe_anims.glb with
// Draco, and merges the optional golem (F_Golem) and burrower drill (F_W_Drill) nodes into the foe scene.
// Asset paths are absolute paths under public/ (/models, /draco).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { downscaleTextures } from '../miner/textureDownscale';

/** The foe scene (all foe templates and weapons) and the shared foe animation clips. */
export interface FoeAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export async function loadFoes(): Promise<FoeAsset> { // ZP (62507)
  const e = new DRACOLoader().setDecoderPath(`/draco/`);
  const t = new GLTFLoader().setDRACOLoader(e);
  const [n, r, i, a] = await Promise.all([
    t.loadAsync(`/models/foes.glb`),
    t.loadAsync(`/models/foe_anims.glb`),
    t.loadAsync(`/models/golem.glb`).catch(() => null),
    t.loadAsync(`/models/burrower.glb`).catch(() => null),
  ]);
  e.dispose();
  const o = i?.scene.getObjectByName(`F_Golem`);
  if (o) n.scene.add(o);
  const s = a?.scene.getObjectByName(`F_W_Drill`);
  if (s) n.scene.add(s);
  downscaleTextures(n.scene);
  return { scene: n.scene, clips: r.animations };
}
