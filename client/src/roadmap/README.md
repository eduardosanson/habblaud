# Roadmap do Habblaud

Página `/roadmap`: leitura dos roadmaps do **Hermes Pipeline** e conversa com o agente que trabalhou em cada plano. O
Habblaud não cria, edita, move, estima nem arquiva nada; ele lê snapshots/SSE e entrega perguntas à sessão real do
agente. O pipeline só registra: não roda LLM nem hospeda conversa.

## Como abrir

No servidor do Habblaud, configure o pipeline e reinicie:

```sh
HABBLAUD_ROADMAP_TOKEN=... npm run dev
# http://localhost:4747/roadmap — ou o botão Roadmap na barra do escritório
```

- `HABBLAUD_ROADMAP_URL` aponta para o Hermes Pipeline (padrão `http://127.0.0.1:49500`).
- `HABBLAUD_ROADMAP_TOKEN` é o token do Habblaud no pipeline (só `roadmap.read`; a conversa não passa pelo pipeline). O
  `PIPELINE_HABBLAUD_TOKEN` também é aceito como conveniência.
- `HABBLAUD_ROADMAP_IDS=atlas-ondas` restringe a página aos roadmaps reais; sem a variável, todos os roadmaps do
  pipeline aparecem.
- Sem token, o recurso fica desligado, o botão da barra não aparece e `/roadmap` explica o que falta.
- O token fica só no servidor: o navegador fala com `/api/roadmap/*` na mesma origem.
- A página é local, como o terminal e o World: pela porta do celular, nem com login.

## O que a página mostra

- **Fonte e revisão**: selo `Pipeline · revisão N`, atualizado por SSE; o rodapé repete que a visão é somente leitura.
- **Portfólio**: o primeiro roadmap devolvido pelo pipeline é o padrão (hoje o Atlas Store). `HABBLAUD_ROADMAP_IDS`
  pode restringir a lista aos roadmaps reais; sem a variável, o índice mostra tudo o que o pipeline devolve.
- **Visão geral**: objetivo, progresso por itens concluídos/total, fase atual, sessões que acompanham o roadmap,
  bloqueios ativos, marco e atividade recente.
- **Fases e detalhe**: lista expansível, filtro por status, busca escopada, faixa “Agora” e detalhe do item.
- **Backlog**: épicos (fases), histórias, tasks e bugs com tipo, status, peso XS–XL, estimativa P50/P80 em tokens,
  dias humanos derivados, realizado, execução e vínculos canônicos com o lado inverso derivado.
- **Trabalho agora**: foco, faixas de em andamento/bloqueado/a seguir, caminho do bloqueio e o que o marco espera.
- **Conversa**: abra um plano e pergunte. O Habblaud descobre pelo registro do pipeline quem trabalhou no plano e lista
  essas sessões num seletor (vivas primeiro, a sugerida já escolhida; você pode trocar). Entrega a pergunta na sessão
  escolhida e mostra o que ela responde depois (lido da conversa da própria sessão, pelo terminal do Habblaud). Quando o agente mover o roadmap, a página refaz o snapshot pelo evento do pipeline.

## Como a pergunta chega ao agente

O pipeline só registra execuções (`workerSessionId` + `provider` + `cwd`). O Habblaud monta a lista de sessões a partir
delas (`GET /api/roadmaps/:id/items/:itemId/executions` e, sem nenhuma no item, `GET /api/roadmaps/:id/executions`) e
cruza com os agentes vivos do escritório. Duas rotas locais, ambas só pelo próprio computador:

- `GET /api/roadmap/sessions?roadmapId=&itemId=` devolve `{options, suggested}`: cada opção traz `provider`, `sessionId`,
  `live`, `agentId` (se viva), `profile`, `model`, `lastAt` e `scope` (`item` ou `roadmap`). Uma sessão aparece uma vez
  (a execução mais recente) e execução sem `workerSessionId` não vira sessão. O `cwd` nunca sai do servidor.
- `POST /api/roadmap/converse` com `{roadmapId, itemId, text, session?}`. Sem `session`, vale a sugerida. Com ela, só
  vale uma sessão que o servidor listou (`400 unknown_session` fora disso).

