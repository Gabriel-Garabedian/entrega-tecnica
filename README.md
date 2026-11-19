# Entrega Técnica

Painel pessoal para organizar entregas acadêmicas e técnicas, acompanhar testes e preparar o envio via GitHub e Moodle.

## Usar localmente

O aplicativo é estático, sem precisar instalar dependências para executá-lo. Com Node.js 22+ ou Python instalado, execute os testes ou sirva os arquivos:

```bash
node --test tests/*.test.mjs
python -m http.server 8080 --directory dist
```

Acesse `http://localhost:8080`. Não abra o HTML diretamente pelo sistema de arquivos, pois os módulos JavaScript precisam de um servidor HTTP.

## Recursos

- Cadastro, edição, busca e acompanhamento de atividades por etapas.
- Registro de equipe, comandos, testes, resultados e anexos de até 25 MB.
- Mensagem de entrega gerada a partir dos dados informados.
- Tema claro e escuro com transição radial, preferência persistida e suporte a movimento reduzido.
- Motion (animações com efeito de mola, contadores, barras de progresso, entrada escalonada e feedback de interações), inspirado em React Bits, sem dependência de React.
- Lucide, Chart.js, date-fns, SortableJS e Fuse.js: ícones, gráficos, calendário e alertas de prazo, Kanban com prioridade reorganizável e busca tolerante a erros.
- O status do Kanban é calculado pelas etapas reais; arrastar reorganiza a prioridade dentro da coluna. A ordem e a visualização são preferências locais deste navegador.
- Backup JSON com anexos e importação de atividades.

## Dados e privacidade

Os projetos e anexos são salvos no IndexedDB do navegador. Não existe sincronização entre dispositivos nem envio automático ao GitHub ou Moodle. Exporte backups regularmente; não publique backups contendo dados pessoais ou arquivos de atividades no repositório.

Para hospedagem estática, publique o conteúdo de `dist/` em um servidor HTTPS.

### Biblioteca de animações

O bundle ESM de Motion 14.14.0 é distribuído localmente em `dist/vendor/motion.mjs` (licença MIT inclusa), sem chamadas a CDNs. Para regenerá-lo, instale `motion@14.14.0` e `esbuild@0.25.12` e execute `npx esbuild scripts/motion-entry.mjs --bundle --format=esm --minify --outfile=dist/vendor/motion.mjs`.

### Bibliotecas do painel

Bundles ESM locais e licenças em `dist/vendor/`. Chart.js é carregado apenas quando há atividades reais para os gráficos. Para regenerar, instale `lucide@1.76.0 chart.js@4.6.1 date-fns@4.4.0 sortablejs@1.15.7 fuse.js@7.5.0 esbuild@0.25.12` e execute:

```bash
npx esbuild scripts/workspace-entry.mjs --bundle --format=esm --minify --outfile=dist/vendor/workspace.mjs
npx esbuild scripts/chart-entry.mjs --bundle --format=esm --minify --outfile=dist/vendor/charts.mjs
```
