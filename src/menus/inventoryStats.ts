// Port of play-inUT-NSi.js 60947-61054: the helpers and the stat sheet table of the inventory hP (oP, sP, cP,
// lP, uP, dP, fP, pP, mP), and the stat card text and icons the inventory shows (55408-55522: Uj long
// descriptions, Wj / X / Gj / Kj the 48x48 stat icon SVGs, qj the card art URL).
// Uj, Wj, X, Gj and Kj are in no owner's range in the port plan. The Wellspring pN also reads Uj (59535), so they
// are exported here for it. qj (55522) is the first line of the [wellspring] card art range; it is one line, and
// the inventory keeps this copy of it.
// MINEAR (folder: minear-r3f/src/menus): the gear page layout (equipment columns, accessory slots, the highlight
// stats), the short row labels of the stat accordion, and the mine-cart drawing of the Cart page.
import type { PlayerState } from '../state/playerState';
import type { GearSlot } from '../state/gear';
import { THORNS_PVP } from '../state/gearStats';
import { bold, formatNumber, formatPercent } from '../state/statCards';
import { GEM_IDS } from '../world/items';

/** oP (60947): querySelector (the inventory markup is static, so the element is there). */
export const qs = <T extends Element = HTMLElement>(e: ParentNode, t: string): T => e.querySelector(t) as T; // oP (60947)

/** sP (60948): a rounded number with thousands separators. */
export const formatCount = (e: number): string => Math.round(e).toLocaleString(); // sP (60948)

