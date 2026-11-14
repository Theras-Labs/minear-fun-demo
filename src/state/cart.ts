// MINEAR: the Cart, the miner's one view of everything carried (folder: minear-r3f/src/state).
// The Cart page of the inventory (minear-r3f/src/menus/inventory.ts, page id `pack`) shows one grid of slot tiles:
// the gems (the gem slots, PlayerState.pack, and the loose gems, PlayerState.crystals), the ore bin
// (PlayerState.ores), the supplies, the reroll dice and the Dead Dust. Equipment is NOT cart goods (the user,
// 2026-11-13): spare gear (PlayerState.items) has its own gear bag, shown by the Gear page's slot chooser.
//
// The storage is merged in the VIEW only. The storage rules do not change:
//   - gems still obey the gem slots: PlayerState.capacity = 8 + the `pack` stat ("Cart Slots"),
//   - ore, supplies, dice and Dead Dust have no slot limit (supplies keep their stack limit per kind),
//   - spare gear is not in the Cart; its gear bag keeps its own limit (PlayerState.bagFull, 24 pieces).
// The Cart shows cartSlots(s) slots open: the gem slots plus CART_EXTRA slots of room for the ore, supply and pocket
// tiles. The rest of the grid shows as locked slots. Pickups and saves do not read these numbers.

/** Open Cart slots past the gem slots: room for the ore, supply and pocket tiles. */
export const CART_EXTRA = 12;

/** Columns of the Cart grid (it grows to 8, then 10 columns when more tiles must show). */
export const CART_COLS = 6;
/** Rows of the Cart grid at least (6 x 5 = 30 tiles). */
export const CART_ROWS = 5;

/** Open Cart slots: the gem slots (s.capacity, 8 + the Cart Slots stat) plus CART_EXTRA. */
export function cartSlots(s: { capacity: number }): number {
  return Math.max(0, Math.round(s.capacity)) + CART_EXTRA;
}
