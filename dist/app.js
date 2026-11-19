import { author, emptyMember, fields, maxAttachmentSize, memberFields, newProject, professorMessage, safeLink, slots, stages, states, statusLabels, summary, validFile } from './model.js';
import { makeBackup, openDatabase, parseBackup, readProjects, updateProject, writeProjects } from './storage.js';

const root = document.querySelector('main');
const dialog = document.querySelector('dialog');
const notice = document.querySelector('#notice');
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });
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

const iconPaths = {
  layers: 'M2 8l10-5 10 5-10 5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  'chevron-right': 'M9 5l7 7-7 7',
  shield: 'M12 22s7-3 7-9V6l-7-3-7 3v7c0 6 7 9 7 9zm-3-10 2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  alert: 'M12 3l10 17H2L12 3zm0 6v4m0 3v.1',
  check: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-4 9 3 3 5-6',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm5 10 5 6',
  checklist: 'M3 6l2 2 3-4m3 2h10M3 12l2 2 3-4m3 2h10M3 18l2 2 3-4m3 2h10',
  send: 'M3 4l18 8-18 8 3-8-3-8zm3 8h15',
  team: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 19v-2c0-4 12-4 12 0v2M16 5a3 3 0 0 1 0 6m1 3c3 0 5 1 5 3v2',
  copy: 'M8 8h12v13H8zM4 16V3h12',
  close: 'M6 6l12 12M18 6 6 18',
  link: 'M10 13l4-4m-7 5-2 2a3 3 0 0 0 4 4l4-4m-2-8 4-4a3 3 0 0 1 4 4l-2 2'
};
{
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d');
  if (context) {
    context.scale(2, 2);
    context.lineWidth = 1.75;
    context.lineJoin = context.lineCap = 'round';
    const style = document.createElement('style');
    style.textContent = Object.entries(iconPaths).map(([name, path]) => {
      context.clearRect(0, 0, 24, 24);
      context.stroke(new Path2D(path));
      return `[data-icon="${name}"]{--mask:url("${canvas.toDataURL()}")}`;
    }).join('');
    document.head.append(style);
  }
}

