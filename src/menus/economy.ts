// Port of play-inUT-NSi.js 73248-73370 (KR economy: stat changes, equip, the Wellspring hooks and the
// Trading Post trades) and 73568-73583 (KR.coinShower, used only by buy).
// Each KR method is a function here that takes the game object through EconomyHost. KR calls them:
//   onStatsChanged()          after equip / unequip (70652), onSent, onPicked
//   equip(uid, slot)          inventory hP act.equip (70651)
//   onShattered(gem), onSent(gems), onPicked(card)   Wellspring pN act shattered / sent / picked (70635-70645)
//   sellItem, sellCrystal, buy, restock               Trading Post nN act (70627-70634, createMenu in panels.ts)
// Members of EconomyHost marked optional belong to systems of later owners (inventory, wardrobe, goals,
// tutorial); when one is missing its call is skipped.
import * as THREE from 'three';
import { ITEMS, RARITY_COLORS, type ItemDef } from '../world/items';
import { STATS, type StatOffer } from '../state/gearStats';
import { TIER_COLORS, rarerGem } from '../state/progression';
import type { GearSlot } from '../state/gear';
import type { PlayerState } from '../state/playerState';
import type { EmitOptions } from '../fx/particles';
import type { JetStats } from '../player/controller';
import type { HubSpot } from '../hub/hub';
import type { Hud } from '../ui/hud';
import { RARITY_TIER } from '../pickups/souls';
import { supplyToast, type PickupHost } from '../pickups/collect';
import type { TradingPost } from './tradingPost';

const ITEM = ITEMS as Record<string, ItemDef>;

// KR module scratch ($ and MR, 70040-70041)
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR

/** The audio methods used here (dM, src/audio/audio.ts). */
export interface EconomyAudio {
  equip(): void;
  deny(): void;
  deposit(value: number): void;
  purchase(): void;
  loot(tier: number): void;
  crystalShatter(rarity: number): void;
  diceRoll(): void;
  gem(rarity: number): void;
}

/** The game object (KR) as the economy reads and writes it. */
export interface EconomyHost {
  state: PlayerState;
  player: { pos: THREE.Vector3; speedMul: number; stats: JetStats; fuel: number };
  model: { emote(clip: string): void };
  audio: EconomyAudio;
  ui: Pick<Hud, 'bumpCoins' | 'bumpCrystals' | 'itemToast' | 'banner' | 'findToast' | 'icons'>;
  hub: {
    flare(spot: HubSpot, k?: number, color?: number): void;
    spiritTop: THREE.Vector3;
    vaultPad: THREE.Vector3;
  };
  sparks: { emit(o: EmitOptions): void };
  cam: { addShake(k: number): void };
  combat: { hp: number; maxHp: number };
  /** nN, the Trading Post panel (createMenu in src/menus/panels.ts). */
  menu: Pick<TradingPost, 'refresh'>;
  // later owners (optional)
  /** KR.syncLook (73018): the miner wears the gear (wardrobe, inventory owner). */
  syncLook?(): void;
  /** hP inventory panel. */
  inv?: { refresh(): void };
  /** KA goals. */
  goals?: { event(kind: string, n?: number): void };
  /** VN tutorial. */
  tutorial?: { sentGems(): void };
}

/** KR.onStatsChanged (73248): stats moved (gear, cards): speed, jetpack, look and the inventory. */
export function onStatsChanged(g: EconomyHost): void { // KR.onStatsChanged (73248)
  g.player.speedMul = g.state.moveMul;
  g.player.stats = { ...g.state.jet };
  g.syncLook?.();
  g.inv?.refresh();
}

/** KR.equip (73254): puts on bag item uid (into slot, when given). */
export function equip(g: EconomyHost, uid: number, slot?: GearSlot): boolean { // KR.equip (73254)
  if (g.state.equip(uid, slot)) {
    g.audio.equip();
    g.model.emote(`Interact`);
    g.goals?.event(`equip`);
    onStatsChanged(g);
    return true;
  }
  g.audio.deny();
  return false;
}

/** KR.onShattered (73263): a gem shattered at the Wellspring (null: no gem). */
export function onShattered(g: EconomyHost, gem: string | null): void { // KR.onShattered (73263)
  const t = gem ? ITEM[gem].color : 16769162;
  g.hub.flare(`fountain`, 2, t);
  const n = g.hub.spiritTop;
  for (let e = 0; e < 3; e++)
    g.sparks.emit({
      pos: n,
      vel: new THREE.Vector3(0, 5, 0),
      spread: 9,
      color: [t, 16777215, t][e],
      intensity: 3.4,
      size: 0.24,
      sizeEnd: 0.02,
      life: 1.6,
      gravity: 2,
      count: 40,
      drag: 1.2,
    });
  g.cam.addShake(0.3);
}

