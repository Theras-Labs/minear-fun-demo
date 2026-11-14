// Stat card groups and short value strings (the parts of the stat card system the state and HUD use).
// Bundle play-inUT-NSi.js lines 55310-55407. Not ported here (UI, later): long descriptions Uj (55408-55481),
// SVG icons Wj / X / Gj / Kj (55482-55521).
import { STATS } from './gearStats';

/** Skill screen columns. */
export const STAT_GROUPS: { name: string; icon: string; ids: string[] }[] = [ // Ij (55310)
  {
    name: `Mining & Exploring`,
    icon: `power`,
    ids: [`power`, `bore`, `burrow`, `sense`, `oresight`, `echo`, `pack`, `magnet`, `fortune`, `gold`, `luck`],
  },
  {
    name: `Combat`,
    icon: `melee`,
    ids: [
      `melee`,
      `ranged`,
      `rate`,
      `crit`,
      `vamp`,
      `twin`,
      `blast`,
      `bounce`,
      `caliber`,
      `muzzle`,
      `ember`,
      `venom`,
      `frost`,
    ],
  },
  {
    name: `Survival & Travel`,
    icon: `hp`,
    ids: [`hp`, `armor`, `regen`, `thorns`, `nimble`, `wind`, `speed`, `fuel`, `resfire`, `respoison`, `grip`],
  },
];

/** True when the stat can come up as a Wellspring card. */
export const canDraft = (e: string): boolean => STATS[e].weight > 0; // Lj (55365)

/** The unit word of % stats that are not plain increases. */
export const PERCENT_WORDS: Record<string, string> = { // Rj (55366)
  frost: `slow`,
  ember: `burn`,
  venom: `poison`,
  vamp: `lifesteal`,
  twin: `chance`,
  blast: `splash`,
  bounce: `chance`,
  thorns: `reflect`,
  nimble: `faster`,
  gold: `more`,
  fortune: `chance`,
  luck: `chance`,
  caliber: `bigger`,
  muzzle: `faster`,
  resfire: `less`,
  respoison: `less`,
};

export const formatNumber = (e: number): string =>
  String(e >= 10 ? Math.round(e) : e >= 1 ? Math.round(e * 10) / 10 : Math.round(e * 100) / 100); // zj (55384)
export const formatPercent = (e: number): string => `${formatNumber(e)}%`; // Bj (55386)
export const bold = (e: string): string => `<b>${e}</b>`; // Vj (55387)

/** Short value string: 'II', 'yes', '12%', '+12%', '+1.5 m', '+0.3/s', '+2 slots', '+4'. */
export function shortValue(e: string, t: number): string { // Hj (55388)
  const n = STATS[e];
  return e === `oresight`
    ? t >= 2
      ? `II`
      : `I`
    : n.cap === 1
      ? `yes`
      : n.unit === `%`
        ? PERCENT_WORDS[e]
          ? formatPercent(t)
          : `+${formatPercent(t)}`
        : n.unit === ` m`
          ? `+${formatNumber(t)} m`
          : n.unit === ` HP/s`
            ? `+${formatNumber(t)}/s`
            : e === `pack`
              ? `+${Math.round(t)} slot${Math.round(t) === 1 ? `` : `s`}`
              : `+${formatNumber(t)}`;
}
