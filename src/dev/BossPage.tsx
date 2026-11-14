// /dev/bosses: each boss alone, for debugging and development.
// The boss views (src/bosses/view, port of QI / eL) run without the boss fight client: a standalone host
// stands in for gL (createBossViewHost). Pick a boss, play every act and every loaded clip, set the phase
// and mode, flash it, fire the boss VFX, and view it on a plain stage or in its own lair (the real voxel
// terrain at the lair from src/world, lit as underground).
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadBosses, type BossAsset } from '../bosses/view/assets';
import { BossView, createBossViewHost, bossInfo, listBossActs, listBossKinds, tellBossView, type StandaloneBossHost } from '../bosses/view/bossView';
import { BOSS_LIGHTS } from '../bosses/view/constants';
import { IceSpikes, Shockwaves } from '../bosses/view/vfx';
import { BOSS_DEFS, BOSS_MODES, type BossAct, type BossKind, type BossMode } from '../bosses/sim/defs';
import { ChunkManager } from '../world/chunkManager';
import { beastCaverns, cavernAt } from '../world/caverns';
import { surfaceHeight } from '../world/generate';
import { Environment } from '../sky/environment';
import { createPostChain, type PostChain } from '../post/composer';
import { biomeUniforms } from '../render/biomeRock';
import { ATMO, setLook } from '../render/atmosphere';
import './dev.css';

type Stage = 'stage' | 'lair';

