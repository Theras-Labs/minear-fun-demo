// Port of play-inUT-NSi.js 51511-51721: sky colour keyframes (by sun elevation) and the day/night clock.
import * as THREE from 'three';

const c = (hex: number) => new THREE.Color(hex); // Y (51511)

/** One "look": the sky and light palette for one sun elevation. */
export interface SkyLook {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  glow: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  skyAmb: THREE.Color;
  groundAmb: THREE.Color;
  ambI: number;
  fogSun: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  exposure: number;
}

/** A keyframe: `e` is the sun direction y (-1 = midnight, 1 = noon). */
export interface SkyKeyframe extends SkyLook {
  e: number;
}

export const SKY_KEYFRAMES: SkyKeyframe[] = [ // nA (51512)
  {
    e: -1,
    zenith: c(0x050a1c),
    horizon: c(0x16244a),
    ground: c(0x0e1630),
    glow: c(0x1d2a52),
    sun: c(0x9fb6ff),
    sunI: 0,
    skyAmb: c(0x3c5288),
    groundAmb: c(0x1c1f35),
    ambI: 0.9,
    fogSun: c(0x1f2d55),
    cloudLit: c(0x34466f),
    cloudShade: c(0x141c34),
    exposure: 1.25,
  },
  {
    e: -0.22,
    zenith: c(0x08102a),
    horizon: c(0x1c2b55),
    ground: c(0x121b38),
    glow: c(0x2a3766),
    sun: c(0x9fb6ff),
    sunI: 0,
    skyAmb: c(0x3f5790),
    groundAmb: c(0x1d2138),
    ambI: 0.9,
    fogSun: c(0x283a6a),
    cloudLit: c(0x3a4c78),
    cloudShade: c(0x161f3a),
    exposure: 1.25,
  },
  {
    e: -0.09,
    zenith: c(0x1d2c62),
    horizon: c(0x6a5d8e),
    ground: c(0x2e3158),
    glow: c(0xc56f6a),
    sun: c(0xff9a6a),
    sunI: 0,
    skyAmb: c(0x5a6aa0),
    groundAmb: c(0x2a2840),
    ambI: 0.95,
    fogSun: c(0xb0707a),
    cloudLit: c(0x9a6f8e),
    cloudShade: c(0x2e2f55),
    exposure: 1.18,
  },
  {
    e: 0,
    zenith: c(0x3b58a6),
    horizon: c(0xf29a6e),
    ground: c(0x9a7a8a),
    glow: c(0xff9a55),
    sun: c(0xff8c4a),
    sunI: 0.9,
    skyAmb: c(0x8290c4),
    groundAmb: c(0x5a4a55),
    ambI: 1,
    fogSun: c(0xffa468),
    cloudLit: c(0xffa27a),
    cloudShade: c(0x6a5a8e),
    exposure: 1.1,
  },
  {
    e: 0.08,
    zenith: c(0x4a78c8),
    horizon: c(0xffc08a),
    ground: c(0xc7a08a),
    glow: c(0xffb070),
    sun: c(0xffb070),
    sunI: 1.9,
    skyAmb: c(0x9fb4e0),
    groundAmb: c(0x7a6655),
    ambI: 1.05,
    fogSun: c(0xffc890),
    cloudLit: c(0xffd0a8),
    cloudShade: c(0x8a86b0),
    exposure: 1.05,
  },
  {
    e: 0.22,
    zenith: c(0x3f86dc),
    horizon: c(0xd8e6ec),
    ground: c(0xb9c4c4),
    glow: c(0xffe0b0),
    sun: c(0xffe2b8),
    sunI: 2.7,
    skyAmb: c(0xb4d0f2),
    groundAmb: c(0x8a7a62),
    ambI: 1.1,
    fogSun: c(0xfff0d6),
    cloudLit: c(0xfff6ea),
    cloudShade: c(0xa2b0d2),
    exposure: 1,
  },
  {
    e: 0.5,
    zenith: c(0x2f7fe0),
    horizon: c(0xc8e6f7),
    ground: c(0xb5d0dc),
    glow: c(0xfff4dc),
    sun: c(0xfff3e2),
    sunI: 3,
    skyAmb: c(0xbcdcff),
    groundAmb: c(0x8f8266),
    ambI: 1.15,
    fogSun: c(0xf4f4ee),
    cloudLit: c(0xffffff),
    cloudShade: c(0xa9b9da),
    exposure: 1,
  },
  {
    e: 1,
    zenith: c(0x2a78dc),
    horizon: c(0xc4e4f8),
    ground: c(0xb5d0dc),
    glow: c(0xfff6e4),
    sun: c(0xfff6ea),
    sunI: 3.1,
    skyAmb: c(0xbfdeff),
    groundAmb: c(0x908468),
    ambI: 1.15,
    fogSun: c(0xf4f6f2),
    cloudLit: c(0xffffff),
    cloudShade: c(0xaebedd),
    exposure: 1,
  },
];

