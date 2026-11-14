// MINEAR digging tools (folder: minear-r3f/src/game). The Claws slot (internal slot `drill`; MINEAR has no
// drill) holds one of three tool types, each good on its own ground (user, 2026-11-14):
//   claws     Burrow, Serrated and Wide Claws: the same power on every ground
//   gauntlet  Digging Gauntlet: strong in ore veins (metal ground), a little weaker elsewhere
//   pump      Jet Pump: a water jet, strong in soft ground (dirt, grass, sandstone, mud, bog moss, snow),
//             weaker in hard rock
// The factor multiplies Burrow Power against the rock ahead: minear-r3f/src/game/Game.ts (boreSpeed and the
// dig calls) passes toolMul through world.dig to minear-r3f/src/world/edit.ts digSphere.
// Drawings: minear-r3f/src/menus/toolIcons.ts.
import { Mat } from '../world/materials';

export type DigTool = `claws` | `gauntlet` | `pump`;

/** Gear base id -> tool type (every other Claws-slot base is claws). */
const TOOL_OF_BASE: Record<string, DigTool> = { gauntlet: `gauntlet`, jetpump: `pump` };

/** The tool type of a Claws-slot gear base (claws when nothing is worn). */
export const toolOf = (base?: string | null): DigTool => (base && TOOL_OF_BASE[base]) || `claws`;

const METAL = new Set<number>([Mat.Copper, Mat.Iron, Mat.Gold, Mat.Mythril]);
const SOFT = new Set<number>([Mat.Grass, Mat.Dirt, Mat.Sand, Mat.SandStripe, Mat.Mud, Mat.Bogmoss, Mat.Snow]);

/** Strong ground factor, and the factor everywhere else. */
const FACTOR: Record<DigTool, [number, number]> = { claws: [1, 1], gauntlet: [1.8, 0.9], pump: [1.8, 0.85] };

/** Burrow Power factor of a tool against a material. */
export function toolMul(tool: DigTool, mat: number): number {
  if (tool === `claws`) return 1;
  const strong = tool === `gauntlet` ? METAL.has(mat) : SOFT.has(mat);
  return FACTOR[tool][strong ? 0 : 1];
}

/** One line for the player: what the tool is good at. */
export const TOOL_NOTE: Record<DigTool, string> = {
  claws: `Claws: the same power on every ground`,
  gauntlet: `Gauntlet: +80% power in ore veins, -10% elsewhere`,
  pump: `Jet Pump: +80% power in dirt, sand, mud and snow, -15% in hard rock`,
};