let db;
let projects = [];
let filter = 'all';
let query = '';
let monitored = '';
let noticeTimeout;
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
const date = value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value && Number.isFinite(parsed.valueOf()) ? dateFormat.format(parsed).replaceAll(' de ', ' ').replace('.', '') : 'Sem prazo';
};
const external = (value, label, className = '') => {
  const url = safeLink(value);
  return url ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
};
const button = (name, label, appearance = 'secondary', glyph = '', extra = '') =>
  `<button type="button" class="button ${appearance}" data-action="${name}" ${extra}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
const list = items => items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
const progressBar = info => `<div class="progress-row"><progress value="${info.percent}" max="100" aria-label="Progresso das etapas"></progress><small>${info.done.length}/${info.total}</small></div>`;
const currentRoute = () => location.hash.slice(1).split('/');
const byId = id => projects.find(project => project.id === id);

function notify(message) {
  clearTimeout(noticeTimeout);
  notice.textContent = message;
  noticeTimeout = setTimeout(() => { notice.textContent = ''; }, 4200);
}

function renderRows() {
  const area = document.querySelector('#table-area');
  if (!area) return;
  const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const term = normalize(query.trim());
  const visible = projects.filter(project => {
    const info = summary(project);
    return (filter === 'all' || filter === info.status) &&
      (!term || normalize([project.title, project.discipline, project.branch].join(' ')).includes(term));
  });
  if (!visible.length) {
    area.innerHTML = `<div class="panel empty">${projects.length ? 'Nenhuma atividade corresponde à busca.' : 'Nenhuma atividade cadastrada. Use “Nova atividade” para começar.'}</div>`;
    return;
  }
  area.innerHTML = `<div class="panel table-wrap"><table>
    <thead><tr><th scope="col">Atividade</th><th scope="col">Status</th><th scope="col">Etapas</th><th scope="col">Prazo</th><th scope="col"><span class="visually-hidden">Detalhes</span></th></tr></thead>
    <tbody>${visible.map(project => {
      const info = summary(project);
      return `<tr>
        <td><div class="activity-cell"><span class="tile-icon">${icon('folder')}</span><div><a href="${activityLink(project)}">${esc(project.title)}</a>${sample(project)}<small>${text(project.discipline, 'Sem disciplina')}</small></div></div></td>
        <td>${statusBadge(info)}</td><td class="progress-cell">${progressBar(info)}</td>
        <td data-cell="deadline">${date(project.deadline)}</td>
        <td><a class="button secondary" href="${activityLink(project)}" aria-label="Abrir ${esc(project.title)}">Abrir</a></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
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
  <div class="metrics" aria-label="Totais por status">${metrics.map(([id, label, glyph, tone]) => `<button class="metric" type="button" data-action="filter" data-filter="${id}" aria-pressed="${filter === id}"><span class="tile-icon ${tone}">${icon(glyph)}</span><span><b>${counts[id]}</b><small>${label}</small></span></button>`).join('')}</div>`
  : `<div class="title-row"><div><h1>Atividades</h1><p>Abra um projeto para editar os dados e acompanhar a entrega.</p></div>${button('new', 'Nova atividade', 'primary', 'plus')}</div>`}
  <section aria-label="Lista de atividades">
    <div class="section-head">
      ${home ? '<h2>Atividades</h2>' : ''}
      <div class="toolbar">
        <label class="search">${icon('search')}<span class="visually-hidden">Pesquisar atividades</span><input id="search" type="search" placeholder="Buscar atividade" value="${esc(query)}"></label>
        <select id="filter" aria-label="Filtrar atividades por status">${Object.entries(statusLabels).map(([id, label]) => `<option value="${id}" ${filter === id ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </div>
    </div>
    <div id="table-area" aria-live="polite"></div>
  </section>
  ${home && projects.length ? `<section class="review" id="monitor"><div class="section-head"><h2>Visão consolidada</h2>
    <div class="toolbar"><select id="monitor-project" aria-label="Atividade da visão consolidada">${projects.map(project => `<option value="${project.id}" ${(byId(monitored) || projects[0]).id === project.id ? 'selected' : ''}>${esc(project.title)}${isExample(project) ? ' (exemplo)' : ''}</option>`).join('')}</select></div></div>
    <div class="review-grid"></div></section>` : ''}`;
  renderRows();
  renderMonitor();
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

function render() {
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
    return;
  }
  const info = summary(project);
  root.innerHTML = `<a class="back" href="#atividades">Voltar às atividades</a>
    <div class="title-row"><div><h1>${esc(project.title)} ${sample(project)}</h1>
    <div class="metadata">${project.discipline ? `<span>${esc(project.discipline)}</span>` : ''}<span class="icon-label">${icon('clock')}${date(project.deadline)}</span>${statusBadge(info)}</div></div>
    ${button('delete', isExample(project) ? 'Remover exemplo' : 'Excluir atividade', 'secondary', '', `data-id="${project.id}"`)}</div>
    <nav class="tabbar" aria-label="Seções da atividade">${Object.entries(tabs).map(([key, [label, glyph]]) => `<a href="${activityLink(project, key)}" ${tab === key ? 'aria-current="page"' : ''}>${icon(glyph)}${label}</a>`).join('')}</nav>
    ${({ etapas: detailStages, dados: detailData, equipe: detailTeam, envio: detailDelivery })[tab](project)}`;
}

function showDialog(title, content) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
    ${button('close', '', 'plain icon-button', 'close', 'aria-label="Fechar"')}</div>${content}`;
  if (!dialog.open) dialog.showModal();
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
  if (action === 'new') {
    showDialog('Nova atividade', `<form data-form="new"><div class="form-grid">${generalFields(newProject())}</div>
      ${formError}<div class="form-actions"><button class="button primary" type="submit">Criar atividade</button></div></form>`);
  } else if (action === 'close') dialog.close();
  else if (action === 'filter') setFilter(control.dataset.filter);
  else if (action === 'copy' && project) await copyMessage(project);
  else if (action === 'backup') backupDialog();
  else if (action === 'export') {
    control.disabled = true;
    try {
      const data = await makeBackup(await readProjects(db));
      download(new Blob([data], { type: 'application/json' }), 'entrega-tecnica-backup.json');
      notify('Backup exportado.');
    } finally { control.disabled = false; }
  } else if (action === 'member' && project) memberDialog(project, person);
  else if (action === 'delete' && project) {
    confirmDialog('Remover atividade', `Excluir “${project.title}” e seus anexos deste navegador?`, 'delete', project);
  } else if (action === 'delete-member' && person) {
    confirmDialog('Remover integrante', `Remover o registro de “${person.name}” desta atividade?`, 'delete-member', project, person);
  } else if (action === 'file' && project?.artifacts[key]?.file) {
    const { name, blob } = project.artifacts[key].file;
    download(blob, name);
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
  const changed = await updateProject(db, id, callback);
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
  if (kind === 'new') {
    const project = newProject();
    for (const field of ['title','discipline','deadline']) project[field] = read(field);
    if (!project.title) throw new Error('Informe o título da atividade.');
    await writeProjects(db, [project]);
    setProjects([...projects, project]);
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
    await writeProjects(db, imported);
    setProjects([...projects, ...imported]);
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
      root.querySelector(`[data-stage="${stage}"]`)?.focus({ preventScroll: true });
    }
    notify('Etapa atualizada.');
  } catch (error) {
    select.value = previous;
    notify(error.message || 'Não foi possível atualizar a etapa.');
  } finally { select.disabled = false; }
}

try {
  db = await openDatabase();
  setProjects(await readProjects(db));
  render();
  window.addEventListener('hashchange', () => {
    render();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.animate([{ opacity: .3, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 340, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    root.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  document.addEventListener('click', event => {
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
    try { await saveForm(form); }
    catch (problem) {
      error.textContent = problem?.name === 'QuotaExceededError'
        ? 'O armazenamento deste navegador está cheio. Tente associar o arquivo por link.'
        : problem?.message || 'Não foi possível salvar. Confira o armazenamento do navegador.';
    } finally { button.disabled = false; }
  });
} catch {
  root.innerHTML = '<div class="panel empty" role="alert">O armazenamento deste navegador está indisponível. Abra o site em uma janela com armazenamento local habilitado.</div>';
}
