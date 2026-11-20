# Roadmap do Habblaud

Página `/roadmap`: leitura dos roadmaps do **Hermes Pipeline** e conversa com o agente que os movimenta. O Habblaud
não cria, edita, move, estima nem arquiva nada; ele lê snapshots/SSE, mostra recibos de ação e envia mensagens.

## Como abrir

No servidor do Habblaud, configure o pipeline e reinicie:

```sh
HABBLAUD_ROADMAP_TOKEN=... npm run dev
# http://localhost:4747/roadmap — ou o botão Roadmap na barra do escritório
```

- `HABBLAUD_ROADMAP_URL` aponta para o Hermes Pipeline (padrão `http://127.0.0.1:49500`).
- `HABBLAUD_ROADMAP_TOKEN` é o token do Habblaud no pipeline (`roadmap.read` + `agent.converse`). O
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
- **Conversa**: sessões e permissões do pipeline, histórico real, comandos de exemplo, respostas do agente e recibos
  `applied`/`rejected` com a revisão resultante. Sem UI otimista: ao receber uma ação aplicada, a página refaz o snapshot.

## Sessões

A conversa só oferece sessões que declaram aquele roadmap em `roadmapIds`. Sem sessão vinculada, a página mostra
"Nenhuma sessão vinculada a este roadmap" e não cai na sessão de outro roadmap. O agente do pipeline continua sendo o
único escritor.

## Fronteira

- **Hermes Pipeline**: dono de roadmaps, itens, status, vínculos, peso, estimativa, orquestração e persistência.
- **Agente**: recebe a mensagem, chama as ferramentas do pipeline e é o único escritor.
- **Habblaud**: proxy de leitura/conversa no servidor, renderização, filtros, troca de roadmap e recibos. Nenhuma
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

## Arquivos

- `client/src/roadmap/pipeline.ts` — cliente HTTP/SSE de `/api/roadmap`.
- `client/src/roadmap/live.ts` — tradução do snapshot para o modelo das telas.
- `client/src/roadmap/data.ts` — tipos e índices em memória.
- `client/src/roadmap/app.ts` — estado, carregamento, SSE e conversa.
- `client/src/roadmap/views.ts` — visão geral, fases, backlog e trabalho agora.
- `client/src/roadmap/conversation.ts` — gaveta de conversa e recibos.
- `server/roadmap/config.ts` / `proxy.ts` — configuração e proxy do pipeline.
