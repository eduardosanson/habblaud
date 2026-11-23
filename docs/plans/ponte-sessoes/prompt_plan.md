# Prompt Plan: ponte de sessões

## Ordem de Implementação (TDD, um commit por passo)
1. [x] H3 testes → `server/roadmap/harness.ts`: mapa de harness→Provider, validação de `resume`, comando de retomada
   por lista fixa (CA01, CA02).
2. [x] H1 testes → proxy: allowlist de `participants`/`executions`; cliente `pipeline.ts` + tipos (CA06 parcial).
3. [x] H2 testes → `server/roadmap/router.ts`: `resolveTarget` puro, recebe participantes + agentes vivos (CA03–CA05).
4. [x] H4 testes → `POST /api/roadmap/converse` local, entrega via `server/messages`.
5. [x] H5 (lógica: bridge.ts e postConverse; falta ligar na gaveta, em H7) resposta pela transcrição da sessão.
6. [ ] H6 verificar reabertura por harness (spike); implementar só onde confirmado.
7. [ ] H7 gaveta usa o roteador; proxy fecha `/api/agent/*` (CA06).
8. [ ] H8 docs, CHANGELOG, i18n, E2E.

## Dependências
- H1 depende do `registro-S4` do pipeline (rota `participants`). Até lá, H1–H3 usam fixtures do contrato congelado.
- H6 depende de verificação por harness (hoje `server/spawn` só cria sessão nova de Claude Code, não retoma).

## Riscos
- Contrato mudar no pipeline: combinar antes; os testes usam fixtures do contrato congelado.
- `sessionId` de run confundido com sessão real: CA05 cobre.
- Reabertura não suportada em todos os harness: RF06 degrada com mensagem honesta.
