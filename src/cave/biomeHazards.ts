// Port of play-inUT-NSi.js lines 68998-69292: the biome hazard events (NL, KR.biomeEvents). Inside a biome
// cavern: lava bursts from the ember pools, poison gas clouds from the bog water, icicles falling in the frost
// caves (each with a warning phase, then the effect that hurts the local miner), and the haunt headlamp
// flicker (KR multiplies the headlamp intensity by `flicker`). Local only, not synced.
import * as THREE from 'three';
import type { Particles } from '../fx/particles';
import { hasLiquidSurface, type BiomeId, type Cavern } from '../world/caverns';

const tmpA = new THREE.Vector3(); // jL (68998)
const tmpB = new THREE.Vector3(); // ML (68999)

/** What the game supplies (KR 70302-70325). */
export interface BiomeHazardHooks {
  /** The chunk manager (groundBelow, sample). */
  world: {
    groundBelow(x: number, z: number, y: number, maxDrop?: number): number | null;
    sample(x: number, y: number, z: number): number;
  };
  /** KR.sparks / KR.dust (the game's particles, not the biome ones). */
  sparks: Particles;
  dust: Particles;
  /** The icicle meshes are added here. */
  scene: THREE.Object3D;
  /** dmg, source position, knock, element [fire, poison, frost]; KR scales by the resfire / respoison stats. */
  hurt(dmg: number, at: THREE.Vector3, knock: number, element: [number, number, number]): void;
  /** KR: combat.afflict(n, [0, 1, 0]). */
  poison(n: number): void;
  /** KR: audio.biomeEvent(kind, clamp(volume, 0.1, 1)). Kinds: rumble, burst, hiss, crack, shatter. */
  sound(kind: string, volume: number): void;
  /** KR: cam.addShake(amount). */
  shake(amount: number): void;
}

interface HazardEvent {
  kind: 'burst' | 'gas' | 'icicle';
  at: THREE.Vector3;
  t: number;
  warn: number;
  fromY?: number;
  mesh?: THREE.Mesh;
}

interface GasCloud {
  at: THREE.Vector3;
  t: number;
}

export class BiomeHazards { // NL (69000)
  d: BiomeHazardHooks;
  next = 6;
  live: HazardEvent[] = [];
  clouds: GasCloud[] = [];
  /** Headlamp multiplier (1 = steady). */
  flicker = 1;
  flickT = 8;
  flickLeft = 0;
  icicle: THREE.Mesh | null = null;
  biome: BiomeId | null = null;

  /** hooks: see BiomeHazardHooks. icicleGeometry: biome.glb BM_Icicles3 (null: no icicles fall). */
  constructor(hooks: BiomeHazardHooks, icicleGeometry: THREE.BufferGeometry | null) {
    this.d = hooks;
    if (icicleGeometry) {
      const material = new THREE.MeshStandardMaterial({
        color: 10471648,
        roughness: 0.15,
        emissive: 3832488,
        emissiveIntensity: 0.35,
      });
      this.icicle = new THREE.Mesh(icicleGeometry, material);
    }
  }

  /**
   * Per frame (KR 72040, before env.update): the hitstop-scaled dt, biomes.region, biomes.k, the player
   * position, and active = started && !burrow && !combat.ko && !player.lifting.
   */
  update(dt: number, region: Cavern | null, k: number, pos: THREE.Vector3, active: boolean): void {
    this.updateLive(dt, pos);
    this.updateClouds(dt, pos);
    this.flickT -= dt;
    if (region?.biome === `haunt` && k > 0.5 && active && this.flickT <= 0) {
      this.flickT = 9 + Math.random() * 14;
      this.flickLeft = 0.9 + Math.random() * 0.8;
    }
    this.flickLeft -= dt;
    this.flicker =
      this.flickLeft > 0 ? 0.25 + 0.75 * Math.abs(Math.sin(this.flickLeft * 31) * Math.sin(this.flickLeft * 13)) : 1;
    if (!region || k < 0.6 || !active) return;
    if (region.biome !== this.biome) {
      this.biome = region.biome;
      this.next = 4 + Math.random() * 5;
    }
    this.next -= dt;
    if (this.next > 0) return;
    this.next =
      region.biome === `ember`
        ? 3 + Math.random() * 5
        : region.biome === `frost`
          ? 6 + Math.random() * 9
          : region.biome === `bog`
            ? 7 + Math.random() * 9
            : 99;
    if (region.biome === `ember`) this.startBurst(region, pos);
    else if (region.biome === `frost`) this.startIcicle(pos);
    else if (region.biome === `bog`) this.startGas(region, pos);
  }

