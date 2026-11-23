# Contrato — Roadmap no Hermes Pipeline, Habblaud como consumidor

> **Desatualizado na parte de conversa.** A seção 4 (API de conversa) e a seção 5 (agente dentro do pipeline) não valem
> mais: o pipeline passou a ser só registro e a conversa vai direto à sessão real do agente. Veja
> [`hermes-pipeline-registry-prompt.md`](hermes-pipeline-registry-prompt.md) e `docs/plans/ponte-sessoes/spec.md`.

Status: proposta para a implementação no projeto `hermes-pipeline`.
Princípio: o **Hermes Pipeline** é a fonte da verdade e o orquestrador. O **agente** é quem movimenta o
roadmap, sempre por ferramentas do pipeline. O **Habblaud** lê o roadmap e conversa com o agente; ele não
escreve estado do roadmap.

## 1. Papéis

| Quem | Responsabilidade |
|---|---|
| Hermes Pipeline | Persistência, regras, status, vínculos, peso/estimativa, classificação, calibração, orquestração, ferramentas do agente e eventos. |
| Agente | Recebe a conversa, decide, chama as ferramentas do pipeline e movimenta o roadmap. É o único ator que escreve. |
| Habblaud | Consome snapshot/eventos, renderiza visão geral/backlog/detalhe, filtra, troca de roadmap e conversa com o agente. Não gera IDs, não persiste e não chama ferramentas de escrita. |

Fluxo de uma ação:

```
pessoa -> Habblaud (mensagem) -> API de conversa -> agente
agente -> ferramenta roadmap.* -> pipeline valida/persiste -> revision++
pipeline -> evento de conversa (recibo) + evento de roadmap -> Habblaud atualiza a tela
```

## 2. Transporte e segurança

- HTTP/JSON local, preferencialmente em `127.0.0.1`; SSE para streams.
- `Authorization: Bearer <token>` em todas as rotas. Dois escopos:
  - Habblaud: `roadmap.read`, `agent.converse`.
  - Agente/ferramentas: `roadmap.read`, `roadmap.write`, `roadmap.complete`, `roadmap.estimate` (conforme a sessão).
- CORS liberado apenas para as origens locais do Habblaud (`http://localhost:4747`, `http://localhost:5173` em dev). Sem `*`.
- `schemaVersion: 1` em todas as respostas e eventos.
- `source: "hermes-pipeline"`.
- `revision`: inteiro monotônico por roadmap. Toda mutação incrementa. Snapshot, itens e eventos carregam a revisão.
- Sem segredos, prompts internos ou chain-of-thought nos eventos; recibos de ação carregam apenas o resumo.
- Limites: mensagens por sessão/minuto, ações por minuto e tamanho máximo de mensagem; responder `429` com `Retry-After`.

## 3. API de leitura para o Habblaud

### 3.1 `GET /api/roadmaps`

Resposta:

```json
{
  "schemaVersion": 1,
  "source": "hermes-pipeline",
  "revision": 42,
  "generatedAt": "2026-11-19T13:00:00Z",
  "roadmaps": [
    {
      "id": "praca",
      "title": "Praça compartilhada",
      "subtitle": "Roadmap do Habblaud World · ciclo 2026.4",
      "objective": "Abrir o escritório para visitas...",
      "status": "active",
      "currentPhaseId": "3",
      "phaseCount": 7,
      "counts": {
        "backlog": 14,
        "ready": 0,
        "in_progress": 2,
        "blocked": 2,
        "review": 0,
        "done": 20,
        "canceled": 0,
        "total": 38
      },
      "progress": { "done": 20, "total": 38, "percent": 53 },
      "milestone": {
        "id": "portas-abertas",
        "title": "Portas abertas",
        "date": "2026-11-28",
        "status": "at-risk"
      },
      "owner": { "id": "nina", "name": "Nina" },
      "updatedAt": "2026-11-19T12:58:00Z"
    }
  ]
}
```

### 3.2 `GET /api/roadmaps/:id`

Resposta `RoadmapSnapshot`:

