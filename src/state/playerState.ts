// Player state: inventory, economy, Wellspring cards, gear, stash, shop, satchels, and the save file
// (localStorage "minear.save.v1") with its validation and migrations.
// Bundle play-inUT-NSi.js lines 54294-55309.
import {
  EXTRA_CONSUMABLE_PRICES,
  ITEMS,
  SUPPLY_IDS,
  isItemId,
  type ItemDef,
  type Rarity,
} from '../world/items';
import { expToNext, gemExp, relevel, sortGems } from './progression';
import { CHEAT } from '../game/entry';
import { STATS, STAT_IDS, rollOffers, stackStat, type StatOffer } from './gearStats';
import {
  GEAR_BY_ID,
  GEAR_SLOTS,
  SLOT_TYPE,
  gearName,
  gearSellPrice,
  gearShopPrice,
  nextUid,
  pickTier,
  rollGear,
  type GearItem,
  type GearSlot,
} from './gear';
import { GOALS } from './goals';
import { ORE_IDS, readRun, type RunLog } from '../base/run';
import { readTree, treeStatPoints } from './skillTree';
import { beltSlots } from './belt';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const ITEM = ITEMS as Record<string, ItemDef>;

/** Stash gem cap by rarity. */
export const STASH_GEM_CAP: Record<Rarity, number> = { common: 40, uncommon: 20, rare: 12, epic: 8, legendary: 5, mythic: 3 }; // bj (54294)
/** Stash cap for a gem id (0 for anything that is not a gem). */
export const stashCap = (e: string): number => (ITEM[e]?.kind === `gem` ? STASH_GEM_CAP[ITEM[e].rarity] : 0); // xj (54295)
export const MAX_SATCHELS = 12; // Sj (54296)
/** Sum of an object's values. */
export const sumValues = (e: Record<string, number>): number => Object.values(e).reduce((e, t) => e + t, 0); // Cj (54297)
/** Trading Post refresh period, ms. */
export const SHOP_PERIOD = 36e4; // wj (54298)
/** Supplies the Trading Post can stock: weight w and stock n. */
export const SHOP_SUPPLIES: { id: string; w: number; n: number }[] = [ // Tj (54299)
  { id: `bomb`, w: 3, n: 3 },
  { id: `boulder`, w: 3, n: 2 },
  { id: `tonic`, w: 3, n: 2 },
  { id: `strength`, w: 2.5, n: 2 },
  { id: `smoke`, w: 2.5, n: 2 },
  { id: `cookie`, w: 2.2, n: 2 },
  { id: `ultjuice`, w: 2.2, n: 2 },
  { id: `birdsong`, w: 1.4, n: 1 },
  { id: `recall`, w: 1.4, n: 1 },
  { id: `die`, w: 1.2, n: 1 },
  { id: `deaddust`, w: 0.9, n: 1 },
];
/** Card pick history cap. */
export const PICKS_CAP = 300; // Ej (54312)
/** Strength flask and fortune cookie length, ms. */
export const BUFF_MS = 12e4; // Dj (54313)
/** Damage multiplier while the strength flask is on. */
export const STRENGTH_MUL = 1.3; // Oj (54314)
/** Drill Slam charge multiplier while Ult Juice is on. */
export const JUICE_MUL = 1.5; // kj (54315)
/** Ult Juice length, ms. */
export const JUICE_MS = 3e5; // Aj (54316)
// MINEAR: the dev-local Demo cheat (minear-r3f/src/game/entry.ts) keeps its own save game, so gear forged with
// local-chain materials never shows up in the demo or the signed-in game.
export const SAVE_KEY = CHEAT ? `minear.save.v1.local` : `minear.save.v1`; // jj (54317)
/** Balance version (1 = thorns rescaled). */
export const BALANCE_VERSION = 1; // Mj (54318)

export type GeodeKind = 'geode' | 'deepgeode' | 'heartgeode';
export const isGeode = (e: unknown): e is GeodeKind => e === `geode` || e === `deepgeode` || e === `heartgeode`; // Nj (54319)
export const GEODES: Record<GeodeKind, { name: string; blurb: string; price: number; odds: Record<string, number> }> = { // Pj (54320)
  geode: {
    name: `Geode`,
    blurb: `A gem inside, usually a humble one.`,
    price: 240,
    odds: { quartz: 55, amethyst: 30, emerald: 11, sapphire: 3.5, ruby: 0.5 },
  },
  deepgeode: {
    name: `Deep Geode`,
    blurb: `From far below: better gems.`,
    price: 1200,
    odds: { amethyst: 28, emerald: 34, sapphire: 22, ruby: 12, sunstone: 3.6, voidheart: 0.4 },
  },
  heartgeode: {
    name: `Heartstone Geode`,
    blurb: `From the heart of the world: the finest gems.`,
    price: 4500,
    odds: { sapphire: 30, ruby: 36, sunstone: 26, voidheart: 8 },
  },
};

/** uj (54097): the raw stored settings (embedded in the save snapshot). */
function readStoredSettings(): Json { // uj (54097)
  try {
    const e = localStorage.getItem(`minear.settings.v1`);
    return e ? JSON.parse(e) : null;
  } catch {
    return null;
  }
}

/** One gem bag slot: a stack of n of item id. */
export interface PackStack {
  id: string;
  n: number;
}

export interface Satchel {
  id: number;
  x: number;
  y: number;
  z: number;
  mine: boolean;
  /** Date.now() when dropped. */
  at: number;
  coins: number;
  crystals: string[];
  items: GearItem[];
  supplies: Record<string, number>;
  /** performance.now() expiry KR sets for the countdown (not saved). */
  exp?: number;
}

export type ShopKind = 'item' | 'die' | 'dust' | 'supply' | GeodeKind;

export interface ShopEntry {
  kind: ShopKind;
  price: number;
  item?: GearItem;
  supply?: string;
  left?: number;
  sold?: boolean;
}

export interface Shop {
  at: number;
  stock: ShopEntry[];
  restocks: number;
}

/** Card pick record: [stat id, tier, value, level]. */
export type PickRecord = [string, number, number, number];

export interface LootDrop {
  coins: number;
  crystals: string[];
  items: GearItem[];
  supplies: Record<string, number>;
}

/** Pick filter for lootSatchel: null takes everything. */
export interface SatchelPick {
  coins?: boolean;
  crystals?: Record<string, number>;
  items?: number[];
  supplies?: Record<string, number>;
}

