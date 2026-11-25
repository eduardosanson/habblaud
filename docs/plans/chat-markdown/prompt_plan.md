# Prompt Plan: Markdown na gaveta do roadmap

1. [ ] `client/src/roadmap/conversation.test.ts`: com um `document` mínimo falso (o Vitest roda em `node`), exportar
   `messageEl` e cobrir CA01 a CA03. Rodar e ver falhar.
2. [ ] `conversation.ts`: na mensagem do agente, anexar `renderMarkdown(message.text)` em um `div.ui-md`.
3. [ ] `roadmap/styles.css`: estilos `.rp-bubble .ui-md` (espaçamento, `white-space`, código, tabela, lista, citação).
4. [ ] CHANGELOG, `docs/decisions/chat-markdown.md`.
5. [ ] `npm test`, `npm run typecheck`, `npm run i18n:check`, `npm run build`; evidências e PR.

## Riscos
- `.rp-bubble` usa `white-space: pre-wrap`; o contêiner do Markdown precisa voltar a `normal` para não duplicar espaços.
- `server/world/uplink.test.ts` já falha na `main`; não faz parte desta correção.
