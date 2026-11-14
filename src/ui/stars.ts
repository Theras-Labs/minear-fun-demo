// MINEAR rarity stars (folder: minear-r3f/src/ui): gear rarity shown as stars, like theras-rpg-template.
// Common 1 star, Uncommon 2, Rare 3, Epic 4, Legendary 5 (tier 0 to 4 in minear-r3f/src/state/progression.ts).
// The row always has 5 stars: the filled ones, then empty ones (Rare: 3 filled, 2 empty).
// Styles: minear-r3f/src/brand/stars.css (imported once in minear-r3f/src/main.tsx).
//   starsHTML(tier, `tile`) - a small row on the bottom edge of an item tile
//   starsHTML(tier, `big`)  - the Forge reveal row; the stars pop in one after another
//   starsHTML(tier)         - inline, next to a name or a rarity word

const STARS = 5;
const STAR = (i: number, on: boolean) =>
  `<svg viewBox="0 0 24 24" class="${on ? `on` : `off`}" style="--i:${i}" aria-hidden="true"><path d="M12 2.6l2.85 5.95 6.55.8-4.8 4.55 1.25 6.5L12 17.2l-5.85 3.2 1.25-6.5-4.8-4.55 6.55-.8z"/></svg>`;

/** Stars for a gear tier: tier 0 (Common) is 1 star, tier 4 (Legendary) is 5. */
export const starCount = (tier: number): number => Math.max(1, Math.min(5, Math.floor(tier) + 1));

/** A row of rarity stars. `cls`: `tile`, `big` or empty (inline). */
export function starsHTML(tier: number, cls = ``): string {
  const n = starCount(tier);
  const label = `${n} of ${STARS} stars`;
  return `<span class="stars s${n}${cls ? ` ${cls}` : ``}" role="img" aria-label="${label}" title="${label}">${Array.from({ length: STARS }, (_, i) => STAR(i, i < n)).join(``)}</span>`;
}
