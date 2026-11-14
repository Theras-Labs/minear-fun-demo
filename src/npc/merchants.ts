// MINEAR: the six merchants as NPCs (folder: minear-r3f/src/npc). Each one stands at its own stall on one of
// the small floating islands around the base (src/hub/satellites.ts MERCHANT_ISLAND): its own mole (a clone of
// nearmol.glb with its own fur tint and hat), a counter with its goods, an awning in its colour, and a name
// sign that shows from the base. E next to one opens its dialog (src/menus/merchantDialog.ts); the trade rules
// and prices are the on-chain merchants of src/economy/pricing.ts. Fly over with the jetpack.
// The stalls are children of the hub group, so they hide with the base when the miner is deep underground.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MERCHANTS } from '../economy/pricing';
import { TOKEN_BY_ID } from '../economy/catalog';
import { MERCHANT_ISLAND, SATELLITES } from '../hub/satellites';
import { MINEAR_BASE } from '../miner/loader';

/** How each merchant looks: fur tint, hat, stall colour, sign colour. */
interface MerchantLook {
  fur: number;
  hat: `cap` | `beret` | `tophat` | `wide` | `tricorn` | `hood`;
  hatColor: number;
  band: number;
  awning: number;
}

const LOOKS: Record<string, MerchantLook> = {
  smelter: { fur: 0x8a5a44, hat: `cap`, hatColor: 0x4a2e22, band: 0xff7a2e, awning: 0xd2552c },
  gemcutter: { fur: 0xb39acb, hat: `beret`, hatColor: 0x7b4fc4, band: 0xe8d4ff, awning: 0x8f62d9 },
  jeweler: { fur: 0xf0e2c8, hat: `tophat`, hatColor: 0xfff6e5, band: 0xe8b834, awning: 0xe8b834 },
  wanderer: { fur: 0x8d8a55, hat: `wide`, hatColor: 0x5b7a3a, band: 0xc9e27b, awning: 0x4f9a5a },
  quartermaster: { fur: 0x7e8ea6, hat: `tricorn`, hatColor: 0x2f4f86, band: 0xffd36b, awning: 0x3d7bd0 },
  relics: { fur: 0x5d6470, hat: `hood`, hatColor: 0x1f3a40, band: 0x5ff0d8, awning: 0x2a8f86 },
};

/** Talk range (metres, flat) and height window. */
const NEAR_R = 3.3;
const NEAR_DY = 2.6;
/** Animate only when the miner is this close. */
const ANIM_R = 90;
/** Body height of a merchant (metres). */
const HEIGHT = 1.7;

export interface MerchantNpc {
  id: string;
  name: string;
  title: string;
  /** World position of the merchant's feet. */
  pos: THREE.Vector3;
  root: THREE.Group;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  wave: THREE.AnimationAction | null;
  /** Yaw when nobody is near (facing the base). */
  homeYaw: number;
  yaw: number;
  greeted: boolean;
}

/**
 * Static parts merged into one vertex-coloured mesh (a stall or a hat is one draw call, not twenty).
 * add() takes a geometry, its colour and its placement.
 */
class Parts {
  private list: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).deleteAttribute(`uv`);
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = g.getAttribute(`position`).count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute(`color`, new THREE.BufferAttribute(col, 3));
    this.list.push(g);
    geo.dispose();
  }
  mesh(material: THREE.Material): THREE.Mesh {
    const geo = mergeGeometries(this.list, false)!;
    geo.computeVertexNormals();
    for (const g of this.list) g.dispose();
    this.list = [];
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** One material for every merchant's stall and hat (flat-shaded, vertex colours). */
const PROP_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true });

