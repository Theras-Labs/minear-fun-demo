// Port of play-inUT-NSi.js 35280-35438: terrain BatchedMesh pager.
// Every chunk mesh can go into a few shared BatchedMesh "pages". Geometry slots ("rooms") are sized in classes
// that grow by 1.25x; freed rooms go to a free list per class and are reused. Chunk vertex positions are baked in
// world space, so the batching code in the shader is turned off.
import * as THREE from 'three';
import type { Chunk } from './chunk';

/** cb (35280): vertex capacity of room size class k. */
const roomVerts = (k: number): number => Math.ceil(128 * 1.25 ** k); // cb (35280)
/** lb (35281): index count per vertex used to size rooms. */
const INDEX_PER_VERTEX = 5.5; // lb (35281)
/** ub (35282): index capacity for a vertex capacity. */
const roomIndices = (verts: number): number => Math.ceil(verts * INDEX_PER_VERTEX); // ub (35282)

/** db (35283): smallest room class that holds the vertex and index counts. */
function roomClass(verts: number, indices: number): number { // db (35283)
  const need = Math.max(verts, Math.ceil(indices / INDEX_PER_VERTEX));
  let k = 0;
  for (; roomVerts(k) < need; ) k++;
  return k;
}

const FIRST_PAGE_VERTS = 1 << 18; // fb (35289)
const PAGE_VERTS = 65536; // pb (35290)

/** mb (35291): prepends `#undef USE_BATCHING` (positions are already in world space). */
function unbatched<M extends THREE.Material>(material: M): M { // mb (35291)
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `#undef USE_BATCHING
` + shader.vertexShader;
  };
  material.customProgramCacheKey = () => `unbatched`;
  return material;
}

interface Room {
  page: TerrainBatch;
  room: number;
}

export class TerrainBatch extends THREE.BatchedMesh { // hb (35302)
  shadowless: Chunk[] = [];
  classOfRoom = new Map<number, number>();
  live = 0;
  constructor(maxVerts: number, maxInstances: number, material: THREE.Material, depthMaterial: THREE.Material) {
    super(maxInstances, maxVerts, roomIndices(maxVerts) + (maxVerts >> 7) + 16, material);
    this.name = `terrain`;
    this.frustumCulled = false;
    this.perObjectFrustumCulled = true;
    this.castShadow = true;
    this.receiveShadow = true;
    this.matrixAutoUpdate = false;
    this.customDepthMaterial = depthMaterial;
  }
  override onBeforeShadow(...args: Parameters<THREE.BatchedMesh['onBeforeShadow']>): void {
    const shadowless = this.shadowless;
    for (const c of shadowless) if (c.page === this) this.setVisibleAt(c.inst, false);
    this.sortObjects = false;
    super.onBeforeShadow(...args);
    this.sortObjects = true;
    for (const c of shadowless) if (c.page === this) this.setVisibleAt(c.inst, true);
  }
}

