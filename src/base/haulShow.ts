// MINEAR: the mining-trip summary (folder: minear-r3f/src/base; styles in minear-r3f/src/base/base.css, `.hs-` rules).
// After "Finish mining trip" teleports the miner to the lift, this full-screen overlay shows the trip in the way of
// the theras-rpg-template "Dig over!" screen, drawn in MINEAR's own cream/ink look:
//   - the depth rolls up, with "New record" or the old record under it, and a depth bar of the rock layers with
//     this trip's depth and the record marked on it;
//   - one tile per material collected (icon and count, no name) pops in every 0.12 s while its icon flies in from
//     the miner; the best find gets rays and a stamp. A trip gives materials only: no gear, no coins;
//   - the rows: damage dealt this trip (with "New record"), the next goal (the current request) and the missions
//     (requests done this trip, or how far the Requests Board is);
//   - the save row (MINEAR rule, user 2026-11-14): a signed-in trip is saved on chain at once when it ends
//     (minear-r3f/src/economy/vault.ts saveAll); the row shows saving, saved, or why it waits (hourly cap, cooldown,
//     no gas-free actions left) with Save now. A demo trip is not kept: the row says so and offers sign-in
//     (minear-r3f/src/menus/signIn.ts), or in the dev-local Demo cheat the local testnet account;
//   - two buttons: "Upgrade at base" (the miner is already on the base) and "Continue mining" (teleport down to
//     the land beside the lift).
// A click skips to the end. While it is up the 3D view is frozen behind it (a panel) and the base around the lift
// loads in. The buttons show when the base is ready (or after a few seconds).
import { ITEMS, RARITY_COLORS, type ItemDef } from '../world/items';
import { MATERIALS } from '../world/materials';
import { DEPTH_LAYERS, depthToBar } from '../ui/depthBar';
import { gearIcons } from '../menus/gearIcons';
import type { GoalReward } from '../state/goals';
import { rewardHTML } from '../ui/goalReward';
import type { Haul } from './backToBase';
import type { PlayerState } from '../state/playerState';
import { savedText, unsavedCount, vault, type SaveReport } from '../economy/vault';
import { CHEAT } from '../game/entry';
import { session } from '../near/session';
import { openSignIn } from '../menus/signIn';

const ITEM = ITEMS as Record<string, ItemDef>;
const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;
const pct = (k: number) => `${(Math.max(0, Math.min(1, k)) * 100).toFixed(2)}%`;
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Timing (seconds), from the theras-rpg-template result screen. */
const T_DEPTH = 0.35;
const DEPTH_ROLL = 0.7;
const T_TILES = 1.25;
const TILE_GAP = 0.12;
const FLY = 0.35;
const COUNT = 0.45;
/** Each row slides in this long after the one before it. */
const ROW_GAP = 0.22;
/** The longest the base may take to load before the buttons show anyway. */
const READY_WAIT = 6;

/** The current request, as the summary shows it. */
export interface GoalView {
  text: string;
  /** "12 / 50", "Reach 50 m" or empty. */
  progress: string;
  /** 0 to 1 for the bar; -1 for no bar. */
  k: number;
  reward: GoalReward;
}

/** How far the Requests Board is. */
export interface BoardView {
  done: number;
  total: number;
}

/** Where the miner goes when the summary closes. */
export type TripNext = `base` | `mine`;

export interface HaulShowHost {
  audio: {
    pickup(): void;
    gem(rarity: number): void;
    coin(i: number): void;
    deposit(value: number): void;
    click(): void;
    levelUp?(): void;
  };
  /** True when the land around the lift is loaded and meshed. */
  baseReady(): boolean;
  /** The current request, or null when every request is done. */
  nextGoal(): GoalView | null;
  /** The Requests Board count. */
  board(): BoardView;
  /** The overlay closed: `base` stays on the base, `mine` teleports down to the land. */
  onClose(next: TripNext): void;
  /** The save game (what a save sends on chain). */
  claimState?(): PlayerState;
  /** Called after Save now changed the save (refresh the HUD and the cart). */
  onClaimed?(): void;
}

