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
- Plugin Python do Hermes e `/api/hermes/events`.
- Entregas (deliveries) a partir de conversas do OpenCode: o `resolve()` do histórico devolve stream, não arquivo.
- Alterar o protocolo do Habblaud World para aceitar `opencode`.

## Fase D — mandar mensagens (entregue)

### Contexto de negócio

Faltava o caminho de volta: o terminal do OpenCode mostrava a conversa, mas a caixa de mensagem só entregava ao Claude
Code (plugin) e ao Codex (`codex queue`). Quem trabalha no OpenCode continuava tendo de trocar de janela para mandar
o próximo prompt.

### Requisitos funcionais

- RF18: o `MessageRegistry` aceita um entregador opcional do OpenCode; `opencode.prompt(sessionId, text)` chama
  `POST /api/session/{id}/prompt` com `{text, delivery: 'queue'}` e resolve quando o serviço aceita o prompt.
- RF19: `canMessage`/`reachable` incluem os agentes principais do OpenCode quando o serviço está resolvido; sem ele, a
  caixa mostra o motivo (`ERR_OPENCODE_UNAVAILABLE`).
- RF20: uma mensagem por agente por vez, na ordem; aceita = `delivered` com a atividade "Mensagem pelo Habblaud";
  recusa do serviço = `failed` com o motivo. Troca de sessão ou agente que saiu antes da vez = falha, sem mandar.
- RF21: a caixa do OpenCode tem dica, texto de fila/entrega e prazo próprios; a do Claude Code passa a dizer que o
  plugin carrega ao abrir a sessão (instalar com a sessão aberta não basta).
- RF22: a caixa de entrada do plugin (`POST /api/mod/inbox`) só atende agentes do Claude Code; Codex e OpenCode nunca
  são entregues por ela.
- RF23: nenhuma senha do `service.json` entra no corpo do prompt, no log ou na resposta da página.

### Requisitos não funcionais

- RNF11: sem dependências novas e sem plugin: o servidor usa o `OpenCodeClient` que já existe.
- RNF12: testes com entregador falso (promise controlada) e cliente falso; nenhum teste manda prompt ao serviço real.
- RNF13: a promessa do prompt não bloqueia o relógio do registro; o `tick` e o fim de cada entrega chamam a fila.

### Critérios de aceite

- CA17: com o serviço no ar, um agente principal do OpenCode aparece com `canMessage` e `POST /api/messages` chama
  `POST /api/session/{id}/prompt` na sessão certa, com `delivery: 'queue'`.
- CA18: duas mensagens para o mesmo agente saem em ordem, uma por vez; a segunda só sai quando a primeira é aceita.
- CA19: recusa do serviço vira `failed` com o motivo; sem serviço, a mensagem é recusada com o motivo certo.
- CA20: troca de sessão ou agente que saiu antes da vez falha com `ERR_SESSION_CHANGED`/`ERR_GONE`.
- CA21: o plugin do Claude Code não busca nem confirma mensagens do OpenCode.
- CA22: a caixa do OpenCode mostra "Na fila: entregando ao OpenCode…", "Entregue ✓ na fila do OpenCode…" e o prazo
  "confira no OpenCode"; a do Claude Code explica que o plugin carrega ao abrir a sessão.

### Definition of Done da Fase D

- [x] `OpenCodeSource.promptSession` + `MessageRegistry` com entregador do OpenCode
- [x] `server/index.ts` ligando o entregador quando a fonte existe
- [x] UI da caixa com dica, fila, entrega e prazo do OpenCode; dica do Claude Code corrigida
- [x] Testes do registro, da fonte e da caixa
- [x] `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes
- [x] CHANGELOG, README do servidor e traduções

### Fora de escopo da Fase D

- Responder permissões do OpenCode pelo escritório.
- Anexos, menções, skills ou comandos de barra no prompt do OpenCode: vai só o texto.
- Entregas (deliveries) a partir de conversas do OpenCode.
- Alterar o protocolo do Habblaud World para aceitar `opencode`.
