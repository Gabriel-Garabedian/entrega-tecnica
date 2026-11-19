import { author, emptyMember, fields, maxAttachmentSize, memberFields, newProject, professorMessage, safeLink, slots, stages, states, statusLabels, summary, validFile } from './model.js';
import { makeBackup, openDatabase, parseBackup, readProjects, updateProject, writeProjects } from './storage.js';
import { reveal, animateCounts, animateProgress, animateDialog, animateNotice, animatePress, animateStatus } from './motion-ui.js';
import { installIcons, searchProjects, deadlineInfo, displayDate, monthLabel, dayKey, calendarDays, addMonths, isSameMonth, startOfMonth, priorityOrder, reorderColumn, mountBoard, destroyBoard, chartData, mountCharts, destroyCharts } from './workspace.js';
import { CloudStore, getCloudClient, localOnlyProjects } from './cloud.js';
import { installApp } from './pwa.js';

const root = document.querySelector('main');
const dialog = document.querySelector('dialog');
const notice = document.querySelector('#notice');
const tabs = {
  etapas: ['Etapas', 'checklist'], dados: ['Dados da atividade', 'folder'],
  equipe: ['Equipe e testes', 'team'], envio: ['Arquivos e envio', 'file']
};
const links = [
  ['original','Repositório original'], ['fork','Fork'], ['github','Link do GitHub'],
  ['pr','Pull request'], ['moodle','Link da atividade no Moodle']
];
const captions = {
  name: 'Nome do integrante', role: 'Responsabilidades', commands: 'Comandos executados',
  tests: 'Testes realizados', results: 'Resultados', pending: 'Pendências'
};

installIcons();

let db;
let cloudClient, cloud, unwatchCloud, refreshTimer;
let busy = 0, refreshing = false, refreshPending = false, authEpoch = 0;
let cloudLoaded = false;
let syncText = 'Dados neste navegador';
let projects = [];
let filter = 'all';
let query = '';
let monitored = '';
let noticeTimeout;
let view = 'list';
let manualOrder = [];
let calendarMonth = startOfMonth(new Date());
let selectedDay = dayKey(new Date());
try { view = localStorage.getItem('entrega-tecnica-view') === 'kanban' ? 'kanban' : 'list'; const saved = JSON.parse(localStorage.getItem('entrega-tecnica-order') || '[]'); if (Array.isArray(saved)) manualOrder = saved.filter(id => typeof id === 'string'); } catch {}
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const icon = name => `<i data-icon="${name}" aria-hidden="true"></i>`;
const activityLink = (project, tab = 'etapas') => `#atividade/${project.id}/${tab}`;
const pill = (state, text) => `<span class="pill ${state}">${esc(text)}</span>`;
const statusBadge = info => pill(info.status, info.status === 'delivered' ? 'Entregue' : info.status === 'blocked' ? 'Com bloqueios' : 'Em andamento');
const isExample = project => project.example || project.id === 'exemplo';
const sample = project => isExample(project) ? pill('sample', 'Exemplo') : '';
const text = (value, fallback = '') => value ? esc(value) : fallback;
const date = displayDate;
const deadlineBadge = project => { const result = deadlineInfo(project); return `<span class="deadline-badge ${result.tone}">${esc(result.label)}</span>`; };
const external = (value, label, className = '') => {
  const url = safeLink(value);
  return url ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
};
const button = (name, label, appearance = 'secondary', glyph = '', extra = '') =>
  `<button type="button" class="button ${appearance}" data-action="${name}" ${extra}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
const list = items => items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
const progressBar = (info, key) => `<div class="progress-row"><progress class="visually-hidden" value="${info.percent}" max="100" aria-label="Progresso das etapas"></progress><span class="progress-track" aria-hidden="true"><span class="progress-fill" data-progress="${esc(key)}" data-value="${info.percent}" style="transform:scaleX(${info.percent / 100})"></span></span><small>${info.done.length}/${info.total}</small></div>`;
const currentRoute = () => location.hash.slice(1).split('/');
const byId = id => projects.find(project => project.id === id);

function notify(message) {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  animateNotice(notice);
  noticeTimeout = setTimeout(() => { notice.textContent = ''; }, 4200);
}

function paintAccount() {
  const status = document.querySelector('#sync-status');
  const account = document.querySelector('#account-button');
  status.textContent = syncText;
  account.querySelector('span').textContent = cloud ? 'Minha conta' : 'Entrar';
  account.title = cloud ? cloud.user.email || 'Conta conectada' : 'Entrar para sincronizar';
}
function syncStatus(message) { syncText = message; paintAccount(); }
async function activeRead() { return cloud ? cloud.readProjects() : readProjects(db); }
async function activeWrite(records) { if (cloud) return cloud.writeProjects(records); await writeProjects(db, records); return records; }
async function activeBlob(file) { return cloud ? cloud.fileBlob(file) : file.blob; }
function requestRefresh() {
  refreshPending = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshCloud, 220);
}
async function refreshCloud(force = false) {
  const store = cloud;
  if (!store) return;
  if (refreshing || busy || (dialog.open && !force)) { refreshPending = true; return; }
  refreshing = true; refreshPending = false;
  try {
    const records = await store.readProjects();
    if (cloud !== store) return;
    if (busy || (dialog.open && !force)) { refreshPending = true; return; }
    const changed = !cloudLoaded || JSON.stringify(records.map(p => [p.id,p._cloudVersion]).sort()) !== JSON.stringify(projects.map(p => [p.id,p._cloudVersion]).sort());
    cloudLoaded = true;
    if (changed) { setProjects(records); renderKeepingDrafts(); }
    syncStatus('Sincronizado na nuvem');
  } catch { if (cloud === store) syncStatus('Sem conexão · tente sincronizar'); }
  finally { refreshing = false; if (refreshPending && !busy && !dialog.open && cloud) requestRefresh(); }
}
async function applySession(session) {
  const user = session?.user;
  if ((!cloud && !user) || (cloud && cloud.user.id === user?.id)) return;
  const epoch = ++authEpoch;
  unwatchCloud?.(); unwatchCloud = undefined;
  clearTimeout(refreshTimer); refreshPending = false;
  cloud = user ? new CloudStore(cloudClient, user) : undefined;
  cloudLoaded = false;
  projects = []; monitored = ''; filter = 'all'; query = '';
  root.innerHTML = '<p class="loading">Carregando atividades…</p>';
  syncStatus(cloud ? 'Conectando à nuvem…' : 'Dados neste navegador');
  const store = cloud;
  try {
    const records = store ? await store.readProjects() : await readProjects(db);
    if (epoch !== authEpoch) return;
    cloudLoaded = true; setProjects(records); render(true);
    if (store) {
      syncStatus('Sincronizado na nuvem');
      unwatchCloud = store.watch(requestRefresh, status => { if (cloud === store) { if (status === 'SUBSCRIBED') requestRefresh(); else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) syncStatus('Conexão instável · atualização automática por consulta'); } });
    }
  } catch { if (epoch === authEpoch) { render(true); syncStatus(store ? 'Sem conexão · tente sincronizar' : 'Armazenamento local indisponível'); } }
}
function authDialog(signup = false) {
  if (cloud) {
    showDialog('Minha conta', `<p class="cloud-account"><strong>${esc(cloud.user.email || 'Conta conectada')}</strong><span class="muted">${esc(syncText)}</span></p><p class="section-intro">As atividades da conta aparecem nos dispositivos onde você entrar com o mesmo e-mail. Os anexos ficam privados.</p><div class="stack">${button('sync-now','Sincronizar agora','secondary','download')}${button('migrate','Copiar atividades locais para a nuvem','secondary','folder')}${button('signout','Sair da conta','secondary')}</div><p class="section-intro">Se criou atividades em outro endereço (por exemplo localhost), exporte um backup lá e importe neste painel com sua conta conectada.</p>`);
    return;
  }
  showDialog(signup ? 'Criar conta' : 'Entrar e sincronizar', `<p class="section-intro">Use o mesmo e-mail no computador e celular. Seus dados locais continuam disponíveis sem login.</p><form data-form="${signup ? 'signup' : 'signin'}"><div class="form-grid"><label class="field span"><span>E-mail</span><input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="seu@email.com"></label><label class="field span"><span>Senha</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? '8' : '1'}" required placeholder="${signup ? 'Mínimo de 8 caracteres' : 'Sua senha'}"></label></div>${formError}<div class="form-actions"><button class="button primary" type="submit">${signup ? 'Criar conta' : 'Entrar'}</button>${button(signup ? 'auth' : 'auth-signup',signup ? 'Já tenho conta' : 'Criar minha conta','secondary')}</div>${signup ? '<p class="section-intro">Confirme o cadastro no e-mail enviado pelo Supabase, depois volte ao painel e entre.</p>' : ''}</form>`);
}

