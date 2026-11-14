// Gear stat (affix) table, stat stacking, labels, weighted picks, level-up offers and loot summaries.
// Bundle play-inUT-NSi.js lines 50634-51197.
import { ITEMS, RARITY_COLORS, type ItemDef, type Rarity } from '../world/items';
import { rarityOdds, TIER_COLORS } from './progression';

export interface StatDef {
  id: string;
  name: string;
  blurb: string;
  /** Roll value per tier 0..4 (perks are 0 at tiers 0-1). */
  per: number[];
  unit: string;
  cap: number;
  /** Soft cap: past it, gains shrink (softCap Ek). */
  soft?: number;
  /** Hyperbolic ceiling [knee, ceiling]. */
  ceil?: [number, number];
  perk?: boolean;
  icon: string;
  /** Draft weight; 0 = never offered as a Wellspring card. */
  weight: number;
  pre: string;
  suf: string;
}

const defineStat = (e: StatDef): StatDef => e; // xk (50634)

/** Every gear stat, keyed by id. Key order is the bundle order. */
export const STATS: Record<string, StatDef> = { // Sk (50635)
  power: defineStat({
    id: `power`,
    name: `Burrow Power`,
    blurb: `Chew through harder rock, faster.`,
    per: [1, 2, 3, 4, 5],
    unit: ``,
    cap: 95,
    soft: 45,
    icon: `power`,
    weight: 13,
    pre: `Grinding`,
    suf: `of the Mole`,
  }),
  bore: defineStat({
    id: `bore`,
    name: `Bore Width`,
    blurb: `Every bite of your claws carves a wider hole.`,
    per: [4, 6, 9, 12, 18],
    unit: `%`,
    cap: 120,
    icon: `bore`,
    weight: 7,
    pre: `Wide`,
    suf: `of Tunnels`,
  }),
  melee: defineStat({
    id: `melee`,
    name: `Burrow Damage`,
    blurb: `Your burrow hits on the Lost deal more damage.`,
    per: [2, 4, 7, 10, 16],
    unit: ``,
    cap: 1 / 0,
    soft: 80,
    icon: `melee`,
    weight: 10,
    pre: `Brutal`,
    suf: `of Bones`,
  }),
  ranged: defineStat({
    id: `ranged`,
    name: `Bullet Damage`,
    blurb: `Your bullets hit harder.`,
    per: [2, 3, 5, 8, 12],
    unit: ``,
    cap: 1 / 0,
    soft: 30,
    icon: `ranged`,
    weight: 9,
    pre: `Deadeye`,
    suf: `of Sparks`,
  }),
  rate: defineStat({
    id: `rate`,
    name: `Fire Rate`,
    blurb: `Shoot faster.`,
    per: [5, 8, 12, 16, 24],
    unit: `%`,
    cap: 1 / 0,
    ceil: [50, 150],
    icon: `rate`,
    weight: 7,
    pre: `Rapid`,
    suf: `of Haste`,
  }),
  hp: defineStat({
    id: `hp`,
    name: `Max Health`,
    blurb: `Take more punishment before you drop.`,
    per: [10, 18, 28, 40, 60],
    unit: ` HP`,
    cap: 1 / 0,
    soft: 180,
    icon: `hp`,
    weight: 10,
    pre: `Hearty`,
    suf: `of Stone`,
  }),
  armor: defineStat({
    id: `armor`,
    name: `Armor`,
    blurb: `Every blow you take is this much weaker.`,
    per: [2, 3, 5, 7, 10],
    unit: `%`,
    cap: 1 / 0,
    ceil: [30, 80],
    icon: `armor`,
    weight: 7,
    pre: `Plated`,
    suf: `of the Wall`,
  }),
  speed: defineStat({
    id: `speed`,
    name: `Move Speed`,
    blurb: `Quicker on your feet.`,
    per: [3, 5, 7, 10, 14],
    unit: `%`,
    cap: 60,
    icon: `speed`,
    weight: 7,
    pre: `Swift`,
    suf: `of the Hare`,
  }),
  burrow: defineStat({
    id: `burrow`,
    name: `Burrow Speed`,
    blurb: `Fly faster through tunnels and loose earth.`,
    per: [5, 8, 12, 16, 24],
    unit: `%`,
    cap: 150,
    icon: `burrow`,
    weight: 7,
    pre: `Tunneling`,
    suf: `of the Worm`,
  }),
  fuel: defineStat({
    id: `fuel`,
    name: `Jet Fuel`,
    blurb: `A bigger tank, and it refills faster.`,
    per: [15, 25, 40, 60, 90],
    unit: ``,
    cap: 1200,
    icon: `fuel`,
    weight: 7,
    pre: `Soaring`,
    suf: `of Updrafts`,
  }),
  pack: defineStat({
    id: `pack`,
    name: `Cart Slots`,
    blurb: `More room in your cart: every gem takes a slot.`,
    per: [1, 1, 2, 3, 4],
    unit: ``,
    cap: 24,
    icon: `pack`,
    weight: 9,
    pre: `Roomy`,
    suf: `of Hoarding`,
  }),
  sense: defineStat({
    id: `sense`,
    name: `Gem Sense`,
    blurb: `Feel gems glowing through the rock from further away; a brighter lamp.`,
    per: [1, 1.5, 2.5, 3.5, 5],
    unit: ` m`,
    cap: 24,
    icon: `sense`,
    weight: 8,
    pre: `Glinting`,
    suf: `of Sight`,
  }),
  fortune: defineStat({
    id: `fortune`,
    name: `Rich Veins`,
    blurb: `Each ore nugget may bring a second one: this is the chance.`,
    per: [4, 7, 10, 14, 20],
    unit: `%`,
    cap: 100,
    icon: `fortune`,
    weight: 6,
    pre: `Rich`,
    suf: `of Veins`,
  }),
  luck: defineStat({
    id: `luck`,
    name: `Lucky Strike`,
    blurb: `Gems and gear may turn out one grade rarer: this is the chance.`,
    per: [2, 3, 5, 7, 10],
    unit: `%`,
    cap: 60,
    icon: `luck`,
    weight: 0,
    pre: `Lucky`,
    suf: `of Fortune`,
  }),
  crit: defineStat({
    id: `crit`,
    name: `Crit Chance`,
    blurb: `More of your blows land as critical hits, for 1.5x damage.`,
    per: [2, 3, 5, 7, 10],
    unit: `%`,
    cap: 1 / 0,
    ceil: [30, 90],
    icon: `crit`,
    weight: 6,
    pre: `Keen`,
    suf: `of Precision`,
  }),
  regen: defineStat({
    id: `regen`,
    name: `Regeneration`,
    blurb: `Health creeps back once you are out of a fight.`,
    per: [0.3, 0.5, 0.8, 1.2, 2],
    unit: ` HP/s`,
    cap: 1 / 0,
    soft: 8,
    icon: `regen`,
    weight: 5,
    pre: `Mending`,
    suf: `of Springs`,
  }),
  caliber: defineStat({
    id: `caliber`,
    name: `Heavy Bullets`,
    blurb: `Bigger bullets: easier to land, and they knock back harder.`,
    per: [6, 10, 15, 20, 30],
    unit: `%`,
    cap: 150,
    icon: `caliber`,
    weight: 5,
    pre: `Heavy`,
    suf: `of Weight`,
  }),
  muzzle: defineStat({
    id: `muzzle`,
    name: `Swift Bullets`,
    blurb: `Bullets fly faster and flatter: easier to lead a moving target.`,
    per: [6, 10, 15, 20, 30],
    unit: `%`,
    cap: 150,
    icon: `muzzle`,
    weight: 5,
    pre: `Whistling`,
    suf: `of the Arrow`,
  }),
  vamp: defineStat({
    id: `vamp`,
    name: `Vampire Claws`,
    blurb: `Every burrow hit heals you this share of the damage it deals.`,
    per: [0, 0, 3, 5, 8],
    unit: `%`,
    cap: 1 / 0,
    ceil: [15, 40],
    perk: !0,
    icon: `vamp`,
    weight: 3,
    pre: `Thirsting`,
    suf: `of Leeches`,
  }),
  twin: defineStat({
    id: `twin`,
    name: `Twin Bullets`,
    blurb: `The chance each shot fires a second bullet alongside.`,
    per: [0, 0, 15, 25, 40],
    unit: `%`,
    cap: 1 / 0,
    ceil: [30, 100],
    perk: !0,
    icon: `twin`,
    weight: 3,
    pre: `Twin`,
    suf: `of Echoes`,
  }),
  blast: defineStat({
    id: `blast`,
    name: `Blasting Caps`,
    blurb: `Every bullet bursts where it lands, dealing this share of its damage around it.`,
    per: [0, 0, 25, 40, 65],
    unit: `%`,
    cap: 1 / 0,
    soft: 60,
    perk: !0,
    icon: `blast`,
    weight: 3,
    pre: `Blasting`,
    suf: `of Thunder`,
  }),
  bounce: defineStat({
    id: `bounce`,
    name: `Ricochet`,
    blurb: `The chance a bullet that hits rock glances off and flies on.`,
    per: [0, 0, 30, 45, 65],
    unit: `%`,
    cap: 1 / 0,
    ceil: [30, 100],
    perk: !0,
    icon: `bounce`,
    weight: 2,
    pre: `Glancing`,
    suf: `of Ricochets`,
  }),
  thorns: defineStat({
    id: `thorns`,
    name: `Spiked Coat`,
    blurb: `Whatever hits you up close takes this share of the blow back (another miner, a fifth of it).`,
    per: [0, 0, 8, 12, 20],
    unit: `%`,
    cap: 1 / 0,
    ceil: [25, 50],
    perk: !0,
    icon: `thorns`,
    weight: 2,
    pre: `Spiked`,
    suf: `of Thorns`,
  }),
  nimble: defineStat({
    id: `nimble`,
    name: `Nimble`,
    blurb: `Dash again this much sooner, and stay untouchable a little longer.`,
    per: [0, 0, 15, 22, 30],
    unit: `%`,
    cap: 60,
    perk: !0,
    icon: `nimble`,
    weight: 3,
    pre: `Nimble`,
    suf: `of Shadows`,
  }),
  gold: defineStat({
    id: `gold`,
    name: `Gold Rush`,
    blurb: `Gem sales pay this much more.`,
    per: [0, 0, 8, 12, 20],
    unit: `%`,
    cap: 150,
    perk: !0,
    icon: `gold`,
    weight: 3,
    pre: `Gilded`,
    suf: `of Greed`,
  }),
  magnet: defineStat({
    id: `magnet`,
    name: `Magnet`,
    blurb: `Loot lying around flies to you from further away.`,
    per: [0, 0, 2, 3, 5],
    unit: ` m`,
    cap: 16,
    perk: !0,
    icon: `magnet`,
    weight: 2,
    pre: `Magnetic`,
    suf: `of Pull`,
  }),
  wind: defineStat({
    id: `wind`,
    name: `Second Wind`,
    blurb: `Once per trip, a knockout blow leaves you standing instead.`,
    per: [0, 0, 0, 0, 1],
    unit: ``,
    cap: 1,
    perk: !0,
    icon: `wind`,
    weight: 2,
    pre: `Undying`,
    suf: `of Second Wind`,
  }),
  echo: defineStat({
    id: `echo`,
    name: `Echo`,
    blurb: `Press Q while burrowing to send a sonar ping whenever you like.`,
    per: [0, 0, 1, 0, 0],
    unit: ``,
    cap: 1,
    perk: !0,
    icon: `echo`,
    weight: 2,
    pre: `Echoing`,
    suf: `of the Bat`,
  }),
  ember: defineStat({
    id: `ember`,
    name: `Ember Bullets`,
    blurb: `Every hit sets its target burning for 3 s: this share of the bullet's damage each second.`,
    per: [0, 0, 10, 15, 24],
    unit: `%`,
    cap: 1 / 0,
    soft: 40,
    perk: !0,
    icon: `ember`,
    weight: 3,
    pre: `Smouldering`,
    suf: `of Embers`,
  }),
  venom: defineStat({
    id: `venom`,
    name: `Venom Bullets`,
    blurb: `Every hit poisons for 5 s: this share of the bullet's damage each second, up to three doses.`,
    per: [0, 0, 6, 9, 14],
    unit: `%`,
    cap: 1 / 0,
    soft: 30,
    perk: !0,
    icon: `venom`,
    weight: 3,
    pre: `Venomous`,
    suf: `of Vipers`,
  }),
  frost: defineStat({
    id: `frost`,
    name: `Frost Bullets`,
    blurb: `Every hit slows its target this much, for 1.6 s.`,
    per: [0, 0, 10, 15, 22],
    unit: `%`,
    cap: 60,
    perk: !0,
    icon: `frost`,
    weight: 3,
    pre: `Frozen`,
    suf: `of Winter`,
  }),
  resfire: defineStat({
    id: `resfire`,
    name: `Heat Shield`,
    blurb: `Lava and fire burn you less.`,
    per: [8, 12, 18, 25, 35],
    unit: `%`,
    cap: 90,
    icon: `resfire`,
    weight: 0,
    pre: `Fireproof`,
    suf: `of the Salamander`,
  }),
  respoison: defineStat({
    id: `respoison`,
    name: `Antitoxin`,
    blurb: `Poison and the Bog's water hurt you less.`,
    per: [8, 12, 18, 25, 35],
    unit: `%`,
    cap: 90,
    icon: `respoison`,
    weight: 0,
    pre: `Immune`,
    suf: `of the Toad`,
  }),
  grip: defineStat({
    id: `grip`,
    name: `Ice Grip`,
    blurb: `Spiked soles: you don't slide on ice.`,
    per: [0, 0, 1, 1, 1],
    unit: ``,
    cap: 1,
    perk: !0,
    icon: `grip`,
    weight: 0,
    pre: `Spiked`,
    suf: `of the Glacier`,
  }),
  oresight: defineStat({
    id: `oresight`,
    name: `Ore Sight`,
    blurb: `Ore veins glimmer through the murk in burrow vision.`,
    per: [0, 0, 1, 1, 0],
    unit: ``,
    cap: 2,
    perk: !0,
    icon: `oresight`,
    weight: 2,
    pre: `Seeing`,
    suf: `of Glimmers`,
  }),
};

