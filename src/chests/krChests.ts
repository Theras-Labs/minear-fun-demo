// KR's chest, knockout, satchel and loot panel glue as functions over a small host (the game).
// Bundle play-inUT-NSi.js lines 70368-70406 (chests and satchels made, chest vanish puff), 70524-70531 (the
// combat knockedOut hook), 70646-70649 (loot panel made), 71785-71810 (per-frame chests, hints, satchels, loot
// panel watch), 71947 (updateSatchels call), 71999 (burrow halos), 72184-72187 (loot panel keys),
// 73371-73501 (openChest, lootChest) and 74782-74985 (wakeAtHome, dropSatchel, syncSatchels, soloSatchels,
// updateSatchels, lootSatchel, takeFromSatchel, satchelById, closeLoot, showLoot, dropGear, dropSupply).
// Solo only: where KR asks the room client (mp.*), the solo branch it takes when mp is not served is used
// (claimChest answers yes at once, chestGone is false, chestStates is empty, dropSatchel returns false).
import * as THREE from 'three';
import { IS_TOUCH } from '../game/device';
import { ITEMS, BIOME_GEM, type ItemDef } from '../world/items';
import { cavernAtWorld, cavernMetric } from '../world/caverns';
import { pickGemByDepth } from '../world/gemSpawn';
import { rollLootGear, type GearItem, type GearSlot } from '../state/gear';
import { TRIP_GIVES_COINS, TRIP_GIVES_GEAR } from '../base/run';
import { TIER_COLORS } from '../state/progression';
import { lootSummary } from '../state/gearStats';
import type { LootDrop, SatchelPick } from '../state/playerState';
import { supplyModel } from '../pickups/supplyModels';
import { supplyToast, type PickupAudio, type PickupHost, type PickupUi } from '../pickups/collect';
import type { HudGearItem, HudIcons } from '../ui/hud';
import { CHEST_NAMES } from '../ui/kr-hud';
import type { SonarBlip } from '../render/sonarRock';
import { Chests, CHEST_COLORS, type Chest, type ChestWorld } from './chests';
import { Satchels, type SatchelData } from './satchels';
import { LootPanel } from './lootPanel';

const ITEM = ITEMS as Record<string, ItemDef>;
const J = IS_TOUCH; // J
const GO = CHEST_NAMES; // GO (50259)

/** The audio methods this glue calls on top of the pickup ones (src/audio/audio.ts Audio). */
export interface ChestAudio {
  chestOpen(kind: number): void;
  poof(): void;
  loot(tier: number): void;
  click(): void;
  lift(): void;
  drop(ring?: boolean): void;
}

/**
 * The game (KR) as this glue reads and writes it. It is a PickupHost (KR.supplyToast is src/pickups/collect.ts
 * supplyToast) plus the fields below. The "KR fields" are the game's own: KR declares them at 70100-70101
 * (chests, satchels = new Satchels()), 70198-70201 (chestHint = null, koBy = null, satchelHint = null),
 * 74869-74878 (satchelT = 0, lootFreed = false, loot).
 */
export interface ChestHost extends PickupHost {
  scene: { add(...o: THREE.Object3D[]): unknown };
  world: PickupHost['world'] & ChestWorld;
  hub: { addStash(model: THREE.Object3D | null): void; liftTop: THREE.Vector3 };
  input: { locked: boolean; hit(code: string): boolean };
  ui: PickupUi & { itemToast(item: HudGearItem): void; bumpCoins(): void; icons: HudIcons };
  audio: PickupAudio & ChestAudio;
  /** A menu, Wellspring, inventory or leaderboard panel is open (KR getter 71299). */
  anyPanel: boolean;
  /** The Fortune mark the HUD last announced (src/ui/kr-hud.ts). */
  fortuneMark: number;
  exitBurrow(toSurface: boolean): void;
  /** KR.releaseLock (72250): leaves pointer lock (lockWasActive = false first). */
  releaseLock(): void;
  // KR fields
  chests: Chests; // tk
  satchels: Satchels; // Uk
  loot: LootPanel; // vP
  chestHint: Chest | null;
  satchelHint: SatchelData | null;
  /** Name of the miner who knocked me out, for the wake banner. */
  koBy: string | null;
  lootFreed: boolean;
  satchelT: number;
  // not ported yet (optional)
  /** KR.onStatsChanged: gear changed (inventory). */
  onStatsChanged?(): void;
  /** EO.nameOf (49110): a miner's name. */
  nameOf?(id: string): string;
}

