# Spec: Hermes no escritório (Fase A — leitura ao vivo)

## Contexto de negócio

Quem usa o Hermes não aparece no Habblaud. O Hermes tem um sistema de plugins Python com hooks de sessão, ferramenta,
subagente, aprovação e uso; esta fase instala um plugin observador que manda esses eventos ao Habblaud local e mostra
as sessões no escritório como as do Claude Code/Codex/OpenCode. Terminal, histórico, mensagens e resposta de
permissões ficam para as fases seguintes.

## Requisitos funcionais

- RF01: `Provider` ganha `'hermes'`; cada perfil do Hermes (`~/.hermes` ou `~/.hermes/profiles/<nome>`) vira uma
  conta, com id resolvido pelo `AccountsService`.
- RF02: `mod/habblaud-hermes` (Python, `register(ctx)` + `plugin.yaml`) registra os hooks de sessão, ferramenta,
  subagente, aprovação e uso, sem ler transcript e sem transformar nada.
- RF03: o plugin publica JSON em `POST /api/hermes/events` (`{profile, home?, event}`), de forma assíncrona (fila +
  thread daemon), com prazo de POST e falha em silêncio.
- RF04: a rota só aceita POST JSON de Host local e, fora do Docker, conexão pelo loopback; a resposta é `{ok}`.
- RF05: `session_open`/`session_start` criam o agente principal na sala do `project` (o `terminal.cwd` do perfil ou
  `HABBLAUD_HERMES_PROJECT`); `session_busy`/`session_idle` mudam o status.
- RF06: `pre_tool_call`/`post_tool_call` viram atividade (comando/arquivo/busca/web/browser) e contam ferramentas;
  falha da ferramenta vira atividade de erro. Evento repetido pelo `event_id` ou pelo `call_id` não duplica.
- RF07: `subagent_start` cria o subagente (papel e objetivo) sob o principal; as ferramentas da sessão filha vão
  para ele; `subagent_stop` conclui (ou marca falha/interrupção).
- RF08: `approval_request` deixa o agente `waiting` com o comando/motivo; `approval_response` volta ao trabalho.
- RF09: `post_api_request` soma tokens de entrada/saída por sessão (prompt/input inclusivo; cache/raciocínio não são
  somados de novo) e atualiza modelo/estatísticas; a mesma medição (`usage_id`) não conta duas vezes.
- RF10: `session_end`/`session_finalize`/`session_reset`/`session_delete` fecham; sessão sem evento por 2 h sai na
  varredura.
- RF11: sem nenhum evento, a fonte não aparece no snapshot/health; depois do primeiro, `sources()` mostra
  `hermes` com as sessões principais.
- RF12: `npm run hermes:install` cria o symlink `~/.hermes/plugins/habblaud` e um em cada
  `~/.hermes/profiles/*/plugins/`, e habilita nos perfis; `uninstall` e `status` funcionam sem tocar no resto do
  Hermes.

## Requisitos não funcionais

- RNF01: sem dependências novas no Habblaud; o plugin usa só a biblioteca padrão do Python (e `yaml`, se houver,
  para ler `terminal.cwd`).
- RNF02: nenhum transcript é lido de disco/SQLite e nenhuma credencial/variável sensível vai para o Habblaud; o
  plugin só manda o que os hooks entregam (texto, ferramenta, resultado), mascarado e cortado pelo servidor.
- RNF03: hook nunca lança nem espera a rede; fila de 256 eventos, descarte silencioso e no máximo um aviso por minuto.
- RNF04: a rota é local (mesma trava dos eventos do Codex); a fonte tolera evento desconhecido/inválido e nunca
  derruba o servidor.
