// MINEAR digging sound candidates. nearmol burrows with its claws, so the drill motor sound must go.
// The game does not use these yet: the /dev/sound page plays them so the owner can choose one. Each sound
// is made with Web Audio (no sound files), from short noise grains, pings and thuds on a beat.

/** Inputs of a dig sound. */
export interface DigParams {
  /** Material hardness from the material table (Dirt 1 .. Heartstone 44). */
  hardness: number;
  /** Dig rate multiplier (0.5 .. 2). */
  speed: number;
}

/** Shared nodes and buffers of one AudioContext. */
export interface DigKit {
  ctx: BaseAudioContext;
  /** Dry input of the output chain. */
  out: AudioNode;
  white: AudioBuffer;
  brown: AudioBuffer;
}

/** A playing loop (held mouse button). */
export interface DigVoice {
  set(p: DigParams): void;
  stop(): void;
}

export interface DigSound {
  id: string;
  name: string;
  blurb: string;
  /** Output level, so that all candidates sound about as loud (RMS near 0.07 at Abyssal Rock). */
  level: number;
  /** Beats per second at these inputs (no beat: only a bed). */
  rate?(p: DigParams): number;
  /** One beat at time t (n counts the beats). */
  hit?(kit: DigKit, t: number, p: DigParams, n: number): void;
  /** A continuous layer under the beats. */
  bed?(kit: DigKit, p: DigParams): DigVoice;
}

/** 0 (soft soil) .. 1 (Heartstone) on a log scale of the material hardness. */
export const hardK = (hardness: number): number =>
  Math.min(1, Math.max(0, Math.log(Math.max(1, hardness)) / Math.log(44)));

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Makes the shared kit: white and brown noise buffers, a light reverb and a limiter before `dest`. `bare` skips
 * the reverb and the limiter (the game's sfx bus has both).
 */
export function makeDigKit(ctx: BaseAudioContext, dest: AudioNode, bare = false): DigKit {
  const len = ctx.sampleRate * 2;
  const white = ctx.createBuffer(1, len, ctx.sampleRate);
  const brown = ctx.createBuffer(1, len, ctx.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    w[i] = Math.random() * 2 - 1;
    last = (last + 0.02 * w[i]) / 1.02;
    b[i] = last * 3.5;
  }
  if (bare) {
    const out = ctx.createGain();
    out.connect(dest);
    return { ctx, out, white, brown };
  }
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 12;
  limiter.knee.value = 0;
  limiter.attack.value = 0.001;
  limiter.connect(dest);
  const out = ctx.createGain();
  out.connect(limiter);
  // the game's reverb: 2.4 s noise impulse, (1 - t)^3, a low wet level
  const verb = ctx.createConvolver();
  const irLen = ctx.sampleRate * 2.4;
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 3;
  }
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.12;
  out.connect(verb).connect(wet).connect(limiter);
  return { ctx, out, white, brown };
}

interface GrainOpts {
  type?: BiquadFilterType;
  freq: number;
  /** Filter frequency at the end of the grain. */
  to?: number;
  q?: number;
  attack?: number;
  dur: number;
  gain: number;
  pan?: number;
  buf?: AudioBuffer;
}

/** A filtered noise grain. */
function grain(kit: DigKit, t: number, o: GrainOpts) {
  const { ctx } = kit;
  const buf = o.buf ?? kit.white;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? `bandpass`;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0008, t + a + o.dur);
  let node: AudioNode = src.connect(f).connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(kit.out);
  src.start(t, Math.random() * (buf.duration - 0.5));
  src.stop(t + a + o.dur + 0.05);
}

