# Entrega Técnica

Painel pessoal para organizar entregas acadêmicas e técnicas, acompanhar testes e preparar o envio via GitHub e Moodle.

## Usar localmente

O aplicativo é estático, sem dependências externas. Com Node.js 22+ ou Python instalado, execute os testes ou sirva os arquivos:

```bash
node --test tests/*.test.mjs
python -m http.server 8080 --directory dist
```

Acesse `http://localhost:8080`. Não abra o HTML diretamente pelo sistema de arquivos, pois os módulos JavaScript precisam de um servidor HTTP.

## Recursos

- Cadastro, edição, busca e acompanhamento de atividades por etapas.
- Registro de equipe, comandos, testes, resultados e anexos de até 25 MB.
- Mensagem de entrega gerada a partir dos dados informados.
- Tema claro e escuro, preferência persistida e suporte a movimento reduzido.
- Backup JSON com anexos e importação de atividades.

## Dados e privacidade

Os projetos e anexos são salvos no IndexedDB do navegador. Não existe sincronização entre dispositivos nem envio automático ao GitHub ou Moodle. Exporte backups regularmente; não publique backups contendo dados pessoais ou arquivos de atividades no repositório.

Para hospedagem estática, publique o conteúdo de `dist/` em um servidor HTTPS.
