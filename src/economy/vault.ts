// The player's materials on chain (folder: minear-r3f/src/economy). MINEAR rules (user, 2026-11-14):
//   - A signed-in player (NEAR Auth on testnet, or the Demo cheat's local testnet account): what a mining trip
//     brings home is saved on chain AT ONCE when the trip ends (saveAll: the items contract's `save_trip`), with no
//     Claim step. The chain's own rules still apply: the hourly cap per material, the 30 s save cooldown, the
//     daily gas-free actions (the relayer, minear-r3f/server/src/relayer.ts). What one save cannot take stays in
//     the save game in this browser and goes with the next save (the next trip end, a salvage, a spin or Save now).
//   - A demo player (no account): the trip result is not kept. dropAll() empties the materials at the trip end.
//   - The Forge, rerolls, the skill tree (burn on chain) and the Refinery (craft on chain) spend ONLY the on-chain
//     balances, so a demo player cannot make or upgrade anything.
// The dev-local Demo cheat's Stock up mints into the local chain (grant()).
// Reads: one player_view call when someone signs in, when a base panel asks (refresh), before each save and after
// each action. No timers: every chain call comes from a player action.
// v2 contract (minear-r3f/contracts/items/src/gear.rs, trips.rs): forged gear is NEP-171 NFTs. The Forge, rerolls
// and salvage of chain gear run on chain (forge, reroll, salvage), and syncGear makes the save's gear match the
// NFTs the player owns. A save sends the trip report (depth) with the haul. On a v1 contract (no `stats` in
// player_view) the old path runs: burn on chain, roll the gear in this browser.
import type { PlayerState } from '../state/playerState';
import { gearFromChain, gearName, type GearItem } from '../state/gear';
import { ITEMS } from '../world/items';
import { CHEAT } from '../game/entry';
import { GameError } from '../near/play';
import { session } from '../near/session';
import { TOKEN_BY_ID, itemOf, tokenName, tokenOf, type TokenId } from './catalog';
import type { GearToken, PlayerView } from './types';

const ITEM = ITEMS as Record<string, { kind: string; name: string }>;

// ---- materials not on chain yet (the save game) ------------------------------------------------------------

/** Materials in the save that are not on chain yet: the ore bin, the gem bag, gems in the cart and in the chest. */
export function localMaterials(s: PlayerState): Map<TokenId, number> {
  const out = new Map<TokenId, number>();
  const add = (item: string, n: number) => {
    const t = tokenOf(item);
    if (t && n > 0) out.set(t, (out.get(t) ?? 0) + n);
  };
  for (const [k, n] of Object.entries(s.ores)) add(k, n);
  for (const [k, n] of Object.entries(s.crystals)) add(k, n);
  for (const p of s.pack) if (ITEM[p.id]?.kind === `gem`) add(p.id, p.n);
  for (const [k, n] of Object.entries(s.stash.gems)) add(k, n);
  return out;
}

/** How many units in the save are not on chain yet. */
export const unsavedCount = (s: PlayerState): number => [...localMaterials(s).values()].reduce((a, n) => a + n, 0);

/** Makes the save's chain gear match the NFTs in `list`: adds pieces it lacks (to the bag), takes out pieces the
 *  player no longer owns, drops duplicates, and refreshes stats from the seeds. Worn pieces stay worn. */
export function applyGear(s: PlayerState, list: GearToken[]): boolean {
  const owned = new Map(list.map((t) => [t.token_id, t]));
  const seen = new Set<string>();
  let changed = false;
  const keep = (it: GearItem | null): boolean => {
    if (!it?.chain) return true;
    const t = owned.get(it.chain);
    if (!t || seen.has(it.chain)) return ((changed = true), false);
    seen.add(it.chain);
    const fresh = gearFromChain(t);
    if (JSON.stringify(fresh.stats) !== JSON.stringify(it.stats) || it.tier !== fresh.tier || it.lvl !== fresh.lvl) {
      Object.assign(it, { stats: fresh.stats, tier: fresh.tier, lvl: fresh.lvl, ore: fresh.ore });
      it.name = gearName(it);
      changed = true;
    }
    return true;
  };
  const gear = s.gear as Record<string, GearItem | null>;
  for (const slot of Object.keys(gear)) if (!keep(gear[slot])) gear[slot] = null;
  s.items = s.items.filter(keep);
  s.stash.items = s.stash.items.filter(keep);
  for (const [id, t] of owned)
    if (!seen.has(id)) {
      s.items.push(gearFromChain(t)); // gear goes to the wallet: no bag limit
      changed = true;
    }
  if (changed) s.recompute();
  return changed;
}

