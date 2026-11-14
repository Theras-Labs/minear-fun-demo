// Merchant market model for minear-r3f/wiki/ai-merchants.md (scratchpad tool, not part of the game).
// It runs the REAL price rules (minear-r3f/src/economy/pricing.ts: price, quote, caravan) on a modelled
// player population. It touches no chain, no server and no database: pure arithmetic.
//   bun sim.ts <out dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKEN_BY_ID } from '../../src/economy/catalog';
import { MERCHANT_BY_ID, MERCHANTS, RULES, caravan, price, quote, type Snapshot } from '../../src/economy/pricing';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// ---------- the model ----------

/** Assumptions (all listed in the document). */
const A = {
  /** Hours one active miner plays per day. */
  hoursPerDay: 1,
  /** Finds per hour of play, as a share of the hourly save cap (the Capped Supply proposal uses the same). */
  findShare: 0.25,
  /** Share of the mined units a miner sells to merchants (the rest goes to the Forge, the skill tree, or stays). */
  sellShare: 0.25,
  /** Share of the mined units a miner uses up (burns) in the Forge, the Refinery and the skill tree. */
  burnShare: 0.6,
  /** Units one miner wants to buy from this merchant per day, as a share of the merchant's target. */
  buyPerMiner: 0.004,
  /** A miner buys only when the ask is at most this multiple of the base price. */
  buyBelow: 1.5,
  /** Hours a shop stays closed before investors bring it to its reopen cash. */
  investAfterH: 24,
};

interface Opt {
  merchant: string;
  days: number;
  stepH: number;
  miners: (day: number) => number;
  /** Find factor D (1 = Open Supply). */
  find?: (day: number, token: string) => number;
  /** How many merchants share the sellers of each item. */
  /** What-if: target, capital, floor and reopen cash times this (not in the game code). */
  scale?: number;
}

interface Row {
  day: number;
  miners: number;
  coins: number;
  closed: boolean;
  owed: number;
  tok: Record<string, { offered: number; cleared: number; bid: number; ask: number; mid: number; stock: number; supply: number; mined: number; f: { stock: number; demand: number; world: number; cash: number } }>;
}

/** How many merchants buy each token (sellers split between them). */
const BUYERS: Record<string, number> = {};
for (const m of MERCHANTS) for (const t of Object.keys(m.target)) BUYERS[t] = (BUYERS[t] ?? 0) + 1;

