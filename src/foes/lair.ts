// Port of play-inUT-NSi.js 40714-40715 (MS biome -> boss kind) and 40849-40892 (boss lair finder eC / tC / nC).
// The foe spawn scan needs the lair (no camps within 28 m of it). The boss module and the cave decor (cw)
// also use tC: they can import bossLair from here.
import * as THREE from 'three';
import {
  cavernFloorY,
  cavernMetric,
  cavernPillar,
  emberColumn,
  hasLiquidSurface,
  type BiomeId,
  type Cavern,
} from '../world/caverns';

export type BossKind = 'titan';

/** MS (40715): the boss kind of each biome. Only the frost cavern has a boss; the other beast caverns stay as empty lairs. */
export const BOSS_OF_BIOME: Partial<Record<BiomeId, BossKind>> = { frost: `titan` }; // MS (40715)

const lairCache = new Map<number, THREE.Vector3>(); // eC (40849)

/** tC (40850): the boss lair spot of a cavern (cached by cavern key). */
export function bossLair(e: Cavern): THREE.Vector3 { // tC (40850)
  let t = lairCache.get(e.key);
  if (!t) lairCache.set(e.key, (t = findLair(e)));
  return t;
}

/** nC (40854): 90 golden-angle samples within 0.42 rx of the centre, scored by openness. */
function findLair(e: Cavern): THREE.Vector3 { // nC (40854)
  let n: THREE.Vector3 | null = null;
  let r = -1 / 0;
  const i = (e.seed % 628) / 100;
  for (let a = 0; a < 90; a++) {
    const o = i + a * 2.39996;
    const s = Math.sqrt(a / 90) * e.rx * 0.42;
    const c = e.cx + Math.cos(o) * s;
    const l = e.cz + Math.sin(o) * s;
    const u = e.biome === `frost` ? Math.max(cavernFloorY(e, c, l), e.liquidY) : cavernFloorY(e, c, l);
    if (cavernMetric(e, c, u + 3, l) > 0.8) continue;
    const d = (rr: number, k: number): boolean => {
      const ang = (k / 10) * Math.PI * 2;
      const x = c + Math.cos(ang) * rr;
      const z = l + Math.sin(ang) * rr;
      if (cavernPillar(e, x, u + 2, z) > 0 || cavernPillar(e, x, u + 8, z) > 0) return true;
      const col = emberColumn(e, x, z);
      return !!col && col.inside > 0 && col.top > u + 1.2;
    };
    let f = true;
    let p = 0;
    for (let k = 0; k < 10 && f; k++) {
      if (d(0, 0) || d(4, k) || d(8, k)) f = false;
      if (d(12, k)) p++;
      if (d(17, k)) p += 0.5;
    }
    if (!f) continue;
    let m = -s * 0.05 - p * 1.5;
    if (e.biome === `bog`) {
      if (!hasLiquidSurface(e, c, l)) continue;
      let w = 0;
      for (let q = 0; q < 16; q++) {
        const ang = (q / 16) * Math.PI * 2;
        for (const rr of [3, 6, 9]) if (hasLiquidSurface(e, c + Math.cos(ang) * rr, l + Math.sin(ang) * rr)) w++;
      }
      m += w;
    } else if (e.biome === `frost`) m += u <= e.liquidY + 0.2 ? 4 : 0;
    if (m > r) {
      r = m;
      n = new THREE.Vector3(c, u, l);
    }
  }
  return n ?? new THREE.Vector3(e.cx, cavernFloorY(e, e.cx, e.cz), e.cz);
}
