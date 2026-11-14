// Port of play-inUT-NSi.js 45806-45834: miner model loader (ZT, QT), plus MINEAR's default body, nearmol.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { BODY_BASE, BODY_CLASSIC, BODY_JET, BODY_MOLE_JACKET, BODY_NEARMOL, BODY_SOFT, BODY_V5, type MinerBody } from './presets';
import { retargetClip } from './retarget';
import { downscaleTextures } from './textureDownscale';

/** Game assets are served from public/ (public/models, public/draco). */
export const ASSET_BASE = '';
/** MINEAR's own models (folder public/minear). */
export const MINEAR_BASE = '/minear';

/** Loaded miner model: the GLB scene, its clips and the body preset. */
export interface MinerAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  body: MinerBody;
}

/**
 * Miner body variant. MINEAR plays as `nearmol`; `localStorage['minear.body'] = 'classic'` brings back the
 * original miner (for comparison while porting).
 */
export function minerVariant(): string { // ZT (45806)
  try {
    if (localStorage.getItem(`minear.body`) === `classic`) return `classic`;
  } catch {
    /* storage blocked */
  }
  return `nearmol`;
}

/** Loads the player miner: nearmol (default), miner4.glb + miner_anims.glb (classic), else miner_<variant>.glb. */
export async function loadMiner(): Promise<MinerAsset> { // QT (45809)
  const variant = minerVariant();
  if (variant === `nearmol`) return loadNearmol();
  if (variant !== `classic`) {
    const draco = new DRACOLoader().setDecoderPath(`${ASSET_BASE}/draco/`);
    const body = variant === `soft` ? BODY_SOFT : variant === `jet` ? BODY_JET : variant === `v5` ? BODY_V5 : BODY_BASE;
    const [model, anims] = await Promise.all([
      new GLTFLoader().setDRACOLoader(draco).loadAsync(`${ASSET_BASE}/models/miner_${variant}.glb`),
      body.clipK ? new GLTFLoader().loadAsync(`${ASSET_BASE}/models/miner_anims.glb`) : null,
    ]);
    draco.dispose();
    downscaleTextures(model.scene);
    return {
      scene: model.scene,
      clips: anims ? retargetClip(anims.animations, anims.scene, model.scene, body.clipK!, body.arms) : model.animations,
      body,
    };
  }
  const loader = new GLTFLoader();
  const [model, anims] = await Promise.all([
    loader.loadAsync(`${ASSET_BASE}/models/miner4.glb`),
    loader.loadAsync(`${ASSET_BASE}/models/miner_anims.glb`),
  ]);
  downscaleTextures(model.scene);
  return { scene: model.scene, clips: anims.animations, body: BODY_CLASSIC };
}

/** The player's mole model: nearmol.glb when this checkout has it (it is kept local, not in git), else the
 *  mole_jacket.glb fallback (CC-BY-4.0, credit in README). Both use the KayKit Rig_Medium
 *  skeleton and a `hatslot`. The merchants use the same pick (minear-r3f/src/npc/merchants.ts). */
export async function loadMole(loader: GLTFLoader): Promise<{ gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>; body: MinerBody; file: string }> {
  // dev only: ?mole=jacket shows the fallback, as a fresh copy of the repository (no nearmol.glb) plays it
  const forceJacket = import.meta.env.DEV && typeof location !== `undefined` && new URLSearchParams(location.search).get(`mole`) === `jacket`;
  try {
    if (forceJacket) throw Error(`?mole=jacket`);
    return { gltf: await loader.loadAsync(`${MINEAR_BASE}/nearmol.glb`), body: BODY_NEARMOL, file: `nearmol.glb` };
  } catch {
    return { gltf: await loader.loadAsync(`${MINEAR_BASE}/mole_jacket.glb`), body: BODY_MOLE_JACKET, file: `mole_jacket.glb` };
  }
}

/**
 * nearmol: the mole body, its hard hat in `hatslot`, and the miner's jetpack (back) taken from miner4.glb.
 * Both skeletons have the KayKit rest angles, so a part keeps its transform relative to its bone; the
 * jetpack then moves back to sit on the mole's wider back. There is no drill model (see below).
 */
