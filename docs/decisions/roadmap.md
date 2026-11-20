## DOR → PROTÓTIPO — 2026-11-19

- Decisão: página isolada em `client/roadmap-prototipo.html` e `client/src/roadmap-prototipo/`, fora do input do Vite e da varredura do `i18n:check`, para avaliar as telas sem alterar o escritório nem o build de produção.
- Decisão: um único roadmap fictício com 7 fases e 36 planos, progresso por planos concluídos/total e três hierarquias na mesma página (visão geral, fases + detalhe e trabalho agora).
- Risco aceito: o protótipo é uma peça de avaliação em PT-BR; os textos passam por `tr()`, mas ficam sem traduções novas em `shared/locales/` até a funcionalidade ser decidida.

## PROTÓTIPO → EVIDÊNCIAS — 2026-11-19

- Decisão: conversa 100% roteirizada por contexto e sessão, com cartão de referência ao plano; nenhuma API, sessão real, autenticação ou envio de mensagem.
- Decisão: o rascunho de plano é um formulário local com prévia e toast de simulação; “Publicar” fica desabilitado e “Salvar” não grava nada.
- Risco aceito: no celular, detalhe e conversa viram folhas fixas; ao reduzir a janela com um plano aberto, a folha de detalhe pode aparecer já aberta — comportamento intencional para inspeção.

## PROTÓTIPO → PORTFÓLIO — 2026-11-19

- Decisão: `Roadmap` vira o contêiner de fases, marcos e atividade; planos e fases usam chave composta `roadmapId:planId`, porque dois roadmaps podem ter o mesmo número de fase/plano.
- Decisão: a troca acontece em dois níveis — índice de roadmaps na barra superior e seletor “Roadmap atual” na página; rascunhos são guardados por roadmap e a conversa carrega o roadmap no contexto.
- Risco aceito: trocar de roadmap zera filtro, busca e detalhe aberto, e reinicia o contexto da conversa para o roadmap novo; é uma navegação de nível superior, não uma edição do mesmo roadmap.

## PORTFÓLIO → ITENS — 2026-11-19

- Decisão: fases viram épicos e os planos recebem tipo `story | task | bug`; vínculos canônicos (`caused_by`, `fixes`, `blocks`, `relates_to`, `duplicates`) e o lado inverso é derivado, não duplicado.
- Decisão: peso XS–XL é uma classe explicável e a estimativa é uma faixa P50/P80 em tokens; dias humanos ficam como leitura derivada, nunca como a mesma unidade. O classificador é uma rubrica determinística, calibrável com o realizado.
- Risco aceito: o bug 3.7 e a correção 3.8 entram no denominador (36 → 38) porque são itens com critérios; o progresso continua por itens e o esforço é lido separado, para não transformar tamanho em progresso.

## ITENS → CONSUMIDOR — 2026-11-19

- Decisão: todo o gerenciamento do roadmap (roadmaps, itens, status, vínculos, peso, estimativa, calibração e orquestração) fica no projeto `hermes-pipeline`; o Habblaud passa a ser consumidor.
- Decisão: o Habblaud recebe snapshot/eventos com IDs estáveis do Hermes Pipeline e só renderiza, filtra e abre detalhe; não gera IDs, não persiste e não escreve estado.
- Risco aceito: o protótipo atual ainda tem “Novo item”, rascunho, “Sugerir peso” e “Publicar” como prévia de gestão; na próxima rodada eles saem ou viram “Gerenciar no Hermes Pipeline”, e o selo de fonte/versão entra no cabeçalho.

## CONSUMIDOR → CONVERSA — 2026-11-19

- Decisão: a gestão do dia a dia é conversa com o agente; o Habblaud não expõe CRUD. O agente chama as ferramentas do `hermes-pipeline`, que valida, aplica e persiste a mudança.
- Decisão: o Habblaud mostra a conversa, o recibo da ação e o roadmap atualizado por snapshot/SSE; sem escrita local e sem UI otimista.
- Risco aceito: o protótipo ainda tem rascunho/classificador locais como prévia da gestão do pipeline; a próxima rodada os troca por prompts (“mova o 3.7 para concluído”, “crie uma task M…”) e recibos de ação do agente.

## CONVERSA → INTEGRAÇÃO — 2026-11-19

- Decisão: o protótipo passou a consumir o `hermes-pipeline` de verdade por `GET /api/roadmaps`, snapshot, SSE e API de conversa; o token do Habblaud fica no proxy do Vite, nunca no navegador.
- Decisão: rascunho, classificador, “Novo item/plano” e “Publicar” saíram; a única escrita vem do agente, e a tela mostra mensagem, recibo `applied`/`rejected` e o snapshot recarregado (sem UI otimista).
- Risco aceito: a integração é de desenvolvimento (`/pipeline-api` no Vite) e a página continua fora do build; produção exige um proxy no servidor do Habblaud e o token de serviço.
- Risco aceito: `review` aparece na faixa “em andamento” e roadmap importado sem peso/estimativa mostra “sem estimativa”; o consumidor não inventa classificação nem número.

## INTEGRAÇÃO → FEATURE — 2026-11-19

- Decisão: o roadmap virou rota real `/roadmap` dentro do mesmo `client/index.html` e do mesmo build; o `main.ts` escolhe o app pelo caminho e o escritório ganha um botão na barra superior.
- Decisão: o token do Hermes Pipeline fica no servidor do Habblaud (`HABBLAUD_ROADMAP_TOKEN`) e o navegador fala com `/api/roadmap/*`; o proxy limita as rotas ao contrato de leitura/conversa, repassa SSE e só atende a porta local.
- Decisão: sem token o recurso fica desligado (status explica o motivo e o botão desaparece); com token, o primeiro roadmap devolvido pelo pipeline é o padrão e os demais ficam no seletor.
- Decisão: as traduções da página ficaram em `shared/locales/roadmap.ts` e entram nos três dicionários; `i18n:check` voltou a cobrir a pasta, sem exceção de protótipo.
- Risco aceito: a página é local, como o terminal e o World; no celular nem com login. No Docker, o pipeline no host exige `HABBLAUD_ROADMAP_URL=http://host.docker.internal:49500`.

## FEATURE → DADOS REAIS — 2026-11-19

- Decisão: `HABBLAUD_ROADMAP_IDS` permite restringir a página aos roadmaps reais; o proxy filtra a lista, rejeita snapshots/eventos de outros roadmaps e filtra sessões pelo vínculo.
- Decisão: a conversa nunca cai na sessão de outro roadmap; sem sessão vinculada, a UI mostra o estado vazio e o composer desativado.
- Risco aceito: um roadmap real sem sessão vinculada não tem conversa até o pipeline registrar uma sessão para ele — melhor um estado vazio verdadeiro do que uma sessão de seed fingindo acompanhar o roadmap.
