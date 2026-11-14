// Port of play-inUT-NSi.js 56116-56179 and 56226-56348: the per-frame update of the audio engine dM and its
// world, biome and places layers: drill / jet / air loops, muffle, wind, rain, cave drone, reverb, cave drips,
// birds and crickets, water chimes and fire crackle near the Wellspring, biome beds and biome voices, thunder.
import { PENTATONIC } from './engine';
import { DIG_SOUNDS, GAME_DIG_SOUND, startDig } from './digSounds';
import { AudioMusic } from './music';

export class AudioAmbience extends AudioMusic {
  world = { rain: 0, wind: 0.3, night: 0, day: 1, under: 0, storm: 0 };
  birdT = 3;
  cricketT = 2;
  combo = 0;
  comboTimer = 0;
  dripTimer = 2;
  places = { water: 0, fire: 0 };
  chimeT = 2;
  crackleT = 0.3;
  voiceT = 2;
  voice2T = 5;

  /** MINEAR: starts, steers and stops the claw dig loop. */
  digSound(on: boolean, hardness: number) {
    const p = { hardness: Math.max(1, hardness), speed: 1 };
    if (on && !this.dig) this.dig = startDig(this.digKit, DIG_SOUNDS.find((s) => s.id === GAME_DIG_SOUND)!, p);
    else if (on) this.dig!.set(p);
    else if (this.dig) {
      this.dig.stop();
      this.dig = null;
    }
  }

  /** setBiome (56116): biome region id (ember, bog, frost, haunt or null) and its strength 0..1. */
  setBiome(id: string | null, k: number) {
    this.biome.id = id;
    this.biome.k = k;
  }

