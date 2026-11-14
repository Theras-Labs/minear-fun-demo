// MINEAR Cheats panel: made ONLY in the dev-local Demo cheat (minear-r3f/src/game/entry.ts CHEAT; Game.ts).
// A "Cheats" chip under the FPS meter (or the ` key) opens a small panel with the switches of src/game/cheats.ts:
// unlimited HP, hidden from foes, unlimited claw endurance and the fast burrow with its speed and the rock it digs
// at full speed, unlimited jetpack fuel, and warps to the four beast lairs (to find and fight the bosses quickly),
// and Stock up: ores and gems minted on chain on the local testnet (minear-r3f/server/src/devGrant.ts),
// Capsule Coins into the save. Every change applies at once.
import { MATERIALS } from '../world/materials';
import { BEAST_DEPTHS, BIOMES, type BiomeId } from '../world/caverns';
import { BOSS_DEFS, BOSS_OF_BIOME } from '../bosses/sim/defs';
import {
  BURROW_SPEEDS,
  CHEAT_ROCKS,
  CHEATS_SAVED,
  anyCheat,
  cheats,
  onCheats,
  rockHardness,
  setCheat,
  STOCK_UP,
  type Cheats,
  type StockKind,
} from '../game/cheats';

type Flag = `god` | `hidden` | `claws` | `jet` | `fast`;

const FLAGS: { k: Flag; label: string; tip: string }[] = [
  { k: `god`, label: `Unlimited HP`, tip: `Foes, bombs, burn and poison do no damage` },
  { k: `hidden`, label: `Hidden from foes`, tip: `Foes, bosses and the worm do not see you; no ambushes` },
  { k: `claws`, label: `Unlimited claw endurance`, tip: `Digging does not wear the claws` },
  { k: `jet`, label: `Unlimited jetpack fuel`, tip: `The jetpack never runs dry (J puts the jetpack on or off)` },
  { k: `fast`, label: `Fast burrow`, tip: `Burrow faster, and dig the ticked rock at full speed` },
];

const hex = (n: number) => `#${n.toString(16).padStart(6, `0`)}`;

export interface CheatPanelHost {
  /** Frees the mouse (pointer lock) so the panel can be clicked. */
  releaseLock(): void;
  /** Warps the miner near the lair of the beast of a biome cavern. */
  goLair?(biome: BiomeId): void;
  /** Ores and gems: minted on the local testnet; Capsule Coins: the save (Game.ts). */
  stockUp?(kind: StockKind): void;
}

export class CheatPanel {
  readonly chip: HTMLButtonElement;
  readonly el: HTMLDivElement;
  private off: () => void;

