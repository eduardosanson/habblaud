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

- Decisão: o instalador usa symlink (como o pixel-office) e `hermes plugins enable` por perfil; não edita YAML nem mexe em confiança/permissões.
- Decisão: a rota segue a trava dos eventos do Codex (Host local + loopback fora do Docker); no Docker o plugin fala com a porta publicada.
- Risco aceito: o plugin não responde aprovações; o agente fica `waiting` e a decisão continua no Hermes.
