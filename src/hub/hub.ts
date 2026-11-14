// Port of play-inUT-NSi.js lines 49540-50257: the hub town UO (with the floater matrices BO, VO, HO).
// A floating island at the lift point with the hub2.glb town on top (merged into a few baked meshes), 8 small
// satellite islands with instanced trees and bushes, glowing crystals under the island, the lift beam down to
// the portal, the Wellspring spirit crystal and water, lights, a halo sprite, the gold stash chest, the
// interaction spots and a hidden BVH collider.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import '../world/chunk'; // installs three-mesh-bvh computeBoundsTree / acceleratedRaycast (35439-35441)
import { LIFT_POINT, LIFT_RADIUS } from '../world/constants';
import { seededRandom } from '../world/rng';
import { stylizeMaterial, stylizePerVertex } from '../miner/stylize';
import { makePaintableGround } from '../render/painterly';
import { CAPTURE_LAYER_DRESSING, CAPTURE_LAYER_HUB_CAPS, CAPTURE_LAYER_HUB_DRESSING } from '../render/grass';
import { oakRecipe, pineRecipe, bushRecipe, type VegetationRecipe } from '../decor/vegetation';
import { createLeafMaterial, createLeafDepthMaterial, createPropMaterial } from '../decor/vegetationMaterials';
import { MERCHANT_ISLANDS, SATELLITES } from './satellites';
import { islandUnderside, islandCap, islandRockMaterial } from './islands';
import {
  HUB_GROUND_Y,
  HUB_GRAIN,
  HUB_GLOW_MATERIALS,
  spiritWaterMaterial,
  forceColor4,
  bakeLook,
  mergeHub,
  type SpiritWater,
} from './hubAssets';
import { caveCrystalMaterial, type CaveKit, type CaveMaterial } from './caveKit';
import { SITES, siteFront, sitePlace, siteStatus, type SiteId, type UnlockView } from '../base/sites';
import { SiteView, siteMaterial } from '../base/buildings';

/** MINEAR base: where the storage chest stands (island-local), in the gap between the Farm and the Diner. */
const STASH_AT = { x: -5.44, z: 4.41 };

const W = LIFT_POINT; // W (28758)

/** Floater top piece (CV_Crys2) about a crystal node. */
const FLOAT_UP = new THREE.Matrix4().makeScale(0.62, 0.62, 0.62); // BO (49540)
/** Floater bottom piece (CV_Crys3), flipped. */
const FLOAT_DOWN = new THREE.Matrix4().makeRotationX(Math.PI).scale(new THREE.Vector3(0.372, 0.372, 0.372)); // VO (49541)
const FLOAT_TMP = new THREE.Matrix4(); // HO (49542)

/** Interaction spots: the Wellspring, the storage chest and the base sites (src/base/sites.ts). */
export type HubSpot = 'fountain' | 'stash' | SiteId;

interface Planted {
  p: THREE.Vector3;
  s: number;
}

export class Hub { // UO (49543)
  group = new THREE.Group();
  collider!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  vaultPad = new THREE.Vector3();
  spots = {
    fountain: new THREE.Vector3(),
    stash: new THREE.Vector3(0, -999, 0),
    ...Object.fromEntries(SITES.map((s) => [s.id, new THREE.Vector3()])),
  } as Record<HubSpot, THREE.Vector3>;
  /** MINEAR base: the site buildings. */
  siteViews: SiteView[] = [];
  get shopPos(): THREE.Vector3 {
    return this.spots.trade;
  }
  liftTop = new THREE.Vector3();
  liftBottomY = 3;
  smokeAnchors: THREE.Object3D[] = [];
  get smokeAnchor(): THREE.Object3D | null {
    return this.smokeAnchors[0] ?? null;
  }
  spiritTop = new THREE.Vector3();
  beamMat!: THREE.ShaderMaterial;
  time = 0;
  lamp!: THREE.PointLight;
  spiritLight!: THREE.PointLight;
  halo!: THREE.Sprite;
  stationLight!: THREE.PointLight;
  undersideMats: THREE.MeshStandardMaterial[] = [];
  undersideGlow = 1.2;
  portalY = 0;
  portalMat!: THREE.ShaderMaterial;
  gem: THREE.Object3D | null = null;
  gemBase = 0;
  crystals: { o: THREE.Object3D; y: number }[] = [];
  floatI: { up: THREE.InstancedMesh; down: THREE.InstancedMesh } | null = null;
  spirit: THREE.Object3D | null = null;
  spiritBase = 0;
  orbit: THREE.Object3D[] = [];
  water: SpiritWater | null = null;
  mats = new Map<string, THREE.MeshStandardMaterial>();
  flares = Object.fromEntries([`fountain`, `stash`, ...SITES.map((s) => s.id)].map((k) => [k, 0])) as Record<HubSpot, number>;
  stashLid: THREE.Object3D | null = null;
  stashAt: THREE.Vector3 | null = null;
  stashK = 0;
  stashWant = 0;
  flareColor = new THREE.Color(8384511);
  floatMat: CaveMaterial | null = null;
  spiritMat: CaveMaterial | null = null;
  shown = true;

