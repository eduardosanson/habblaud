# Antigravity no Habblaud

## DOR → SPEC — 2026-11-20

- Decisão: entrar pelo **hook do `agy`** (`~/.gemini/config/hooks.json`), não por banco de conversas — o CLI já entrega `conversationId`, `cwd`, `lastUserInput` e ferramentas por evento, sem ler credenciais.
- Decisão: o uso vem do próprio `agy -p "/usage" --output-format json`; os grupos (Gemini, Claude/GPT, Argon) são mais fiéis que um único percentual.
- Risco aceito: o cartão usa a pior janela entre os grupos para avisar o quanto antes; o detalhe por grupo fica na dica.

## SPEC → PROMPT PLAN — 2026-11-20

- Decisão: um `AntigravitySource` com conta única `antigravity` e eventos normalizados pelo hook (`session_*`, `tool_*`), para o servidor não depender dos nomes internos do runtime.
- Decisão: terminal/histórico/permissões ficam fora do MVP; a fonte não finge um `transcriptPathOf`.
- Risco aceito: o `agy` é chamado a cada 60 s para o uso; sem login/binário o cartão fica sem dados e a fonte continua.

## TDD → BUILD — 2026-11-20

- Decisão: o instalador grava um grupo `habblaud` e faz backup do `hooks.json`, preservando Orca/ai-memory/agent-office; o uninstall remove só o grupo.
- Decisão: o cartão mostra a pior 5 h/semana e a dica lista cada grupo — evita escolher arbitrariamente Gemini ou Claude/GPT.
- Risco aceito: o hook roda um processo Node por callback; o timeout de 1,5 s e o exit 0 garantem que o agente nunca espere pelo Habblaud.
