// Port of play-inUT-NSi.js 51902-52275: atmosphere / environment manager (bA). Owns the sky dome,
// hemisphere light, cascaded SunLight (sun by day, moon by night), day clock, fog values in the shared
// atmosphere uniforms (ATMO), weather inputs (cover, overcast, storm, mist, flash), the underground
// blend, exposure, cloud children, the masked far-terrain plane and the ring of distant scenery.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMO } from '../render/atmosphere';
import { createTerrainMaterial } from '../render/terrainMaterial';
import { seededRandom } from '../world/rng';
import { Simplex } from '../world/simplex';
import { MATERIALS, Mat } from '../world/materials';
import { surfaceHeight } from '../world/generate'; // Gv (33583)
import { IS_TOUCH } from '../game/device'; // J (45509)
import { DayClock, sampleSkyLook } from './dayClock';
import { SkyDome } from './skyDome';
import { SunLight } from './sunShadow';

/** Far-terrain mask grid size in chunks. */
export const MASK_GRID = 19; // cA (51902)

const caveColor = new THREE.Color(0x221c38); // lA (51903): cave fog/sky colour, rebuilt per frame
const CAVE_SHALLOW = new THREE.Color(0x2e2431); // uA (51904)
const CAVE_MID = new THREE.Color(0x15313b); // dA (51905): depth 12-60
const CAVE_DEEP = new THREE.Color(0x261b44); // fA (51906): depth 60-140
const CAVE_SKY_AMB = [new THREE.Color(0xa294a6), new THREE.Color(0x86b8c6), new THREE.Color(0xa08ee0)]; // pA (51907)
const CAVE_GROUND_AMB = [new THREE.Color(0x3d2e34), new THREE.Color(0x1d3a42), new THREE.Color(0x2e2150)]; // mA (51908)
const murkColor = new THREE.Color(); // hA (51909): forced-underground (murk) colour, rebuilt per frame
const MURK_DEEP = new THREE.Color(0x1d1535); // gA (51910)
const MOON_COLOR = new THREE.Color(0x9fb6ff); // _A (51911)
const _tmpA = new THREE.Color(); // vA (51912)
const _tmpB = new THREE.Color(); // yA (51913)

/** Biome air (the biomes manager's air() entry): tints the cave light and fog. */
export interface BiomeAir {
  fog: THREE.Color;
  haze: number;
  clear: number;
  sky: THREE.Color;
  ground: THREE.Color;
  amb: number;
}

type FarMaterial = ReturnType<typeof createTerrainMaterial>;

