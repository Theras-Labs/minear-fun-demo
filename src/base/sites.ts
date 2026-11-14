// MINEAR base: the building sites on the island around the lift. Four are open from the start (Trade Post,
// Refinery, Forge, Requests Board). The others are bare roped-off plots with a name sign: nothing of the
// building shows until it unlocks by an objective. The Capsule Machine works once unlocked; the rest show
// "opening soon" until their system is built. The Trade Post is the original house from hub2.glb.
// Angles are degrees from north (-z), clockwise; r is the distance from the lift centre (island-local metres).

export type SiteId =
  | 'trade'
  | 'exchange'
  | 'refinery'
  | 'board'
  | 'capsule'
  | 'statue'
  | 'farm'
  | 'diner'
  | 'warp'
  | 'forge';

/** What the unlock rules read. */
export interface UnlockView {
  deepest: number;
  level: number;
  /** Beasts slain (souls carried or given). */
  beasts: number;
  /** Signed in on NEAR (Google sign-in, or the Demo cheat's local testnet account). */
  wallet: boolean;
}

export interface SiteUnlock {
  /** "Reach 120 m down" */
  text: string;
  /** [now, need] for the progress bar. */
  progress(v: UnlockView): [number, number];
}

export interface SiteDef {
  id: SiteId;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** What it will do (locked sites). */
  plan: string;
  angle: number;
  r: number;
  /** Footprint width (along the ring) and depth (toward the edge), metres. */
  w: number;
  d: number;
  /** Accent colour (sign, panel theme). */
  color: string;
  /** Null: open from the start. */
  unlock: SiteUnlock | null;
  /** The system behind it works in this build. */
  built: boolean;
  /** The building comes from hub2.glb (the original Trading Post house); no model or plot is made. */
  legacy?: boolean;
  /** Model scale (the footprint w and d are already scaled). */
  scale?: number;
}

const need = (text: string, get: (v: UnlockView) => number, n: number): SiteUnlock => ({
  text,
  progress: (v) => [Math.min(n, Math.max(0, Math.floor(get(v)))), n],
});

export const SITES: SiteDef[] = [
  {
    id: `trade`,
    name: `Trade Post`,
    blurb: `Sell gems and gear, buy supplies`,
    plan: ``,
    angle: 0,
    r: 11.8,
    w: 8.4,
    d: 6.6,
    color: `#2fa39a`,
    unlock: null,
    built: true,
    legacy: true,
  },
  {
    id: `exchange`,
    name: `NEAR Exchange`,
    blurb: `The on-chain market`,
    plan: `Trade rare gems and gear with other miners on NEAR.`,
    angle: 40,
    r: 13.0,
    w: 3.4,
    d: 3,
    color: `#7af7c9`,
    unlock: need(`Sign in with Google`, (v) => +v.wallet, 1),
    built: false,
  },
  {
    id: `refinery`,
    name: `Refinery`,
    blurb: `Smelt ore into the next ore up`,
    plan: ``,
    angle: 280,
    r: 12.4,
    w: 5,
    d: 4.4,
    color: `#e8603c`,
    unlock: null,
    built: true,
  },
  {
    id: `board`,
    name: `Requests Board`,
    blurb: `Jobs from the island, with rewards`,
    plan: ``,
    angle: 72,
    r: 12.4,
    w: 5.5,
    d: 2.0,
    color: `#c9823c`,
    unlock: null,
    built: true,
    scale: 1.45,
  },
  {
    id: `capsule`,
    name: `Capsule Machine`,
    blurb: `One Capsule Coin, one spin`,
    plan: `Spin for coins, ore, gems, supplies and gear.`,
    angle: 129,
    r: 12.4,
    w: 2.8,
    d: 2.8,
    color: `#ff5a7a`,
    unlock: need(`Reach 120 m down`, (v) => v.deepest, 120),
    built: true,
  },
  {
    id: `statue`,
    name: `Guildmaster Statue`,
    blurb: `Reports to the Guildmaster`,
    plan: `File your expedition reports and send word to the Guildmaster.`,
    angle: 151,
    r: 12.8,
    w: 3,
    d: 3,
    color: `#9fb8ff`,
    unlock: need(`Reach miner level 3`, (v) => v.level, 3),
    built: false,
  },
  {
    id: `farm`,
    name: `Farm`,
    blurb: `Grow food for the deep`,
    plan: `Plant cave seeds, harvest crops for the Diner.`,
    angle: 216,
    r: 13.0,
    w: 6,
    d: 4.4,
    color: `#7cc95a`,
    unlock: need(`Reach miner level 5`, (v) => v.level, 5),
    built: false,
  },
  {
    id: `diner`,
    name: `Diner`,
    blurb: `Hot meals, long digs`,
    plan: `Cook farm crops into meals that buff your next dig.`,
    angle: 249,
    r: 12.6,
    w: 5.4,
    d: 4.4,
    color: `#ffb347`,
    unlock: need(`Reach 260 m down (Obsidian)`, (v) => v.deepest, 260),
    built: false,
  },
  {
    id: `warp`,
    name: `Dungeon Warp`,
    blurb: `Co-op missions with other miners`,
    plan: `Warp into a dungeon with your crew: a separate mission, played together.`,
    angle: 103,
    r: 12.6,
    w: 4.6,
    d: 2.6,
    color: `#b07aff`,
    unlock: need(`Slay a mythical beast`, (v) => v.beasts, 1),
    built: false,
  },
  {
    id: `forge`,
    name: `Forge`,
    blurb: `Make gear, salvage it, reroll its enchants`,
    plan: ``,
    angle: 314,
    r: 12.6,
    w: 5.4,
    d: 4.4,
    color: `#d9a441`,
    unlock: null,
    built: true,
  },
];

export const SITE_BY_ID = Object.fromEntries(SITES.map((s) => [s.id, s])) as Record<SiteId, SiteDef>;
export const SITE_IDS = SITES.map((s) => s.id);
export const isSiteId = (v: unknown): v is SiteId => typeof v === `string` && Object.hasOwn(SITE_BY_ID, v);

/** The site is open (no rule, or its rule is met). */
export function siteOpen(s: SiteDef, v: UnlockView): boolean {
  if (!s.unlock) return true;
  const [n, k] = s.unlock.progress(v);
  return n >= k;
}

/** open: usable now; soon: rule met but its system is not built yet; locked: rule not met. */
export type SiteStatus = 'open' | 'soon' | 'locked';

export function siteStatus(s: SiteDef, v: UnlockView): SiteStatus {
  if (!siteOpen(s, v)) return `locked`;
  return s.built ? `open` : `soon`;
}

/** Island-local centre (x, z) of a site, and the yaw that faces the lift. */
export function sitePlace(s: SiteDef): { x: number; z: number; yaw: number } {
  const a = (s.angle * Math.PI) / 180;
  const x = Math.sin(a) * s.r;
  const z = -Math.cos(a) * s.r;
  // the front (+z of the model) turns toward the lift centre
  return { x, z, yaw: Math.atan2(-x, -z) };
}

/** Island-local spot in front of a site where the player stands to use it. */
export function siteFront(s: SiteDef): { x: number; z: number } {
  const p = sitePlace(s);
  const k = (s.r - s.d / 2 - 1.5) / s.r;
  return { x: p.x * k, z: p.z * k };
}
