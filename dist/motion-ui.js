import { animate, stagger } from './vendor/motion.mjs';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = [.22, 1, .36, 1];
const spring = { type: 'spring', stiffness: 390, damping: 31, mass: .8 };
const counts = new Map();
const progress = new Map();
const playing = new WeakMap();

export const unit = value => Math.max(0, Math.min(1, Number(value) || 0));

function run(element, keyframes, options) {
  if (!element || reduced()) return;
  playing.get(element)?.stop();
  const animation = animate(element, keyframes, options);
  playing.set(element, animation);
  return animation;
}

export function reveal(container) {
  if (!container || reduced()) return;
  const items = Array.from(container.querySelectorAll('.hero, .metric, .title-row, .tabbar, .panel, .section-head'))
    .filter(el => !el.parentElement.closest('.panel, .hero'));
  if (!items.length) return;
  const delay = stagger(.045, { startDelay: .015 });
  animate(items, { opacity: [.72, 1], y: [12, 0] }, { duration: .42, ease, delay: (index, total) => Math.min(.22, delay(index, total)) });
}

export function animateCounts(container) {
  for (const element of container.querySelectorAll('[data-count]')) {
    const target = Number(element.dataset.count);
    const key = element.dataset.metric;
    const previous = counts.get(key) ?? 0;
    counts.set(key, target);
    if (reduced() || previous === target) continue;
    element.textContent = String(previous);
    animate(previous, target, { duration: .55, ease, onUpdate: value => {
      element.textContent = String(Math.round(value));
    } });
  }
}

export function animateProgress(container) {
  for (const fill of container.querySelectorAll('[data-progress]')) {
    const key = fill.dataset.progress;
    const target = unit(Number(fill.dataset.value) / 100);
    const previous = progress.get(key) ?? 0;
    progress.set(key, target);
    if (reduced() || target === previous) continue;
    run(fill, { scaleX: [previous, target] }, { duration: .62, ease });
  }
}

export function animateDialog(dialog) {
  run(dialog, { opacity: [.35, 1], scale: [.94, 1], y: [14, 0] }, spring);
}

export function animateNotice(notice) {
  run(notice, { opacity: [0, 1], scale: [.96, 1], y: [12, 0] }, spring);
}

export function animatePress(control) {
  if (!control?.isConnected || control.disabled) return;
  run(control, { scale: [.96, 1] }, spring);
}

export function animateStatus(control) {
  run(control, { scale: [.98, 1], opacity: [.65, 1] }, spring);
}
