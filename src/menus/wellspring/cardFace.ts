// Port of play-inUT-NSi.js 55522-55591: the Wellspring card art (qj, Jj, the preload Yj / Xj / Zj, the gem art
// list Qj), the star $j and crest eM SVGs, and the card face HTML tM with its number format nM.
// Users outside the Wellspring: the inventory skills page (hP 61263-61704) calls qj; KR's loading screen
// (70945) awaits Zj with an 8 s limit.
// The art paths are absolute paths under public/ (/cards/<stat>.webp, /cards/gem_<gem>.webp).
import { IS_TOUCH } from '../../game/device';
import { STATS, STAT_IDS, displayRound, statLabel, type StatOffer } from '../../state/gearStats';
import { PERCENT_WORDS } from '../../state/statCards';
import { TIER_NAMES } from '../../state/progression';

const J = IS_TOUCH; // J

/** The painted card art of a stat. */
export const cardArtUrl = (e: string): string => `/cards/${e}.webp`; // qj (55522)
/** The painted art of a gem (Wellspring tray, touch gem viewer). */
export const gemArtUrl = (e: string): string => `/cards/gem_${e}.webp`; // Jj (55523)

let preloading: Promise<void> | null = null; // Yj (55524)
/** Desktop keeps the decoded images alive. */
const kept: HTMLImageElement[] = []; // Xj (55525)

/** Loads and decodes every card and gem image once (the same promise on every call). */
export function preloadCardArt(): Promise<void> { // Zj (55526)
  return (preloading ??= Promise.all(
    [...STAT_IDS.map(cardArtUrl), ...CARD_GEMS.map(gemArtUrl)].map((e) => {
      const t = new Image();
      t.decoding = `async`;
      t.src = e;
      if (!J) kept.push(t);
      return t.decode().catch(() => {});
    }),
  ).then(() => {}));
}

/** The gems that have painted art. */
export const CARD_GEMS = [ // Qj (55537)
  `quartz`,
  `amethyst`,
  `emerald`,
  `sapphire`,
  `ruby`,
  `sunstone`,
  `voidheart`,
  `bogjade`,
  `rime`,
  `fireopal`,
  `soulpearl`,
];

/** One tier star. */
export const STAR_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2.2l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.3l-6.05 3.4 1.3-6.75-5-4.7 6.8-.85z"/></svg>`; // $j (55550)

/** The card crest: rings and a faceted hexagonal gem (classes r0 r1 f1-f4 hl). */
export const CREST_SVG = `<svg class="crest" viewBox="0 0 40 40"><circle class="r0" cx="20" cy="20" r="19"/><circle class="r1" cx="20" cy="20" r="16.5"/><circle class="r0" cx="20" cy="20" r="13"/>
  <polygon class="f3" points="20,8.5 29.5,14 29.5,26 20,31.5 10.5,26 10.5,14"/><polygon class="f1" points="20,8.5 29.5,14 20,19.5"/><polygon class="f2" points="20,8.5 10.5,14 20,19.5"/>
  <polygon class="f2" points="10.5,14 10.5,26 20,19.5"/><polygon class="f4" points="29.5,14 29.5,26 20,19.5"/><polygon class="f3" points="10.5,26 20,31.5 20,19.5"/>
  <polygon class="f4" points="29.5,26 20,31.5 20,19.5"/><polygon class="hl" points="15,12 20,9.5 18,14"/></svg>`; // eM (55551)

/**
 * The face of a Wellspring card: e = the offer, t = the stat now, n = the stat after the pick.
 * Big value (cap > 2 stats; Ore Sight shows I / II), unit, tier stars, Special badge for perks, name, blurb,
 * and the foot line (now -> after, New!, New power, Already yours, Sharper sight) with the tier name.
 */
export function cardFace(e: StatOffer, t: number, n = t + e.value): string { // tM (55555)
  const r = STATS[e.id],
    i =
      r.cap <= 2
        ? r.id === `oresight`
          ? t
            ? `II`
            : `I`
          : ``
        : statLabel(e.id, displayRound(n - t), !1).replace(/ (HP|m|HP\/s)$/, ``),
    a = r.cap <= 2 ? `` : r.unit === `%` ? (PERCENT_WORDS[e.id] ?? ``) : r.unit.trim(),
    o = r.unit === `%` ? `%` : ``,
    s =
      r.cap <= 2
        ? t > 0 && r.id === `oresight`
          ? `Sharper sight`
          : t > 0
            ? `Already yours`
            : `New power`
        : t > 0
          ? `${cardNumber(t)}${o} <i>→</i> <b>${cardNumber(n)}${o}</b>`
          : `<b>New!</b>`;
  return `<div class="face t${e.tier}${r.perk ? ` perk` : ``}${i ? `` : ` nobig`}">
    <div class="art"><div class="abg"></div><div class="arays"></div><div class="bokeh"></div><div class="foil"></div></div>
    <img class="obj" src="${cardArtUrl(e.id)}" alt="" draggable="false">
    ${CREST_SVG}
    <div class="stars">${STAR_SVG.repeat(e.tier + 1)}</div>
    ${r.perk ? `<div class="perkb">Special</div>` : ``}
    ${i ? `<div class="val">${i}<small>${a}</small></div>` : ``}
    <div class="plate"><h3>${r.name}</h3></div>
    <p class="blurb">${r.blurb}</p>
    <div class="foot"><span class="now">${s}</span><span class="tier">${TIER_NAMES[e.tier]}</span></div>
    <div class="glit"></div><div class="glare"></div><div class="shade"></div>
  </div>`;
}

/** Card foot numbers: integers as is, 100+ rounded, under 1 with 2 decimals, else 1 decimal. */
export const cardNumber = (e: number): string =>
  Number.isInteger(e) ? String(e) : e >= 100 ? String(Math.round(e)) : e.toFixed(e < 1 ? 2 : 1); // nM (55590)