export class PlayerState { // Fj (54340)
  coins = 0;
  dice = 0;
  dust = 0;
  banned: string[] = [];
  /** Absolute end times (Date.now() ms). */
  buffs = { strength: 0, cookies: [] as number[], juice: 0 };
  /** Gems kept out of the bag (geode leftovers, migration). */
  crystals: Record<string, number> = {};
  /** Gem bag: one stack per slot. */
  pack: PackStack[] = [];
  supplies: Record<string, number> = {};
  belt: (string | null)[] = [null, null, null, null];
  coinFrac = 0;
  satchels: Satchel[] = [];
  wiped = !1;
  hold = !1;
  cards: Record<string, number> = {};
  cardCount = 0;
  /** MINEAR: skill tree levels, node id -> level (minear-r3f/src/state/skillTree.ts). */
  tree: Record<string, number> = {};
  /** Stat points from the skill tree (recompute fills it; they stack with the card points). */
  treePts: Record<string, number> = {};
  picks: PickRecord[] = [];
  /** [x, y, z, yaw] where the miner quit, or null. */
  where: number[] | null = null;
  /** [x, y, z] where the miner was knocked out before quitting, or null. */
  koAt: number[] | null = null;
  lvl = 1;
  exp = 0;
  levelUps = 0;
  fortune = 0;
  fortuneBest = 0;
  /** Drill Slam charge 0..1. */
  ult = 0;
  gear: Record<GearSlot, GearItem | null> = {
    head: null,
    body: null,
    drill: null,
    launcher: null,
    pack: null,
    charm1: null,
    charm2: null,
  };
  items: GearItem[] = [];
  stash: { items: GearItem[]; supplies: Record<string, number>; gems: Record<string, number> } = { items: [], supplies: {}, gems: {} };
  shop: Shop | null = null;
  draft: { cards: StatOffer[] } | null = null;
  /** Opened chest keys. */
  opened: string[] = [];
  /** Second wind already used since the last haven visit. */
  windUsed = !1;
  /** Deepest depth reached, in metres below the surface. */
  deepest = 0;
  /** MINEAR: the most damage dealt in one mining trip (the trip summary's record). */
  bestDmg = 0;
  /** MINEAR: claw tier (CLAW_TIERS in src/game/clawEndurance.ts) and endurance left (-1 = full). */
  clawTier = 0;
  clawEndurance = -1;
  earned = 0;
  shattered = 0;
  grinSlain = 0;
  seen: Record<string, boolean> & { spring?: boolean; fought?: boolean; burrow?: boolean } = {};
  /** Boss id -> Date.now() ms it may return. */
  bossBack: Record<string, number> = {};
  souls: string[] = [];
  soulsGiven: string[] = [];
  skyOpen = !1;
  lodestone = !1;
  strangerTalk: Record<string, number> = {};
  goal = { i: 0, c: 0 };
  migrated: { coins: number; crystals: number; dice: number } | null = null;
  refunded = 0;
  /** Stat totals (cards + gear through the caps). */
  totals: Record<string, number> = {};
  /** Gear points per stat. */
  gearPts: Record<string, number> = {};
  /** MINEAR base: the ore bin (ore id -> count), filled by every nugget picked up (src/base). */
  ores: Record<string, number> = {};
  /** MINEAR base: Capsule Coins, one per Capsule Machine spin. */
  capsules = 0;
  /** MINEAR: the expedition seed of the gem layout (src/world/gemSpawn.ts); 0 = the original layout. */
  runSeed = 0;
  /** MINEAR: what this expedition has taken so far (src/base/run.ts); null before the first one starts. */
  run: RunLog | null = null;

  constructor() {
    this.recompute();
  }

