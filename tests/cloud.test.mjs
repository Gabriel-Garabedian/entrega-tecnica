import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudStore, attachmentPath, localOnlyProjects, unpackRow, conflictMessage, authRedirectUrl } from '../dist/cloud.js';
import { newProject } from '../dist/model.js';

const user = { id: '8ca25ba1-c188-4d71-9c13-308382583545' };
const projectId = 'b8b0349a-6c64-4ef6-9d44-f0cd94d48d20';
const objectId = 'd4a4a53a-71ff-4d5a-9d2f-bfc195b82c34';
test('confirmação de e-mail usa o endereço GitHub Pages, preservando o endereço antigo', () => {
  assert.equal(authRedirectUrl({ hostname: 'gabriel-garabedian.github.io' }), 'https://gabriel-garabedian.github.io/entrega-tecnica/');
  assert.equal(authRedirectUrl({ hostname: 'entrega-tecnica-gabriel.garabedi4n.chatgpt.site' }), 'https://entrega-tecnica-gabriel.garabedi4n.chatgpt.site/');
  assert.equal(authRedirectUrl({ hostname: 'localhost' }), 'https://gabriel-garabedian.github.io/entrega-tecnica/');
});
test('anexos são endereçados por conta, atividade, categoria e identificador aleatório', () => {
  assert.equal(attachmentPath(user.id, projectId, 'report', objectId), `${user.id}/${projectId}/report/${objectId}`);
  assert.throws(() => attachmentPath(user.id, projectId, '../zip', objectId));
  assert.throws(() => attachmentPath('outra-conta', projectId, 'zip', objectId));
});
test('migração local é idempotente e não inclui demonstrações', () => {
  const existing = newProject(projectId), fresh = newProject(objectId);
  assert.deepEqual(localOnlyProjects([existing, fresh, { id: 'exemplo' }], [projectId]), [fresh]);
});
test('identificação e versão são recebidas da linha, não do JSON', () => {
  assert.deepEqual(unpackRow({ project_id: projectId, payload: { id: 'errado', title: 'Entrega' }, version: 4 }), { id: projectId, title: 'Entrega', _cloudVersion: 4 });
});
test('arquivo é enviado para Storage e somente referência entra no banco', async () => {
  const uploads = [];
  const client = { storage: { from(bucket) { assert.equal(bucket, 'entrega-anexos'); return { async upload(path, blob, options) { uploads.push({ path, blob, options }); return { error: null }; } }; } } };
  const store = new CloudStore(client, user);
  const project = newProject(projectId); project.title = 'Entrega';
  project.artifacts.report = { link: '', file: { name: 'relatorio.pdf', blob: new Blob(['teste'], { type: 'application/pdf' }) } };
  const paths = [];
  const payload = await store.packProject(project, paths);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.upsert, false);
  assert.ok(paths[0].startsWith(`${user.id}/${projectId}/report/`));
  assert.equal(payload.artifacts.report.file.path, paths[0]);
  assert.equal(payload.artifacts.report.file.blob, undefined);
  assert.equal(payload.artifacts.report.file.size, 5);
});
test('edição de versão antiga é recusada antes de escrever', async () => {
  let updated = false;
  const builder = { select() { return this; }, eq() { return this; }, is() { return this; }, async maybeSingle() { return { data: { project_id: projectId, payload: newProject(projectId), version: 2 }, error: null }; }, update() { updated = true; return this; } };
  const store = new CloudStore({ from() { return builder; } }, user);
  await assert.rejects(store.updateProject(projectId, project => project, 1), { message: conflictMessage });
  assert.equal(updated, false);
});
