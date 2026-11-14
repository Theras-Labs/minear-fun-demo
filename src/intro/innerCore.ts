// The Inner Core: the set piece at 100,000 m for the intro film (src/intro/film.ts).
// A molten heart inside a cracked obsidian shell, held by three rune seal rings. The film drives
// wake (0 asleep, 1 awake), pulse (heartbeat flash), eye (0 shut, 1 open), seal (1 whole, 0 broken)
// and wave (shockwave progress) each frame.
import * as THREE from 'three';
import { NOISE_GLSL } from '../render/glsl/noise';

const HOT = new THREE.Color(0xff6a1a);
const SEAL = new THREE.Color(0x5dffc4);

/** Thin prism plates of a shell, one per icosahedron face, with per-plate centre and random attributes. */
function shellGeometry(radius: number, detail: number, gap: number, thick: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(radius, detail).toNonIndexed();
  const p = ico.getAttribute('position');
  const pos: number[] = [];
  const centre: number[] = [];
  const rand: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const m = new THREE.Vector3();
  const tri = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, r: number) => {
    for (const v of [x, y, z]) {
      pos.push(v.x, v.y, v.z);
      centre.push(m.x, m.y, m.z);
      rand.push(r);
    }
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    m.copy(a).add(b).add(c).divideScalar(3);
    const shrink = (v: THREE.Vector3) => v.clone().lerp(m, gap);
    const ao = shrink(a);
    const bo = shrink(b);
    const co = shrink(c);
    const n = m.clone().normalize();
    const ai = ao.clone().addScaledVector(n, -thick);
    const bi = bo.clone().addScaledVector(n, -thick);
    const ci = co.clone().addScaledVector(n, -thick);
    const r = rnd();
    tri(ao, bo, co, r);
    tri(ai, ci, bi, r);
    for (const [u, v, ui, vi] of [
      [ao, bo, ai, bi],
      [bo, co, bi, ci],
      [co, ao, ci, ai],
    ] as const) {
      tri(u, ui, v, r);
      tri(v, ui, vi, r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(centre, 3));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rand, 1));
  g.computeVertexNormals();
  return g;
}

export class InnerCore {
  readonly group = new THREE.Group();
  readonly radius: number;
  wake = 0;
  pulse = 0;
  eye = 0;
  seal = 1;
  wave = -1;
  /** Unit vector from the core centre toward the viewer; the eye and the opening plates face it. */
  readonly look = new THREE.Vector3(0, 0, 1);
  readonly light = new THREE.PointLight(0xff5a1e, 0, 160, 1.15);
  readonly sealLight = new THREE.PointLight(0x5dffc4, 0, 90, 1.3);

  private coreU = {
    uTime: { value: 0 },
    uWake: { value: 0 },
    uPulse: { value: 0 },
  };
  private shellU = {
    uOpen: { value: 0 },
    uEyeOpen: { value: 0 },
    uLook: { value: new THREE.Vector3(0, 0, 1) },
    uHeat: { value: 0 },
  };
  private eyeU = {
    uOpen: { value: 0 },
    uTime: { value: 0 },
    uHeat: { value: 0 },
  };
  private rings: { mesh: THREE.Mesh; u: { uTime: { value: number }; uSeal: { value: number }; uFlick: { value: number } }; axis: THREE.Vector3; speed: number; tilt: THREE.Quaternion }[] = [];
  private eyeMesh: THREE.Mesh;
  private debris: THREE.InstancedMesh;
  private debrisData: { r: number; a: number; y: number; s: number; spin: THREE.Vector3; speed: number }[] = [];
  private waveRing: THREE.Mesh;
  private waveShell: THREE.Mesh;
  private waveMat: THREE.MeshBasicMaterial;
  private shellMat2: THREE.MeshBasicMaterial;

