# habblaud — plugin do Hermes

Plugin do [Hermes](https://hermes-agent.nousresearch.com/) para o Habblaud local: mostra em tempo real o que cada
sessão está fazendo, serve o terminal do escritório, entrega mensagens na sessão e responde aprovações pelo
escritório. Nunca bloqueia o agente.

## O que aparece no escritório

- **Sessões:** abertura, primeiro turno, ociosidade e encerramento.
- **Terminal:** histórico do primeiro turno, prompts, respostas, ferramentas e resultados da sessão aberta (e do
  subagente), no mesmo terminal do Claude Code/Codex.
- **Ferramentas:** comando/arquivo/busca que o agente está usando, no mesmo cartão do Claude Code/Codex.
- **Subagentes:** `delegate_task` vira um subagente no escritório; ferramentas da sessão filha ficam nele.
- **Mensagens:** a caixa do escritório injeta o texto na sessão com `ctx.inject_message`; a mensagem só é confirmada
  quando o Hermes aceita.
- **Aprovações:** o pedido vira um cartão no escritório; aprovar/recusar responde ao Hermes e “Responder no terminal”
  devolve o pedido para lá (o prompt embutido aparece).
- **Tokens:** `post_api_request` soma entrada/saída por sessão (sem custo, que o Hermes não informa).
- **Contas e salas:** cada perfil do Hermes (`~/.hermes/profiles/<nome>` ou `~/.hermes`) vira uma conta com o nome
  “Hermes” + as iniciais do perfil; a sala é o `terminal.cwd` do perfil (ou `HABBLAUD_HERMES_PROJECT`).
- **Presença:** um heartbeat a cada 30 s mantém a sessão viva no escritório e a traz de volta sozinha depois de
  reiniciar o Habblaud. No gateway multi-perfil, só o plugin do perfil dono da sessão publica.

Sessões encerradas/antigas ficam fora: o plugin só observa sessões vivas.

## Instalação

Do checkout do Habblaud:

```sh
npm run hermes:install
```

O instalador cria o symlink `~/.hermes/plugins/habblaud` e um em cada `~/.hermes/profiles/*/plugins/`, habilita o
plugin no perfil padrão e em cada perfil e configura, por perfil:

- `plugins.entries.habblaud.allow_gateway_injection: true` — permite o `ctx.inject_message` nas sessões TUI/gateway;
- `security.approval.transport: habblaud` — as aprovações passam pelo escritório;
- `security.approval.transport_fallback: builtin` — sem página aberta, o Hermes volta ao prompt do terminal.

Para remover: `npm run hermes:uninstall` (desabilita e limpa as três chaves). Para conferir: `npm run hermes:status`.

Se preferir na mão:

```sh
ln -s "$(pwd)/mod/habblaud-hermes" ~/.hermes/plugins/habblaud
ln -s "$(pwd)/mod/habblaud-hermes" ~/.hermes/profiles/developer/plugins/habblaud
hermes plugins enable habblaud
hermes -p developer plugins enable habblaud
hermes -p developer config set plugins.entries.habblaud.allow_gateway_injection true
hermes -p developer config set security.approval.transport habblaud
hermes -p developer config set security.approval.transport_fallback builtin
# repita o symlink e os config set com -p <perfil> em cada perfil
```

Reinicie as sessões do Hermes depois de instalar.

## Configuração

| Variável | Efeito |
| --- | --- |
| `HABBLAUD_HERMES=0` | desliga o plugin (aceita `false`, `off`, `no`) |
| `HABBLAUD_HERMES_URL` | URL completa do POST (padrão `http://127.0.0.1:4747/api/hermes/events`) |
| `HABBLAUD_PORT` | porta do Habblaud quando a URL não é dada |
| `HABBLAUD_HERMES_PROJECT` | força a sala do escritório (senão usa `terminal.cwd` do perfil) |
| `HABBLAUD_HERMES_HOME` | pasta base do Hermes no instalador (padrão `~/.hermes`) |

A publicação é assíncrona (fila de 256 eventos + thread daemon, POST com prazo de 1,5 s). Habblaud fora do ar, fila
cheia ou JSON estranho: o evento é descartado em silêncio, com no máximo um aviso por minuto no log do Hermes. A
caixa de mensagens é buscada a cada 2 s; sem o Habblaud, nada acontece.

## O que ele acessa

Hooks do Hermes (os opcionais só entram quando `hermes_cli.plugins.VALID_HOOKS` os conhece):
`on_session_open`, `on_session_start`, `on_session_end`, `on_session_finalize`, `on_session_reset`,
`on_session_delete`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`, `subagent_start`,
`subagent_stop`, `pre_approval_request`, `post_approval_response` e `post_api_request`; `ctx.inject_message` e
`ctx.register_approval_transport`.

Não lê transcript nem SQLite, não usa `os.environ` além das variáveis acima, não grava arquivos e fala só com
`127.0.0.1`.
