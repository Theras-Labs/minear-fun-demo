// Port of play-inUT-NSi.js 51198-51370: dropped loot satchels (Uk): the procedural burlap sack with its tie and
// coin, the additive light beam, the "[E] Your satchel" tag over each one in #nametags, one point light on the
// nearest satchel, sonar halos and the expiry blink.
import * as THREE from 'three';
import { lootSummary } from '../state/gearStats';
import type { Satchel } from '../state/playerState';
import type { SonarBlip } from '../render/sonarRock';

/** A satchel as the game shows it (Fj satchel, or EO.satchelData() with the dropper's name `by`). */
export type SatchelData = Satchel & { by?: string };

/** Nk (51198): satchel tags show within this distance. */
const TAG_RANGE = 14; // Nk (51198)
/** Pk (51199): scratch. */
const tagAt = new THREE.Vector3(); // Pk (51199)
/** Fk (51200): sack cloth. */
const SACK_MAT = new THREE.MeshStandardMaterial({ color: 10117172, roughness: 0.82, vertexColors: !0 }); // Fk (51200)
/** Ik (51201): tie cord. */
const TIE_MAT = new THREE.MeshStandardMaterial({ color: 14728578, roughness: 0.9 }); // Ik (51201)
/** Lk (51202): the gold coin. */
const COIN_MAT = new THREE.MeshStandardMaterial({ // Lk (51202)
  color: 16761405,
  roughness: 0.3,
  metalness: 0.85,
  emissive: 8014336,
  emissiveIntensity: 0.6,
});

interface SackGeometries {
  body: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
  tie: THREE.BufferGeometry;
  coin: THREE.BufferGeometry;
  beam: THREE.BufferGeometry;
}

/** Rk (51209): the shared sack geometries, made once. */
let sackGeos: SackGeometries | null = null; // Rk (51209)

/** zk (51210): makes (once) the lumpy sack body with baked grey AO, the neck, top, tie, coin and beam. */
function sackGeometries(): SackGeometries { // zk (51210)
  if (sackGeos) return sackGeos;
  const e = new THREE.SphereGeometry(0.42, 20, 14),
    t = e.getAttribute(`position`),
    n = new Float32Array(t.count * 3);
  for (let e = 0; e < t.count; e++) {
    const r = t.getX(e),
      i = t.getY(e),
      a = t.getZ(e),
      o = 1 + Math.sin(r * 11 + a * 7) * 0.04 + Math.sin(i * 9 - r * 5) * 0.035,
      s = i < 0 ? 1 + (-i / 0.42) * 0.12 : 1 - (i / 0.42) * 0.18;
    t.setXYZ(e, r * o * s, i * 0.8 * o, a * o * s);
    const c = 0.72 + (i / 0.42 + 1) * 0.16;
    n.set([c, c, c], e * 3);
  }
  return (
    e.setAttribute(`color`, new THREE.BufferAttribute(n, 3)),
    e.computeVertexNormals(),
    e.translate(0, 0.33, 0),
    (sackGeos = {
      body: e,
      neck: new THREE.CylinderGeometry(0.1, 0.19, 0.2, 12).translate(0, 0.72, 0),
      top: new THREE.ConeGeometry(0.17, 0.2, 10).rotateX(Math.PI).translate(0, 0.9, 0),
      tie: new THREE.TorusGeometry(0.115, 0.032, 8, 18).rotateX(Math.PI / 2).translate(0, 0.72, 0),
      coin: new THREE.CylinderGeometry(0.075, 0.075, 0.022, 14).rotateZ(1.1).translate(0.12, 0.84, 0.05),
      beam: new THREE.CylinderGeometry(0.1, 0.34, 1, 12, 1, !0).translate(0, 0.5, 0),
    }),
    sackGeos
  );
}

type Beam = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

/** Bk (51240): a sack (own: warm beam 34 m; other: cool beam 18 m). */
function makeSack(e: boolean): { root: THREE.Group; beam: Beam } { // Bk (51240)
  const t = sackGeometries(),
    n = new THREE.Group(),
    r = new THREE.Mesh(t.body, SACK_MAT);
  (n.add(
    r,
    new THREE.Mesh(t.neck, SACK_MAT),
    new THREE.Mesh(t.top, SACK_MAT),
    new THREE.Mesh(t.tie, TIE_MAT),
    new THREE.Mesh(t.coin, COIN_MAT),
  ),
    n.traverse((e) => {
      const t = e as THREE.Mesh;
      t.isMesh && ((t.castShadow = !0), (t.receiveShadow = !0));
    }));
  const i: Beam = new THREE.Mesh(
    t.beam,
    new THREE.MeshBasicMaterial({
      color: e ? 16765562 : 12575999,
      transparent: !0,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: !1,
      side: THREE.DoubleSide,
    }),
  );
  return (i.scale.set(1, e ? 34 : 18, 1), (i.renderOrder = 9), n.add(i), { root: n, beam: i });
}

/** Vk (51262): halo colour of my satchels. */
const HALO_MINE = new THREE.Color(16765562); // Vk (51262)
/** Hk (51263): halo colour of other miners' satchels. */
const HALO_OTHER = new THREE.Color(12575999); // Hk (51263)

interface LiveSatchel {
  data: SatchelData;
  root: THREE.Group;
  beam: Beam;
  t: number;
  tag: HTMLDivElement;
  said: string;
}

