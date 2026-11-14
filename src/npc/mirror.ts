// Port of play-inUT-NSi.js 69568-69679: the Mirror of Renown hub prop tR (stone pedestal, gold oval frame and a
// swirling portal shader in the glass). KR places it on the hub collider (src/npc/krNpc.ts updateMirror) and
// pressing E near it opens the leaderboard panel ZL (KR.openLeaders).
import * as THREE from 'three';
import '../world/chunk'; // installs three-mesh-bvh computeBoundsTree / acceleratedRaycast (35439-35441)
import { stylizeMaterial } from '../miner/stylize';

/** QL (69568): prop scale. */
export const MIRROR_SCALE = 1.25; // QL (69568)

/** $L (69569): glass vertex shader. */
export const MIRROR_GLASS_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`; // $L (69569)

/** eR (69575): glass fragment shader, a slow inward swirl of violet and teal with sparkles. */
export const MIRROR_GLASS_FRAG = `
uniform float uTime;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  // a slow swirl, turning inward
  vec2 q = vec2(cos(a + r * 2.2 - uTime * 0.25), sin(a + r * 2.2 - uTime * 0.25)) * r;
  float n = fbm(q * 2.2 + vec2(uTime * 0.05, -uTime * 0.07));
  float m = fbm(q * 4.5 - vec2(uTime * 0.11, uTime * 0.04));
  vec3 deep = vec3(0.09, 0.06, 0.22), violet = vec3(0.42, 0.26, 0.86), teal = vec3(0.32, 0.86, 0.92);
  vec3 c = mix(deep, violet, smoothstep(0.25, 0.75, n));
  c = mix(c, teal, smoothstep(0.62, 0.95, m * n * 1.6));
  // light pooling in the middle, darker toward the rim, and a sparkle now and then
  c += vec3(0.85, 0.8, 1.0) * pow(max(0.0, 1.0 - r), 2.5) * 0.35;
  c *= 0.65 + 0.35 * (1.0 - r * r);
  float sp = step(0.985, h21(floor(vUv * 60.0) + floor(uTime * 3.0)));
  c += vec3(1.0) * sp * 0.6 * (1.0 - r);
  gl_FragColor = vec4(c, 1.0);
}`; // eR (69575)

export class Mirror { // tR (69603)
  readonly root = new THREE.Group();
  /** Placed position; y -9999 until KR.updateMirror places it. */
  readonly pos = new THREE.Vector3(0, -9999, 0);
  collider: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  readonly box = new THREE.Box3();
  /** World position of the glass (the sparkle source). */
  readonly glassAt = new THREE.Vector3();
  readonly glass: THREE.ShaderMaterial;
  readonly glassMesh: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  t = 0;

  constructor() {
    const stone = new THREE.MeshStandardMaterial({ color: 10133684, roughness: 0.95 });
    const gold = new THREE.MeshStandardMaterial({ color: 14724172, roughness: 0.55, metalness: 0.25 });
    stylizeMaterial(stone, 0.12, 1.2);
    stylizeMaterial(gold, 0.06, 1.4);
    const body = new THREE.Group();
    body.scale.setScalar(MIRROR_SCALE);
    this.root.add(body);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      m.layers.enable(3);
      body.add(m);
      return m;
    };
    part(new THREE.CylinderGeometry(0.62, 0.7, 0.18, 8), stone, 0.09);
    part(new THREE.CylinderGeometry(0.48, 0.56, 0.16, 8), stone, 0.26);
    part(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8), stone, 0.59);
    part(new THREE.CylinderGeometry(0.34, 0.24, 0.12, 8), stone, 0.9);
    const frame = new THREE.Group();
    frame.position.y = 1.72;
    body.add(frame);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.075, 10, 48), gold);
    ring.scale.set(0.82, 1.18, 1);
    ring.castShadow = true;
    frame.add(ring);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), gold);
    crest.position.y = 0.82;
    crest.scale.set(0.8, 1.3, 0.5);
    frame.add(crest);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.24, 6), gold);
      leg.position.set(s * 0.16, -0.78, 0);
      leg.rotation.z = s * 0.25;
      frame.add(leg);
    }
    this.glass = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: MIRROR_GLASS_VERT,
      fragmentShader: MIRROR_GLASS_FRAG,
      side: THREE.DoubleSide,
    });
    this.glassMesh = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), this.glass);
    this.glassMesh.scale.set(0.82, 1.18, 1);
    frame.add(this.glassMesh);
    // footprint disc on layer 3 only
    const foot = new THREE.Mesh(new THREE.CircleGeometry(1.35, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    foot.position.y = 0.02;
    foot.layers.set(3);
    this.root.add(foot);
  }

  /** place (69654): stands the prop at `at` facing `yaw` and builds its box collider. */
  place(at: THREE.Vector3, yaw: number): void {
    this.pos.copy(at);
    this.root.position.copy(at);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    const geo = new THREE.BoxGeometry(1.2 * MIRROR_SCALE, 2.6 * MIRROR_SCALE, 0.9 * MIRROR_SCALE).translate(0, 1.3 * MIRROR_SCALE, 0);
    geo.computeBoundsTree();
    this.collider?.geometry.dispose();
    this.collider = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.position.copy(at);
    this.collider.rotation.y = yaw;
    this.collider.updateMatrixWorld(true);
    this.box.setFromObject(this.collider).expandByScalar(1);
    this.glassMesh.getWorldPosition(this.glassAt);
  }

  /** near (69669): within `r` on the ground plane and 2.5 vertically, once placed. */
  near(p: THREE.Vector3, r = 3): boolean {
    return this.pos.y > -9e3 && Math.abs(p.y - this.pos.y) < 2.5 && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < r;
  }

  /** update (69676) */
  update(dt: number): void {
    this.t += dt;
    this.glass.uniforms.uTime.value = this.t;
  }
}