class BossLab {
  env: Environment;
  post: PostChain;
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
  controls: OrbitControls;
  host: StandaloneBossHost;
  view: BossView | null = null;
  kind: BossKind = 'titan';
  stage: Stage = 'stage';
  world: ChunkManager | null = null;
  floor: THREE.Mesh;
  spikes = new IceSpikes();
  waves = new Shockwaves();
  origin = new THREE.Vector3();
  /** The game lights caves with the miner's headlamp (KR 70551); the lair view uses the same light at the camera. */
  lamp = new THREE.SpotLight(0xffe2b4, 0, 120, 0.9, 0.85, 0.9);
  fill = new THREE.PointLight(0xffd9a8, 0, 80, 1);
  needFrame = false;
  last = performance.now();
  info = '';

  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene, asset: BossAsset) {
    scene.matrixAutoUpdate = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    this.env = new Environment(scene);
    this.env.clock.frozen = 0.42;
    this.post = createPostChain(renderer, scene, this.camera, 'high');
    this.post.outline.enabled = true;
    setLook('painterly');
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.host = createBossViewHost(asset);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6f7a5a }));
    this.floor.receiveShadow = true;
    scene.add(this.lamp, this.lamp.target, this.fill);
    scene.add(this.floor, BOSS_LIGHTS.glow, BOSS_LIGHTS.flash, this.spikes.mesh, this.waves.group);
    for (const o of [this.floor, BOSS_LIGHTS.glow, BOSS_LIGHTS.flash]) o.updateMatrixWorld();
    this.show('titan', 'stage');
  }

  /** Builds the view of `kind` at the stage origin or on its lair floor. */
  show(kind: BossKind, stage: Stage) {
    this.kind = kind;
    this.stage = stage;
    if (this.view) {
      this.view.root.removeFromParent();
      this.view.dispose();
      this.view = null;
    }
    this.spikes.clear();
    this.waves.clear();
    if (stage === 'lair') {
      const b = beastCaverns().find((c) => c.biome === BOSS_DEFS[kind].biome)!;
      const c = cavernAt(b.ix, b.iy, b.iz);
      if (!this.world) {
        this.world = new ChunkManager();
        this.world.useBatch();
        this.scene.add(this.world.group);
      }
      this.world.group.visible = true;
      this.origin.set(b.cx, c?.floorY ?? b.cy, b.cz);
      this.world.boost = true;
      for (let i = 0; i < 40 && !this.world.update(this.origin, true); i++);
      this.world.boost = false;
      const g = this.world.groundBelow(this.origin.x, this.origin.z, this.origin.y + 6, 20);
      if (g !== null) this.origin.y = g;
      this.floor.visible = false;
    } else {
      if (this.world) this.world.group.visible = false;
      this.origin.set(0, 0, 0);
      this.floor.visible = true;
    }
    const v = new BossView(1, kind, this.host, bossInfo(kind, { x: this.origin.x, y: this.origin.y, z: this.origin.z, mode: 'fight' }));
    this.scene.add(v.root);
    this.view = v;
    // frame by the model's real bounds once it has posed (next frame)
    this.needFrame = true;
  }

  /** Puts the camera at a distance that fits the boss. */
  private frameView(v: BossView) {
    const box = new THREE.Box3().setFromObject(v.root, true);
    if (box.isEmpty()) box.setFromCenterAndSize(this.origin, new THREE.Vector3(6, 6, 6));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = r / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.25;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.62, 0.38, 0.69).normalize().multiplyScalar(dist));
    this.camera.far = Math.max(2000, dist * 6);
    this.camera.updateProjectionMatrix();
  }

  act(a: BossAct) {
    if (!this.view) return;
    this.view.curAct = null;
    tellBossView(this.view, { act: a });
  }
  clip(name: string) {
    this.view?.play(name, { once: true });
  }
  phase(n: number) {
    if (this.view) tellBossView(this.view, { phase: n });
  }
  mode(m: BossMode) {
    if (this.view) tellBossView(this.view, { mode: m });
  }
  flash() {
    if (this.view) this.view.flash = 1;
  }
  vfx(kind: 'spikes' | 'wave') {
    const o = this.origin;
    const at = new THREE.Vector3(o.x + 6, o.y, o.z + 6);
    if (kind === 'spikes') for (let i = 0; i < 6; i++) this.spikes.spawn(at.clone().add(new THREE.Vector3(Math.cos(i) * 3, 0, Math.sin(i) * 3)), 2.5 + i * 0.3);
    if (kind === 'wave') this.waves.spawn(new THREE.Vector3(o.x, o.y + 0.1, o.z), 1, 16, 14, 9430271);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.post.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.post.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.controls.update();
    this.camera.updateMatrixWorld();
    const o = this.origin;
    const lair = this.stage === 'lair';
    if (lair && this.world) this.world.update(o);
    const depth = lair ? surfaceHeight(o.x, o.z) - o.y : 0;
    this.env.update(dt, o, depth, this.camera, 0);
    this.renderer.toneMappingExposure = this.env.exposure;
    ATMO.focus.set(o.x, o.y + 1, o.z, 0);
    biomeUniforms.uTime.value += dt;
    const v = this.view;
    if (v) {
      v.update(dt, now, 0);
      v.root.updateMatrixWorld(true);
      if (this.needFrame) {
        this.needFrame = false;
        this.frameView(v);
      }
    }
    // headlamp and fill at the camera in the lair (off on the plain stage, where the sun lights it)
    const k = lair ? 1 : 0;
    this.lamp.intensity = 60 * k;
    this.fill.intensity = 30 * k;
    this.lamp.position.copy(this.camera.position);
    this.lamp.target.position.copy(this.controls.target);
    this.fill.position.copy(this.camera.position);
    this.lamp.updateMatrixWorld();
    this.lamp.target.updateMatrixWorld();
    this.fill.updateMatrixWorld();
    this.spikes.update(dt);
    this.waves.update(dt);
    this.spikes.mesh.updateMatrixWorld();
    this.waves.group.updateMatrixWorld(true);
    BOSS_LIGHTS.glow.updateMatrixWorld();
    BOSS_LIGHTS.flash.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
    this.post.composer.render();
    if (v) {
      const d = BOSS_DEFS[v.kind];
      this.info =
        `${d.name}, ${d.title}\n` +
        `hp ${d.hp}  radius ${d.radius}  height ${d.height}\n` +
        `mode ${v.mode}  phase ${v.phase}  act ${v.curAct ?? '-'}\n` +
        `clips loaded ${v.actions.size}\n` +
        `at ${o.x.toFixed(0)} ${o.y.toFixed(0)} ${o.z.toFixed(0)}  depth ${depth.toFixed(0)} m\n` +
        `draws ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}`;
    }
  }
}