/** A hat that fits the KayKit `hatslot` (width 1, origin at the crown centre at rim height). */
function makeHat(look: MerchantLook): THREE.Mesh {
  const p = new Parts();
  const m = look.hatColor;
  const b = look.band;
  const half = Math.PI / 2;
  switch (look.hat) {
    case `cap`:
      p.add(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, half), m);
      p.add(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 14), b, 0, 0.02, 0.28);
      break;
    case `beret`:
      p.add(new THREE.CylinderGeometry(0.62, 0.5, 0.18, 16), m, 0, 0.1, 0, 0, 0, 0.18);
      p.add(new THREE.SphereGeometry(0.07, 8, 6), b, 0, 0.24, 0);
      break;
    case `tophat`:
      p.add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 18), m, 0, 0.02, 0);
      p.add(new THREE.CylinderGeometry(0.4, 0.42, 0.62, 18), m, 0, 0.34, 0);
      p.add(new THREE.CylinderGeometry(0.425, 0.425, 0.12, 18), b, 0, 0.12, 0);
      break;
    case `wide`:
      p.add(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 18), m, 0, 0.02, 0);
      p.add(new THREE.ConeGeometry(0.45, 0.42, 16), m, 0, 0.24, 0);
      p.add(new THREE.CylinderGeometry(0.43, 0.45, 0.08, 16), b, 0, 0.08, 0);
      break;
    case `tricorn`:
      p.add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 3), m, 0, 0.1, 0, 0, Math.PI);
      p.add(new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, half), m, 0, 0.12, 0);
      p.add(new THREE.SphereGeometry(0.06, 8, 6), b, 0, 0.2, 0.42);
      break;
    case `hood`:
      p.add(new THREE.ConeGeometry(0.55, 0.9, 14), m, 0, 0.32, 0);
      p.add(new THREE.TorusGeometry(0.47, 0.06, 6, 18), b, 0, 0.03, 0, half);
      break;
  }
  return p.mesh(PROP_MAT);
}

/** A text sign texture: name on top, title under it. */
function signTexture(name: string, title: string, color: string): THREE.CanvasTexture {
  const c = document.createElement(`canvas`);
  c.width = 512;
  c.height = 176;
  const x = c.getContext(`2d`)!;
  const r = 40;
  x.fillStyle = `#3a281c`;
  x.beginPath();
  x.roundRect(4, 4, 504, 168, r);
  x.fill();
  x.fillStyle = `#fff6e5`;
  x.beginPath();
  x.roundRect(14, 14, 484, 148, r - 10);
  x.fill();
  x.fillStyle = color;
  x.fillRect(14, 120, 484, 6);
  x.textAlign = `center`;
  x.fillStyle = `#3a281c`;
  x.font = `700 70px Fredoka, system-ui, sans-serif`;
  x.fillText(name, 256, 92);
  x.font = `600 34px Fredoka, system-ui, sans-serif`;
  x.fillStyle = `#7a5c45`;
  x.fillText(title, 256, 154);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The stall: a counter with goods on it, an awning on four posts, a lantern and the floating name sign. */
function makeStall(id: string, look: MerchantLook, name: string, title: string, goods: number[]): THREE.Group {
  const g = new THREE.Group();
  const p = new Parts();
  const wood = 0x8a5a3a;
  const dark = 0x5a3a26;
  const stripe = new THREE.Color(look.awning).lerp(new THREE.Color(0xffffff), 0.55).getHex();
  // the counter in front of the merchant (local +z faces the base)
  p.add(new THREE.BoxGeometry(2.0, 0.9, 0.7), wood, 0, 0.45, 0.85);
  p.add(new THREE.BoxGeometry(2.15, 0.1, 0.82), dark, 0, 0.95, 0.85);
  // posts and the awning, with a scalloped front edge in two colours
  for (const sx of [-1, 1]) p.add(new THREE.BoxGeometry(0.12, 2.4, 0.12), dark, sx * 1.05, 1.2, 1.15);
  for (const sx of [-1, 1]) p.add(new THREE.BoxGeometry(0.12, 2.6, 0.12), dark, sx * 1.05, 1.3, -0.55);
  p.add(new THREE.BoxGeometry(2.4, 0.08, 2.0), look.awning, 0, 2.55, 0.3, -0.18);
  for (let i = 0; i < 6; i++)
    p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10, 1, false, 0, Math.PI), i % 2 ? look.awning : stripe, -1.0 + i * 0.4, 2.36, 1.3, Math.PI / 2);
  // goods on the counter: a little heap of each item it trades (crystals for gems, nuggets for ore)
  goods.forEach((color, i) => {
    const gem = i % 2 === 1;
    const bright = new THREE.Color(color).lerp(new THREE.Color(0xffffff), gem ? 0.15 : 0).getHex();
    for (let k = 0; k < 3; k++)
      p.add(
        gem ? new THREE.OctahedronGeometry(0.11) : new THREE.DodecahedronGeometry(0.1),
        bright,
        -0.75 + i * 0.5 + (k - 1) * 0.12,
        1.06 + (k === 1 ? 0.08 : 0),
        0.85 + (k % 2 ? 0.1 : -0.08),
        k,
        i + k * 2,
      );
  });
  g.add(p.mesh(PROP_MAT));
  // a lantern on the right post
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
  lamp.position.set(1.05, 2.1, 1.3);
  g.add(lamp);
  // the name sign above the stall: readable from the base, always facing the camera
  const sign = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: signTexture(name, title, `#${look.awning.toString(16).padStart(6, `0`)}`), transparent: true, depthWrite: false }),
  );
  sign.scale.set(2.9, 1.0, 1);
  sign.position.set(0, 3.55, 0.3);
  sign.name = `MerchantSign:${id}`;
  g.add(sign);
  return g;
}

