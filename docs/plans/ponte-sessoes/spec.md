# Spec: ponte de sessões — o Habblaud conversa com o agente real do item

## Contexto de Negócio
Hoje a conversa do roadmap passa por `/api/agent/*` do Hermes Pipeline, onde o agente "mora" no pipeline e não sabe
o que os outros agentes fizeram nesta máquina. O pipeline passa a ser **só registro** (plano `registro-sessoes`, no
repositório do pipeline). O Habblaud é o integrador: descobre quem trabalhou no item, escolhe a sessão por regra fixa
(sem LLM), entrega a pergunta nela e lê a resposta. Roadmap no servidor: `habblaud-ponte-sessoes` (H1–H8).

## Contrato com o pipeline (congelado no plano dele; o Habblaud só consome)
- `GET /api/roadmaps/:id/items/:itemId/participants` → `[{profile, harness, model, role, executions, lastOutcome,
  lastEndedAt, resume}]`.
- `resume`: `null | {harness, sessionId, workdir, argv: [str]}`. `execution` ganha `harness`, `workdir`, `role`, `resume`.
- Campos novos são opcionais; execuções antigas chegam sem eles (`resume: null`, strings vazias).
- **`execution.sessionId` NÃO é a sessão do harness**: em execuções `source: pipeline-run` ele é um id de run
  (`run:feat-...:D1:2`). A sessão real é `resume.sessionId`. `provider` também não serve de chave (vem como
  `claude-subscription-directsdk-experimental`); a chave é `resume.harness`.
- Harness do pipeline: `hermes | opencode | agy | claude-code | codex`. Mapa para o `Provider` do Habblaud:
  `claude-code→claude`, `codex→codex`, `opencode→opencode`, `hermes→hermes`, `agy→antigravity`. Desconhecido = ignorar.
- `resume.argv` é **dado, nunca comando**: o Habblaud não o executa. O comando de retomada é montado aqui, por harness,
  a partir de `sessionId` + `workdir` validados.

## Requisitos Funcionais
- RF01 (H1): o proxy aceita `GET /api/roadmaps/:id/items/:itemId/participants` e `.../executions` (somente leitura) e o
  cliente expõe os dois.
- RF02 (H3): módulo puro `harness` converte harness do pipeline em `Provider` e valida `resume` (sessionId e workdir
  bem formados, workdir absoluto, sem `..`, sem NUL); monta o comando de retomada por lista fixa por harness.
- RF03 (H2): roteador local `resolveTarget(item)`: (1) participante com `resume` válido, mais recente; (2) preferência
  por agente **vivo** no escritório (mesmo `sessionId`/provider); (3) fallback: participante mais recente do roadmap.
  Determinístico, sem LLM; devolve `{participant, agent?, reason}` ou `null` com motivo.
- RF04 (H4): `POST /api/roadmap/converse` (local) entrega a mensagem ao agente vivo escolhido pela fila existente
  (`server/messages`) com o contexto do item; sem agente vivo, cai em RF06.
- RF05 (H5): a resposta vem da transcrição da sessão (fontes existentes), não de `/api/agent/*`.
- RF06 (H6): sessão fechada só é reaberta onde houver mecanismo verificado por harness; sem mecanismo, a gaveta
  explica "sessão fechada, abra-a" e nunca inventa resposta.
- RF07 (H7): a gaveta usa o roteador; o proxy deixa de aceitar `/api/agent/*`.
- RF08 (H8): docs, CHANGELOG, i18n (`tr()`), E2E.

## Requisitos Não-Funcionais
- RNF01 Segurança: nenhum argv do pipeline é executado; token continua só no servidor; rota nova só local.
- RNF02 Sem LLM no roteamento; resultado idêntico para a mesma entrada.
- RNF03 Compatível com pipeline antigo (campos ausentes não quebram a página).
- RNF04 Tudo visível por `tr()` com locales; `npm run i18n:check` limpo.

## Critérios de Aceite
- CA01: dado participante com `resume.harness='agy'`, quando resolvido, então o provider é `antigravity`.
- CA02: dado `resume.sessionId` com `;`, `../` ou vazio, quando validado, então é recusado e nunca vira comando.
- CA03: dado dois participantes, um com agente vivo, quando roteado, então escolhe o vivo.
- CA04: dado item sem `participants`, quando roteado, então usa o mais recente do roadmap; sem nenhum, `null` + motivo.
- CA05: dado `execution.sessionId='run:...'` sem `resume`, quando roteado, então NÃO trata como sessão do harness.
- CA06: o proxy bloqueia `/api/agent/*` depois do H7 e deixa passar `participants`/`executions`.

## Definition of Done
- [ ] Código compilando; testes unitários passando; `npm run typecheck` e `npm run i18n:check` verdes
- [ ] CHANGELOG "Não lançado" atualizado
- [ ] Evidências e passo a passo de validação humana no PR
- [ ] PR aberto contra main

## Fora de Escopo
- Qualquer alteração no repositório do pipeline (outro agente).
- Escolha de agente por LLM; criação/edição de roadmap pelo Habblaud.
- Reabrir sessão em harness sem mecanismo verificado (RF06 só documenta).
