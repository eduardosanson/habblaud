# Decisões: Markdown na gaveta do roadmap

## DOR → SPEC — 2026-11-24

- Decisão: reaproveitar `ui/markdown.ts` em vez de biblioteca nova — já monta DOM só com `textContent`.
- Decisão: estilos próprios na página do roadmap em vez de importar `ui/styles.css`, que afetaria a página inteira.
- Risco aceito: links continuam como texto com o endereço na dica, como no terminal.

## TDD → BUILD — 2026-11-24

- Decisão: testar `messageEl` com um `document` mínimo falso em vez de adicionar jsdom — o Vitest do projeto roda em `node`.
- Risco aceito: a aparência não tem teste automatizado; depende da validação manual na gaveta.
