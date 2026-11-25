# Decisões: reabrir sessão finalizada pelo roadmap

## SPEC → TDD — 2026-11-24

- Decisão: reabrir só Claude Code, pelo `PtyManager` que já roda `claude --resume`; Codex ficou de fora porque o terminal interativo só executa o `claude` e não havia sessão de Codex para validar.
- Decisão: a pasta vem do transcript local, nunca do `cwd` do pipeline — abrir o Claude Code numa pasta carrega os hooks e permissões dela, e o pipeline pode ser remoto.
- Risco aceito: sem `HABBLAUD_PTY=1` o botão responde com a explicação em vez de reabrir; ligar o terminal interativo é escolha de quem usa.

## TDD → BUILD — 2026-11-24

- Decisão: ao parar no aviso de pasta não confiável, encerrar o terminal e explicar — a sessão não aparece no escritório nesse estado, e confirmar a confiança não cabe ao Habblaud.
- Decisão: mandar número e título do item junto da pergunta — no teste real a sessão não sabia a que "5.1" a pergunta se referia.
- Risco aceito: o aviso é reconhecido pelo texto "Yes, I trust this folder"; se o Claude Code mudar o texto, volta a aparecer só a mensagem de espera esgotada.