async function loadNearmol(): Promise<MinerAsset> {
  const loader = new GLTFLoader();
  const [picked, hat, miner, anims, crawl] = await Promise.all([
    loadMole(loader),
    loader.loadAsync(`${MINEAR_BASE}/hats/hard_hat.glb`),
    loader.loadAsync(`${ASSET_BASE}/models/miner4.glb`),
    loader.loadAsync(`${ASSET_BASE}/models/miner_anims.glb`),
    loader.loadAsync(`${MINEAR_BASE}/anims/crawl.glb`),
  ]);
  const { gltf: mole, body, file } = picked;
  const scene = mole.scene;
  scene.updateMatrixWorld(true);
  miner.scene.updateMatrixWorld(true);
  const bone = (name: string) => {
    const node = scene.getObjectByName(name);
    if (!node) throw Error(`${file} is missing node "${name}"`);
    return node;
  };
  const take = (name: string, into: THREE.Object3D) => {
    const part = miner.scene.getObjectByName(name);
    if (!part) throw Error(`miner4.glb is missing node "${name}"`);
    into.add(part); // keeps position / rotation / scale relative to the bone
  };

  // No drill model: nearmol digs with its claws (the crawl replaces the drill pose). The rig and the drill
  // effects still need the drill bit node (tip and spin axis), so an empty node takes its place in the hand.
  const bit = miner.scene.getObjectByName(`M4_DrillBit`);
  if (!bit) throw Error(`miner4.glb is missing node "M4_DrillBit"`);
  const tip = new THREE.Object3D();
  tip.name = bit.name;
  tip.position.copy(bit.position);
  tip.quaternion.copy(bit.quaternion);
  tip.scale.copy(bit.scale);
  bone(`handr`).add(tip);

  // the jetpack on the back
  const chest = bone(`chest`);
  const jet = new THREE.Group();
  jet.name = `NM_Jetpack`;
  chest.add(jet);
  for (const name of [`M4_Tanks`, `M4_TankMetal`, `M4_NozzleL`, `M4_NozzleR`]) take(name, jet);
  scene.updateMatrixWorld(true);
  const tankBox = new THREE.Box3();
  for (const name of [`M4_Tanks`, `M4_TankMetal`]) tankBox.expandByObject(scene.getObjectByName(name)!);
  const backZ = backSurfaceZ(scene, (tankBox.min.y + tankBox.max.y) / 2);
  // glTF forward is +Z: the tank's front face (max z) moves to the mole's back (min z), a little inside it
  const shift = new THREE.Vector3(0, 0, backZ - tankBox.max.z + 0.04);
  jet.position.add(shift.applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()).invert()));

  // the hard hat in its slot; the lamp light hangs on its front
  const hatGroup = new THREE.Group();
  hatGroup.name = `M4_Hat`;
  hatGroup.add(hat.scene);
  bone(`hatslot`).add(hatGroup);
  const lamp = new THREE.Object3D();
  lamp.name = `M4_LampAnchor`;
  lamp.position.set(0, 0.42, 0.5);
  hatGroup.add(lamp);
  // the rig looks for an eyes node (a Blink shape key makes it blink; nearmol's eyes have none)
  const eyes = new THREE.Group();
  eyes.name = `M4_Eyes`;
  bone(`head`).add(eyes);

  downscaleTextures(scene);
  const clips = retargetClip([...anims.animations, ...crawl.animations], anims.scene, scene, body.clipK!);
  return { scene, clips, body };
}

/** The most backward (lowest z) point of the mole's skinned meshes near height y, within the middle of the back. */
function backSurfaceZ(scene: THREE.Object3D, y: number): number {
  let z = Infinity;
  const p = new THREE.Vector3();
  scene.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const pos = mesh.geometry.getAttribute(`position`);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(p.y - y) < 0.12 && Math.abs(p.x) < 0.3) z = Math.min(z, p.z);
    }
  });
  return isFinite(z) ? z : 0;
}
