// The merchant dialog (folder: minear-r3f/src/menus; styles in minear-r3f/src/brand/merchant.css).
// Each of the six merchants (MERCHANTS in minear-r3f/src/economy/pricing.ts) is an NPC on its own floating
// island near the base; pressing E at one calls openMerchant(id, host). The dialog shows that ONE merchant:
//   - its cash, open or closed, shareholders (investors still owed) and fee,
//   - what it pays and asks per item, in NEAR (display only: minear-r3f/src/economy/nearDisplay.ts), with
//     the last change and a sparkline, its stock, and the on-chain trade (quote, then the relayer pays gas),
//   - World supply: per item, the on-chain total and the last 24 h mined and used up. The same in every
//     merchant's dialog, because it is the whole game's supply (Board.tokens),
//   - Activity: the last relayed actions (GET /events on minear-r3f/server, every REFRESH_MS while open),
//     with an explorer link per transaction.
// The dev-local Demo cheat (minear-r3f/src/game/entry.ts) runs this same dialog on the NEAR local chain
// (minear-r3f/server/tools/localChain.ts): real quotes, real trades, real Activity, no explorer links. There is no
// market simulation any more (user, 2026-11-14): to make the market move, run the bot miners
// (npm run near:bots on testnet, npm run local:bots on the local chain; minear-r3f/server/tools/bots.ts).
// The sign-in card and the Save now helper come from the Market Town panel (minear-r3f/src/menus/market.ts).
// While open, keys belong to the dialog: Esc (or E outside a text field) closes it.
import '../brand/merchant.css';
import { COIN, RECIPES, TOKENS, TOKEN_BY_ID, tokenName, type TokenId } from '../economy/catalog';
import { MERCHANT_BY_ID, last24, price, snapshot, type MerchantRules } from '../economy/pricing';
import type { Board, PlayerView, Side } from '../economy/types';
import { NEAR_ICON, coinsToNear, fmtNear, nearPrice, nearRef, nearToCoins } from '../economy/nearDisplay';
import { localMaterials } from '../economy/vault';
import { CHEAT } from '../game/entry';
import { GameError, viewCall, type Player } from '../near/play';
import { session } from '../near/session';
import { saveItems, runSignIn, signInHTML, type MarketHost } from './market';

export interface MerchantHost extends MarketHost {
  /** Called after the dialog closed (give the controls back to the game). */
  onClose?(): void;
}

/** Board and Activity refresh while open (the same cadence as the Market Town panel). */
const REFRESH_MS = 8_000;
const FEED_ROWS = 30;
/** The testnet explorer; none on the local chain (the Demo cheat). */
const EXPLORER: string | null = CHEAT ? null : `https://testnet.nearblocks.io`;
/** Price history points kept per merchant item (the sparkline). */
const HIST_MAX = 48;

/** An Activity line. */
interface MarketEvent {
  /** Stable key for the feed. */
  key: string;
  at: number;
  kind: 'sell' | 'buy' | 'invest' | 'save' | 'craft' | 'use' | 'other';
  /** The merchant id (pricing.ts) it belongs to; none for world events (save, craft, use). */
  merchant?: string;
  /** The account that acted. */
  who?: string;
  /** The rest of the sentence, plain text. */
  text: string;
  /** Explorer link to the transaction (testnet only). */
  href?: string;
}

interface PricePoint {
  bid: number;
  ask: number;
}

interface ShopRow {
  token: TokenId;
  /** NEAR per unit. */
  bid: number;
  ask: number;
  bidCoins: number;
  askCoins: number;
  stock: number;
  target: number;
  /** 24 h: players bought from / sold to this merchant; the world minted / used up; the supply now. */
  bought: number;
  sold: number;
  minted: number;
  burned: number;
  supply: number;
  factors: { stock: number; demand: number; world: number; cash: number };
}

interface ShopLook {
  cash: number;
  capital: number;
  reopen: number;
  closed: boolean;
  /** Investors still owed money. */
  investors: number;
  owed: number;
  /** The spread, 0.12 = 12%. */
  fee: number;
  rows: ShopRow[];
}

interface WorldRow {
  token: TokenId;
  supply: number;
  minted: number;
  burned: number;
}

/** A colour per merchant, for the crest and the sheet's accent. */
const ACCENT: Record<string, string> = {
  smelter: `#e8603c`,
  gemcutter: `#3f9be0`,
  jeweler: `#b06ad8`,
  wanderer: `#2fa39a`,
  quartermaster: `#c98a1e`,
  relics: `#7a62d6`,
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n: number) => Math.round(n).toLocaleString(`en-US`);
const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;
const pct = (k: number) => {
  const v = Math.round((k - 1) * 100);
  return v === 0 ? `no change` : `${v > 0 ? `+` : `−`}${Math.abs(v)}%`;
};

