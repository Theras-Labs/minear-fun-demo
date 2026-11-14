// /dev/catalog: read-only tables of the foes, bosses, gems, gear and sky states.
// Every row is built from the live game tables at import time; nothing here is a copy of their values.
// Sources: src/foes/types.ts, src/bosses/sim/defs.ts, src/world/items.ts, src/world/caverns.ts,
// src/state/gear.ts, src/state/gearStats.ts, src/sky/weather.ts, src/sky/dayClock.ts.
import { useEffect, useState, type ReactNode } from 'react';
import { FOE_DIGGING, FOE_KINDS, FOE_TYPES } from '../foes/types';
import { BOSS_DEFS, BOSS_KINDS, BOSS_REST_S, type BossDef } from '../bosses/sim/defs';
import { BEAST_DEPTHS, BIOMES, type BiomeId } from '../world/caverns';
import { BIOME_GEM, GEM_DEPTH_TABLE, GEM_IDS, ITEMS, RARITY_COLORS, type ItemDef, type ItemId } from '../world/items';
import { GEAR_BASES, SLOT_LABELS, type GearBase, type GearSlotType } from '../state/gear';
import { STATS } from '../state/gearStats';
import { WEATHER_DURATION, WEATHER_NEXT, WEATHER_PRESETS, type WeatherState } from '../sky/weather';
import { DayClock } from '../sky/dayClock';
import './dev.css';

// ---------- small helpers ----------

const fmt = (n: number, digits = 2): string => String(Number(n.toFixed(digits)));
const pct = (n: number): string => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const hex = (c: number): string => `#${c.toString(16).padStart(6, `0`)}`;
const mins = (s: number): string => (s >= 60 ? `${fmt(s / 60, 1)} min` : `${fmt(s, 0)} s`);

function Biome({ id }: { id?: BiomeId }) {
  if (!id) return <span className="dim">-</span>;
  const b = BIOMES[id];
  return (
    <span className="chip" style={{ color: b.color, borderColor: b.color }} title={b.name}>
      {id}
    </span>
  );
}

