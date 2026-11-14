// /dev/sound: listen to the digging sound candidates (src/audio/digSounds.ts) before one goes into the game.
// Hold a "Hold to dig" button (or turn on Loop), pick the rock, and mark the one you like with "Pick".
import { useEffect, useRef, useState } from 'react';
import { DIG_SOUNDS, makeDigKit, playBreak, startDig, type DigKit, type DigVoice } from '../audio/digSounds';
import './dev.css';

/** Rock layers from the surface down, with their hardness (world/materials.ts). */
const ROCKS = [
  { name: `Dirt`, hardness: 1 },
  { name: `Sandstone`, hardness: 1.6 },
  { name: `Stone`, hardness: 4 },
  { name: `Slate`, hardness: 7 },
  { name: `Abyssal Rock`, hardness: 11 },
  { name: `Obsidian`, hardness: 17 },
  { name: `Emberstone`, hardness: 25 },
  { name: `Voidstone`, hardness: 34 },
  { name: `Heartstone`, hardness: 44 },
];

const PICK_KEY = `minear.digSound`;

function readPick(): string {
  try {
    return localStorage.getItem(PICK_KEY) ?? ``;
  } catch {
    return ``;
  }
}

export function SoundPage() {
  const [rock, setRock] = useState(2);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [playing, setPlaying] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [pick, setPick] = useState(readPick);
  const audio = useRef<{ ctx: AudioContext; kit: DigKit; vol: GainNode } | null>(null);
  const voice = useRef<DigVoice | null>(null);
  const params = { hardness: ROCKS[rock].hardness, speed };

  useEffect(() => {
    document.body.classList.add(`dev`);
    return () => {
      voice.current?.stop();
      void audio.current?.ctx.close();
    };
  }, []);
  useEffect(() => {
    voice.current?.set(params);
  }, [rock, speed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (audio.current) audio.current.vol.gain.value = volume;
  }, [volume]);

  /** The AudioContext starts on the first press (browsers block sound before a user gesture). */
  const kit = () => {
    if (!audio.current) {
      const ctx = new AudioContext();
      const vol = ctx.createGain();
      vol.gain.value = volume;
      vol.connect(ctx.destination);
      audio.current = { ctx, kit: makeDigKit(ctx, vol), vol };
    }
    void audio.current.ctx.resume();
    return audio.current.kit;
  };
  const start = (id: string) => {
    voice.current?.stop();
    const sound = DIG_SOUNDS.find((s) => s.id === id)!;
    voice.current = startDig(kit(), sound, params);
    setPlaying(id);
  };
  const stop = () => {
    voice.current?.stop();
    voice.current = null;
    setPlaying(null);
    setLooping(false);
  };
  const choose = (id: string) => {
    const next = pick === id ? `` : id;
    setPick(next);
    try {
      if (next) localStorage.setItem(PICK_KEY, next);
      else localStorage.removeItem(PICK_KEY);
    } catch {
      /* storage blocked */
    }
  };

  return (
    <div className="dev-sound">
      <header>
        <h1>MINEAR: digging sounds</h1>
        <p>
          nearmol digs with its claws, so the drill motor sound must go. The game still plays the drill motor: none
          of these is in the game yet. Hold a button to dig, choose the rock, then press <b>Pick</b> on the one you
          like. The pick is kept in this browser.
        </p>
        <p className="picked">{pick ? <>Picked: <b>{DIG_SOUNDS.find((s) => s.id === pick)?.name ?? pick}</b></> : `Nothing picked yet.`}</p>
      </header>

      <section className="controls">
        <h2>Rock</h2>
        <div className="row">
          {ROCKS.map((r, i) => (
            <button key={r.name} className={i === rock ? `on` : ``} onClick={() => setRock(i)}>
              {r.name} <small>{r.hardness}</small>
            </button>
          ))}
        </div>
        <div className="sliders">
          <label>
            Dig speed <b>{speed.toFixed(2)}x</b>
            <input type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
          </label>
          <label>
            Volume <b>{Math.round(volume * 100)}%</b>
            <input type="range" min={0} max={1.5} step={0.05} value={volume} onChange={(e) => setVolume(+e.target.value)} />
          </label>
          <button onClick={() => playBreak(kit(), params)}>Block breaks (one shot)</button>
          {playing && <button onClick={stop}>Stop</button>}
        </div>
      </section>

      <section className="cards">
        {DIG_SOUNDS.map((s) => (
          <article key={s.id} className={`${playing === s.id ? `live` : ``} ${pick === s.id ? `picked` : ``}`}>
            <h3>{s.name}</h3>
            <p>{s.blurb}</p>
            <div className="row">
              <button
                className="hold"
                onPointerDown={() => start(s.id)}
                onPointerUp={() => !looping && stop()}
                onPointerLeave={() => playing === s.id && !looping && stop()}
              >
                Hold to dig
              </button>
              <button
                className={looping && playing === s.id ? `on` : ``}
                onClick={() => {
                  if (looping && playing === s.id) stop();
                  else {
                    start(s.id);
                    setLooping(true);
                  }
                }}
              >
                Loop
              </button>
              <button className={pick === s.id ? `on` : ``} onClick={() => choose(s.id)}>
                {pick === s.id ? `Picked` : `Pick`}
              </button>
            </div>
          </article>
        ))}
      </section>
      <a className="back" href="/dev">
        All debug pages
      </a>
    </div>
  );
}