export class Environment { // bA (51914)
  scene: THREE.Scene;
  clock = new DayClock();
  skyDome = new SkyDome();
  sky: THREE.Mesh;
  look = sampleSkyLook(0.3);
  sun: SunLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  /** Children drift along x by `userData.speed`. */
  clouds = new THREE.Group();
  far: THREE.Mesh<THREE.PlaneGeometry, FarMaterial>;
  farMat: FarMaterial;
  farUniforms = {
    uPlayer: { value: new THREE.Vector2() },
    uMask: { value: null as THREE.DataTexture | null },
    uMaskOrigin: { value: new THREE.Vector2() },
  };
  maskData = new Uint8Array(MASK_GRID * MASK_GRID * 4);
  maskTex = new THREE.DataTexture(this.maskData, MASK_GRID, MASK_GRID, THREE.RGBAFormat);
  underground = 0;
  biomeAir: BiomeAir | null = null;
  biomeK = 0;
  cover = 0.42;
  overcast = 0;
  storm = 0;
  mist = 0;
  flash = 0;
  exposure = 1;
  time = 0;
  scenery = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.Fog(0xffffff, 1, 1000);
    scene.fog = this.fog;
    scene.background = null;
    this.sky = this.skyDome.mesh;
    scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8666, 1.15);
    scene.add(this.hemi);
    this.sun = new SunLight(0xfff0d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -4e-4;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 1.5;
    scene.add(this.sun);
    scene.add(this.clouds);
    this.farMat = createTerrainMaterial();
    const baseCompile = this.farMat.onBeforeCompile;
    this.farMat.onBeforeCompile = (shader, renderer) => {
      baseCompile.call(this.farMat, shader, renderer);
      shader.uniforms.uPlayer = this.farUniforms.uPlayer;
      shader.uniforms.uMask = this.farUniforms.uMask;
      shader.uniforms.uMaskOrigin = this.farUniforms.uMaskOrigin;
      shader.vertexShader = shader.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
varying vec3 vWorldP;`,
        )
        .replace(
          `#include <worldpos_vertex>`,
          `#include <worldpos_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          `#include <common>`,
          `#include <common>
          varying vec3 vWorldP;
          uniform vec2 uPlayer;
          uniform sampler2D uMask;
          uniform vec2 uMaskOrigin;
          // 1 where this spot's column of real terrain is streamed in
          float farMasked(vec2 cell) {
            if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= ${MASK_GRID.toFixed(1)} || cell.y >= ${MASK_GRID.toFixed(1)}) return 0.0;
            return step(0.5, texture2D(uMask, (floor(cell) + 0.5) / ${MASK_GRID.toFixed(1)}).r);
          }`,
        )
        .replace(
          `#include <clipping_planes_fragment>`,
          `#include <clipping_planes_fragment>
          {
            vec2 cell = (vWorldP.xz - uMaskOrigin) / ${(16).toFixed(1)};
            const float M = ${(3.5 / 16).toFixed(3)};
            if (farMasked(cell + vec2(-M, -M)) * farMasked(cell + vec2(M, -M)) * farMasked(cell + vec2(-M, M)) * farMasked(cell + vec2(M, M)) > 0.5) discard;
          }`,
        );
    };
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.NearestFilter;
    this.farUniforms.uMask.value = this.maskTex;
    this.far = this.buildFarTerrain(0, 0);
    scene.add(this.far);
    this.buildScenery();
    scene.add(this.scenery);
  }

  /** Distant mountains, hills and rock pillars, merged into one vertex-coloured mesh. */
  buildScenery() {
    const rand = seededRandom(2024);
    const noise = new Simplex(77);
    const geos: THREE.BufferGeometry[] = [];
    const grassA = new THREE.Color(0x4f8f45);
    const grassB = new THREE.Color(0x6aa84c);
    const rockA = new THREE.Color(0x8d96ad);
    const rockB = new THREE.Color(0x6f7890);
    const snow = new THREE.Color(0xf1f4fa);
    const col = new THREE.Color();
    // l (52022): a noisy cone ("disc rings") at (cx, cz)
    const addMound = (cx: number, cz: number, radius: number, height: number, seed: number, snowy: boolean) => {
      const rings = IS_TOUCH ? 9 : 18;
      const segs = IS_TOUCH ? 28 : 56;
      const pos: number[] = [];
      const index: number[] = [];
      for (let n = 0; n <= rings; n++) {
        const r = (n / rings) * radius;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          const k = r / radius;
          const ridge = 1 - Math.abs(noise.noise3(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, k * 2.2));
          const warp = noise.noise3(x * 0.012 + seed, z * 0.012, 3.3) * 0.12;
          let y = height * Math.max(0, 1 - k) ** 1.35 * (0.72 + ridge * 0.42 + warp);
          if (n === rings) y = -12;
          pos.push(cx + x, y - 10, cz + z);
        }
      }
      for (let e = 0; e < rings; e++)
        for (let t = 0; t < segs; t++) {
          const a = e * segs + t;
          const b = e * segs + ((t + 1) % segs);
          const c = (e + 1) * segs + t;
          const d = (e + 1) * segs + ((t + 1) % segs);
          index.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const normal = geo.getAttribute('normal');
      const colors = new Float32Array(pos.length);
      for (let e = 0; e < pos.length / 3; e++) {
        const h = pos[e * 3 + 1] + 10;
        const hk = h / height;
        const ny = normal.getY(e);
        const jitter = noise.noise3(pos[e * 3] * 0.02, h * 0.02, pos[e * 3 + 2] * 0.02) * 0.08;
        if (snowy && hk + jitter > 0.66 && ny > 0.35) col.copy(snow);
        else if (hk + jitter < 0.22 || (ny > 0.82 && hk < 0.5))
          col.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(ny - 0.6, 0, 1));
        else col.copy(rockA).lerp(rockB, THREE.MathUtils.clamp(0.9 - ny, 0, 1));
        colors[e * 3] = col.r;
        colors[e * 3 + 1] = col.g;
        colors[e * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(geo);
    };
    // mountains
    for (let t = 0; t < 34; t++) {
      const a = (t / 34) * Math.PI * 2 + rand() * 0.12;
      const r = 560 + rand() * 170;
      const h = 90 + rand() * 150;
      addMound(Math.cos(a) * r, Math.sin(a) * r, h * (0.9 + rand() * 0.5), h, t * 3.7, h > 150);
    }
    // hills
    for (let t = 0; t < 26; t++) {
      const a = (t / 26) * Math.PI * 2 + rand() * 0.2;
      const r = 400 + rand() * 90;
      const h = 30 + rand() * 45;
      addMound(Math.cos(a) * r, Math.sin(a) * r, h * 2.4, h, 100 + t * 1.3, false);
    }
    // rock pillars
    for (let p = 0; p < 9; p++) {
      const ang = -0.9 + (rand() - 0.5) * 0.7;
      const dist = 330 + rand() * 140;
      const h = 70 + rand() * 90;
      const r = 9 + rand() * 9;
      const geo = new THREE.CylinderGeometry(r * 0.8, r * 1.15, h, IS_TOUCH ? 10 : 20, IS_TOUCH ? 5 : 10);
      const position = geo.getAttribute('position');
      const seed = p * 5.1;
      for (let e = 0; e < position.count; e++) {
        const x = position.getX(e);
        const y = position.getY(e);
        const z = position.getZ(e);
        const s = 1 + noise.noise3(x * 0.08 + seed, y * 0.05, z * 0.08) * 0.22 + Math.sin(y * 0.25 + seed) * 0.05;
        position.setXYZ(e, x * s, y, z * s);
      }
      geo.computeVertexNormals();
      const normal = geo.getAttribute('normal');
      const colors = new Float32Array(position.count * 3);
      for (let e = 0; e < position.count; e++) {
        const k = (position.getY(e) + h / 2) / h;
        if (normal.getY(e) > 0.6 || k > 0.93) col.copy(grassB);
        else col.copy(rockA).lerp(rockB, 0.3 + 0.3 * Math.sin(position.getY(e) * 0.4 + seed));
        colors[e * 3] = col.r;
        colors[e * 3 + 1] = col.g;
        colors[e * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.deleteAttribute('uv');
      geo.translate(Math.cos(ang) * dist, h / 2 - 8, Math.sin(ang) * dist);
      geos.push(geo.toNonIndexed());
    }
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.frustumCulled = false;
    this.scenery.add(mesh);
  }

  /** Low-detail terrain plane (1100 m) from the surface height function, centred on (cx, cz). */
  buildFarTerrain(cx: number, cz: number) {
    const size = 1100;
    const segs = IS_TOUCH ? 115 : 230;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const position = geo.getAttribute('position');
    const count = position.count;
    const colors = new Float32Array(count * 3);
    const mats = new Float32Array(count);
    geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute('carved', new THREE.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute('ore', new THREE.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute('oreCol', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const grass = new THREE.Color(MATERIALS[Mat.Grass].color);
    const dirt = new THREE.Color(MATERIALS[Mat.Dirt].color);
    for (let n = 0; n < count; n++) {
      const x = position.getX(n) + cx;
      const z = position.getZ(n) + cz;
      const y = surfaceHeight(x, z);
      position.setY(n, y - 0.5);
      const dx = surfaceHeight(x + 3, z) - y;
      const dz = surfaceHeight(x, z + 3) - y;
      const steep = Math.hypot(dx, dz) / 3 > 0.9;
      const c = steep ? dirt : grass;
      colors[n * 3] = c.r;
      colors[n * 3 + 1] = c.g;
      colors[n * 3 + 2] = c.b;
      mats[n] = steep ? Mat.Dirt : Mat.Grass;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aMat', new THREE.BufferAttribute(mats, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.farMat);
    mesh.position.set(cx, 0, cz);
    geo.translate(0, 0, 0);
    mesh.receiveShadow = true;
    mesh.userData.center = new THREE.Vector2(cx, cz);
    return mesh;
  }

  /** Marks which chunk columns around (chunkX, chunkZ) are streamed in; the far plane is cut out there. */
  setLoaded(chunkX: number, chunkZ: number, isLoaded: (cx: number, cz: number) => boolean) {
    const half = (MASK_GRID - 1) / 2;
    let changed = false;
    for (let a = 0; a < MASK_GRID; a++)
      for (let o = 0; o < MASK_GRID; o++) {
        const v = isLoaded(chunkX - half + o, chunkZ - half + a) ? 255 : 0;
        const i = (a * MASK_GRID + o) * 4;
        if (this.maskData[i] !== v) {
          this.maskData[i] = v;
          changed = true;
        }
      }
    const ox = (chunkX - half) * 16;
    const oz = (chunkZ - half) * 16;
    const origin = this.farUniforms.uMaskOrigin.value;
    if (changed || origin.x !== ox || origin.y !== oz) {
      origin.set(ox, oz);
      this.maskTex.needsUpdate = true;
    }
  }

  /**
   * @param depth metres below the surface (surface height - player y)
   * @param forceUnder 0..1 forced underground blend (the game passes its murk value)
   */
  update(dt: number, playerPos: THREE.Vector3, depth: number, camera: THREE.Camera, forceUnder = 0) {
    this.time += dt;
    const target = Math.max(THREE.MathUtils.smoothstep(depth, 1.5, 22), forceUnder);
    this.underground += (target - this.underground) * Math.min(1, dt * 2.5);
    if (Math.abs(target - this.underground) < 0.001) this.underground = target;
    const under = Math.max(this.underground, forceUnder);
    const clock = this.clock;
    clock.update(dt);
    const sunY = clock.sunDir.y;
    const look = sampleSkyLook(sunY, this.look);
    const night = clock.night;
    const clearSky = 1 - this.overcast * 0.75;
    const sunUp = THREE.MathUtils.smoothstep(sunY, -0.05, 0.03);
    const moonUp = THREE.MathUtils.smoothstep(-sunY, 0.05, 0.16);
    const moonLit = sunY < -0.05;
    const dir = moonLit ? clock.moonDir : clock.sunDir;
    this.sun.position.copy(dir);
    if (moonLit) this.sun.color.copy(MOON_COLOR);
    else this.sun.color.copy(look.sun);
    const base = moonLit ? 0.55 * moonUp : look.sunI * sunUp;
    this.sun.intensity = (base * clearSky + this.flash * 3) * (1 - under);
    ATMO.sunDir.copy(dir);
    ATMO.sunColor.copy(this.sun.color).multiplyScalar(this.sun.intensity / 3);
    this.hemi.color.copy(look.skyAmb).lerp(_tmpA.setHex(0xc4cbd8), this.overcast * 0.6);
    this.hemi.groundColor.copy(look.groundAmb);
    this.hemi.intensity = look.ambI * (1 + this.overcast * 0.25) + this.flash * 1.5;
    const band1 = THREE.MathUtils.smoothstep(depth, 12, 60);
    const band2 = THREE.MathUtils.smoothstep(depth, 60, 140);
    this.hemi.color.lerp(_tmpA.copy(CAVE_SKY_AMB[0]).lerp(CAVE_SKY_AMB[1], band1).lerp(CAVE_SKY_AMB[2], band2), under);
    this.hemi.groundColor.lerp(
      _tmpA.copy(CAVE_GROUND_AMB[0]).lerp(CAVE_GROUND_AMB[1], band1).lerp(CAVE_GROUND_AMB[2], band2),
      under,
    );
    this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, 0.8, under);
    const air = this.biomeAir;
    const airK = air ? this.biomeK * under : 0;
    if (air && airK > 0) {
      this.hemi.color.lerp(air.sky, airK);
      this.hemi.groundColor.lerp(air.ground, airK);
      this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, air.amb, airK);
    }
    const u = this.skyDome.u;
    u.uSun.value.copy(clock.sunDir);
    u.uMoon.value.copy(clock.moonDir);
    const overcastTint = _tmpA.setHex(0x9aa3b4);
    u.uZenith.value.copy(look.zenith).lerp(overcastTint, this.overcast * 0.55 * (1 - night));
    u.uHorizon.value.copy(look.horizon).lerp(overcastTint, this.overcast * 0.45 * (1 - night));
    u.uGround.value.copy(look.ground);
    if (ATMO.look.x > 0) {
      const k = ATMO.look.x * (1 - night) * (1 - this.overcast * 0.7);
      u.uZenith.value.lerp(_tmpB.setHex(0x3cb2ee), 0.6 * k);
      u.uHorizon.value.lerp(_tmpB.setHex(0xcff0fc), 0.5 * k);
    }
    u.uGlow.value.copy(look.glow).multiplyScalar(clearSky);
    u.uSunCol.value.copy(look.sun).multiplyScalar(clearSky);
    u.uCloudLit.value.copy(look.cloudLit);
    u.uCloudShade.value.copy(look.cloudShade);
    u.uNight.value = night * (1 - this.overcast * 0.8);
    u.uCover.value = this.cover;
    u.uStorm.value = this.storm;
    u.uTime.value = this.time;
    u.uCloudOff.value.set(this.time * 0.006, this.time * 0.0025);
    u.uFlash.value = this.flash;
    ATMO.fogHorizon.copy(u.uHorizon.value).lerp(u.uZenith.value, 0.32 * (1 - night));
    if (ATMO.look.x > 0) ATMO.fogHorizon.lerp(_tmpB.setHex(0xcdeaf7), 0.25 * ATMO.look.x * (1 - night));
    ATMO.fogSun.copy(look.fogSun).lerp(ATMO.fogHorizon, this.overcast * 0.7);
    const fogNear = 0.0035 + this.mist * 0.03 + this.overcast * 0.002;
    const fogFar = (0.0011 + this.overcast * 9e-4 + this.mist * 0.002) * (1 + ATMO.look.x * 0.6);
    ATMO.fogA.set(fogNear, 0.07 - this.mist * 0.04, 0, 1 - this.overcast * 0.7);
    ATMO.fogB.set(1, fogFar, 0, 0);
    murkColor
      .setHex(0x251b29)
      .lerp(_tmpA.setHex(0x0f252e), THREE.MathUtils.smoothstep(depth, 15, 70))
      .lerp(MURK_DEEP, THREE.MathUtils.smoothstep(depth, 70, 150));
    caveColor
      .copy(CAVE_SHALLOW)
      .lerp(CAVE_MID, THREE.MathUtils.smoothstep(depth, 12, 60))
      .lerp(CAVE_DEEP, THREE.MathUtils.smoothstep(depth, 60, 140));
    const cave = _tmpA.copy(caveColor).lerp(murkColor, forceUnder);
    if (air && airK > 0) cave.lerp(_tmpB.copy(air.fog).lerp(murkColor, forceUnder), this.biomeK);
    ATMO.fogHorizon.lerp(cave, under);
    ATMO.fogSun.lerp(cave, under);
    ATMO.fogA.x *= 1 - under;
    ATMO.fogA.w *= 1 - under;
    ATMO.fogB.y = THREE.MathUtils.lerp(fogFar, air ? THREE.MathUtils.lerp(0.017, air.haze, this.biomeK) : 0.017, under);
    ATMO.fogB.z = (air ? THREE.MathUtils.lerp(9, air.clear, this.biomeK) : 9) * under;
    ATMO.params.set(this.time, ATMO.params.y, night, under);
    u.uUnder.value = under;
    u.uCave.value.copy(cave);
    this.exposure = THREE.MathUtils.lerp(look.exposure * (1 + this.overcast * 0.08), 1, under);
    this.scenery.visible = under < 0.95;
    this.clouds.visible = under < 0.95;
    this.far.visible = under < 0.95;
    this.sky.position.copy(camera.position);
    this.scenery.position.set(playerPos.x, 0, playerPos.z);
    for (const cloud of this.clouds.children) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 380) cloud.position.x = -380;
    }
    this.farUniforms.uPlayer.value.set(playerPos.x, playerPos.z);
    const center = this.far.userData.center as THREE.Vector2;
    if (Math.hypot(playerPos.x - center.x, playerPos.z - center.y) > 160) {
      this.scene.remove(this.far);
      this.far.geometry.dispose();
      this.far = this.buildFarTerrain(Math.round(playerPos.x / 50) * 50, Math.round(playerPos.z / 50) * 50);
      this.scene.add(this.far);
    }
  }
}