  /** hubScene: the loadHub() scene (consumed: its meshes are merged or moved). kit: loadCaveKit() result. */
  constructor(hubScene: THREE.Object3D, kit: CaveKit | null = null) {
    const n = this.group;
    n.position.set(W.x, W.y, W.z);
    const colliders: THREE.BufferGeometry[] = []; // r
    const island = islandUnderside(21, 19, 4242, 72);
    const rocks = [island.geometry]; // a
    colliders.push(island.collider);
    const ip = island.geometry.getAttribute(`position`);
    let low = 0;
    for (let e = 0; e < ip.count; e++)
      if (Math.hypot(ip.getX(e), ip.getZ(e)) < 3 && ip.getY(e) < low) low = ip.getY(e);
    this.portalY = W.y + low - 0.6;
    n.add(this.undersideCrystals(island.geometry, kit));
    const cap = islandCap(21, HUB_GROUND_Y, 4242);
    const caps = [cap]; // l
    colliders.push(cap.clone());
    hubScene.position.set(0, HUB_GROUND_Y, 0);
    hubScene.updateMatrixWorld(true);
    const byName = new Map<string, THREE.Object3D>(); // u
    hubScene.traverse((e) => byName.set(e.name, e));
    const find = (name: string) => byName.get(name) ?? null; // d
    const worldPos = (o: THREE.Object3D, out = new THREE.Vector3()) => o.getWorldPosition(out); // f
    const animated =
      /^H2M_(VaultGem|LiftCrystal\d|StationCrystal\d|SpiritCrystal|SpiritOrbit|SpiritRunes|SpiritWater|SpiritWaterTop)$/; // p
    const baked: { hub: THREE.BufferGeometry[]; station: THREE.BufferGeometry[] } = { hub: [], station: [] }; // m
    const glowGroups = new Map<string, { mat: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[] }>(); // h
    const moved: THREE.Mesh[] = []; // g
    hubScene.traverse((e) => {
      const t = e as THREE.Mesh;
      if (!t.isMesh) return;
      const name = t.name;
      const colOnly = name.startsWith(`COL_`);
      if (colOnly || name.startsWith(`WALK_`)) {
        const g = t.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== `position`) g.deleteAttribute(k);
        g.applyMatrix4(t.matrixWorld);
        colliders.push(g.index ? g.toNonIndexed() : g);
      }
      if (colOnly) return;
      const mat = this.material(t.material as THREE.MeshStandardMaterial);
      if (animated.test(name)) {
        forceColor4(t.geometry);
        t.material = mat;
        moved.push(t);
        return;
      }
      const o = t.geometry.clone();
      o.applyMatrix4(t.matrixWorld);
      for (const k of Object.keys(o.attributes)) if (![`position`, `normal`, `color`].includes(k)) o.deleteAttribute(k);
      if (!o.getAttribute(`normal`)) o.computeVertexNormals();
      forceColor4(o);
      if (!HUB_GLOW_MATERIALS.has(mat.name) || mat.name === `H2_Interior`) {
        (name.includes(`Station`) ? baked.station : baked.hub).push(bakeLook(o, mat));
        return;
      }
      const key = (name.includes(`Station`) ? `station:` : ``) + mat.name;
      let group = glowGroups.get(key);
      if (!group) glowGroups.set(key, (group = { mat, geos: [] }));
      group.geos.push(o);
    });
    for (const [key, group] of glowGroups) {
      const merged = mergeGeometries(
        group.geos.map((g) => (g.index ? g.toNonIndexed() : g)),
        false,
      ) as THREE.BufferGeometry | null;
      if (!merged) {
        console.warn(`hub: could not merge`, key);
        continue;
      }
      const mesh = new THREE.Mesh(merged, group.mat);
      mesh.name = key;
      mesh.castShadow = !HUB_GLOW_MATERIALS.has(group.mat.name) || group.mat.name === `H2_Interior`;
      mesh.receiveShadow = true;
      mesh.layers.enable(key.startsWith(`station:`) ? CAPTURE_LAYER_DRESSING : CAPTURE_LAYER_HUB_DRESSING);
      n.add(mesh);
    }
    const surfaceMat = new THREE.MeshStandardMaterial(); // _
    stylizePerVertex(surfaceMat);
    for (const [key, geos] of Object.entries(baked)) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeHub(geos), surfaceMat);
      mesh.name = key === `station` ? `station:surfaces` : `surfaces`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.enable(key === `station` ? CAPTURE_LAYER_DRESSING : CAPTURE_LAYER_HUB_DRESSING);
      n.add(mesh);
    }
    for (const e of moved) {
      const p = e.getWorldPosition(new THREE.Vector3());
      const q = e.getWorldQuaternion(new THREE.Quaternion());
      e.removeFromParent();
      e.position.copy(p);
      e.quaternion.copy(q);
      e.castShadow = true;
      e.receiveShadow = true;
      e.layers.enable(e.name.includes(`Station`) ? CAPTURE_LAYER_DRESSING : CAPTURE_LAYER_HUB_DRESSING);
      n.add(e);
    }
    this.gem = byName.get(`H2M_VaultGem`) ?? null;
    this.gemBase = this.gem?.position.y ?? 0;
    for (let e = 0; e < 4; e++)
      for (const name of [`H2M_LiftCrystal${e}`, `H2M_StationCrystal${e}`]) {
        const o = byName.get(name);
        if (o) this.crystals.push({ o, y: o.position.y });
      }
    this.spirit = byName.get(`H2M_SpiritCrystal`) ?? null;
    this.spiritBase = this.spirit?.position.y ?? 0;
    if (kit?.CV_Crys2 && kit.CV_Crys3 && kit.CV_Crys1) this.restyleCrystals(kit, n);
    for (const name of [`H2M_SpiritOrbit`, `H2M_SpiritRunes`]) {
      const o = byName.get(name);
      if (o) this.orbit.push(o);
    }
    const waterCenter = new THREE.Vector3(); // v
    const waterMesh = byName.get(`H2M_SpiritWater`) as THREE.Mesh | undefined; // y
    if (waterMesh) waterMesh.geometry.computeBoundingBox();
    if (waterMesh) waterMesh.geometry.boundingBox!.getCenter(waterCenter).applyMatrix4(waterMesh.matrixWorld).add(n.position);
    this.water = spiritWaterMaterial(waterCenter);
    for (const name of [`H2M_SpiritWater`, `H2M_SpiritWaterTop`]) {
      const o = byName.get(name) as THREE.Mesh | undefined;
      if (o) {
        o.material = this.water.m;
        o.castShadow = false;
      }
    }
    const spotAt = (name: string, out: THREE.Vector3) => { // b
      const o = find(name);
      if (o) worldPos(o, out).add(n.position);
      return out;
    };
    spotAt(`H2M_PadCenter`, this.vaultPad);
    spotAt(`H2M_TradeFront`, this.spots.trade);
    spotAt(`H2M_FountainFront`, this.spots.fountain);
    for (const name of [`H2M_Smoke_TP`]) {
      const o = find(name);
      if (o) {
        const anchor = new THREE.Object3D();
        worldPos(o, anchor.position);
        n.add(anchor);
        this.smokeAnchors.push(anchor);
      }
    }
    // MINEAR base: the site buildings, their spots, colliders and chimney smoke (the Trade Post is the
    // original house above, so it keeps its own spot)
    const siteMat = siteMaterial();
    for (const def of SITES) {
      if (def.legacy) continue;
      const view = new SiteView(def, HUB_GROUND_Y, siteMat);
      this.siteViews.push(view);
      n.add(view.group);
      colliders.push(...view.cols);
      const f = siteFront(def);
      this.spots[def.id].set(W.x + f.x, W.y + HUB_GROUND_Y - 0.35, W.z + f.z);
      for (const v of view.smoke) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(v);
        n.add(anchor);
        this.smokeAnchors.push(anchor);
      }
    }
    if (this.spirit) this.spiritTop.copy(this.spirit.position).add(n.position);
    this.liftTop.set(W.x, W.y + HUB_GROUND_Y + 0.25, W.z);
    this.lamp = new THREE.PointLight(16761466, 0, 16, 1.5);
    this.lamp.position.set(0, 3.5, 0);
    this.spiritLight = new THREE.PointLight(8384511, 0, 11, 1.4);
    if (this.spirit) this.spiritLight.position.copy(this.spirit.position);
    this.stationLight = new THREE.PointLight(9431295, 0, 18, 1.3);
    this.stationLight.position.set(0, 3 - W.y + 2.6, 0);
    n.add(this.lamp, this.spiritLight, this.stationLight);
    const canvas = document.createElement(`canvas`);
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext(`2d`)!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, `rgba(255,255,255,1)`);
    grad.addColorStop(0.25, `rgba(255,255,255,0.45)`);
    grad.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        color: 8384511,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.3,
      }),
    );
    this.halo.scale.setScalar(3.2);
    if (this.spirit) this.halo.position.copy(this.spirit.position);
    this.halo.renderOrder = 6;
    n.add(this.halo);

    // trees and bushes on the town and the satellite islands (49747-49848)
    const rand = seededRandom(8); // w
    const crownMat = createLeafMaterial(); // T
    const crownDepth = createLeafDepthMaterial(); // E
    const trunkMat = createPropMaterial(); // D
    const trees: Planted[] = []; // O
    const bushes: Planted[] = []; // ee
    // MINEAR base: no tree or bush inside a site's footprint
    const onSite = (p: THREE.Vector3) =>
      SITES.some((d) => {
        if (d.legacy) return false;
        const c = sitePlace(d);
        return Math.hypot(p.x - c.x, p.z - c.z) < Math.max(d.w, d.d) / 2 + 1.2;
      });
    for (const [name, o] of byName)
      if (/^H2M_Tree\d+$/.test(name)) {
        const p = worldPos(o);
        if (!onSite(p)) trees.push({ p, s: o.userData.scale ?? 1 });
      } else if (/^H2M_Bush\d+$/.test(name)) {
        const p = worldPos(o);
        if (!onSite(p)) bushes.push({ p, s: o.userData.scale ?? 1 });
      }
    const treeKinds: VegetationRecipe[] = [oakRecipe(41, true), oakRecipe(57), pineRecipe(23)]; // k
    const treesByKind: Planted[][] = [[], [], []]; // te
    trees.forEach((e, t) => treesByKind[(t * 7 + 3) % 5 < 2 ? 2 : t % 2].push(e));
    // satellite islands: [angle in degrees, distance, y, radius] (ne); the list is in src/hub/satellites.ts
    const satellites = SATELLITES;
    const hasTree = (i: number) => satellites[i][3] > 3.3; // re
    const treeMeshes: { trunk: THREE.InstancedMesh; crown: THREE.InstancedMesh }[] = []; // A
    const bushMeshes: THREE.InstancedMesh[] = []; // ie
    const m4 = new THREE.Matrix4(); // j
    treeKinds.forEach((kind, t) => {
      const list = treesByKind[t];
      const extra = t === 1 ? satellites.filter((_, i) => hasTree(i)).length : 0;
      if (!list.length && !extra) return;
      const trunk = new THREE.InstancedMesh(kind.trunk as THREE.BufferGeometry, trunkMat, list.length + extra);
      const crown = new THREE.InstancedMesh(kind.crown, crownMat, list.length + extra);
      trunk.count = crown.count = list.length;
      treeMeshes[t] = { trunk, crown };
      crown.customDepthMaterial = crownDepth;
      list.forEach((e, i) => {
        const s = e.s * (t === 2 ? 0.95 : 1.05);
        m4.compose(
          e.p.clone().setY(0.45),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)),
          new THREE.Vector3(s, s, s),
        );
        trunk.setMatrixAt(i, m4);
        crown.setMatrixAt(i, m4);
      });
      for (const mesh of [trunk, crown]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.layers.enable(CAPTURE_LAYER_HUB_DRESSING);
        n.add(mesh);
      }
    });
    [bushRecipe(42, true), bushRecipe(43), bushRecipe(47, true)].forEach((kind, t) => {
      const list = bushes.filter((_, i) => i % 3 === t);
      const extra = satellites.filter((_, i) => !hasTree(i) && i % 3 === t).length;
      if (!list.length && !extra) return;
      const crown = new THREE.InstancedMesh(kind.crown, crownMat, list.length + extra);
      crown.count = list.length;
      bushMeshes[t] = crown;
      crown.customDepthMaterial = crownDepth;
      list.forEach((e, i) => {
        m4.compose(
          e.p.clone().setY(0.45),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)),
          new THREE.Vector3(e.s, e.s * 0.9, e.s),
        );
        crown.setMatrixAt(i, m4);
      });
      crown.castShadow = true;
      crown.receiveShadow = true;
      n.add(crown);
    });
    const place = new THREE.Matrix4(); // ae
    const plant = new THREE.Matrix4(); // oe
    const placer = new THREE.Object3D(); // se
    const append = (mesh: THREE.InstancedMesh | undefined, m: THREE.Matrix4) => { // ce
      if (mesh) {
        mesh.setMatrixAt(mesh.count, m);
        mesh.count++;
      }
    };
    satellites.forEach(([angle, dist, y, radius], o) => {
      const s = THREE.MathUtils.degToRad(angle);
      const rock = islandUnderside(radius, radius * 1.35, 900 + o, 40);
      const top = islandCap(radius, 0.25, 900 + o, 0.12);
      const tree = hasTree(o);
      if (tree) {
        const k = 0.5 + rand() * 0.12;
        plant.makeScale(k, k, k).setPosition((rand() - 0.5) * radius * 0.4, 0.3, (rand() - 0.5) * radius * 0.4);
        rand();
        rand();
      } else {
        rand();
        const k = 0.6 + rand() * 0.3;
        const a = rand() * Math.PI * 2;
        const r = radius * (0.35 + rand() * 0.3);
        plant.makeScale(k, k, k).setPosition(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      }
      placer.position.set(Math.cos(s) * dist, y, -Math.sin(s) * dist);
      placer.rotation.y = rand() * Math.PI * 2;
      placer.updateMatrix();
      place.copy(placer.matrix);
      rocks.push(rock.geometry.applyMatrix4(place));
      caps.push(top.clone().applyMatrix4(place));
      plant.premultiply(place);
      // MINEAR: an island with a merchant gets the merchant's stall instead of its tree or bush
      if (MERCHANT_ISLANDS.has(o)) {
        /* no plant */
      } else if (tree) {
        append(treeMeshes[1]?.trunk, plant);
        append(treeMeshes[1]?.crown, plant);
      } else append(bushMeshes[o % 3], plant);
      colliders.push(rock.collider.clone().applyMatrix4(place), top.clone().applyMatrix4(place));
    });
    const rockMesh = new THREE.Mesh(mergeHub(rocks), islandRockMaterial()); // le
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    const capMesh = new THREE.Mesh(mergeHub(caps), makePaintableGround(new THREE.MeshLambertMaterial({ vertexColors: true }))); // ue
    capMesh.receiveShadow = true;
    capMesh.layers.enable(CAPTURE_LAYER_HUB_CAPS);
    n.add(rockMesh, capMesh);

    // lift beam, portal disc and ring (49855-49920)
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(8381439) } },
      vertexShader: `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float core = pow(1.0 - rim, 2.0);
          float bands = 0.55 + 0.45 * sin(vUv.y * 60.0 - uTime * 5.0);
          float ends = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          float a = (0.05 + 0.13 * core * bands) * ends;
          gl_FragColor = vec4(uColor * (0.9 + core * 0.6), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beamH = this.portalY - 3; // de
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(LIFT_RADIUS, LIFT_RADIUS, beamH, 32, 1, true), this.beamMat);
    beam.position.set(0, 3 - W.y + beamH / 2, 0);
    beam.renderOrder = 5;
    n.add(beam);
    this.portalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(8381439) } },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);
          float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 11.0 - uTime * 2.2);
          float swirl2 = 0.5 + 0.5 * sin(a * 3.0 - r * 7.0 - uTime * 1.3);
          float core = 1.0 - smoothstep(0.0, 1.0, r);
          float rim = smoothstep(0.72, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
          vec3 deep = uColor * 0.35;
          vec3 c = mix(deep, uColor, 0.35 + 0.45 * swirl * (0.6 + 0.4 * swirl2));
          c = mix(c, vec3(1.0), core * core * 0.55) + uColor * rim * 1.6;
          gl_FragColor = vec4(c * 1.4, 0.92 * (1.0 - smoothstep(0.96, 1.0, r)));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const portal = new THREE.Mesh(new THREE.CircleGeometry(LIFT_RADIUS + 0.7, 48), this.portalMat); // pe
    portal.rotation.x = Math.PI / 2;
    portal.position.set(0, this.portalY - W.y, 0);
    portal.renderOrder = 6;
    const ring = new THREE.Mesh( // me
      new THREE.TorusGeometry(LIFT_RADIUS + 0.75, 0.16, 8, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(10481919).multiplyScalar(2.4) }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(portal.position);
    n.add(portal, ring);

    // one position-only collider in world space with a BVH (49921-49932)
    const merged = mergeGeometries(
      colliders.map((e) => {
        const t = e.index ? e.toNonIndexed() : e;
        for (const k of Object.keys(t.attributes)) if (k !== `position`) t.deleteAttribute(k);
        return t;
      }),
    );
    merged.translate(W.x, W.y, W.z);
    merged.computeBoundingBox();
    merged.computeBoundsTree();
    this.collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.updateMatrixWorld(true);
  }

  /** Glowing crystal clusters under the island; uses the cave kit crystals when the kit loaded. */
  undersideCrystals(geo: THREE.BufferGeometry, kit: CaveKit | null): THREE.Group { // (49934)
    if (kit?.CV_Crys1) return this.kitCrystals(geo, kit);
    const pos = geo.getAttribute(`position`);
    const nor = geo.getAttribute(`normal`);
    const rand = seededRandom(77);
    const shape = mergeGeometries([
      new THREE.CylinderGeometry(0.85, 1, 0.6, 6, 1).translate(0, 0.3, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.85, 0.5, 6).translate(0, 0.85, 0).toNonIndexed(),
    ]);
    shape.deleteAttribute(`uv`);
    shape.computeVertexNormals();
    const mats = [
      new THREE.MeshStandardMaterial({
        color: 11203839,
        emissive: 5232895,
        emissiveIntensity: 1.3,
        roughness: 0.25,
        flatShading: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 14468351,
        emissive: 10120191,
        emissiveIntensity: 1.25,
        roughness: 0.25,
        flatShading: true,
      }),
    ];
    const lists: THREE.Matrix4[][] = [[], []];
    const c = new THREE.Vector3();
    const l = new THREE.Vector3();
    const u = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let clusters = 0;
    for (let tries = 0; tries < 6e3 && clusters < 34; tries++) {
      const e = Math.floor(rand() * pos.count);
      c.fromBufferAttribute(pos, e);
      l.fromBufferAttribute(nor, e);
      if (c.y > -5.5 || c.y < -16.5 || Math.hypot(c.x, c.z) < 5.5 || l.y > -0.35) continue;
      clusters++;
      const kind = rand() < 0.62 ? 0 : 1;
      const count = 3 + Math.floor(rand() * 3);
      for (let e = 0; e < count; e++) {
        u.copy(l)
          .add(new THREE.Vector3((rand() - 0.5) * 0.9, (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.9))
          .normalize();
        if (u.y > -0.1) u.y = -0.1 - rand() * 0.3;
        u.normalize();
        q.setFromUnitVectors(up, u);
        const len = (e === 0 ? 2.4 : 1) + rand() * 1.6;
        const w = len * (0.16 + rand() * 0.06);
        scale.set(w, len, w);
        const at = c
          .clone()
          .addScaledVector(l, -0.15)
          .add(new THREE.Vector3((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7));
        lists[kind].push(new THREE.Matrix4().compose(at, q, scale));
      }
    }
    const group = new THREE.Group();
    lists.forEach((list, t) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(shape, mats[t], list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      group.add(mesh);
    });
    this.undersideMats = mats;
    return group;
  }

  /** Underside crystals from the cave kit (CV_Crys1..4), with per-instance colour, plus 7 rim crystals. */
  kitCrystals(geo: THREE.BufferGeometry, kit: CaveKit): THREE.Group { // (50008)
    const pos = geo.getAttribute(`position`);
    const nor = geo.getAttribute(`normal`);
    const rand = seededRandom(77);
    const shapes = [`CV_Crys1`, `CV_Crys2`, `CV_Crys3`, `CV_Crys4`].map((name) => kit[name]);
    const lists: { m: THREE.Matrix4; c: THREE.Color }[][] = shapes.map(() => []);
    const colors = [new THREE.Color(3588095), new THREE.Color(9726207)];
    const c = new THREE.Vector3();
    const l = new THREE.Vector3();
    const u = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const add = (at: THREE.Vector3, dir: THREE.Vector3, size: number) => {
      const q = new THREE.Quaternion()
        .setFromUnitVectors(up, dir)
        .multiply(new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2));
      const s = new THREE.Vector3(size, size * (0.9 + rand() * 0.4), size);
      const col = colors[rand() < 0.6 ? 0 : 1].clone().multiplyScalar(0.85 + rand() * 0.3);
      lists[Math.floor(rand() * shapes.length)].push({ m: new THREE.Matrix4().compose(at, q, s), c: col });
    };
    let clusters = 0;
    for (let tries = 0; tries < 6e3 && clusters < 22; tries++) {
      const e = Math.floor(rand() * pos.count);
      c.fromBufferAttribute(pos, e);
      l.fromBufferAttribute(nor, e);
      if (!(c.y > -5.5 || c.y < -16.5 || Math.hypot(c.x, c.z) < 6 || l.y > -0.35)) {
        clusters++;
        u.copy(l).lerp(down, 0.5).normalize();
        add(c.clone().addScaledVector(l, -0.5), u.clone(), 2.2 + rand() * 2.4);
      }
    }
    const rim: (THREE.Vector3 | null)[] = Array(7).fill(null);
    for (let e = 0; e < pos.count; e++) {
      c.fromBufferAttribute(pos, e);
      const r = Math.hypot(c.x, c.z);
      if (r < 3.2 + 1.6 || r > 7.7) continue;
      const slot = Math.floor(((Math.atan2(c.z, c.x) / (Math.PI * 2) + 1) % 1) * 7);
      if (!rim[slot] || c.y < rim[slot]!.y) rim[slot] = c.clone();
    }
    for (const e of rim)
      if (e) {
        u.set(e.x, 0, e.z).normalize().multiplyScalar(0.55).add(down).normalize();
        add(e.clone().setY(e.y + 0.3), u.clone(), 1.5 + rand() * 1);
      }
    const group = new THREE.Group();
    const mat = caveCrystalMaterial(1.2);
    lists.forEach((list, t) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(shapes[t], mat, list.length);
      list.forEach((e, i) => {
        mesh.setMatrixAt(i, e.m);
        mesh.setColorAt(i, e.c);
      });
      group.add(mesh);
    });
    this.undersideMats = [mat];
    this.undersideGlow = 0.85;
    return group;
  }

  /** Replaces the GLB lift/station crystals with instanced kit floaters and the spirit crystal with kit pieces. */
  restyleCrystals(kit: CaveKit, group: THREE.Object3D): void { // (50066)
    const build = (mat: THREE.Material, top: string, bottom: string, scale: number) => {
      const g = new THREE.Group();
      const a = new THREE.Mesh(kit[top], mat);
      a.scale.setScalar(scale);
      const b = new THREE.Mesh(kit[bottom], mat);
      b.scale.setScalar(scale * 0.6);
      b.rotation.x = Math.PI;
      for (const m of [a, b]) m.castShadow = true;
      g.add(a, b);
      return g;
    };
    const swap = (old: THREE.Object3D, next: THREE.Object3D) => {
      next.name = old.name;
      next.position.copy(old.position);
      next.quaternion.copy(old.quaternion);
      group.remove(old);
      group.add(next);
      return next;
    };
    this.floatMat = caveCrystalMaterial(0.9);
    this.floatMat.userData.tint.value.setHex(6283519);
    const count = this.crystals.length;
    if (count) {
      const up = new THREE.InstancedMesh(kit.CV_Crys2, this.floatMat, count);
      const down = new THREE.InstancedMesh(kit.CV_Crys3, this.floatMat, count);
      const white = new THREE.Color(1, 1, 1);
      for (const mesh of [up, down]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
        mesh.castShadow = false;
        group.add(mesh);
      }
      this.floatI = { up, down };
      for (const e of this.crystals) {
        const o = new THREE.Object3D();
        o.name = e.o.name;
        o.position.copy(e.o.position);
        o.quaternion.copy(e.o.quaternion);
        group.remove(e.o);
        e.o = o;
        e.y = o.position.y;
      }
      this.placeFloaters();
      for (const mesh of [up, down]) {
        mesh.computeBoundingSphere();
        mesh.boundingSphere!.radius += 0.5;
      }
    }
    if (this.spirit) {
      this.spiritMat = caveCrystalMaterial(1);
      this.spiritMat.userData.tint.value.setHex(8384511);
      this.spirit = swap(this.spirit, build(this.spiritMat, `CV_Crys1`, `CV_Crys3`, 0.95));
      this.spiritBase = this.spirit.position.y;
    }
  }

  /** Writes the floater instance matrices from the crystal nodes. */
  placeFloaters(): void { // (50114)
    const f = this.floatI;
    if (!f) return;
    this.crystals.forEach((t, i) => {
      t.o.updateMatrix();
      f.up.setMatrixAt(i, FLOAT_TMP.multiplyMatrices(t.o.matrix, FLOAT_UP));
      f.down.setMatrixAt(i, FLOAT_TMP.multiplyMatrices(t.o.matrix, FLOAT_DOWN));
    });
    f.up.instanceMatrix.needsUpdate = true;
    f.down.instanceMatrix.needsUpdate = true;
  }

  /** One clone per material name, with vertex colours; non-glow materials get the grain stylize. */
  material(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial { // (50125)
    const name = src.name || `H2_Unnamed`;
    let m = this.mats.get(name);
    if (m) return m;
    m = src.clone();
    m.name = name;
    m.vertexColors = true;
    if (HUB_GLOW_MATERIALS.has(name)) {
      if (name === `H2_Window`) m.userData.baseGlow = m.emissiveIntensity;
    } else stylizeMaterial(m, HUB_GRAIN[name] ?? 0.06);
    this.mats.set(name, m);
    return m;
  }

  /** True inside the lift column under the island (the lift pulls the player up). */
  inLiftColumn(p: { x: number; y: number; z: number }): boolean { // (50140)
    return Math.hypot(p.x - W.x, p.z - W.z) < 3.2 && p.y < W.y + HUB_GROUND_Y - 0.2 && p.y > 2;
  }

  /** Places the gold chest model (chests.modelOf(2)) on the island as the stash. */
  addStash(model: THREE.Object3D | null | undefined): void { // (50143)
    if (!model) return;
    const x = W.x + STASH_AT.x; // MINEAR base: was (-6.6, 0.4), now between the Farm and the Diner
    const z = W.z + STASH_AT.z;
    const hit = new THREE.Raycaster(new THREE.Vector3(x, W.y + 20, z), new THREE.Vector3(0, -1, 0), 0, 40).intersectObject(
      this.collider,
      false,
    )[0];
    const y = hit ? hit.point.y : W.y + 0.7;
    const holder = new THREE.Group();
    model.position.set(0, 0, 0);
    holder.add(model);
    holder.scale.setScalar(1.45);
    holder.position.set(x, y - 0.02, z).sub(this.group.position);
    holder.rotation.y = Math.atan2(-STASH_AT.x, -STASH_AT.z); // faces the lift
    this.group.add(holder);
    holder.updateMatrixWorld(true);
    this.stashLid = model.getObjectByName(`CH_Gold_Lid`) ?? null;
    const k = 1 - 1.9 / Math.hypot(STASH_AT.x, STASH_AT.z); // the spot: 1.9 m toward the lift
    this.spots.stash.set(W.x + STASH_AT.x * k, y, W.z + STASH_AT.z * k);
    this.stashAt = new THREE.Vector3(x, y, z);
  }

  /** Pushes a body (pos, vel) out of the stash chest footprint. */
  pushOutStash(pos: THREE.Vector3, vel: THREE.Vector3): void { // (50164)
    const at = this.stashAt;
    if (!at || pos.y > at.y + 1.3 || pos.y < at.y - 1.5) return;
    const dx = pos.x - at.x;
    const dz = pos.z - at.z;
    const R = 1.25;
    const d = Math.hypot(dx, dz);
    if (d >= R || d < 1e-4) return;
    pos.x = at.x + (dx / d) * R;
    pos.z = at.z + (dz / d) * R;
    const s = (vel.x * dx + vel.z * dz) / d;
    if (s < 0) {
      vel.x -= (s * dx) / d;
      vel.z -= (s * dz) / d;
    }
  }

  /** MINEAR base: pushes a body out of the standing site machines (the Capsule Machine once open). */
  pushOutSites(pos: THREE.Vector3, vel: THREE.Vector3): void {
    if (pos.y > W.y + 6 || pos.y < W.y - 3) return;
    for (const s of this.siteViews) {
      const b = s.blocker;
      if (!b) continue;
      const dx = pos.x - (W.x + b.x);
      const dz = pos.z - (W.z + b.z);
      const d = Math.hypot(dx, dz);
      if (d >= b.r + 0.42 || d < 1e-4) continue;
      const R = b.r + 0.42;
      pos.x = W.x + b.x + (dx / d) * R;
      pos.z = W.z + b.z + (dz / d) * R;
      const v = (vel.x * dx + vel.z * dz) / d;
      if (v < 0) {
        vel.x -= (v * dx) / d;
        vel.z -= (v * dz) / d;
      }
    }
  }

  setStashOpen(open: boolean): void { // (50176)
    this.stashWant = +!!open;
  }

  /** The nearest interaction spot within r (and 2.5 m in height), or null. */
  near(p: { x: number; y: number; z: number }, r = 2.6): HubSpot | null { // (50179)
    let best: HubSpot | null = null;
    let bestD = r;
    for (const key of Object.keys(this.spots) as HubSpot[]) {
      const s = this.spots[key];
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < bestD && Math.abs(p.y - s.y) < 2.5) {
        bestD = d;
        best = key;
      }
    }
    return best;
  }

  /** Flares a spot (decays at 0.8 per second); the fountain flare takes a colour (default 0x7FEFFF). */
  flare(spot: HubSpot, k = 1, color?: number): void { // (50189)
    this.flares[spot] = Math.max(this.flares[spot], k);
    if (spot === `fountain`) this.flareColor.setHex(color ?? 8384511);
  }

  /** Shows or hides every child of the group except the lights. */
  setShown(shown: boolean): void { // (50194)
    if (this.shown === shown) return;
    this.shown = shown;
    for (const c of this.group.children) if (!(c as THREE.Light).isLight) c.visible = shown;
  }

  /** dt; under = underground fade (0 on the surface, 1 deep); night = env.clock.night. */
  /** MINEAR base: shows each site's status (locked, opening soon, open) from the player's progress. */
  setSiteStatus(v: UnlockView): void {
    for (const s of this.siteViews) s.setStatus(siteStatus(s.def, v));
  }

  update(dt: number, under: number, night = 0): void { // (50200)
    this.time += dt;
    for (const s of this.siteViews) s.update(dt);
    const r = this.time;
    for (const key of Object.keys(this.flares) as HubSpot[]) this.flares[key] = Math.max(0, this.flares[key] - dt * 0.8);
    const f = this.flares;
    if (this.stashLid) {
      this.stashK += (this.stashWant - this.stashK) * Math.min(1, dt * (this.stashWant ? 7 : 5));
      this.stashLid.rotation.x = -1.7 * this.stashK + Math.sin(r * 9) * 0.02 * f.stash;
    }
    if (this.gem) {
      this.gem.rotation.y += dt * (1.1 + f.trade * 8);
      this.gem.position.y = this.gemBase + Math.sin(r * 2) * 0.12 + f.trade * 0.4;
    }
    this.crystals.forEach((t, i) => {
      t.o.rotation.y += dt * 1.6;
      t.o.position.y = t.y + Math.sin(r * 2.4 + i * 1.7) * 0.08;
    });
    if (this.shown) this.placeFloaters();
    if (this.spirit) {
      this.spirit.rotation.y += dt * (0.5 + f.fountain * 5);
      this.spirit.position.y = this.spiritBase + Math.sin(r * 1.3) * 0.15 + f.fountain * 0.35;
      this.halo.position.copy(this.spirit.position);
      const hm = this.halo.material;
      hm.opacity = (0.22 + 0.08 * Math.sin(r * 1.3) + f.fountain * 0.5 + night * 0.12) * (1 - under);
      this.halo.scale.setScalar(3.2 + f.fountain * 2.5 + Math.sin(r * 1.3) * 0.2);
    }
    this.orbit.forEach((t) => (t.rotation.y -= dt * (0.35 + f.fountain * 2.5) * 1));
    if (this.water) {
      this.water.u.uTime.value = r;
      this.water.u.uPulse.value = f.fountain;
    }
    this.beamMat.uniforms.uTime.value = r;
    this.portalMat.uniforms.uTime.value = r;
    const a = 1 - under;
    this.lamp.intensity = 5 * a * (0.5 + night * 1.5);
    this.spiritLight.intensity = (2.2 + night * 2 + f.fountain * 10) * (0.85 + 0.15 * Math.sin(r * 1.3)) * a;
    this.spiritLight.color.setHex(8384511).lerp(this.flareColor, Math.min(1, f.fountain));
    this.halo.material.color.copy(this.spiritLight.color);
    const crystal = this.mats.get(`H2_Crystal`);
    if (crystal) crystal.emissiveIntensity = 1.3 + f.fountain * 2.5 + Math.sin(r * 1.3) * 0.15;
    if (this.floatMat) this.floatMat.emissiveIntensity = 0.85 + f.fountain * 1.2 + Math.sin(r * 1.3) * 0.1;
    if (this.spiritMat) {
      this.spiritMat.emissiveIntensity = 1 + f.fountain * 2.2 + Math.sin(r * 1.3) * 0.12;
      this.spiritMat.userData.tint.value.setHex(8384511).lerp(this.flareColor, Math.min(1, f.fountain));
    }
    const pad = this.mats.get(`H2_PadGlow`);
    if (pad) pad.emissiveIntensity = 0.9 + Math.sin(r * 3) * 0.25 + f.trade * 2;
    this.stationLight.intensity = (2.2 + night * 3) * (0.9 + 0.1 * Math.sin(r * 2.2));
    for (const m of this.undersideMats) m.emissiveIntensity = this.undersideGlow + night * 0.45 + Math.sin(r * 0.9) * 0.07;
    const lift = this.mats.get(`H2_LiftGlow`);
    if (lift) lift.emissiveIntensity = 0.5 + Math.sin(r * 2.2) * 0.12;
    const win = this.mats.get(`H2_Window`);
    if (win) win.emissiveIntensity = (win.userData.baseGlow ?? 1.4) * (0.55 + night * 1.2);
  }
}