/** "now", "40 s", "12 min", "3 h", "2 d" between two times. */
function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 5) return `now`;
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

/** A small two-line sparkline (what it pays, what it asks) of the last points. */
function sparkSVG(h: PricePoint[]): string {
  const W = 72;
  const HH = 22;
  if (h.length < 2) return `<svg viewBox="0 0 ${W} ${HH}" aria-hidden="true"><line x1="2" y1="${HH / 2}" x2="${W - 2}" y2="${HH / 2}" class="flat"/></svg>`;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of h) {
    lo = Math.min(lo, p.bid, p.ask);
    hi = Math.max(hi, p.bid, p.ask);
  }
  const span = hi - lo || hi * 0.1 || 1;
  const x = (i: number) => (2 + (i * (W - 4)) / (HIST_MAX - 1) + (HIST_MAX - h.length) * ((W - 4) / (HIST_MAX - 1))).toFixed(1);
  const y = (v: number) => (HH - 2 - ((v - lo) / span) * (HH - 4)).toFixed(1);
  const line = (k: 'bid' | 'ask') => h.map((p, i) => `${x(i)},${y(p[k])}`).join(` `);
  return `<svg viewBox="0 0 ${W} ${HH}" aria-hidden="true"><polyline points="${line(`ask`)}" class="ask"/><polyline points="${line(`bid`)}" class="bid"/></svg>`;
}

/** The merchant's reasoning, in NEAR (the price tooltip). */
function reasons(m: MerchantRules, r: ShopRow, look: ShopLook): string[] {
  const t = TOKEN_BY_ID[r.token];
  const out = [
    `${t.name}: reference price ${fmtNear(nearRef(r.token))} NEAR.`,
    `I hold ${num(r.stock)}, I want about ${num(r.target)}: ${pct(r.factors.stock)}.`,
    `Miners sold me ${num(r.sold)} and bought ${num(r.bought)} in 24 h: ${pct(r.factors.demand)}.`,
    `Whole world: ${num(r.supply)} exist; in 24 h ${num(r.minted)} mined, ${num(r.burned)} used up: ${pct(r.factors.world)}.`,
    `My cash: ${fmtNear(look.cash)} of ${fmtNear(look.capital)} NEAR: I pay ${pct(r.factors.cash)}.`,
    `My fee is ${Math.round(look.fee * 100)}%. I pay ${fmtNear(r.bid)} NEAR each and sell at ${fmtNear(r.ask)} NEAR.`,
  ];
  if (look.closed) out.push(`My shop is CLOSED: I need ${fmtNear(look.reopen)} NEAR to open. Invest to open it.`);
  return out;
}

/** A relayed action as GET /events returns it (minear-r3f/server/src/relayer.ts RelayEvent). */
interface RelayEvent {
  at: number;
  sender: string;
  method: string;
  tx: string;
  merchant?: string;
  token?: TokenId;
  side?: Side;
  amount?: number;
  coins?: number;
  items?: [TokenId, number][];
  memo?: string;
  recipe?: string;
  times?: number;
}

const listText = (items: [TokenId, number][]) => items.map(([t, n]) => `${num(n)} ${tokenName(t)}`).join(`, `);

/** A relayed action as an Activity line (null for actions the feed does not show). */
function fromRelay(e: RelayEvent): MarketEvent | null {
  const id = Object.entries(session.deploy.merchants).find(([, a]) => a === e.merchant)?.[0];
  const mName = id ? MERCHANT_BY_ID[id].name : (e.merchant ?? ``);
  let kind: MarketEvent['kind'] = `other`;
  let text = ``;
  if (e.method === `trade` && e.token && e.side) {
    kind = e.side;
    const near = fmtNear(nearPrice(e.token, e.coins ?? 0));
    text =
      e.side === `sell`
        ? `sold ${num(e.amount ?? 0)} ${tokenName(e.token)} to ${mName} for ${near} NEAR`
        : `bought ${num(e.amount ?? 0)} ${tokenName(e.token)} from ${mName} for ${near} NEAR`;
  } else if (e.method === `invest`) {
    kind = `invest`;
    text = `invested ${fmtNear(coinsToNear(e.coins ?? 0))} NEAR in ${mName}`;
  } else if (e.method === `save_trip` && e.items?.length) {
    kind = `save`;
    text = `saved ${listText(e.items)} from a trip (supply up)`;
  } else if (e.method === `craft`) {
    const r = RECIPES.find((x) => x.id === e.recipe);
    if (!r) return null;
    const k = e.times ?? 1;
    kind = `craft`;
    const times = (l: [TokenId, number][]) => l.map(([t, n]): [TokenId, number] => [t, n * k]);
    text = `smelted ${listText(times(r.inputs))} into ${listText(times(r.outputs))} at the Refinery (supply down)`;
  } else if (e.method === `burn` && e.items?.length) {
    kind = `use`;
    text = e.memo === `take-home` ? `took ${listText(e.items)} home (burned on chain)` : `used up ${listText(e.items)} (burned on chain)`;
  } else return null;
  return {
    key: `tx:${e.tx || `${e.sender}:${e.at}`}`,
    at: e.at,
    kind,
    merchant: id,
    who: e.sender,
    text,
    href: EXPLORER && e.tx ? `${EXPLORER}/txns/${e.tx}` : undefined,
  };
}

