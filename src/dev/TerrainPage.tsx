// /dev/terrain: the voxel world alone, for debugging and development.
// Same world generator, chunk manager, terrain and sonar materials, sky, sun, fog and post chain as the game
// (src/game/Game.ts), without the miner, monsters or HUD. An orbit camera looks at a focus point that the
// chunk manager streams around. Presets jump to each rock layer, the biome caverns and the boss lairs.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkManager } from '../world/chunkManager';
import { chunkKey } from '../world/chunk';
import { surfaceHeight } from '../world/generate';
import { MATERIALS, Mat } from '../world/materials';
import { BIOMES, beastCaverns, cavernAt, cavernAtWorld, type Cavern } from '../world/caverns';
import { Environment } from '../sky/environment';
import { createPostChain, type PostChain } from '../post/composer';
import { createSonarRock } from '../render/sonarRock';
import { terrainUniforms } from '../render/terrainMaterial';
import { biomeUniforms } from '../render/biomeRock';
import { ATMO, setLook } from '../render/atmosphere';
import './dev.css';

interface Preset {
  name: string;
  /** Focus point; y is the world height. */
  at: [number, number, number];
  /** Carve a viewing room at the focus (inside solid rock). */
  room?: number;
}

/** Rock layers by depth (materialAt qv 33594): a point 30 m outside the hub plaza at the middle of each band. */
function layerPresets(): Preset[] {
  const x = 40;
  const z = 40;
  const s = surfaceHeight(x, z);
  const band = (name: string, depth: number): Preset => ({ name, at: [x, s - depth, z], room: 7 });
  return [
    { name: 'Hub plaza', at: [0, surfaceHeight(0, 0) + 1, 0] },
    { name: 'Surface', at: [x, s + 1, z] },
    band('Sandstone 18 m', 18),
    band('Stone 50 m', 50),
    band('Slate 100 m', 100),
    band('Abyss 200 m', 200),
    band('Obsidian 340 m', 340),
    band('Emberstone 520 m', 520),
    band('Voidstone 760 m', 760),
    band('Heartstone 950 m', 950),
  ];
}

/** The four starter biome caverns (row iy = -1 around the hub) and the four boss lairs. */
function cavernPresets(): Preset[] {
  const out: Preset[] = [];
  for (const [ix, iz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const c = cavernAt(ix, -1, iz);
    if (c) out.push({ name: `${BIOMES[c.biome].name.replace('THE ', '')}`, at: [c.cx, c.floorY + 4, c.cz] });
  }
  for (const b of beastCaverns()) {
    const c = cavernAt(b.ix, b.iy, b.iz);
    out.push({ name: `Lair: ${b.biome}`, at: [b.cx, (c?.floorY ?? b.cy) + 4, b.cz] });
  }
  return out;
}

const T = new THREE.Vector3();

class TerrainLab {
  world = new ChunkManager();
  env: Environment;
  post: PostChain;
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
  controls: OrbitControls;
  sonar = createSonarRock();
  focus = new THREE.Vector3(0, 4, 0);
  mode: 'normal' | 'sonar' = 'normal';
  last = performance.now();
  info = '';

  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene) {
    scene.matrixAutoUpdate = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    this.env = new Environment(scene);
    this.env.clock.frozen = 0.42;
    this.world.useBatch();
    scene.add(this.world.group);
    this.post = createPostChain(renderer, scene, this.camera, 'high');
    this.post.outline.enabled = true;
    setLook('painterly');
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.goTo({ name: 'Hub plaza', at: [0, surfaceHeight(0, 0) + 1, 0] });
  }

  goTo(p: Preset) {
    this.focus.set(...p.at);
    this.controls.target.copy(this.focus);
    this.camera.position.copy(this.focus).add(T.set(14, 9, 14));
    this.world.boost = true;
    // stream the chunks in at once, then carve the viewing room
    for (let i = 0; i < 40 && !this.world.update(this.focus, true); i++);
    this.world.boost = false;
    if (p.room) this.carve(p.room);
  }

  /** Digs a sphere at the focus so the rock of a layer can be seen from inside. */
  carve(r: number) {
    this.world.dig(this.focus, r, 1000, 999);
    this.world.remeshNear(this.focus, r + 3);
  }

  setMode(m: 'normal' | 'sonar') {
    this.mode = m;
    this.world.setMaterial(m === 'sonar' ? this.sonar.material : this.world.material);
    if (m === 'normal') this.world.cullBeyond(this.focus, null);
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
    this.focus.copy(this.controls.target);
    this.camera.updateMatrixWorld();
    const ready = this.world.update(this.focus);
    const depth = surfaceHeight(this.focus.x, this.focus.z) - this.focus.y;
    const sonar = this.mode === 'sonar';
    // the sky / fog / underground light follow the focus as they follow the miner in the game
    this.env.update(dt, this.focus, depth, this.camera, sonar ? 1 : 0);
    this.renderer.toneMappingExposure = this.env.exposure;
    ATMO.focus.set(this.focus.x, this.focus.y, this.focus.z, 0);
    terrainUniforms.uPlayerXZ.value.set(this.focus.x, this.focus.z);
    biomeUniforms.uTime.value += dt;
    const u = this.sonar.uniforms;
    u.uPlayer.value.copy(this.focus);
    u.uCam.value.copy(this.camera.position);
    u.uTime.value += dt;
    u.uFade.value = sonar ? 1 : 0;
    u.uFar.value = 60;
    const murk = this.post.murk.uniforms;
    murk.uMurk.value = sonar ? 1 : 0;
    murk.uTime.value += dt;
    if (sonar) this.world.cullBeyond(this.focus, u.uFar.value);
    else this.world.cullBuried(this.camera.position, this.camera.position.y > surfaceHeight(this.camera.position.x, this.camera.position.z) - 3);
    this.renderer.shadowMap.needsUpdate = true;
    this.post.composer.render();

    const f = this.focus;
    const mat = this.world.materialAt(Math.round(f.x), Math.round(f.y - 1), Math.round(f.z));
    const cav: Cavern | null = cavernAtWorld(f.x, f.y, f.z);
    let meshed = 0;
    for (const c of this.world.chunks.values()) if (c.meshed) meshed++;
    this.info =
      `focus ${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)}\n` +
      `depth ${depth.toFixed(1)} m   surface ${surfaceHeight(f.x, f.z).toFixed(1)}\n` +
      `below ${MATERIALS[mat]?.name ?? '?'} (${mat}) hardness ${MATERIALS[mat]?.hardness ?? '-'}\n` +
      `cavern ${cav ? `${cav.biome}${cav.beast ? ' (lair)' : ''}` : '-'}\n` +
      `chunks ${this.world.chunks.size} meshed ${meshed} meshes ${this.world.meshes.length}\n` +
      `ready ${ready}  draws ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}\n` +
      `chunk ${chunkKey(Math.floor(f.x / 16), Math.floor(f.y / 16), Math.floor(f.z / 16))}`;
  }
}

