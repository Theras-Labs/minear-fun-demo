// Item catalog: ores, boss souls, gems, reroll die, Dead Dust, shop supplies, gem depth table.
// Bundle play-inUT-NSi.js lines 33015-33359.
import type { BiomeId } from './caverns';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type ItemKind = 'ore' | 'soul' | 'gem' | 'die' | 'dust' | 'supply';

/** Rarity -> CSS color. */
export const RARITY_COLORS: Record<Rarity, string> = { // cv (33015)
  common: `#e9eef5`,
  uncommon: `#7be08f`,
  rare: `#5fb4ff`,
  epic: `#c38bff`,
  legendary: `#ffc23d`,
  mythic: `#ff5fd2`,
};

export interface ItemDef {
  id: string;
  name: string;
  /** Sell value. */
  value: number;
  /** 24-bit int color. */
  color: number;
  stack: number;
  rarity: Rarity;
  kind: ItemKind;
  /** Shop price. */
  price?: number;
  /** Use verb shown on the button. */
  verb?: string;
  /** Help text. */
  blurb?: string;
}

/** Every carryable item, keyed by id. Key order is the bundle order. */
export const ITEMS = { // K (33023)
  copper: {
    id: `copper`,
    name: `Copper`,
    value: 2,
    color: 16747082,
    stack: 1,
    rarity: `common`,
    kind: `ore`,
  },
  soul_titan: {
    id: `soul_titan`,
    name: `Rimeheart's Soul`,
    value: 0,
    color: 9430783,
    stack: 1,
    rarity: `mythic`,
    kind: `soul`,
  },
  iron: {
    id: `iron`,
    name: `Iron`,
    value: 5,
    color: 15260875,
    stack: 1,
    rarity: `common`,
    kind: `ore`,
  },
  gold: {
    id: `gold`,
    name: `Gold`,
    value: 14,
    color: 16765500,
    stack: 1,
    rarity: `uncommon`,
    kind: `ore`,
  },
  mythril: {
    id: `mythril`,
    name: `Mythril`,
    value: 40,
    color: 7336959,
    stack: 1,
    rarity: `rare`,
    kind: `ore`,
  },
  quartz: {
    id: `quartz`,
    name: `Quartz`,
    value: 30,
    color: 15398655,
    stack: 1,
    rarity: `common`,
    kind: `gem`,
  },
  amethyst: {
    id: `amethyst`,
    name: `Amethyst`,
    value: 80,
    color: 11566335,
    stack: 1,
    rarity: `uncommon`,
    kind: `gem`,
  },
  emerald: {
    id: `emerald`,
    name: `Emerald`,
    value: 200,
    color: 3530890,
    stack: 1,
    rarity: `rare`,
    kind: `gem`,
  },
  sapphire: {
    id: `sapphire`,
    name: `Sapphire`,
    value: 420,
    color: 4163327,
    stack: 1,
    rarity: `rare`,
    kind: `gem`,
  },
  ruby: {
    id: `ruby`,
    name: `Ruby`,
    value: 900,
    color: 16725336,
    stack: 1,
    rarity: `epic`,
    kind: `gem`,
  },
  sunstone: {
    id: `sunstone`,
    name: `Sunstone`,
    value: 2400,
    color: 16757294,
    stack: 1,
    rarity: `legendary`,
    kind: `gem`,
  },
  voidheart: {
    id: `voidheart`,
    name: `Voidheart`,
    value: 7e3,
    color: 14044671,
    stack: 1,
    rarity: `mythic`,
    kind: `gem`,
  },
  bogjade: {
    id: `bogjade`,
    name: `Bog Jade`,
    value: 480,
    color: 8314970,
    stack: 1,
    rarity: `rare`,
    kind: `gem`,
  },
  rime: {
    id: `rime`,
    name: `Rime Crystal`,
    value: 520,
    color: 11070719,
    stack: 1,
    rarity: `rare`,
    kind: `gem`,
  },
  fireopal: {
    id: `fireopal`,
    name: `Fire Opal`,
    value: 1150,
    color: 16738847,
    stack: 1,
    rarity: `epic`,
    kind: `gem`,
  },
  soulpearl: {
    id: `soulpearl`,
    name: `Soul Pearl`,
    value: 1300,
    color: 13218047,
    stack: 1,
    rarity: `epic`,
    kind: `gem`,
  },
  die: {
    id: `die`,
    name: `Reroll Die`,
    value: 0,
    color: 16773590,
    stack: 1,
    rarity: `epic`,
    kind: `die`,
  },
  deaddust: {
    id: `deaddust`,
    name: `Dead Dust`,
    value: 0,
    color: 12167384,
    stack: 1,
    rarity: `legendary`,
    kind: `dust`,
    price: 2e3,
    blurb: `When you level up at the Wellspring, press Banish and pick a card: that skill never comes up again.`,
  },
  bomb: {
    id: `bomb`,
    name: `Blast Bomb`,
    value: 60,
    color: 3814464,
    stack: 10,
    rarity: `rare`,
    kind: `supply`,
    price: 150,
    verb: `throw`,
    blurb: `Six-second fuse, then a big crater (even in rock too hard to burrow through) that hurts everything close by. You too.`,
  },
  boulder: {
    id: `boulder`,
    name: `Boulder`,
    value: 35,
    color: 9076078,
    stack: 5,
    rarity: `uncommon`,
    kind: `supply`,
    price: 90,
    verb: `drop`,
    blurb: `Rolls in behind you and plugs the tunnel: the Lost can't follow, and anyone else has to mine through.`,
  },
  birdsong: {
    id: `birdsong`,
    name: `Bird Song`,
    value: 100,
    color: 16765500,
    stack: 3,
    rarity: `epic`,
    kind: `supply`,
    price: 260,
    verb: `play`,
    blurb: `Worms are terrified of birds. Play it and the worm flees, and stays away a good while.`,
  },
  tonic: {
    id: `tonic`,
    name: `Healing Tonic`,
    value: 45,
    color: 16732010,
    stack: 5,
    rarity: `rare`,
    kind: `supply`,
    price: 120,
    verb: `drink`,
    blurb: `Knock it back: nearly half your health comes back over a couple of seconds.`,
  },
  strength: {
    id: `strength`,
    name: `Flask of Strength`,
    value: 70,
    color: 16730682,
    stack: 5,
    rarity: `rare`,
    kind: `supply`,
    price: 200,
    verb: `drink`,
    blurb: `+30% damage for two minutes.`,
  },
  cookie: {
    id: `cookie`,
    name: `Fortune Cookie`,
    value: 90,
    color: 15905882,
    stack: 5,
    rarity: `epic`,
    kind: `supply`,
    price: 280,
    verb: `eat`,
    blurb: `+35% Fortune for two minutes. Two at once at most.`,
  },
  ultjuice: {
    id: `ultjuice`,
    name: `Ult Juice`,
    value: 80,
    color: 16761405,
    stack: 5,
    rarity: `rare`,
    kind: `supply`,
    price: 220,
    verb: `drink`,
    blurb: `Your Burrow Slam charges 50% faster for five minutes.`,
  },
  smoke: {
    id: `smoke`,
    name: `Smoke Bomb`,
    value: 40,
    color: 9406120,
    stack: 5,
    rarity: `rare`,
    kind: `supply`,
    price: 110,
    verb: `throw`,
    blurb: `Pops into a thick cloud for ten seconds: the Lost lose sight of anyone inside, and other miners can't see you in it.`,
  },
  recall: {
    id: `recall`,
    name: `Recall Stone`,
    value: 120,
    color: 7333631,
    stack: 2,
    rarity: `epic`,
    kind: `supply`,
    price: 360,
    verb: `use`,
    blurb: `Three seconds of glowing (you can only walk, and a hit breaks it), then it carries you home with everything you carry.`,
  },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

/** Lookup by an untrusted string id (returns undefined for unknown ids). */
export const itemDef = (id: string): ItemDef | undefined =>
  isItemId(id) ? (ITEMS as Record<string, ItemDef>)[id] : undefined;

/** Gem ids in display order. */
export const GEM_IDS: ItemId[] = [ // lv (33324)
  `quartz`,
  `amethyst`,
  `emerald`,
  `bogjade`,
  `rime`,
  `sapphire`,
  `ruby`,
  `fireopal`,
  `soulpearl`,
  `sunstone`,
  `voidheart`,
];

/** Shop supply ids in display order. */
export const SUPPLY_IDS: ItemId[] = [ // uv (33337)
  `bomb`,
  `boulder`,
  `tonic`,
  `strength`,
  `cookie`,
  `ultjuice`,
  `smoke`,
  `birdsong`,
  `recall`,
];

/** Prices of extra consumables that are not in ITEMS. */
export const EXTRA_CONSUMABLE_PRICES = { flare: 35, antidote: 95, frostflask: 170 }; // dv (33348)

/** Biome -> biome gem. */
export const BIOME_GEM: Record<BiomeId, ItemId> = { // fv (33349)
  ember: `fireopal`,
  bog: `bogjade`,
  frost: `rime`,
  haunt: `soulpearl`,
};

/** True when e is a known item id. */
export const isItemId = (e: unknown): e is ItemId => typeof e == `string` && Object.hasOwn(ITEMS, e); // pv (33350)

export interface GemDepthEntry {
  id: ItemId;
  minDepth: number;
  weight: number;
}

/** Gem drop table by depth below the surface. */
export const GEM_DEPTH_TABLE: GemDepthEntry[] = [ // mv (33351)
  { id: `quartz`, minDepth: 3, weight: 60 },
  { id: `amethyst`, minDepth: 12, weight: 30 },
  { id: `emerald`, minDepth: 28, weight: 14 },
  { id: `sapphire`, minDepth: 48, weight: 7 },
  { id: `ruby`, minDepth: 75, weight: 3.5 },
  { id: `sunstone`, minDepth: 150, weight: 1.1 },
  { id: `voidheart`, minDepth: 300, weight: 0.35 },
];
