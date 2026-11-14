// Port of play-inUT-NSi.js 59333-59931: the Wellspring screen pN (#shatter in index.html), and KR's Wellspring
// glue: the constructor call with its hooks (70635-70645).
// The player sends every carried gem into the Wellspring. Each gem type rises, charges and shatters with sound
// and canvas FX; the XP bar fills step by step with level-ups; then for each banked level three cards are dealt
// and flipped one by one (epic and legendary tease and stamp), and the player picks one, skips it for coins,
// rerolls with a die, or banishes a card with Dead Dust (click twice to confirm).
// Keys (its own window keydown): Space / Enter send, 1-3 pick, B banish mode, R reroll, X skip, Esc / E leave
// banish mode. E / Escape close the screen through KR.handleKeys (src/menus/panels.ts handlePanelKeys) unless
// `locked`.
//
// How it plugs in (KR constructor 70635): game.shatter = makeWellspring(game). src/menus/panels.ts then opens it
// with openShatter (show(state)) and closes it with closeShatter (hide()); it reads open and locked. The
// economy hooks are src/menus/economy.ts onSent / onShattered / onPicked. KR's other Wellspring parts already
// live in src/menus/panels.ts: openShatter / closeShatter (72303-72313), anyPanel (71300), the touch no-snapshot
// rule in presentFrame (71565) and the panel keys (72179-72181).
// No per-frame calls: the FX canvas (fx.ts) and the gem viewer (gemViewer.ts) run their own
// requestAnimationFrame loops while the screen is open.
import type * as THREE from 'three';
import { IS_TOUCH } from '../../game/device';
import { STATS, displayRound, statLabel, type StatOffer } from '../../state/gearStats';
import { RARITY_WEIGHTS, TIER_COLORS, TIER_NAMES, expToNext, gemExp, rarerGem, rarityOdds } from '../../state/progression';
import type { PlayerState } from '../../state/playerState';
import { ITEMS, type ItemDef } from '../../world/items';
import type { Audio } from '../../audio/audio';
import type { Hud } from '../../ui/hud';
import type { GemField } from '../../gems/gemField';
import { gearIcons } from '../gearIcons';
import { closeShatter, type PanelHost, type ShatterPanel } from '../panels';
import { onPicked, onSent, onShattered, type EconomyHost } from '../economy';
import { STAT_ICONS } from './statInfo';
import { cardFace, gemArtUrl, preloadCardArt } from './cardFace';
import { GemViewer } from './gemViewer';
import { SKULL_SVG, WellFx, escapeText, hexColor, isLite, q, sleep } from './fx';

const J = IS_TOUCH; // J
const K = ITEMS as Record<string, ItemDef>; // K
const Sk = STATS; // Sk
const yk = TIER_COLORS; // yk
const uN = SKULL_SVG; // uN
const oN = q; // oN
const cN = sleep; // cN
const sN = hexColor; // sN

/** The audio methods the Wellspring plays (dM, src/audio/audio.ts). */
export type WellspringAudio = Pick<
  Audio,
  | 'cardHover'
  | 'cardFly'
  | 'cardFlip'
  | 'cardPick'
  | 'crystalCharge'
  | 'crystalShatter'
  | 'levelUp'
  | 'deadDust'
  | 'skipCards'
  | 'diceRoll'
>;

/** What the Wellspring tells the game (KR, 70635-70645). */
export interface WellspringHooks {
  /** A fresh gem object for the 3D viewer (KR: gems.makeMesh). */
  makeGem(id: string): THREE.Object3D;
  close(): void;
  /** Gems sent (sorted, one entry per gem). */
  sent(gems: string[]): void;
  /** A gem shattered (null: the level-up orb). */
  shattered(gem: string | null): void;
  picked(card: StatOffer): void;
  /** The draft was skipped for coins. */
  skipped(coins: number): void;
  rerolled(): void;
}

/** select: gems to send; pour: gems shattering; charge: level-up orb; deal; choose; resolve (pick / skip). */
export type WellspringPhase = 'select' | 'pour' | 'charge' | 'deal' | 'choose' | 'resolve';

