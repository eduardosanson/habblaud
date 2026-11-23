# Prompt para o agente do Hermes Pipeline — pipeline como registro do roadmap

Este documento orienta a implementação **do lado do pipeline**. O lado do Habblaud é implementado neste repositório
e não faz parte do que você deve alterar. Ele substitui a seção "conversa com o agente" de
`hermes-pipeline-roadmap-contract.md`: o pipeline não conversa com ninguém.

## Princípio

O pipeline é **só o registro do roadmap**: itens, status, vínculos, estimativas, decisões, execuções, revisão e
auditoria. Ele **não** roda LLM (direta nem indiretamente), **não** hospeda sessões de agente, **não** enfileira
conversa e **não** decide qual agente responde.

Quem escolhe o agente, reabre a sessão e pergunta é o Habblaud, porque ele já enxerga as sessões reais desta máquina
(Claude Code, Codex, OpenCode, Antigravity, Hermes), com seus IDs. O agente que responde escreve no roadmap pelo MCP
do pipeline, com o token de agente e a própria sessão em `X-Agent-Session`.

```
pessoa -> Habblaud -> resolve item -> sessão/agente (via execuções do pipeline + sessões vivas)
Habblaud -> entrega a mensagem na sessão real (reabre se estiver fechada)
agente   -> MCP do pipeline (roadmap_*) -> valida, persiste, revision++, audita
Habblaud <- GET /api/roadmaps/:id + SSE roadmap.changed
```

## O que remover

- Rotas `GET /api/agent/sessions`, `GET|POST /api/agent/sessions/:id/messages`, `GET /api/agent/sessions/:id/events`
  e `POST .../cancel`, e o escopo `agent.converse` do token do Habblaud (ele passa a ter só `roadmap.read`).
- `PIPELINE_AGENT_CMD`, `scripts/roadmap-agent.py` (chama o `opencode`), `process --watch`, o runtime determinístico
  de `pipeline/roadmap_api/agent.py` e as tabelas de mensagens/recibos de conversa.
- A tabela `agent_sessions` como sessões fictícias (`sess-nina`, `sess-assistant`). Sessão deixa de ser entidade do
  pipeline: vira dado dentro da execução (abaixo).
- Atualizar `contract/openapi.yaml`, `docs/roadmap-api.md` e os testes junto com cada remoção.

## O que manter

- Roadmaps, snapshot (`GET /api/roadmaps`, `GET /api/roadmaps/:id`), SSE `roadmap.changed`, MCP (`POST /mcp`),
  `actionId`, `expectedRevision`, máquina de estados, vínculos canônicos e auditoria.
- Os tokens: `habblaud` (leitura), `agent` (escrita/conclusão/estimativa) e `admin`.

## O que o Habblaud precisa receber

O Habblaud precisa, para qualquer item, saber **quem trabalhou nele de verdade**. Isso é a `roadmap-execucoes`
(`features/roadmap-execucoes/spec.md`), que já está especificada. Priorize-a e ajuste:

1. **`item_executions` sem validação contra `agent_sessions`.** `roadmap_record_execution` e
   `roadmap_link_execution` aceitam `{provider, sessionId, agentId, model, cwd, startedAt, endedAt, outcome, summary}`.
   `sessionId` é o **ID real do harness** (UUID do Claude Code, thread do Codex, ID do OpenCode). Hoje a mutação
   falha se a sessão não existir em `agent_sessions`; passe a exigir apenas que `provider` e `sessionId` venham
   preenchidos e bem formados. O RF04 da spec generaliza para todas as `source`.
2. **`provider` com valores fechados e iguais aos do Habblaud:** `claude-code`, `codex`, `opencode`, `antigravity`,
   `hermes`. Valor desconhecido é `validation_error`.
3. **Snapshot por item:** `execution` (a mais recente) e `executionCount`, como na spec.
4. **Novo endpoint de leitura, `GET /api/roadmaps/:id/executions?limit=50`:** execuções recentes de todo o roadmap,
   da mais nova para a mais antiga, no mesmo formato de `GET .../items/:itemId/executions`. Ele serve para o
   fallback do Habblaud (último agente que tocou o roadmap).
5. **O pipeline não valida nem abre sessão.** Ele só guarda o que o agente ou o `roadmap-sync` informam. Se uma
   sessão não existir mais, quem descobre é o Habblaud.
6. **Quem escreve registra a própria execução.** O SOUL dos implementadores e o `roadmap-sync` chamam
   `roadmap_record_execution` com o `sessionId` do worker (a spec já prevê `worker_session_id`). Nada de
   `sess-assistant` nem backfill fictício; o RF07 limpa o que não tem lastro.

## Contrato mínimo que o Habblaud consome

| Rota | Escopo | Uso no Habblaud |
|---|---|---|
| `GET /api/roadmaps` | `roadmap.read` | portfólio |
| `GET /api/roadmaps/:id` | `roadmap.read` | snapshot, com `execution` e `executionCount` por item |
| `GET /api/roadmaps/:id/events` | `roadmap.read` | SSE `roadmap.changed` |
| `GET /api/roadmaps/:id/items/:itemId/executions` | `roadmap.read` | quem trabalhou no item |
| `GET /api/roadmaps/:id/executions?limit=` | `roadmap.read` | quem trabalhou no roadmap |
| `POST /mcp` | token do agente | escrita feita pelo agente que responde |

Nada mais. O Habblaud não chama nenhuma rota de mutação.

## Como trabalhar

Siga o fluxo do `CLAUDE.md` do pipeline: DOR, spec, prompt plan, decisões em `docs/decisions/` e TDD. Salve o
planejamento em `features/<slug>/spec.md` e `features/<slug>/prompt_plan.md` (sugestão de slug:
`roadmap-registro-puro`) e **avise o dono**, para o lado do Habblaud ser alinhado ao que você planejou antes de
implementar. Sugestão de ordem: (1) `roadmap-execucoes` com os ajustes acima, (2) endpoint de execuções do roadmap,
(3) remoção da conversa e do runtime, (4) contrato e docs.

## Fora de escopo do pipeline

- Escolher o agente que responde, reabrir sessão, entregar mensagem, ler resposta de agente: tudo isso é do Habblaud.
- Qualquer alteração no repositório do Habblaud.
