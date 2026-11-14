// Port of play-inUT-NSi.js 52276-52636: weather presets and Markov tables, GPU rain streaks with
// splash ripples (wA), the lightning bolt (TA) and the weather controller (EA).
import * as THREE from 'three';
import { ATMO } from '../render/atmosphere';
import { NOISE_GLSL } from '../render/glsl/noise';

export type WeatherState = 'clear' | 'fair' | 'cloudy' | 'rain' | 'storm' | 'mist';
export type WeatherMode = 'dynamic' | 'clear' | 'rain' | 'storm';

export interface WeatherPreset {
  cover: number;
  overcast: number;
  rain: number;
  storm: number;
  mist: number;
  wind: number;
}

export const WEATHER_PRESETS: Record<WeatherState, WeatherPreset> = { // xA (52276)
  clear: { cover: 0.32, overcast: 0, rain: 0, storm: 0, mist: 0, wind: 0.3 },
  fair: { cover: 0.5, overcast: 0.08, rain: 0, storm: 0, mist: 0, wind: 0.42 },
  cloudy: { cover: 0.78, overcast: 0.55, rain: 0, storm: 0, mist: 0.05, wind: 0.55 },
  rain: { cover: 0.92, overcast: 0.85, rain: 0.75, storm: 0, mist: 0.18, wind: 0.62 },
  storm: { cover: 1, overcast: 1, rain: 1, storm: 1, mist: 0.12, wind: 1.05 },
  mist: { cover: 0.38, overcast: 0.25, rain: 0, storm: 0, mist: 1, wind: 0.08 },
};

/** Next-state weights. */
export const WEATHER_NEXT: Record<WeatherState, [WeatherState, number][]> = { // SA (52284)
  clear: [
    ['fair', 5],
    ['cloudy', 2],
    ['mist', 1],
  ],
  fair: [
    ['clear', 4],
    ['cloudy', 3],
  ],
  cloudy: [
    ['rain', 4],
    ['fair', 3],
    ['clear', 1],
  ],
  rain: [
    ['cloudy', 4],
    ['storm', 2],
    ['fair', 1],
  ],
  storm: [['rain', 1]],
  mist: [
    ['clear', 3],
    ['fair', 2],
  ],
};

/** Duration [min, max] in seconds. */
export const WEATHER_DURATION: Record<WeatherState, [number, number]> = { // CA (52310)
  clear: [240, 480],
  fair: [150, 300],
  cloudy: [90, 180],
  rain: [100, 200],
  storm: [60, 120],
  mist: [90, 160],
};

/** The floating hub island: no rain below it inside radius r. */
export interface RainHub {
  x: number;
  y: number;
  z: number;
  r: number;
}

export class Rain { // wA (52318)
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  mat: THREE.ShaderMaterial;
  splash: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  splashMat: THREE.ShaderMaterial;

