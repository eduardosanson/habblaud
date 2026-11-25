# Spec: Markdown formatado na gaveta do roadmap

## Contexto de Negócio
No teste manual do chat do roadmap, a resposta do agente volta com os símbolos do Markdown à mostra.

## Causa
`client/src/roadmap/conversation.ts` (`messageEl`) escreve `message.text` como texto puro. O renderizador seguro
`client/src/ui/markdown.ts`, já usado no terminal e nas entregas, não é chamado, e os estilos `.ui-md` só existem em
`client/src/ui/styles.css`, que a página do roadmap não carrega.

## Requisitos Funcionais
- RF01: a resposta do agente é montada com `renderMarkdown`.
- RF02: a mensagem da pessoa continua em texto puro.
- RF03: a página do roadmap estiliza os elementos `.ui-md` com as cores dela.

## Requisitos Não-Funcionais
- RNF01: nenhum texto da resposta passa por `innerHTML`; links não ficam clicáveis (endereço na dica).
- RNF02: blocos de código e tabelas rolam dentro do balão, sem rolagem horizontal na página.

## Critérios de Aceite
- CA01: dada uma resposta com `**negrito**`, lista e bloco de código, então a gaveta mostra os elementos formatados.
- CA02: dada uma resposta com `<img onerror=...>`, então o texto aparece literalmente e nada é executado.
- CA03: dada uma pergunta da pessoa com `**`, então os asteriscos aparecem como foram digitados.

## Definition of Done (DOD)
- [ ] Teste escrito antes da correção, e passando
- [ ] `npm run typecheck`, `npm run i18n:check` e `npm run build` verdes; suíte sem novas falhas
- [ ] CHANGELOG em "Não lançado"
- [ ] Validação manual na gaveta e passo a passo no PR

## Fora de Escopo
Links clicáveis, destaque de sintaxe, tabelas em HTML e mudanças no renderizador.
