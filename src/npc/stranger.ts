// Port of play-inUT-NSi.js 69680-69860: the Stranger NPC. nR loads /models/stranger.glb; oR seats it on the hub,
// breathes its chest with a vertex patch, makes the sword blade glow brighter with each beast soul delivered,
// builds a box collider and a footprint disc, and openSky() raises a 420 m light beam from the blade once all
// four souls are given. KR glue: src/npc/krNpc.ts (updateStranger, talkToStranger).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import '../world/chunk'; // installs three-mesh-bvh computeBoundsTree / acceleratedRaycast (35439-35441)
import { downscaleTextures } from '../miner/textureDownscale';
import { stylizeMaterial } from '../miner/stylize';

/** nR (69680): loads the Stranger scene, or null when the load fails. */
export async function loadStranger(): Promise<THREE.Group | null> { // nR (69680)
  try {
    const draco = new DRACOLoader().setDecoderPath(`/draco/`);
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`/models/stranger.glb`);
    draco.dispose();
    downscaleTextures(gltf.scene);
    return gltf.scene;
  } catch {
    return null;
  }
}

/** rR (69689): model scale. */
export const STRANGER_SCALE = 1.7; // rR (69689)
/** iR (69690): breath period in seconds. */
export const BREATH_PERIOD = 4.6; // iR (69690)
/** aR (69691): breath amplitude. */
export const BREATH_AMOUNT = 0.007; // aR (69691)

type BeamMesh = THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

export class Stranger { // oR (69692)
  readonly root = new THREE.Group();
  /** Placed position (the feet); y -9999 until KR.updateStranger places it. */
  readonly pos = new THREE.Vector3(0, -9999, 0);
  collider: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  readonly box = new THREE.Box3();
  model: THREE.Object3D | null = null;
  /** The ST_Blade material. */
  blade: THREE.MeshStandardMaterial | null = null;
  readonly breath = { value: 0 };
  t = 0;
  beam: BeamMesh | null = null;
  /** Local positions of the ST_* empties (ST_Chest, ST_BenchTop, ST_Head, ST_BladeMid). */
  readonly marks = new Map<string, THREE.Vector3>();
  /** Bounds of ST_Body in root space. */
  readonly bounds = new THREE.Box3();

  constructor(scene: THREE.Object3D | null) {
    if (!scene) return;
    const t = scene;
    t.scale.setScalar(STRANGER_SCALE);
    t.updateMatrixWorld(true);
    t.traverse((e) => {
      if (!(e as THREE.Mesh).isMesh && e.name.startsWith(`ST_`)) this.marks.set(e.name, e.position.clone());
    });
    const chest = this.marks.get(`ST_Chest`) ?? new THREE.Vector3();
    const seat = this.marks.get(`ST_BenchTop`)?.y ?? -1e3;
    const done = new Map<THREE.Material, THREE.Material>();
    t.traverse((e) => {
      const mesh = e as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(3);
      const patch = (m: THREE.Material): THREE.Material => {
        let out = done.get(m);
        if (out) return out;
        if (m.name === `ST_Void`) {
          out = new THREE.MeshBasicMaterial({ color: 0 });
          done.set(m, out);
          return out;
        }
        const a = m as THREE.MeshStandardMaterial;
        out = a;
        done.set(m, out);
        a.metalness = 0.06;
        a.roughness = 1.6;
        stylizeMaterial(a, 0.03, 1.3);
        if (a.name === `ST_Blade`) {
          this.blade = a;
          a.emissive.setRGB(1, 1, 1);
          a.emissiveMap = a.map;
          a.emissiveIntensity = 0.4;
        } else {
          const prev = a.onBeforeCompile;
          a.onBeforeCompile = (shader, renderer) => {
            prev.call(a, shader, renderer);
            shader.uniforms.uBreath = this.breath;
            shader.uniforms.uChest = { value: chest };
            shader.uniforms.uSeat = { value: seat };
            shader.vertexShader = shader.vertexShader
              .replace(
                `#include <common>`,
                `#include <common>
uniform float uBreath; uniform vec3 uChest; uniform float uSeat;`,
              )
              .replace(
                `#include <begin_vertex>`,
                `#include <begin_vertex>
transformed += objectNormal * uBreath * (1.0 - smoothstep(0.04, 0.3, distance(position, uChest))) * smoothstep(uSeat + 0.005, uSeat + 0.04, position.y);`,
              );
          };
          a.customProgramCacheKey = () => `stranger-body`;
        }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
    });
    this.model = t;
    this.root.add(t);
    this.root.updateMatrixWorld(true);
    this.bounds.setFromObject(t.getObjectByName(`ST_Body`) ?? t);
    const b = this.bounds;
    // footprint disc on layer 3 only
    const foot = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    foot.scale.set((b.max.x - b.min.x) * 0.5 + 0.45, 1, (b.max.z - b.min.z) * 0.5 + 0.55);
    foot.position.set((b.min.x + b.max.x) / 2, b.min.y + 0.02, (b.min.z + b.max.z) / 2);
    foot.layers.set(3);
    this.root.add(foot);
  }

  get loaded(): boolean {
    return !!this.model;
  }

  /** place (69775): seats the model with its lowest point on `at`, facing `yaw`, and builds a world-space box collider. */
  place(at: THREE.Vector3, yaw: number): void {
    this.pos.copy(at);
    this.root.position.set(at.x, at.y - this.bounds.min.y, at.z);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    const n = this.bounds;
    const k = this.marks.has(`ST_BenchTop`) ? [0.97, 0.9, 0.94] : [0.86, 0.8, 0.7];
    const geo = new THREE.BoxGeometry((n.max.x - n.min.x) * k[0], (n.max.y - n.min.y) * k[1], (n.max.z - n.min.z) * k[2]);
    geo.translate((n.min.x + n.max.x) / 2, n.min.y + (n.max.y - n.min.y) * k[1] * 0.5, (n.min.z + n.max.z) / 2);
    geo.applyMatrix4(this.root.matrixWorld);
    geo.deleteAttribute(`normal`);
    geo.deleteAttribute(`uv`);
    geo.computeBoundingBox();
    geo.computeBoundsTree();
    this.collider?.geometry.dispose();
    this.collider = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.updateMatrixWorld(true);
    this.box.copy(geo.boundingBox!).expandByScalar(1);
  }

  /** near (69802): distance from the body bounds (in the model's turned frame) under r - 1.2, and within 2.5 vertically. */
  near(p: THREE.Vector3, r = 3): boolean {
    if (!this.model || Math.abs(p.y - this.pos.y) > 2.5) return false;
    const a = -this.root.rotation.y;
    const dx = p.x - this.root.position.x;
    const dz = p.z - this.root.position.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a);
    const lz = dx * Math.sin(a) + dz * Math.cos(a);
    const s = this.bounds;
    const ox = Math.max(0, s.min.x - lx, lx - s.max.x);
    const oz = Math.max(0, s.min.z - lz, lz - s.max.z);
    return Math.hypot(ox, oz) < r - 1.2;
  }