  constructor(radius = 7) {
    this.radius = radius;
    const g = this.group;

    // the molten heart
    const coreMat = new THREE.ShaderMaterial({
      uniforms: this.coreU,
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vObj = position;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uWake;
        uniform float uPulse;
        varying vec3 vObj;
        varying vec3 vN;
        varying vec3 vView;
        ${NOISE_GLSL}
        void main() {
          vec3 p = normalize(vObj) * 2.2;
          float flow = nzFbm3(p * 1.4 + vec3(0.0, uTime * 0.18, uTime * 0.07));
          float veins = 1.0 - abs(nzFbm3(p * 2.6 - vec3(uTime * 0.11, 0.0, uTime * 0.05)) * 2.0 - 1.0);
          veins = pow(veins, 6.0);
          float heat = clamp(flow * 0.9 + veins * 0.9, 0.0, 1.6);
          vec3 deep = vec3(0.22, 0.02, 0.04);
          vec3 hot = vec3(1.0, 0.36, 0.08);
          vec3 white = vec3(1.0, 0.86, 0.55);
          vec3 col = mix(deep, hot, smoothstep(0.35, 0.85, heat));
          col = mix(col, white, smoothstep(1.0, 1.45, heat));
          float rim = pow(1.0 - max(dot(vN, vView), 0.0), 2.5);
          float lvl = 0.45 + 0.75 * uWake + 1.6 * uPulse;
          col = col * lvl + vec3(1.0, 0.42, 0.12) * rim * (0.6 + 1.8 * uWake + 2.0 * uPulse);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 6), coreMat));

    // the cracked obsidian shell: plates push out as the core wakes, and part wide around the eye
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x3a2633, roughness: 0.62, metalness: 0.15, flatShading: true });
    shellMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.shellU);
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aCentre;
attribute float aRand;
uniform float uOpen;
uniform float uEyeOpen;
uniform vec3 uLook;
varying float vHeat;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec3 dirC = normalize(aCentre);
float facing = smoothstep(0.78, 0.96, dot(dirC, uLook));
vec3 aside = dirC - uLook * dot(dirC, uLook);
aside = length(aside) > 1e-4 ? normalize(aside) : vec3(1.0, 0.0, 0.0);
float push = uOpen * (0.25 + aRand * 1.1);
float fold = facing * uEyeOpen;
transformed += dirC * (push + fold * 0.35) + aside * fold * (1.7 + aRand * 0.6);
vHeat = min(push + fold, 1.0);`,
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uHeat;
varying float vHeat;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.28, 0.07) * (0.04 + min(uHeat, 1.5) * 0.08) * (0.5 + vHeat);
float rimK = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
totalEmissiveRadiance += vec3(0.75, 0.28, 0.55) * rimK * 0.55;`,
        );
    };
    const shell = new THREE.Mesh(shellGeometry(radius * 1.1, 2, 0.14, radius * 0.06), shellMat);
    g.add(shell);
    // a back-face glow behind the plates so the gaps read as light
    this.shellMat2 = new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.35, 4), this.shellMat2));

    // the eye: an almond lid with a fiery iris and a slit pupil
    const eyeMat = new THREE.ShaderMaterial({
      uniforms: this.eyeU,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpen;
        uniform float uTime;
        uniform float uHeat;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv;
          float lid = 0.62 * pow(max(1.0 - p.x * p.x, 0.0), 0.85);
          float open = lid * uOpen;
          float edge = abs(p.y) - open;
          float inside = 1.0 - smoothstep(-0.015, 0.015, edge);
          float crack = (1.0 - smoothstep(0.0, 0.05, abs(edge))) * step(abs(p.x), 0.98);
          float r = length(p * vec2(1.0, 1.15));
          float ang = atan(p.y, p.x);
          float streak = 0.5 + 0.5 * sin(ang * 34.0 + sin(r * 9.0 - uTime * 2.0) * 1.4);
          vec3 iris = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.3, 0.05), smoothstep(0.08, 0.62, r));
          iris *= 0.75 + 0.35 * streak;
          iris *= 1.0 - smoothstep(0.55, 0.75, r) * 0.7;
          float slitW = 0.07 + 0.05 * uOpen;
          float slit = 1.0 - smoothstep(slitW * 0.7, slitW, abs(p.x) / max(sqrt(max(1.0 - p.y * p.y * 1.4, 0.0)), 0.001));
          vec3 col = iris * (2.2 + uHeat * 2.0);
          col = mix(col, vec3(0.02, 0.0, 0.0), slit * step(r, 0.95));
          float a = inside;
          col = mix(vec3(1.0, 0.55, 0.2) * 3.0, col, inside);
          a = max(a, crack * 0.9);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.eyeMesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.15, radius * 1.15), eyeMat);
    this.eyeMesh.renderOrder = 5;
    g.add(this.eyeMesh);

    // three rune seal rings
    const ringGeo = (R: number) => new THREE.CylinderGeometry(R, R, radius * 0.11, 220, 1, true);
    for (let i = 0; i < 3; i++) {
      const u = { uTime: { value: 0 }, uSeal: { value: 1 }, uFlick: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uSeal;
          uniform float uFlick;
          varying vec2 vUv;
          float h(float n) { return fract(sin(n * 91.3) * 43758.5453); }
          void main() {
            float u = vUv.x * 96.0;
            float cell = floor(u);
            float f = fract(u);
            float glyph = step(0.18, f) * step(f, 0.82);
            float bars = step(0.5, h(cell + floor(vUv.y * 3.0) * 7.0));
            float band = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
            float rails = step(vUv.y, 0.12) + step(0.88, vUv.y);
            float rune = glyph * bars * step(0.25, vUv.y) * step(vUv.y, 0.75);
            float on = max(rails * 0.85, rune);
            float flick = 1.0 - uFlick * step(0.5, h(floor(uTime * 24.0) + cell * 0.1));
            vec3 col = vec3(0.36, 1.0, 0.77) * (1.4 * on + 0.12 * band) * flick;
            gl_FragColor = vec4(col * uSeal, 1.0);
          }`,
      });
      const R = radius * (1.42 + i * 0.17);
      const mesh = new THREE.Mesh(ringGeo(R), mat);
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35 + i * 0.9, i * 1.1, 0.2 - i * 0.45));
      this.rings.push({ mesh, u, axis: new THREE.Vector3(0, 1, 0), speed: 0.12 * (i % 2 ? -1 : 1) * (1 + i * 0.3), tilt });
      g.add(mesh);
    }

    // orbiting rubble
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a1c24, roughness: 0.9, flatShading: true, emissive: 0x3a0a08, emissiveIntensity: 0.4 });
    const N = 70;
    this.debris = new THREE.InstancedMesh(rock, rockMat, N);
    let seed = 31;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++)
      this.debrisData.push({
        r: radius * (2.0 + rnd() * 1.0),
        a: rnd() * Math.PI * 2,
        y: (rnd() - 0.5) * radius * 0.9,
        s: 0.25 + rnd() * rnd() * 1.1,
        spin: new THREE.Vector3(rnd(), rnd(), rnd()).normalize(),
        speed: 0.05 + rnd() * 0.08,
      });
    g.add(this.debris);

    // the shockwave: a flat ring and a thin sphere shell
    this.waveMat = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.waveRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 160).rotateX(-Math.PI / 2), this.waveMat);
    this.waveShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 4),
      new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
    );
    g.add(this.waveRing, this.waveShell);

    g.add(this.light, this.sealLight);
  }

  /** Points the eye and the opening plates toward a world position. */
  aim(world: THREE.Vector3): void {
    this.group.updateMatrixWorld(true);
    const local = this.group.worldToLocal(world.clone());
    this.look.copy(local).normalize();
    this.shellU.uLook.value.copy(this.look);
    this.eyeMesh.position.copy(this.look).multiplyScalar(this.radius * 1.02);
    this.eyeMesh.lookAt(this.group.localToWorld(this.look.clone().multiplyScalar(this.radius * 3)));
  }

  update(t: number): void {
    const wake = this.wake;
    this.coreU.uTime.value = t;
    this.coreU.uWake.value = wake;
    this.coreU.uPulse.value = this.pulse;
    this.shellU.uOpen.value = wake * 0.35 + this.pulse * 0.25;
    this.shellU.uEyeOpen.value = Math.min(1, this.eye * 1.4);
    this.shellU.uHeat.value = wake + this.pulse;
    this.eyeU.uOpen.value = this.eye;
    this.eyeU.uTime.value = t;
    this.eyeU.uHeat.value = this.pulse;
    this.eyeMesh.visible = wake > 0.02;
    this.shellMat2.opacity = 0.05 + wake * 0.12 + this.pulse * 0.25;

    for (const [i, r] of this.rings.entries()) {
      const broken = 1 - this.seal;
      r.u.uTime.value = t;
      r.u.uSeal.value = Math.max(0, this.seal) * (1 + this.pulse * 0.6);
      r.u.uFlick.value = Math.min(1, broken * 2.5 + this.pulse * 0.5);
      const spin = t * r.speed * (1 + broken * 14) + broken * broken * (i + 1) * 2.0;
      r.mesh.quaternion.copy(r.tilt).multiply(new THREE.Quaternion().setFromAxisAngle(r.axis, spin));
      const s = 1 + broken * broken * (0.6 + i * 0.25);
      r.mesh.scale.set(s, 1 + broken * 0.5, s);
      r.mesh.visible = this.seal > 0.01;
    }

    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3();
    const push = this.wave > 0 ? Math.min(1, this.wave * 3) : 0;
    for (const [i, d] of this.debrisData.entries()) {
      const a = d.a + t * d.speed * (1 + wake * 2);
      const r = d.r * (1 + push * 0.8);
      P.set(Math.cos(a) * r, d.y + Math.sin(t * 0.7 + i) * 0.4 * (1 + wake), Math.sin(a) * r);
      Q.setFromAxisAngle(d.spin, t * (0.3 + d.speed * 4));
      S.setScalar(d.s);
      M.compose(P, Q, S);
      this.debris.setMatrixAt(i, M);
    }
    this.debris.instanceMatrix.needsUpdate = true;

    const w = this.wave;
    const on = w >= 0 && w <= 1;
    this.waveRing.visible = this.waveShell.visible = on;
    if (on) {
      const R = this.radius * (1.2 + w * 16);
      this.waveRing.scale.setScalar(R);
      this.waveShell.scale.setScalar(R * 0.92);
      const fade = (1 - w) * (1 - w);
      this.waveMat.opacity = 1.6 * fade;
      (this.waveShell.material as THREE.MeshBasicMaterial).opacity = 0.35 * fade;
    }

    this.light.intensity = 1400 * (0.25 + wake * 1.2 + this.pulse * 2.5);
    this.light.color.copy(HOT);
    this.sealLight.intensity = 220 * Math.max(0, this.seal) * (1 - wake * 0.5);
    this.sealLight.color.copy(SEAL);
    this.group.updateMatrixWorld(true);
  }
}