function run(o: Opt): Row[] {
  const m0 = MERCHANT_BY_ID[o.merchant];
  const k0 = o.scale ?? 1;
  const m = { ...m0, target: Object.fromEntries(Object.entries(m0.target).map(([t, v]) => [t, v * k0])), capital: m0.capital * k0, floor: m0.floor * k0, reopen: m0.reopen * k0 };
  const tokens = Object.keys(m.target);
  const win = Math.round(24 / o.stepH);
  let coins = m.capital;
  let closed = false;
  let closedH = 0;
  let owed = 0;
  interface St { stock: number; supply: number; sold: number[]; bought: number[]; minted: number[]; burned: number[]; due: number; backlog: number; want: number }
  const st: Record<string, St> = {};
  for (const t of tokens) {
    const genesis = MERCHANTS.reduce((a, x) => a + (x.target[t] ?? 0), 0);
    st[t] = { stock: m.target[t], supply: genesis, sold: [], bought: [], minted: [], burned: [], due: 0, backlog: 0, want: 0 };
  }
  const sum = (a: number[]) => a.slice(-win).reduce((x, y) => x + y, 0);
  const rows: Row[] = [];
  const steps = Math.round((o.days * 24) / o.stepH);
  const frac = o.stepH / 24;
  for (let i = 0; i <= steps; i++) {
    const day = (i * o.stepH) / 24;
    const n = o.miners(day);
    const now: Record<string, { mined: number; used: number; sold: number; bought: number; caravan: number }> = {};
    const snap = (t: string): Snapshot => ({
      nowMs: 0,
      closed,
      coins,
      stock: st[t].stock,
      bought: sum(st[t].bought) + now[t].bought,
      sold: sum(st[t].sold) + now[t].sold,
      minted: sum(st[t].minted),
      burned: sum(st[t].burned),
      supply: st[t].supply,
    });
    // 1. mining, and the caravan: surplus above 1.5x target leaves at up to 0.5x target per day, for 60% of base.
    //    The contract settles the caravan at a trade, from the time that passed. A closed shop has no trades, so
    //    its caravan waits and settles when the shop is open again.
    for (const t of tokens) {
      const s = st[t];
      const def = TOKEN_BY_ID[t];
      const d = o.find ? o.find(day, t) : 1;
      const mined = n * A.hoursPerDay * def.capPerHour * A.findShare * d * frac;
      now[t] = { mined, used: mined * A.burnShare, sold: 0, bought: 0, caravan: 0 };
      const c = caravan(m, t);
      s.due += c.perDay * frac;
      const units = closed ? 0 : Math.min(Math.floor(s.due), Math.max(0, s.stock - c.above));
      if (!closed) s.due -= Math.floor(s.due);
      if (units > 0) {
        s.stock -= units;
        coins += Math.floor((units * def.base * c.priceBps) / 10_000);
        now[t].caravan = units;
      }
      const share = BUYERS[t] ?? 1;
      s.backlog = Math.min(s.backlog + (mined * A.sellShare) / share, (n * def.capPerHour * A.findShare * d * A.sellShare * 3) / share);
      s.want = Math.min(s.want + n * m0.target[t] * A.buyPerMiner * frac, m.target[t]);
    }
    // 2. miners buy for the Forge when the ask is fair (repay_bps: 40% of the income pays investors back)
    if (!closed)
      for (const t of tokens) {
        const s = st[t];
        const need = Math.floor(s.want);
        if (need < 1 || price(m, t, snap(t)).ask > TOKEN_BY_ID[t].base * A.buyBelow) continue;
        const q = quote(m, t, `buy`, need, snap(t));
        if (q.amount === 0) continue;
        s.stock -= q.amount;
        const pay = Math.min(owed, Math.floor(q.coins * 0.4));
        owed -= pay;
        coins += q.coins - pay;
        now[t].bought = q.amount;
        s.want -= q.amount;
      }
    // 3. miners sell, in lots of 50, the items in turn (one quote may take at most budgetShare of the cash)
    for (let k = 0; k < 400 && !closed; k++) {
      let any = false;
      for (const t of tokens) {
        const s = st[t];
        const lot = Math.min(Math.floor(s.backlog), 50 * k0);
        if (lot < 1 || closed) continue;
        const q = quote(m, t, `sell`, lot, snap(t));
        if (q.amount === 0) continue;
        any = true;
        s.stock += q.amount;
        coins -= q.coins;
        now[t].sold += q.amount;
        s.backlog -= q.amount;
        if (coins < m.floor) closed = true; // the contract closes a shop under its floor
      }
      if (!any) break;
    }
    for (const t of tokens) {
      const s = st[t];
      const x = now[t];
      s.sold.push(x.sold);
      s.bought.push(x.bought);
      s.minted.push(x.mined);
      s.burned.push(x.used + x.caravan + x.bought * 0.5); // half of what is bought is forged
      s.supply = Math.max(1, s.supply + x.mined - x.used - x.caravan - x.bought * 0.5);
    }
    // 4. a closed shop: investors bring it to its reopen cash after a day (the contract opens it only on invest)
    if (closed) {
      closedH += o.stepH;
      if (closedH >= A.investAfterH && coins < m.reopen) {
        const put = m.reopen - coins;
        coins += put;
        owed += put * 1.25; // return_bps 2500
      }
      if (coins >= m.reopen) {
        closed = false;
        closedH = 0;
      }
    }
    const tok: Row['tok'] = {};
    for (const t of tokens) {
      const p = price(m, t, snap(t));
      tok[t] = { offered: (now[t].mined * A.sellShare) / (BUYERS[t] ?? 1) / frac, cleared: (now[t].bought + now[t].caravan) / frac, bid: p.bid, ask: p.ask, mid: p.mid, stock: st[t].stock, supply: st[t].supply, mined: now[t].mined / frac, f: p.factors };
    }
    rows.push({ day, miners: n, coins, closed, owed, tok });
  }
  return rows;
}

// ---------- Capped Supply find factor (the proposal's formula, daily retarget) ----------