  constructor(
    private host: CheatPanelHost,
    parent: HTMLElement = document.getElementById(`ui`) ?? document.body,
  ) {
    this.chip = document.createElement(`button`);
    this.chip.id = `cheatchip`;
    this.chip.type = `button`;
    this.chip.title = `Cheats (\` key)`;
    this.chip.addEventListener(`click`, () => this.toggle());

    this.el = document.createElement(`div`);
    this.el.id = `cheats`;
    this.el.hidden = true;
    const flags = FLAGS.map(
      (f) => `<label class="ch-flag" title="${f.tip}"><input type="checkbox" data-k="${f.k}"><span>${f.label}</span></label>`,
    ).join(``);
    const speeds = BURROW_SPEEDS.map((s) => `<button type="button" data-s="${s}">×${s}</button>`).join(``);
    const rocks = CHEAT_ROCKS.map((r) => {
      const c = hex(MATERIALS[r.mats[0]]?.color ?? 0);
      return `<li><label><input type="checkbox" data-r="${r.id}"><i style="background:${c}"></i><span>${r.name}</span><em title="Hardness">${rockHardness(r)}</em></label></li>`;
    }).join(``);
    this.el.innerHTML = `
      <div class="ch-hd"><b>Cheats</b><small>dev</small><button type="button" class="ch-x" title="Close">×</button></div>
      ${flags}
      <div class="ch-fast">
        <div class="ch-row"><span>Burrow speed</span><span class="ch-seg">${speeds}</span></div>
        <div class="ch-row"><span>Full speed through</span><span class="ch-seg"><button type="button" data-all="1">All</button><button type="button" data-all="0">None</button></span></div>
        <ul class="ch-rocks">${rocks}</ul>
      </div>
      <div class="ch-lairs"><div class="ch-row"><span>Warp to the beast lair</span></div><div class="ch-seg ch-lairbtns">${BEAST_DEPTHS.filter((b) => BOSS_OF_BIOME[b.biome]).map(
        (b) =>
          `<button type="button" data-lair="${b.biome}" style="--c:${BIOMES[b.biome].color}" title="${BOSS_DEFS[BOSS_OF_BIOME[b.biome]!].name}, ${BOSS_DEFS[BOSS_OF_BIOME[b.biome]!].title}: ${BIOMES[b.biome].name.toLowerCase()}, ${b.depth} m">${b.depth} m</button>`,
      ).join(``)}</div><p class="ch-tip">The boss wakes when you come close. Untick <b>Hidden from foes</b> to fight.</p></div>
      <div class="ch-lairs ch-stock"><div class="ch-row"><span>Stock up <small>local testnet</small></span></div><div class="ch-seg ch-lairbtns">
        <button type="button" data-stock="ore" title="+${STOCK_UP.ore} copper, iron, gold and mythril">Ores</button>
        <button type="button" data-stock="gem" title="+${STOCK_UP.gem} of each gem">Gems</button>
        <button type="button" data-stock="capsules" title="+${STOCK_UP.capsules} Capsule Coins">Capsule</button>
        <button type="button" data-stock="all" class="on" title="Ores, gems and Capsule Coins">All</button>
      </div><p class="ch-tip">Ores and gems arrive on chain on the local testnet (never testnet). Capsule Coins go to the save.</p></div>
      <p class="ch-note">${CHEATS_SAVED ? `Saved in this browser.` : `URL override: changes last for this visit only.`} Press <kbd>\`</kbd> to open or close.</p>`;

    this.el.addEventListener(`change`, (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.k) setCheat({ [t.dataset.k as Flag]: t.checked });
      else if (t.dataset.r) setCheat({ rocks: { [t.dataset.r]: t.checked } });
    });
    this.el.addEventListener(`click`, (e) => {
      const b = (e.target as HTMLElement).closest(`button`);
      if (!b) return;
      if (b.classList.contains(`ch-x`)) this.toggle(false);
      else if (b.dataset.lair) {
        this.toggle(false);
        this.host.goLair?.(b.dataset.lair as BiomeId);
      }
      else if (b.dataset.stock) this.host.stockUp?.(b.dataset.stock as StockKind);
      else if (b.dataset.s) setCheat({ speed: +b.dataset.s });
      else if (b.dataset.all) {
        const on = b.dataset.all === `1`;
        setCheat({ rocks: Object.fromEntries(CHEAT_ROCKS.map((r) => [r.id, on])) });
      }
    });
    // keys typed in the panel stay out of the game (Space would toggle a checkbox and jump)
    this.el.addEventListener(`keydown`, (e) => {
      if (e.code !== `Backquote`) (e.target as HTMLElement).blur?.();
    });
    window.addEventListener(`keydown`, this.onKey);

    parent.append(this.chip, this.el);
    this.off = onCheats((c) => this.render(c));
    this.render(cheats);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open;
    this.chip.classList.toggle(`on`, open);
    if (open) this.host.releaseLock();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== `Backquote` || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === `TEXTAREA` || (t.tagName === `INPUT` && (t as HTMLInputElement).type === `text`))) return;
    if (document.body.classList.contains(`title`)) return;
    e.preventDefault();
    this.toggle();
  };

  private render(c: Cheats): void {
    const n = FLAGS.filter((f) => c[f.k]).length;
    this.chip.textContent = n ? `Cheats ${n}` : `Cheats`;
    this.chip.classList.toggle(`live`, anyCheat());
    for (const i of this.el.querySelectorAll<HTMLInputElement>(`input[data-k]`)) i.checked = c[i.dataset.k as Flag];
    for (const i of this.el.querySelectorAll<HTMLInputElement>(`input[data-r]`)) {
      i.checked = !!c.rocks[i.dataset.r!];
      i.disabled = !c.fast;
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>(`button[data-s]`)) {
      b.classList.toggle(`on`, +b.dataset.s! === c.speed);
      b.disabled = !c.fast;
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>(`button[data-all]`)) b.disabled = !c.fast;
    this.el.querySelector(`.ch-fast`)!.classList.toggle(`dim`, !c.fast);
  }

  dispose(): void {
    window.removeEventListener(`keydown`, this.onKey);
    this.off();
    this.chip.remove();
    this.el.remove();
  }
}
