// The asset loads of the bootstrap dz (play-inUT-NSi.js 75723-75731): every model loads in parallel
// before the game class is built, and each finished load moves the loading bar (0.02 + 0.4 * done / count).
import { loadMiner, type MinerAsset } from '../miner/loader';
import { loadHub } from '../hub/hubAssets';
import { loadCaveKit, type CaveKit } from '../hub/caveKit';
import { loadFoes } from '../foes/assets';
import { loadWorm } from '../worm/wormAssets';
import { loadBiomeKit, type BiomeKit } from '../cave/biomeKit';
import { loadChests } from '../chests/chests';
import { loadGear } from '../menus/gearIcons';
import { loadStranger } from '../npc/stranger';
import type * as THREE from 'three';

export interface GameAssets {
  miner: MinerAsset; // QT
  hub: THREE.Object3D; // FO
  foes: Awaited<ReturnType<typeof loadFoes>>; // ZP
  worm: Awaited<ReturnType<typeof loadWorm>>; // fI
  cave: CaveKit | null; // AC
  biome: BiomeKit | null; // aC
  chests: THREE.Group | null; // JO
  gear: THREE.Group | null; // pM
  stranger: THREE.Group | null; // nR
}

export async function loadAssets(progress: (k: number) => void): Promise<GameAssets> {
  const loads = [loadMiner(), loadHub(), loadFoes(), loadWorm(), loadCaveKit(), loadBiomeKit(), loadChests(), loadGear(), loadStranger()] as const;
  let done = 0;
  for (const p of loads) p.then(() => progress(0.02 + 0.4 * (++done / loads.length)));
  const [miner, hub, foes, worm, cave, biome, chests, gear, stranger] = await Promise.all(loads);
  return { miner, hub, foes, worm, cave, biome, chests, gear, stranger };
}
