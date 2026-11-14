// Port of play-inUT-NSi.js 56349-56380 and 56384-56471: the generative score of the audio engine dM.
// 72 BPM in eighth steps, a 32-step loop with one chord per 8 steps: a detuned pad, a bass root, a fifth on
// step 4 and a random arpeggio note (half of it through the feedback delay). Biome chord sets replace the
// home set when the biome is strong (k > 0.5). A boss layer adds drums and a low sawtooth bass (bossK > 0.03).
import { AudioEngine } from './engine';

export interface Chord {
  root: number;
  notes: number[];
}

export class AudioMusic extends AudioEngine {
  /** dM.CHORDS (56349) */
  static CHORDS: Chord[] = [
    { root: 41, notes: [53, 57, 60, 64] },
    { root: 43, notes: [55, 59, 62, 64] },
    { root: 40, notes: [52, 55, 59, 62] },
    { root: 45, notes: [57, 60, 64, 67] },
  ];

  /** dM.BIOME_CHORDS (56355) */
  static BIOME_CHORDS: Record<string, Chord[]> = {
    ember: [
      { root: 40, notes: [52, 55, 59, 64] },
      { root: 41, notes: [53, 57, 60, 65] },
      { root: 40, notes: [52, 55, 59, 62] },
      { root: 38, notes: [50, 53, 57, 60] },
    ],
    bog: [
      { root: 45, notes: [57, 60, 64, 71] },
      { root: 41, notes: [53, 57, 60, 64] },
      { root: 38, notes: [50, 53, 57, 60] },
      { root: 40, notes: [52, 57, 59, 62] },
    ],
    frost: [
      { root: 48, notes: [60, 64, 67, 71] },
      { root: 53, notes: [65, 69, 72, 78] },
      { root: 45, notes: [57, 64, 67, 71] },
      { root: 43, notes: [55, 62, 65, 69] },
    ],
    haunt: [
      { root: 45, notes: [57, 60, 64, 69] },
      { root: 41, notes: [53, 56, 60, 65] },
      { root: 38, notes: [50, 53, 57, 62] },
      { root: 40, notes: [52, 56, 59, 62] },
    ],
  };

  bossK = 0;
  bossLp: BiquadFilterNode | null = null;

  /** voice (56384): one music note at time `at`, linear attack, release from dur - 0.2 with time constant dur / 4. */
  voice(freq: number, at: number, dur: number, gain: number, type: OscillatorType, attack: number, dest: AudioNode, detune = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.setTargetAtTime(0, at + Math.max(attack, dur - 0.2), dur * 0.25);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + dur * 2 + 0.5);
  }

  /** setBoss (56398): ease the boss layer toward k (fast in, slow out). KR passes 1 while a boss fights. */
  setBoss(k: number, dt: number) {
    this.bossK += (k - this.bossK) * Math.min(1, dt * (k > this.bossK ? 1.2 : 0.4));
    if (this.bossK < 0.002) this.bossK = 0;
  }

  /** drum (56402): a 96 -> 44 Hz sine kick and a low noise thump on the music bus. */
  drum(at: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, at);
    osc.frequency.exponentialRampToValueAtTime(44, at + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.006);
    g.gain.exponentialRampToValueAtTime(1e-4, at + 0.42);
    osc.connect(g).connect(this.music);
    osc.start(at);
    osc.stop(at + 0.5);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.5, at);
    ng.gain.exponentialRampToValueAtTime(1e-4, at + 0.16);
    src.connect(low).connect(ng).connect(this.music);
    src.start(at, Math.random());
    src.stop(at + 0.2);
  }

  /** scheduleMusic (56426): schedule every step that starts in the next 0.3 s. murk lowers the arpeggio rate. */
  scheduleMusic(murk: number) {
    const ctx = this.ctx!;
    const step = 60 / 72 / 2;
    while (this.nextBeat < ctx.currentTime + 0.3) {
      const at = this.nextBeat;
      const a = this.beat % 32;
      const chord = (
        this.biome.id && this.biome.k > 0.5 ? (AudioMusic.BIOME_CHORDS[this.biome.id] ?? AudioMusic.CHORDS) : AudioMusic.CHORDS
      )[Math.floor(a / 8)];
      if (a % 8 === 0) {
        const pad = ctx.createBiquadFilter();
        pad.type = 'lowpass';
        pad.frequency.value = 1100;
        pad.connect(this.music);
        for (const note of chord.notes) {
          this.voice(this.midi(note), at, step * 8, 0.022, 'triangle', 0.9, pad, -6);
          this.voice(this.midi(note), at, step * 8, 0.016, 'sine', 0.9, pad, 7);
        }
        this.voice(this.midi(chord.root), at, step * 5, 0.07, 'sine', 0.08, this.music);
      } else if (a % 8 === 4) this.voice(this.midi(chord.root + 7), at, step * 3, 0.04, 'sine', 0.06, this.music);
      if (this.bossK > 0.03) {
        const k = this.bossK;
        if (a % 2 === 0 || a % 8 === 7) this.drum(at, 0.12 * k * (a % 8 === 0 ? 1.35 : 1));
        if (!this.bossLp) {
          this.bossLp = ctx.createBiquadFilter();
          this.bossLp.type = 'lowpass';
          this.bossLp.frequency.value = 420;
          this.bossLp.connect(this.music);
        }
        this.voice(this.midi(chord.root - 12), at, step * 0.85, 0.035 * k, 'sawtooth', 0.01, this.bossLp);
      }
      if (Math.random() < 0.5 - murk * 0.25 && a % 2 === (this.beat % 64 < 32 ? 0 : 1)) {
        const note = chord.notes[Math.floor(Math.random() * chord.notes.length)] + 12;
        this.voice(this.midi(note), at, 0.5, 0.03, 'triangle', 0.005, this.musicDelay);
        this.voice(this.midi(note), at, 0.5, 0.02, 'triangle', 0.005, this.music);
      }
      this.nextBeat += step;
      this.beat++;
    }
  }
}
