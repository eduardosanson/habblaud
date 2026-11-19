# Prompt Plan: OpenCode no escritório (Fase A)

## Ordem de implementação

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

## Dependências

- Nenhuma issue/PR bloqueante.
- A API do OpenCode V2 é experimental; a fonte falha fechada e avisa no log.

## Riscos identificados

- **Mudança de contrato da API:** validar a versão major e isolar o parsing; testes com fixtures.
- **Excesso de sessões antigas:** janela de presença configurável (padrão 2 h) e exclusão de arquivadas.
- **Segredo local:** a senha do `service.json` só existe em memória; nenhum log/snapshot.
- **World:** não enviar `opencode` como outra ferramenta; filtrar até o protocolo suportar.
