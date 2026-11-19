import { author, emptyMember, exampleProject, fields, maxAttachmentSize, memberFields, newProject, safeLink, slots, stages, states, validFile } from './model.js';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('entrega-tecnica', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' }).put(exampleProject());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function readProjects(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function writeProjects(db, projects) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    for (const project of projects) store.add(project);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export function updateProject(db, id, change) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    const store = transaction.objectStore('projects');
    const request = store.get(id);
    let result;
    let failure;
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('Atividade indisponível.');
        result = change(request.result);
        if (result) store.put(result);
        else store.delete(id);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || transaction.error);
  });
}

const asText = value => typeof value === 'string' ? value.trim() : '';
const urlFields = ['original','fork','github','pr','moodle'];
function fileToData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function makeBackup(projects) {
  const records = [];
  for (const project of projects) {
    const artifacts = {};
    for (const [key, { link, file }] of Object.entries(project.artifacts)) {
      artifacts[key] = { link };
      if (file) artifacts[key].file = { name: file.name, type: file.blob.type, data: await fileToData(file.blob) };
    }
    records.push({ ...project, artifacts });
  }
  return JSON.stringify({ format: 'entrega-tecnica', version: 1, projects: records });
}

export function parseBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== 'entrega-tecnica' || backup.version !== 1 || !Array.isArray(backup.projects)) {
    throw new Error('Selecione um backup JSON exportado pelo Entrega Técnica.');
  }
  return backup.projects.map(record => {
    if (!asText(record?.title)) throw new Error('O backup contém uma atividade sem título.');
    const project = newProject();
    if (record.example === true || record.id === 'exemplo') project.example = true;
    for (const key of fields) project[key] = asText(record[key]);
    for (const key of urlFields) project[key] = safeLink(project[key]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(project.deadline)) project.deadline = '';
    for (const [id] of stages) {
      const entry = record.stages?.[id];
      if (Object.hasOwn(states, entry?.state)) project.stages[id] = { state: entry.state, reason: asText(entry.reason) };
    }
    if (project.stages.author.state === 'done' && project.observedAuthor !== author) project.stages.author.state = 'pending';
    for (const person of Array.isArray(record.members) ? record.members : []) {
      const member = { ...emptyMember(), id: crypto.randomUUID() };
      for (const key of memberFields) member[key] = asText(person?.[key]);
      if (member.name) project.members.push(member);
    }
    for (const [key, label] of slots) {
      const entry = record.artifacts?.[key];
      if (!entry) continue;
      const item = { link: safeLink(asText(entry.link)) };
      if (entry.file) {
        const { name, type, data } = entry.file;
        const invalid = typeof name !== 'string' || !validFile(key, name) ||
          typeof data !== 'string' || data.length > Math.ceil(maxAttachmentSize / 3) * 4;
        if (invalid) throw new Error(`O anexo “${label}” está inválido ou excede 25 MB.`);
        const bytes = typeof Uint8Array.fromBase64 === 'function'
          ? Uint8Array.fromBase64(data)
          : Uint8Array.from(atob(data), character => character.charCodeAt(0));
        if (bytes.byteLength > maxAttachmentSize) throw new Error(`O anexo “${label}” excede 25 MB.`);
        item.file = { name, blob: new Blob([bytes], { type: asText(type) }) };
      }
      if (item.link || item.file) project.artifacts[key] = item;
    }
    return project;
  });
}
