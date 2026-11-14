// MINEAR: how a request (goal) reward reads (folder: minear-r3f/src/ui). Rewards are materials (ore, gems),
// reroll dice, and on rare milestones coins shown as NEAR (src/state/goals.ts GoalReward).
// Used by the goal card (src/tutorial/goalCard.ts), the goal banner (src/tutorial/krTutorial.ts), the Requests
// Board (src/base/basePanels.ts) and the trip summary (src/base/haulShow.ts).
import type { GoalReward } from '../state/goals';
import { ITEMS, type ItemDef } from '../world/items';
import { gearIcons } from '../menus/gearIcons';

const ITEM = ITEMS as Record<string, ItemDef>;

/** Icons and counts: `<span><img>5</span>` per material, then dice, then coins. */
export function rewardHTML(r: GoalReward): string {
  const out: string[] = [];
  for (const [id, n] of Object.entries(r.items ?? {}))
    if (n > 0) out.push(`<span class="rw-it" title="${ITEM[id]?.name ?? id}"><i class="rw-ic">${gearIcons.lootHtml(id)}</i>${n}</span>`);
  if (r.dice) out.push(`<span class="rw-it" title="Reroll die"><i class="die sm"></i>${r.dice}</span>`);
  if (r.coins) out.push(`<span class="rw-it" title="NEAR"><i class="coin sm"></i>${r.coins.toLocaleString()}</span>`);
  return out.join(``);
}

/** Plain words: "+5 Copper · +1 reroll die". */
export function rewardText(r: GoalReward): string {
  const out: string[] = [];
  for (const [id, n] of Object.entries(r.items ?? {})) if (n > 0) out.push(`+${n} ${ITEM[id]?.name ?? id}`);
  if (r.dice) out.push(`+${r.dice} reroll ${r.dice > 1 ? `dice` : `die`}`);
  if (r.coins) out.push(`+${r.coins.toLocaleString()} coins`);
  return out.join(` · `);
}
