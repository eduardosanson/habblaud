# Prompt Plan: Hermes no escritório (Fase A)

## Ordem de implementação

1. [x] Tipos e UI
   - `Provider` ganha `'hermes'`; `PROVIDER_NAME`, selo, chip, busca e `emptyOfficeHint` incluem Hermes.
   - Compositor e terminal explicam que Hermes ainda não tem mensagens/terminal, em vez de mostrar a dica do plugin
     do Claude Code.
   - World filtra `hermes` (o protocolo ainda só aceita Claude Code/Codex).
2. [x] Eventos puros + testes
   - `server/sources/hermes/events.ts`: timestamp, preview mascarado, atividade por ferramenta, tokens inclusivos e
     `usage_id`.
3. [x] Fonte + testes
   - `HermesSource`: conta por perfil, sala pelo projeto/`terminal.cwd`, sessão, status, ferramentas, subagentes,
     aprovação, uso, sweep e dedupe.
   - `sources()` vazio até o primeiro evento; nunca aparece para quem não usa Hermes.
4. [x] Rota + testes
   - `POST /api/hermes/events` local (Host + loopback, como o Codex), JSON até 256 KB, `{ok}`.
   - `ApiDeps.hermes` e `hermesEvents` em `/api/health`.
5. [x] Plugin Python
   - `mod/habblaud-hermes/__init__.py`: hooks observadores, fila assíncrona, POST local, `HABBLAUD_HERMES=0`,
     `HABBLAUD_HERMES_URL`, `HABBLAUD_HERMES_PROJECT`.
   - `plugin.yaml` + README.
   - `tests/test_plugin.py` com `_post` falso (sem sessão real).
6. [x] Instalador
   - `scripts/hermes-install.ts`: symlink em `~/.hermes/plugins/habblaud` e em `~/.hermes/profiles/*/plugins/`,
     `hermes plugins enable` no padrão e nos perfis, `--dry-run`, `--no-enable`, `--force`, uninstall e status.
   - Scripts npm `hermes:install/uninstall/status`.
7. [x] Documentação e evidências
   - Spec, prompt plan, decisões, CHANGELOG, README do servidor, README do plugin e traduções.
   - Teste ponta a ponta com o plugin e um Habblaud real (eventos sintéticos no perfil de teste).

## Dependências

- Nenhuma issue/PR bloqueante.
- Hermes com plugins Python (`hermes_cli.plugins`) e os hooks listados em `VALID_HOOKS`; hooks opcionais são
  detectados em tempo de execução.

## Riscos identificados

- **Sem transcript nesta fase:** o escritório mostra atividade e status, não a conversa; terminal/histórico ficam
  para a fase seguinte.
- **Sala sem cwd por sessão:** os hooks de sessão não trazem `cwd` em todas as versões; o plugin usa o
  `terminal.cwd` do perfil e permite `HABBLAUD_HERMES_PROJECT`.
- **Gateway com vários perfis:** o perfil e o `HERMES_HOME` são resolvidos no contexto de cada hook; nunca são
  cacheados no processo.
- **Fila e servidor fora do ar:** eventos são perdidos (observabilidade), nunca bloqueiam o agente.
- **Hook novo em versão antiga:** nomes opcionais só são registrados se `VALID_HOOKS` os conhecer; os hooks centrais
  existem desde as versões com plugins.

## Fase B — terminal, mensagens e aprovações

### Ordem de implementação

1. [x] Terminal pelos hooks
   - `pre_llm_call` manda `history` (primeiro turno), `user_message` e `session_busy`;
     `post_llm_call` manda `assistant_message` e `session_idle`.
   - `pre_tool_call` manda `input` (args JSON-safe); `post_tool_call` manda `result`.
   - `HermesSource` guarda um buffer por agente e `messageStream(agentId)` serve o SSE do terminal.
   - `hermesToolView` traduz as ferramentas do Hermes para `Bash/Read/Edit/Write/...`.
2. [x] Mensagens
   - `/api/hermes/sessions` lista as sessões principais para o plugin.
   - O plugin busca `/api/mod/inbox` (`provider: hermes`), injeta com `ctx.inject_message` e confirma.
   - Outro processo do mesmo perfil devolve `retry`; a mensagem volta para `queued`.
   - `MessageRegistry` aceita `provider: hermes`, presença por `seen` e `entry.hermes`.
3. [x] Aprovações
   - Plugin registra `ctx.register_approval_transport('habblaud', present)`.
   - `present` manda `provider: hermes` para `/api/permissions` e espera; `allow` = `once`, `deny` = `deny`.
   - `PermissionRegistry` aceita `provider: hermes`, `hermesToolView` e cartão com a nota do transport.
   - Instalador liga `security.approval.transport: habblaud` + `transport_fallback: builtin` por perfil.
4. [x] Instalador
   - Configura `allow_gateway_injection` e as duas chaves de aprovação; uninstall limpa.
5. [x] Testes e documentação
   - Fonte/terminal, registry de mensagens (incluindo retry), permissões, plugin (history/mensagens/transport),
     instalador, UI e traduções.
   - Evidência ponta a ponta: terminal SSE, caixa/ack e cartão de aprovação no servidor real.

### Dependências

- Hermes com `ctx.inject_message` e `ctx.register_approval_transport` (versões recentes); hooks `pre/post_llm_call`.
- O plugin precisa de `plugins.entries.habblaud.allow_gateway_injection: true` para injetar em sessões TUI/gateway.

### Riscos da Fase B

- **Histórico antigo:** só sessões vivas entram no terminal; o `state.db`/API autenticada fica fora.
- **Múltiplos processos do mesmo perfil:** o primeiro que busca a mensagem pode não ser o dono da sessão; o `retry`
  devolve à fila para o dono buscar.
- **Aprovação sem página:** o transport lança e o Hermes usa o prompt embutido (`transport_fallback: builtin`).
- **Sempre permitir:** o transport só responde `once`/`deny`; escopos de sessão/permanente ficam no terminal.
- **Habblaud reiniciado:** sem o heartbeat, o agente só voltaria no próximo turno; o plugin manda um sinal a cada
  30 s e o escritório recria a sessão viva.