interface Tile {
  key: string;
  n: number;
  icon: string;
  color: string;
  name: string;
  rarity: number;
}

export interface HaulShowOptions {
  /** Why the trip ended (shown under the title), e.g. the claws wore out. */
  why?: string;
}

export class HaulShow {
  el: HTMLElement;
  private card: HTMLElement;
  private tilesEl: HTMLElement;
  private flyEl: HTMLElement;
  private loadEl: HTMLElement;
  private depthEl: HTMLElement;
  private recEl: HTMLElement;
  private youEl: HTMLElement;
  private bestEl: HTMLElement;
  private bonusEl: HTMLElement;
  private dmgEl: HTMLElement;
  private rows: HTMLElement[];
  private raf = 0;
  private t0 = 0;
  private haul: Haul | null = null;
  private tiles: Tile[] = [];
  private placed: HTMLElement[] = [];
  private landed: boolean[] = [];
  private flying: { el: HTMLElement; from: [number, number]; to: HTMLElement; at: number; i: number }[] = [];
  private done = false;
  private skipped = false;
  private ready = false;
  private depthShown = -1;
  private dmgShown = -1;
  private recShown = false;
  private bonusShown = false;
  private rowsShown = 0;
  private lastTick = -1;
  private claimEl!: HTMLElement;
  /** The save row's error line (the Demo cheat's local account). */
  private claimMsg: { text: string; err: boolean } | null = null;
  private claiming = false;
  /** vault.last when this summary opened: until a newer report comes, the trip's save is on its way. */
  private lastAtShow: SaveReport | null = null;

