// Port of play-inUT-NSi.js 45504-45544: touch / phone detection.
// The original runs this at import and also adds the manifest link and the "turn your phone" overlay;
// here the flags are computed at import and the DOM side effects run in applyDeviceClasses().

const touchParam = new URLSearchParams(location.search).get('touch'); // DT
const smallTouch = // OT
  navigator.maxTouchPoints > 0 &&
  (/Android|iPhone|iPod/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) <= 600);

/** J (45509): touch device; the original also forces the `lite` quality on it. */
export const IS_TOUCH: boolean =
  touchParam === '1' ||
  (touchParam !== '0' &&
    ((matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) || smallTouch));
export const IS_LITE = IS_TOUCH;

/** kT (45514): a phone-sized screen (shortest side <= 540 px), updated on resize. */
export let IS_PHONE = false;

let applied = false;
export function applyDeviceClasses() {
  if (applied || !IS_TOUCH) return;
  applied = true;
  const root = document.documentElement;
  root.classList.add('touch', 'lite');
  const measure = () => {
    const w = root.clientWidth || innerWidth;
    const h = root.clientHeight || innerHeight;
    IS_PHONE = Math.min(w, h) <= 540;
    root.classList.toggle('phone', IS_PHONE);
    root.classList.toggle('portrait', h > w);
  };
  measure();
  addEventListener('resize', measure);
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  const turn = document.createElement('div');
  turn.id = 'turn';
  turn.innerHTML =
    '<svg viewBox="0 0 64 64"><rect x="20" y="6" width="24" height="52" rx="5" fill="#fff6e5" stroke="#3a281c" stroke-width="3.5"/><rect x="24" y="12" width="16" height="38" rx="2" fill="#5fc8ff"/><circle cx="32" cy="54" r="1.8" fill="#3a281c"/></svg><b>Turn your phone sideways</b><span>MINEAR is played in landscape</span>';
  document.body.append(turn);
}
