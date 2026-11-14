// Port of play-inUT-NSi.js 69444-69567: the Mirror of Renown leaderboard ZL (div#leaders in index.html), with
// its value format JL, board table YL and page size XL, and the board list lw (43016).
// The panel makes no request of its own. KR.openLeaders (75301, [npc]) opens it with show(mp.askLeaders()), and
// mp.askLeaders() (EO 49102) is true only when the room is online (it then asks the server, whose answer
// arrives through mp.onLeaders -> set(data), 70793). Solo has no room: askLeaders() is false, so the game calls
// show(false) and the board shows the offline line "The mirror shows the miners of the online world...".
// KR makes it as a field (70136: leadersPanel = new ZL()); its onClose locks the pointer again (70794,
// src/menus/panels.ts wirePanels). E or Escape close it (KR.handleKeys 72205, handlePanelKeys).

/** lw (43016): the boards, in tab order. */
export const BOARDS = [`lvl`, `power`, `foes`, `beasts`, `earned`, `deepest`, `fortune`, `gems`] as const; // lw (43016)
export type BoardId = (typeof BOARDS)[number];

/** JL (69444) */
const formatValue = (e: number): string => e.toLocaleString(`en-US`); // JL (69444)

/** YL (69445): tab name, long name, value format and the note under the tabs. */
export const BOARD_INFO: Record<BoardId, { name: string; long: string; value: (e: number) => string; note?: string }> = { // YL (69445)
  lvl: { name: `Level`, long: `Level`, value: (e) => `Lv ${e}` },
  power: { name: `Power`, long: `Power`, value: formatValue },
  foes: { name: `Foes`, long: `Foes slain`, value: formatValue },
  beasts: {
    name: `Beasts`,
    long: `Beasts slain`,
    value: formatValue,
    note: `the four mythical beasts, and the worm`,
  },
  earned: { name: `Gold`, long: `Gold earned`, value: formatValue },
  deepest: { name: `Depth`, long: `Deepest dive`, value: (e) => `${formatValue(e)} m` },
  fortune: {
    name: `Fortune`,
    long: `Highest Fortune`,
    value: (e) => `+${formatValue(e)}%`,
    note: `the most each miner has built up (cookies don't count)`,
  },
  gems: { name: `Gems`, long: `Gems found`, value: formatValue },
};

/** XL (69465): rows per page. */
export const PAGE_SIZE = 10; // XL (69465)

/** The server's leaderboard answer (EO `leaders` message): [name, value] rows, and your [rank, value] per board. */
export interface LeadersData {
  boards: Record<BoardId, [string, number][]>;
  you: Record<BoardId, [number, number]>;
}

export class Leaderboard { // ZL (69466)
  el = document.getElementById(`leaders`)!;
  tabs = this.el.querySelector<HTMLElement>(`.tabs`)!;
  list = this.el.querySelector<HTMLElement>(`.board`)!;
  note = this.el.querySelector<HTMLElement>(`.note`)!;
  you = this.el.querySelector<HTMLElement>(`.you`)!;
  pager = this.el.querySelector<HTMLElement>(`.pager`)!;
  board: BoardId = `lvl`;
  page = 0;
  data: LeadersData | null = null;
  online = !1;
  onClose: () => void = () => {};

  constructor() {
    for (const e of BOARDS) {
      const t = document.createElement(`button`);
      t.type = `button`;
      t.className = `ghost`;
      t.dataset.board = e;
      t.textContent = BOARD_INFO[e].name;
      t.title = BOARD_INFO[e].long;
      t.addEventListener(`click`, () => {
        ((this.board = e), (this.page = 0), this.render());
      });
      this.tabs.append(t);
    }
    this.el.querySelector(`.close`)!.addEventListener(`click`, () => this.close());
    this.pager.querySelector(`.prev`)!.addEventListener(`click`, () => this.turn(-1));
    this.pager.querySelector(`.next`)!.addEventListener(`click`, () => this.turn(1));
    this.el.addEventListener(`click`, (e) => {
      e.target === this.el && this.close();
    });
  }

  get open(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  /** Opens on the first page; online = the room asked the server (solo: always false). */
  show(e: boolean): void {
    this.online = e;
    this.page = 0;
    this.render();
    this.el.classList.remove(`hidden`);
  }

  /** The server's answer (mp.onLeaders, 70793); never called in solo. */
  set(e: LeadersData): void {
    this.data = e;
    this.open && this.render();
  }

  turn(e: number): void {
    const t = this.data?.boards[this.board].length ?? 0,
      n = Math.max(0, Math.ceil(t / PAGE_SIZE) - 1),
      r = Math.max(0, Math.min(n, this.page + e));
    r !== this.page && ((this.page = r), this.render());
  }

  close(): void {
    this.open && (this.el.classList.add(`hidden`), this.onClose());
  }

  render(): void {
    for (const e of this.tabs.querySelectorAll<HTMLElement>(`button`))
      e.classList.toggle(`on`, e.dataset.board === this.board);
    const e = BOARD_INFO[this.board];
    this.note.textContent = e.note ?? ``;
    const t = (e: string) => {
      const t = document.createElement(`li`);
      t.className = `empty`;
      t.textContent = e;
      this.list.replaceChildren(t);
      this.you.textContent = ``;
      this.pager.hidden = !0;
    };
    if (!this.online)
      return t(`The mirror shows the miners of the online world. Play online to see them, and to join them.`);
    if (!this.data) return t(`The mirror stirs…`);
    const n = this.data.boards[this.board],
      [r, i] = this.data.you[this.board];
    if (!n.length) return t(`Nobody yet. It could be you.`);
    const a = Math.ceil(n.length / PAGE_SIZE);
    this.page = Math.min(this.page, a - 1);
    const o = this.page * PAGE_SIZE;
    this.pager.hidden = a <= 1;
    this.pager.querySelector(`span`)!.textContent = `${this.page + 1} / ${a}`;
    this.pager.querySelector<HTMLButtonElement>(`.prev`)!.disabled = this.page <= 0;
    this.pager.querySelector<HTMLButtonElement>(`.next`)!.disabled = this.page >= a - 1;
    this.list.replaceChildren(
      ...n.slice(o, o + PAGE_SIZE).map(([t, n], i) => {
        const a = o + i,
          s = document.createElement(`li`);
        (a < 3 && s.classList.add([`gold`, `silver`, `bronze`][a]), a + 1 === r && s.classList.add(`me`));
        const c = document.createElement(`b`);
        c.textContent = String(a + 1);
        const l = document.createElement(`span`);
        l.textContent = t;
        const u = document.createElement(`em`);
        u.textContent = e.value(n);
        s.append(c, l, u);
        return s;
      }),
    );
    const s = r > o && r <= o + PAGE_SIZE;
    this.you.textContent = r ? (s ? `` : `You: #${r} · ${e.value(i)}`) : i ? `` : `You're not on this board yet`;
  }
}