export const STAT_IDS = Object.keys(STATS); // Ck (51087)
/** Thorns share against other miners. */
export const THORNS_PVP = 0.2; // wk (51088)

/** Stacked stat value: card total t plus gear total n, through the stat's ceiling, soft cap and cap. */
export function stackStat(e: string, t: number, n: number): number { // Tk (51089)
  const r = STATS[e];
  if (r.ceil) {
    const [e, i] = r.ceil,
      a = t + n;
    if (a <= e) return a;
    const o = a - e,
      s = i - e;
    return e + (s * o) / (o + s);
  }
  return r.soft ? Math.min(softCap(t, r.soft) + n, r.cap) : Math.min(t + n, r.cap);
}

export const softCap = (e: number, t: number): number => (e <= t ? e : t + 2 * t * (Math.sqrt(1 + (e - t) / t) - 1)); // Ek (51101)
/** Display rounding. */
export const displayRound = (e: number): number =>
  e >= 10 ? Math.round(e) : e >= 1 ? Math.round(e * 10) / 10 : Math.round(e * 100) / 100; // Dk (51102)

/** Stat label: '+5% Fire Rate', 'Ore Sight II', '+1 Gem Bag Slot'. */
export function statLabel(e: string, t: number, n = !0): string { // Ok (51104)
  const r = STATS[e],
    i = n ? ` ${r.name}` : ``;
  if (r.cap === 1) return r.name;
  if (e === `oresight`) return n ? `Ore Sight ${t >= 2 ? `II` : `I`}` : t >= 2 ? `II` : `I`;
  const a =
    Math.abs(t) < 1 && t !== 0
      ? t.toFixed(2).replace(/0$/, ``)
      : Number.isInteger(t)
        ? String(t)
        : t.toFixed(1);
  return r.unit === `%`
    ? `+${a}%${i}`
    : r.unit === ` m`
      ? `+${a} m${i}`
      : r.unit === ` HP`
        ? `+${a}${n ? ` Max Health` : ` HP`}`
        : r.unit === ` HP/s`
          ? `+${a} HP/s${n ? ` regen` : ``}`
          : e === `pack`
            ? `+${a}${n ? ` Cart Slot${t === 1 ? `` : `s`}` : t === 1 ? ` slot` : ` slots`}`
            : `+${a}${i}`;
}