```json
{
  "schemaVersion": 1,
  "source": "hermes-pipeline",
  "revision": 42,
  "generatedAt": "2026-11-19T13:00:00Z",
  "roadmap": {
    "id": "praca",
    "title": "Praça compartilhada",
    "subtitle": "Roadmap do Habblaud World · ciclo 2026.4",
    "objective": "Abrir o escritório para visitas...",
    "status": "active",
    "currentPhaseId": "3",
    "owner": { "id": "nina", "name": "Nina" },
    "createdAt": "2026-10-01T12:00:00Z",
    "updatedAt": "2026-11-19T12:58:00Z",
    "counts": {
      "backlog": 14,
      "ready": 0,
      "in_progress": 2,
      "blocked": 2,
      "review": 0,
      "done": 20,
      "canceled": 0,
      "total": 38
    },
    "progress": { "done": 20, "total": 38, "percent": 53 },
    "phases": [
      {
        "id": "3",
        "index": 3,
        "name": "Visitas e portas",
        "objective": "Abrir passagem entre escritórios...",
        "ownerId": "nina",
        "status": "active",
        "counts": {
          "backlog": 0,
          "ready": 0,
          "in_progress": 2,
          "blocked": 1,
          "review": 0,
          "done": 5,
          "canceled": 0,
          "total": 8
        },
        "progress": { "done": 5, "total": 8, "percent": 63 },
        "items": [
          {
            "id": "3.7",
            "key": "PRC-37",
            "roadmapId": "praca",
            "phaseId": "3",
            "parentId": "3",
            "index": 7,
            "title": "Visita duplicada ao reconectar",
            "type": "bug",
            "status": "done",
            "priority": "P1",
            "ownerId": "nina",
            "objective": "Impedir que a mesma visita apareça duas vezes...",
            "createdAt": "2026-11-19T08:00:00Z",
            "updatedAt": "2026-11-19T09:05:00Z",
            "steps": [
              { "id": "s1", "title": "Reproduzir a duplicação", "status": "done", "note": "..." }
            ],
            "criteria": [
              { "id": "c1", "text": "A visita aparece uma vez ao reconectar.", "done": true }
            ],
            "dependencies": [],
            "links": [
              { "type": "caused_by", "targetId": "3.3" },
              { "type": "relates_to", "targetId": "3.4" }
            ],
            "decisions": [
              { "id": "d1", "date": "2026-11-19", "text": "Deduplicar no servidor, não no cliente.", "by": "Nina" }
            ],
            "size": "S",
            "estimate": {
              "unit": "tokens",
              "p50": 52000,
              "p80": 88000,
              "confidence": "medium",
              "sample": 19,
              "basis": "Base: 19 bugs S; P50 52k tokens; P80 88k.",
              "humanDays": { "p50": 0.2, "p80": 0.5 }
            },
            "actual": { "tokens": 52000, "sessions": 1, "updatedAt": "2026-11-19T09:05:00Z" },
            "execution": { "provider": "claude", "sessionId": "8f3a", "agentId": "nina" },
            "blockReason": null,
            "unblock": [],
            "revision": 42
          }
        ]
      }
    ],
    "milestone": {
      "id": "portas-abertas",
      "phaseId": "3",
      "title": "Portas abertas",
      "date": "2026-11-28",
      "status": "at-risk",
      "summary": "Uma visita completa entre dois escritórios...",
      "criteria": [
        { "text": "Atravessar a porta e chegar na praça em menos de 1,5 s.", "done": true }
      ],
      "itemIds": ["3.4", "3.5", "3.6"]
    },
    "activity": [
      {
        "id": "a7",
        "at": "2026-11-19T09:05:00Z",
        "agentId": "nina",
        "kind": "done",
        "text": "corrigiu a duplicação de visita no 3.7",
        "itemId": "3.7"
      }
    ]
  }
}
```

Regras do snapshot:

