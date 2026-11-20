# Limites das contas do Codex e do OpenCode

## TDD → BUILD — 2026-11-20

- Decisão: o uso do Codex é semeado em todo boot, não só quando a conta ainda não tem números — uma sessão aberta e parada pode ter a última leitura antiga e esconder um rollout fechado mais novo; `pushUsage` continua vencendo pelo maior `fetchedAt`.
- Risco aceito: o boot lê o rollout mais recente com números mesmo com sessão aberta (até 8 arquivos, só o fim de cada um); o custo é pequeno e o número deixa de ficar preso na sessão parada.
- Decisão: o cartão do OpenCode ganha a terceira janela (`monthly`) e a barra superior cresce 15 px só quando ela existe (`has-monthly`) — mostra o limite que o serviço já informava sem espremer os cartões.
- Decisão: o uso do OpenCode é relido a cada 15 s em um timer próprio, em vez de esperar o poll de 60 s — a semana/mês acompanham o serviço de perto sem aumentar a releitura de sessões.
- Risco aceito: uma requisição local extra a cada 15 s; o serviço é loopback e a rota é experimental, com erro ignorado sem derrubar a fonte.
- Decisão: `UsageStore.view` mantém as janelas vencidas (em vez de apagá-las) para o cliente trocar o percentual por “—” e o reinício por “renovada” — apagar fazia o limite de 5 h do Codex sumir quando a janela reiniciava.
- Risco aceito: o snapshot carrega uma janela antiga sem utilidade para o cálculo; o cliente é a única tela que lê esses números e sempre confere `resetsAt` antes de mostrá-los.
