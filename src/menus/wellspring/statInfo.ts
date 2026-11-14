// Port of play-inUT-NSi.js 55408-55521: the long stat descriptions Uj and the stat icon SVGs Wj / X / Gj / Kj.
// The rest of the stat card system (55310-55407: groups Ij, canDraft Lj, unit words Rj, formatters zj / Bj / Vj,
// short values Hj) is src/state/statCards.ts and is imported, not copied.
// Users outside the Wellspring: the inventory skills page and tooltips (hP 61236-61704) call Kj and Uj.
import { THORNS_PVP } from '../../state/gearStats';
import { bold, formatNumber, formatPercent } from '../../state/statCards';

const zj = formatNumber; // zj (55384)
const Bj = formatPercent; // Bj (55386)
const Vj = bold; // Vj (55387)

/** Long description of stat e at total t (HTML with <b>); undefined for an unknown id. */
export function statDescription(e: string, t: number): string | undefined { // Uj (55408)
  switch (e) {
    case `power`:
      return `You burrow at power ${Vj(zj(2 + t))} (2 to start): harder rock gives way, and faster.`;
    case `bore`:
      return `Every bite of your claws carves a ${Vj(`${(1.35 * (1 + t / 100)).toFixed(2)} m`)} hole, ${Bj(t)} wider than at the start.`;
    case `burrow`:
      return `You fly through tunnels and loose earth ${Vj(Bj(t))} faster.`;
    case `sense`:
      return `You feel gems glowing through the rock from ${Vj(`${zj(12 + t)} m`)} away (12 m to start), and your lamp reaches further.`;
    case `oresight`:
      return `Ore veins glimmer through the murk in burrow vision${t >= 2 ? `, brighter and further off` : ``}.`;
    case `echo`:
      return `Press ${Vj(`Q`)} while burrowing to send a sonar ping whenever you like.`;
    case `pack`:
      return `Your cart holds ${Vj(String(8 + Math.round(t)))} gems (8 to start).`;
    case `magnet`:
      return `Loot lying around flies to you from ${Vj(`${zj(2.4 + t)} m`)} away (2.4 m to start).`;
    case `fortune`:
      return `Every ore nugget has a ${Vj(Bj(t))} chance to bring a second one with it.`;
    case `gold`:
      return `Coin seams and gem sales pay ${Vj(Bj(t))} more.`;
    case `luck`:
      return `Gems and gear have a ${Vj(Bj(t))} chance to turn out one grade rarer.`;
    case `melee`:
      return `Each burrow hit deals ${Vj(zj(16 + t))} damage (16 to start).`;
    case `ranged`:
      return `Each bullet deals ${Vj(zj(8 + t))} damage (8 to start).`;
    case `rate`:
      return `You fire ${Vj(zj(2.94 * (1 + t / 100)))} bullets a second, ${Bj(t)} faster than at the start.`;
    case `crit`:
      return `${Vj(Bj(10 + t))} of burrow hits and ${Vj(Bj(8 + t))} of bullets land as critical hits, for 1.5× damage.`;
    case `vamp`:
      return `Every burrow hit heals you ${Vj(Bj(t))} of the damage it deals.`;
    case `twin`:
      return `${Vj(Bj(Math.min(100, t)))} of your shots fire a second bullet alongside the first.`;
    case `blast`:
      return `Every bullet bursts where it lands: ${Vj(Bj(t))} of its damage to everything within 2.4 m (half that at the edge).`;
    case `bounce`:
      return `${Vj(Bj(Math.min(100, t)))} of your bullets glance off rock once and fly on.`;
    case `caliber`:
      return `Your bullets are ${Vj(Bj(t))} bigger: easier to land, and they knock back harder.`;
    case `muzzle`:
      return `Your bullets fly ${Vj(Bj(t))} faster and drop less: easier to lead a moving target.`;
    case `ember`:
      return `Bullets set what they hit burning for 3 s: ${Vj(Bj(t))} of the bullet's damage every second (${Bj(3 * t)} more in all). A fresh hit starts it again.`;
    case `venom`:
      return `Bullets poison what they hit for 5 s: ${Vj(Bj(t))} of the bullet's damage every second (${Bj(5 * t)} more in all). Up to three doses work at once.`;
    case `frost`:
      return `Bullets slow what they hit by ${Vj(Bj(Math.min(60, t)))} for 1.6 s, and its blows wind up ${Bj(Math.min(60, t) / 2)} slower.`;
    case `hp`:
      return `You have ${Vj(zj(100 + t))} health (100 to start).`;
    case `armor`:
      return `Every blow you take is ${Vj(Bj(t))} weaker.`;
    case `regen`:
      return `Out of a fight you heal ${Vj(`${zj(t)} more`)} health a second, on top of 3.5% of your health.`;
    case `thorns`:
      return `Whatever hits you up close takes ${Vj(Bj(t))} of the blow back (another miner, ${Bj(t * THORNS_PVP)}).`;
    case `nimble`:
      return `You can dash again ${Vj(Bj(t))} sooner, and stay untouchable ${zj((0.3 * t) / 100)} s longer.`;
    case `wind`:
      return `Once a trip, a blow that would knock you out leaves you standing instead.`;
    case `speed`:
      return `You run ${Vj(Bj(t))} faster.`;
    case `fuel`:
      return `Your jetpack holds ${Vj(zj(100 + t))} fuel (100 to start), refills faster and lifts harder.`;
    case `resfire`:
      return `Lava and fire burn you ${Vj(Bj(Math.min(90, t)))} less.`;
    case `respoison`:
      return `Poison and the Bog's water hurt you ${Vj(Bj(Math.min(90, t)))} less.`;
    case `grip`:
      return `Spiked soles: you don't slide on ice.`;
  }
  return undefined;
}

