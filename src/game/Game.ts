// Port of the main game class KR (play-inUT-NSi.js 70056-75530), phase 1 subset:
// world streaming, the miner on foot (walk, jump, jetpack, dash), the follow camera, drilling and digging
// (digTick with debris, dust and sparks), the sky / sun / fog / weather, grass, headlamp and the post chain.
// Not yet ported (later phases): hub town and lift, burrow mode, foes, worm, bosses, gems, chests, pickups,
// HUD controller, menus, inventory, Wellspring, tutorial, audio, multiplayer.
import * as THREE from 'three';
import { ChunkManager } from '../world/chunkManager';
import { chunkKey } from '../world/chunk';
import { baseDensity, materialAt, strataOffset, surfaceHeight } from '../world/generate';
import { gemSlotsForChunk, setGemRunSeed } from '../world/gemSpawn';
import { BaseDesk, type BaseTheme } from '../base/basePanels';
import { askHome, canGoHome, goHome, runDealt, startRun, type Haul } from '../base/backToBase';
import { HaulShow, type GoalView, type TripNext } from '../base/haulShow';
import { GOALS } from '../state/goals';
import { Merchants } from '../npc/merchants';
import { SITE_BY_ID, siteStatus, type SiteId, type UnlockView } from '../base/sites';
import { BOSS_DEFS, BOSS_OF_BIOME, bossLair } from '../bosses/sim/defs';
import { MATERIALS, Mat } from '../world/materials';
import { LIFT_POINT, BURROW_SPEED } from '../world/constants';
import { PlayerController, BURROW_CENTER_Y } from '../player/controller';
import { createSonarRock, SonarPing, SonarBlips, type SonarRockUniforms } from '../render/sonarRock';
import { FollowCamera } from '../player/followCamera';
import { Input, NULL_INPUT } from '../player/input';
import { Environment } from '../sky/environment';
import { Weather } from '../sky/weather';
import { GrassField } from '../render/grass';
import { terrainUniforms } from '../render/terrainMaterial';
import { biomeUniforms } from '../render/biomeRock';
import { ATMO, setLook } from '../render/atmosphere';
import { createPostChain, type PostChain } from '../post/composer';
import { Particles } from '../fx/particles';
import { Debris } from '../fx/debris';
import { IS_TOUCH } from './device';
import { loadSettings, pickStartQuality, cappedPixelRatio, DETAIL, DECOR_DENSITY, PIXEL_RATIO, SHADOW_SIZE, type Quality, type Settings } from './settings';
import { PlayerState } from '../state/playerState';
import { Pickups } from '../pickups/pickups';
import { supplyModel, bombModel } from '../pickups/supplyModels';
import { bossSouls } from '../pickups/souls';
import { rollLootGear, gearSellPrice } from '../state/gear';
import { TIER_COLORS } from '../state/progression';
import { wirePickups, updatePickups, digOre, releaseGem as releaseGemToPickup, layerNote, useBelt, lootModel } from '../pickups/collect';
import { MinerRig } from '../miner/rig';
import { Hub } from '../hub/hub';
import { CaveDecor, caveRoomTest, caveGroundProbe } from '../cave/caveDecor';
import { BiomeAmbience } from '../cave/biomeAmbience';
import { BiomeHazards } from '../cave/biomeHazards';
import { BIOMES, beastCaverns, cavernAt, cavernFloorY, cavernMetric, type BiomeId } from '../world/caverns';
import { Decor } from '../decor/decor';
import { FarForest } from '../decor/farForest';
import type { GameAssets } from './assets';
import { Combat } from '../combat/combat';
import { SoloFoeHost, applyFoeMessage, type FoeHostMsg } from '../foes/soloHost';
import { inTownZone } from '../foes/nav';
import { WormHost, wormHostParts } from '../worm/wormHost';
import { BossHost, bossHostParts, mergeHostParts } from '../bosses/sim/bossHost';
import { BossClient } from '../bosses/client/bossClient';
import { makeUlt, warmUlt } from '../ult/ultClient';
import { Items } from '../items/kr-items';
import type { Chests, Chest } from '../chests/chests';
import { Satchels, type SatchelData } from '../chests/satchels';
import type { LootPanel } from '../chests/lootPanel';
import {
  makeChests,
  makeLootPanel,
  knockedOut as chestsKnockedOut,
  wakeAtHome as chestsWakeAtHome,
  updateChests,
  updateChestHints,
  updateSatchels,
  chestHalos,
  lootKeys,
  openChest as chestsOpen,
  lootSatchel as chestsLootSatchel,
} from '../chests/krChests';
import { lootSummary } from '../state/gearStats';
import { makeWellspring, type Wellspring } from '../menus/wellspring/wellspring';
import { makeInventory, type Inventory } from '../menus/inventory';
import { syncLook as wardrobeSyncLook, dressMiner, type MinerLook } from '../menus/wardrobe';
import { Portrait } from '../menus/portrait';
import { makeSettingsPanel, applySettings as applyAllSettings, liteLights, type SettingsPanel } from '../menus/settingsPanel';
import { ControlsPanel } from '../menus/controlsPanel';
import { Leaderboard } from '../menus/leaderboard';
import { openLobby } from '../menus/lobby';
import { setupJetpackToggle } from './jetpackToggle';
import { DepthBar } from '../ui/depthBar';
import { MinerHud } from '../ui/minerHud';
import { ClawEndurance, WORN_DIG } from './clawEndurance';
import { startFpsMeter } from '../ui/fpsMeter';
import { cheats, cheatSpeed, fastRock, onCheats, stockPlan } from './cheats';
import { CHEAT } from './entry';
import { vault } from '../economy/vault';
import { session } from '../near/session';
import { toolMul, toolOf } from './digTools';
import { MATERIAL_IDS, TRIP_GIVES_GEAR } from '../base/run';
import { CheatPanel } from '../ui/cheatPanel';
import { onStatsChanged as economyStatsChanged } from '../menus/economy';
import { KrNpc } from '../npc/krNpc';
import type { GoalCard } from '../tutorial/goalCard';
import type { TutorialCoach } from '../tutorial/coach';
import { makeGoals, makeTutorial, wireTutorialButtons, startGame, endSandbox, updateIntro, updateHavenGoals, SANDBOX_TIME } from '../tutorial/krTutorial';
import { AutoQuality } from './autoQuality';
import { SlowFrames } from './slowFrames';
import { showInstallPrompt } from './install';
import { Backdrop } from '../menus/backdrop';
import { gearIcons } from '../menus/gearIcons';
import type { TradingPost } from '../menus/tradingPost';
import {
  anyPanelOpen,
  isPaused,
  isPlaying,
  presentFrame,
  compileTick,
  handlePanelKeys,
  releaseLock as panelsReleaseLock,
  openMenu as panelsOpenMenu,
  openStash as panelsOpenStash,
  openShatter as panelsOpenShatter,
  closeMenu,
  createMenu,
  wirePanels,
} from '../menus/panels';
import type { DrillSlam } from '../ult/drillSlam';
import type { SlamFx } from '../ult/slamFx';
import { WormClient, wormDrillHit } from '../worm/wormClient';
import type { WormMsg } from '../worm/wormHost';
import { Hud } from '../ui/hud';
import { TouchControls } from '../ui/touch';
import { updateHud, handleUseKeys, updateFortune, updateStrength } from '../ui/kr-hud';
import { RingPulsePool } from '../fx/rings';
import { GemField, type Gem } from '../gems/gemField';
import { GemBursts } from '../fx/gemBursts';
import { Vortex } from '../fx/vortex';
import { DashLines } from '../fx/dashLines';
import { GEM_IDS, ITEMS, RARITY_COLORS } from '../world/items';
import { Audio } from '../audio/audio';
import { saveSettings } from './settings';

const MY_ID = 'me'; // solo: the local miner's id (mp.id)

const DIG_TICK = 0.06; // vR (69990)

/**
 * MINEAR lobby mode, from the URL: ?lobby=a, ?lobby=b (the default) or ?lobby=top.
 * a: the underground sonar view ends at Play, and the camera flies up in the normal view.
 * b: the sonar view stays on during the flight and ends when the camera is out of the ground.
 * top: the original lobby, a circle over the island.
 */
export type LobbyMode = 'a' | 'b' | 'top';
export function lobbyMode(): LobbyMode {
  const v = new URLSearchParams(location.search).get('lobby');
  return v === 'a' || v === 'top' ? v : 'b';
}
/** The lobby is a soft background behind the menus: it draws at most at this pixel ratio. */
const LOBBY_PIXEL_RATIO = 1;
const RARITY_TIER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 } as const; // pR (69986)
const BURROW_ENTER_OPEN = 0.35; // DR (70035)
const BURROW_EXIT_OPEN = 0.6; // OR (70036)
const BORE_SPEED = 1.7; // kR (70037)
const BORE_DIG = 1.7; // AR (70038)