  /** A liquid surface point minR..maxR from pos (14 tries), or null. */
  poolNear(region: Cavern, pos: THREE.Vector3, minR: number, maxR: number): THREE.Vector3 | null {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = pos.x + Math.cos(a) * r;
      const z = pos.z + Math.sin(a) * r;
      if (hasLiquidSurface(region, x, z)) return new THREE.Vector3(x, region.liquidY, z);
    }
    return null;
  }

  startBurst(region: Cavern, pos: THREE.Vector3): void {
    const at = this.poolNear(region, pos, 3, 16);
    if (!at) return;
    this.live.push({ kind: `burst`, at, t: 0, warn: 1.3 });
    this.d.sound(`rumble`, 1 - at.distanceTo(pos) / 30);
  }

  startGas(region: Cavern, pos: THREE.Vector3): void {
    const at = this.poolNear(region, pos, 2, 14);
    if (at) this.live.push({ kind: `gas`, at, t: 0, warn: 1.1 });
  }

  /** An icicle over open ground 1-8 m from pos, falling from the ceiling (at most 22 m up). */
  startIcicle(pos: THREE.Vector3): void {
    if (!this.icicle) return;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 7;
      const x = pos.x + Math.cos(a) * r;
      const z = pos.z + Math.sin(a) * r;
      const g = this.d.world.groundBelow(x, z, pos.y + 3, 8);
      if (g === null) continue;
      let ceiling = NaN;
      for (let y = g + 3; y < g + 64; y += 1)
        if (this.d.world.sample(x, y, z) > 128) {
          ceiling = y;
          break;
        }
      if (!Number.isNaN(ceiling)) {
        this.live.push({
          kind: `icicle`,
          at: new THREE.Vector3(x, g, z),
          t: 0,
          warn: 1.4,
          fromY: Math.min(ceiling - 0.6, g + 22),
        });
        this.d.sound(`crack`, 1 - r / 20);
        return;
      }
    }
  }

  updateLive(dt: number, pos: THREE.Vector3): void {
    for (let n = this.live.length - 1; n >= 0; n--) {
      const e = this.live[n];
      e.t += dt;
      const vol = 1 - Math.min(1, e.at.distanceTo(pos) / 35);
      if (e.kind === `burst`) {
        if (e.t < e.warn) {
          if (Math.random() < dt * 30)
            this.d.sparks.emit({
              pos: tmpA.set(e.at.x + (Math.random() - 0.5) * 2, e.at.y + 0.05, e.at.z + (Math.random() - 0.5) * 2),
              vel: tmpB.set(0, 1.5, 0),
              spread: 0.4,
              color: 16752704,
              intensity: 3,
              size: 0.12,
              sizeEnd: 0.03,
              life: 0.5,
              gravity: 5,
              count: 1,
            });
          continue;
        }
        this.d.sparks.emit({
          pos: e.at,
          vel: tmpB.set(0, 11, 0),
          spread: 3.2,
          color: 16742954,
          intensity: 3.6,
          size: 0.2,
          sizeEnd: 0.05,
          life: 1.3,
          gravity: 14,
          count: 60,
          drag: 0.3,
        });
        this.d.sparks.emit({
          pos: e.at,
          spread: 1.5,
          color: 16765066,
          intensity: 5,
          size: 0.9,
          sizeEnd: 0.1,
          life: 0.3,
          count: 5,
        });
        this.d.dust.emit({
          pos: tmpA.copy(e.at).setY(e.at.y + 1),
          vel: tmpB.set(0, 2.5, 0),
          spread: 1.4,
          color: 3812392,
          size: 1.2,
          sizeEnd: 3.6,
          alpha: 0.45,
          life: 2.4,
          gravity: -0.4,
          drag: 0.8,
          count: 10,
        });
        this.d.sound(`burst`, vol);
        this.d.shake(Math.max(0, 0.4 - e.at.distanceTo(pos) * 0.03));
        const h = Math.hypot(pos.x - e.at.x, pos.z - e.at.z);
        if (h < 3 && pos.y < e.at.y + 3) this.d.hurt(Math.round(26 * (1 - h / 4)), e.at, 6, [0.5, 0, 0]);
        this.live.splice(n, 1);
      } else if (e.kind === `gas`) {
        if (e.t < e.warn) {
          if (Math.random() < dt * 20)
            this.d.dust.emit({
              pos: tmpA.set(e.at.x + (Math.random() - 0.5) * 1.2, e.at.y + 0.05, e.at.z + (Math.random() - 0.5) * 1.2),
              vel: tmpB.set(0, 0.8, 0),
              spread: 0.3,
              color: 10473568,
              size: 0.2,
              sizeEnd: 0.5,
              alpha: 0.6,
              life: 0.5,
              count: 1,
            });
          continue;
        }
        this.clouds.push({ at: e.at.clone(), t: 0 });
        this.d.sound(`hiss`, vol);
        this.live.splice(n, 1);
      } else {
        const fromY = e.fromY!;
        if (e.t < e.warn) {
          const y = Math.min(fromY, e.at.y + 7);
          if (Math.random() < dt * 26)
            this.d.dust.emit({
              pos: tmpA.set(e.at.x + (Math.random() - 0.5) * 0.7, y, e.at.z + (Math.random() - 0.5) * 0.7),
              vel: tmpB.set(0, -3, 0),
              spread: 0.2,
              color: 15923455,
              size: 0.12,
              alpha: 0.85,
              life: (y - e.at.y) / 3,
              count: 1,
            });
          continue;
        }
        if (!e.mesh) {
          e.mesh = this.icicle!.clone();
          e.mesh.scale.setScalar(1.2 + Math.random() * 0.8);
          e.mesh.rotation.y = Math.random() * 6.28;
          this.d.scene.add(e.mesh);
        }
        const ft = e.t - e.warn;
        const y = fromY - 13 * ft * ft;
        e.mesh.position.set(e.at.x, Math.max(e.at.y + 1.2, y), e.at.z);
        if (y > e.at.y + 1.2) continue;
        e.mesh.removeFromParent();
        this.d.sparks.emit({
          pos: tmpA.copy(e.at).setY(e.at.y + 0.3),
          vel: tmpB.set(0, 4, 0),
          spread: 4,
          color: 14218495,
          intensity: 3,
          size: 0.12,
          sizeEnd: 0.03,
          life: 0.7,
          gravity: 12,
          count: 30,
        });
        this.d.dust.emit({
          pos: tmpA.copy(e.at).setY(e.at.y + 0.3),
          vel: tmpB.set(0, 0.8, 0),
          spread: 1.6,
          color: 15398655,
          size: 0.6,
          sizeEnd: 1.8,
          alpha: 0.5,
          life: 1,
          drag: 1.5,
          count: 8,
        });
        this.d.sound(`shatter`, vol);
        this.d.shake(Math.max(0, 0.3 - e.at.distanceTo(pos) * 0.03));
        const h = Math.hypot(pos.x - e.at.x, pos.z - e.at.z);
        if (h < 1.7 && Math.abs(pos.y - e.at.y) < 2.5) this.d.hurt(Math.round(24 * (1 - h / 2.4)), e.at, 4, [0, 0, 0.45]);
        this.live.splice(n, 1);
      }
    }
  }

  /** Gas clouds: 5 s, puffs fading over the last second, poison(6) at random while inside. */
  updateClouds(dt: number, pos: THREE.Vector3): void {
    for (let n = this.clouds.length - 1; n >= 0; n--) {
      const c = this.clouds[n];
      c.t += dt;
      if (c.t > 5) {
        this.clouds.splice(n, 1);
        continue;
      }
      const fade = c.t < 4 ? 1 : 5 - c.t;
      if (Math.random() < dt * 14 * fade)
        this.d.dust.emit({
          pos: tmpA.set(c.at.x + (Math.random() - 0.5) * 3, c.at.y + 0.4 + Math.random() * 1.5, c.at.z + (Math.random() - 0.5) * 3),
          vel: tmpB.set(0, 0.3, 0),
          spread: 0.4,
          color: Math.random() < 0.5 ? 10469466 : 8034880,
          size: 1.4,
          sizeEnd: 3,
          alpha: 0.28,
          life: 2,
          drag: 0.8,
          count: 1,
        });
      if (Math.hypot(pos.x - c.at.x, pos.z - c.at.z) < 2.8 && pos.y < c.at.y + 3 && Math.random() < dt * 1.2) this.d.poison(6);
    }
  }

  /** Removes the falling icicles and every event (KR never calls it in the bundle). */
  clear(): void {
    for (const e of this.live) e.mesh?.removeFromParent();
    this.live.length = 0;
    this.clouds.length = 0;
  }
}