/** Weighted pick; undefined when every weight is 0. */
export const weightedPick = <T>(e: readonly T[], t: (x: T) => number, n = Math.random()): T | undefined => { // kk (51127)
  let r = 0;
  for (const n of e) r += Math.max(0, t(n));
  if (r <= 0) return;
  let i = n * r;
  for (const n of e) if (((i -= Math.max(0, t(n))), i <= 0)) return n;
  return e[e.length - 1];
};

export interface StatOffer {
  id: string;
  tier: number;
  value: number;
}

/** Rolls level-up card offers. e(id) = the stat's current card total. */
export function rollOffers(e: (id: string) => number, t = 3, n = 0, r: string[] = []): StatOffer[] { // Ak (51135)
  const i = rarityOdds(n),
    a: StatOffer[] = [];
  for (let n = 0; n < t; n++) {
    let t = weightedPick([0, 1, 2, 3, 4], (e) => i[e])!;
    for (; t >= 0; t--) {
      const n = t,
        i = weightedPick(STAT_IDS, (t) => {
          const i = STATS[t];
          return i.per[n] <= 0 || a.some((e) => e.id === t) || r.includes(t) || e(t) >= i.cap
            ? 0
            : i.weight;
        });
      if (i) {
        const t = STATS[i];
        a.push({ id: i, tier: n, value: Math.min(t.per[n], t.cap - e(i)) });
        break;
      }
    }
  }
  return (a.sort((e, t) => e.tier - t.tier), a.length === 3 && ([a[1], a[2]] = [a[2], a[1]]), a);
}