export class Merchants {
  list: MerchantNpc[] = [];
  private loaded = false;
  private tmp = new THREE.Vector3();

  /**
   * hubGroup: the hub's group (stands at the lift, unrotated); hubCollider: the hub's merged collider, used to
   * find each island's top. clips: the player's retargeted clips (the merchants use the same skeleton).
   */
  constructor(
    private hubGroup: THREE.Group,
    hubCollider: THREE.Mesh,
    private clips: THREE.AnimationClip[],
  ) {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    hubCollider.updateMatrixWorld(true);
    for (const m of MERCHANTS) {
      const i = MERCHANT_ISLAND[m.id];
      const sat = SATELLITES[i];
      if (!sat) continue;
      const [angle, dist, y] = sat;
      const a = THREE.MathUtils.degToRad(angle);
      // island centre (hub-local) and the way to the base (the lift)
      const cx = Math.cos(a) * dist;
      const cz = -Math.sin(a) * dist;
      const toBase = new THREE.Vector3(-cx, 0, -cz).normalize();
      // the merchant stands a little behind the centre, the counter between it and the base
      const lx = cx - toBase.x * 0.7;
      const lz = cz - toBase.z * 0.7;
      // island top under that spot (world ray against the hub collider), else the island's y
      const world = new THREE.Vector3(lx, y + 6, lz).add(hubGroup.position);
      ray.set(world, down);
      ray.far = 14;
      const hit = ray.intersectObject(hubCollider, false)[0];
      const topY = hit ? hit.point.y - hubGroup.position.y : y + 0.25;
      const yaw = Math.atan2(toBase.x, toBase.z);
      const root = new THREE.Group();
      root.name = `Merchant:${m.id}`;
      root.position.set(lx, topY, lz);
      root.rotation.y = yaw;
      const look = LOOKS[m.id] ?? LOOKS.smelter;
      const goods = Object.keys(m.target).map((t) => TOKEN_BY_ID[t]?.color ?? 0xffffff);
      root.add(makeStall(m.id, look, m.name, m.title, goods));
      hubGroup.add(root);
      this.list.push({
        id: m.id,
        name: m.name,
        title: m.title,
        pos: new THREE.Vector3(lx, topY, lz).add(hubGroup.position),
        root,
        model: null,
        mixer: null,
        idle: null,
        wave: null,
        homeYaw: 0,
        yaw: 0,
        greeted: false,
      });
    }
  }

