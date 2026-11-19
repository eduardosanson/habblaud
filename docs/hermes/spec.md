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
- RF12: `npm run hermes:install` cria o symlink `~/.hermes/plugins/habblaud` e habilita nos perfis; `uninstall` e
  `status` funcionam sem tocar no resto do Hermes.

## Requisitos não funcionais

- RNF01: sem dependências novas no Habblaud; o plugin usa só a biblioteca padrão do Python (e `yaml`, se houver,
  para ler `terminal.cwd`).
- RNF02: nenhum prompt, mensagem, transcript, credencial ou variável de ambiente sensível vai para o Habblaud; só
  nome de ferramenta, preview curto mascarado, status, tokens e ids.
- RNF03: hook nunca lança nem espera a rede; fila de 256 eventos, descarte silencioso e no máximo um aviso por minuto.
- RNF04: a rota é local (mesma trava dos eventos do Codex); a fonte tolera evento desconhecido/inválido e nunca
  derruba o servidor.
- RNF05: testes com Office/AccountsService e eventos sintéticos; rota com servidor HTTP falso; plugin com `_post` falso.
- RNF06: `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes.

## Critérios de aceite

- CA01: `session_open` cria o agente `hermes:<perfil>:<sessão>` na sala do projeto, com conta do perfil e status idle.
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
- CA11: o plugin não envia `user_message`, prompt, transcript ou segredo; só os campos normalizados.
- CA12: `npm run hermes:install -- --dry-run` não grava; instalar cria o symlink e habilita; desinstalar remove.

## Definition of Done

- [x] `Provider 'hermes'` e UI (selo, chip, busca, composer/terminal indisponíveis com mensagem clara)
- [x] `HermesSource` + rota `/api/hermes/events` + registro no servidor
- [x] Plugin Python + instalador `hermes:install/uninstall/status`
- [x] Testes da fonte, eventos, rota, instalador e plugin
- [x] `npm run typecheck`, testes focados, `npm run build` e `npm run i18n:check` verdes
- [x] CHANGELOG, README do servidor, README do plugin e traduções

## Fora de escopo

- Terminal e histórico do Hermes (transcripts/SQLite): o agente mostra "terminal do Hermes ainda não está disponível".
- Mandar mensagens pelo escritório: a caixa mostra "mensagens para o Hermes ainda não estão disponíveis".
- Responder aprovações pelo escritório: o agente só levanta a mão; a resposta continua no Hermes.
- Enviar agentes do Hermes ao Habblaud World (o protocolo ainda só aceita Claude Code/Codex).
- Instalar/gerenciar perfis do Hermes além de habilitar o plugin nos que já existem.