function capped(miners: (day: number) => number, days: number, token: string) {
  const def = TOKEN_BY_ID[token];
  const sMax = 125_000 * def.capPerHour;
  const e0 = (sMax * Math.LN2) / 365;
  const out: { day: number; d: number; mined: number; minedDay: number; openDay: number; x: number }[] = [];
  let mined = 0;
  let d = 1;
  let prev = 0;
  for (let day = 0; day <= days; day++) {
    const x = (sMax - mined) / sMax;
    const e = e0 * x;
    const demand = miners(day) * A.hoursPerDay * def.capPerHour * A.findShare;
    if (day > 0) d = Math.min(Math.max(d * Math.sqrt(e / Math.max(prev, 1)), d / 2), Math.min(1, 2 * d));
    const dd = Math.min(Math.sqrt(x), d);
    const got = Math.min(demand * dd, sMax - mined, 1.5 * e);
    out.push({ day, d: dd, mined, minedDay: got, openDay: demand, x });
    mined += got;
    prev = got;
  }
  return out;
}

// ---------- SVG charts (dark surface, the reference palette's dark steps) ----------

const C = { bg: `#1a1a19`, text: `#f0efec`, sub: `#c3c2b7`, grid: `#34332f`, axis: `#6b6a64`, s: [`#3987e5`, `#d95926`, `#199e70`, `#c98500`], warn: `#e66767` };
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

interface Series {
  name: string;
  pts: [number, number][];
  color: string;
  dash?: boolean;
  step?: boolean;
}
interface Panel {
  title: string;
  yLabel?: string;
  series: Series[];
  refs?: { y: number; label: string }[];
  bands?: { x0: number; x1: number; label?: string }[];
  yMin?: number;
  yMax?: number;
  h?: number;
  fmt?: (v: number) => string;
  log?: boolean;
}

const nice = (max: number) => {
  const p = 10 ** Math.floor(Math.log10(max || 1));
  const k = max / p;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * p;
};
const fmtNum = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${+(v / 1e3).toFixed(0)}k` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`);
const esc = (s: string) => s.replace(/&/g, `&amp;`).replace(/</g, `&lt;`);

