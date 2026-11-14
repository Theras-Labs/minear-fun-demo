// Bootstrap, after play-inUT-NSi.js 75698-75752 (lz WebGL check, uz no-3D notice, dz boot).
// The original loads every asset in dz and then builds KR; here <App> mounts the R3F Canvas and
// the Game object is built in the Canvas onCreated callback (src/game/Game.ts).
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAtmosphere } from './render/atmosphere';
import { applyDeviceClasses } from './game/device';
import { loading } from './game/loading';
import './brand/nearcoin.css';
import './brand/stars.css';

/** lz (75698): can this browser create a WebGL2 context? */
function webglCheck() {
  let why = '';
  const tryContext = (kind: 'webgl2' | 'webgl') => {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextcreationerror', (e) => (why ||= (e as WebGLContextEvent).statusMessage));
    const gl = c.getContext(kind) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  };
  const ok = tryContext('webgl2');
  return { ok, webgl1: !ok && tryContext('webgl'), why };
}

/** uz (75709): show the "no 3D graphics" help in the start sheet. */
function showNo3d({ webgl1, why }: { webgl1: boolean; why: string }) {
  document.querySelector('#start .sheet')!.classList.add('no3d');
  const lines: string[] = [];
  if (webgl1)
    lines.push('Only the older WebGL 1 works here, which usually means an out-of-date or blocked graphics driver: try step 3.');
  if (why) lines.push(`Your browser says: “${why}”`);
  document.getElementById('no3d-why')!.textContent = lines.join('\n');
}

const path = location.pathname.replace(/\/+$/, '');
const check = webglCheck();
if (!check.ok) {
  loading.hide();
  showNo3d(check);
} else if (path === '/dev' || path.startsWith('/dev/')) {
  // debug pages: the same atmosphere patch, no game
  installAtmosphere();
  loading.hide();
  const root = createRoot(document.getElementById('root')!);
  if (path === '/dev/terrain') import('./dev/TerrainPage').then((m) => root.render(<m.TerrainPage />));
  else if (path === '/dev/bosses') import('./dev/BossPage').then((m) => root.render(<m.BossPage />));
  else if (path === '/dev/sound') import('./dev/SoundPage').then((m) => root.render(<m.SoundPage />));
  else if (path === '/dev/catalog') import('./dev/CatalogPage').then((m) => root.render(<m.CatalogPage />));
  else if (path === '/dev/catalog/near') import('./dev/NearPage').then((m) => root.render(<m.NearPage />));
  else if (path === '/dev/intro') import('./dev/IntroPage').then((m) => root.render(<m.IntroPage />));
  else import('./dev/DevIndex').then((m) => root.render(<m.DevIndex />));
} else {
  applyDeviceClasses();
  // Iy (34276): the original patches three's ShaderChunk at import; it must run before any material compiles.
  installAtmosphere();
  loading.set(0.02, 'Loading…');
  createRoot(document.getElementById('root')!).render(<App />);
}