export class Wellspring implements ShatterPanel { // pN (59333)
  audio: WellspringAudio;
  hooks: WellspringHooks;
  el = document.getElementById(`shatter`) as HTMLElement;
  open = !1;
  fx: WellFx;
  phase: WellspringPhase = `select`;
  state!: PlayerState;
  stage = oN(this.el, `.stage`);
  cardsEl = oN(this.el, `.cards`);
  crystalEl = oN(this.el, `.crystal`);
  tray = oN(this.el, `.tray`);
  info = oN(this.el, `.cinfo`);
  busy = !1;
  revealed = 0;
  gem3d: GemViewer;
  /** The gem the viewer shows. */
  shown: string | null = null;
  lvlText: HTMLElement | null = null;
  armT = 0;
  banishing = !1;
  unbanishAt = 0;
  // window listeners (kept so dispose() can remove them; the original never removes them)
  private onKey: (e: KeyboardEvent) => void;
  private onResize: () => void;

  constructor(e: WellspringAudio, t: WellspringHooks) {
    this.audio = e;
    this.hooks = t;
    this.gem3d = new GemViewer((e) => this.hooks.makeGem(e));
    this.fx = new WellFx(oN<HTMLCanvasElement>(this.el, `canvas.fxc`), (e, t) => {
      this.stage.style.translate = `${e.toFixed(1)}px ${t.toFixed(1)}px`;
    });
    oN(this.el, `.close`).addEventListener(`click`, () => {
      if (!this.busy) this.hooks.close();
    });
    oN(this.el, `button.all`).addEventListener(`click`, () => this.send());
    oN(this.el, `button.reroll`).addEventListener(`click`, () => this.reroll());
    oN(this.el, `button.banishbtn`).addEventListener(`click`, () => this.setBanishing(!this.banishing));
    oN(this.el, `button.skip`).addEventListener(`click`, () => this.skip());
    oN(this.el, `button.leave`).addEventListener(`click`, () => {
      if (!this.busy) this.hooks.close();
    });
    this.onKey = (e) => {
      if (!this.open || e.repeat) return;
      if (this.phase === `select` && (e.code === `Space` || e.code === `Enter`)) this.send();
      else if (this.phase === `choose`) {
        const t = [`Digit1`, `Digit2`, `Digit3`].indexOf(e.code);
        if (t >= 0) {
          if (this.banishing) this.banishClick(t);
          else this.pick(t);
        } else if (e.code === `KeyB`) this.setBanishing(!this.banishing);
        else if (this.banishing && (e.code === `Escape` || e.code === `KeyE`)) this.setBanishing(!1);
        else if (e.code === `KeyR` && !this.banishing) this.reroll();
        else if (e.code === `KeyX` && !this.banishing) this.skip();
      }
    };
    this.onResize = () => {
      if (this.open) this.fx.resize();
    };
    window.addEventListener(`keydown`, this.onKey);
    window.addEventListener(`resize`, this.onResize);
  }

  /** A shatter is playing out, or banish mode closed less than 300 ms ago (its E / Esc must not close). */
  get locked(): boolean {
    return this.busy || performance.now() - this.unbanishAt < 300;
  }

  show(e: PlayerState): void {
    this.state = e;
    this.open = !0;
    document.documentElement.classList.add(`well`);
    void preloadCardArt();
    this.el.classList.remove(`hidden`);
    this.el.classList.remove(`enter`);
    void this.el.offsetWidth;
    this.el.classList.add(`enter`);
    this.fx.start();
    this.busy = !1;
    this.renderXp();
    this.renderOdds();
    if (e.draft) {
      this.renderTray();
      this.gem3d.stop();
      this.crystalEl.innerHTML = ``;
      this.shown = null;
      this.deal(e.draft.cards, !1);
    } else if (e.levelUps > 0) {
      this.renderTray();
      this.nextLevel();
    } else this.toSelect();
  }

  setPhase(e: WellspringPhase): void {
    this.phase = e;
    this.el.dataset.phase = e;
    if (e !== `choose` && this.banishing) {
      this.banishing = !1;
      this.el.classList.remove(`banishing`);
    }
  }

  setBanishing(e: boolean): void {
    if (!((!e || (this.phase === `choose` && !this.busy && this.state.canBanish)) && e !== this.banishing)) return;
    this.banishing = e;
    if (!e) this.unbanishAt = performance.now();
    this.el.classList.toggle(`banishing`, e);
    this.cardsEl.querySelectorAll(`.banish.armed`).forEach((e) => e.classList.remove(`armed`));
    clearTimeout(this.armT);
    this.audio.cardHover(e ? 3 : 0);
    this.renderButtons();
  }

