# Prompt Plan: OpenCode no escritório

## Fase A — leitura ao vivo

### Ordem de implementação

1. [x] Tipos e configuração
   - `shared/types.ts`: `Provider` ganha `'opencode'`; `AccountUsage.source` ganha `'opencode'`.
   - `server/config.ts`: `opencode`, `opencodeUrl`, `opencodePassword`, `opencodeService`, `opencodeRecentMs`.
   - Ajustar os `Record<Provider, ...>` e assinaturas que o TypeScript apontar.
2. [x] Cliente do OpenCode + testes
   - Descoberta do `service.json`, validação de loopback, Basic auth, `GET`/`POST` JSON.
   - Parser SSE (`/api/event`) ignorando heartbeats.
   - Testes com `fetch` falso e `ReadableStream`.
3. [x] Mapeamento puro + testes
   - `parseSession`, `parseUsage`, `describeOpenCodeTool`, atividade/status por evento.
   - Testes de mesa para ferramentas, status e permissão.
4. [x] Fonte + testes de integração
   - Boot, presença, principais/subagentes, eventos, sweep, reconexão e uso.
   - `Office` + `AccountsService` + cliente falso.
5. [x] Registro no servidor
   - `server/index.ts`: instanciar quando o serviço existir ou quando `HABBLAUD_OPENCODE=1`.
   - `SourceSet` e `late`.
6. [x] UI
   - `client/src/ui/provider.ts`: nome, selo, chip e rótulos.
   - `widgets.ts`, `rows.ts`, `model.ts`, `history.ts`, `usage.ts` e CSS do chip/selo.
   - Testes de `provider` e `usage`.
7. [x] World
   - Excluir agentes `opencode` da projeção até o protocolo do World aceitar a ferramenta.
   - Teste na projeção.
8. [x] Documentação e evidências
   - `CHANGELOG.md` em "Não lançado".
   - Evidências de teste e passo a passo manual.

### Dependências

- Nenhuma issue/PR bloqueante.
- A API do OpenCode V2 é experimental; a fonte falha fechada e avisa no log.

### Riscos identificados

- **Mudança de contrato da API:** validar a versão major e isolar o parsing; testes com fixtures.
- **Excesso de sessões antigas:** janela de presença configurável (padrão 2 h) e exclusão de arquivadas.
- **Segredo local:** a senha do `service.json` só existe em memória; nenhum log/snapshot.
- **World:** não enviar `opencode` como outra ferramenta; filtrar até o protocolo suportar.

## Fase B — terminal e histórico

### Ordem de implementação

1. [x] Costura do stream
   - `sources/stream.ts`: `MessageStream { intervalMs?, load(), poll() }` e `MessageDelta`.
   - `AgentSource.messageStream?` e `SourceSet.messageStreamFor` (um stream novo por conexão).
   - `HistorySession` vira união: `{ path, createParser }` ou `{ stream() }`.
2. [x] Terminal do OpenCode + testes
   - `sources/opencode/terminal.ts`: `openCodeMessageEntries` (user, assistant, reasoning, tool, resultado,
     shell, compactação, system, synthetic, idle) e `OpenCodeMessageStream`.
   - Texto do assistant só quando a mensagem termina; raciocínio quando o bloco termina; ferramenta ao começar e
     resultado ao acabar; `streaming` espera os argumentos.
3. [x] Histórico do OpenCode + testes
   - `sources/opencode/history.ts`: `GET /api/session?limit=150&order=desc`, janela de 7 dias, raiz e não
     arquivadas, `provider: 'opencode'`, `size: 0`.
   - `resolve()` devolve `{ stream }`; id inválido = 400, conta/serviço desconhecido = 404.
4. [x] TerminalStreams assíncrono + testes
   - `load()`/`poll()` podem devolver promessa; `serve()` espera o `init` antes de abrir o SSE.
   - `messageStreamFor` tem precedência sobre `transcriptPathOf`; arquivo/demo seguem síncronos.
   - `pump()` não empilha (`busy`) e erro de fonte com `status` vira JSON 400/403/404.
5. [x] Registro no servidor
   - `server/index.ts`: `messageStreamFor` no `TerminalStreams` e `OpenCodeHistory` no `HistorySet`.
   - `OpenCodeSource.messageStream(agentId)` e `api()`.
6. [x] UI
   - Histórico já aceita `provider: 'opencode'`; o tamanho do transcript só aparece quando existe (`size > 0`).
7. [x] Documentação, traduções e evidências
   - Spec, prompt plan, decisions, `server/README.md`, CHANGELOG e locales (`[arquivo: {0}]`, `anexo`).
   - `opencode:smoke` passou a ler histórico e terminal do serviço real.

### Dependências

- Fase A (cliente, fonte, contas e eventos) já entregue.
- API experimental do OpenCode: `GET /api/session` e `GET /api/session/{id}/message` aceitam `limit` e `order`.

### Riscos da Fase B

- **Volume de mensagens:** a página mais recente é limitada a 100 mensagens e o `init` a 500 entradas; conversas
  maiores chegam com `truncated`.
- **Streaming do assistant:** o texto só entra quando a mensagem termina; o escritório continua mostrando o
  progresso pelas atividades e ferramentas ao vivo.
- **Polling:** 1 s por terminal aberto no agente e 2 s na sessão do histórico; o poll assíncrono não empilha.
- **Sessão desconhecida:** o `resolve()` não lista tudo a cada clique; o 404 vem da primeira leitura de mensagens.