export function createSkyLook(): SkyLook { // rA (51642)
  return {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    ground: new THREE.Color(),
    glow: new THREE.Color(),
    sun: new THREE.Color(),
    sunI: 0,
    skyAmb: new THREE.Color(),
    groundAmb: new THREE.Color(),
    ambI: 1,
    fogSun: new THREE.Color(),
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
    exposure: 1,
  };
}

type LookColorKey = 'zenith' | 'horizon' | 'ground' | 'glow' | 'sun' | 'skyAmb' | 'groundAmb' | 'fogSun' | 'cloudLit' | 'cloudShade';

export const LOOK_COLOR_KEYS: LookColorKey[] = [ // iA (51659)
  'zenith',
  'horizon',
  'ground',
  'glow',
  'sun',
  'skyAmb',
  'groundAmb',
  'fogSun',
  'cloudLit',
  'cloudShade',
];

/** Interpolates the keyframes (smoothstep between the two around sunY) into `out`. */
export function sampleSkyLook(sunY: number, out: SkyLook = createSkyLook()): SkyLook { // aA (51671)
  let n = 0;
  for (; n < SKY_KEYFRAMES.length - 2 && sunY > SKY_KEYFRAMES[n + 1].e; ) n++;
  const a = SKY_KEYFRAMES[n];
  const b = SKY_KEYFRAMES[n + 1];
  let k = THREE.MathUtils.clamp((sunY - a.e) / (b.e - a.e), 0, 1);
  k = k * k * (3 - 2 * k);
  for (const key of LOOK_COLOR_KEYS) out[key].copy(a[key]).lerp(b[key], k);
  out.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, k);
  out.ambI = THREE.MathUtils.lerp(a.ambI, b.ambI, k);
  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, k);
  return out;
}

/** Day/night clock. `t` runs 0..1 (0.25 = sunrise); nights run 2.6x faster. */
export class DayClock { // oA (51686)
  t = 0.3;
  daySeconds = 840;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  /** Target time of day; the clock eases toward it while set. */
  frozen: number | null = null;

  constructor() {
    this.computeDirs();
  }

  update(dt: number) {
    if (this.frozen !== null) {
      let d = this.frozen - this.t;
      if (d > 0.5) --d;
      if (d < -0.5) d += 1;
      this.t = (this.t + d * Math.min(1, dt * 1.5) + 1) % 1;
    } else {
      const isNight = this.sunDir.y < -0.06;
      this.t = (this.t + (dt / (this.daySeconds * 2)) * (isNight ? 2.6 : 1)) % 1;
    }
    this.computeDirs();
  }

  computeDirs() {
    const a = (this.t - 0.25) * Math.PI * 2;
    const tilt = 0.5;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    const m = a + Math.PI + 0.35;
    this.moonDir
      .set(Math.cos(m) * 0.9, Math.sin(m) * Math.cos(0.3), -Math.sin(m) * Math.sin(0.3) + 0.2)
      .normalize();
  }

  /** 0 by day, 1 at night. */
  get night() {
    return THREE.MathUtils.smoothstep(-this.sunDir.y, 0.02, 0.2);
  }
}
