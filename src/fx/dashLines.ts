// Port of play-inUT-NSi.js 29667-29865: speed lines and ribbon trails Dm (KR.dashLines), with the ribbon Em.
// On a dodge or a drill-slam streak: 64 instanced white speed lines spawn around the miner and run along the
// dash direction, and up to 3 camera-facing ribbons follow the rig's trail points (MinerRig.trailPoints).
// It fades out after the dash and then switches itself off.
import * as THREE from 'three';

const LINES = 64; // ym (29667)
const RIBBON_PTS = 16; // bm (29668)

/** xm (29669): instanced speed line vertex shader. */
const LINE_VERTEX = `
  attribute float aAlpha; varying vec2 vUv; varying float vA;
  void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`; // xm (29669)

/** Sm (29672): speed line fragment shader. */
const LINE_FRAGMENT = `
  varying vec2 vUv; varying float vA;
  void main() {
    // (clamped: at the very edge it dips below 0, and pow() of that is NaN: a black pixel)
    float across = max(0.0, 1.0 - abs(vUv.y - 0.5) * 2.0);
    // its head (x = 1) bright, thinning away along its tail
    float along = smoothstep(0.0, 0.8, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
    float a = pow(across, 1.3) * along * vA;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.97, 0.99, 1.0, a);
  }`; // Sm (29672)

/** Cm (29683): ribbon vertex shader. */
const RIBBON_VERTEX = `
  attribute float aT; attribute float aS; varying float vT; varying float vS;
  void main() { vT = aT; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`; // Cm (29683)

/** wm (29686): ribbon fragment shader. */
const RIBBON_FRAGMENT = `
  uniform float uAlpha; varying float vT; varying float vS;
  void main() {
    float edge = max(0.0, 1.0 - abs(vS));
    float a = pow(max(0.0, 1.0 - vT), 1.5) * pow(edge, 1.2) * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.97, 0.99, 1.0, a);
  }`; // wm (29686)

/** Material factory: normal blending, transparent, no depth write, double sided. */
const lineMaterial = ( // Tm (29694)
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform> = {},
): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

const UP = new THREE.Vector3(0, 1, 0); // Om (29856)
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // km (29857)
const tmpMatrix = new THREE.Matrix4(); // Am (29858)
const tmpA = new THREE.Vector3(); // jm (29859)
const tmpB = new THREE.Vector3(); // Mm (29860)
const tmpC = new THREE.Vector3(); // Nm (29861)
const tmpD = new THREE.Vector3(); // Pm (29862)
const tmpMid = new THREE.Vector3(); // Fm (29863)
const tmpSide = new THREE.Vector3(); // Im (29864)
const tmpNormal = new THREE.Vector3(); // Lm (29865)

/** A camera-facing ribbon over a 16-point history of one trail point; tapers toward the tail. */
export class Ribbon { // Em (29703)
  width: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pts: THREE.Vector3[] = [];
  pos: Float32Array;
  geo = new THREE.BufferGeometry();
  u: { [name: string]: THREE.IUniform; uAlpha: THREE.IUniform<number> } = { uAlpha: { value: 0 } };