  /** In banish mode: the first click arms card e's skull for 3 s, the second banishes it. */
  banishClick(e: number): void {
    if (!this.banishing || this.phase !== `choose` || this.busy || !this.state.canBanish) return;
    const t = this.cardsEl.querySelectorAll(`.c3`)[e]?.querySelector(`.banish`);
    if (!t) return;
    if (!t.classList.contains(`armed`)) {
      this.cardsEl.querySelectorAll(`.banish.armed`).forEach((e) => e.classList.remove(`armed`));
      t.classList.add(`armed`);
      this.audio.cardHover(0);
      clearTimeout(this.armT);
      this.armT = window.setTimeout(() => t.classList.remove(`armed`), 3e3);
      return;
    }
    clearTimeout(this.armT);
    this.banishCard(e);
  }

  /** Every held gem, one entry each. */
  allGems(): string[] {
    const e = this.state.gemsHeld(),
      t: string[] = [];
    for (const n in e) for (let r = 0; r < e[n]; r++) t.push(n);
    return t;
  }

  renderXp(e = this.state.level, t = this.state.exp): void {
    const n = expToNext(e);
    oN(this.el, `.xp .lv`).textContent = `Level ${e}`;
    oN(this.el, `.xp .fill`).style.width = `${(100 * Math.min(1, t / n)).toFixed(1)}%`;
    oN(this.el, `.xp .num`).textContent = `${Math.floor(t).toLocaleString()} / ${n.toLocaleString()}`;
  }

  hide(): void {
    this.open = !1;
    document.documentElement.classList.remove(`well`);
    this.el.classList.add(`hidden`);
    this.fx.stop();
    this.gem3d.stop();
    this.shown = null;
    this.cardsEl.innerHTML = ``;
  }

  toSelect(): void {
    this.setPhase(`select`);
    this.cardsEl.innerHTML = ``;
    this.renderTray();
    this.renderGem();
    this.renderOdds();
    this.renderButtons();
  }

  /** The gem badges under the stage, in item order. */
  renderTray(): void {
    const e = this.state.gemsHeld(),
      t = Object.keys(K).filter((e) => K[e].kind === `gem`);
    this.tray.innerHTML = t
      .filter((t) => (e[t] ?? 0) > 0)
      .map((t) => {
        const n = K[t];
        return `<span class="gemb" data-id="${t}" data-n="${e[t]}" style="--c:${sN(n.color)}" title="${n.name} · +${gemExp(t)} xp"><span class="g"><img src="${gemArtUrl(t)}" alt="" draggable="false"></span><b>×${e[t]}</b></span>`;
      })
      .join(``);
  }

  /** The rarest held gem idles in the crystal (empty when none). */
  renderGem(): void {
    const e = this.allGems().reduce<string | null>((e, t) => rarerGem(e, t), null);
    if (!e) {
      this.gem3d.stop();
      this.shown = null;
      this.crystalEl.innerHTML = ``;
      this.crystalEl.className = `crystal empty`;
      return;
    }
    if (!(this.shown === e && this.crystalEl.classList.contains(`idle`))) this.showGem(e, `idle`);
  }

  showGem(e: string, t: string): void {
    this.shown = e;
    this.crystalEl.className = `crystal ${t}`;
    this.crystalEl.style.setProperty(`--c`, sN(K[e].color));
    this.crystalEl.innerHTML = `<div class="glow"></div>`;
    this.crystalEl.appendChild(this.gem3d.el);
    this.gem3d.show(e);
  }

  /** The crystal's screen centre. */
  centre(): { x: number; y: number } {
    const e = this.crystalEl.getBoundingClientRect();
    return { x: e.left + e.width / 2, y: e.top + e.height / 2 };
  }

