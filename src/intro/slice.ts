// The cut face of the intro film: the world seen as a sliced cake.
// One voxel layer of the real world (z = const) becomes two textures: density (linear filtered, so the
// cave outlines are smooth) and material (nearest). A quad on the cut plane draws the rock with the game's
// material colours, an ink outline and soft shade along every cave, and discards air, so the tunnels and
// caverns open into the real 3D world behind the plane. Gems are scattered on the face with the game's
// depth table (pickGemByDepth).
import * as THREE from 'three';
import type { ChunkManager } from '../world/chunkManager';
import { generateChunk } from '../world/generate';
import { chunkKey } from '../world/chunk';
import { MATERIALS, Mat } from '../world/materials';
import { pickGemByDepth } from '../world/gemSpawn';
import { NOISE_GLSL } from '../render/glsl/noise';
import type { GemField } from '../gems/gemField';

const Q = 16;
const PALETTE = 32;

export interface SliceBox {
  /** The voxel layer (world z) that is cut. */
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export class GroundSlice {
  readonly mesh: THREE.Mesh;
  readonly gems = new THREE.Group();
  readonly uniforms = {
    uDensity: { value: null as THREE.DataTexture | null },
    uMaterial: { value: null as THREE.DataTexture | null },
    uPalette: { value: [] as THREE.Color[] },
    uGlow: { value: new Float32Array(PALETTE) },
    uOrigin: { value: new THREE.Vector2() },
    uSize: { value: new THREE.Vector2() },
    /** Vertical motion blur length in metres. */
    uBlur: { value: 0 },
    uGain: { value: 1 },
    uTime: { value: 0 },
  };
  private density: Uint8Array;
  private material: Uint8Array;
  private dirty = false;
  readonly w: number;
  readonly h: number;

  constructor(
    private world: ChunkManager,
    readonly box: SliceBox,
  ) {
    this.w = box.x1 - box.x0;
    this.h = box.y1 - box.y0;
    this.density = new Uint8Array(this.w * this.h);
    this.material = new Uint8Array(this.w * this.h);
    for (let i = 0; i < PALETTE; i++) {
      const m = MATERIALS[i];
      this.uniforms.uPalette.value.push(new THREE.Color(m ? m.color : 0x444444));
      this.uniforms.uGlow.value[i] = m?.glow ?? 0;
    }
    this.uniforms.uOrigin.value.set(box.x0, box.y0);
    this.uniforms.uSize.value.set(this.w, this.h);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xy;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDensity;
        uniform sampler2D uMaterial;
        uniform vec3 uPalette[${PALETTE}];
        uniform float uGlow[${PALETTE}];
        uniform vec2 uOrigin;
        uniform vec2 uSize;
        uniform float uBlur;
        uniform float uGain;
        uniform float uTime;
        varying vec2 vW;
        ${NOISE_GLSL}
        vec2 uvOf(vec2 w) { return (w - uOrigin + 0.5) / uSize; }
        float dens(vec2 w) { return texture2D(uDensity, uvOf(w)).r; }
        // the material grid is 1 m: warp the lookup a little so layer and ore edges read as rock, not pixels
        int matId(vec2 w) {
          vec2 warp = vec2(nzValue2(w * 0.45) - 0.5, nzValue2(w * 0.45 + 17.3) - 0.5) * 1.8;
          return int(texture2D(uMaterial, uvOf(w + warp)).r * 255.0 + 0.5);
        }
        vec3 rock(vec2 w, out float glow) {
          int id = matId(w);
          vec3 c = uPalette[0];
          float g = 0.0;
          for (int i = 0; i < ${PALETTE}; i++) if (i == id) { c = uPalette[i]; g = uGlow[i]; }
          float n = nzFbm2(w * 0.32);
          float fleck = step(0.86, nzHash12(floor(w * 2.0)));
          c *= 0.82 + 0.3 * n;
          c *= 1.0 - fleck * 0.18;
          // ore and glowing rock pulse a little
          glow = g;
          return c;
        }
        void main() {
          vec2 w = vW;
          // vertical motion blur: average the cut along y while the camera moves fast
          float d = 0.0;
          vec3 col = vec3(0.0);
          float glow = 0.0;
          const int N = 12;
          float jit = nzHash12(gl_FragCoord.xy);
          for (int i = 0; i < N; i++) {
            float o = ((float(i) + jit) / float(N) - 0.5) * uBlur;
            vec2 p = w + vec2(0.0, o);
            float g;
            col += rock(p, g);
            glow += g;
            d += dens(p);
          }
          col /= float(N);
          glow /= float(N);
          d /= float(N);
          float iso = 128.0 / 255.0;
          if (d < iso) discard;
          // soft shade toward every cave edge, an ink line on the edge itself, a lit lip on top of an opening
          float aa = fwidth(d) * 1.2 + 1e-4;
          float near = min(min(dens(w + vec2(1.4, 0.0)), dens(w - vec2(1.4, 0.0))), min(dens(w + vec2(0.0, 1.4)), dens(w - vec2(0.0, 1.4))));
          float far = min(min(dens(w + vec2(3.2, 0.0)), dens(w - vec2(3.2, 0.0))), min(dens(w + vec2(0.0, 3.2)), dens(w - vec2(0.0, 3.2))));
          float shade = mix(0.58, 1.0, smoothstep(iso, iso + 0.25, near)) * mix(0.82, 1.0, smoothstep(iso, iso + 0.3, far));
          float ink = 1.0 - smoothstep(iso, iso + aa * 2.5 + 0.03, d);
          float lip = (1.0 - smoothstep(iso - 0.05, iso + 0.1, dens(w + vec2(0.0, 0.9)))) * (1.0 - ink);
          col *= shade;
          col += col * lip * 0.35;
          col = mix(col, vec3(0.05, 0.035, 0.04), ink * 0.85);
          col += col * glow * (2.2 + 0.6 * sin(uTime * 2.0 + w.x * 0.2));
          gl_FragColor = vec4(col * uGain, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), mat);
    this.mesh.position.set(box.x0 - 0.5 + this.w / 2, box.y0 - 0.5 + this.h / 2, box.z + 0.18);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noClip = true;
    this.mesh.updateMatrixWorld(true);
  }

  /** Reads the cut layer from the world (edited chunks) or the generator (all others) into the textures. */
  build(): void {
    const { x0, y0, z } = this.box;
    const cz = Math.floor(z / Q);
    const lz = z - cz * Q;
    const W = this.w;
    const H = this.h;
    for (let cy = Math.floor(y0 / Q); cy * Q < y0 + H; cy++)
      for (let cx = Math.floor(x0 / Q); cx * Q < x0 + W; cx++) {
        const c = this.world.chunks.get(chunkKey(cx, cy, cz)) ?? generateChunk(cx, cy, cz);
        for (let ly = 0; ly < Q; ly++) {
          const y = cy * Q + ly - y0;
          if (y < 0 || y >= H) continue;
          for (let lx = 0; lx < Q; lx++) {
            const x = cx * Q + lx - x0;
            if (x < 0 || x >= W) continue;
            const k = lx + Q * (ly + Q * lz);
            this.density[x + y * W] = c.density[k];
            this.material[x + y * W] = c.material[k];
          }
        }
      }
    this.open(2);
    this.dropIslands(120);
    // air cells take a solid neighbour's material, so linear density edges never show black fringes
    const m = this.material;
    for (let pass = 0; pass < 2; pass++)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = x + y * W;
          if (m[i]) continue;
          const n = (x > 0 && m[i - 1]) || (x < W - 1 && m[i + 1]) || (y > 0 && m[i - W]) || (y < H - 1 && m[i + W]) || 0;
          if (n) m[i] = n;
        }
    const tex = (data: Uint8Array, linear: boolean) => {
      const t = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
      t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.uniforms.uDensity.value = tex(this.density, true);
    this.uniforms.uMaterial.value = tex(this.material, false);
  }

  /**
   * Morphological opening of the solid mask (erode, then dilate, by r cells): spikes, strands and bridges
   * thinner than about 2r metres that the cut grazes become air, so the caverns open cleanly.
   */
  private open(r: number): void {
    const W = this.w;
    const H = this.h;
    const d = this.density;
    const solid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) solid[i] = d[i] > 128 ? 1 : 0;
    const pass = (src: Uint8Array, keep: (v: number) => boolean, horizontal: boolean) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let hit = false;
          for (let k = -r; k <= r && !hit; k++) {
            const xx = horizontal ? x + k : x;
            const yy = horizontal ? y : y + k;
            const v = xx < 0 || yy < 0 || xx >= W || yy >= H ? 1 : src[xx + yy * W];
            if (keep(v)) hit = true;
          }
          out[x + y * W] = keep(0) ? (hit ? 0 : 1) : hit ? 1 : 0;
        }
      return out;
    };
    // erode: a cell stays solid only if no air is within r; dilate: solid if any solid is within r
    const eroded = pass(pass(solid, (v) => v === 0, true), (v) => v === 0, false);
    const opened = pass(pass(eroded, (v) => v === 1, true), (v) => v === 1, false);
    for (let i = 0; i < W * H; i++) if (solid[i] && !opened[i]) d[i] = Math.min(d[i], 90);
  }

  /**
   * Loose bits of rock that touch the cut only in a small patch (cave pillars and spikes grazed by it) would
   * float as flat shapes in front of the caverns: patches under `minArea` square metres become air here
   * (the 3D rock behind still shows).
   */
  private dropIslands(minArea: number): void {
    const W = this.w;
    const H = this.h;
    const d = this.density;
    const seen = new Uint8Array(W * H);
    const stack: number[] = [];
    const comp: number[] = [];
    for (let start = 0; start < W * H; start++) {
      if (seen[start] || d[start] <= 128) continue;
      comp.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        comp.push(i);
        if (comp.length > minArea) {
          // big enough: mark the rest of it as seen without collecting
          for (; stack.length; ) {
            const j = stack.pop()!;
            const x = j % W;
            for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W])
              if (n >= 0 && n < W * H && !seen[n] && d[n] > 128) {
                seen[n] = 1;
                stack.push(n);
              }
          }
          break;
        }
        const x = i % W;
        for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W])
          if (n >= 0 && n < W * H && !seen[n] && d[n] > 128) {
            seen[n] = 1;
            stack.push(n);
          }
      }
      if (comp.length <= minArea) for (const i of comp) d[i] = Math.min(d[i], 90);
    }
  }

  solidAt(x: number, y: number): number {
    const ix = Math.round(x - this.box.x0);
    const iy = Math.round(y - this.box.y0);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.density[ix + iy * this.w];
  }

  /** Writes one cell of the cut (density 0..255, material id); flush() sends the changes to the GPU. */
  setCell(x: number, y: number, density: number, material: number): void {
    const ix = Math.round(x - this.box.x0);
    const iy = Math.round(y - this.box.y0);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const i = ix + iy * this.w;
    if (this.density[i] === density && this.material[i] === material) return;
    this.density[i] = density;
    this.material[i] = material;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.uniforms.uDensity.value) this.uniforms.uDensity.value.needsUpdate = true;
    if (this.uniforms.uMaterial.value) this.uniforms.uMaterial.value.needsUpdate = true;
  }

  materialAt(x: number, y: number): number {
    const ix = Math.round(x - this.box.x0);
    const iy = Math.round(y - this.box.y0);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.material[ix + iy * this.w];
  }

  /** Gems on the cut face: one try per cell, inside solid rock, picked by depth like the game's gem slots. */
  scatterGems(field: GemField, surfaceY: (x: number) => number, cell = 6.5, chance = 0.42): void {
    const { x0, x1, y0, y1, z } = this.box;
    let s = 20261113;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const mats = new Map<THREE.Material, THREE.Material>();
    for (let y = y0 + 4; y < y1; y += cell)
      for (let x = x0 + 2; x < x1 - 2; x += cell) {
        const px = x + rnd() * cell;
        const py = y + rnd() * cell;
        const roll = rnd();
        const r = rnd();
        const depth = surfaceY(px) - py;
        if (depth < 3 || roll > chance) continue;
        // keep clear of the edges so a gem never hangs in the air
        if (this.solidAt(px, py) < 200 || this.solidAt(px + 1.2, py) < 160 || this.solidAt(px - 1.2, py) < 160 || this.solidAt(px, py + 1.2) < 160 || this.solidAt(px, py - 1.2) < 160) continue;
        const mid = this.materialAt(px, py);
        if (mid === Mat.Grass || mid === Mat.Dirt) continue;
        const id = pickGemByDepth(depth, r);
        const mesh = field.makeMesh(id);
        // a private material: the film clips the world at the cut, these sit on it and must not be clipped
        const base = mesh.material as THREE.Material;
        let own = mats.get(base);
        if (!own) mats.set(base, (own = base.clone()));
        mesh.material = own;
        mesh.userData.noClip = true;
        mesh.position.set(px, py, z + 0.25);
        mesh.rotation.set(rnd() * 0.8 - 0.4 + Math.PI / 2, rnd() * Math.PI * 2, rnd() * 0.8 - 0.4);
        mesh.scale.multiplyScalar(2.2 + rnd() * 1.4);
        mesh.updateMatrixWorld(true);
        mesh.matrixAutoUpdate = false;
        this.gems.add(mesh);
      }
  }
}