function Flag({ on, title }: { on: boolean; title?: string }) {
  return on ? (
    <span className="flag" title={title}>
      yes
    </span>
  ) : (
    <span className="dim">-</span>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

function Stat({ id }: { id: string }) {
  const s = STATS[id];
  return (
    <span className="pill" title={`stat id: ${id}${s ? `\n${s.blurb}` : ``}`}>
      {s?.name ?? id}
    </span>
  );
}

// ---------- sortable table ----------

export interface Col<T> {
  label: string;
  /** Value used for sorting (and shown when there is no render). */
  get: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  num?: boolean;
  title?: string;
}

export function Table<T>({ rows, cols, rowKey }: { rows: T[]; cols: Col<T>[]; rowKey: (row: T) => string }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const shown = sort
    ? [...rows].sort((a, b) => {
        const x = cols[sort.col].get(a);
        const y = cols[sort.col].get(b);
        return (typeof x === `number` && typeof y === `number` ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      })
    : rows;
  const click = (i: number) =>
    setSort((s) => (!s || s.col !== i ? { col: i, dir: 1 } : s.dir === 1 ? { col: i, dir: -1 } : null));
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={c.label} className={c.num ? `num` : undefined} title={c.title ?? `Click to sort`} onClick={() => click(i)}>
                {c.label}
                {sort?.col === i ? (sort.dir === 1 ? ` ^` : ` v`) : ``}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)}>
              {cols.map((c) => (
                <td key={c.label} className={c.num ? `num` : undefined}>
                  {c.render ? c.render(r) : c.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- foes ----------

const FOE_ROWS = FOE_KINDS.map((kind) => ({ kind, ...FOE_TYPES[kind] }));
type FoeRow = (typeof FOE_ROWS)[number];

const FOE_COLS: Col<FoeRow>[] = [
  { label: `Name`, get: (f) => f.name, render: (f) => <b>{f.name}</b> },
  { label: `Kind`, get: (f) => f.kind, render: (f) => <code>{f.kind}</code> },
  { label: `Biome`, get: (f) => f.biome ?? ``, render: (f) => <Biome id={f.biome} /> },
  { label: `Min depth`, get: (f) => f.minDepth, num: true },
  { label: `Weight`, get: (f) => f.weight, num: true, title: `Spawn pick weight (0 = never picked by weight)` },
  { label: `HP`, get: (f) => f.hp, num: true },
  { label: `Dmg`, get: (f) => f.dmg, num: true },
  { label: `Attack`, get: (f) => f.attack },
  { label: `Range`, get: (f) => f.range, num: true },
  { label: `Speed`, get: (f) => f.speed, num: true },
  { label: `Ghost`, get: (f) => (f.ghost ? 1 : 0), render: (f) => <Flag on={!!f.ghost} /> },
  {
    label: `Digger`,
    get: (f) => (f.digger ? 1 : 0),
    render: (f) => (
      <Flag on={!!f.digger} title={f.digger ? `speed ${f.digger.speed}, radius ${f.digger.r}, clip ${f.digger.clip}` : undefined} />
    ),
  },
  { label: `Surface`, get: (f) => (f.surface ? 1 : 0), render: (f) => <Flag on={!!f.surface} /> },
];

function Foes() {
  return (
    <section id="foes">
      <h2>Foes ({FOE_ROWS.length})</h2>
      <p className="note">
        <code>FOE_TYPES</code> in <code>src/foes/types.ts</code>, in table order. Biome "-" means the foe is not tied to a
        biome.{' '}
        <code>FOE_DIGGING</code> is <b>{String(FOE_DIGGING)}</b>
        {FOE_DIGGING ? `: diggers burrow to the player.` : `: diggers fight like the other Lost.`}
      </p>
      <Table rows={FOE_ROWS} cols={FOE_COLS} rowKey={(f) => f.kind} />
    </section>
  );
}

// ---------- bosses ----------

const lairDepth = (b: BiomeId): number | undefined => BEAST_DEPTHS.find((d) => d.biome === b)?.depth;
const BOSS_ROWS = BOSS_KINDS.map((k) => BOSS_DEFS[k]);

const BOSS_COLS: Col<BossDef>[] = [
  {
    label: `Name`,
    get: (b) => b.name,
    render: (b) => (
      <b style={{ color: b.color }}>
        {b.name} <span className="dim">{b.title}</span>
      </b>
    ),
  },
  { label: `Kind`, get: (b) => b.kind, render: (b) => <code>{b.kind}</code> },
  { label: `Biome`, get: (b) => b.biome, render: (b) => <Biome id={b.biome} /> },
  {
    label: `Lair depth`,
    get: (b) => lairDepth(b.biome) ?? -1,
    num: true,
    title: `Nominal lair depth: BEAST_DEPTHS in src/world/caverns.ts`,
    render: (b) => lairDepth(b.biome) ?? <span className="dim">-</span>,
  },
  { label: `HP`, get: (b) => b.hp, num: true },
  { label: `Speed`, get: (b) => b.speed, num: true },
  { label: `Turn`, get: (b) => b.turn, num: true },
  { label: `Radius`, get: (b) => b.radius, num: true },
  { label: `Height`, get: (b) => b.height, num: true },
  { label: `Wake r`, get: (b) => b.wakeR, num: true },
  { label: `Keep`, get: (b) => b.keep, num: true },
  { label: `Moves`, get: (b) => b.moves.length, num: true },
];

function Bosses() {
  return (
    <section id="bosses">
      <h2>Bosses ({BOSS_ROWS.length})</h2>
      <p className="note">
        <code>BOSS_DEFS</code> in <code>src/bosses/sim/defs.ts</code>. A slain boss rests {mins(BOSS_REST_S)} (
        <code>BOSS_REST_S</code>). Move range is [min, max] in metres; cone 0 means any facing.
      </p>
      <Table rows={BOSS_ROWS} cols={BOSS_COLS} rowKey={(b) => b.kind} />
      <div className="cards">
        {BOSS_ROWS.map((b) => (
          <article key={b.kind} style={{ borderColor: b.color }}>
            <h3 style={{ color: b.color }}>{b.name}</h3>
            <p className="dim">
              wake {b.lens.wake} s, roar {b.lens.roar} s, die {b.lens.die} s
            </p>
            <table className="mini">
              <thead>
                <tr>
                  <th>Move</th>
                  <th className="num">Len</th>
                  <th className="num">Cooldown</th>
                  <th className="num">Range</th>
                  <th className="num">Cone</th>
                  <th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {b.moves.map((m) => (
                  <tr key={m.act}>
                    <td>
                      <code>{m.act}</code>
                    </td>
                    <td className="num">{m.len}</td>
                    <td className="num">{m.cd}</td>
                    <td className="num">
                      {m.min}-{m.max}
                    </td>
                    <td className="num">{m.cone}</td>
                    <td className="num">{m.w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- gems ----------

const GEM_WEIGHT_SUM = GEM_DEPTH_TABLE.reduce((s, g) => s + g.weight, 0);
const GEM_BIOME = Object.fromEntries((Object.entries(BIOME_GEM) as [BiomeId, ItemId][]).map(([b, g]) => [g, b])) as Partial<
  Record<ItemId, BiomeId>
>;
const GEM_ROWS = GEM_IDS.map((id) => {
  const item: ItemDef = ITEMS[id];
  const depth = GEM_DEPTH_TABLE.find((g) => g.id === id);
  return { id, item, depth, biome: GEM_BIOME[id] };
});
type GemRow = (typeof GEM_ROWS)[number];

const GEM_COLS: Col<GemRow>[] = [
  {
    label: `Gem`,
    get: (g) => g.item.name,
    render: (g) => (
      <b>
        <Swatch color={hex(g.item.color)} />
        {g.item.name}
      </b>
    ),
  },
  { label: `Id`, get: (g) => g.id, render: (g) => <code>{g.id}</code> },
  {
    label: `Rarity`,
    get: (g) => Object.keys(RARITY_COLORS).indexOf(g.item.rarity),
    render: (g) => <span style={{ color: RARITY_COLORS[g.item.rarity] }}>{g.item.rarity}</span>,
  },
  { label: `Value`, get: (g) => g.item.value, num: true },
  {
    label: `Found`,
    get: (g) => (g.depth ? `depth` : g.biome ? `biome ${g.biome}` : `none`),
    render: (g) =>
      g.depth ? (
        <span>depth table</span>
      ) : g.biome ? (
        <span>
          biome gem <Biome id={g.biome} />
        </span>
      ) : (
        <span className="warn">in no drop table</span>
      ),
  },
  { label: `Min depth`, get: (g) => g.depth?.minDepth ?? -1, num: true, render: (g) => g.depth?.minDepth ?? <span className="dim">-</span> },
  { label: `Weight`, get: (g) => g.depth?.weight ?? -1, num: true, render: (g) => g.depth?.weight ?? <span className="dim">-</span> },
  {
    label: `Share`,
    get: (g) => g.depth?.weight ?? -1,
    num: true,
    title: `Weight / sum of all depth-table weights (the share once every row is unlocked)`,
    render: (g) => (g.depth ? pct(g.depth.weight / GEM_WEIGHT_SUM) : <span className="dim">-</span>),
  },
];

function Gems() {
  return (
    <section id="gems">
      <h2>Gems ({GEM_ROWS.length})</h2>
      <p className="note">
        <code>GEM_IDS</code>, <code>GEM_DEPTH_TABLE</code> and <code>BIOME_GEM</code> in <code>src/world/items.ts</code>; name,
        rarity and value from <code>ITEMS</code>. Depth is metres below the surface.
      </p>
      <Table rows={GEM_ROWS} cols={GEM_COLS} rowKey={(g) => g.id} />
    </section>
  );
}

// ---------- gear ----------

const SLOT_ORDER = Object.keys(SLOT_LABELS) as GearSlotType[];

const GEAR_COLS: Col<GearBase>[] = [
  {
    label: `Name`,
    get: (g) => g.name,
    render: (g) => {
      const c = g.dye ?? g.tint;
      return (
        <b>
          {c !== undefined ? <Swatch color={hex(c)} /> : <span className="swatch none" />}
          {g.name}
        </b>
      );
    },
  },
  { label: `Id`, get: (g) => g.id, render: (g) => <code>{g.id}</code> },
  { label: `Implicit`, get: (g) => STATS[g.implicit]?.name ?? g.implicit, render: (g) => <Stat id={g.implicit} /> },
  {
    label: `Likes`,
    get: (g) => g.likes.join(` `),
    render: (g) => (
      <span className="pills">
        {g.likes.map((l) => (
          <Stat key={l} id={l} />
        ))}
      </span>
    ),
  },
  { label: `Biome`, get: (g) => g.biome ?? ``, render: (g) => <Biome id={g.biome} /> },
  { label: `Model`, get: (g) => g.model, render: (g) => <code className="dim">{g.model}</code> },
];

function Gear() {
  const biomeOnly = GEAR_BASES.filter((g) => g.biome).length;
  return (
    <section id="gear">
      <h2>Gear ({GEAR_BASES.length} bases)</h2>
      <p className="note">
        <code>GEAR_BASES</code> in <code>src/state/gear.ts</code>, grouped by slot (<code>SLOT_LABELS</code>).{' '}
        {GEAR_BASES.length - biomeOnly} normal bases, {biomeOnly} biome bases: a biome base rolls only when the loot roll names
        its biome. Stat names come from <code>STATS</code> in <code>src/state/gearStats.ts</code>; hover a stat for its id.
        The swatch is the tint or dye color.
      </p>
      {SLOT_ORDER.map((slot) => {
        const rows = GEAR_BASES.filter((g) => g.slot === slot);
        return (
          <div key={slot} className="group">
            <h3>
              {SLOT_LABELS[slot]} <span className="dim">({rows.length})</span>
            </h3>
            <Table rows={rows} cols={GEAR_COLS} rowKey={(g) => g.id} />
          </div>
        );
      })}
    </section>
  );
}

// ---------- characters ----------

function Characters() {
  return (
    <section id="characters">
      <h2>Characters</h2>
      <p className="note">
        The rigged moles and their hats are in <code>public/minear</code>.
      </p>
    </section>
  );
}

// ---------- sky ----------

const WEATHER_ROWS = (Object.keys(WEATHER_PRESETS) as WeatherState[]).map((state) => {
  const next = WEATHER_NEXT[state];
  const sum = next.reduce((s, [, w]) => s + w, 0);
  return { state, look: WEATHER_PRESETS[state], dur: WEATHER_DURATION[state], next: next.map(([s, w]) => [s, w / sum] as const) };
});
type WeatherRow = (typeof WEATHER_ROWS)[number];

const WEATHER_COLS: Col<WeatherRow>[] = [
  { label: `State`, get: (w) => w.state, render: (w) => <b>{w.state}</b> },
  { label: `Duration`, get: (w) => w.dur[0], num: true, render: (w) => `${mins(w.dur[0])} to ${mins(w.dur[1])}` },
  { label: `Cover`, get: (w) => w.look.cover, num: true },
  { label: `Overcast`, get: (w) => w.look.overcast, num: true },
  { label: `Rain`, get: (w) => w.look.rain, num: true },
  { label: `Storm`, get: (w) => w.look.storm, num: true },
  { label: `Mist`, get: (w) => w.look.mist, num: true },
  { label: `Wind`, get: (w) => w.look.wind, num: true },
  {
    label: `Next`,
    get: (w) => w.next.map(([s]) => s).join(` `),
    render: (w) => (
      <span className="pills">
        {w.next.map(([s, p]) => (
          <span key={s} className="pill">
            {s} {pct(p)}
          </span>
        ))}
      </span>
    ),
  },
];

/**
 * Runs a real DayClock through one full turn (sunrise to sunrise) with a fixed step and measures the day and
 * night parts and the night speed-up. The clock code is the source; nothing here repeats its constants.
 */
function measureDayClock() {
  const c = new DayClock();
  c.t = 0.25;
  c.computeDirs();
  const dt = 0.25;
  let day = 0;
  let night = 0;
  let dayStep = 0;
  let nightStep = 0;
  let wrapped = false;
  for (let i = 0; i < 400000; i++) {
    const isNight = c.sunDir.y < -0.06;
    const before = c.t;
    c.update(dt);
    const step = (c.t - before + 1) % 1;
    if (isNight) {
      night += dt;
      nightStep = step;
    } else {
      day += dt;
      dayStep = step;
    }
    if (c.t < before) wrapped = true;
    if (wrapped && c.t >= 0.25) break;
  }
  return { daySeconds: c.daySeconds, day, night, speedUp: dayStep > 0 ? nightStep / dayStep : 0 };
}

function Sky() {
  const [clock] = useState(measureDayClock);
  return (
    <section id="sky">
      <h2>Sky</h2>
      <p className="note">
        Change these in the game at <b>Settings &gt; Time of day</b> and <b>Settings &gt; Weather</b>. States, looks and
        durations: <code>WEATHER_PRESETS</code>, <code>WEATHER_DURATION</code> and <code>WEATHER_NEXT</code> in{' '}
        <code>src/sky/weather.ts</code>. Dynamic weather stays in a state for a random time in its duration range, then moves
        to a next state by the weights shown.
      </p>
      <Table rows={WEATHER_ROWS} cols={WEATHER_COLS} rowKey={(w) => w.state} />
      <h3>Day clock</h3>
      <p className="note">
        <code>DayClock.daySeconds</code> in <code>src/sky/dayClock.ts</code> is <b>{clock.daySeconds} s</b>. Measured by running
        the clock through one full turn: day {mins(clock.day)}, night {mins(clock.night)}, full turn{' '}
        {mins(clock.day + clock.night)}. Nights run <b>{fmt(clock.speedUp, 2)}x</b> faster than days.
      </p>
    </section>
  );
}

// ---------- page ----------

const SECTIONS = [
  [`foes`, `Foes`],
  [`bosses`, `Bosses`],
  [`gems`, `Gems`],
  [`gear`, `Gear`],
  [`characters`, `Characters`],
  [`sky`, `Sky`],
] as const;

export function CatalogPage() {
  useEffect(() => {
    document.body.classList.add(`dev`);
  }, []);
  return (
    <div className="dev-catalog">
      <header>
        <h1>MINEAR: catalog</h1>
        <p>Read-only. Every table comes from the live game data, so it always matches the code. Click a column head to sort.</p>
        <nav>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
          <a href="/dev" className="back">
            All debug pages
          </a>
        </nav>
      </header>
      <Foes />
      <Bosses />
      <Gems />
      <Gear />
      <Characters />
      <Sky />
    </div>
  );
}
