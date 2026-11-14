// Port of play-inUT-NSi.js lines 68473-68997: the biome air table (SL), the lava / toxic pool shaders
// (CL, wL, TL, EL), the biome light table (DL) and the biome ambience manager (AL, KR.biomes).
// Each frame it finds the biome cavern around the player, eases the presence k, sets the liquid uniforms of
// the voxel shader, makes the pool discs, calls onNear / onEnter, emits the biome particles and moves the
// liquid light and the crystal glow light.
import * as THREE from 'three';
import { NOISE_GLSL } from '../render/glsl/noise';
import { copyAtmoUniforms } from '../render/atmosphere';
import { biomeUniforms } from '../render/biomeRock';
import type { BiomeAir } from '../sky/environment';
import { Particles } from '../fx/particles';
import {
  BIOMES,
  cavernAtWorld,
  cavernFloorY,
  cavernMetric,
  cavernVerticalFalloff,
  hasLiquidSurface,
  type BiomeId,
  type Cavern,
  type LiquidKind,
} from '../world/caverns';
import type { GlowSpot } from './caveDecor';

/** Biome air: Environment.biomeAir reads fog .. amb; KR reads murk (murk pass tint) and bloom. */
export interface BiomeAirDef extends BiomeAir {
  murk: THREE.Color;
  bloom: number;
}

export const BIOME_AIR: Record<BiomeId, BiomeAirDef> = { // SL (68473)
  ember: {
    fog: new THREE.Color(2757648),
    haze: 0.02,
    clear: 8,
    sky: new THREE.Color(5913142),
    ground: new THREE.Color(9056272),
    amb: 0.9,
    murk: new THREE.Color(10508346),
    bloom: 0.12,
  },
  bog: {
    fog: new THREE.Color(1318160),
    haze: 0.026,
    clear: 7,
    sky: new THREE.Color(6713948),
    ground: new THREE.Color(2898460),
    amb: 0.95,
    murk: new THREE.Color(6982218),
    bloom: 0.08,
  },
  frost: {
    fog: new THREE.Color(3496314),
    haze: 0.012,
    clear: 13,
    sky: new THREE.Color(13821695),
    ground: new THREE.Color(6983860),
    amb: 1.5,
    murk: new THREE.Color(9089232),
    bloom: 0.08,
  },
  haunt: {
    fog: new THREE.Color(2037555),
    haze: 0.024,
    clear: 7,
    sky: new THREE.Color(7627936),
    ground: new THREE.Color(2760768),
    amb: 0.85,
    murk: new THREE.Color(8022696),
    bloom: 0.1,
  },
};

const POOL_VERT = `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`; // CL (68515)

const POOL_PRELUDE = `
#include <common>
uniform float uTime;
uniform vec4 uClip; // the cavern's middle (xz), its half-width, and its cross-section here (squared)
varying vec3 vW;
${NOISE_GLSL}
vec2 cell2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + nzHash22(i + o) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  return sqrt(vec2(d1, d2));
}
bool clipped() {
  vec2 d = (vW.xz - uClip.xy) / uClip.z;
  return dot(d, d) > uClip.w;
}`; // wL (68522)

const LAVA_FRAG = `
${POOL_PRELUDE}
void main() {
  if (clipped()) discard;
  vec2 p = vW.xz * 0.16;
  // it creeps: rafts of black crust ride a slow, wandering flow over the molten rock
  vec2 flow = vec2(nzFbm2(p * 0.5 + uTime * 0.015), nzFbm2(p * 0.5 - uTime * 0.012 + 9.0)) - 0.5;
  vec2 q = p + flow * 1.2 + vec2(uTime * 0.02, uTime * 0.008);
  vec2 cl = cell2(q * 1.5);
  float edge = cl.y - cl.x;
  // where the crust has broken up (open lava) and where it's whole (rafts, their seams glowing)
  float open = smoothstep(0.52, 0.34, nzFbm2(q * 0.45 + 3.0));
  float seam = 1.0 - smoothstep(0.0, 0.1, edge);
  float heat = nzFbm2(q * 2.2 - uTime * 0.05);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.9 + heat * 9.0);
  // molten: deep orange, yellow where it's hottest (kept saturated: too bright washes to pink)
  vec3 molten = mix(vec3(1.35, 0.26, 0.02), vec3(1.9, 0.72, 0.08), smoothstep(0.5, 0.85, heat)) * pulse;
  // crust: near black, dull red at its edges, the seams between plates bright
  vec3 crust = vec3(0.035, 0.012, 0.008) * (0.7 + 0.8 * cl.x) + vec3(0.45, 0.07, 0.01) * smoothstep(0.35, 0.05, edge) * 0.35;
  crust += vec3(1.2, 0.3, 0.03) * seam * pulse * 0.8;
  vec3 col = mix(crust, molten, open);
  // a hot shimmer: the surface's brightest streaks
  col += vec3(0.9, 0.45, 0.08) * smoothstep(0.78, 0.95, heat) * open * 0.6;
  gl_FragColor = vec4(atmoFog(col, vW), 1.0);
}`; // TL (68544)

