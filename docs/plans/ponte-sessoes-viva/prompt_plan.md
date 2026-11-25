# Ponte de sessões vivas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a gaveta do roadmap deixa escolher, entre as sessões que trabalharam no item, com qual falar, e entrega a pergunta na sessão viva escolhida.

**Architecture:** o branch `feature/habblaud-ponte-sessoes` (13 commits: harness, roteador, converse, ponte de resposta, gaveta) entra na `main` por cherry-pick e é adaptado ao contrato final do pipeline (só `executions`). O servidor monta a lista de sessões a partir das execuções, cruza com os agentes vivos e valida a escolha; o cliente só mostra e envia a escolha.

**Tech Stack:** TypeScript, Node sem dependências de runtime (`server/`), Vite (`client/`), Vitest. Comandos: `npm test`, `npm run typecheck`, `npm run i18n:check`.

**Spec:** `docs/plans/ponte-sessoes-viva/spec.md`

## Global Constraints

- Todo texto visível passa por `tr('texto em PT')` e entra em `shared/locales/` (`en`, `es`, `fr`); `npm run i18n:check` limpo.
- Toda mudança visível entra em "Não lançado" no `CHANGELOG.md`.
- Commits Conventional Commits, atômicos, um por tarefa; testes escritos antes e vistos falhando.
- Rotas novas só locais (`isLocal`); token do roadmap só no servidor; nenhum `argv`/comando do pipeline é executado.
- Não tocar em `shared/world/` nem `server/world/`. O teste `server/world/uplink.test.ts` já falha na `main` e fica fora.
- Provider do pipeline → `Provider` do Habblaud: `claude-code→claude`; `codex`, `opencode`, `antigravity`, `hermes` iguais.

## Review Focus

- Sessão repetida em várias execuções do item (revisor e implementador, ou a mesma sessão em dois itens): aparece uma vez, a mais recente.
- `session` enviada pelo navegador que não está na lista do servidor (id forjado, de outro item): 400 e nada na fila.
- Execução com `workerSessionId` vazio (o revisor do pipeline): não vira opção nem alvo.
- Pipeline respondendo 401/5xx ou fora do ar ao montar a lista: erro legível na gaveta, página de pé.
- Sessão escolhida viva mas sem `canMessage` (plugin desconectado): 409 `unavailable` com o motivo, sem fingir envio.

---

### Task 1: Trazer a ponte para a `main`

**Files:**
- Modify: `CHANGELOG.md` (resolver o único conflito)
- Todos os 13 commits de `f36eb89` até `d3dca6e` do branch `feature/habblaud-ponte-sessoes`

**Interfaces:**
- Produces: `server/roadmap/{harness,router,converse}.ts`, `client/src/roadmap/bridge.ts` e a gaveta nova, já na `main` (base de todas as tarefas).

- [ ] **Step 1:** `git cherry-pick f36eb89^..d3dca6e` no branch `feature/habblaud-H1` (criado a partir da `main`).
- [ ] **Step 2:** resolver o conflito de `CHANGELOG.md` mantendo as duas entradas (a correção `fix: roadmap abre sem as rotas de conversa` e as da ponte), `git cherry-pick --continue`.
- [ ] **Step 3:** `npm test`. Esperado: só `server/world/uplink.test.ts` falhando (já falhava na `main`); `npm run typecheck` verde.

### Task 2: Roteador reconhece o provider do pipeline e lê `cwd`

**Files:**
- Modify: `server/roadmap/harness.ts`, `server/roadmap/router.ts`
- Test: `server/roadmap/harness.test.ts`, `server/roadmap/router.test.ts`

**Interfaces:**
- Produces: `providerOfPipeline(value: unknown): Provider | null` em `harness.ts` (mapa fechado do Global Constraints; qualquer outro valor → `null`). `RouterExecution` ganha `cwd?: string`; `Candidate.workdir` vem de `cwd` quando absoluto, sem `..`, sem NUL (reusar a validação de `workdir` existente).
- Produces: `listTargets(input: RouteInput): RouteResult[]` em `router.ts` — todas as sessões candidatas, sem repetição (a mais recente de cada `provider:sessionId`), cada uma com `agent` se viva e acessível; ordem: vivas primeiro, depois mais recentes. `resolveTarget` passa a devolver o primeiro de `listTargets` (item, depois roadmap), mantendo os `reason` atuais.

