// Goal / quest chain table (data only; the goal card KA comes with the goal UI).
// Bundle play-inUT-NSi.js lines 53385-53536. The player state's load() needs it to move old goal indexes.
// MINEAR (user, 2026-11-14): the Requests Board pays in materials (ore, gems, reroll dice). A NEAR coin reward
// is rare: only a few great milestones keep one. Keys come later, when keys are in the game.

/** What a request pays: materials (item id -> count), reroll dice, and on rare milestones coins (NEAR). */
export interface GoalReward {
  coins?: number;
  dice?: number;
  /** Item id (ore or gem, src/world/items.ts) -> count. */
  items?: Record<string, number>;
}

/** The player state parts a reward pays into (src/state/playerState.ts). */
export interface RewardSink {
  dice: number;
  crystals: Record<string, number>;
  earn(n: number): void;
  room(id: string): number;
  put(id: string, n?: number): number;
}

/**
 * Pays a request reward. Ore goes to the ore bin; a gem goes to the cart while it has room, and the rest is
 * kept out of the cart (the gem store, `crystals`), so nothing is lost.
 */
export function giveReward(s: RewardSink, r: GoalReward): void {
  if (r.coins) s.earn(r.coins);
  if (r.dice) s.dice += r.dice;
  for (const [id, n] of Object.entries(r.items ?? {})) {
    if (!(n > 0)) continue;
    const fit = Math.min(n, s.room(id));
    const took = fit > 0 ? s.put(id, fit) : 0;
    if (n - took > 0) s.crystals[id] = (s.crystals[id] ?? 0) + (n - took);
  }
}

/** The state fields a goal's check reads. */
export interface GoalStateView {
  readonly level: number;
  lodestone: boolean;
  soulsGiven: string[];
}

export interface GoalDef {
  text: string;
  /** Event name that counts toward the goal. */
  on?: string;
  need?: number;
  /** Progress read from the state. */
  check?: (s: GoalStateView) => number;
  /** Reach this depth (m). */
  depth?: number;
  /** Discover this many biome caverns. */
  biomes?: number;
  /** Slay this many beasts. */
  slain?: number;
  reward: GoalReward;
  /** Save version that added the goal. */
  added?: number;
  /** Save version that removed the goal (skipped from then on). */
  gone?: number;
}