/**
 * KR 70368-70406: makes the chest manager (chest model from loadChests, JO), puts the gold chest on the hub as
 * the stash, sets the vanish puff, adds the chest and satchel groups to the scene and shows the saved satchels.
 * Call after state.load(), with h.satchels already made; assign the result to h.chests.
 */
export function makeChests(h: ChestHost, model: THREE.Object3D | null): Chests {
  // isOpened: state.opened or mp.chestGone (solo: false); turnedUp: mp.chestStates (solo: empty)
  const chests = new Chests(h.world, (e) => h.state.opened.includes(e), model);
  h.hub.addStash(chests.modelOf(2));
  chests.onVanish = (e, t) => {
    const n = e.clone().setY(e.y + 0.4);
    (h.dust.emit({
      pos: n,
      vel: new THREE.Vector3(0, 0.6, 0),
      spread: 1.3,
      color: [10119748, 9080732, 8010330][t],
      size: 0.55,
      sizeEnd: 1.6,
      alpha: 0.55,
      life: 0.9,
      drag: 2.5,
      count: 12,
    }),
      h.sparks.emit({
        pos: n,
        vel: new THREE.Vector3(0, 2.5, 0),
        spread: 2.2,
        color: parseInt(CHEST_COLORS[t].slice(1), 16),
        intensity: 2.6,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.8,
        gravity: -1,
        count: 18,
        drag: 1.5,
      }),
      h.audio.poof());
  };
  h.scene.add(chests.group);
  h.scene.add(h.satchels.group);
  h.satchels.sync(h.state.satchels);
  return chests;
}

/** KR 70646-70649: the loot satchel panel (appends div#loot to #ui). Assign the result to h.loot. */
export function makeLootPanel(h: ChestHost): LootPanel {
  return new LootPanel(
    h.state,
    {
      take: (e, t) => takeFromSatchel(h, e, t),
      close: () => closeLoot(h),
    },
    () => h.ui.icons,
  );
}

/** KR 70524-70531: the combat knockedOut hook (by = the miner who did it, or null). */
export function knockedOut(h: ChestHost, by: string | null): void {
  // mp.ko(by): solo sends nothing
  ((h.koBy = by ? (h.nameOf?.(by) ?? `another miner`) : null), (h.state.fortune = 0), (h.fortuneMark = 0));
  const t = h.player.pos;
  ((h.state.koAt = [t.x, t.y, t.z]), (h.state.where = null), h.state.save());
}

/** KR 71785-71792 (after combat.updateFoes, before the worm and the bosses): dt = the hitstop-scaled step. */
export function updateChests(h: ChestHost, dt: number): void {
  const r = h.player;
  h.chests.update(dt, r.pos, r.vel, !h.burrow, h.world.chunks.values(), h.burrow ? h.state.lamp.sense : 0);
}

/**
 * KR 71795-71810 (after the bosses' update): the chest and satchel in reach, the satchel beams and light, and the
 * loot panel watch (frees the pointer, closes when the miner walks off, is knocked out or opens a panel).
 */
export function updateChestHints(h: ChestHost, dt: number): void {
  const r = h.player;
  if (
    ((h.chestHint = h.started && !r.lifting ? h.chests.nearest(r.pos) : null),
    h.satchels.update(dt, r.pos),
    (h.satchelHint = h.started && !r.lifting && !h.chestHint ? h.satchels.nearest(r.pos) : null),
    h.loot.open)
  ) {
    const e = h.loot.sd;
    (h.input.locked ? h.lootFreed || h.releaseLock() : (h.lootFreed = !0),
      !e ||
      Math.hypot(e.x - r.pos.x, (e.y - r.pos.y) * 0.8, e.z - r.pos.z) > 3.2 ||
      h.combat.ko ||
      h.anyPanel ||
      (!J && h.lootFreed && h.input.locked)
        ? closeLoot(h)
        : h.loot.tick());
  }
}

/** KR 71999 (after gems.update, before halos.set): chest and satchel halos join the sensed list while burrowing. */
export function chestHalos(h: ChestHost, sense: number, sensed: SonarBlip[]): void {
  const r = h.player;
  h.burrow && (h.chests.halos(r.pos, sense, sensed), h.satchels.halos(r.pos, sense, sensed));
}

/** KR.handleKeys 72184-72187: while the loot panel is open E takes all and Escape closes it; true = handled. */
export function lootKeys(h: ChestHost): boolean {
  if (!h.loot.open) return !1;
  const e = h.input;
  e.hit(`KeyE`) ? h.loot.takeAll() : e.hit(`Escape`) && closeLoot(h);
  return !0;
}