// shared temps (70040-70052)
const T0 = new THREE.Vector3(); // $
const T1 = new THREE.Vector3(); // MR
const T2 = new THREE.Vector3(); // NR
const T3 = new THREE.Vector3(); // PR
const drillRay = new THREE.Raycaster(); // RR
// MINEAR: burrowing without the jetpack (noJetBurrow)
const NOJET_DIR = new THREE.Vector3();
const NOJET_DOWN = new THREE.Vector3(0, -1, 0);
const NOJET_FALL = 9;
const NOJET_REACH = 2.6;
const drillBox = new THREE.Box3(); // zR

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly settings: Settings;
  /** settings.quality: the auto tuner can change it (applySettings applies it). */
  get quality(): Quality {
    return this.settings.quality;
  }
  goals!: GoalCard; // KA
  tutorial!: TutorialCoach; // VN
  sandboxWas: Parameters<typeof startGame>[0]['sandboxWas'] = null;
  intro: Parameters<typeof updateIntro>[0]['intro'] = null;
  readonly myId = MY_ID;
  npc!: KrNpc; // stranger oR, mirror tR and KR's souls / lodestone glue
  /** MINEAR: the six merchants on the floating islands around the base (src/npc/merchants.ts). */
  merchants!: Merchants;
  tuner!: AutoQuality; // RL (70109)
  crawl!: SlowFrames; // WL (70118)
  readonly pixelRatio: number;
  readonly state = new PlayerState(); // Fj
  /** MINEAR: the claws' endurance (saved in the state). */
  readonly claws = new ClawEndurance(this.state);
  readonly pickups: Pickups; // wP
  items!: Items; // bombs KM, smokes XP and KR's belt / footing / stone code
  readonly satchels = new Satchels(); // Uk
  chests!: Chests; // tk
  loot!: LootPanel; // vP
  chestHint: Chest | null = null;
  satchelHint: SatchelData | null = null;
  koBy: string | null = null;
  lootFreed = false;
  satchelT = 0;
  returning: { at: THREE.Vector3; t: number; heard: number } | null = null;
  whereT = 0;
  whereSaved = new THREE.Vector3(Infinity, 0, 0);
  readonly world = new ChunkManager();
  readonly cam: FollowCamera;
  readonly input = new Input();
  readonly player: PlayerController;
  readonly post: PostChain;
  readonly env: Environment;
  readonly grass: GrassField;
  readonly weather: Weather;
  readonly sparks = new Particles(2500, true); // FA (70085)
  readonly dust = new Particles(2000, false); // FA (70086)
  readonly debris: Debris;
  readonly headlamp: THREE.SpotLight;
  readonly aura: THREE.PointLight;
  readonly model: MinerRig;
  readonly hub: Hub;
  readonly hubBox: THREE.Box3;
  readonly decor: Decor;
  readonly caveDecor: CaveDecor; // cw
  readonly biomes = new BiomeAmbience(); // AL
  readonly biomeEvents: BiomeHazards; // NL
  private hinted = new Set<string>();
  readonly farForest: FarForest;
  readonly combat: Combat;
  readonly foeHost: SoloFoeHost;
  readonly wormHost: WormHost;
  readonly wormClient: WormClient;
  readonly bossHost: BossHost;
  readonly bossClient: BossClient;
  ult!: DrillSlam; // wD
  ultFx!: SlamFx; // CD
  readonly audio = new Audio(); // dM
  readonly ui = new Hud(); // EM
  readonly burrowMat: THREE.ShaderMaterial; // Ap material (70285)
  readonly burrowU: SonarRockUniforms;
  readonly ping = new SonarPing(); // Mp
  readonly gems: GemField; // Rb
  readonly gemBursts = new GemBursts(); // zp
  readonly vortex = new Vortex(); // am
  readonly dashLines = new DashLines(); // Dm
  wasDashing = false;
  sensedT = 0;
  airPuffT = 0;
  pointHit: THREE.Vector3 | null = null;
  private trailPts: THREE.Vector3[] = [];
  readonly halos = new SonarBlips(); // Np
  pingT = 1.2;
  modeCooldown = 0;
  openT = 0;
  openness = 0;
  burrowDigT = 0;
  bore = false;
  arc: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; peak: number } | null = null;
  readonly rings = new RingPulsePool(48); // Hp
  touch: TouchControls | null = null; // lM
  // KR fields the HUD functions read and write (src/ui/kr-hud.ts KrHudHost)
  sandbox = false;
  burrow = false;
  // panels (src/menus/panels.ts PanelHost)
  readonly backdrop: Backdrop; // xL
  menu!: TradingPost; // nN
  pauseAt = 0;
  stillAt = 0;
  calmNow = true;
  lockWasActive = false;
  compiling = false;
  compiledAt = 0;
  private unwirePanels: () => void = () => {};
  shatter?: Wellspring; // pN
  inv?: Inventory; // hP
  settingsPanel?: SettingsPanel; // yj
  keysPanel?: ControlsPanel; // qL
  leadersPanel?: Leaderboard; // ZL
  readonly portrait = new Portrait();
  look: MinerLook | null = null;
  /** Set by the R3F shell: keeps R3F's dpr equal to the pixel ratio the quality setting picks. */
  onDpr: ((r: number) => void) | null = null;
  get paused() {
    return isPaused(this);
  }
  get anyPanel() {
    return anyPanelOpen(this);
  }
  hasDug = false;
  fullHintT = 0;
  burrowTipT = 0;
  ultTipT = 0;
  lodestoneT = 0;
  fortuneMark = -1;
  fortuneSaveT = 0;
  echoT = 0;
  wasLifting = false;
  leftHub = false;
  townT = 0;
  smokeT = 0;
  moteT = 0;

  started = false;
  worldReady = false;
  last = performance.now();
  hitstop = 0;
  murk = 0;
  digTimer = 0;
  drilling = false;
  /** Burrowed and pushing a direction (the player's own move, not a fall). */
  burrowPush = false;
  /** MINEAR: the depth bar on the right edge (rock layers, boss lairs, record, you). */
  depthBar = new DepthBar();
  /** MINEAR: the Cheats panel (src/ui/cheatPanel.ts); only in the dev-local Demo cheat. */
  cheatPanel: CheatPanel | null = null;
  /** MINEAR lobby: the title camera looks at the rock under the island in burrow (sonar) view. */
  lobbyDeep = false;
  readonly lobbyFocus = new THREE.Vector3();
  /** Lobby view: sonar reach (m), and the camera's circle radius, height over the spot and look-up. */
  lobbyView = { far: 50, r: 13, up: 2, look: -0.5, murk: 0.6 };
  /** MINEAR: the top-left HUD (place, claw endurance, coins, gems, this trip's ore, requests). */
  minerHud = new MinerHud();
  tripOre(id: string, n: number) {
    this.minerHud.addOre(id, n);
  }
  /** MINEAR base: the panels of the base sites (drawn in the Trading Post sheet). */
  baseDesk!: BaseDesk;
  /** MINEAR: the haul show after a teleport home (src/base/haulShow.ts). */
  haulShow!: HaulShow;
  /** MINEAR: the world's streaming budgets before the haul show raised them. */
  private homeBudget: { gen: number; mesh: number } | null = null;
  private siteT = 0;
  pointing = false;
  aimPitch = 0;
  stuckT = 0;
  shadowTick = 0;
  shadowDue = false;
  farMaskT = 0;
  titleT = 0;
  crossState: 'none' | 'aim' | 'foe' | 'hard' | 'valid' | 'air' = 'none';
  lastMat: number = Mat.Air;
  hardHintT = 0;
  crunchT = 0;
  clangT = 0;
  hintOverride = '';
  private colliderList: THREE.Mesh[] = [];

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, assets: GameAssets) {
    this.renderer = renderer;
    this.scene = scene;
    this.backdrop = new Backdrop(renderer.domElement); // 70213
    // 70215-70236: the miner, then the hub; small hub meshes lose their shadow
    this.model = new MinerRig(assets.miner);
    this.caveDecor = new CaveDecor(assets.cave, caveRoomTest(this.world), 1, assets.biome, caveGroundProbe(this.world)); // 70216
    this.hub = new Hub(assets.hub, assets.cave);
    this.hub.group.updateMatrixWorld(true);
    this.merchants = new Merchants(this.hub.group, this.hub.collider, assets.miner.clips); // MINEAR: before the shadow pass below
    void this.merchants.load();
    this.npc = new KrNpc(this, assets.stranger); // 70237
    const ws = new THREE.Vector3();
    this.hub.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.getWorldScale(ws);
      if (m.geometry.boundingSphere!.radius * Math.max(ws.x, ws.y, ws.z) < 0.85) m.castShadow = false;
    });
    this.settings = loadSettings();
    this.settings.quality = pickStartQuality(this.settings, renderer.getContext());
    this.pixelRatio = cappedPixelRatio(this.quality); // MINEAR: inside the pixel budget (settings.ts)

    // renderer (70238-70253)
    scene.matrixAutoUpdate = false;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;

    this.cam = new FollowCamera(window.innerWidth / window.innerHeight);
    this.cam.sensitivity = 0.0022 * this.settings.sensitivity;
    this.cam.invertY = this.settings.invertY;
    this.post = createPostChain(renderer, scene, this.cam.camera, this.quality);
    const sonar = createSonarRock(); // 70284-70286
    this.burrowMat = sonar.material;
    this.burrowU = sonar.uniforms;

    // world (70284-70292)
    this.env = new Environment(scene);
    if (!IS_TOUCH && !new URLSearchParams(location.search).has('nobatch')) this.world.useBatch();
    scene.add(this.world.group);
    // 70290-70296
    this.gems = new GemField(this.world);
    scene.add(this.gems.group);
    this.world.onChunkMeshed = (c) => this.gems.spawnForChunk(c);
    this.world.onChunkUnloaded = (c, deleted) => {
      this.gems.unloadChunk(c, deleted);
      this.caveDecor.unloadChunk(c);
      this.chests?.unloadChunk(c);
    };
    // 70296-70327: cave decor, biome ambience and biome hazards
    this.caveDecor.density = DECOR_DENSITY[this.quality] ?? 1;
    scene.add(this.caveDecor.group, this.biomes.group, this.biomes.sparks.points, this.biomes.dust.points);
    this.biomes.density = DECOR_DENSITY[this.quality] ?? 1;
    this.biomes.onEnter = (b) => this.biomeEntered(b);
    this.biomes.onNear = (b, d) => this.biomeNear(b, d);
    this.biomes.nearestGlow = (pos, r) => this.caveDecor.nearestGlow(pos, r);
    this.biomeEvents = new BiomeHazards(
      {
        world: this.world,
        sparks: this.sparks,
        dust: this.dust,
        scene,
        hurt: (dmg, at, knock, el) => {
          const res = el ? Math.min(0.9, (el[0] > 0 ? this.state.stat('resfire') : el[1] > 0 ? this.state.stat('respoison') : 0) / 100) : 0;
          const n = Math.round(dmg * (1 - res));
          if (n > 0 && this.combat.hurt(n, at, knock) && el) this.combat.afflict(dmg, el as never);
        },
        poison: (n) => this.combat.afflict(n, [0, 1, 0] as never),
        sound: (kind, v) => this.audio.biomeEvent(kind, THREE.MathUtils.clamp(v, 0.1, 1)),
        shake: (k) => this.cam.addShake(k),
      },
      assets.biome?.BM_Icicles3 ?? null,
    );

    // grass, weather (70332-70349)
    // 70328-70331
    this.decor = new Decor(this.world);
    scene.add(this.decor.group);
    this.farForest = new FarForest(renderer);
    scene.add(this.farForest.mesh);
    this.grass = new GrassField(this.quality);
    this.grass.enableHub();
    this.grass.hubCaptureBelow = LIFT_POINT.y - 12;
    scene.add(this.grass.group);
    terrainUniforms.uGrassR.value = this.grass.farRadius;
    this.weather = new Weather(
      this.grass.heightTexture,
      this.grass.heightVP,
      { x: LIFT_POINT.x, y: LIFT_POINT.y + 0.5, z: LIFT_POINT.z, r: 22.5 },
      this.quality === 'low' ? 3500 : this.quality === 'ultra' ? 11000 : 7000,
    );
    scene.add(this.weather.group);
    this.world.onMeshChanged = (c) => {
      if (c.cy >= -2) this.grass.markDirty(c.cx * 16 + 8, c.cz * 16 + 8);
    };

    // 70350-70352
    scene.add(this.hub.group, this.npc.stranger.root, this.npc.mirror.root); // 70350
    this.hubBox = this.hub.collider.geometry.boundingBox!.clone().expandByScalar(2);
    this.debris = new Debris(500, this.world); // LA (70352)
    scene.add(this.sparks.points, this.dust.points, this.debris.mesh, this.rings.group, this.ping.mesh, this.halos.points, this.gemBursts.group, this.vortex.group, this.dashLines.group);

    // headlamp and aura (70551-70554)
    this.headlamp = new THREE.SpotLight(0xffe2b4, 0, 20, 0.62, 0.85, 0.9);
    this.headlamp.castShadow = false;
    this.aura = new THREE.PointLight(0xffd9a8, 0, 10, 1);
    scene.add(this.headlamp, this.headlamp.target, this.aura);

    // 70364-70367: pickups, then the save loads
    this.pickups = new Pickups(scene);
    wirePickups(this);
    this.state.load();
    // MINEAR: the gems sit where this expedition's seed puts them; the expedition log starts with the first visit
    setGemRunSeed(this.state.runSeed);
    if (!this.state.run) this.state.run = startRun(this.state);
    // 70452-70456
    this.player = new PlayerController({ ...this.state.jet });
    this.player.liftPortalY = this.hub.portalY;
    this.player.onLiftWarp = () => this.liftWarp();
    this.spawnAtHub();
    scene.add(this.model.root);
    setupJetpackToggle(this); // MINEAR: jetpack on/off (dock button, J)
    startFpsMeter(); // MINEAR: FPS in the top-right corner
    // MINEAR: the Cheats panel exists only in the dev-local Demo cheat (minear-r3f/src/game/entry.ts)
    if (CHEAT)
      this.cheatPanel = new CheatPanel({
        releaseLock: () => this.releaseLock(),
        goLair: (b) => this.goLair(b),
        // Stock up: ores and gems minted on chain on the local testnet; Capsule Coins to the save
        stockUp: (k) => {
          const plan = stockPlan(k, MATERIAL_IDS, GEM_IDS);
          const refresh = () => {
            this.inv?.refresh();
            if (this.menu?.open) this.menu.refresh();
            this.onStatsChanged();
          };
          if (plan.capsules) {
            this.state.capsules = Math.min(999, this.state.capsules + plan.capsules);
            this.state.save();
          }
          const toast = () => {
            this.audio.purchase();
            this.ui.noteToast(``, `<b>Stock up</b> ${plan.words} (local testnet)`, 0, `stockup`);
            refresh();
          };
          if (!plan.items.length) return toast();
          session
            .cheatAccount()
            .then(() => vault.grant(plan.items))
            .then(toast, (e) => {
              this.audio.deny();
              this.ui.noteToast(``, `<b>Stock up failed</b> ${e instanceof Error ? e.message : e}`, 0, `stockup`);
            });
        },
      });
    // unlimited HP turned on: fill the HP bar
    onCheats((c) => {
      if (c.god && this.combat && !this.combat.ko) this.combat.hp = this.combat.maxHp;
    });

    // combat dI (70458-70533) and the solo monster host (ET as mp.local, EO.simulate)
    const game = this; // eslint-disable-line @typescript-eslint/no-this-alias
    this.combat = new Combat(
      {
        scene,
        world: this.world,
        state: this.state,
        player: this.player,
        model: this.model,
        cam: this.cam,
        get audio() {
          return game.audio;
        },
        get ui() {
          return game.ui;
        },
        sparks: this.sparks,
        dust: this.dust,
        rings: this.rings,
        get pickups() {
          return game.pickups;
        },
        gems: this.gems,
        pickupMesh: (id) => supplyModel(id),
        bombMesh: () => bombModel(),
        lootGear: (depth, at) => this.lootGear(depth, at),
        hitstop: (t) => (this.hitstop = Math.max(this.hitstop, t)),
        safe: (pos) => this.inHaven(pos) || !!this.returning,
        respawn: () => chestsWakeAtHome(this),
        golemDown: (foe, mine) => {
          const d = foe.pos.distanceTo(this.player.pos);
          this.audio.rockfall(THREE.MathUtils.clamp(1.3 - d / 50, 0.2, 1));
          this.cam.addShake(Math.max(0, 0.6 - d * 0.015));
          this.debris.burst(foe.pos.clone().setY(foe.pos.y + 1.5), new THREE.Color(9142904), 30, new THREE.Vector3(0, 1, 0), 7);
          if (mine) {
            this.goals.event('golem');
            this.ui.banner('GOLEM TOPPLED', 'The stone giant crumbles', '#d8c9a6');
          }
        },
        defeated: (foe) => {
          // 70492-70495
          this.goals.event('defeat');
          if (foe.def.biome) this.goals.event('biomefoe');
          if (!this.state.seen.fought) {
            this.state.seen.fought = true;
            this.state.save();
          }
        },
        hitFoe: (id, dmg, dx, dz, knock, chill) => {
          runDealt(this.state, dmg); // MINEAR: the trip summary's "Damage dealt this trip"
          this.foeHost.hitFoe(MY_ID, id as never, dmg, dx, dz, knock, chill);
        },
        me: () => MY_ID as never,
        ground: this.footGround,
        debris: (pos, color, n, speed) => this.debris.burst(pos, new THREE.Color(color), n, new THREE.Vector3(0, 1, 0), speed),
        knockedOut: (by) => chestsKnockedOut(this, by),
        dealt: () => this.ult?.dealt(),
      },
      assets.foes,
    );
    this.foeHost = new SoloFoeHost(
      this.world,
      (to, m) => {
        if (to !== MY_ID) return;
        this.onSim(m);
      },
      undefined,
      (d) => {
        this.world.applyDig(d.x, d.y, d.z, d.r, d.a, d.p, 0);
      },
    );
    // the worm: its host part of ET runs inside the foe host (parts), its client part is KR's worm wiring
    this.wormHost = new WormHost(this.world, (to, m) => {
      if (to === MY_ID) this.onSim(m);
    });
    // the bosses: the boss parts of ET next to the worm (worm first, as ET orders them), and KR's boss glue
    this.bossHost = new BossHost(
      this.world,
      (to, m) => {
        if (to === MY_ID) this.onSim(m);
      },
      undefined,
    );
    this.foeHost.parts = mergeHostParts(wormHostParts(this.wormHost), bossHostParts(this.bossHost));
    this.wormHost.inBossFight = (pl) => this.bossHost.inBossFight(pl);
    this.wormClient = new WormClient(
      {
        scene,
        world: this.world,
        player: this.player,
        cam: this.cam,
        sparks: this.sparks,
        dust: this.dust,
        debris: this.debris,
        combat: this.combat,
        audio: this.audio,
        get ui() {
          return game.ui;
        },
        dreadPass: this.post.dread,
        headlamp: this.headlamp,
        hitstop: (t) => (this.hitstop = Math.max(this.hitstop, t)),
        me: () => MY_ID,
        nameOf: () => 'You',
        hitWorm: (dmg, weak) => {
          runDealt(this.state, dmg);
          this.wormHost.hitWorm(MY_ID, dmg, weak);
        },
        stats: this.state,
        get pickups() {
          return game.pickups;
        },
        gems: this.gems,
        pickupMesh: (id) => supplyModel(id),
        rollGear: (w, f, d) => rollLootGear(w, f, d),
      },
      assets.worm,
    );
    this.bossClient = new BossClient({
      scene,
      world: this.world,
      player: this.player,
      cam: this.cam,
      sparks: this.sparks,
      dust: this.dust,
      debris: this.debris,
      combat: this.combat,
      state: this.state,
      audio: this.audio,
      ui: this.ui,
      hitstop: (t) => (this.hitstop = Math.max(this.hitstop, t)),
      started: () => this.started,
      me: () => MY_ID,
      nameOf: () => 'You',
      hitBoss: (id, dmg, weak) => {
        runDealt(this.state, dmg);
        this.bossHost.hitBoss(MY_ID, id, dmg, weak);
      },
      worm: () => this.wormClient.worm,
      foesDelay: () => this.combat.foes.delay,
      compileScene: (obj) => this.compileScene(obj),
      served: () => false,
      stats: this.state,
      pickups: this.pickups,
      gems: this.gems,
      pickupMesh: (id) => supplyModel(id),
      rollGear: (w, f, d, o) => rollLootGear(w, f, d, o),
      souls: bossSouls,
    });
    this.bossHost.restBosses(this.state.bossBack); // 70761
    ({ ultFx: this.ultFx, ult: this.ult } = makeUlt(this)); // 70556-70583
    this.items = new Items(this, MY_ID); // 70407-70427
    this.chests = makeChests(this, assets.chests); // 70368-70406
    this.loot = makeLootPanel(this); // 70646
    // 70535: gear icons for the HUD and the menus
    gearIcons.build(renderer, assets.gear);
    gearIcons.buildLoot(renderer, (id) => lootModel(this, id));
    this.ui.icons = gearIcons;
    dressMiner(this, assets.gear); // 70537-70539
    this.portrait.attach(this.model.root); // 70540-70548
    this.goals = makeGoals(this); // 70428
    this.menu = createMenu(this); // 70627
    this.menu.base = this.baseDesk = new BaseDesk({
      state: this.state,
      audio: this.audio,
      ui: this.ui,
      onStatsChanged: () => this.onStatsChanged(),
      get inv() {
        return game.inv;
      },
      unlockView: () => this.unlockView(),
      closeSheet: () => closeMenu(this),
      goHome: () => goHome(this),
      atBase: () => this.inHaven(this.player.pos),
      onForged: (grade) => this.tutorial.forged(grade),
    });
    // MINEAR: the vault keeps the save's gear in step with the player's gear NFTs (src/economy/vault.ts)
    vault.bindState(this.state);
    if (session.player) void vault.refresh().then(() => vault.syncGear());
    this.haulShow = new HaulShow({
      audio: this.audio,
      baseReady: () => this.worldReady && this.world.backlog === 0,
      nextGoal: () => this.goalView(),
      board: () => {
        const live = GOALS.map((g, i) => ({ g, i })).filter((e) => !e.g.gone);
        return { done: live.filter((e) => e.i < this.state.goal.i).length, total: live.length };
      },
      onClose: (next) => this.haulClosed(next),
      // MINEAR: the trip summary shows the trip's save on chain (src/economy/vault.ts); Save now retries it
      claimState: () => this.state,
      onClaimed: () => this.afterSave(),
    });
    this.wireHome();
    this.wireDock(); // MINEAR: click the bottom bar labels and belt slots
    // MINEAR: a bigger or smaller window gets the pixel ratio that fits the pixel budget (settings.ts)
    addEventListener('resize', () => {
      if (this.started && !this.lobbyDeep) this.setPixelRatio(this.qualityPixelRatio());
    });
    this.shatter = makeWellspring(this); // 70635
    this.settingsPanel = makeSettingsPanel(this); // 70590
    this.inv = makeInventory(this); // 70650-70663
    this.keysPanel = new ControlsPanel();
    this.leadersPanel = new Leaderboard();
    this.bossClient.setMe(MY_ID); // 70760
    this.weather.onStrike = (d) => this.audio.thunder(d); // 70343

    // touch budgets (70584-70589)
    if (IS_TOUCH) {
      this.world.meshBudget = 4;
      this.world.genBudget = 2;
      this.world.loadFar = 6;
      this.world.unloadRadius = 8;
    }

    this.applySettings();
    this.input.attach(renderer.domElement);
    // 70681-70689: save when the page goes away or is hidden
    this.saveOnLeave = () => {
      if (this.started && !this.sandbox && !this.returning) this.state.save();
    };
    this.saveOnHide = () => {
      if (document.visibilityState === 'hidden') this.saveOnLeave();
    };
    addEventListener('pagehide', this.saveOnLeave, true);
    document.addEventListener('visibilitychange', this.saveOnHide, true);
    if (IS_TOUCH) this.touch = new TouchControls(this.input, { chat: () => {} }); // chat comes with multiplayer
    this.unwirePanels = wirePanels(this); // 70596-70680: buttons, pause, relock rule
    wireTutorialButtons(this); // 70616
    this.tutorial = makeTutorial(this); // 70802
    if (IS_TOUCH) liteLights(this, this.settings.quality === 'lite'); // 70801
    this.tuner = new AutoQuality(
      () => this.settings.quality,
      (q) => {
        this.settings.quality = q;
        this.applySettings();
        saveSettings(this.settings);
        this.settingsPanel?.sync();
      },
    );
    this.crawl = new SlowFrames({
      unbatch: () => (this.world.batch ? (this.world.unbatch(), true) : false),
      snapshot: () => ({ q: this.settings.quality, chunks: this.world.meshes.length }),
      tell: () => {}, // the original sends this to its server (multiplayer telemetry): not in the solo port
    });
  }

  /** KR.onSim (72389): one message from the monster simulation (foes and the worm). */
  private onSim(m: FoeHostMsg | WormMsg | { t: string }) {
    if (this.wormClient?.onSim(m as WormMsg)) return;
    if (this.bossClient?.onSim(m)) return;
    applyFoeMessage(this.combat.foes, m, MY_ID, {
      shot: (kind, pos, vel, dmg, mark, el) => this.combat.foeShot(kind, pos, vel, dmg, mark as never, el as never),
      hurt: (msg) => this.hurtByFoe(msg),
      ambush: (_msg, mine) => {
        if (mine) this.ui.banner('AMBUSH!', 'The Lost claw out of the rock all around you', '#ff6b5f');
        this.audio.rise();
        this.cam.addShake(0.3);
      },
    });
  }

  /** applySettings (71000-71051), the parts that exist in phase 1. */
  /** applySettings (71000-71051): the full port is src/menus/settingsPanel.ts applySettings. */
  applySettings() {
    applyAllSettings(this, this.settings);
    const s = SHADOW_SIZE[this.quality] ?? 2048;
    this.env.sun.shadow.mapSize.set(s, s);
    this.onDpr?.(this.renderer.getPixelRatio());
  }

  /** Loads the miner and warms the world around the spawn (dz 75723-75747, KR.warmUp 70918-70999). */
  async boot(progress: (k: number, text: string) => void) {
    progress(0.2, 'Carving the world…');
    this.world.update(new THREE.Vector3(0, 3, 0), true); // 70694
    // generate and mesh around the spawn before the title shows (KR.warmUp waits for worldReady)
    const t0 = performance.now();
    while (!this.world.update(this.player.pos, true) && performance.now() - t0 < 20000) {
      progress(0.2 + 0.7 * Math.min(1, (performance.now() - t0) / 4000), 'Carving the world…');
      await new Promise((r) => requestAnimationFrame(r));
    }
    progress(0.95, 'Warming up…');
    await warmUlt(this.ultFx, () => this.compileScene());
    this.satchels.warm(true);
    this.tutorial.warm(true);
    await this.compileScene();
    this.satchels.warm(false);
    this.tutorial.warm(false);
    // MINEAR: the underground lobby starts behind the loading screen (no flash of the island first), with its
    // cave loaded; the compile below then covers the sonar materials too.
    if (lobbyMode() !== 'top') {
      progress(0.97, 'Lighting the caves…');
      this.enterLobbyView();
      this.world.boost = true;
      const t1 = performance.now();
      while (!(this.world.update(this.lobbyFocus) && this.world.backlog === 0) && performance.now() - t1 < 8000)
        await new Promise((r) => requestAnimationFrame(r));
      this.world.boost = false;
    }
    await this.renderer.compileAsync(this.scene, this.cam.camera);
    progress(1, 'Ready');
  }

  /** The MINEAR lobby (src/menus/lobby.ts): Continue with Google, Play demo or the dev-local Demo cheat, and the quick boards. */
  showTitle() {
    if (lobbyMode() !== 'top') this.enterLobbyView(); // MINEAR: the lobby looks into the rock (boot already did it)
    openLobby(this);
    if (new URLSearchParams(location.search).has('autostart')) this.start();
    else showInstallPrompt(); // 75747 (touch only)
  }

  /** start (71052) */
  start() {
    const fromLobby = this.lobbyDeep;
    if (lobbyMode() === 'a') this.exitLobbyView(); // option a: the normal view at once
    startGame(this);
    // MINEAR: the lobby's sonar view stays on while the camera flies up through the rock (grass, trees and the
    // island stay hidden); update() turns it off once the camera is above the ground. The short arc of a
    // returning miner gets more time, as the way up from the cave is long.
    if (fromLobby && this.intro && !this.intro.around) this.intro.len = 2.6; // 71052: intro camera, then the tutorial sandbox for a new miner or the return path
  }

  /** spawnPoint (70991) */
  spawnPoint(out = new THREE.Vector3()) {
    return out.set(LIFT_POINT.x, this.hub.liftTop.y + 0.3, LIFT_POINT.z + 2);
  }

  /** spawnAtHub (70994) */
  spawnAtHub() {
    this.spawnPoint(this.player.pos);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = Math.PI;
    this.cam.yaw = Math.PI;
  }

  /** liftWarp (70900): the lift's portal near the top (flash and sound come with the HUD and audio). */
  liftWarp() {
    if (this.sandbox) endSandbox(this, 'done'); // 70901
    const top = this.hub.liftTop;
    this.ui.flash(0.85, '#c9f6ff');
    this.audio.lift();
    this.cam.addShake(0.12);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.sparks.emit({
        pos: new THREE.Vector3(top.x + Math.cos(a) * 1.6, top.y + 0.2, top.z + Math.sin(a) * 1.6),
        vel: new THREE.Vector3(Math.cos(a) * 2.5, 4 + Math.random() * 3, Math.sin(a) * 2.5),
        color: 8381439,
        intensity: 3,
        size: 0.18,
        sizeEnd: 0.02,
        life: 0.9,
        gravity: 5,
      });
    }
  }

  // ---- burrow mode (71328-71535) ----

  /** burrowWish (71328): the 3D flying wish velocity from the keys or the stick, relative to the camera. */
  burrowWish(e: { moveX: number; moveY: number; down(code: string): boolean }) {
    const stick = e.moveX !== 0 || e.moveY !== 0;
    const fwd = stick ? e.moveY : +!!e.down('KeyW') - +!!e.down('KeyS');
    const str = stick ? e.moveX : +!!e.down('KeyD') - +!!e.down('KeyA');
    const up = (e.down('Space') || e.down('KeyE') ? 1 : 0) - (e.down('KeyC') || e.down('KeyQ') ? 1 : 0);
    const right = T1.set(-Math.cos(this.cam.yaw), 0, Math.sin(this.cam.yaw));
    const v = new THREE.Vector3().addScaledVector(this.cam.dir, fwd).addScaledVector(right, str);
    v.y += up;
    const len = v.length();
    if (len < 0.001) return v.set(0, 0, 0);
    const speed = BURROW_SPEED * this.state.burrowMul * (e.down('ShiftLeft') ? 1.45 : 1) * cheatSpeed(); // MINEAR cheat
    return v.multiplyScalar(speed / Math.max(1, len));
  }

  /** boreProbe (71343) */
  private boreProbe(dir: THREE.Vector3) {
    const p = this.player.pos;
    return new THREE.Vector3(p.x, p.y + BURROW_CENTER_Y, p.z).addScaledVector(dir, this.state.drill.radius * 0.8);
  }

  /** rockAhead (71347): the hardest material along the next 1.45 m, or 0 when the way is open. */
  private rockAhead(dir: THREE.Vector3) {
    const p = this.player.pos;
    let mat = 0;
    let best = 118;
    for (const k of [0.45, 0.8, 1.15, 1.45]) {
      const x = p.x + dir.x * k;
      const y = p.y + BURROW_CENTER_Y + dir.y * k;
      const z = p.z + dir.z * k;
      const d = this.world.sample(x, y, z);
      if (d > best) {
        best = d;
        mat = this.world.materialAt(Math.round(x), Math.round(y), Math.round(z)) || Mat.Stone;
      }
    }
    return mat;
  }

  /**
   * MINEAR, burrowed without the jetpack: the miner can dig any way through rock (up too), but cannot rise
   * through open space (a dug shaft or tunnel), and falls where there is no rock under it.
   */
  private noJetBurrow(wish: THREE.Vector3) {
    const len = wish.length();
    // digging into rock (the bore clears about 1.5 m ahead, so look further than rockAhead does)
    if (len > 0.01 && this.rockWithin(NOJET_DIR.copy(wish).multiplyScalar(1 / len), NOJET_REACH)) return;
    if (wish.y > 0) wish.y = 0;
    if (!this.rockAhead(NOJET_DOWN)) wish.y = Math.min(wish.y, -NOJET_FALL);
  }

  /** True when solid rock lies within `reach` metres of the burrow centre along dir. */
  private rockWithin(dir: THREE.Vector3, reach: number) {
    const p = this.player.pos;
    for (let k = 0.45; k <= reach; k += 0.35)
      if (this.world.sample(p.x + dir.x * k, p.y + BURROW_CENTER_Y + dir.y * k, p.z + dir.z * k) > 118) return true;
    return false;
  }

  /** boreSpeed (71362): the speed cap while boring through rock, by drill power over hardness. */
  private boreSpeed(wish: THREE.Vector3): number | null {
    const len = wish.length();
    if (len < 0.5) return null;
    const mat = this.rockAhead(T1.copy(wish).multiplyScalar(1 / len));
    if (!mat) return null;
    const hard = MATERIALS[mat]?.hardness ?? 1;
    if (!isFinite(hard)) return 0;
    // MINEAR cheat: fast burrow rock; MINEAR dig tools: the worn tool's factor on this ground
    const k = fastRock(mat) ? 2.2 : (this.state.drill.power * toolMul(toolOf(this.state.gear.drill?.base), mat)) / hard;
    if (k < 0.3 || this.claws.worn) return 0.15; // MINEAR: worn claws bore slowly
    return BORE_SPEED * Math.min(k, 2.2) * cheatSpeed();
  }

  /** The per-material rule world.dig takes: the fast-burrow cheat rock (full rate), else the worn dig tool's
   *  power factor (minear-r3f/src/game/digTools.ts). */
  private digFn() {
    const tool = toolOf(this.state.gear.drill?.base);
    return (mat: number): boolean | number => (fastRock(mat) ? true : toolMul(tool, mat));
  }

  /** autoDig (71372): clears the body's cell and bores ahead; returns true while boring. */
  private autoDig(dt: number, wish: THREE.Vector3) {
    const p = this.player.pos;
    const center = T0.set(p.x, p.y + BURROW_CENTER_Y, p.z);
    if (this.world.sample(center.x, center.y, center.z) > 138) {
      this.world.dig(center, this.state.drill.radius, 600, this.state.drill.power, this.digFn());
      this.world.remeshNear(center, this.state.drill.radius + 3);
    }
    const len = wish.length();
    if (len < 0.3) {
      this.burrowDigT = 0;
      return false;
    }
    const dir = T1.copy(wish).multiplyScalar(1 / len);
    const blocked = this.player.vel.dot(dir) < len * 0.35;
    if (!this.rockAhead(dir) && !blocked) {
      this.burrowDigT = 0;
      return false;
    }
    const probe = this.boreProbe(dir);
    this.burrowDigT += dt;
    const at = probe.clone().addScaledVector(dir, -0.35);
    // MINEAR cheat: the fast burrow digs more often, so the tunnel end keeps ahead of the faster mole
    const tick = DIG_TICK / cheatSpeed();
    for (; this.burrowDigT >= tick; ) {
      this.burrowDigT -= tick;
      this.digTick(at, dir.clone(), BORE_DIG * cheatSpeed());
    }
    const mat = this.world.materialAt(Math.round(probe.x), Math.round(probe.y), Math.round(probe.z));
    if (mat) this.lastMat = mat;
    return true;
  }

  /** enterBurrow (71390): the rock turns to sonar view. */
  enterBurrow() {
    const p = this.player;
    this.burrow = true;
    this.goals.event('burrow'); // 71393
    this.modeCooldown = 0.8;
    this.world.setMaterial(this.burrowMat);
    this.gems.setBurrow(true);
    this.audio.burrowEnter();
    this.cam.addShake(0.3);
    p.vel.multiplyScalar(0.3);
    this.pingT = 0.45;
    this.hasDug = true;
    for (let i = 0; i < 18; i++)
      this.dust.emit({ pos: p.pos.clone().setY(p.pos.y + 1), spread: 2.5, color: 12098166, size: 0.5, sizeEnd: 1.8, alpha: 0.5, life: 0.9, drag: 2 });
    if (!this.state.seen.burrow) {
      this.state.seen.burrow = true;
      this.state.save();
      this.burrowTipT = 7;
    }
  }

  /** findBreachLanding (71421): open ground near the surface to arc onto when leaving the rock. */
  private findBreachLanding(at: THREE.Vector3) {
    for (let i = 0; i < 8; i++) {
      const a = this.cam.yaw + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4);
      for (const r of [3.2, 4.2, 5.5]) {
        const x = at.x + Math.sin(a) * r;
        const z = at.z + Math.cos(a) * r;
        const g = this.world.groundBelow(x, z, 18, 40);
        if (g !== null && Math.abs(g - surfaceHeight(x, z)) < 1.5) return new THREE.Vector3(x, g + 0.05, z);
      }
    }
    return null;
  }

  /** updateArc (71433): the hop out of a breach hole. */
  private updateArc(dt: number) {
    const a = this.arc;
    if (!a) return false;
    a.t += dt / a.dur;
    const k = Math.min(1, a.t);
    const p = this.player;
    const mid = new THREE.Vector3((a.from.x + a.to.x) / 2, a.peak * 2 - (a.from.y + a.to.y) / 2, (a.from.z + a.to.z) / 2);
    const u = 1 - k;
    p.pos.set(
      u * u * a.from.x + 2 * u * k * mid.x + k * k * a.to.x,
      u * u * a.from.y + 2 * u * k * mid.y + k * k * a.to.y,
      u * u * a.from.z + 2 * u * k * mid.z + k * k * a.to.z,
    );
    p.yaw = Math.atan2(a.to.x - a.from.x, a.to.z - a.from.z);
    p.vel.set(0, (1 - 2 * k) * 8, 0);
    p.onGround = false;
    if (k >= 1) {
      this.arc = null;
      p.vel.set(0, -2, 0);
      p.landed = 9;
    }
    return true;
  }

  /** measureOpenness (71458): the share of open cells in a 5 m ball. */
  private measureOpenness(x: number, y: number, z: number) {
    const step = 1.25;
    let open = 0;
    let all = 0;
    for (let dz = -5; dz <= 5; dz += step)
      for (let dy = -5; dy <= 5; dy += step)
        for (let dx = -5; dx <= 5; dx += step) {
          if (dx * dx + dy * dy + dz * dz > 25) continue;
          all++;
          if (this.world.density(Math.round(x + dx), Math.round(y + dy), Math.round(z + dz)) <= 128) open++;
        }
    return all ? open / all : 0;
  }

  /** exitBurrow (71471): into an open cave (false), or a breach up to the surface (true). */
  exitBurrow(toSurface: boolean) {
    const p = this.player;
    this.burrow = false;
    this.modeCooldown = 1;
    this.world.setMaterial(this.world.material);
    this.world.cullBeyond(p.pos, null);
    this.gems.setBurrow(false);
    this.halos.set([]);
    if (!toSurface) {
      p.vel.y = Math.max(p.vel.y, 2.5);
      this.audio.breach();
      this.cam.addShake(0.2);
      for (let i = 0; i < 10; i++)
        this.dust.emit({ pos: p.pos.clone().setY(p.pos.y + 1), spread: 2, color: 12098166, size: 0.5, sizeEnd: 1.8, alpha: 0.4, life: 0.8, drag: 2 });
      return;
    }
    const top = surfaceHeight(p.pos.x, p.pos.z) + 1.5;
    const c = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z);
    for (; c.y < top; c.y += 1.2) this.world.dig(c, 1.6, 255, 99);
    this.world.remeshNear(new THREE.Vector3(p.pos.x, (p.pos.y + top) / 2, p.pos.z), (top - p.pos.y) / 2 + 3);
    if (this.world.solid(Math.round(p.pos.x), Math.round(p.pos.y + 2.5), Math.round(p.pos.z))) {
      const g = this.world.groundBelow(p.pos.x, p.pos.z, 18, 46);
      if (g !== null) p.pos.y = g + 0.3;
    }
    const land = this.findBreachLanding(p.pos);
    if (land) {
      this.arc = { from: p.pos.clone(), to: land, t: 0, dur: 0.6, peak: Math.max(p.pos.y, land.y) + 2.6 };
      p.vel.set(0, 0, 0);
    } else {
      const h = Math.max(0, top - p.pos.y) + 2.2;
      p.vel.set(0, Math.min(24, Math.sqrt(48 * h)), 0);
    }
    this.audio.breach();
    this.cam.addShake(0.45);
    const color = MATERIALS[this.lastMat]?.color ?? 11566418;
    this.debris.burst(p.pos.clone().setY(p.pos.y + 1.5), color, 22, new THREE.Vector3(0, 1, 0), 7);
    for (let i = 0; i < 16; i++)
      this.dust.emit({ pos: p.pos.clone().setY(p.pos.y + 1.2), vel: new THREE.Vector3(0, 4, 0), spread: 3, color: 14206888, size: 0.7, sizeEnd: 2.4, alpha: 0.45, life: 1.1, drag: 2 });
  }

  /** lootGear hook of combat (70497): a gear drop rolled by Fortune, or coins when the armory is full. */
  lootGear(depth: number, at: THREE.Vector3) {
    if (!TRIP_GIVES_GEAR) return; // MINEAR: gear comes from the Forge, never from underground (src/base/run.ts)
    const item = rollLootGear([46, 34, 15, 4.3, 0.7], this.state.fortuneNow, depth);
    if (this.state.addItem(item)) {
      this.ui.itemToast(item as never);
      this.audio.loot(item.tier);
      this.ui.floater(at.clone().setY(at.y + 1.4), item.name, TIER_COLORS[item.tier]);
    } else {
      const coins = gearSellPrice(item);
      this.state.earn(coins);
      this.ui.floater(at.clone().setY(at.y + 1.4), `+${coins} coins (armory full)`, '#ffc23d');
    }
    this.state.save();
  }

  /** keepWhere (71153): remembers where the miner is, saved every 4 s after moving 2 m. */
  private keepWhere(dt: number) {
    if (!this.started || this.sandbox || this.returning) return;
    const p = this.player;
    const keep = !this.combat.ko && !p.lifting && !this.inHaven(p.pos);
    if (keep) {
      const w = (this.state.where ??= [0, 0, 0, 0]);
      w[0] = p.pos.x;
      w[1] = p.pos.y;
      w[2] = p.pos.z;
      w[3] = p.yaw;
    } else this.state.where = null;
    this.whereT -= dt;
    if (this.whereT > 0) return;
    this.whereT = 4;
    if (keep ? p.pos.distanceToSquared(this.whereSaved) > 4 : this.whereSaved.x !== Infinity) {
      if (keep) this.whereSaved.copy(p.pos);
      else this.whereSaved.set(Infinity, 0, 0);
      this.state.save();
    }
  }

  /** beginReturn (71115): back where you left off, held still while the land comes in. */
  beginReturn(w: number[]) {
    const p = this.player;
    p.pos.set(w[0], w[1], w[2]);
    p.vel.set(0, 0, 0);
    p.yaw = this.cam.yaw = w[3];
    this.cam.pitch = -0.2;
    this.returning = { at: p.pos.clone(), t: 0, heard: 0 };
    this.world.boost = true;
    const d = Math.round(surfaceHeight(w[0], w[2]) - w[1]);
    const el = document.getElementById('back')!;
    el.querySelector('span')!.textContent = d > 3 ? `${d} m down` : '';
    el.classList.add('on');
  }

  /** updateReturn (71128) */
  private updateReturn(dt: number) {
    const r = this.returning;
    if (!r) return;
    r.t += dt;
    if (!(this.worldReady && this.world.backlog === 0) && r.t < 8) return;
    this.returning = null;
    this.world.boost = false;
    document.getElementById('back')!.classList.remove('on');
    if (this.embedded(r.at)) {
      this.world.dig(T0.set(r.at.x, r.at.y + 1, r.at.z), 1.9, 1e3, 200);
      this.world.dig(T1.set(r.at.x, r.at.y + 0.25, r.at.z), 1.5, 1e3, 200);
      this.world.remeshNear(T0.set(r.at.x, r.at.y + 1, r.at.z), 4);
      this.ui.banner('THE ROCK GREW BACK', 'Mine your way out', '#d8c7a8');
    }
  }

  /** embedded (71144) */
  private embedded(at: THREE.Vector3) {
    for (const k of [0.3, 0.9, 1.5]) if (this.world.sample(at.x, at.y + k, at.z) > 128) return true;
    return false;
  }

  /** biomeNear (75504): a hint floater the first time a biome cavern is near. */
  private biomeNear(b: keyof typeof BIOMES, dir: THREE.Vector3) {
    if (!this.started || this.combat.ko || this.state.seen['biome:' + b] || this.hinted.has(b)) return;
    this.hinted.add(b);
    const smell: Record<string, string> = {
      ember: 'Warm air rising, and a smell of burning stone',
      bog: 'A reek of rot, and water dripping somewhere',
      frost: 'A cold draught, and the rock furred with frost',
      haunt: 'Whispers in the rock, and an old chill',
    };
    const f = this.cam.camera.getWorldDirection(T2).setY(0).normalize();
    const side = f.x * dir.z - f.z * dir.x;
    const ahead = f.dot(dir);
    const where = ahead > 0.7 ? 'ahead' : ahead < -0.7 ? 'behind you' : side > 0 ? 'to your right' : 'to your left';
    const p = this.player.pos;
    this.ui.floater(p.clone().setY(p.y + 2.5), `${smell[b]}... ${where}`, BIOMES[b].color);
  }

  /** biomeEntered (75521): the discovery banner the first time. */
  private biomeEntered(b: keyof typeof BIOMES) {
    if (!this.started || this.combat.ko) return;
    const d = BIOMES[b];
    if (this.state.seen['biome:' + b]) return;
    this.state.seen['biome:' + b] = true;
    this.state.save();
    this.ui.banner(d.name, d.blurb, d.color);
    this.audio.discover(b);
    this.goals.event('biome'); // 75529
  }

  /** inHaven (74779): the town zone, where the Lost do not follow. */
  inHaven(pos: THREE.Vector3) {
    return inTownZone(pos);
  }

  /** simPlayer (72369): what the monster simulation sees of the local miner. */
  simPlayer() {
    const p = this.player;
    return {
      id: MY_ID,
      pos: p.pos,
      vel: p.vel,
      // MINEAR cheat: hidden from foes, bosses and the worm
      ok: this.started && !this.combat.ko && !p.lifting && !this.inHaven(p.pos) && !cheats.hidden,
      ko: this.combat.ko,
      digging: this.drilling || this.burrow,
      burrowing: this.burrow,
      fortune: 0,
    };
  }

  /** hurtBy (72799), the foe case. */
  private hurtByFoe(msg: { dmg: number; p: [number, number, number]; knock: number; by: number }) {
    const at = new THREE.Vector3().fromArray(msg.p);
    const n = this.player.pos;
    const foe = this.combat.foes.byId(msg.by as never);
    if (foe && (Math.hypot(foe.pos.x - n.x, foe.pos.z - n.z) > foe.def.range + 4 || Math.abs(foe.pos.y - n.y) > 3.5)) return;
    if (this.combat.hurt(msg.dmg, foe?.pos ?? at, msg.knock, foe ?? undefined) && foe?.def.el)
      this.combat.afflict(msg.dmg, foe.def.el as never);
  }

  /** colliders (71544): chunk meshes in a box plus the hub collider (stranger and mirror come later). */
  colliders = (box: THREE.Box3) => {
    const list = this.world.collidersIn(box, this.colliderList);
    if (box.intersectsBox(this.hubBox)) list.push(this.hub.collider);
    this.npc.colliders(box, list); // 71548-71551
    return list;
  };

  /** compileScene (70949): compiles new materials into the composer's read buffer, giving up after 8 s. */
  compileScene(obj: THREE.Object3D = this.scene): Promise<void> {
    const compile = this.renderer.compileAsync(obj, this.cam.camera, this.scene).then(() => {});
    return Promise.race([compile, new Promise<void>((r) => setTimeout(r, 8000))]);
  }

  /** run (71555): one animation frame. */
  frame() {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.update(dt);
    const drawn = performance.now();
    presentFrame(this, dt, now); // 71562-71574: draw, or freeze the frame behind a panel
    const done = performance.now();
    compileTick(this, now); // 71576-71583
    this.input.endFrame();
    // 71585-71594: the auto quality tuner and the slow-frame watch
    const active = this.started && !document.hidden && !this.anyPanel && !this.combat.ko && !this.paused;
    if (this.settings.autoQuality) this.tuner.frame(raw, active);
    this.crawl.frame(raw, drawn - now, done - drawn, active, now);
  }

  /** resize (71303) */
  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.post.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.post.composer.setSize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    const scale = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.camera.fov / 2)));
    this.sparks.material.uniforms.uScale.value = scale;
    this.dust.material.uniforms.uScale.value = scale;
    this.biomes.sparks.material.uniforms.uScale.value = scale;
    this.biomes.dust.material.uniforms.uScale.value = scale;
    this.halos.material.uniforms.uScale.value = scale;
    this.post.dread.uniforms.uRes.value.set(w * pr, h * pr);
  }

  get controlling() {
    return isPlaying(this);
  }

  // belt hooks for the pickups glue and the HUD (src/pickups/collect.ts PickupHost, src/ui/kr-hud.ts)
  get belt() {
    return this.items.belt;
  }
  get stoneT() {
    return this.items.stoneT;
  }
  stoneBroken(why: string) {
    this.items.stoneBroken(why);
  }
  useBelt(slot: number) {
    useBelt(this, slot);
  }

  /** releaseLock (72250) */
  releaseLock() {
    panelsReleaseLock(this);
  }
  openMenu() {
    panelsOpenMenu(this);
  }

  // ---- MINEAR base (src/base) ----

  /** What the site unlock rules read. */
  unlockView(): UnlockView {
    const s = this.state;
    return { deepest: s.deepest, level: s.level, beasts: s.souls.length + s.soulsGiven.length, wallet: !!session.player };
  }
  /** Opens a base theme in the building sheet. */
  openBase(theme: BaseTheme) {
    this.menu.show(this.state, theme);
    this.audio.click();
    this.releaseLock();
  }
  /** E at a base site: its panel when open, else what it needs to unlock. */
  openSite(id: SiteId) {
    if (id === 'trade') return this.openMenu();
    const st = siteStatus(SITE_BY_ID[id], this.unlockView());
    this.baseDesk.site = id;
    const theme: BaseTheme =
      st !== 'open' ? 'site' : id === 'refinery' || id === 'forge' || id === 'board' || id === 'capsule' ? id : 'site';
    this.openBase(theme);
  }
  siteHint(id: SiteId) {
    const d = SITE_BY_ID[id];
    const st = siteStatus(d, this.unlockView());
    if (st === 'locked') return `<b>${d.name}</b>: locked. ${d.unlock?.text}. Press <kbd>E</kbd> to look`;
    if (st === 'soon') return `<b>${d.name}</b>: opening soon. Press <kbd>E</kbd> to look`;
    if (id === 'refinery') return `Press <kbd>E</kbd> to use the <b>Refinery</b>: smelt ore into the next ore up`;
    if (id === 'forge') return `Press <kbd>E</kbd> to use the <b>Forge</b>: make gear, salvage it, reroll its enchants`;
    if (id === 'board') return `Press <kbd>E</kbd> to read the <b>Requests Board</b>`;
    if (id === 'capsule') return `Press <kbd>E</kbd> to use the <b>Capsule Machine</b> (${this.state.capsules} Capsule Coins)`;
    return `Press <kbd>E</kbd> to look at the <b>${d.name}</b>`;
  }
  siteWord(id: SiteId) {
    const st = siteStatus(SITE_BY_ID[id], this.unlockView());
    if (st !== 'open') return 'Look';
    return id === 'refinery' ? 'Smelt' : id === 'forge' ? 'Forge' : id === 'board' ? 'Read' : id === 'capsule' ? 'Spin' : 'Use';
  }
  /** Back to Base: hides the open sheet without asking for the pointer (the haul sheet follows). */
  closeAnyPanel() {
    if (this.menu.open) this.menu.hide();
    if (this.shatter?.open) this.shatter.hide();
    if (this.inv?.open) this.inv.hide();
  }
  /** MINEAR: the tutorial's `finish` step is on: Finish trip and worn-out claws end its trip (backToBase.ts). */
  get tutorialTrip() {
    return this.sandbox && this.tutorial?.step === 'finish';
  }
  /** MINEAR: ends the tutorial sandbox with its trip's finds; a first tutorial keeps them (src/tutorial/krTutorial.ts). */
  endTutorialTrip(took: Record<string, number>) {
    const keep = this.tutorial.first;
    endSandbox(this, 'done', keep ? { ...took } : null);
    return keep;
  }
  setHaul(h: Haul) {
    this.baseDesk.haul = h;
  }
  /**
   * MINEAR: the haul show after a teleport home. The 3D view freezes behind it (it counts as a panel), and the
   * land around the lift streams in with larger per-frame budgets than in play (still capped, so the show keeps
   * animating), so the miner lands in a finished base instead of watching it load in.
   */
  /** MINEAR: the trip's save on chain finished (src/base/backToBase.ts): the HUD and the bag show what is left. */
  afterSave() {
    this.inv?.refresh();
    this.ui.bumpCrystals?.();
  }
  showHaul(h: Haul, why?: string) {
    this.homeBudget ??= { gen: this.world.genBudget, mesh: this.world.meshBudget };
    this.world.genBudget = 10;
    this.world.meshBudget = 12;
    this.releaseLock();
    this.haulShow.show(h, { why });
  }
  /**
   * MINEAR: the trip summary closed: normal streaming budgets, the mouse back to the game. "Upgrade at base"
   * leaves the miner on the base; "Continue mining" teleports the miner down to the land beside the lift.
   */
  private haulClosed(next: TripNext) {
    if (this.homeBudget) {
      this.world.genBudget = this.homeBudget.gen;
      this.world.meshBudget = this.homeBudget.mesh;
      this.homeBudget = null;
    }
    if (next === 'mine') this.landBesideLift();
    if (this.started && !this.anyPanel && !this.paused) this.input.requestLock();
  }
  /**
   * MINEAR "Continue mining": the miner lands on the land a few metres out from the lift column (outside it, so
   * the lift does not pull the miner up again), facing away from the lift, on the first open ground found.
   */
  landBesideLift() {
    const p = this.player;
    const r = 7;
    let at: THREE.Vector3 | null = null;
    for (let i = 0; i < 12 && !at; i++) {
      const a = Math.PI + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const x = LIFT_POINT.x + Math.sin(a) * r;
      const z = LIFT_POINT.z + Math.cos(a) * r;
      const top = surfaceHeight(x, z);
      const g = this.world.groundBelow(x, z, top + 6, 14);
      if (g !== null && Math.abs(g - top) < 2) at = new THREE.Vector3(x, g + 0.3, z);
    }
    at ??= new THREE.Vector3(LIFT_POINT.x, surfaceHeight(LIFT_POINT.x, LIFT_POINT.z + r) + 1, LIFT_POINT.z + r);
    p.stopLift();
    p.pos.copy(at);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(at.x - LIFT_POINT.x, at.z - LIFT_POINT.z);
    this.cam.yaw = p.yaw;
    this.ui.flash(0.6, '#c9f6ff');
    this.audio.lift();
    this.cam.addShake(0.1);
  }
  /** MINEAR: the current request as the trip summary shows it ("Next goal"). */
  private goalView(): GoalView | null {
    const g = this.goals.current;
    if (!g) return null;
    const need = g.need ?? g.depth ?? g.biomes ?? g.slain ?? 1;
    if (g.depth !== undefined) return { text: g.text, progress: `Reach ${g.depth} m`, k: -1, reward: g.reward };
    const c = Math.min(need, this.state.goal.c);
    return { text: g.text, progress: need > 1 ? `${c} / ${need}` : ``, k: need > 1 ? c / need : -1, reward: g.reward };
  }
  /** MINEAR: a full-screen overlay outside the KR panels is up (src/menus/panels.ts anyPanelOpen). */
  overlayOpen(): boolean {
    return !!this.haulShow?.open || !!this.merchantUi?.merchantOpen();
  }
  /** MINEAR: the merchant dialog module, loaded on the first visit (it brings the NEAR libraries). */
  private merchantUi: typeof import('../menus/merchantDialog') | null = null;
  /** MINEAR: E at a merchant's stall: its dialog (src/menus/merchantDialog.ts). */
  async openMerchant(id: string) {
    this.releaseLock();
    this.audio.click();
    this.merchantUi ??= await import('../menus/merchantDialog');
    this.merchantUi.openMerchant(id, {
      state: this.state,
      onLocalChange: () => {
        this.inv?.refresh();
        this.onStatsChanged();
      },
      onClose: () => {
        if (this.started && !this.anyPanel && !this.paused) this.input.requestLock();
      },
    });
  }
  /** MINEAR: a mouse click on the bottom bar's labels and belt slots works like their keys (touch wires its own). */
  private wireDock() {
    const tapOn = (el: Element | undefined, code: string) => {
      if (!el) return;
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.started && !this.paused) this.input.tap(code);
      });
    };
    const keys = document.querySelectorAll('#vitals .key');
    tapOn(keys[0], 'Tab');
    tapOn(keys[1], 'KeyB');
    document.querySelectorAll('#belt .bslot').forEach((el, i) => tapOn(el, `Digit${i + 1}`));
  }
  /** The dock button, the H key and the pause sheet's Finish mining trip. */
  private wireHome() {
    const btn = document.getElementById('homebtn') as HTMLButtonElement | null;
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      askHome(this);
    });
    document.querySelectorAll('.open-home').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ui.pauseEl.classList.add('hidden');
        askHome(this);
      }),
    );
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyH' || e.repeat || !this.started) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (this.menu.open && this.menu.current === 'home') closeMenu(this);
      else if (!this.anyPanel && !this.paused) askHome(this);
    });
  }
  /** MINEAR cheat: warps near the lair of a biome's beast, outside its wake range, facing it. */
  goLair(biome: BiomeId) {
    if (!this.started || this.sandbox || this.returning || this.combat.ko) return;
    const b = beastCaverns().find((c) => c.biome === biome);
    const cav = b ? cavernAt(b.ix, b.iy, b.iz) : null;
    if (!cav) return;
    const kind = BOSS_OF_BIOME[biome];
    if (!kind) return;
    const lair = bossLair(cav);
    const want = BOSS_DEFS[kind].wakeR + 8;
    let at: THREE.Vector3 | null = null;
    for (let k = 0; k < 24 && !at; k++) {
      const a = (k / 24) * Math.PI * 2;
      for (const d of [want, want * 0.8, want * 0.6]) {
        const x = lair.x + Math.cos(a) * d;
        const z = lair.z + Math.sin(a) * d;
        const y = cavernFloorY(cav, x, z);
        if (y > cav.liquidY + 0.5 && cavernMetric(cav, x, y + 2, z) < 0.7) {
          at = new THREE.Vector3(x, y, z);
          break;
        }
      }
    }
    at ??= new THREE.Vector3(lair.x + want, lair.y + 1, lair.z);
    if (this.burrow) this.exitBurrow(false);
    this.arc = null;
    this.ult.stop();
    this.player.stopLift();
    this.closeAnyPanel();
    const label = document.querySelector('#back b');
    const old = label?.textContent ?? '';
    if (label) label.textContent = `Warping to ${BOSS_DEFS[kind].name}`;
    setTimeout(() => label && (label.textContent = old), 9000);
    this.beginReturn([at.x, at.y + 0.3, at.z, Math.atan2(lair.x - at.x, lair.z - at.z)]);
    this.input.requestLock();
  }
  openStash() {
    panelsOpenStash(this);
  }
  openShatter() {
    panelsOpenShatter(this);
  }
  openChest(c: Chest) {
    chestsOpen(this, c);
  }
  lootSatchel(sd: SatchelData) {
    chestsLootSatchel(this, sd);
  }
  describeSatchel(sd: SatchelData) {
    return lootSummary(sd as never);
  }

  // NPC hooks for the HUD use keys (src/ui/kr-hud.ts)
  get stranger() {
    return this.npc.stranger;
  }
  get mirror() {
    return this.npc.mirror;
  }
  talkToStranger() {
    this.npc.talkToStranger();
  }
  openLeaders() {
    this.npc.openLeaders();
  }
  nextBeast() {
    return this.npc.nextBeast();
  }

  /** renderPortrait (73502): the miner portrait on the inventory gear page. */
  renderPortrait(dt: number) {
    this.portrait.render(this, dt);
  }
  /** syncLook (73018) */
  syncLook() {
    wardrobeSyncLook(this);
  }
  /** onStatsChanged (73248) */
  onStatsChanged() {
    economyStatsChanged(this);
  }

  /** playing (71249) */
  get playing() {
    return isPlaying(this);
  }

  /** update (71620), phase 1 subset in the original order. */
  update(dt: number) {
    let t = dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      t = dt * 0.06;
    }
    const input = this.input;
    const p = this.player;
    const ready = this.world.update(this.lobbyDeep && !this.started ? this.lobbyFocus : p.pos); // MINEAR: the lobby streams its cave
    this.worldReady = ready;
    if (this.started) this.handleKeys();
    const active = this.controlling;
    const depthNow = surfaceHeight(p.pos.x, p.pos.z) - p.pos.y;
    this.claws.update(dt, this.started && !this.burrow && depthNow < 4); // MINEAR: claws rest on the surface
    // MINEAR: claws worn right out underground: the miner teleports home at once (no confirm) to rest them
    if (this.claws.worn && !this.claws.unlimited && depthNow > 4 && !this.haulShow.open && canGoHome(this))
      goHome(this, 'Your claws wore out, so the trip ended. They rest while you are above ground.');
    this.bossClient.checkDepth(depthNow); // 71636: the boss models load lazily below 120 m
    // 71637-71651: burrow mode switches on deep in tight rock and off near the surface or in open caves
    this.modeCooldown -= dt;
    this.openT -= dt;
    if (this.openT <= 0) {
      this.openT = 0.15;
      this.openness = this.measureOpenness(p.pos.x, p.pos.y + BURROW_CENTER_Y, p.pos.z);
    }
    if (this.started && !p.lifting && this.modeCooldown <= 0 && !this.ult.leap && !this.returning) {
      if (!this.burrow && depthNow > 5 && this.openness < BURROW_ENTER_OPEN) this.enterBurrow();
      else if (this.burrow && depthNow < 3) this.exitBurrow(true);
      else if (this.burrow && this.openness > BURROW_EXIT_OPEN) this.exitBurrow(false);
    }
    p.stats = { ...this.state.jet };
    const aboveFloor = p.pos.y < 38;
    this.bore = false;
    if (!this.ult.step(t) && !this.updateArc(t)) {
      if (this.burrow) {
        // 71656-71662
        const wish = this.burrowWish(active ? input : NULL_INPUT);
        this.burrowPush = wish.lengthSq() > 0.01;
        if (!p.jetpackOn) this.noJetBurrow(wish); // MINEAR
        const cap = this.boreSpeed(wish);
        if (cap !== null && wish.length() > cap) wish.setLength(cap);
        p.updateBurrow(t, wish, this.colliders, !ready && aboveFloor);
        this.bore = this.autoDig(t, wish);
        if (wish.lengthSq() < 0.01 && !this.drilling) p.yaw = this.cam.yaw;
      } else
        p.update(
          t,
          active ? input : NULL_INPUT,
          this.cam.yaw,
          this.colliders,
          (pos) => (!this.sandbox || this.tutorial.liftOpen) && this.hub.inLiftColumn(pos), // 71669
          this.hub.liftTop.y,
          !ready && aboveFloor && !p.lifting,
        );
    }
    this.items.updateFooting(t); // 71675
    if (!this.burrow && !p.lifting) {
      // 71676-71680 (cave decor push-out comes with cave decor)
      this.decor.pushOut(p.pos, p.vel, 0.38);
      this.caveDecor.pushOut(p.pos, p.vel, 0.38);
      this.hub.pushOutStash(p.pos, p.vel);
      this.hub.pushOutSites(p.pos, p.vel); // MINEAR base: the Capsule Machine
    }
    if (!this.started) this.spawnPoint(p.pos);
    if (this.returning) {
      p.pos.copy(this.returning.at);
      p.vel.set(0, 0, 0);
    }
    this.updateReturn(dt);
    this.keepWhere(dt);
    updateHavenGoals(this); // 71685-71692

    // lift start burst and the rising sparks while lifting (71694-71716)
    if (p.lifting && !this.wasLifting) this.audio.lift();
    if (p.lifting && !this.wasLifting)
      this.sparks.emit({ pos: p.pos.clone().setY(p.pos.y + 1), color: 8381439, intensity: 3, count: 30, spread: 3, size: 0.2, life: 0.8 });
    this.wasLifting = p.lifting;
    if (p.lifting)
      this.sparks.emit({
        pos: p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)),
        vel: new THREE.Vector3(0, -3, 0),
        color: 8381439,
        intensity: 2.5,
        size: 0.15,
        life: 0.6,
      });

    if (p.landed > 0) {
      const v = p.landed;
      p.landed = 0;
      if (v > 5) {
        this.model.land(v);
        this.audio.land(v);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.dust.emit({
            pos: p.pos.clone().add(new THREE.Vector3(0, 0.1, 0)),
            vel: new THREE.Vector3(Math.cos(a) * 3, 0.4, Math.sin(a) * 3),
            color: 14206888,
            size: 0.5,
            sizeEnd: 1.6,
            alpha: 0.4,
            life: 0.7,
            drag: 3,
          });
        }
        if (v > 16) this.cam.addShake(Math.min(0.6, v / 50));
      }
    }
    // stuck inside rock: float up (71738)
    if (!this.burrow && this.world.sample(p.pos.x, p.pos.y + 0.9, p.pos.z) > 215 && !p.lifting && aboveFloor) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) p.pos.y += 4 * dt;
    } else this.stuckT = 0;

    const kick = p.thrust * 5 + (p.lifting ? 8 : 0) + (this.burrow ? p.thrust * 4 : 0) + (p.dodging ? 7 : 0) + this.ult.fovKick;
    this.cam.fovKick = THREE.MathUtils.lerp(this.cam.fovKick, kick, Math.min(1, dt * 4));
    if (this.started) {
      this.cam.update(dt, active ? input : NULL_INPUT, p.pos, this.colliders, this.burrow);
      updateIntro(this, dt); // 71748
      if (this.lobbyDeep) {
        const c = this.cam.camera.position;
        if (!this.intro || c.y > surfaceHeight(c.x, c.z) + 1) this.exitLobbyView(); // MINEAR: out of the ground
      }
    }
    else this.titleCamera(dt);

    ATMO.focus.set(p.pos.x, p.pos.y + 1, p.pos.z, this.started ? 1 : 0);
    this.ult.frame(dt, t, active); // 71765
    this.tutorial.update(dt, active); // 71766
    this.updateDrill(t, active && !this.ult.holdsLmb);
    // 71768-71783: combat, the monster simulation, then the foe views
    this.combat.update(t, {
      controlling: active,
      burrow: this.burrow,
      lmb: active && input.lmb && !this.ult.holdsLmb,
      rmb: active && input.rmb && !this.ult.holdsRmb,
      dodge: active && !this.burrow && !this.ult.owns && (input.doubled('KeyW') || input.doubled('KeyA') || input.doubled('KeyS') || input.doubled('KeyD')),
      fwd: input.moveX !== 0 || input.moveY !== 0 ? input.moveY : +!!input.down('KeyW') - +!!input.down('KeyS'),
      str: input.moveX !== 0 || input.moveY !== 0 ? input.moveX : +!!input.down('KeyD') - +!!input.down('KeyA'),
    });
    this.foeHost.simulate(t, this.simPlayer());
    {
      // EO.simulate (48946): the worm snapshot after the foe post
      const w = this.wormHost.snapshot(MY_ID);
      if (w) this.onSim({ t: 'worm', w } as WormMsg);
      const list = this.bossHost.snapshot(MY_ID); // 48947
      if (list.length) this.onSim({ t: 'bosses', list } as never);
    }
    this.combat.foes.eye.set(p.pos.x, p.pos.y + 1.4, p.pos.z);
    this.combat.updateFoes(t);
    updateChests(this, t); // 71785
    this.wormClient.update(dt, t); // 71793
    this.bossClient.update(dt, t); // 71794
    updateChestHints(this, t); // 71795-71810

    // the miner (71811-71846)
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const m = this.model;
    if (m) {
      m.root.position.copy(p.pos);
      const pitch = this.drilling || this.pointing ? this.aimPitch : this.cam.pitch * 0.3;
      m.update(t, {
        yaw: p.yaw,
        speed,
        onGround: p.onGround,
        thrust: p.jetpackOn ? p.thrust : 0,
        drilling: this.drilling || this.pointing || this.combat.aiming,
        point: this.pointing,
        aiming: this.combat.aiming,
        bore: this.bore,
        dig: this.drilling, // MINEAR: claws on rock, a foe or the worm (nearmol crawls toward it)
        burrowPush: this.burrow && this.burrowPush,
        aimPitch: pitch,
        vy: p.vel.y,
        vel: p.vel,
        burrow: this.burrow,
        lookYaw: this.cam.yaw,
        ground: this.footGround,
        slam: this.ult.slamPose(),
      });
      m.setOpacity(this.cam.dist < 0.9);
      m.root.updateMatrixWorld(true);
      // 71847-71879: dash speed lines (the ult streak comes with the Drill Slam)
      const streak = this.ult.streak(T3);
      const dashing = (p.dodging && !this.burrow) || !!streak;
      if (dashing && !this.wasDashing) this.dashLines.start(streak ?? T0.set(p.vel.x, 0, p.vel.z), m.trailPoints(this.trailPts), !!streak);
      else if (streak) this.dashLines.turn(streak);
      this.wasDashing = dashing;
      this.dashLines.update(t, dashing, T1.set(p.pos.x, p.pos.y + 0.9, p.pos.z), m.trailPoints(this.trailPts), this.cam.camera.position);
      if (p.dodging && p.onGround && !this.burrow && Math.random() < 0.6)
        this.dust.emit({ pos: T0.set(p.pos.x, p.pos.y + 0.08, p.pos.z), vel: T1.set(-p.vel.x * 0.12, 0.4, -p.vel.z * 0.12), spread: 0.5, color: 13483942, size: 0.24, sizeEnd: 0.8, alpha: 0.24, life: 0.4, drag: 3 });
      if (p.thrust > 0.05 && p.jetpackOn) this.jetFlames(p);
      // 71913-71920: the drill's suction funnel when it points at air
      this.vortex.update(t, this.pointing || this.ult.spinning, m.drillTip(T2), m.drillAxis(T3), this.cam.camera.position);
      if (this.pointing) this.airPull(t);
    }

    // headlamp and aura (71921-71936)
    const under = this.env.underground;
    if (m) m.lampAnchor.getWorldPosition(T0);
    else T0.copy(p.pos).setY(p.pos.y + 1.6);
    this.headlamp.position.copy(T0);
    this.cam.camera.getWorldDirection(T1);
    this.headlamp.target.position.copy(T0).addScaledVector(T1, 12);
    this.headlamp.target.updateMatrixWorld();
    this.headlamp.intensity = this.state.lamp.intensity * Math.max(under, this.env.clock.night * 0.8) * this.biomeEvents.flicker;
    this.headlamp.distance = this.state.lamp.range;
    this.aura.position.copy(p.pos).add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(T1, -1.6);
    this.aura.intensity = 1.6 * Math.max(under, this.env.clock.night * 0.55);
    this.headlamp.updateMatrixWorld();
    this.aura.updateMatrixWorld();
    updatePickups(this, t); // 71937
    this.items.update(t, dt); // 71944-71946
    updateSatchels(this, dt); // 71947
    this.menu.update(dt); // 71949

    const depth = surfaceHeight(p.pos.x, p.pos.z) - p.pos.y;
    if (depth > this.state.deepest) this.state.deepest = depth;
    layerNote(this, depth);
    const murky = this.burrow || this.lobbyDeep; // MINEAR: the lobby's underground view is murky too
    this.murk += (+murky - this.murk) * Math.min(1, dt * (murky ? 3.5 : 5)); // 71956
    const mu = this.post.murk.uniforms;
    mu.uMurk.value = this.lobbyDeep ? this.murk * this.lobbyView.murk : this.murk;
    mu.uTime.value += dt;
    mu.uTint.value.setHex(depth > 90 ? 8022696 : depth > 40 ? 7305832 : 9072472);
    const air = this.biomes.air(); // 71962
    if (air) mu.uTint.value.lerp(air.murk, this.biomes.k);

    // 71957-71988: the sonar rock uniforms, burrow culling and the sonar ping
    const sense = this.state.lamp.sense;
    const b = this.burrowU;
    b.uPlayer.value.copy(this.lobbyDeep ? this.lobbyEye(T3) : p.pos); // MINEAR lobby: the rock around the lobby spot
    b.uCam.value.copy(this.cam.camera.position);
    b.uTime.value += dt;
    b.uFade.value = this.murk;
    b.uFar.value = this.lobbyDeep ? this.lobbyView.far : 26 + sense * 0.25;
    b.uFlashPos.value.copy(this.gemBursts.focus.pos);
    b.uFlashCol.value.copy(this.gemBursts.focus.color);
    b.uFlashK.value = this.gemBursts.focus.strength;
    if (this.lobbyDeep) this.world.cullBeyond(b.uPlayer.value, b.uFar.value + 6);
    else if (!this.burrow) {
      const camPos = this.cam.camera.position;
      this.world.cullBuried(camPos, camPos.y > surfaceHeight(camPos.x, camPos.z) - 3);
    } else {
      this.world.cullBeyond(p.pos, b.uFar.value);
      this.pingT -= dt;
      if (this.pingT <= 0) {
        this.pingT = this.state.sonarEvery;
        this.ping.fire();
        this.audio.sonar();
      }
    }
    this.echoT -= dt;
    this.ping.update(dt, T3.copy(p.pos).setY(p.pos.y + BURROW_CENTER_Y), (sense + 2) * this.state.sonarReach);
    b.uOreSight.value = this.lobbyDeep ? 3 : this.burrow ? this.state.stat('oresight') : 0;
    b.uPing.value = this.ping.radius;

    // weather and environment (72004-72048)
    const w = this.weather;
    w.update(dt, this.cam.camera, this.env.underground, surfaceHeight);
    this.env.cover = w.now.cover;
    this.env.overcast = w.now.overcast;
    this.env.storm = w.now.storm;
    this.env.mist = w.now.mist;
    this.env.flash = w.flash;
    this.audio.setWorld(w.now.rain, w.now.wind, w.now.storm, this.env.clock.night); // 72012
    this.farMaskT -= dt;
    if (this.farMaskT <= 0) {
      this.farMaskT = 0.2;
      const cx = Math.floor(p.pos.x / 16);
      const cz = Math.floor(p.pos.z / 16);
      const world = this.world;
      world.drawCX = cx;
      world.drawCZ = cz;
      this.env.setLoaded(cx, cz, (x, z) => {
        if (world.drawR !== Infinity && (x - cx) ** 2 + (z - cz) ** 2 > world.drawR * world.drawR) return false;
        const sy = surfaceHeight(x * 16 + 8, z * 16 + 8);
        const lo = Math.floor((sy - 3) / 16);
        const hi = Math.floor((sy + 3) / 16);
        for (let y = lo; y <= hi; y++) if (!world.chunks.get(chunkKey(x, y, z))?.meshed) return false;
        return true;
      });
    }
    // 72031-72046: the biome ambience and hazards, before the environment
    this.cam.camera.getWorldDirection(T1).setY(0).normalize();
    this.biomes.update(dt, p.pos, T0.copy(p.pos).setY(p.pos.y + 1.45), T1, this.murk);
    this.env.biomeAir = this.biomes.air() as never;
    this.env.biomeK = this.biomes.k;
    this.world.extraUp = +(this.biomes.k > 0.2 && !this.burrow);
    this.audio.setBiome(this.biomes.region?.biome ?? null, this.murk > 0.5 ? this.biomes.k * 0.4 : this.biomes.k);
    this.biomeEvents.update(t, this.biomes.region, this.biomes.k, p.pos, this.started && !this.burrow && !this.combat.ko && !p.lifting);
    this.env.update(dt, p.pos, depth, this.cam.camera, this.murk);
    this.renderer.toneMappingExposure = this.env.exposure;
    // 71989-72000: gems sensed through the rock (chest and satchel halos come with those systems)
    this.sensedT -= dt;
    const deep = this.burrow || this.lobbyDeep;
    const sensed = this.gems.update(t, this.lobbyDeep ? b.uPlayer.value : p.pos, this.lobbyDeep ? 30 : this.burrow ? sense : 0, this.burrow ? this.ping.radius : -1, (g) => {
      const tier = RARITY_TIER[ITEMS[g.id as keyof typeof ITEMS].rarity as keyof typeof RARITY_TIER];
      if (tier >= 1 && this.sensedT <= 0) {
        this.sensedT = 0.25;
        this.audio.sensed(tier);
      }
    });
    if (this.burrow) chestHalos(this, sense, sensed); // 71999
    this.halos.set(deep ? sensed : []);
    this.decor.group.visible = this.murk < 0.5 && under < 0.95; // 72001
    this.caveDecor.group.visible = this.murk < 0.5; // 72002
    this.hub.setShown(this.murk < 0.5); // 72003
    this.hub.update(dt, under, this.env.clock.night); // 72056
    this.merchants.update(dt, p.pos, this.hub.shown); // MINEAR
    this.npc.update(dt); // 72057-72058: updateStranger, updateMirror
    this.decor.update(dt, p.pos); // 72059
    this.decorEvents();
    this.caveDecor.update(dt, p.pos, this.world.chunks.values()); // 72061
    this.farForest.update(p.pos);
    this.farForest.mesh.visible = under < 0.95;
    this.grass.update(dt, this.renderer, this.scene, this.cam.camera, p.pos, this.murk < 0.5 && under < 0.97);
    this.townFx(dt, under);
    terrainUniforms.uPlayerXZ.value.set(p.pos.x, p.pos.z);
    this.sparks.update(t);
    this.dust.update(t);
    this.debris.update(t);
    this.gemBursts.update(dt);
    this.post.bloom.strength = 0.2 + under * 0.3 + (air ? air.bloom * this.biomes.k : 0); // 72079
    this.renderer.shadowMap.autoUpdate = false;
    if (!this.env.sun.shadow.map || (under < 0.9 && ++this.shadowTick % (this.quality === 'high' || this.quality === 'ultra' ? 2 : 3) === 0))
      this.shadowDue = true;
    // 72158-72168: the drill, jet and depth layers of the sound
    const drillMat = this.drilling ? this.lastMat : Mat.Air;
    this.audio.update(
      dt,
      this.drilling ? 1 : this.pointing ? 0.5 : 0,
      MATERIALS[drillMat]?.hardness ?? 1,
      p.thrust,
      under,
      -depth,
      this.murk,
      +this.pointing,
    );
    updateFortune(this, dt, depth); // 71954
    updateStrength(this, dt);
    this.rings.update(t);
    this.ultFx.update(t); // 72078
    updateHud(this, dt, depth);
    this.depthBar.update(depth, this.state.deepest); // MINEAR
    this.minerHud.update(depth, this.burrow, this.claws); // MINEAR
    // MINEAR: unlimited jetpack fuel (cheat), this expedition's depth, and the base sites' status
    if (cheats.jet) p.fuel = this.player.stats.fuelMax;
    const run = this.state.run;
    // MINEAR: the tutorial trip counts too (its trip log is the sandbox's own, src/tutorial/krTutorial.ts)
    if (run && this.started && depth > run.deep) run.deep = depth;
    this.siteT -= dt;
    if (this.siteT <= 0) {
      this.siteT = 0.5;
      this.hub.setSiteStatus(this.unlockView());
      const hb = document.getElementById('homebtn');
      if (hb) hb.hidden = !(this.started && (!this.sandbox || this.tutorialTrip));
    }
  }

  /** handleKeys (72171): mute, then the use keys (panels come with the menus port). */
  private handleKeys() {
    if (handlePanelKeys(this)) return; // 72171-72220: mute and the keys of the open panel
    if (lootKeys(this)) return;
    handleUseKeys(this);
  }

  /** airPull (73584): air puffs drawn into the drill while it points at the sky. */
  private airPull(dt: number) {
    this.airPuffT -= dt;
    if (this.airPuffT > 0) return;
    this.airPuffT = 0.07;
    const p = this.player;
    const axis = this.model.drillAxis(T3);
    T1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(axis).normalize().multiplyScalar(2.2).addScaledVector(axis, -1.2).addScaledVector(p.vel, 0.8);
    this.dust.emit({ pos: this.vortex.exhaust, vel: T1, spread: 0.5, color: 16186367, size: 0.14, sizeEnd: 0.7, alpha: 0.3, life: 0.4, drag: 3, gravity: -0.2 });
    if (this.pointHit) {
      T0.copy(p.pos).setY(p.pos.y + 1).sub(this.pointHit).normalize().multiplyScalar(2.4);
      this.dust.emit({ pos: this.pointHit, vel: T0, spread: 0.9, color: 15327958, size: 0.25, sizeEnd: 1.1, alpha: 0.32, life: 0.6, drag: 1.5, count: 2 });
    }
  }

  /** decorEvents (73070): dust, debris and shake when a giant tree is hit, lands or crumbles (sounds come with audio). */
  private decorEvents() {
    for (const e of this.decor.events.splice(0)) {
      const d = e.pos.distanceTo(this.player.pos);
      if (e.kind === 'hit') {
        if (d < 45) this.audio.creak(0.7 * (1 - d / 45));
        this.dust.emit({ pos: e.pos, spread: 4.5 * e.size, color: 7126871, size: 0.45, sizeEnd: 0.9, alpha: 0.8, life: 1.8, count: 12, gravity: 1.2, drag: 1.4 });
      } else if (e.kind === 'land') {
        for (let i = 0; i <= 5; i++) {
          const at = e.from.clone().lerp(e.pos, i / 5).setY(e.pos.y);
          this.dust.emit({ pos: at, spread: 1.6 + 2.4 * e.size * (i / 5), color: 12098166, size: 1.2, sizeEnd: 3.6, alpha: 0.55, life: 1.9, count: 6, drag: 1.6 });
        }
        this.dust.emit({ pos: e.pos, spread: 5 * e.size, color: 7126871, size: 1.1, sizeEnd: 2.4, alpha: 0.85, life: 1.4, count: 26, gravity: 1.5 });
        this.debris.burst(e.pos.clone().setY(e.pos.y + 1), 7126871, 16, undefined, 7);
        if (d < 70) {
          this.cam.addShake(0.7 * (1 - d / 70));
          this.audio.rockfall(1 - d / 70);
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          const at = e.from.clone().lerp(e.pos, i / 4).setY(e.pos.y + 0.5);
          this.dust.emit({ pos: at, spread: 1.5 + 3 * e.size * (i / 4), color: 7126871, size: 0.8, sizeEnd: 1.8, alpha: 0.8, life: 1.3, count: 10, gravity: 0.8 });
        }
        if (d < 45) this.audio.poof();
      }
    }
  }

  /** Town sparks over the Wellspring, chimney smoke and underground dust motes (72081-72157). */
  private townFx(dt: number, under: number) {
    const p = this.player;
    this.townT -= dt;
    const inTown = p.pos.distanceTo(this.hub.liftTop) < 60 && under < 0.5 && this.murk < 0.5;
    const toSpirit = inTown ? p.pos.distanceTo(this.hub.spiritTop) : 99;
    this.audio.setPlaces(1 - THREE.MathUtils.smoothstep(toSpirit, 4, 18), 0); // 72114
    if (this.townT <= 0 && inTown) {
      this.townT = 0.12;
      const top = this.hub.spiritTop;
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 1.2;
      // gems held tint the sparks (state.gemsHeld comes with the inventory)
      const color = Math.random() < 0.3 ? 16777215 : 8384511;
      this.sparks.emit({
        pos: T0.set(top.x + Math.cos(a) * r, top.y - 1.4 + Math.random() * 0.6, top.z + Math.sin(a) * r),
        vel: T1.set(0, 0.7, 0),
        spread: 0.3,
        color,
        intensity: 1.6,
        size: 0.07,
        sizeEnd: 0.02,
        life: 2.4,
        gravity: -0.25,
        drag: 0.4,
      });
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0 && under < 0.9 && this.hub.smokeAnchors.length) {
      this.smokeT = 0.35;
      this.hub.smokeAnchors.forEach((o, i) => {
        o.getWorldPosition(T0);
        this.dust.emit({
          pos: T0,
          vel: new THREE.Vector3(0.35, 1.1, 0.1),
          spread: 0.25,
          color: i ? 14999252 : 13616827,
          size: i ? 0.55 : 0.8,
          sizeEnd: i ? 2 : 2.8,
          alpha: i ? 0.3 : 0.42,
          life: 3.2,
          drag: 0.3,
          gravity: -0.15,
        });
      });
    }
    if (under > 0.5)
      for (this.moteT -= dt; this.moteT <= 0; ) {
        this.moteT += 0.08;
        const s = 14;
        this.dust.emit({
          pos: p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * 7 + 1, (Math.random() - 0.5) * s)),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2),
          color: 16769712,
          size: 0.07,
          alpha: 0.7,
          life: 3.5,
          drag: 0.2,
        });
      }
  }

  /**
   * MINEAR lobby: burrow (sonar) view of the rock under the island, so the lobby shows what you dig for: gems
   * glow through the rock and ore veins glimmer. The player stays on the island; start() turns it off.
   */
  private enterLobbyView() {
    if (this.lobbyDeep) return;
    this.findLobbySpot(this.lobbyFocus);
    this.lobbyDeep = true;
    this.murk = 1; // the sonar rock shows at once, no fade in
    this.setPixelRatio(Math.min(this.renderer.getPixelRatio(), LOBBY_PIXEL_RATIO));
    document.body.classList.add(`mn-deep`); // the HUD waits until the camera is out of the ground
    this.world.setMaterial(this.burrowMat);
    this.gems.setBurrow(true);
  }

  /** The pixel ratio of the current quality (settings PIXEL_RATIO, at most the screen's). */
  qualityPixelRatio() {
    return cappedPixelRatio(this.quality); // MINEAR: the quality's ratio, inside the pixel budget (settings.ts)
  }

  /** Sets the drawing pixel ratio and resizes the render targets (as applySettings does for a quality change). */
  private setPixelRatio(r: number) {
    if (Math.abs(this.renderer.getPixelRatio() - r) < 0.01) return;
    this.renderer.setPixelRatio(r);
    const c = this.renderer.domElement;
    this.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
    this.onDpr?.(r);
  }

  /** The middle of the lobby's sonar view: the cave spot, or a point ahead of the camera as it flies up. */
  private lobbyEye(out: THREE.Vector3) {
    if (!this.started) return out.copy(this.lobbyFocus);
    const c = this.cam.camera;
    return out.copy(c.position).addScaledVector(c.getWorldDirection(T2), 6);
  }

  private exitLobbyView() {
    if (!this.lobbyDeep) return;
    this.lobbyDeep = false;
    this.setPixelRatio(this.qualityPixelRatio()); // back to the quality's
    document.body.classList.remove(`mn-deep`);
    this.world.setMaterial(this.world.material);
    this.world.cullBeyond(this.player.pos, null);
    this.gems.setBurrow(false);
    this.halos.set([]);
  }

  /**
   * The lobby spot: an open cave 30 to 54 m under the ground near the island, with the most open space, ore and
   * gem slots close by. It reads the world generator directly (no chunks load for the search; dug rock is not
   * seen). update() then streams the chunks around the spot while the lobby shows.
   */
  private findLobbySpot(out: THREE.Vector3) {
    let best = -1;
    out.set(0, -40, 24);
    const gemSlots: { x: number; y: number; z: number }[] = [];
    for (let cx = -6; cx <= 5; cx++)
      for (let cz = -6; cz <= 5; cz++) for (let cy = -5; cy <= -1; cy++) gemSlots.push(...gemSlotsForChunk(cx, cy, cz));
    for (let x = -64; x <= 64; x += 16)
      for (let z = -64; z <= 64; z += 16) {
        if (Math.hypot(x, z) < 16) continue; // not right under the plaza
        const surf = surfaceHeight(x, z);
        for (const depth of [30, 38, 46, 54]) {
          const y = surf - depth;
          let score = 0;
          for (let dx = -10; dx <= 10; dx += 2.5)
            for (let dy = -6; dy <= 6; dy += 2)
              for (let dz = -10; dz <= 10; dz += 2.5) {
                const vx = x + dx;
                const vy = y + dy;
                const vz = z + dz;
                const vs = surfaceHeight(vx, vz);
                if (baseDensity(vx, vy, vz, vs) <= 128) score += 0.5; // open: tunnel or cave walls to see
                else if (MATERIALS[materialAt(Math.round(vx), Math.round(vy), Math.round(vz), vs, strataOffset(vx, vz))]?.ore) score += 0.6;
              }
          if (score < 40) continue; // the camera's middle must hold a real cave, not one thin tunnel
          for (const g of gemSlots) {
            const d2 = (g.x - x) ** 2 + (g.y - y) ** 2 + (g.z - z) ** 2;
            if (d2 < 400) score += 8 * (1.2 - Math.sqrt(d2) / 20);
          }
          if (score > best) {
            best = score;
            out.set(x, y, z);
          }
        }
      }
  }

  /** Title orbit (71749-71761) around the lift top. */
  private titleCamera(dt: number) {
    this.titleT += dt;
    if (this.lobbyDeep) {
      // MINEAR: a slow circle inside the rock around the lobby spot, a little above it
      const f = this.lobbyFocus;
      const a = this.titleT * 0.05 + 0.6;
      const c = this.cam.camera;
      const v = this.lobbyView;
      c.position.set(f.x + Math.sin(a) * v.r, f.y + v.up + Math.sin(this.titleT * 0.13) * 1.2, f.z + Math.cos(a) * v.r);
      c.lookAt(f.x - Math.cos(a) * 2.5, f.y + v.look, f.z + Math.sin(a) * 2.5);
      c.updateMatrixWorld();
      this.cam.yaw = Math.atan2(f.x - c.position.x, f.z - c.position.z);
      return;
    }
    const a = this.titleT * 0.035 + 0.45;
    const top = this.hub.liftTop;
    const c = this.cam.camera;
    c.position.set(top.x + Math.sin(a) * 30, top.y + 13 + Math.sin(this.titleT * 0.11) * 1.5, top.z + Math.cos(a) * 30);
    c.lookAt(top.x - Math.cos(a) * 7, top.y - 1.5, top.z + Math.sin(a) * 7);
    c.updateMatrixWorld();
    this.cam.yaw = Math.atan2(top.x - c.position.x, top.z - c.position.z);
  }

  /** Jetpack flame sparks and smoke (71880-71912). */
  private jetFlames(p: PlayerController) {
    for (const f of this.model!.flames) {
      f.getWorldPosition(T0);
      const q = f.getWorldQuaternion(new THREE.Quaternion());
      T1.set(0, -1, 0).applyQuaternion(q);
      T0.addScaledVector(T1, 0.1);
      this.sparks.emit({
        pos: T0,
        vel: T1.clone().multiplyScalar(7).addScaledVector(p.vel, 0.3),
        spread: 0.8,
        color: 16751164,
        intensity: 3.2 * p.thrust,
        size: 0.32,
        sizeEnd: 0.04,
        life: 0.22,
        drag: 2,
      });
      const lite = this.quality === 'lite';
      if (Math.random() < (lite ? 0.15 : 0.5))
        this.dust.emit({
          pos: T0,
          vel: T1.clone().multiplyScalar(3),
          spread: 0.6,
          color: 12564656,
          size: 0.35,
          sizeEnd: lite ? 1.1 : 1.5,
          alpha: 0.25,
          life: 0.9,
          drag: 2.5,
          gravity: this.burrow ? 0 : -1.2,
        });
    }
  }

  /** footGround (71536) */
  footGround = (x: number, z: number, y: number): number | null => {
    const ray = new THREE.Raycaster(T2.set(x, y + 0.7, z), new THREE.Vector3(0, -1, 0), 0, 1.5);
    (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const box = new THREE.Box3(new THREE.Vector3(x - 0.2, y - 0.9, z - 0.2), new THREE.Vector3(x + 0.2, y + 0.8, z + 0.2));
    const hit = ray.intersectObjects(this.colliders(box), false)[0];
    return hit ? hit.point.y : null;
  };

  /** updateDrill (73628), terrain only (foes, worm and remote miners come with combat). */
  updateDrill(dt: number, allowed: boolean) {
    const p = this.player;
    const camera = this.cam.camera;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const reach = this.state.drill.reach;
    const chest = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z);
    const from = this.burrow ? chest : camera.position; // 73634-73635
    const far = this.burrow ? reach : this.cam.dist + reach + 2;
    drillRay.set(from, dir);
    drillRay.far = far;
    drillBox.setFromPoints([from, T0.copy(from).addScaledVector(dir, far)]).expandByScalar(0.5);
    const meshes = this.world.collidersIn(drillBox, []);
    const hits = drillRay.intersectObjects(meshes, false);
    let hit: THREE.Intersection | null = null;
    for (const h of hits) {
      if (h.point.distanceTo(chest) <= reach) {
        hit = h;
        break;
      }
      if (h.distance > this.cam.dist + 1) break;
    }
    // 73649-73650: a foe in front of the rock takes the drill instead (worm and remote miners come later)
    const fh = this.combat.foes.rayHit(from, dir, far);
    const foeHit = fh && fh.point.distanceTo(chest) <= reach + 0.8 && (!hit || fh.t < hit.distance) ? fh : null;
    // 73651-73652: else the worm, if it is nearer than the rock
    const wormHit = wormDrillHit(this.combat.worm, foeHit, from, dir, far, chest, reach, hit);
    this.crossState = this.combat.aiming ? 'aim' : 'none';
    if (foeHit || wormHit) this.crossState = 'foe';
    else if (hit) {
      const into = hit.point.clone().addScaledVector(dir, 0.6);
      const mat = this.world.materialAt(Math.round(into.x), Math.round(into.y), Math.round(into.z));
      const info = MATERIALS[mat];
      const hard =
        !!info && (!isFinite(info.hardness) || (!fastRock(mat) && this.state.drill.power / info.hardness < 0.3));
      if (!this.combat.aiming) this.crossState = hard ? 'hard' : 'valid';
      if (mat !== Mat.Air) this.lastMat = mat;
    }
    const target = foeHit ? foeHit.point : wormHit ? wormHit.point : hit?.point;
    const digging = allowed && this.input.lmb && !!target && !p.lifting && !this.combat.aiming;
    this.drilling = digging;
    this.pointing = allowed && this.input.lmb && !target && !p.lifting && !this.combat.aiming && !this.combat.ko && !this.burrow;
    if (this.pointing) {
      this.crossState = 'air';
      p.yaw = this.cam.yaw;
      this.aimPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      const far2 = hits.find((h) => h.distance > this.cam.dist * 0.8);
      this.pointHit = far2 ? (this.pointHit ?? new THREE.Vector3()).copy(far2.point) : null;
    }
    if (!digging || !target) {
      this.digTimer = 0;
      return;
    }
    const to = target.clone().sub(chest);
    this.aimPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    p.yaw = Math.atan2(to.x, to.z);
    if (foeHit) {
      this.digTimer = 0;
      this.combat.grind(foeHit.foe, foeHit.point, dt);
      return;
    }
    if (wormHit) {
      this.digTimer = 0;
      this.combat.grindWorm(wormHit.point, wormHit.weak, dt);
      return;
    }
    if (!hit) return;
    for (this.digTimer += dt; this.digTimer >= DIG_TICK; ) {
      this.digTimer -= DIG_TICK;
      this.digTick(hit.point, dir);
    }
  }

  /** digTick (73707), without ore pickups, decor, cave decor and gems (later phases). */
  digTick(at: THREE.Vector3, dir: THREE.Vector3, k = 1) {
    const drill = this.state.drill;
    const c = at.clone().addScaledVector(dir, 0.35);
    const worn = this.claws.worn; // MINEAR: worn-out claws dig as slowly as rock that is too hard
    const r = this.world.dig(c, drill.radius, 12 * k * (worn ? WORN_DIG : 1), drill.power, this.digFn());
    this.world.remeshNear(c, drill.radius + 3);
    this.hasDug = true;
    const info = MATERIALS[r.mat] ?? MATERIALS[Mat.Stone];
    // MINEAR: the tutorial's lessons do not wear the claws (only its `finish` step, the first real trip, does)
    if (r.touched > 0 && !r.tooHard && !this.tutorial.noWear) this.claws.use(info.hardness);
    if (worn && r.touched > 0) {
      this.hardHintT = 2;
      this.hintOverride = 'Your claws are worn out! Go up to the surface to rest them.';
    }
    const back = dir.clone().negate();
    if (r.touched > 0) {
      const col = new THREE.Color(info.color);
      this.debris.burst(at, col, 1 + Math.min(5, Math.floor(r.touched / 250)), back, 4);
      this.dust.emit({
        pos: at,
        vel: back.clone().multiplyScalar(1.2),
        spread: 1,
        color: col.clone().lerp(new THREE.Color(16777215), 0.35),
        size: 0.8,
        sizeEnd: 2.4,
        alpha: 0.32,
        life: 0.9,
        drag: 2.2,
        gravity: -0.4,
        count: 2,
      });
      this.sparks.emit({
        pos: at,
        vel: back.clone().multiplyScalar(3),
        spread: 4,
        color: 16766880,
        intensity: 2.5,
        size: 0.1,
        life: 0.25,
        gravity: 12,
        count: 2,
      });
      this.crunchT -= DIG_TICK;
      if (this.crunchT <= 0) {
        this.audio.crunch(info.hardness);
        this.crunchT = 0.11;
      }
      this.cam.addShake(0.16);
    }
    if (r.tooHard) {
      this.sparks.emit({
        pos: at,
        vel: back.clone().multiplyScalar(5),
        spread: 5,
        color: 16769184,
        intensity: 4,
        size: 0.12,
        life: 0.3,
        gravity: 14,
        count: 4,
      });
      this.clangT -= DIG_TICK;
      if (this.clangT <= 0) {
        this.audio.clang();
        this.clangT = 0.3;
      }
      this.hardHintT = 2;
      this.hintOverride =
        r.mat === Mat.Plaza
          ? 'The plaza is protected. Walk off it to mine.'
          : `${info.name} is too hard! Shatter gems at the Wellspring for Burrow Power`;
    }
    digOre(this, r.yields, c); // 73764-73769: ore nuggets fly out
    for (const e of this.caveDecor.removeNear(c, drill.radius)) // 73770
      this.sparks.emit({ pos: e.p, spread: 2.2, color: e.color.getHex(), intensity: 2.4, size: 0.12, sizeEnd: 0.02, life: 0.6, count: 6, drag: 2 });
    for (const g of this.gems.release(c, drill.radius)) releaseGemToPickup(this, g); // 73798
    // 73782-73797: trees, bushes and rocks in the drill's reach go up in a puff
    for (const d of this.decor.removeNear(c, drill.radius)) {
      this.audio.poof();
      const color = d.big ? 7126871 : d.color;
      this.dust.emit({
        pos: d.pos.clone().setY(d.pos.y + (d.big ? 2 : 0.3)),
        spread: d.big ? 2.5 : 0.8,
        color,
        size: d.big ? 0.8 : 0.3,
        sizeEnd: d.big ? 1.8 : 0.6,
        alpha: 0.8,
        life: 0.8,
        count: d.big ? 18 : 4,
        gravity: 2,
      });
      if (d.big) this.debris.burst(d.pos.clone().setY(d.pos.y + 1.5), 7126871, 10, undefined, 5);
    }
  }

  private saveOnLeave = () => {};
  private saveOnHide = () => {};

  dispose() {
    removeEventListener('pagehide', this.saveOnLeave, true);
    document.removeEventListener('visibilitychange', this.saveOnHide, true);
    this.input.detach();
    this.touch?.dispose();
    this.unwirePanels();
    this.portrait.dispose();
    this.shatter?.dispose();
  }
}