  /** update (69814): breath, blade glow by souls delivered, and the beam time. */
  update(dt: number, souls: number): void {
    if (!this.model) return;
    this.t += dt;
    const k = (this.t % BREATH_PERIOD) / BREATH_PERIOD;
    this.breath.value = BREATH_AMOUNT * Math.sin(Math.PI * k) ** 2;
    if (this.blade) this.blade.emissiveIntensity = (0.35 + souls * 0.35) * (0.82 + 0.18 * Math.sin(this.t * 1.7));
    if (this.beam) this.beam.material.uniforms.uT.value = this.t;
  }

  /** mark (69824): world position of an ST_* empty, or a point 0.4 above the feet. */
  mark(name: string, out: THREE.Vector3): THREE.Vector3 {
    const n = this.marks.get(name);
    return !n || !this.model ? out.copy(this.pos).setY(this.pos.y + 0.4) : this.model.localToWorld(out.copy(n));
  }

  /** bladeAt (69830) */
  bladeAt(out: THREE.Vector3): THREE.Vector3 {
    return this.mark(`ST_BladeMid`, out);
  }

  /** openSky (69833): the sky beam rising from the blade. */
  openSky(): void {
    if (this.beam || !this.model) return;
    const geo = new THREE.CylinderGeometry(0.3, 1.2, 420, 16, 1, true);
    geo.translate(0, 210, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0.55, 0.75, 1) } },
      vertexShader: `
        varying float vH; varying vec2 vUv;
        void main() { vH = position.y / ${(420).toFixed(1)}; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uT; uniform vec3 uC; varying float vH; varying vec2 vUv;
        void main() {
          float fade = smoothstep(0.0, 0.03, vH) * (1.0 - smoothstep(0.35, 1.0, vH));
          float streak = 0.6 + 0.4 * sin(vUv.x * 40.0 + uT * 1.5) * sin(vH * 60.0 - uT * 3.0);
          gl_FragColor = vec4(uC * fade * streak * 0.55, 1.0);
        }`,
    });
    this.beam = new THREE.Mesh(geo, mat);
    this.beam.frustumCulled = false;
    this.root.updateMatrixWorld(true);
    const at = this.bladeAt(new THREE.Vector3());
    this.beam.position.copy(this.root.worldToLocal(at));
    this.beam.rotation.y = -this.root.rotation.y;
    this.root.add(this.beam);
  }
}
