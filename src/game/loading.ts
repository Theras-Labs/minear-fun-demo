// Port of play-inUT-NSi.js 75549-75578: the loading screen controller ZR (#loading in index.html).
// `ap` (the platform SDK bridge, 27996-28023) is a no-op stub in the original and is left out.
const el = () => document.getElementById('loading');
let shown = 0; // XR

export const loading = {
  set(progress: number, text?: string) {
    const n = el();
    if (!n) return;
    shown = Math.max(shown, Math.min(1, progress));
    (n.querySelector('.lbar i') as HTMLElement).style.width = `${(4 + shown * 96).toFixed(1)}%`;
    if (text !== undefined) n.querySelector('.ltext')!.textContent = text;
  },
  fail(message: string) {
    const n = el();
    if (!n) return;
    n.classList.add('failed');
    n.querySelector('.ltext')!.textContent = message;
  },
  async done() {
    const n = el();
    if (!n) return;
    this.set(1);
    await new Promise((r) => setTimeout(r, 450));
    n.classList.add('gone');
    await new Promise((r) => setTimeout(r, 750));
    n.remove();
  },
  hide() {
    el()?.remove();
  },
};
