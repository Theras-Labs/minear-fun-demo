// /dev: the list of debug pages.
import { useEffect } from 'react';
import './dev.css';

export function DevIndex() {
  useEffect(() => {
    document.body.classList.add('dev');
  }, []);
  return (
    <div className="dev-index">
      <h1>MINEAR: debug pages</h1>
      <a href="/dev/terrain">Terrain: rock layers, biome caverns, boss lairs, normal and sonar view</a>
      <a href="/dev/bosses">Bosses: each boss model, animation clips, phases and effects</a>
      <a href="/dev/sound">Sound: digging sound candidates for the claws (pick one for the game)</a>
      <a href="/dev/intro">Intro film: the surface, the plunge to the Inner Core at 100,000 m, the bosses, the title</a>
      <a href="/dev/catalog">Catalog: foes, bosses, gems, gear, characters and sky states, from the live game data</a>
      <a href="/dev/catalog/near">Base and NEAR systems: Refinery, Forge, reroll, Capsule Machine, skill tree, slots, quests, next to the theras-rpg-template reference</a>
      <a href="/">The game</a>
    </div>
  );
}
