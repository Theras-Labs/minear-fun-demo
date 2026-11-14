// MINEAR: frames per second in the top-right corner of the game screen. It counts the frames the browser
// draws (requestAnimationFrame, the same beat as the game loop) and shows the rate twice a second.

/** Adds #fps to `parent` and starts counting; the returned function removes it. */
export function startFpsMeter(parent: HTMLElement = document.getElementById(`ui`) ?? document.body): () => void {
  const el = document.createElement(`div`);
  el.id = `fps`;
  el.title = `Frames per second`;
  parent.appendChild(el);
  let frames = 0;
  let from = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    frames++;
    const span = now - from;
    if (span >= 500) {
      const fps = Math.round((frames * 1000) / span);
      el.textContent = `${fps} FPS`;
      el.className = fps >= 50 ? `ok` : fps >= 30 ? `mid` : `low`;
      frames = 0;
      from = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.remove();
  };
}
