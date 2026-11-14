// The miner wardrobe wiring of the game class KR (play-inUT-NSi.js):
//   70537-70539  the constructor: model.setWardrobe(gear scene), syncLook(), player.speedMul = state.moveMul
//   73018-73046  KR.syncLook: the miner wears what is equipped (drill bit and tank colors, drill bit size from the
//                drill power, and the worn models of head, body, launcher, pack and the two charms)
// KR calls syncLook from onStatsChanged (73248, src/menus/economy.ts EconomyHost.syncLook) after every equip,
// unequip, Wellspring send and card pick. The look record it keeps (KR.look) is what multiplayer sends to the
// other miners (mp.sendLook, EO 70703); solo keeps the record and sends nothing.
import * as THREE from 'three';
import { GEAR_BY_ID, gearModelKey } from '../state/gear';
import { TIER_COLORS } from '../state/progression';
import type { PlayerState } from '../state/playerState';
import type { WearSlot } from '../miner/pieces';

/** KR.look (73031): the miner's look as other miners see it. */
export interface MinerLook {
  /** Drill bit color (null: the default bit color). */
  bit: number | null;
  /** Jetpack tank color (null: the default tank color). */
  tank: number | null;
  power: number;
  lvl: number;
  /** Worn model key per slot ("Model" or "Model#rrggbb"), null when the slot is empty. */
  wear: Record<WearSlot, string | null>;
}

/** The game (KR) as the wardrobe reads and writes it. */
export interface WardrobeHost {
  state: PlayerState;
  /** eD (src/miner/rig.ts MinerRig). */
  model: {
    setWardrobe(scene: THREE.Object3D | null): void;
    setLook(bitHex: number | null | undefined, tankHex: number | null | undefined, level: number): void;
    wear(slot: WearSlot, model: string | null | undefined): void;
  };
  player: { speedMul: number };
  /** KR.look (multiplayer reads it; set by syncLook). */
  look?: MinerLook | null;
}

/** The slots syncLook dresses, in its order (73029). */
const WEAR_ORDER = [`head`, `body`, `launcher`, `pack`, `charm1`, `charm2`] as const;

/** KR.syncLook (73018): the miner model wears the equipped gear. */
export function syncLook(g: WardrobeHost): void { // KR.syncLook (73018)
  const e = g.state.gear,
    t = (t: WearSlot) => (e[t] ? gearModelKey(GEAR_BY_ID[e[t]!.base]) : null),
    n = e.drill
      ? new THREE.Color(TIER_COLORS[e.drill.tier])
          .lerp(new THREE.Color(GEAR_BY_ID[e.drill.base].tint ?? 13620957), 0.45)
          .getHex()
      : null,
    r =
      e.pack && t(`pack`) === `G_Jetpack`
        ? new THREE.Color(TIER_COLORS[e.pack.tier]).lerp(new THREE.Color(7316438), 0.35).getHex()
        : null;
  g.model.setLook(n, r, g.state.drill.power);
  for (const e of WEAR_ORDER) g.model.wear(e, t(e));
  g.look = {
    bit: n,
    tank: r,
    power: g.state.drill.power,
    lvl: g.state.level,
    wear: {
      head: t(`head`),
      body: t(`body`),
      launcher: t(`launcher`),
      pack: t(`pack`),
      charm1: t(`charm1`),
      charm2: t(`charm2`),
    },
  };
  // mp?.sendLook(): solo has no room to tell
}

/**
 * KR constructor 70537-70539, right after the icon studio (gearIcons.build / buildLoot): the wardrobe is the
 * gear.glb scene (src/menus/gearIcons.ts loadGear, null when it is missing), the miner puts the gear on, and the
 * move speed follows the stats. Call it BEFORE Portrait.attach (src/menus/portrait.ts), which then puts the
 * miner, the worn gear included, on the portrait layer (70540).
 */
export function dressMiner(g: WardrobeHost, gearScene: THREE.Object3D | null): void { // KR constructor (70537)
  g.model.setWardrobe(gearScene);
  syncLook(g);
  g.player.speedMul = g.state.moveMul;
}