- [ ] **Step 1: Write the failing tests**
  - `harness.test.ts`: `providerOfPipeline('claude-code')` → `'claude'`; `'antigravity'` → `'antigravity'`; `'claude-subscription-directsdk-experimental'` → `null`; `undefined` → `null`.
  - `router.test.ts`: execução `{provider:'claude-code', workerSessionId:'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'}` com agente vivo `{provider:'claude', sessionId:<mesmo>, canMessage:true}` → `resolveTarget(...).agent.id` é o do agente (CA01). Duas execuções da mesma sessão → `listTargets` devolve uma. `workerSessionId: ''` → ausente de `listTargets`. Execução com `cwd:'/tmp/x'` e provider `claude-code` → `resumable === true`; sem `cwd` → `false`.
- [ ] **Step 2:** `npx vitest run server/roadmap/harness.test.ts server/roadmap/router.test.ts`. Esperado: FAIL (`providerOfPipeline` não existe; `claude-code` → `null`).
- [ ] **Step 3:** implementar `providerOfPipeline` e `listTargets`, e trocar `asProvider(e.provider)` por `providerOfPipeline(e.provider)` em `candidatesOf`.
- [ ] **Step 4:** mesmos testes. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "fix: roteador reconhece o provider do pipeline (claude-code) e lista as sessões"`.

### Task 3: Proxy libera `executions` e fecha `participants` e `/api/agent/sessions`

**Files:**
- Modify: `server/roadmap/proxy.ts` (constante `ALLOWED`)
- Test: `server/roadmap/proxy.test.ts`

**Interfaces:**
- Produces: `ALLOWED` com `^/api/roadmaps/[^/]+/executions$` e `^/api/roadmaps/[^/]+/items/[^/]+/executions$`; sem `participants` e sem `/api/agent/sessions`.

- [ ] **Step 1: Write the failing tests** (CA02): `GET /api/roadmap/roadmaps/r1/executions` e `.../items/i1/executions` repassados ao pipeline falso (200); `.../items/i1/participants` e `/api/roadmap/agent/sessions` → 404 com `error.message` `rota de roadmap desconhecida`; `POST` em `executions` → 405.
- [ ] **Step 2:** `npx vitest run server/roadmap/proxy.test.ts`. Esperado: FAIL (rota do roadmap bloqueada, `participants`/`agent/sessions` ainda liberadas).
- [ ] **Step 3:** ajustar `ALLOWED`.
- [ ] **Step 4:** mesmos testes. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "fix: proxy do roadmap libera executions e fecha rotas que o pipeline removeu"`.

### Task 4: Servidor lista as sessões e valida a escolha

**Files:**
- Modify: `server/roadmap/converse.ts`, `server/roadmap/proxy.ts` (rota `GET ${PREFIX}/sessions`)
- Test: `server/roadmap/converse.test.ts`, `server/roadmap/proxy.test.ts`

**Interfaces:**
- Consumes: `listTargets`, `resolveTarget` (Task 2).
- Produces em `converse.ts`: `sessionOptions(deps: ConverseDeps, get: PipelineGet, allowedRoadmap: (id: string) => boolean, query: {roadmapId: string; itemId: string}): Promise<ConverseOutcome>` com corpo 200 `{ options: SessionOption[]; suggested: {provider: Provider; sessionId: string} | null }`, onde `SessionOption = { provider: Provider; sessionId: string; agentId?: string; live: boolean; resumable: boolean; profile?: string; model?: string; lastAt: string; scope: 'item' | 'roadmap' }`.
- Produces: `converse(...)` aceita `session?: {provider: string; sessionId: string}` no corpo. Fonte das execuções: item (`/api/roadmaps/:id/items/:itemId/executions`); se vazio, roadmap (`/api/roadmaps/:id/executions?limit=200`). Deixa de chamar `participants`.
- Erros: `session` fora das opções → 400 `unknown_session`; viva sem `canMessage` → 409 `unavailable`; fechada → 409 `session_closed`; pipeline 401/5xx → repassa o status do pipeline no envelope `{error:{code,message,retryable}}`; rede → 502 `pipeline_unavailable`.

