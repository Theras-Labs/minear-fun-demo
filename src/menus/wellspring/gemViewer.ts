// Port of play-inUT-NSi.js 58938-59079: the rotating 3D gem viewer iN of the Wellspring.
// A small WebGLRenderer of its own (a second WebGL context, made on the first show) draws the gem that is about
// to shatter, spinning, with an additive edge overlay. Phases: idle, charging (spin, glow and edge flicker rise),
// burst (scales up). On touch it makes no renderer and shows the painted /cards/gem_<id>.webp image instead.
// It runs its own requestAnimationFrame loop from show() until stop(); the game does not call it per frame.
// The scene is its own THREE.Scene with the default matrix auto update (only KR's main scene turns it off).
import * as THREE from 'three';
import { IS_TOUCH } from '../../game/device';
import { gemArtUrl } from './cardFace';

const J = IS_TOUCH; // J

export type GemViewerPhase = 'idle' | 'charging' | 'burst';

export class GemViewer { // iN (58938)
  /** Makes a fresh gem object for an item id (KR: gems.makeMesh). */
  make: (id: string) => THREE.Object3D;
  canvas = document.createElement(`canvas`);
  img = J ? document.createElement(`img`) : null;
  renderer: THREE.WebGLRenderer | null = null;
  failed = false;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(26, 240 / 324, 0.1, 50);
  pivot = new THREE.Group();
  gem: THREE.Object3D | null = null;
  /** The gem's cloned materials (emissive animates) and their first emissive intensities. */
  mats: THREE.MeshStandardMaterial[] = [];
  glow0: number[] = [];
  edges: THREE.LineBasicMaterial | null = null;
  id = ``;
  raf = 0;
  last = 0;
  t = 0;
  phase: GemViewerPhase = `idle`;
  phaseT = 0;

  /** The element to put in the page: the image on touch, else the canvas. */
  get el(): HTMLCanvasElement | HTMLImageElement {
    return this.img ?? this.canvas;
  }

  constructor(e: (id: string) => THREE.Object3D) {
    this.make = e;
    this.canvas.className = `csvg gem3d`;
    if (this.img) {
      this.img.className = `csvg gem3d gemimg`;
      this.img.alt = ``;
      this.img.draggable = !1;
    }
    this.scene.add(new THREE.HemisphereLight(16774368, 4864618, 1.5));
    const t = new THREE.DirectionalLight(16777215, 2.6);
    t.position.set(2, 3, 4);
    const n = new THREE.DirectionalLight(10476799, 1.8);
    n.position.set(-3, 1, -2);
    this.scene.add(t, n, this.pivot);
    this.cam.position.set(0, 0, 5);
    this.cam.lookAt(0, 0, 0);
  }

  /** Shows gem e in the idle phase and starts the loop (touch: sets the image). */
  show(e: string): void {
    if (this.img) {
      if (e !== this.id) this.img.src = gemArtUrl(e);
      this.id = e;
      return;
    }
    if (!this.renderer && !this.failed)
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !0, alpha: !0 });
        this.renderer.setClearColor(0, 0);
        this.renderer.toneMapping = THREE.NeutralToneMapping; // 7
      } catch {
        this.failed = !0;
      }
    if (!this.renderer) return;
    if (e !== this.id) this.setGem(e);
    this.phase = `idle`;
    this.phaseT = 0;
    this.pivot.scale.setScalar(1);
    if (!this.raf) {
      this.last = performance.now();
      const e = () => {
        this.raf = requestAnimationFrame(e);
        const t = performance.now();
        this.frame(Math.min(0.05, (t - this.last) / 1e3));
        this.last = t;
      };
      e();
    }
  }

  charge(): void {
    this.phase = `charging`;
    this.phaseT = 0;
  }

  burst(): void {
    this.phase = `burst`;
    this.phaseT = 0;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Swaps in gem e: clones its materials, adds the 25 degree edge lines, fits it to the view. */
  setGem(e: string): void {
    if (this.gem) {
      this.pivot.remove(this.gem);
      for (const e of this.mats) e.dispose();
      this.edges?.dispose();
    }
    this.mats = [];
    this.glow0 = [];
    this.id = e;
    const t = this.make(e);
    t.position.set(0, 0, 0);
    t.quaternion.identity();
    t.scale.setScalar(1);
    const edges = (this.edges = new THREE.LineBasicMaterial({
      color: 16777215,
      transparent: !0,
      opacity: 0,
      blending: THREE.AdditiveBlending, // 2
      depthWrite: !1,
    }));
    t.traverse((e) => {
      const t = e as THREE.Mesh;
      if (!t.isMesh) return;
      const n = (t.material as THREE.MeshStandardMaterial).clone();
      t.material = n;
      this.mats.push(n);
      this.glow0.push(n.emissiveIntensity);
      t.add(new THREE.LineSegments(new THREE.EdgesGeometry(t.geometry, 25), edges));
    });
    const n = new THREE.Box3().setFromObject(t),
      r = n.getSize(new THREE.Vector3()),
      i = 2.05 / Math.max(r.y, r.x * 0.75, 0.001);
    t.scale.setScalar(i);
    t.position.copy(n.getCenter(new THREE.Vector3())).multiplyScalar(-i);
    this.gem = t;
    this.pivot.add(t);
  }

  /** One frame of the loop (dt capped at 0.05 s by the caller). */
  frame(e: number): void {
    const t = this.renderer;
    if (!t || !this.canvas.isConnected) return;
    const n = Math.min(2, devicePixelRatio || 1),
      r = Math.max(1, Math.round(this.canvas.clientWidth * n)),
      i = Math.max(1, Math.round(this.canvas.clientHeight * n));
    if (this.canvas.width !== r || this.canvas.height !== i) {
      t.setSize(r, i, !1);
      this.cam.aspect = r / i;
      this.cam.updateProjectionMatrix();
    }
    this.t += e;
    this.phaseT += e;
    const a = this.phase,
      o = this.phaseT,
      s = a === `idle` ? 0.55 : a === `charging` ? 0.6 + o * o * 7 : 9;
    this.pivot.rotation.y += e * s;
    this.pivot.rotation.z = Math.sin(this.t * 0.7) * 0.1;
    this.pivot.rotation.x = Math.sin(this.t * 0.45) * 0.08;
    if (a === `burst`) this.pivot.scale.setScalar(1 + o * 2.5);
    const c = a === `charging` ? 1 + 1.4 * Math.min(1, o / 1.1) ** 2 : a === `burst` ? 6 : 1,
      l = 0.9 + 0.1 * Math.sin(this.t * 2.6);
    this.mats.forEach((e, t) => (e.emissiveIntensity = this.glow0[t] * c * l));
    if (this.edges)
      this.edges.opacity =
        a === `charging` ? Math.min(1, o / 0.9) * (0.7 + Math.random() * 0.3) : a === `burst` ? 1 : 0.06;
    t.render(this.scene, this.cam);
  }
}
