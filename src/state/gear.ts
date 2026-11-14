// Gear slots, the 44 gear bases, the random gear roller, item names, sell and shop prices, tier picker.
// Bundle play-inUT-NSi.js lines 53613-54080.
import { STATS } from './gearStats';
import { luckCurve } from './progression';

export type GearSlot = 'head' | 'body' | 'drill' | 'launcher' | 'pack' | 'charm1' | 'charm2';
export type GearSlotType = 'head' | 'body' | 'drill' | 'launcher' | 'pack' | 'charm';

/** Equipment slots in paper-doll order. */
export const GEAR_SLOTS: GearSlot[] = [`head`, `body`, `drill`, `launcher`, `pack`, `charm1`, `charm2`]; // qA (53613)
/** Slot -> the base slot type it takes. */
export const SLOT_TYPE: Record<GearSlot, GearSlotType> = { // JA (53614)
  head: `head`,
  body: `body`,
  drill: `drill`,
  launcher: `launcher`,
  pack: `pack`,
  charm1: `charm`,
  charm2: `charm`,
};
export const SLOT_LABELS: Record<GearSlotType, string> = { // YA (53623)
  head: `Head`,
  body: `Back`,
  drill: `Claws`,
  launcher: `Launcher`,
  pack: `Pack`,
  charm: `Charm`,
};

export interface GearBase {
  id: string;
  name: string;
  slot: GearSlotType;
  /** Node name in /models/gear.glb. */
  model: string;
  implicit: string;
  likes: string[];
  /** Color for materials named /Metal|Bit/. */
  tint?: number;
  dye?: number;
  biome?: 'ember' | 'bog' | 'frost' | 'haunt';
}

