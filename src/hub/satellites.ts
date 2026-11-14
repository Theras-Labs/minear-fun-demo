// The small floating islands around the base (folder: minear-r3f/src/hub). Hub (src/hub/hub.ts) builds them;
// MINEAR's merchants stand on six of them, one each (src/npc/merchants.ts).
// Each entry: [angle in degrees, distance from the lift, y (hub-local), radius]. The island sits at
// (cos(angle) * distance, y, -sin(angle) * distance) in the hub group, which stands at LIFT_POINT unrotated.
export const SATELLITES: [number, number, number, number][] = [ // ne (49790)
  [20, 28, -3, 3.4],
  [58, 34, 3.5, 2.8],
  [100, 31, -5, 3.8],
  [140, 36, 1, 3],
  [185, 29, -2, 3.6],
  [228, 35, 5, 2.6],
  [270, 30, -4.5, 3.2],
  [318, 34, 2, 3],
];

/** MINEAR: the satellite (index into SATELLITES) each merchant (src/economy/pricing.ts MERCHANTS id) stands on.
 *  Their tree or bush is left off; the merchant's stall stands there instead. */
export const MERCHANT_ISLAND: Record<string, number> = {
  smelter: 0,
  jeweler: 2,
  wanderer: 3,
  quartermaster: 4,
  relics: 6,
  gemcutter: 7,
};

/** Satellite indexes that carry a merchant. */
export const MERCHANT_ISLANDS = new Set(Object.values(MERCHANT_ISLAND));
