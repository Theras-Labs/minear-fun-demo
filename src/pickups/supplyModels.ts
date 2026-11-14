// Procedural supply models (boulder, bird song, tonic, smoke pot, recall stone, strength flask, fortune cookie,
// ult juice, dead dust) and the dispatcher VP. Bundle play-inUT-NSi.js lines 62105-62337.
// The bomb mesh BM (58353-58406, Bombs system) is ported here too because VP falls back to it; the bombs owner
// should import bombModel from this file.
import * as THREE from 'three';

/** TP (62105): MeshStandardMaterial with roughness 0.6. */
const supplyMat = (e: number, t: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: e, roughness: 0.6, ...t }); // TP (62105)

// ---- the bomb mesh (58358-58406) ----
const BOMB_R = 0.26; // MM (58358)
const bombBodyMat = new THREE.MeshStandardMaterial({ // NM (58359)
  color: 2893875,
  roughness: 0.38,
  metalness: 0.55,
  emissive: 16722458,
  emissiveIntensity: 0,
});
const bombBandMat = new THREE.MeshStandardMaterial({ color: 12728878, roughness: 0.55, metalness: 0.1 }); // PM (58366)
const bombCollarMat = new THREE.MeshStandardMaterial({ color: 14133322, roughness: 0.35, metalness: 0.8 }); // FM (58367)
const bombFuseMat = new THREE.MeshStandardMaterial({ color: 15127456, roughness: 0.9 }); // IM (58368)
const bombSparkMat = new THREE.MeshBasicMaterial({ color: 16773552 }); // LM (58369)
interface BombParts {
  body: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
  fuse: THREE.BufferGeometry;
  spark: THREE.BufferGeometry;
  tip: THREE.Vector3;
}
let bombParts: BombParts | null = null; // RM (58370)
function bombGeometry(): BombParts { // zM (58371)
  if (bombParts) return bombParts;
  const e = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.32, 0),
    new THREE.Vector3(0.03, 0.4, 0.02),
    new THREE.Vector3(0.09, 0.45, 0.05),
    new THREE.Vector3(0.15, 0.46, 0.08),
  ]);
  return (
    (bombParts = {
      body: new THREE.SphereGeometry(BOMB_R, 22, 16),
      band: new THREE.TorusGeometry(BOMB_R * 0.985, 0.028, 8, 32).rotateX(Math.PI / 2),
      collar: new THREE.CylinderGeometry(0.075, 0.09, 0.08, 14).translate(0, 0.28, 0),
      fuse: new THREE.TubeGeometry(e, 12, 0.016, 6),
      spark: new THREE.IcosahedronGeometry(0.035, 1),
      tip: e.getPoint(1),
    }),
    bombParts
  );
}
/** BM (58391): the bomb mesh; lit = a thrown bomb (own body material, fuse spark). */
export function bombModel(e = !1): THREE.Group { // BM (58391)
  const t = bombGeometry(),
    n = new THREE.Group(),
    r = new THREE.Mesh(t.body, e ? bombBodyMat.clone() : bombBodyMat);
  if (
    (n.add(r, new THREE.Mesh(t.band, bombBandMat), new THREE.Mesh(t.collar, bombCollarMat), new THREE.Mesh(t.fuse, bombFuseMat)),
    e)
  ) {
    const e = new THREE.Mesh(t.spark, bombSparkMat);
    (e.position.copy(t.tip), n.add(e), (n.userData.spark = e));
  }
  return (
    (n.userData.body = r),
    n.traverse((e) => {
      (e as THREE.Mesh).isMesh && (e.castShadow = !0);
    }),
    n
  );
}