function saveOrder(ids) {
  manualOrder = reorderColumn(manualOrder, ids).filter(id => byId(id));
  try { localStorage.setItem('entrega-tecnica-order', JSON.stringify(manualOrder)); } catch {}
}
function kanban(visible) {
  const columns = ['doing', 'blocked', 'delivered'].filter(status => filter === 'all' || filter === status);
  return `<p class="board-hint muted">Arraste para priorizar dentro de uma coluna. O status muda pelas etapas da atividade.</p><div class="kanban-grid">${columns.map(status => {
    const cards = priorityOrder(visible.filter(project => summary(project).status === status), manualOrder);
    return `<section class="kanban-column" aria-label="${statusLabels[status]}"><header><span class="kanban-dot ${status}"></span><h3>${statusLabels[status]}</h3><span class="column-count">${cards.length}</span></header><div class="kanban-list" data-kanban-list="${status}">${cards.map((project, index) => `<article class="kanban-card panel" data-card="${esc(project.id)}"><div class="kanban-card-head"><a href="${activityLink(project)}"><strong>${esc(project.title)}</strong></a>${query.trim() ? '' : `<span class="drag-handle" title="Arrastar para priorizar">${icon('grip')}</span>`}</div><small>${text(project.discipline, 'Sem disciplina')}</small>${progressBar(summary(project), `board-${project.id}`)}<div class="kanban-foot">${deadlineBadge(project)}${query.trim() ? '' : `<div class="kanban-order"><button class="order-button" type="button" data-action="reorder" data-id="${esc(project.id)}" data-direction="-1" aria-label="Mover ${esc(project.title)} para cima" ${index === 0 ? 'disabled' : ''}>${icon('chevron-up')}</button><button class="order-button" type="button" data-action="reorder" data-id="${esc(project.id)}" data-direction="1" aria-label="Mover ${esc(project.title)} para baixo" ${index === cards.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button></div>`}</div></article>`).join('') || '<p class="kanban-empty">Nenhuma atividade</p>'}</div></section>`;
  }).join('')}</div>`;
}
function renderRows() {
  const area = document.querySelector('#table-area');
  if (!area) return;
  destroyBoard();
  const visible = searchProjects(projects.filter(project => filter === 'all' || summary(project).status === filter), query);
  if (view === 'kanban' && (visible.length || !query.trim())) {
    area.innerHTML = kanban(visible);
    if (!query.trim()) mountBoard(area, ids => { saveOrder(ids); renderRows(); notify('Ordem de prioridade salva.'); });
    animateProgress(area);
    return;
  }
  if (!visible.length) {
    area.innerHTML = projects.length ? '<div class="panel empty">Nenhuma atividade corresponde à busca.</div>' : `<div class="panel empty empty-start"><span class="tile-icon">${icon('folder')}</span><h3>Nenhuma atividade cadastrada</h3><p>Seu painel está pronto. Crie sua primeira atividade quando quiser.</p>${button('new', 'Criar primeira atividade', 'primary', 'plus')}</div>`;
    return;
  }
  area.innerHTML = `<div class="panel table-wrap"><table>
    <thead><tr><th scope="col">Atividade</th><th scope="col">Status</th><th scope="col">Etapas</th><th scope="col">Prazo</th><th scope="col"><span class="visually-hidden">Detalhes</span></th></tr></thead>
    <tbody>${visible.map(project => {
      const info = summary(project);
      return `<tr>
        <td><div class="activity-cell"><span class="tile-icon">${icon('folder')}</span><div><a href="${activityLink(project)}">${esc(project.title)}</a>${sample(project)}<small>${text(project.discipline, 'Sem disciplina')}</small></div></div></td>
        <td>${statusBadge(info)}</td><td class="progress-cell">${progressBar(info, `row-${project.id}`)}</td>
        <td data-cell="deadline"><span class="deadline-date">${date(project.deadline)}</span>${deadlineBadge(project)}</td>
        <td><a class="button secondary" href="${activityLink(project)}" aria-label="Abrir ${esc(project.title)}">Abrir</a></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  animateProgress(area);
}

function insights() {
  const { counts, progress } = chartData(projects);
  const pending = projects.map(project => ({ project, info: deadlineInfo(project) })).filter(item => item.info.date && item.info.tone !== 'done').sort((a,b) => a.info.days - b.info.days);
  const late = pending.filter(item => item.info.days < 0).length;
  const soon = pending.filter(item => item.info.days >= 0 && item.info.days <= 7).length;
  return `<section class="insights" id="insights"><div class="section-head"><div><h2>Planejamento e produtividade</h2><p class="muted">Acompanhe seus prazos e a evolução de cada entrega.</p></div></div><div class="insight-grid"><section class="panel padded"><div class="panel-heading">${icon('chart')}<h2>Distribuição por status</h2></div>${projects.length ? `<div class="donut-wrap"><canvas id="status-chart" role="img" aria-label="${counts.doing} em andamento, ${counts.blocked} com bloqueios e ${counts.delivered} entregues"></canvas><div class="donut-center" aria-hidden="true"><strong>${projects.length}</strong><small>atividades</small></div></div><div class="chart-legend">${[['doing','Em andamento'],['blocked','Com bloqueios'],['delivered','Entregues']].map(([status,label]) => `<span><i class="kanban-dot ${status}"></i>${label} <b>${counts[status]}</b></span>`).join('')}</div>` : '<div class="chart-empty">Cadastre uma atividade para visualizar os dados.</div>'}</section><section class="panel padded"><div class="panel-heading">${icon('checklist')}<h2>Progresso por atividade</h2></div>${projects.length ? `<div class="bar-wrap"><canvas id="progress-chart" role="img" aria-label="${esc(progress.map(item => `${item.title}: ${item.percent}%`).join('; '))}"></canvas></div><small class="muted">Até seis atividades, priorizadas pelo prazo.</small>` : '<div class="chart-empty">O gráfico acompanha as etapas concluídas.</div>'}</section></div><div class="insight-grid calendar-grid"><section class="panel padded"><div class="panel-heading">${icon('calendar')}<h2>Calendário de entregas</h2></div><div id="calendar-area"></div></section><section class="panel padded"><div class="panel-heading">${icon('clock')}<h2>Alertas de prazo</h2></div><div class="deadline-stats"><div><b>${late}</b><small>Atrasadas</small></div><div><b>${soon}</b><small>Próximos 7 dias</small></div></div>${pending.length ? `<ul class="mini-list deadline-list">${pending.slice(0, 6).map(({project}) => `<li><div><a href="${activityLink(project)}">${esc(project.title)}</a><small>${date(project.deadline)}</small></div>${deadlineBadge(project)}</li>`).join('')}</ul>` : '<p class="muted chart-empty">Nenhum prazo pendente. Adicione uma data a uma atividade.</p>'}</section></div></section>`;
}
function renderCalendar() {
  const area = document.querySelector('#calendar-area');
  if (!area) return;
  const today = dayKey(new Date());
  const byDay = new Map();
  for (const project of projects) { const info = deadlineInfo(project); if (info.date) { const key = dayKey(info.date); byDay.set(key, [...(byDay.get(key) || []), project]); } }
  const selected = byDay.get(selectedDay) || [];
  area.innerHTML = `<div class="calendar-head"><h3>${esc(monthLabel(calendarMonth))}</h3><div class="calendar-controls">${button('calendar-prev','', 'secondary icon-button', 'chevron-left', 'aria-label="Mês anterior"')}${button('calendar-today','Hoje','secondary')}${button('calendar-next','', 'secondary icon-button', 'chevron-right', 'aria-label="Próximo mês"')}</div></div><div class="calendar-days">${['dom','seg','ter','qua','qui','sex','sáb'].map(label => `<span class="weekday">${label}</span>`).join('')}${calendarDays(calendarMonth).map(day => {
    const key = dayKey(day); const entries = byDay.get(key) || [];
    return `<button type="button" data-action="calendar-day" data-day="${key}" class="calendar-day ${!isSameMonth(day, calendarMonth) ? 'outside' : ''} ${key === today ? 'today' : ''}" aria-pressed="${key === selectedDay}" aria-label="${key.split('-').reverse().join('/')}, ${entries.length} ${entries.length === 1 ? 'entrega' : 'entregas'}"><span>${day.getDate()}</span>${entries.length ? `<small class="calendar-event">${entries.length}</small>` : ''}</button>`;
  }).join('')}</div><div class="calendar-agenda"><h3>${date(selectedDay)}</h3>${selected.length ? `<ul class="mini-list deadline-list">${selected.map(project => `<li><a href="${activityLink(project)}">${esc(project.title)}</a>${deadlineBadge(project)}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma entrega nesta data.</p>'}</div>`;
}

function summaryPanel(project) {
  const info = summary(project);
  return `<section class="panel padded">
    <div class="panel-heading">${icon('alert')}<h2>Prontidão da entrega</h2></div>
    <div class="monitor-line"><strong>Etapas concluídas</strong><span>${info.done.length} de ${info.total}</span></div>
    <div class="monitor-line"><strong>Bloqueios</strong><span>${info.blocked.length}</span></div>
    ${list(info.blocked.map(row => row.reason ? `${row.title} — ${row.reason}` : row.title))}
    <div class="monitor-line"><strong>Arquivos faltantes</strong><span>${info.missing.length}</span></div>
    ${list(info.missing)}
    ${project.pending ? `<p class="block-note"><strong>Pendências</strong><br>${esc(project.pending)}</p>` : ''}
  </section>`;
}

function messagePanel(project) {
  return `<section class="panel padded">
    <div class="panel-heading">${icon('send')}<h2>Mensagem ao professor</h2></div>
    <div class="message" tabindex="0" role="region" aria-label="Prévia da mensagem">${esc(professorMessage(project))}</div>
    ${button('copy', 'Copiar mensagem', 'secondary', 'copy', `data-id="${project.id}"`)}
  </section>`;
}

function renderMonitor() {
  const area = document.querySelector('#monitor');
  if (!area) return;
  const project = byId(monitored) || projects[0];
  area.hidden = !project;
  if (!project) return;
  const details = area.querySelector('.review-grid');
  details.innerHTML = `<section class="panel padded">
    <div class="panel-heading">${icon('checklist')}<h2>Status por etapa</h2></div>
    <ul class="mini-list">${stages.map(([id, label]) => `<li><span>${label}</span>${pill(project.stages[id].state, states[project.stages[id].state])}</li>`).join('')}</ul>
    <div class="form-actions"><a class="button secondary" href="${activityLink(project)}">Revisar etapas</a></div>
  </section><div class="stack">${summaryPanel(project)}${messagePanel(project)}</div>`;
}

function dashboard(home) {
  const counts = { all: projects.length, doing: 0, blocked: 0, delivered: 0 };
  for (const project of projects) counts[summary(project).status]++;
  const metrics = [
    ['all','Atividades','folder',''], ['doing','Em andamento','clock','blue'],
    ['blocked','Com bloqueios','alert','amber'], ['delivered','Entregues','check','green']
  ];
  root.innerHTML = `${home ? `<section class="hero">
    <div class="hero-copy"><h1>Painel de entregas</h1><p>Acompanhe o que falta revisar e prepare seus trabalhos para o GitHub e o Moodle.</p>
    ${button('new', 'Nova atividade', 'primary', 'plus')}</div>
    <div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="paper paper-back"></div>
    <div class="paper">${icon('checklist')}<span></span><span></span><span></span></div>
    <div class="file-chip zip">${icon('folder')} ZIP</div><div class="file-chip pdf">${icon('file')} PDF</div></div>
  </section>
  <div class="metrics" aria-label="Totais por status">${metrics.map(([id, label, glyph, tone]) => `<button class="metric" type="button" data-action="filter" data-filter="${id}" aria-label="${counts[id]} ${label}" aria-pressed="${filter === id}"><span class="tile-icon ${tone}">${icon(glyph)}</span><span><b data-count="${counts[id]}" data-metric="${id}" aria-hidden="true">${counts[id]}</b><small>${label}</small></span></button>`).join('')}</div>`
  : `<div class="title-row"><div><h1>Atividades</h1><p>Abra um projeto para editar os dados e acompanhar a entrega.</p></div>${button('new', 'Nova atividade', 'primary', 'plus')}</div>`}
  <section aria-label="Lista de atividades">
    <div class="section-head">
      ${home ? '<h2>Atividades</h2>' : ''}
      <div class="toolbar">
        <label class="search">${icon('search')}<span class="visually-hidden">Pesquisar atividades</span><input id="search" type="search" placeholder="Buscar atividade" value="${esc(query)}"></label>
        <select id="filter" aria-label="Filtrar atividades por status">${Object.entries(statusLabels).map(([id, label]) => `<option value="${id}" ${filter === id ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="view-toggle" role="group" aria-label="Visualização">${button('view-list','Lista','secondary','list',`aria-pressed="${view === 'list'}"`)}${button('view-kanban','Kanban','secondary','kanban',`aria-pressed="${view === 'kanban'}"`)}</div>
      </div>
    </div>
    <div id="table-area" aria-live="polite"></div>
  </section>
  ${home && projects.length ? `<section class="review" id="monitor"><div class="section-head"><h2>Visão consolidada</h2>
    <div class="toolbar"><select id="monitor-project" aria-label="Atividade da visão consolidada">${projects.map(project => `<option value="${project.id}" ${(byId(monitored) || projects[0]).id === project.id ? 'selected' : ''}>${esc(project.title)}${isExample(project) ? ' (exemplo)' : ''}</option>`).join('')}</select></div></div>
    <div class="review-grid"></div></section>` : ''}${home ? insights() : ''}`;
  renderRows();
  renderMonitor();
  animateCounts(root);
  if (home) { renderCalendar(); mountCharts(document.querySelector('#insights'), projects).catch(console.error); }
}

function basicInput(label, key, value = '', { type = 'text', required = false, hint = '', wide = false, rows = 0, placeholder = '' } = {}) {
  const attributes = `name="${key}" ${required ? 'required' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}`;
  return `<label class="field ${wide ? 'span' : ''}"><span>${label}</span>
    ${rows ? `<textarea ${attributes} rows="${rows}">${esc(value)}</textarea>` : `<input ${attributes} type="${type}" value="${esc(value)}">`}
    ${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function generalFields(project) {
  return [
    basicInput('Título da atividade', 'title', project.title, { required: true, wide: true }),
    basicInput('Disciplina', 'discipline', project.discipline),
    basicInput('Prazo informado', 'deadline', project.deadline, { type: 'date' })
  ].join('');
}

const formError = '<p class="error" role="alert"></p>';
const saveButton = '<button class="button primary" type="submit">Salvar alterações</button>';

function detailData(project) {
  return `<form class="panel padded" data-form="details" data-id="${project.id}">
    <section class="form-section"><h2>Identificação</h2><div class="form-grid">${generalFields(project)}</div></section>
    <section class="form-section"><h2>GitHub e Moodle</h2><div class="form-grid">
      ${links.map(([key, label]) => basicInput(label, key, project[key], { type: 'url', placeholder: 'https://' })).join('')}
      ${basicInput('Branch', 'branch', project.branch)}
      ${basicInput('Nome do autor exibido', 'observedAuthor', project.observedAuthor, { hint: `Nome esperado: ${author}`, wide: true })}
    </div></section>
    <section class="form-section"><h2>Execução e observações</h2><div class="form-grid">
      ${basicInput('O que foi feito', 'work', project.work, { rows: 3, wide: true })}
      ${basicInput('Onde estão as respostas', 'answers', project.answers, { rows: 3, wide: true, hint: 'Informe o caminho, a seção ou o link.' })}
      ${basicInput('Pendências', 'pending', project.pending, { rows: 3 })}
      ${basicInput('Observações do professor', 'teacher', project.teacher, { rows: 3 })}
    </div></section>
    ${formError}<div class="form-actions">${saveButton}</div>
  </form>`;
}

function detailStages(project) {
  return `<div class="detail-grid"><section class="panel padded">
    <div class="panel-heading">${icon('checklist')}<h2>Checklist de entrega</h2></div>
    <div class="checklist-progress"><span>Progresso da atividade</span>${progressBar(summary(project), `detail-${project.id}`)}</div>
    <ul class="stage-list">${stages.map(([id, label, detail]) => {
      const row = project.stages[id];
      return `<li><div class="stage-line"><div><strong>${label}</strong><small>${detail}</small>
        ${id === 'author' ? `<small>Nome esperado <strong style="display:inline">${author}</strong>. Nome registrado <strong style="display:inline">${text(project.observedAuthor, 'a conferir')}</strong>. <a href="${activityLink(project, 'dados')}">Editar autoria</a></small>` : ''}</div>
        <select data-stage="${id}" data-id="${project.id}" data-state="${row.state}" aria-label="Status de ${label}">${Object.entries(states).map(([key, value]) => `<option value="${key}" ${row.state === key ? 'selected' : ''}>${value}</option>`).join('')}</select>
      </div>${row.state === 'blocked' ? `<form class="reason" data-form="reason" data-id="${project.id}" data-stage-key="${id}">
        ${basicInput('Motivo do bloqueio', 'reason', row.reason)}${formError}<div class="form-actions">${saveButton}</div>
      </form>` : ''}</li>`;
    }).join('')}</ul>
  </section><div class="stack">${summaryPanel(project)}${messagePanel(project)}</div></div>`;
}

function detailTeam(project) {
  return `<div class="stack">
    <section class="panel padded"><div class="section-head"><h2>Integrantes e testes</h2>${button('member', 'Adicionar integrante', 'primary', 'plus', `data-id="${project.id}"`)}</div>
    <p class="muted">Registre as responsabilidades, os comandos e os resultados de cada pessoa.</p></section>
    ${project.members.length ? project.members.map(member => `<section class="panel padded">
      <div class="member-row"><div><strong>${esc(member.name)}</strong><p>${text(member.role)}</p></div>
      ${button('member', 'Editar registro', 'secondary', '', `data-id="${project.id}" data-member="${member.id || ''}"`)}</div>
      <div class="member-preview">${['commands','tests','results','pending'].filter(key => member[key]).map(key => `<div><strong>${captions[key]}</strong><br>${esc(member[key])}</div>`).join('')}</div>
    </section>`).join('') : '<p class="panel empty">Nenhum integrante cadastrado.</p>'}
  </div>`;
}

function detailDelivery(project) {
  return `<div class="detail-grid"><div class="stack">
    <section class="panel padded"><div class="panel-heading">${icon('file')}<h2>Arquivos da atividade</h2></div>
      <p class="section-intro">Anexe um arquivo de até 25 MB ou informe um link para cada item.</p>
      ${slots.map(([key, label, description, accept]) => {
        const item = project.artifacts[key] || {};
        return `<form class="artifact" data-form="artifact" data-id="${project.id}" data-key="${key}">
          <h3>${label}</h3><small class="muted">${description}</small>
          <div class="artifact-info">
            ${item.file ? `<span>${esc(item.file.name)}</span>${button('file', 'Baixar', 'secondary', 'download', `data-id="${project.id}" data-key="${key}"`)}
              ${button('remove-file', 'Remover anexo', 'plain', '', `data-id="${project.id}" data-key="${key}"`)}` : ''}
            ${external(item.link, 'Abrir link', 'button secondary')}
          </div>
          <div class="form-grid">
            ${basicInput(`Link de ${label.toLowerCase()}`, 'link', item.link, { type: 'url', placeholder: 'https://' })}
            <label class="field"><span>${item.file ? 'Substituir anexo' : 'Selecionar anexo'} · ${label}</span><input name="file" type="file" accept="${accept}"></label>
          </div>${formError}<div class="form-actions"><button class="button secondary" type="submit">Salvar ${label.toLowerCase()}</button></div>
        </form>`;
      }).join('')}
    </section>
    <form class="panel padded" data-form="delivery" data-id="${project.id}">
      <div class="panel-heading">${icon('send')}<h2>Preparação do envio</h2></div>
      <div class="form-grid">
        ${basicInput('Nome do arquivo final', 'finalName', project.finalName, { wide: true, placeholder: 'atividade.zip' })}
        ${basicInput('Mensagem resumida para a entrega', 'message', project.message, { rows: 4, wide: true })}
      </div>${formError}<div class="form-actions">${saveButton}</div>
    </form>
  </div><div class="stack">${messagePanel(project)}${summaryPanel(project)}
  <section class="panel padded"><h2>Destinos da entrega</h2><div class="metadata">${[
    external(project.github || project.fork, 'GitHub', 'button secondary'),
    external(project.pr, 'Pull request', 'button secondary'),
    external(project.moodle, 'Moodle', 'button secondary')
  ].filter(Boolean).join('') || 'Adicione os links na aba Dados da atividade.'}</div>
  <p class="section-intro">O status de envio é atualizado na aba Etapas.</p>
  <a class="button secondary" href="${activityLink(project)}">Atualizar etapas</a></section></div></div>`;
}

function render(transition = false) {
  destroyBoard();
  destroyCharts();
  if (cloud && !cloudLoaded) {
    root.innerHTML = `<div class="panel empty empty-start"><span class="tile-icon">${icon('alert')}</span><h3>Não foi possível carregar sua conta</h3><p>Confira a conexão e tente novamente. Seus dados na nuvem não foram apagados.</p>${button('sync-now','Tentar sincronizar','primary','download')}</div>`;
    return;
  }
  const [page, id, section] = currentRoute();
  const project = page === 'atividade' && byId(id);
  const tab = Object.hasOwn(tabs, section) ? section : 'etapas';
  document.querySelector('#page-label').textContent = project ? 'Atividade' : page === 'atividades' ? 'Atividades' : 'Visão geral';
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === (page === 'atividades' || project ? 'atividades' : 'inicio');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (!project) {
    dashboard(page !== 'atividades');
    if (transition) reveal(root);
    return;
  }
  const info = summary(project);
  root.innerHTML = `<a class="back" href="#atividades">Voltar às atividades</a>
    <div class="title-row"><div><h1>${esc(project.title)} ${sample(project)}</h1>
    <div class="metadata">${project.discipline ? `<span>${esc(project.discipline)}</span>` : ''}<span class="icon-label">${icon('clock')}${date(project.deadline)}</span>${deadlineBadge(project)}${statusBadge(info)}</div></div>
    ${button('delete', isExample(project) ? 'Remover exemplo' : 'Excluir atividade', 'secondary', '', `data-id="${project.id}"`)}</div>
    <nav class="tabbar" aria-label="Seções da atividade">${Object.entries(tabs).map(([key, [label, glyph]]) => `<a href="${activityLink(project, key)}" ${tab === key ? 'aria-current="page"' : ''}>${icon(glyph)}${label}</a>`).join('')}</nav>
    ${({ etapas: detailStages, dados: detailData, equipe: detailTeam, envio: detailDelivery })[tab](project)}`;
  animateProgress(root);
  if (transition) reveal(root);
}

function showDialog(title, content) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
    ${button('close', '', 'plain icon-button', 'close', 'aria-label="Fechar"')}</div>${content}`;
  if (!dialog.open) dialog.showModal();
  animateDialog(dialog);
  (dialog.querySelector('input:not([type=file])') || dialog.querySelector('[data-action=close]')).focus();
}

function backupDialog() {
  showDialog('Backup de atividades', `<p class="section-intro">Exporte os projetos e anexos como JSON. Ao importar em outro navegador, o painel acrescenta cópias das atividades à lista.</p>
    <div class="form-actions">${button('export', 'Exportar backup', 'secondary', 'download')}</div>
    <form class="delivery-area" data-form="import">
      <label class="field"><span>Arquivo de backup</span><input name="backup" type="file" accept=".json,application/json" required></label>
      ${formError}<div class="form-actions"><button class="button primary" type="submit">Importar atividades</button></div>
    </form>`);
}

function memberDialog(project, member) {
  showDialog(member ? 'Editar registro do integrante' : 'Adicionar integrante', `
    <form data-form="member" data-id="${project.id}" data-member="${member?.id || ''}">
      <div class="form-grid">${memberFields.map(key => basicInput(captions[key], key, member?.[key], {
        required: key === 'name', wide: !['name','role'].includes(key), rows: ['name','role'].includes(key) ? 0 : 2
      })).join('')}</div>
      ${formError}<div class="form-actions">${saveButton}
        ${member ? button('delete-member', 'Remover integrante', 'plain', '', `data-id="${project.id}" data-member="${member.id}"`) : ''}
      </div>
    </form>`);
}

function confirmDialog(title, description, form, project, member) {
  showDialog(title, `<p>${esc(description)}</p>
    <form data-form="${form}" data-id="${project.id}" data-member="${member?.id || ''}">
      ${formError}<div class="form-actions">
        ${button('close', 'Cancelar')}
        <button class="button danger" type="submit">Confirmar remoção</button>
      </div>
    </form>`);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyMessage(project) {
  const message = professorMessage(project);
  try {
    await navigator.clipboard.writeText(message);
    notify('Mensagem copiada.');
  } catch {
    showDialog('Copiar mensagem', `<p class="section-intro">Selecione o texto e use a opção de copiar do seu dispositivo.</p>
      ${basicInput('Mensagem ao professor', 'copy', message, { rows: 10 })}`);
    dialog.querySelector('textarea').select();
  }
}

function setFilter(next) {
  filter = next;
  document.querySelector('#filter').value = filter;
  document.querySelectorAll('[data-action=filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  renderRows();
}

async function handleAction(control) {
  const { action, id, key, member: memberId } = control.dataset;
  const project = byId(id);
  const person = project?.members.find(member => member.id === memberId);
  if (action === 'auth' || action === 'auth-signup') {
    if (!busy) authDialog(action === 'auth-signup');
  } else if (action === 'install') {
    if (!await installApp()) showDialog('Instalar Entrega Técnica', `<p class="section-intro">No Android, abra o site no Chrome e escolha “Instalar aplicativo” ou “Adicionar à tela inicial” no menu. No iPhone, abra no Safari, toque em Compartilhar e em “Adicionar à Tela de Início”.</p>${button('close','Entendi','primary')}`);
  } else if (action === 'signout' && cloud && !busy) {
    const { error } = await cloudClient.auth.signOut({ scope: 'local' });
    if (error) throw error;
    dialog.close(); await applySession(null); notify('Você saiu da conta. Seus dados na nuvem continuam salvos.');
  } else if (action === 'sync-now' && cloud) {
    dialog.close(); await refreshCloud(true); notify(syncText);
  } else if (action === 'migrate' && cloud) {
    const local = localOnlyProjects(await readProjects(db), await cloud.existingIds());
    if (!local.length) { notify('Não há atividades locais novas para copiar.'); return; }
    showDialog('Copiar para a nuvem', `<p>Copiar ${local.length} ${local.length === 1 ? 'atividade deste navegador' : 'atividades deste navegador'} e seus anexos para a sua conta? Os dados locais serão mantidos e atividades existentes na nuvem não serão sobrescritas.</p><form data-form="migrate">${formError}<div class="form-actions">${button('close','Cancelar')}<button class="button primary" type="submit">Copiar atividades</button></div></form>`);
  } else if (action === 'view-list' || action === 'view-kanban') {
    view = action.slice(5);
    try { localStorage.setItem('entrega-tecnica-view', view); } catch {}
    document.querySelectorAll('[data-action^="view-"]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.action === action)));
    renderRows();
    reveal(document.querySelector('#table-area'));
  } else if (action === 'reorder' && project) {
    const column = control.closest('[data-kanban-list]');
    const ids = [...column.querySelectorAll('[data-card]')].map(card => card.dataset.card);
    const index = ids.indexOf(id), next = index + Number(control.dataset.direction);
    if (index >= 0 && next >= 0 && next < ids.length) {
      [ids[index], ids[next]] = [ids[next], ids[index]];
      saveOrder(ids); renderRows(); notify('Ordem de prioridade salva.');
      [...document.querySelectorAll('[data-action="reorder"]')].find(item => item.dataset.id === id && item.dataset.direction === control.dataset.direction && !item.disabled)?.focus();
    }
  } else if (action.startsWith('calendar-')) {
    if (action === 'calendar-prev') { calendarMonth = addMonths(calendarMonth, -1); selectedDay = dayKey(calendarMonth); }
    if (action === 'calendar-next') { calendarMonth = addMonths(calendarMonth, 1); selectedDay = dayKey(calendarMonth); }
    if (action === 'calendar-today') { calendarMonth = startOfMonth(new Date()); selectedDay = dayKey(new Date()); }
    if (action === 'calendar-day') selectedDay = control.dataset.day;
    renderCalendar();
    if (action === 'calendar-day') document.querySelector(`[data-day="${selectedDay}"]`)?.focus();
    else document.querySelector(`[data-action="${action}"]`)?.focus();
  } else if (action === 'new') {
    showDialog('Nova atividade', `<form data-form="new"><div class="form-grid">${generalFields(newProject())}</div>
      ${formError}<div class="form-actions"><button class="button primary" type="submit">Criar atividade</button></div></form>`);
  } else if (action === 'close') dialog.close();
  else if (action === 'filter') setFilter(control.dataset.filter);
  else if (action === 'copy' && project) await copyMessage(project);
  else if (action === 'backup') backupDialog();
  else if (action === 'export') {
    control.disabled = true;
    try {
      const data = await makeBackup(await activeRead(), activeBlob);
      download(new Blob([data], { type: 'application/json' }), 'entrega-tecnica-backup.json');
      notify('Backup exportado.');
    } finally { control.disabled = false; }
  } else if (action === 'member' && project) memberDialog(project, person);
  else if (action === 'delete' && project) {
    confirmDialog('Remover atividade', `Excluir “${project.title}” e seus anexos ${cloud ? 'da sua conta em todos os dispositivos' : 'deste navegador'}?`, 'delete', project);
  } else if (action === 'delete-member' && person) {
    confirmDialog('Remover integrante', `Remover o registro de “${person.name}” desta atividade?`, 'delete-member', project, person);
  } else if (action === 'file' && project?.artifacts[key]?.file) {
    const file = project.artifacts[key].file;
    control.disabled = true;
    try { download(await activeBlob(file), file.name); } finally { control.disabled = false; }
  } else if (action === 'remove-file' && project) {
    const slot = slots.find(([slot]) => slot === key);
    showDialog('Remover anexo', `<p>O arquivo anexado será removido desta atividade. O link do item continuará disponível.</p>
      <form data-form="remove-file" data-id="${project.id}" data-key="${slot[0]}">
      ${formError}<div class="form-actions">${button('close', 'Cancelar')}<button class="button danger" type="submit">Remover anexo</button></div></form>`);
  }
}

function setProjects(records) {
  projects = records.sort((a, b) => Number(Boolean(isExample(a))) - Number(Boolean(isExample(b))) || a.title.localeCompare(b.title, 'pt-BR'));
}

async function changeProject(id, callback) {
  const store = cloud;
  const changed = store ? await store.updateProject(id, callback, byId(id)?._cloudVersion) : await updateProject(db, id, callback);
  if (cloud !== store) return;
  setProjects([...projects.filter(project => project.id !== id), ...(changed ? [changed] : [])]);
}

function renderKeepingDrafts(savedForm) {
  const formKey = form => [form.dataset.form, form.dataset.key, form.dataset.stageKey].join('/');
  const drafts = Array.from(root.querySelectorAll('form')).filter(form => form !== savedForm).map(form => [
    formKey(form), Array.from(form.elements).filter(input => input.name &&
      (input.type === 'file' ? input.files.length : input.value !== input.defaultValue))
  ]);
  render();
  for (const [key, fields] of drafts) {
    const form = Array.from(root.querySelectorAll('form')).find(form => formKey(form) === key);
    for (const oldInput of fields) {
      const input = form?.elements.namedItem(oldInput.name);
      if (!input) continue;
      if (input.type === 'file') input.files = oldInput.files;
      else input.value = oldInput.value;
    }
  }
}

function checkedLink(value) {
  const normalized = safeLink(value);
  if (value && !normalized) throw new Error('Use um endereço válido que comece com https:// ou http://.');
  return normalized;
}

async function saveForm(form) {
  const { form: kind, id, key, stageKey, member: memberId } = form.dataset;
  const data = new FormData(form);
  const read = key => String(data.get(key) || '').trim();
  if (kind === 'signin' || kind === 'signup') {
    cloudClient ||= await getCloudClient();
    const credentials = { email: read('email'), password: String(data.get('password') || '') };
    const { data: result, error } = kind === 'signin' ? await cloudClient.auth.signInWithPassword(credentials) : await cloudClient.auth.signUp({ ...credentials, options: { emailRedirectTo: 'https://entrega-tecnica-gabriel.garabedi4n.chatgpt.site/' } });
    if (error) {
      const messages = { invalid_credentials: 'E-mail ou senha inválidos.', email_not_confirmed: 'Confirme o e-mail recebido antes de entrar.', weak_password: 'Escolha uma senha mais forte.', over_email_send_rate_limit: 'Aguarde antes de solicitar outro e-mail.', signup_disabled: 'Cadastro indisponível neste momento.' };
      throw new Error(messages[error.code] || error.message);
    }
    dialog.close();
    if (result.session) { await applySession(result.session); notify('Conta conectada.'); }
    else notify('Confira o e-mail de confirmação e depois volte para entrar.');
    return;
  }
  if (kind === 'migrate') {
    if (!cloud) throw new Error('Entre na conta para copiar.');
    const local = localOnlyProjects(await readProjects(db), await cloud.existingIds());
    if (local.length) await cloud.writeProjects(local);
    dialog.close(); setProjects(await cloud.readProjects()); render(true); notify(`${local.length} atividade(s) copiada(s) para a nuvem.`); return;
  }
  if (kind === 'new') {
    const project = newProject();
    for (const field of ['title','discipline','deadline']) project[field] = read(field);
    if (!project.title) throw new Error('Informe o título da atividade.');
    const [stored] = await activeWrite([project]);
    setProjects([...projects, stored]);
    monitored = project.id;
    filter = 'all';
    query = '';
    dialog.close();
    location.hash = activityLink(project, 'dados');
    notify('Atividade criada.');
    return;
  }
  if (kind === 'import') {
    const file = data.get('backup');
    if (!file?.size) throw new Error('Selecione um arquivo de backup.');
    let imported;
    try { imported = parseBackup(await file.text()); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof DOMException) throw new Error('O arquivo de backup está inválido.');
      throw error;
    }
    const stored = await activeWrite(imported);
    setProjects([...projects, ...stored]);
    if (imported.length) monitored = imported[0].id;
    dialog.close();
    renderKeepingDrafts(form);
    notify(imported.length === 1 ? 'Uma atividade importada.' : `${imported.length} atividades importadas.`);
    return;
  }
  await changeProject(id, project => {
    if (kind === 'details') {
      const changes = Object.fromEntries(fields.filter(key => data.has(key)).map(key => [key, read(key)]));
      if (!changes.title) throw new Error('Informe o título da atividade.');
      for (const [key] of links) changes[key] = checkedLink(changes[key]);
      Object.assign(project, changes);
      if (project.observedAuthor !== author && project.stages.author.state === 'done') {
        project.stages.author.state = 'pending';
      }
    } else if (kind === 'reason') {
      project.stages[stageKey].reason = read('reason');
    } else if (kind === 'member') {
      const member = Object.assign(emptyMember(), Object.fromEntries(memberFields.map(key => [key, read(key)])), { id: memberId || crypto.randomUUID() });
      if (!member.name) throw new Error('Informe o nome do integrante.');
      if (memberId) {
        const index = project.members.findIndex(item => item.id === memberId);
        if (index < 0) throw new Error('Registro do integrante indisponível.');
        project.members[index] = member;
      } else project.members.push(member);
    } else if (kind === 'delivery') {
      project.finalName = read('finalName');
      project.message = read('message');
    } else if (kind === 'artifact') {
      const link = checkedLink(read('link'));
      const chosen = data.get('file');
      let savedFile = project.artifacts[key]?.file;
      if (chosen?.name) {
        if (chosen.size > maxAttachmentSize) throw new Error('O anexo deve ter até 25 MB. Para arquivos maiores, use um link.');
        if (!chosen.size || !validFile(key, chosen.name)) throw new Error('Selecione um arquivo válido no formato indicado.');
        savedFile = { name: chosen.name, blob: chosen };
      }
      if (link || savedFile) project.artifacts[key] = { link, file: savedFile };
      else delete project.artifacts[key];
    } else if (kind === 'remove-file') {
      const link = project.artifacts[key]?.link;
      if (link) project.artifacts[key] = { link };
      else delete project.artifacts[key];
    } else if (kind === 'delete-member') {
      project.members = project.members.filter(member => member.id !== memberId);
    } else if (kind === 'delete') return null;
    return project;
  });
  if (dialog.open) dialog.close();
  if (kind === 'delete') location.hash = '#atividades';
  else renderKeepingDrafts(form);
  notify(kind === 'delete' ? 'Atividade removida.' : 'Alterações salvas.');
}

async function changeStage(select) {
  const { id, stage, state: previous } = select.dataset;
  const next = select.value;
  select.disabled = true;
  busy++;
  try {
    await changeProject(id, project => {
      if (stage === 'author' && next === 'done' && project.observedAuthor !== author) {
        throw new Error(`Em Dados da atividade, registre o nome exibido exatamente como ${author} antes de concluir a conferência.`);
      }
      project.stages[stage].state = next;
      return project;
    });
    if (select.isConnected) {
      renderKeepingDrafts();
      const updated = root.querySelector(`[data-stage="${stage}"]`);
      updated?.focus({ preventScroll: true });
      animateStatus(updated);
    }
    notify('Etapa atualizada.');
  } catch (error) {
    select.value = previous;
    notify(error.message || 'Não foi possível atualizar a etapa.');
  } finally { select.disabled = false; busy--; if (cloud) requestRefresh(); }
}

try {
  db = await openDatabase();
  setProjects(await readProjects(db));
  render(true);
  paintAccount();
  getCloudClient().then(async client => {
    cloudClient = client;
    const { data, error } = await client.auth.getSession();
    if (!error && data.session) await applySession(data.session);
    client.auth.onAuthStateChange((event, session) => { setTimeout(() => { if (event !== 'INITIAL_SESSION') applySession(session).catch(console.error); }, 0); });
  }).catch(() => { syncStatus('Modo local · nuvem indisponível'); });
  setInterval(() => { if (cloud && document.visibilityState === 'visible') requestRefresh(); }, 30000);
  window.addEventListener('online', requestRefresh);
  window.addEventListener('focus', () => { if (cloud) requestRefresh(); });
  dialog.addEventListener('close', () => { if (refreshPending) requestRefresh(); });
  new MutationObserver(() => { const area = document.querySelector('#insights'); if (area) mountCharts(area, projects).catch(console.error); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('hashchange', () => {
    render(true);
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  document.addEventListener('click', event => {
    const pressed = event.target.closest('.button, .metric, .nav a, .nav button, .tabbar a, .theme-toggle');
    if (pressed) animatePress(pressed);
    const control = event.target.closest('[data-action]');
    if (control) handleAction(control).catch(error => notify(error.message || 'Não foi possível concluir a operação.'));
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'search') {
      query = event.target.value;
      renderRows();
    }
  });
  document.addEventListener('change', event => {
    const input = event.target;
    if (input.id === 'filter') setFilter(input.value);
    if (input.id === 'monitor-project') {
      monitored = input.value;
      renderMonitor();
      reveal(document.querySelector('#monitor'));
    }
    if (input.matches('[data-stage]')) changeStage(input);
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.dataset.form) return;
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    if (button.disabled) return;
    button.disabled = true;
    error.textContent = '';
    busy++;
    try { await saveForm(form); }
    catch (problem) {
      error.textContent = problem?.name === 'QuotaExceededError'
        ? 'O armazenamento deste navegador está cheio. Tente associar o arquivo por link.'
        : problem?.message || 'Não foi possível salvar. Confira o armazenamento do navegador.';
    } finally { button.disabled = false; busy--; if (cloud) requestRefresh(); }
  });
} catch {
  root.innerHTML = '<div class="panel empty" role="alert">O armazenamento deste navegador está indisponível. Abra o site em uma janela com armazenamento local habilitado.</div>';
}
