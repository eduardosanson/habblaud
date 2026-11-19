# Spec: OpenCode no escritório

## Fase A — leitura ao vivo (entregue)

### Contexto de negócio

Quem usa o OpenCode hoje não aparece no Habblaud. O OpenCode V2 expõe uma API HTTP local com SSE, então dá para
mostrar as sessões dele no escritório sem plugin, sem hook e sem ler o SQLite. Esta fase entrega a visão ao vivo:
personagens, salas, status, atividades, subagentes e uso da conta. Terminal, permissões e mensagens ficam para as
fases seguintes.

### Requisitos funcionais

- RF01: descobrir o serviço local pelo `service.json` (`$XDG_STATE_HOME/opencode/service.json` ou
  `~/.local/state/opencode/service.json`) e autenticar com Basic.
- RF02: aceitar `HABBLAUD_OPENCODE_URL` e `HABBLAUD_OPENCODE_PASSWORD` para casos em que o arquivo não está
  acessível (Docker, servidor explícito).
- RF03: no boot, listar as sessões com `GET /api/session`, as ativas com `GET /api/session/active` e o uso com
  `GET /api/experimental/usage/limits`.
- RF04: mostrar cada sessão principal como um agente `provider: 'opencode'`, com sala pelo `location.directory`,
  título, modelo, tokens, custo, agente do OpenCode no papel e status coerente.
- RF05: mostrar sessões filhas (`parentID`) como subagentes do pai enquanto o pai estiver presente.
- RF06: acompanhar `GET /api/event` e refletir início/fim de turno, status, ferramentas, shells, compactação,
  permissões, renomeação, uso e remoção.
- RF07: sessões com `permission.asked` ficam `waiting` com o motivo; `permission.replied` volta ao trabalho.
- RF08: presença por sessão ativa ou vista/atualizada na janela configurável (padrão 2 h); sessões arquivadas e
  removidas saem do escritório.
- RF09: reconectar o SSE com backoff e ressincronizar sessões, ativas e uso ao reconectar.
- RF10: registrar a conta `opencode` no `AccountsService`, com uso de 5 h e semanal mapeado de `rolling` e
  `weekly`.

### Requisitos não funcionais

- RNF01: sem dependências de runtime novas; usar `fetch`, `TextDecoder` e `AbortSignal` do Node.
- RNF02: a senha do `service.json` nunca vai para o snapshot, para o log, para o navegador ou para um arquivo.
- RNF03: nenhuma leitura de `/api/credential`, tokens ou credenciais.
- RNF04: tolerar a API experimental: validar versão major 2, ignorar eventos desconhecidos e nunca derrubar o
  servidor por falha da fonte.
- RNF05: testes com cliente falso/servidor HTTP falso; nenhum teste fala com o OpenCode real.
- RNF06: `npm run typecheck`, `npm test` e `npm run build` verdes.

### Critérios de aceite

- CA01: com um `service.json` válido e um serviço falso, o boot cria o agente principal na sala correta, com
  `provider: 'opencode'`, conta `opencode` e status inicial coerente.
- CA02: um evento `session.execution.started` deixa o agente `working`; `session.idle` deixa `idle`.
- CA03: um evento `session.created` com `parentID` cria um subagente do pai; `session.idle` do filho entrega o
  subagente.
- CA04: `session.tool.called` gera atividade com o nome/entrada da ferramenta; `session.tool.failed` marca erro.
- CA05: `permission.asked` deixa o agente `waiting` com o motivo; `permission.replied` volta o status.
- CA06: sessão com `time.viewed` antiga e sem eventos sai depois da janela; sessão ativa nunca sai.
- CA07: reconexão do SSE refaz a lista de sessões e não duplica agentes.
- CA08: o uso `rolling`/`weekly` aparece na conta `opencode` com a origem `opencode`.
- CA09: agentes do OpenCode não entram no pacote do Habblaud World (o protocolo ainda só aceita Claude/Codex).
- CA10: nenhum segredo do `service.json` aparece no snapshot, no feed ou no log.

### Definition of Done

- [ ] Código implementado e compilando
- [ ] Testes unitários e de integração da fonte passando
- [ ] `npm run typecheck`, `npm test` e `npm run build` verdes
- [ ] `npm run i18n:check` sem novos textos pendentes
- [ ] CHANGELOG em "Não lançado"
- [ ] Evidências e passo a passo de validação manual no PR

