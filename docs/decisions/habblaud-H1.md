# Decisões: habblaud-H1 — ponte de sessões vivas

## DOR → SPEC — 2026-11-24

- Decisão: a lista de sessões do seletor sai das execuções (`workerSessionId` + `provider` + `cwd`), montada no servidor do Habblaud — o pipeline apagou `/api/agent/sessions` e `participants`, e o cliente nunca escolhe destino fora da lista do servidor.
- Decisão: seletor com sugestão automática do roteador e troca manual — a pessoa pediu para escolher a sessão, e o roteador por regra fixa já existe no branch da ponte; descartado: só automático (não atende o pedido) e só manual (perde o padrão sensato).
- Risco aceito: sessões fechadas aparecem mas não recebem mensagem até a reabertura (H6) existir; só vale a pena para harness com comando verificado, e isso fica para outra tarefa.
