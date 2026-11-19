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
   - `scripts/hermes-install.ts`: symlink em `~/.hermes/plugins/habblaud`, `hermes plugins enable` no padrão e nos
     perfis, `--dry-run`, `--no-enable`, `--force`, uninstall e status.
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