/** KR.onSent (73283): gems sent into the Wellspring. */
export function onSent(g: EconomyHost, gems: string[]): void { // KR.onSent (73283)
  g.goals?.event(`bank`);
  g.goals?.event(`shatter`, gems.length);
  g.tutorial?.sentGems();
  const t = gems.reduce<string | null>((e, t) => rarerGem(e, t), null)!;
  g.hub.flare(`fountain`, 1.4, ITEM[t].color);
  g.audio.gem(Math.min(5, RARITY_TIER[ITEM[t].rarity]));
  g.ui.bumpCrystals();
  g.inv?.refresh();
  onStatsChanged(g);
}

/** KR.onPicked (73292): a Wellspring card picked. */
export function onPicked(g: EconomyHost, card: StatOffer): void { // KR.onPicked (73292)
  const color = parseInt(TIER_COLORS[card.tier].slice(1), 16);
  g.hub.flare(`fountain`, 1.2, color);
  g.model.emote(`Cheering`);
  onStatsChanged(g);
  if (card.id === `fuel`) g.player.fuel = g.state.jet.fuelMax;
  if (card.id === `hp`) g.combat.hp = g.combat.maxHp;
  const t = g.player.pos;
  g.sparks.emit({
    pos: T0.set(t.x, t.y + 1, t.z),
    vel: T1.set(0, 3, 0),
    spread: 3,
    color,
    intensity: 3,
    size: 0.16,
    sizeEnd: 0.02,
    life: 1.2,
    gravity: -1.5,
    count: 50,
    drag: 1.4,
  });
  const s = STATS[card.id];
  if (s.perk) g.ui.banner(s.name.toUpperCase(), s.blurb, TIER_COLORS[card.tier]);
}

/** KR.sellItem (73314): sells bag gear uid at the Trading Post. */
export function sellItem(g: EconomyHost, uid: number): boolean { // KR.sellItem (73314)
  const t = g.state.sellItem(uid);
  if (!t) return false;
  g.audio.deposit(t);
  g.ui.bumpCoins();
  g.hub.flare(`trade`, 0.6);
  g.menu.refresh();
  return true;
}

/** KR.sellCrystal (73324): sells one gem of an id. */
export function sellCrystal(g: EconomyHost, id: string): boolean { // KR.sellCrystal (73324)
  const t = g.state.sellCrystal(id);
  if (!t) return false;
  g.audio.deposit(t);
  g.ui.bumpCoins();
  g.hub.flare(`trade`, 0.6);
  g.menu.refresh();
  return true;
}

/** KR.buy (73334): buys stock entry i. */
export function buy(g: EconomyHost, i: number): boolean { // KR.buy (73334)
  const t = g.state.buy(i);
  if (!t) {
    g.audio.deny();
    return false;
  }
  g.audio.purchase();
  g.hub.flare(`trade`, 1);
  coinShower(g, g.hub.vaultPad, 16761405);
  g.goals?.event(`buy`);
  if (t.item) {
    g.audio.loot(t.item.tier);
    g.ui.itemToast(t.item);
  } else if (t.kind === `supply` && t.supply) {
    // supplyToast (74055) reads only state.belt and ui.findToast / ui.icons
    supplyToast(g as unknown as PickupHost, t.supply);
  } else if (t.kind === `die`) g.ui.banner(`REROLL DIE`, `Spend it at the Wellspring to redraw the cards`, `#c38bff`);
  else if (t.crystal) {
    const e = ITEM[t.crystal];
    g.audio.crystalShatter(
      Math.max(0, [`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`].indexOf(e.rarity) - 1),
    );
    g.ui.banner(`${e.name.toUpperCase()}!`, `Cracked from the geode · in your cart`, RARITY_COLORS[e.rarity]);
    g.ui.bumpCrystals();
    g.inv?.refresh();
  }
  g.menu.refresh();
  return true;
}

/** KR.restock (73366): pays for a fresh stock now. */
export function restock(g: EconomyHost): boolean { // KR.restock (73366)
  if (g.state.restock()) {
    g.audio.diceRoll();
    g.menu.refresh();
    return true;
  }
  g.audio.deny();
  return false;
}

/** KR.coinShower (73568): three bursts of coin sparks over a point (white, then the color twice). */
export function coinShower(g: Pick<EconomyHost, 'sparks'>, at: THREE.Vector3, color: number): void { // KR.coinShower (73568)
  for (let n = 0; n < 3; n++)
    g.sparks.emit({
      pos: at.clone().add(new THREE.Vector3(0, 0.6, 0)),
      vel: new THREE.Vector3(0, 7, 0),
      spread: 5,
      color: n ? color : 16777215,
      intensity: 3,
      size: 0.2,
      sizeEnd: 0.04,
      life: 1.1,
      gravity: 11,
      count: 18,
      drag: 0.8,
    });
}