const TOXIC_FRAG = `
${POOL_PRELUDE}
uniform vec3 uLight;
uniform vec3 uLightCol;
void main() {
  if (clipped()) discard;
  vec2 p = vW.xz;
  // a slow swell, and fine ripples over it
  float e = 0.1;
  vec2 o1 = uTime * vec2(0.05, 0.03), o2 = -uTime * vec2(0.06, 0.09);
  float h = nzFbm2(p * 0.3 + o1) + 0.35 * nzValue2(p * 2.2 + o2);
  float hx = nzFbm2((p + vec2(e, 0.0)) * 0.3 + o1) + 0.35 * nzValue2((p + vec2(e, 0.0)) * 2.2 + o2);
  float hz = nzFbm2((p + vec2(0.0, e)) * 0.3 + o1) + 0.35 * nzValue2((p + vec2(0.0, e)) * 2.2 + o2);
  vec3 n = normalize(vec3(-(hx - h) / e * 0.3, 1.0, -(hz - h) / e * 0.3));
  vec3 vd = normalize(vW - cameraPosition);
  float facing = max(dot(n, -vd), 0.0);
  float fres = pow(1.0 - facing, 5.0);
  // deep, murky water: near black with green in it
  vec3 col = vec3(0.004, 0.016, 0.006) * (0.8 + 0.4 * nzFbm2(p * 0.08 + 3.0));
  // glowing threads of algae winding through it, stirred by the swell
  float sw = nzFbm2(p * 0.1 + vec2(h, hx) * 0.7 + uTime * 0.01);
  float thread = smoothstep(0.022, 0.0, abs(sw - 0.56)) + 0.6 * smoothstep(0.016, 0.0, abs(sw - 0.44));
  col += vec3(0.25, 0.85, 0.12) * thread * 0.24;
  // mats of duckweed and scum floating on it
  float scum = smoothstep(0.62, 0.7, nzFbm2(p * 0.38 + uTime * 0.006 + 11.0));
  vec3 weed = vec3(0.045, 0.085, 0.02) * (0.6 + 0.8 * nzValue2(p * 6.0));
  col = mix(col, weed, scum * 0.92);
  // bubbles rising and popping: a ring spreading from each, then gone
  vec2 bc = floor(p * 0.55);
  vec2 bj = (bc + 0.2 + 0.6 * nzHash22(bc + 7.0)) / 0.55;
  float ph = fract(uTime * (0.18 + 0.12 * nzHash12(bc)) + nzHash12(bc + 3.3));
  float ring = smoothstep(0.045, 0.0, abs(length(p - bj) - ph * 0.55)) * (1.0 - ph) * step(0.45, nzHash12(bc + 9.1));
  col += vec3(0.3, 0.85, 0.15) * ring * 0.35 * (1.0 - scum);
  // it shines: the cave's murk at a slant, glints of the nearest glow on the ripples, the lamp
  vec3 wet = vec3(1.0 - scum * 0.85);
  col = mix(col, vec3(0.035, 0.06, 0.04), fres * 0.55 * wet.x);
  vec3 L = normalize(uLight - vW);
  col += uLightCol * pow(max(dot(reflect(vd, n), L), 0.0), 60.0) * 1.5 * wet;
  col += vec3(1.0, 0.95, 0.8) * pow(max(dot(reflect(vd, n), -vd), 0.0), 140.0) * 0.5 * wet;
  gl_FragColor = vec4(atmoFog(col, vW), 1.0);
}`; // EL (68569)