Como o roteador escolhe (`server/roadmap/router.ts`), por regra fixa e sem LLM: a sessão viva e acessível primeiro, depois
a mais recente; no item e, se ele não tem ninguém, no roadmap. O `provider` do pipeline (`claude-code`, `codex`, `opencode`,
`antigravity`, `hermes`) vira o do Habblaud (`claude-code` → `claude`), e agente sem `provider` no escritório é Claude Code.

A entrega vai pela fila de mensagens do escritório (`server/messages`), como se a pessoa tivesse digitado. Respostas:
`202` entregue; `409 session_closed` sessão fechada ou sem o plugin de mensagens conectado; `404 no_session` ninguém
registrou sessão; `409 unavailable` a sessão não aceita mensagem agora; erro do pipeline (por exemplo `401`) é repassado.

O Habblaud nunca executa comando vindo do pipeline. A gaveta mostra sessão fechada na lista, mas não envia para ela e
explica o motivo: reabrir sessão fechada fica para depois (só Claude Code e Codex têm retomada verificada em
`server/roadmap/harness.ts`).

## Fronteira

- **Hermes Pipeline**: dono de roadmaps, itens, status, vínculos, peso, estimativa e persistência; registra quem
  executou cada item. Não roda LLM.
- **Agente** (sessão real no escritório): responde e, se tiver a ferramenta, move o roadmap pelo MCP do pipeline.
- **Habblaud**: proxy somente leitura, roteamento da pergunta, renderização, filtros e troca de roadmap. Nenhuma
  ferramenta de mutação é exposta ao navegador.

O contrato completo está em
[`docs/integration/hermes-pipeline-roadmap-contract.md`](../../../docs/integration/hermes-pipeline-roadmap-contract.md)
e o prompt de implementação em
[`docs/integration/hermes-pipeline-prompt.md`](../../../docs/integration/hermes-pipeline-prompt.md).

## Testes

```sh
# contrato de dados e vínculos (sem rede)
npx vitest run client/src/roadmap/data.test.ts

# proxies, configuração e permissões do servidor
npx vitest run server/roadmap/config.test.ts server/roadmap/proxy.test.ts

# ponte de sessões: harness, roteador, /converse e leitura da resposta (sem rede)
npx vitest run server/roadmap/harness.test.ts server/roadmap/router.test.ts server/roadmap/converse.test.ts \
  client/src/roadmap/bridge.test.ts client/src/roadmap/pipeline.test.ts

# contrato direto do pipeline (usa os roadmaps de seed do pipeline)
PIPELINE_HABBLAUD_TOKEN=... npx tsx scripts/roadmap-pipeline-smoke.ts

# E2E real: cópia descartável do banco, sem roadmaps/sessões de seed, com uma sessão
# vinculada ao Atlas; sobe pipeline + Habblaud, conversa, move um item e confere o snapshot
PIPELINE_REPO=... npm run build
PIPELINE_REPO=... node scripts/roadmap-e2e.mjs
```

O E2E usa o servidor de produção do Habblaud e o proxy real, sem token no navegador. Ele confirma que a página não
mostra roadmaps/sessões de seed, que a conversa só usa sessão vinculada ao roadmap e que uma ação do agente atualiza o
snapshot.

> **Pendente:** `scripts/roadmap-e2e.mjs` e `scripts/roadmap-pipeline-smoke.ts` ainda exercitam a conversa antiga, com o
> agente dentro do pipeline (`/api/agent/sessions/:id/messages`), que o proxy do Habblaud já não repassa e que o pipeline
> já removeu. Precisam ser reescritos para a ponte (pergunta por `/api/roadmap/converse` a uma sessão real). Não foram
> executados nesta mudança.

## Arquivos

- `client/src/roadmap/pipeline.ts` — cliente HTTP/SSE de `/api/roadmap`.
- `client/src/roadmap/live.ts` — tradução do snapshot para o modelo das telas.
- `client/src/roadmap/data.ts` — tipos e índices em memória.
- `client/src/roadmap/app.ts` — estado, carregamento, SSE e conversa.
- `client/src/roadmap/views.ts` — visão geral, fases, backlog e trabalho agora.
- `client/src/roadmap/conversation.ts` — gaveta de conversa e recibos.
- `server/roadmap/config.ts` / `proxy.ts` — configuração e proxy do pipeline.
