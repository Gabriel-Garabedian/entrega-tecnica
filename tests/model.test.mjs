import test from 'node:test';
import assert from 'node:assert/strict';
import { author, newProject, summary, safeLink, validFile, professorMessage } from '../dist/model.js';
import { parseBackup } from '../dist/storage.js';

test('atividade nova tem 11 etapas e quatro anexos faltantes', () => {
  const result = summary(newProject());
  assert.equal(result.total, 11);
  assert.equal(result.percent, 0);
  assert.equal(result.missing.length, 4);
});
test('etapas não aplicáveis não entram no progresso', () => {
  const project = newProject();
  project.stages.zip.state = 'na';
  project.stages.docs.state = 'done';
  assert.equal(summary(project).percent, 10);
  assert.equal(summary(project).missing.length, 3);
});
test('entrega e bloqueio são exibidos corretamente', () => {
  const project = newProject();
  project.stages.github.state = project.stages.moodle.state = 'done';
  assert.equal(summary(project).status, 'delivered');
  project.stages.tests.state = 'blocked';
  assert.equal(summary(project).status, 'blocked');
});
test('links e tipos de anexos são validados', () => {
  assert.equal(safeLink('https://github.com/'), 'https://github.com/');
  assert.equal(safeLink('javascript:void(0)'), '');
  assert.equal(validFile('report', 'relatorio.pdf'), true);
  assert.equal(validFile('report', 'relatorio.exe'), false);
});
test('backup restaura dados com identificador novo e verifica autoria', () => {
  const project = newProject();
  project.title = 'Entrega';
  project.observedAuthor = 'Outra conta';
  project.stages.author.state = 'done';
  const [restored] = parseBackup(JSON.stringify({ format: 'entrega-tecnica', version: 1, projects: [project] }));
  assert.notEqual(restored.id, project.id);
  assert.equal(restored.title, 'Entrega');
  assert.equal(restored.stages.author.state, 'pending');
  assert.equal(author, 'Gabriel-Garabedian');
  assert.match(professorMessage(restored), /Entrega/);
});
