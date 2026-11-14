// The Market Town panel (folder: minear-r3f/src/menus; styles in minear-r3f/src/brand/market.css).
// The NEAR side of the economy: sign in (NEAR Auth, minear-r3f/src/menus/signIn.ts), see the on-chain vault
// (minear-r3f/src/economy/vault.ts; trips are saved there when they end, Save now sends what a limit left), trade with the six merchants, smelt at the Refinery, invest in a broke
// shop. Every action is signed in this browser with the session key and paid by the relayer: no
// wallet popup, no gas prompt. Hover a price to read the merchant's reasoning (minear-r3f/src/economy/pricing.ts).
// It opens from the lobby's Market tab. In the game the merchants are NPCs on the floating islands; each
// one opens its own dialog (minear-r3f/src/menus/merchantDialog.ts), which shares the sign-in and save
// helpers exported here. It changes nothing in the 3D scene.
import '../brand/market.css';
import { COIN, RECIPES, TOKENS, TOKEN_BY_ID, itemOf, tokenName, type TokenId } from '../economy/catalog';
import { MERCHANTS, explain, impact24, price, snapshot, type MerchantRules } from '../economy/pricing';
import type { Board, MerchantState, PlayerView, Side } from '../economy/types';
import { localMaterials, savedText, vault } from '../economy/vault';
import { CHEAT } from '../game/entry';
import { GameError, viewCall, type Player } from '../near/play';
import { session } from '../near/session';
import type { PlayerState } from '../state/playerState';
import { openSignIn } from './signIn';

export interface MarketHost {
  /** The local save: saving on chain takes materials from it, "take home" puts them back. */
  state?: PlayerState;
  /** Called after the local save changed (refresh the HUD and the panel underneath). */
  onLocalChange?(): void;
}

const REFRESH_MS = 8_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n: number) => n.toLocaleString(`en-US`);
const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;
const COINI = `<i class="coin sm"></i>`;

/** The sign-in card of the market and the merchant dialog: one button that opens the sign-in sheet
 *  (minear-r3f/src/menus/signIn.ts). Button: data-act="signin". In the Demo cheat: data-act="cheatacct". */
export function signInHTML(why = `Sign in to trade`): string {
  if (!session.live) return `<section class="mkt-card"><p>No deployment in this build.</p></section>`;
  if (CHEAT)
    return `<section class="mkt-card mkt-signin"><h3>${esc(why)}</h3>
      <p>The Demo cheat plays on the local testnet with an account made on this machine.</p>
      <div class="row"><button class="mkt-btn primary" data-act="cheatacct">Make my local testnet account</button></div></section>`;
  return `<section class="mkt-card mkt-signin">
      <h3>${esc(why)}</h3>
      <p>No seed phrase, no wallet popup, no gas: the game pays the gas.</p>
      <div class="row"><button class="mkt-btn primary" data-act="signin">Continue with Google</button></div>
      <p class="soft">Your account will be <b>&lt;name&gt;.${esc(session.deploy.root)}</b>. NEAR Auth keeps its key in NEAR's MPC network.</p>
    </section>`;
}

/** Runs the card's button (call from the click handler: the Google popup must open inside the click). */
export function runSignIn(act: string, onDone: () => void, onErr: (m: string) => void): boolean {
  if (act === `signin`) {
    openSignIn({ start: true, onDone });
    return true;
  }
  if (act === `cheatacct`) {
    session.cheatAccount().then(onDone, (e) => onErr(e instanceof Error ? e.message : String(e)));
    return true;
  }
  return false;
}

/** Save now: saves what still waits in this browser on chain (the vault, minear-r3f/src/economy/vault.ts) and tells
 *  the host. Trips are saved by themselves when they end; this is for what a limit or a failed save left behind. */
export async function saveItems(host: MarketHost): Promise<string> {
  const r = await vault.saveAll(host.state!);
  host.onLocalChange?.();
  if (r.err) throw new GameError(r.why ?? `The save failed.`);
  if (!r.items.length) return r.why ?? `Nothing waits to be saved.`;
  return `Saved ${savedText(r.items)} on chain.${r.why ? ` ${r.why}` : ``}`;
}