  constructor(width: number) {
    this.width = width;
    for (let k = 0; k < RIBBON_PTS; k++) this.pts.push(new THREE.Vector3());
    this.pos = new Float32Array(96);
    const aT = new Float32Array(32);
    const aS = new Float32Array(32);
    const index: number[] = [];
    for (let k = 0; k < RIBBON_PTS; k++) {
      aT[k * 2] = aT[k * 2 + 1] = k / 15;
      aS[k * 2] = -1;
      aS[k * 2 + 1] = 1;
      if (k < 15) index.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    this.geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    this.geo.setIndex(index);
    this.mesh = new THREE.Mesh(this.geo, lineMaterial(RIBBON_VERTEX, RIBBON_FRAGMENT, this.u));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  reset(p: THREE.Vector3): void {
    for (const t of this.pts) t.copy(p);
  }

  /** Shifts the history, adds the new head and rebuilds the strip facing the camera. */
  follow(head: THREE.Vector3, cam: THREE.Vector3): void {
    for (let k = 15; k > 0; k--) this.pts[k].copy(this.pts[k - 1]);
    this.pts[0].copy(head);
    for (let k = 0; k < RIBBON_PTS; k++) {
      const a = this.pts[Math.max(0, k - 1)];
      const b = this.pts[Math.min(15, k + 1)];
      tmpA.subVectors(a, b);
      tmpB.subVectors(cam, this.pts[k]).cross(tmpA);
      const len = tmpB.length();
      const w = this.width * (1 - k / 15);
      if (len > 1e-6) tmpB.multiplyScalar(w / len);
      else tmpB.set(0, 0, 0);
      tmpD.copy(this.pts[k]).add(tmpB).toArray(this.pos, k * 6);
      tmpD.copy(this.pts[k]).sub(tmpB).toArray(this.pos, k * 6 + 3);
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

interface SpeedLine {
  head: THREE.Vector3;
  speed: number;
  len: number;
  w: number;
  t: number;
  life: number;
  on: boolean;
}

export class DashLines { // Dm (29753)
  readonly group = new THREE.Group();
  lines: THREE.InstancedMesh;
  aAlpha: THREE.InstancedBufferAttribute;
  ls: SpeedLine[] = [];
  next = 0;
  spawnT = 0;
  dir = new THREE.Vector3(0, 0, 1);
  ribbons: Ribbon[] = [];
  fade = 0;
  live = false;

  constructor(ribbons = 3) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(LINES), 1);
    quad.setAttribute('aAlpha', this.aAlpha);
    this.lines = new THREE.InstancedMesh(quad, lineMaterial(LINE_VERTEX, LINE_FRAGMENT), LINES);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    for (let k = 0; k < LINES; k++) {
      this.lines.setMatrixAt(k, HIDDEN);
      this.ls.push({ head: new THREE.Vector3(), speed: 0, len: 0, w: 0, t: 0, life: 1, on: false });
    }
    this.group.add(this.lines);
    for (let k = 0; k < ribbons; k++) {
      const r = new Ribbon(k === ribbons - 1 ? 0.05 : 0.04);
      r.mesh.visible = false;
      this.ribbons.push(r);
      this.group.add(r.mesh);
    }
    this.group.visible = false;
  }

  /**
   * KR 71851: on the first dash frame, start(streak ?? flat velocity, model.trailPoints(), !!streak).
   * keepY keeps the vertical part of the direction (the slam streak); a dodge runs flat.
   */
  start(dir: THREE.Vector3, pts: readonly THREE.Vector3[], keepY = false): void {
    this.dir.set(dir.x, keepY ? dir.y : 0, dir.z);
    if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0, 1);
    this.dir.normalize();
    this.ribbons.forEach((r, k) => pts[k] && r.reset(pts[k]));
    this.spawnT = 0;
    this.live = true;
  }

  /** KR 71856: the slam streak changed direction mid-dash. */
  turn(dir: THREE.Vector3): void {
    if (dir.lengthSq() > 1e-6) this.dir.copy(dir).normalize();
  }

  /** KR 71858: update(t, dashing, (pos.x, pos.y + 0.9, pos.z), model.trailPoints(), camera.position). */
  update(dt: number, active: boolean, center: THREE.Vector3, pts: readonly THREE.Vector3[], cam: THREE.Vector3): void {
    if (!this.live) return;
    this.group.visible = true;
    if (active) {
      tmpB.crossVectors(UP, this.dir);
      if (tmpB.lengthSq() < 1e-4) tmpB.set(1, 0, 0);
      tmpB.normalize();
      tmpC.crossVectors(this.dir, tmpB).normalize();
      for (this.spawnT -= dt; this.spawnT <= 0; ) {
        this.spawnT += 1 / 150;
        const l = this.ls[this.next];
        this.next = (this.next + 1) % LINES;
        const side = (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1);
        const up = -0.75 + Math.random() * 1.65;
        l.head
          .copy(center)
          .addScaledVector(tmpB, side)
          .addScaledVector(tmpC, up)
          .addScaledVector(this.dir, -0.2 + Math.random() * 0.5);
        l.speed = 2 + Math.random() * 3;
        l.len = 0.6 + Math.random() * 0.9;
        l.w = 0.024 + Math.random() * 0.022;
        l.t = 0;
        l.life = 0.2 + Math.random() * 0.14;
        l.on = true;
      }
    }
    let any = false;
    for (let k = 0; k < LINES; k++) {
      const l = this.ls[k];
      if (!l.on) continue;
      l.t += dt;
      const r = l.t / l.life;
      if (r >= 1) {
        l.on = false;
        this.lines.setMatrixAt(k, HIDDEN);
        this.aAlpha.setX(k, 0);
        any = true;
        continue;
      }
      any = true;
      l.head.addScaledVector(this.dir, l.speed * dt * (1 - r));
      const len = l.len * (1 - 0.55 * r);
      tmpMid.copy(l.head).addScaledVector(this.dir, -len * 0.5);
      tmpSide.subVectors(cam, tmpMid).cross(this.dir);
      if (tmpSide.lengthSq() < 1e-8) tmpSide.copy(UP);
      tmpSide.normalize();
      tmpNormal.crossVectors(this.dir, tmpSide);
      tmpMatrix
        .makeBasis(tmpA.copy(this.dir).multiplyScalar(len), tmpD.copy(tmpSide).multiplyScalar(l.w), tmpNormal)
        .setPosition(tmpMid);
      this.lines.setMatrixAt(k, tmpMatrix);
      this.aAlpha.setX(k, Math.min(1, l.t / 0.03) * (1 - r) * 0.88);
    }
    if (any) {
      this.lines.instanceMatrix.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
    }
    this.fade += (+active - this.fade) * Math.min(1, dt * (active ? 30 : 8));
    const show = this.fade > 0.01;
    this.ribbons.forEach((rb, k) => {
      rb.mesh.visible = show && !!pts[k];
      if (rb.mesh.visible) {
        rb.u.uAlpha.value = this.fade * 0.82;
        rb.follow(pts[k], cam);
      }
    });
    if (!show && !any) {
      this.live = false;
      this.group.visible = false;
    }
  }
}
