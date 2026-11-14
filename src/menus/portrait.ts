// Port of the inventory portrait of the game class KR (play-inUT-NSi.js):
//   70053        UR = 7, the portrait layer; WR (70054) the Vector2 scratch
//   70207-70210  the KR fields portraitCam, portraitR, portraitT, portraitSnapT (here: Portrait.cam, r, t, snapT)
//   70540-70548  the constructor: every node of the miner also goes on layer 7, three lights on layer 7 only ride
//                on the miner (so they light the portrait and nothing else), the portrait camera sees layer 7 only
//   73502-73528  KR.renderPortrait: on desktop, a second WebGLRenderer on the inventory's portrait canvas draws the
//                scene from the portrait camera every frame (layer 7: the miner, its worn gear and the 3 lights)
//   73529-73567  KR.snapPortrait: on touch, 5 times a second the game renderer draws the portrait into the lower
//                left corner of its own canvas, and the 2D canvas copies it from there
// KR calls renderPortrait from drawWorld (71279: first on touch, last on desktop) and, behind the frozen menu
// backdrop, alone (71573); both are in src/menus/panels.ts (drawWorld, presentFrame) through PanelHost.renderPortrait.
//
// Game wiring (the [game] lead):
//   portrait = new Portrait();                         // KR fields 70207-70210
//   dressMiner(game, gearScene);                       // src/menus/wardrobe.ts (70537-70539)
//   portrait.attach(model.root);                       // 70540-70548, right after dressMiner
//   renderPortrait(dt) { this.portrait.render(this, dt); }   // PanelHost.renderPortrait (73502)
import * as THREE from 'three';
import { IS_TOUCH } from '../game/device';

const J = IS_TOUCH; // J

/** UR (70053): the layer the portrait camera sees. */
export const PORTRAIT_LAYER = 7; // UR (70053)

const SIZE = new THREE.Vector2(); // WR (70054)

/** The game (KR) as the portrait reads it. */
export interface PortraitHost {
  /** hP (src/menus/inventory.ts Inventory): open, the page, and its portrait canvas. */
  inv?: { readonly open: boolean; readonly page: string; readonly portrait: HTMLCanvasElement } | null;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** eD (src/miner/rig.ts MinerRig). */
  model: { root: THREE.Object3D };
  player: { yaw: number };
}

/** The KR portrait fields and methods (70207-70210, 70540-70548, 73502-73567). */
export class Portrait {
  /** portraitCam (70207) */
  cam = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  /** portraitR (70208): the desktop portrait renderer, made on the first draw. */
  r: THREE.WebGLRenderer | null = null;
  /** portraitT (70209): the slow turn of the view. */
  t = 0;
  /** portraitSnapT (70210): time to the next touch snapshot. */
  snapT = 0;

  /** KR constructor 70540-70548: the miner on the portrait layer, its portrait lights, the camera's layer. */
  attach(root: THREE.Object3D): void { // KR constructor (70540)
    root.traverse((e) => e.layers.enable(PORTRAIT_LAYER));
    const y = new THREE.DirectionalLight(16773340, 2.8);
    y.position.set(-2, 4, 5);
    const b = new THREE.DirectionalLight(11832575, 2.2);
    b.position.set(3, 2, -4);
    const x = new THREE.HemisphereLight(14674175, 4864602, 1.3);
    for (const e of [y, b, x] as THREE.Light[]) {
      e.layers.set(PORTRAIT_LAYER);
      root.add(e);
      const t = (e as THREE.DirectionalLight).target;
      t && root.add(t);
    }
    this.cam.layers.set(PORTRAIT_LAYER);
  }

  /** KR.renderPortrait (73502): only while the inventory is open on the gear page. */
  render(g: PortraitHost, e: number): void { // KR.renderPortrait (73502)
    if (!g.inv?.open || g.inv.page !== `gear`) return;
    if (J) return this.snap(g, e);
    const t = g.inv.portrait,
      n = t.clientWidth,
      r = t.clientHeight;
    if (n < 10 || r < 10) return;
    if (!this.r) {
      this.r = new THREE.WebGLRenderer({ canvas: t, antialias: !0, alpha: !0 });
      this.r.toneMapping = THREE.NeutralToneMapping; // 7
      this.r.setClearColor(0, 0);
    }
    const i = this.r;
    i.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const a = i.getSize(SIZE);
    ((a.x !== n || a.y !== r) && i.setSize(n, r, !1), (this.t += e));
    const o = this.cam,
      s = g.model.root,
      c = g.player.yaw + Math.sin(this.t * 0.45) * 0.55 + 0.25,
      l = s.position.x,
      u = s.position.y + 0.8,
      d = s.position.z;
    o.aspect = n / r;
    o.fov = 24;
    o.updateProjectionMatrix();
    const f = 1.15 / Math.tan(THREE.MathUtils.degToRad(o.fov / 2));
    o.position.set(l + Math.sin(c) * f, u + 0.3, d + Math.cos(c) * f);
    o.lookAt(l, u, d);
    const p = g.scene.background;
    g.scene.background = null;
    i.render(g.scene, o);
    g.scene.background = p;
  }

  /** KR.snapPortrait (73529): touch, every 0.2 s, through the game renderer and a corner of its canvas. */
  snap(g: PortraitHost, e: number): void { // KR.snapPortrait (73529)
    if (((this.t += e), (this.snapT -= e), this.snapT > 0)) return;
    this.snapT = 0.2;
    const t = g.inv!.portrait,
      n = t.clientWidth,
      r = t.clientHeight;
    if (n < 10 || r < 10) return;
    const i = g.renderer,
      a = i.getPixelRatio(),
      o = i.getDrawingBufferSize(SIZE),
      s = Math.min(2, o.x / n, o.y / r),
      c = Math.floor(n * s),
      l = Math.floor(r * s);
    (t.width !== c || t.height !== l) && ((t.width = c), (t.height = l));
    const u = this.cam,
      d = g.model.root,
      f = g.player.yaw + Math.sin(this.t * 0.45) * 0.55 + 0.25,
      p = d.position.x,
      m = d.position.y + 0.8,
      h = d.position.z;
    u.aspect = n / r;
    u.fov = 24;
    u.updateProjectionMatrix();
    const k = 1.15 / Math.tan(THREE.MathUtils.degToRad(u.fov / 2));
    u.position.set(p + Math.sin(f) * k, m + 0.3, h + Math.cos(f) * k);
    u.lookAt(p, m, h);
    const _ = g.scene.background,
      v = i.getClearColor(new THREE.Color()),
      y = i.getClearAlpha();
    g.scene.background = null;
    i.setRenderTarget(null);
    i.setViewport(0, 0, c / a, l / a);
    i.setScissor(0, 0, c / a, l / a);
    i.setScissorTest(!0);
    i.setClearColor(2760774, 1);
    i.render(g.scene, u);
    i.setScissorTest(!1);
    i.setViewport(0, 0, o.x / a, o.y / a);
    i.setClearColor(v, y);
    g.scene.background = _;
    t.getContext(`2d`)?.drawImage(i.domElement, 0, o.y - l, c, l, 0, 0, c, l);
  }

  /** Not in the original (KR lives for the page): frees the desktop portrait renderer when the game unmounts. */
  dispose(): void {
    this.r?.dispose();
    this.r = null;
  }
}