function chart(file: string, title: string, sub: string, xLabel: string, panels: Panel[], xTicks?: number[], xFmt: (v: number) => string = (v) => `${v}`) {
  const W = 880;
  const L = 64;
  const R = 150;
  const top = 64;
  let y = top;
  const body: string[] = [];
  const xs = panels.flatMap((p) => p.series.flatMap((s) => s.pts.map((q) => q[0])));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const ticks = xTicks ?? Array.from({ length: 7 }, (_, i) => x0 + ((x1 - x0) * i) / 6);
  panels.forEach((p, pi) => {
    const H = p.h ?? 170;
    const ys = p.series.flatMap((s) => s.pts.map((q) => q[1])).concat((p.refs ?? []).map((r) => r.y));
    const lo = p.yMin ?? 0;
    const hi = p.yMax ?? nice(Math.max(...ys) * 1.05);
    const Y = (v: number) => y + 26 + H - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * H;
    const f = p.fmt ?? fmtNum;
    body.push(`<text x="${L}" y="${y + 12}" fill="${C.text}" font-size="13" font-weight="600">${esc(p.title)}</text>`);
    for (const b of p.bands ?? []) {
      body.push(`<rect x="${X(b.x0)}" y="${Y(hi)}" width="${Math.max(2, X(b.x1) - X(b.x0))}" height="${H}" fill="${C.warn}" opacity="0.16"/>`);
      if (b.label) body.push(`<text x="${X(b.x0) + 4}" y="${Y(hi) + 13}" fill="${C.warn}" font-size="11">${esc(b.label)}</text>`);
    }
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      body.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${i === 0 ? C.axis : C.grid}" stroke-width="1"/>`);
      body.push(`<text x="${L - 8}" y="${Y(v) + 4}" fill="${C.sub}" font-size="11" text-anchor="end">${f(v)}</text>`);
    }
    for (const r of p.refs ?? []) {
      body.push(`<line x1="${L}" x2="${W - R}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${C.sub}" stroke-width="1" stroke-dasharray="3 4"/>`);
    }
    const ends: { y: number; s?: Series; ref?: string }[] = (p.refs ?? []).map((r) => ({ y: Y(r.y), ref: r.label }));
    for (const s of p.series) {
      let dpath = ``;
      s.pts.forEach(([a, b], i) => {
        if (s.step && i > 0) dpath += `L${X(a).toFixed(1)} ${Y(s.pts[i - 1][1]).toFixed(1)}`;
        dpath += `${i ? `L` : `M`}${X(a).toFixed(1)} ${Y(b).toFixed(1)}`;
      });
      body.push(`<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="6 4"` : ``}/>`);
      ends.push({ y: Y(s.pts.at(-1)![1]), s });
    }
    // direct labels at the line ends, pushed apart
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) {
      if (!e.s) {
        body.push(`<text x="${W - R + 8}" y="${e.y + 4}" fill="${C.sub}" font-size="11">${esc(e.ref!)}</text>`);
        continue;
      }
      body.push(`<line x1="${W - R + 6}" x2="${W - R + 20}" y1="${e.y}" y2="${e.y}" stroke="${e.s.color}" stroke-width="2"${e.s.dash ? ` stroke-dasharray="4 3"` : ``}/>`);
      body.push(`<text x="${W - R + 25}" y="${e.y + 4}" fill="${C.text}" font-size="11.5">${esc(e.s.name)}</text>`);
    }
    if (pi === panels.length - 1) {
      for (const t of ticks) body.push(`<text x="${X(t)}" y="${y + 26 + H + 16}" fill="${C.sub}" font-size="11" text-anchor="middle">${xFmt(t)}</text>`);
      body.push(`<text x="${(L + W - R) / 2}" y="${y + 26 + H + 34}" fill="${C.sub}" font-size="11.5" text-anchor="middle">${esc(xLabel)}</text>`);
    }
    y += 26 + H + (pi === panels.length - 1 ? 44 : 22);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}" font-family="${FONT}" role="img" aria-label="${esc(title)}">
<rect width="${W}" height="${y}" rx="10" fill="${C.bg}"/>
<text x="${L}" y="28" fill="${C.text}" font-size="16" font-weight="700">${esc(title)}</text>
<text x="${L}" y="47" fill="${C.sub}" font-size="12">${esc(sub)}</text>
${body.join(`\n`)}
</svg>`;
  writeFileSync(join(OUT, file), svg);
}

const pick = (rows: Row[], f: (r: Row) => number): [number, number][] => rows.map((r) => [r.day, f(r)]);
const closedBands = (rows: Row[]) => {
  const b: { x0: number; x1: number; label?: string }[] = [];
  let start: number | null = null;
  for (const r of rows) {
    if (r.closed && start === null) start = r.day;
    if (!r.closed && start !== null) {
      b.push({ x0: start, x1: r.day });
      start = null;
    }
  }
  if (start !== null) b.push({ x0: start, x1: rows.at(-1)!.day });
  if (b[0]) b[0].label = `shop closed`;
  return b;
};

const report: Record<string, unknown> = {};

// ---- chart 1: the STOCK rule ----
{
  const el = [
    [0.5, `Opaline 0.5`],
    [0.7, `Pip 0.7`],
    [1, `Ossian 1.0`],
  ] as const;
  const series: Series[] = el.map(([e, name], i) => ({
    name,
    color: C.s[i],
    pts: Array.from({ length: 121 }, (_, k) => {
      const r = 0.1 + (k * 3.9) / 120;
      return [r, Math.min(RULES.stockMax, Math.max(RULES.stockMin, (1 / r) ** e))] as [number, number];
    }),
  }));
  chart(`chart-stock-rule.svg`, `STOCK factor: full shelves pay less`, `(target / stock) ^ elasticity, kept between x0.25 and x4. Source: price() in src/economy/pricing.ts`, `Stock the merchant holds, as a multiple of its target`, [{ title: `Price multiplier`, series, refs: [{ y: 1, label: `x1 at target` }], yMax: 4, h: 240, fmt: (v) => `x${+v.toFixed(2)}` }], [0.1, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], (v) => `${v}x`);
}

// ---- chart 2: one big sale walks the price ----
{
  const m = MERCHANT_BY_ID.smelter;
  const s: Snapshot = { nowMs: 0, closed: false, coins: m.capital, stock: 300, bought: 0, sold: 0, minted: 0, burned: 0, supply: 450 };
  const per: [number, number][] = [];
  const avg: [number, number][] = [];
  let total = 0;
  const cur = { ...s };
  for (let n = 1; n <= 600; n++) {
    const p = price(m, `ore.iron`, cur);
    total += p.bid;
    cur.stock += 1;
    cur.sold += 1;
    cur.coins -= p.bid;
    per.push([n, p.bid]);
    avg.push([n, total / n]);
  }
  const q = quote(m, `ore.iron`, `sell`, 600, s);
  report.slippage = { firstBid: per[0][1], bidAt300: per[299][1], lastBid: per.at(-1)![1], avg600: +(total / 600).toFixed(2), quoteTakes: q.amount, quoteCoins: q.coins };
  chart(`chart-big-sale.svg`, `One big sale moves the price as it goes`, `Selling iron to Brann the Smelter (stock 300 = target, cash 8,000). quote() prices each unit after the one before.`, `Units of iron in one sale`, [
    {
      title: `Coins per unit of iron (base price 5)`,
      series: [
        { name: `bid for this unit`, pts: per, color: C.s[0], step: true },
        { name: `average paid`, pts: avg, color: C.s[1] },
      ],
      refs: [{ y: 1, label: `floor: 10% of base` }],
      yMax: 6,
      h: 220,
    },
  ], [1, 100, 200, 300, 400, 500, 600]);
}

// ---- charts 3 and 4: a quiet month and a gold rush at Brann ----
const month = (file: string, title: string, sub: string, miners: (d: number) => number, key: string, merchant = `smelter`, token = `ore.iron`) => {
  const rows = run({ merchant, days: 30, stepH: 1, miners });
  const m = MERCHANT_BY_ID[merchant];
  const t = TOKEN_BY_ID[token];
  const bands = closedBands(rows);
  chart(file, title, sub, `Day`, [
    { title: `Active miners`, series: [{ name: `miners`, pts: pick(rows, (r) => r.miners), color: C.s[3] }], h: 70 },
    {
      title: `${t.name}: coins per unit (base price ${t.base})`,
      series: [
        { name: `sells at (ask)`, pts: pick(rows, (r) => r.tok[token].ask), color: C.s[1], step: true },
        { name: `pays (bid)`, pts: pick(rows, (r) => r.tok[token].bid), color: C.s[0], step: true },
      ],
      refs: [{ y: t.base, label: `base ${t.base}` }],
      bands,
    },
    { title: `${t.name} stock at ${m.name}`, series: [{ name: `stock`, pts: pick(rows, (r) => r.tok[token].stock), color: C.s[2] }], refs: [{ y: m.target[token], label: `target ${m.target[token]}` }, { y: m.target[token] * 1.5, label: `caravan above ${m.target[token] * 1.5}` }], bands },
    { title: `${m.name}'s cash (coins)`, series: [{ name: `cash`, pts: pick(rows, (r) => r.coins), color: C.s[0] }], refs: [{ y: m.floor, label: `closes under ${m.floor}` }, { y: m.reopen, label: `reopens at ${m.reopen}` }], bands },
  ], [0, 5, 10, 15, 20, 25, 30]);
  const last = rows.at(-1)!;
  const closedHours = rows.filter((r) => r.closed).length;
  report[key] = {
    minBid: Math.min(...rows.map((r) => r.tok[token].bid)),
    maxBid: Math.max(...rows.map((r) => r.tok[token].bid)),
    endBid: last.tok[token].bid,
    endAsk: last.tok[token].ask,
    maxStock: Math.max(...rows.map((r) => r.tok[token].stock)),
    endStock: last.tok[token].stock,
    minCash: Math.round(Math.min(...rows.map((r) => r.coins))),
    endCash: Math.round(last.coins),
    closedHours,
    firstClosedDay: rows.find((r) => r.closed)?.day ?? null,
    owedEnd: Math.round(last.owed),
  };
  return rows;
};
month(`chart-quiet-month.svg`, `A quiet month: 10 miners, the price finds a level`, `Brann the Smelter and iron. Hourly steps, real price rules, modelled players (see the assumptions table).`, () => 10, `quiet`);
month(`chart-rush-month.svg`, `A rush: 10 miners become 120 in ten days`, `Same model. More miners sell more iron than Brann's buyers and caravan can take.`, (d) => (d < 8 ? 10 : d < 18 ? 10 + ((d - 8) / 10) * 110 : 120), `rush`);
month(`chart-small-purse.svg`, `A small purse breaks first: Quill the Quartermaster`, `40 miners. Quill has 3,000 coins and may spend 35% of his cash on one sale.`, () => 40, `quill`, `quartermaster`, `ore.copper`);

// ---- chart 5: the six merchants' capacity ----
{
  const cap = MERCHANTS.map((m) => {
    let units = 0;
    let coinsDay = 0;
    for (const t of Object.keys(m.target)) {
      const c = caravan(m, t);
      units += c.perDay;
      coinsDay += (c.perDay * TOKEN_BY_ID[t].base * c.priceBps) / 10_000;
    }
    return { id: m.id, name: m.name, capital: m.capital, caravanUnitsDay: units, caravanCoinsDay: Math.round(coinsDay) };
  });
  report.capacity = cap;
  report.caravanCoinsDayAll = cap.reduce((a, c) => a + c.caravanCoinsDay, 0);
}

// ---- charts 6 and 7: Open Supply and Capped Supply over three years ----
{
  const growth = (d: number) => Math.round(50 + (950 * Math.min(d, 365)) / 365); // 50 -> 1,000 miners in year one
  const days = 365 * 3;
  const cu = capped(growth, days, `ore.copper`);
  const ticks = [0, 182, 365, 547, 730, 912, 1095];
  const xf = (v: number) => (v === 0 ? `0` : `${+(v / 365).toFixed(1)} y`);
  let openTotal = 0;
  const openCum: [number, number][] = [];
  const capCum: [number, number][] = [];
  for (const r of cu) {
    openCum.push([r.day, openTotal]);
    capCum.push([r.day, r.mined]);
    openTotal += r.openDay;
  }
  const sMax = 125_000 * TOKEN_BY_ID[`ore.copper`].capPerHour;
  chart(`chart-open-vs-capped-supply.svg`, `Copper mined: Open Supply keeps growing, Capped Supply bends`, `Model: miners grow from 50 to 1,000 in year one, then stay. Capped Supply uses the proposal's formula (not built).`, `Time`, [
    { title: `Active miners`, series: [{ name: `miners`, pts: cu.map((r) => [r.day, growth(r.day)]), color: C.s[3] }], h: 60 },
    {
      title: `Copper mined per day`,
      series: [
        { name: `Open Supply`, pts: cu.map((r) => [r.day, r.openDay]), color: C.s[1] },
        { name: `Capped Supply`, pts: cu.map((r) => [r.day, r.minedDay]), color: C.s[0] },
      ],
    },
    {
      title: `Copper mined in total`,
      series: [
        { name: `Open Supply`, pts: openCum, color: C.s[1] },
        { name: `Capped Supply`, pts: capCum, color: C.s[0] },
      ],
      refs: [{ y: sMax, label: `cap ${fmtNum(sMax)}` }],
      yMax: nice(openTotal),
    },
    { title: `Capped Supply find factor D (share of an Open Supply find that is kept)`, series: [{ name: `D`, pts: cu.map((r) => [r.day, r.d]), color: C.s[0] }], yMax: 1, h: 110, fmt: (v) => `${Math.round(v * 100)}%` },
  ], ticks, xf);
  const at = (d: number) => cu[d];
  report.capped = {
    sMax,
    day0: at(0),
    y1: at(365),
    y2: at(730),
    y3: at(1095),
    openTotal3y: Math.round(openTotal),
    cappedTotal3y: Math.round(cu.at(-1)!.mined),
  };

  // the same merchant under both: daily steps, three years, iron at Brann
  const fe = capped(growth, days, `ore.iron`);
  const dOf: Record<string, ReturnType<typeof capped>> = {};
  for (const t of Object.keys(MERCHANT_BY_ID.smelter.target)) dOf[t] = capped(growth, days, t);
  const open = run({ merchant: `smelter`, days, stepH: 2, miners: growth });
  const cap = run({ merchant: `smelter`, days, stepH: 2, miners: growth, find: (day, t) => dOf[t][Math.min(days, Math.floor(day))].d });
  const weekly = (rows: Row[], f: (r: Row) => number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < rows.length; i += 84) {
      const part = rows.slice(i, i + 84);
      out.push([part[0].day, part.reduce((a, r) => a + f(r), 0) / part.length]);
    }
    return out;
  };
  const shut = (rows: Row[]) => weekly(rows, (r) => (r.closed ? 1 : 0));
  chart(`chart-open-vs-capped-market.svg`, `The same merchant in both economies (iron at Brann)`, `Weekly averages. Fixed merchant settings in both runs: target 300, cash 8,000, caravan 150 a day. The bid stays at 1 to 2 coins.`, `Time`, [
    {
      title: `Iron per day: what miners bring to Brann, and what leaves his shelves`,
      series: [
        { name: `brought, Open`, pts: weekly(open, (r) => r.tok[`ore.iron`].offered), color: C.s[1] },
        { name: `brought, Capped`, pts: weekly(cap, (r) => r.tok[`ore.iron`].offered), color: C.s[0] },
        { name: `leaves (Capped run)`, pts: weekly(cap, (r) => r.tok[`ore.iron`].cleared), color: C.s[2], dash: true },
      ],
    },
    {
      title: `Share of the week Brann's shop is closed`,
      series: [
        { name: `Open Supply`, pts: shut(open), color: C.s[1] },
        { name: `Capped Supply`, pts: shut(cap), color: C.s[0] },
      ],
      yMax: 1,
      h: 120,
      fmt: (v) => `${Math.round(v * 100)}%`,
    },
    {
      title: `Coins Brann owes his investors (125% of what they put in)`,
      series: [
        { name: `Open Supply`, pts: weekly(open, (r) => r.owed), color: C.s[1] },
        { name: `Capped Supply`, pts: weekly(cap, (r) => r.owed), color: C.s[0] },
      ],
      h: 130,
    },
    {
      title: `Iron that exists (circulating supply)`,
      series: [
        { name: `Open Supply`, pts: weekly(open, (r) => r.tok[`ore.iron`].supply), color: C.s[1] },
        { name: `Capped Supply`, pts: weekly(cap, (r) => r.tok[`ore.iron`].supply), color: C.s[0] },
      ],
    },
  ], ticks, xf);
  const yr = (rows: Row[], y: number) => {
    const part = rows.filter((r) => r.day >= (y - 1) * 365 && r.day < y * 365);
    return {
      avgBid: +(part.reduce((a, r) => a + r.tok[`ore.iron`].bid, 0) / part.length).toFixed(2),
      offered: Math.round(part.reduce((a, r) => a + r.tok[`ore.iron`].offered, 0) / part.length),
      cleared: Math.round(part.reduce((a, r) => a + r.tok[`ore.iron`].cleared, 0) / part.length),
      closedShare: +(part.filter((r) => r.closed).length / part.length).toFixed(2),
      endSupply: Math.round(part.at(-1)!.tok[`ore.iron`].supply),
      owedEnd: Math.round(part.at(-1)!.owed),
    };
  };
  report.market = { open: [1, 2, 3].map((y) => yr(open, y)), capped: [1, 2, 3].map((y) => yr(cap, y)), ironD: { y1: fe[365].d, y2: fe[730].d, y3: fe[1095].d } };
}

// ---- chart 8: how many miners one merchant can serve ----
{
  const ns = [5, 10, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200];
  const res = ns.map((n) => {
    const rows = run({ merchant: `smelter`, days: 60, stepH: 1, miners: () => n }).filter((r) => r.day >= 30);
    const avg = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    return { n, iron: avg((r) => r.tok[`ore.iron`].bid) / 5, copper: avg((r) => r.tok[`ore.copper`].bid) / 2, gold: avg((r) => r.tok[`ore.gold`].bid) / 14, closed: avg((r) => (r.closed ? 1 : 0)) };
  });
  report.dose = res.map((r) => ({ n: r.n, iron: +r.iron.toFixed(2), copper: +r.copper.toFixed(2), gold: +r.gold.toFixed(2), closed: +r.closed.toFixed(2) }));
  chart(`chart-miners-per-merchant.svg`, `How many miners can one merchant serve?`, `Brann the Smelter, a steady number of miners, averages of days 30 to 60 of each run.`, `Active miners (steady)`, [
    {
      title: `What Brann pays, as a share of the base price`,
      series: [
        { name: `gold`, pts: res.map((r) => [r.n, r.gold]), color: C.s[3] },
        { name: `iron`, pts: res.map((r) => [r.n, r.iron]), color: C.s[0] },
        { name: `copper`, pts: res.map((r) => [r.n, r.copper]), color: C.s[1] },
      ],
      yMax: 1,
      fmt: (v) => `${Math.round(v * 100)}%`,
      h: 200,
    },
    { title: `Share of the time Brann's shop is closed`, series: [{ name: `closed`, pts: res.map((r) => [r.n, r.closed]), color: C.s[0] }], yMax: 1, h: 110, fmt: (v) => `${Math.round(v * 100)}%` },
  ], [5, 20, 40, 60, 80, 100, 120, 160, 200]);
}

// ---- chart 9: what-if, merchants scaled to the miner count, Open Supply and Capped Supply ----
{
  const days = 365 * 3;
  const N = 1000;
  const K = Number(process.env.SCALE ?? 40);
  const dOf: Record<string, ReturnType<typeof capped>> = {};
  for (const t of Object.keys(MERCHANT_BY_ID.smelter.target)) dOf[t] = capped(() => N, days, t);
  const open = run({ merchant: `smelter`, days, stepH: 4, miners: () => N, scale: K });
  const cap = run({ merchant: `smelter`, days, stepH: 4, miners: () => N, scale: K, find: (day, t) => dOf[t][Math.min(days, Math.floor(day))].d });
  const weekly = (rows: Row[], f: (r: Row) => number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < rows.length; i += 42) {
      const part = rows.slice(i, i + 42);
      out.push([part[0].day, part.reduce((a, r) => a + f(r), 0) / part.length]);
    }
    return out;
  };
  const ticks = [0, 182, 365, 547, 730, 912, 1095];
  const xf = (v: number) => (v === 0 ? `0` : `${+(v / 365).toFixed(1)} y`);
  chart(`chart-whatif-scaled.svg`, `What-if: merchants sized for the crowd (1,000 miners, Brann x${K})`, `Target, cash and caravan times ${K}. This scaling is NOT in the game code. Weekly averages.`, `Time`, [
    {
      title: `Brann pays for iron (coins per unit, base 5)`,
      series: [
        { name: `Open Supply`, pts: weekly(open, (r) => r.tok[`ore.iron`].bid), color: C.s[1] },
        { name: `Capped Supply`, pts: weekly(cap, (r) => r.tok[`ore.iron`].bid), color: C.s[0] },
      ],
      refs: [{ y: 5, label: `base 5` }],
      yMax: 10,
    },
    {
      title: `Iron on Brann's shelves, as a multiple of his target`,
      series: [
        { name: `Open Supply`, pts: weekly(open, (r) => r.tok[`ore.iron`].stock / (300 * K)), color: C.s[1] },
        { name: `Capped Supply`, pts: weekly(cap, (r) => r.tok[`ore.iron`].stock / (300 * K)), color: C.s[0] },
      ],
      refs: [{ y: 1, label: `target` }],
      h: 130,
      fmt: (v) => `${+v.toFixed(2)}x`,
    },
    {
      title: `Share of the week the shop is closed`,
      series: [
        { name: `Open Supply`, pts: weekly(open, (r) => (r.closed ? 1 : 0)), color: C.s[1] },
        { name: `Capped Supply`, pts: weekly(cap, (r) => (r.closed ? 1 : 0)), color: C.s[0] },
      ],
      yMax: 1,
      h: 90,
      fmt: (v) => `${Math.round(v * 100)}%`,
    },
  ], ticks, xf);
  const yr = (rows: Row[], y: number) => {
    const part = rows.filter((r) => r.day >= (y - 1) * 365 && r.day < y * 365);
    const avg = (f: (r: Row) => number) => +(part.reduce((a, r) => a + f(r), 0) / part.length).toFixed(2);
    return { bid: avg((r) => r.tok[`ore.iron`].bid), ask: avg((r) => r.tok[`ore.iron`].ask), stockX: avg((r) => r.tok[`ore.iron`].stock / (300 * K)), closed: avg((r) => (r.closed ? 1 : 0)) };
  };
  report.whatif = { K, open: [1, 2, 3].map((y) => yr(open, y)), capped: [1, 2, 3].map((y) => yr(cap, y)) };
}

writeFileSync(join(OUT, `report.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