  /** The card tier odds bar (with the fortune bonus) and the banished skills. */
  renderOdds(): void {
    const e = Math.floor(this.state.fortuneNow),
      t = rarityOdds(e),
      n = (e: number) => {
        const t = e * 100;
        return t >= 9.95 ? String(Math.round(t)) : t.toFixed(1).replace(/\.0$/, ``);
      },
      r = t.map((e, t) => `<i style="flex:${e};background:${yk[t]}"></i>`).join(``),
      i = t
        .map((e, t) => {
          const r = e - RARITY_WEIGHTS[t] / 100;
          return `<em style="color:${yk[t]}">${TIER_NAMES[t]} ${n(e)}%${r >= 5e-4 ? `<small>(+${n(r)}%)</small>` : ``}</em>`;
        })
        .join(``),
      a = this.state.banned,
      o = a.length
        ? `<div class="banned" title="Banished with Dead Dust: they never come up">${uN}${a.map((e) => `<i title="${Sk[e].name}"><svg viewBox="0 0 48 48">${STAT_ICONS[Sk[e].icon] ?? ``}</svg></i>`).join(``)}<small>${a.length}/8</small></div>`
        : ``;
    this.info.innerHTML = `${e >= 1 ? `<span class="ftag"><i></i>Fortune +${e}%</span>` : ``}<div class="odds">${r}</div><div class="names">${i}</div>${o}`;
  }

  renderButtons(): void {
    const e = this.state,
      t = oN<HTMLButtonElement>(this.el, `button.all`),
      n = oN<HTMLButtonElement>(this.el, `button.reroll`),
      r = oN<HTMLButtonElement>(this.el, `button.skip`),
      i = this.phase === `choose`,
      a = this.allGems().length;
    t.style.display = this.phase === `select` || this.phase === `pour` ? `` : `none`;
    t.disabled = this.phase !== `select` || a <= 0;
    t.innerHTML = `Send all${a > 0 ? ` <b>${a}</b>` : ``}`;
    this.el.classList.toggle(`done`, this.phase === `select` && a <= 0);
    n.style.display = r.style.display = i || this.phase === `deal` || this.phase === `resolve` ? `` : `none`;
    n.disabled = !i || e.dice <= 0;
    r.disabled = !i;
    n.innerHTML = `<i class="die sm"></i> Reroll <b>${e.dice}</b>`;
    r.innerHTML = `Skip <span>+${e.skipValue}</span><i class="coin sm"></i>`;
    const o = oN<HTMLButtonElement>(this.el, `button.banishbtn`);
    o.style.display = e.dust > 0 && (i || this.phase === `deal` || this.phase === `resolve`) ? `` : `none`;
    o.disabled = !i || !e.canBanish;
    o.classList.toggle(`on`, this.banishing);
    o.innerHTML = this.banishing ? `${uN} Cancel` : `${uN} Banish <b>${e.dust}</b>`;
    if (this.banishing) n.disabled = r.disabled = !0;
    oN(this.el, `.res .dice b`).textContent = String(e.dice);
    oN(this.el, `.res .coins b`).textContent = e.coins.toLocaleString();
    oN(this.el, `.res .gifts b`).textContent = String(e.level);
    const s = oN(this.el, `.res .dust`);
    s.style.display = e.dust > 0 ? `` : `none`;
    const ic = oN(s, `.ic`);
    if (e.dust > 0 && !ic.innerHTML) ic.innerHTML = gearIcons.lootHtml(`deaddust`); // _M.lootHtml
    oN(s, `b`).textContent = String(e.dust);
    this.el.classList.toggle(`canbanish`, e.canBanish);
  }

  /** Sends every held gem: one shatter per gem type, the XP bar step by step, then the first draft. */
  async send(): Promise<void> {
    if (this.phase !== `select` || this.busy) return;
    const e = this.allGems();
    if (!e.length) return;
    const t = this.state,
      n = t.level,
      r = t.exp,
      i = t.sendGems(e);
    if (!i.sent.length) return;
    this.busy = !0;
    this.setPhase(`pour`);
    this.renderButtons();
    this.hooks.sent(i.sent);
    const a: { id: string; n: number }[] = [];
    for (const e of i.sent) {
      const t = a[a.length - 1];
      if (t?.id === e) t.n++;
      else a.push({ id: e, n: 1 });
    }
    let o = n,
      s = r;
    const c = oN(this.el, `.xp .fill`);
    for (let e = 0; e < a.length; e++) {
      const { id: t, n } = a[e],
        r = e === a.length - 1;
      await this.shatterGem(t, n, r ? 1 : a.length > 3 ? 0.4 : 0.55);
      this.trayTake(t, n);
      let i = n * gemExp(t);
      for (; i > 0; ) {
        const need = expToNext(o),
          step = Math.min(i, need - s);
        c.style.transition = `width 380ms cubic-bezier(.3,.7,.3,1)`;
        s += step;
        i -= step;
        this.renderXp(o, s);
        await cN(380);
        if (s >= need) {
          o++;
          s = 0;
          this.levelUp(o);
          await cN(360);
          c.style.transition = `none`;
          this.renderXp(o, 0);
          void c.offsetWidth;
        }
      }
    }
    c.style.transition = ``;
    this.renderXp();
    this.renderTray();
    this.busy = !1;
    if (t.startDraft()) this.deal(t.draft!.cards, !0);
    else this.toSelect();
  }