/** KR.openChest (73371): E on a chest. */
export function openChest(h: ChestHost, e: Chest): void {
  if (e.pending) return;
  e.pending = !0;
  const answer = (t: boolean) => {
    if (((e.pending = !1), t)) return lootChest(h, e);
    (h.chests.open(e),
      h.audio.deny(),
      h.ui.floater(e.pos.clone().setY(e.pos.y + 1.6), `Someone got here first`, `#ffb0a0`));
  };
  answer(!0); // EO.claimChest (48986): solo answers yes at once
}

/**
 * KR.lootChest (73385): opens the chest and rolls coins, gear, die, gem, bombs and supplies.
 * MINEAR: a mining trip gives no gear and no coins (src/base/run.ts TRIP_GIVES_GEAR / TRIP_GIVES_COINS), so a
 * chest drops its die, gem, bombs and supplies only.
 */
export function lootChest(h: ChestHost, e: Chest): void {
  (h.chests.open(e), h.state.opened.push(e.key));
  const t = Math.max(8, e.depth),
    n = 1 + t / 80,
    r = TRIP_GIVES_COINS ? Math.round([25, 70, 180][e.kind] * n * (0.7 + Math.random() * 0.6)) : 0,
    i = [
      [62, 30, 7, 1, 0],
      [22, 44, 26, 7, 1],
      [0, 26, 46, 22, 6],
    ][e.kind],
    a = !TRIP_GIVES_GEAR ? 0 : e.kind === 0 ? 1 : e.kind === 1 ? (Math.random() < 0.5 ? 2 : 1) : 2,
    o = cavernAtWorld(e.pos.x, e.pos.y, e.pos.z),
    s = o && cavernMetric(o, e.pos.x, e.pos.y, e.pos.z) < 1.8 ? o.biome : null,
    c: GearItem[] = [];
  for (let e = 0; e < a; e++) c.push(rollLootGear(i, h.state.fortuneNow, t, s && e === 0 ? { biome: s } : {}));
  const l = Math.random() < [0.1, 0.25, 0.6][e.kind],
    u = Math.random() < [0.3, 0.45, 0.6][e.kind] ? 1 + Math.floor(Math.random() * (e.kind + 1.5)) : 0,
    d: string[] = [],
    f: [string, number][] = [
      [`tonic`, 32],
      [`boulder`, 22],
      [`strength`, 18],
      [`cookie`, 14],
      [`ultjuice`, 14],
      [`smoke`, 6],
      [`birdsong`, 8],
    ],
    p = () => {
      let e = Math.random() * 100;
      for (const [t, n] of f) if ((e -= n) <= 0) return t;
      return `tonic`;
    };
  (Math.random() < [0.45, 0.6, 0.75][e.kind] && d.push(p()), e.kind === 2 && Math.random() < 0.5 && d.push(p()));
  const m: string | null =
    Math.random() < [0.15, 0.3, 0.6][e.kind] || (s && Math.random() < 0.5)
      ? s && Math.random() < 0.65
        ? BIOME_GEM[s]
        : pickGemByDepth(t)
      : null;
  (s && d.push(s === `haunt` ? `smoke` : Math.random() < 0.5 ? `tonic` : `strength`),
    e.kind === 2 && Math.random() < 0.04 && d.push(`deaddust`),
    h.state.earn(r));
  let g = 0;
  for (const e of c) h.state.addItem(e) || (g += Math.round([12, 35, 90, 240, 620][e.tier] * 0.8));
  (h.state.earn(g), h.state.save(), h.audio.chestOpen(e.kind), h.goals?.event(`chest`));
  const _ = e.pos.clone().setY(e.pos.y + 0.8),
    v = parseInt(CHEST_COLORS[e.kind].slice(1), 16);
  (h.sparks.emit({
    pos: _,
    vel: new THREE.Vector3(0, 7, 0),
    spread: 4,
    color: 16761405,
    intensity: 3.2,
    size: 0.2,
    sizeEnd: 0.04,
    life: 1.2,
    gravity: 12,
    count: 40,
    drag: 0.8,
  }),
    h.sparks.emit({
      pos: _,
      vel: new THREE.Vector3(0, 3, 0),
      spread: 2,
      color: v,
      intensity: 3.5,
      size: 0.14,
      sizeEnd: 0.02,
      life: 1.6,
      gravity: -1.5,
      count: 30,
      drag: 1.2,
    }),
    h.dust.emit({
      pos: _,
      spread: 1.4,
      color: 14206888,
      size: 0.6,
      sizeEnd: 1.8,
      alpha: 0.4,
      life: 0.9,
      drag: 2,
      count: 8,
    }),
    h.cam.addShake(0.2 + e.kind * 0.1),
    e.kind === 2 && h.ui.flash(0.25),
    r > 0 && h.ui.floater(_.clone().setY(_.y + 1), `+${r} coins`, `#ffc23d`),
    r > 0 && h.ui.bumpCoins());
  const y = c.reduce((e, t) => Math.max(e, t.tier), 0);
  (h.ui.banner(
    GO[e.kind].toUpperCase(),
    c.length
      ? c.map((e) => e.name).join(` · `) + (g ? ` (bag full: sold for ${g})` : ``)
      : [m, l ? `die` : ``, ...d, u ? `bomb` : ``]
          .filter((id): id is string => !!id)
          .map((id) => ITEM[id]?.name ?? id)
          .join(` · `),
    y >= 2 ? TIER_COLORS[y] : CHEST_COLORS[e.kind],
  ),
    c.forEach((e, t) =>
      setTimeout(
        () => {
          (h.ui.itemToast(e), h.audio.loot(e.tier));
        },
        450 + t * 380,
      ),
    ),
    l && h.pickups.spawnGem(`die`, h.gems.makeMesh(`die`), _.clone()),
    m && h.pickups.spawnGem(m, h.gems.makeMesh(m), _.clone()));
  for (let e = 0; e < u; e++) h.pickups.spawnGem(`bomb`, supplyModel(`bomb`), _.clone());
  for (const e of d) h.pickups.spawnGem(e, supplyModel(e), _.clone());
  y >= 3 && (h.hitstop = Math.max(h.hitstop, 0.12));
}