  recompute() {
    const e: Record<string, number> = {},
      t: Record<string, number> = {};
    for (const e of STAT_IDS) t[e] = 0;
    for (const e of GEAR_SLOTS) for (const [n, r] of this.gear[e]?.stats ?? []) t[n] += r;
    const tp = (this.treePts = treeStatPoints(this));
    for (const n of STAT_IDS) e[n] = stackStat(n, (this.cards[n] ?? 0) + (tp[n] ?? 0), t[n]);
    ((this.gearPts = t), (this.totals = e));
  }
  /** Card points plus skill tree points of stat e (they stack through the same soft cap). */
  cardPoints(e: string): number {
    return (this.cards[e] ?? 0) + (this.treePts[e] ?? 0);
  }
  /** The stat with t more card points. */
  statWithGift(e: string, t: number): number {
    return stackStat(e, this.cardPoints(e) + t, this.gearPts[e] ?? 0);
  }
  gearPoints(e: string): number {
    return this.gearPts[e] ?? 0;
  }
  earn(e: number) {
    ((this.coins += e), (this.earned += e));
  }
  get level() {
    return this.lvl;
  }
  get expNext() {
    return expToNext(this.lvl);
  }
  /** Gem id -> count held (pack and crystals). */
  gemsHeld(): Record<string, number> {
    const e: Record<string, number> = { ...this.crystals };
    for (const t of this.pack) ITEM[t.id].kind === `gem` && (e[t.id] = (e[t.id] ?? 0) + t.n);
    for (const t in e) e[t] > 0 || delete e[t];
    return e;
  }
  /** Wellspring: gems -> exp -> levels. */
  sendGems(e: string[]): { sent: string[]; levels: number; exp: number } {
    const t: string[] = [];
    let n = 0,
      r = 0;
    for (const i of sortGems(e)) {
      if (this.crystals[i] > 0) --this.crystals[i] <= 0 && delete this.crystals[i];
      else {
        const e = this.pack.find((e) => e.id === i && e.n > 0);
        if (!e) continue;
        e.n--;
      }
      (t.push(i), this.shattered++);
      const e = gemExp(i);
      for (this.exp += e, r += e; this.exp >= expToNext(this.lvl); )
        ((this.exp -= expToNext(this.lvl)), this.lvl++, n++, this.levelUps++);
    }
    return (
      (this.pack = this.pack.filter((e) => e.n > 0)),
      t.length && this.save(),
      { sent: t, levels: n, exp: r }
    );
  }
  stat(e: string): number {
    return this.totals[e] ?? 0;
  }
  /** Stat e if slot t held item n instead. */
  statWith(e: string, t: GearSlot | null, n: GearItem | null): number {
    let r = 0;
    for (const i of GEAR_SLOTS) {
      const a = i === t ? n : this.gear[i];
      for (const [t, n] of a?.stats ?? []) t === e && (r += n);
    }
    return stackStat(e, this.cardPoints(e), r);
  }
  /** Phase-1 alias of the stat totals (src/game/playerStats.ts). */
  get stats(): Record<string, number> {
    return this.totals;
  }
  get capacity() {
    return 8 + Math.round(this.stat(`pack`));
  }
  get drill() {
    const e = 1.35 * (1 + this.stat(`bore`) / 100);
    return { power: 2 + this.stat(`power`), radius: e, reach: 4.2 + (e - 1.35) * 1.2 };
  }
  get jet() {
    const e = this.stat(`fuel`);
    return {
      fuelMax: 100 + e,
      thrust: 38 + Math.min(20, e * 0.025),
      burn: 24,
      regen: 32 + e * 0.3,
    };
  }
  get lamp() {
    const e = this.stat(`sense`);
    return { range: 17 + e * 0.9, intensity: 7 + e * 0.12, sense: 12 + e };
  }
  get sonarEvery() {
    return Math.max(4.5, 9 - this.stat(`sense`) * 0.12);
  }
  get sonarReach() {
    return 1 + this.stat(`sense`) * 0.02;
  }
  get burrowMul() {
    return 1 + this.stat(`burrow`) / 100;
  }
  get luck() {
    return this.stat(`luck`) / 100;
  }
  get oreBonus() {
    return this.stat(`fortune`) / 100;
  }
  get moveMul() {
    return 1 + this.stat(`speed`) / 100;
  }
  get meleeDamage() {
    return (16 + this.stat(`melee`)) * this.dmgMul;
  }
  get rangedDamage() {
    return (8 + this.stat(`ranged`)) * this.dmgMul;
  }
  get dmgMul() {
    return this.buffs.strength > Date.now() ? STRENGTH_MUL : 1;
  }
  get ultMul() {
    return this.buffs.juice > Date.now() ? JUICE_MUL : 1;
  }
  get cookiesOn() {
    const e = Date.now();
    return this.buffs.cookies.filter((t) => t > e).length;
  }
  get fortuneNow() {
    return this.fortune + 35 * this.cookiesOn;
  }
  /** Seconds between shots. */
  get fireRate() {
    return 0.34 / (1 + this.stat(`rate`) / 100);
  }
  get maxHp() {
    return 100 + Math.round(this.stat(`hp`));
  }
  get armor() {
    return this.stat(`armor`) / 100;
  }
  get crit() {
    return this.stat(`crit`) / 100;
  }
  /** Power rating. */
  get power() {
    const e = 1 + Math.min(1, 0.1 + this.crit) * 0.5,
      t = (this.rangedDamage / this.fireRate) * e * (1 + this.stat(`twin`) / 100),
      n = this.meleeDamage * e * 1.4 + t * 0.5;
    return Math.round(n * (1 + this.armor) + this.maxHp * 0.1 + this.drill.power * 6);
  }
  /** Gem bag slots in use. */
  get used() {
    return this.pack.length;
  }
  get packFull() {
    return this.pack.length >= this.capacity;
  }
  get carrying() {
    return this.pack.length > 0;
  }
  /** How many of item e still fit, after the pending pickups t (id -> count). */
  room(e: string, t?: Map<string, number>): number {
    const n = ITEM[e];
    if (n.kind === `die` || n.kind === `dust` || n.kind === `ore` || n.kind === `soul`)
      return 1 / 0;
    if (n.kind === `supply`)
      return Math.max(0, n.stack - (this.supplies[e] ?? 0) - (t?.get(e) ?? 0));
    let r = this.capacity - this.pack.length;
    for (const [n, i] of t ?? []) {
      if (n === e || i <= 0 || ITEM[n].kind === `die` || ITEM[n].kind === `dust`) continue;
      const t = ITEM[n].stack;
      let a = i;
      for (const e of this.pack) e.id === n && (a -= t - e.n);
      a > 0 && (r -= Math.ceil(a / t));
    }
    const i = n.stack;
    let a = Math.max(0, r) * i;
    for (const t of this.pack) t.id === e && (a += i - t.n);
    return Math.max(0, a - (t?.get(e) ?? 0));
  }
  /** Adds up to t of item e; returns how many were taken. */
  put(e: string, t = 1): number {
    const n = ITEM[e];
    if (n.kind === `soul`) {
      const n = e.slice(5);
      return (!this.souls.includes(n) && !this.soulsGiven.includes(n) && this.souls.push(n), t);
    }
    if (n.kind === `die`) return ((this.dice += t), t);
    if (n.kind === `dust`) return ((this.dust += t), t);
    if (n.kind === `ore`) {
      // MINEAR: ore is material for the Refinery and the Forge. It goes to the ore bin and pays no coins
      // (the original turned each nugget into coins at once).
      this.ores[n.id] = (this.ores[n.id] ?? 0) + t;
      return t;
    }
    if (n.kind === `supply`) {
      const r = Math.min(t, n.stack - (this.supplies[e] ?? 0));
      if (r <= 0) return 0;
      // MINEAR: a new supply goes into a free open belt slot (a locked slot is not used).
      const open = this.belt.slice(0, beltSlots(this));
      if (((this.supplies[e] = (this.supplies[e] ?? 0) + r), !open.includes(e))) {
        const t = open.indexOf(null);
        if (t >= 0) {
          const old = this.belt.indexOf(e);
          old >= 0 && (this.belt[old] = null);
          this.belt[t] = e;
        }
      }
      return r;
    }
    let r = t;
    for (const t of this.pack) {
      if (r <= 0) break;
      if (t.id !== e || t.n >= n.stack) continue;
      const i = Math.min(r, n.stack - t.n);
      ((t.n += i), (r -= i));
    }
    for (; r > 0 && this.pack.length < this.capacity; ) {
      const t = Math.min(r, n.stack);
      (this.pack.push({ id: e, n: t }), (r -= t));
    }
    return t - r;
  }
  add(e: string): boolean {
    return this.put(e, 1) === 1;
  }
  /** Takes t (default all) from bag slot e. */
  takeSlot(e: number, t?: number): PackStack | null {
    const n = this.pack[e];
    if (!n) return null;
    const r = Math.max(1, Math.min(n.n, t ?? n.n));
    return ((n.n -= r), n.n <= 0 && this.pack.splice(e, 1), { id: n.id, n: r });
  }
  packCounts(): Record<string, number> {
    const e: Record<string, number> = {};
    for (const t of this.pack) e[t.id] = (e[t.id] ?? 0) + t.n;
    return e;
  }
  crystalPrice(e: string): number {
    return Math.round(ITEM[e].value * (1 + this.stat(`gold`) / 100));
  }
  packWorth(): number {
    let e = 0;
    for (const t of this.pack) ITEM[t.id].kind === `gem` && (e += t.n * this.crystalPrice(t.id));
    return e;
  }
  gemCount(): number {
    let e = 0;
    for (const t of this.pack) ITEM[t.id].kind === `gem` && (e += t.n);
    return e;
  }
  stashCount(): number {
    let e = 0;
    for (const t in this.crystals) e += this.crystals[t];
    return e;
  }
  /** Loses a share e of the gem stacks at random. */
  loseSome(e: number) {
    const t = this.pack.filter((e) => ITEM[e.id].kind === `gem`);
    let n = Math.floor(t.length * e);
    for (; n-- > 0; ) t.splice(Math.floor(Math.random() * t.length), 1)[0].n = 0;
    ((this.pack = this.pack.filter((e) => e.n > 0)), this.save());
  }
  startDraft(): boolean {
    return this.draft || this.levelUps <= 0
      ? !1
      : (this.levelUps--,
        (this.draft = { cards: rollOffers((e) => this.stat(e), 3, this.fortuneNow, this.banned) }),
        this.save(),
        !0);
  }
  reroll(): boolean {
    return !this.draft || this.dice <= 0
      ? !1
      : (this.dice--,
        (this.draft.cards = rollOffers((e) => this.stat(e), 3, this.fortuneNow, this.banned)),
        this.save(),
        !0);
  }
  get canBanish() {
    return !!this.draft && this.dust > 0 && this.banned.length < 8;
  }
  banish(e: number): StatOffer | null | false {
    const t = this.draft?.cards[e];
    if (!t || !this.canBanish || this.banned.includes(t.id)) return !1;
    (this.dust--, this.banned.push(t.id));
    const n = this.draft!.cards,
      r =
        rollOffers((e) => this.stat(e), 1, this.fortuneNow, [...this.banned, ...n.map((e) => e.id)])[0] ??
        null;
    return (r ? (n[e] = r) : n.splice(e, 1), this.save(), r);
  }
  pick(e: number): StatOffer | null {
    const t = this.draft?.cards[e];
    return t
      ? ((this.cards[t.id] = (this.cards[t.id] ?? 0) + t.value),
        this.cardCount++,
        this.picks.push([t.id, t.tier, t.value, this.lvl - this.levelUps]),
        this.picks.length > PICKS_CAP && this.picks.splice(0, this.picks.length - PICKS_CAP),
        (this.draft = null),
        this.recompute(),
        this.save(),
        t)
      : null;
  }
  get skipValue() {
    return 10 + 5 * this.lvl;
  }
  skip(): number {
    if (!this.draft) return 0;
    const e = this.skipValue;
    return (this.earn(e), (this.draft = null), this.save(), e);
  }
  /** MINEAR: gear is held in the player's wallet, so there is no gear limit (user, 2026-11-14). Only the
   *  Cart (the mining-trip carry, `pack`) has a size. Always false; kept so old call sites read the same. */
  get bagFull() {
    return false;
  }
  addItem(e: GearItem): boolean {
    return !this.bagFull && ((e.fresh = !0), this.items.push(e), !0);
  }
  equip(e: number, t?: GearSlot): boolean {
    const n = this.items.findIndex((t) => t.uid === e);
    if (n < 0) return !1;
    const r = this.items[n],
      i = GEAR_BY_ID[r.base].slot,
      a = GEAR_SLOTS.filter((e) => SLOT_TYPE[e] === i),
      o = t && a.includes(t) ? t : (a.find((e) => !this.gear[e]) ?? a[0]);
    if (!o) return !1;
    const s = this.gear[o];
    return (
      this.items.splice(n, 1),
      s && this.items.splice(n, 0, s),
      (r.fresh = !1),
      (this.gear[o] = r),
      this.recompute(),
      this.save(),
      !0
    );
  }
  unequip(e: GearSlot): boolean {
    const t = this.gear[e];
    return !t || this.bagFull
      ? !1
      : ((this.gear[e] = null), this.items.push(t), this.recompute(), this.save(), !0);
  }
  takeGear(e: number, t?: GearSlot): GearItem | null {
    let n: GearItem | null = null;
    if (t) {
      if (((n = this.gear[t]), !n || n.uid !== e)) return null;
      ((this.gear[t] = null), this.recompute());
    } else {
      const t = this.items.findIndex((t) => t.uid === e);
      if (t < 0) return null;
      n = this.items.splice(t, 1)[0];
    }
    return (this.save(), n);
  }
  takeSupply(e: string, t: number): number {
    const n = Math.min(t, this.supplies[e] ?? 0);
    return n <= 0 ? 0 : ((this.supplies[e] -= n), this.save(), n);
  }
  /** Knockout: all bag gems, half the coins and all gear bag items go into the drop. */
  dropOnDeath(): { coins: number; crystals: string[]; items: GearItem[] } {
    const e: string[] = [];
    for (const t of this.pack) for (let n = 0; n < t.n; n++) e.push(t.id);
    this.pack = [];
    const t = Math.floor(this.coins / 2);
    this.coins -= t;
    const n = this.items;
    return ((this.items = []), this.save(), { coins: t, crystals: e, items: n });
  }
  addSatchel(e: Omit<Satchel, 'id' | 'at'>): Satchel {
    const t: Satchel = { ...e, id: nextUid(), at: Date.now() };
    for (this.satchels.push(t); this.satchels.length > MAX_SATCHELS; ) this.satchels.shift();
    return (this.save(), t);
  }
  lootRoom(): { crystals: number; items: number; supplies: Record<string, number> } {
    const e: Record<string, number> = {};
    for (const t of SUPPLY_IDS) e[t] = Math.max(0, ITEM[t].stack - (this.supplies[t] ?? 0));
    return {
      crystals: Math.max(0, this.capacity - this.pack.length),
      items: Number.MAX_SAFE_INTEGER, // gear goes to the wallet: no limit
      supplies: e,
    };
  }
  /** Takes a loot drop; returns what did not fit. */
  takeLoot(e: { coins: number; crystals: string[]; items: Json[]; supplies: Record<string, number> }): LootDrop {
    const t: LootDrop = { coins: 0, crystals: [], items: [], supplies: {} };
    this.coins += e.coins;
    for (const n of e.crystals)
      isItemId(n) && ITEM[n].kind === `gem` && (this.put(n, 1) || t.crystals.push(n));
    for (const n of e.items)
      typeof n?.base == `string` &&
        Object.hasOwn(GEAR_BY_ID, n.base) &&
        ((n.stats = (Array.isArray(n.stats) ? n.stats : []).filter(
          (e: Json) => Array.isArray(e) && Object.hasOwn(STATS, e[0]) && Number.isFinite(e[1]),
        )),
        n.stats.length && ((n.name = gearName(n)), this.addItem(n) || t.items.push(n)));
    for (const n in e.supplies) {
      if (!isItemId(n) || ITEM[n].kind !== `supply`) continue;
      const r = e.supplies[n] - this.put(n, e.supplies[n]);
      r > 0 && (t.supplies[n] = r);
    }
    return (this.save(), t);
  }
  /** Takes from satchel e (all, or what pick t names). */
  lootSatchel(e: number, t?: SatchelPick | null): (LootDrop & { left: boolean }) | null {
    const n = this.satchels.find((t) => t.id === e);
    if (!n) return null;
    const r = { coins: 0, crystals: [] as string[], items: [] as GearItem[], supplies: {} as Record<string, number>, left: !1 };
    (!t || t.coins) && ((r.coins = n.coins), (this.coins += n.coins), (n.coins = 0));
    const i: Record<string, number> = {};
    ((n.crystals = n.crystals.filter((e) =>
      (t && (i[e] ?? 0) >= (t.crystals?.[e] ?? 0)) || !this.put(e, 1)
        ? !0
        : ((i[e] = (i[e] ?? 0) + 1), r.crystals.push(e), !1),
    )),
      (n.items = n.items.filter((e) =>
        (t && !t.items?.includes(e.uid)) || !this.addItem(e) ? !0 : (r.items.push(e), !1),
      )));
    for (const e in n.supplies) {
      const i = this.put(e, Math.min(n.supplies[e], t ? (t.supplies?.[e] ?? 0) : 1 / 0));
      (i > 0 && (r.supplies[e] = i),
        (n.supplies[e] -= i),
        n.supplies[e] <= 0 && delete n.supplies[e]);
    }
    return (
      (r.left = n.coins > 0 || n.crystals.length + n.items.length + sumValues(n.supplies) > 0),
      r.left || (this.satchels = this.satchels.filter((e) => e !== n)),
      this.save(),
      r
    );
  }
  /** Drops satchels older than 10 minutes; true when any went. */
  expireSatchels(e = Date.now()): boolean {
    const t = this.satchels.length;
    return (
      (this.satchels = this.satchels.filter((t) => e - t.at <= 6e5)),
      this.satchels.length !== t && (this.save(), !0)
    );
  }
  sellItem(e: number): number {
    const t = this.items.findIndex((t) => t.uid === e);
    if (t < 0) return 0;
    const n = gearSellPrice(this.items[t]);
    return (this.items.splice(t, 1), this.earn(n), this.save(), n);
  }
  sellCrystal(e: string): number {
    const t = this.pack.find((t) => t.id === e && t.n > 0);
    if (t) (t.n--, (this.pack = this.pack.filter((e) => e.n > 0)));
    else if (this.crystals[e] > 0) --this.crystals[e] <= 0 && delete this.crystals[e];
    else return 0;
    const n = this.crystalPrice(e);
    return (this.earn(n), this.save(), n);
  }
  beltEquip(e: string, t?: number): boolean {
    if (!isItemId(e) || ITEM[e].kind !== `supply`) return !1;
    // MINEAR: only the open belt slots (2 + the skill tree's Belt Loops, minear-r3f/src/state/belt.ts).
    const open = this.belt.slice(0, beltSlots(this)),
      n = t ?? (open.includes(e) ? open.indexOf(e) : open.indexOf(null));
    if (n < 0 || n >= open.length) return !1;
    const r = this.belt.indexOf(e);
    return (r >= 0 && (this.belt[r] = null), (this.belt[n] = e), this.save(), !0);
  }
  beltClear(e: number): boolean {
    return this.belt[e] ? ((this.belt[e] = null), this.save(), !0) : !1;
  }
  /** Spends one of belt slot e's supply; returns its id or null. */
  useBelt(e: number): string | null {
    const t = this.belt[e];
    return !t || !(this.supplies[t] > 0) ? null : (this.supplies[t]--, this.save(), t);
  }
  ensureShop(e = Date.now()): boolean {
    return this.shop && e - this.shop.at < 36e4 ? !1 : (this.rollShop(e), !0);
  }
  rollShop(e = Date.now(), t = 0) {
    const n = Math.max(8, this.deepest * 0.9),
      r: ShopEntry[] = [];
    for (let e = 0; e < 3; e++) {
      const e = rollGear(pickTier([48, 33, 14, 4.3, 0.7]), n);
      r.push({ kind: `item`, item: e, price: gearShopPrice(e) });
    }
    const i = SHOP_SUPPLIES.filter((e) => e.id === `die` || e.id === `deaddust` || SUPPLY_IDS.includes(e.id as never));
    for (let e = 0; e < 3 && i.length; e++) {
      let e = Math.random() * i.reduce((e, t) => e + t.w, 0),
        t = 0;
      for (; t < i.length - 1 && (e -= i[t].w) > 0; ) t++;
      const n = i.splice(t, 1)[0];
      n.id === `die`
        ? r.push({ kind: `die`, price: 380 })
        : n.id === `deaddust`
          ? r.push({ kind: `dust`, price: ITEMS.deaddust.price ?? 2e3 })
          : r.push({ kind: `supply`, supply: n.id, price: ITEM[n.id].price ?? 100, left: n.n });
    }
    for (const e of [`geode`, `deepgeode`, `heartgeode`] as const) r.push({ kind: e, price: GEODES[e].price });
    this.shop = { at: e, stock: r, restocks: t };
  }
  get restockCost() {
    return 60 * 2 ** Math.min(6, this.shop?.restocks ?? 0);
  }
  restock(): boolean {
    const e = this.restockCost;
    if (this.coins < e) return !1;
    this.coins -= e;
    const t = this.shop?.at ?? Date.now();
    return (this.rollShop(t, (this.shop?.restocks ?? 0) + 1), this.save(), !0);
  }
  buy(e: number): { kind: ShopKind; item?: GearItem; crystal?: string; supply?: string } | null {
    const t = this.shop?.stock[e];
    if (
      !t ||
      t.sold ||
      this.coins < t.price ||
      (t.kind === `item` && this.bagFull) ||
      (isGeode(t.kind) && this.packFull) ||
      (t.kind === `supply` && (!t.supply || !isItemId(t.supply) || this.room(t.supply) < 1))
    )
      return null;
    ((this.coins -= t.price),
      t.kind === `supply`
        ? ((t.left = Math.max(0, (t.left ?? 1) - 1)), t.left || (t.sold = !0))
        : (t.sold = !0));
    let n: string | undefined;
    if (t.kind === `supply`) this.put(t.supply!, 1);
    else if (t.kind === `item`) this.addItem(t.item!);
    else if (t.kind === `die`) this.dice++;
    else if (t.kind === `dust`) this.dust++;
    else {
      const e = GEODES[t.kind].odds,
        r = Object.keys(e);
      let i = Math.random() * r.reduce((t, n) => t + e[n], 0);
      n = r[0];
      for (const t of r)
        if (((i -= e[t]), i <= 0)) {
          n = t;
          break;
        }
      this.put(n, 1) || (this.crystals[n] = (this.crystals[n] ?? 0) + 1);
    }
    return (this.save(), { kind: t.kind, item: t.item, crystal: n, supply: t.supply });
  }
  stowItem(e: number): boolean {
    const t = this.items.findIndex((t) => t.uid === e);
    return t < 0 || this.stash.items.length >= 36
      ? !1
      : (this.stash.items.push(this.items.splice(t, 1)[0]), this.save(), !0);
  }
  unstowItem(e: number): boolean {
    const t = this.stash.items.findIndex((t) => t.uid === e);
    return t < 0 || this.bagFull
      ? !1
      : (this.items.push(this.stash.items.splice(t, 1)[0]), this.save(), !0);
  }
  stowSupply(e: string, t = 1 / 0): number {
    const n = Math.min(t, this.supplies[e] ?? 0, 99 - (this.stash.supplies[e] ?? 0));
    return n <= 0
      ? 0
      : ((this.supplies[e] -= n),
        (this.stash.supplies[e] = (this.stash.supplies[e] ?? 0) + n),
        this.save(),
        n);
  }
  unstowSupply(e: string, t = 1 / 0): number {
    const n = Math.min(t, this.stash.supplies[e] ?? 0, this.room(e));
    return n <= 0
      ? 0
      : ((this.stash.supplies[e] -= n),
        this.stash.supplies[e] <= 0 && delete this.stash.supplies[e],
        this.put(e, n),
        this.save(),
        n);
  }
  packOf(e: string): number {
    let t = 0;
    for (const n of this.pack) n.id === e && (t += n.n);
    return t;
  }
  stowGem(e: string, t = 1 / 0): number {
    const n = Math.min(t, this.packOf(e), stashCap(e) - (this.stash.gems[e] ?? 0));
    if (n <= 0) return 0;
    let r = n;
    for (const t of this.pack) {
      if (t.id !== e || r <= 0) continue;
      const n = Math.min(r, t.n);
      ((t.n -= n), (r -= n));
    }
    return (
      (this.pack = this.pack.filter((e) => e.n > 0)),
      (this.stash.gems[e] = (this.stash.gems[e] ?? 0) + n),
      this.save(),
      n
    );
  }
  unstowGem(e: string, t = 1 / 0): number {
    const n = Math.min(t, this.stash.gems[e] ?? 0, this.room(e));
    return n <= 0
      ? 0
      : ((this.stash.gems[e] -= n),
        this.stash.gems[e] <= 0 && delete this.stash.gems[e],
        this.put(e, n),
        this.save(),
        n);
  }
  /** Writes the save (not while wiped or held). */
  save() {
    if (!(this.wiped || this.hold))
      try {
        localStorage.setItem(SAVE_KEY, this.snapshot());
      } catch {
        /* storage full or blocked */
      }
  }
  snapshot(): string {
    return JSON.stringify({
      at: Date.now(),
      v: 9,
      coins: this.coins,
      dice: this.dice,
      dust: this.dust,
      banned: this.banned,
      buffs: this.buffs,
      crystals: this.crystals,
      pack: this.pack,
      supplies: this.supplies,
      belt: this.belt,
      cards: this.cards,
      cardCount: this.cardCount,
      tree: this.tree,
      picks: this.picks,
      where: this.where,
      koAt: this.koAt,
      lvl: this.lvl,
      exp: this.exp,
      levelUps: this.levelUps,
      curve: 2,
      fortune: Math.round(this.fortune * 10) / 10,
      fortuneBest: Math.round(this.fortuneBest * 10) / 10,
      ult: Math.round(this.ult * 1e3) / 1e3,
      gear: this.gear,
      items: this.items,
      shop: this.shop,
      draft: this.draft,
      opened: this.opened.slice(-400),
      deepest: this.deepest,
      bestDmg: this.bestDmg,
      clawTier: this.clawTier,
      clawEndurance: Math.round(this.clawEndurance * 100) / 100,
      earned: this.earned,
      shattered: this.shattered,
      grinSlain: this.grinSlain,
      seen: this.seen,
      goal: this.goal,
      satchels: this.satchels.map(({ exp: _e, ...t }) => t),
      sclock: 1,
      stash: this.stash,
      bossBack: this.bossBack,
      bal: BALANCE_VERSION,
      souls: this.souls,
      soulsGiven: this.soulsGiven,
      skyOpen: this.skyOpen,
      lodestone: this.lodestone,
      strangerTalk: this.strangerTalk,
      ores: this.ores,
      capsules: this.capsules,
      runSeed: this.runSeed,
      run: this.run,
      settings: readStoredSettings(),
    });
  }
  /** Reads and validates the save, runs the migrations, then finishes a knockout left in the save. */
  load() {
    try {
      const e = localStorage.getItem(SAVE_KEY);
      if (!e) return;
      const t: Json = JSON.parse(e);
      ((this.coins = t.coins ?? 0),
        (this.deepest = t.deepest ?? 0),
        (this.bestDmg = Math.max(0, Math.floor(+t.bestDmg || 0))),
        (this.clawTier = typeof t.clawTier == `number` ? t.clawTier : 0),
        (this.clawEndurance = typeof t.clawEndurance == `number` ? t.clawEndurance : -1),
        (this.earned = Math.max(t.earned ?? 0, this.coins)),
        (this.seen = t.seen ?? {}));
      // MINEAR base: ore bin, Capsule Coins, expedition seed and log
      this.ores = {};
      for (const k of ORE_IDS) {
        const n = Math.floor(+t.ores?.[k] || 0);
        if (n > 0) this.ores[k] = Math.min(n, 1e7);
      }
      this.capsules = Math.max(0, Math.min(999, Math.floor(+t.capsules || 0)));
      this.runSeed = Math.max(0, Math.floor(+t.runSeed || 0)) % 1e6;
      this.run = readRun(t.run);
      // MINEAR: skill tree levels (an older save has none: {})
      this.tree = readTree(t.tree);
      const n = Date.now();
      for (const [e, r] of Object.entries(t.bossBack ?? {}))
        typeof r == `number` && r > n && (this.bossBack[e] = r);
      const r = (e: Json): string[] =>
        Array.isArray(e)
          ? [...new Set(e.filter((e: Json) => typeof e == `string` && `soul_${e}` in ITEMS))]
          : [];
      ((this.soulsGiven = r(t.soulsGiven)),
        (this.souls = r(t.souls).filter((e) => !this.soulsGiven.includes(e))),
        (this.skyOpen = !!t.skyOpen),
        (this.lodestone = !!t.lodestone),
        (this.strangerTalk = {}));
      for (const [e, n] of Object.entries(t.strangerTalk ?? {}))
        typeof n == `number` && n >= 0 && (this.strangerTalk[e] = Math.floor(n));
      if ((t.v ?? 1) < 3) this.migrate(t);
      else {
        ((this.dice = t.dice ?? 0),
          (this.dust = Math.max(0, Math.floor(+t.dust || 0))),
          (this.banned = (Array.isArray(t.banned) ? t.banned : [])
            .filter((e: Json, t: number, n: Json[]) => Object.hasOwn(STATS, e) && n.indexOf(e) === t)
            .slice(0, 8)));
        const e = (e: Json): number => (Number.isFinite(e) ? e : 0);
        this.buffs = {
          strength: e(t.buffs?.strength),
          cookies: (Array.isArray(t.buffs?.cookies) ? t.buffs.cookies.map(e) : []).slice(0, 2),
          juice: e(t.buffs?.juice),
        };
        const dv = EXTRA_CONSUMABLE_PRICES as Record<string, number>;
        for (const e of [t.supplies, t.stash?.supplies])
          for (const t in e ?? {})
            Object.hasOwn(dv, t) && (this.refunded += dv[t] * Math.max(0, e[t] | 0));
        ((this.coins += this.refunded),
          (this.crystals = t.crystals ?? {}),
          (this.cards = t.cards ?? {}),
          (this.cardCount = t.cardCount ?? 0),
          (this.picks = (Array.isArray(t.picks) ? t.picks : [])
            .filter(
              (e: Json) =>
                Array.isArray(e) &&
                Object.hasOwn(STATS, e[0]) &&
                [0, 1, 2, 3, 4].includes(e[1]) &&
                Number.isFinite(e[2]) &&
                Number.isFinite(e[3]),
            )
            .slice(-300)));
        const n = (e: Json, t: number): number[] | null =>
          Array.isArray(e) && e.length === t && e.every((e) => Number.isFinite(e)) ? e : null;
        this.where = n(t.where, 4);
        this.koAt = n(t.koAt, 3);
        this.lvl = Math.max(1, Math.floor(t.lvl ?? 1));
        this.exp = Math.max(0, t.exp ?? 0);
        this.levelUps = Array.isArray(t.levelUps)
          ? t.levelUps.length
          : Math.max(0, Math.floor(+t.levelUps || 0));
        this.fortune = Math.max(0, Math.min(1e5, +t.fortune || 0));
        this.fortuneBest = Math.max(this.fortune, Math.min(1e5, +t.fortuneBest || 0));
        this.ult = Math.max(0, Math.min(1, +t.ult || 0));
        if ((t.curve ?? 1) < 2) {
          const e = relevel(this.lvl, this.exp);
          ((this.levelUps += Math.max(0, e.lvl - this.lvl)),
            (this.lvl = e.lvl),
            (this.exp = e.exp));
        }
        for (const e of GEAR_SLOTS) this.gear[e] = t.gear?.[e] && GEAR_BY_ID[t.gear[e].base] ? t.gear[e] : null;
        ((this.items = (t.items ?? []).filter((e: Json) => GEAR_BY_ID[e.base])), (this.shop = t.shop ?? null));
        const r = Array.isArray(t.draft?.cards) ? t.draft.cards.filter((e: Json) => STATS[e?.id]) : [];
        this.draft = r.length ? { cards: r } : null;
        this.opened = t.opened ?? [];
        this.shattered = t.shattered ?? 0;
        this.grinSlain = t.grinSlain ?? 0;
        this.goal = t.goal ?? { i: 0, c: 0 };
        if ((t.v ?? 1) < 9 && t.goal) {
          const e = GOALS.filter((e) => (e.added ?? 0) <= (t.v ?? 1))[t.goal.i];
          this.goal = { i: e ? GOALS.indexOf(e) : GOALS.length, c: e ? t.goal.c : 0 };
        }
        this.pack = (t.pack ?? []).filter((e: Json) => isItemId(e?.id) && ITEM[e.id].kind === `gem` && e.n > 0);
        const i = (e: Json): boolean => isItemId(e) && ITEM[e].kind === `supply`;
        for (const e in t.supplies ?? {})
          i(e) && (this.supplies[e] = Math.max(0, Math.min(ITEM[e].stack, t.supplies[e] | 0)));
        Array.isArray(t.belt) &&
          (this.belt = Array.from({ length: 4 }, (_e, n) => (i(t.belt[n]) ? t.belt[n] : null)));
        const a = Date.now();
        ((this.satchels = (t.satchels ?? [])
          .filter((e: Json) => Number.isFinite(e?.x) && Number.isFinite(e?.y) && Number.isFinite(e?.z))
          .map((e: Json): Satchel => {
            const n: Record<string, number> = {};
            for (const t in e.supplies ?? {}) i(t) && (n[t] = Math.max(0, e.supplies[t] | 0));
            return (
              e.bombs && (n.bomb = (n.bomb ?? 0) + Math.max(0, e.bombs | 0)),
              {
                id: e.id,
                x: e.x,
                y: e.y,
                z: e.z,
                mine: !!e.mine,
                at: (t.sclock && Number(e.at)) || a,
                crystals: (e.crystals ?? []).filter((e: Json) => isItemId(e) && ITEM[e].kind === `gem`),
                items: (e.items ?? []).filter(
                  (e: Json) => typeof e?.base == `string` && Object.hasOwn(GEAR_BY_ID, e.base),
                ),
                coins: Math.max(0, Math.floor(+e.coins || 0)),
                supplies: n,
              }
            );
          })),
          this.shop &&
            !this.shop.stock.some((e) => e.kind === `supply` && e.left !== void 0) &&
            (this.shop = null),
          this.shop?.stock.some((e) => e.kind === `supply` && !isItemId(e.supply)) &&
            (this.shop = null),
          this.shop &&
            !this.shop.stock.some((e) => e.kind === `heartgeode`) &&
            (this.shop = null),
          (this.stash = {
            items: (t.stash?.items ?? [])
              .filter((e: Json) => typeof e?.base == `string` && Object.hasOwn(GEAR_BY_ID, e.base))
              .slice(0, 36),
            supplies: {},
            gems: {},
          }));
        for (const e in t.stash?.supplies ?? {})
          i(e) && (this.stash.supplies[e] = Math.max(0, Math.min(99, t.stash.supplies[e] | 0)));
        for (const e in t.stash?.gems ?? {}) {
          const n = Math.min(stashCap(e), t.stash.gems[e] | 0);
          n > 0 && (this.stash.gems[e] = n);
        }
        t.v === 3 && this.packToSlots();
      }
      ((t.bal ?? 0) < 1 && this.thornsRescale(), (t.v ?? 1) < 5 && this.toV5());
      const i = (e: GearItem | null | undefined) => {
        e?.base === `smoke` && (e.name = gearName(e));
      };
      for (const e of GEAR_SLOTS) i(this.gear[e]);
      for (const e of [
        ...this.items,
        ...this.stash.items,
        ...this.satchels.flatMap((e) => e.items),
      ])
        i(e);
      for (const e of this.shop?.stock ?? []) i(e.item);
    } catch {
      /* a broken save keeps what was read so far */
    }
    (this.recompute(), this.koAt && this.finishKnockout());
  }
  /** The miner quit while knocked out: the drop becomes a satchel where it happened. */
  finishKnockout() {
    const [e, t, n] = this.koAt!;
    ((this.koAt = null), (this.where = null));
    const r = this.dropOnDeath();
    r.coins > 0 || r.crystals.length > 0 || r.items.length > 0
      ? this.addSatchel({
          x: e,
          y: t,
          z: n,
          mine: !0,
          coins: r.coins,
          crystals: r.crystals,
          items: r.items,
          supplies: {},
        })
      : this.save();
  }
  /** Save v < 5: ore in the bag becomes coins, bore becomes a percent. */
  toV5() {
    const e: Record<string, number> = { copper: 5, iron: 12, gold: 35, mythril: 100 };
    let t = 0;
    ((this.pack = this.pack.filter(
      (n) => ITEM[n.id]?.kind !== `ore` || ((t += n.n * (e[n.id] ?? ITEM[n.id].value)), !1),
    )),
      (this.coins += t));
    const n = (e: number) => (e > 0 ? Math.max(1, Math.round((e / 1.35) * 100)) : 0);
    this.cards.bore && (this.cards.bore = n(this.cards.bore));
    const r = (e: GearItem | null | undefined) => {
      if (e) for (const t of e.stats) t[0] === `bore` && (t[1] = n(t[1]));
    };
    for (const e of GEAR_SLOTS) r(this.gear[e]);
    for (const e of this.items) r(e);
    for (const e of this.shop?.stock ?? []) r(e.item);
    (this.shop &&
      !this.shop.stock.some((e) => e.kind === `supply` && e.left !== void 0) &&
      (this.shop = null),
      this.save());
  }
  /** Balance v1: thorns values / 5. */
  thornsRescale() {
    let e = !1;
    const t = (t: number) => ((e = !0), t > 0 ? Math.max(1, Math.round(t / 5)) : 0);
    this.cards.thorns && (this.cards.thorns = t(this.cards.thorns));
    for (const e of this.picks) e[0] === `thorns` && (e[2] = t(e[2]));
    for (const e of this.draft?.cards ?? []) e.id === `thorns` && (e.value = t(e.value));
    const n = (e: GearItem | null | undefined) => {
      if (e) for (const n of e.stats) n[0] === `thorns` && (n[1] = t(n[1]));
    };
    for (const e of GEAR_SLOTS) n(this.gear[e]);
    for (const e of [...this.items, ...this.stash.items, ...this.satchels.flatMap((e) => e.items)])
      n(e);
    for (const e of this.shop?.stock ?? []) n(e.item);
    e && this.save();
  }
  /** Save v3: pack stat values / 5 (bag slots). */
  packToSlots() {
    const e = (e: number) => (e > 0 ? Math.max(1, Math.round(e / 5)) : 0);
    this.cards.pack && (this.cards.pack = e(this.cards.pack));
    const t = (t: GearItem | null | undefined) => {
      if (t) for (const n of t.stats) n[0] === `pack` && (n[1] = e(n[1]));
    };
    for (const e of GEAR_SLOTS) t(this.gear[e]);
    for (const e of this.items) t(e);
    for (const e of this.shop?.stock ?? []) t(e.item);
    this.save();
  }
  /** Save v < 3 (the old tiers / training / skills game): refunds coins, gems and two dice. */
  migrate(e: Json) {
    const t: Record<string, number[]> = {
        drill: [0, 150, 650, 2200, 7500],
        weapon: [0, 180, 700, 2400, 8e3],
        jetpack: [0, 120, 500, 1800, 6e3],
        backpack: [0, 100, 420, 1600, 5200],
      },
      n = [80, 200, 450, 900, 1800],
      r: Record<string, number[]> = {
        sense: [5, 15, 40, 100],
        sonarPulse: [8, 25, 60],
        sonarReach: [8, 25, 60],
        echo: [30],
        oreSight: [40, 120],
        burrow: [6, 20, 50],
        jetEff: [10, 30, 70],
        recall: [15, 45],
        luck: [12, 35, 90],
        richVeins: [10, 30, 80],
        spiritBond: [60],
      };
    let i = 0;
    for (const n in t) for (let r = 1; r <= (e.tiers?.[n] ?? 0); r++) i += t[n][r] ?? 0;
    for (const t in e.training ?? {}) for (let r = 0; r < e.training[t]; r++) i += n[r] ?? 0;
    let a = e.essence ?? 0;
    for (const t in e.skills ?? {}) for (let n = 0; n < e.skills[t]; n++) a += r[t]?.[n] ?? 0;
    const o: [string, number][] = [
      [`voidheart`, 320],
      [`sunstone`, 100],
      [`ruby`, 35],
      [`sapphire`, 15],
      [`emerald`, 7],
      [`amethyst`, 3],
      [`quartz`, 1],
    ];
    let s = 0;
    for (const [e, t] of o)
      for (; a >= t && s < 12; )
        ((a -= t), (this.crystals[e] = (this.crystals[e] ?? 0) + 1), s++);
    ((this.coins += i), (this.dice = 2));
    const c = [0, 1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
    ((this.goal = { i: c[Math.min(c.length - 1, e.goal?.i ?? 0)], c: 0 }),
      (this.migrated = { coins: i, crystals: s, dice: 2 }),
      this.save());
  }
  /** Back to a fresh miner, then load the save again. */
  reload() {
    (Object.assign(this, new PlayerState()), this.load());
  }
  hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return !1;
    }
  }
  /** Copies the save to "minear.save.v1.<suffix>". */
  archive(e: string) {
    try {
      const t = localStorage.getItem(SAVE_KEY);
      t && localStorage.setItem(`${SAVE_KEY}.${e}`, t);
    } catch {
      /* storage blocked */
    }
  }
  /** Start over: no more saves this session, and the save is removed. */
  reset() {
    this.wiped = !0;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage blocked */
    }
  }
}
