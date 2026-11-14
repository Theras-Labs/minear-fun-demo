// Voxel material table. Bundle play-inUT-NSi.js lines 32956-33014.

/** Voxel material ids (stored in Chunk.material). Id 9 is not used. */
export const Mat = { // G (32956)
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Sand: 3,
  SandStripe: 4,
  Stone: 5,
  Slate: 6,
  Abyss: 7,
  Plaza: 8,
  Copper: 10,
  Iron: 11,
  Gold: 12,
  Mythril: 13,
  Boulder: 14,
  Obsidian: 15,
  Ember: 16,
  Void: 17,
  Heart: 18,
  Basalt: 19,
  Magma: 20,
  Mud: 21,
  Bogmoss: 22,
  Frostrock: 23,
  Ice: 24,
  Snow: 25,
  Ashstone: 26,
  Bonestone: 27,
} as const;

export type MatName = keyof typeof Mat;
export type MatId = (typeof Mat)[MatName];

export type OreItemId = 'copper' | 'iron' | 'gold' | 'mythril';

export interface MaterialDef {
  name: string;
  /** Base color as a 24-bit int (sRGB hex). */
  color: number;
  /** Hardness; Infinity = undiggable. */
  hardness: number;
  glow: number;
  /** Item id dropped when this ore is mined. */
  ore?: OreItemId;
}

/** Per-material definition, keyed by material id. */
export const MATERIALS: Record<number, MaterialDef> = { // ov (32985)
  [Mat.Air]: { name: `Air`, color: 0, hardness: 0, glow: 0 },
  [Mat.Grass]: { name: `Grass`, color: 7320646, hardness: 1, glow: 0 },
  [Mat.Dirt]: { name: `Dirt`, color: 11566418, hardness: 1, glow: 0 },
  [Mat.Sand]: { name: `Sandstone`, color: 15117678, hardness: 1.6, glow: 0 },
  [Mat.SandStripe]: { name: `Sandstone`, color: 13931099, hardness: 1.6, glow: 0 },
  [Mat.Stone]: { name: `Stone`, color: 10986178, hardness: 4, glow: 0 },
  [Mat.Slate]: { name: `Slate`, color: 6194324, hardness: 7, glow: 0 },
  [Mat.Abyss]: { name: `Abyssal Rock`, color: 5983104, hardness: 11, glow: 0.02 },
  [Mat.Plaza]: { name: `Plaza`, color: 7320646, hardness: 1 / 0, glow: 0 },
  [Mat.Copper]: { name: `Copper`, color: 16747082, hardness: 1.8, glow: 0.05, ore: `copper` },
  [Mat.Iron]: { name: `Iron`, color: 15260875, hardness: 3.6, glow: 0.04, ore: `iron` },
  [Mat.Gold]: { name: `Gold`, color: 16765500, hardness: 5, glow: 0.14, ore: `gold` },
  [Mat.Mythril]: { name: `Mythril`, color: 7336959, hardness: 8, glow: 0.35, ore: `mythril` },
  [Mat.Boulder]: { name: `Boulder`, color: 9273715, hardness: 3, glow: 0 },
  [Mat.Obsidian]: { name: `Obsidian`, color: 3952494, hardness: 17, glow: 0.05 },
  [Mat.Ember]: { name: `Emberstone`, color: 9325626, hardness: 25, glow: 0.14 },
  [Mat.Void]: { name: `Voidstone`, color: 4930428, hardness: 34, glow: 0.07 },
  [Mat.Heart]: { name: `Heartstone`, color: 9650303, hardness: 44, glow: 0.22 },
  [Mat.Basalt]: { name: `Basalt`, color: 4866118, hardness: 9, glow: 0.02 },
  [Mat.Magma]: { name: `Magma Rock`, color: 8008216, hardness: 7, glow: 0.3 },
  [Mat.Mud]: { name: `Bog Mud`, color: 4864550, hardness: 2, glow: 0 },
  [Mat.Bogmoss]: { name: `Mossrock`, color: 4608058, hardness: 4, glow: 0.03 },
  [Mat.Frostrock]: { name: `Frostrock`, color: 10272728, hardness: 6, glow: 0.02 },
  [Mat.Ice]: { name: `Ice`, color: 12576511, hardness: 3, glow: 0.08 },
  [Mat.Snow]: { name: `Snow`, color: 15791871, hardness: 1, glow: 0.02 },
  [Mat.Ashstone]: { name: `Ashstone`, color: 5327456, hardness: 6, glow: 0 },
  [Mat.Bonestone]: { name: `Bonestone`, color: 13616818, hardness: 5, glow: 0.02 },
};

/** Grass side color (0xa9794f) for grass vertices on steep faces (mesher). */
export const GRASS_SIDE_COLOR = 11106639; // sv (33014)