/** Demo (no account): the trip result is not kept. Empties every on-chain material from the save. */
export function dropAll(s: PlayerState): void {
  for (const [t, n] of localMaterials(s)) takeLocal(s, t, n);
}

/** Takes n of a material out of the save (bin, gem bag, cart, then chest). */
export function takeLocal(s: PlayerState, token: TokenId, n: number): void {
  const item = itemOf(token)!;
  let left = n;
  const from = (rec: Record<string, number>) => {
    const k = Math.min(left, rec[item] ?? 0);
    if (k <= 0) return;
    rec[item] -= k;
    if (rec[item] <= 0) delete rec[item];
    left -= k;
  };
  if (TOKEN_BY_ID[token].kind === `ore`) from(s.ores);
  else {
    from(s.crystals);
    for (const p of s.pack) {
      if (left <= 0) break;
      if (p.id !== item) continue;
      const k = Math.min(left, p.n);
      p.n -= k;
      left -= k;
    }
    s.pack = s.pack.filter((p) => p.n > 0);
    from(s.stash.gems);
  }
}

/** What a save sends: the materials not on chain yet, within this hour's save caps. */
export function savePlan(s: PlayerState, v: PlayerView | null): { items: [TokenId, number][]; capped: string[] } {
  const hour = v ? Math.floor(v.now_ms / 3_600_000) : 0;
  const done = new Map(v && v.player.hour === hour ? v.player.minted : []);
  const items: [TokenId, number][] = [];
  const capped: string[] = [];
  for (const [t, n] of localMaterials(s)) {
    const room = TOKEN_BY_ID[t].capPerHour - (done.get(t) ?? 0);
    const k = Math.min(n, room);
    if (k > 0) items.push([t, k]);
    if (k < n) capped.push(tokenName(t));
  }
  return { items, capped };
}

// ---- the materials on chain --------------------------------------------------------------------------------

/** The result of one save. */
export interface SaveReport {
  /** What this save put on chain. */
  items: [TokenId, number][];
  /** Units still in this browser after it (they go with the next save). */
  left: number;
  /** Why some or all of it is not on chain yet (the hourly cap, the cooldown, the chain's or relayer's reason). */
  why?: string;
  /** True when the save failed (an error), false when it only waits for a limit. */
  err: boolean;
}

const fmtItems = (items: [TokenId, number][]) => items.map(([t, n]) => `${n.toLocaleString(`en-US`)} ${tokenName(t)}`).join(`, `);
export { fmtItems as savedText };

class Vault {
  /** The last player_view read (null before the first read or when no one is signed in). */
  view: PlayerView | null = null;
  private bal = new Map<TokenId, number>();
  private reading: Promise<void> | null = null;
  private fns = new Set<() => void>();
  /** An action is on its way to the chain. */
  busy = false;

  constructor() {
    session.onChange(() => {
      this.view = null;
      this.last = null;
      this.pendingTrip = null;
      this.bal.clear();
      this.emit();
      void this.refresh().then(() => this.syncGear());
    });
  }

  /** True when a player is signed in (connected, or the Demo cheat's local account). */
  get signedIn(): boolean {
    return !!session.player;
  }

  /** True once the vault has been read (always true when no one is signed in). */
  get loaded(): boolean {
    return !session.player || !!this.view;
  }

  /** `local testnet` in the Demo cheat, else `NEAR testnet`: for player text. */
  get chainName(): string {
    return CHEAT ? `local testnet` : `NEAR testnet`;
  }