  /** Gem e (n of them) rises, charges and shatters; pace t (1 = the last type) sets the timing. */
  async shatterGem(e: string, t: number, n: number): Promise<void> {
    const r = sN(K[e].color),
      i = [`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`].indexOf(K[e].rarity);
    if (this.shown !== e || !this.crystalEl.classList.contains(`idle`)) {
      this.showGem(e, `rise`);
      await cN(Math.round(480 * n));
    }
    const a = 0.25 + 0.8 * n,
      { x: o, y: s } = this.centre();
    this.crystalEl.style.setProperty(`--charge`, `${a}s`);
    this.crystalEl.className = `crystal charging`;
    this.gem3d.charge();
    this.audio.crystalCharge(a * 0.9, i);
    const c = Math.max(3, Math.round(a * 9));
    for (let e = 0; e < c; e++) {
      this.fx.motes(o, s, r, 4 + e * 2);
      await cN((a * 1e3) / c);
    }
    this.crystalEl.className = `crystal burst`;
    this.gem3d.burst();
    this.fx.burst(o, s, r, Math.min(5, i + Math.log2(t + 1) * 0.6));
    this.flash(r, 0.55 + 0.35 * n);
    this.audio.crystalShatter(i);
    this.hooks.shattered(e);
    await cN(260);
    this.gem3d.stop();
    this.shown = null;
    this.crystalEl.innerHTML = ``;
  }

  /** Takes t gems of id e off the tray badge. */
  trayTake(e: string, t: number): void {
    const n = this.tray.querySelector<HTMLElement>(`.gemb[data-id="${e}"]`);
    if (!n) return;
    const r = Math.max(0, Number(n.dataset.n) - t);
    n.dataset.n = String(r);
    oN(n, `b`).textContent = `×${r}`;
    n.classList.remove(`took`);
    void n.offsetWidth;
    n.classList.add(`took`);
    if (r <= 0) n.classList.add(`gone`);
  }

  /** The level-up moment on the XP bar (sound, flash, sparks, LEVEL n text). */
  levelUp(e: number): void {
    this.audio.levelUp();
    this.flash(`#ffe08a`, 0.45);
    const t = oN(this.el, `.xp`).getBoundingClientRect();
    this.fx.pop(t.left + t.width / 2, t.top + t.height / 2, `#ffe08a`, 40, 420);
    this.lvlText?.remove();
    const n = document.createElement(`div`);
    n.className = `gained lvlup`;
    n.innerHTML = `LEVEL ${e}`;
    this.stage.appendChild(n);
    this.lvlText = n;
    setTimeout(() => n.remove(), 1400);
    oN(this.el, `.res .gifts b`).textContent = String(e);
  }

  /** Opens the next banked level: a golden orb charges and bursts, then the cards are dealt. */
  async nextLevel(): Promise<void> {
    if (this.busy || !this.state.startDraft()) {
      this.toSelect();
      return;
    }
    this.busy = !0;
    this.cardsEl.innerHTML = ``;
    this.setPhase(`charge`);
    this.renderButtons();
    const e = `#ffe08a`;
    this.gem3d.stop();
    this.shown = null;
    this.crystalEl.style.setProperty(`--c`, e);
    this.crystalEl.style.setProperty(`--charge`, `0.9s`);
    this.crystalEl.className = `crystal light charging`;
    this.crystalEl.innerHTML = `<div class="glow"></div><div class="orb"></div>`;
    const { x: t, y: n } = this.centre();
    this.audio.crystalCharge(0.8, 2);
    for (let r = 0; r < 9; r++) {
      this.fx.motes(t, n, r % 3 ? e : `#ffffff`, 5 + r * 2);
      await cN(100);
    }
    this.crystalEl.className = `crystal light burst`;
    this.fx.burst(t, n, e, isLite() ? 1.5 : 2.5);
    this.flash(e, 0.7);
    this.audio.crystalShatter(2);
    this.hooks.shattered(null);
    await cN(240);
    this.crystalEl.innerHTML = ``;
    this.deal(this.state.draft!.cards, !0);
  }

