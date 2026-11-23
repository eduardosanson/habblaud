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
- **Conversa**: abra um plano e pergunte. O Habblaud descobre pelo registro do pipeline quem trabalhou no plano, entrega
  a pergunta na sessão desse agente e mostra o que ele responde depois (lido da conversa da própria sessão, pelo
  terminal do Habblaud). Quando o agente mover o roadmap, a página refaz o snapshot pelo evento do pipeline.

## Como a pergunta chega ao agente

`POST /api/roadmap/converse` (só local) com `{roadmapId, itemId, text}`:

1. Lê `participants` do item no pipeline; se o pipeline ainda não tem essa rota, usa o histórico de `executions`.
2. Escolhe a sessão por regra fixa, sem LLM (`server/roadmap/router.ts`): o participante que está vivo no escritório e
   aceita mensagem; senão o mais recente. A sessão vem de `resume` (pipeline novo) ou de `workerSessionId` + `provider`
   da execução. Id de run do pipeline e `workerSessionId` vazio nunca viram sessão.
3. Entrega pela fila de mensagens do escritório (`server/messages`), como se a pessoa tivesse digitado.
4. Respostas: `202` entregue; `409 session_closed` sessão fechada (`details.route.resumable` diz se há como reabrir);
   `404 no_session` ninguém registrado trabalhou no plano; `409 unavailable` a sessão não aceita mensagem agora.

O `argv` de retomada que o pipeline registra é só dado: o Habblaud nunca o executa (`server/roadmap/harness.ts` monta o
comando por lista fixa). Hoje só Claude Code (`claude --resume`) e Codex (`codex resume`) têm retomada verificada, e a
gaveta ainda não reabre sessão sozinha: ela avisa que a sessão está fechada.

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
> vai remover. Precisam ser reescritos para a ponte (pergunta por `/api/roadmap/converse` a uma sessão real). Não foram
> executados nesta mudança.

## Arquivos

- `client/src/roadmap/pipeline.ts` — cliente HTTP/SSE de `/api/roadmap`.
- `client/src/roadmap/live.ts` — tradução do snapshot para o modelo das telas.
- `client/src/roadmap/data.ts` — tipos e índices em memória.
- `client/src/roadmap/app.ts` — estado, carregamento, SSE e conversa.
- `client/src/roadmap/views.ts` — visão geral, fases, backlog e trabalho agora.
- `client/src/roadmap/conversation.ts` — gaveta de conversa e recibos.
- `server/roadmap/config.ts` / `proxy.ts` — configuração e proxy do pipeline.
