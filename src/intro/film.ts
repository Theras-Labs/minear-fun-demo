// The MINEAR intro film: one unbroken camera move along a slice of the real game world, seen from the side
// like a cut cake. It starts on nearmol, the mole, at the edge of the cut, pulls back to the land and the
// floating hub, falls down the cut face through every rock layer, its tunnels, ore and gems, to the Inner
// Core at 100,000 m; the core wakes up; then the rise back to the surface: two bosses in their caverns,
// "and many more" past two more, a hidden chest and its rewards, the mole mining ore and gems out of the
// cut, and back up to the land, where the mole bursts out of the ground for the closing line and the logo.
// soundCues() and soundState(t) give the sound track (src/intro/soundtrack.ts) its timing.
// Time is driven from outside (renderAt(t)), so a capture can step it frame by frame (src/dev/IntroPage.tsx).
import * as THREE from 'three';
import { ChunkManager } from '../world/chunkManager';
import { chunkKey } from '../world/chunk';
import { surfaceHeight } from '../world/generate';
import { cavernAt, cavernFloorY, type Cavern } from '../world/caverns';
import { Environment } from '../sky/environment';
import { createPostChain, type PostChain } from '../post/composer';
import { terrainUniforms } from '../render/terrainMaterial';
import { biomeUniforms } from '../render/biomeRock';
import { ATMO, setLook } from '../render/atmosphere';
import { GrassField } from '../render/grass';
import { Decor } from '../decor/decor';
import { FarForest } from '../decor/farForest';
import { Hub } from '../hub/hub';
import { loadHub } from '../hub/hubAssets';
import { loadCaveKit, type CaveKit } from '../hub/caveKit';
import { loadBiomeKit, type BiomeKit } from '../cave/biomeKit';
import { CaveDecor, caveRoomTest, caveGroundProbe } from '../cave/caveDecor';
import { BiomeAmbience } from '../cave/biomeAmbience';
import { GemField } from '../gems/gemField';
import { Chests, loadChests } from '../chests/chests';
import { FoeViews } from '../foes/foeViews';
import { loadFoes } from '../foes/assets';
import { FOE_LOOPS, FOE_STATES } from '../foes/types';
import { loadBosses, type BossAsset } from '../bosses/view/assets';
import { BossView, bossInfo, createBossViewHost, tellBossView, type StandaloneBossHost } from '../bosses/view/bossView';
import { BOSS_LIGHTS } from '../bosses/view/constants';
import { BOSS_DEFS, bossLair, type BossKind } from '../bosses/sim/defs';
import { loadMiner, type MinerAsset } from '../miner/loader';
import { stylizeMaterial } from '../miner/stylize';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MATERIALS, Mat } from '../world/materials';
import { InnerCore } from './innerCore';
import { GroundSlice, type SliceBox } from './slice';

export const FILM_W = 1920;
export const FILM_H = 1080;
export const FILM_FPS = 60;

export interface FilmAssets {
  hub: THREE.Group;
  cave: CaveKit | null;
  biome: BiomeKit | null;
  chests: THREE.Group | null;
  foes: Awaited<ReturnType<typeof loadFoes>>;
  bosses: BossAsset | null;
  /** nearmol, the player's mole (src/miner/loader.ts). */
  mole: MinerAsset | null;
}

export async function loadFilmAssets(): Promise<FilmAssets> {
  const [hub, cave, biome, chests, foes, bosses, mole] = await Promise.all([
    loadHub(),
    loadCaveKit(),
    loadBiomeKit(),
    loadChests(),
    loadFoes(),
    loadBosses(),
    loadMiner().catch(() => null),
  ]);
  return { hub, cave, biome, chests, foes, bosses, mole };
}

/** What the page draws over the 3D frame. Every number is 0..1 unless stated. */
export interface FilmOverlay {
  caption: string;
  captionK: number;
  /** Big rolling depth counter (metres), or null. */
  counter: number | null;
  counterK: number;
  /** Rock layer name during the fall. */
  layer: string;
  layerK: number;
  layerTint: string;
  /** Rising glow line: 0 = bottom of the frame, 1 = top; < 0 hides it. */
  wipe: number;
  /** Vertical speed streaks: strength, and the screen direction they move (-1 up, 1 down). */
  speed: number;
  streakDir: number;
  flash: number;
  flashColor: string;
  fade: number;
  /** The closing line, then the logo after it. */
  banner: string;
  bannerK: number;
  logo: number;
}

const blankOverlay = (): FilmOverlay => ({
  caption: '',
  captionK: 0,
  counter: null,
  counterK: 0,
  layer: '',
  layerK: 0,
  layerTint: '#fff6e5',
  wipe: -1,
  speed: 0,
  streakDir: -1,
  flash: 0,
  flashColor: '#ffffff',
  fade: 0,
  banner: '',
  bannerK: 0,
  logo: 0,
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** 0 before a, rises to 1 over `inn`, holds, falls to 0 over `out` before b. */
const window01 = (t: number, a: number, b: number, inn = 0.25, out = 0.25) => Math.min(smooth(a, a + inn, t), 1 - smooth(b - out, b, t));
const lerp = THREE.MathUtils.lerp;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

/** Seeded value noise for camera shake. */
function shakeNoise(t: number, seed: number): number {
  const s = (x: number) => Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453;
  const f = (x: number) => s(x) - Math.floor(s(x));
  const i = Math.floor(t);
  const u = t - i;
  return lerp(f(i), f(i + 1), u * u * (3 - 2 * u)) * 2 - 1;
}

// ---------------------------------------------------------------- the slice and the timeline

/** The cut: the voxel layer z = 120 crosses four biome caverns near the hub, among them Rimeheart's lair. */
const SLICE: SliceBox = { z: 120, x0: -224, x1: 224, y0: -1584, y1: 32 };
const Z = SLICE.z;
/** Camera distance from the cut for the wide view, and its field of view. */
const D_FAR = 75;
const FOV = 40;
const CORE_DEPTH = 100_000;
/** The core chamber sits this deep in the real world; the counter runs from 1,000 m to 100,000 m on the way. */
const REAL_CORE = 1500;

const T = {
  /** The mole waves, then the camera pulls back from it to the land. */
  wave: 0.35,
  pull: 1.5,
  descend: 3.7,
  core: 10.1,
  coreEnd: 15.7,
  out: 16.5,
  /** End of the last stop on the way up; then the camera rises to the mole. */
  top: 27.3,
  surface: 28.6,
  banner: 31.55,
  end: 34.35,
};
/** On the land the mole bursts out of the ground just before the camera arrives, and lands. */
const BREACH = T.surface - 0.35;
const LANDED = T.surface + 0.15;
/** The mole stands on the land at the edge of the cut. */
const MOLE_X = 8;
const MOLE_Z = Z - 0.9;
export const FILM_DURATION = T.end;

const LAYERS: { to: number; name: string; tint: string }[] = [
  { to: 4, name: 'DIRT', tint: '#ffd9a0' },
  { to: 30, name: 'SANDSTONE', tint: '#ffd9a0' },
  { to: 72, name: 'STONE', tint: '#e2dcff' },
  { to: 135, name: 'SLATE', tint: '#b9d6e2' },
  { to: 260, name: 'THE ABYSS', tint: '#b8aaff' },
  { to: 420, name: 'THE OBSIDIAN', tint: '#a9c0ff' },
  { to: 620, name: 'THE EMBERSTONE', tint: '#ff9a5c' },
  { to: 900, name: 'THE VOIDSTONE', tint: '#c8a2ff' },
  { to: 1000, name: 'THE HEARTSTONE', tint: '#ff8ac6' },
  { to: 1e9, name: 'THE INNER CORE', tint: '#ffb26b' },
];

/** The fall: speed rises late and drops to zero at the core (a normalised integral of u^2 (1-u)^0.55). */
const FALL = (() => {
  const n = 512;
  const out = new Float32Array(n + 1);
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    const u = (i - 0.5) / n;
    sum += u * u * Math.pow(1 - u, 0.55);
    out[i] = sum;
  }
  for (let i = 0; i <= n; i++) out[i] /= sum;
  return (u: number) => {
    const x = clamp01(u) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return lerp(out[i], out[i + 1], x - i);
  };
})();

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}
interface Key extends Pose {
  t: number;
}

/** Stops on the way up: a boss (zoom), a pass (no zoom, "and many more"), the chest and the mining. */
type StopKind = 'boss' | 'pass' | 'chest' | 'mine';
interface Stop {
  kind: StopKind;
  /** The point the camera frames. */
  at: THREE.Vector3;
  /** Distance from the camera to `at` when zoomed in (a pass: the distance it looks from). */
  dist: number;
  /** Distance of the wider view on the way to it. */
  wideD: number;
  /** Seconds this stop takes, the move to it included (scaled to fit T.out..T.top). */
  span: number;
  caption: string;
  /** Set by buildKeys: start and end of the stop, and the moment the zoom starts. */
  start: number;
  end: number;
  t0: number;
  boss?: BossKind;
}

