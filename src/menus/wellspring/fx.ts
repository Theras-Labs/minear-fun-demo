// Port of play-inUT-NSi.js 59080-59332: the Wellspring helpers aN, oN, sN, cN, lN, uN, dN and the full-screen
// 2D canvas FX fN on #shatter canvas.fxc: gem shatter bursts (outlined polygon shards with a highlight), glowing
// sparks (radial gradients; cheap circles in lite mode), expanding rings, motes that close in on a point, and a
// screen shake passed out through onShake. It runs its own requestAnimationFrame loop from start() until stop(),
// and stops drawing while it is empty; the game does not call it per frame.

/** The lite quality is on (html.lite). */
export const isLite = (): boolean => document.documentElement.classList.contains(`lite`); // aN (59080)
/** querySelector. */
export const q = <T extends Element = HTMLElement>(e: ParentNode, t: string): T => e.querySelector(t) as T; // oN (59081)
/** 24-bit int -> #rrggbb. */
export const hexColor = (e: number): string => `#` + e.toString(16).padStart(6, `0`); // sN (59082)
/** Waits e ms. */
export const sleep = (e: number): Promise<void> => new Promise((t) => setTimeout(t, e)); // cN (59083)
/** HTML escape (&, <, >, "). */
export const escapeText = (e: string): string => // lN (59084)
  e.replace(/[&<>"]/g, (e) => ({ '&': `&amp;`, '<': `&lt;`, '>': `&gt;`, '"': `&quot;` })[e as '&']);

/** The Dead Dust skull (banish icon). */
export const SKULL_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.6 1.2 4.4 3 5.4v3.2c0 .8.6 1.3 1.3 1.3h7.4c.7 0 1.3-.5 1.3-1.3v-3.2c1.8-1 3-2.8 3-5.4 0-4.4-3.3-7.6-8-7.6z" fill="currentColor"/><circle cx="8.8" cy="11" r="2.1" fill="#1a1426"/><circle cx="15.2" cy="11" r="2.1" fill="#1a1426"/><path d="M10.6 15.6 L12 13.6 L13.4 15.6 Z" fill="#1a1426"/><path d="M10 18.2v1.6M12 18.2v1.6M14 18.2v1.6" stroke="#1a1426" stroke-width="1.2"/></svg>`; // uN (59086)

/** Moves #rrggbb toward white (t > 0) or black (t < 0) by |t|; returns rgb(). */
export function shade(e: string, t: number): string { // dN (59087)
  const n = parseInt(e.slice(1), 16);
  let r = (n >> 16) & 255,
    i = (n >> 8) & 255,
    a = n & 255;
  const o = t > 0 ? 255 : 0,
    s = Math.abs(t);
  r = Math.round(r + (o - r) * s);
  i = Math.round(i + (o - i) * s);
  a = Math.round(a + (o - a) * s);
  return `rgb(${r},${i},${a})`;
}

export type FxKind = 'spark' | 'shard' | 'ring' | 'mote';

/** One particle. A ring grows by vx; a mote flies from (x, y) to (tx, ty); a shard draws pts (x0, y0, x1, ...). */
export interface FxParticle {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
  age: number;
  pts?: number[];
  tx?: number;
  ty?: number;
}

/** add() input: x and y are needed, the rest has defaults. */
export type FxParticleInit = Partial<FxParticle> & { x: number; y: number };

export class WellFx { // fN (59101)
  onShake: (x: number, y: number) => void;
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  ps: FxParticle[] = [];
  raf = 0;
  last = 0;
  shake = 0;
  idle = !1;

  get dpr(): number {
    return isLite() ? 1 : devicePixelRatio || 1;
  }

  constructor(e: HTMLCanvasElement, t: (x: number, y: number) => void) {
    this.onShake = t;
    this.cv = e;
    this.g = e.getContext(`2d`)!;
  }

  start(): void {
    this.resize();
    this.last = performance.now();
    const e = () => {
      this.raf = requestAnimationFrame(e);
      const t = performance.now(),
        n = Math.min(0.05, (t - this.last) / 1e3);
      this.last = t;
      this.step(n);
    };
    cancelAnimationFrame(this.raf);
    e();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.ps.length = 0;
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  resize(): void {
    const e = this.dpr;
    this.cv.width = Math.round(innerWidth * e);
    this.cv.height = Math.round(innerHeight * e);
  }

  add(e: FxParticleInit): void {
    this.ps.push({
      kind: `spark`,
      vx: 0,
      vy: 0,
      rot: 0,
      vr: 0,
      size: 4,
      color: `#fff`,
      life: 1,
      age: 0,
      ...e,
    });
  }

  /** A shatter at (e, t) in color n with power r: shards, sparks, two rings and a shake. */
  burst(e: number, t: number, n: string, r: number): void {
    const i = [n, shade(n, 0.5), shade(n, -0.25), `#ffffff`],
      a = isLite() ? 0.55 : 1;
    for (let k = 0; k < (38 + r * 10) * a; k++) {
      const ang = Math.random() * Math.PI * 2,
        o = 260 + Math.random() * (520 + r * 90),
        s = 8 + Math.random() * 22,
        c: number[] = [],
        l = 3 + Math.floor(Math.random() * 2);
      for (let v = 0; v < l; v++) {
        const th = (v / l) * Math.PI * 2 + Math.random() * 0.8,
          rad = s * (0.5 + Math.random() * 0.6);
        c.push(Math.cos(th) * rad, Math.sin(th) * rad * (0.6 + Math.random()));
      }
      this.add({
        kind: `shard`,
        x: e,
        y: t,
        vx: Math.cos(ang) * o,
        vy: Math.sin(ang) * o - 180,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 16,
        size: s,
        color: i[k % 3],
        life: 1.1 + Math.random() * 0.8,
        pts: c,
      });
    }
    for (let o = 0; o < (90 + r * 30) * a; o++) {
      const ang = Math.random() * Math.PI * 2,
        s = 120 + Math.random() * (700 + r * 120);
      this.add({
        kind: `spark`,
        x: e,
        y: t,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        size: 2 + Math.random() * 4,
        color: i[(o % 2) * 3] ?? n,
        life: 0.5 + Math.random() * 0.9,
      });
    }
    this.add({ kind: `ring`, x: e, y: t, size: 20, vx: 1500 + r * 250, color: n, life: 0.55 });
    this.add({ kind: `ring`, x: e, y: t, size: 10, vx: 900, color: `#ffffff`, life: 0.4 });
    this.shake = 1 + r * 0.25;
  }

  /** r sparks at (e, t) in color n (every 4th white) at speed about i. */
  pop(e: number, t: number, n: string, r = 30, i = 380): void {
    if (isLite()) r = Math.ceil(r * 0.6);
    for (let a = 0; a < r; a++) {
      const ang = Math.random() * Math.PI * 2,
        o = i * (0.3 + Math.random());
      this.add({
        kind: `spark`,
        x: e,
        y: t,
        vx: Math.cos(ang) * o,
        vy: Math.sin(ang) * o - 60,
        size: 2 + Math.random() * 3.5,
        color: a % 4 == 0 ? `#ffffff` : n,
        life: 0.4 + Math.random() * 0.7,
      });
    }
  }

  /** r motes that start 220..480 px around (e, t) and close in on it. */
  motes(e: number, t: number, n: string, r: number): void {
    for (let k = 0; k < r; k++) {
      const ang = Math.random() * Math.PI * 2,
        d = 220 + Math.random() * 260;
      this.add({
        kind: `mote`,
        x: e + Math.cos(ang) * d,
        y: t + Math.sin(ang) * d,
        tx: e,
        ty: t,
        size: 1.5 + Math.random() * 3,
        color: Math.random() < 0.3 ? `#ffffff` : n,
        life: 0.9,
      });
    }
  }

  step(e: number): void {
    const t = this.g,
      n = this.dpr;
    if (!this.ps.length && this.shake <= 0) {
      if (!this.idle) {
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.clearRect(0, 0, this.cv.width, this.cv.height);
        this.onShake(0, 0);
        this.idle = !0;
      }
      return;
    }
    this.idle = !1;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, this.cv.width, this.cv.height);
    t.setTransform(n, 0, 0, n, 0, 0);
    this.shake = Math.max(0, this.shake - e * 2.6);
    const r = this.shake * this.shake * 14;
    this.onShake((Math.random() - 0.5) * r, (Math.random() - 0.5) * r);
    let i = 0;
    for (const p of this.ps) {
      if (((p.age += e), p.age >= p.life)) continue;
      const u = p.age / p.life;
      if (p.kind === `mote`) {
        const k = u * u,
          mx = p.x + (p.tx! - p.x) * k,
          my = p.y + (p.ty! - p.y) * k;
        t.globalCompositeOperation = `lighter`;
        t.globalAlpha = Math.min(1, u * 3) * (1 - u * 0.3);
        t.fillStyle = p.color;
        t.beginPath();
        t.arc(mx, my, p.size, 0, Math.PI * 2);
        t.fill();
      } else if (p.kind === `ring`) {
        const rad = p.size + p.vx * (1 - (1 - u) ** 2) * 0.5;
        t.globalCompositeOperation = `lighter`;
        t.globalAlpha = 1 - u;
        t.strokeStyle = p.color;
        t.lineWidth = 16 * (1 - u) + 2;
        t.beginPath();
        t.arc(p.x, p.y, rad, 0, Math.PI * 2);
        t.stroke();
      } else if (p.kind === `shard`) {
        p.vy += 1100 * e;
        p.vx *= Math.exp(-e * 0.8);
        p.x += p.vx * e;
        p.y += p.vy * e;
        p.rot += p.vr * e;
        t.globalCompositeOperation = `source-over`;
        t.globalAlpha = Math.min(1, (1 - u) * 2.2);
        t.save();
        t.translate(p.x, p.y);
        t.rotate(p.rot);
        t.beginPath();
        const pts = p.pts!;
        t.moveTo(pts[0], pts[1]);
        for (let v = 2; v < pts.length; v += 2) t.lineTo(pts[v], pts[v + 1]);
        t.closePath();
        t.fillStyle = p.color;
        t.fill();
        t.lineWidth = 2.5;
        t.strokeStyle = `#241712`;
        t.stroke();
        t.globalCompositeOperation = `lighter`;
        t.globalAlpha *= 0.5;
        t.fillStyle = `#ffffff`;
        t.beginPath();
        t.moveTo(pts[0] * 0.5, pts[1] * 0.5);
        t.lineTo(pts[2] * 0.5, pts[3] * 0.5);
        t.lineTo(0, 0);
        t.fill();
        t.restore();
      } else {
        p.vy += 240 * e;
        p.vx *= Math.exp(-e * 2.2);
        p.vy *= Math.exp(-e * 2.2);
        p.x += p.vx * e;
        p.y += p.vy * e;
        t.globalCompositeOperation = `lighter`;
        t.globalAlpha = 1 - u;
        const sz = p.size * (1 - u * 0.5);
        if (isLite()) {
          t.fillStyle = p.color;
          t.globalAlpha = (1 - u) * 0.3;
          t.beginPath();
          t.arc(p.x, p.y, sz * 2.2, 0, Math.PI * 2);
          t.fill();
          t.globalAlpha = 1 - u;
          t.beginPath();
          t.arc(p.x, p.y, sz, 0, Math.PI * 2);
          t.fill();
        } else {
          const grad = t.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 3);
          grad.addColorStop(0, p.color);
          grad.addColorStop(0.35, p.color);
          grad.addColorStop(1, `rgba(0,0,0,0)`);
          t.fillStyle = grad;
          t.fillRect(p.x - sz * 3, p.y - sz * 3, sz * 6, sz * 6);
        }
      }
      this.ps[i++] = p;
    }
    this.ps.length = i;
    t.globalAlpha = 1;
    t.globalCompositeOperation = `source-over`;
  }
}