- RNF05: testes com Office/AccountsService e eventos sintéticos; rota com servidor HTTP falso; plugin com `_post` falso.
- RNF06: `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes.

## Critérios de aceite

- CA01: `session_open` cria o agente `hermes:<perfil>:<sessão>` na sala do projeto, com conta do perfil (nome
  “Hermes” + iniciais, ex.: “Hermes D”) e status idle.
- CA02: `session_busy` deixa working; `session_idle`, idle; `session_end`, offline.
- CA03: `tool_start` gera atividade e conta uma ferramenta; repetir o mesmo `call_id` não conta de novo.
- CA04: `subagent_start` cria o subagente sob o principal; ferramentas da sessão filha aparecem nele; `subagent_stop`
  conclui.
- CA05: `approval_request` deixa waiting com `aprovar <comando>`; `approval_response` volta ao trabalho.
- CA06: `usage` soma tokens uma vez por `usage_id`; uma segunda medição com o mesmo id não soma.
- CA07: dois perfis viram duas contas; a conta não muda de id quando outro perfil chega.
- CA08: evento desconhecido ou sem sessão é ignorado; sessão parada além de 2 h sai no sweep.
- CA09: `/api/hermes/events` responde 403 fora do Host local, 405 para GET, 415 sem JSON, 400 sem `event.type` e 413
  acima de 256 KB.
- CA10: sem fonte, a rota responde `{ok: false}`; com fonte e evento válido, `{ok: true}`.
- CA11: o plugin não lê transcript nem credenciais; a conversa da Fase B vem dos hooks e é mascarada/cortada.
- CA12: `npm run hermes:install -- --dry-run` não grava; instalar cria os symlinks (base e perfis) e habilita;
  desinstalar remove.

## Definition of Done (Fase A)

- [x] `Provider 'hermes'` e UI (selo, chip, busca)
- [x] `HermesSource` + rota `/api/hermes/events` + registro no servidor
- [x] Plugin Python + instalador `hermes:install/uninstall/status`
- [x] Testes da fonte, eventos, rota, instalador e plugin
- [x] `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes
- [x] CHANGELOG, README do servidor, README do plugin e traduções

## Fase B — terminal, mensagens e aprovações (entregue)

### Contexto de negócio

A Fase A mostrou o Hermes no escritório, mas a conversa, a caixa de mensagem e as aprovações ainda ficavam no Hermes.
Esta fase usa os contratos do próprio runtime: os hooks de LLM/ferramenta para o terminal, `ctx.inject_message` para
mensagens e `register_approval_transport` para responder aprovações.

### Requisitos funcionais

- RF24: o plugin envia `history` (primeiro turno), `user_message` (`pre_llm_call`), `assistant_message`
  (`post_llm_call`), ferramenta (`tool_start` com `input`) e resultado (`tool_end`); o `HermesSource` mantém um buffer
  por agente e `messageStream(agentId)` serve o terminal SSE do Habblaud.
- RF25: a caixa de mensagem do Hermes usa a mesma fila do Claude Code: `POST /api/mod/inbox` com
  `provider: 'hermes'`; o plugin busca a cada 2 s, injeta com `ctx.inject_message(text, session_key=sessão)` e
  confirma em `/api/mod/inbox/ack`. Outro processo do mesmo perfil devolve com `retry` em vez de falhar.
- RF26: o plugin registra o transport `habblaud`; `present_fn` manda o pedido para `POST /api/permissions`
  (`provider: 'hermes'`) e espera a decisão. `allow` vira `once`; `deny` vira `deny`; sem página, sessão desconhecida
  ou “Responder no terminal”, o transport falha e o host usa o prompt embutido (`transport_fallback: builtin`).
- RF27: o instalador deixa o plugin visível em cada perfil (symlink em `~/.hermes/profiles/*/plugins/`) e configura
  `plugins.entries.habblaud.allow_gateway_injection: true`, `security.approval.transport: habblaud` e
  `security.approval.transport_fallback: builtin` em cada perfil; o `uninstall` limpa as três chaves e os symlinks.
