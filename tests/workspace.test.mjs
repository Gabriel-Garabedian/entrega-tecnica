import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../dist/model.js';
import { searchProjects, deadlineInfo, parseDeadline, calendarDays, dayKey, priorityOrder, reorderColumn, chartData } from '../dist/workspace.js';

const project = (id, title, deadline = '') => ({ ...newProject(id), title, deadline });
test('busca encontra acentos, erros de digitação e integrantes', () => {
  const a = { ...project('a', 'Configuração Docker'), discipline: 'DevOps', members: [{ name: 'Gabriel' }] };
  const b = project('b', 'Matemática');
  assert.equal(searchProjects([a,b], 'configuracao')[0].id, 'a');
  assert.equal(searchProjects([a,b], 'dokcer')[0].id, 'a');
  assert.equal(searchProjects([a,b], 'gabriel')[0].id, 'a');
  assert.deepEqual(searchProjects([a,b], 'zzzzzz'), []);
});
test('prazo usa dias de calendário, não horas; entrega concluída não alerta', () => {
  const now = new Date(2026, 10, 19, 23, 59);
  const a = project('a', 'Entrega', '2026-11-18');
  assert.equal(deadlineInfo(a, now).tone, 'late');
  assert.equal(deadlineInfo({ ...a, deadline: '2026-11-19' }, now).label, 'Vence hoje');
  assert.equal(deadlineInfo({ ...a, deadline: '2026-11-20' }, now).label, 'Vence amanhã');
  assert.equal(deadlineInfo({ ...a, deadline: '2026-11-24' }, now).label, 'Faltam 5 dias');
  a.stages.github.state = a.stages.moodle.state = 'done';
  assert.equal(deadlineInfo(a, now).tone, 'done');
  assert.equal(parseDeadline('2026-02-30'), null);
});
test('calendário inclui mês inteiro em semanas completas', () => {
  const days = calendarDays(new Date(2026, 10, 19));
  assert.equal(days.length % 7, 0);
  assert.equal(days[0].getDay(), 0);
  assert.ok(days.some(date => dayKey(date) === '2026-11-30'));
});
test('prioridade altera somente a ordem sem modificar status', () => {
  const a = project('a', 'A'), b = project('b', 'B'), c = project('c', 'C');
  const order = reorderColumn(['a','b','c'], ['b','a']);
  assert.deepEqual(order, ['b','a','c']);
  assert.deepEqual(priorityOrder([a,b,c], order).map(item => item.id), ['b','a','c']);
  assert.equal(a.stages.github.state, 'pending');
});
test('gráficos calculam dados verdadeiros do checklist e não inventam valores', () => {
  assert.deepEqual(chartData([]), { counts: { doing:0,blocked:0,delivered:0 }, progress: [] });
  const a = project('a','A'); a.stages.structure.state = 'done';
  assert.deepEqual(chartData([a]), { counts: { doing:1,blocked:0,delivered:0 }, progress: [{ title:'A',percent:9 }] });
});