export const GOALS: GoalDef[] = [ // GA (53385)
  // MINEAR (2026-11-15): stone too, so a first tutorial (it pays the first four requests) can always make Stone Claws
  { text: `Hop off the island to the mine site`, on: `leave`, need: 1, reward: { items: { stone: 10, copper: 5 } } },
  {
    text: `Mine an ore vein (copper, iron, gold)`,
    on: `ore`,
    need: 10,
    reward: { items: { copper: 10 } },
  },
  { text: `Find a gem`, on: `gem`, need: 1, reward: { items: { iron: 5 } } },
  { text: `Ride the light beam home`, on: `home`, need: 1, reward: { items: { copper: 12 } } },
  {
    text: `Send a gem into the Wellspring (E at the fountain)`,
    on: `bank`,
    need: 1,
    reward: { items: { amethyst: 1 } },
  },
  {
    text: `Reach level 3: every level is a gift at the Wellspring`,
    check: (e) => e.level - 1,
    need: 2,
    reward: { dice: 1 },
  },
  { text: `Mine down 20 m`, depth: 20, reward: { items: { iron: 8 } } },
  { text: `Burrow through solid rock`, on: `burrow`, need: 1, reward: { items: { iron: 6 } } },
  {
    text: `Put one of the Lost to rest (hold LMB to burrow, RMB to shoot)`,
    on: `defeat`,
    need: 1,
    reward: { items: { quartz: 2 } },
  },
  { text: `Find and open a treasure chest`, on: `chest`, need: 1, reward: { items: { gold: 3 } } },
  { text: `Put on a piece of gear (Tab)`, on: `equip`, need: 1, reward: { items: { iron: 10 } } },
  { text: `Mine 60 ore nuggets`, on: `ore`, need: 60, reward: { items: { gold: 4 } } },
  { text: `Find a rare gem (emerald or better)`, on: `rare`, need: 1, reward: { dice: 1 } },
  { text: `Mine down 50 m`, depth: 50, reward: { items: { gold: 5, emerald: 1 } } },
  {
    text: `Find one of the four great caverns (80-100 m down, a couple of hundred metres out from the island)`,
    biomes: 1,
    reward: { items: { sapphire: 1 } },
    added: 6,
  },
  { text: `Find a reroll die in the rock`, on: `die`, need: 1, reward: { items: { gold: 6 } } },
  { text: `Send 5 gems into the Wellspring`, on: `shatter`, need: 5, reward: { dice: 1 } },
  { text: `Buy something at the Trading Post`, on: `buy`, need: 1, reward: { items: { iron: 12 } } },
  { text: `Mine down 90 m`, depth: 90, reward: { items: { mythril: 2, sapphire: 1 } } },
  {
    text: `Back on the island, speak with the Stranger`,
    check: (e) => +!!e.lodestone,
    reward: { items: { ruby: 1 } },
    added: 8,
  },
  {
    text: `Discover all four great caverns: fire, bog, ice and graves`,
    biomes: 4,
    reward: { items: { ruby: 2, mythril: 4 }, dice: 1 },
    added: 6,
  },
  {
    text: `Find a cavern's own gem (it grows only in the rock around one)`,
    on: `biomegem`,
    need: 1,
    reward: { items: { mythril: 3 } },
    added: 6,
  },
  { text: `Put 15 of the Lost to rest`, on: `defeat`, need: 15, reward: { items: { emerald: 2, gold: 8 } } },
  {
    text: `Put 10 of the caverns' own dead to rest`,
    on: `biomefoe`,
    need: 10,
    reward: { items: { sapphire: 2, mythril: 5 }, dice: 1 },
    added: 6,
  },
  {
    text: `Slay the keeper of a great cavern (each has one, asleep in the middle; bring friends)`,
    on: `boss`,
    need: 1,
    reward: { coins: 4e3, dice: 2 },
    added: 7,
    gone: 8,
  },
  { text: `Survive the worm below`, on: `grin`, need: 1, reward: { dice: 2 } },
  { text: `Mine down 140 m`, depth: 140, reward: { items: { ruby: 1, mythril: 6 }, dice: 1 } },
  {
    text: `Freeze a pool of lava solid with a Frost Flask (the Trading Post sells them)`,
    on: `freeze`,
    need: 1,
    reward: { coins: 800 },
    added: 6,
    gone: 9,
  },
  {
    text: `Slay the worm (bring friends)`,
    on: `grinSlain`,
    need: 1,
    reward: { coins: 3e3, dice: 3 },
  },
  {
    text: `Slay all four keepers of the great caverns`,
    slain: 4,
    reward: { coins: 15e3, dice: 4 },
    added: 7,
    gone: 8,
  },
  {
    text: `Topple a stone golem (they roam the grass below the island)`,
    on: `golem`,
    need: 1,
    reward: { items: { ruby: 2, mythril: 8 }, dice: 1 },
  },
  { text: `Mine down 260 m, into the Obsidian`, depth: 260, reward: { items: { sunstone: 1, mythril: 10 }, dice: 1 } },
  {
    text: `Slay a mythical beast: follow the lodestone down (bring friends)`,
    slain: 1,
    reward: { items: { sunstone: 1, ruby: 2 }, dice: 2 },
    added: 8,
  },
  {
    text: `Bring its soul to the Stranger`,
    check: (e) => e.soulsGiven.length,
    reward: { items: { sunstone: 1 }, dice: 1 },
    added: 8,
  },
  { text: `Put 60 of the Lost to rest`, on: `defeat`, need: 60, reward: { items: { ruby: 3, mythril: 12 } } },
  { text: `Mine down 420 m, into the Emberstone`, depth: 420, reward: { coins: 6e3, dice: 2 } },
  {
    text: `Slay the worm 3 more times (it comes back hungrier)`,
    on: `grinSlain`,
    need: 3,
    reward: { items: { voidheart: 1, sunstone: 2 }, dice: 3 },
  },
  {
    text: `Find a Voidheart (300 m and deeper)`,
    on: `mythic`,
    need: 1,
    reward: { items: { sunstone: 3 }, dice: 2 },
  },
  { text: `Mine down 620 m, into the Voidstone`, depth: 620, reward: { coins: 14e3, dice: 3 } },
  { text: `Topple 5 stone golems`, on: `golem`, need: 5, reward: { items: { voidheart: 1, mythril: 20 }, dice: 3 } },
  { text: `Mine down 900 m, to the Heartstone`, depth: 900, reward: { coins: 3e4, dice: 5 } },
  {
    text: `Bring the souls of all four mythical beasts to the Stranger`,
    check: (e) => e.soulsGiven.length,
    need: 4,
    reward: { coins: 4e4, dice: 6 },
    added: 8,
    gone: 9, // this build has one beast, so four souls cannot be brought
  },
  {
    text: `Mine down 1200 m: as deep as anyone has gone`,
    depth: 1200,
    reward: { coins: 6e4, dice: 8 },
  },
];