  /** On-chain count of a game item (0 when not signed in or not an on-chain material). */
  have(item: string): number {
    const t = tokenOf(item);
    return t ? (this.bal.get(t) ?? 0) : 0;
  }

  /** Reads the vault once (shared by callers that ask at the same time). */
  refresh(): Promise<void> {
    const p = session.player;
    if (!p) return Promise.resolve();
    this.reading ??= p
      .view()
      .then((v) => {
        if (session.player !== p) return;
        this.view = v;
        this.bal = new Map(v.balances.map(([t, n]) => [t, Number(n)]));
        this.emit();
      })
      .catch(() => undefined)
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  /** Burns materials on chain (`memo` says why: forge, reroll, skill). Throws with the reason when short. */
  async spend(items: [string, number][], memo: string): Promise<void> {
    const p = this.need();
    const sum = new Map<TokenId, number>();
    for (const [item, n] of items) {
      const t = tokenOf(item);
      if (!t) throw new GameError(`${ITEM[item]?.name ?? item} is not an on-chain material`);
      if (n > 0) sum.set(t, (sum.get(t) ?? 0) + n);
    }
    for (const [t, n] of sum)
      if ((this.bal.get(t) ?? 0) < n) throw new GameError(`You need ${n - (this.bal.get(t) ?? 0)} more ${tokenName(t).toLowerCase()} on chain.`);
    await this.run(() => p.burn([...sum], memo));
    for (const [t, n] of sum) this.bal.set(t, (this.bal.get(t) ?? 0) - n);
    this.emit();
    void this.refresh();
  }

  /** Smelts on chain with a Refinery recipe (minear-r3f/src/economy/catalog.ts RECIPES) `times` times. */
  async smelt(recipeId: string, times: number): Promise<void> {
    const p = this.need();
    await this.run(() => p.craft(recipeId, times));
    await this.refresh();
  }

  /** A save is on its way to the chain. */
  saving = false;
  /** The trip report a save has not carried yet. */
  private pendingTrip: { depth_m: number } | null = null;
  /** The save game, for the gear sync after a sign-in (Game binds it once). */
  private state: PlayerState | null = null;

  /** True on a v2 contract: gear NFTs and trip records (player_view has `stats`). */
  get chainGear(): boolean {
    return !!this.view?.stats;
  }

  /** Game.ts binds the save once, so a sign-in brings the player's gear NFTs into it. */
  bindState(s: PlayerState): void {
    this.state = s;
  }

  /** Reads the player's gear NFTs (one view call) and makes the save match them. */
  async syncGear(): Promise<void> {
    const p = session.player;
    const s = this.state;
    if (!p || !s || !this.chainGear) return;
    const list = await p.gearOf().catch(() => null);
    if (!list || session.player !== p) return;
    if (applyGear(s, list)) {
      s.save();
      this.emit();
    }
  }

  /** The Forge on chain: burns the grade's materials and mints `times` gear NFTs; they go into the bag. */
  async forge(s: PlayerState, base: string, grade: string, times: number): Promise<GearItem[]> {
    const p = this.need();
    const made = await this.run(() => p.forge(base, grade, times));
    const items = made.map((t) => {
      const it = gearFromChain(t);
      it.fresh = true;
      return it;
    });
    s.items.push(...items);
    s.save();
    await this.refresh();
    return items;
  }

  /** A reroll on chain: burns the tier's cost and gives the piece new enchants from the new seed. */
  async reroll(s: PlayerState, item: GearItem): Promise<void> {
    const p = this.need();
    const t = await this.run(() => p.reroll(item.chain!));
    const fresh = gearFromChain(t);
    Object.assign(item, { stats: fresh.stats, name: fresh.name });
    s.recompute();
    s.save();
    await this.refresh();
  }

  /** Salvage on chain: burns the gear NFT and mints its ore. Takes the piece out of the save. */
  async salvage(s: PlayerState, item: GearItem): Promise<[TokenId, number][]> {
    const p = this.need();
    const out = await this.run(() => p.salvage(item.chain!));
    s.items = s.items.filter((e) => e.uid !== item.uid);
    s.save();
    await this.refresh();
    return out.map(([t, n]) => [t, Number(n)]);
  }
  /** The last save's result (null before the first save, or after a sign-in change). */
  last: SaveReport | null = null;
  private saves: Promise<unknown> = Promise.resolve();

  /**
   * Saves every material in the save game that is not on chain yet (`save_trip`), within this hour's caps and after the
   * save cooldown, and takes what was saved out of the save game. Called when a mining trip ends, after a salvage or
   * a Capsule spin, and by Save now. Saves run one after another, so two saves never send the same units. Never
   * throws: the report says what was saved and why the rest waits.
   */
  saveAll(s: PlayerState, trip?: { depth_m: number }): Promise<SaveReport> {
    // the trip report waits here until a save carries it (the deepest of the trips not sent yet)
    if (trip) this.pendingTrip = { depth_m: Math.max(this.pendingTrip?.depth_m ?? 0, Math.max(0, Math.round(trip.depth_m))) };
    const run = () => this.saveNow(s);
    const r = this.saves.then(run, run);
    this.saves = r.catch(() => undefined);
    return r;
  }

  private async saveNow(s: PlayerState): Promise<SaveReport> {
    const total = unsavedCount(s);
    const p = session.player;
    if (!total && !(this.pendingTrip && this.chainGear)) return this.report({ items: [], left: 0, err: false });
    if (!p) return this.report({ items: [], left: total, why: `Sign in to keep what you mine.`, err: true });
    this.saving = true;
    this.emit();
    try {
      await this.refresh(); // fresh caps and cooldown (one view call)
      const v = this.view;
      if (v && v.next_save_ms > v.now_ms) {
        const secs = Math.ceil((v.next_save_ms - v.now_ms) / 1000);
        return this.report({ items: [], left: total, why: `The chain takes one save every 30 s. Save again in ${secs} s.`, err: false });
      }
      const plan = savePlan(s, v);
      // a v2 contract records the trip even with no items (a trip that found nothing, or all over the cap)
      const trip = this.chainGear ? this.pendingTrip : null;
      if (!plan.items.length && !trip)
        return this.report({ items: [], left: total, why: `This hour's limit is reached for ${plan.capped.join(`, `)}. It is saved with a later trip.`, err: false });
      await this.run(() => p.saveTrip(plan.items, trip ?? undefined));
      if (trip) this.pendingTrip = null;
      for (const [t, n] of plan.items) {
        takeLocal(s, t, n);
        this.bal.set(t, (this.bal.get(t) ?? 0) + n);
      }
      s.save();
      const left = unsavedCount(s);
      return this.report({
        items: plan.items,
        left,
        why: plan.capped.length ? `Over this hour's limit: ${plan.capped.join(`, `)}. It is saved with a later trip.` : undefined,
        err: false,
      });
    } catch (e) {
      return this.report({ items: [], left: total, why: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      this.saving = false;
      this.emit();
      void this.refresh();
    }
  }

  private report(r: SaveReport): SaveReport {
    this.last = r;
    this.emit();
    return r;
  }

  /** Demo cheat only: mints game items into this vault on the local chain (the Cheats panel's Stock up). */
  async grant(items: [string, number][]): Promise<void> {
    if (!CHEAT) throw new GameError(`Stock up exists only in the Demo cheat`);
    const p = this.need();
    const lines = items.map(([item, n]) => [tokenOf(item), n] as const).filter(([t]) => !!t);
    await this.run(async () => {
      const r = await fetch(`${session.server}/dev/grant`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ accountId: p.id, items: lines }),
      });
      const body = (await r.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new GameError(body.error ?? `Stock up failed`);
    });
    await this.refresh();
  }

  onChange(fn: () => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  private need() {
    const p = session.player;
    if (!p) throw new GameError(`Sign in to keep and use your materials.`);
    if (this.busy) throw new GameError(`One moment: the last action is still on its way.`);
    return p;
  }

  private async run<T>(f: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.emit();
    try {
      return await f();
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit(): void {
    for (const f of this.fns) f();
  }
}

export const vault = new Vault();
