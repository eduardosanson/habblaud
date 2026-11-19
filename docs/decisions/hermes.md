## DOR → SPEC — 2026-11-19

- Decisão: integrar o Hermes por plugin Python + `POST /api/hermes/events`, não lendo o `state.db`/transcripts — o plugin é o contrato observável do runtime e evita acoplar ao banco de 230 MB.
- Decisão: esta fase é só leitura ao vivo (sessões, status, ferramentas, subagentes, aprovação e tokens); terminal, histórico e mensagens ficam para depois.
- Risco aceito: hooks de sessão nem sempre trazem `cwd`; a sala usa o `terminal.cwd` do perfil e pode ser forçada por `HABBLAUD_HERMES_PROJECT`.

## SPEC → PROMPT PLAN — 2026-11-19

- Decisão: cada perfil do Hermes vira uma conta (`developer`, `orchestrator`...), porque o perfil é a identidade que a sessão herda; o `AccountsService` resolve ids duplicados.
- Decisão: o plugin publica em uma fila + thread daemon, não direto no hook — um Habblaud lento ou fora do ar não pode atrasar uma ferramenta ou um turno.
- Risco aceito: evento perdido com o Habblaud fora do ar; o escritório é observabilidade, não uma fila durável.

## TDD → BUILD — 2026-11-19

- Decisão: tokens usam `prompt/input` inclusivo e `output`; cache e raciocínio não são somados de novo, como no adaptador do agent-office-local.
- Decisão: `event_id` e `call_id` deduplicam eventos repetidos; `usage_id` deduplica a mesma tentativa de API.
- Risco aceito: sessão sem `session_end` (processo morto) sai só na varredura de 2 h.

## BUILD → EVIDÊNCIAS — 2026-11-19

- Decisão: o instalador usa symlink (como o pixel-office) e `hermes plugins enable` por perfil; não edita YAML na mão, só usa `hermes config set` para as chaves do plugin.
- Decisão: a rota segue a trava dos eventos do Codex (Host local + loopback fora do Docker); no Docker o plugin fala com a porta publicada.
- Risco aceito: a Fase A só observava aprovações; a Fase B adiciona o transport e o cartão do escritório.

## SPEC → PROMPT PLAN (Fase B) — 2026-11-19

- Decisão: o terminal vem dos hooks (`pre/post_llm_call`, `tool_start`/`tool_end`) para um buffer por agente, não de transcript/SQLite — o plugin já tem o texto e não precisa de API key.
- Decisão: mensagens usam o `ctx.inject_message` oficial do Hermes, com a caixa do plugin e `retry` quando outro processo do perfil não é o dono da sessão.
- Decisão: aprovações usam o `register_approval_transport` oficial; `allow` vira `once` e `deny` vira `deny`.

## TDD → BUILD (Fase B) — 2026-11-19

- Decisão: o instalador liga `security.approval.transport: habblaud` com `transport_fallback: builtin` — sem página, o Hermes volta ao prompt do terminal em vez de negar.
- Decisão: a conversa é mascarada/cortada no servidor com as mesmas regras do terminal do Claude Code; o plugin só manda o que o hook entregou.
- Risco aceito: o terminal não lista sessões encerradas/antigas; isso exigiria `state.db` ou a API autenticada.

## BUILD → EVIDÊNCIAS (Fase B) — 2026-11-19

- Decisão: o cartão de permissão do Hermes só oferece aprovar/recusar (sem “sempre permitir”); o transport não devolve escopo `session`/`always`.
- Decisão: o endpoint `/api/hermes/sessions` é local e lista só as sessões principais vivas, para o plugin buscar mensagens sem conhecer o banco.
- Risco aceito: mensagens para uma sessão que nenhum processo do perfil tem falham no prazo da fila; o plugin devolve `retry` para os outros processos tentarem.

## EVIDÊNCIAS → PR (Fase B) — 2026-11-19

- Decisão: cada perfil do Hermes tem a própria pasta `plugins/`, então o instalador cria o symlink também em `profiles/*/plugins` — o link da base sozinho não chega aos perfis (descoberto na instalação real).
- Risco aceito: instalar em 27 perfis é mais lento e mexe em cada `config.yaml` via `hermes config set`; o uninstall limpa as três chaves e os symlinks.

## EVIDÊNCIAS → PR (nome da conta) — 2026-11-19

- Decisão: a conta do Hermes mostra `Hermes` + iniciais do perfil (até 3 no nome, até 2 no chip), em vez do nome inteiro do perfil; as contas do Claude Code ficam como estão.
