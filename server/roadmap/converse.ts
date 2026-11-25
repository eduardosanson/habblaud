// Conversa do roadmap pelo escritório: a pergunta vai para a sessão REAL do agente que trabalhou no item, não para um
// agente do pipeline. O pipeline só registra as execuções (workerSessionId + provider + cwd); aqui o Habblaud monta a
// lista de sessões, cruza com os agentes vivos (router.ts) e entrega pela fila de mensagens que já existe
// (messages/registry.ts).
//
// A pessoa pode escolher a sessão, mas só entre as que ESTE servidor listou: o navegador nunca aponta um destino
// por conta própria. Sessão fechada nunca é reaberta aqui nem recebe resposta inventada: devolve 409 `session_closed`.
// O texto da pergunta vai à sessão como foi digitado, depois de uma linha que diz de onde veio.
import { tr } from '../../shared/i18n';
import type { Provider } from '../../shared/types';
import type { SendResult } from '../messages/registry';
import { listTargets, type LiveAgent, type RouteResult, type RouterExecution } from './router';

const ID_MAX = 200;
const TEXT_MAX = 19_000;
/** Máximo de execuções do roadmap inteiro que o pipeline entrega (limite dele). */
const ROADMAP_EXECUTIONS_LIMIT = 200;

export interface ConverseDeps {
  office: { list(): ReadonlyArray<{ id: string; provider?: Provider; sessionId: string; kind?: string }> };
  messages: { canMessage(agentId: string): boolean; send(raw: unknown): SendResult };
}

/** GET no pipeline (com o token do servidor). Rejeita se o pipeline não responde. */
export type PipelineGet = (path: string) => Promise<{ status: number; json: unknown }>;

export interface ConverseOutcome {
  status: number;
  body: unknown;
}

/** Uma sessão que trabalhou no item (ou no roadmap), como o navegador a vê. Nunca traz o `cwd`. */
export interface SessionOption {
  provider: Provider;
  sessionId: string;
  /** Presente quando a sessão está viva no escritório e aceita mensagem. */
  agentId?: string;
  live: boolean;
  /** Há comando verificado para reabri-la (fora do escopo desta tela; informativo). */
  resumable: boolean;
  profile?: string;
  model?: string;
  lastAt: string;
  scope: 'item' | 'roadmap';
}

export interface SessionOptions {
  options: SessionOption[];
  suggested: { provider: Provider; sessionId: string } | null;
}

function fail(status: number, code: string, message: string, details?: Record<string, unknown>, retryable = false): ConverseOutcome {
  return { status, body: { error: { code, message, retryable, ...(details ? { details } : {}) } } };
}

function idOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > ID_MAX) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(value) ? null : value;
}

