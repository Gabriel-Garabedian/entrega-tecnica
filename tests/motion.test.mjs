import test from 'node:test';
import assert from 'node:assert/strict';
import { unit, animateCounts, animateProgress, reveal } from '../dist/motion-ui.js';

test('progresso para animação é limitado ao intervalo de 0 a 1', () => {
  assert.equal(unit(-.2), 0);
  assert.equal(unit(.45), .45);
  assert.equal(unit(2), 1);
  assert.equal(unit(NaN), 0);
});

test('movimento reduzido preserva valores finais sem iniciar animações', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  t.after(() => previous ? Object.defineProperty(globalThis, 'matchMedia', previous) : delete globalThis.matchMedia);
  const counter = { dataset: { count: '7', metric: 'test' }, textContent: '7' };
  const fill = { dataset: { progress: 'test', value: '45' } };
  const root = { querySelectorAll(selector) { return selector === '[data-count]' ? [counter] : [fill]; } };
  assert.doesNotThrow(() => { reveal(root); animateCounts(root); animateProgress(root); });
  assert.equal(counter.textContent, '7');
});
