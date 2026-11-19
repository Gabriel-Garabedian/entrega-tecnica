export const author = 'Gabriel-Garabedian';
export const states = {
  pending: 'Pendente', doing: 'Em andamento', done: 'Concluída',
  blocked: 'Bloqueada', na: 'Não se aplica'
};
export const stages = [
  ['structure', 'Estrutura dos arquivos', 'Confira diretórios, nomes e arquivos exigidos.'],
  ['author', 'Autoria exibida', 'Compare o nome mostrado no GitHub e no relatório com o autor esperado.'],
  ['credits', 'Contribuições e créditos', 'Confira se os créditos correspondem às contribuições reais.'],
  ['tests', 'Testes por integrante', 'Registre os comandos e resultados de quem executou os testes.'],
  ['docs', 'Documentação', 'Revise o README e indique onde estão as respostas.'],
  ['evidence', 'Evidências', 'Associe logs, resultados ou outros registros.'],
  ['prints', 'Prints', 'Identifique as capturas de tela que comprovam os resultados.'],
  ['report', 'Relatório em PDF', 'Revise e associe a versão final do relatório.'],
  ['zip', 'Compactação em ZIP', 'Verifique o conteúdo do ZIP e o nome do arquivo final.'],
  ['github', 'Entrega no GitHub', 'Confira a branch, o pull request e os links da entrega.'],
  ['moodle', 'Envio final no Moodle', 'Registre o envio depois de confirmar a entrega no Moodle.']
];
export const slots = [
  ['zip', 'Arquivo ZIP', 'Pacote final da atividade', '.zip,application/zip'],
  ['report', 'Relatório em PDF', 'Versão final do relatório', '.pdf,application/pdf'],
  ['evidence', 'Evidências', 'Logs, resultados ou outros registros', ''],
  ['prints', 'Prints', 'Capturas dos testes e resultados', 'image/*']
];
export const fields = ['title','discipline','deadline','original','fork','github','branch','pr','moodle','observedAuthor','work','answers','pending','teacher','finalName','message'];
export const memberFields = ['name','role','commands','tests','results','pending'];
export const emptyMember = () => Object.fromEntries(memberFields.map(key => [key, '']));
export const statusLabels = { all: 'Todas', doing: 'Em andamento', blocked: 'Com bloqueios', delivered: 'Entregues' };
export const maxAttachmentSize = 25 * 1024 * 1024;

export function newProject(id = crypto.randomUUID()) {
  return {
    id, ...Object.fromEntries(fields.map(key => [key, ''])),
    stages: Object.fromEntries(stages.map(([id]) => [id, { state: 'pending', reason: '' }])),
    members: [], artifacts: {}
  };
}

export function exampleProject() {
  const project = {
    ...newProject('exemplo'), example: true, title: 'API de catálogo', discipline: 'Desenvolvimento Web',
    branch: 'atividade/catalogo', observedAuthor: author, pending: 'Anexar o relatório e conferir o ZIP final.',
    work: 'Implementação das rotas de listagem e consulta do catálogo.',
    answers: 'README.md, na seção «Respostas da atividade».',
    members: [{ ...emptyMember(), id: 'exemplo-integrante', name: 'Integrante de exemplo', role: 'Rotas de catálogo',
      commands: 'npm test', tests: 'Listagem e consulta por identificador.',
      results: 'As duas verificações passaram.' }]
  };
  for (const id of ['structure','author','credits','tests','docs']) project.stages[id].state = 'done';
  project.stages.evidence.state = 'doing';
  return project;
}

export function summary(project) {
  const entries = stages.map(([id, title]) => ({ title, ...project.stages[id] }));
  const applicable = entries.filter(row => row.state !== 'na');
  const done = applicable.filter(row => row.state === 'done');
  const blocked = applicable.filter(row => row.state === 'blocked');
  const missing = slots.filter(([id]) => project.stages[id].state !== 'na' &&
    !project.artifacts[id]?.link && !project.artifacts[id]?.file).map(([, title]) => title);
  const submissions = ['github','moodle'].map(id => project.stages[id].state).filter(state => state !== 'na');
  const delivered = submissions.length > 0 && submissions.every(state => state === 'done');
  return {
    done, blocked, missing, total: applicable.length,
    percent: applicable.length ? Math.round(100 * done.length / applicable.length) : 0,
    status: blocked.length ? 'blocked' : delivered ? 'delivered' : 'doing'
  };
}

export function safeLink(input) {
  try {
    const url = new URL(input);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function validFile(key, name) {
  if (key === 'report') return /\.pdf$/i.test(name);
  if (key === 'zip') return /\.zip$/i.test(name);
  return key !== 'prints' || /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i.test(name);
}

export function professorMessage(project) {
  const lines = [`Olá, professor(a)!\n\nSegue o resumo da atividade “${project.title}”${project.discipline ? ` (${project.discipline})` : ''}.`];
  if (project.message) lines.push(project.message);
  if (project.work) lines.push(`O que foi feito\n${project.work}`);
  const tests = project.members.filter(member => member.tests || member.results || member.commands);
  if (tests.length) {
    lines.push('Testes registrados\n' + tests.map(member => [
      member.name + (member.role ? ` (${member.role})` : ''),
      member.commands && `Comandos: ${member.commands}`,
      member.tests && `Testes: ${member.tests}`,
      member.results && `Resultados: ${member.results}`
    ].filter(Boolean).join('\n')).join('\n\n'));
  }
  if (project.answers) lines.push(`Onde estão as respostas\n${project.answers}`);
  const links = [
    ['GitHub', project.github || project.fork], ['Branch', project.branch], ['Pull request', project.pr],
    ['Arquivo final', project.finalName || project.artifacts.zip?.file?.name],
    ...slots.map(([id, label]) => [label, project.artifacts[id]?.link || (id !== 'zip' && project.artifacts[id]?.file?.name)])
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  if (links.length) lines.push(links.join('\n'));
  return lines.join('\n\n');
}
