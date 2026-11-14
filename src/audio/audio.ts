// Port of play-inUT-NSi.js 55864-57517: the procedural audio engine dM (Web Audio, no sound files).
// This file holds 57085-57481 (the worm "grin" drone, heartbeat and cues, the boss voices and beastRoar) and
// exports the one class the game uses. The rest is split by role:
//   engine.ts   buses, loops, beds, tone / bell / noise / sweepNoise, mix   (55864-56115, 56180-56225, 57482-57516)
//   music.ts    chords, voice, drum, boss layer, scheduleMusic             (56349-56471)
//   ambience.ts update, world / biome / places layers, birds, thunder      (56116-56179, 56226-56348)
//   sfx.ts      one-shot sound effects                                     (56472-57084)
// KR makes it at 70095 (`audio = new dM()`) and calls start() in KR.start (71067) after the Play click; the
// AudioContext and its wake listeners exist only after that call.
//
// KR call sites (play-inUT-NSi.js, KR = 70056-75530):
//   start()                                 71067 start (Play click)
//   setMix(settings)                        71001 applySettings
//   setMuted(settings.muted)                72176 handleKeys, KeyM
//   update(dt, drill, hardness, jet, under, -depth, murk, +pointing)   72159 end of update
//     drill = drilling || burrow autoDig ? 1 : pointing ? 0.5 : 0; hardness = MATERIALS[lastMat].hardness ?? 1
//     (Air when not drilling); jet = burrow ? thrust * 0.5 : thrust; under = env.underground
//   setWorld(rain, wind, storm, clock.night) 72012 update, after weather
//   setBiome(region?.biome ?? null, murk > 0.5 ? k * 0.4 : k)          72036 update, after biomes.update
//   setPlaces(1 - smoothstep(dist to hub.spiritTop, 4, 18), 0)         72114 update, town fx (dist 99 when not in town)
//   setBoss(engaged boss fighting && !ko ? 1 : 0, dt)                   72684 updateBosses
//   setGrin(dread, dt)                      72921 updateWorm; heartbeat read at 72926 (dreadPass uBeat)
//   thunder(dist)                           70343 weather.onStrike
//   biomeEvent(kind, clamp(k, 0.1, 1))      70323 biome events sound hook
//   boss(kind, clamp(1.15 - dist / 70, 0.08, 1) * n)                   72624 boss sound hook (makeBosses)
//   grinBreach(k), grinHurt(big)            72325, 72363 makeWorm hooks
//   grinGiggle/grinWindup/grinLunge/grinScreech(k), grinScreech(1, true)  72456-72463 onSim wormCue
//   grinBite()                              72835 hurtBy (worm bite)
//   burrowEnter() 71397 enterBurrow; breach() 71482, 71520 exitBurrow
//   lift() 70903 liftWarp, 71697 lift start, 74797 wakeAtHome; land(v) 71721 landing > 5 m/s
//   sonar() 71983 burrow ping, 72248 echo key; sensed(rarity) 71996 burrow gem sensed
//   crunch(hardness) 73742, clang() 73758, poof() 73783 digTick; poof() 70402 chest vanish, 73136 decorEvents
//   creak(k) 72261 closeMenu (stash), 72268 openStash, 73086 decorEvents (tree hit)
//   rockfall(k) 70479 golemDown, 73117 decorEvents (tree lands), 74135 layerNote, 74156 rockfallShow
//   smokePop(k) 70426 smokes.onPop, 72792 onFx smoke; bombThrow() 72782 onFx, 74446 throwSmoke, 74607 throwBomb
//   bombTick(blink, dist) 70420 bombs.onTick; bombBoom(dist) 74774 blastShow; ultSlam(dist) 70789 ult slam hook
//   gem(rarity) 72774 bossSlain, 73016 grinSlain, 73287 onSent, 73859 releaseGem, 73895/73912 collect, 75406 stranger
//   pickup() 73904, 73908, 73933 collect, 74939 showLoot; diceRoll() 73368 restock, 73921 collect
//   full() 73950 backpackFull; gemBreak() 73985 destroyFromPack
//   deposit(value) 73317 sellItem, 73327 sellCrystal; purchase() 70437 goal complete, 73338 buy
//   loot(tier) 70501 lootGear, 70755 satchel KO, 73344 buy, 73491 lootChest; chestOpen(kind) 73437 lootChest,
//     chestOpen(0) 74939 showLoot; crystalShatter(max(0, rarity index - 1)) 73350 buy (a crystal);
//     coin(3) 70641 Wellspring skipped hook
//   click() 70654, 70661, 72255, 72269, 72286, 72304, 72315, 74881, 75304 (menus); equip() 70660, 73256
//   deny() 70655, 70660, 72287, 73261, 73336, 73369, 73377, 74032, 74077, 74093, 74106, 74303, 74399, 74429,
//     74460, 74478, 74590
//   chatDing() 70758; rise() 72435 onSim (Lost rising); birdsong(k) 74174 songShow
//   splash(big) 74231, sizzle() 74271 updateFooting; gulp() 74309, 74331, 74358 drinks; munch() 74407 eatCookie
//   recallStep(i) 74534 updateStone; recallGo(k) 74581 recallShow; drop(false) 74970 dropGear, 74982 dropSupply
//   lodeLand(k) 75218 updateFortune, 75476, 75486; lodeRise() 75472 lodestoneArrives
//   whisper(0.6) 75462, murmur(low) 75469 talkToStranger (ui.talk voice); discover(biome) 75528 biomeEntered
// Other callers get the same object: ult controller (47780-48185), Wellspring pN (59334-59911), tutorial
// (60522-60632), combat dI (63895-65297).
import { AudioSfx } from './sfx';

