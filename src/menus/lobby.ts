// The MINEAR lobby (div#start in index.html; styles in src/brand/minear.css).
// Left: the logo and the three ways in (MINEAR rules, user 2026-11-14; minear-r3f/src/game/entry.ts):
//   Continue with Google  NEAR Auth on the real NEAR testnet (minear-r3f/src/menus/signIn.ts). Each finished trip is
//                         saved on chain at once, and those materials pay for the Forge and upgrades. Signed in, the
//                         button becomes "Play as <account>".
//   Play demo             no account (a guest name is made): mine and see the trip summary, but nothing is kept.
//                         Signed in, it plays this page with no account and keeps the sign-in for the next visit.
//   Demo cheat            dev runs on this machine only: cheats on, a local testnet account, its own save. Enabled
//                         when the local chain's server answers (one check when the lobby opens; npm run dev:local).
// A page runs on one chain (?mode=cheat: the local chain; no mode: NEAR testnet). On a dev run all three buttons
// show on both; a button of the other chain reloads the page in that mode with ?entry=, and this lobby carries the
// choice on at once (Play demo and Demo cheat start the game; Google opens the sign-in sheet).
// Right: the board, with tabs: Depth (the deepest miners, you among them), Trips (a live log of finished
// trips: who, how deep, how much came home), Supply (how much of each material has been mined, from the
// items contract on NEAR testnet) and Market (the best price an open merchant pays now, in NEAR).
// On a v2 contract (minear-r3f/contracts/items/src/trips.rs) Trips and Depth are live from the chain: every
// finished trip, its move on the Depth board, and how 24 h of mining moved the price of its best find
// (impact24, minear-r3f/src/economy/pricing.ts). One lobby_feed and one market_board view when the lobby opens,
// then again every LIVE_EVERY ms while the lobby is on screen (RPC views only, no database). On a v1 contract
// (no lobby_feed) they show seeded sample miners (src/menus/lobbyData.ts) next to your own record and trips.
import { CHEAT, DEV_LOCAL, ENTRY, clearEntry, localChainUp, modeUrl } from '../game/entry';
import { nearAuthPageFix, preloadNearAuth } from '../near/nearAuth';
import { session } from '../near/session';
import { GOOGLE_ICON, openSignIn } from './signIn';
import type { Game } from '../game/Game';
import { DEPTH_LAYERS } from '../ui/depthBar';
import { MATERIALS } from '../world/materials';
import { itemOf, type TokenId } from '../economy/catalog';
import type { Board, LobbyFeed } from '../economy/types';
import { SAMPLE_MINERS, ago, initialTrips, itemColor, itemKind, itemName, loadTrips, placeAt, sampleTrip, type TripRow } from './lobbyData';

const GUEST_KEY = `minear.guestName`;
const ADJ = [`Dusty`, `Rusty`, `Lucky`, `Sleepy`, `Brave`, `Mossy`, `Sooty`, `Gritty`, `Shiny`, `Rocky`, `Muddy`, `Jolly`];
const NOUN = [`Mole`, `Digger`, `Miner`, `Burrow`, `Pebble`, `Nugget`, `Shovel`, `Tunnel`];

/** The guest name: made once, then kept in this browser. */
export function guestName(): string {
  try {
    const saved = localStorage.getItem(GUEST_KEY);
    if (saved) return saved;
  } catch {
    /* storage blocked */
  }
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const name = `${pick(ADJ)}${pick(NOUN)}${10 + Math.floor(Math.random() * 90)}`;
  try {
    localStorage.setItem(GUEST_KEY, name);
  } catch {
    /* storage blocked */
  }
  return name;
}

/** The name the miner plays under: the NEAR account when signed in, else the guest name. */
export function playerName(): string {
  return session.player?.id ?? guestName();
}

