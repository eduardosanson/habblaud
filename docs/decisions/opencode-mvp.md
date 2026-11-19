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
