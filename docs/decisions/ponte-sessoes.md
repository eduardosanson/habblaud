# Decisões: ponte de sessões

## DOR → SPEC — 2026-11-23

- Decisão: roteamento por regra fixa (participante com `resume` → agente vivo → mais recente do roadmap), sem LLM — pedido explícito de manter o pipeline e o roteamento sem LLM.
- Decisão: `resume.argv` do pipeline nunca é executado; o Habblaud monta o comando por harness a partir de `sessionId` + `workdir` validados — o registro é dado de outro processo.
- Decisão: a chave de sessão é `resume.sessionId`/`resume.harness`, não `execution.sessionId`/`provider` — hoje esses guardam id de run e nome de modelo/serviço.
- Risco aceito: H1–H3 avançam sobre fixtures do contrato congelado enquanto o pipeline ainda não implementou `participants` (S4).
