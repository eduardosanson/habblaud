# Spec: Antigravity no escritório (MVP)

## Contexto de negócio

Quem usa o Antigravity CLI (`agy`) não aparece no Habblaud. O CLI expõe hooks em `~/.gemini/config/hooks.json` e o
próprio comando de uso (`agy -p "/usage" --output-format json`); dá para mostrar sessões e limites sem plugin Python,
sem ler credenciais e sem tocar no banco de conversas.

## Escopo desta fase

- Sessões principais por hook: `session_start`, `session_busy`, `session_idle`, `session_end`, `tool_start`, `tool_end`.
- Sala pelo `cwd`/projeto; título pelo `lastUserInput`; modelo e atividade da ferramenta.
- Uso do plano pelos grupos do Google no `agy`: `Gemini Models` e `Gemini 4 Argon` (excluindo modelos de terceiros
  como `Claude and GPT models`). O cartão mostra cada janela diretamente (uma embaixo da outra) e a dica lista os detalhes.
- Instalador `antigravity:install|uninstall|status`, preservando os grupos de hooks existentes.

## Fora de escopo

- Terminal/histórico de conversas, permissões, mensagens pelo escritório e subagentes.
- Habblaud World (o protocolo só aceita Claude/Codex).
- Docker (o hook e o `agy` rodam no host).

## Critérios de aceite

- Com um hook `SessionStart`, o agente `provider: 'antigravity'` aparece na sala do `cwd`, com conta `antigravity`.
- Um `PreToolUse` vira atividade; `Stop` deixa ocioso; `SessionEnd` encerra.
- O cartão mostra as piores janelas e a dica os grupos do `agy`.
- `npm run antigravity:install` mantém os grupos Orca/ai-memory/agent-office e adiciona/remover só `habblaud`.
- Sem `agy` autenticado, a fonte funciona e o cartão fica "sem dados ainda"; nenhum erro derruba o servidor.

## DOD

- Testes da fonte e do parser de uso; typecheck, build e i18n verdes.
- README e CHANGELOG atualizados.