  /**
   * @param count streak instances
   * @param heightTex top-down ground height capture (r = ground y), from the grass field
   * @param heightVP view-projection matrix of that capture
   * @param hub floating island cylinder
   */
  constructor(count: number, heightTex: THREE.Texture | null, heightVP: THREE.Matrix4, hub: RainHub) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let e = 0; e < seeds.length; e++) seeds[e] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    const shared = {
      uHeightTex: { value: heightTex },
      uHeightVP: { value: heightVP },
      uHub: { value: new THREE.Vector4(hub.x, hub.y, hub.z, hub.r) },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uBox: { value: new THREE.Vector3(38, 26, 38) },
        uVel: { value: new THREE.Vector3(2, -15, 1) },
        uOff: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(0.75, 0.8, 0.9) },
      },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uAmount; uniform vec3 uBox; uniform vec3 uVel; uniform vec3 uOff;
        uniform sampler2D uHeightTex; uniform mat4 uHeightVP; uniform vec4 uHub;
        varying float vA; varying float vT;
        void main() {
          vec3 lo = cameraPosition - uBox * 0.5;
          vec3 p = aSeed.xyz * uBox + uOff * (0.85 + aSeed.w * 0.3);
          p = lo + mod(p - lo, uBox);
          // hidden below the ground (tunnels) and under the floating island
          vec4 hc = uHeightVP * vec4(p.x, 0.0, p.z, 1.0);
          vec2 huv = hc.xy * 0.5 + 0.5;
          float ground = texture2D(uHeightTex, huv).r;
          float visible = step(aSeed.w, uAmount) * step(ground, p.y);
          visible *= 1.0 - step(length(p.xz - uHub.xz), uHub.w) * step(p.y, uHub.y);
          vec3 axis = normalize(uVel);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(axis, toCam)) * 0.012;
          float len = 0.55 + aSeed.w * 0.35;
          vec3 wp = p + side * position.x + axis * len * position.y;
          vT = position.y;
          float d = length(cameraPosition - p);
          vA = visible * smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(uBox.x * 0.35, uBox.x * 0.5, d));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA; varying float vT;
        void main() {
          if (vA < 0.01) discard;
          float a = vA * smoothstep(0.0, 0.3, vT) * smoothstep(1.0, 0.6, vT) * 0.34;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    const sGeo = new THREE.InstancedBufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
    sGeo.setIndex([0, 2, 1, 0, 3, 2]);
    const sSeeds = new Float32Array(2800);
    for (let e = 0; e < sSeeds.length; e++) sSeeds[e] = Math.random();
    sGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sSeeds, 4));
    sGeo.instanceCount = 700;
    this.splashMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uAmount;
        uniform sampler2D uHeightTex; uniform mat4 uHeightVP; uniform vec4 uHub;
        varying vec2 vUv; varying float vA; varying float vK;
        ${NOISE_GLSL}
        void main() {
          float cyc = uTime * (1.6 + aSeed.w) + aSeed.z * 10.0;
          float k = fract(cyc);
          float n = floor(cyc);
          // a new random spot every cycle, within 14m of the camera
          vec2 r = nzHash22(vec2(n, aSeed.x * 97.0)) - 0.5;
          vec2 xz = cameraPosition.xz + r * 28.0;
          vec4 hc = uHeightVP * vec4(xz.x, 0.0, xz.y, 1.0);
          vec4 g = texture2D(uHeightTex, hc.xy * 0.5 + 0.5);
          float vis = step(aSeed.y, uAmount);
          vis *= 1.0 - step(length(xz - uHub.xz), uHub.w) * step(g.r, uHub.y);
          float s = 0.04 + k * 0.16;
          vec3 wp = vec3(xz.x + position.x * s, g.r + 0.04, xz.y + position.z * s);
          vUv = position.xz;
          vK = k;
          vA = vis;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vA; varying float vK;
        void main() {
          float d = length(vUv);
          float ring = smoothstep(0.7, 0.85, d) * smoothstep(1.0, 0.88, d);
          float a = ring * vA * (1.0 - vK) * 0.5;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.splash = new THREE.Mesh(sGeo, this.splashMat);
    this.splash.frustumCulled = false;
    this.splash.renderOrder = 7;
  }
}

export class Lightning { // TA (52434)
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
  life = 0;

  constructor() {
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.85, 0.9, 1).multiplyScalar(6),
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** Builds a jagged bolt from `top` to `ground` with 3 branches, as camera-facing ribbons. */
  strike(top: THREE.Vector3, ground: THREE.Vector3, camPos: THREE.Vector3) {
    const paths: THREE.Vector3[][] = [];
    const main = [top.clone(), ground.clone()];
    for (let n = 0; n < 6; n++) {
      const amp = (top.distanceTo(ground) * 0.12) / (n + 1);
      for (let e = main.length - 1; e > 0; e--) {
        const mid = main[e - 1].clone().lerp(main[e], 0.5);
        mid.x += (Math.random() - 0.5) * amp;
        mid.z += (Math.random() - 0.5) * amp;
        mid.y += (Math.random() - 0.5) * amp * 0.3;
        main.splice(e, 0, mid);
      }
    }
    paths.push(main);
    for (let b = 0; b < 3; b++) {
      const branch = [main[4 + Math.floor(Math.random() * (main.length - 12))].clone()];
      const dir = new THREE.Vector3((Math.random() - 0.5) * 2, -1.2, (Math.random() - 0.5) * 2).normalize();
      for (let n = 0; n < 8; n++)
        branch.push(
          branch[branch.length - 1]
            .clone()
            .addScaledVector(dir, 8 + Math.random() * 8)
            .add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)),
        );
      paths.push(branch);
    }
    const pos: number[] = [];
    for (const path of paths) {
      const half = path === main ? 1.4 : 0.6;
      for (let r = 0; r < path.length - 1; r++) {
        const a = path[r];
        const b = path[r + 1];
        const side = b
          .clone()
          .sub(a)
          .normalize()
          .clone()
          .cross(camPos.clone().sub(a).normalize())
          .normalize()
          .multiplyScalar(half);
        const c = a.clone().add(side);
        const l = a.clone().sub(side);
        const u = b.clone().add(side);
        const d = b.clone().sub(side);
        pos.push(c.x, c.y, c.z, l.x, l.y, l.z, u.x, u.y, u.z, l.x, l.y, l.z, d.x, d.y, d.z, u.x, u.y, u.z);
      }
    }
    this.mesh.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.mesh.geometry = geo;
    this.life = 0.35;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.life <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.life -= dt;
    this.mat.opacity = Math.random() < 0.7 ? Math.min(1, this.life * 4) : 0.15;
  }
}