/** Long implicit accounts (64 hex characters) are cut to their ends; named accounts stay whole (the table cuts them). */
const shortAccount = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 8)}…${id.slice(-6)}` : id);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;

type TabId = `depth` | `trips` | `supply` | `market`;
const TABS: { id: TabId; name: string }[] = [
  { id: `trips`, name: `Trips` },
  { id: `depth`, name: `Depth` },
  { id: `supply`, name: `Supply` },
  { id: `market`, name: `Market` },
];

const TITLES: Record<TabId, string> = { depth: `Top miners`, trips: `Latest trips`, supply: `Mined so far`, market: `Merchants pay` };

const COIN = `<i class="coin sm"></i>`;
/** Rows the board always shows (the table keeps its size when it is empty). */
const BOARD_ROWS = 10;
/** A new sample trip arrives this often (ms, a random time between the two). */
const TRIP_EVERY: [number, number] = [2600, 6200];
const SAMPLE_NOTE = `Sample miners until the online board is live. Your own record and trips are real.`;
/** The live board reads the chain again this often while the lobby is on screen (ms). */
const LIVE_EVERY = 20_000;
const CHAIN_NAME = CHEAT ? `the local testnet` : `NEAR testnet`;

export function openLobby(game: Game): void {
  const start = document.getElementById(`start`)!;
  const play = document.getElementById(`play`) as HTMLButtonElement;
  const login = document.getElementById(`google-login`) as HTMLButtonElement;
  const walletBtn = document.getElementById(`wallet-login`) as HTMLButtonElement;
  const cheatBtn = document.getElementById(`cheat-entry`) as HTMLButtonElement;
  const entry = start.querySelector<HTMLElement>(`.entry`)!;
  entry.classList.toggle(`on-cheat`, CHEAT);
  /** The Demo cheat's Play failed (no local testnet): the next Play starts without it. */
  let cheatErr = ``;
  /** Dev runs on NEAR testnet: does the local chain's server answer? (null: not checked yet) */
  let localUp: boolean | null = null;
  const who = start.querySelector<HTMLElement>(`.who`)!;
  const board = start.querySelector<HTMLElement>(`.lboard`)!;
  const tabs = board.querySelector<HTMLElement>(`.ltabs`)!;
  const rows = board.querySelector<HTMLElement>(`.lrows`)!;
  const note = board.querySelector<HTMLElement>(`.lnote`)!;
  let tab: TabId = `trips`;
  let busy = false;
  // the trip log: your own saved trips and the sample trips, newest first; a new sample trip arrives every
  // few seconds while the lobby is open (no network, no timers after the game starts)
  let trips: TripRow[] = [...loadTrips(), ...initialTrips()].sort((a, b) => b.at - a.at).slice(0, 40);
  let tripTimer = 0;
  let agoTimer = 0;
  const lobbyUp = () => !start.classList.contains(`hidden`) && !game.started;
  /** Live from the chain (v2 contract): the feed, the market board and each token's 24 h price impact. */
  let live: { feed: LobbyFeed; impact: Map<TokenId, number> } | null = null;
  let liveTimer = 0;
  const loadLive = (): Promise<void> =>
    Promise.all([import('../near/play'), import('./market')])
      .then(async ([play, m]) => {
        const [feed, board] = await Promise.all([
          play.viewCall<LobbyFeed>(session.deploy, `lobby_feed`),
          play.viewCall<Board>(session.deploy, `market_board`),
        ]);
        live = { feed, impact: new Map(m.bestPrices(board).map((p) => [p.token, p.impact])) };
        clearTimeout(tripTimer); // the chain's trips replace the sample trips
        if (tab === `trips` || tab === `depth`) renderBoard();
      })
      .catch(() => undefined); // a v1 contract has no lobby_feed: the sample board stays
  const nextTrip = () => {
    clearTimeout(tripTimer);
    if (!lobbyUp() || live) return;
    tripTimer = window.setTimeout(() => {
      if (!lobbyUp()) return;
      trips = [sampleTrip(Date.now()), ...trips].slice(0, 40);
      if (tab === `trips`) renderTrips(true);
      nextTrip();
    }, TRIP_EVERY[0] + Math.random() * (TRIP_EVERY[1] - TRIP_EVERY[0]));
  };

  const label = (title: string, sub: string) => `<span class="et">${title}</span><small>${sub}</small>`;
  // NEAR's shared testnet sign-in client returns only to http://localhost:3000 (minear-r3f/src/near/nearAuth.ts)
  const authFix = nearAuthPageFix(`testnet`);
  const renderEntry = () => {
    const id = session.player?.id ?? null;
    // 1. Continue with Google: NEAR Auth, the real NEAR testnet
    login.disabled = busy;
    login.innerHTML = CHEAT
      ? `<span class="gi" aria-hidden="true">${GOOGLE_ICON}</span><span class="gtx">${label(`Continue with Google`, `NEAR Auth · switches to NEAR testnet`)}</span>`
      : id
        ? `<span class="gtx">${label(`Play as ${esc(shortAccount(id))}`, `NEAR testnet · each trip is saved on chain`)}</span>`
        : `<span class="gi" aria-hidden="true">${GOOGLE_ICON}</span><span class="gtx">${label(
            `Continue with Google`,
            authFix ? `works only at ${authFix.replace(/^https?:\/\//, ``)}` : `NEAR Auth on NEAR testnet · keeps what you mine`,
          )}</span>`;
    // 1b. Connect a NEAR wallet: the player's own testnet account (hidden once signed in: Play as <account>)
    walletBtn.hidden = !!id && !CHEAT;
    walletBtn.disabled = busy;
    walletBtn.innerHTML = label(`Connect a NEAR wallet`, CHEAT ? `switches to NEAR testnet` : `your own testnet account · no popups while you play`);
    // 2. Play demo: no account, nothing kept
    play.disabled = busy;
    play.innerHTML = label(`Play demo`, CHEAT ? `no account · switches to NEAR testnet` : `no account · nothing you mine is kept`);
    // 3. Demo cheat: the local testnet (dev runs on this machine only)
    cheatBtn.hidden = !DEV_LOCAL;
    cheatBtn.disabled = busy || (!CHEAT && localUp !== true);
    cheatBtn.innerHTML = CHEAT
      ? busy
        ? label(`Making your local testnet account…`, `local testnet`)
        : cheatErr
          ? label(`Play anyway`, `no local testnet account: nothing is kept`)
          : label(`Play demo cheat`, `local testnet · cheats on · dev only`)
      : localUp === null
        ? label(`Demo cheat`, `checking the local testnet…`)
        : localUp
          ? label(`Demo cheat`, `local testnet · cheats on · dev only`)
          : label(`Demo cheat`, `the local testnet is off: npm run dev:local`);
    cheatBtn.title = !CHEAT && localUp === false ? `Start the local testnet with: npm run dev:local` : ``;
    // the line under the buttons
    if (CHEAT)
      who.innerHTML = cheatErr
        ? `<span class="err">${esc(cheatErr)}</span>`
        : id
          ? `This page runs on the local testnet: <b>${esc(shortAccount(id))}</b>. Cheats on.`
          : `This page runs on the local testnet. Cheats on. Your account is made when you press Play.`;
    else
      who.innerHTML = id
        ? `Signed in on NEAR ${esc(session.network)}: <b>${esc(shortAccount(id))}</b> · <button type="button" class="link out">Sign out</button>`
        : session.guest
          ? `Demo on this page: nothing you mine is kept.`
          : `Sign in with NEAR to keep what you mine and forge with it. Demo: you mine as <b>${esc(guestName())}</b>.`;
    who.querySelector<HTMLButtonElement>(`.out`)?.addEventListener(`click`, () => {
      session.signOut();
      renderEntry();
      renderBoard();
    });
  };

  /** Empty rows that keep the table at BOARD_ROWS rows. */
  const pad = (n: number, from = 0) =>
    Array.from({ length: Math.max(0, BOARD_ROWS - n) }, (_, i) =>
      `<li class="empty"><span class="rk">${from ? from + i : ``}</span><span class="nm">—</span><span class="kd"></span><b></b></li>`,
    ).join(``);
  const chip = (id: string | null) =>
    id ? `<span class="chip ${itemKind(id) === `gem` ? `gem` : `ore`}" style="--c:${itemColor(id)}" title="${esc(itemName(id))}"></span>` : ``;

  /** A depth in the colour of its rock layer (the same layers and colours as the in-game depth bar). */
  const depthTag = (deep: number) => {
    const layer = DEPTH_LAYERS.find((l) => deep < l.bottom) ?? DEPTH_LAYERS[DEPTH_LAYERS.length - 1];
    const c = MATERIALS[layer.mat].color;
    const lum = (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
    return `<span class="dep" style="--c:${hex(c)};--t:${lum > 0.6 ? `#3a281c` : `#fff`}" title="${layer.name}">${deep.toLocaleString(`en-US`)} m</span>`;
  };

  /** A token's 24 h price impact as a small tag (nothing under half a percent); `named` puts the item name first. */
  const impactTag = (token: TokenId | null, named = true) => {
    const k = token ? (live?.impact.get(token) ?? 0) : 0;
    if (!token || Math.abs(k) < 0.005) return ``;
    const pct = `${k > 0 ? `+` : `−`}${Math.abs(k * 100).toFixed(1)}% 24 h`;
    return ` <span class="imp ${k < 0 ? `dn` : `up`}" title="How 24 h of mining and trading moved its price">${named ? `${esc(itemName(itemOf(token)))} ` : ``}${pct}</span>`;
  };

  /** Depth on the chain: the Depth board (deepest trip per player), you highlighted. */
  const renderLiveDepth = (f: LobbyFeed) => {
    const me = session.player?.id;
    const list = f.top_depth.slice(0, BOARD_ROWS);
    rows.innerHTML =
      `<li class="hd"><span class="rk">#</span><span class="nm">Miner</span><span class="kd">Deepest at</span><b>Depth</b></li>` +
      list
        .map(
          (l, i) =>
            `<li${l.account_id === me ? ` class="you"` : ``}><span class="rk">${i + 1}</span>` +
            `<span class="nm">${esc(shortAccount(l.account_id))}${l.account_id === me ? ` <em>you</em>` : ``}</span>` +
            `<span class="kd">${esc(placeAt(l.value))}</span><b>${l.value.toLocaleString(`en-US`)} m</b></li>`,
        )
        .join(``) +
      pad(list.length + 1, list.length + 1);
    note.textContent = `Live from ${CHAIN_NAME}. For now the game reports each trip's depth; a realtime server will confirm it later.`;
  };

  /** Trips on the chain: every finished trip (who, how many items, its best find, how deep). Board places are on the
   *  Depth tab and prices on the Market tab, so a trip row shows neither (the user, 2026-11-15). */
  const renderLiveTrips = (f: LobbyFeed) => {
    const now = Date.now();
    const me = session.player?.id;
    rows.innerHTML = f.trips.length
      ? f.trips
          .map((t, i) => {
            const when = ago(t.at_ms, now);
            const best = t.best ? itemOf(t.best) : null;
            return (
              `<li class="${[`say`, t.account_id === me ? `you` : ``, i === 0 && now - t.at_ms < LIVE_EVERY ? `new` : ``].join(` `).trim()}">` +
              `<span class="ago">${when === `now` ? `just now` : `${when} ago`}</span><span class="tx"><b>${esc(shortAccount(t.account_id))}</b> finished a mining trip: ${t.items.toLocaleString(`en-US`)} items ${chip(best)} ` +
              `at ${depthTag(t.depth_m)}</span></li>`
            );
          })
          .join(``)
      : `<li class="empty"><span class="rk"></span><span class="nm">No trips on chain yet. Finish a trip to be the first.</span><span class="kd"></span><b></b></li>`;
    note.textContent = `Live from ${CHAIN_NAME}: every finished mining trip.`;
  };

  /** Depth: the deepest miners (sample miners and you), with where their deepest point is. */
  const renderDepth = () => {
    if (live?.feed.top_depth.length) return renderLiveDepth(live.feed);
    const me = { name: playerName(), deepest: Math.round(game.state.deepest), where: placeAt(game.state.deepest), you: true };
    const all = [...SAMPLE_MINERS, me].sort((a, b) => b.deepest - a.deepest);
    const myRank = all.indexOf(me) + 1;
    const top = all.slice(0, BOARD_ROWS);
    const list = top.includes(me) ? top : [...top.slice(0, BOARD_ROWS - 1), me];
    rows.innerHTML =
      `<li class="hd"><span class="rk">#</span><span class="nm">Miner</span><span class="kd">Deepest at</span><b>Depth</b></li>` +
      list
        .map(
          (m) =>
            `<li${m === me ? ` class="you"` : ``}><span class="rk">${m === me ? myRank : all.indexOf(m) + 1}</span>` +
            `<span class="nm">${esc(shortAccount(m.name))}${m === me ? ` <em>you</em>` : ``}</span>` +
            `<span class="kd">${esc(m.where)}</span><b>${m.deepest.toLocaleString(`en-US`)} m</b></li>`,
        )
        .join(``);
    note.textContent = SAMPLE_NOTE;
  };

  /** Trips: the live log, newest first: who, how deep, how many things came home, the best find. */
  const renderTrips = (fresh = false) => {
    if (live) return renderLiveTrips(live.feed);
    const now = Date.now();
    rows.innerHTML = trips
      .slice(0, 30)
      .map((t, i) => {
        const when = ago(t.at, now);
        const finds = (t.finds?.length ? t.finds : t.best ? [t.best] : []).slice(0, 3);
        return (
          `<li class="${[`say`, t.you ? `you` : ``, fresh && i === 0 ? `new` : ``].join(` `).trim()}">` +
          `<span class="ago">${when === `now` ? `just now` : `${when} ago`}</span><span class="tx"><b>${esc(t.name)}</b> finished a mining trip: ${t.items.toLocaleString(`en-US`)} items ${finds.map(chip).join(``)} ` +
          `at ${depthTag(t.deep)}</span></li>`
        );
      })
      .join(``);
    note.textContent = `Finished trips, live. ${SAMPLE_NOTE}`;
  };

  /** Supply: how much of each material has been mined (saved on chain), all time and in the last 24 h. */
  const renderSupply = () => {
    const head = `<li class="hd"><span class="rk"></span><span class="nm">Material</span><span class="kd">Mined 24 h</span><b>Total mined</b></li>`;
    rows.innerHTML = head + `<li class="empty"><span class="rk"></span><span class="nm">Reading the chain…</span><span class="kd"></span><b></b></li>` + pad(1);
    note.textContent = `Live on ${CHEAT ? `the local testnet` : `NEAR testnet`}: the items contract counts every unit saved on chain.`;
    void Promise.all([import('../near/play'), import('../near/session'), import('../economy/catalog'), import('../economy/pricing')])
      .then(async ([play, s, cat, pr]) => {
        const board = await play.viewCall<import('../economy/types').Board>(s.session.deploy, `market_board`);
        if (tab !== `supply`) return;
        const list = cat.TOKENS.map((t) => {
          const st = board.tokens.find((x) => x.token_id === t.id);
          const f = pr.last24(st?.flow, board.now_ms);
          return { t, supply: Number(st?.supply ?? 0), mined: f.a, used: f.b };
        });
        const most = Math.max(1, ...list.map((x) => x.supply));
        rows.innerHTML =
          head +
          list
            .map(
              ({ t, supply, mined, used }) =>
                `<li class="sup"><span class="chip ${t.kind}" style="--c:${hex(t.color)}"></span><span class="nm">${esc(t.name)}` +
                `<i class="bar"><i style="width:${Math.max(2, (supply / most) * 100)}%;--c:${hex(t.color)}"></i></i></span>` +
                `<span class="kd" title="Mined in the last 24 h, minus what was used up">+${mined.toLocaleString(`en-US`)}${used ? ` <s>−${used.toLocaleString(`en-US`)}</s>` : ``}</span>` +
                `<b>${supply.toLocaleString(`en-US`)}</b></li>`,
            )
            .join(``);
      })
      .catch(() => {
        if (tab === `supply`) note.textContent = `Could not reach ${CHEAT ? `the local testnet (npm run dev:local)` : `NEAR testnet`} right now.`;
      });
  };

  /** Market: the merchants on NEAR testnet; the best price any open merchant pays now, shown in NEAR. */
  const renderMarket = () => {
    const head = `<li class="hd"><span class="rk"></span><span class="nm">Item</span><span class="kd">Best buyer</span><b>Pays</b></li>`;
    rows.innerHTML = head + `<li class="empty"><span class="rk"></span><span class="nm">Asking the merchants…</span><span class="kd"></span><b></b></li>` + pad(1);
    note.textContent = `Live on ${CHEAT ? `the local testnet` : `NEAR testnet`}. Trade with each merchant at their stall on the islands around the base.`;
    void Promise.all([import('./market'), import('../near/play'), import('../near/session')])
      .then(async ([m, play, s]) => {
        const best = m.bestPrices(await play.viewCall(s.session.deploy, `market_board`)).slice(0, 15);
        const { TOKEN_BY_ID } = await import('../economy/catalog');
        const { fmtNear, nearPrice } = await import('../economy/nearDisplay'); // MINEAR: prices shown in NEAR
        if (tab !== `market`) return;
        rows.innerHTML =
          head +
          best
            .map((p) => {
              const d = TOKEN_BY_ID[p.token];
              return `<li><span class="chip ${d.kind}" style="--c:${hex(d.color)}"></span><span class="nm">${esc(d.name)}</span>` +
                `<span class="kd">${esc(p.bidBy)}${impactTag(p.token, false)}</span><b>${p.bid ? fmtNear(nearPrice(p.token, p.bid)) : `—`} ${COIN}</b></li>`;
            })
            .join(``);
      })
      .catch(() => {
        if (tab === `market`) note.textContent = `Could not reach ${CHEAT ? `the local testnet (npm run dev:local)` : `NEAR testnet`} right now.`;
      });
  };

  const renderBoard = () => {
    tabs.innerHTML = TABS.map(
      (t) => `<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.name}</button>`,
    ).join(``);
    rows.dataset.tab = tab;
    const h2 = board.querySelector(`h2`);
    if (h2) h2.textContent = TITLES[tab];
    if (tab === `depth`) renderDepth();
    else if (tab === `trips`) renderTrips();
    else if (tab === `supply`) renderSupply();
    else renderMarket();
  };

  tabs.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(`[data-tab]`);
    if (!b) return;
    tab = b.dataset.tab as TabId;
    renderBoard();
  };
  /** Demo cheat: make (or check) the local testnet account, then play. */
  const playCheat = () => {
    if (cheatErr || busy) return void (cheatErr && game.start());
    busy = true;
    renderEntry();
    session.cheatAccount().then(
      () => {
        busy = false;
        game.start();
      },
      (e) => {
        busy = false;
        cheatErr = e instanceof Error ? e.message : String(e);
        renderEntry();
      },
    );
  };
  // Google: the popup opens inside this click; the sheet asks for a name the first time. From the Demo cheat it
  // reloads on NEAR testnet and opens the sheet there.
  login.onclick = () => {
    if (CHEAT) return location.assign(modeUrl(false, `google`));
    if (session.player) return game.start();
    openSignIn({ start: true });
  };
  // NEAR wallet: NEAR Connect's picker opens in the page; the sheet shows the game-key step and errors
  walletBtn.onclick = () => {
    if (CHEAT) return location.assign(modeUrl(false, `wallet`));
    if (session.player) return game.start();
    openSignIn({ wallet: true });
  };
  play.onclick = () => {
    if (CHEAT) return location.assign(modeUrl(false, `demo`));
    session.playAsGuest(); // signed in: this page plays with no account; the sign-in stays for the next visit
    game.start();
  };
  cheatBtn.onclick = () => (CHEAT ? playCheat() : location.assign(modeUrl(true, `cheat`)));
  session.onChange(() => {
    renderEntry();
    renderBoard();
  });
  if (!CHEAT) preloadNearAuth();
  if (DEV_LOCAL && !CHEAT)
    void localChainUp().then((up) => {
      localUp = up;
      renderEntry();
    });

  board.hidden = false;
  renderEntry();
  renderBoard();
  nextTrip();
  void loadLive();
  clearInterval(liveTimer);
  liveTimer = window.setInterval(() => {
    if (!lobbyUp()) return clearInterval(liveTimer);
    if (live && !document.hidden) void loadLive();
  }, LIVE_EVERY);
  clearInterval(agoTimer);
  agoTimer = window.setInterval(() => {
    if (!lobbyUp()) return clearInterval(agoTimer);
    if (tab === `trips`) renderTrips();
  }, 15_000);
  if (matchMedia(`(pointer: fine)`).matches) (CHEAT ? cheatBtn : login).focus({ preventScroll: true });
  // a button of the other chain reloaded the page: carry the choice on
  clearEntry();
  if (ENTRY === `cheat` && CHEAT) playCheat();
  else if (ENTRY === `demo` && !CHEAT) {
    session.playAsGuest();
    game.start();
  } else if (ENTRY === `google` && !CHEAT && !session.player) openSignIn({ reason: `Sign in with NEAR (NEAR testnet) to keep what you mine.` });
  else if (ENTRY === `wallet` && !CHEAT && !session.player) openSignIn({ wallet: true });
}