/** Uk (51264): the satchels in the world. */
export class Satchels { // Uk (51264)
  group = new THREE.Group();
  live = new Map<number, LiveSatchel>();
  light = new THREE.PointLight(16767392, 0, 7, 1.6);
  time = 0;
  constructor() {
    this.group.add(this.light);
  }
  /** Shows (true) or removes (false) an off-screen sack so its shaders compile during the warm-up. */
  warm(e: boolean): void {
    e && !this.warmer
      ? ((this.warmer = makeSack(!0)),
        this.warmer.root.position.set(0, -9999, 0),
        this.warmer.root.traverse((e) => (e.frustumCulled = !1)),
        this.group.add(this.warmer.root))
      : !e &&
        this.warmer &&
        (this.warmer.root.removeFromParent(), this.warmer.beam.material.dispose(), (this.warmer = null));
  }
  warmer: { root: THREE.Group; beam: Beam } | null = null;
  /** Matches the shown satchels to the list e: removes the gone ones, adds sacks and tags for new ones. */
  sync(e: SatchelData[]): void {
    const t = new Set(e.map((e) => e.id));
    for (const [e, n] of this.live)
      t.has(e) || (n.root.removeFromParent(), n.beam.material.dispose(), n.tag.remove(), this.live.delete(e));
    for (const t of e) {
      const e = this.live.get(t.id);
      if (e) {
        e.data = t;
        continue;
      }
      const { root: n, beam: r } = makeSack(t.mine);
      (n.position.set(t.x, t.y, t.z), (n.rotation.y = (t.id % 628) / 100), this.group.add(n));
      const i = document.createElement(`div`);
      ((i.className = `sacktag`),
        (i.style.display = `none`),
        (i.innerHTML = `<kbd>E</kbd><span></span>`),
        document.getElementById(`nametags`)?.appendChild(i),
        this.live.set(t.id, { data: t, root: n, beam: r, t: 0, tag: i, said: `` }));
    }
  }
  /** Places the tags of the satchels within 14 m on screen (camera e, view t x n); r is the one in reach. */
  place(e: THREE.Camera, t: number, n: number, r: SatchelData | null): void {
    for (const i of this.live.values()) {
      tagAt.set(i.data.x, i.data.y + 1.3, i.data.z);
      const a = tagAt.distanceTo(e.position);
      tagAt.project(e);
      const o = a < TAG_RANGE && tagAt.z < 1 && Math.abs(tagAt.x) < 1.1 && Math.abs(tagAt.y) < 1.1;
      if (((i.tag.style.display = o ? `` : `none`), !o)) continue;
      const s = lootSummary(i.data),
        c = s.one ? s.what : `${i.data.mine ? `Your satchel` : `Satchel`}<small>${s.short}</small>`;
      (c !== i.said && ((i.tag.lastElementChild!.innerHTML = c), (i.said = c)),
        i.tag.classList.toggle(`near`, r?.id === i.data.id),
        (i.tag.style.transform = `translate(${((tagAt.x * 0.5 + 0.5) * t).toFixed(1)}px, ${((-tagAt.y * 0.5 + 0.5) * n).toFixed(1)}px) translate(-50%, -100%)`),
        (i.tag.style.opacity = String(Math.min(1, Math.max(0.35, 1.5 - a / TAG_RANGE)))));
    }
  }
  /** The satchel nearest to e within t (height counts 0.8). */
  nearest(e: THREE.Vector3, t = 2.3): SatchelData | null {
    let n: SatchelData | null = null,
      r = t;
    for (const t of this.live.values()) {
      const i = Math.hypot(t.data.x - e.x, (t.data.y - e.y) * 0.8, t.data.z - e.z);
      i < r && ((r = i), (n = t.data));
    }
    return n;
  }
  /** My newest satchel. */
  mine(): SatchelData | null {
    let e: SatchelData | null = null;
    for (const t of this.live.values()) t.data.mine && (!e || t.data.at > e.at) && (e = t.data);
    return e;
  }
  /** Sonar halos of the satchels within 1.5 t of e, pushed onto n. */
  halos(e: THREE.Vector3, t: number, n: SonarBlip[]): void {
    for (const r of this.live.values())
      r.root.position.distanceTo(e) > t * 1.5 ||
        n.push({
          p: r.root.position,
          color: r.data.mine ? HALO_MINE : HALO_OTHER,
          size: 1.8 * (0.9 + Math.sin(this.time * 3 + r.data.id) * 0.1),
        });
  }
  /** Per frame: beam fade by distance and age, the expiry blink, the light on the nearest within 12 m. */
  update(e: number, t: THREE.Vector3): void {
    this.time += e;
    let n: LiveSatchel | null = null,
      r = 12;
    const i = performance.now();
    for (const a of this.live.values()) {
      a.t += e;
      const o = a.root.position.distanceTo(t),
        s = THREE.MathUtils.smoothstep(o, 4, 16),
        c = a.data.exp === void 0 ? 999 : (a.data.exp - i) / 1e3,
        l = c < 60 ? 0.35 + 0.65 * +(Math.sin(this.time * (10 - c / 10)) > 0) : 1;
      ((a.beam.material.opacity = s * (0.26 + Math.sin(this.time * 2 + a.data.id) * 0.06) * Math.min(1, a.t * 2) * l),
        o < r && ((r = o), (n = a)));
    }
    n
      ? (this.light.position.set(n.data.x, n.data.y + 1, n.data.z),
        this.light.color.setHex(n.data.mine ? 16767392 : 13625599),
        (this.light.intensity += (1.6 - this.light.intensity) * Math.min(1, e * 3)))
      : (this.light.intensity *= 0.9);
  }
}