// ---- shared between the six dialogs ----

/** On-chain price history per `${merchant}:${token}` (NEAR), one point per board refresh. */
const realHist = new Map<string, PricePoint[]>();
let realHistMs = 0;

function recordHistory(b: Board): void {
  if (b.now_ms <= realHistMs) return;
  realHistMs = b.now_ms;
  for (const [id, account] of Object.entries(session.deploy.merchants)) {
    const m = MERCHANT_BY_ID[id];
    const s = b.merchants.find((x) => x.account_id === account);
    if (!m || !s) continue;
    for (const t of Object.keys(m.target)) {
      const p = price(m, t, snapshot(b, s, t));
      const key = `${id}:${t}`;
      const h = realHist.get(key) ?? [];
      h.push({ bid: nearPrice(t, p.bid), ask: nearPrice(t, p.ask) });
      if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
      realHist.set(key, h);
    }
  }
}

async function readBoard(): Promise<Board> {
  try {
    const r = await fetch(`${session.server}/board`);
    if (r.ok) return (await r.json()) as Board;
  } catch {
    /* server down: read the chain directly */
  }
  return viewCall<Board>(session.deploy, `market_board`);
}

async function readEvents(account: string): Promise<MarketEvent[] | null> {
  try {
    const q = new URLSearchParams({ merchant: account, world: `1`, limit: String(FEED_ROWS) });
    const r = await fetch(`${session.server}/events?${q}`);
    if (!r.ok) return null;
    const body = (await r.json()) as { events?: RelayEvent[] };
    return (body.events ?? []).map(fromRelay).filter((e): e is MarketEvent => !!e);
  } catch {
    return null;
  }
}

class MerchantDialog {
  el: HTMLElement;
  sheet: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  msgEl: HTMLElement;
  tip: HTMLElement;
  id = ``;
  m!: MerchantRules;
  host: MerchantHost = {};
  board: Board | null = null;
  view: PlayerView | null = null;
  chainEvents: MarketEvent[] = [];
  eventsOk = true;
  busy = false;
  msg: { text: string; kind: 'ok' | 'err' | 'info' } | null = null;
  amounts = new Map<string, number>();
  timer = 0;
  openedAt = 0;
  /** Last painted prices per `${token}:bid|ask`, and the direction of their last change. */
  shown = new Map<string, number>();
  dir = new Map<string, 1 | -1>();
  /** Activity keys already shown, so only new rows slide in (also after a rebuild); none animate until the
   *  first list of this opening has been shown. */
  seen = new Set<string>();
  primed = false;
  feedLoaded = false;