/** A short tone that falls in pitch (thud) or rings (ping). */
function tone(kit: DigKit, t: number, o: { from: number; to?: number; dur: number; gain: number; type?: OscillatorType; pan?: number }) {
  const { ctx } = kit;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? `sine`;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
  let node: AudioNode = osc.connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(kit.out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/** One claw stroke: a noise scrape whose band slides down. Paws alternate left and right. */
function scratch(kit: DigKit, t: number, k: number, n: number, gain: number) {
  const paw = n % 2 ? 1 : -1;
  const f = (1500 + 2300 * k) * (paw > 0 ? 1.08 : 0.93) * rand(0.9, 1.1);
  grain(kit, t, { freq: f, to: f * 0.62, q: 1.4, attack: 0.004, dur: 0.075 - 0.03 * k, gain, pan: paw * 0.25 });
}

/** A handful of soil: many tiny grains and a soft low "shh". */
function crunch(kit: DigKit, t: number, k: number, gain: number) {
  const count = 7 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++)
    grain(kit, t + Math.random() * 0.07, {
      freq: rand(500, 1300) * (1 + 1.8 * k),
      q: 3,
      attack: 0.001,
      dur: rand(0.006, 0.018),
      gain: rand(0.25, 0.6) * gain,
      pan: rand(-0.3, 0.3),
    });
  grain(kit, t, { type: `lowpass`, freq: 700 + 900 * k, q: 0.7, attack: 0.01, dur: 0.14, gain: 0.35 * gain });
}

/** Small stones that click as they fall. */
function pebbles(kit: DigKit, t: number, k: number, gain: number) {
  const count = 1 + Math.floor(Math.random() * (1 + 3 * k));
  for (let i = 0; i < count; i++) {
    const at = t + rand(0.02, 0.14);
    tone(kit, at, { from: rand(1800, 4200), dur: rand(0.02, 0.05), gain: rand(0.05, 0.12) * gain, type: `triangle`, pan: rand(-0.4, 0.4) });
    grain(kit, at, { freq: rand(3000, 6000), q: 4, attack: 0.001, dur: 0.008, gain: 0.25 * gain });
  }
}

/** A claw hits hard rock: a sharp click, a low knock and chips. */
function chip(kit: DigKit, t: number, k: number, gain: number) {
  grain(kit, t, { freq: 2400 + 2200 * k, q: 7, attack: 0.001, dur: 0.03, gain: 0.9 * gain });
  tone(kit, t, { from: 140, to: 55, dur: 0.09, gain: 0.35 * gain });
  const count = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++)
    grain(kit, t + rand(0.02, 0.08), { freq: rand(3000, 6500), q: 5, attack: 0.001, dur: rand(0.005, 0.012), gain: rand(0.2, 0.45) * gain, pan: rand(-0.4, 0.4) });
}

/** A low earth rumble that swells on the dig beat. */
function rumbleBed(kit: DigKit, p: DigParams, level: number): DigVoice {
  const { ctx } = kit;
  const src = ctx.createBufferSource();
  src.buffer = kit.brown;
  src.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = `lowpass`;
  const amp = ctx.createGain();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  depth.gain.value = level * 0.45;
  lfo.connect(depth).connect(amp.gain);
  src.connect(low).connect(amp).connect(kit.out);
  const set = (q: DigParams) => {
    const k = hardK(q.hardness);
    low.frequency.setTargetAtTime(160 + 260 * k, ctx.currentTime, 0.05);
    lfo.frequency.setTargetAtTime(2.2 * q.speed, ctx.currentTime, 0.05);
    amp.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
  };
  set(p);
  src.start();
  lfo.start();
  return {
    set,
    stop() {
      amp.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      src.stop(ctx.currentTime + 0.3);
      lfo.stop(ctx.currentTime + 0.3);
    },
  };
}

/** The sound the game plays (MINEAR picked the Mole mix on 2026-11-10). */
export const GAME_DIG_SOUND = `mole`;