/** cP (60949): HTML escape. */
export const escapeText = (e: unknown): string => // cP (60949)
  String(e).replace(
    /[&<>"']/g,
    (e) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;`, "'": `&#39;` })[e]!,
  );

/** lP (60954): the padlock on a locked slot (Cart, belt, accessory). */
export const LOCK_SVG = `<svg viewBox="0 0 48 48"><rect x="11" y="21" width="26" height="20" rx="4" fill="#fff6e5" stroke="#3a281c" stroke-width="3"/><path d="M16 21 V15 C16 5 32 5 32 15 V21" fill="none" stroke="#3a281c" stroke-width="3"/></svg>`; // lP (60954)

/** One row of the stat sheet: the stat it shows, its value now, and the value a fresh miner has. */
export interface SheetRow {
  label: string;
  /** MINEAR: the short label of the group summary line (the accordion header). */
  short: string;
  stat: string;
  get(s: PlayerState): string;
  base: string;
}

/** One group of the stat sheet (an icon from STAT_ICONS and its rows). */
export interface SheetGroup {
  name: string;
  icon: string;
  rows: SheetRow[];
}

/** uP (60955): the stat sheet on the gear page. */
export const STAT_SHEET: SheetGroup[] = [ // uP (60955)
  {
    name: `Mining`,
    icon: `power`,
    rows: [
      { label: `Burrow Power`, short: `Power`, stat: `power`, get: (e) => e.drill.power.toFixed(0), base: `2` },
      {
        label: `Bore Width`,
        short: `Width`,
        stat: `bore`,
        get: (e) => `${e.drill.radius.toFixed(2)} m`,
        base: `1.35 m`,
      },
      {
        label: `Burrow Speed`,
        short: `Burrow`,
        stat: `burrow`,
        get: (e) => `${Math.round(e.burrowMul * 100)}%`,
        base: `100%`,
      },
      {
        label: `Rich Veins`,
        short: `Veins`,
        stat: `fortune`,
        get: (e) => `${Math.round(e.stat(`fortune`))}%`,
        base: `0%`,
      },
    ],
  },
  {
    name: `Combat`,
    icon: `melee`,
    rows: [
      {
        label: `Burrow Damage`,
        short: `Damage`,
        stat: `melee`,
        get: (e) => String(Math.round(e.meleeDamage)),
        base: `16`,
      },
      {
        label: `Bullet Damage`,
        short: `Bullets`,
        stat: `ranged`,
        get: (e) => String(Math.round(e.rangedDamage)),
        base: `8`,
      },
      {
        label: `Fire Rate`,
        short: `Rate`,
        stat: `rate`,
        get: (e) => `${(1 / e.fireRate).toFixed(1)}/s`,
        base: `2.9/s`,
      },
      {
        label: `Crit Chance`,
        short: `Crit`,
        stat: `crit`,
        get: (e) => `${Math.round(10 + e.stat(`crit`))}%`,
        base: `10%`,
      },
    ],
  },
  {
    name: `Survival`,
    icon: `hp`,
    rows: [
      { label: `Max Health`, short: `Health`, stat: `hp`, get: (e) => String(e.maxHp), base: `100` },
      { label: `Armor`, short: `Armor`, stat: `armor`, get: (e) => `${Math.round(e.armor * 100)}%`, base: `0%` },
      {
        label: `Regeneration`,
        short: `Regen`,
        stat: `regen`,
        get: (e) => `${e.stat(`regen`).toFixed(1)}/s`,
        base: `0/s`,
      },
    ],
  },
  {
    name: `Travel`,
    icon: `speed`,
    rows: [
      {
        label: `Move Speed`,
        short: `Speed`,
        stat: `speed`,
        get: (e) => `${Math.round(e.moveMul * 100)}%`,
        base: `100%`,
      },
      {
        label: `Jet Fuel`,
        short: `Fuel`,
        stat: `fuel`,
        get: (e) => String(Math.round(e.jet.fuelMax)),
        base: `100`,
      },
      {
        label: `Gem Sense`,
        short: `Sense`,
        stat: `sense`,
        get: (e) => `${e.lamp.sense.toFixed(1)} m`,
        base: `12 m`,
      },
      // MINEAR: the gem slots of the Cart (the `pack` stat, "Cart Slots"); the Cart shows more open slots for the
      // ore, supplies and gear (minear-r3f/src/state/cart.ts), but only gems fill these.
      { label: `Cart Slots`, short: `Cart`, stat: `pack`, get: (e) => `${e.capacity} gems`, base: `8 gems` },
    ],
  },
];

/** dP (61051): the stats the sheet rows show (the other gear stats go under "Gear perks"). */
export const SHEET_STATS = new Set(STAT_SHEET.flatMap((e) => e.rows.map((e) => e.stat))); // dP (61051)

/** fP (61052): gem rarities whose Destroy asks "Sure?" first. */
export const ASK_RARITIES = new Set<string>([`rare`, `epic`, `legendary`, `mythic`]); // fP (61052)

/** pP (61053): the equipment columns beside the portrait. MINEAR: worn on the body at the left, the tools (Claws,
 * Launcher) at the right. The two charm slots are the open accessory slots under the portrait (ACCESSORY_SLOTS). */
export const DOLL_COLUMNS: { l: GearSlot[]; r: GearSlot[] } = { // pP (61053)
  l: [`head`, `body`, `pack`],
  r: [`drill`, `launcher`],
};

/** MINEAR: the open accessory slots (the charms). */
export const ACCESSORY_SLOTS: GearSlot[] = [`charm1`, `charm2`];
/** MINEAR: accessory slots shown; the ones past ACCESSORY_SLOTS are locked (for later). */
export const ACCESSORY_MAX = 7;

/** MINEAR: the 4 big stat tiles at the top of the status: the first row of each stat group (Mining, Combat,
 * Survival, Travel). */
export const HIGHLIGHT_STATS = STAT_SHEET.map((e) => e.rows[0].stat);

/** MINEAR: the "+" of an empty accessory slot or ability slot (48x48). */
export const PLUS_SVG = `<svg viewBox="0 0 48 48"><path d="M24 13 V35 M13 24 H35" fill="none" stroke="#3a281c" stroke-width="5" stroke-linecap="round"/></svg>`;

/** mP (61054): a gem's place in the gem order lv. */
export const gemOrder = (e: string): number => GEM_IDS.indexOf(e as never); // mP (61054)

/** Uj (55408): the long description of a stat at value t (undefined for an unknown stat, as the original). */
export function skillText(e: string, t: number): string | undefined { // Uj (55408)
  switch (e) {
    case `power`:
      return `You burrow at power ${bold(formatNumber(2 + t))} (2 to start): harder rock gives way, and faster.`;
    case `bore`:
      return `Every bite of your claws carves a ${bold(`${(1.35 * (1 + t / 100)).toFixed(2)} m`)} hole, ${formatPercent(t)} wider than at the start.`;
    case `burrow`:
      return `You fly through tunnels and loose earth ${bold(formatPercent(t))} faster.`;
    case `sense`:
      return `You feel gems glowing through the rock from ${bold(`${formatNumber(12 + t)} m`)} away (12 m to start), and your lamp reaches further.`;
    case `oresight`:
      return `Ore veins glimmer through the murk in burrow vision${t >= 2 ? `, brighter and further off` : ``}.`;
    case `echo`:
      return `Press ${bold(`Q`)} while burrowing to send a sonar ping whenever you like.`;
    case `pack`:
      return `Your cart holds ${bold(String(8 + Math.round(t)))} gems (8 to start).`;
    case `magnet`:
      return `Loot lying around flies to you from ${bold(`${formatNumber(2.4 + t)} m`)} away (2.4 m to start).`;
    case `fortune`:
      return `Every ore nugget has a ${bold(formatPercent(t))} chance to bring a second one with it.`;
    case `gold`:
      return `Coin seams and gem sales pay ${bold(formatPercent(t))} more.`;
    case `luck`:
      return `Gems and gear have a ${bold(formatPercent(t))} chance to turn out one grade rarer.`;
    case `melee`:
      return `Each burrow hit deals ${bold(formatNumber(16 + t))} damage (16 to start).`;
    case `ranged`:
      return `Each bullet deals ${bold(formatNumber(8 + t))} damage (8 to start).`;
    case `rate`:
      return `You fire ${bold(formatNumber(2.94 * (1 + t / 100)))} bullets a second, ${formatPercent(t)} faster than at the start.`;
    case `crit`:
      return `${bold(formatPercent(10 + t))} of burrow hits and ${bold(formatPercent(8 + t))} of bullets land as critical hits, for 1.5× damage.`;
    case `vamp`:
      return `Every burrow hit heals you ${bold(formatPercent(t))} of the damage it deals.`;
    case `twin`:
      return `${bold(formatPercent(Math.min(100, t)))} of your shots fire a second bullet alongside the first.`;
    case `blast`:
      return `Every bullet bursts where it lands: ${bold(formatPercent(t))} of its damage to everything within 2.4 m (half that at the edge).`;
    case `bounce`:
      return `${bold(formatPercent(Math.min(100, t)))} of your bullets glance off rock once and fly on.`;
    case `caliber`:
      return `Your bullets are ${bold(formatPercent(t))} bigger: easier to land, and they knock back harder.`;
    case `muzzle`:
      return `Your bullets fly ${bold(formatPercent(t))} faster and drop less: easier to lead a moving target.`;
    case `ember`:
      return `Bullets set what they hit burning for 3 s: ${bold(formatPercent(t))} of the bullet's damage every second (${formatPercent(3 * t)} more in all). A fresh hit starts it again.`;
    case `venom`:
      return `Bullets poison what they hit for 5 s: ${bold(formatPercent(t))} of the bullet's damage every second (${formatPercent(5 * t)} more in all). Up to three doses work at once.`;
    case `frost`:
      return `Bullets slow what they hit by ${bold(formatPercent(Math.min(60, t)))} for 1.6 s, and its blows wind up ${formatPercent(Math.min(60, t) / 2)} slower.`;
    case `hp`:
      return `You have ${bold(formatNumber(100 + t))} health (100 to start).`;
    case `armor`:
      return `Every blow you take is ${bold(formatPercent(t))} weaker.`;
    case `regen`:
      return `Out of a fight you heal ${bold(`${formatNumber(t)} more`)} health a second, on top of 3.5% of your health.`;
    case `thorns`:
      return `Whatever hits you up close takes ${bold(formatPercent(t))} of the blow back (another miner, ${formatPercent(t * THORNS_PVP)}).`;
    case `nimble`:
      return `You can dash again ${bold(formatPercent(t))} sooner, and stay untouchable ${formatNumber((0.3 * t) / 100)} s longer.`;
    case `wind`:
      return `Once a trip, a blow that would knock you out leaves you standing instead.`;
    case `speed`:
      return `You run ${bold(formatPercent(t))} faster.`;
    case `fuel`:
      return `Your jetpack holds ${bold(formatNumber(100 + t))} fuel (100 to start), refills faster and lifts harder.`;
    case `resfire`:
      return `Lava and fire burn you ${bold(formatPercent(Math.min(90, t)))} less.`;
    case `respoison`:
      return `Poison and the Bog's water hurt you ${bold(formatPercent(Math.min(90, t)))} less.`;
    case `grip`:
      return `Spiked soles: you don't slide on ice.`;
  }
}

/** Wj (55482): the icon outline color. */
export const ICON_STROKE_COLOR = `#3a281c`; // Wj (55482)
/** X (55483): the shared SVG stroke attributes. */
export const ICON_STROKE = `stroke="${ICON_STROKE_COLOR}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`; // X (55483)

/** Gj (55484): 48x48 SVG markup per stat id. */
export const STAT_ICONS: Record<string, string> = { // Gj (55484)
    power: `<path d="M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z" fill="#fff1d6" ${ICON_STROKE}/><path d="M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z" fill="#fff1d6" ${ICON_STROKE}/><path d="M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z" fill="#fff1d6" ${ICON_STROKE}/><ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" ${ICON_STROKE}/><ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/>`, // MINEAR: a mole claw, no drill
    bore: `<circle cx="24" cy="24" r="11" fill="#6b4a34" ${ICON_STROKE}/><circle cx="24" cy="24" r="5" fill="#2a1b14"/><path d="M6 24 H1 M42 24 H47 M24 6 V1 M24 42 V47" ${ICON_STROKE}/><path d="M8 20 L4 24 L8 28 M40 20 L44 24 L40 28" fill="none" ${ICON_STROKE}/>`,
    melee: `<path d="M10 38 L30 18" stroke="#8c5c37" stroke-width="7" stroke-linecap="round"/><path d="M26 10 L40 8 L38 22 L28 20 Z" fill="#cfd6dd" ${ICON_STROKE}/><path d="M34 30 L42 34 M36 38 L44 38 M30 36 L32 44" ${ICON_STROKE}/>`,
    ranged: `<path d="M8 30 L30 14" stroke="#ff9a3c" stroke-width="3" stroke-dasharray="3 4" stroke-linecap="round"/><rect x="26" y="8" width="16" height="9" rx="4.5" transform="rotate(-35 34 12.5)" fill="#ffd28a" ${ICON_STROKE}/><circle cx="12" cy="36" r="5" fill="#ffb45a" ${ICON_STROKE}/>`,
    rate: `<rect x="18" y="16" width="22" height="10" rx="5" fill="#ffd28a" ${ICON_STROKE}/><path d="M4 16 H12 M2 22 H12 M6 28 H14" ${ICON_STROKE}/><path d="M22 34 L26 40 L30 34" fill="none" ${ICON_STROKE}/>`,
    hp: `<path d="M24 41 C8 30 5 20 10 13 C15 7 22 9 24 15 C26 9 33 7 38 13 C43 20 40 30 24 41 Z" fill="#ff6b6b" ${ICON_STROKE}/><path d="M15 16 Q17 13 20 14" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
    armor: `<path d="M24 5 L40 11 L38 27 C36 35 30 40 24 43 C18 40 12 35 10 27 L8 11 Z" fill="#6f8fd6" ${ICON_STROKE}/><path d="M24 11 V37 M14 19 H34" stroke="${ICON_STROKE_COLOR}" stroke-width="2.5" opacity=".45"/>`,
    speed: `<path d="M8 30 L30 30 L38 22 L42 26 L32 36 L8 36 Z" fill="#7fd6a0" ${ICON_STROKE}/><path d="M6 20 H18 M4 26 H14 M10 14 H22" ${ICON_STROKE}/>`,
    burrow: `<path d="M6 34 C10 22 18 22 22 30 C26 38 34 38 38 26" fill="none" stroke="#c98b5a" stroke-width="8" stroke-linecap="round"/><path d="M6 34 C10 22 18 22 22 30 C26 38 34 38 38 26" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="2" stroke-linecap="round" opacity=".5"/><circle cx="39" cy="22" r="6" fill="#e3a574" ${ICON_STROKE}/>`,
    fuel: `<path d="M24 6 C32 16 36 22 36 30 C36 37 30 42 24 42 C18 42 12 37 12 30 C12 22 16 16 24 6 Z" fill="#ff9a3c" ${ICON_STROKE}/><path d="M24 22 C28 28 29 31 29 33 C29 36 27 38 24 38 C21 38 19 36 19 33 C19 31 20 28 24 22 Z" fill="#ffe08a"/>`,
    pack: `<path d="M17 13 Q17 5 24 5 Q31 5 31 13" fill="none" ${ICON_STROKE}/><rect x="9" y="12" width="30" height="31" rx="8" fill="#c9854a" ${ICON_STROKE}/><rect x="15" y="25" width="18" height="11" rx="3" fill="#e0a86a" ${ICON_STROKE}/>`,
    sense: `<path d="M3 24 C10 12 38 12 45 24 C38 36 10 36 3 24 Z" fill="#fff6e5" ${ICON_STROKE}/><path d="M24 15 L31 24 L24 33 L17 24 Z" fill="#8ff0ff" ${ICON_STROKE}/>`,
    fortune: `<path d="M8 34 L14 24 L22 26 L26 36 L16 40 Z" fill="#ff8a4a" ${ICON_STROKE}/><path d="M22 22 L28 12 L38 14 L40 26 L30 28 Z" fill="#ffd23c" ${ICON_STROKE}/><path d="M34 34 L40 32 L42 40 L36 42 Z" fill="#e8dccb" ${ICON_STROKE}/>`,
    luck: `<circle cx="17" cy="17" r="8" fill="#6fd08a" ${ICON_STROKE}/><circle cx="31" cy="17" r="8" fill="#6fd08a" ${ICON_STROKE}/><circle cx="17" cy="31" r="8" fill="#6fd08a" ${ICON_STROKE}/><circle cx="31" cy="31" r="8" fill="#6fd08a" ${ICON_STROKE}/><path d="M24 24 L30 44" ${ICON_STROKE}/>`,
    crit: `<circle cx="24" cy="24" r="16" fill="#fff6e5" ${ICON_STROKE}/><circle cx="24" cy="24" r="9" fill="#ff6b5f" ${ICON_STROKE}/><circle cx="24" cy="24" r="3" fill="${ICON_STROKE_COLOR}"/><path d="M24 2 V8 M24 40 V46 M2 24 H8 M40 24 H46" ${ICON_STROKE}/>`,
    regen: `<path d="M24 41 C8 30 5 20 10 13 C15 7 22 9 24 15 C26 9 33 7 38 13 C43 20 40 30 24 41 Z" fill="#7be08f" ${ICON_STROKE}/><path d="M24 17 V31 M17 24 H31" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    vamp: `<path d="M10 12 H38 L34 22 L30 16 L27 30 L24 18 L21 30 L18 16 L14 22 Z" fill="#fff6e5" ${ICON_STROKE}/><path d="M24 30 C28 36 29 38 29 40 C29 43 27 45 24 45 C21 45 19 43 19 40 C19 38 20 36 24 30 Z" fill="#e0463c" ${ICON_STROKE}/>`,
    twin: `<rect x="14" y="8" width="10" height="20" rx="5" fill="#ffd28a" ${ICON_STROKE}/><rect x="26" y="16" width="10" height="20" rx="5" fill="#ffd28a" ${ICON_STROKE}/><path d="M19 34 V42 M31 40 V46" stroke="#ff9a3c" stroke-width="3" stroke-linecap="round"/>`,
    blast: `<path d="M24 4 L28 16 L40 10 L33 22 L45 26 L33 30 L39 42 L27 35 L24 46 L20 35 L9 42 L15 30 L3 26 L15 22 L8 10 L20 16 Z" fill="#ffb45a" ${ICON_STROKE}/><circle cx="24" cy="26" r="6" fill="#fff0c0"/>`,
    bounce: `<path d="M6 10 L22 34 L30 18 L42 38" fill="none" stroke="#ff9a3c" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M36 38 L42 38 L42 32" fill="none" ${ICON_STROKE}/><path d="M4 40 H44" stroke="#8a7a6a" stroke-width="4" stroke-linecap="round"/>`,
    thorns: `<path d="M10 40 L14 26 L8 24 L18 18 L16 8 L24 14 L32 8 L30 18 L40 24 L34 26 L38 40 L24 34 Z" fill="#b58cff" ${ICON_STROKE}/>`,
    nimble: `<path d="M12 40 C16 22 26 10 40 6 C38 18 30 32 12 40 Z" fill="#e9eef5" ${ICON_STROKE}/><path d="M16 36 C22 28 28 20 36 12" stroke="${ICON_STROKE_COLOR}" stroke-width="2" fill="none" opacity=".6"/><path d="M4 30 H10 M6 36 H12" ${ICON_STROKE}/>`,
    gold: `<ellipse cx="24" cy="34" rx="14" ry="6" fill="#ffc23d" ${ICON_STROKE}/><ellipse cx="24" cy="26" rx="14" ry="6" fill="#ffc23d" ${ICON_STROKE}/><ellipse cx="24" cy="18" rx="14" ry="6" fill="#ffd96a" ${ICON_STROKE}/>`,
    magnet: `<path d="M10 8 H20 V26 C20 30 28 30 28 26 V8 H38 V26 C38 38 10 38 10 26 Z" fill="#ff6b5f" ${ICON_STROKE}/><path d="M10 8 H20 V14 H10 Z M28 8 H38 V14 H28 Z" fill="#cfd6dd" ${ICON_STROKE}/>`,
    wind: `<path d="M6 18 H30 C36 18 36 10 30 10 M6 26 H38 C44 26 44 36 38 36 M6 34 H22" fill="none" stroke="#8ff0ff" stroke-width="4" stroke-linecap="round"/><path d="M6 18 H30 C36 18 36 10 30 10 M6 26 H38 C44 26 44 36 38 36 M6 34 H22" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>`,
    echo: `<circle cx="14" cy="24" r="5" fill="#8ff0ff" ${ICON_STROKE}/><path d="M22 14 C28 20 28 28 22 34 M30 8 C40 18 40 30 30 40" fill="none" ${ICON_STROKE}/>`,
    oresight: `<path d="M3 24 C10 12 38 12 45 24 C38 36 10 36 3 24 Z" fill="#fff6e5" ${ICON_STROKE}/><circle cx="24" cy="24" r="8" fill="#ffd23c" ${ICON_STROKE}/><path d="M20 22 L24 18 L28 22" stroke="#fff" stroke-width="2" fill="none"/>`,
    caliber: `<rect x="12" y="16" width="26" height="16" rx="8" fill="#ffd28a" ${ICON_STROKE}/><path d="M38 20 L44 24 L38 28" fill="#e39a14" ${ICON_STROKE}/><path d="M4 18 H9 M3 24 H9 M4 30 H9" ${ICON_STROKE}/>`,
    muzzle: `<rect x="22" y="19" width="18" height="10" rx="5" fill="#ffd28a" ${ICON_STROKE}/><path d="M2 20 H16 M6 26 H18 M2 32 H14" ${ICON_STROKE}/><path d="M40 21 L46 24 L40 27" fill="#e39a14" ${ICON_STROKE}/>`,
    ember: `<path d="M24 4 C30 14 36 18 36 28 C36 36 30 42 24 42 C18 42 12 36 12 28 C12 22 16 18 18 12 C20 18 22 20 24 20 C24 14 23 9 24 4 Z" fill="#ff7a3c" ${ICON_STROKE}/><path d="M24 26 C27 30 28 32 28 34 C28 37 26 38 24 38 C22 38 20 37 20 34 C20 31 22 29 24 26 Z" fill="#ffe08a"/>`,
    venom: `<path d="M24 5 C31 16 36 23 36 30 C36 37 30 43 24 43 C18 43 12 37 12 30 C12 23 17 16 24 5 Z" fill="#7be08f" ${ICON_STROKE}/><circle cx="19" cy="30" r="3" fill="#fff" opacity=".8"/><path d="M28 34 Q30 30 28 27" stroke="${ICON_STROKE_COLOR}" stroke-width="2" fill="none" opacity=".5"/>`,
    frost: `<path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14" stroke="#8fe8ff" stroke-width="5" stroke-linecap="round"/><path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14" ${ICON_STROKE} fill="none"/><path d="M19 8 L24 13 L29 8 M19 40 L24 35 L29 40" ${ICON_STROKE} fill="none"/><circle cx="24" cy="24" r="5" fill="#e8fbff" ${ICON_STROKE}/>`,
    resfire: `<path d="M24 4 L40 10 C40 26 34 37 24 44 C14 37 8 26 8 10 Z" fill="#8a5a3c" ${ICON_STROKE}/><path d="M24 14 C28 20 31 23 31 28 C31 32 28 35 24 35 C20 35 17 32 17 28 C17 25 19 22 21 19 C22 22 23 23 24 23 C24 20 23.5 17 24 14 Z" fill="#ff8a3c" ${ICON_STROKE}/><path d="M24 26 C26 28.5 26.8 30 26.8 31 C26.8 32.6 25.6 33.4 24 33.4 C22.4 33.4 21.2 32.6 21.2 31 C21.2 29.6 22.4 28 24 26 Z" fill="#ffe08a"/>`,
    respoison: `<path d="M24 4 L40 10 C40 26 34 37 24 44 C14 37 8 26 8 10 Z" fill="#3f6a4a" ${ICON_STROKE}/><path d="M24 13 C28.5 20 31 24 31 28 C31 32 28 35 24 35 C20 35 17 32 17 28 C17 24 19.5 20 24 13 Z" fill="#9fe870" ${ICON_STROKE}/><circle cx="21.5" cy="28" r="2" fill="#fff" opacity=".8"/>`,
    grip: `<path d="M9 22 C9 16 14 12 20 12 L30 12 C36 12 40 16 40 22 L40 28 L9 28 Z" fill="#8fb7d9" ${ICON_STROKE}/><path d="M11 28 L14 37 L17 28 M19 28 L22 37 L25 28 M27 28 L30 37 L33 28 M35 28 L37 35 L39 28" fill="#e8fbff" ${ICON_STROKE}/>`,
};

/** Kj (55521): a stat icon as an <svg> (the power icon for an unknown id). */
export const statIcon = (e: string): string => `<svg viewBox="0 0 48 48">${STAT_ICONS[e] ?? STAT_ICONS.power}</svg>`; // Kj (55521)

/** qj (55522): the card art of a stat. */
export const cardArt = (e: string): string => `/cards/${e}.webp`; // qj (55522)

/** MINEAR: the mine cart in the Cart page header (168x112, the game's ink outline): a wooden cart with iron bands
 * on a rail, ore lumps and gems peeking out over the rim. */
export const CART_ART = `<svg viewBox="0 0 168 112" aria-hidden="true">
<g fill="#8a5a3a" stroke="${ICON_STROKE_COLOR}" stroke-width="2.5" stroke-linejoin="round"><rect x="6" y="100" width="22" height="9" rx="2.5"/><rect x="51" y="100" width="22" height="9" rx="2.5"/><rect x="96" y="100" width="22" height="9" rx="2.5"/><rect x="140" y="100" width="22" height="9" rx="2.5"/></g>
<rect x="2" y="95" width="164" height="7" rx="3.5" fill="#b9c2cc" ${ICON_STROKE}/>
<circle cx="52" cy="85" r="11" fill="#5a4636" ${ICON_STROKE}/><circle cx="116" cy="85" r="11" fill="#5a4636" ${ICON_STROKE}/>
<circle cx="52" cy="85" r="4" fill="#d9dee4" stroke="${ICON_STROKE_COLOR}" stroke-width="2.5"/><circle cx="116" cy="85" r="4" fill="#d9dee4" stroke="${ICON_STROKE_COLOR}" stroke-width="2.5"/>
<path d="M22 44 C18 32 28 24 38 27 C44 19 58 22 58 33 L60 44 Z" fill="#9a7650" ${ICON_STROKE}/>
<circle cx="32" cy="34" r="2.6" fill="#ff8a4a"/><circle cx="45" cy="29" r="2.2" fill="#ff8a4a"/><circle cx="51" cy="37" r="2" fill="#ffb27a"/>
<path d="M112 44 C110 31 121 24 131 28 C140 24 150 33 147 44 Z" fill="#a9b0ba" ${ICON_STROKE}/>
<circle cx="123" cy="34" r="2.4" fill="#eef2f6"/><circle cx="136" cy="31" r="2" fill="#eef2f6"/><circle cx="140" cy="39" r="1.8" fill="#eef2f6"/>
<path d="M50 44 L46 30 L54 22 L64 26 L66 40 Z" fill="#7be08f" ${ICON_STROKE}/>
<path d="M54 22 L56 32 L46 30 M56 32 L66 40" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="2" opacity=".35"/>
<g transform="rotate(16 108 26)"><path d="M108 10 L118 22 L108 40 L98 22 Z" fill="#c38bff" ${ICON_STROKE}/><path d="M98 22 H118 M108 10 V40" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="2" opacity=".35"/></g>
<path d="M84 4 L98 13 L98 29 L84 38 L70 29 L70 13 Z" fill="#5fb4ff" ${ICON_STROKE}/>
<path d="M70 13 L84 21 L98 13 M84 21 V38" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="2" opacity=".35"/>
<path d="M75 13 L81 9.5" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<path d="M66 44 C64 36 72 31 78 34 C84 31 92 36 90 44 Z" fill="#ffc23d" ${ICON_STROKE}/>
<path d="M71 37.5 Q74 35 77 36" fill="none" stroke="#fff6c8" stroke-width="2.5" stroke-linecap="round"/>
<path d="M58 4 L60 9 L65 11 L60 13 L58 18 L56 13 L51 11 L56 9 Z" fill="#fff6c8" stroke="${ICON_STROKE_COLOR}" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M128 9 L129.6 13 L133.5 14.5 L129.6 16 L128 20 L126.4 16 L122.5 14.5 L126.4 13 Z" fill="#fff6c8" stroke="${ICON_STROKE_COLOR}" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M138 62 H155 A4.5 4.5 0 0 1 155 71 H150" fill="none" ${ICON_STROKE}/>
<path d="M22 45 H146 L135 84 H33 Z" fill="#c98b5a" ${ICON_STROKE}/>
<path d="M25.5 58 H142.5 M29 71 H139" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="2" opacity=".3"/>
<path d="M29 51.5 H44 M60 51.5 H108" fill="none" stroke="#fff3df" stroke-width="3" stroke-linecap="round" opacity=".5"/>
<path d="M50 46 L53 83 M118 46 L115 83" fill="none" stroke="${ICON_STROKE_COLOR}" stroke-width="9"/>
<path d="M50 46 L53 83 M118 46 L115 83" fill="none" stroke="#8d97a5" stroke-width="4.5"/>
<g fill="${ICON_STROKE_COLOR}"><circle cx="51" cy="57" r="1.5"/><circle cx="52" cy="70" r="1.5"/><circle cx="117" cy="57" r="1.5"/><circle cx="116" cy="70" r="1.5"/></g>
<rect x="14" y="36" width="140" height="11" rx="4.5" fill="#8d97a5" ${ICON_STROKE}/>
<path d="M20 39.8 H148" fill="none" stroke="#d3dae3" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
