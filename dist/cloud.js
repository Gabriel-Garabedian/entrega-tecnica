import { fields, slots, maxAttachmentSize, validFile } from './model.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './cloud-config.js';

const TABLE = 'entrega_projects';
const BUCKET = 'entrega-anexos';
const rowFields = 'project_id,payload,version,deleted_at';
export const conflictMessage = 'Esta atividade mudou em outro dispositivo. Atualize o painel, revise os dados e tente novamente.';
export function authRedirectUrl(locationLike = globalThis.location) {
  const oldHost = 'entrega-tecnica-gabriel.garabedi4n.chatgpt.site';
  return locationLike?.hostname === oldHost ? `https://${oldHost}/` : 'https://gabriel-garabedian.github.io/entrega-tecnica/';
}
let clientPromise;
export function getCloudClient() {
  return clientPromise ??= import('./vendor/supabase.mjs').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'entrega-tecnica-auth' } }));
}
function fail(error) { if (error) { const problem = new Error(error.message || 'Não foi possível conectar ao Supabase.'); problem.code = error.code; throw problem; } }
export function unpackRow(row) {
  return { ...row.payload, id: row.project_id, _cloudVersion: Number(row.version) };
}
export function localOnlyProjects(local, remoteIds) {
  const ids = new Set(remoteIds);
  return local.filter(project => project.id !== 'exemplo' && !project.example && !ids.has(project.id));
}
export function attachmentPath(userId, projectId, key, objectId = crypto.randomUUID()) {
  const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  if (![userId, projectId, objectId].every(id => uuid.test(id)) || !slots.some(([slot]) => slot === key)) throw new Error('Identificação de anexo inválida.');
  return `${userId}/${projectId}/${key}/${objectId}`;
}
const paths = project => Object.values(project?.artifacts || {}).map(item => item.file?.path).filter(Boolean);

export class CloudStore {
  constructor(client, user) { this.client = client; this.user = user; }
  async readProjects() {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from(TABLE).select(rowFields).eq('owner_id', this.user.id).is('deleted_at', null).order('project_id').range(offset, offset + 499);
      fail(error); rows.push(...(data || [])); if (!data || data.length < 500) break;
    }
    return rows.map(unpackRow);
  }
  async existingIds() {
    const ids = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from(TABLE).select('project_id').eq('owner_id', this.user.id).order('project_id').range(offset, offset + 499);
      fail(error); ids.push(...(data || []).map(row => row.project_id)); if (!data || data.length < 500) break;
    }
    return ids;
  }
  async cleanup(objects) {
    const own = objects.filter(path => typeof path === 'string' && path.startsWith(`${this.user.id}/`));
    if (!own.length) return;
    try { const { error } = await this.client.storage.from(BUCKET).remove(own); if (error) console.warn('Limpeza de anexos pendente.'); } catch { console.warn('Limpeza de anexos pendente.'); }
  }
  async packProject(project, uploaded) {
    const payload = Object.fromEntries(fields.map(key => [key, String(project[key] ?? '')]));
    payload.stages = project.stages; payload.members = project.members; payload.artifacts = {};
    if (project.example) payload.example = true;
    for (const [key] of slots) {
      const item = project.artifacts?.[key]; if (!item) continue;
      const result = { link: item.link || '' };
      if (item.file?.blob) {
        const { name, blob } = item.file;
        if (!validFile(key, name) || !blob.size || blob.size > maxAttachmentSize) throw new Error('Anexo inválido ou acima de 25 MB.');
        const path = attachmentPath(this.user.id, project.id, key);
        const { error } = await this.client.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: blob.type || 'application/octet-stream' });
        fail(error); uploaded.push(path);
        result.file = { name, path, type: blob.type || 'application/octet-stream', size: blob.size };
      } else if (item.file?.path) {
        if (!item.file.path.startsWith(`${this.user.id}/${project.id}/${key}/`)) throw new Error('Anexo não pertence à atividade.');
        result.file = { name: item.file.name, path: item.file.path, type: item.file.type, size: item.file.size };
      }
      if (result.link || result.file) payload.artifacts[key] = result;
    }
    return payload;
  }
  async writeProjects(projects) {
    if (!projects.length) return [];
    const uploaded = [];
    let attempted = false;
    try {
      const rows = [];
      for (const project of projects) rows.push({ owner_id: this.user.id, project_id: project.id, payload: await this.packProject(project, uploaded) });
      attempted = true;
      const { data, error } = await this.client.from(TABLE).insert(rows).select(rowFields);
      fail(error);
      if (data?.length !== rows.length) throw new Error('Não foi possível confirmar a gravação. Sincronize para conferir.');
      return data.map(unpackRow);
    } catch (error) {
      // If the response is lost, the database may have committed; never delete a possibly referenced file.
      if (!attempted || /^[0-9A-Z]{5}$/.test(error.code || '')) await this.cleanup(uploaded);
      throw error;
    }
  }
  async updateProject(id, change, expectedVersion) {
    const { data: row, error } = await this.client.from(TABLE).select(rowFields).eq('owner_id', this.user.id).eq('project_id', id).is('deleted_at', null).maybeSingle();
    fail(error);
    if (!row || Number(row.version) !== Number(expectedVersion)) throw new Error(conflictMessage);
    const previous = unpackRow(row);
    const oldPaths = paths(previous);
    const changed = change(structuredClone(previous));
    const uploaded = [];
    let committed = false, attempted = false;
    try {
      const payload = changed ? await this.packProject(changed, uploaded) : {};
      const patch = changed ? { payload } : { payload: {}, deleted_at: new Date().toISOString() };
      attempted = true;
      const { data, error: updateError } = await this.client.from(TABLE).update(patch).eq('owner_id', this.user.id).eq('project_id', id).eq('version', row.version).is('deleted_at', null).select(rowFields).maybeSingle();
      fail(updateError); if (!data) { attempted = false; throw new Error(conflictMessage); }
      committed = true;
      const retained = new Set(paths(payload));
      await this.cleanup(oldPaths.filter(path => !retained.has(path)));
      return changed ? unpackRow(data) : null;
    } catch (problem) { if (!committed && (!attempted || /^[0-9A-Z]{5}$/.test(problem.code || ''))) await this.cleanup(uploaded); throw problem; }
  }
  async fileBlob(file) {
    if (file.blob) return file.blob;
    if (!file.path?.startsWith(`${this.user.id}/`)) throw new Error('Anexo indisponível nesta conta.');
    const { data, error } = await this.client.storage.from(BUCKET).download(file.path);
    fail(error); return data;
  }
  watch(callback, status) {
    const channel = this.client.channel(`entrega-${this.user.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `owner_id=eq.${this.user.id}` }, callback)
      .subscribe(status);
    return () => { this.client.removeChannel(channel).catch(() => {}); };
  }
}
