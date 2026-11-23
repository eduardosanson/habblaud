# Decisões: ponte de sessões

## DOR → SPEC — 2026-11-23

- Decisão: roteamento por regra fixa (participante com `resume` → agente vivo → mais recente do roadmap), sem LLM — pedido explícito de manter o pipeline e o roteamento sem LLM.
- Decisão: `resume.argv` do pipeline nunca é executado; o Habblaud monta o comando por harness a partir de `sessionId` + `workdir` validados — o registro é dado de outro processo.
- Decisão: a chave de sessão é `resume.sessionId`/`resume.harness`, não `execution.sessionId`/`provider` — hoje esses guardam id de run e nome de modelo/serviço.
- Risco aceito: H1–H3 avançam sobre fixtures do contrato congelado enquanto o pipeline ainda não implementou `participants` (S4).

## TDD → BUILD — 2026-11-23

- Decisão: POST só na rota de mensagens; as demais rotas do proxy respondem 405 — o teste de `participants` mostrou que qualquer rota permitida aceitava POST, inclusive as antigas.
- Decisão: o roteador aceita `workerSessionId` + `provider` de pipeline antigo (id real e provider já conhecido), sem `workdir` — dá para falar com quem está vivo, não para reabrir.
- Risco aceito: o envelope de `participants` é suposto (`{roadmapId, itemId, participants[]}`, espelhando `executions`) até o pipeline publicar o openapi.

## BUILD (H4) — 2026-11-23

- Decisão: `POST /api/roadmap/converse` vive dentro do handler do roadmap (herda porta local, token e allowlist) e só existe com as mensagens do escritório ligadas; sem sessão viva responde 409 `session_closed` em vez de inventar resposta.
- Decisão: o fallback "quem trabalhou no roadmap" existe no roteador, mas H4 só alimenta o nível do item — agregar por item exigiria varrer o snapshot; fica para quando o pipeline expuser uma rota do roadmap inteiro.
- Risco aceito: a entrega só confirma "entrou na fila da sessão"; a resposta do agente (H5) ainda não volta para a gaveta.