/** Gear bases (34 normal, 12 biome-only). */
export const GEAR_BASES: GearBase[] = [ // XA (53631)
  { id: `hardhat`, name: `Hard Hat`, slot: `head`, model: `G_HardHat`, implicit: `sense`, likes: [`hp`, `armor`] },
  { id: `bearhat`, name: `Bear Hat`, slot: `head`, model: `G_BearHat`, implicit: `hp`, likes: [`melee`, `regen`, `armor`] },
  { id: `knighthelm`, name: `Knight Helm`, slot: `head`, model: `G_KnightHelm`, implicit: `armor`, likes: [`hp`, `thorns`, `melee`] },
  { id: `wizardhat`, name: `Wizard Hat`, slot: `head`, model: `G_WizardHat`, implicit: `ranged`, likes: [`sense`, `rate`, `crit`] },
  { id: `bonehelm`, name: `Bone Helm`, slot: `head`, model: `G_BoneHelm`, implicit: `armor`, likes: [`melee`, `vamp`, `hp`] },
  { id: `shadehood`, name: `Shade Hood`, slot: `head`, model: `G_ShadeHood`, implicit: `crit`, likes: [`speed`, `nimble`, `ranged`] },
  { id: `witchhat`, name: `Deep Witch Hat`, slot: `head`, model: `G_WitchHat`, implicit: `fortune`, likes: [`sense`, `regen`] },
  { id: `rangercloak`, name: `Ranger Cloak`, slot: `body`, model: `G_RangerCape`, implicit: `speed`, likes: [`ranged`, `crit`, `burrow`] },
  { id: `knightcape`, name: `Knight Cape`, slot: `body`, model: `G_KnightCape`, implicit: `armor`, likes: [`hp`, `melee`, `thorns`] },
  { id: `magecape`, name: `Mage Mantle`, slot: `body`, model: `G_MageCape`, implicit: `regen`, likes: [`sense`, `rate`] },
  { id: `roguecape`, name: `Rogue Cape`, slot: `body`, model: `G_RogueCape`, implicit: `crit`, likes: [`speed`, `nimble`, `burrow`] },
  { id: `gravecloak`, name: `Grave Cloak`, slot: `body`, model: `G_GraveCloak`, implicit: `hp`, likes: [`vamp`, `armor`, `regen`] },
  { id: `bit`, name: `Burrow Claws`, slot: `drill`, model: `G_DrillBit`, implicit: `power`, likes: [`bore`, `melee`, `fortune`], tint: 13620957 },
  { id: `serrated`, name: `Serrated Claws`, slot: `drill`, model: `G_DrillBit`, implicit: `melee`, likes: [`crit`, `vamp`, `power`], tint: 14716778 },
  { id: `widebit`, name: `Wide Claws`, slot: `drill`, model: `G_DrillBit`, implicit: `bore`, likes: [`power`, `fortune`, `burrow`], tint: 9418713 },
  // MINEAR dig tools (minear-r3f/src/game/digTools.ts): strong in ore veins / in soft ground
  { id: `gauntlet`, name: `Digging Gauntlet`, slot: `drill`, model: `G_DrillBit`, implicit: `power`, likes: [`melee`, `fortune`, `gold`], tint: 12108748 },
  { id: `jetpump`, name: `Jet Pump`, slot: `drill`, model: `G_DrillBit`, implicit: `burrow`, likes: [`bore`, `speed`, `power`], tint: 6277375 },
  { id: `handxbow`, name: `Hand Crossbow`, slot: `launcher`, model: `G_Crossbow1H`, implicit: `rate`, likes: [`ranged`, `twin`, `crit`] },
  { id: `heavyxbow`, name: `Heavy Crossbow`, slot: `launcher`, model: `G_Crossbow2H`, implicit: `ranged`, likes: [`blast`, `crit`, `rate`] },
  { id: `bonexbow`, name: `Bone Repeater`, slot: `launcher`, model: `G_BoneCrossbow`, implicit: `rate`, likes: [`twin`, `bounce`, `ranged`] },
  { id: `wand`, name: `Spark Wand`, slot: `launcher`, model: `G_Wand`, implicit: `ranged`, likes: [`bounce`, `rate`, `sense`] },
  { id: `staff`, name: `Deep Staff`, slot: `launcher`, model: `G_Staff`, implicit: `ranged`, likes: [`blast`, `regen`] },
  { id: `jetpack`, name: `Jetpack`, slot: `pack`, model: `G_Jetpack`, implicit: `fuel`, likes: [`pack`, `speed`, `burrow`] },
  { id: `quiver`, name: `Ore Quiver`, slot: `pack`, model: `G_Quiver`, implicit: `pack`, likes: [`fortune`, `fuel`, `magnet`] },
  { id: `mug`, name: `Lucky Mug`, slot: `charm`, model: `G_Mug`, implicit: `gold`, likes: [`fortune`, `regen`, `magnet`] },
  { id: `tome`, name: `Tome of Echoes`, slot: `charm`, model: `G_Tome`, implicit: `sense`, likes: [`echo`, `oresight`] },
  { id: `smoke`, name: `Soot Charm`, slot: `charm`, model: `G_SmokeBomb`, implicit: `speed`, likes: [`nimble`, `crit`, `burrow`] },
  { id: `shield`, name: `Round Shield`, slot: `charm`, model: `G_ShieldRound`, implicit: `armor`, likes: [`hp`, `thorns`, `regen`] },
  { id: `buckler`, name: `Spiked Buckler`, slot: `charm`, model: `G_ShieldSpikes`, implicit: `armor`, likes: [`thorns`, `melee`, `hp`] },
  { id: `badge`, name: `Badge Shield`, slot: `charm`, model: `G_ShieldBadge`, implicit: `hp`, likes: [`armor`, `regen`, `wind`] },
  { id: `dagger`, name: `Dagger`, slot: `charm`, model: `G_Dagger`, implicit: `crit`, likes: [`melee`, `vamp`, `speed`] },
  { id: `hatchet`, name: `Hatchet`, slot: `charm`, model: `G_Axe`, implicit: `melee`, likes: [`crit`, `power`, `vamp`] },
  { id: `arrows`, name: `Arrow Bundle`, slot: `charm`, model: `G_Arrows`, implicit: `ranged`, likes: [`twin`, `rate`, `bounce`] },
  { id: `bonebuckler`, name: `Bone Buckler`, slot: `charm`, model: `G_BoneShield`, implicit: `armor`, likes: [`vamp`, `hp`, `thorns`] },
  { id: `cinderhelm`, name: `Cinder Helm`, slot: `head`, model: `G_KnightHelm`, implicit: `resfire`, likes: [`armor`, `hp`, `thorns`], dye: 6961712, biome: `ember` },
  { id: `salamander`, name: `Salamander Cape`, slot: `body`, model: `G_KnightCape`, implicit: `resfire`, likes: [`ember`, `armor`, `hp`], dye: 16734746, biome: `ember` },
  { id: `magmabit`, name: `Magma Claws`, slot: `drill`, model: `G_DrillBit`, implicit: `power`, likes: [`resfire`, `melee`, `ember`], tint: 16742972, biome: `ember` },
  { id: `mirehood`, name: `Mire Hood`, slot: `head`, model: `G_ShadeHood`, implicit: `respoison`, likes: [`venom`, `regen`, `crit`], dye: 5933620, biome: `bog` },
  { id: `bogcloak`, name: `Bog Cloak`, slot: `body`, model: `G_RangerCape`, implicit: `respoison`, likes: [`speed`, `regen`, `venom`], dye: 4876842, biome: `bog` },
  { id: `toadidol`, name: `Toad Idol`, slot: `charm`, model: `G_Mug`, implicit: `respoison`, likes: [`regen`, `venom`], dye: 8314970, biome: `bog` },
  { id: `rimehelm`, name: `Rime Helm`, slot: `head`, model: `G_KnightHelm`, implicit: `armor`, likes: [`grip`, `frost`, `hp`], dye: 11067647, biome: `frost` },
  { id: `frostmantle`, name: `Frost Mantle`, slot: `body`, model: `G_MageCape`, implicit: `grip`, likes: [`frost`, `armor`, `regen`], dye: 10475775, biome: `frost` },
  { id: `rimerepeater`, name: `Rime Repeater`, slot: `launcher`, model: `G_Crossbow1H`, implicit: `rate`, likes: [`frost`, `ranged`, `twin`], dye: 11070719, biome: `frost` },
  { id: `wraithhood`, name: `Wraith Hood`, slot: `head`, model: `G_ShadeHood`, implicit: `crit`, likes: [`vamp`, `nimble`, `speed`], dye: 9071359, biome: `haunt` },
  { id: `soulstaff`, name: `Soul Staff`, slot: `launcher`, model: `G_Staff`, implicit: `ranged`, likes: [`vamp`, `bounce`, `crit`], dye: 13218047, biome: `haunt` },
  { id: `ghostward`, name: `Ghostward`, slot: `charm`, model: `G_BoneShield`, implicit: `armor`, likes: [`vamp`, `thorns`, `nimble`], dye: 11111167, biome: `haunt` },
];

