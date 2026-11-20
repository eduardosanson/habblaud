# Prompt para o agente do `hermes-pipeline`

Cole o bloco abaixo no agente que vai implementar a camada no repositório `hermes-pipeline`. O contrato
detalhado está em `docs/integration/hermes-pipeline-roadmap-contract.md`; o prompt repete o essencial para
ser autossuficiente.

---

Você é o agente responsável por implementar o **gerenciamento de roadmap** no projeto `hermes-pipeline`.

## Contexto e fronteira

- O `hermes-pipeline` é a fonte da verdade e o orquestrador: persiste roadmaps, itens, status, vínculos,
  peso, estimativa, classificação, execução e auditoria.
- O **agente** é quem movimenta o roadmap. Ele recebe a conversa do Habblaud e chama ferramentas do
  pipeline; nunca escreve no banco direto.
- O **Habblaud** é somente consumidor: lê o roadmap por snapshot/SSE e conversa com o agente. Ele não
  escreve estado do roadmap e não chama ferramentas de mutação.
- Qualquer orquestração (fila, despacho, retry, concorrência, calibração) fica no `hermes-pipeline`.
- Não altere o projeto Habblaud. Implemente o contrato no `hermes-pipeline` e entregue o que o Habblaud
  precisa consumir.

## Antes de codar

1. Leia o README, a stack, o padrão de API, a persistência, os testes e o runtime de agentes que já existem
   no `hermes-pipeline`.
2. Proponha um plano curto, com os arquivos/entidades que serão criados e o que será reutilizado.
3. Se algo do contrato conflitar com a stack, adapte o transporte, mas preserve nomes, campos, semântica e
   invariantes. Não invente um segundo modelo de tarefa.
4. Implemente em fatias verificáveis: leitura + seed; ferramentas + mutações; conversa + SSE; testes e smoke.

## Contrato mínimo

### Leitura para o Habblaud

- `GET /api/roadmaps` — resumos.
- `GET /api/roadmaps/:id` — snapshot completo com `schemaVersion`, `source`, `revision`, `generatedAt` e
  `roadmap`.
- `GET /api/roadmaps/:id/events` — SSE com `roadmap.changed` (roadmapId, revision, changedItemIds, reason),
  `heartbeat` e `error`; `Last-Event-ID` para retomar.
- O Habblaud refaz o snapshot ao receber `roadmap.changed`; não envie o snapshot inteiro em cada evento.
- `Authorization: Bearer <token>`; o token do Habblaud tem apenas `roadmap.read` e `agent.converse`.

### Modelo

- `Roadmap`: id, title, subtitle, objective, status (`active|archived|draft`), currentPhaseId, owner,
  counts, progress, phases, milestone, activity, createdAt/updatedAt, revision.
- `Phase` = épico: id, index, name, objective, ownerId, status, counts, progress, items.
- `Item`: id, key, roadmapId, phaseId, parentId, index, title, type (`story|task|bug`), status
  (`backlog|ready|in_progress|blocked|review|done|canceled`), priority, ownerId, objective, steps,
  criteria, dependencies, links, decisions, size (`XS|S|M|L|XL`), estimate, actual, execution,
  blockReason, unblock, createdAt/updatedAt, revision.
- `links` são canônicos e de saída: `blocks|caused_by|fixes|relates_to|duplicates`, com `targetId` e
  `targetRoadmapId?`. O consumidor deriva o lado inverso; não duplique as duas direções.
- `dependencies` é o contexto de bloqueio: `kind: plan|phase|external`, `targetId?`,
  `targetRoadmapId?`, `label`, `status`, `detail?`, `blocking?`; o pipeline calcula.
- `estimate`: `unit:"tokens"`, `p50`, `p80`, `confidence`, `sample`, `basis`, `humanDays?`.
- `actual`: `tokens?`, `days?`, `sessions?`, `updatedAt`.
- `execution`: `provider`, `sessionId`, `agentId`.
- `progress`/`counts`: `total` exclui `canceled`; `done` conta `done`; `percent = round(done/total*100)`.
  `blocked`, `in_progress`, `review`, `ready` e `backlog` entram no total, mas não como concluídos.
- `revision` é inteiro monotônico por roadmap; toda mutação incrementa. IDs são estáveis e nunca
  reutilizados.

### Conversa com o agente

- `GET /api/agent/sessions` — sessões com id, agentId, displayName, harness
  (`claude-code|codex|opencode|hermes|custom`), model, status, capabilities, roadmapIds, currentItemId,
  lastSeen.
- `GET /api/agent/sessions/:id/messages?limit=50` — histórico de mensagens e recibos de ação.
- `POST /api/agent/sessions/:id/messages` — corpo
  `{ "messageId": "uuid", "text": "...", "context": { "roadmapId": "...", "itemId": "..." } }`.
  `messageId` é a chave de idempotência; resposta `202` com `accepted`, `messageId`, `sessionId` e
  `receivedAt`. O processamento é assíncrono.
- `GET /api/agent/sessions/:id/events` — SSE com `message`, `action`, `error` e `heartbeat`;
  `Last-Event-ID` para retomar.