/** KR.wakeAtHome (74782): the combat respawn hook: the drop becomes a satchel, the miner wakes at the lift. */
export function wakeAtHome(h: ChestHost): void {
  const e = h.player,
    t = h.state.dropOnDeath(),
    n = t.coins > 0 || t.crystals.length > 0 || t.items.length > 0;
  (n && dropSatchel(h, e.pos, { coins: t.coins, crystals: t.crystals, items: t.items, supplies: {} }, !0),
    (h.state.koAt = null),
    h.state.save(),
    h.burrow && h.exitBurrow(!1),
    e.pos.copy(h.hub.liftTop).add(new THREE.Vector3(0, 0.5, 2.5)),
    e.vel.set(0, 0, 0),
    h.audio.lift(),
    h.ui.bumpCoins(),
    h.inv?.refresh());
  const r = h.koBy;
  ((h.koBy = null),
    h.ui.banner(
      r ? `${r.toUpperCase()} KNOCKED YOU OUT` : `KNOCKED OUT`,
      n ? `Your gems, half your coins and your spare gear lie where you fell` : `You wake up back home`,
      `#ff8a7a`,
    ));
}

/** KR.dropSatchel (74810): drops loot t on the ground under e (mine = n), into a satchel within 1.8 m if any. */
export function dropSatchel(h: ChestHost, e: THREE.Vector3, t: LootDrop, n: boolean): void {
  const r = h.world.groundBelow(e.x, e.z, e.y + 1.2, 30),
    i = new THREE.Vector3(e.x, r ?? e.y, e.z);
  {
    // mp.dropSatchel(...) is false in solo: the satchel is kept in the save
    const e = h.state.satchels.find((e) => e.mine === n && Math.hypot(e.x - i.x, e.y - i.y, e.z - i.z) < 1.8);
    if (e) {
      ((e.coins += t.coins), e.crystals.push(...t.crystals), e.items.push(...t.items));
      for (const n in t.supplies) e.supplies[n] = (e.supplies[n] ?? 0) + t.supplies[n];
      ((e.at = Date.now()), h.state.save());
    } else h.state.addSatchel({ x: i.x, y: i.y, z: i.z, mine: n, ...t, supplies: { ...t.supplies } });
    syncSatchels(h);
  }
  h.dust.emit({
    pos: i.clone().setY(i.y + 0.4),
    spread: 0.8,
    color: 13214330,
    size: 0.4,
    sizeEnd: 1.1,
    alpha: 0.5,
    life: 0.7,
    drag: 2.5,
    count: 6,
  });
}

/** KR.syncSatchels (74844), solo branch: shows the saved satchels and refreshes the open loot panel. */
export function syncSatchels(h: ChestHost): void {
  h.satchels.sync(soloSatchels(h));
  h.loot.open && h.loot.sd && h.loot.update(satchelById(h, h.loot.sd.id));
}