/** The biome light: colour, power and distance. */
export const BIOME_LIGHT: Record<BiomeId, { color: number; power: number; dist: number }> = { // DL (68610)
  ember: { color: 16734746, power: 9, dist: 30 },
  bog: { color: 12123994, power: 2, dist: 22 },
  frost: { color: 11065599, power: 2.4, dist: 34 },
  haunt: { color: 10789119, power: 2, dist: 30 },
};

const tmpA = new THREE.Vector3(); // OL (68616)
const tmpB = new THREE.Vector3(); // kL (68617)

interface Pool {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  mat: THREE.ShaderMaterial;
}

export class BiomeAmbience { // AL (68618)
  group = new THREE.Group();
  sparks = new Particles(900, true);
  dust = new Particles(1400, false);
  region: Cavern | null = null;
  k = 0;
  current: BiomeId | null = null;
  /** KR: biomeEntered(biome). */
  onEnter: (biome: BiomeId) => void = () => {};
  /** KR: biomeNear(biome, flat direction to the cavern centre). */
  onNear: (biome: BiomeId, dir: THREE.Vector3) => void = () => {};
  nearT = 0;
  /** DECOR_DENSITY[quality] (GR). */
  density = 1;
  pools = new Map<number, Pool>();
  light = new THREE.PointLight(16738848, 0, 30, 1.3);
  glow = new THREE.PointLight(16777215, 0, 9, 1.6);
  glowCol = new THREE.Color();
  glowAt = new THREE.Vector3();
  glowNext: GlowSpot | null = null;
  glowT = 0;
  /** KR: caveDecor.nearestGlow(pos, r). */
  nearestGlow: (pos: THREE.Vector3, r: number) => GlowSpot | null = () => null;
  lightAt = new THREE.Vector3();
  lightT = 0;
  time = 0;
  emitT = { a: 0, b: 0, c: 0, d: 0 };
  breathT = 1;
  constructor() {
    this.group.name = `biomes`;
    this.sparks.points.renderOrder = 2;
    this.group.add(this.sparks.points, this.dust.points, this.light, this.glow);
  }

  /** The air of the current region (null outside a biome region). */
  air(): BiomeAirDef | null {
    return this.region ? BIOME_AIR[this.region.biome] : null;
  }

  /**
   * Per frame (KR 72031, before env.update): dt, the player position, the head (pos + 1.45 y), the flat
   * camera direction and the murk.
   */
  update(dt: number, pos: THREE.Vector3, head: THREE.Vector3, dirFlat: THREE.Vector3, murk: number): void {
    this.time += dt;
    biomeUniforms.uTime.value = this.time;
    const here = cavernAtWorld(pos.x, pos.y, pos.z);
    if (here !== this.region && (this.k <= 0.02 || !this.region)) this.region = here;
    const region = this.region;
    let target = 0;
    let c = 99;
    if (region) {
      c = cavernMetric(region, pos.x, pos.y, pos.z);
      target = 1 - THREE.MathUtils.smoothstep(c, 0.72, 1.18);
    }
    this.k += (target - this.k) * Math.min(1, dt * 1.6);
    if (Math.abs(target - this.k) < 0.001) this.k = target;
    const liquid = region ? BIOMES[region.biome].liquid : null;
    const near = !!region && c < 3.5;
    biomeUniforms.uLiquidY.value = near && liquid ? region!.liquidY : -1e5;
    biomeUniforms.uLiquidKind.value = near && liquid ? (liquid === `lava` ? 1 : 2) : 0;
    if (region && liquid && c < 4 && !this.pools.has(region.key)) this.pools.set(region.key, this.makePool(region, liquid));
    for (const [key, pool] of this.pools) {
      const shown = !!region && region.key === key && c < 5.5 && murk < 0.5;
      pool.mesh.visible = shown;
      if (shown) pool.mat.uniforms.uTime.value = this.time;
    }
    this.nearT -= dt;
    if (region && this.nearT <= 0) {
      this.nearT = 1;
      if (c < 2.8 && c > 1.3) this.onNear(region.biome, new THREE.Vector3(region.cx - pos.x, 0, region.cz - pos.z).normalize());
    }
    const current = region && this.k > 0.5 ? region.biome : null;
    if (current !== this.current) {
      this.current = current;
      if (current) this.onEnter(current);
    }
    this.sparks.update(dt);
    this.dust.update(dt);
    if (region && this.k > 0.05 && murk < 0.5) this.emit(dt, region, pos, head, dirFlat);
    this.shine(dt, region, pos, murk);
    this.glowNear(dt, pos, murk);
  }

