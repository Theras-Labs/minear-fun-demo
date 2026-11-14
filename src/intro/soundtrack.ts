// The sound track of the MINEAR intro film (src/intro/film.ts), made with the game's own audio engine
// (src/audio, Web Audio, no sound files): its music, boss layer, ambience and one-shot sounds.
// The engine is built on an OfflineAudioContext and stepped at 60 Hz with the film's camera (soundState),
// so the music and the ambience play as they would in the game; each cue (soundCues) fires at its frame.
// The result is a stereo 48 kHz buffer as long as the film; toWav() packs it for the render script.
import { Audio } from '../audio/audio';
import { playBreak } from '../audio/digSounds';
import { FILM_DURATION, type IntroFilm, type SoundCue } from './film';

const RATE = 48_000;
const STEP = 1 / 60;
/** The music bus level at full music: louder than in the game (0.48), where the music stays in the back. */
const MUSIC = 0.9;
/** The block-break sound of the dig kit is made for one block now and then: much softer for five in a row. */
const BREAK = 0.35;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function play(a: Audio, c: SoundCue): void {
  const k = c.k ?? 1;
  switch (c.id) {
    case 'hello':
      a.tutNext();
      return;
    case 'pull':
      a.sweepNoise(0.14, 2.0, 260, 900, 'bandpass', 0.7);
      return;
    case 'dive':
      a.burrowEnter();
      return;
    case 'layer':
      a.tone(1480, 0.3, 0.035, 'sine', 0, 0.985);
      a.noise(0.18, 0.05, 420, 0.8, 'bandpass');
      return;
    case 'rumble':
      a.biomeEvent('rumble', 1);
      return;
    case 'omen':
      a.discover('haunt');
      return;
    case 'beat':
      // a heartbeat: lub, dub
      a.tone(52, 0.55, 0.42 * k, 'sine', 0, 0.55);
      a.noise(0.2, 0.2 * k, 180, 0.7, 'lowpass');
      a.tone(47, 0.45, 0.26 * k, 'sine', 0.17, 0.55);
      return;
    case 'eye':
      a.crystalCharge(1.0, 4);
      return;
    case 'shock':
      a.ultSlam(0);
      a.bombBoom(10);
      a.rockfall(0.8);
      return;
    case 'rise':
      a.breach();
      a.sweepNoise(0.28, 0.9, 220, 2600, 'bandpass', 0.9);
      return;
    case 'roar':
      a.boss('roar', 1);
      return;
    case 'titan':
      a.boss('stomp', 0.8);
      a.boss('roar', 0.9);
      return;
    case 'far':
      a.boss('whoosh', 0.7);
      a.boss('growl', 0.55);
      return;
    case 'far2':
      a.boss('whoosh', 0.6);
      a.boss('roar', 0.4);
      return;
    case 'swish':
      a.boss('whoosh', 0.45);
      return;
    case 'chest':
      a.chestOpen(2);
      return;
    case 'treasure':
      a.gem(3);
      return;
    case 'coin':
      a.coin(k);
      return;
    case 'break': {
      a.crunch(1.6);
      const out = a.digKit.ctx.createGain();
      out.gain.value = BREAK;
      out.connect(a.digKit.out);
      playBreak({ ...a.digKit, out }, { hardness: 1.6, speed: 1 });
      return;
    }
    case 'ore':
      a.pickup();
      return;
    case 'gem':
      a.pickup();
      a.gem(2);
      return;
    case 'burrow':
      a.burrowEnter();
      return;
    case 'up':
      a.sweepNoise(0.2, 1.2, 300, 1600, 'bandpass', 0.8);
      return;
    case 'breach':
      a.breach();
      return;
    case 'land':
      a.land(14);
      return;
    case 'banner':
      a.levelUp();
      return;
    case 'logo':
      a.lodeLand(1);
      a.tone(55, 1.8, 0.35, 'sine', 0, 0.6);
      return;
  }
}

/** Renders the whole sound track of the film, peak-normalised to -1 dBFS. */
export async function renderSoundtrack(film: IntroFilm): Promise<AudioBuffer> {
  const length = Math.ceil(FILM_DURATION * RATE);
  const ctx = new OfflineAudioContext(2, length, RATE);
  const a = new Audio();
  a.start(ctx as unknown as AudioContext);
  a.setMix({ master: 0.9, music: 0.8, sfx: 0.9, ambience: 0.75, muted: false });
  // the rush of air while the camera falls and rises fast
  const rush = ctx.createBufferSource();
  rush.buffer = a.noiseBuf;
  rush.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.6;
  const rushGain = ctx.createGain();
  rushGain.gain.value = 0;
  rush.connect(band).connect(rushGain).connect(a.sfx);
  rush.start(0);
  // fade out with the picture
  a.master.gain.setTargetAtTime(0, FILM_DURATION - 0.7, 0.18);

  const cues = film.soundCues();
  let next = 0;
  // the last step is held a little before the end (a suspend at the very end of the render is refused)
  const steps = Math.floor((FILM_DURATION - 0.01) / STEP);
  const step = (i: number) => {
    const t = i * STEP;
    const now = ctx.currentTime;
    const s = film.soundState(t);
    a.setBiome(s.biome, s.biomeK);
    a.setBoss(s.boss, STEP);
    a.update(STEP, 0, 1, 0, s.under, s.height);
    a.music.gain.setTargetAtTime(MUSIC * s.music, now, 0.2);
    const w = clamp01((s.speed - 15) / 280);
    rushGain.gain.setTargetAtTime(0.3 * w, now, 0.08);
    band.frequency.setTargetAtTime(260 + 1400 * w, now, 0.1);
    while (next < cues.length && cues[next].t < t + STEP) play(a, cues[next++]);
  };
  // each step runs while the render is held at its time, so the engine's own clock reads film time
  const chain = (i: number) => {
    if (i > steps) return;
    ctx
      .suspend(i * STEP)
      .then(() => {
        step(i);
        chain(i + 1);
        return ctx.resume();
      })
      .catch((e) => console.error('soundtrack step', i, e));
  };
  step(0);
  chain(1);
  const buf = await ctx.startRendering();
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
  return buf;
}

/** 16-bit PCM WAV of a buffer, as base64 (for page.evaluate). */
export function toWav(buf: AudioBuffer): string {
  const chs = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * chs * 2));
  const text = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + n * chs * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, chs, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * chs * 2, true);
  out.setUint16(32, chs * 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, n * chs * 2, true);
  const data = [...Array(chs)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chs; c++) {
      out.setInt16(o, Math.round(Math.max(-1, Math.min(1, data[c][i])) * 32767), true);
      o += 2;
    }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