const CAPTION_BEASTS = 'Its heat is waking the beasts of the deep.';
const CAPTION_MORE = 'And many more...';
const CAPTION_CHEST = 'Open hidden chests for rewards.';
const CAPTION_MINE = 'Mine ore and gems all over the ground.';

/** One sound of the film at time t (src/intro/soundtrack.ts plays it with the game's own sounds). */
export interface SoundCue {
  t: number;
  id: string;
  k?: number;
}
/** What the sound track follows from frame to frame. */
export interface SoundState {
  /** 0 on the land, 1 deep in the ground. */
  under: number;
  /** Metres above the land. */
  height: number;
  /** Vertical speed of the camera, m/s. */
  speed: number;
  biome: string | null;
  biomeK: number;
  /** Boss music layer 0..1. */
  boss: number;
  /** Music level 0..1. */
  music: number;
}

/**
 * The mining: the mole stands in a small burrow on the cut and claws its way along a vein, one column of
 * 1 m cells at a time. Rows go up from the floor; each cell is plain rock (null), an ore, or rock with a gem.
 */
const VEIN: (null | 'copper' | 'iron' | 'gold' | 'emerald' | 'sapphire' | 'ruby')[][] = [
  [null, 'copper', 'copper'],
  ['iron', null, 'emerald'],
  ['copper', 'gold', null],
  ['sapphire', 'iron', 'gold'],
  ['gold', 'ruby', 'gold'],
];
const ORE_MAT = { copper: Mat.Copper, iron: Mat.Iron, gold: Mat.Gold } as const;
/** Seconds between two claw strokes (one column each), and where in the claw clip the stroke lands (0..1). */
const STROKE = 0.48;
/** Seconds a piece of loot flies from the vein to the mole. */
const FLIGHT = 0.45;
const MINE_HIT = 0.5;

/** A gold coin for the chest rewards (the satchel coin look, src/chests/satchels.ts). */
const COIN_GEO = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 22).rotateX(Math.PI / 2);
const COIN_MAT = new THREE.MeshStandardMaterial({ color: 0xffc13d, roughness: 0.3, metalness: 0.85, emissive: 0x7a4a00, emissiveIntensity: 0.6 });

