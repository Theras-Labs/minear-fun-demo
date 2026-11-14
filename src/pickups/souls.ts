// Beast souls (the Stranger chain items) and small KR helpers the pickup glue needs.
// Bundle play-inUT-NSi.js lines 69861-69898 (sR, cR, lR, uR), 69985 (pR), 69989 (_R).
import * as THREE from 'three';
import type { Rarity } from '../world/items';

export type SoulKind = 'titan';

export const SOULS: Record<SoulKind, { id: string; name: string; color: number; line: string }> = { // sR (69861)
  titan: {
    id: `soul_titan`,
    name: `Rimeheart's Soul`,
    color: 9430783,
    line: `Rimeheart's cold.`,
  },
};
export const SOUL_KINDS = Object.keys(SOULS) as SoulKind[]; // cR (69877)

/** The beast kind of a soul item id, or null. */
export function soulKind(e: string): SoulKind | null { // lR (69878)
  const t = e.startsWith(`soul_`) ? e.slice(5) : null;
  return t && (SOULS as Record<string, unknown>)[t] ? (t as SoulKind) : null;
}

/** The glowing soul pickup model. */
export function soulModel(e: SoulKind): THREE.Group { // uR (69882)
  const t = SOULS[e].color,
    n = new THREE.Group(),
    r = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      new THREE.MeshStandardMaterial({ color: t, emissive: t, emissiveIntensity: 2.4, roughness: 0.3, flatShading: !0 }),
    ),
    i = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3, 2),
      new THREE.MeshBasicMaterial({ color: t, transparent: !0, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: !1 }),
    ),
    a = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.014, 6, 36),
      new THREE.MeshBasicMaterial({ color: t, transparent: !0, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: !1 }),
    );
  return ((a.rotation.x = Math.PI / 2.4), n.add(r, i, a), n);
}

/** BossSouls hook of src/bosses/client/bossClient.ts: sR[kind].id and uR(kind). */
export const bossSouls = {
  id: (kind: string): string | null => (SOULS as Record<string, { id: string }>)[kind]?.id ?? null,
  mesh: (kind: string): THREE.Object3D => soulModel(kind as SoulKind),
};

/** Rarity -> tier number. */
export const RARITY_TIER: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 }; // pR (69985)
/** 24-bit color -> '#rrggbb'. */
export const hexColor = (e: number): string => `#` + e.toString(16).padStart(6, `0`); // _R (69989)
