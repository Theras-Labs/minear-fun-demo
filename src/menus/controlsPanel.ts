// Port of play-inUT-NSi.js 69422-69443: the controls sheet qL (div#controls in index.html; the key list is static
// markup). The ✕ button, a click on the backdrop and Escape close it.
// KR makes it as a field (70135: keysPanel = new qL()); the pause sheet's .open-controls button opens it and its
// onClose goes back to the pause sheet (src/menus/panels.ts wirePanels, 70599 and 70602).

export class ControlsPanel { // qL (69422)
  el = document.getElementById(`controls`)!;
  onClose: () => void = () => {};

  constructor() {
    this.el.querySelector(`.close`)!.addEventListener(`click`, () => this.close());
    this.el.addEventListener(`click`, (e) => {
      e.target === this.el && this.close();
    });
    window.addEventListener(`keydown`, (e) => {
      e.code === `Escape` && this.open && this.close();
    });
  }

  get open(): boolean {
    return !this.el.classList.contains(`hidden`);
  }

  show(): void {
    this.el.classList.remove(`hidden`);
  }

  close(): void {
    this.open && (this.el.classList.add(`hidden`), this.onClose());
  }
}