- [ ] **Step 1: Write the failing tests** (CA03–CA08), com pipeline e escritório falsos como os testes atuais de `converse.test.ts`:
  - `sessionOptions`: duas execuções da mesma sessão → 1 opção; viva primeiro; `workerSessionId: ''` ausente; item vazio e roadmap com execução → `scope: 'roadmap'`; tudo vazio → `options: []`, `suggested: null`; pipeline 401 → status 401 e `error.code` do pipeline.
  - `converse`: `session` forjada → 400 `unknown_session` e `messages.send` não chamado; `session` viva escolhida (diferente da sugerida) → 202 com o `agentId` dela; `session` fechada → 409 `session_closed`; `session` viva com `canMessage:false` → 409 `unavailable`.
  - `proxy.test.ts`: `GET /api/roadmap/sessions?roadmapId=r1&itemId=i1` de origem não local → 403; local → 200.
- [ ] **Step 2:** `npx vitest run server/roadmap/converse.test.ts server/roadmap/proxy.test.ts`. Esperado: FAIL (`sessionOptions` não existe; `session` ignorada).
- [ ] **Step 3:** implementar `sessionOptions`, o parâmetro `session` em `converse` e a rota GET no proxy (mesmas guardas de local/token/allowlist do POST).
- [ ] **Step 4:** mesmos testes. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat: servidor lista as sessões do item e valida a escolhida"`.

### Task 5: Cliente sem `/api/agent/sessions` e com a lista de sessões

**Files:**
- Modify: `client/src/roadmap/pipeline.ts`, `client/src/roadmap/live.ts`
- Test: `client/src/roadmap/pipeline.test.ts`, `client/src/roadmap/live.test.ts`

**Interfaces:**
- Produces em `pipeline.ts`: `listRoadmapExecutions(roadmapId: string, limit?: number): Promise<{ roadmapId: string; executions: ApiItemExecution[] }>`; `listSessionOptions(roadmapId: string, itemId: string): Promise<ApiSessionOptions>` (`ApiSessionOptions` = formato 200 de `sessionOptions`); `postConverse` aceita `session?: {provider: Provider; sessionId: string}`. Remove `listSessions`.
- Produces em `live.ts`: `sessionsFromExecutions(executions: ApiItemExecution[]): ApiSession[]` — uma `ApiSession` por `provider:workerSessionId` (a mais recente), `id` = `${provider}:${workerSessionId}`, `agentId` = `profile`, `harness` = `provider`, `status` = `'working'` se `outcome === 'running'`, senão `'idle'` (confirmar no `agentFromSession` os valores aceitos antes de fixar), `roadmapIds` = roadmaps onde apareceu, `currentItemId` = item da execução em andamento ou `null`. `loadLiveData` usa `listRoadmapExecutions` de cada roadmap e não chama mais `/agent/sessions` (remover `listSessionsIfExposed`).

- [ ] **Step 1: Write the failing tests:** `sessionsFromExecutions` — dedupe por sessão, `outcome:'running'` → `working` com `currentItemId`, `workerSessionId:''` ignorada. `loadLiveData` com `fetch` falso: nenhuma chamada a `/agent/sessions` (assert na lista de URLs), `sessions` vindas das execuções; o teste de "404 vale sem sessões" é substituído por este. `pipeline.test.ts`: `postConverse` envia `session` no corpo; `listSessionOptions` chama `/sessions?roadmapId=…&itemId=…` com ids codificados.
- [ ] **Step 2:** `npx vitest run client/src/roadmap`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run client/src/roadmap && npm run typecheck`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat: página do roadmap monta as sessões pelas execuções do pipeline"`.

### Task 6: Seletor de sessão na gaveta

**Files:**
- Create: `client/src/roadmap/session-picker.ts` (+ `session-picker.test.ts`)
- Modify: `client/src/roadmap/conversation.ts`, `client/src/roadmap/state.ts`, `client/src/roadmap/styles.css`, `shared/locales/roadmap.ts`