function Loop({ lab, onInfo }: { lab: TerrainLab; onInfo: (s: string) => void }) {
  const size = useThree((s) => s.size);
  useEffect(() => lab.resize(size.width, size.height), [lab, size.width, size.height]);
  let n = 0;
  useFrame(() => {
    lab.frame();
    if (++n % 10 === 0) onInfo(lab.info);
  }, 1);
  return null;
}

export function TerrainPage() {
  const [lab, setLab] = useState<TerrainLab | null>(null);
  const [info, setInfo] = useState('');
  const [mode, setMode] = useState<'normal' | 'sonar'>('normal');
  const [time, setTime] = useState(0.42);
  const layers = useRef(layerPresets());
  const caverns = useRef(cavernPresets());
  useEffect(() => {
    document.body.classList.add('dev');
  }, []);

  const onCreated = (s: RootState) => {
    s.setEvents({ enabled: false });
    const l = new TerrainLab(s.gl as THREE.WebGLRenderer, s.scene);
    s.set({ camera: l.camera });
    Object.assign(window, { __terrain: l });
    setLab(l);
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
        <h1>Terrain</h1>
        <a href="/dev">all debug pages</a> · <a href="/">game</a>
        <h2>Rock layers</h2>
        <div className="row">
          {layers.current.map((p) => (
            <button key={p.name} onClick={() => lab?.goTo(p)}>
              {p.name}
            </button>
          ))}
        </div>
        <h2>Biome caverns and lairs</h2>
        <div className="row">
          {caverns.current.map((p) => (
            <button key={p.name} onClick={() => lab?.goTo(p)}>
              {p.name}
            </button>
          ))}
        </div>
        <h2>View</h2>
        <div className="row">
          {(['normal', 'sonar'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                lab?.setMode(m);
                setMode(m);
              }}
            >
              {m === 'normal' ? 'Normal' : 'Sonar (burrow)'}
            </button>
          ))}
          <button onClick={() => lab?.carve(5)}>Carve room</button>
        </div>
        <label>
          Time
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={time}
            onChange={(e) => {
              const v = +e.target.value;
              setTime(v);
              if (lab) lab.env.clock.frozen = v;
            }}
          />
          {time.toFixed(2)}
        </label>
        <h2>Materials</h2>
        <div className="info">
          {Object.entries(Mat)
            .filter(([, v]) => typeof v === 'number' && v !== Mat.Air)
            .map(([k, v]) => `${String(v).padStart(2)} ${k.padEnd(11)} ${MATERIALS[v as number]?.hardness}`)
            .join('\n')}
        </div>
        <h2>Focus</h2>
        <div className="info">{info}</div>
      </div>
    </>
  );
}