  /** Moves the crystal glow light to the nearest lit decor (swaps target only when faded out). */
  glowNear(dt: number, pos: THREE.Vector3, murk: number): void {
    const g = this.glow;
    this.glowT -= dt;
    if (this.glowT <= 0) {
      this.glowT = 0.3;
      const spot = murk < 0.5 ? this.nearestGlow(pos, 11) : null;
      if (spot) {
        if (!this.glowNext || this.glowNext.p !== spot.p) this.glowNext = spot;
      } else this.glowNext = null;
    }
    const next = this.glowNext;
    const there = !!next && this.glowAt.distanceToSquared(tmpA.copy(next.p).setY(next.p.y + 0.6)) < 0.01;
    if (next && (there || g.intensity < 0.06)) {
      this.glowAt.copy(next.p).setY(next.p.y + 0.6);
      g.position.copy(this.glowAt);
      this.glowCol.copy(next.color);
      const m = Math.max(this.glowCol.r, this.glowCol.g, this.glowCol.b, 0.001);
      this.glowCol.multiplyScalar(1 / m);
      g.color.copy(this.glowCol);
    }
    const want = next && this.glowAt.distanceToSquared(tmpA.copy(next.p).setY(next.p.y + 0.6)) < 0.01 ? 2.2 : 0;
    g.intensity += (want - g.intensity) * Math.min(1, dt * (want ? 3 : 8));
  }