  /** Loads the mole once and dresses a clone for each merchant. Safe to call more than once. */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let src: THREE.Group;
    try {
      src = (await new GLTFLoader().loadAsync(`${MINEAR_BASE}/nearmol.glb`)).scene;
    } catch {
      return; // the stalls and signs still stand; the merchant bodies are missing
    }
    const pick = (...names: string[]) => {
      for (const n of names) {
        const c = this.clips.find((x) => x.name === n) ?? this.clips.find((x) => x.name.startsWith(n));
        if (c) return c;
      }
      return null;
    };
    const idleClip = pick(`Idle_A`, `Idle`);
    const waveClip = pick(`Interact`, `Cheer`, `Idle_B`);
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const scale = HEIGHT / Math.max(0.1, box.max.y - box.min.y);
    for (const npc of this.list) {
      const look = LOOKS[npc.id] ?? LOOKS.smelter;
      const model = cloneSkinned(src);
      model.scale.setScalar(scale);
      model.position.y = -box.min.y * scale;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds do not follow the pose
        const tint = (m: THREE.Material) => {
          const c = (m as THREE.MeshStandardMaterial).clone();
          if (c.color) c.color.multiply(new THREE.Color(look.fur).lerp(new THREE.Color(0xffffff), 0.35));
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
      });
      model.getObjectByName(`hatslot`)?.add(makeHat(look));
      const holder = new THREE.Group();
      holder.add(model);
      npc.root.add(holder);
      npc.model = holder;
      const mixer = new THREE.AnimationMixer(model);
      npc.mixer = mixer;
      if (idleClip) {
        npc.idle = mixer.clipAction(idleClip);
        npc.idle.time = Math.random() * idleClip.duration;
        npc.idle.play();
      }
      if (waveClip) {
        npc.wave = mixer.clipAction(waveClip);
        npc.wave.setLoop(THREE.LoopOnce, 1);
        npc.wave.clampWhenFinished = false;
      }
      mixer.update(0);
    }
  }

  /** The merchant the miner can talk to at `pos`, or null. */
  near(pos: THREE.Vector3): MerchantNpc | null {
    let best: MerchantNpc | null = null;
    let bestD = NEAR_R;
    for (const m of this.list) {
      const d = Math.hypot(pos.x - m.pos.x, pos.z - m.pos.z);
      if (d < bestD && Math.abs(pos.y - m.pos.y) < NEAR_DY) [best, bestD] = [m, d];
    }
    return best;
  }

  /** Idle animation, a wave when the miner walks up, and a slow turn toward the miner while near. */
  update(dt: number, player: THREE.Vector3, shown: boolean): void {
    if (!shown) return;
    for (const m of this.list) {
      const d = m.pos.distanceTo(player);
      if (d > ANIM_R || !m.model) continue;
      m.mixer?.update(dt);
      const close = d < 7;
      if (close && !m.greeted && m.wave) {
        m.greeted = true;
        m.wave.reset().setEffectiveWeight(1).fadeIn(0.2).play();
        m.idle?.fadeOut(0.2);
        setTimeout(() => {
          m.wave?.fadeOut(0.3);
          m.idle?.reset().fadeIn(0.3).play();
        }, Math.max(600, (m.wave.getClip().duration - 0.3) * 1000));
      }
      if (d > 10) m.greeted = false;
      // turn the body toward the miner when close, back to the base when not
      let want = 0;
      if (close) {
        this.tmp.copy(player).sub(m.pos);
        const world = Math.atan2(this.tmp.x, this.tmp.z);
        want = THREE.MathUtils.euclideanModulo(world - m.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        want = THREE.MathUtils.clamp(want, -1.1, 1.1);
      }
      m.yaw += (want - m.yaw) * Math.min(1, dt * 4);
      m.model.rotation.y = m.yaw;
    }
  }
}
