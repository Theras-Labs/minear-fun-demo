// Port of play-inUT-NSi.js 56472-57084: the one-shot sound effects of the audio engine dM.
// Each one builds fresh oscillators and filtered noise (nothing is pooled). `k` arguments are 0..1 loudness,
// usually from distance to the player; `tier` and `rarity` arguments pick a longer, brighter voicing.
import { PENTATONIC } from './engine';
import { AudioAmbience } from './ambience';

export class AudioSfx extends AudioAmbience {
  /** burrowEnter (56472): a band-passed whoosh falling 1400 -> 160 Hz and a low sine drop. */
  burrowEnter() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.8);
    this.tone(170, 0.7, 0.35, 'sine', 0, 0.3);
  }

  /** breach (56491): a rising whoosh 250 -> 2600 Hz and a late chirp. */
  breach() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.6);
    this.tone(520, 0.12, 0.12, 'sine', 0.25, 1.8);
  }

  /** sonar (56510) */
  sonar() {
    for (let i = 0; i < 3; i++) this.tone(1480, 0.35, 0.05 / (i + 1), 'sine', i * 0.19, 0.985);
  }

  /** sensed (56513): a sonar blip for a gem of rarity index n (1..5). */
  sensed(n: number) {
    this.bell(this.semis(1760, [0, 4, 7, 12, 16, 19][Math.min(n, 5)]), 0.6, 0.035);
  }

  /** crunch (56516): one dig crunch; pitch rises with the material hardness. */
  crunch(hardness: number) {
    this.noise(0.1, 0.14, 220 + Math.random() * 160 + hardness * 30, 1.1, 'bandpass');
  }

  /** clang (56519): the drill hits rock that is too hard. */
  clang() {
    this.tone(470, 0.25, 0.09, 'triangle', 0, 0.9);
    this.tone(700, 0.2, 0.04, 'square', 0, 0.95);
  }

  /** pickup (56523): each pickup inside 1.1 s climbs the pentatonic ladder. */
  pickup() {
    const step = Math.min(this.combo, PENTATONIC.length - 1);
    this.combo++;
    this.comboTimer = 1.1;
    this.tone(this.semis(660, PENTATONIC[step]), 0.12, 0.09, 'triangle');
  }

  /** gem (56529): a gem arpeggio by rarity 0..5; 3 and up add a sub drop and a shimmer. */
  gem(rarity: number) {
    const chords = [
      [0, 7],
      [0, 4, 7],
      [0, 4, 7, 12],
      [0, 4, 7, 11, 14],
      [0, 4, 7, 12, 16, 19],
      [0, 3, 7, 10, 14, 17, 21],
    ];
    chords[Math.min(rarity, chords.length - 1)].forEach((s, i) => this.bell(this.semis(880, s), 0.9 + rarity * 0.3, 0.1, i * 0.06));
    if (rarity >= 3) {
      this.tone(55, 1.2, 0.35, 'sine', 0, 0.5);
      this.noise(1.4, 0.12, 3e3, 0.5, 'highpass', 0.05);
    }
  }

  /** land (56545): landing thump; louder with the landing speed. */
  land(speed: number) {
    const k = Math.min(1, speed / 25);
    this.tone(120, 0.18, 0.25 * k + 0.05, 'sine', 0, 0.4);
    this.noise(0.15, 0.15 * k + 0.03, 400, 0.8);
  }

  /** jump (56550) */
  jump() {
    this.tone(330, 0.12, 0.06, 'triangle', 0, 1.6);
  }

  /** coin (56553) */
  coin(i: number) {
    this.tone(this.semis(1320, PENTATONIC[i % 8]), 0.09, 0.05, 'square');
  }

  /** deposit (56556): a major arpeggio; a sub boom above 500 coins. */
  deposit(value: number) {
    [0, 4, 7, 12].forEach((s, i) => this.bell(this.semis(523, s), 1.2, 0.12, i * 0.08));
    if (value > 500) this.tone(65, 1, 0.3, 'sine', 0, 0.6);
  }

  /** purchase (56560) */
  purchase() {
    [0, 4, 7, 12, 16].forEach((s, i) => this.tone(this.semis(523, s), 0.25, 0.1, 'triangle', i * 0.07));
    this.noise(0.5, 0.08, 5e3, 0.6, 'highpass', 0.3);
  }

  /** deny (56566) */
  deny() {
    this.tone(200, 0.15, 0.1, 'square', 0, 0.7);
  }

  /** click (56569) */
  click() {
    this.tone(900, 0.05, 0.05, 'triangle');
  }

  /** poof (56572) */
  poof() {
    this.noise(0.3, 0.15, 900, 0.6, 'bandpass');
  }

  /** lift (56575): the lift starts or the portal warps. */
  lift() {
    this.tone(220, 1.6, 0.12, 'sine', 0, 3);
    this.noise(1.2, 0.08, 2e3, 0.4, 'bandpass');
  }

  /** full (56578): backpack full. */
  full() {
    this.tone(300, 0.12, 0.1, 'square');
    this.tone(240, 0.16, 0.1, 'square', 0.12);
  }

  /** bombThrow (56581) */
  bombThrow() {
    this.noise(0.22, 0.16, 900, 1.2, 'bandpass');
    this.noise(0.5, 0.06, 5200, 2, 'highpass', 0.08);
  }

  /** bombTick (56585): fuse tick; blink 0..1 raises the pitch, quieter with distance (40 m). */
  bombTick(blink: number, dist: number) {
    const g = 0.07 * Math.max(0.15, 1 - dist / 40);
    this.tone(900 + blink * 700, 0.05, g, 'square');
    this.noise(0.05, g * 0.6, 6e3, 3, 'highpass');
  }

  /** bombBoom (56589): explosion `dist` metres away. */
  bombBoom(dist: number) {
    const k = Math.max(0.25, 1 - dist / 60);
    this.noise(0.12, 0.55 * k, 2400, 0.8, 'bandpass');
    this.noise(1.6, 0.5 * k, 320, 0.7, 'lowpass');
    this.tone(62, 0.9, 0.5 * k, 'sine', 0, 0.35);
    this.tone(38, 1.4, 0.35 * k, 'sine', 0.05, 0.5);
    this.noise(2.4, 0.12 * k, 900, 0.6, 'lowpass', 0.25);
  }

  /** drop (56597): an item is dropped; `ring` adds a bell. */
  drop(ring = false) {
    this.noise(0.12, 0.2, 420, 0.8, 'lowpass');
    this.tone(140, 0.12, 0.12, 'sine', 0, 0.6);
    if (ring) this.bell(1320, 0.5, 0.05, 0.05);
  }

  /** gemBreak (56602) */
  gemBreak() {
    this.noise(0.16, 0.3, 3200, 0.9, 'highpass');
    this.noise(0.1, 0.18, 900, 1, 'bandpass');
    this.tone(180, 0.12, 0.12, 'triangle', 0, 0.5);
    for (let i = 0; i < 5; i++) this.tone(2200 + Math.random() * 2600, 0.07, 0.03, 'sine', 0.03 + i * 0.035 + Math.random() * 0.02, 0.9);
  }

  /** hit (56616): a melee hit; crit is heavier. */
  hit(crit = false) {
    this.noise(0.08, crit ? 0.42 : 0.3, 2300, 1.1, 'bandpass');
    this.tone(crit ? 85 : 125, 0.18, crit ? 0.38 : 0.24, 'sine', 0, 0.45);
    this.tone(crit ? 480 : 680, 0.06, 0.06, 'square', 0, 0.6);
  }

  /** ultReady (56621) */
  ultReady() {
    this.bell(660, 0.5, 0.06);
    this.bell(880, 0.5, 0.06, 0.08);
    this.bell(1320, 0.8, 0.07, 0.16);
    this.noise(0.6, 0.04, 6e3, 1.5, 'highpass', 0.12);
  }

  /** ultArm (56627) */
  ultArm() {
    this.tone(220, 0.22, 0.08, 'sawtooth', 0, 2.2);
    this.tone(1320, 0.08, 0.05, 'square');
    this.noise(0.16, 0.06, 2600, 2, 'bandpass');
  }

  /** ultCancel (56632) */
  ultCancel() {
    this.tone(480, 0.16, 0.06, 'triangle', 0, 0.5);
  }

  /** ultLeap (56635) */
  ultLeap(k = 1) {
    if (!this.ctx) return;
    this.tone(70, 0.3, 0.32 * k, 'sine', 0, 0.5);
    this.noise(0.12, 0.2 * k, 500, 0.8, 'lowpass');
    this.sweepNoise(0.16 * k, 0.5, 500, 2600, 'bandpass', 1.1);
    this.tone(300, 0.55, 0.05 * k, 'sawtooth', 0.05, 4);
  }

  /** ultApex (56642) */
  ultApex() {
    this.tone(2640, 0.3, 0.05, 'sine');
    this.tone(1760, 0.22, 0.05, 'triangle');
  }

  /** ultDive (56645) */
  ultDive() {
    if (!this.ctx) return;
    this.sweepNoise(0.18, 0.2, 3200, 700, 'bandpass', 2);
    this.tone(1400, 0.2, 0.05, 'triangle', 0, 0.4);
  }

  /** ultSlam (56650): the ultimate's ground slam `dist` metres away. */
  ultSlam(dist: number) {
    const k = Math.max(0.15, 1 - dist / 70);
    this.noise(0.14, 0.6 * k, 2600, 0.8, 'bandpass');
    this.noise(0.08, 0.35 * k, 7e3, 1, 'highpass');
    this.tone(58, 1, 0.6 * k, 'sine', 0, 0.4);
    this.tone(36, 1.7, 0.45 * k, 'sine', 0.03, 0.55);
    this.tone(520, 0.9, 0.05 * k, 'triangle', 0.01, 0.92);
    this.tone(1040, 0.6, 0.03 * k, 'sine', 0.01);
    this.noise(2.6, 0.16 * k, 360, 0.7, 'lowpass', 0.1);
    this.noise(0.7, 0.07 * k, 3500, 0.8, 'highpass', 0.15);
  }

  /** grind (56661) */
  grind(k = 1) {
    this.noise(0.07, 0.16 * k, 3e3 + Math.random() * 1500, 2, 'bandpass');
  }

  /** shoot (56664) */
  shoot(k = 1) {
    this.noise(0.07, 0.22 * k, 1700, 0.9, 'bandpass');
    this.tone(760, 0.1, 0.07 * k, 'square', 0, 0.35);
    this.tone(92, 0.13, 0.2 * k, 'sine', 0, 0.5);
  }

  /** ping (56669) */
  ping() {
    this.tone(1300 + Math.random() * 500, 0.07, 0.05, 'triangle', 0, 0.7);
    this.noise(0.06, 0.1, 1600, 1, 'bandpass');
  }

  /** twang (56673) */
  twang(k = 1) {
    this.tone(250, 0.2, 0.09 * k, 'triangle', 0, 0.75);
    this.noise(0.14, 0.09 * k, 3200, 0.8, 'highpass');
  }

  /** cast (56677) */
  cast(k = 1) {
    this.tone(200, 0.55, 0.08 * k, 'sine', 0, 2.3);
    this.tone(300, 0.5, 0.05 * k, 'triangle', 0.05, 2);
    this.noise(0.5, 0.06 * k, 900, 2, 'bandpass', 0.05);
  }

  /** rockfall (56682) */
  rockfall(k = 1) {
    this.noise(0.5, 0.3 * k, 380, 0.7, 'lowpass');
    this.tone(58, 0.55, 0.42 * k, 'sine', 0.02, 0.6);
    this.noise(0.9, 0.12 * k, 1200, 0.6, 'bandpass', 0.08);
    for (let i = 0; i < 5; i++) this.noise(0.08, 0.1 * k, 1400 + Math.random() * 1400, 1.5, 'bandpass', 0.1 + i * 0.07 + Math.random() * 0.05);
  }

  /** birdsong (56696): the song item's tune. */
  birdsong(k = 1) {
    [0, 4, 7, 12, 7, 16, 12, 19].forEach((s, i) => {
      const f = this.semis(1760, s);
      this.tone(f, 0.09, 0.07 * k, 'sine', i * 0.085, 1.18);
      this.tone(f * 2, 0.05, 0.02 * k, 'sine', i * 0.085 + 0.01, 1.1);
    });
    for (let i = 0; i < 8; i++) this.tone(this.semis(2349, i % 2 ? 2 : 0), 0.05, 0.05 * k, 'sine', 0.75 + i * 0.045, 1.05);
    this.tone(1568, 0.22, 0.04 * k, 'sine', 1.2, 1.5);
    this.tone(1976, 0.16, 0.03 * k, 'sine', 1.45, 1.4);
  }

  /** gulp (56707): a drink. */
  gulp() {
    for (let i = 0; i < 3; i++) this.tone(180 + i * 25, 0.12, 0.12, 'sine', i * 0.16, 0.6);
    this.noise(0.1, 0.05, 700, 2, 'bandpass', 0.05);
    this.bell(this.semis(880, 7), 0.6, 0.05, 0.5);
    this.bell(this.semis(880, 12), 0.7, 0.04, 0.62);
  }

  /** tutNext (56713) */
  tutNext() {
    this.bell(this.semis(784, 0), 0.5, 0.04, 0);
    this.bell(this.semis(784, 5), 0.6, 0.035, 0.08);
  }

  /** tutDone (56717) */
  tutDone(big = false) {
    [0, 4, 7, ...(big ? [12, 16] : [])].forEach((s, i) => this.bell(this.semis(988, s), 0.7 + i * 0.1, 0.05, i * 0.055));
    if (big) this.tone(this.semis(494, -12), 1.2, 0.05, 'sine');
  }

  /** chatDing (56723) */
  chatDing() {
    this.bell(this.semis(1319, 0), 0.5, 0.05, 0);
    this.bell(this.semis(1319, 7), 0.7, 0.045, 0.09);
  }

  /** munch (56727): a cookie. */
  munch() {
    this.noise(0.05, 0.24, 3200, 1.2, 'bandpass');
    this.noise(0.05, 0.2, 2500, 1.2, 'bandpass', 0.12);
    this.bell(this.semis(1047, 7), 0.6, 0.05, 0.24);
    this.bell(this.semis(1047, 12), 0.8, 0.045, 0.34);
  }

  /** deadDust (56733) */
  deadDust() {
    this.noise(0.9, 0.2, 1800, 0.7, 'bandpass');
    this.tone(110, 1.1, 0.16, 'sine', 0.05, 0.5);
    this.bell(this.semis(330, -5), 1.4, 0.05, 0.12);
  }

  /** smokePop (56738) */
  smokePop(k = 1) {
    this.tone(90, 0.3, 0.3 * k, 'sine', 0, 0.55);
    this.noise(0.18, 0.22 * k, 700, 0.8, 'bandpass');
    this.noise(2.2, 0.12 * k, 2400, 0.5, 'bandpass', 0.06);
    this.noise(1.6, 0.05 * k, 6e3, 0.7, 'highpass', 0.1);
  }

  /** recallStep (56744): one step of the recall stone's charge. */
  recallStep(i: number) {
    this.bell(this.semis(523, [0, 4, 7, 12, 16, 19, 24, 28, 31][Math.min(8, i)]), 0.9, 0.035 + i * 0.004);
    this.tone(196 * 2 ** (i / 9), 0.4, 0.035, 'sine', 0, 1.08);
  }

  /** recallGo (56752) */
  recallGo(k = 1) {
    this.noise(0.7, 0.22 * k, 1600, 0.6, 'bandpass');
    this.bell(this.semis(1047, 7), 1.1, 0.08 * k, 0.02);
    this.bell(this.semis(1047, 12), 1.3, 0.07 * k, 0.08);
    this.tone(330, 0.9, 0.08 * k, 'sine', 0, 3);
  }

  /** pour (56758) */
  pour(i: number) {
    this.bell(this.semis(523, PENTATONIC[Math.min(i, 10)]), 0.55, 0.045);
  }

  /** levelUp (56761) */
  levelUp() {
    [0, 4, 7, 12, 16].forEach((s, i) => this.bell(this.semis(523, s), 1.3, 0.06, i * 0.06));
    this.tone(this.semis(523, 24), 0.9, 0.03, 'triangle', 0.32);
  }

  /** lodeRise (56765) */
  lodeRise() {
    this.tone(262, 1.2, 0.045, 'sine', 0, 2.5);
    this.noise(1.1, 0.035, 2600, 0.9, 'bandpass', 0.05);
    [0, 4, 7, 12].forEach((s, i) => this.bell(this.semis(784, s), 0.45, 0.022, 0.2 + i * 0.22));
  }

  /** lodeLand (56772) */
  lodeLand(k = 1) {
    [0, 7, 12, 16].forEach((s, i) => this.bell(this.semis(523, s), 1.7, 0.07 * k, i * 0.05));
    this.tone(this.semis(523, -12), 1.5, 0.06 * k, 'sine');
  }

  /** discover (56776): a biome is entered for the first time. */
  discover(biome: string) {
    const scales: Record<string, number[]> = {
      ember: [0, 3, 7, 10],
      bog: [0, 5, 7, 12],
      frost: [0, 4, 7, 11, 14],
      haunt: [0, 3, 6, 10],
    };
    const roots: Record<string, number> = { ember: 110, bog: 147, frost: 262, haunt: 123 };
    (scales[biome] ?? [0, 4, 7]).forEach((s, i) => this.bell(this.semis(roots[biome] ?? 196, s + 12), 3.2, 0.05, i * 0.16));
    this.tone(this.semis(roots[biome] ?? 196, 0), 3.5, 0.08, 'sine', 0, 1);
    this.noise(1.8, 0.05, 900, 0.5, 'bandpass', 0.1);
  }

  /** biomeEvent (56790): kind rumble, burst, crack, shatter, or any other kind (a hiss). */
  biomeEvent(kind: string, k = 1) {
    if (kind === 'rumble') {
      this.tone(45, 1.3, 0.14 * k, 'sawtooth', 0, 1.4);
      this.noise(1.2, 0.08 * k, 160, 0.7, 'lowpass');
    } else if (kind === 'burst') {
      this.tone(60, 0.7, 0.25 * k, 'sine', 0, 0.5);
      this.noise(0.6, 0.25 * k, 900, 0.6, 'bandpass');
      this.noise(1.4, 0.1 * k, 3500, 0.6, 'highpass', 0.1);
    } else if (kind === 'crack') {
      this.noise(0.08, 0.18 * k, 3200, 3, 'bandpass');
      this.tone(1900, 0.2, 0.04 * k, 'triangle', 0.05, 0.7);
    } else if (kind === 'shatter') {
      this.noise(0.4, 0.25 * k, 5200, 1, 'bandpass');
      for (let i = 0; i < 4; i++) this.bell(this.semis(2093, PENTATONIC[Math.floor(Math.random() * 8)]), 0.4, 0.03 * k, i * 0.05);
    } else {
      this.noise(1.6, 0.12 * k, 1400, 0.6, 'bandpass');
      this.tone(210, 0.2, 0.05 * k, 'sine', 0, 1.8);
    }
  }

  /** splash (56809) */
  splash(big: boolean) {
    if (big) {
      this.tone(70, 0.4, 0.2, 'sine', 0, 0.6);
      this.noise(0.9, 0.18, 3e3, 0.7, 'highpass', 0.05);
    } else {
      this.noise(0.35, 0.22, 900, 0.8, 'bandpass');
      this.tone(320, 0.12, 0.06, 'sine', 0.05, 1.8);
    }
  }

  /** sizzle (56816) */
  sizzle() {
    if (Math.random() < 0.5) this.noise(0.25, 0.05, 4200, 0.7, 'highpass');
  }

  /** dash (56819): a band-passed whoosh rising 600 -> 2400 Hz. */
  dash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.22);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + 0.25);
    this.noise(0.07, 0.07, 320, 0.8, 'lowpass');
  }

  /** deflect (56839) */
  deflect(k = 1) {
    this.tone(1320 + Math.random() * 200, 0.35, 0.12 * k, 'triangle', 0, 0.9);
    this.tone(2640, 0.18, 0.05 * k, 'sine', 0.01);
    this.noise(0.12, 0.2 * k, 4200, 1.2, 'bandpass');
  }

  /** golemWindup (56844) */
  golemWindup(k = 1) {
    this.tone(62, 0.9, 0.3 * k, 'sawtooth', 0, 0.7);
    this.noise(0.9, 0.18 * k, 260, 0.9, 'lowpass');
    this.noise(0.6, 0.08 * k, 900, 2, 'bandpass', 0.1);
  }

  /** murmur (56849): one syllable of the stranger's talk; `low` is the deeper voice. */
  murmur(low = false) {
    const f = low ? 96 + Math.random() * 8 : 128 + Math.random() * 34;
    this.tone(f, low ? 0.22 : 0.085, low ? 0.05 : 0.04, 'triangle', 0, low ? 0.9 : 0.95);
    this.tone(f * 2.02, low ? 0.12 : 0.05, 0.01, 'sine', 0, 0.97);
    this.noise(low ? 0.16 : 0.05, low ? 0.012 : 0.009, low ? 500 : 1100, 1.3, 'bandpass');
  }

  /** whisper (56855) */
  whisper(k = 1) {
    this.noise(0.9, 0.07 * k, 700, 1.4, 'bandpass');
    this.noise(0.7, 0.05 * k, 1600, 2.2, 'bandpass', 0.15);
    this.tone(82, 1.1, 0.08 * k, 'sine', 0, 0.9);
    this.tone(123, 0.9, 0.04 * k, 'sine', 0.1, 0.9);
  }

  /** heave (56861) */
  heave(k = 1) {
    this.noise(0.55, 0.24 * k, 420, 0.9, 'bandpass');
    this.noise(0.4, 0.12 * k, 950, 1.2, 'bandpass', 0.08);
    this.tone(96, 0.35, 0.18 * k, 'sine', 0, 0.5);
  }

  /** mend (56866) */
  mend(k = 1) {
    this.tone(98, 2.4, 0.12 * k, 'triangle', 0, 1.5);
    this.tone(147, 2.2, 0.07 * k, 'sine', 0.15, 1.5);
    this.tone(196, 1.8, 0.04 * k, 'sine', 0.35, 1.5);
    this.noise(1.9, 0.09 * k, 280, 0.8, 'lowpass', 0.05);
  }

  /** creak (56872) */
  creak(k = 1) {
    this.tone(130 + Math.random() * 40, 0.26, 0.09 * k, 'sawtooth', 0, 0.7);
    this.noise(0.18, 0.06 * k, 1700, 3, 'bandpass');
  }

  /** hurt (56876) */
  hurt() {
    this.tone(220, 0.22, 0.2, 'square', 0, 0.5);
    this.noise(0.12, 0.22, 700, 0.8, 'bandpass');
  }

  /** shatter (56879) */
  shatter(k = 1) {
    for (let i = 0; i < 6; i++) this.tone(850 + Math.random() * 1e3, 0.06, 0.05 * k, 'triangle', i * 0.035 + Math.random() * 0.02, 0.8);
    this.noise(0.45, 0.15 * k, 1100, 0.7, 'bandpass', 0.02);
    this.tone(70, 0.4, 0.2 * k, 'sine', 0, 0.6);
  }

  /** rise (56892) */
  rise() {
    this.tone(62, 1.2, 0.26, 'sine', 0, 1.5);
    this.noise(1, 0.13, 280, 0.8, 'lowpass');
    for (let i = 0; i < 5; i++) this.tone(560 + Math.random() * 520, 0.05, 0.035, 'triangle', 0.3 + i * 0.11, 0.9);
  }

  /** ko (56897) */
  ko() {
    this.tone(330, 0.9, 0.18, 'triangle', 0, 0.5);
    this.tone(220, 1.2, 0.15, 'triangle', 0.2, 0.45);
    this.noise(0.6, 0.12, 400, 0.7, 'lowpass');
  }

  /** crystalCharge (56902): a rising, tremolo-shaken chord with crackles over `dur` seconds. */
  crystalCharge(dur: number, rarity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.t;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, t);
    env.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.85);
    env.gain.exponentialRampToValueAtTime(1e-4, t + dur + 0.05);
    const trem = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.setValueAtTime(6, t);
    lfo.frequency.exponentialRampToValueAtTime(28, t + dur);
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);
    trem.gain.value = 0.6;
    env.connect(trem).connect(this.sfx);
    const base = 180 + rarity * 25;
    const partials: [number, OscillatorType, number][] = [
      [1, 'sine', 0],
      [1.5, 'triangle', 8],
      [2.01, 'sine', -6],
    ];
    for (const [mul, type, detune] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(base * mul, t);
      osc.frequency.exponentialRampToValueAtTime(base * mul * 3.2, t + dur);
      osc.connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
    for (let i = 0; i < 22; i++) {
      const n = i / 22;
      const at = dur * (1 - (1 - n) ** 1.7) + Math.random() * 0.03;
      this.noise(0.03, 0.05 + n * 0.1, 3e3 + Math.random() * 4e3, 3, 'bandpass', at);
    }
  }

  /** crystalShatter (56941): rarity index 0..5. */
  crystalShatter(rarity: number) {
    if (!this.ctx) return;
    this.noise(0.5, 0.45, 2400, 0.6, 'highpass');
    this.noise(0.25, 0.4, 900, 0.8, 'bandpass');
    this.tone(95, 0.9, 0.55, 'sine', 0, 0.3);
    this.tone(48, 1.4, 0.35 + rarity * 0.04, 'sine', 0.02, 0.6);
    const shards = 26 + rarity * 6;
    for (let i = 0; i < shards; i++) {
      const at = Math.random() ** 1.8 * (0.7 + rarity * 0.08);
      this.tone(
        1800 + Math.random() * 4200,
        0.08 + Math.random() * 0.25,
        0.035 + Math.random() * 0.03,
        Math.random() < 0.5 ? 'sine' : 'triangle',
        at,
        0.96,
      );
    }
    const root = [523, 587, 659, 698, 784, 880][Math.min(rarity, 5)];
    [0, 4, 7, 11, 14]
      .slice(0, 3 + Math.min(2, rarity))
      .forEach((s, i) => this.bell(this.semis(root, s), 1.6 + rarity * 0.2, 0.05, 0.12 + i * 0.05));
  }

  /** cardFly (56964) */
  cardFly(i: number) {
    this.noise(0.18, 0.12, 1500 + i * 400, 1.4, 'bandpass');
  }

  /** cardFlip (56967): card tier 0..4; tier 4 adds a swelling sawtooth chord. */
  cardFlip(tier: number) {
    this.noise(0.05, 0.14, 2600, 1.2, 'bandpass');
    this.tone(420, 0.06, 0.06, 'triangle', 0, 1.6);
    const chords = [[0], [0, 7], [0, 4, 7], [0, 4, 7, 11, 14], [0, 4, 7, 12, 16, 19, 24]];
    const root = [660, 740, 784, 880, 988][tier];
    chords[tier].forEach((s, i) => this.bell(this.semis(root, s), 0.7 + tier * 0.25, 0.06 + tier * 0.012, 0.04 + i * (tier >= 4 ? 0.07 : 0.05)));
    if (tier >= 3) {
      this.tone(65, 1.1, 0.3, 'sine', 0, 0.55);
      this.noise(1.2, 0.08, 5e3, 0.5, 'highpass', 0.05);
    }
    if (tier >= 4) {
      const ctx = this.ctx!;
      const t = this.t;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.setValueAtTime(600, t);
      low.frequency.exponentialRampToValueAtTime(3200, t + 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1e-4, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.35);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 2.6);
      low.connect(g).connect(this.sfx);
      for (const s of [0, 4, 7, 12])
        for (const detune of [-9, 9]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = this.semis(262, s);
          osc.detune.value = detune;
          osc.connect(low);
          osc.start(t);
          osc.stop(t + 2.7);
        }
    }
  }

  /** cardHover (57009) */
  cardHover(i: number) {
    this.tone(this.semis(1320, i * 2), 0.05, 0.025, 'sine');
  }

  /** cardPick (57012) */
  cardPick(tier: number) {
    if (!this.ctx) return;
    this.tone(220, 0.45, 0.14, 'sawtooth', 0, 4);
    this.noise(0.4, 0.1, 3e3, 0.7, 'bandpass');
    [0, 4, 7, 12, 16].forEach((s, i) => this.tone(this.semis(523, s + tier), 0.5, 0.08, 'triangle', 0.18 + i * 0.045));
    this.tone(this.semis(523, 24 + tier), 0.9, 0.05, 'sine', 0.42);
    this.tone(70, 0.6, 0.3, 'sine', 0.15, 0.5);
  }

  /** skipCards (57022): a falling whoosh 2200 -> 260 Hz and three blips. */
  skipCards() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.75);
    [0, 3, 7].forEach((s, i) => this.tone(this.semis(1320, s), 0.08, 0.04, 'square', 0.25 + i * 0.06));
  }

  /** diceRoll (57043): nine slowing rattles, a thud and a bell. */
  diceRoll() {
    let at = 0;
    for (let i = 0; i < 9; i++) {
      at += 0.05 + Math.random() * 0.09 * (1 + i * 0.12);
      this.noise(0.035, 0.22 - i * 0.015, 1400 + Math.random() * 1600, 4, 'bandpass', at);
      this.tone(700 + Math.random() * 500, 0.04, 0.04, 'triangle', at, 0.8);
    }
    this.tone(160, 0.2, 0.2, 'sine', at + 0.05, 0.5);
    this.bell(1175, 0.8, 0.05, at + 0.1);
  }

  /** secondWind (57051) */
  secondWind() {
    this.tone(196, 0.8, 0.2, 'triangle', 0, 2);
    [0, 7, 12, 19].forEach((s, i) => this.bell(this.semis(523, s), 1.1, 0.07, 0.15 + i * 0.07));
  }

  /** blast (57057) */
  blast() {
    this.noise(0.35, 0.3, 600, 0.7, 'lowpass');
    this.tone(80, 0.35, 0.3, 'sine', 0, 0.4);
    this.noise(0.1, 0.15, 3e3, 1, 'bandpass');
  }

  /** chestOpen (57062): chest kind 0..2. */
  chestOpen(kind: number) {
    this.tone(140, 0.35, 0.12, 'sawtooth', 0, 1.6);
    this.noise(0.3, 0.12, 900, 3, 'bandpass');
    this.tone(90, 0.3, 0.3, 'sine', 0.3, 0.5);
    const root = [523, 587, 659][kind] ?? 523;
    [0, 4, 7, 12, 16, 19]
      .slice(0, 4 + kind)
      .forEach((s, i) => this.bell(this.semis(root, s), 1.1 + kind * 0.3, 0.07, 0.35 + i * 0.06));
    this.noise(1.2, 0.07, 6e3, 0.5, 'highpass', 0.35);
  }

  /** loot (57072): gear tier 0..4. */
  loot(tier: number) {
    [0, 7, 12].slice(0, 1 + Math.min(2, tier)).forEach((s, i) => this.tone(this.semis(784 + tier * 60, s), 0.18, 0.07, 'triangle', i * 0.06));
    if (tier >= 3) this.bell(this.semis(1568, tier), 1, 0.06, 0.2);
  }

  /** equip (57080) */
  equip() {
    this.noise(0.08, 0.16, 1800, 1.5, 'bandpass');
    this.tone(330, 0.1, 0.08, 'square', 0.02, 1.4);
    this.tone(660, 0.14, 0.06, 'triangle', 0.08);
  }
}
