# Decisões: habblaud-H1 — ponte de sessões vivas

## DOR → SPEC — 2026-11-24

- Decisão: a lista de sessões do seletor sai das execuções (`workerSessionId` + `provider` + `cwd`), montada no servidor do Habblaud — o pipeline apagou `/api/agent/sessions` e `participants`, e o cliente nunca escolhe destino fora da lista do servidor.
- Decisão: seletor com sugestão automática do roteador e troca manual — a pessoa pediu para escolher a sessão, e o roteador por regra fixa já existe no branch da ponte; descartado: só automático (não atende o pedido) e só manual (perde o padrão sensato).
- Risco aceito: sessões fechadas aparecem mas não recebem mensagem até a reabertura (H6) existir; só vale a pena para harness com comando verificado, e isso fica para outra tarefa.

## TDD → BUILD — 2026-11-24

- Decisão: a escolha manual vale só se a sessão estiver na lista que o servidor montou (`400 unknown_session` fora dela) — o navegador nunca aponta um destino por conta própria; descartado: aceitar `agentId` direto do cliente.
- Decisão: enquanto a lista carrega (ou falhou), o envio vai sem `session` e o servidor usa a sugerida — o atalho de perguntas dispara 90 ms após abrir a gaveta e não pode perder a pergunta.
- Risco aceito: sessão aberta sem o plugin de mensagens aparece "fechada", porque o roteador só considera viva a que aceita mensagem.

## BUILD → PR — 2026-11-24

- Decisão: agente do escritório sem `provider` é tratado como `claude` no `converse` — achado no servidor real (a sessão `ae476a5b` aparecia fechada); os testes com agentes falsos de provider explícito não pegaram isso.
- Decisão: a lista de sessões não se atualiza sozinha; reabrir a gaveta ou o plano recarrega — a presença volta ~10 s depois de reiniciar o Habblaud e uma atualização periódica ficou fora do escopo.
- Risco aceito: o envio de ponta a ponta (CA09) não foi executado, porque a única sessão viva do `roadmap-gate` é de outro agente e o envio precisa da aprovação da pessoa.