// ---- supplies (62106-62337) ----
function boulderModel(): THREE.Group { // EP (62106)
  const e = new THREE.IcosahedronGeometry(0.3, 1),
    t = e.getAttribute(`position`) as THREE.BufferAttribute;
  for (let e = 0; e < t.count; e++) {
    const n = t.getX(e),
      r = t.getY(e),
      i = t.getZ(e),
      a = 1 + Math.sin(n * 17 + r * 5) * 0.07 + Math.sin(i * 13 - n * 7) * 0.06;
    t.setXYZ(e, n * a, r * a * 0.88, i * a);
  }
  e.computeVertexNormals();
  const n = new THREE.Group(),
    r = supplyMat(9273715, { roughness: 0.92, flatShading: !0 });
  n.add(new THREE.Mesh(e, r));
  for (const [e, t, i] of [
    [0.3, 0.12, 0.08],
    [-0.24, 0.22, 0.06],
  ]) {
    const a = new THREE.Mesh(new THREE.DodecahedronGeometry(i, 0), r);
    (a.position.set(e, -0.2, t), n.add(a));
  }
  return n;
}
function birdModel(): THREE.Group { // DP (62129)
  const e = new THREE.Group(),
    t = supplyMat(16765500, { roughness: 0.55 }),
    n = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), t);
  n.scale.set(1.25, 0.95, 1);
  const r = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), t);
  r.position.set(0.17, 0.12, 0);
  const i = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 10), supplyMat(16747068));
  ((i.rotation.z = -Math.PI / 2), i.position.set(0.29, 0.11, 0));
  const a = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), supplyMat(14721562));
  ((a.rotation.z = Math.PI / 2 - 0.5), a.position.set(-0.24, 0.07, 0), a.scale.set(1, 1, 0.45));
  const o = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), supplyMat(15775018));
  (o.scale.set(1.2, 0.55, 0.35), o.position.set(-0.02, 0.04, 0.14));
  const s = o.clone();
  s.position.z = -0.14;
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), supplyMat(2759444, { roughness: 0.3 }));
  c.position.set(0.23, 0.15, 0.06);
  const l = c.clone();
  l.position.z = -0.06;
  const u = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), supplyMat(5913114));
  return (u.position.set(-0.02, 0.16, 0), e.add(n, r, i, a, o, s, c, l, u), e);
}
function tonicModel(): THREE.Group { // OP (62151)
  const e = new THREE.Group(),
    t = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 20, 14),
      supplyMat(16732010, { roughness: 0.25, emissive: 16720452, emissiveIntensity: 0.45 }),
    );
  t.scale.set(1, 0.95, 1);
  const n = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.14, 14), supplyMat(14283519, { roughness: 0.15, metalness: 0.1 }));
  n.position.y = 0.17;
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.052, 0.07, 12), supplyMat(11566418, { roughness: 0.9 }));
  r.position.y = 0.27;
  const i = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.014, 8, 20), supplyMat(16761405, { metalness: 0.6, roughness: 0.35 }));
  ((i.rotation.x = Math.PI / 2), (i.position.y = 0.13));
  const a = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), supplyMat(16777215, { emissive: 16777215, emissiveIntensity: 0.3 }));
  return (a.position.set(0, 0.01, 0.151), e.add(t, n, r, i, a), e);
}
let smokeCache: THREE.Group | null = null; // kP (62167)
function smokeModel(): THREE.Group { // AP (62168)
  return ((smokeCache ||= buildSmoke()), smokeCache.clone());
}
function buildSmoke(): THREE.Group { // jP (62171)
  const e = new THREE.Group(),
    t = supplyMat(9406120, { roughness: 0.85 }),
    n = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), t);
  n.scale.set(1, 0.9, 1);
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.196, 0.022, 8, 28), supplyMat(15721423, { roughness: 0.7 }));
  r.rotation.x = Math.PI / 2;
  const i = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.07, 14), supplyMat(6182006, { roughness: 0.7 }));
  i.position.y = 0.2;
  const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), supplyMat(15127456, { roughness: 0.9 }));
  ((a.position.y = 0.27), e.add(n, r, i, a));
  const o = supplyMat(14999280, { roughness: 1, emissive: 7300752, emissiveIntensity: 0.25 });
  for (const [t, n, r] of [
    [0.02, 0.36, 0.06],
    [0.07, 0.45, 0.075],
    [0.02, 0.56, 0.09],
  ]) {
    const i = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), o);
    (i.position.set(t, n, 0), e.add(i));
  }
  return e;
}
function recallModel(): THREE.Group { // MP (62193)
  const e = new THREE.Group(),
    t = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 16),
      supplyMat(5596543, { roughness: 0.45, emissive: 1915466, emissiveIntensity: 0.4 }),
    );
  t.scale.set(1, 0.55, 0.78);
  const n = supplyMat(10482943, { emissive: 5235711, emissiveIntensity: 1.6, roughness: 0.3 }),
    r = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 28), n);
  ((r.rotation.x = Math.PI / 2), (r.position.y = 0.115));
  const i = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, 0.2), n);
  i.position.y = 0.118;
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.024), n);
  return (a.position.set(0, 0.118, -0.05), e.add(t, r, i, a), (e.rotation.x = 0.35), e);
}
let strengthCache: THREE.Group | null = null; // NP (62208)
function strengthModel(): THREE.Group { // PP (62209)
  if (!strengthCache) {
    const e = new THREE.Group(),
      t = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.125, 0.26, 6),
        supplyMat(13116954, {
          roughness: 0.2,
          emissive: 16734746,
          emissiveIntensity: 0.55,
          flatShading: !0,
        }),
      );
    t.position.y = 0.04;
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.1, 0.07, 6), supplyMat(15255736, { roughness: 0.15, flatShading: !0 }));
    n.position.y = 0.205;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 10), supplyMat(3814464, { metalness: 0.6, roughness: 0.4 }));
    r.position.y = 0.27;
    const i = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.1, 8),
      supplyMat(16765500, { emissive: 16752672, emissiveIntensity: 0.9 }),
    );
    ((i.scale.z = 0.4), i.position.set(0, 0.04, 0.112), e.add(t, n, r, i), (strengthCache = e));
  }
  return strengthCache.clone();
}
let cookieCache: THREE.Group | null = null; // FP (62234)
function cookieModel(): THREE.Group { // IP (62235)
  if (!cookieCache) {
    const e = new THREE.Group(),
      t = supplyMat(15312200, { roughness: 0.75, emissive: 6961672, emissiveIntensity: 0.25 }),
      n = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.075, 12, 22, Math.PI), t);
    (n.scale.set(1, 0.85, 0.9), (n.rotation.z = Math.PI), (n.position.y = 0.12));
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.05), supplyMat(16775920, { roughness: 0.8 }));
    (r.position.set(0.1, 0.02, 0.07),
      r.rotation.set(0.2, 0.4, -0.15),
      e.add(n, r),
      (e.rotation.x = 0.35),
      (cookieCache = e));
  }
  return cookieCache.clone();
}
let juiceCache: THREE.Group | null = null; // LP (62250)
function juiceModel(): THREE.Group { // RP (62251)
  if (!juiceCache) {
    const e = new THREE.Group(),
      t = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.27, 20),
        supplyMat(5914544, {
          roughness: 0.35,
          metalness: 0.2,
          emissive: 2759274,
          emissiveIntensity: 0.35,
        }),
      );
    t.position.y = 0.135;
    const n = new THREE.Mesh(
      new THREE.CylinderGeometry(0.114, 0.114, 0.11, 20),
      supplyMat(16761405, {
        roughness: 0.3,
        metalness: 0.15,
        emissive: 16752672,
        emissiveIntensity: 0.35,
      }),
    );
    n.position.y = 0.13;
    const r = supplyMat(14212580, {
        roughness: 0.3,
        metalness: 0.2,
        emissive: 4212824,
        emissiveIntensity: 0.3,
      }),
      i = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.108, 0.03, 20), r);
    i.position.y = 0.285;
    const a = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.012, 8, 24), r);
    ((a.rotation.x = Math.PI / 2), (a.position.y = 0.3));
    const o = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.035), supplyMat(13159636, { roughness: 0.35 }));
    o.position.set(0.02, 0.306, 0.01);
    const s = new THREE.Mesh(
      new THREE.ConeGeometry(0.034, 0.08, 6),
      supplyMat(16774084, { emissive: 16769162, emissiveIntensity: 0.9 }),
    );
    ((s.rotation.x = Math.PI),
      (s.scale.z = 0.45),
      s.position.set(0, 0.125, 0.112),
      e.add(t, n, i, a, o, s),
      (juiceCache = e));
  }
  return juiceCache.clone();
}
let dustCache: THREE.Group | null = null; // zP (62298)
function dustModel(): THREE.Group { // BP (62299)
  if (!dustCache) {
    const e = new THREE.Group(),
      t = supplyMat(14209220, { roughness: 0.95 }),
      n = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), t);
    (n.scale.set(1, 0.9, 1), (n.position.y = 0.13));
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.08, 12), t);
    r.position.y = 0.27;
    const i = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 16), supplyMat(2761776, { roughness: 0.6 }));
    ((i.rotation.x = Math.PI / 2), (i.position.y = 0.26));
    const a = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 6),
      supplyMat(10129584, { roughness: 1, emissive: 6970010, emissiveIntensity: 0.6 }),
    );
    (a.scale.set(1.3, 0.35, 1), a.position.set(0, 0.32, 0), e.add(n, r, i, a), (dustCache = e));
  }
  return dustCache.clone();
}

/** VP (62317): the pickup model of a supply or Dead Dust (a bomb for anything else). */
export function supplyModel(e: string): THREE.Object3D { // VP (62317)
  return e === `strength`
    ? strengthModel()
    : e === `cookie`
      ? cookieModel()
      : e === `ultjuice`
        ? juiceModel()
        : e === `deaddust`
          ? dustModel()
          : e === `boulder`
            ? boulderModel()
            : e === `birdsong`
              ? birdModel()
              : e === `tonic`
                ? tonicModel()
                : e === `smoke`
                  ? smokeModel()
                  : e === `recall`
                    ? recallModel()
                    : bombModel();
}
