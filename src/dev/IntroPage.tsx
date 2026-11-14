// /dev/intro: the MINEAR intro film (src/intro/film.ts) with its text overlay.
// Preview: plays in real time, with a scrub bar and a jump to each shot; "Sound" renders the sound track
// (src/intro/soundtrack.ts) once and plays it with the picture.
// Capture (?capture): a bare 1920x1080 stage; window.__intro.frame(t) renders one frame at film time t,
// for a headless browser to screenshot frame by frame; window.__intro.soundtrack() gives the sound as a WAV.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FILM_DURATION, FILM_FPS, FILM_H, FILM_W, IntroFilm, loadFilmAssets, type FilmOverlay } from '../intro/film';
import { renderSoundtrack, toWav } from '../intro/soundtrack';
import './dev.css';
// The stylesheet goes in a <style> tag: a production build does not link the CSS of this lazy page by itself.
import introCss from '../intro/intro.css?inline';

const params = new URLSearchParams(location.search);
const capture = params.has('capture');

interface Els {
  stage: HTMLDivElement;
  caption: HTMLDivElement;
  counter: HTMLDivElement;
  layer: HTMLDivElement;
  wipe: HTMLDivElement;
  flash: HTMLDivElement;
  fade: HTMLDivElement;
  banner: HTMLDivElement;
  logo: HTMLDivElement;
  streaks: HTMLCanvasElement;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Vertical speed streaks for the side view: they run up the frame while the camera falls, down while it rises. */
function drawStreaks(c: HTMLCanvasElement, t: number, k: number, dir: number, tint: string) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  if (k <= 0) return;
  g.globalCompositeOperation = 'lighter';
  const H = c.height;
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * c.width;
    const speed = 1.2 + rnd() * 2.2;
    const len = H * (0.12 + rnd() * 0.35) * k;
    const ph = (rnd() + t * speed) % 1;
    const y = dir < 0 ? H + len - ph * (H + 2 * len) : -len + ph * (H + 2 * len);
    const w = 1 + rnd() * 3;
    const grad = g.createLinearGradient(x, y - len / 2, x, y + len / 2);
    const col = rnd() < 0.5 ? tint : '#fff6e5';
    grad.addColorStop(0, '#0000');
    grad.addColorStop(0.5, col);
    grad.addColorStop(1, '#0000');
    g.globalAlpha = (0.2 + 0.5 * k) * (rnd() < 0.3 ? 1 : 0.5);
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y - len / 2);
    g.lineTo(x, y + len / 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function applyOverlay(e: Els, o: FilmOverlay, t: number) {
  e.caption.textContent = o.caption;
  e.caption.style.opacity = String(o.captionK);
  e.caption.style.transform = `translate(-50%, ${(1 - o.captionK) * 14}px)`;
  if (o.counter !== null) {
    e.counter.innerHTML = `${fmt(o.counter)}<small> m</small>`;
    e.counter.style.opacity = String(o.counterK);
  } else e.counter.style.opacity = '0';
  e.layer.textContent = o.layer;
  e.layer.style.opacity = String(o.layerK);
  e.layer.style.color = o.layerTint;
  e.layer.style.transform = `translate(-50%, 0) scale(${1.15 - 0.15 * o.layerK})`;
  if (o.wipe >= 0) {
    e.wipe.style.opacity = String(Math.sin(o.wipe * Math.PI));
    e.wipe.style.top = `${(1 - o.wipe) * FILM_H}px`;
  } else e.wipe.style.opacity = '0';
  e.flash.style.opacity = String(o.flash);
  e.flash.style.background = o.flashColor;
  e.fade.style.opacity = String(o.fade);
  const pop = (k: number) => (k < 1 ? 0.82 + 0.18 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.05 : 1);
  e.banner.textContent = o.banner;
  e.banner.style.opacity = String(o.bannerK);
  e.banner.style.transform = `translate(-50%, 0) scale(${pop(o.bannerK)})`;
  e.logo.style.opacity = String(Math.min(1, o.logo * 1.5));
  e.logo.style.transform = `scale(${pop(o.logo)})`;
  drawStreaks(e.streaks, t, o.speed, o.streakDir, o.layerTint);
}

export function IntroPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const els = useRef<Partial<Els>>({});
  const filmRef = useRef<IntroFilm | null>(null);
  const [status, setStatus] = useState('Loading the game models…');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(!capture && !params.has('paused'));
  const [scale, setScale] = useState(1);
  const [shots, setShots] = useState<{ id: string; at: number }[]>([]);
  const playRef = useRef(playing);
  const timeRef = useRef(0);
  playRef.current = playing;
  const [sound, setSound] = useState<'off' | 'making' | 'on'>('off');
  const audio = useRef<{ ctx: AudioContext; buf: AudioBuffer; src: AudioBufferSourceNode | null } | null>(null);
  /** Restarts the sound at the film time (or stops it when paused or off). */
  const syncSound = (play: boolean) => {
    const a = audio.current;
    if (!a) return;
    a.src?.stop();
    a.src = null;
    if (!play || sound !== 'on') return;
    const src = a.ctx.createBufferSource();
    src.buffer = a.buf;
    src.connect(a.ctx.destination);
    src.start(0, Math.min(timeRef.current, FILM_DURATION - 0.01));
    a.src = src;
  };
  useEffect(() => syncSound(playing), [playing, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.classList.add('dev', 'intro-body');
    const style = document.createElement('style');
    style.textContent = introCss;
    document.head.appendChild(style);
    if (capture) document.body.classList.add('intro-capture');
    const fit = () => setScale(capture ? 1 : Math.min(innerWidth / FILM_W, (innerHeight - 64) / FILM_H));
    fit();
    addEventListener('resize', fit);
    return () => {
      removeEventListener('resize', fit);
      style.remove();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
    const scene = new THREE.Scene();
    (async () => {
      const assets = await loadFilmAssets();
      if (!alive) return;
      setStatus('Building the world…');
      const film = new IntroFilm(renderer, scene, assets);
      filmRef.current = film;
      setShots(film.shots);
      const e = els.current as Els;
      const draw = (t: number) => {
        const o = film.renderAt(t);
        applyOverlay(e, o, t);
      };
      draw(0);
      setStatus('');
      Object.assign(window, {
        __intro: {
          film,
          ready: true,
          duration: FILM_DURATION,
          fps: FILM_FPS,
          /** The sound track as a base64 WAV (48 kHz, stereo, 16 bit). */
          soundtrack: async () => toWav(await renderSoundtrack(film)),
          /** Renders film time t and resolves after the browser has painted it. */
          frame: (t: number) =>
            new Promise<void>((done) => {
              draw(t);
              requestAnimationFrame(() => requestAnimationFrame(() => done()));
            }),
        },
      });
      if (capture) return;
      let last = performance.now();
      const loop = () => {
        if (!alive) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (playRef.current) {
          let t = timeRef.current + dt;
          const wrap = t >= FILM_DURATION;
          if (wrap) t = 0;
          timeRef.current = t;
          if (wrap) syncRef.current(true);
          setTime(t);
          draw(t);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })().catch((err) => {
      console.error(err);
      setStatus(`Failed: ${err?.message ?? err}`);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const syncRef = useRef(syncSound);
  syncRef.current = syncSound;
  const toggleSound = async () => {
    if (sound === 'on') {
      setSound('off');
      return;
    }
    const film = filmRef.current;
    if (!film || sound === 'making') return;
    if (!audio.current) {
      setSound('making');
      const buf = await renderSoundtrack(film);
      audio.current = { ctx: new AudioContext(), buf, src: null };
    }
    await audio.current.ctx.resume();
    setSound('on');
  };

  const seek = (t: number) => {
    timeRef.current = t;
    setTime(t);
    const film = filmRef.current;
    if (film) applyOverlay(els.current as Els, film.renderAt(t), t);
  };

  const ref = <K extends keyof Els>(k: K) => (el: Els[K] | null) => {
    if (el) els.current[k] = el;
  };

  return (
    <>
      <div className="intro-frame" style={{ width: FILM_W * scale, height: FILM_H * scale }}>
        <div className="intro-stage" ref={stageRef} style={{ transform: `scale(${scale})` }}>
          <canvas ref={canvasRef} width={FILM_W} height={FILM_H} className="intro-canvas" />
          <canvas ref={ref('streaks')} width={FILM_W} height={FILM_H} className="intro-streaks" />
          <div className="intro-vignette" />
          <div className="intro-wipe" ref={ref('wipe')} />
          <div className="intro-caption" ref={ref('caption')} />
          <div className="intro-layer" ref={ref('layer')} />
          <div className="intro-counter" ref={ref('counter')} />
          <div className="intro-banner" ref={ref('banner')} />
          <div className="intro-logo" ref={ref('logo')}>
            <img src="/minear-logo.svg" alt="MINEAR" />
          </div>
          <div className="intro-flash" ref={ref('flash')} />
          <div className="intro-fade" ref={ref('fade')} />
          {status && <div className="intro-status">{status}</div>}
        </div>
      </div>
      {!capture && (
        <div className="intro-bar">
          <a href="/dev">debug pages</a>
          <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
          <button onClick={toggleSound}>{sound === 'on' ? 'Sound on' : sound === 'making' ? 'Making sound…' : 'Sound off'}</button>
          <input
            type="range"
            min={0}
            max={FILM_DURATION}
            step={1 / FILM_FPS}
            value={time}
            onChange={(ev) => {
              setPlaying(false);
              seek(+ev.target.value);
            }}
          />
          <span className="intro-time">{time.toFixed(2)} s</span>
          {shots.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setPlaying(false);
                seek(s.at + 0.3);
              }}
            >
              {s.id}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
