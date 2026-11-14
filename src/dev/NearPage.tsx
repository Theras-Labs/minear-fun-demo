// /dev/catalog/near: the base systems that run on NEAR (Refinery, Forge, reroll, salvage, Capsule Machine, skill
// tree, slots, Requests Board), drawn from the live MINEAR tables with the game's own icons, next to the
// theras-rpg-template reference.
// MINEAR sources: src/base/sites.ts, src/base/workshop.ts, src/economy/forgeRules.ts, src/base/backToBase.ts,
// src/state/skillTree.ts, src/state/gearStats.ts, src/state/goals.ts, src/state/belt.ts, src/menus/inventoryStats.ts.
// Icons: /cards/<stat>.webp and /cards/gem_<id>.webp (public/cards), statIcon, gearIcons (tool drawings, loot).
// The REF_* constants are a hand copy of the theras-rpg-template data tables (read 2026-11-14). That project is
// not part of this build, so it cannot be imported; every REF_* block is labelled as a reference on the page.
import { useEffect, useState, type ReactNode } from 'react';
import { SITES, type SiteDef } from '../base/sites';
import { CAPSULE_COIN_PRICE, CAPSULE_ODDS, FORGE_GRADES, FORGE_SLOTS, REFINE, SALVAGE, forgeNeeds, rerollCost } from '../base/workshop';
import { capsuleBonus } from '../base/backToBase';
import { BRANCH_NAMES, TREE, TREE_BY_ID, nodeCost, nodeRing, type TreeBranch, type TreeNode } from '../state/skillTree';
import { STATS } from '../state/gearStats';
import { GOALS, type GoalReward } from '../state/goals';
import { BELT_BASE, BELT_MAX } from '../state/belt';
import { ACCESSORY_MAX, ACCESSORY_SLOTS, LOCK_SVG, statIcon } from '../menus/inventoryStats';
import { gearIcons } from '../menus/gearIcons';
import { type GearItem } from '../state/gear';
import { ITEMS, RARITY_COLORS, type ItemDef, type Rarity } from '../world/items';
import { Table, type Col } from './CatalogPage';
import './dev.css';

const ITEM = ITEMS as Record<string, ItemDef>;
const nm = (id: string): string => ITEM[id]?.name ?? id;
const TIERS: Rarity[] = [`common`, `uncommon`, `rare`, `epic`, `legendary`];

// ---------- icons ----------

const Svg = ({ html, className = `ico` }: { html: string; className?: string }) => (
  <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
);