  /** Deals cards e face down, flips them one by one, then wires them (t: right after the orb burst). */
  async deal(e: StatOffer[], t: boolean): Promise<void> {
    this.busy = !0;
    this.setPhase(`deal`);
    this.renderButtons();
    this.revealed = 0;
    this.cardsEl.innerHTML = e.map((e, t) => this.cardHtml(e, t)).join(``);
    const n = [...this.cardsEl.querySelectorAll<HTMLElement>(`.c3`)];
    for (const e of n) {
      e.style.setProperty(`--r0`, `${(Math.random() - 0.5) * 540}deg`);
      e.classList.add(`start`);
    }
    void this.cardsEl.offsetWidth;
    n.forEach((e, n) => {
      setTimeout(
        () => {
          e.classList.remove(`start`);
          e.classList.add(`dealt`);
          this.audio.cardFly(n);
        },
        (t ? 60 : 0) + n * 90,
      );
    });
    await cN((t ? 520 : 380) + 180);
    for (let t = 0; t < n.length; t++) {
      await this.reveal(n[t], e[t]);
      await cN(e[t].tier >= 3 ? 520 : 300);
    }
    this.setPhase(`choose`);
    this.busy = !1;
    this.renderButtons();
    n.forEach((e, t) => this.wireCard(e, t));
  }

  /** One card (back, front face, banish button, key number). */
  cardHtml(e: StatOffer, t: number): string {
    return `<div class="c3" data-i="${t}" style="--i:${t};--back:#8ff0ff;--tc:${yk[e.tier]}">
        <div class="lift"><div class="tilt"><div class="flip">
          <div class="back"><span class="ring r1"></span><span class="ring r2"></span><i class="emblem star"><i></i></i><b class="bname">Wellspring</b></div>
          <div class="front">${cardFace(e, this.state.stat(e.id), this.state.statWithGift(e.id, e.value))}</div>
        </div></div>
        <button class="banish" type="button" title="Dead Dust: this skill never comes up again">${uN}<span>Sure?</span></button></div>
        <div class="key">${t + 1}</div>
      </div>`;
  }

  /** Flips card element e (offer t): tease for epic / legendary, sparks, ring, shake, stamp. */
  async reveal(e: HTMLElement, t: StatOffer): Promise<void> {
    if (t.tier >= 3) {
      e.classList.add(`tease`);
      this.audio.cardHover(t.tier);
      await cN(t.tier === 4 ? 520 : 400);
      e.classList.remove(`tease`);
    }
    e.classList.add(`shown`, `t${t.tier}`);
    this.audio.cardFlip(t.tier);
    const n = e.getBoundingClientRect(),
      r = n.left + n.width / 2,
      i = n.top + n.height / 2;
    this.fx.pop(r, i, yk[t.tier], 10 + t.tier * 14, 240 + t.tier * 90);
    if (t.tier >= 3) {
      this.fx.add({ kind: `ring`, x: r, y: i, size: 30, vx: 700 + t.tier * 200, color: yk[t.tier], life: 0.5 });
      this.fx.shake = Math.max(this.fx.shake, t.tier === 4 ? 1.1 : 0.55);
    }
    if (t.tier >= 3) {
      if (t.tier === 4 && !J) this.flash(yk[4], 0.55);
      const n = document.createElement(`div`);
      n.className = `stamp t${t.tier}`;
      n.textContent = t.tier === 4 ? `LEGENDARY!` : `EPIC!`;
      e.appendChild(n);
    }
    this.revealed++;
  }