- RF28: o terminal do subagente usa o tracker filho (`hermes:<perfil>:<pai>:<filho>`) e os eventos da sessão filha.
- RF29: o endpoint `GET /api/hermes/sessions` lista as sessões principais no escritório para o plugin buscar a caixa;
  é local e não expõe conversa.
- RF30: o plugin manda `session_heartbeat` a cada 30 s para cada sessão viva; se o Habblaud reiniciar, o
  `HermesSource` recria o agente no status que o plugin lembra, sem esperar um turno novo.
- RF31: no gateway multi-perfil, o plugin só publica a sessão no perfil dono (`HERMES_SESSION_PROFILE`); o
  `HermesSource` também junta a mesma sessão vista em perfis diferentes num agente só.

### Requisitos não funcionais

- RNF07: a conversa vai pelos hooks do runtime (não lê SQLite/transcript em disco); textos, comandos e resultados são
  mascarados e cortados pelas regras do terminal do Claude Code.
- RNF08: o poll da caixa é de 2 s e não bloqueia o agente; `inject_message` é o host oficial do Hermes.
- RNF09: aprovações usam o contrato `ApprovalRequest`/`ApprovalDecision` (digest e prazo do host); falha sempre cai no
  prompt embutido quando `transport_fallback: builtin`.
- RNF10: sem API key, sem WebSocket do dashboard e sem `/api/credential`; tudo local.

### Critérios de aceite

- CA13: um `history`/`user_message`/`assistant_message`/`tool_start`/`tool_end` aparece no terminal SSE do agente na
  ordem, com título de ferramenta e resultado.
- CA14: o terminal do subagente recebe os eventos da sessão filha.
- CA15: com o plugin buscando a caixa, o agente aparece com `canMessage`; `POST /api/messages` entrega o texto ao
  `ctx.inject_message` e a confirmação vira `delivered`.
- CA16: sem o plugin, a caixa mostra a dica e o `POST /api/messages` responde 409; outro processo que não é dono da
  sessão devolve `retry` e a mensagem volta para `queued`.
- CA17: um pedido do Hermes vira cartão `provider: 'hermes'` com `Bash(comando)`; `allow`/`deny` chegam ao transport;
  “Responder no terminal” libera e cai no prompt embutido.
- CA18: o instalador configura as três chaves por perfil; `uninstall` remove; `--dry-run` só mostra.
- CA19: nada de senha/credencial no snapshot, log ou UI; o World continua sem Hermes.
- CA20: depois de reiniciar o Habblaud, uma sessão viva volta ao escritório em até 30 s pelo heartbeat, mesmo sem
  prompt novo; um agente que já está aqui não tem o status alterado pelo heartbeat.
- CA21: a mesma sessão publicada por dois perfis vira um agente só; os eventos do perfil duplicado atualizam esse
  agente.

### Definition of Done (Fase B)

- [x] Terminal ao vivo pelos eventos do plugin (principal, subagente, histórico do turno)
- [x] Mensagens pelo `ctx.inject_message` + caixa do plugin + retry entre processos
- [x] Aprovações pelo `register_approval_transport` + cartão do escritório
- [x] Instalador configura mensagens/aprovações e limpa no uninstall
- [x] Testes da fonte (terminal), registro de mensagens, permissões, plugin e instalador
- [x] `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes
- [x] CHANGELOG, README do servidor e README do plugin atualizados

## Fora de escopo

- Histórico/lista de sessões **encerradas ou antigas** do Hermes: o plugin só observa sessões vivas; o terminal cobre a
  sessão aberta. Ler o `state.db` ou a API HTTP autenticada fica para uma fase seguinte.
- Anexos, menções, skills e comandos de barra na caixa do Hermes: vai só o texto.
- Escopos “sessão”/“sempre permitir” na aprovação do Hermes: o transport oferece `once` e `deny`.
- Enviar agentes do Hermes ao Habblaud World (o protocolo ainda só aceita Claude Code/Codex).
- Instalar/gerenciar perfis do Hermes além de habilitar o plugin nos que já existem.