- `phases` são os épicos. Cada fase tem `items` (histórias, tasks e bugs); não há um tipo `epic` em item.
- `links` são canônicos e de saída. O Habblaud deriva o lado inverso (`originou`, `corrigido por`, `bloqueado por`); o pipeline não duplica as duas direções.
- `dependencies` são o contexto de bloqueio, separado de `links`: `kind: "plan" | "phase" | "external"`, `targetId?`, `targetRoadmapId?`, `label`, `status`, `detail?`, `blocking?`. O pipeline calcula `status`/`label`/`blocking`; o cliente só exibe.
- `size` é `XS | S | M | L | XL`. `estimate` é uma faixa P50/P80 em **tokens** (`unit: "tokens"`); `humanDays` é leitura derivada opcional. `actual` é do pipeline/sessão; o Habblaud só exibe.
- `execution` conecta o item à sessão do agente que o está movendo.
- `status` do item: `backlog | ready | in_progress | blocked | review | done | canceled`.
- `progress`/`counts`: `total` exclui `canceled`; `done` conta `done`; `percent = round(done / total * 100)`. `backlog`, `ready`, `in_progress`, `blocked` e `review` entram no total, mas não como concluídos. O pipeline calcula; o Habblaud pode recalcular para conferir.
- `phase.status` é derivado: `active` se há `in_progress`/`review`/`ready`; `blocked` se há bloqueio e nenhum ativo; `done` se todos os não cancelados estão `done`; senão `future`.
- `revision` incrementa em toda mutação; `item.revision` é a revisão da última mudança do item.

### 3.3 `GET /api/roadmaps/:id/events`

SSE (`text/event-stream`), com `id` de evento = revisão.

Eventos:

```text
event: roadmap.changed
id: 43
data: {"schemaVersion":1,"source":"hermes-pipeline","roadmapId":"praca","revision":43,"changedItemIds":["3.7"],"reason":"roadmap.update_item","at":"2026-11-19T13:01:00Z"}

event: heartbeat
data: {"at":"2026-11-19T13:01:15Z"}

event: error
data: {"code":"pipeline_unavailable","message":"...","retryable":true}
```

- O cliente reconecta com `Last-Event-ID`. O pipeline reemite os eventos após essa revisão; se não conseguir, emite `roadmap.changed` com a revisão atual e o Habblaud refaz o snapshot.
- O pipeline não envia o snapshot completo em cada evento; o Habblaud refaz `GET /api/roadmaps/:id` quando recebe `roadmap.changed`.
- Heartbeat a cada 15 s. Sem writes do Habblaud.

## 4. API de conversa (Habblaud ↔ agente)

### 4.1 `GET /api/agent/sessions`

```json
{
  "schemaVersion": 1,
  "source": "hermes-pipeline",
  "sessions": [
    {
      "id": "sess-8f3a",
      "agentId": "nina",
      "displayName": "Nina",
      "harness": "claude-code",
      "model": "sonnet",
      "status": "active",
      "capabilities": ["roadmap.read", "roadmap.write", "roadmap.complete", "roadmap.estimate"],
      "roadmapIds": ["praca"],
      "currentItemId": "3.4",
      "lastSeen": "2026-11-19T13:00:00Z"
    }
  ]
}
```

- `harness`: `claude-code | codex | opencode | hermes | custom`.
- `capabilities` definem o que o agente pode fazer; o pipeline valida em cada ferramenta.
- O Habblaud usa `displayName`, `agentId`, `harness`, `status` e `roadmapIds` no seletor de sessão.

### 4.2 `GET /api/agent/sessions/:id/messages?limit=50`

Histórico em ordem cronológica, para o painel abrir com contexto:

```json
{
  "schemaVersion": 1,
  "source": "hermes-pipeline",
  "sessionId": "sess-8f3a",
  "messages": [
    { "id": "m1", "role": "agent", "text": "Estou no 3.4...", "at": "..." },
    { "id": "m2", "role": "user", "text": "Mova o 3.7 para concluído.", "at": "..." },
    { "id": "m3", "role": "agent", "text": "Vou mover.", "at": "..." }
  ],
  "actions": [
    {
      "id": "act_1",
      "action": "roadmap.update_item",
      "status": "applied",
      "target": { "roadmapId": "praca", "itemId": "3.7" },
      "summary": "3.7 movido para done",
      "revision": 43,
      "at": "..."
    }
  ]
}
```

### 4.3 `POST /api/agent/sessions/:id/messages`

```json
{
  "messageId": "0c4f7e1a-...",
  "text": "Mova o 3.7 para concluído.",
  "context": { "roadmapId": "praca", "itemId": "3.7" }
}
```

- `messageId` é gerado pelo Habblaud e serve de chave de idempotência; repetir a mesma mensagem não duplica.
- Resposta `202 Accepted`: `{ "accepted": true, "messageId": "...", "sessionId": "...", "receivedAt": "..." }`.
- O pipeline enfileira e o agente responde de forma assíncrona; o Habblaud acompanha pelos eventos.
- `context` é uma dica para o agente (roadmap, item, fase); não é uma ordem de escrita direta.
- Erros: `400` inválido, `404` sessão, `409` sessão ocupada/fechada, `422` contexto inválido, `429` limite, `503` pipeline indisponível.

