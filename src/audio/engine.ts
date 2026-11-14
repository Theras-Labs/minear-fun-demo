// Port of play-inUT-NSi.js 55864-56115, 56180-56225, 56381-56383 and 57482-57516: the core of the
// procedural audio engine dM (55865-57517). Web Audio only, no sound files.
// Buses: master -> muffle low-pass -> compressor -> destination. The sfx bus (with a convolution reverb send),
// the ambience bus and the music bus (with a feedback delay) feed master.
// Continuous loops built in start(): drill motor, drill-into-air hiss, jetpack, wind, rain (high and low),
// cave drone, water, fire, and the four biome beds (buildBeds).
// One-shot helpers: tone, bell, noise, sweepNoise. Mix: setMuted, setMix, applyMix.
// The AudioContext is made only in start() (KR.start calls it after the Play click). Nothing runs at import time.
import { makeDigKit, type DigKit, type DigVoice } from './digSounds';
import type { Settings } from '../game/settings';

/** uM (55864): pentatonic semitone ladder. */
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

/** The settings fields setMix reads (57503). */
export type AudioMix = Pick<Settings, 'master' | 'music' | 'sfx' | 'ambience' | 'muted'>;

export class AudioEngine {
  // dM (55865)
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  ambience!: GainNode;
  reverb!: ConvolverNode;
  wet!: GainNode;
  noiseBuf!: AudioBuffer;
  /** MINEAR: the claw dig sound (src/audio/digSounds.ts) replaces the drill motor. */
  digKit!: DigKit;
  dig: DigVoice | null = null;
  airGain!: GainNode;
  jetGain!: GainNode;
  jetFilter!: BiquadFilterNode;
  windGain!: GainNode;
  rainGain!: GainNode;
  rainLow!: GainNode;
  caveGain!: GainNode;
  muffle!: BiquadFilterNode;
  music!: GainNode;
  musicDelay!: DelayNode;
  nextBeat = 0;
  beat = 0;
  waterGain: GainNode | null = null;
  fireGain: GainNode | null = null;
  beds: Record<string, GainNode> = {};
  biome: { id: string | null; k: number } = { id: null, k: 0 };
  muted = false;

