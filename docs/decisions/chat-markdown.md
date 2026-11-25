# Decisões: Markdown na gaveta do roadmap

## DOR → SPEC — 2026-11-24

- Decisão: reaproveitar `ui/markdown.ts` em vez de biblioteca nova — já monta DOM só com `textContent`.
- Decisão: estilos próprios na página do roadmap em vez de importar `ui/styles.css`, que afetaria a página inteira.
- Risco aceito: links continuam como texto com o endereço na dica, como no terminal.