/** Painted card art (public/cards) with the SVG as the fallback when the file is missing. */
function Art({ src, svg, className = `ico` }: { src: string; svg: string; className?: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <Svg html={svg} className={className} /> : <img className={className} src={src} alt="" onError={() => setBad(true)} />;
}

/** A stat's icon: its painted card, else the stat drawing. */
const StatIco = ({ id, className }: { id: string; className?: string }) => (
  <Art src={`/cards/${id}.webp`} svg={statIcon(id)} className={className} />
);

/** An item's icon: a gem's painted card, else the loot drawing (ore, supply, die). */
function ItemIco({ id, className }: { id: string; className?: string }) {
  const loot = <Svg html={gearIcons.lootHtml(id)} className={className} />;
  return ITEM[id]?.kind === `gem` ? <Art src={`/cards/gem_${id}.webp`} svg={gearIcons.lootHtml(id)} className={className} /> : loot;
}

/** A material cost or reward: icon, count, name. */
const Mat = ({ id, n }: { id: string; n: number }) => (
  <span className="mat" title={nm(id)}>
    <ItemIco id={id} />
    <b>{n.toLocaleString()}</b> {nm(id)}
  </span>
);
const Mats = ({ list }: { list: [string, number][] }) => (
  <span className="mats">
    {list.map(([id, n]) => (
      <Mat key={id} id={id} n={n} />
    ))}
  </span>
);
const CoinIco = () => <i className="coin" />;

// ---------- small visuals ----------

/** A 100% bar split by weight, one coloured part per tier or kind. */
function Odds({ parts }: { parts: { label: string; w: number; color: string }[] }) {
  const sum = parts.reduce((a, p) => a + p.w, 0) || 1;
  return (
    <div className="odds">
      {parts
        .filter((p) => p.w > 0)
        .map((p) => {
          const pc = (p.w / sum) * 100;
          return (
            <span key={p.label} style={{ width: `${pc}%`, background: p.color }} title={`${p.label}: ${pc.toFixed(1)}%`}>
              {pc >= 7 ? `${Math.round(pc)}%` : ``}
            </span>
          );
        })}
    </div>
  );
}

const tierParts = (w: number[]) => w.map((x, i) => ({ label: TIERS[i], w: x, color: RARITY_COLORS[TIERS[i]] }));

function Legend() {
  return (
    <p className="legend">
      {TIERS.map((t) => (
        <span key={t}>
          <i style={{ background: RARITY_COLORS[t] }} />
          {t}
        </span>
      ))}
    </p>
  );
}

function Ref({ children }: { children: ReactNode }) {
  return (
    <div className="pico">
      <span className="tag">theras-rpg-template</span>
      {children}
    </div>
  );
}

// ---------- 1. base buildings ----------

function Buildings() {
  const state = (s: SiteDef) => (!s.unlock ? (s.built ? `open` : `soon`) : s.built ? `unlock` : `planned`);
  const label = { open: `Open from the start`, unlock: `Works after unlock`, soon: `Not built`, planned: `Locked and not built` };
  return (
    <section id="base">
      <h2>Base buildings</h2>
      <p className="note">
        <code>SITES</code> in <code>src/base/sites.ts</code>. "Not built" buildings show "opening soon" even after their rule is
        met. The plan line is what each one will serve.
      </p>
      <div className="cards">
        {SITES.map((s) => {
          const st = state(s);
          return (
            <article key={s.id} className={`site ${st}`} style={{ borderColor: s.color }}>
              <h3 style={{ color: s.color }}>{s.name}</h3>
              <p className="dim">{s.blurb}</p>
              <p>
                <span className={`badge ${st}`}>{label[st]}</span>
                {s.unlock ? <span className="dim"> unlock: {s.unlock.text}</span> : null}
              </p>
              {s.plan ? <p className="plan">Will serve: {s.plan}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ---------- 2. refinery ----------

const REF_REFINERY = [
  { lv: 1, rate: 5, bonus: 0, cost: `30 Copper` },
  { lv: 2, rate: 4, bonus: 0, cost: `250 Silver + 100 Ruby` },
  { lv: 3, rate: 3, bonus: 0, cost: `650 Gold + 250 Sapphire` },
  { lv: 4, rate: 3, bonus: 20, cost: `2200 Mithril + 850 Emerald` },
  { lv: 5, rate: 2, bonus: 20, cost: `4500 Adamantite + 1700 Diamond` },
  { lv: 6, rate: 2, bonus: 30, cost: `1500 Abyss Crystal + 3000 Diamond (also 2500 Diamond to 1 Crystal)` },
];

function Refinery() {
  return (
    <section id="refinery">
      <h2>Refinery</h2>
      <div className="split">
        <div>
          <h3>MINEAR</h3>
          <ul className="flow">
            {REFINE.map((r) => (
              <li key={r.from}>
                <Mat id={r.from} n={r.n} /> <span className="arrow">to</span> <Mat id={r.to} n={1} />
              </li>
            ))}
          </ul>
          <p className="note">
            Fixed rate, no levels. On chain: <code>craft smelt.&lt;ore&gt;</code>. Spends ore saved on chain only.
          </p>
        </div>
        <Ref>
          <h3>Refinery has 6 levels</h3>
          <table className="mini">
            <thead>
              <tr>
                <th>Lv</th>
                <th className="num">Rate</th>
                <th className="num">Bonus</th>
                <th>Upgrade cost</th>
              </tr>
            </thead>
            <tbody>
              {REF_REFINERY.map((r) => (
                <tr key={r.lv}>
                  <td>{r.lv}</td>
                  <td className="num">{r.rate}:1</td>
                  <td className="num">{r.bonus ? `${r.bonus}%` : `-`}</td>
                  <td>{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Any ore into the next one (12 ores), but only into an ore you have already found. Up to 10 at a time. The forge
            can refine the missing ore for you.
          </p>
        </Ref>
      </div>
    </section>
  );
}

// ---------- 3. forge ----------

const REF_METALS: [string, number, string][] = [
  [`Stone`, 1.0, `20 Stone`],
  [`Copper`, 1.2, `15 Copper`],
  [`Iron`, 1.45, `20 Iron`],
  [`Silver`, 1.7, `20 Silver`],
  [`Ruby`, 2.0, `20 Ruby`],
  [`Gold`, 2.35, `25 Gold`],
  [`Sapphire`, 2.75, `25 Sapphire`],
  [`Mithril`, 3.2, `30 Mithril`],
  [`Emerald`, 3.7, `30 Emerald`],
  [`Adamantite`, 4.3, `35 Adamantite`],
  [`Diamond`, 5.0, `40 Diamond`],
  [`Abyss Crystal`, 6.0, `200 Crystal + 1000 Diamond (after the Abyss opens)`],
];
/** Reference rarity odds (common..legendary) at forge level 1, and how the forge level moves them. */
const REF_QUALITY = [0.2, 0.45, 0.22, 0.1, 0.03];
function refQuality(lv: number): number[] {
  const b = 0.08 * (lv - 1);
  const w = [...REF_QUALITY];
  w[0] = w[0] / (1 + 2 * b);
  for (let q = 2; q < w.length; q++) w[q] = w[q] * (1 + b) ** (q - 1);
  return w;
}

function Forge() {
  return (
    <section id="forge">
      <h2>Forge</h2>
      <Legend />
      <div className="split">
        <div>
          <h3>MINEAR: {FORGE_GRADES.length} metals</h3>
          {FORGE_GRADES.map((g) => (
            <div key={g.id} className="grade">
              <div className="row">
                <b>{g.name}</b>
                <Mats list={forgeNeeds(g).map((m) => [m.ore, m.n])} />
              </div>
              <Odds parts={tierParts(g.weights)} />
            </div>
          ))}
          <p className="note">
            Today the metal sets the rarity odds, so a better metal gives better rarity. All 3 metals show from the start.
            Tables: <code>FORGE_GRADES</code> in <code>src/economy/forgeRules.ts</code> (also the contract's settings).
          </p>
          <h3>Pieces the Forge makes</h3>
          <div className="pieces">
            {FORGE_SLOTS.map((k) => (
              <div key={k.id} className="piece">
                <div className="row">
                  {FORGE_GRADES.map((g) => (
                    <Svg key={g.id} html={gearIcons.html({ base: k.base, ore: g.ore })} className="tile" />
                  ))}
                </div>
                <b>{k.name}</b>
                <small className="dim">{k.title}</small>
              </div>
            ))}
          </div>
        </div>
        <Ref>
          <h3>12 metals, shown one by one</h3>
          <table className="mini">
            <thead>
              <tr>
                <th>Metal</th>
                <th className="num">Damage</th>
                <th>Base cost</th>
              </tr>
            </thead>
            <tbody>
              {REF_METALS.map(([m, x, c]) => (
                <tr key={m}>
                  <td>{m}</td>
                  <td className="num">x{x}</td>
                  <td>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            A metal shows when you have found its ore. The next one shows with a padlock. The rest stay hidden. The metal
            sets the power (damage x). The rarity odds are the <b>same for every metal</b>; they get better with the forge
            level (1 to 20; level n needs n + 1 makes):
          </p>
          <div className="grade">
            {[1, 10, 20].map((lv) => (
              <div key={lv}>
                <span className="dim">Forge level {lv}</span>
                <Odds parts={tierParts(refQuality(lv))} />
              </div>
            ))}
          </div>
          <p className="note">
            Rarity multiplies damage (x0.8, 1.0, 1.15, 1.3, 1.5) and durability, and gives 0 to 4 effect lines (common 0,
            legendary 4).
          </p>
        </Ref>
      </div>
    </section>
  );
}

// ---------- 4. reroll and salvage ----------

const STAT_ROWS = Object.values(STATS);
type StatRow = (typeof STAT_ROWS)[number];
const STAT_COLS: Col<StatRow>[] = [
  {
    label: `Effect`,
    get: (s) => s.name,
    render: (s) => (
      <span className="named">
        <StatIco id={s.icon || s.id} className="ico big" />
        <b>{s.name}</b>
      </span>
    ),
  },
  { label: `Id`, get: (s) => s.id, render: (s) => <code>{s.id}</code> },
  { label: `What it does`, get: (s) => s.blurb, render: (s) => <span className="wrap">{s.blurb}</span> },
  ...TIERS.map(
    (t, i): Col<StatRow> => ({
      label: t,
      get: (s) => s.per[i] ?? 0,
      num: true,
      render: (s) =>
        s.per[i] ? (
          <span style={{ color: RARITY_COLORS[t] }}>
            {s.per[i]}
            {s.unit}
          </span>
        ) : (
          <span className="dim">-</span>
        ),
    }),
  ),
  { label: `Cap`, get: (s) => s.cap, num: true },
  { label: `Perk`, get: (s) => (s.perk ? 1 : 0), render: (s) => (s.perk ? <span className="flag">perk</span> : <span className="dim">-</span>) },
];

function Reroll() {
  const tierItem = (t: number) => ({ tier: t }) as GearItem;
  return (
    <section id="reroll">
      <h2>Gear effects, reroll and salvage</h2>
      <div className="split">
        <div>
          <h3>MINEAR</h3>
          <p className="note">
            A piece has 1 built-in effect (its base's <i>implicit</i>) plus more by rarity: common 1 line, uncommon 2, rare
            3, epic 3, legendary 4. Extra lines come mostly (65%) from the base's <i>likes</i>, else from Max Health, Burrow
            Power, speed, crit, pack, sense, melee or ranged. Values grow with the depth the piece was made at. Perks roll
            from epic up (a rare charm sometimes gets one); a one-level perk needs legendary.
          </p>
          <p className="note">
            <b>Reroll</b> keeps the built-in effect and rerolls <b>all</b> other lines at once (same rarity). <b>Salvage</b>{' '}
            breaks a spare piece into ore, so a bad roll turns back into Forge material.
          </p>
          <table className="mini">
            <thead>
              <tr>
                <th>Rarity</th>
                <th>Reroll cost</th>
                <th>Salvage gives</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t, i) => {
                const c = rerollCost(tierItem(i));
                return (
                  <tr key={t}>
                    <td style={{ color: RARITY_COLORS[t] }}>{t}</td>
                    <td>{i === 0 ? <span className="dim">nothing to reroll</span> : <Mat id={c.ore} n={c.n} />}</td>
                    <td>
                      <Mats list={Object.entries(SALVAGE[i] ?? {}) as [string, number][]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Ref>
          <h3>One line at a time, paid in mana stones</h3>
          <p className="note">
            You pick <b>one</b> effect line and reroll only that one. It becomes a different kind than the other lines. Cost
            by item level: 2, 3, 4, 5, 7, 10, 14, 20, 28, 40, 56 mana stones. Legendary is 3 times rarer on a reroll than on
            a new piece.
          </p>
          <p className="note">
            13 effect kinds, 6 tiers (I to VI): damage, attack speed, crit, ability frequency, max durability, slower wear,
            extra drops, chest rate, ability power, and power for each of the 4 ability families.
          </p>
          <p className="note">
            <b>Salvage</b> gives back 50% of the ore paid, plus mana stones per effect line (1, 2, 3, 5, 7, 15 by tier).
          </p>
        </Ref>
      </div>
      <h3>MINEAR effect list (every gear stat, value per roll at each rarity)</h3>
      <Table rows={STAT_ROWS} cols={STAT_COLS} rowKey={(s) => s.id} />
    </section>
  );
}

// ---------- 5. capsule machine ----------

const KIND_COLOR: Record<string, string> = {
  coins: `#ffd36a`,
  ore: `#c48a5a`,
  supply: `#6ff3c8`,
  gem: `#5fb4ff`,
  die: `#c38bff`,
  gear: `#ff7aa8`,
  capsules: `#ff5a7a`,
};
function KindIco({ kind }: { kind: string }) {
  if (kind === `coins`) return <CoinIco />;
  if (kind === `ore`) return <ItemIco id="iron" />;
  if (kind === `supply`) return <ItemIco id="tonic" />;
  if (kind === `gem`) return <ItemIco id="sapphire" />;
  if (kind === `die`) return <ItemIco id="die" />;
  if (kind === `gear`) return <Svg html={gearIcons.html(`knighthelm`)} />;
  return <StatIco id="luck" />;
}
const REF_CAPSULE = [0.5, 0.28, 0.14, 0.06, 0.02];
const REF_CAPSULE_DEEP = [0.45, 0.28, 0.14, 0.09, 0.04];

function Capsule() {
  return (
    <section id="capsule">
      <h2>Capsule Machine</h2>
      <div className="split">
        <div>
          <h3>MINEAR (live from src/base/workshop.ts)</h3>
          <Odds parts={CAPSULE_ODDS.map((o) => ({ label: o.kind, w: o.pct, color: KIND_COLOR[o.kind] ?? `#888` }))} />
          <ul className="kinds">
            {CAPSULE_ODDS.map((o) => (
              <li key={o.kind}>
                <KindIco kind={o.kind} />
                <b>{o.pct}%</b> {o.kind}
              </li>
            ))}
          </ul>
          <ul className="plain">
            <li>Coins: 120 to 340, times (1 + deepest / 500).</li>
            <li>Ore: 18 Iron; past 120 m, half the time 8 Gold; past 400 m, 35% 3 Mythril.</li>
            <li>Supply: 1 random shop supply (needs Cart room, else coins).</li>
            <li>Gem: 1 gem from the depth table at 90% of your deepest depth.</li>
            <li>Gear: 1 random piece, 40 / 38 / 17 / 4.5 / 0.5% common to legendary.</li>
          </ul>
          <p className="note">
            Capsule Coins: {[250, 500, 750, 1000, 1500].map((d) => `${d} m = ${capsuleBonus(d)}`).join(`, `)} per trip; or
            buy one for {CAPSULE_COIN_PRICE} coins.
          </p>
        </div>
        <Ref>
          <h3>Every spin is an artifact</h3>
          <span className="dim">Odds at the start</span>
          <Odds parts={tierParts(REF_CAPSULE)} />
          <span className="dim">Odds at the deepest floor (999F)</span>
          <Odds parts={tierParts(REF_CAPSULE_DEEP)} />
          <p className="note">
            26 artifacts (passive bonuses: drop rate, damage, crit, chest rate, revive and more). A duplicate levels its
            artifact up. 8% of spins give a skin and 6% a pet hat instead. <b>No coin, ore or gear prizes.</b> Capsule Coins
            come from the merchant (3 for ore), the Lucky Coin artifact and chests. Up to 10 spins at once.
          </p>
        </Ref>
      </div>
    </section>
  );
}

// ---------- 6. skill tree ----------

const BRANCH_COLOR: Record<TreeBranch, string> = {
  home: `#ffd36a`,
  dig: `#ff8a3c`,
  loot: `#ffc23d`,
  live: `#6ff3c8`,
  move: `#9fb8ff`,
};
/** Grid cell of a tree node, px. */
const CW = 112;
const CH = 104;

function NodeIco({ n }: { n: TreeNode }) {
  if (n.icon.startsWith(`<svg`)) return <Svg html={n.icon} className="ico node" />;
  return <StatIco id={n.icon} className="ico node" />;
}

function SkillTree() {
  const [pick, setPick] = useState<TreeNode>(TREE_BY_ID.feet);
  const xs = TREE.map((n) => n.gx);
  const ys = TREE.map((n) => n.gy);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = (Math.max(...xs) - x0 + 1) * CW;
  const H = (Math.max(...ys) - y0 + 1) * CH;
  const cx = (n: TreeNode) => (n.gx - x0) * CW + CW / 2;
  const cy = (n: TreeNode) => (n.gy - y0) * CH + CH / 2;
  const kids = TREE.filter((n) => n.parent === pick.id);
  return (
    <section id="tree">
      <h2>Skill tree (abilities)</h2>
      <p className="note">
        <code>TREE</code> in <code>src/state/skillTree.ts</code>: {TREE.length - 1} nodes,{' '}
        {TREE.reduce((a, n) => a + (n.parent ? n.max : 0), 0)} levels. Every node has its own levels (the dots). A line
        label <b>L2</b> means the next node opens when this one reaches level 2. Click a node for every level's cost. Today
        nothing opens by depth.
      </p>
      <div className="treewrap">
        <div className="treescroll">
          <div className="tree" style={{ width: W, height: H }}>
            <svg className="links" width={W} height={H}>
              {TREE.filter((n) => n.parent).map((n) => {
                const p = TREE_BY_ID[n.parent!];
                return (
                  <g key={n.id}>
                    <line x1={cx(p)} y1={cy(p)} x2={cx(n)} y2={cy(n)} stroke={BRANCH_COLOR[n.branch]} strokeOpacity="0.55" strokeWidth="3" />
                    <text x={(cx(p) + cx(n)) / 2} y={(cy(p) + cy(n)) / 2 + 4} textAnchor="middle">
                      L{n.req}
                    </text>
                  </g>
                );
              })}
            </svg>
            {TREE.map((n) => (
              <button
                key={n.id}
                className={`tnode${n.big ? ` big` : ``}${pick.id === n.id ? ` on` : ``}`}
                style={{ left: cx(n) - 46, top: cy(n) - 44, borderColor: BRANCH_COLOR[n.branch] }}
                onClick={() => setPick(n)}
                title={`${n.name}: ${BRANCH_NAMES[n.branch]}`}
              >
                <NodeIco n={n} />
                <b>{n.name}</b>
                {n.parent ? (
                  <span className="pips">
                    {Array.from({ length: n.max }, (_v, i) => (
                      <i key={i} />
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <aside className="tside">
          <div className="named">
            <NodeIco n={pick} />
            <h3 style={{ color: BRANCH_COLOR[pick.branch] }}>{pick.name}</h3>
          </div>
          <p className="dim">
            {BRANCH_NAMES[pick.branch]}, ring {nodeRing(pick)}, {pick.parent ? `${pick.max} levels` : `root`}
            {pick.parent ? `; opens at ${TREE_BY_ID[pick.parent].name} level ${pick.req}` : ``}
          </p>
          <p>{pick.blurb ?? (pick.stat ? STATS[pick.stat]?.blurb : ``)}</p>
          {kids.length ? (
            <p className="dim">Opens next: {kids.map((k) => `${k.name} (at level ${k.req})`).join(`, `)}</p>
          ) : null}
          {pick.parent ? (
            <table className="mini">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Cost</th>
                  <th className="num">Gives</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: pick.max }, (_v, l) => (
                  <tr key={l}>
                    <td>{l + 1}</td>
                    <td>
                      <Mats list={nodeCost(pick, l).mats} />
                    </td>
                    <td className="num">{pick.stat ? `+${+((l + 1) * pick.per).toFixed(2)} ${STATS[pick.stat]?.name ?? pick.stat}` : `+${l + 1} slot`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </aside>
      </div>
      <Ref>
        <h3>113 nodes, opened by depth</h3>
        <table className="mini">
          <thead>
            <tr>
              <th>Depth</th>
              <th>What opens</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Start</td><td>Core tree, metal tier 1, abilities Bomb, Fireball, Slime, Drill</td></tr>
            <tr><td>100F</td><td>2nd ability slot for row 1</td></tr>
            <tr><td>200F</td><td>Lake band (10 nodes, two capstones), tier 2, Molotov, Frost, Golem, Turret</td></tr>
            <tr><td>300F</td><td>2nd ability slot for row 2</td></tr>
            <tr><td>400F</td><td>Magma band (11 nodes), tier 3, Dynamite, Bolt, Hammer, Cannon</td></tr>
            <tr><td>500F</td><td>2nd ability slot for row 3</td></tr>
            <tr><td>600F</td><td>Ruins band (11 nodes), tier 4, Missile, Meteor, Destroyer, Laser</td></tr>
            <tr><td>700F</td><td>2nd ability slot for row 4</td></tr>
            <tr><td>800F</td><td>Abyss band (11 nodes), tier 5, Nuke, Black Hole, Dragon, Excavator</td></tr>
            <tr><td>900F</td><td>2nd ability slot for row 5</td></tr>
            <tr><td>Abyss open / 2nd loop</td><td>Abyss Power, Guard, Eye (30, 30, 20 levels), loop nodes</td></tr>
          </tbody>
        </table>
        <p className="note">Each node also opens by its parent's level. Costs scale with the layer: surface x4, lake x10, magma x18, ruins x93.</p>
      </Ref>
    </section>
  );
}

// ---------- 7. slots ----------

function Slots() {
  return (
    <section id="slots">
      <h2>Accessory and ability slots</h2>
      <div className="slotrow">
        <span className="dim">Accessories</span>
        {Array.from({ length: ACCESSORY_MAX }, (_v, i) => (
          <span key={i} className={`slot${i < ACCESSORY_SLOTS.length ? ` open` : ``}`}>
            {i < ACCESSORY_SLOTS.length ? <Svg html={gearIcons.html(`shield`)} /> : <Svg html={LOCK_SVG} />}
            {i < ACCESSORY_SLOTS.length ? `Charm ${i + 1}` : `locked`}
          </span>
        ))}
      </div>
      <p className="note">
        {ACCESSORY_SLOTS.length} open, {ACCESSORY_MAX - ACCESSORY_SLOTS.length} locked "for a later update". No unlock rule exists yet.
      </p>
      <div className="slotrow">
        <span className="dim">Ability belt</span>
        {Array.from({ length: BELT_MAX }, (_v, i) => (
          <span key={i} className={`slot${i < BELT_BASE ? ` open` : ` buy`}`}>
            {i < BELT_BASE ? <ItemIco id="tonic" /> : <Svg html={LOCK_SVG} />}
            {i < BELT_BASE ? `Key ${i + 1}` : `Belt Loops L${i - BELT_BASE + 1}`}
          </span>
        ))}
      </div>
      <p className="note">
        {BELT_BASE} open at the start; the skill tree node Belt Loops opens the rest:
      </p>
      <ul className="plain">
        {Array.from({ length: TREE_BY_ID.belt.max }, (_v, l) => (
          <li key={l}>
            Level {l + 1}: <Mats list={nodeCost(TREE_BY_ID.belt, l).mats} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- 8. requests board ----------

function Reward({ r }: { r: GoalReward }) {
  return (
    <span className="mats">
      {Object.entries(r.items ?? {}).map(([id, n]) => (
        <Mat key={id} id={id} n={n} />
      ))}
      {r.dice ? <Mat id="die" n={r.dice} /> : null}
      {r.coins ? (
        <span className="mat">
          <CoinIco />
          <b>{r.coins.toLocaleString()}</b> coins
        </span>
      ) : null}
    </span>
  );
}

const REF_MISSIONS: [string, number][] = [
  [`ore`, 24],
  [`mana stones`, 18],
  [`chests`, 11],
  [`skins`, 8],
  [`charms`, 4],
  [`chest keys`, 4],
  [`pet hats`, 2],
  [`lantern`, 1],
];

function Board() {
  const live = GOALS.filter((g) => !g.gone);
  return (
    <section id="board">
      <h2>Requests Board (quests)</h2>
      <h3>MINEAR: {live.length} jobs, one at a time</h3>
      <ol className="jobs">
        {live.map((g) => (
          <li key={g.text} className={g.reward.coins ? `paycoin` : ``}>
            <span className="jtext">{g.text}</span>
            <Reward r={g.reward} />
          </li>
        ))}
      </ol>
      <p className="note">Gold-edged jobs pay coins. After the last job the board says new jobs come later.</p>
      <Ref>
        <h3>72 missions</h3>
        <p className="note">
          Kinds: runs, collect ore, depth (up to 200F), kills, chests, crafts, enchants, salvage, summons, relics, cores.
          Rewards (no coins): {REF_MISSIONS.map(([k, n]) => `${k} ${n}`).join(`, `)}.
        </p>
      </Ref>
    </section>
  );
}

// ---------- page ----------

const SECTIONS = [
  [`base`, `Buildings`],
  [`refinery`, `Refinery`],
  [`forge`, `Forge`],
  [`reroll`, `Effects and reroll`],
  [`capsule`, `Capsule`],
  [`tree`, `Skill tree`],
  [`slots`, `Slots`],
  [`board`, `Quests`],
] as const;

export function NearPage() {
  useEffect(() => {
    document.body.classList.add(`dev`);
  }, []);
  return (
    <div className="dev-catalog dev-near">
      <header>
        <h1>MINEAR: base and NEAR systems</h1>
        <p>
          MINEAR values come live from the game code. Grey "theras-rpg-template" boxes are a reference copy. Rule: the
          Refinery, Forge, reroll and skill tree spend only materials saved on NEAR; salvage, capsule prizes and job rewards
          land in the save first and go on chain with the next save.
        </p>
        <nav>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
          <a href="/dev/catalog" className="back">
            Catalog
          </a>
        </nav>
      </header>
      <Buildings />
      <Refinery />
      <Forge />
      <Reroll />
      <Capsule />
      <SkillTree />
      <Slots />
      <Board />
    </div>
  );
}