### 4.4 `GET /api/agent/sessions/:id/events`

SSE com `Last-Event-ID`; `id` é a sequência da sessão.

```text
event: message
id: 101
data: {"schemaVersion":1,"source":"hermes-pipeline","sessionId":"sess-8f3a","message":{"id":"m3","role":"agent","text":"Vou mover o 3.7.","at":"..."}}

event: action
id: 102
data: {"schemaVersion":1,"source":"hermes-pipeline","sessionId":"sess-8f3a","action":{"id":"act_1","action":"roadmap.update_item","status":"started","target":{"roadmapId":"praca","itemId":"3.7"},"summary":"Movendo 3.7 para done","at":"..."}}

event: action
id: 103
data: {"schemaVersion":1,"source":"hermes-pipeline","sessionId":"sess-8f3a","action":{"id":"act_1","action":"roadmap.update_item","status":"applied","target":{"roadmapId":"praca","itemId":"3.7"},"summary":"3.7 movido para done","revision":43,"at":"..."}}

event: heartbeat
data: {"at":"..."}
```

- `message` carrega texto completo; streaming por delta é opcional (`message.delta`), mas o v1 pode usar mensagens completas.
- `action` é o recibo que o Habblaud mostra na conversa; ele não contém argumentos internos nem chain-of-thought, só `action`, `status`, `target`, `summary`, `revision` e `error?`.
- A ação `applied` deve ser correlacionada com o `roadmap.changed` da mesma revisão; o Habblaud pode atualizar a tela pelo evento do roadmap, não de forma otimista.
- `POST /api/agent/sessions/:id/cancel` (opcional) interrompe o turno atual; retorna `202` e um `action`/`message` de cancelamento.

## 5. Ferramentas do agente (interno do pipeline)

O agente nunca escreve no banco direto. Ele chama ferramentas com nomes e schema estáveis. Podem ser MCP,
CLI ou função interna; o importante é o contrato.

Toda mutação aceita:

```json
{
  "actionId": "uuid",
  "expectedRevision": 42
}
```

e responde:

```json
{
  "ok": true,
  "actionId": "uuid",
  "revision": 43,
  "action": "roadmap.update_item",
  "item": { "...": "item atualizado" },
  "summary": "3.7 movido para done"
}
```

ou `{ "ok": false, "code": "revision_conflict", "message": "...", "retryable": true }`.

Ferramentas mínimas:

| Ferramenta | Entrada | Regra |
|---|---|---|
| `roadmap_list` | — | Lista resumos. |
| `roadmap_get` | `roadmapId` | Snapshot ou item; leitura. |
| `roadmap_create_item` | `roadmapId`, `phaseId`, `parentId?`, `type`, `title`, `objective?`, `status?`, `ownerId?`, `size?`, `estimate?`, `criteria?`, `links?` | Cria item com ID estável; `parentId` é fase ou história. |
| `roadmap_update_item` | `roadmapId`, `itemId`, `patch` | Valida transição, campos e revisão. |
| `roadmap_move_item` | `roadmapId`, `itemId`, `phaseId`, `parentId?` | Sem ciclo de hierarquia. |
| `roadmap_link_items` | `roadmapId`, `fromId`, `type`, `toId`, `targetRoadmapId?`, `note?` | Sem auto-link, duplicata ou ciclo em `blocks`; `caused_by` aponta para item que originou; `fixes` aponta para bug. |
| `roadmap_unlink_items` | `roadmapId`, `fromId`, `type`, `toId` | Remove o vínculo canônico. |
| `roadmap_estimate_item` | `roadmapId`, `itemId` ou draft | Retorna peso e faixa P50/P80 em tokens; rubrica determinística e base histórica. |
| `roadmap_record_actual` | `roadmapId`, `itemId`, `tokens`, `sessions` | Atualiza o realizado; usado pelo runtime/orquestração. |
| `roadmap_link_execution` | `roadmapId`, `itemId`, `sessionId`, `agentId`, `provider` | Liga o item à sessão que o executa. |
| `roadmap_add_decision` | `roadmapId`, `itemId`, `text`, `by` | Registra decisão. |
| `roadmap_progress` | `roadmapId` | Retorna counts/progresso recalculados. |