/** The stat icon outline color. */
export const ICON_OUTLINE = `#3a281c`; // Wj (55482)
/** The shared SVG stroke attributes of the stat icons. */
export const ICON_STROKE = `stroke="${ICON_OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`; // X (55483)

const Wj = ICON_OUTLINE;
const X = ICON_STROKE;

/** 48x48 SVG body markup per stat icon id (StatDef.icon). */
export const STAT_ICONS: Record<string, string> = { // Gj (55484)
  power: `<path d="M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z" fill="#fff1d6" ${X}/><path d="M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z" fill="#fff1d6" ${X}/><path d="M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z" fill="#fff1d6" ${X}/><ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" ${X}/><ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/>`, // MINEAR: a mole claw, no drill
  bore: `<circle cx="24" cy="24" r="11" fill="#6b4a34" ${X}/><circle cx="24" cy="24" r="5" fill="#2a1b14"/><path d="M6 24 H1 M42 24 H47 M24 6 V1 M24 42 V47" ${X}/><path d="M8 20 L4 24 L8 28 M40 20 L44 24 L40 28" fill="none" ${X}/>`,
  melee: `<path d="M10 38 L30 18" stroke="#8c5c37" stroke-width="7" stroke-linecap="round"/><path d="M26 10 L40 8 L38 22 L28 20 Z" fill="#cfd6dd" ${X}/><path d="M34 30 L42 34 M36 38 L44 38 M30 36 L32 44" ${X}/>`,
  ranged: `<path d="M8 30 L30 14" stroke="#ff9a3c" stroke-width="3" stroke-dasharray="3 4" stroke-linecap="round"/><rect x="26" y="8" width="16" height="9" rx="4.5" transform="rotate(-35 34 12.5)" fill="#ffd28a" ${X}/><circle cx="12" cy="36" r="5" fill="#ffb45a" ${X}/>`,
  rate: `<rect x="18" y="16" width="22" height="10" rx="5" fill="#ffd28a" ${X}/><path d="M4 16 H12 M2 22 H12 M6 28 H14" ${X}/><path d="M22 34 L26 40 L30 34" fill="none" ${X}/>`,
  hp: `<path d="M24 41 C8 30 5 20 10 13 C15 7 22 9 24 15 C26 9 33 7 38 13 C43 20 40 30 24 41 Z" fill="#ff6b6b" ${X}/><path d="M15 16 Q17 13 20 14" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
  armor: `<path d="M24 5 L40 11 L38 27 C36 35 30 40 24 43 C18 40 12 35 10 27 L8 11 Z" fill="#6f8fd6" ${X}/><path d="M24 11 V37 M14 19 H34" stroke="${Wj}" stroke-width="2.5" opacity=".45"/>`,
  speed: `<path d="M8 30 L30 30 L38 22 L42 26 L32 36 L8 36 Z" fill="#7fd6a0" ${X}/><path d="M6 20 H18 M4 26 H14 M10 14 H22" ${X}/>`,
  burrow: `<path d="M6 34 C10 22 18 22 22 30 C26 38 34 38 38 26" fill="none" stroke="#c98b5a" stroke-width="8" stroke-linecap="round"/><path d="M6 34 C10 22 18 22 22 30 C26 38 34 38 38 26" fill="none" stroke="${Wj}" stroke-width="2" stroke-linecap="round" opacity=".5"/><circle cx="39" cy="22" r="6" fill="#e3a574" ${X}/>`,
  fuel: `<path d="M24 6 C32 16 36 22 36 30 C36 37 30 42 24 42 C18 42 12 37 12 30 C12 22 16 16 24 6 Z" fill="#ff9a3c" ${X}/><path d="M24 22 C28 28 29 31 29 33 C29 36 27 38 24 38 C21 38 19 36 19 33 C19 31 20 28 24 22 Z" fill="#ffe08a"/>`,
  pack: `<path d="M17 13 Q17 5 24 5 Q31 5 31 13" fill="none" ${X}/><rect x="9" y="12" width="30" height="31" rx="8" fill="#c9854a" ${X}/><rect x="15" y="25" width="18" height="11" rx="3" fill="#e0a86a" ${X}/>`,
  sense: `<path d="M3 24 C10 12 38 12 45 24 C38 36 10 36 3 24 Z" fill="#fff6e5" ${X}/><path d="M24 15 L31 24 L24 33 L17 24 Z" fill="#8ff0ff" ${X}/>`,
  fortune: `<path d="M8 34 L14 24 L22 26 L26 36 L16 40 Z" fill="#ff8a4a" ${X}/><path d="M22 22 L28 12 L38 14 L40 26 L30 28 Z" fill="#ffd23c" ${X}/><path d="M34 34 L40 32 L42 40 L36 42 Z" fill="#e8dccb" ${X}/>`,
  luck: `<circle cx="17" cy="17" r="8" fill="#6fd08a" ${X}/><circle cx="31" cy="17" r="8" fill="#6fd08a" ${X}/><circle cx="17" cy="31" r="8" fill="#6fd08a" ${X}/><circle cx="31" cy="31" r="8" fill="#6fd08a" ${X}/><path d="M24 24 L30 44" ${X}/>`,
  crit: `<circle cx="24" cy="24" r="16" fill="#fff6e5" ${X}/><circle cx="24" cy="24" r="9" fill="#ff6b5f" ${X}/><circle cx="24" cy="24" r="3" fill="${Wj}"/><path d="M24 2 V8 M24 40 V46 M2 24 H8 M40 24 H46" ${X}/>`,
  regen: `<path d="M24 41 C8 30 5 20 10 13 C15 7 22 9 24 15 C26 9 33 7 38 13 C43 20 40 30 24 41 Z" fill="#7be08f" ${X}/><path d="M24 17 V31 M17 24 H31" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  vamp: `<path d="M10 12 H38 L34 22 L30 16 L27 30 L24 18 L21 30 L18 16 L14 22 Z" fill="#fff6e5" ${X}/><path d="M24 30 C28 36 29 38 29 40 C29 43 27 45 24 45 C21 45 19 43 19 40 C19 38 20 36 24 30 Z" fill="#e0463c" ${X}/>`,
  twin: `<rect x="14" y="8" width="10" height="20" rx="5" fill="#ffd28a" ${X}/><rect x="26" y="16" width="10" height="20" rx="5" fill="#ffd28a" ${X}/><path d="M19 34 V42 M31 40 V46" stroke="#ff9a3c" stroke-width="3" stroke-linecap="round"/>`,
  blast: `<path d="M24 4 L28 16 L40 10 L33 22 L45 26 L33 30 L39 42 L27 35 L24 46 L20 35 L9 42 L15 30 L3 26 L15 22 L8 10 L20 16 Z" fill="#ffb45a" ${X}/><circle cx="24" cy="26" r="6" fill="#fff0c0"/>`,
  bounce: `<path d="M6 10 L22 34 L30 18 L42 38" fill="none" stroke="#ff9a3c" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M36 38 L42 38 L42 32" fill="none" ${X}/><path d="M4 40 H44" stroke="#8a7a6a" stroke-width="4" stroke-linecap="round"/>`,
  thorns: `<path d="M10 40 L14 26 L8 24 L18 18 L16 8 L24 14 L32 8 L30 18 L40 24 L34 26 L38 40 L24 34 Z" fill="#b58cff" ${X}/>`,
  nimble: `<path d="M12 40 C16 22 26 10 40 6 C38 18 30 32 12 40 Z" fill="#e9eef5" ${X}/><path d="M16 36 C22 28 28 20 36 12" stroke="${Wj}" stroke-width="2" fill="none" opacity=".6"/><path d="M4 30 H10 M6 36 H12" ${X}/>`,
  gold: `<ellipse cx="24" cy="34" rx="14" ry="6" fill="#ffc23d" ${X}/><ellipse cx="24" cy="26" rx="14" ry="6" fill="#ffc23d" ${X}/><ellipse cx="24" cy="18" rx="14" ry="6" fill="#ffd96a" ${X}/>`,
  magnet: `<path d="M10 8 H20 V26 C20 30 28 30 28 26 V8 H38 V26 C38 38 10 38 10 26 Z" fill="#ff6b5f" ${X}/><path d="M10 8 H20 V14 H10 Z M28 8 H38 V14 H28 Z" fill="#cfd6dd" ${X}/>`,
  wind: `<path d="M6 18 H30 C36 18 36 10 30 10 M6 26 H38 C44 26 44 36 38 36 M6 34 H22" fill="none" stroke="#8ff0ff" stroke-width="4" stroke-linecap="round"/><path d="M6 18 H30 C36 18 36 10 30 10 M6 26 H38 C44 26 44 36 38 36 M6 34 H22" fill="none" stroke="${Wj}" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>`,
  echo: `<circle cx="14" cy="24" r="5" fill="#8ff0ff" ${X}/><path d="M22 14 C28 20 28 28 22 34 M30 8 C40 18 40 30 30 40" fill="none" ${X}/>`,
  oresight: `<path d="M3 24 C10 12 38 12 45 24 C38 36 10 36 3 24 Z" fill="#fff6e5" ${X}/><circle cx="24" cy="24" r="8" fill="#ffd23c" ${X}/><path d="M20 22 L24 18 L28 22" stroke="#fff" stroke-width="2" fill="none"/>`,
  caliber: `<rect x="12" y="16" width="26" height="16" rx="8" fill="#ffd28a" ${X}/><path d="M38 20 L44 24 L38 28" fill="#e39a14" ${X}/><path d="M4 18 H9 M3 24 H9 M4 30 H9" ${X}/>`,
  muzzle: `<rect x="22" y="19" width="18" height="10" rx="5" fill="#ffd28a" ${X}/><path d="M2 20 H16 M6 26 H18 M2 32 H14" ${X}/><path d="M40 21 L46 24 L40 27" fill="#e39a14" ${X}/>`,
  ember: `<path d="M24 4 C30 14 36 18 36 28 C36 36 30 42 24 42 C18 42 12 36 12 28 C12 22 16 18 18 12 C20 18 22 20 24 20 C24 14 23 9 24 4 Z" fill="#ff7a3c" ${X}/><path d="M24 26 C27 30 28 32 28 34 C28 37 26 38 24 38 C22 38 20 37 20 34 C20 31 22 29 24 26 Z" fill="#ffe08a"/>`,
  venom: `<path d="M24 5 C31 16 36 23 36 30 C36 37 30 43 24 43 C18 43 12 37 12 30 C12 23 17 16 24 5 Z" fill="#7be08f" ${X}/><circle cx="19" cy="30" r="3" fill="#fff" opacity=".8"/><path d="M28 34 Q30 30 28 27" stroke="${Wj}" stroke-width="2" fill="none" opacity=".5"/>`,
  frost: `<path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14" stroke="#8fe8ff" stroke-width="5" stroke-linecap="round"/><path d="M24 4 V44 M6.7 14 L41.3 34 M6.7 34 L41.3 14" ${X} fill="none"/><path d="M19 8 L24 13 L29 8 M19 40 L24 35 L29 40" ${X} fill="none"/><circle cx="24" cy="24" r="5" fill="#e8fbff" ${X}/>`,
  resfire: `<path d="M24 4 L40 10 C40 26 34 37 24 44 C14 37 8 26 8 10 Z" fill="#8a5a3c" ${X}/><path d="M24 14 C28 20 31 23 31 28 C31 32 28 35 24 35 C20 35 17 32 17 28 C17 25 19 22 21 19 C22 22 23 23 24 23 C24 20 23.5 17 24 14 Z" fill="#ff8a3c" ${X}/><path d="M24 26 C26 28.5 26.8 30 26.8 31 C26.8 32.6 25.6 33.4 24 33.4 C22.4 33.4 21.2 32.6 21.2 31 C21.2 29.6 22.4 28 24 26 Z" fill="#ffe08a"/>`,
  respoison: `<path d="M24 4 L40 10 C40 26 34 37 24 44 C14 37 8 26 8 10 Z" fill="#3f6a4a" ${X}/><path d="M24 13 C28.5 20 31 24 31 28 C31 32 28 35 24 35 C20 35 17 32 17 28 C17 24 19.5 20 24 13 Z" fill="#9fe870" ${X}/><circle cx="21.5" cy="28" r="2" fill="#fff" opacity=".8"/>`,
  grip: `<path d="M9 22 C9 16 14 12 20 12 L30 12 C36 12 40 16 40 22 L40 28 L9 28 Z" fill="#8fb7d9" ${X}/><path d="M11 28 L14 37 L17 28 M19 28 L22 37 L25 28 M27 28 L30 37 L33 28 M35 28 L37 35 L39 28" fill="#e8fbff" ${X}/>`,
};

/** A stat icon as a full <svg viewBox="0 0 48 48"> (unknown ids show the Drill Power icon). */
export const statIcon = (e: string): string => `<svg viewBox="0 0 48 48">${STAT_ICONS[e] ?? STAT_ICONS.power}</svg>`; // Kj (55521)