  /** The liquid light: over the nearest liquid (lava, toxic), else above the player. */
  shine(dt: number, region: Cavern | null, pos: THREE.Vector3, murk: number): void {
    const l = this.light;
    let want = 0;
    if (region && this.k > 0.01 && murk < 0.5) {
      const liquid = BIOMES[region.biome].liquid;
      this.lightT -= dt;
      if (liquid && this.lightT <= 0) {
        this.lightT = 0.35;
        let best = 1e9;
        for (let r = 0; r <= 24; r += 3)
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + r * 0.37;
            const x = pos.x + Math.cos(a) * r;
            const z = pos.z + Math.sin(a) * r;
            if (r * r < best && hasLiquidSurface(region, x, z)) {
              best = r * r;
              this.lightAt.set(x, region.liquidY + 1.4, z);
            }
          }
        if (best > 1e8) this.lightAt.set(pos.x, -1e4, pos.z);
      }
      if (!liquid) this.lightAt.set(pos.x, pos.y + (region.biome === `frost` ? 7 : 5), pos.z);
      const off = this.lightAt.y < -1e3;
      if (!off) {
        if (l.position.distanceToSquared(this.lightAt) > 900) l.position.copy(this.lightAt);
        else l.position.lerp(this.lightAt, Math.min(1, dt * 3));
      }
      const def = BIOME_LIGHT[region.biome];
      l.color.setHex(def.color);
      l.distance = def.dist;
      want = off ? 0 : def.power * this.k;
    }
    l.intensity += (want - l.intensity) * Math.min(1, dt * 2.5);
    if (region?.biome === `ember`) l.intensity *= 0.97 + 0.03 * Math.sin(this.time * 2.3);
  }

  /** The pool material: lava or toxic water, clipped to the cavern (clip = cx, cz, rx, cross-section). */
  poolMat(kind: LiquidKind, clip: THREE.Vector4): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uClip: { value: clip },
        uLight: { value: this.glow.position },
        uLightCol: { value: this.glowCol },
        ...copyAtmoUniforms(),
      },
      vertexShader: POOL_VERT,
      fragmentShader: kind === `lava` ? LAVA_FRAG : TOXIC_FRAG,
    });
  }

  /** Shader warm-up (KR.warmUp 70966 / 70970): small lava and toxic discs while on, removed when off. */
  warm(on: boolean): void {
    for (const m of this.warmers) {
      this.group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.warmers.length = 0;
    if (on)
      for (const kind of [`lava`, `toxic`] as const) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), this.poolMat(kind, new THREE.Vector4()));
        m.frustumCulled = false;
        this.warmers.push(m);
        this.group.add(m);
      }
  }
  warmers: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>[] = [];

  /** The liquid disc of a cavern at its liquid height. */
  makePool(region: Cavern, kind: LiquidKind): Pool {
    const geometry = new THREE.CircleGeometry(region.rx * 1.02, 72).rotateX(-Math.PI / 2);
    const mat = this.poolMat(
      kind,
      new THREE.Vector4(region.cx, region.cz, region.rx, cavernVerticalFalloff(region, region.liquidY) * 1.02),
    );
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(region.cx, region.liquidY, region.cz);
    mesh.frustumCulled = false;
    mesh.name = `pool-${kind}`;
    this.group.add(mesh);
    return { mesh, mat };
  }

  /** The biome particles around the player (rates per second x k x density). */
  emit(dt: number, region: Cavern, pos: THREE.Vector3, head: THREE.Vector3, dir: THREE.Vector3): void {
    const rate = this.k * this.density;
    const acc = this.emitT;
    const jitter = (w: number) => (Math.random() - 0.5) * w;
    const floorAt = (x: number, z: number) => Math.max(cavernFloorY(region, x, z), region.liquidY);
    switch (region.biome) {
      case `ember`:
        for (acc.a -= dt * 16 * rate; acc.a < 0; ) {
          acc.a += 1;
          const x = pos.x + jitter(26);
          const z = pos.z + jitter(26);
          tmpA.set(x, floorAt(x, z) + Math.random() * 8, z);
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.6), 1.2 + Math.random() * 1.6, jitter(0.6)),
            spread: 0.25,
            color: Math.random() < 0.6 ? 16738842 : 16757575,
            intensity: 2.6,
            size: 0.05 + Math.random() * 0.05,
            sizeEnd: 0.02,
            life: 3.5,
            gravity: -0.15,
            drag: 0.4,
          });
        }
        for (acc.b -= dt * 7 * rate; acc.b < 0; ) {
          acc.b += 1;
          tmpA.set(pos.x + jitter(24), pos.y + 3 + Math.random() * 7, pos.z + jitter(24));
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.4), -0.35, jitter(0.4)),
            spread: 0.15,
            color: 5919312,
            size: 0.07,
            alpha: 0.7,
            life: 6,
            drag: 0.1,
          });
        }
        for (acc.c -= dt * 5 * rate; acc.c < 0; ) {
          acc.c += 1;
          const x = pos.x + jitter(36);
          const z = pos.z + jitter(36);
          if (!hasLiquidSurface(region, x, z)) continue;
          tmpA.set(x, region.liquidY + 0.05, z);
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(0, 2.6, 0),
            spread: 1.3,
            color: 16747050,
            intensity: 3.2,
            size: 0.12,
            sizeEnd: 0.04,
            life: 0.7,
            gravity: 9,
            drag: 0.5,
            count: 5,
          });
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(0, 0.8, 0),
            spread: 0.2,
            color: 2760734,
            size: 0.6,
            sizeEnd: 2.4,
            alpha: 0.32,
            life: 2.6,
            gravity: -0.25,
            drag: 0.6,
          });
        }
        break;
      case `bog`:
        for (acc.a -= dt * 12 * rate; acc.a < 0; ) {
          acc.a += 1;
          tmpA.set(pos.x + jitter(24), pos.y + Math.random() * 7 - 1, pos.z + jitter(24));
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.3), jitter(0.2) + 0.05, jitter(0.3)),
            spread: 0.08,
            color: Math.random() < 0.5 ? 11075418 : 7012296,
            intensity: 1.6,
            size: 0.05 + Math.random() * 0.03,
            life: 5,
            gravity: -0.02,
            drag: 0.05,
          });
        }
        for (acc.b -= dt * 2.5 * rate; acc.b < 0; ) {
          acc.b += 1;
          const x = pos.x + jitter(20);
          const z = pos.z + jitter(20);
          tmpA.set(x, floorAt(x, z) + 0.6 + Math.random() * 2.5, z);
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.9), jitter(0.4), jitter(0.9)),
            spread: 0.3,
            color: 15007562,
            intensity: 3.4,
            size: 0.07,
            life: 3.2,
            drag: 0.2,
          });
        }
        for (acc.c -= dt * 4 * rate; acc.c < 0; ) {
          acc.c += 1;
          const x = pos.x + jitter(30);
          const z = pos.z + jitter(30);
          if (!hasLiquidSurface(region, x, z)) continue;
          tmpA.set(x, region.liquidY + 0.3, z);
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.3), 0.05, jitter(0.3)),
            spread: 0.1,
            color: 8362590,
            size: 2.2,
            sizeEnd: 4.5,
            alpha: 0.13,
            life: 6,
            drag: 0.2,
          });
          if (Math.random() < 0.6) {
            tmpA.y = region.liquidY + 0.02;
            this.sparks.emit({
              pos: tmpA,
              vel: tmpB.set(0, 1.1, 0),
              spread: 0.45,
              color: 10157898,
              intensity: 1.8,
              size: 0.06,
              life: 0.5,
              gravity: 5,
              drag: 0.4,
              count: 3,
            });
          }
        }
        break;
      case `frost`:
        for (acc.a -= dt * 30 * rate; acc.a < 0; ) {
          acc.a += 1;
          tmpA.set(pos.x + jitter(28), pos.y + 4 + Math.random() * 9, pos.z + jitter(28));
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.5) + 0.15, -0.55 - Math.random() * 0.45, jitter(0.5)),
            spread: 0.08,
            color: 15923199,
            size: 0.06 + Math.random() * 0.06,
            alpha: 0.9,
            life: 9,
            drag: 0.02,
          });
        }
        for (acc.b -= dt * 6 * rate; acc.b < 0; ) {
          acc.b += 1;
          tmpA.set(pos.x + jitter(14), pos.y + Math.random() * 5, pos.z + jitter(14));
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.1), -0.1, jitter(0.1)),
            color: 14217471,
            intensity: 2.2,
            size: 0.03,
            life: 1.6,
            drag: 0.1,
          });
        }
        this.breathT -= dt;
        if (this.breathT <= 0) {
          this.breathT = 2 + Math.random() * 0.8;
          tmpA.copy(head).addScaledVector(dir, 0.35);
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.copy(dir).multiplyScalar(0.7).setY(0.15),
            spread: 0.08,
            color: 15266047,
            size: 0.14,
            sizeEnd: 0.55,
            alpha: 0.4 * this.k,
            life: 1.3,
            drag: 1.2,
            count: 3,
          });
        }
        break;
      case `haunt`:
        for (acc.a -= dt * 2.2 * rate; acc.a < 0; ) {
          acc.a += 1;
          const x = pos.x + jitter(26);
          const z = pos.z + jitter(26);
          tmpA.set(x, floorAt(x, z) + 0.8 + Math.random() * 4, z);
          this.sparks.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.5), 0.1 + jitter(0.2), jitter(0.5)),
            spread: 0.1,
            color: Math.random() < 0.65 ? 11111167 : 8060896,
            intensity: 2.6,
            size: 0.14,
            sizeEnd: 0.06,
            life: 5,
            gravity: -0.03,
            drag: 0.1,
          });
        }
        for (acc.b -= dt * 6 * rate; acc.b < 0; ) {
          acc.b += 1;
          tmpA.set(pos.x + jitter(22), pos.y + Math.random() * 6 - 1, pos.z + jitter(22));
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.2), jitter(0.1), jitter(0.2)),
            color: 8022682,
            size: 0.08,
            alpha: 0.55,
            life: 5,
            drag: 0.1,
          });
        }
        for (acc.c -= dt * 3.5 * rate; acc.c < 0; ) {
          acc.c += 1;
          const x = pos.x + jitter(26);
          const z = pos.z + jitter(26);
          tmpA.set(x, floorAt(x, z) + 0.35, z);
          this.dust.emit({
            pos: tmpA,
            vel: tmpB.set(jitter(0.35), 0.03, jitter(0.35)),
            spread: 0.05,
            color: 4865894,
            size: 2.6,
            sizeEnd: 5,
            alpha: 0.14,
            life: 7,
            drag: 0.15,
          });
        }
    }
  }
}
