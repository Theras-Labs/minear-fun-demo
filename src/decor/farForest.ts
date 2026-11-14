// Port of play-inUT-NSi.js lines 37566-37791: the far forest sx. At construction it renders 10 vegetation
// recipes into a 2560x256 impostor atlas (twice: classic look and painterly look) with an offscreen
// orthographic camera, then draws up to 7000 Y-axis billboards in a ring 118..430 around the player. The
// ring is laid out again only after the player moves 40 units. Density follows the biome field.
import * as THREE from 'three';
import { ATMO } from '../render/atmosphere';
import { hash3 } from '../world/rng';
import { WORLD_SEED } from '../world/constants';
import { surfaceHeight } from '../world/generate';
import { forestAt, giantOakRecipe, giantPineRecipe, oakRecipe, pineRecipe, type VegetationRecipe } from './vegetation';
import { createLeafMaterial, createPropMaterial, leafPalette } from './vegetationMaterials';

/** One atlas cell: index and the world width / height the 256x256 cell covers. */
export interface ImpostorKind {
  cell: number;
  w: number;
  h: number;
}

export class FarForest { // sx (37566)
  inner: number;
  outer: number;
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  center = new THREE.Vector2(1e9, 1e9);
  kinds: ImpostorKind[] = [];
  cellAttr: THREE.InstancedBufferAttribute;
  atlases: THREE.DataTexture[] = [];
  mat: THREE.MeshLambertMaterial;
  painterly = false;

