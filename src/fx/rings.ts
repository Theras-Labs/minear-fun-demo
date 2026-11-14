// Port of play-inUT-NSi.js 29352-29429: the ring pulse pool Hp.
// A fixed pool of additive, double-sided unit quads with a soft rim shader. pulse() takes the next quad
// (round robin), faces it along a normal, and grows it from r0 to r1 with an ease-out over its life while the
// band thins and fades. KR makes it with 48 quads (rings = new Hp(48), 70168), adds `group` to the scene (70360)
// and calls update(t) each frame (72077). Combat (dI) calls pulse() through the RingPulses hook.
import * as THREE from 'three';
import type { RingPulseOptions, RingPulses } from '../combat/combat';

/** Vp (29352): ring fragment shader. */
const RING_FRAGMENT = `
  uniform vec3 uColor; uniform float uLife; uniform float uAlpha; uniform float uThick;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    // a soft band at the rim, thinning as it spreads; gone at the end of its life
    float w = uThick * (1.0 - uLife * 0.6);
    float ring = smoothstep(1.0 - w, 1.0 - w * 0.45, r) * (1.0 - smoothstep(1.0 - w * 0.45, 1.0, r));
    float fade = 1.0 - uLife;
    float a = ring * fade * fade * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }`; // Vp (29352)

const RING_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Up (29428): the quad's own facing axis. */
const QUAD_AXIS = new THREE.Vector3(0, 0, 1); // Up (29428)
/** Wp (29429): scratch for the normalized facing direction. */
const tmpDir = new THREE.Vector3(); // Wp (29429)

interface RingUniforms {
  [name: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uLife: THREE.IUniform<number>;
  uAlpha: THREE.IUniform<number>;
  uThick: THREE.IUniform<number>;
}

interface RingPulse {
  mesh: THREE.Mesh;
  u: RingUniforms;
  vel: THREE.Vector3;
  t: number;
  life: number;
  r0: number;
  r1: number;
}

export class RingPulsePool implements RingPulses { // Hp (29365)
  readonly group = new THREE.Group();
  ps: RingPulse[] = [];
  next = 0;
  static geo = new THREE.PlaneGeometry(1, 1);

  constructor(count = 40) {
    for (let i = 0; i < count; i++) {
      const u: RingUniforms = {
        uColor: { value: new THREE.Color() },
        uLife: { value: 1 },
        uAlpha: { value: 0.5 },
        uThick: { value: 0.35 },
      };
      const material = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(RingPulsePool.geo, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.ps.push({ mesh, u, vel: new THREE.Vector3(), t: 1, life: 1, r0: 0, r1: 0 });
    }
  }

  /** Starts a ring at pos facing along normal (29395). `speed` drifts it along the normal. */
  pulse(pos: THREE.Vector3, normal: THREE.Vector3, opts: RingPulseOptions): void {
    const r = this.ps[this.next];
    this.next = (this.next + 1) % this.ps.length;
    r.mesh.position.copy(pos);
    r.mesh.quaternion.setFromUnitVectors(QUAD_AXIS, tmpDir.copy(normal).normalize());
    r.vel.copy(tmpDir).multiplyScalar(opts.speed ?? 0);
    r.t = 0;
    r.life = opts.life;
    r.r0 = opts.r0;
    r.r1 = opts.r1;
    r.u.uColor.value.setHex(opts.color);
    r.u.uAlpha.value = opts.alpha ?? 0.5;
    r.u.uThick.value = opts.thick ?? 0.35;
    r.u.uLife.value = 0;
    r.mesh.scale.setScalar(opts.r0 * 2);
    r.mesh.visible = true;
  }

  /** Grows, drifts and fades every live ring (29412). */
  update(dt: number): void {
    for (const p of this.ps) {
      if (!p.mesh.visible) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      p.mesh.scale.setScalar((p.r0 + (p.r1 - p.r0) * e) * 2);
      p.mesh.position.addScaledVector(p.vel, dt * (1 - k));
      p.u.uLife.value = k;
    }
  }
}
