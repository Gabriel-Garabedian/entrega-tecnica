import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../dist/storage.js';

function mockDatabase(t, oldVersion, records = []) {
  const rows = new Map(records.map(record => [record.id, record]));
  let created = false;
  const store = { delete: id => rows.delete(id) };
  const result = { createObjectStore(name, options) {
    assert.equal(name, 'projects');
    assert.equal(options.keyPath, 'id');
    created = true;
    return store;
  } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open(name, version) {
      assert.equal(name, 'entrega-tecnica');
      assert.equal(version, 2);
      const request = { result, transaction: { objectStore(storeName) {
        assert.equal(storeName, 'projects');
        return store;
      } } };
      queueMicrotask(() => {
        if (oldVersion < version) request.onupgradeneeded({ oldVersion });
        request.onsuccess();
      });
      return request;
    }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'indexedDB', previous) : delete globalThis.indexedDB);
  return { rows, result, store, get created() { return created; } };
}

test('banco novo inicia vazio', async t => {
  const db = mockDatabase(t, 0);
  await openDatabase();
  assert.equal(db.created, true);
  assert.equal(db.rows.size, 0);
});

test('migração remove apenas a demonstração e preserva uma atividade real', async t => {
  const real = { id: 'real-1', title: 'Minha atividade', artifacts: { zip: { link: 'https://example.com/zip' } } };
  const db = mockDatabase(t, 1, [{ id: 'exemplo', title: 'API de catálogo' }, real]);
  await openDatabase();
  assert.equal(db.rows.has('exemplo'), false);
  assert.deepEqual([...db.rows.values()], [real]);
  assert.equal(db.created, false);
});