export class TerrainPager { // gb (35323)
  parent: THREE.Object3D;
  material: THREE.Material;
  layer: number;
  pages: TerrainBatch[] = [];
  rooms = new Map<number, Room[]>();
  depth = unbatched(new THREE.MeshDepthMaterial());
  tmp = new THREE.BufferGeometry();
  sphere = new THREE.Sphere();
  scratch = new Float32Array();
  constructor(parent: THREE.Object3D, material: THREE.Material, layer: number) {
    this.parent = parent;
    this.material = material;
    this.layer = layer;
    this.addPage(FIRST_PAGE_VERTS, 1024);
  }
  setMaterial(material: THREE.Material): void {
    this.material = material;
    for (const p of this.pages) p.material = material;
  }
  put(chunk: Chunk, geometry: THREE.BufferGeometry, x: number, y: number, z: number): void {
    const placed = this.placed(geometry, x, y, z);
    const verts = geometry.attributes.position.count;
    const indices = geometry.index!.count;
    const old = chunk.page;
    if (old && roomVerts(old.classOfRoom.get(chunk.room) as number) >= Math.max(verts, Math.ceil(indices / INDEX_PER_VERTEX))) {
      old.setGeometryAt(chunk.room, placed);
      return;
    }
    if (old) this.drop(chunk, false);
    const k = roomClass(Math.ceil(verts * (old ? 1.25 : 1)), indices);
    let slot: Room | null = null;
    for (let i = 0; i < 3 && !slot; i++) slot = this.take(k + i);
    if (slot) slot.page.setGeometryAt(slot.room, placed);
    else {
      const v = roomVerts(k);
      const ix = roomIndices(v);
      const page =
        this.pages.find((p) => p.unusedVertexCount >= v && p.unusedIndexCount >= ix) ?? this.addPage(PAGE_VERTS, 256);
      slot = { page, room: page.addGeometry(placed, v, ix) };
      page.classOfRoom.set(slot.room, k);
    }
    const page = slot.page;
    if (page.instanceCount >= page.maxInstanceCount) page.setInstanceCount(Math.ceil(page.maxInstanceCount * 1.5));
    chunk.inst = page.addInstance(slot.room);
    chunk.room = slot.room;
    chunk.page = page;
    page.live++;
    if (old && old !== page) this.retireIfEmpty(old);
  }
  drop(chunk: Chunk, retire = true): void {
    const page = chunk.page;
    if (!page) return;
    page.deleteInstance(chunk.inst);
    page.live--;
    const k = page.classOfRoom.get(chunk.room) as number;
    let free = this.rooms.get(k);
    if (!free) this.rooms.set(k, (free = []));
    free.push({ page, room: chunk.room });
    chunk.page = null;
    chunk.room = chunk.inst = -1;
    if (retire) this.retireIfEmpty(page);
  }
  mirror(meshes: readonly THREE.Mesh[], shadows: boolean): void {
    for (const p of this.pages) p.shadowless.length = 0;
    for (const m of meshes) {
      const chunk = m.userData.chunk as Chunk;
      const page = chunk.page;
      if (page) {
        page.setVisibleAt(chunk.inst, m.visible);
        if (shadows && m.visible && !m.castShadow) page.shadowless.push(chunk);
      }
    }
  }
  /** Copy of the geometry with positions offset to world space (shared scratch, valid until the next call). */
  placed(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
    const src = geometry.attributes.position.array;
    if (this.scratch.length < src.length) this.scratch = new Float32Array(Math.ceil(src.length * 1.5));
    const dst = this.scratch.subarray(0, src.length);
    for (let i = 0; i < src.length; i += 3) {
      dst[i] = src[i] + x;
      dst[i + 1] = src[i + 1] + y;
      dst[i + 2] = src[i + 2] + z;
    }
    const tmp = this.tmp;
    for (const name in geometry.attributes) tmp.setAttribute(name, geometry.attributes[name]);
    tmp.setAttribute(`position`, new THREE.BufferAttribute(dst, 3));
    tmp.setIndex(geometry.index);
    const s = geometry.boundingSphere!;
    this.sphere.center.set(s.center.x + x, s.center.y + y, s.center.z + z);
    this.sphere.radius = s.radius;
    tmp.boundingSphere = this.sphere;
    tmp.boundingBox = null;
    return tmp;
  }
  /** Reuses a free room of class k from the page with the most live instances. */
  take(k: number): Room | null {
    const free = this.rooms.get(k);
    if (!free?.length) return null;
    let best = 0;
    for (let i = 1; i < free.length; i++) if (free[i].page.live > free[best].page.live) best = i;
    const r = free[best];
    free[best] = free[free.length - 1];
    free.pop();
    return r;
  }
  addPage(verts: number, instances: number): TerrainBatch {
    const page = new TerrainBatch(verts, instances, this.material, this.depth);
    page.layers.enable(this.layer);
    this.pages.push(page);
    this.parent.add(page);
    return page;
  }
  dispose(): void {
    for (const p of this.pages) {
      this.parent.remove(p);
      p.dispose();
    }
    this.pages.length = 0;
    this.rooms.clear();
    this.depth.dispose();
  }
  /** Removes an empty page (never the first page). */
  retireIfEmpty(page: TerrainBatch): void {
    if (page.live > 0 || page === this.pages[0]) return;
    for (const [k, free] of this.rooms)
      this.rooms.set(
        k,
        free.filter((r) => r.page !== page),
      );
    this.pages.splice(this.pages.indexOf(page), 1);
    this.parent.remove(page);
    page.dispose();
  }
}