/** Model key with the dye suffix, "Model#rrggbb". */
export const gearModelKey = (e: GearBase): string =>
  e.dye === void 0 ? e.model : `${e.model}#${e.dye.toString(16).padStart(6, `0`)}`; // ZA (54012)
/** Gear base by id. */
export const GEAR_BY_ID: Record<string, GearBase> = Object.fromEntries(GEAR_BASES.map((e) => [e.id, e])); // QA (54013)

let uidCounter = Date.now() % 1e9; // $A (54014)
/** Next gear uid. */
export const nextUid = (): number => ++uidCounter; // ej (54015)

export type StatPair = [string, number];

export interface GearItem {
  uid: number;
  base: string;
  /** 0..4 */
  tier: number;
  lvl: number;
  stats: StatPair[];
  name: string;
  /** Not yet seen in the inventory. */
  fresh?: boolean;
  /** MINEAR Forge: the metal the piece was forged from (`iron`, `gold`, `mythril`); it names the piece
   *  ("Iron Knight Helm") and picks its metal icon (minear-r3f/src/menus/gearIcons.ts). Absent on loot gear. */
  ore?: string;
  /** MINEAR: the NFT token id ("g12") of a piece the chain forged (minear-r3f/contracts/items/src/gear.rs).
   *  Absent on gear that lives only in this browser (loot, old saves). */
  chain?: string;
}

/** The metal word of a forged piece. */
export const FORGE_METAL: Record<string, string> = { copper: `Copper`, iron: `Iron`, gold: `Gold`, mythril: `Mythril` };

/** Rounds a rolled stat value (0.05 steps for ' m' and ' HP/s', else whole numbers, at least 1). */
export const roundStat = (e: string, t: number): number => { // tj (54016)
  const n = STATS[e];
  return n.cap <= 2
    ? Math.max(1, Math.round(t))
    : n.unit === ` m` || n.unit === ` HP/s`
      ? Math.max(0.05, Math.round(t * 20) / 20)
      : Math.max(1, Math.round(t));
};
/** Stats per tier. */
export const STATS_PER_TIER = [1, 2, 3, 3, 4]; // nj (54024)

/** Rolls a random gear item of a tier and level. `rng`: the random source (a seeded one for gear NFTs, so every
 *  client expands a chain seed into the same stats: gearFromChain). */
