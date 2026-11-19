## DOR → SPEC — 2026-11-19

- Decisão: integrar o OpenCode pela API HTTP local + SSE, não pelo SQLite — o serviço já é a fonte da verdade e evita acoplar ao schema de 1,1 GB.
- Decisão: a Fase A é só leitura (personagens, status, atividades, subagentes e uso); terminal, permissões e mensagens ficam para fases seguintes.
- Risco aceito: a API do OpenCode é experimental; a fonte valida a versão e falha fechada sem derrubar o servidor.

## SPEC → PROMPT PLAN — 2026-11-19

- Decisão: presença = sessão ativa ou vista/atualizada nas últimas 2 h, configurável — sem isso, dezenas de sessões antigas lotariam o escritório.
- Decisão: agentes do OpenCode ficam fora do Habblaud World até o protocolo aceitar `opencode`; não serão enviados como `claude`.
- Risco aceito: no Docker a fonte fica desligada nesta fase, porque o `service.json` e o loopback do host não são acessíveis de dentro do container.

## TDD → BUILD — 2026-11-19

- Decisão: o cliente HTTP usa o `fetch` nativo e um parser SSE de ~60 linhas em vez de `@opencode/client` — mantém zero dependências de runtime e o mesmo contrato do resto do servidor.
- Decisão: a conta é uma só (`opencode`) com id/letra `O`; o `agent` da sessão vira o papel, não uma conta separada — o OpenCode não tem perfis como o Hermes.
- Risco aceito: sessões vistas nas últimas 2 h continuam no escritório mesmo ociosas; a janela é configurável e evita que o histórico inteiro lote o prédio.

## BUILD → EVIDÊNCIAS — 2026-11-19

- Decisão: agentes do OpenCode são filtrados da projeção do World enquanto o protocolo só aceitar Claude/Codex — melhor omitir do que rotular a ferramenta errada.
- Decisão: a Fase A não cria cartão de permissão nem caixa de mensagem; o agente só levanta a mão em `permission.asked`, e a resposta continua no OpenCode.
- Risco aceito: a API do OpenCode é experimental; o adaptador valida a versão major e falha fechado, com testes de fixtures e um smoke local.

## SPEC → PROMPT PLAN (Fase B) — 2026-11-19

- Decisão: `MessageStream` é uma costura OPCIONAL em `AgentSource`/`HistorySession`; Claude Code e Codex continuam síncronos e o terminal escolhe o stream antes do arquivo — menor risco de regressão.
- Decisão: o histórico do OpenCode tem uma única conta (`opencode`) e lista só sessões raiz não arquivadas dos últimos 7 dias; subagentes aparecem no escritório, mas não no histórico, como nas outras ferramentas.
- Risco aceito: sessões do OpenCode não têm `size` de transcript; o campo vai `0` e a UI omite o tamanho em vez de inventar um valor.

## TDD → BUILD (Fase B) — 2026-11-19

- Decisão: texto do assistant só entra quando a mensagem termina, raciocínio quando o bloco termina e ferramenta ao começar (resultado ao acabar) — evita reemitir blocos que crescem a cada poll.
- Decisão: a página de mensagens é `limit=100&order=desc`, invertida para ordem cronológica; o `init` corta em 500 entradas e marca `truncated`.
- Risco aceito: entre dois polls (>1 s) uma sessão pode trocar mais de 100 mensagens; nesse caso as mais antigas dessa janela ficam de fora, sem derrubar o terminal.

## BUILD → EVIDÊNCIAS (Fase B) — 2026-11-19

- Decisão: o `resolve()` do histórico não lista sessões a cada clique; um id bem formado é validado na primeira leitura de mensagens e o 404 do serviço vira 404 JSON no terminal.
- Decisão: o polling assíncrono tem trava por conexão (`busy`) e `opencode:smoke` passou a abrir histórico e terminal, para provar as duas rotas contra o serviço real.
- Risco aceito: permissões e mensagens continuam só no OpenCode; o World segue sem `opencode` até o protocolo de lá aceitar a ferramenta.
