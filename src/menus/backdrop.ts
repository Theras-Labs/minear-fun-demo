// Port of play-inUT-NSi.js 68428-68472: the menu backdrop snapshot xL.
// While a panel is open and nothing dangerous is near, KR stops drawing the 3D scene and shows a blurred
// still of the last frame instead (KR.run 71562-71574, ported as presentFrame in src/menus/panels.ts).
// take() halves the WebGL canvas again and again through two ping-pong 2D canvases down to about
// innerWidth / 16, then scales it back up 2x into canvas#backdrop with a dark tint.
// KR makes it first in its constructor (70213: backdrop = new xL(canvas)); the canvas goes right after the
// game canvas (the original CSS gives #backdrop position: fixed, inset 0, and the class `on` fades it in).

export class Backdrop { // xL (68428)
  el = document.createElement(`canvas`);
  a = document.createElement(`canvas`);
  b = document.createElement(`canvas`);
  on = false;

  /** canvas: the game canvas (KR passes renderer.domElement); #backdrop goes right after it. */
  constructor(canvas: HTMLCanvasElement) {
    this.el.id = `backdrop`;
    canvas.after(this.el);
  }

  /** Takes a blurred still of the source canvas (call it in the same task as the draw it copies). */
  take(src: HTMLCanvasElement): void {
    let t = src.width;
    let n = src.height;
    if (!t || !n) return;
    let r: HTMLCanvasElement = src;
    const i = Math.max(40, Math.round(innerWidth / 16));
    let a = false;
    for (; t / 2 >= i; ) {
      const e = a ? this.b : this.a;
      a = !a;
      const w = Math.round(t / 2);
      const h = Math.max(1, Math.round(n / 2));
      e.width = w;
      e.height = h;
      const s = e.getContext(`2d`);
      if (!s) return;
      s.imageSmoothingQuality = `high`;
      s.drawImage(r, 0, 0, t, n, 0, 0, w, h);
      r = e;
      t = w;
      n = h;
    }
    this.el.width = t * 2;
    this.el.height = n * 2;
    const o = this.el.getContext(`2d`);
    if (o) {
      o.imageSmoothingQuality = `high`;
      o.drawImage(r, 0, 0, t, n, 0, 0, t * 2, n * 2);
      o.fillStyle = `rgba(8, 9, 22, 0.2)`;
      o.fillRect(0, 0, t * 2, n * 2);
      this.a.width = this.a.height = this.b.width = this.b.height = 1;
    }
  }

  show(): void {
    this.on = true;
    this.el.classList.add(`on`);
  }

  hide(): void {
    this.on = false;
    this.el.classList.remove(`on`);
  }
}