**Interfaces:**
- Consumes: `ApiSessionOptions`, `listSessionOptions`, `postConverse` (Task 5).
- Produces em `session-picker.ts` (puro, sem DOM): `initialChoice(opts: ApiSessionOptions): {provider: Provider; sessionId: string} | null` (sugerida, senão a primeira viva, senão `null`); `describeOption(o: SessionOption): string` (ex.: `claude · reviewer · viva`, `codex · impl · fechada`); `canSend(opts: ApiSessionOptions, choice: {provider: Provider; sessionId: string} | null): { ok: true } | { ok: false; reason: string }` (`reason` via `tr()`: sem sessões, fechada, ou nenhuma escolhida).
- `state.ts` guarda `chatSession: {provider: Provider; sessionId: string} | null` por conversa.

- [ ] **Step 1: Write the failing tests** (`session-picker.test.ts`): `initialChoice` usa `suggested`; sem `suggested` pega a primeira viva; sem vivas → `null`. `canSend` com opções vazias → `ok:false` e motivo "ninguém registrou sessão neste item" (CA07); sessão fechada → `ok:false`; viva → `ok:true`. `describeOption` contém provider, perfil e "viva"/"fechada".
- [ ] **Step 2:** `npx vitest run client/src/roadmap/session-picker.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** implementar o módulo puro; depois ligar na gaveta: `<select>` com as opções, padrão `initialChoice`, envio desabilitado quando `canSend` é `ok:false` (motivo visível ao lado), erro do `listSessionOptions` mostrado na própria gaveta (CA08), `postConverse` com `session`. Textos novos por `tr()` e traduzidos em `en`, `es`, `fr`.
- [ ] **Step 4:** `npx vitest run client/src/roadmap && npm run typecheck && npm run i18n:check`. Esperado: PASS e idiomas completos.
- [ ] **Step 5:** `git commit -m "feat: gaveta do roadmap escolhe a sessão com quem conversar"`.

### Task 7: Verificação no servidor real

**Files:** nenhum (evidências no PR); só leitura, com um envio **que precisa da sua aprovação**.

- [ ] **Step 1:** subir por `./run-roadmap.sh` e abrir `http://127.0.0.1:4747/roadmap`; escolher o roadmap `roadmap-gate` (tem execuções com `workerSessionId` e `cwd`).
- [ ] **Step 2:** confirmar no navegador (screenshot + `read_network_requests`): `GET /api/roadmap/sessions` 200; seletor com as sessões vivas primeiro; nenhuma chamada a `/agent/sessions`.
- [ ] **Step 3 (precisa de OK):** enviar uma pergunta inofensiva à sessão viva escolhida (CA09) e ver a pergunta no terminal dela e a resposta na gaveta. Sem OK, parar no Step 2 e registrar que o CA09 ficou pendente.

### Task 8: Docs, CHANGELOG e roadmap

**Files:**
- Modify: `CHANGELOG.md`, `docs/integration/hermes-pipeline-roadmap-contract.md`, `docs/decisions/habblaud-H1.md`

- [ ] **Step 1:** CHANGELOG "Não lançado": entrada **Corrigido** (`claude-code` agora é roteado; rotas de executions liberadas) e **Novo** (seletor de sessão na gaveta).
- [ ] **Step 2:** atualizar o contrato do Habblaud (só `executions`; sem `participants`/`resume`) e anexar as transições TDD → BUILD e BUILD → PR ao log de decisões (máx. 3 itens cada).
- [ ] **Step 3:** `npm test && npm run typecheck && npm run i18n:check` (só `uplink` falhando) e `git commit -m "docs: ponte de sessões vivas"`.
- [ ] **Step 4:** registrar no roadmap `habblaud-ponte-sessoes` o andamento de H1 (skill `roadmap-iniciar-trabalho`, com a sessão real desta execução).

---

## Self-review

- **Cobertura:** RF01→T3, RF02→T2, RF03/RF04→T4, RF05→T6, RF06→T5, RF07→T6/T8; CA01→T2, CA02→T3, CA03–CA06→T4, CA07/CA08→T6, CA09→T7.
- **Consistência de tipos:** `SessionOption`/`ApiSessionOptions` definidos em T4 e usados em T5/T6; `listTargets` (T2) usado em T4.
- **Pontos a confirmar na execução (não são decisões):** valores de `status` aceitos por `agentFromSession` (T5); se `cherry-pick` pede mais de um conflito além do `CHANGELOG.md` (T1; a simulação de merge indicou só esse).