/** A soft four-point glint for the loot the mole picks up. */
function glintTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, '#ffffffff');
  r.addColorStop(0.18, '#fff6dccc');
  r.addColorStop(0.5, '#ffe6a022');
  r.addColorStop(1, '#ffe6a000');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [
    [64, 3],
    [3, 64],
  ]) {
    const l = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    l.addColorStop(0, '#ffffffff');
    l.addColorStop(1, '#ffffff00');
    g.fillStyle = l;
    g.fillRect(32 - w / 2, 32 - h / 2, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

export class IntroFilm {
  readonly camera = new THREE.PerspectiveCamera(FOV, FILM_W / FILM_H, 0.1, 2400);
  readonly world = new ChunkManager();
  readonly env: Environment;
  readonly post: PostChain;
  readonly grass: GrassField;
  readonly decor: Decor;
  readonly farForest: FarForest;
  readonly hub: Hub;
  readonly gems: GemField;
  readonly caveDecor: CaveDecor;
  readonly biomes = new BiomeAmbience();
  readonly chests: Chests;
  readonly foes: FoeViews;
  readonly core = new InnerCore(7);
  readonly slice: GroundSlice;
  readonly focus = new THREE.Vector3();
  readonly shots: { id: string; at: number }[] = [];
  overlay = blankOverlay();

  private clipPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), Z + 0.15)];
  private sliceZ = { value: Z + 0.15 };
  private noClip = new Set<THREE.Material>();
  private bossHost: StandaloneBossHost | null = null;
  private bosses = new Map<BossKind, { view: BossView; at: THREE.Vector3 }>();
  private lamp = new THREE.SpotLight(0xffe2b4, 0, 260, 0.75, 0.8, 0.6);
  private fill = new THREE.PointLight(0xffd9a8, 0, 160, 0.7);
  private warm: THREE.PointLight[] = [0, 1, 2].map(() => new THREE.PointLight(0xffb36b, 0, 14, 1.4));
  private warmSpots: THREE.Vector3[] = [];
  private coreAt = new THREE.Vector3();
  private stops: Stop[] = [];
  private keys: Key[] = [];
  private captions: { text: string; a: number; b: number }[] = [];
  private roared = new Set<BossKind>();
  private mole: {
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    idle: THREE.AnimationAction | null;
    wave: THREE.AnimationAction | null;
    cheer: THREE.AnimationAction | null;
    jump: THREE.AnimationAction | null;
    at: THREE.Vector3;
  } | null = null;
  /** The same mole underground, mining (a second copy of the model). */
  private miner: {
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    idle: THREE.AnimationAction | null;
    dig: THREE.AnimationAction | null;
    jump: THREE.AnimationAction | null;
    x0: number;
    y: number;
  } | null = null;
  /** The burrow and the vein on the cut (cells written into the slice), the loot and the light. */
  private mine: {
    floor: THREE.Vector3;
    burrow: { x: number; y: number; d: number; m: number }[];
    cols: { x: number; cells: { y: number; d: number; m: number; ore: number }[] }[];
    loot: { o: THREE.Object3D; col: number; from: THREE.Vector3; size: number; gem: boolean; rest: THREE.Euler }[];
    glints: THREE.Sprite[];
    light: THREE.PointLight;
    /** Claw strokes (one per column), the dive into the ground; set by buildKeys. */
    hits: number[];
    dive: number;
    state: number;
  } | null = null;
  /** Bits of rock thrown out by the claws, the dive and the burst on the land. */
  private bits: THREE.InstancedMesh | null = null;
  private bursts: { t: number; at: THREE.Vector3; first: number; n: number; vel: THREE.Vector3[]; size: number[] }[] = [];
  private chest: {
    lid: THREE.Object3D | null;
    at: THREE.Vector3;
    loot: { o: THREE.Object3D; to: THREE.Vector3; size: number }[];
    light: THREE.PointLight;
  } | null = null;
  private lastT = -1;
  private skyShown = -1;
  private surfaceY0: number;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly scene: THREE.Scene,
    assets: FilmAssets,
  ) {
    scene.matrixAutoUpdate = false;
    renderer.setPixelRatio(1);
    renderer.setSize(FILM_W, FILM_H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.localClippingEnabled = true;

    this.env = new Environment(scene);
    this.env.clock.frozen = 0.4;
    this.world.useBatch();
    scene.add(this.world.group);
    this.post = createPostChain(renderer, scene, this.camera, 'ultra');
    this.post.composer.setPixelRatio(1);
    this.post.composer.setSize(FILM_W, FILM_H);
    this.post.outline.enabled = true;
    setLook('painterly');

    this.gems = new GemField(this.world);
    this.caveDecor = new CaveDecor(assets.cave, caveRoomTest(this.world), 1, assets.biome, caveGroundProbe(this.world));
    this.world.onChunkMeshed = (c) => this.gems.spawnForChunk(c);
    this.world.onChunkUnloaded = (c, deleted) => {
      this.gems.unloadChunk(c, deleted);
      this.caveDecor.unloadChunk(c);
    };
    // biome liquid pools are shader materials: cut them at the slice in their own clip test
    const poolMat = this.biomes.poolMat.bind(this.biomes);
    this.biomes.poolMat = (kind, clip) => {
      const m = poolMat(kind, clip);
      m.uniforms.uSliceZ = this.sliceZ;
      m.fragmentShader = m.fragmentShader.replace('bool clipped() {', 'uniform float uSliceZ;\nbool clipped() {\n  if (vW.z > uSliceZ) return true;');
      return m;
    };
    scene.add(this.gems.group, this.caveDecor.group, this.biomes.group);

    this.decor = new Decor(this.world);
    scene.add(this.decor.group);
    this.farForest = new FarForest(renderer);
    scene.add(this.farForest.mesh);
    this.grass = new GrassField('ultra');
    this.grass.enableHub();
    scene.add(this.grass.group);
    terrainUniforms.uGrassR.value = this.grass.farRadius;
    this.world.onMeshChanged = (c) => {
      if (c.cy >= -2) this.grass.markDirty(c.cx * 16 + 8, c.cz * 16 + 8);
    };
    this.hub = new Hub(assets.hub, assets.cave);
    this.hub.group.updateMatrixWorld(true);
    scene.add(this.hub.group);

    this.chests = new Chests(this.world as never, () => false, assets.chests);
    this.foes = new FoeViews(assets.foes, {
      rose: () => {},
      windup: () => {},
      died: () => {},
      hit: () => {},
      aura: () => {},
      mending: () => {},
      burrowing: () => {},
      slam: () => {},
    });
    scene.add(this.foes.group, this.core.group);
    scene.add(this.lamp, this.lamp.target, this.fill, ...this.warm);
    scene.add(BOSS_LIGHTS.glow, BOSS_LIGHTS.flash);

    this.surfaceY0 = surfaceHeight(0, Z);
    this.coreAt.set(0, surfaceHeight(0, Z - 22) - REAL_CORE, Z - 22);

    // carve first, then read the cut: the core chamber, the small pockets that hold chests on the way down,
    // and a hidden hall near the top for a chest and its rewards
    this.carveRoom(this.coreAt, 30, 9, 77);
    // the burrow where the mole mines: solid rock all round, 12 m down (carved after the cut is read)
    const mineAt = this.solidSpot(new THREE.Vector3(-14, surfaceHeight(-14, Z) - 13, 0), 5, 4, Z - 3);
    const chestAt = this.solidSpot(new THREE.Vector3(-38, surfaceHeight(-38, Z) - 28, 0), 5.5, 7, Z - 6);
    if (chestAt) this.carveHall(chestAt, 3.6, Z - 4.8, 6.2, 43);
    const pockets: [number, number, number][] = [
      [31, 44, 0],
      [-19, 118, 1],
      [24, 186, 1],
      [-33, 300, 2],
      [17, 415, 1],
      [-14, 640, 2],
      [35, 820, 2],
      [-28, 1060, 2],
    ];
    const pocketAt = pockets.map(([x, d]) => new THREE.Vector3(x, surfaceHeight(x, Z) - d, Z - 0.8));
    pocketAt.forEach((p, i) => this.carveRoom(p, 2.3, 2, 300 + i));

    this.slice = new GroundSlice(this.world, SLICE);
    this.slice.build();
    this.slice.scatterGems(this.gems, (x) => surfaceHeight(x, Z));
    scene.add(this.slice.mesh, this.slice.gems);
    if (mineAt) this.buildMine(mineAt);
    for (const o of [this.slice.mesh, this.slice.gems, this.core.group])
      o.traverse((m) => {
        const mat = (m as THREE.Mesh).material;
        for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) this.noClip.add(x);
      });

    // chests in the pockets: wood near the top, iron and gold deeper (as chestTier grows with depth)
    pockets.forEach(([, , tier], i) => this.placeChest(pocketAt[i], tier));

    // the stops on the way up: the boss in its cavern, then the hidden chest and the mining
    const cell = (ix: number, iy: number) => cavernAt(ix, iy, Math.floor(Z / 240));
    this.bossHost = assets.bosses ? createBossViewHost(assets.bosses) : null;
    const addBoss = (kind: BossKind, cav: Cavern | null, pass = false) => {
      if (!cav || !this.bossHost) return;
      const def = BOSS_DEFS[kind];
      // the game's own lair spot when it sits behind the cut and can be seen through it
      let at = cav.beast ? bossLair(cav).clone() : null;
      if (at && (at.z > Z - 6 || !this.seenFromCut(at.x, at.y + 1.5, at.z) || !this.seenFromCut(at.x, at.y + Math.min(def.height, 8) * 0.6, at.z))) at = null;
      at ??= this.findSpot(cav, Math.min(def.height, 8));
      if (!at) return;
      const v = new BossView(10 + this.bosses.size, kind, this.bossHost, bossInfo(kind, { x: at.x, y: at.y, z: at.z, yaw: 0, mode: 'fight' }));
      this.scene.add(v.root);
      this.bosses.set(kind, { view: v, at });
      const h = def.height;
      const stop = { start: 0, end: 0, t0: 0, boss: kind };
      if (pass) this.stops.push({ ...stop, kind: 'pass', at: new THREE.Vector3(at.x, at.y + h * 0.6, at.z), dist: 54, wideD: 54, span: 0.85, caption: CAPTION_MORE });
      else this.stops.push({ ...stop, kind: 'boss', at: new THREE.Vector3(at.x, at.y + h * 0.45, at.z), dist: h * 2.3 + 12, wideD: 52, span: 1.55, caption: CAPTION_BEASTS });
    };
    const addFoes = (kinds: string[], at: THREE.Vector3, spread: number) => {
      kinds.forEach((kind, i) => {
        const x = at.x + (i - (kinds.length - 1) / 2) * spread;
        const z = at.z + (i % 2 ? 1.2 : -0.6);
        const y = this.world.groundBelow(x, z, at.y + 3, 12) ?? at.y;
        this.foes.add([100 + this.foes.foes.length, kind, x, y, z, (i - 1) * 0.15, 100, 100, FOE_STATES.indexOf('hunt'), 1, FOE_LOOPS.indexOf('taunt'), i === 0 ? 1 : 0] as never, 0);
      });
    };
    addBoss('titan', cell(0, -4));
    // fire monsters by a gold chest in the ember cavern: seen on the way up from the titan
    const ember = cell(0, -3);
    const emberSpot = ember ? this.findSpot(ember, 3) : null;
    if (emberSpot) {
      addFoes(['cinder', 'pyre', 'cinder'], emberSpot, 3.2);
      this.placeChest(new THREE.Vector3(emberSpot.x + 6.5, emberSpot.y + 2, emberSpot.z + 1), 2, 1.9);
    }
    const find = { start: 0, end: 0, t0: 0 };
    if (chestAt) {
      this.buildChest(new THREE.Vector3(chestAt.x, chestAt.y, Z - 2.3));
      this.stops.push({ ...find, kind: 'chest', at: new THREE.Vector3(chestAt.x, chestAt.y + 2.1, Z - 2.3), dist: 10, wideD: 28, span: 2.1, caption: CAPTION_CHEST });
    }
    if (this.mine) {
      const f = this.mine.floor;
      this.stops.push({ ...find, kind: 'mine', at: new THREE.Vector3(f.x + 0.6, f.y + 1.7, Z - 0.5), dist: 9, wideD: 22, span: 3.9, caption: CAPTION_MINE });
    }
    this.placeMole(assets.mole);
    this.placeMiner(assets.mole);

    // bosses face the camera (+z) and stay hidden until their cavern is near
    for (const b of this.bosses.values()) b.view.root.visible = false;
    this.buildKeys();
    this.buildBits();
  }

  // ------------------------------------------------------------ setup helpers

  private carveRoom(at: THREE.Vector3, r: number, lumps: number, seed: number): void {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.world.dig(at, r, 1000, 999);
    for (let i = 0; i < lumps; i++) {
      const a = rnd() * Math.PI * 2;
      const e = (rnd() - 0.5) * 0.9;
      const d = r * (0.45 + rnd() * 0.4);
      V.set(at.x + Math.cos(a) * Math.cos(e) * d, at.y + Math.sin(e) * d * 0.6, at.z + Math.sin(a) * Math.cos(e) * d);
      this.world.dig(V, r * (0.45 + rnd() * 0.35), 1000, 999);
    }
  }

  /**
   * A floor point near `target` (x, y) with rock all round a hall of half width `hw` and height `h`, from
   * z = `zBack` to the cut, so the hall is hidden in the ground and only the cut shows it (a thin tunnel
   * may touch it: up to 3% of the samples may be open).
   */
  private solidSpot(target: THREE.Vector3, hw: number, h: number, zBack: number): THREE.Vector3 | null {
    const solid = (x: number, y: number) => {
      let open = 0;
      let all = 0;
      for (let dx = -hw - 2; dx <= hw + 2; dx += 2)
        for (let dy = -2.5; dy <= h + 2.5; dy += 2)
          for (let z = zBack; z <= Z + 1; z += 2.5) {
            all++;
            if (this.world.density(Math.round(x + dx), Math.round(y + dy), Math.round(z)) <= 128) open++;
          }
      return open <= all * 0.03;
    };
    for (const dy of [0, 4, -4, 8, -8])
      for (const dx of [0, 5, -5, 10, -10, 15, -15, 20, -20]) {
        const x = target.x + dx;
        const y = target.y + dy;
        if (solid(x, y)) return new THREE.Vector3(x, y, Z);
      }
    return null;
  }

  /** A hall with a flat floor at `floor`.y, from z = `zBack` through the cut, and a rough vault above. */
  private carveHall(floor: THREE.Vector3, hw: number, zBack: number, h: number, seed: number): void {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let x = -hw; x <= hw + 0.01; x += 1.55)
      for (let z = zBack; z <= Z + 1.2; z += 1.55) this.world.dig(V.set(floor.x + x, floor.y + 1.95, z), 2.0, 1000, 999);
    const r = Math.min(h - 2.4, hw * 0.75);
    for (let x = -hw + r * 0.6; x <= hw - r * 0.6 + 0.01; x += r * 0.7)
      for (let z = zBack + r * 0.6; z <= Z + 1.2; z += r * 0.8) this.world.dig(V.set(floor.x + x, floor.y + h - r + rnd() * 0.6, z), r * (0.9 + rnd() * 0.2), 1000, 999);
  }

  /**
   * The mining place: a burrow 4 m wide and 3 m high on the cut, and to its right a vein of five columns of
   * ore, rock and gems that the mole claws out one by one. The cells are written into the cut each frame
   * (animateMine); the burrow and the vein are carved into the world behind the cut, so each opened cell
   * shows the tunnel behind it. `at` is a floor point found in solid rock.
   */
  private buildMine(at: THREE.Vector3): void {
    const cx = Math.round(at.x);
    const fy = Math.floor(at.y) + 0.5;
    const rows = [fy + 0.5, fy + 1.5, fy + 2.5];
    const burrow: { x: number; y: number; d: number; m: number }[] = [];
    for (let x = cx - 4; x <= cx - 1; x++) for (const y of rows) burrow.push({ x, y, d: this.slice.solidAt(x, y), m: this.slice.materialAt(x, y) });
    const cols = VEIN.map((col, i) => ({
      x: cx + i,
      cells: col.map((what, r) => {
        const y = rows[r];
        const ore = what && what in ORE_MAT ? ORE_MAT[what as keyof typeof ORE_MAT] : -1;
        return { y, d: this.slice.solidAt(cx + i, y), m: this.slice.materialAt(cx + i, y), ore };
      }),
    }));
    // the scattered gems of the cut keep clear of it
    for (const g of [...this.slice.gems.children]) if (Math.abs(g.position.x - cx) < 7 && g.position.y > fy - 2 && g.position.y < fy + 5) this.slice.gems.remove(g);
    // the tunnel behind the cut, from the burrow to the end of the vein
    for (let x = cx - 4.2; x <= cx + 4.21; x += 0.7)
      for (const y of [fy + 1, fy + 1.5, fy + 2]) for (let z = Z - 2.6; z <= Z + 1.21; z += 0.7) this.world.dig(V.set(x, y, z), 1.0, 1000, 999);

    const tex = glintTexture();
    const loot: { o: THREE.Object3D; col: number; from: THREE.Vector3; size: number; gem: boolean; rest: THREE.Euler }[] = [];
    const glints: THREE.Sprite[] = [];
    const nuggetGeo = new THREE.IcosahedronGeometry(0.2, 0);
    VEIN.forEach((col, i) =>
      col.forEach((what, r) => {
        if (!what) return;
        const from = new THREE.Vector3(cx + i, rows[r], Z + 0.3);
        let o: THREE.Mesh;
        let size: number;
        const gem = !(what in ORE_MAT);
        if (gem) {
          o = this.gems.makeMesh(what);
          o.material = (o.material as THREE.Material).clone();
          size = o.scale.x * 0.95;
          from.z = Z + 0.25;
        } else {
          const c = new THREE.Color(MATERIALS[ORE_MAT[what as keyof typeof ORE_MAT]].color);
          o = new THREE.Mesh(nuggetGeo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.55, emissive: c.clone().multiplyScalar(0.3), flatShading: true }));
          size = 1.25;
        }
        const rest = new THREE.Euler(Math.PI / 2 + Math.sin(i * 3.1 + r) * 0.35, i * 1.7 + r, Math.cos(i * 2.3 + r) * 0.35);
        o.position.copy(from);
        o.rotation.copy(rest);
        o.scale.setScalar(gem ? size : 0);
        this.scene.add(o);
        this.noClip.add(o.material as THREE.Material);
        loot.push({ o, col: i, from, size, gem, rest });
        const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        glint.scale.setScalar(0);
        this.scene.add(glint);
        this.noClip.add(glint.material);
        glints.push(glint);
      }),
    );
    const light = new THREE.PointLight(0xffd6a0, 0, 12, 1.4);
    light.position.set(cx - 0.5, fy + 2.4, Z + 1.6);
    this.scene.add(light);
    this.mine = { floor: new THREE.Vector3(cx - 0.5, fy, Z), burrow, cols, loot, glints, light, hits: [], dive: Infinity, state: -1 };
  }

  /** The mining mole: a second copy of nearmol in the burrow, facing the vein (+x), a little toward the camera. */
  private placeMiner(asset: MinerAsset | null): void {
    if (!asset || !this.mole || !this.mine) return;
    const body = cloneSkinned(this.mole.root.children[0]);
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    const root = new THREE.Group();
    root.add(body);
    const x0 = this.mine.floor.x - 1.05;
    root.position.set(x0, this.mine.floor.y, Z - 0.9);
    root.rotation.y = Math.PI / 2 - 0.42;
    root.visible = false;
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const act = (name: string) => {
      const clip = asset.clips.find((c) => c.name === name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.miner = { root, mixer, idle: act('Idle_A'), dig: act('Pickaxing'), jump: act('Jump_Full_Short'), x0, y: this.mine.floor.y };
  }

  /** Bits of rock: one instanced mesh for every burst (each claw stroke, the dive, the burst on the land). */
  private buildBits(): void {
    let s = 4242;
    const rnd = (a: number, b: number) => a + ((s = (s * 16807) % 2147483647) / 2147483647) * (b - a);
    const add = (t: number, at: THREE.Vector3, n: number, vx: [number, number], vy: [number, number], vz: [number, number], colors: number[], size: [number, number]) => {
      const vel: THREE.Vector3[] = [];
      const sz: number[] = [];
      for (let i = 0; i < n; i++) {
        vel.push(new THREE.Vector3(rnd(...vx), rnd(...vy), rnd(...vz)));
        sz.push(rnd(...size));
      }
      this.bursts.push({ t, at, first: 0, n, vel, size: sz });
      return colors;
    };
    const tints: number[][] = [];
    const m = this.mine;
    if (m && m.hits.length)
      m.cols.forEach((col, i) =>
        col.cells.forEach((c) => {
          const rock = MATERIALS[c.m as keyof typeof MATERIALS]?.color ?? 0x9a7a55;
          const ore = c.ore >= 0 ? MATERIALS[c.ore as keyof typeof MATERIALS].color : rock;
          tints.push(add(m.hits[i] + 0.02, new THREE.Vector3(col.x, c.y, Z + 0.3), 7, [-2.8, 0.5], [1, 4.2], [0.8, 3.2], [rock, rock, ore], [0.1, 0.26]));
        }),
      );
    if (m && this.miner && isFinite(m.dive))
      tints.push(add(m.dive + 0.1, new THREE.Vector3(this.minerX(m.dive), m.floor.y + 2.6, Z - 0.3), 14, [-2, 2], [0.4, 3], [0.6, 2.6], [0x8a6a48, 0x6e5238], [0.12, 0.3]));
    if (this.mole) {
      const g = this.mole.at;
      tints.push(add(BREACH + 0.04, new THREE.Vector3(g.x, g.y + 0.15, g.z + 0.4), 16, [-2.4, 2.4], [2.2, 5], [-0.4, 2.2], [0xa47c52, 0x8a6844, 0x7cc552], [0.08, 0.2]));
    }
    const count = this.bursts.reduce((a, b) => a + b.n, 0);
    if (!count) return;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const bits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
    bits.frustumCulled = false;
    bits.castShadow = true;
    let first = 0;
    const c = new THREE.Color();
    this.bursts.forEach((b, i) => {
      b.first = first;
      for (let j = 0; j < b.n; j++) bits.setColorAt(first + j, c.setHex(tints[i][j % tints[i].length]));
      first += b.n;
    });
    this.noClip.add(mat);
    this.scene.add(bits);
    this.bits = bits;
  }

  /** x of the mining mole at time t: one step of 1 m after each claw stroke. */
  private minerX(t: number): number {
    const m = this.mine;
    const x0 = this.miner?.x0 ?? 0;
    if (!m) return x0;
    return x0 + m.hits.reduce((a, h) => a + smooth(h + 0.1, h + 0.34, t), 0);
  }

  /** The hidden chest: a gold chest on the hall floor, and the rewards that fly out of it when it opens. */
  private buildChest(at: THREE.Vector3): void {
    const lid = this.placeChest(at, 2, 1.6);
    const y = this.world.groundBelow(at.x, at.z, at.y + 0.5, 6) ?? at.y;
    const mouth = new THREE.Vector3(at.x, y + 1.1, at.z);
    const loot: { o: THREE.Object3D; to: THREE.Vector3; size: number }[] = [];
    const ids = ['ruby', 'sapphire', 'sunstone', 'emerald', 'voidheart'];
    const n = ids.length + 6;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.06 + (0.88 * i) / (n - 1));
      const ring = i % 2 ? 1.75 : 1.3;
      const to = new THREE.Vector3(at.x + Math.cos(a) * ring * 1.3, y + 1.9 + Math.sin(a) * ring, at.z + 1.2);
      let o: THREE.Object3D;
      let size: number;
      if (i % 2 === 0 && ids.length) {
        const gem = this.gems.makeMesh(ids.shift()!);
        gem.material = (gem.material as THREE.Material).clone();
        size = gem.scale.x * 0.62;
        o = gem;
      } else {
        o = new THREE.Mesh(COIN_GEO, COIN_MAT);
        size = 1;
      }
      o.position.copy(mouth);
      o.scale.setScalar(0);
      this.scene.add(o);
      loot.push({ o, to, size });
    }
    const light = new THREE.PointLight(0xffc46b, 0, 16, 1.3);
    light.position.copy(mouth).add(V.set(0, 1.2, 1.4));
    this.scene.add(light);
    this.chest = { lid, at: mouth, loot, light };
  }

  /** nearmol, the player's mole, on the land at the edge of the cut, facing the camera. */
  private placeMole(asset: MinerAsset | null): void {
    if (!asset) return;
    const y = this.world.groundBelow(MOLE_X, MOLE_Z, this.surfaceY0 + 15, 40) ?? surfaceHeight(MOLE_X, MOLE_Z);
    const root = new THREE.Group();
    const body = asset.scene;
    body.scale.setScalar(asset.body.scale);
    root.add(body);
    root.position.set(MOLE_X, y, MOLE_Z);
    root.rotation.y = 0.18;
    const seen = new Set<THREE.Material>();
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds do not follow the pose
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        stylizeMaterial(m as THREE.MeshStandardMaterial, 0.06, 1.4);
      }
    });
    this.scene.add(root);
    // the grass round its feet lies flat, so the tall blades do not hide it
    this.grass.slam(MOLE_X, y, MOLE_Z, 2.2, 1);
    const mixer = new THREE.AnimationMixer(body);
    const act = (name: string) => {
      const clip = asset.clips.find((c) => c.name === name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.mole = { root, mixer, idle: act('Idle_A'), wave: act('Waving'), cheer: act('Cheering'), jump: act('Jump_Full_Short'), at: new THREE.Vector3(MOLE_X, y, MOLE_Z) };
  }

  /** A chest (0 wood, 1 iron, 2 gold) on the floor below `at`, facing the camera; returns its lid. */
  private placeChest(at: THREE.Vector3, tier: number, scale = 1.35): THREE.Object3D | null {
    const model = this.chests.modelOf(tier);
    if (!model) return null;
    const y = this.world.groundBelow(at.x, at.z, at.y + 0.5, 6) ?? at.y - 2;
    const root = new THREE.Group();
    root.add(model);
    root.position.set(at.x, y, at.z);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    this.scene.add(root);
    this.warmSpots.push(new THREE.Vector3(at.x, y + 1.4, at.z + 0.6));
    return model.getObjectByName(`${['CH_Wood', 'CH_Iron', 'CH_Gold'][tier]}_Lid`) ?? null;
  }

  /** True when nothing solid stands between a point behind the cut and the cut, straight toward the camera. */
  private seenFromCut(x: number, y: number, z: number): boolean {
    for (let zz = z + 1.5; zz < Z; zz += 0.75) if (this.world.density(Math.round(x), Math.round(y), Math.round(zz)) > 128) return false;
    return this.slice.solidAt(x, y) <= 128;
  }

  /** An open floor spot in a cavern just behind the cut, with head room and seen through the cut. */
  private findSpot(cav: Cavern, height: number): THREE.Vector3 | null {
    for (const dz of [9, 12, 7, 15])
      for (const dx of [0, 6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
        const x = cav.cx + dx;
        const z = Z - dz;
        const top = Math.max(cavernFloorY(cav, x, z), cav.liquidY) + 7;
        const g = this.world.groundBelow(x, z, top, 22);
        if (g === null) continue;
        let room = true;
        for (let k = 2; k <= height; k += 2) if (this.world.density(Math.round(x), Math.round(g + k), Math.round(z)) > 128) room = false;
        if (!room) continue;
        if (!this.seenFromCut(x, g + 1.5, z) || !this.seenFromCut(x, g + height * 0.6, z) || !this.seenFromCut(x - 2, g + height * 0.5, z) || !this.seenFromCut(x + 2, g + height * 0.5, z)) continue;
        return new THREE.Vector3(x, g, z);
      }
    return null;
  }

  /** The camera keys after the core: back out, then up through every stop, then the mole. */
  private buildKeys(): void {
    const C = this.coreAt;
    const keys: Key[] = [];
    const wide = (x: number, y: number, d = D_FAR): Pose => ({ pos: new THREE.Vector3(x, y, Z + d), look: new THREE.Vector3(x, y, Z - 10), fov: FOV });
    const core = this.corePose(5.6);
    keys.push({ t: T.coreEnd, ...core });
    keys.push({ t: T.out, ...wide(C.x, C.y + 8) });
    // the stops in the order they were added (deepest first); their spans fill T.out..T.top
    const k = (T.top - T.out) / Math.max(1e-3, this.stops.reduce((a, s) => a + s.span, 0));
    let t = T.out;
    for (const s of this.stops) {
      const span = s.span * k;
      s.start = t;
      s.end = t + span;
      if (s.kind === 'pass') {
        // no zoom: the camera slows down by it, seen from afar
        s.t0 = t + span * 0.55;
        keys.push({ t: s.t0, ...wide(s.at.x, s.at.y, s.wideD) });
      } else {
        const find = s.kind !== 'boss';
        const travel = span * (find ? 0.3 : 0.36);
        const zoom = span * (find ? 0.25 : 0.3);
        s.t0 = t + travel;
        keys.push({ t: t + travel, ...wide(s.at.x, s.at.y + 2, s.wideD) });
        const near = { pos: new THREE.Vector3(s.at.x, s.at.y + s.dist * 0.08, s.at.z + s.dist), look: s.at.clone(), fov: FOV };
        keys.push({ t: t + travel + zoom, ...near });
        keys.push({ t: t + span * 0.98, pos: near.pos.clone().setZ(s.at.z + s.dist * 0.9), look: s.at.clone(), fov: FOV });
      }
      this.shots.push({ id: s.boss ?? s.kind, at: s.t0 });
      t += span;
    }
    // the mining: the first claw stroke just after the camera arrives, then one per column, then the dive
    const ms = this.stops.find((s) => s.kind === 'mine');
    if (ms && this.mine) {
      const first = ms.t0 + 0.15;
      this.mine.hits = VEIN.map((_, i) => first + i * STROKE);
      this.mine.dive = first + (VEIN.length - 1) * STROKE + 0.66;
    }
    // the captions: one line over the bosses, one over the passes, then one for each of the rest
    for (const s of this.stops) {
      const last = this.captions[this.captions.length - 1];
      if (last && last.text === s.caption) last.b = s.end;
      else this.captions.push({ text: s.caption, a: this.captions.length ? s.start + 0.1 : T.coreEnd + 0.3, b: s.end });
    }
    // back to the mole on the land for the closing line, then a little back and up for the logo
    // (the move down to the logo framing starts before the line fades, so the logo never covers the mole)
    keys.push({ t: T.surface, ...this.molePose('arrive') });
    keys.push({ t: T.banner - 0.7, ...this.molePose('banner') });
    keys.push({ t: T.banner + 0.9, ...this.molePose('logo') });
    const last = this.molePose('logo');
    last.pos.add(V.set(0.25, 0.05, -0.5));
    keys.push({ t: T.end, ...last });
    this.keys = keys;
    this.shots.unshift({ id: 'mole', at: 0 }, { id: 'land', at: T.descend - 0.3 }, { id: 'fall', at: T.descend + 1 }, { id: 'core', at: T.core }, { id: 'rise', at: T.coreEnd });
    this.shots.push({ id: 'top', at: T.surface }, { id: 'logo', at: T.banner });
  }

  /** Close views of the mole: at the start, back on the land, during the closing line and for the logo. */
  private molePose(which: 'start' | 'arrive' | 'banner' | 'logo'): Pose {
    const M = this.mole?.at ?? new THREE.Vector3(MOLE_X, surfaceHeight(MOLE_X, MOLE_Z), MOLE_Z);
    const at = (dx: number, dy: number, dz: number, lx: number, ly: number, fov = FOV): Pose => ({
      pos: new THREE.Vector3(M.x + dx, M.y + dy, Z + dz),
      look: new THREE.Vector3(M.x + lx, M.y + ly, M.z),
      fov,
    });
    if (which === 'start') return at(1.1, 1.25, 5.0, 0.15, 0.85);
    if (which === 'arrive') return at(-0.9, 1.45, 5.6, 0, 1.45);
    if (which === 'banner') return at(-0.6, 1.45, 5.0, 0, 1.4);
    // level view from 7 m: the mole stands in the lower third, under the logo
    return at(-0.3, 2.08, 6.1, 0, 2.08);
  }

  // ------------------------------------------------------------ sound timing (src/intro/soundtrack.ts)

  /** Every one-shot sound of the film, in time order. */
  soundCues(): SoundCue[] {
    const q: SoundCue[] = [];
    const at = (t: number, id: string, k?: number) => q.push({ t, id, k });
    at(T.wave + 0.15, 'hello');
    at(T.pull, 'pull');
    at(T.descend, 'dive');
    // a ping for each rock layer the fall passes
    let layer = '';
    for (let t = T.descend; t < T.core; t += 1 / 120) {
      const d = this.depthAt(this.pose(t).pos.y);
      const name = (LAYERS.find((l) => d.real < l.to) ?? LAYERS[LAYERS.length - 1]).name;
      if (d.real > 2 && name !== layer) {
        if (layer) at(t, 'layer');
        layer = name;
      }
    }
    at(T.core - 0.5, 'rumble');
    at(T.core + 0.45, 'omen');
    [1.9, 2.6, 3.3, 4.45].forEach((b, i) => at(T.core + b, 'beat', [0.6, 0.8, 1, 1.4][i]));
    at(T.core + 3.4, 'eye');
    at(T.core + 4.5, 'shock');
    at(T.coreEnd, 'rise');
    for (const s of this.stops) {
      if (s.kind === 'boss') at(s.t0 + 0.25, s.boss === 'titan' ? 'titan' : 'roar');
      else if (s.kind === 'pass') at(s.t0 - 0.1, 'far');
      else at(s.start + 0.1, 'swish');
    }
    const cs = this.stops.find((s) => s.kind === 'chest');
    if (cs && this.chest) {
      const open = cs.t0 + (cs.end - cs.start) * 0.2;
      at(open - 0.3, 'chest');
      at(open + 0.35, 'treasure');
      this.chest.loot.forEach((l, i) => {
        if (!(l.o as THREE.Mesh).geometry || (l.o as THREE.Mesh).geometry !== COIN_GEO) return;
        at(open + 0.12 + i * 0.05 + 0.3, 'coin', i);
      });
    }
    const m = this.mine;
    if (m && m.hits.length) {
      m.hits.forEach((h) => at(h, 'break'));
      const perCol = new Map<number, number>();
      for (const l of m.loot) {
        const rank = perCol.get(l.col) ?? 0;
        perCol.set(l.col, rank + 1);
        at(m.hits[l.col] + 0.04 + rank * 0.07 + FLIGHT, l.gem ? 'gem' : 'ore');
      }
      at(m.dive, 'burrow');
    }
    at(T.top + 0.05, 'up');
    at(BREACH, 'breach');
    at(LANDED, 'land');
    at(T.surface + 0.25, 'banner');
    at(T.banner + 0.3, 'logo');
    return q.sort((a, b) => a.t - b.t);
  }

  /** The ambience, the boss music layer and the music level at film time t. */
  soundState(t: number): SoundState {
    const y = this.pose(t).pos.y;
    const h = 1 / 60;
    const speed = Math.abs(this.pose(t + h).pos.y - this.pose(t - h).pos.y) / (2 * h);
    let biome: string | null = null;
    let biomeK = 0;
    for (const s of this.stops) {
      if (!s.boss) continue;
      const k = window01(t, s.start - 0.3, s.end + 0.4, 0.5, 0.6) * (s.kind === 'pass' ? 0.6 : 1);
      if (k > biomeK) [biome, biomeK] = [BOSS_DEFS[s.boss].biome, k];
    }
    const lastBoss = this.stops.filter((s) => s.boss).reduce((a, s) => Math.max(a, s.end), T.out);
    const music =
      t < T.descend
        ? 1
        : t < T.core
          ? 0.75 * (1 - smooth(T.core - 2.2, T.core - 0.2, t))
          : t < T.coreEnd
            ? 0
            : smooth(T.coreEnd, T.out + 0.4, t) * (1 - 0.35 * smooth(T.end - 0.8, T.end, t));
    return {
      under: smooth(this.surfaceY0 - 3, this.surfaceY0 - 16, y),
      height: Math.max(0, y - this.surfaceY0),
      speed,
      biome,
      biomeK,
      boss: t >= T.out - 0.3 && t < lastBoss ? 1 : 0,
      music,
    };
  }

  // ------------------------------------------------------------ camera path (a pure function of t)

  private corePose(lt: number): Pose {
    const C = this.coreAt;
    const push = easeOut(clamp01(lt / 5.6));
    return { pos: new THREE.Vector3(C.x + lerp(5, 2, push), C.y + lerp(5.5, 2.2, push), C.z + lerp(30, 21, push)), look: new THREE.Vector3(C.x, C.y + 0.4, C.z), fov: 48 };
  }

  private pose(t: number): Pose {
    const sy = surfaceHeight(12, Z);
    if (t < T.descend) {
      // close on the mole while it waves, then back and up to the land, the cut and the floating hub
      const a = this.molePose('start');
      a.pos.z -= 0.35 * smooth(0, T.pull, t);
      const b: Pose = { pos: new THREE.Vector3(12, sy + 6, Z + D_FAR), look: new THREE.Vector3(12, sy + 4.5, Z - 10), fov: FOV };
      const k = easeInOut(clamp01((t - T.pull) / (T.descend - T.pull)));
      const look = a.look.clone().lerp(b.look, k);
      const oa = a.pos.clone().sub(a.look);
      const ob = b.pos.clone().sub(b.look);
      // the distance grows on a log scale, so the pull back looks even
      const len = Math.exp(lerp(Math.log(oa.length()), Math.log(ob.length()), k));
      const dir = oa.normalize().lerp(ob.normalize(), k).normalize();
      return { pos: look.clone().addScaledVector(dir, len), look, fov: lerp(a.fov, b.fov, k) };
    }
    if (t < T.core) {
      const u = (t - T.descend) / (T.core - T.descend);
      const f = FALL(u);
      const end = this.corePose(0);
      const y0 = sy + 6;
      const y = lerp(y0, end.pos.y, f);
      const pin = smooth(0.8, 1, u);
      const x = lerp(12, end.pos.x, smooth(0.2, 1, u));
      const pos = new THREE.Vector3(x, y, lerp(Z + D_FAR, end.pos.z, pin));
      const look = new THREE.Vector3(x, y - 1.5, Z - 10).lerp(end.look, pin);
      return { pos, look, fov: lerp(FOV, end.fov, pin) };
    }
    if (t < T.coreEnd) return this.corePose(t - T.core);
    const keys = this.keys;
    let i = 0;
    while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const k = easeInOut(clamp01((t - a.t) / (b.t - a.t)));
    const pos = a.pos.clone().lerp(b.pos, k);
    // the rise from the mining to the mole bows out from the cut, so the cut does not fill the view
    if (b.t === T.surface) pos.z += Math.sin(Math.PI * k) * 6;
    return { pos, look: a.look.clone().lerp(b.look, k), fov: lerp(a.fov, b.fov, k) };
  }

  /** Real depth of the view centre on the cut, and the depth the counter shows. */
  private depthAt(y: number): { real: number; shown: number } {
    const real = this.surfaceY0 - y;
    const shown = real <= 1000 ? real : 1000 * Math.pow(CORE_DEPTH / 1000, clamp01((real - 1000) / (REAL_CORE - 1000 - 6)));
    return { real, shown: Math.min(CORE_DEPTH, shown) };
  }

  // ------------------------------------------------------------ frame helpers

  private stream(): void {
    this.world.boost = true;
    for (let i = 0; i < 80; i++) if (this.world.update(this.focus, true) && this.world.backlog === 0) break;
    this.world.boost = false;
  }

  /** Cuts every built-in material of the world at the slice (shader materials draw no clip). */
  private applyClip(): void {
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (this.noClip.has(m) || (m as THREE.ShaderMaterial).isShaderMaterial || m.clippingPlanes === this.clipPlanes) continue;
        m.clippingPlanes = this.clipPlanes;
        m.needsUpdate = true;
      }
    });
  }

  private skyUp(on: boolean): void {
    if (+on === this.skyShown) return;
    this.skyShown = +on;
    this.hub.setShown(on);
    this.decor.group.visible = this.farForest.mesh.visible = this.grass.group.visible = on;
    if (on) {
      // trees standing on the cut would show their insides: clear a strip along it
      this.decor.redecorate();
      for (let x = SLICE.x0; x <= SLICE.x1; x += 5) this.decor.clear(x, Z, 7);
    }
  }

  // ------------------------------------------------------------ frame

  /** Renders the frame at film time t (seconds). */
  renderAt(t: number): FilmOverlay {
    const back = t < this.lastT;
    const dt = back || this.lastT < 0 ? 1 / FILM_FPS : Math.min(0.1, t - this.lastT);
    const first = this.lastT < 0 || back;
    this.lastT = t;
    if (back) this.roared.clear();
    const o = (this.overlay = blankOverlay());
    const cam = this.camera;

    const p = this.pose(t);
    cam.position.copy(p.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.look);
    if (cam.fov !== p.fov) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // vertical speed of the view, for the blur on the cut and the streaks
    const h = 1 / 240;
    const vy = (this.pose(t + h).pos.y - this.pose(t - h).pos.y) / (2 * h);
    const speed = Math.abs(vy);

    // what the camera looks at, behind the cut: the world streams around it
    this.focus.set(p.look.x, p.look.y, Math.min(p.look.z, Z - 8));
    const depthHere = surfaceHeight(this.focus.x, this.focus.z) - this.focus.y;
    const inCore = t >= T.core && t < T.coreEnd;
    const sky = cam.position.y > this.surfaceY0 - 45;
    let lampK = sky ? 0 : 0.4;
    let bloom = sky ? 0.22 : 0.3;
    let expo = 1;

    // ----- the core: the reveal as it was, now reached without a cut
    const c = this.core;
    c.group.visible = t > T.descend + 3 && t < T.out + 1.5;
    if (c.group.visible) {
      const C = this.coreAt;
      const lt = t - T.core;
      c.group.position.copy(C);
      c.aim(inCore ? cam.position : this.corePose(0).pos);
      const beat = (at: number) => (lt >= at ? Math.exp(-(lt - at) * 5) : 0);
      c.pulse = Math.min(1.4, beat(1.9) * 0.6 + beat(2.6) * 0.8 + beat(3.3) * 1.0 + beat(4.45) * 1.4);
      c.wake = smooth(1.6, 4.4, lt);
      c.eye = easeOut(clamp01((lt - 3.45) / 0.9));
      c.seal = 1 - smooth(3.3, 4.5, lt);
      c.wave = lt >= 4.45 && lt < 5.5 ? (lt - 4.45) / 1.05 : -1;
      c.update(t);
    }
    if (inCore) {
      const lt = t - T.core;
      this.shake(t, c.pulse * 0.25 + smooth(4.4, 4.6, lt) * (1 - smooth(4.6, 5.6, lt)) * 0.9);
      lampK = 0.3 * (1 - c.wake);
      bloom = 0.45 + c.wake * 0.35 + c.pulse * 0.3;
      expo = 0.62;
      o.flash = smooth(4.5, 5.15, lt) * (1 - smooth(5.15, 5.6, lt)) * 0.9;
      o.flashColor = '#ffb070';
      o.counter = CORE_DEPTH;
      o.counterK = 1 - smooth(1.5, 2.0, lt);
      o.caption = lt < 3.2 ? 'Deep under the world, a core was sealed long ago.' : 'Now it is waking up.';
      o.captionK = lt < 3.2 ? window01(lt, 0.5, 3.15, 0.35, 0.3) : window01(lt, 3.25, 5.5, 0.25, 0.35);
    }

    // ----- the fall: counter, layer names, streaks
    if (t >= T.descend && t < T.core) {
      const d = this.depthAt(cam.position.y);
      o.counter = Math.round(Math.max(0, d.shown));
      o.counterK = smooth(T.descend + 0.15, T.descend + 0.5, t);
      const layer = LAYERS.find((l) => d.real < l.to) ?? LAYERS[LAYERS.length - 1];
      o.layer = layer.name;
      o.layerTint = layer.tint;
      o.layerK = o.counterK * (d.real > 2 ? 1 : 0);
      bloom = 0.3 + smooth(900, 1400, d.real) * 0.3;
    }
    o.speed = clamp01((speed - 40) / 420);
    o.streakDir = vy < 0 ? -1 : 1;
    this.slice.uniforms.uBlur.value = Math.min(16, (speed / FILM_FPS) * 1.4);

    // ----- the rise: the shock goes up, the beasts wake, then the finds on the way up
    if (t >= T.coreEnd && t < T.out + 0.2) o.wipe = clamp01((t - T.coreEnd) / (T.out + 0.2 - T.coreEnd));
    if (!inCore)
      for (const c of this.captions) {
        const k = window01(t, c.a, c.b, 0.3, 0.3);
        if (k > o.captionK) [o.caption, o.captionK] = [c.text, k];
      }
    for (const s of this.stops) {
      const boss = s.kind === 'boss' || s.kind === 'pass';
      const k = boss ? window01(t, s.t0 - 0.6, s.t0 + 1.2, 0.3, 0.3) : window01(t, s.t0 - 0.6, s.end + 0.2, 0.3, 0.3);
      if (s.boss) {
        const b = this.bosses.get(s.boss)!;
        const on = t > s.t0 - 1.2 && t < s.t0 + 1.8;
        b.view.root.visible = on;
        if (on && !this.roared.has(s.boss) && t >= s.t0 + 0.25) {
          this.roared.add(s.boss);
          tellBossView(b.view, { act: 'roar' }, t * 1000);
        }
      }
      // the halls of the finds are small and near: a much weaker lamp than in the boss caverns
      if (k > 0 && boss && !sky) lampK = lerp(lampK, 0.12, k);
      if (k > 0 && !boss) {
        lampK = lerp(lampK, 0.045, k);
        bloom = lerp(bloom, 0.22, k);
      }
      if (k > 0 && s.boss === 'titan') expo = lerp(1, 0.8, k);
    }
    this.animateFinds(t);
    this.animateMole(t);

    // ----- the top: the closing line, then the logo
    o.banner = 'Go to the deepest. Save the world!';
    o.bannerK = window01(t, T.surface + 0.2, T.banner, 0.45, 0.4);
    o.logo = smooth(T.banner + 0.3, T.banner + 1.0, t);
    o.fade = Math.max(1 - smooth(0, 0.6, t), smooth(T.end - 0.5, T.end, t));

    // ----- streaming, the world systems and the render
    this.skyUp(sky);
    if (first) {
      this.env.underground = smooth(1.5, 22, depthHere);
      this.biomes.k = 0;
    }
    this.stream();
    if (first)
      for (let i = 0; i < 4; i++) {
        (this.caveDecor as unknown as { timer: number }).timer = 0;
        this.caveDecor.update(0.05, this.focus, this.world.chunks.values());
      }
    cam.getWorldDirection(V2).setY(0).normalize();
    this.biomes.update(dt, this.focus, V.copy(this.focus).setY(this.focus.y + 1.45), V2, 0);
    this.biomes.sparks.points.visible = this.biomes.dust.points.visible = false;
    this.env.biomeAir = this.biomes.air() as never;
    this.env.biomeK = this.biomes.k;
    this.env.update(dt, this.focus, depthHere, cam, 0);
    // no fog between the camera and the cut: the fog starts at the cut
    const toCut = Math.max(0, cam.position.z - Z);
    ATMO.fogB.z = Math.max(ATMO.fogB.z, toCut + 6);
    ATMO.fogB.y = Math.min(ATMO.fogB.y, 0.012);
    this.renderer.toneMappingExposure = this.env.exposure * expo;
    this.slice.uniforms.uGain.value = 1 / Math.max(0.2, this.renderer.toneMappingExposure);
    this.slice.uniforms.uTime.value = t;
    ATMO.focus.set(this.focus.x, this.focus.y + 1, this.focus.z, 0);
    terrainUniforms.uPlayerXZ.value.set(this.focus.x, this.focus.z);
    biomeUniforms.uTime.value = t;
    this.world.extraUp = sky ? 0 : 1;
    this.world.cullBuried(cam.position, false);
    this.gems.update(dt, this.focus, 0, -1);
    this.caveDecor.update(dt, this.focus, this.world.chunks.values());
    if (sky) {
      // the far-terrain plane shows only where no real terrain is meshed (as the game masks it, Game.ts 72016)
      const world = this.world;
      const fcx = Math.floor(this.focus.x / 16);
      const fcz = Math.floor(this.focus.z / 16);
      world.drawCX = fcx;
      world.drawCZ = fcz;
      this.env.setLoaded(fcx, fcz, (x, z) => {
        const ty = surfaceHeight(x * 16 + 8, z * 16 + 8);
        for (let y = Math.floor((ty - 3) / 16); y <= Math.floor((ty + 3) / 16); y++) if (!world.chunks.get(chunkKey(x, y, z))?.meshed) return false;
        return true;
      });
      this.hub.update(dt, 0, this.env.clock.night);
      this.decor.update(dt, this.focus);
      this.farForest.update(this.focus);
      this.grass.update(dt, this.renderer, this.scene, cam, this.focus, true);
    }
    for (const b of this.bosses.values()) {
      if (!b.view.root.visible) continue;
      b.view.update(dt, t * 1000, 0);
      b.view.root.updateMatrixWorld(true);
    }
    this.foes.update(dt, t * 1000);
    this.foes.group.updateMatrixWorld(true);

    // lights: a lamp at the camera underground, warm light in the nearest chest pockets
    this.lamp.intensity = 260 * lampK;
    this.fill.intensity = 90 * lampK;
    this.lamp.position.copy(cam.position);
    cam.getWorldDirection(V);
    this.lamp.target.position.copy(cam.position).addScaledVector(V, 40);
    this.fill.position.copy(cam.position);
    for (const l of [this.lamp, this.lamp.target, this.fill]) l.updateMatrixWorld();
    const near = [...this.warmSpots].sort((a, b) => a.distanceToSquared(this.focus) - b.distanceToSquared(this.focus));
    this.warm.forEach((l, i) => {
      const s = near[i];
      l.position.copy(s);
      l.intensity = sky || inCore ? 0 : 26 * (1 - smooth(40, 70, s.distanceTo(this.focus)));
      l.updateMatrixWorld();
    });
    this.post.bloom.strength = bloom;
    this.applyClip();
    this.renderer.shadowMap.needsUpdate = true;
    this.post.composer.render();
    return o;
  }

  /** The chest opens and throws out its rewards; the mole mines the vein. */
  private animateFinds(t: number): void {
    const c = this.chest;
    if (c) {
      const s = this.stops.find((x) => x.kind === 'chest');
      const open = s ? s.t0 + (s.end - s.start) * 0.2 : Infinity;
      const lid = easeOut(clamp01((t - open) / 0.5));
      if (c.lid) {
        c.lid.rotation.x = -lid * 1.9;
        c.lid.updateMatrixWorld(true);
      }
      c.light.intensity = 3 + 10 * lid * (1 - 0.35 * smooth(open + 0.4, open + 1.2, t));
      c.loot.forEach((l, i) => {
        const k = clamp01((t - open - 0.12 - i * 0.05) / 0.55);
        const e = easeOut(k);
        const o = l.o;
        o.position.lerpVectors(c.at, l.to, e);
        o.position.y += Math.sin(k * Math.PI) * 0.6 + (k >= 1 ? Math.sin(t * 2.2 + i) * 0.08 : 0);
        o.scale.setScalar(l.size * (k > 0 ? 0.35 + 0.65 * e : 0));
        o.rotation.set(0.25 * Math.sin(i), t * 2.4 + i, 0);
        o.updateMatrixWorld(true);
      });
    }
    this.animateMine(t);
    this.animateBits(t);
  }

  /** The burrow opens on the cut once the camera is deep; each claw stroke opens a column and its loot flies to the mole. */
  private animateMine(t: number): void {
    const m = this.mine;
    if (!m) return;
    const open = t >= T.out;
    const mined = open ? m.hits.filter((h) => t >= h + 0.03).length : 0;
    const state = open ? 1 + mined : 0;
    if (state !== m.state) {
      m.state = state;
      for (const c of m.burrow) this.slice.setCell(c.x, c.y, open ? 0 : c.d, c.m);
      m.cols.forEach((col, i) => {
        for (const c of col.cells) this.slice.setCell(col.x, c.y, i < mined ? 0 : 255, c.ore >= 0 ? c.ore : c.m);
      });
      this.slice.flush();
    }
    const s = this.stops.find((x) => x.kind === 'mine');
    m.light.intensity = s ? 7 * window01(t, s.t0 - 0.8, s.end + 0.4, 0.5, 0.5) : 0;
    const perCol = new Map<number, number>();
    m.loot.forEach((l, j) => {
      const rank = perCol.get(l.col) ?? 0;
      perCol.set(l.col, rank + 1);
      const go = (m.hits[l.col] ?? Infinity) + 0.04 + rank * 0.07;
      const arrive = go + FLIGHT;
      const o = l.o;
      const glint = m.glints[j];
      if (t < go || !open) {
        o.position.copy(l.from);
        o.rotation.copy(l.rest);
        o.scale.setScalar(l.gem ? l.size : 0);
        glint.scale.setScalar(0);
      } else {
        const k = clamp01((t - go) / (arrive - go));
        const to = V.set(this.minerX(arrive), m.floor.y + 0.95, Z - 0.5);
        o.position.lerpVectors(l.from, to, easeInOut(k));
        o.position.y += Math.sin(k * Math.PI) * 1.0;
        o.position.z += Math.sin(k * Math.PI) * 0.8;
        o.rotation.set(l.rest.x + k * 5, l.rest.y + k * 7, l.rest.z);
        const pop = l.gem ? 1 : smooth(0, 0.18, k);
        o.scale.setScalar(k >= 1 ? 0 : l.size * pop * (1 - smooth(0.75, 1, k)) * (l.gem ? 0.75 + 0.25 * (1 - k) : 1));
        const g = (t - arrive) / 0.32;
        glint.position.copy(to).add(V2.set(0.15, 0.35, 0.6));
        glint.scale.setScalar(g > 0 && g < 1 ? 0.75 * Math.sin(g * Math.PI) : 0);
      }
      o.updateMatrixWorld(true);
      glint.updateMatrixWorld(true);
    });
  }

  /** Each burst throws its bits out, they fall and shrink away. */
  private animateBits(t: number): void {
    const bits = this.bits;
    if (!bits) return;
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const E = new THREE.Euler();
    const S = new THREE.Vector3();
    for (const b of this.bursts) {
      const age = t - b.t;
      for (let j = 0; j < b.n; j++) {
        const life = 0.7 + (j % 3) * 0.08;
        if (age < 0 || age > life) {
          M.makeScale(0, 0, 0);
        } else {
          const v = b.vel[j];
          V.copy(b.at).addScaledVector(v, age);
          V.y -= 5.5 * age * age;
          Q.setFromEuler(E.set(age * (4 + j), age * (3 + j * 0.7), j));
          S.setScalar(b.size[j] * (1 - smooth(life * 0.55, life, age)));
          M.compose(V, Q, S);
        }
        bits.setMatrixAt(b.first + j, M);
      }
    }
    bits.instanceMatrix.needsUpdate = true;
  }

  /**
   * The mole idles and waves at the start. It is away during the rise (it is the one mining), bursts out of
   * the ground as the camera arrives, cheers during the closing line and waves again with the logo.
   */
  private animateMole(t: number): void {
    this.animateMiner(t);
    const m = this.mole;
    if (!m) return;
    const dur = (a: THREE.AnimationAction | null) => a?.getClip().duration ?? 1;
    m.root.visible = t < T.out || t >= BREACH;
    // the burst out of the ground: from under the grass, up in an arc, down on its feet
    const k = clamp01((t - BREACH) / (LANDED - BREACH));
    m.root.position.y = m.at.y + (t >= BREACH && k < 1 ? lerp(-1.3, 0, k) + 1.15 * Math.sin(Math.PI * k) : 0);
    const jW = m.jump ? window01(t, BREACH - 0.01, LANDED + 0.3, 0.01, 0.3) : 0;
    if (m.jump) {
      // the airborne middle of the clip during the arc, its landing just after
      m.jump.time = lerp(0.3, 0.8, clamp01((t - BREACH) / (LANDED + 0.3 - BREACH))) * dur(m.jump);
      m.jump.setEffectiveWeight(jW);
    }
    const wave2 = T.banner + 0.5;
    const wW1 = m.wave ? window01(t, T.wave, T.wave + dur(m.wave), 0.25, 0.35) : 0;
    const wW2 = m.wave ? window01(t, wave2, wave2 + dur(m.wave), 0.25, 0.35) : 0;
    const cW = m.cheer ? window01(t, LANDED - 0.05, T.banner + 0.3, 0.3, 0.4) * (1 - jW) : 0;
    if (m.wave) {
      m.wave.time = clamp01((t - (t < wave2 - 0.3 ? T.wave : wave2)) / dur(m.wave)) * dur(m.wave);
      m.wave.setEffectiveWeight(Math.max(wW1, wW2));
    }
    if (m.cheer) {
      m.cheer.time = Math.max(0, t - (LANDED - 0.05)) % dur(m.cheer);
      m.cheer.setEffectiveWeight(cW);
    }
    if (m.idle) {
      m.idle.time = t % dur(m.idle);
      m.idle.setEffectiveWeight(Math.max(0, 1 - wW1 - wW2 - cW - jW));
    }
    m.mixer.update(0);
    m.root.updateMatrixWorld(true);
  }

  /** The mining mole: claw strokes on the beat of the columns, a step after each, then a dive up into the rock. */
  private animateMiner(t: number): void {
    const n = this.miner;
    const m = this.mine;
    if (!n || !m || !m.hits.length) return;
    const dive = m.dive;
    n.root.visible = t > T.out - 0.2 && t < dive + 0.26;
    if (!n.root.visible) return;
    const dur = (a: THREE.AnimationAction | null) => a?.getClip().duration ?? 1;
    const first = m.hits[0];
    const last = m.hits[m.hits.length - 1];
    const up = clamp01((t - dive) / 0.26);
    n.root.position.set(this.minerX(t), n.y + up * up * 1.8, Z - 0.9);
    n.root.scale.setScalar(1 - smooth(0.45, 1, up));
    const dW = n.dig ? window01(t, first - MINE_HIT * STROKE - 0.12, last + 0.3, 0.12, 0.2) : 0;
    if (n.dig) {
      const u = (t - first) / STROKE + MINE_HIT;
      n.dig.time = (u - Math.floor(u)) * dur(n.dig);
      n.dig.setEffectiveWeight(dW);
    }
    const jW = n.jump ? window01(t, dive - 0.2, dive + 0.4, 0.12, 0.1) : 0;
    if (n.jump) {
      n.jump.time = lerp(0.05, 0.45, clamp01((t - dive + 0.2) / 0.46)) * dur(n.jump);
      n.jump.setEffectiveWeight(jW);
    }
    if (n.idle) {
      n.idle.time = t % dur(n.idle);
      n.idle.setEffectiveWeight(Math.max(0, 1 - dW - jW));
    }
    n.mixer.update(0);
    n.root.updateMatrixWorld(true);
  }

  private shake(t: number, k: number): void {
    if (k <= 0) return;
    const c = this.camera;
    c.position.x += shakeNoise(t * 22, 1) * k;
    c.position.y += shakeNoise(t * 22, 2) * k;
    c.rotateZ(shakeNoise(t * 15, 3) * k * 0.02);
    c.updateMatrixWorld();
  }
}
