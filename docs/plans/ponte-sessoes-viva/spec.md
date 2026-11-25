# Spec: ponte de sessões vivas — escolher e conversar com a sessão real do item

## Contexto de Negócio
Hoje, na gaveta de conversa do roadmap, a pessoa não consegue escolher com qual sessão falar: a lista vinha de
`/api/agent/sessions`, que o pipeline removeu (pipeline = só registro). O Habblaud passa a montar essa lista a partir
das **execuções** que o pipeline registra (`workerSessionId` + `provider` + `cwd`), mostra quais sessões estão vivas no
escritório e entrega a pergunta na escolhida. Foco: **sessões vivas**. Reabrir sessão fechada (H6) fica fora.

Contrato do pipeline (lado deles, fechado): `pipeline/docs/integration/contrato-restauracao-sessao.md`.
Roadmap no servidor: `habblaud-ponte-sessoes` (H1, H6 em andamento). O trabalho já feito (H2–H5, H7, H8) está no branch
`feature/habblaud-ponte-sessoes`, que diverge da `main`; este plano o traz para a `main` e o adapta ao contrato final.

## Contrato consumido (somente leitura, escopo `roadmap.read`)
- `GET /api/roadmaps/:id/executions?limit=` → `{roadmapId, executions[]}` (mais nova primeiro).
- `GET /api/roadmaps/:id/items/:itemId/executions` → `{roadmapId, itemId, executions[]}` (mais antiga primeiro).
- Campos usados: `workerSessionId` (vazio quando o pipeline não capturou), `provider` (enum fechado `claude-code`,
  `codex`, `opencode`, `antigravity`, `hermes`), `cwd`, `profile`, `model`, `startedAt`, `endedAt`, `outcome`.
- **Não existem** no pipeline: `participants`, `resume`, `argv`, `harness`, `workdir`, `role`, `/api/agent/*`.
- Mapa de `provider` para o `Provider` do Habblaud: `claude-code→claude`; `codex`, `opencode`, `antigravity`,
  `hermes` mantêm o nome.

## Requisitos Funcionais
- RF01: o proxy libera as duas rotas `executions` (GET); deixa de aceitar `participants` e `/api/agent/sessions`.
- RF02: o roteador reconhece o `provider` do pipeline (incluindo `claude-code`) e lê `cwd` da execução.
- RF03: `GET /api/roadmap/sessions?roadmapId=&itemId=` (somente local) devolve as sessões que trabalharam no item
  (ou, sem nenhuma, no roadmap), sem repetição, com `live`, `agentId` (se viva), `resumable`, `profile`, `model`,
  `lastAt`, e a sugerida pelo roteador. Execução com `workerSessionId` vazio não vira sessão.
- RF04: `POST /api/roadmap/converse` aceita `session: {provider, sessionId}` opcional. Com ele, entrega na sessão
  escolhida **somente se ela estiver na lista do RF03**; sem ele, usa a sugerida (comportamento atual).
- RF05: a gaveta mostra um seletor de sessão (padrão = sugerida; viva primeiro; fechada visível mas não enviável,
  com a explicação "sessão fechada, abra-a"). A escolha vale para as perguntas seguintes da mesma conversa.
- RF06: a página `/roadmap` monta a lista de agentes pelas execuções do roadmap, sem chamar `/api/agent/sessions`.
- RF07: tudo visível por `tr()` com `en`, `es`, `fr`; CHANGELOG "Não lançado"; docs da ponte atualizadas.

## Requisitos Não-Funcionais
- RNF01 Segurança: a rota de sessões e o converse são só locais; o token fica só no servidor; o cliente nunca escolhe
  um destino fora da lista que o servidor montou; nenhum comando do pipeline é executado.
- RNF02 Sem LLM no roteamento: mesma entrada, mesma saída.
- RNF03 Falha do pipeline (401, 5xx, rede) aparece como erro na gaveta e não derruba a página.
- RNF04 `npm run typecheck` e `npm run i18n:check` limpos; suíte sem novas falhas.

## Critérios de Aceite
- CA01: dada execução com `provider: "claude-code"` e `workerSessionId` de um agente Claude vivo e acessível, quando
  roteada, então o alvo é esse agente (hoje retorna `null`).
- CA02: dado `GET /api/roadmap/roadmaps/x/executions`, então o proxy responde 200; `.../items/y/participants` e
  `/api/roadmap/agent/sessions` respondem 404 `rota de roadmap desconhecida`.
- CA03: dado item com duas execuções da mesma sessão, quando listadas, então a sessão aparece uma vez (a mais recente).
- CA04: dado `session` fora da lista, quando se faz o POST, então 400 `unknown_session` e nada entra na fila.
- CA05: dado `session` viva e acessível, quando se faz o POST, então 202 e o `agentId` é o dela, não o sugerido.
- CA06: dado `session` fechada, então 409 `session_closed`.
- CA07: dado item sem execuções e roadmap sem execuções, então a lista vem vazia, `suggested: null` e a gaveta
  explica que ninguém registrou sessão neste item, com o envio desabilitado.
- CA08: dado o pipeline com 401, então `/api/roadmap/sessions` responde o erro e a gaveta o mostra sem recarregar.
- CA09: dado o servidor real, quando se pergunta numa sessão viva escolhida no seletor, então a pergunta aparece no
  terminal dela e a resposta volta na gaveta (verificação manual, com a sua aprovação do envio).

## Definition of Done (DOD)
- [ ] Código implementado e compilando
- [ ] Testes unitários escritos primeiro e passando
- [ ] `npm run typecheck`, `npm run i18n:check` verdes; suíte sem novas falhas
- [ ] CHANGELOG atualizado
- [ ] Evidências (CA09) e passo a passo de validação humana
- [ ] Decisões registradas em `docs/decisions/habblaud-H1.md`
- [ ] Item do roadmap `habblaud-H1` atualizado

## Fora de Escopo
- Reabrir sessão fechada (H6) e qualquer comando de retomada (`claude --resume`, `codex resume`).
- Alterações no repositório do pipeline.
- Escolha de agente por LLM; criar ou editar roadmap pelo Habblaud.
- `shared/world/` e `server/world/` (e o teste `server/world/uplink.test.ts`, que já falha na `main`).