function arrayAt(json: unknown, key: string): unknown[] {
  const value = json && typeof json === 'object' ? (json as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value : [];
}

/** Repassa o erro do pipeline (status e envelope) quando ele recusa; sem envelope legível, monta um. */
function pipelineFail(status: number, json: unknown): ConverseOutcome {
  const error = json && typeof json === 'object' ? (json as { error?: { code?: unknown; message?: unknown } }).error : undefined;
  const code = typeof error?.code === 'string' ? error.code : 'pipeline_error';
  const message = typeof error?.message === 'string' ? error.message : tr('o Hermes Pipeline respondeu {0}', [status]);
  return fail(status, code, message, undefined, status >= 500);
}

function routeSummary(route: RouteResult): Record<string, unknown> {
  const { candidate } = route;
  return {
    reason: route.reason,
    provider: candidate.provider,
    resumable: route.resumable,
    ...(candidate.profile ? { profile: candidate.profile } : {}),
    ...(candidate.role ? { role: candidate.role } : {}),
  };
}

function liveAgentsOf(deps: ConverseDeps): LiveAgent[] {
  return deps.office
    .list()
    .filter((agent) => agent.kind === 'main')
    // `provider` ausente quer dizer Claude Code (shared/types.ts): o roteador compara com o `Provider` explícito.
    .map((agent) => ({ id: agent.id, provider: agent.provider ?? 'claude', sessionId: agent.sessionId, canMessage: deps.messages.canMessage(agent.id) }));
}

/**
 * Sessões que trabalharam no item (as do roadmap, se o item não tem nenhuma), vivas primeiro. Um 404 do pipeline
 * (item ou roadmap desconhecido) vale lista vazia; qualquer outra recusa dele é erro.
 */
export async function targetsFor(deps: ConverseDeps, get: PipelineGet, roadmapId: string, itemId: string): Promise<{ targets: RouteResult[] } | { failure: ConverseOutcome }> {
  const liveAgents = liveAgentsOf(deps);
  const roadmap = `/api/roadmaps/${encodeURIComponent(roadmapId)}`;
  try {
    const item = await get(`${roadmap}/items/${encodeURIComponent(itemId)}/executions`);
    if (item.status !== 200 && item.status !== 404) return { failure: pipelineFail(item.status, item.json) };
    const executions = item.status === 200 ? (arrayAt(item.json, 'executions') as RouterExecution[]) : [];
    const itemOnly = listTargets({ executions, liveAgents });
    if (itemOnly.length > 0) return { targets: itemOnly };
    const wide = await get(`${roadmap}/executions?limit=${ROADMAP_EXECUTIONS_LIMIT}`);
    if (wide.status !== 200 && wide.status !== 404) return { failure: pipelineFail(wide.status, wide.json) };
    const roadmapExecutions = wide.status === 200 ? (arrayAt(wide.json, 'executions') as RouterExecution[]) : [];
    return { targets: listTargets({ executions, roadmapExecutions, liveAgents }) };
  } catch {
    return { failure: fail(502, 'pipeline_unavailable', tr('o Hermes Pipeline não respondeu'), undefined, true) };
  }
}

/** "5.1 «Título»" do item no snapshot; sem conseguir ler, o id. A sessão pode nunca ter visto o número do plano. */
async function itemLabel(get: PipelineGet, roadmapId: string, itemId: string): Promise<string> {
  try {
    const snapshot = await get(`/api/roadmaps/${encodeURIComponent(roadmapId)}`);
    const roadmap = snapshot.status === 200 ? (snapshot.json as { roadmap?: unknown } | null)?.roadmap : undefined;
    for (const phase of arrayAt(roadmap, 'phases')) {
      for (const raw of arrayAt(phase, 'items')) {
        const item = raw as { id?: unknown; key?: unknown; title?: unknown };
        if (item.id === itemId && typeof item.title === 'string') {
          const title = item.title.replace(/\s+/g, ' ').slice(0, 200);
          return typeof item.key === 'string' && item.key ? `${item.key.slice(0, 20)} «${title}»` : `«${title}»`;
        }
      }
    }
  } catch {
    // o rótulo é só contexto: a pergunta não se perde por causa dele
  }
  return itemId;
}

function optionOf(route: RouteResult): SessionOption {
  const { candidate, agent } = route;
  return {
    provider: candidate.provider,
    sessionId: candidate.sessionId,
    ...(agent ? { agentId: agent.id } : {}),
    live: !!agent,
    resumable: route.resumable,
    ...(candidate.profile ? { profile: candidate.profile } : {}),
    ...(candidate.model ? { model: candidate.model } : {}),
    lastAt: candidate.at,
    scope: route.reason.startsWith('roadmap') ? 'roadmap' : 'item',
  };
}

/** GET /api/roadmap/sessions?roadmapId=&itemId=: o que o seletor da gaveta mostra. */
export async function sessionOptions(
  deps: ConverseDeps,
  get: PipelineGet,
  allowedRoadmap: (id: string) => boolean,
  query: { roadmapId?: unknown; itemId?: unknown },
): Promise<ConverseOutcome> {
  const roadmapId = idOf(query.roadmapId);
  const itemId = idOf(query.itemId);
  if (!roadmapId || !itemId) return fail(400, 'bad_request', tr('esperado {roadmapId, itemId}'));
  if (!allowedRoadmap(roadmapId)) return fail(404, 'not_found', tr('roadmap fora da lista permitida'));
  const found = await targetsFor(deps, get, roadmapId, itemId);
  if ('failure' in found) return found.failure;
  const first = found.targets[0];
  const body: SessionOptions = {
    options: found.targets.map(optionOf),
    suggested: first ? { provider: first.candidate.provider, sessionId: first.candidate.sessionId } : null,
  };
  return { status: 200, body };
}

export async function converse(
  deps: ConverseDeps,
  get: PipelineGet,
  allowedRoadmap: (id: string) => boolean,
  raw: unknown,
): Promise<ConverseOutcome> {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const roadmapId = idOf(body.roadmapId);
  const itemId = idOf(body.itemId);
  const text = typeof body.text === 'string' ? body.text : '';
  if (!roadmapId || !itemId) return fail(400, 'bad_request', tr('esperado {roadmapId, itemId, text}'));
  if (!text.trim()) return fail(400, 'bad_request', tr('a mensagem está vazia'));
  if (text.length > TEXT_MAX) return fail(400, 'bad_request', tr('a mensagem passa de 19.000 caracteres'));
  if (!allowedRoadmap(roadmapId)) return fail(404, 'not_found', tr('roadmap fora da lista permitida'));

  const found = await targetsFor(deps, get, roadmapId, itemId);
  if ('failure' in found) return found.failure;

  let route: RouteResult | undefined = found.targets[0];
  if (body.session !== undefined) {
    const chosen = body.session && typeof body.session === 'object' ? (body.session as Record<string, unknown>) : {};
    route = found.targets.find((target) => target.candidate.provider === chosen.provider && target.candidate.sessionId === chosen.sessionId);
    if (!route) return fail(400, 'unknown_session', tr('essa sessão não trabalhou neste item'));
  }
  if (!route) return fail(404, 'no_session', tr('nenhuma sessão registrada trabalhou neste item'));
  if (!route.agent) {
    return fail(409, 'session_closed', tr('a sessão que trabalhou neste item está fechada; abra-a para conversar'), { route: routeSummary(route) });
  }

  const framed = tr('Pergunta pelo roadmap {0}, item {1}:\n{2}', [roadmapId, await itemLabel(get, roadmapId, itemId), text]);
  let sent: SendResult;
  try {
    sent = deps.messages.send({ agentId: route.agent.id, text: framed });
  } catch (error) {
    return fail(400, 'bad_request', error instanceof Error ? error.message : tr('mensagem inválida'));
  }
  if ('message' in sent) {
    return {
      status: 202,
      // `sentAt`: a página só considera respostas do agente a partir daqui (a pergunta aparece no terminal dele).
      body: { accepted: true, messageId: sent.message.id, agentId: route.agent.id, sentAt: Date.now(), route: routeSummary(route) },
    };
  }
  if (sent.error === 'unavailable') return fail(409, 'unavailable', sent.reason, { route: routeSummary(route) });
  if (sent.error === 'too-many') return fail(429, 'too_many', tr('há mensagens demais esperando este agente'), undefined, true);
  return fail(404, 'no_session', tr('a sessão do agente já encerrou; veja “O que foi entregue” no item ou reabra a sessão'));
}