function Loop({ lab, onInfo }: { lab: BossLab; onInfo: (s: string) => void }) {
  const size = useThree((s) => s.size);
  useEffect(() => lab.resize(size.width, size.height), [lab, size.width, size.height]);
  let n = 0;
  useFrame(() => {
    lab.frame();
    if (++n % 10 === 0) onInfo(lab.info);
  }, 1);
  return null;
}

const assetPromise = loadBosses();

export function BossPage() {
  const [lab, setLab] = useState<BossLab | null>(null);
  const [info, setInfo] = useState('Loading the boss models…');
  const [kind, setKind] = useState<BossKind>('titan');
  const [stage, setStage] = useState<Stage>('stage');
  const [, bump] = useState(0);
  useEffect(() => {
    document.body.classList.add('dev');
  }, []);

  const onCreated = (s: RootState) => {
    s.setEvents({ enabled: false });
    assetPromise.then((asset) => {
      if (!asset) return setInfo('The boss models did not load (/models/bosses.glb, boss_anims.glb).');
      const l = new BossLab(s.gl as THREE.WebGLRenderer, s.scene, asset);
      s.set({ camera: l.camera });
      Object.assign(window, { __bosses: l });
      setLab(l);
    });
  };

  const pick = (k: BossKind, st: Stage) => {
    setKind(k);
    setStage(st);
    lab?.show(k, st);
  };

  return (
    <>
      <Canvas
        style={{ position: 'fixed', inset: 0 }}
        flat
        gl={(p) => new THREE.WebGLRenderer({ canvas: p.canvas as HTMLCanvasElement, antialias: false, powerPreference: 'high-performance' })}
        onCreated={onCreated}
      >
        {lab && <Loop lab={lab} onInfo={setInfo} />}
      </Canvas>
      <div className="dev-panel">
        <h1>Bosses</h1>
        <a href="/dev">all debug pages</a> · <a href="/dev/terrain">terrain</a> · <a href="/">game</a>
        <h2>Boss</h2>
        <div className="row">
          {listBossKinds().map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => pick(k, stage)}>
              {BOSS_DEFS[k].name}
            </button>
          ))}
        </div>
        <h2>Place</h2>
        <div className="row">
          <button className={stage === 'stage' ? 'on' : ''} onClick={() => pick(kind, 'stage')}>
            Plain stage
          </button>
          <button className={stage === 'lair' ? 'on' : ''} onClick={() => pick(kind, 'lair')}>
            Its lair
          </button>
        </div>
        <h2>Acts</h2>
        <div className="row">
          {listBossActs(kind).map((a) => (
            <button key={a} onClick={() => lab?.act(a)}>
              {a}
            </button>
          ))}
        </div>
        <h2>Clips</h2>
        <div className="row">
          {lab?.view &&
            [...lab.view.actions.keys()].map((c) => (
              <button key={c} onClick={() => lab.clip(c)}>
                {c.replace(/^Skeletons_/, '')}
              </button>
            ))}
        </div>
        <h2>Phase and mode</h2>
        <div className="row">
          {[1, 2, 3].map((n) => (
            <button key={n} onClick={() => lab?.phase(n)}>
              phase {n}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          {BOSS_MODES.map((m) => (
            <button key={m} onClick={() => lab?.mode(m)}>
              {m}
            </button>
          ))}
          <button onClick={() => lab?.flash()}>flash</button>
        </div>
        <h2>Effects</h2>
        <div className="row">
          <button onClick={() => lab?.vfx('spikes')}>ice spikes</button>
          <button onClick={() => lab?.vfx('wave')}>shockwave</button>
        </div>
        <h2>Info</h2>
        <div className="info">{info}</div>
      </div>
    </>
  );
}