Regras de status:

- `backlog -> ready -> in_progress -> review -> done`.
- `in_progress -> blocked` exige `blockReason` e uma dependência bloqueante; `blocked -> in_progress` remove/atualiza o motivo.
- `review -> in_progress` para ajustes; `review -> done` exige todos os critérios atendidos e a capability `roadmap.complete`.
- `canceled` exige motivo; sai do denominador. `canceled -> backlog` só com `roadmap.admin`.
- O agente com `roadmap.write` pode mover para `ready`, `in_progress`, `blocked`, `review`; `done`/`canceled`/`admin` dependem das capabilities.
- O pipeline calcula `counts`, `progress`, `phase.status` e `activity` após cada mutação; o cliente não envia esses campos.

Invariantes:

- IDs estáveis, únicos, nunca reutilizados. `revision` monotônica.
- Hierarquia sem ciclos: fase -> história -> task/bug (ou fase -> task/bug). `parentId` deve existir e aceitar o tipo.
- Vínculos sem auto-link, duplicata ou ciclo em `blocks`; `fixes` só aponta para `bug`; `caused_by` aponta para história/task/bug existente.
- `size` e `estimate` são normalizados pelo pipeline; o agente pode sugerir, mas o pipeline é a autoridade.
- `done` não pode ter critérios pendentes, salvo override auditado de `roadmap.admin`.
- Toda mutação grava auditoria: ator (sessão/agente), actionId, antes/depois, revisão, timestamp.
- Tool calls são idempotentes por `actionId`; mensagens por `messageId`.

## 6. Seed de integração

Para o Habblaud consumir sem adaptação, semear dois roadmaps fictícios:

- `praca` — “Praça compartilhada”, 7 fases, 38 itens (20 done, 2 in_progress, 2 blocked, 14 backlog), com o bug `3.7` (`caused_by 3.3`, `relates_to 3.4`) e a correção `3.8` (`fixes 3.7`), tamanhos/estimativas e marcos.
- `confianca` — “Confiança e privacidade”, 4 fases, 15 itens (5 done, 1 in_progress, 1 blocked, 8 backlog), com o bloqueio `2.3`.
- Duas sessões de agente: uma com `roadmap.read/write/complete/estimate` (Nina/Claude Code) e uma somente leitura para testar permissão.

Não usar dados reais de sessões nem credenciais no seed.

## 7. Erros e idempotência

Formato:

```json
{
  "error": {
    "code": "invalid_transition",
    "message": "in_progress -> done exige review",
    "details": { "from": "in_progress", "to": "done" },
    "retryable": false
  }
}
```

Códigos: `not_found`, `forbidden`, `validation_error`, `invalid_transition`, `revision_conflict`,
`duplicate_link`, `cycle`, `session_busy`, `rate_limited`, `pipeline_unavailable`.

- `409 revision_conflict`: o agente refaz `roadmap_get` e tenta de novo com a revisão atual.
- `429`: `Retry-After` em segundos.
- `503`: evento `error` com `retryable: true`; o Habblaud reconecta com backoff.
- Nenhum endpoint de escrita de roadmap é exposto ao token do Habblaud.

## 8. Critérios de aceite

- [ ] Lista, snapshot e SSE de roadmap com o schema acima e `revision`.
- [ ] SSE de conversa com mensagens, ações `started/applied/rejected`, erro e heartbeat; `Last-Event-ID` funciona.
- [ ] `POST` de mensagem idempotente por `messageId`; resposta 202; ação assíncrona.
- [ ] Ferramentas do agente com `actionId`/`expectedRevision`, permissões e auditoria.
- [ ] Bug/fix e vínculos canônicos; lado inverso derivável pelo consumidor.
- [ ] Progresso por item, `canceled` fora do denominador; peso/estimativa em tokens com P50/P80.
- [ ] Seed com os dois roadmaps e duas sessões.
- [ ] Testes de contrato, transições, permissões, idempotência, conflito de revisão, ciclos e SSE.
- [ ] Smoke: listar roadmaps, abrir snapshot, conectar SSE, enviar “Mova o 3.7 para concluído”, receber ação aplicada e ver o roadmap atualizar.
- [ ] Nenhuma rota de escrita de roadmap acessível ao token do Habblaud; nenhum chain-of-thought nos eventos.