export function rollGear(
  e: number,
  t: number,
  n: { base?: string; slot?: GearSlotType; biome?: string } = {},
  rng: () => number = Math.random,
): GearItem { // rj (54025)
  const r = GEAR_BASES.filter((e) =>
      n.base
        ? e.id === n.base
        : (!n.slot || e.slot === n.slot) && (n.biome ? e.biome === n.biome : !e.biome),
    ),
    i = r[Math.floor(rng() * r.length)],
    a = t <= 110 ? 0.7 + t / 110 : 1.7 + (t - 110) / 600,
    o: StatPair[] = [],
    s = (t: string, n: number) => {
      const r = STATS[t];
      let i =
        (r.per[e] || r.per[Math.max(2, e)] || r.per[4]) *
        n *
        (r.cap <= 2 ? 1 : a * (0.8 + rng() * 0.4));
      ((i = Math.min(i, r.cap)), o.push([t, roundStat(t, i)]));
    };
  s(i.implicit, 1);
  const c = STATS_PER_TIER[e],
    l = [...i.likes, `hp`, `power`, `speed`, `crit`, `pack`, `sense`, `melee`, `ranged`];
  for (let t = 0; o.length < c && t < 40; t++) {
    const t =
        rng() < 0.65
          ? i.likes[Math.floor(rng() * i.likes.length)]
          : l[Math.floor(rng() * l.length)],
      n = STATS[t];
    o.some((e) => e[0] === t) ||
      (n.perk && e < 3 && !(e === 2 && i.slot === `charm` && rng() < 0.3)) ||
      (n.perk && n.cap <= 1 && e < 4) ||
      s(t, 0.75);
  }
  const u: GearItem = { uid: nextUid(), base: i.id, tier: e, lvl: Math.round(t), stats: o, name: `` };
  return ((u.name = gearName(u)), u);
}

/** A seeded random source (sfc32) from a 64-hex-character seed: the same numbers on every client. */
export function seededRng(hex: string): () => number {
  const w = (i: number) => parseInt(hex.slice(i * 8, i * 8 + 8).padEnd(8, `0`), 16) >>> 0;
  let a = w(0);
  let b = w(1);
  let c = w(2);
  let d = w(3);
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** Uids of chain gear start here, far above nextUid's range, so they never meet. */
export const CHAIN_UID_BASE = 3_000_000_000;

/** A gear NFT (minear-r3f/contracts/items/src/gear.rs) as game gear: the stats from its seed, the enchants from
 *  its reroll seed (the built-in first stat stays, as in a reroll). The same on every client. */
export function gearFromChain(t: { token_id: string; gear: { base: string; ore: string; tier: number; lvl: number; seed: string; reroll: string | null } }): GearItem {
  const g = t.gear;
  const item = rollGear(g.tier, g.lvl, { base: g.base }, seededRng(g.seed));
  if (g.reroll) {
    const fresh = rollGear(g.tier, g.lvl, { base: g.base }, seededRng(g.reroll));
    if (fresh.stats.length > 1) item.stats = [item.stats[0], ...fresh.stats.slice(1)];
  }
  item.uid = CHAIN_UID_BASE + (Number(t.token_id.replace(/\D/g, ``)) || 0);
  item.ore = g.ore;
  item.chain = t.token_id;
  item.name = gearName(item);
  return item;
}

/** Item name: base name with a prefix (tier 1+) and a suffix (tier 2+). */
export function gearName(e: Pick<GearItem, 'base' | 'tier' | 'stats' | 'ore'>): string { // ij (54059)
  const b = GEAR_BY_ID[e.base];
  const t = { name: e.ore && FORGE_METAL[e.ore] ? `${FORGE_METAL[e.ore]} ${b.name}` : b.name };
  if (e.tier === 0) return t.name;
  const n = STATS[(e.stats[1] ?? e.stats[0])[0]].pre;
  if (e.tier === 1) return `${n} ${t.name}`;
  const r = STATS[e.stats[e.stats.length - 1][0]].suf;
  return `${n} ${t.name} ${r}`;
}

/** Sell price at the Trading Post. */
export function gearSellPrice(e: Pick<GearItem, 'tier' | 'lvl'>): number { // aj (54067)
  return Math.round([12, 35, 90, 240, 620][e.tier] * (0.8 + e.lvl / 150));
}

/** Shop buy price. */
export function gearShopPrice(e: Pick<GearItem, 'tier' | 'lvl'>): number { // oj (54070)
  return Math.round(([60, 150, 420, 1100, 2800][e.tier] * (0.8 + e.lvl / 150)) / 5) * 5;
}

/** Weighted index with a chance t to go one higher. */
export function pickTier(e: readonly number[], t = 0): number { // sj (54073)
  let n = 0;
  for (const t of e) n += t;
  let r = Math.random() * n;
  for (let n = 0; n < e.length; n++)
    if (((r -= e[n]), r <= 0)) return n < e.length - 1 && Math.random() < t ? n + 1 : n;
  return 0;
}

/**
 * KR's loot roll rj(sj(weights, hk(fortuneNow)), depth, opts) (70498 foe, 72750 boss, 73000 worm, 73400 chest).
 * Fits the rollGear hooks of src/bosses/client/bossClient.ts and src/worm/wormClient.ts.
 */
export function rollLootGear(
  weights: readonly number[],
  fortune: number,
  depth: number,
  opts: { base?: string; slot?: GearSlotType; biome?: string } = {},
): GearItem {
  return rollGear(pickTier(weights, luckCurve(fortune)), depth, opts);
}