export const escapeHtml = (e: unknown): string =>
  String(e).replace(
    /[&<>"']/g,
    (e) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;`, "'": `&#39;` })[e]!,
  ); // jk (51157)

export interface LootLike {
  items: { tier: number; name: string }[];
  supplies?: Record<string, number>;
  crystals: string[];
  coins: number;
}

const itemOf = (id: string): ItemDef | undefined => (ITEMS as Record<string, ItemDef>)[id];

/** HTML summary of a satchel or loot drop: {one, what, short}. */
export function lootSummary(e: LootLike): { one: boolean; what: string; short: string } { // Mk (51162)
  const t = e.items,
    n = Object.entries(e.supplies ?? {}).filter(([, e]) => e > 0),
    r = e.crystals.length,
    i = (e: { tier: number; name: string }) => `<b style="color:${TIER_COLORS[e.tier]}">${escapeHtml(e.name)}</b>`,
    a = ([e, t]: [string, number]) => `<b>${escapeHtml(itemOf(e)?.name ?? `something`)}</b>${t > 1 ? ` ×${t}` : ``}`;
  if (t.length === 1 && !n.length && !r && !e.coins)
    return { one: !0, what: i(t[0]), short: i(t[0]) };
  if (!t.length && n.length === 1 && !r && !e.coins)
    return { one: !0, what: a(n[0]), short: a(n[0]) };
  if (!t.length && !n.length && !e.coins && new Set(e.crystals).size === 1) {
    const t = itemOf(e.crystals[0]),
      n = `<b style="color:${RARITY_COLORS[(t?.rarity ?? `common`) as Rarity]}">${escapeHtml(t?.name ?? `gem`)}</b>${r > 1 ? ` ×${r}` : ``}`;
    return { one: !0, what: n, short: n };
  }
  if (!t.length && !n.length && !r && e.coins > 0) {
    const t = `<b>${e.coins.toLocaleString()} coins</b>`;
    return { one: !0, what: t, short: t };
  }
  const o = r ? `${r} gem${r > 1 ? `s` : ``}` : ``,
    s = e.coins ? `${e.coins.toLocaleString()} coins` : ``,
    c = [
      ...t.slice(0, 2).map(i),
      t.length > 2 ? `${t.length - 2} more gear` : ``,
      ...n.slice(0, 2).map(a),
      o,
      s,
    ],
    l = [
      t.length ? `${t.length} gear` : ``,
      n.length ? `${n.reduce((e, [, t]) => e + t, 0)} supplies` : ``,
      o,
      s,
    ];
  return { one: !1, what: c.filter(Boolean).join(` · `), short: l.filter(Boolean).join(` · `) };
}