class MarketPanel {
  el: HTMLElement;
  body: HTMLElement;
  msgEl: HTMLElement;
  tip: HTMLElement;
  host: MarketHost = {};
  board: Board | null = null;
  view: PlayerView | null = null;
  msg: { text: string; kind: 'ok' | 'err' | 'info' } | null = null;
  timer = 0;
  amounts = new Map<string, number>();
  busy = false;

  constructor() {
    this.el = document.createElement(`div`);
    this.el.id = `market`;
    this.el.className = `hidden`;
    this.el.innerHTML = `<div class="mkt-sheet" role="dialog" aria-label="Market Town">
      <header><div class="titles"><h2>Market Town</h2>
        <p class="sub">Six merchants on NEAR testnet. Each sets its own prices from its stock, its cash and what miners did in the last 24 hours.</p></div>
        <button class="ghost close" type="button" title="Close (Esc)">✕</button></header>
      <div class="mkt-body"></div><div class="mkt-msg" aria-live="polite"></div></div><div class="mkt-tip" hidden></div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector(`.mkt-body`)!;
    this.msgEl = this.el.querySelector(`.mkt-msg`)!;
    this.tip = this.el.querySelector(`.mkt-tip`)!;
    this.el.querySelector(`.close`)!.addEventListener(`click`, () => this.close());
    this.el.addEventListener(`click`, (e) => e.target === this.el && this.close());
    this.body.addEventListener(`click`, (e) => this.onClick(e));
    this.body.addEventListener(`input`, (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.amt) this.amounts.set(t.dataset.amt, Math.max(1, Math.floor(Number(t.value) || 1)));
    });
    this.body.addEventListener(`pointerover`, (e) => this.onHover(e));
    this.body.addEventListener(`pointerout`, (e) => {
      if ((e.target as HTMLElement).closest(`[data-why]`)) this.tip.hidden = true;
    });
    // While open, keys belong to this panel: typing must not move the miner, Esc closes only this.
    window.addEventListener(
      `keydown`,
      (e) => {
        if (!this.isOpen) return;
        if (e.key === `Escape`) {
          e.preventDefault();
          this.close();
        }
        e.stopImmediatePropagation();
      },
      true,
    );
    session.onChange(() => this.isOpen && void this.refresh());
  }

  get isOpen(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  open(host: MarketHost): void {
    this.host = host;
    this.el.classList.remove(`hidden`);
    this.render();
    void this.refresh();
    clearInterval(this.timer);
    // a timed refresh never redraws under a field being typed in
    this.timer = window.setInterval(() => {
      if (!this.busy && !this.body.contains(document.activeElement)) void this.refresh();
    }, REFRESH_MS);
  }

  close(): void {
    this.el.classList.add(`hidden`);
    this.tip.hidden = true;
    clearInterval(this.timer);
  }

  get player(): Player | null {
    return session.player;
  }

  async refresh(): Promise<void> {
    const p = this.player;
    try {
      const [board, view] = await Promise.all([
        p ? p.board() : viewCall<Board>(session.deploy, `market_board`),
        p ? p.view() : Promise.resolve(null),
      ]);
      this.board = board;
      this.view = view;
    } catch (e) {
      this.say(`Could not read the market: ${e instanceof Error ? e.message : e}`, `err`);
    }
    if (this.isOpen) this.render();
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
    this.render();
    try {
      const done = await f();
      this.say(done || `${label}: done`, `ok`);
    } catch (e) {
      const m = e instanceof GameError || e instanceof Error ? e.message : String(e);
      this.say(m, `err`);
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  bal(token: TokenId): number {
    return Number(this.view?.balances.find(([t]) => t === token)?.[1] ?? 0);
  }

  // ---- render ----

  render(): void {
    this.tip.hidden = true;
    const p = this.player;
    const parts = [p ? this.accountHTML(p) : this.signInHTML()];
    if (p) parts.push(this.vaultHTML());
    parts.push(this.shopsHTML());
    const scroll = this.body.scrollTop;
    this.body.innerHTML = parts.join(``);
    this.body.scrollTop = scroll;
    this.body.classList.toggle(`busy`, this.busy);
    if (this.msg) {
      this.msgEl.textContent = this.msg.text;
      this.msgEl.dataset.kind = this.msg.kind;
    }
  }

  signInHTML(): string {
    return signInHTML();
  }

  accountHTML(p: Player): string {
    const v = this.view;
    const via = session.via === `nearauth` ? `NEAR Auth${session.email ? ` (${esc(session.email)})` : ``}` : `this device`;
    const free = v ? `${num(v.free_left)} / ${num(v.free_limit)}` : `…`;
    return `<section class="mkt-acct">
      <span><b>${esc(p.id)}</b> <small>key: ${via}</small></span>
      <span class="pill small">${COINI}<b>${num(this.bal(COIN))}</b> market coins</span>
      <span class="pill small" title="Actions the game pays gas for today. They reset at 00:00 UTC.">Gas-free today: <b>${free}</b></span>
      <button class="mkt-btn small" data-act="pack" ${this.busy ? `disabled` : ``}>+300 for 250 ${COINI}</button>
      ${CHEAT ? `<i class="soft">local testnet</i>` : `<a class="mkt-link" href="https://testnet.nearblocks.io/address/${esc(p.id)}" target="_blank" rel="noopener">on chain ↗</a>`}
      <button class="mkt-link" data-act="signout">Sign out</button>
    </section>`;
  }

  vaultHTML(): string {
    const v = this.view;
    const held = (v?.balances ?? []).filter(([t]) => t !== COIN && TOKEN_BY_ID[t]);
    const chips = held.length
      ? held
          .map(([t, n]) => {
            const d = TOKEN_BY_ID[t];
            return `<span class="chip" style="--c:${hex(d.color)}"><i></i>${esc(d.name)} <b>${num(Number(n))}</b></span>`;
          })
          .join(``)
      : `<span class="soft">Empty. Save what you mined, or buy from a merchant.</span>`;
    const coinHome =
      this.host.state && this.bal(COIN) > 0
        ? `<button class="mkt-link" data-act="home" data-token="${COIN}" title="Burn market coins and add them to your purse">take coins home</button>`
        : ``;

    let saveRow = ``;
    const s = this.host.state;
    if (s) {
      const local = [...localMaterials(s)];
      const wait = v && v.next_save_ms > Date.now() ? Math.ceil((v.next_save_ms - Date.now()) / 1000) : 0;
      saveRow = local.length
        ? `<div class="row"><span>Not saved on chain yet: ${local.map(([t, n]) => `${num(n)} ${esc(tokenName(t))}`).join(`, `)}</span>
            <button class="mkt-btn primary" data-act="save" ${this.busy || wait ? `disabled` : ``}>${wait ? `Save again in ${wait} s` : `Save now`}</button></div>`
        : `<div class="row soft">Everything you mined is saved on chain. Each finished trip is saved by itself.</div>`;
    }
    const recipes = RECIPES.map((r) => {
      const [[inT, inN]] = r.inputs;
      const [[outT, outN]] = r.outputs;
      const can = this.bal(inT) >= inN && this.bal(COIN) >= r.fee;
      return `<button class="mkt-btn small" data-act="craft" data-recipe="${r.id}" ${can && !this.busy ? `` : `disabled`}
        title="${esc(r.name)}: burns ${inN} ${esc(tokenName(inT))} and ${r.fee} coins">${inN} ${esc(tokenName(inT))} → ${outN} ${esc(tokenName(outT))}</button>`;
    }).join(``);
    return `<section class="mkt-card mkt-vault">
      <h3>Your vault <small>NEP-245 balances in ${esc(session.deploy.contract)}</small></h3>
      <div class="chips">${chips} ${coinHome}</div>
      ${saveRow}
      <div class="row"><span>Refinery:</span>${recipes}</div>
    </section>`;
  }

  shopsHTML(): string {
    const b = this.board;
    if (!b) return `<section class="mkt-card soft">Reading the market…</section>`;
    return `<section class="mkt-shops">${MERCHANTS.map((m) => {
      const s = b.merchants.find((x) => x.account_id === session.deploy.merchants[m.id]);
      return s ? this.shopHTML(m, s, b) : ``;
    }).join(``)}</section>`;
  }

  shopHTML(m: MerchantRules, s: MerchantState, b: Board): string {
    const cash = Number(s.coins);
    const owed = s.loans.reduce((a, l) => a + Number(l.owed), 0);
    const p = this.player;
    const rows = Object.keys(m.target)
      .map((t) => {
        const d = TOKEN_BY_ID[t];
        const pr = price(m, t, snapshot(b, s, t));
        const key = `${m.id}:${t}`;
        const amt = this.amounts.get(key) ?? (d.tier >= 4 ? 1 : 10);
        const stock = Number(s.stock.find(([x]) => x === t)?.[1] ?? 0);
        const off = s.closed || !p || this.busy;
        return `<tr>
          <td class="nm"><span class="chip" style="--c:${hex(d.color)}"><i></i>${esc(d.name)}</span>${p ? `<small>you ${num(this.bal(t))}</small>` : ``}</td>
          <td class="px" data-why="${key}">${num(pr.bid)}${COINI}</td>
          <td class="px" data-why="${key}">${num(pr.ask)}${COINI}<small>${num(stock)} left</small></td>
          <td class="go">${p ? `<input type="number" min="1" max="1000" value="${amt}" data-amt="${key}" />
            <button class="mkt-btn small" data-act="trade" data-side="sell" data-key="${key}" ${off || this.bal(t) < 1 ? `disabled` : ``}>Sell</button>
            <button class="mkt-btn small" data-act="trade" data-side="buy" data-key="${key}" ${off || stock < 1 ? `disabled` : ``}>Buy</button>` : ``}</td>
        </tr>`;
      })
      .join(``);
    const closed = s.closed
      ? `<div class="closed"><b>CLOSED</b>: ${esc(m.name)} is broke. ${num(cash)} of the ${num(m.reopen)} coins needed to open.
          ${p ? `<span class="row"><input type="number" min="1" value="${this.amounts.get(`inv:${m.id}`) ?? Math.max(1, m.reopen - cash)}" data-amt="inv:${m.id}" />
          <button class="mkt-btn small primary" data-act="invest" data-m="${m.id}" ${this.busy ? `disabled` : ``}>Invest</button></span>
          <small>You get back 125% from its later sales.</small>` : ``}</div>`
      : ``;
    return `<article class="mkt-shop ${s.closed ? `is-closed` : ``}">
      <header><h4>${esc(m.name)} <span>the ${esc(m.title)}</span></h4>
        <span class="cash" title="Starting capital ${num(m.capital)}">${num(cash)}${COINI}</span></header>
      <p class="blurb">${esc(m.blurb)}${owed ? ` <small>Owes investors ${num(owed)}.</small>` : ``}</p>
      ${closed}
      <table><thead><tr><th></th><th title="What the merchant pays you">Pays</th><th title="What the merchant asks">Sells</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </article>`;
  }

  // ---- events ----

  onHover(e: Event): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(`[data-why]`);
    if (!cell || !this.board) return;
    const [id, token] = cell.dataset.why!.split(`:`);
    const m = MERCHANTS.find((x) => x.id === id)!;
    const s = this.board.merchants.find((x) => x.account_id === session.deploy.merchants[id]);
    if (!s) return;
    const snap = snapshot(this.board, s, token);
    const lines = explain(m, token, snap, price(m, token, snap));
    this.tip.innerHTML = `<b>${esc(m.name)} thinks:</b><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join(``)}</ul>`;
    const r = cell.getBoundingClientRect();
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    this.tip.style.top = `${r.bottom + 8 + this.tip.offsetHeight > innerHeight ? r.top - this.tip.offsetHeight - 8 : r.bottom + 8}px`;
  }

  onClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>(`[data-act]`);
    if (!b || this.busy) return;
    const act = b.dataset.act!;
    const p = this.player;
    if (act === `signout`) {
      session.signOut();
      this.say(`Signed out. Your account stays on chain.`);
      return;
    }
    if (runSignIn(act, () => void this.refresh(), (m) => this.say(m, `err`))) return;
    if (!p) return;
    if (act === `pack`) void this.act(`Buying 300 gas-free actions`, async () => void (await p.buyActions()));
    else if (act === `save`) void this.save(p);
    else if (act === `home`) void this.takeHome(p, b.dataset.token!);
    else if (act === `craft`) {
      const r = RECIPES.find((x) => x.id === b.dataset.recipe)!;
      void this.act(r.name, async () => {
        await p.craft(r.id, 1);
        return `${r.name}: done. The burned ore counts in every merchant's WORLD factor.`;
      });
    } else if (act === `trade`) void this.trade(p, b.dataset.key!, b.dataset.side as Side);
    else if (act === `invest`) {
      const id = b.dataset.m!;
      const amt = this.amounts.get(`inv:${id}`) ?? Number(this.body.querySelector<HTMLInputElement>(`[data-amt="inv:${id}"]`)?.value ?? 0);
      void this.act(`Investing ${amt} coins`, async () => {
        await p.invest(session.deploy.merchants[id], amt);
        return `Invested ${num(amt)} in ${MERCHANTS.find((m) => m.id === id)!.name}.`;
      });
    }
  }

  async trade(p: Player, key: string, side: Side): Promise<void> {
    const [id, token] = key.split(`:`);
    const input = this.body.querySelector<HTMLInputElement>(`[data-amt="${key}"]`);
    const want = Math.max(1, Math.floor(Number(input?.value ?? 1) || 1));
    const m = MERCHANTS.find((x) => x.id === id)!;
    const before = this.msg;
    await this.act(`Asking ${m.name}`, async () => {
      const q = await p.quote(id, token, side, side === `sell` ? Math.min(want, this.bal(token)) : want);
      await p.trade(q);
      const n = Number(q.quote.amount);
      const short = n < want ? ` (${m.name} took only ${n}: ${side === `sell` ? `cash` : `stock`} limit)` : ``;
      return `${side === `sell` ? `Sold` : `Bought`} ${num(n)} ${tokenName(token)} ${side === `sell` ? `to` : `from`} ${m.name} for ${num(Number(q.quote.coins))} coins${short}.`;
    });
    // The merchant's voice (NEAR AI, minear-r3f/server/src/talk.ts): one line after the result or the
    // refusal. It never changes the price; the trade is already done. Shown only if nothing new happened.
    // A merchant's refusal always names the merchant (pricing.ts); other errors (network, keys) are
    // not the merchant's business and are never sent to the LLM.
    const said = this.msg;
    if (!said || said === before || said.kind === `info`) return;
    if (said.kind === `err` && !said.text.includes(m.name)) return;
    const line = await p.talk(id, token as TokenId, side, said.text);
    if (line && this.msg === said) this.say(`${said.text} ${m.name}: “${line}”`, said.kind);
  }

  async save(_p: Player): Promise<void> {
    await this.act(`Saving`, () => saveItems(this.host));
  }

  async takeHome(p: Player, token: TokenId): Promise<void> {
    const s = this.host.state!;
    const n = this.bal(token);
    // coins only: materials stay on chain (a trip's materials are saved there; nothing goes back to the save)
    if (n < 1 || token !== COIN) return;
    await this.act(`Taking ${tokenName(token)} home`, async () => {
      await p.burn([[token, n]], `take-home`);
      s.coins += n;
      s.save();
      this.host.onLocalChange?.();
      return `${num(n)} ${tokenName(token)} burned on chain and added to your save.`;
    });
  }
}