/** The candidates, in the order the dev page lists them. */
export const DIG_SOUNDS: DigSound[] = [
  {
    id: `drill`,
    level: 0.55,
    name: `Drill motor (the game now)`,
    blurb: `The current sound, for comparison: a motor hum and a noise band that rise with hardness.`,
    bed(kit, p) {
      const { ctx } = kit;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const band = ctx.createBiquadFilter();
      band.type = `bandpass`;
      band.Q.value = 0.9;
      const src = ctx.createBufferSource();
      src.buffer = kit.white;
      src.loop = true;
      src.connect(band).connect(gain);
      const saw = ctx.createOscillator();
      saw.type = `sawtooth`;
      const sq = ctx.createOscillator();
      sq.type = `square`;
      const low = ctx.createBiquadFilter();
      low.type = `lowpass`;
      low.frequency.value = 420;
      const motor = ctx.createGain();
      motor.gain.value = 0.24;
      saw.connect(low);
      sq.connect(low);
      low.connect(motor).connect(gain);
      gain.connect(kit.out);
      let cur = p;
      const set = (q: DigParams) => {
        cur = q;
      };
      const step = () => {
        const now = ctx.currentTime;
        const pitch = 54 + Math.min(cur.hardness, 12) * 3.5 + Math.random() * 4;
        saw.frequency.setTargetAtTime(pitch, now, 0.05);
        sq.frequency.setTargetAtTime(pitch * 0.5, now, 0.05);
        band.frequency.setTargetAtTime(280 + Math.min(cur.hardness, 12) * 45, now, 0.05);
        gain.gain.setTargetAtTime(0.19 * 2.5, now, 0.04);
      };
      step();
      const timer = setInterval(step, 50);
      src.start();
      saw.start();
      sq.start();
      return {
        set,
        stop() {
          clearInterval(timer);
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
          for (const s of [src, saw, sq]) s.stop(ctx.currentTime + 0.3);
        },
      };
    },
  },
  {
    id: `scratch`,
    level: 3.2,
    name: `Claw scratch`,
    blurb: `Fast strokes of the two paws in turn, left and right. Brighter and shorter in hard rock.`,
    rate: (p) => (7 + 2 * hardK(p.hardness)) * p.speed,
    hit: (kit, t, p, n) => scratch(kit, t, hardK(p.hardness), n, 0.55),
  },
  {
    id: `crunch`,
    level: 3.2,
    name: `Soil crunch`,
    blurb: `Handfuls of earth: many small grains and a soft low rush. Best for dirt and sandstone.`,
    rate: (p) => (5.5 + hardK(p.hardness)) * p.speed,
    hit: (kit, t, p) => crunch(kit, t, hardK(p.hardness), 1),
  },
  {
    id: `pebbles`,
    level: 3.8,
    name: `Soil and pebbles`,
    blurb: `The soil crunch with small stones that click as they fall. More stones in harder rock.`,
    rate: (p) => (5.5 + hardK(p.hardness)) * p.speed,
    hit(kit, t, p) {
      const k = hardK(p.hardness);
      crunch(kit, t, k, 0.75);
      pebbles(kit, t, k, 1);
    },
  },
  {
    id: `chip`,
    level: 1.6,
    name: `Rock chip`,
    blurb: `Claws strike hard rock: a sharp click, a low knock and flying chips. Slower beats.`,
    rate: (p) => (4 + 1.5 * hardK(p.hardness)) * p.speed,
    hit: (kit, t, p) => chip(kit, t, hardK(p.hardness), 1),
  },
  {
    id: `rumble`,
    level: 0.62,
    name: `Burrow rumble`,
    blurb: `A low earth rumble with soft thumps, as the body pushes through the ground.`,
    rate: (p) => 2.2 * p.speed,
    hit(kit, t, p) {
      const k = hardK(p.hardness);
      tone(kit, t, { from: 90, to: 45, dur: 0.18, gain: 0.3 });
      grain(kit, t, { type: `lowpass`, freq: 300 + 300 * k, q: 0.7, attack: 0.02, dur: 0.2, gain: 0.4 });
    },
    bed: (kit, p) => rumbleBed(kit, p, 0.5),
  },
  {
    id: `mole`,
    level: 1.8,
    name: `Mole mix`,
    blurb: `Claw strokes with soil in soft ground, turning to chips in hard rock, over a quiet rumble.`,
    rate: (p) => (6 + 2 * hardK(p.hardness)) * p.speed,
    hit(kit, t, p, n) {
      const k = hardK(p.hardness);
      scratch(kit, t, k, n, 0.4);
      if (Math.random() > k) crunch(kit, t + 0.01, k, 0.7);
      if (n % 2 === 0 && Math.random() < k) chip(kit, t + 0.02, k, 0.6);
      if (Math.random() < 0.35) pebbles(kit, t, k, 0.6);
    },
    bed: (kit, p) => rumbleBed(kit, p, 0.15),
  },
];

/** Starts a loop of one candidate. */
export function startDig(base: DigKit, sound: DigSound, p: DigParams): DigVoice {
  let cur = p;
  const level = base.ctx.createGain();
  level.gain.value = sound.level;
  level.connect(base.out);
  const kit: DigKit = { ...base, out: level };
  const bed = sound.bed?.(kit, p) ?? null;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (sound.rate && sound.hit) {
    let next = kit.ctx.currentTime + 0.03;
    let n = 0;
    const tick = () => {
      // schedule 120 ms ahead; a little timing jitter keeps the beat from sounding like a machine
      while (next < kit.ctx.currentTime + 0.12) {
        sound.hit!(kit, next, cur, n++);
        next += (1 / Math.max(0.5, sound.rate!(cur))) * rand(0.88, 1.12);
      }
    };
    tick();
    timer = setInterval(tick, 25);
  }
  return {
    set(q) {
      cur = q;
      bed?.set(q);
    },
    stop() {
      if (timer) clearInterval(timer);
      bed?.stop();
      setTimeout(() => level.disconnect(), 600);
    },
  };
}

/** One block of rock breaks: a crumble that falls in pitch, a thud and a few trailing stones. */
export function playBreak(base: DigKit, p: DigParams) {
  const level = base.ctx.createGain();
  level.gain.value = 3;
  level.connect(base.out);
  const kit: DigKit = { ...base, out: level };
  const k = hardK(p.hardness);
  const t = kit.ctx.currentTime + 0.01;
  for (let i = 0; i < 26; i++) {
    const u = i / 26;
    grain(kit, t + u * 0.3 + Math.random() * 0.02, {
      freq: (1800 + 2500 * k) * (1 - u) + (500 + 800 * k) * u,
      q: 2.5,
      attack: 0.001,
      dur: rand(0.01, 0.03),
      gain: rand(0.3, 0.6) * (1 - u * 0.6),
      pan: rand(-0.35, 0.35),
    });
  }
  tone(kit, t, { from: 80, to: 40, dur: 0.2, gain: 0.45 });
  grain(kit, t, { type: `lowpass`, freq: 500 + 700 * k, q: 0.6, attack: 0.005, dur: 0.25, gain: 0.4 });
  pebbles(kit, t + 0.1, k, 1);
  pebbles(kit, t + 0.25, k, 0.7);
}