/** KR.soloSatchels (74864): the saved satchels with a performance.now() expiry 10 minutes after the drop. */
export function soloSatchels(h: ChestHost): SatchelData[] {
  const e = performance.now(),
    t = Date.now();
  return h.state.satchels.map((n) => ({ ...n, exp: e + n.at + 6e5 - t }));
}

/** KR.updateSatchels (74870), called at 71947 with the real dt: once a second, expired satchels go. */
export function updateSatchels(h: ChestHost, dt: number): void {
  ((h.satchelT -= dt), !(h.satchelT > 0) && ((h.satchelT = 1), h.state.expireSatchels() && syncSatchels(h)));
}

/** KR.lootSatchel (74879): E on a satchel: one thing is taken at once, else the loot panel opens. */
export function lootSatchel(h: ChestHost, e: SatchelData): void {
  if (lootSummary(e).one) return takeFromSatchel(h, e, null);
  (h.loot.show(e), (h.lootFreed = !1), h.releaseLock(), h.audio.click());
}

/** KR.takeFromSatchel (74883), solo branch: takes pick t (null = everything) from satchel e. */
export function takeFromSatchel(h: ChestHost, e: SatchelData, t: SatchelPick | null): void {
  const n = h.loot.open;
  const r = h.state.lootSatchel(e.id, t ?? void 0);
  r && (syncSatchels(h), showLoot(h, e, r, n));
}

/** KR.satchelById (74915), solo branch. */
export function satchelById(h: ChestHost, e: number): SatchelData | null {
  return soloSatchels(h).find((t) => t.id === e) ?? null;
}

/** KR.closeLoot (74921) */
export function closeLoot(h: ChestHost): void {
  h.loot.open && h.loot.hide();
}

/** KR.showLoot (74924): toasts, sound, sparks and (outside the panel, n false) the satchel banner. */
export function showLoot(h: ChestHost, e: SatchelData, t: LootDrop & { left: boolean }, n: boolean): void {
  const r = new THREE.Vector3(e.x, e.y + 1.2, e.z),
    i: string[] = [];
  (t.coins && (i.push(`+${t.coins.toLocaleString()} coins`), h.ui.bumpCoins(), h.ui.coinsToast(t.coins)),
    t.crystals.length && i.push(`${t.crystals.length} gem${t.crystals.length > 1 ? `s` : ``}`),
    t.items.length && i.push(`${t.items.length} piece${t.items.length > 1 ? `s` : ``} of gear`));
  for (const e in t.supplies) t.supplies[e] > 0 && i.push(`${t.supplies[e]} × ${ITEM[e]?.name ?? e}`);
  t.items.forEach((e, t) => setTimeout(() => h.ui.itemToast(e), (n ? 0 : 200) + t * 250));
  for (const e of t.crystals) h.ui.gemToast(e);
  for (const e in t.supplies) t.supplies[e] > 0 && supplyToast(h, e);
  (n ? h.audio.pickup() : h.audio.chestOpen(0),
    h.sparks.emit({
      pos: r,
      vel: new THREE.Vector3(0, 4, 0),
      spread: 2.5,
      color: 16765562,
      intensity: 3,
      size: 0.16,
      sizeEnd: 0.03,
      life: 0.9,
      gravity: 8,
      count: n ? 10 : 26,
    }),
    n ||
      h.ui.banner(
        e.mine ? `YOUR SATCHEL` : `A SATCHEL`,
        (i.join(` · `) || `Nothing you can carry right now`) + (t.left ? ` · no room for the rest` : ``),
        `#ffd27a`,
      ),
    h.inv?.refresh());
}

/** KR.dropGear (74961): the inventory's drop hook for a gear item (uid e, from slot t or the bag). */
export function dropGear(h: ChestHost, e: number, t?: GearSlot): boolean {
  const n = h.state.takeGear(e, t);
  return n
    ? (t && h.onStatsChanged?.(),
      dropSatchel(h, h.player.pos, { coins: 0, crystals: [], items: [n], supplies: {} }, !0),
      h.audio.drop(!1),
      !0)
    : !1;
}

/** KR.dropSupply (74974): the inventory's drop hook for t of supply e. */
export function dropSupply(h: ChestHost, e: string, t: number): boolean {
  const n = h.state.takeSupply(e, t);
  return n
    ? (dropSatchel(h, h.player.pos, { coins: 0, crystals: [], items: [], supplies: { [e]: n } }, !0),
      h.audio.drop(!1),
      !0)
    : !1;
}

/** Mk (51162) over a satchel: what the HUD hint and the touch use button say (KrHudHost.describeSatchel). */
export const describeSatchel = (s: SatchelData): { one: boolean; what: string } => lootSummary(s);
