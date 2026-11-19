# habblaud — plugin do Hermes

Plugin observador do [Hermes](https://hermes-agent.nousresearch.com/): manda para o Habblaud local, em tempo real, o
que cada sessão está fazendo. Não lê a conversa, não manda prompt e nunca bloqueia o agente.

## O que aparece no escritório

- **Sessões:** abertura, primeiro turno, ociosidade e encerramento.
- **Ferramentas:** comando/arquivo/busca que o agente está usando, no mesmo cartão do Claude Code/Codex.
- **Subagentes:** `delegate_task` vira um subagente no escritório; ferramentas da sessão filha ficam nele.
- **Aprovações:** o agente levanta a mão quando o Hermes pede aprovação; a resposta continua no Hermes.
- **Tokens:** `post_api_request` soma entrada/saída por sessão (sem custo, que o Hermes não informa).
- **Contas e salas:** cada perfil do Hermes (`~/.hermes/profiles/<nome>` ou `~/.hermes`) vira uma conta; a sala é o
  `terminal.cwd` do perfil (ou `HABBLAUD_HERMES_PROJECT`).

Terminal e histórico do Hermes ainda não existem: esta fase é só leitura ao vivo.

## Instalação

Do checkout do Habblaud:

```sh
npm run hermes:install
```

O instalador cria o symlink `~/.hermes/plugins/habblaud` e habilita o plugin no perfil padrão e em cada
`~/.hermes/profiles/*`. Para remover: `npm run hermes:uninstall`. Para conferir: `npm run hermes:status`.

Se preferir na mão:

```sh
ln -s "$(pwd)/mod/habblaud-hermes" ~/.hermes/plugins/habblaud
hermes plugins enable habblaud
hermes -p developer plugins enable habblaud   # repita por perfil
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
cheia ou JSON estranho: o evento é descartado em silêncio, com no máximo um aviso por minuto no log do Hermes.

## O que ele acessa

Hooks do Hermes (os opcionais só entram quando `hermes_cli.plugins.VALID_HOOKS` os conhece):
`on_session_open`, `on_session_start`, `on_session_end`, `on_session_finalize`, `on_session_reset`,
`on_session_delete`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`, `subagent_start`,
`subagent_stop`, `pre_approval_request`, `post_approval_response` e `post_api_request`.

Não lê transcript, não usa `os.environ` além das variáveis acima, não grava arquivos e fala só com `127.0.0.1`.
