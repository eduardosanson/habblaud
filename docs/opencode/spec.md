# Spec: OpenCode no escritório (Fase A — leitura ao vivo)

## Contexto de negócio

Quem usa o OpenCode hoje não aparece no Habblaud. O OpenCode V2 expõe uma API HTTP local com SSE, então dá para
mostrar as sessões dele no escritório sem plugin, sem hook e sem ler o SQLite. Esta fase entrega a visão ao vivo:
personagens, salas, status, atividades, subagentes e uso da conta. Terminal, permissões e mensagens ficam para as
fases seguintes.

## Requisitos funcionais

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

## Requisitos não funcionais

- RNF01: sem dependências de runtime novas; usar `fetch`, `TextDecoder` e `AbortSignal` do Node.
- RNF02: a senha do `service.json` nunca vai para o snapshot, para o log, para o navegador ou para um arquivo.
- RNF03: nenhuma leitura de `/api/credential`, tokens ou credenciais.
- RNF04: tolerar a API experimental: validar versão major 2, ignorar eventos desconhecidos e nunca derrubar o
  servidor por falha da fonte.
- RNF05: testes com cliente falso/servidor HTTP falso; nenhum teste fala com o OpenCode real.
- RNF06: `npm run typecheck`, `npm test` e `npm run build` verdes.

## Critérios de aceite

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

## Definition of Done

- [ ] Código implementado e compilando
- [ ] Testes unitários e de integração da fonte passando
- [ ] `npm run typecheck`, `npm test` e `npm run build` verdes
- [ ] `npm run i18n:check` sem novos textos pendentes
- [ ] CHANGELOG em "Não lançado"
- [ ] Evidências e passo a passo de validação manual no PR

## Fora de escopo

- Terminal ao vivo e histórico de sessões do OpenCode.
- Aprovar/recusar permissões pelo escritório (só mostrar `waiting`).
- Mandar mensagens pelo escritório.
- Docker com o serviço no host e múltiplos serviços do OpenCode.
- Alterar o protocolo do Habblaud World para aceitar `opencode`.