  constructor(private host: HaulShowHost) {
    this.el = document.createElement(`div`);
    this.el.id = `haulshow`;
    this.el.className = `hs hidden`;
    const segs = DEPTH_LAYERS.map((l) => `<b style="--c:${hex(MATERIALS[l.mat].color)}" title="${l.name}"></b>`).join(``);
    this.el.innerHTML = `<div class="hs-bg"></div><div class="hs-flash"></div>
      <div class="hs-card" role="dialog" aria-label="Mining trip summary">
        <header>
          <small>Mining trip</small>
          <h2>Trip finished!</h2>
          <div class="hs-hero"><b class="hs-depth">0 m</b><i class="hs-rec"></i></div>
          <p class="hs-why"></p>
        </header>
        <div class="hs-bar" aria-hidden="true">
          <div class="hs-track">${segs}<u class="hs-best"></u><em class="hs-you"><i></i></em></div>
          <div class="hs-ends"><span>Surface</span><span>Heartstone</span></div>
        </div>
        <div class="hs-tiles"></div>
        <div class="hs-bonus"></div>
        <div class="hs-rows">
          <div class="hs-row hs-dmgrow"><span class="k">Damage dealt this trip</span><b class="v hs-dmg">0</b></div>
          <div class="hs-row hs-goal"></div>
          <div class="hs-row hs-mission"></div>
        </div>
        <footer>
          <div class="hs-load"><i></i><span>Landing at base…</span></div>
          <div class="hs-btns">
            <div class="hs-claim"></div>
            <button class="hs-go" type="button" data-next="base">Upgrade at base</button>
            <button class="hs-go hs-alt" type="button" data-next="mine">Continue mining</button>
          </div>
        </footer>
      </div>
      <div class="hs-fly"></div>`;
    document.getElementById(`ui`)!.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    this.card = q(`.hs-card`);
    this.tilesEl = q(`.hs-tiles`);
    this.flyEl = q(`.hs-fly`);
    this.loadEl = q(`.hs-load`);
    this.depthEl = q(`.hs-depth`);
    this.recEl = q(`.hs-rec`);
    this.youEl = q(`.hs-you`);
    this.bestEl = q(`.hs-best`);
    this.bonusEl = q(`.hs-bonus`);
    this.dmgEl = q(`.hs-dmg`);
    this.rows = [...this.el.querySelectorAll<HTMLElement>(`.hs-row`)];
    for (const b of this.el.querySelectorAll<HTMLButtonElement>(`.hs-go[data-next]`))
      b.addEventListener(`click`, (e) => {
        e.stopPropagation();
        this.close(b.dataset.next === `mine` ? `mine` : `base`);
      });
    this.claimEl = q(`.hs-claim`);
    this.claimEl.addEventListener(`click`, (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>(`[data-claim]`);
      if (b) this.claimAct(b.dataset.claim!);
    });
    vault.onChange(() => this.open && this.renderClaim());
    // a click anywhere skips the show to its end
    this.el.addEventListener(`mousedown`, (e) => e.stopPropagation());
    this.el.addEventListener(`click`, () => this.skip());
    // keys: Enter, Space, E or Esc skip; when it is done, Enter/Space/E is "Upgrade at base" and C or Esc is
    // "Continue mining"
    window.addEventListener(
      `keydown`,
      (e) => {
        if (!this.open) return;
        const go = e.code === `Enter` || e.code === `Space` || e.code === `KeyE`;
        const mine = e.code === `KeyC` || e.code === `Escape`;
        if (go || mine) {
          e.preventDefault();
          if (this.done && this.ready) this.close(mine ? `mine` : `base`);
          else this.skip();
        }
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  get open(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  show(haul: Haul, opts: HaulShowOptions = {}): void {
    cancelAnimationFrame(this.raf);
    this.haul = haul;
    this.tiles = tilesOf(haul);
    this.placed = [];
    this.landed = this.tiles.map(() => false);
    this.flying = [];
    this.done = false;
    this.skipped = false;
    this.ready = false;
    this.depthShown = -1;
    this.dmgShown = -1;
    this.recShown = false;
    this.bonusShown = false;
    this.rowsShown = 0;
    this.lastTick = -1;
    this.flyEl.innerHTML = ``;
    this.bonusEl.innerHTML = ``;
    this.bonusEl.classList.remove(`in`);
    const why = this.el.querySelector<HTMLElement>(`.hs-why`)!;
    why.textContent = opts.why ?? ``;
    why.hidden = !opts.why;
    this.depthEl.textContent = `0 m`;
    this.recEl.className = `hs-rec`;
    this.recEl.textContent = ``;
    // the depth bar: the old record stays put, this trip's marker rides down with the rolling number
    this.bestEl.style.left = pct(depthToBar(haul.best0));
    this.bestEl.hidden = !(haul.best0 > 4);
    this.youEl.style.left = `0%`;
    // the tile grid: empty slots now, filled as the icons land
    this.tilesEl.innerHTML = this.tiles.length
      ? this.tiles.map(() => `<div class="hs-tile"></div>`).join(``)
      : `<p class="hs-empty">This trip found nothing to bring home.</p>`;
    this.placed = [...this.tilesEl.querySelectorAll<HTMLElement>(`.hs-tile`)];
    // the rows
    this.dmgEl.textContent = `0`;
    this.rows[0].querySelector(`.hs-new`)?.remove();
    this.fillGoal();
    this.fillMission(haul);
    this.claimMsg = null;
    this.lastAtShow = vault.last;
    this.renderClaim();
    for (const r of this.rows) r.classList.remove(`in`);
    this.el.classList.remove(`hidden`, `done`, `ready`, `out`);
    this.card.classList.remove(`in`);
    void this.card.offsetWidth;
    this.card.classList.add(`in`);
    document.body.classList.add(`hs-on`);
    this.t0 = performance.now();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /** The save row. Signed in: the trip's save on chain (started by Finish mining trip, minear-r3f/src/base/backToBase.ts):
   *  saving, saved, or why it waits, with Save now when something is still in this browser. Demo: nothing of the
   *  trip is kept, and sign in (or the Demo cheat's local account) keeps the next trips. Its buttons are clicks only
   *  (Enter stays "Upgrade at base"). */
  private renderClaim(): void {
    const s = this.host.claimState?.();
    if (!s || !this.haul) {
      this.claimEl.innerHTML = ``;
      return;
    }
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const msg = this.claimMsg ? `<p class="hs-cmsg${this.claimMsg.err ? ` err` : ``}">${esc(this.claimMsg.text)}</p>` : ``;
    const busy = this.claiming || vault.busy || vault.saving ? `disabled` : ``;
    const chain = vault.chainName;
    let body: string;
    if (!this.haul.kept) {
      if (vault.signedIn) body = `<p class="hs-cnote">Demo trip: nothing from it was kept. From now on, what you mine is saved on ${chain}.</p>`;
      else
        body = CHEAT
          ? `<p class="hs-cnote">Nothing from this trip is kept: there is no local testnet account.</p>
             <button class="hs-go hs-claimgo" type="button" data-claim="cheat" ${busy}>Make my local testnet account</button>`
          : `<p class="hs-cnote">Demo: nothing from this trip is kept, so it cannot be used at the Forge. Sign in with NEAR to keep what you mine.</p>
             <button class="hs-go hs-claimgo google" type="button" data-claim="signin">Sign in with Google</button>`;
    } else {
      const r = vault.last;
      const left = unsavedCount(s);
      const retry = left
        ? `<button class="hs-go hs-claimgo" type="button" data-claim="save" ${busy}>${vault.saving ? `Saving…` : `Save now`}</button>`
        : ``;
      if (vault.saving || r === this.lastAtShow)
        body = `<p class="hs-cnote">Saving what you mined on ${chain}…</p>`;
      else if (r?.items.length)
        body = `<p class="hs-cnote ok">Saved on ${chain}: ${esc(savedText(r.items))}.${r.why ? ` ${esc(r.why)}` : ``}</p>${retry}`;
      else if (r?.why)
        body = `<p class="hs-cnote${r.err ? ` err` : ``}">Not saved yet: ${esc(r.why)} It stays in this browser until the next save.</p>${retry}`;
      else body = `<p class="hs-cnote">${left ? `` : `Everything you mined is saved on ${chain}.`}</p>${retry}`;
    }
    this.claimEl.innerHTML = body + msg;
  }

  private claimAct(kind: string): void {
    if (this.claiming) return;
    if (kind === `signin`) {
      // the popup opens inside this click; the row redraws when the session changes
      openSignIn({ start: true, reason: `Sign in with NEAR to keep what you mine.` });
      return;
    }
    const s = this.host.claimState?.();
    if (!s) return;
    this.claiming = true;
    this.claimMsg = null;
    this.renderClaim();
    const run =
      kind === `cheat`
        ? session.cheatAccount().then(() => null)
        : vault.saveAll(s).then((r) => {
            this.host.onClaimed?.();
            if (r.items.length) this.host.audio.deposit(40);
            return null;
          });
    run
      .catch((e) => (this.claimMsg = { text: e instanceof Error ? e.message : String(e), err: true }))
      .finally(() => {
        this.claiming = false;
        this.renderClaim();
      });
  }

  /** Jumps to the end: every tile shown with its full count. */
  skip(): void {
    if (this.done) return;
    this.skipped = true;
  }

  close(next: TripNext = `base`): void {
    if (!this.open) return;
    cancelAnimationFrame(this.raf);
    this.host.audio.click();
    this.el.classList.add(`out`);
    document.body.classList.remove(`hs-on`);
    setTimeout(() => {
      this.el.classList.add(`hidden`);
      this.el.classList.remove(`out`);
    }, 220);
    this.host.onClose(next);
  }

  /** "Next goal": the current request with its progress and reward. */
  private fillGoal(): void {
    const g = this.host.nextGoal();
    this.rows[1].innerHTML = g
      ? `<span class="k">Next goal</span>
         <p class="t">${esc(g.text)}</p>
         <span class="v">${esc(g.progress)}</span>
         ${g.k >= 0 ? `<span class="hs-gbar"><i style="width:${pct(g.k)}"></i></span>` : ``}
         <span class="rw">${rewardHTML(g.reward)}</span>`
      : `<span class="k">Next goal</span><p class="t">Every request is done. New jobs come with the next update.</p>`;
  }

  /** "Missions": requests done on this trip, or how far the Requests Board is. */
  private fillMission(h: Haul): void {
    const b = this.host.board();
    const done = h.goalsDone;
    this.rows[2].innerHTML =
      done > 0
        ? `<span class="k">Missions</span>
           <p class="t"><b class="ok">Mission complete!</b> ${done} request${done > 1 ? `s` : ``} done this trip. The rewards are already paid out.</p>
           <span class="v">${b.done} / ${b.total}</span>`
        : `<span class="k">Missions</span>
           <p class="t">Requests Board: ${b.done} of ${b.total} done. See the board at base for what is next.</p>
           <span class="v">${b.done} / ${b.total}</span>`;
    this.rows[2].classList.toggle(`good`, done > 0);
  }

  private tick(): void {
    if (!this.open || !this.haul) return;
    const haul = this.haul;
    const t = this.skipped ? 1e3 : (performance.now() - this.t0) / 1000;

    // the depth rolls up; the bar marker rides with it
    const deep = Math.round(haul.deep * easeOut((t - T_DEPTH) / DEPTH_ROLL));
    if (deep !== this.depthShown) {
      this.depthShown = deep;
      this.depthEl.textContent = `${deep.toLocaleString()} m`;
      this.youEl.style.left = pct(depthToBar(deep));
      const step = Math.floor(deep / 25);
      if (!this.skipped && t > T_DEPTH && step !== this.lastTick) {
        this.lastTick = step;
        this.host.audio.coin(step);
      }
    }
    // then the record line: "New record!" stamp, or the record to beat
    if (!this.recShown && t >= T_DEPTH + DEPTH_ROLL) {
      this.recShown = true;
      const fresh = haul.deep > haul.best0 && haul.deep > 4;
      this.recEl.textContent = fresh ? `New record!` : haul.best0 > 0 ? `Record ${haul.best0.toLocaleString()} m` : ``;
      this.recEl.classList.add(fresh ? `new` : `old`, `in`);
      if (fresh && !this.skipped) this.host.audio.levelUp?.();
    }

    // tiles: an icon flies in from the miner (bottom middle) to its slot, then the tile pops and counts up
    const n = this.tiles.length;
    for (let i = 0; i < n; i++) {
      const start = T_TILES + i * TILE_GAP;
      const slot = this.placed[i];
      if (t < start || !slot) continue;
      if (!slot.dataset.on) {
        slot.dataset.on = `1`;
        const tile = this.tiles[i];
        slot.title = tile.name;
        slot.innerHTML = `<span class="ic">${tile.icon}</span><b class="n">0</b>`;
        slot.style.setProperty(`--c`, tile.color);
        if (this.skipped) this.land(i, true);
        else {
          const fly = document.createElement(`div`);
          fly.className = `hs-flyer`;
          fly.innerHTML = tile.icon;
          fly.style.setProperty(`--c`, tile.color);
          this.flyEl.appendChild(fly);
          this.flying.push({ el: fly, from: [innerWidth / 2, innerHeight * 0.86], to: slot, at: start, i });
        }
      }
      if (this.landed[i]) {
        const k = this.skipped ? 1 : (t - (start + FLY)) / COUNT;
        const v = Math.round(this.tiles[i].n * Math.min(1, Math.max(0, k)));
        const nEl = slot.querySelector<HTMLElement>(`.n`);
        const txt = `×${v.toLocaleString()}`;
        if (nEl && nEl.textContent !== txt) nEl.textContent = txt;
      }
    }
    for (const f of this.flying) {
      const u = (t - f.at) / FLY;
      if (u >= 1 || this.skipped) {
        f.el.remove();
        if (!this.landed[f.i]) this.land(f.i, false);
        continue;
      }
      const r = f.to.getBoundingClientRect();
      const x1 = r.left + r.width / 2;
      const y1 = r.top + r.height / 2 - 6;
      const e = easeOut(u);
      const x = f.from[0] + (x1 - f.from[0]) * e;
      const y = f.from[1] + (y1 - f.from[1]) * e - 120 * Math.sin(Math.PI * u);
      const s = 0.4 + 0.6 * e;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    }
    this.flying = this.flying.filter((f) => f.el.isConnected);

    // the Capsule Coin bonus stamp, then the rows one by one (damage counts up)
    const tEnd = T_TILES + (n ? (n - 1) * TILE_GAP + FLY + COUNT : 0.2);
    if (haul.capsules > 0 && !this.bonusShown && t > tEnd + 0.1) {
      this.bonusShown = true;
      this.bonusEl.innerHTML = `<b>+${haul.capsules}</b> Capsule Coin${haul.capsules > 1 ? `s` : ``}<small>for reaching ${haul.deep.toLocaleString()} m</small>`;
      this.bonusEl.classList.add(`in`);
      if (!this.skipped) this.host.audio.deposit(haul.capsules * 300);
    }
    const tRows = tEnd + (haul.capsules > 0 ? 0.5 : 0.15);
    while (this.rowsShown < this.rows.length && t >= tRows + this.rowsShown * ROW_GAP) {
      this.rows[this.rowsShown].classList.add(`in`);
      if (!this.skipped) this.host.audio.pickup();
      this.rowsShown++;
    }
    const dmg = Math.round(haul.dmg * easeOut((t - tRows) / 0.6));
    if (dmg !== this.dmgShown) {
      this.dmgShown = dmg;
      this.dmgEl.textContent = dmg.toLocaleString();
    }
    const tDmgDone = tRows + 0.6;
    if (t >= tDmgDone && haul.dmg > haul.dmgBest0 && haul.dmg > 0 && !this.rows[0].querySelector(`.hs-new`)) {
      this.rows[0].insertAdjacentHTML(`beforeend`, `<i class="hs-new">New record!</i>`);
      if (!this.skipped) this.host.audio.levelUp?.();
    }

    // done, and the base is loaded: the buttons
    const end = Math.max(tDmgDone, tRows + this.rows.length * ROW_GAP) + 0.15;
    if (!this.done && t >= end) {
      this.done = true;
      this.el.classList.add(`done`);
    }
    const ready = this.ready || this.host.baseReady() || (performance.now() - this.t0) / 1000 > READY_WAIT;
    if (ready && !this.ready) {
      this.ready = true;
      this.el.classList.add(`ready`);
      this.loadEl.hidden = true;
    }
    if (this.done && this.ready && this.flying.length === 0) return; // the screen is still: stop the frame loop
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /** An icon reached its slot: the tile pops in, rings, and plays its note. */
  private land(i: number, quiet: boolean): void {
    this.landed[i] = true;
    const slot = this.placed[i];
    const tile = this.tiles[i];
    slot.classList.add(`in`);
    if (i === 0 && this.tiles.length > 1 && tile.rarity > 0) {
      slot.classList.add(`best`);
      slot.insertAdjacentHTML(`beforeend`, `<i class="rays"></i><i class="stamp">BEST</i>`);
    }
    if (quiet) return;
    if (tile.rarity >= 2) this.host.audio.gem(tile.rarity);
    else this.host.audio.pickup();
  }
}

/** The tiles of a haul: the best find first, then gems, ore, other finds (materials only). */
function tilesOf(h: Haul): Tile[] {
  const item = (id: string, n: number): Tile => {
    const it = ITEM[id];
    return {
      key: id,
      n,
      icon: gearIcons.lootHtml(id),
      color: it ? (it.kind === `gem` ? (RARITY_COLORS[it.rarity] ?? hex(it.color)) : hex(it.color)) : `#e8dcc4`,
      name: it?.name ?? id,
      rarity: RARITY_RANK[it?.rarity ?? `common`] ?? 0,
    };
  };
  const out: Tile[] = [...h.gems.map(([id, n]) => item(id, n)), ...h.ores.map(([id, n]) => item(id, n)), ...h.other.map(([id, n]) => item(id, n))];
  // the best single find leads (it gets the rays); the rest keep their order
  let best = -1;
  let bestRank = -1;
  out.forEach((t, i) => {
    const rank = t.rarity * 1e6 + (ITEM[t.key]?.value ?? 0);
    if (rank > bestRank) [best, bestRank] = [i, rank];
  });
  if (best > 0) out.unshift(out.splice(best, 1)[0]);
  return out.slice(0, 24);
}
