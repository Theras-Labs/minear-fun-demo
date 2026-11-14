// The R3F shell around the Game object (port of KR, play-inUT-NSi.js 70056-75530).
// R3F owns the canvas, the WebGLRenderer, the scene and the resize; the Game owns the simulation,
// the camera (FollowCamera) and the post chain, and draws with its EffectComposer in a priority-1
// useFrame (which turns off R3F's own render, as KR.run does its own drawWorld).
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { Game } from './game/Game';
import { loading } from './game/loading';
import { loadAssets } from './game/assets';

// dz (75725): the model loads start at once, before the canvas exists
const assets = loadAssets((k) => loading.set(k));

function GameLoop({ game }: { game: Game }) {
  const size = useThree((s) => s.size);
  useEffect(() => game.resize(size.width, size.height), [game, size.width, size.height]);
  useFrame(() => game.frame(), 1);
  return null;
}

export function App() {
  const [game, setGame] = useState<Game | null>(null);
  // The Canvas owns the dpr: without the prop, every re-render (setGame) puts R3F's default (up to 2) back on
  // the renderer, and a Retina screen draws up to 2.56x the pixels the quality asks for.
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio, 1.5));

  const onCreated = (state: RootState) => {
    // pointer events are the game's own (Input), not R3F raycasts over the voxel chunks
    state.setEvents({ enabled: false });
    assets
      .then((a) => {
        loading.set(0.44, 'Carving the world…');
        const g = new Game(state.gl as THREE.WebGLRenderer, state.scene, a);
        state.set({ camera: g.cam.camera });
        state.setDpr(g.qualityPixelRatio());
        setDpr(g.qualityPixelRatio());
        // applySettings (quality changes, the auto tuner) and the lobby set the renderer's pixel ratio; keep R3F's
        // dpr and the Canvas prop equal so neither its resize nor a re-render puts the old ratio back
        g.onDpr = (r) => {
          if (Math.abs(state.viewport.dpr - r) > 0.01) state.setDpr(r);
          setDpr(r);
        };
        if (import.meta.env.DEV) Object.assign(window, { __ld: g }); // the original exposes window.__ld (70838)
        setGame(g);
        return g.boot((k, text) => loading.set(0.48 + 0.52 * k, text)).then(() => g);
      })
      .then((g) => loading.done().then(() => g.showTitle()))
      .catch((e: unknown) => {
        console.error(e);
        loading.fail(`Couldn't load the game: ${(e as Error)?.message ?? e}. Try reloading the page.`);
      });
  };

  useEffect(() => () => game?.dispose(), [game]);

  return (
    <Canvas
      id="game"
      // R3F writes `position: relative` inline on its wrapper; keep the original #game layout (fixed, inset 0)
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }}
      flat
      dpr={dpr}
      frameloop="always"
      gl={(props) =>
        new THREE.WebGLRenderer({
          canvas: props.canvas as HTMLCanvasElement,
          antialias: false,
          powerPreference: 'high-performance',
        })
      }
      onCreated={onCreated}
    >
      {game && <GameLoop game={game} />}
    </Canvas>
  );
}