- `action`: id, action, status (`started|applied|rejected`), target (`roadmapId`, `itemId?`), summary,
  revision, error?. Não inclua argumentos internos, prompts ou chain-of-thought; o recibo é um resumo.
- O Habblaud mostra a mensagem, o recibo e o roadmap atualizado. Não use UI otimista.

### Ferramentas do agente

Exponha como MCP, CLI ou funções internas, com nomes e schema estáveis. Toda mutação recebe
`actionId` (UUID) e `expectedRevision`; responde `ok`, `actionId`, `revision`, `action`, `summary` e
`item?`/`error?`. Idempotência por `actionId`.

Ferramentas mínimas:

`roadmap_list`, `roadmap_get`, `roadmap_create_item`, `roadmap_update_item`, `roadmap_move_item`,
`roadmap_link_items`, `roadmap_unlink_items`, `roadmap_estimate_item`, `roadmap_record_actual`,
`roadmap_link_execution`, `roadmap_add_decision`, `roadmap_progress`.

Regras:

- `backlog -> ready -> in_progress -> review -> done`; `in_progress -> blocked` exige motivo e dependência
  bloqueante; `blocked -> in_progress` limpa/atualiza o motivo.
- `done` exige todos os critérios atendidos e a capability `roadmap.complete`; `canceled` exige motivo e
  fica fora do denominador. `roadmap.write` cobre ready/in_progress/blocked/review; `done`, `canceled` e
  admin dependem de capabilities.
- `parentId` é fase ou história; sem ciclos. `fixes` aponta para bug; `caused_by` aponta para o item de
  origem; sem auto-link, duplicata ou ciclo em `blocks`.
- Toda mutação recalcula counts/progress/phase.status/activity e grava auditoria (ator, actionId,
  antes/depois, revisão, timestamp).
- O agente pode sugerir peso/estimativa, mas o pipeline normaliza e é a autoridade.
- O token do Habblaud não acessa nenhuma ferramenta de mutação.

### Erros

Formato `{ "error": { "code", "message", "details?", "retryable" } }` com `not_found`, `forbidden`,
`validation_error`, `invalid_transition`, `revision_conflict`, `duplicate_link`, `cycle`, `session_busy`,
`rate_limited`, `pipeline_unavailable`. `409` de revisão pede refetch e nova tentativa; `429` envia
`Retry-After`; `503` é retryable.

## Seed de integração

Crie um seed fictício com dois roadmaps:

- `praca` “Praça compartilhada”: 7 fases, 38 itens, 20 done, 2 in_progress, 2 blocked, 14 backlog; bug
  `3.7` (`caused_by 3.3`, `relates_to 3.4`) e correção `3.8` (`fixes 3.7`); tamanhos/estimativas; marco
  `portas-abertas`.
- `confianca` “Confiança e privacidade”: 4 fases, 15 itens, 5 done, 1 in_progress, 1 blocked, 8 backlog;
  bloqueio `2.3`.
- Duas sessões: uma com read/write/complete/estimate (Nina/Claude Code) e uma read-only, para testar
  permissão.

Sem dados reais, credenciais ou sessões reais no seed.

## Entregáveis

- Persistência e migrações/seed.
- API de leitura + SSE de roadmap.
- API de conversa + SSE, com histórico e ações.
- Ferramentas do agente com validação, auditoria, idempotência e revisão.
- Runtime/orquestração mínima para o agente responder e chamar ferramentas; reutilize o que já existe no
  projeto.
- Contrato em `contract/` (OpenAPI/JSON Schema + exemplos) e README com variáveis de ambiente, porta,
  token, CORS e como rodar.
- Testes de contrato, transições, permissões, idempotência, conflito de revisão, ciclos, SSE e
  `Last-Event-ID`.
- Smoke test: listar roadmaps, abrir snapshot, conectar SSE, enviar “Mova o 3.7 para concluído”, receber
  `action applied` e ver o roadmap atualizar.

## Critérios de aceite

- [ ] O Habblaud consegue listar, abrir e acompanhar os dois roadmaps sem escrever nada.
- [ ] O agente consegue mover o 3.7 para `done` por ferramenta; o pipeline valida, persiste, incrementa a
  revisão e emite `action applied` + `roadmap.changed`.
- [ ] O Habblaud recebe a mensagem, o recibo e o roadmap atualizado; nenhuma UI otimista.
- [ ] Bug/fix e vínculos aparecem nos dois lados quando o consumidor deriva o inverso.
- [ ] Progresso e estimativas batem com as regras; `canceled` fica fora do denominador.
- [ ] Permissões: sessão read-only não move; token do Habblaud não chama mutação.
- [ ] Testes e smoke passam; documentação de execução está pronta.

Comece inspecionando o repositório e respondendo com o plano de implementação. Se encontrar uma decisão
de arquitetura que o contrato não cobre, registre a suposição e siga com a opção mais simples que preserve
a fronteira: **pipeline escreve, agente move, Habblaud lê e conversa**.