  /** Card tilt and shine under the pointer, hover sound, click to pick (or banish), the skull button. */
  wireCard(e: HTMLElement, t: number): void {
    const n = oN(e, `.tilt`);
    e.addEventListener(`pointermove`, (t) => {
      if (this.phase !== `choose`) return;
      const r = e.getBoundingClientRect(),
        i = (t.clientX - r.left) / r.width - 0.5,
        a = (t.clientY - r.top) / r.height - 0.5;
      n.style.transform = `rotateY(${(i * 22).toFixed(1)}deg) rotateX(${(-a * 18).toFixed(1)}deg)`;
      e.style.setProperty(`--mx`, `${((i + 0.5) * 100).toFixed(0)}%`);
      e.style.setProperty(`--my`, `${((a + 0.5) * 100).toFixed(0)}%`);
      e.style.setProperty(`--px`, (i * 2).toFixed(3));
      e.style.setProperty(`--py`, (a * 2).toFixed(3));
    });
    e.addEventListener(`pointerenter`, () => {
      if (this.phase === `choose`) this.audio.cardHover(this.state.draft?.cards[t]?.tier ?? 0);
    });
    e.addEventListener(`pointerleave`, () => {
      n.style.transform = ``;
      e.style.setProperty(`--px`, `0`);
      e.style.setProperty(`--py`, `0`);
    });
    e.addEventListener(`click`, () => (this.banishing ? this.banishClick(t) : this.pick(t)));
    oN(e, `.banish`).addEventListener(`click`, (e) => {
      e.stopPropagation();
      this.banishClick(t);
    });
  }

  /** Banishes card e with Dead Dust: it crumbles, and a fresh card is dealt in its place (or the draft redeals). */
  async banishCard(e: number): Promise<void> {
    const t = this.state,
      n = t.draft?.cards[e];
    if (!n || this.phase !== `choose` || this.busy) return;
    const r = t.banish(e);
    if (r === !1) return;
    this.busy = !0;
    this.banishing = !1;
    this.el.classList.remove(`banishing`);
    const i = this.cardsEl.querySelectorAll<HTMLElement>(`.c3`)[e],
      a = i.getBoundingClientRect(),
      o = a.left + a.width / 2,
      s = a.top + a.height / 2;
    this.audio.deadDust();
    this.fx.pop(o, s, `#b9a8d8`, 70, 320);
    this.fx.pop(o, s, `#5a5468`, 40, 180);
    this.flash(`#9a8fb0`, 0.3);
    i.classList.add(`crumble`);
    const c = document.createElement(`div`);
    c.className = `gained banished`;
    c.innerHTML = `${escapeText(Sk[n.id].name)}<small>never again</small>`;
    this.stage.appendChild(c);
    setTimeout(() => c.remove(), 1600);
    this.renderButtons();
    this.renderOdds();
    await cN(720);
    if (!r) {
      this.busy = !1;
      this.deal(t.draft!.cards, !1);
      return;
    }
    const l = document.createElement(`div`);
    l.innerHTML = this.cardHtml(r, e);
    const u = l.firstElementChild as HTMLElement;
    u.style.setProperty(`--r0`, `${(Math.random() - 0.5) * 540}deg`);
    u.classList.add(`start`);
    i.replaceWith(u);
    void u.offsetWidth;
    u.classList.remove(`start`);
    u.classList.add(`dealt`);
    this.audio.cardFly(e);
    await cN(560);
    await this.reveal(u, r);
    this.wireCard(u, e);
    this.busy = !1;
    this.renderButtons();
  }

  /** Picks card e: the others fall away, the gain floats up, then the next level or the gem screen. */
  async pick(e: number): Promise<void> {
    if (this.phase !== `choose` || this.busy) return;
    const t = this.state.draft?.cards?.[e];
    if (!t) return;
    this.busy = !0;
    this.phase = `resolve`;
    this.el.dataset.phase = `resolve`;
    this.renderButtons();
    const n = [...this.cardsEl.querySelectorAll<HTMLElement>(`.c3`)];
    n.forEach((t, n) => t.classList.add(n === e ? `chosen` : `gone`));
    const r = this.state.stat(t.id),
      i = this.state.pick(e),
      a = displayRound(this.state.stat(t.id) - r);
    this.audio.cardPick(t.tier);
    const o = n[e].getBoundingClientRect();
    this.fx.pop(o.left + o.width / 2, o.top + o.height / 2, yk[t.tier], 50 + t.tier * 20, 520);
    this.fx.add({
      kind: `ring`,
      x: o.left + o.width / 2,
      y: o.top + o.height / 2,
      size: 40,
      vx: 1100,
      color: yk[t.tier],
      life: 0.6,
    });
    if (!J) this.flash(yk[t.tier], 0.35);
    this.hooks.picked(i!);
    await cN(850);
    n[e].classList.add(`absorb`);
    const s = document.createElement(`div`);
    s.className = `gained`;
    s.style.color = yk[t.tier];
    s.innerHTML = `${statLabel(t.id, Sk[t.id].cap <= 2 ? t.value : a)}<small>Level ${this.state.level}</small>`;
    this.stage.appendChild(s);
    setTimeout(() => s.remove(), 1600);
    await cN(560);
    this.busy = !1;
    await this.afterGift();
  }

