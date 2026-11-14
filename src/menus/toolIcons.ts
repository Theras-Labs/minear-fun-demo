// MINEAR dig tool drawings (folder: minear-r3f/src/menus). The Claws slot has no 3D model in MINEAR (no
// drill: minear-r3f/src/miner/loader.ts), so its gear shows these drawings everywhere (inventory, Forge, loot,
// toasts) through minear-r3f/src/menus/gearIcons.ts html(). One drawing per kind, so the kinds look different:
//   bit (Burrow Claws), serrated (Serrated Claws), widebit (Wide Claws), magmabit (Magma Claws),
//   gauntlet (Digging Gauntlet), jetpump (Jet Pump). Tool rules: minear-r3f/src/game/digTools.ts.
// A forged piece takes the colour of its metal (METAL_DYE) on its metal parts.

const INK = `#3a281c`;
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

/** MINEAR Forge metals: the colour of an Iron, Gold or Mythril piece (Forge tiles, forged gear icons). */
export const METAL_DYE: Record<string, number> = { copper: 0xd9773b, iron: 0xa7b1bf, gold: 0xf5b833, mythril: 0x47c9e0 };

const hex = (n: number): string => `#${n.toString(16).padStart(6, `0`)}`;
/** A darker shade of a #rrggbb colour (k 0..1). */
function shade(c: string, k: number): string {
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => Math.round(v * (1 - k));
  return hex((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255));
}

const PAW = `<ellipse cx="15" cy="25" rx="10" ry="12.5" fill="#c98b5a" ${S}/><ellipse cx="13" cy="26" rx="4.5" ry="6" fill="#f2b49a"/>`;

const claws = (m: string) =>
  `<path d="M20 13.5 C29 9 37 10.5 43 16 C37 18.5 30 19.5 22 19.5 Z" fill="${m}" ${S}/><path d="M22 21.5 C31 19.5 39 21.5 45 26 C39 28.5 32 30 22 29 Z" fill="${m}" ${S}/><path d="M20 30.5 C29 30.5 37 32.5 42 38 C35 40 28 40 20 37 Z" fill="${m}" ${S}/>${PAW}`;

const serrated = (m: string) =>
  `<path d="M20 13.5 L25 9.5 L27 12.5 L31 9 L33 12 L37 10 L43 16 C37 18.5 30 19.5 22 19.5 Z" fill="${m}" ${S}/><path d="M22 21.5 L27 18.5 L29 21 L33 18.5 L35 21.5 L39 20 L45 26 C39 28.5 32 30 22 29 Z" fill="${m}" ${S}/><path d="M20 30.5 L25 29 L27 31.5 L31 30 L33 33 L37 32.5 L42 38 C35 40 28 40 20 37 Z" fill="${m}" ${S}/>${PAW}`;

const wide = (m: string) =>
  `<path d="M19 10 C27 7 34 8 39 12 C34 15 27 16 21 16 Z" fill="${m}" ${S}/><path d="M21 18 C30 16 37 17 43 21 C37 24 30 25 21 24.5 Z" fill="${m}" ${S}/><path d="M21 26.5 C30 26 37 27.5 43 31 C37 34 30 34.5 21 33 Z" fill="${m}" ${S}/><path d="M19 35 C27 35.5 33 37 38 41 C32 43 26 43 19 41 Z" fill="${m}" ${S}/>${PAW}`;

const gauntlet = (m: string) => {
  const d = shade(m, 0.28);
  return `<rect x="4" y="25" width="15" height="17" rx="3" fill="${d}" ${S}/><rect x="4" y="30" width="15" height="5" fill="#c98b5a"/>
    <path d="M15 15 H35 Q41 15 41 21 V37 Q41 43 35 43 H15 Z" fill="${m}" ${S}/>
    <path d="M27 21 H38 M27 27 H38 M27 33 H38" stroke="${d}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M41 16.5 L46.5 19 L41 21.5 Z M41 23 L46.5 25.5 L41 28 Z M41 29.5 L46.5 32 L41 34.5 Z M41 36 L46.5 38.5 L41 41 Z" fill="#fff6e5" ${S.replace(`stroke-width="3"`, `stroke-width="2"`)}/>
    <path d="M18 20 Q22 17 26 19" stroke="#ffffff99" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
};

const pump = (m: string) => {
  const d = shade(m, 0.28);
  return `<rect x="4" y="11" width="15" height="30" rx="7" fill="${m}" ${S}/><rect x="4" y="23" width="15" height="4" fill="${d}"/>
    <circle cx="11.5" cy="17" r="3.2" fill="#fff6e5" ${S.replace(`stroke-width="3"`, `stroke-width="2"`)}/>
    <path d="M19 25 H30 L37 21.5 V36.5 L30 33 H19 Z" fill="${d}" ${S}/>
    <path d="M40 24 Q44 22.5 46.5 20 M40 29 H47 M40 34 Q44 35.5 46.5 38" stroke="#5fc8ff" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <path d="M7.5 34 V38" stroke="#ffffff99" stroke-width="2.5" stroke-linecap="round"/>`;
};

const DRAW: Record<string, { draw: (m: string) => string; base: string }> = {
  bit: { draw: claws, base: `#fff1d6` },
  serrated: { draw: serrated, base: `#fff1d6` },
  widebit: { draw: wide, base: `#fff1d6` },
  magmabit: { draw: claws, base: `#ff8a4a` },
  gauntlet: { draw: gauntlet, base: `#c9d1db` },
  jetpump: { draw: pump, base: `#c9d1db` },
};

/** The drawing of a Claws-slot gear base (in its forged metal when `ore` is set), or null for other bases. */
export function toolIconSVG(base: string, ore?: string): string | null {
  const t = DRAW[base];
  if (!t) return null;
  const m = ore && METAL_DYE[ore] !== undefined ? hex(METAL_DYE[ore]) : t.base;
  return `<svg viewBox="0 0 48 48">${t.draw(m)}</svg>`;
}