export { PENTATONIC, type AudioMix } from './engine';
export type { Chord } from './music';

/** Boss sound kinds boss() knows (57275); other kinds make no sound. */
export type BossSoundKind =
  | 'roar'
  | 'die'
  | 'growl'
  | 'bite'
  | 'inhale'
  | 'breath'
  | 'whoosh'
  | 'stomp'
  | 'boom'
  | 'thud'
  | 'geyser'
  | 'crack'
  | 'shatter'
  | 'splash'
  | 'spit'
  | 'hiss'
  | 'soul'
  | 'bones'
  | 'rise';

export class Audio extends AudioSfx {
  // dM (55865)
  grin: { g: GainNode; low: OscillatorNode; saw: OscillatorNode; filt: BiquadFilterNode } | null = null;
  beatT = 0;
  /** 1 on each heartbeat, falls at 3.2 per second; KR feeds it to the dread pass (uBeat). */
  heartbeat = 0;

  /** setGrin (57088): the worm proximity drone and heartbeat; k is KR's dread 0..1. */
  setGrin(k: number, dt: number) {
    this.heartbeat = Math.max(0, this.heartbeat - dt * 3.2);
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.t;
    if (!this.grin && k > 0.01) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 160;
      const low = ctx.createOscillator();
      low.type = 'sine';
      low.frequency.value = 36;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 54.5;
      const lowGain = ctx.createGain();
      lowGain.gain.value = 0.9;
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.35;
      low.connect(lowGain).connect(g);
      saw.connect(sawGain).connect(filt).connect(g);
      const rumble = this.loopNoise();
      const rumbleLow = ctx.createBiquadFilter();
      rumbleLow.type = 'lowpass';
      rumbleLow.frequency.value = 110;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.8;
      rumble.connect(rumbleLow).connect(rumbleGain).connect(g);
      g.connect(this.sfx);
      low.start();
      saw.start();
      this.grin = { g, low, saw, filt };
    }
    if (this.grin) {
      this.grin.g.gain.setTargetAtTime(Math.min(1, k) * 0.42, now, 0.4);
      this.grin.filt.frequency.setTargetAtTime(120 + k * 260, now, 0.3);
      this.grin.saw.detune.setTargetAtTime(Math.sin(now * 0.7) * 30 * k, now, 0.2);
    }
    if (k > 0.12) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 60 / (52 + k * 78);
        this.heartbeat = 1;
        const v = 0.25 + k * 0.45;
        this.tone(64, 0.18, v, 'sine', 0, 0.55);
        this.tone(58, 0.2, v * 0.75, 'sine', 0.22, 0.55);
      }
    } else this.beatT = 0.4;
  }

  /** grinGiggle (57132): 4-6 falling sawtooth syllables through two formants. */
  grinGiggle(k = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.t;
    const out = ctx.createGain();
    out.gain.value = 0.22 * k;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 640;
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1180;
    f2.Q.value = 7;
    f1.connect(out);
    f2.connect(out);
    out.connect(this.sfx);
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = now + i * 0.16 + Math.random() * 0.03;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = 128 - i * 8;
      osc.frequency.setValueAtTime(f * 1.3, at);
      osc.frequency.exponentialRampToValueAtTime(f, at + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      osc.connect(g);
      g.connect(f1);
      g.connect(f2);
      osc.start(at);
      osc.stop(at + 0.16);
    }
    this.noise(0.9, 0.05 * k, 900, 1.2, 'bandpass', 0.05);
  }

  /** grinWindup (57167): a 1.5 s rising growl before the lunge. */
  grinWindup(k = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(60, now);
    low.frequency.exponentialRampToValueAtTime(520, now + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.7 * k, now + 1.2);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.45);
    src.connect(low).connect(g).connect(this.sfx);
    src.start(now);
    src.stop(now + 1.5);
    for (const [f, detune] of [
      [98, 0],
      [139, 6],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, now + 1.3);
      osc.detune.value = detune;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.001, now);
      og.gain.exponentialRampToValueAtTime(0.12 * k, now + 1.25);
      og.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      osc.connect(lp).connect(og).connect(this.sfx);
      osc.start(now);
      osc.stop(now + 1.5);
    }
  }

  /** grinLunge (57204) */
  grinLunge(k = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.t;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.32);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.7);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1500;
    band.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.3 * k, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc.connect(band).connect(g).connect(this.sfx);
    osc.start(now);
    osc.stop(now + 0.8);
    this.noise(0.6, 0.35 * k, 700, 0.6, 'bandpass');
    this.tone(55, 0.7, 0.4 * k, 'sine', 0, 0.6);
  }

  /** grinBite (57225) */
  grinBite() {
    for (const d of [0, 0.1]) {
      this.noise(0.14, 0.5, 480, 1, 'bandpass', d);
      this.noise(0.05, 0.3, 3200, 2, 'bandpass', d + 0.01);
    }
    this.tone(72, 0.35, 0.55, 'sine', 0, 0.5);
    this.tone(180, 0.2, 0.2, 'square', 0.02, 0.5);
  }

  /** grinBreach (57231): the worm breaks out of the ground. */
  grinBreach(k = 1) {
    this.noise(0.7, 0.55 * k, 320, 0.7, 'lowpass');
    this.tone(44, 0.7, 0.45 * k, 'sine', 0, 0.6);
    for (let i = 0; i < 6; i++) this.noise(0.04, 0.18 * k, 1200 + Math.random() * 1800, 3, 'bandpass', 0.02 + i * 0.05 + Math.random() * 0.03);
  }

  /** grinHurt (57244) */
  grinHurt(big: boolean) {
    this.noise(0.16, 0.25, big ? 900 : 380, 1.8, 'bandpass');
    this.tone(big ? 140 : 95, 0.35, 0.16, 'sawtooth', 0, 0.6);
  }

  /** grinScreech (57248): death = the long falling death scream with a sub drop. */
  grinScreech(k = 1, death = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = this.t;
    const dur = death ? 2.2 : 0.9;
    for (const [detune, q] of [
      [0, 3],
      [37, 5],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(death ? 900 : 700, now);
      osc.frequency.exponentialRampToValueAtTime(death ? 90 : 380, now + dur);
      osc.detune.value = detune;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1300;
      band.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.26 * k, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(band).connect(g).connect(this.sfx);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    }
    if (death) {
      this.tone(40, 2.6, 0.5, 'sine', 0.2, 0.7);
      this.noise(2.4, 0.3, 260, 0.6, 'lowpass', 0.3);
    }
  }

  /** boss (57275): a boss voice of `kind` (BossSoundKind) at loudness k; silent at k <= 0.01. */
  boss(kind: string, k = 1) {
    const ctx = this.ctx;
    if (!ctx || k <= 0.01) return;
    switch (kind) {
      case 'roar':
        return this.beastRoar(k, 1.9, 1);
      case 'die':
        return this.beastRoar(k, 3, 0.7);
      case 'growl':
        return this.beastRoar(k * 0.6, 0.9, 0.8);
      case 'bite':
        for (const d of [0, 0.07]) this.noise(0.12, 0.45 * k, 520, 1.2, 'bandpass', d);
        this.tone(64, 0.3, 0.5 * k, 'sine', 0, 0.5);
        return;
      case 'inhale':
        return this.sweepNoise(k * 0.55, 1.1, 180, 1600, 'lowpass');
      case 'breath':
        this.sweepNoise(k * 0.8, 2.3, 900, 500, 'bandpass', 0.8);
        this.noise(2.3, 0.35 * k, 160, 0.7, 'lowpass');
        for (let i = 0; i < 18; i++) this.noise(0.03, 0.12 * k, 2400 + Math.random() * 2400, 4, 'bandpass', Math.random() * 2.2);
        return;
      case 'whoosh':
        return this.sweepNoise(k * 0.5, 0.55, 320, 1500, 'bandpass', 1.4);
      case 'stomp':
      case 'boom':
        this.tone(52, 1, 0.75 * k, 'sine', 0, 0.55);
        this.noise(0.9, 0.55 * k, 180, 0.7, 'lowpass');
        for (let i = 0; i < 5; i++) this.noise(0.05, 0.15 * k, 900 + Math.random() * 1500, 3, 'bandpass', 0.03 + i * 0.06 + Math.random() * 0.04);
        return;
      case 'thud':
        this.tone(58, 0.35, 0.45 * k, 'sine', 0, 0.6);
        this.noise(0.25, 0.3 * k, 140, 0.8, 'lowpass');
        return;
      case 'geyser':
        this.tone(46, 0.8, 0.45 * k, 'sine', 0, 0.6);
        this.noise(1.1, 0.4 * k, 2600, 0.6, 'highpass');
        this.noise(0.8, 0.35 * k, 420, 0.8, 'bandpass');
        return;
      case 'crack':
        for (let i = 0; i < 6; i++) this.noise(0.035, 0.3 * k, 3e3 + Math.random() * 3e3, 5, 'bandpass', i * 0.04 + Math.random() * 0.03);
        this.tone(1900, 0.5, 0.05 * k, 'sine', 0, 0.4);
        return;
      case 'shatter':
        this.noise(0.6, 0.35 * k, 3600, 0.7, 'highpass');
        for (let i = 0; i < 14; i++) this.bell(1400 + Math.random() * 2800, 0.3 + Math.random() * 0.4, 0.03 * k, Math.random() * 0.35);
        this.tone(70, 0.4, 0.3 * k, 'sine', 0, 0.5);
        return;
      case 'splash':
        this.noise(0.7, 0.45 * k, 850, 0.8, 'bandpass');
        this.noise(0.4, 0.2 * k, 2400, 1, 'bandpass', 0.05);
        for (let i = 0; i < 6; i++) this.tone(300 + Math.random() * 500, 0.08, 0.05 * k, 'sine', 0.1 + Math.random() * 0.5, 1.8);
        return;
      case 'spit':
        this.noise(0.16, 0.35 * k, 1300, 1.5, 'bandpass');
        this.tone(220, 0.18, 0.12 * k, 'triangle', 0, 0.4);
        return;
      case 'hiss':
        return this.sweepNoise(k * 0.35, 0.9, 5200, 3200, 'highpass');
      case 'soul': {
        const now = this.t;
        for (const [f, detune] of [
          [196, 0],
          [293.7, 7],
          [392, -9],
        ]) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f * 1.5, now);
          osc.frequency.exponentialRampToValueAtTime(f, now + 1.1);
          osc.detune.value = detune;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.001, now);
          g.gain.exponentialRampToValueAtTime(0.08 * k, now + 0.15);
          g.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
          osc.connect(g).connect(this.sfx);
          osc.start(now);
          osc.stop(now + 1.4);
        }
        this.sweepNoise(k * 0.3, 1.2, 600, 2400, 'bandpass', 2);
        return;
      }
      case 'bones':
        for (let i = 0; i < 16; i++) this.noise(0.03, 0.22 * k, 1800 + Math.random() * 1600, 6, 'bandpass', i * 0.05 + Math.random() * 0.05);
        this.tone(90, 0.4, 0.2 * k, 'sine', 0.4, 0.6);
        return;
      case 'rise': {
        const now = this.t;
        for (const [f, detune] of [
          [73.4, 0],
          [110, 5],
          [146.8, -6],
          [220, 3],
        ]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = f;
          osc.detune.value = detune;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(200, now);
          lp.frequency.exponentialRampToValueAtTime(1400, now + 2);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.001, now);
          g.gain.exponentialRampToValueAtTime(0.06 * k, now + 1.6);
          g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
          osc.connect(lp).connect(g).connect(this.sfx);
          osc.start(now);
          osc.stop(now + 2.7);
        }
        return;
      }
    }
  }

  /** beastRoar (57433): three vibrato sawtooths through a moving formant, a noise sweep and a sub. */
  beastRoar(k: number, dur: number, pitch: number) {
    const ctx = this.ctx!;
    const now = this.t;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.5 * k, now + 0.18);
    g.gain.setValueAtTime(0.5 * k, now + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(380 * pitch, now);
    band.frequency.linearRampToValueAtTime(620 * pitch, now + dur * 0.4);
    band.frequency.linearRampToValueAtTime(300 * pitch, now + dur);
    band.Q.value = 3;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900 * pitch;
    band.connect(g);
    low.connect(g);
    g.connect(this.sfx);
    for (const [f0, detune] of [
      [62, 0],
      [64, 14],
      [93, -8],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = f0 * pitch;
      osc.frequency.setValueAtTime(f * 0.8, now);
      osc.frequency.linearRampToValueAtTime(f * 1.25, now + dur * 0.3);
      osc.frequency.linearRampToValueAtTime(f * 0.7, now + dur);
      osc.detune.value = detune;
      const vib = ctx.createOscillator();
      vib.frequency.value = 7 + Math.random() * 4;
      const vibDepth = ctx.createGain();
      vibDepth.gain.value = f * 0.06;
      vib.connect(vibDepth).connect(osc.frequency);
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og);
      og.connect(band);
      og.connect(low);
      osc.start(now);
      vib.start(now);
      osc.stop(now + dur + 0.05);
      vib.stop(now + dur + 0.05);
    }
    this.sweepNoise(k * 0.4, dur, 700 * pitch, 1400 * pitch, 'bandpass', 1.2);
    this.tone(40 * pitch, dur, 0.3 * k, 'sine', 0, 0.8);
  }
}