### Fora de escopo da Fase A

- Terminal ao vivo e histórico de sessões do OpenCode.
- Aprovar/recusar permissões pelo escritório (só mostrar `waiting`).
- Mandar mensagens pelo escritório.
- Docker com o serviço no host e múltiplos serviços do OpenCode.
- Alterar o protocolo do Habblaud World para aceitar `opencode`.

## Fase B — terminal e histórico (entregue)

### Contexto de negócio

A Fase A mostrou o OpenCode no escritório, mas o personagem ainda não abria a conversa: o terminal era só de
transcript em arquivo (Claude Code/Codex). Esta fase leva o terminal e o histórico do OpenCode ao mesmo lugar, pela
API de sessões/mensagens, sem plugin e sem dependência nova.

### Requisitos funcionais

- RF11: `OpenCodeHistory implements HistoryProvider` lista as sessões raiz recentes com `GET /api/session`
  (`limit=150&order=desc`), janela de 7 dias, subagentes e arquivadas de fora, e `provider: 'opencode'` em cada
  `RecentSession`.
- RF12: `resolve()` valida conta e id de sessão e devolve um `MessageStream` que lê
  `GET /api/session/{id}/message?limit=100&order=desc`.
- RF13: o terminal ao vivo de uma sessão do OpenCode (principal ou subagente) usa o mesmo protocolo SSE do Claude
  Code/Codex (`init` + `append`), com prompts, respostas, raciocínio, ferramentas, resultados, shells, compactação
  e avisos.
- RF14: o terminal de uma sessão encerrada do histórico abre pelo mesmo `MessageStream`, com o streamId
  `session:<conta>:<sessionId>`.
- RF15: `MessageStream` é uma costura opcional em `AgentSource`/`HistorySession`; Claude Code e Codex continuam no
  caminho de transcript em arquivo, sem mudança de comportamento.
- RF16: a sessão desconhecida responde 404 e o serviço fora do ar não derruba o Habblaud (log + nova tentativa).
- RF17: nenhuma rota lê `/api/credential`; a senha do `service.json` continua só em memória.

### Requisitos não funcionais

- RNF07: sem dependências de runtime novas; o stream usa o `OpenCodeClient` existente.
- RNF08: textos, argumentos e resultados seguem as mesmas regras de limpeza, máscara de segredos e corte do terminal
  do Claude Code.
- RNF09: o polling do terminal não empilha: um `poll()` assíncrono lento segura o próximo ciclo daquela conexão.
- RNF10: testes com cliente falso/fixtures; nenhum teste fala com o serviço real.

### Critérios de aceite

- CA11: com um cliente falso, `GET /api/sessions/recent` mostra a sessão do OpenCode com `provider: 'opencode'`,
  projeto, título e `open`/`agentId` quando o agente está no escritório.
- CA12: o terminal de um agente OpenCode manda `init` com as entradas da conversa e `append` só com o que apareceu
  depois; uma ferramenta que termina entra só como resultado.
- CA13: o terminal de uma sessão do histórico usa o stream da sessão e o streamId do histórico.
- CA14: subagente aberto no escritório também abre o terminal da sessão filha.
- CA15: id malformado = 400; conta desconhecida (com id bem formado) ou serviço sem cliente = 404; sessão inexistente no
  serviço = 404.
- CA16: a senha do `service.json` não aparece no snapshot, no terminal, no histórico ou no log.

### Definition of Done da Fase B

- [x] `OpenCodeHistory` e `OpenCodeMessageStream` implementados e testados
- [x] `TerminalStreams` aceita fonte assíncrona sem quebrar arquivo/demo
- [x] `RecentSession.provider = 'opencode'` e terminal do histórico
- [x] `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes
- [x] Smoke local (`npm run opencode:smoke`) lê histórico e terminal do serviço real
- [x] CHANGELOG em "Não lançado" e documentação atualizada

### Fora de escopo da Fase B

- Responder permissões pelo escritório (`/api/session/{id}/permission/{requestID}/reply`).
- Mandar mensagens (`POST /api/session/{id}/prompt`).
- Plugin Python do Hermes e `/api/hermes/events`.
- Entregas (deliveries) a partir de conversas do OpenCode: o `resolve()` do histórico devolve stream, não arquivo.
- Alterar o protocolo do Habblaud World para aceitar `opencode`.