  /** 55905: resume a suspended context (tab back in front, focus, any input). */
  wake = () => {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) ctx.resume().catch(() => {});
  };

  mix = { master: 0.9, music: 0.85, sfx: 0.9, ambience: 0.7 };

  /**
   * 55914: make the context and every bus and loop. A second call only wakes the context.
   * MINEAR: `given` builds the same graph on a context made by the caller (the intro film renders its sound
   * track on an OfflineAudioContext); no wake listeners are added for it.
   */
  start(given?: AudioContext) {
    if (this.ctx) {
      this.wake();
      return;
    }
    const e = given ?? new AudioContext();
    this.ctx = e;
    if (!given) {
      document.addEventListener('visibilitychange', this.wake);
      addEventListener('pageshow', this.wake);
      addEventListener('focus', this.wake);
      for (const type of ['pointerdown', 'touchend', 'keydown']) addEventListener(type, this.wake, { capture: true, passive: true });
    }

    // master -> muffle -> compressor -> out (55926-55934)
    const comp = e.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = e.createGain();
    this.muffle = e.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18e3;
    this.muffle.Q.value = 0.4;
    this.master.connect(this.muffle).connect(comp).connect(e.destination);
    this.sfx = e.createGain();
    this.sfx.connect(this.master);
    this.ambience = e.createGain();
    this.ambience.connect(this.master);

    // music bus with a 0.42 s feedback delay through a 2200 Hz low-pass (55939-55949)
    this.music = e.createGain();
    this.musicDelay = e.createDelay(1);
    this.musicDelay.delayTime.value = 0.42;
    const feedback = e.createGain();
    feedback.gain.value = 0.32;
    const feedbackLow = e.createBiquadFilter();
    feedbackLow.type = 'lowpass';
    feedbackLow.frequency.value = 2200;
    this.musicDelay.connect(feedbackLow).connect(feedback).connect(this.musicDelay);
    this.musicDelay.connect(this.music);
    this.music.connect(this.master);
    this.nextBeat = e.currentTime + 0.5;

    // 2 s white noise (55951-55953)
    this.noiseBuf = e.createBuffer(1, e.sampleRate * 2, e.sampleRate);
    const noise = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;

    // reverb: 2.4 s stereo noise impulse, decay (1 - t)^3 (55954-55965)
    this.reverb = e.createConvolver();
    const irLength = e.sampleRate * 2.4;
    const ir = e.createBuffer(2, irLength, e.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLength; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLength) ** 3;
    }
    this.reverb.buffer = ir;
    this.wet = e.createGain();
    this.wet.gain.value = 0.15;
    this.sfx.connect(this.reverb);
    this.reverb.connect(this.wet).connect(this.master);

    // MINEAR: no drill motor (55966-55989). nearmol digs with its claws: a beat of claw strokes, soil and chips
    // (DIG_SOUNDS, GAME_DIG_SOUND) through the sfx bus while digging; ambience.update starts and stops it.
    this.digKit = makeDigKit(e, this.sfx, true);

    // drill into air: noise band 1500 Hz with a 13 Hz tremolo (55990-56002)
    this.airGain = e.createGain();
    this.airGain.gain.value = 0;
    const airBand = e.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.frequency.value = 1500;
    airBand.Q.value = 0.8;
    const airTrem = e.createGain();
    airTrem.gain.value = 0.75;
    const tremOsc = e.createOscillator();
    tremOsc.frequency.value = 13;
    const tremDepth = e.createGain();
    tremDepth.gain.value = 0.25;
    tremOsc.connect(tremDepth).connect(airTrem.gain);
    tremOsc.start();
    this.loopNoise().connect(airBand).connect(airTrem).connect(this.airGain).connect(this.sfx);

    // jetpack: low-passed noise (56003-56008)
    this.jetGain = e.createGain();
    this.jetGain.gain.value = 0;
    this.jetFilter = e.createBiquadFilter();
    this.jetFilter.type = 'lowpass';
    this.jetFilter.frequency.value = 600;
    this.loopNoise().connect(this.jetFilter).connect(this.jetGain).connect(this.sfx);

    // wind: noise band 420 Hz swept +-180 Hz by a 0.13 Hz LFO (56009-56019)
    this.windGain = e.createGain();
    this.windGain.gain.value = 0;
    const windBand = e.createBiquadFilter();
    windBand.type = 'bandpass';
    windBand.frequency.value = 420;
    windBand.Q.value = 0.5;
    const windLfo = e.createOscillator();
    windLfo.frequency.value = 0.13;
    const windDepth = e.createGain();
    windDepth.gain.value = 180;
    windLfo.connect(windDepth).connect(windBand.frequency);
    windLfo.start();
    this.loopNoise().connect(windBand).connect(this.windGain).connect(this.ambience);

    // rain: high-passed hiss and a low band (56020-56034)
    this.rainGain = e.createGain();
    this.rainGain.gain.value = 0;
    const rainHigh = e.createBiquadFilter();
    rainHigh.type = 'highpass';
    rainHigh.frequency.value = 900;
    const rainTop = e.createBiquadFilter();
    rainTop.type = 'lowpass';
    rainTop.frequency.value = 6500;
    this.loopNoise().connect(rainHigh).connect(rainTop).connect(this.rainGain).connect(this.ambience);
    this.rainLow = e.createGain();
    this.rainLow.gain.value = 0;
    const rainBand = e.createBiquadFilter();
    rainBand.type = 'bandpass';
    rainBand.frequency.value = 380;
    rainBand.Q.value = 0.7;
    this.loopNoise().connect(rainBand).connect(this.rainLow).connect(this.ambience);

    // cave drone: three sines, each with a slow gain wobble (56035-56051)
    this.caveGain = e.createGain();
    this.caveGain.gain.value = 0;
    for (const f of [55, 82.4, 110.3]) {
      const osc = e.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = e.createGain();
      g.gain.value = 0.05;
      const lfo = e.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.1;
      const depth = e.createGain();
      depth.gain.value = 0.04;
      lfo.connect(depth).connect(g.gain);
      lfo.start();
      osc.connect(g).connect(this.caveGain);
      osc.start();
    }
    this.caveGain.connect(this.ambience);

    // water: two noise bands (56052-56064)
    const water = e.createGain();
    this.waterGain = water;
    water.gain.value = 0;
    for (const [f, q] of [
      [1500, 0.7],
      [480, 1.4],
    ]) {
      const band = e.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = f;
      band.Q.value = q;
      this.loopNoise().connect(band).connect(water);
    }
    water.connect(this.ambience);

    // fire: low-passed noise (56065-56071)
    const fire = e.createGain();
    this.fireGain = fire;
    fire.gain.value = 0;
    const fireLow = e.createBiquadFilter();
    fireLow.type = 'lowpass';
    fireLow.frequency.value = 360;
    this.loopNoise().connect(fireLow).connect(fire);
    fire.connect(this.ambience);

    this.buildBeds();
    this.applyMix();
  }

  /** buildBeds (56075): the ember, bog, frost and haunt beds; biomeSounds fades them. */
  buildBeds() {
    const e = this.ctx!;
    const bed = (id: string) => {
      const g = e.createGain();
      g.gain.value = 0;
      g.connect(this.ambience);
      this.beds[id] = g;
      return g;
    };
    const band = (to: AudioNode, type: BiquadFilterType, freq: number, q: number, gain: number) => {
      const f = e.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = e.createGain();
      g.gain.value = gain;
      this.loopNoise().connect(f).connect(g).connect(to);
      return f;
    };
    const lfo = (param: AudioParam, freq: number, depth: number) => {
      const o = e.createOscillator();
      o.frequency.value = freq;
      const g = e.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
    };
    const ember = bed('ember');
    band(ember, 'lowpass', 90, 0.8, 0.9);
    lfo(band(ember, 'bandpass', 380, 0.6, 0.25).frequency, 0.13, 90);
    const bog = bed('bog');
    band(bog, 'lowpass', 260, 0.7, 0.35);
    lfo(band(bog, 'bandpass', 5200, 9, 0.05).frequency, 7, 300);
    const frost = bed('frost');
    lfo(band(frost, 'bandpass', 950, 7, 0.22).frequency, 0.09, 380);
    band(frost, 'bandpass', 5600, 1.2, 0.03);
    const haunt = bed('haunt');
    const hauntTones: [number, OscillatorType][] = [
      [110, 'triangle'],
      [130.8, 'sine'],
      [164.8, 'sine'],
      [220.4, 'sine'],
    ];
    for (const [f, type] of hauntTones) {
      const o = e.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = e.createGain();
      g.gain.value = 0.035;
      lfo(g.gain, 0.05 + Math.random() * 0.07, 0.03);
      o.connect(g).connect(haunt);
      o.start();
    }
    band(haunt, 'bandpass', 700, 1.6, 0.08);
  }

  /** loopNoise (56180): a looping noise source started at a random offset. */
  loopNoise() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  /** t (56184): the context clock. */
  get t() {
    return this.ctx!.currentTime;
  }

  /** tone (56187): one oscillator, 8 ms attack, exponential decay; glide > 0 bends the pitch to freq * glide. */
  tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, glide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.t + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, s);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), s + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(gain, s + 0.008);
    g.gain.exponentialRampToValueAtTime(1e-4, s + dur);
    osc.connect(g).connect(this.sfx);
    osc.start(s);
    osc.stop(s + dur + 0.05);
  }

  /** bell (56203): three sine partials (1, 2.76, 5.4). */
  bell(freq: number, dur: number, gain: number, delay = 0) {
    this.tone(freq, dur, gain, 'sine', delay);
    this.tone(freq * 2.76, dur * 0.6, gain * 0.35, 'sine', delay);
    this.tone(freq * 5.4, dur * 0.3, gain * 0.15, 'sine', delay);
  }

  /** noise (56208): a filtered noise burst with an exponential decay. */
  noise(dur: number, gain: number, freq: number, q = 1, type: BiquadFilterType = 'lowpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.t + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, s);
    g.gain.exponentialRampToValueAtTime(1e-4, s + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(s, Math.random());
    src.stop(s + dur + 0.05);
  }

  /** semis (56223) */
  semis(freq: number, st: number) {
    return freq * 2 ** (st / 12);
  }

  /** midi (56381) */
  midi(note: number) {
    return 440 * 2 ** ((note - 69) / 12);
  }

  /** sweepNoise (57482): looping noise through a filter swept from `from` to `to` Hz, swelled in and out. */
  sweepNoise(gain: number, dur: number, from: number, to: number, type: BiquadFilterType, q = 0.8) {
    const ctx = this.ctx!;
    const s = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, s);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), s + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, s);
    g.gain.exponentialRampToValueAtTime(gain, s + Math.min(0.15, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.001, s + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(s, Math.random());
    src.stop(s + dur + 0.05);
  }

  /** setMuted (57500) */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMix();
  }

  /** setMix (57503): master/music/sfx/ambience volumes and mute from the settings. */
  setMix(settings: AudioMix) {
    this.mix = { master: settings.master, music: settings.music, sfx: settings.sfx, ambience: settings.ambience };
    this.muted = settings.muted;
    this.applyMix();
  }

  /** applyMix (57508): squared slider curves. */
  applyMix() {
    if (!this.ctx) return;
    const now = this.t;
    const sq = (v: number) => v * v;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85 * sq(this.mix.master), now, 0.03);
    this.music.gain.setTargetAtTime(0.75 * sq(this.mix.music), now, 0.03);
    this.sfx.gain.setTargetAtTime(sq(this.mix.sfx) * 1.2, now, 0.03);
    this.ambience.gain.setTargetAtTime(sq(this.mix.ambience) * 2, now, 0.03);
  }
}