  /** biomeSounds (56119): fade the beds and play the biome voices. */
  biomeSounds(dt: number) {
    const b = this.biome;
    const now = this.t;
    const level: Record<string, number> = { ember: 0.16, bog: 0.14, frost: 0.12, haunt: 0.2 };
    for (const id in this.beds) this.beds[id].gain.setTargetAtTime(id === b.id ? b.k * level[id] : 0, now, 1.2);
    if (!b.id || b.k < 0.3) return;
    const k = b.k;
    this.voiceT -= dt;
    this.voice2T -= dt;
    switch (b.id) {
      case 'ember':
        if (this.voiceT <= 0) {
          this.voiceT = 0.4 + Math.random() * 1.4;
          this.tone(55 + Math.random() * 40, 0.3, 0.1 * k, 'sine', 0, 2.2);
          if (Math.random() < 0.5) this.noise(0.06, 0.06 * k, 2400 + Math.random() * 2e3, 2.5, 'bandpass', 0.2);
        }
        if (this.voice2T <= 0) {
          this.voice2T = 4 + Math.random() * 7;
          this.noise(0.4, 0.09 * k, 600, 0.9, 'bandpass');
          this.tone(48, 0.6, 0.06 * k, 'sawtooth', 0.02, 0.8);
        }
        break;
      case 'bog':
        if (this.voiceT <= 0) {
          this.voiceT = 0.5 + Math.random() * 1.6;
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) this.tone(260 + Math.random() * 300, 0.09, 0.05 * k, 'sine', i * 0.11, 1.9);
        }
        if (this.voice2T <= 0) {
          this.voice2T = 3 + Math.random() * 6;
          const f = 120 + Math.random() * 70;
          for (let i = 0; i < 3; i++) this.tone(f, 0.09, 0.06 * k, 'sawtooth', i * 0.13, 0.8);
        }
        break;
      case 'frost':
        if (this.voiceT <= 0) {
          this.voiceT = 1.5 + Math.random() * 3;
          this.bell(this.semis(1760, PENTATONIC[Math.floor(Math.random() * 8)]), 1.4, 0.012 * k);
        }
        if (this.voice2T <= 0) {
          this.voice2T = 5 + Math.random() * 9;
          this.tone(70 + Math.random() * 40, 1.4, 0.07 * k, 'sawtooth', 0, 0.55);
          this.tone(140 + Math.random() * 60, 0.9, 0.03 * k, 'triangle', 0.3, 0.6);
        }
        break;
      case 'haunt':
        if (this.voiceT <= 0) {
          this.voiceT = 4 + Math.random() * 8;
          for (let i = 0; i < 4; i++)
            this.noise(0.18 + Math.random() * 0.15, 0.05 * k, 1400 + Math.random() * 1400, 5, 'bandpass', i * 0.2);
        }
        if (this.voice2T <= 0) {
          this.voice2T = 14 + Math.random() * 14;
          this.bell(196, 4, 0.045 * k);
          this.bell(196, 4, 0.03 * k, 2.6);
        }
    }
  }

  /**
   * update (56226), once per frame from KR.update (72159).
   * drill: 1 while digging, 0.5 while drilling into air, else 0. hardness: hardness of the last material hit.
   * jet: jetpack thrust (halved in burrow mode). under: env.underground 0..1. height: metres above the surface
   * (KR passes -depth). murk: water murk 0..1 (muffles the master bus). air: 1 while drilling into air.
   */
  update(dt: number, drill: number, hardness: number, jet: number, under: number, height: number, murk = 0, air = 0) {
    if (!this.ctx) return;
    const now = this.t;
    this.muffle.frequency.setTargetAtTime(18e3 * (1e3 / 18e3) ** murk, now, 0.12);
    this.scheduleMusic(murk);
    // MINEAR: claws on rock play the dig loop (1 = digging; 0.5 = clawing at the air, which only hisses)
    this.digSound(drill > 0.75, hardness);
    this.airGain.gain.setTargetAtTime(air * 0.06, now, 0.05);
    this.jetGain.gain.setTargetAtTime(jet * 0.1125, now, 0.05);
    this.jetFilter.frequency.setTargetAtTime(400 + jet * 1400, now, 0.05);
    this.placeSounds(dt);
    this.biomeSounds(dt);
    const w = this.world;
    const gust = 0.5 + 0.5 * Math.sin(now * 0.37) * Math.sin(now * 0.61 + 1.3);
    const wind = 0.012 + Math.min(1, Math.max(0, height) / 40) * 0.028 + Math.max(0, w.wind - 0.4) * 0.05 * gust;
    this.windGain.gain.setTargetAtTime((1 - under) * wind, now, 0.5);
    const open = 1 - under * 0.85;
    this.rainGain.gain.setTargetAtTime(w.rain * 0.09 * open, now, 0.6);
    this.rainLow.gain.setTargetAtTime(w.rain * 0.05 * (1 - under * 0.5), now, 0.6);
    this.lifeSounds(dt, under);
    this.caveGain.gain.setTargetAtTime(under * 0.5, now, 0.8);
    this.wet.gain.setTargetAtTime(0.12 + under * 0.45, now, 0.5);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    if (under > 0.6) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 1.5 + Math.random() * 5;
        this.tone(1400 + Math.random() * 900, 0.18, 0.05, 'sine', 0, 0.5);
      }
    }
  }

  /** setWorld (56259): weather and night 0..1 for wind, rain and the bird / cricket gate. */
  setWorld(rain: number, wind: number, storm: number, night: number) {
    this.world.rain = rain;
    this.world.wind = wind;
    this.world.storm = storm;
    this.world.night = night;
  }

  /** setPlaces (56265): nearness 0..1 to water (the Wellspring) and fire. */
  setPlaces(water: number, fire: number) {
    this.places.water = water;
    this.places.fire = fire;
  }

  /** placeSounds (56268): water and fire beds, water chimes, fire crackle. */
  placeSounds(dt: number) {
    if (!this.waterGain || !this.fireGain) return;
    const p = this.places;
    this.waterGain.gain.setTargetAtTime(p.water * 0.045, this.t, 0.4);
    this.fireGain.gain.setTargetAtTime(p.fire * 0.08, this.t, 0.4);
    this.chimeT -= dt;
    if (this.chimeT <= 0) {
      this.chimeT = 1.6 + Math.random() * 3.2;
      if (p.water > 0.15) this.bell(this.semis(880, PENTATONIC[Math.floor(Math.random() * 8)]), 2.4, 0.018 * p.water);
    }
    this.crackleT -= dt;
    if (this.crackleT <= 0) {
      this.crackleT = 0.06 + Math.random() * 0.4;
      if (p.fire > 0.1) this.noise(0.025, 0.07 * p.fire, 1800 + Math.random() * 2800, 2.5, 'bandpass');
    }
  }

  /** lifeSounds (56284): birds by day, crickets by night, only above ground and without much rain. */
  lifeSounds(dt: number, under: number) {
    const w = this.world;
    const calm = under < 0.3 && w.rain < 0.3;
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.5 + Math.random() * 5;
      if (calm && w.night < 0.4) this.bird();
    }
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.9 + Math.random() * 1.6;
      if (calm && w.night > 0.5) this.cricket();
    }
  }

  /** chirp (56294): a panned sine sweep on the ambience bus. */
  chirp(from: number, to: number, dur: number, gain: number, delay: number, pan: number) {
    const ctx = this.ctx!;
    const s = this.t + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, s);
    osc.frequency.exponentialRampToValueAtTime(to, s + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(gain, s + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(1e-4, s + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(this.ambience);
    osc.start(s);
    osc.stop(s + dur + 0.05);
  }

  /** bird (56311): one of three call shapes. */
  bird() {
    const kind = Math.floor(Math.random() * 3);
    const pan = Math.random() * 1.6 - 0.8;
    const f = 2600 + Math.random() * 1800;
    const g = 0.012 + Math.random() * 0.01;
    if (kind === 0) {
      this.chirp(f, f * 1.25, 0.14, g, 0, pan);
      this.chirp(f * 1.1, f * 0.9, 0.18, g, 0.2, pan);
    } else if (kind === 1) {
      const n = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) this.chirp(f * 1.3, f, 0.05, g * 0.8, i * 0.065, pan);
    } else this.chirp(f * 0.8, f * 1.5, 0.22, g, 0, pan);
  }

  /** cricket (56323) */
  cricket() {
    const pan = Math.random() * 1.4 - 0.7;
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) this.chirp(f, f * 0.98, 0.035, 0.006, i * 0.055, pan);
  }

  /** thunder (56328): a strike `dist` metres away; sound speed 343 m/s, delay at most 2.5 s. */
  thunder(dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = Math.min(2.5, dist / 343);
    const at = this.t + delay;
    const near = 1 - Math.min(1, dist / 450);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(260 + near * 500, at);
    low.frequency.exponentialRampToValueAtTime(90, at + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.35 + near * 0.35, at + 0.08 + (1 - near) * 0.4);
    g.gain.setTargetAtTime(0, at + 0.6, 1.2 + (1 - near));
    src.connect(low).connect(g).connect(this.ambience);
    src.start(at, Math.random());
    src.stop(at + 7);
    if (near > 0.4) this.noise(0.25, 0.2 * near, 2500, 0.5, 'highpass', delay);
  }
}