  constructor() {
    this.el = document.createElement(`div`);
    this.el.id = `merchant`;
    this.el.className = `hidden`;
    this.el.innerHTML = `<div class="mch-sheet" role="dialog" aria-modal="true">
      <header class="mch-head"></header>
      <div class="mch-body"></div><div class="mch-msg" aria-live="polite"></div></div><div class="mch-tip" hidden></div>`;
    document.body.appendChild(this.el);
    this.sheet = this.el.querySelector(`.mch-sheet`)!;
    this.head = this.el.querySelector(`.mch-head`)!;
    this.body = this.el.querySelector(`.mch-body`)!;
    this.msgEl = this.el.querySelector(`.mch-msg`)!;
    this.tip = this.el.querySelector(`.mch-tip`)!;
    this.el.addEventListener(`click`, (e) => {
      const t = e.target as HTMLElement;
      if (t === this.el) this.close();
      else if (t.closest(`.mch-close`)) this.close();
    });
    this.body.addEventListener(`click`, (e) => this.onClick(e));
    this.body.addEventListener(`input`, (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.amt) this.amounts.set(t.dataset.amt, t.dataset.amt === `inv` ? Number(t.value) || 0 : Math.max(1, Math.floor(Number(t.value) || 1)));
    });
    this.body.addEventListener(`pointerover`, (e) => this.onHover(e));
    this.body.addEventListener(`pointerout`, (e) => {
      if ((e.target as HTMLElement).closest(`[data-why]`)) this.tip.hidden = true;
    });
    // While open, keys belong to the dialog: typing must not move the miner; Esc closes; E closes when
    // the focus is not in a text field (E opened it: a held key's repeats and the first 250 ms are ignored).
    window.addEventListener(
      `keydown`,
      (e) => {
        if (!this.isOpen) return;
        const t = e.target as HTMLElement | null;
        const typing = !!t && (t.tagName === `INPUT` || t.tagName === `TEXTAREA`);
        if (e.key === `Escape`) {
          e.preventDefault();
          this.close();
        } else if ((e.key === `e` || e.key === `E`) && !typing && !e.repeat && performance.now() - this.openedAt > 250) {
          e.preventDefault();
          this.close();
        }
        e.stopImmediatePropagation();
      },
      true,
    );
    session.onChange(() => this.isOpen && void this.refresh(true));
  }

  get isOpen(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  get player(): Player | null {
    return session.player;
  }

  get account(): string {
    return session.deploy.merchants[this.id] ?? `${this.id}.${session.deploy.root}`;
  }

  open(id: string, host: MerchantHost): void {
    const m = MERCHANT_BY_ID[id];
    if (!m) throw new Error(`Unknown merchant: ${id}`);
    if (this.id !== id) {
      this.shown.clear();
      this.dir.clear();
      this.chainEvents = [];
      this.msg = null;
      this.msgEl.textContent = ``;
    }
    this.id = id;
    this.m = m;
    this.host = host;
    this.openedAt = performance.now();
    this.primed = false;
    this.feedLoaded = false;
    this.sheet.style.setProperty(`--mc`, ACCENT[id] ?? `#2fa39a`);
    this.sheet.setAttribute(`aria-label`, `${m.name} the ${m.title}`);
    if (document.pointerLockElement) document.exitPointerLock();
    this.el.classList.remove(`hidden`);
    this.build();
    void this.refresh();
    clearInterval(this.timer);
    // a timed refresh never runs under a field being typed in
    this.timer = window.setInterval(() => {
      if (!this.busy && !this.body.contains(document.activeElement)) void this.refresh();
    }, REFRESH_MS);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.classList.add(`hidden`);
    this.tip.hidden = true;
    clearInterval(this.timer);
    this.host.onClose?.();
  }

  // ---- data ----

  async refresh(rebuild = false): Promise<void> {
    const p = this.player;
    const account = this.account;
    try {
      const [board, view, events] = await Promise.all([readBoard(), p ? p.view() : Promise.resolve(null), readEvents(account)]);
      this.board = board;
      this.view = view;
      recordHistory(board);
      this.eventsOk = !!events;
      if (events) this.chainEvents = events;
      if (account === this.account) this.feedLoaded = true;
    } catch (e) {
      this.say(`Could not read the market: ${e instanceof Error ? e.message : e}`, `err`);
    }
    if (!this.isOpen || account !== this.account) return;
    // the chain view rebuilds: balances and buttons change with it
    if (rebuild || !this.body.contains(document.activeElement)) this.build();
    else this.paint();
  }

  /** The look of this merchant now: the simulation, or the chain board. */
  look(): ShopLook | null {
    const b = this.board;
    const s = b?.merchants.find((x) => x.account_id === this.account);
    if (!b || !s) return null;
    const m = this.m;
    return {
      cash: coinsToNear(Number(s.coins)),
      capital: coinsToNear(m.capital),
      reopen: coinsToNear(Number(s.reopen)),
      closed: s.closed,
      investors: new Set(s.loans.filter((l) => Number(l.owed) > 0).map((l) => l.investor)).size,
      owed: coinsToNear(s.loans.reduce((a, l) => a + Number(l.owed), 0)),
      fee: m.spread,
      rows: Object.keys(m.target).map((t) => {
        const snap = snapshot(b, s, t);
        const p = price(m, t, snap);
        return {
          token: t,
          bid: nearPrice(t, p.bid),
          ask: nearPrice(t, p.ask),
          bidCoins: p.bid,
          askCoins: p.ask,
          stock: snap.stock,
          target: m.target[t],
          bought: snap.bought,
          sold: snap.sold,
          minted: snap.minted,
          burned: snap.burned,
          supply: snap.supply,
          factors: p.factors,
        };
      }),
    };
  }

  world(): WorldRow[] {
    const b = this.board;
    if (!b) return [];
    return TOKENS.map((t) => {
      const ts = b.tokens.find((x) => x.token_id === t.id);
      const w = last24(ts?.flow, b.now_ms);
      return { token: t.id, supply: Number(ts?.supply ?? 0), minted: w.a, burned: w.b };
    });
  }

  history(token: TokenId): PricePoint[] {
    return realHist.get(`${this.id}:${token}`) ?? [];
  }

  feed(): MarketEvent[] {
    return this.chainEvents;
  }

  bal(token: TokenId): number {
    return Number(this.view?.balances.find(([t]) => t === token)?.[1] ?? 0);
  }

  /** The closed banner and the trade buttons are built, not painted: rebuild when they change. */
  private builtClosed: boolean | null = null;
  structureChanged(): boolean {
    return (this.look()?.closed ?? null) !== this.builtClosed;
  }

  say(text: string, kind: 'ok' | 'err' | 'info' = `info`): void {
    this.msg = { text, kind };
    this.msgEl.textContent = text;
    this.msgEl.dataset.kind = kind;
  }

  async act(label: string, f: () => Promise<string | void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say(`${label}…`);
    this.build();
    try {
      const done = await f();
      this.say(done || `${label}: done`, `ok`);
    } catch (e) {
      const m = e instanceof GameError || e instanceof Error ? e.message : String(e);
      this.say(m, `err`);
    } finally {
      this.busy = false;
      await this.refresh(true);
    }
  }

  // ---- build (structure) and paint (numbers) ----

  build(): void {
    this.tip.hidden = true;
    const m = this.m;
    const look = this.look();
    this.builtClosed = look?.closed ?? null;
    this.head.innerHTML = `<div class="mch-crest" aria-hidden="true">${esc(m.name[0])}</div>
      <div class="titles"><h2>${esc(m.name)} <span>the ${esc(m.title)}</span></h2>
        <p class="sub">${esc(m.blurb)}</p>
        <div class="mch-stats">
          <span class="mch-pill" title="Cash: what it pays sellers with. Starting capital ${fmtNear(coinsToNear(m.capital))} NEAR (1 coin = ${fmtNear(coinsToNear(1))} NEAR)">${NEAR_ICON}<b data-k="cash">…</b> NEAR cash</span>
          <span class="mch-pill state" data-k="state">…</span>
          <span class="mch-pill" data-k="sharePill" title="Investors this shop still owes (they get 125% back from 40% of its sales)">Shareholders <b data-k="share">…</b></span>
          <span class="mch-pill" title="The gap between what it pays and what it asks">Fee <b data-k="fee">…</b></span>
          ${EXPLORER ? `<a class="mch-link" href="${EXPLORER}/address/${esc(this.account)}" target="_blank" rel="noopener">${esc(this.account)} ↗</a>` : `<span class="mch-link">${esc(this.account)} <i class="simtag">local testnet</i></span>`}
        </div></div>
      <button class="ghost mch-close" type="button" title="Close (Esc)">✕</button>`;
    const p = this.player;
    const parts: string[] = [];
    parts.push(p ? this.accountHTML(p) : signInHTML());
    parts.push(this.pricesHTML(look));
    parts.push(`<div class="mch-cols">
      <section class="mch-card mch-world"><h3>World supply <small>${CHEAT ? `on the local testnet` : `on chain`}, the same at every shop</small></h3>
        <div class="mch-wl" data-k="world"></div>
        <p class="soft mch-note">Bar: the last 24 h, mined minus used up, as a share of what exists. Green grows the supply (prices fall), red shrinks it (prices rise).</p></section>
      <section class="mch-card mch-feed"><h3>Activity <small>newest first</small></h3><ol class="mch-fl" data-k="feed"></ol></section>
    </div>`);
    const scroll = this.body.scrollTop;
    this.body.innerHTML = parts.join(``);
    this.body.scrollTop = scroll;
    this.body.classList.toggle(`busy`, this.busy);
    if (this.msg) {
      this.msgEl.textContent = this.msg.text;
      this.msgEl.dataset.kind = this.msg.kind;
    }
    this.paint();
  }

  accountHTML(p: Player): string {
    const v = this.view;
    const free = v ? `${num(v.free_left)} / ${num(v.free_limit)}` : `…`;
    let saveBtn = ``;
    const s = this.host.state;
    if (s) {
      const local = [...localMaterials(s)];
      const wait = v && v.next_save_ms > Date.now() ? Math.ceil((v.next_save_ms - Date.now()) / 1000) : 0;
      saveBtn = local.length
        ? `<button class="mkt-btn small primary" data-act="save" ${this.busy || wait ? `disabled` : ``}
            title="Not saved on chain yet: ${esc(local.map(([t, n]) => `${num(n)} ${tokenName(t)}`).join(`, `))}">${wait ? `Save again in ${wait} s` : `Save now`}</button>`
        : ``;
    }
    return `<section class="mch-acct">
      <span><b>${esc(p.id)}</b></span>
      <span class="mch-pill" title="Your game balance, shown in NEAR (1 coin = ${fmtNear(coinsToNear(1))} NEAR)">${NEAR_ICON}<b data-k="mine">${v ? fmtNear(coinsToNear(this.bal(COIN))) : `…`}</b> NEAR</span>
      <span class="mch-pill" title="Actions the game pays gas for today. They reset at 00:00 UTC.">Gas-free today <b>${free}</b></span>
      ${saveBtn}
      ${EXPLORER ? `<a class="mch-link" href="${EXPLORER}/address/${esc(p.id)}" target="_blank" rel="noopener">on chain ↗</a>` : `<i class="simtag">local testnet</i>`}
      ${CHEAT ? `` : `<button class="mch-link" data-act="signout">Sign out</button>`}
    </section>`;
  }

  pricesHTML(look: ShopLook | null): string {
    const m = this.m;
    if (!look) return `<section class="mch-card soft">${this.board ? `${esc(m.name)} is not on the board yet.` : `Reading the market…`}</section>`;
    const p = this.player;
    // trading: on chain with a signed-in player (testnet, or the local testnet in the Demo cheat)
    const can = !!p;
    const off = look.closed || !can || this.busy;
    let closed = ``;
    if (look.closed) {
      const need = Math.max(0.01, look.reopen - look.cash);
      const amt = this.amounts.get(`inv`) ?? Number(need.toFixed(2));
      closed = `<div class="mch-closed"><b>CLOSED</b>: ${esc(m.name)} is broke. It has ${fmtNear(look.cash)} of the ${fmtNear(look.reopen)} NEAR it needs to open.
        ${can ? `<span class="row"><input type="number" min="0.01" step="0.01" value="${amt}" data-amt="inv" aria-label="NEAR to invest" />
          <button class="mkt-btn small primary" data-act="invest" ${this.busy ? `disabled` : ``}>Invest</button></span>
          <small>You get back 125% from its later sales.</small>` : ``}</div>`;
    }
    const rows = look.rows
      .map((r) => {
        const d = TOKEN_BY_ID[r.token];
        const amt = this.amounts.get(r.token) ?? (d.tier >= 4 ? 1 : 10);
        return `<div class="mch-tr" data-token="${r.token}">
          <span class="nm"><span class="chip" style="--c:${hex(d.color)}"><i></i>${esc(d.name)}</span>${can ? `<small data-k="you">you ${num(this.bal(r.token))}</small>` : ``}</span>
          <span class="px bid" data-why="${r.token}"><b data-k="bid"></b><em data-k="bidDir"></em></span>
          <span class="px ask" data-why="${r.token}"><b data-k="ask"></b><em data-k="askDir"></em></span>
          <span class="mch-spark" data-k="spark"></span>
          <span class="stk"><b data-k="stock"></b><small>/${num(r.target)}</small></span>
          ${can ? `<span class="go"><input type="number" min="1" max="1000" value="${amt}" data-amt="${r.token}" aria-label="How many" />
            <button class="mkt-btn small" data-act="trade" data-side="sell" data-token="${r.token}" ${off || this.bal(r.token) < 1 ? `disabled` : ``}>Sell</button>
            <button class="mkt-btn small" data-act="trade" data-side="buy" data-token="${r.token}" ${off || r.stock < 1 ? `disabled` : ``}>Buy</button></span>` : `<span class="go"></span>`}
        </div>`;
      })
      .join(``);
    const note = `<p class="soft mch-note">Hover a price to read ${esc(m.name)}'s reasoning. Prices are shown in NEAR; ${p ? `a trade is signed in this browser and the game pays the gas${CHEAT ? ` (local testnet)` : ``}.` : `sign in to trade.`} You trade materials saved on chain only.</p>`;
    return `<section class="mch-card mch-prices">
      <h3>Prices <small>NEAR per unit</small></h3>
      ${closed}
      <div class="mch-table" role="table">
        <div class="mch-tr mch-th" role="row"><span>Item</span><span title="What ${esc(m.name)} pays you">Pays</span><span title="What ${esc(m.name)} asks">Sells</span><span>Trend</span><span title="In stock / wants to hold">Stock</span><span></span></div>
        ${rows}
      </div>${note}
    </section>`;
  }

  /** Writes the numbers into the built dialog (no rebuild: inputs and focus stay). */
  paint(): void {
    if (!this.isOpen) return;
    const look = this.look();
    const q = (root: ParentNode, k: string) => root.querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (look) {
      const set = (k: string, v: string) => {
        const e = q(this.head, k);
        if (e && e.textContent !== v) e.textContent = v;
      };
      set(`cash`, fmtNear(look.cash));
      set(`share`, String(look.investors));
      const sp = q(this.head, `sharePill`);
      if (sp) sp.title = `Investors this shop still owes: ${fmtNear(look.owed)} NEAR. They get 125% back from 40% of its sales.`;
      set(`fee`, `${Math.round(look.fee * 100)}%`);
      const st = q(this.head, `state`);
      if (st) {
        st.textContent = look.closed ? `Closed: broke` : `Open`;
        st.classList.toggle(`closed`, look.closed);
        st.title = look.closed ? `Closed until investors bring its cash to ${fmtNear(look.reopen)} NEAR` : `Open: it buys and sells`;
      }
      for (const r of look.rows) {
        const row = this.body.querySelector<HTMLElement>(`.mch-tr[data-token="${r.token}"]`);
        if (!row) continue;
        this.paintPrice(row, r.token, `bid`, r.bid);
        this.paintPrice(row, r.token, `ask`, r.ask);
        const stock = q(row, `stock`);
        if (stock) stock.textContent = num(r.stock);
        const sp = q(row, `spark`);
        if (sp) sp.innerHTML = sparkSVG(this.history(r.token));
      }
    }
    const w = q(this.body, `world`);
    if (w) w.innerHTML = this.worldHTML();
    const f = q(this.body, `feed`);
    if (f) this.paintFeed(f);
  }

  /** The Activity list, newest first. New rows go in at the top (they slide in with a short highlight);
   *  rows already shown stay as they are, only their age text changes. */
  paintFeed(f: HTMLElement): void {
    const items = this.feed();
    const now = Date.now();
    if (!items.length) {
      if (!f.querySelector(`.mch-empty`))
        f.innerHTML = `<li class="mch-empty">${this.eventsOk ? `No trades since the server started. Trades, saved trips and investments show here as they happen.` : `The activity server is not reachable.`}</li>`;
      return;
    }
    const want = new Set(items.map((e) => e.key));
    for (const li of [...f.children] as HTMLElement[]) if (!want.has(li.dataset.key ?? ``)) li.remove();
    const have = new Set(([...f.children] as HTMLElement[]).map((li) => li.dataset.key));
    const fresh = items.filter((e) => !have.has(e.key));
    if (fresh.length) {
      const anim = (e: MarketEvent) => this.primed && !this.seen.has(e.key);
      const onTop = items.slice(0, fresh.length).every((e) => !have.has(e.key));
      if (have.size && onTop) f.insertAdjacentHTML(`afterbegin`, fresh.map((e) => this.feedRow(e, now, anim(e))).join(``));
      else f.innerHTML = items.map((e) => this.feedRow(e, now, anim(e))).join(``);
    }
    if (this.seen.size > 2000) this.seen.clear();
    for (const e of items) this.seen.add(e.key);
    if (this.feedLoaded) this.primed = true;
    for (const li of f.children as HTMLCollectionOf<HTMLElement>) {
      const t = li.firstElementChild as HTMLElement | null;
      const a = ago(Number(li.dataset.at), now);
      if (t && t.textContent !== a) t.textContent = a;
    }
  }

  /** One price cell: the number, the arrow of its last change, and a flash when it moved. */
  paintPrice(row: HTMLElement, token: TokenId, k: 'bid' | 'ask', v: number): void {
    const key = `${token}:${k}`;
    const cell = row.querySelector<HTMLElement>(`.px.${k}`)!;
    const b = cell.querySelector(`b`)!;
    const em = cell.querySelector(`em`)!;
    const was = this.shown.get(key);
    const text = fmtNear(v);
    if (b.textContent !== text) b.textContent = text;
    if (was !== undefined && Math.abs(v - was) > Math.max(1e-12, was * 0.0005)) {
      const up = v > was;
      this.dir.set(key, up ? 1 : -1);
      cell.animate([{ backgroundColor: up ? `#bff0d2` : `#ffd2c8` }, { backgroundColor: `#0000` }], { duration: 700, easing: `ease-out` });
    }
    this.shown.set(key, v);
    const d = this.dir.get(key);
    em.textContent = d === 1 ? `▲` : d === -1 ? `▼` : ``;
    em.className = d === 1 ? `up` : d === -1 ? `down` : ``;
  }

  worldHTML(): string {
    const rows = this.world();
    if (!rows.length) return `<p class="soft">Reading the chain…</p>`;
    return rows
      .map((w) => {
        const d = TOKEN_BY_ID[w.token];
        const growth = (w.minted - w.burned) / Math.max(w.supply, 1);
        // the WORLD factor reaches its limit at a 50% change in 24 h (RULES.worldScale): the bar's full width
        const k = Math.max(-1, Math.min(1, growth / 0.5));
        const bar = k >= 0 ? `left:50%;width:${(k * 50).toFixed(1)}%` : `left:${(50 + k * 50).toFixed(1)}%;width:${(-k * 50).toFixed(1)}%`;
        return `<div class="wrow" title="${esc(d.name)}: ${num(w.supply)} exist. Last 24 h: ${num(w.minted)} mined, ${num(w.burned)} used up (${growth >= 0 ? `+` : `−`}${Math.abs(Math.round(growth * 100))}%).">
          <span class="chip" style="--c:${hex(d.color)}"><i></i>${esc(d.name)}</span>
          <b class="sup">${num(w.supply)}</b>
          <span class="flow"><em class="up">+${num(w.minted)}</em> <em class="down">−${num(w.burned)}</em></span>
          <span class="wbar"><i class="${k >= 0 ? `grow` : `shrink`}" style="${bar}"></i></span>
        </div>`;
      })
      .join(``);
  }

  feedRow(e: MarketEvent, now: number, isNew = false): string {
    const who = e.who
      ? EXPLORER
        ? `<a class="who" href="${EXPLORER}/address/${esc(e.who)}" target="_blank" rel="noopener" title="${esc(e.who)}">${esc(e.who)}</a> `
        : `<b class="who" title="${esc(e.who)}">${esc(e.who)}</b> `
      : ``;
    const tx = e.href ? ` <a class="tx" href="${esc(e.href)}" target="_blank" rel="noopener" title="The transaction on the testnet explorer">tx ↗</a>` : ``;
    return `<li class="k-${e.kind}${isNew ? ` new` : ``}" data-key="${esc(e.key)}" data-at="${e.at}"><span class="t">${ago(e.at, now)}</span><span class="tx-line">${who}${esc(e.text)}${tx}</span></li>`;
  }

  // ---- input ----

  onHover(e: Event): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(`[data-why]`);
    if (!cell) return;
    const look = this.look();
    const r = look?.rows.find((x) => x.token === cell.dataset.why);
    if (!look || !r) return;
    const lines = reasons(this.m, r, look);
    this.tip.innerHTML = `<b>${esc(this.m.name)} thinks:</b><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join(``)}</ul>`;
    const rect = cell.getBoundingClientRect();
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`;
    this.tip.style.top = `${rect.bottom + 8 + this.tip.offsetHeight > innerHeight ? rect.top - this.tip.offsetHeight - 8 : rect.bottom + 8}px`;
  }

  onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>(`[data-act]`);
    if (!b || this.busy) return;
    const act = b.dataset.act!;
    const p = this.player;
    if (act === `signout`) {
      session.signOut();
      this.say(`Signed out. Your account stays on chain.`);
      return;
    }
    if (runSignIn(act, () => void this.refresh(true), (m) => this.say(m, `err`))) return;
    if (!p) return;
    if (act === `save`) void this.save(p);
    else if (act === `trade`) void this.trade(p, b.dataset.token!, b.dataset.side as Side);
    else if (act === `invest`) {
      const near = Number(this.body.querySelector<HTMLInputElement>(`[data-amt="inv"]`)?.value ?? 0);
      const coins = nearToCoins(near);
      if (coins < 1) return this.say(`Type how much NEAR to invest`, `err`);
      void this.act(`Investing ${fmtNear(coinsToNear(coins))} NEAR`, async () => {
        await p.invest(this.account, coins);
        return `Invested ${fmtNear(coinsToNear(coins))} NEAR in ${this.m.name}.`;
      });
    }
  }

  async trade(p: Player, token: TokenId, side: Side): Promise<void> {
    const want = Math.max(1, Math.floor(Number(this.body.querySelector<HTMLInputElement>(`[data-amt="${token}"]`)?.value ?? 1) || 1));
    const m = this.m;
    const before = this.msg;
    await this.act(`Asking ${m.name}`, async () => {
      const q = await p.quote(m.id, token, side, side === `sell` ? Math.min(want, this.bal(token)) : want);
      await p.trade(q);
      const n = Number(q.quote.amount);
      const short = n < want ? ` (${m.name} took only ${n}: ${side === `sell` ? `cash` : `stock`} limit)` : ``;
      const near = fmtNear(nearPrice(token, Number(q.quote.coins)));
      return `${side === `sell` ? `Sold` : `Bought`} ${num(n)} ${tokenName(token)} ${side === `sell` ? `to` : `from`} ${m.name} for ${near} NEAR${short}.`;
    });
    // The merchant's voice (NEAR AI, minear-r3f/server/src/talk.ts), as in the Market Town panel: one line
    // after the result or the merchant's own refusal; never a price, and never for network or key errors.
    const said = this.msg;
    if (!said || said === before || said.kind === `info`) return;
    if (said.kind === `err` && !said.text.includes(m.name)) return;
    const line = await p.talk(m.id, token, side, said.text);
    if (line && this.msg === said && this.isOpen) this.say(`${said.text} ${m.name}: “${line}”`, said.kind);
  }

  async save(_p: Player): Promise<void> {
    if (!this.host.state) return;
    await this.act(`Saving`, async () => `${await saveItems(this.host)} Now you can sell it here.`);
  }
}

let dialog: MerchantDialog | null = null;

/** Opens the dialog of one merchant (`id`: a MERCHANTS id in minear-r3f/src/economy/pricing.ts). */
export function openMerchant(id: string, host: MerchantHost): void {
  dialog ??= new MerchantDialog();
  dialog.open(id, host);
}

export function merchantOpen(): boolean {
  return !!dialog?.isOpen;
}

export function closeMerchant(): void {
  dialog?.close();
}