export class Weather { // EA (52532)
  group = new THREE.Group();
  state: WeatherState = 'clear';
  /** Current values, eased toward the preset of `state`. */
  now: WeatherPreset = { ...WEATHER_PRESETS.clear };
  mode: WeatherMode = 'dynamic';
  wet = 0;
  flash = 0;
  /** Called with the strike distance (thunder delay). */
  onStrike: (dist: number) => void = () => {};
  timer = 200;
  rain: Rain;
  bolt = new Lightning();
  strikeT = 12;
  flashSeq: number[] = [];
  windAngle = 0.3;
  time = 0;

  constructor(heightTex: THREE.Texture | null, heightVP: THREE.Matrix4, hub: RainHub, rainCount = 7000) {
    this.rain = new Rain(rainCount, heightTex, heightVP, hub);
    this.group.add(this.rain.mesh, this.rain.splash, this.bolt.mesh);
  }

  setMode(mode: WeatherMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'clear') this.state = 'clear';
    else if (mode === 'rain') this.state = 'rain';
    else if (mode === 'storm') this.state = 'storm';
    else this.timer = 60;
  }

  force(state: WeatherState) {
    this.state = state;
    this.now = { ...WEATHER_PRESETS[state] };
    this.timer = 120;
  }

  pickNext() {
    const options = WEATHER_NEXT[this.state];
    let total = 0;
    for (const [, w] of options) total += w;
    let n = Math.random() * total;
    for (const [s, w] of options)
      if (((n -= w), n <= 0)) {
        this.state = s;
        break;
      }
    const [lo, hi] = WEATHER_DURATION[this.state];
    this.timer = lo + Math.random() * (hi - lo);
  }

  /**
   * @param underground 0..1 (environment underground blend); rain and flash are off underground
   * @param groundHeight surface height at (x, z), for the strike point
   */
  update(dt: number, camera: THREE.Camera, underground: number, groundHeight: (x: number, z: number) => number) {
    this.time += dt;
    if (this.mode === 'dynamic') {
      this.timer -= dt;
      if (this.timer <= 0) this.pickNext();
    }
    const target = WEATHER_PRESETS[this.state];
    const ease = Math.min(1, dt * 0.05);
    for (const key of Object.keys(target) as (keyof WeatherPreset)[]) this.now[key] += (target[key] - this.now[key]) * ease;
    const now = this.now;
    this.wet = THREE.MathUtils.clamp(this.wet + (now.rain > 0.2 ? dt * 0.03 * now.rain : -dt * 0.006), 0, 1);
    ATMO.params.y = this.wet;
    this.windAngle += dt * 0.01 * Math.sin(this.time * 0.013);
    const wx = Math.cos(this.windAngle);
    const wz = Math.sin(this.windAngle);
    const strength = 0.25 + now.wind * 0.75;
    ATMO.wind.set(wx, wz, strength, 0);
    const scroll = ATMO.windScroll;
    scroll.set(scroll.x + wx * dt, scroll.y + wz * dt, scroll.z + wx * strength * dt, scroll.w + wz * strength * dt);
    const above = 1 - underground;
    const ru = this.rain.mat.uniforms;
    ru.uTime.value = this.time;
    ru.uAmount.value = now.rain * above;
    const push = 0.35 + now.wind * 2.2;
    (ru.uVel.value as THREE.Vector3).set(Math.cos(this.windAngle) * push, -15 - now.storm * 4, Math.sin(this.windAngle) * push);
    (ru.uOff.value as THREE.Vector3).addScaledVector(ru.uVel.value, dt);
    this.rain.mesh.visible = now.rain * above > 0.02;
    const su = this.rain.splashMat.uniforms;
    su.uTime.value = this.time;
    su.uAmount.value = now.rain * above;
    this.rain.splash.visible = this.rain.mesh.visible;
    this.bolt.update(dt);
    if (now.storm > 0.6 && ((this.strikeT -= dt), this.strikeT <= 0)) {
      this.strikeT = 5 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      const dist = 140 + Math.random() * 320;
      const x = camera.position.x + Math.cos(a) * dist;
      const z = camera.position.z + Math.sin(a) * dist;
      this.bolt.strike(
        new THREE.Vector3(x + (Math.random() - 0.5) * 60, 260, z + (Math.random() - 0.5) * 60),
        new THREE.Vector3(x, groundHeight(x, z), z),
        camera.position,
      );
      this.flashSeq = [0, 0.09, 0.2];
      this.onStrike(dist);
    }
    this.flash = 0;
    for (let t = this.flashSeq.length - 1; t >= 0; t--) {
      this.flashSeq[t] -= dt;
      const n = -this.flashSeq[t];
      if (n >= 0) this.flash = Math.max(this.flash, Math.max(0, 1 - n * 9) * (t === 0 ? 1 : 0.7));
      if (n > 0.3) this.flashSeq.splice(t, 1);
    }
    this.flash *= above;
  }
}
