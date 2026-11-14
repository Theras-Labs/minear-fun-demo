// Port of play-inUT-NSi.js lines 28796-28924 (sonar rock terrain material), 28957-29009 (sonar ping sphere)
// and 29010-29071 (sonar blip points).
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise';

export interface SonarRockUniforms {
  [name: string]: THREE.IUniform;
  uPlayer: { value: THREE.Vector3 };
  uCam: { value: THREE.Vector3 };
  uNear: { value: number };
  uFar: { value: number };
  uTime: { value: number };
  uFade: { value: number };
  uPing: { value: number };
  uFlashPos: { value: THREE.Vector3 };
  uFlashCol: { value: THREE.Color };
  uFlashK: { value: number };
  uOreSight: { value: number };
}

export interface SonarRock {
  material: THREE.ShaderMaterial;
  uniforms: SonarRockUniforms;
}

/** The see-through "burrow" rock: one transparent ShaderMaterial for every chunk mesh while burrowing. */
export function createSonarRock(): SonarRock { // Ap (28796)
  const uniforms: SonarRockUniforms = {
    uPlayer: { value: new THREE.Vector3() },
    uCam: { value: new THREE.Vector3() },
    uNear: { value: 3.2 },
    uFar: { value: 30 },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uPing: { value: -1 },
    uFlashPos: { value: new THREE.Vector3() },
    uFlashCol: { value: new THREE.Color() },
    uFlashK: { value: 0 },
    uOreSight: { value: 0 },
  };
  return {
    material: new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
      attribute vec3 color;
      attribute float glow;
      attribute float carved;
      attribute float aMat;
      attribute float ore;
      attribute vec3 oreCol;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vGlow;
      varying float vCarved;
      varying float vOre;
      varying vec3 vOreCol;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vCol = color;
        vGlow = glow;
        vCarved = carved;
        vOre = ore;
        vOreCol = oreCol;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
      fragmentShader: `
      uniform vec3 uPlayer; uniform vec3 uCam; uniform float uNear; uniform float uFar;
      uniform float uTime; uniform float uFade; uniform float uPing;
      uniform vec3 uFlashPos; uniform vec3 uFlashCol; uniform float uFlashK; uniform float uOreSight;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vGlow;
      varying float vCarved;
      varying float vOre;
      varying vec3 vOreCol;
      ${NOISE_GLSL}

      float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

      void main() {
        // part smooth, part faceted: the rock stays chunky and gritty rather than glassy
        vec3 flatN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        if (dot(flatN, N) < 0.0) flatN = -flatN;
        N = normalize(mix(N, flatN, 0.55));
        vec3 V = normalize(uCam - vWorld);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 2.0);

        vec3 body = uPlayer + vec3(0.0, 0.8, 0.0);
        float dP = length(vWorld - body);
        float dC = length(vWorld - uCam);

        // lit by the miner's own glow
        vec3 L = normalize(body - vWorld);
        float lam = 0.35 + 0.65 * abs(dot(N, L));
        float near = 1.0 - smoothstep(uNear, uNear * 2.6, dP);
        float mid = 1.0 - smoothstep(uNear * 1.5, uFar * 0.55, dP); // things further away get vaguer
        float fade = 1.0 - smoothstep(uFar * 0.25, uFar, dC);

        // see-through cutaway along the line of sight to the miner
        vec3 toBody = body - uCam;
        float t = clamp(dot(vWorld - uCam, toBody) / dot(toBody, toBody), 0.0, 1.0);
        float sight = length(uCam + toBody * t - vWorld);
        float cut = (dC < length(toBody)) ? smoothstep(0.7, 1.9, sight) : 1.0;

        // gritty, earthy grain, fixed in the rock (the murky burrow look), over a soft mottling
        float grain = hash31(floor(vWorld * 7.0)) * 0.6 + hash31(floor(vWorld * 2.3)) * 0.4;
        float mott = nzValue3(vWorld * 0.8) * 0.6 + nzValue3(vWorld * 2.7) * 0.4;

        // topographic contour lines every 1.5 m of height: the rock reads like a sonar map
        float ly = vWorld.y / 1.5;
        float lw = max(fwidth(ly), 1e-4);
        float line = (1.0 - smoothstep(0.0, lw * 1.3, abs(fract(ly + 0.5) - 0.5))) * mid;

        vec3 tunnelTint = vec3(0.34, 0.8, 0.84);
        vec3 edgeTint = mix(vec3(1.0, 0.74, 0.46), tunnelTint, vCarved);
        vec3 col = vCol * lam * (0.4 + 0.34 * near) * (0.86 + 0.28 * mott) * (0.64 + 0.66 * grain);
        col += edgeTint * fres * (0.42 + 0.65 * vCarved * (1.0 - near * 0.5));
        col += edgeTint * line * 0.16;
        col += vCol * vGlow * 3.0 * (1.0 - clamp(vOre, 0.0, 1.0));

        // sonar shell passing through the rock
        float ping = uPing > 0.0 ? exp(-abs(dP - uPing) * 1.4) : 0.0;
        col += vec3(0.4, 0.95, 1.0) * ping * 0.6;

        // a rare find lights up the rock around it
        float fl = uFlashK * exp(-length(vWorld - uFlashPos) * 0.22);
        col += uFlashCol * fl * (0.6 + 0.8 * fres);

        // Ore Sight: veins glimmer through the murk in their own colors
        float oreK = 0.0;
        if (vOre > 0.05 && uOreSight > 0.0) {
          vec3 oc = vOreCol / max(vOre, 1e-3);
          float pulse = 0.7 + 0.3 * sin(uTime * 2.2 + nzValue3(vWorld * 0.7) * 6.28);
          oreK = uOreSight * 0.45 * smoothstep(0.1, 0.6, vOre) * pulse * (0.35 + 0.65 * mid);
          col += oc * oreK;
        }

        float alpha = (0.04 + 0.34 * near + fres * (0.16 + 0.34 * mid) + 0.1 * vCarved + line * 0.12 + vGlow * 0.6 + ping * 0.25 + fl * 0.35 + oreK * 0.4) * fade * cut;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85) * uFade);
      }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
    uniforms,
  };
}

/** Expanding additive rim-lit sphere of a sonar ping. */
export class SonarPing { // Mp (28957)
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  radius = -1;
  mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(7333631) } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uAlpha; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
          gl_FragColor = vec4(uColor * 1.8, rim * uAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 30;
    this.mesh.frustumCulled = false;
  }
  fire(): void {
    this.radius = 0.5;
  }
  update(dt: number, center: THREE.Vector3, maxRadius: number, speed = 26): void {
    if (this.radius < 0) {
      this.mesh.visible = false;
      return;
    }
    this.radius += dt * speed;
    const i = this.radius / maxRadius;
    if (i >= 1) {
      this.radius = -1;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.copy(center);
    this.mesh.scale.setScalar(this.radius);
    this.mat.uniforms.uAlpha.value = 0.55 * (1 - i) * Math.min(1, i * 6);
  }
}

export interface SonarBlip {
  p: THREE.Vector3;
  color: THREE.Color;
  size: number;
}

/** Pool of camera-scaled glowing point sprites (core + ring) for things the sonar finds. */
export class SonarBlips { // Np (29010)
  cap: number;
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  geo: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  constructor(cap = 256) {
    this.cap = cap;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float core = 1.0 - smoothstep(0.0, 0.5, d);
          float ring = smoothstep(0.34, 0.4, d) * (1.0 - smoothstep(0.42, 0.5, d));
          gl_FragColor = vec4(vColor, core * core * 0.9 + ring * 0.8);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 25;
  }
  set(list: readonly SonarBlip[]): void {
    const n = Math.min(list.length, this.cap);
    for (let k = 0; k < n; k++) {
      const b = list[k];
      this.pos[k * 3] = b.p.x;
      this.pos[k * 3 + 1] = b.p.y;
      this.pos[k * 3 + 2] = b.p.z;
      this.col[k * 3] = b.color.r;
      this.col[k * 3 + 1] = b.color.g;
      this.col[k * 3 + 2] = b.color.b;
      this.size[k] = b.size;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size']) this.geo.getAttribute(name).needsUpdate = true;
  }
}
