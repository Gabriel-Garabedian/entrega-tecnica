import { icons, Fuse, Sortable, format, parseISO, isValid, differenceInCalendarDays, startOfMonth, startOfWeek, endOfMonth, endOfWeek, eachDayOfInterval, addMonths, isSameMonth, isSameDay, ptBR } from './vendor/workspace.mjs';
import { summary } from './model.js';

export function installIcons() {
  const style = document.createElement('style');
  style.textContent = Object.entries(icons).map(([name, nodes]) => {
    const children = nodes.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')}/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
    return `[data-icon="${name}"]{--mask:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  }).join('');
  document.head.append(style);
}

const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function searchProjects(projects, query) {
  const term = normalize(query).trim();
  if (!term) return projects;
  const rows = projects.map(project => ({ project, title: normalize(project.title), discipline: normalize(project.discipline), branch: normalize(project.branch), details: normalize([project.work, project.answers, project.pending, ...(project.members || []).map(m => m.name)].join(' ')) }));
  const exact = rows.filter(row => [row.title, row.discipline, row.branch, row.details].some(field => field.includes(term)));
  if (term.length < 3) return exact.map(row => row.project);
  const fuse = new Fuse(rows, { keys: [{ name: 'title', weight: 3 }, { name: 'discipline', weight: 2 }, 'branch', 'details'], threshold: .34, ignoreLocation: true });
  const results = [...exact, ...fuse.search(term).map(result => result.item)];
  return Array.from(new Map(results.map(row => [row.project.id, row.project])).values());
}

export function parseDeadline(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value ? parsed : null;
}
export function deadlineInfo(project, now = new Date()) {
  const date = parseDeadline(project.deadline);
  if (!date) return { label: 'Sem prazo', tone: 'none', days: null, date: null };
  const days = differenceInCalendarDays(date, now);
  if (summary(project).status === 'delivered') return { label: 'Entregue', tone: 'done', days, date };
  if (days < 0) return { label: `${Math.abs(days)} ${days === -1 ? 'dia' : 'dias'} de atraso`, tone: 'late', days, date };
  if (days === 0) return { label: 'Vence hoje', tone: 'urgent', days, date };
  if (days === 1) return { label: 'Vence amanhã', tone: 'urgent', days, date };
  return { label: `Faltam ${days} dias`, tone: days <= 7 ? 'soon' : 'normal', days, date };
}
export const displayDate = value => { const date = parseDeadline(value); return date ? format(date, "dd 'de' MMM", { locale: ptBR }) : 'Sem prazo'; };
export const monthLabel = date => format(date, 'MMMM yyyy', { locale: ptBR });
export const dayKey = date => format(date, 'yyyy-MM-dd');
export const calendarDays = date => eachDayOfInterval({ start: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(date), { weekStartsOn: 0 }) });
export { addMonths, isSameMonth, isSameDay, startOfMonth };

export function priorityOrder(items, order) {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return items.slice().sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.title.localeCompare(b.title, 'pt-BR'));
}
export function reorderColumn(order, ids) {
  const changed = new Set(ids);
  return [...ids, ...order.filter(id => !changed.has(id))];
}
let sortables = [];
export function destroyBoard() { for (const sortable of sortables) sortable.destroy(); sortables = []; }
export function mountBoard(root, callback) {
  destroyBoard();
  for (const list of root.querySelectorAll('[data-kanban-list]')) {
    sortables.push(Sortable.create(list, { draggable: '[data-card]', handle: '.drag-handle', animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, ghostClass: 'kanban-ghost', chosenClass: 'kanban-chosen', delayOnTouchOnly: true, delay: 120, onEnd() { callback([...list.querySelectorAll('[data-card]')].map(card => card.dataset.card)); } }));
  }
}

export function chartData(projects) {
  const counts = { doing: 0, blocked: 0, delivered: 0 };
  for (const project of projects) counts[summary(project).status]++;
  const progress = [...projects].sort((a,b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title, 'pt-BR')).slice(0, 6).map(project => ({ title: project.title, percent: summary(project).percent }));
  return { counts, progress };
}
let charts = [];
export function destroyCharts() { for (const chart of charts) chart.destroy(); charts = []; }
export async function mountCharts(container, projects) {
  destroyCharts();
  if (!container || !projects.length) return;
  const { Chart } = await import('./vendor/charts.mjs');
  if (!container.isConnected) return;
  destroyCharts();
  const { counts, progress } = chartData(projects);
  const root = getComputedStyle(document.documentElement);
  const color = name => root.getPropertyValue(name).trim();
  const animation = matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 650, easing: 'easeOutQuart' };
  const base = { responsive: true, maintainAspectRatio: false, animation, color: color('--muted'), plugins: { tooltip: { padding: 10 } } };
  const donut = container.querySelector('#status-chart');
  const bar = container.querySelector('#progress-chart');
  if (!donut || !bar) return;
  charts.push(new Chart(donut, { type: 'doughnut', data: { labels: ['Em andamento','Com bloqueios','Entregues'], datasets: [{ data: [counts.doing, counts.blocked, counts.delivered], backgroundColor: ['#8060e9','#e6a451','#39a77e'], borderWidth: 0, hoverOffset: 5 }] }, options: { ...base, cutout: '76%', layout: { padding: 8 } } }));
  charts.push(new Chart(bar, { type: 'bar', data: { labels: progress.map(item => item.title.length > 23 ? `${item.title.slice(0,22)}…` : item.title), datasets: [{ label: 'Progresso', data: progress.map(item => item.percent), backgroundColor: color('--violet'), borderRadius: 6, barThickness: 13 }] }, options: { ...base, indexAxis: 'y', scales: { x: { min: 0, max: 100, ticks: { color: color('--muted'), callback: value => `${value}%` }, grid: { color: color('--line') } }, y: { ticks: { color: color('--muted') }, grid: { display: false } } }, plugins: { tooltip: { callbacks: { title: items => progress[items[0].dataIndex].title, label: item => `${item.raw}% concluído` } } } } }));
}