  constructor(renderer: THREE.WebGLRenderer, inner = 118, outer = 430) {
    this.inner = inner;
    this.outer = outer;
    // cells 5, 6, 8 are drawn magenta in the painterly atlas; 7, 8 giant broadleaf; 9 giant pine
    const recipes = [
      oakRecipe(1),
      oakRecipe(2),
      oakRecipe(4, true),
      pineRecipe(6),
      pineRecipe(7),
      oakRecipe(1),
      oakRecipe(4, true),
      giantOakRecipe(20),
      giantOakRecipe(20),
      giantPineRecipe(21),
    ];
    const classic = this.bake(renderer, recipes, 0);
    this.atlases = [classic, this.bake(renderer, recipes, 1)];
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ map: classic, alphaTest: 0.42, color: new THREE.Color(1.3, 1.3, 1.25) });
    this.mat = mat;
    const cells = recipes.length;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          `#include <common>`,
          `#include <common>
attribute float aCell;`,
        )
        .replace(
          `#include <uv_vertex>`,
          `#include <uv_vertex>
          float cellI = aCell;
          float mirror = step(9.5, cellI);
          cellI -= mirror * 10.0;
          vMapUv.x = (mix(vMapUv.x, 1.0 - vMapUv.x, mirror) + cellI) / ${cells.toFixed(1)};`,
        )
        .replace(
          `#include <project_vertex>`,
          `vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);
          vec3 toCam = cameraPosition - base;
          toCam.y = 0.0;
          toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 wp = base + side * transformed.x * sx + vec3(0.0, transformed.y * sy, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;`,
        )
        .replace(
          `#include <normal_vertex>`,
          `#include <normal_vertex>
          {
            vec3 tc = toCamN();
            vec3 sd = normalize(cross(vec3(0.0, 1.0, 0.0), tc));
            vNormal = normalize((viewMatrix * vec4(normalize(sd * position.x * 1.7 + vec3(0.0, 1.0, 0.0) * (position.y - 0.3) * 1.5 + tc * 0.75), 0.0)).xyz);
          }`,
        )
        .replace(
          `void main() {`,
          `vec3 toCamN() {
          vec3 b = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 t = cameraPosition - b;
          t.y = 0.0;
          return normalize(t + vec3(1e-4, 0.0, 0.0));
        }
        void main() {`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <map_fragment>`,
        `#include <map_fragment>
        {
          vec2 dx = dFdx(vMapUv * 256.0), dy = dFdy(vMapUv * 256.0);
          float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + lod * 0.35;
        }`,
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, 7e3);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(7e3), 1);
    geo.setAttribute(`aCell`, this.cellAttr);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** Renders each recipe into a 256x256 cell of a (256 * n) x 256 sRGB atlas. painterly: 0 classic, 1 painterly. */
  bake(renderer: THREE.WebGLRenderer, recipes: VegetationRecipe[], painterly: number): THREE.DataTexture {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(16777215, Math.PI));
    const leafMat = createLeafMaterial();
    const propMat = createPropMaterial();
    const rt = new THREE.WebGLRenderTarget(256, 256, { samples: 4, type: THREE.FloatType });
    const px = new Float32Array(262144);
    const width = 256 * recipes.length;
    const atlas = new Uint8Array(width * 256 * 4);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevFocusW = ATMO.focus.w;
    const prevSun = ATMO.sunColor.clone();
    const prevLook = ATMO.look.x;
    const prevPal = leafPalette.value;
    ATMO.look.x = painterly;
    ATMO.focus.w = 0;
    ATMO.sunColor.setRGB(0, 0, 0);
    renderer.setClearColor(0, 0);
    const toSRGB = (v: number) => {
      v = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(v * 255)));
    };
    const elev = THREE.MathUtils.degToRad(6);
    recipes.forEach((recipe, cell) => {
      leafPalette.value = painterly && (cell === 5 || cell === 6 || cell === 8) ? 1 : 0;
      const tree = new THREE.Group();
      if (recipe.trunk) tree.add(new THREE.Mesh(recipe.trunk, propMat));
      tree.add(new THREE.Mesh(recipe.crown, leafMat));
      scene.add(tree);
      const box = new THREE.Box3().setFromObject(tree);
      const size = box.getSize(new THREE.Vector3());
      const w = Math.max(size.x, size.z) * 1.04;
      const h = size.y * 1.06 + size.z * Math.sin(elev);
      const cy = box.min.y + h / 2 - 0.02;
      const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 200);
      cam.position.set(0, cy + Math.sin(elev) * 50, Math.cos(elev) * 50);
      cam.lookAt(0, cy, 0);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, 256, 256, px);
      scene.remove(tree);
      // average opaque colour, used to fill the transparent pixels (so mipmaps do not bleed dark edges)
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let e = 0; e < 262144; e += 4)
        if (px[e + 3] > 0.5) {
          sr += px[e] / px[e + 3];
          sg += px[e + 1] / px[e + 3];
          sb += px[e + 2] / px[e + 3];
          n++;
        }
      const fill = [toSRGB(sr / Math.max(1, n)), toSRGB(sg / Math.max(1, n)), toSRGB(sb / Math.max(1, n))];
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const src = (y * 256 + x) * 4;
          const dst = (y * width + cell * 256 + x) * 4;
          const a = Math.min(1, px[src + 3]);
          const inside = x >= 6 && x < 250 && y < 250;
          if (a > 0.02) {
            const k = 1 / a;
            atlas[dst] = toSRGB(px[src] * k);
            atlas[dst + 1] = toSRGB(px[src + 1] * k);
            atlas[dst + 2] = toSRGB(px[src + 2] * k);
          } else {
            atlas[dst] = fill[0];
            atlas[dst + 1] = fill[1];
            atlas[dst + 2] = fill[2];
          }
          atlas[dst + 3] = inside ? Math.round(Math.min(1, a * 1.25) * 255) : 0;
        }
      if (!painterly) this.kinds.push({ cell, w, h });
    });
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    ATMO.focus.w = prevFocusW;
    ATMO.sunColor.copy(prevSun);
    ATMO.look.x = prevLook;
    leafPalette.value = prevPal;
    rt.dispose();
    leafMat.dispose();
    propMat.dispose();
    const tex = new THREE.DataTexture(atlas, width, 256, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  /** Swaps the atlas and forces a new layout. */
  setPainterly(on: boolean): void {
    if (on !== this.painterly) {
      this.painterly = on;
      this.mat.map = this.atlases[+!!on];
      this.center.set(1e9, 1e9);
    }
  }

  /** Lays out the billboard ring again when the player is 40 units from the last layout centre. */
  update(pos: THREE.Vector3): void {
    if (Math.hypot(pos.x - this.center.x, pos.z - this.center.y) < 40) return;
    this.center.set(pos.x, pos.z);
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const outer = this.outer;
    const in2 = this.inner * this.inner;
    const out2 = outer * outer;
    let c = 0;
    const max = this.mesh.instanceMatrix.count;
    const gx0 = Math.floor((pos.x - outer) / 9);
    const gx1 = Math.ceil((pos.x + outer) / 9);
    const gz0 = Math.floor((pos.z - outer) / 9);
    const gz1 = Math.ceil((pos.z + outer) / 9);
    for (let gz = gz0; gz <= gz1 && c < max; gz++)
      for (let gx = gx0; gx <= gx1 && c < max; gx++) {
        const l = hash3(gx, 4242, gz, WORLD_SEED);
        const x = (gx + (l & 255) / 255) * 9;
        const z = (gz + ((l >>> 8) & 255) / 255) * 9;
        const d2 = (x - pos.x) ** 2 + (z - pos.z) ** 2;
        if (d2 < in2 || d2 > out2) continue;
        const biome = forestAt(x, z);
        if (
          (!biome.forest && ((l >>> 16) & 255) > 14) ||
          (biome.forest && ((l >>> 20) & 255) > (this.painterly ? 85 : 150)) ||
          Math.hypot(x, z) < 15
        )
          continue;
        let kind: ImpostorKind | undefined = this.kinds[biome.pine ? 3 + ((l >>> 3) & 1) : (l >>> 5) % 3];
        if (!kind) continue;
        const g = hash3(gx, 4243, gz, WORLD_SEED);
        const giant = this.painterly && (g >>> 0) % 8 == 0 && Math.hypot(x, z) > 37;
        if (giant) kind = this.kinds[biome.pine ? 9 : (g >>> 8) & 7 ? 7 : 8];
        else if (this.painterly && !biome.pine && !((l >>> 13) & 7)) kind = this.kinds[kind.cell === 2 ? 6 : 5];
        const v = (g >>> 16) & 255;
        const s = giant
          ? v < 85
            ? 0.95 + (v / 85) * 0.2
            : 0.55 + ((v - 85) / 170) * 0.25
          : (0.85 + (((l >>> 24) & 255) / 255) * 0.45) * (this.painterly ? 1.5 : 1);
        scale.set(kind.w * s, kind.h * s, 1);
        m.compose(at.set(x, surfaceHeight(x, z) - 0.25, z), q, scale);
        this.mesh.setMatrixAt(c, m);
        this.cellAttr.setX(c, kind.cell + ((l >>> 11) & 1 ? 10 : 0));
        c++;
      }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
  }
}