  async afterGift(): Promise<void> {
    this.renderXp();
    if (this.state.levelUps > 0) {
      await cN(250);
      await this.nextLevel();
      return;
    }
    this.toSelect();
  }

  /** Skips the draft for coins (state.skipValue). */
  async skip(): Promise<void> {
    if (this.phase !== `choose` || this.busy) return;
    this.busy = !0;
    this.phase = `resolve`;
    this.el.dataset.phase = `resolve`;
    const e = this.state.skip();
    this.audio.skipCards();
    this.cardsEl.querySelectorAll(`.c3`).forEach((e) => e.classList.add(`crumble`));
    this.hooks.skipped(e);
    const t = document.createElement(`div`);
    t.className = `gained coins`;
    t.textContent = `+${e} coins`;
    this.stage.appendChild(t);
    setTimeout(() => t.remove(), 1500);
    await cN(700);
    this.busy = !1;
    await this.afterGift();
  }

  /** Spends a die: a die tumbles, the cards gather, and a fresh draft is dealt. */
  async reroll(): Promise<void> {
    if (this.phase !== `choose` || this.busy || this.state.dice <= 0 || !this.state.reroll()) return;
    this.busy = !0;
    this.phase = `deal`;
    this.el.dataset.phase = `deal`;
    this.renderButtons();
    this.hooks.rerolled();
    this.audio.diceRoll();
    const e = document.createElement(`div`);
    e.className = `dieroll`;
    e.innerHTML = `<div class="cube">${[1, 2, 3, 4, 5, 6].map((e) => `<i class="f${e}">${`<b></b>`.repeat(e)}</i>`).join(``)}</div>`;
    this.stage.appendChild(e);
    setTimeout(() => e.remove(), 1300);
    this.cardsEl.querySelectorAll(`.c3`).forEach((e) => {
      e.classList.remove(`shown`, `t0`, `t1`, `t2`, `t3`, `t4`);
      e.classList.add(`gather`);
    });
    await cN(620);
    this.deal(this.state.draft!.cards, !1);
  }

  /** A full-screen flash of color e at strength t (x0.7 in lite), 520 ms. */
  flash(e: string, t: number): void {
    const n = oN(this.el, `.flash`);
    n.style.background = `radial-gradient(circle at 50% 45%, #ffffff 0%, ${e} 35%, transparent 75%)`;
    n.animate([{ opacity: isLite() ? t * 0.7 : t }, { opacity: 0 }], {
      duration: 520,
      easing: `ease-out`,
    });
  }

  /**
   * Not in the original (KR never tears the screen down): removes the window listeners and stops both
   * animation loops, for Game.dispose.
   */
  dispose(): void {
    window.removeEventListener(`keydown`, this.onKey);
    window.removeEventListener(`resize`, this.onResize);
    this.fx.stop();
    this.gem3d.stop();
    this.gem3d.renderer?.dispose();
  }
}

/** The game object (KR) as the Wellspring glue reads it: the panel and economy hosts, the gems, coin sound. */
export type WellspringHost = PanelHost &
  EconomyHost & {
    audio: WellspringAudio & Pick<Audio, 'coin'>;
    ui: Pick<Hud, 'bumpCoins'>;
    /** Rb (src/gems/gemField.ts): makeMesh for the 3D viewer. */
    gems: Pick<GemField, 'makeMesh'>;
  };

/**
 * KR constructor 70635-70645: the Wellspring with KR's hooks. Assign the result to game.shatter (PanelHost.shatter).
 * skipped: the coin counter bumps and coin(3) plays; rerolled does nothing.
 */
export function makeWellspring(g: WellspringHost): Wellspring { // KR constructor (70635)
  return new Wellspring(g.audio, {
    close: () => closeShatter(g),
    sent: (e) => onSent(g, e),
    shattered: (e) => onShattered(g, e),
    picked: (e) => onPicked(g, e),
    skipped: () => {
      g.ui.bumpCoins();
      g.audio.coin(3);
    },
    rerolled: () => {},
    makeGem: (e) => g.gems.makeMesh(e),
  });
}
