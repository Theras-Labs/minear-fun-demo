// Port of play-inUT-NSi.js 35439-35472: three-mesh-bvh prototype install (35439-35441), chunk record _b
// (35443-35469) and the padded mesher scratch arrays vb/yb/bb (35470-35472). Also the chunk key Ey (34025).
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { MESH_GRID } from './surfaceNets';
import type { TerrainBatch } from './terrainPager';

// 35439-35441: the original installs three-mesh-bvh on the three classes at import time.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree; // X_
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree; // Z_
THREE.Mesh.prototype.raycast = acceleratedRaycast; // J_

/** Ey (34025): unique numeric key of a chunk coordinate. */
export const chunkKey = (cx: number, cy: number, cz: number): number => // Ey (34025)
  ((cx + 32768) * 65536 + (cz + 32768)) * 8192 + (cy + 4096);

/** The natural (generated) copy of a chunk, kept before its first edit. */
export interface ChunkNatural {
  density: Uint8Array;
  material: Uint8Array;
}

export class Chunk { // _b (35443)
  cx: number;
  cy: number;
  cz: number;
  density: Uint8Array;
  material: Uint8Array;
  /** 0 = empty, 1 = full, -1 = mixed. */
  uniform: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  dirty = true;
  modified = false;
  meshed = false;
  gemsSpawned = false;
  dug: Uint8Array | null = null;
  nat: ChunkNatural | null = null;
  surface = false;
  page: TerrainBatch | null = null;
  room = -1;
  inst = -1;
  constructor(cx: number, cy: number, cz: number, density: Uint8Array, material: Uint8Array, uniform: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.density = density;
    this.material = material;
    this.uniform = uniform;
  }
}

/** vb (35470): padded 20^3 density grid filled by ChunkManager.gather for the mesher. */
export const PAD_DENSITY = new Uint8Array(MESH_GRID * MESH_GRID * MESH_GRID); // vb (35470)
/** yb (35471): padded 20^3 material grid. */
export const PAD_MATERIAL = new Uint8Array(MESH_GRID * MESH_GRID * MESH_GRID); // yb (35471)
/** bb (35472): padded 20^3 dug mask. */
export const PAD_DUG = new Uint8Array(MESH_GRID * MESH_GRID * MESH_GRID); // bb (35472)