let panel: MarketPanel | null = null;

/** Opens the Market Town panel. */
export function openMarket(host: MarketHost = {}): void {
  panel ??= new MarketPanel();
  panel.open(host);
}

export function marketOpen(): boolean {
  return !!panel?.isOpen;
}

/** Best price per item across the open merchants (the lobby's Market tab). */
export function bestPrices(
  b: Board,
): { token: TokenId; bid: number; bidBy: string; ask: number; askBy: string; impact: number }[] {
  return TOKENS.map((t) => {
    let bid = 0;
    let bidBy = `—`;
    let ask = Infinity;
    let askBy = `—`;
    let impact = 0;
    for (const m of MERCHANTS) {
      if (!(t.id in m.target)) continue;
      const s = b.merchants.find((x) => x.account_id === session.deploy.merchants[m.id]);
      if (!s || s.closed) continue;
      const snap = snapshot(b, s, t.id);
      const p = price(m, t.id, snap);
      if (p.bid > bid) [bid, bidBy, impact] = [p.bid, m.name, impact24(m, t.id, snap)];
      if (p.ask < ask) [ask, askBy] = [p.ask, m.name];
    }
    return { token: t.id, bid, bidBy, ask: Number.isFinite(ask) ? ask : 0, askBy, impact };
  });
}
