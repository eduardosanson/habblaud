// Conversa do roadmap pelo escritório: a pergunta vai para a sessão REAL do agente que trabalhou no item, não para um
// agente do pipeline. O pipeline só registra quem fez o quê (participants/executions); aqui o Habblaud escolhe a
// sessão por regra fixa (router.ts) e entrega pela fila de mensagens que já existe (messages/registry.ts).
//
// Sessão fechada nunca é reaberta aqui nem recebe resposta inventada: devolve 409 `session_closed` com o motivo e se
// há como reabri-la. O texto da pergunta vai à sessão como foi digitado, depois de uma linha que diz de onde veio.
import { tr } from '../../shared/i18n';
import type { Provider } from '../../shared/types';
import type { SendResult } from '../messages/registry';
import { resolveTarget, type LiveAgent, type RouteResult, type RouterExecution, type RouterParticipant } from './router';

const ID_MAX = 200;
const TEXT_MAX = 19_000;

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

  const base = `/api/roadmaps/${encodeURIComponent(roadmapId)}/items/${encodeURIComponent(itemId)}`;
  let participants: RouterParticipant[] = [];
  let executions: RouterExecution[] = [];
  try {
    const found = await get(`${base}/participants`);
    if (found.status === 200) participants = arrayAt(found.json, 'participants') as RouterParticipant[];
    // Pipeline antigo (sem participants) ou item sem participante: o histórico de execuções ainda diz quem trabalhou.
    if (participants.length === 0) {
      const history = await get(`${base}/executions`);
      if (history.status === 200) executions = arrayAt(history.json, 'executions') as RouterExecution[];
    }
  } catch {
    return fail(502, 'pipeline_unavailable', tr('o Hermes Pipeline não respondeu'), undefined, true);
  }

  const liveAgents: LiveAgent[] = deps.office
    .list()
    .filter((agent) => agent.kind === 'main')
    .map((agent) => ({ id: agent.id, provider: agent.provider, sessionId: agent.sessionId, canMessage: deps.messages.canMessage(agent.id) }));

  const route = resolveTarget({ participants, executions, liveAgents });
  if (!route) return fail(404, 'no_session', tr('nenhuma sessão registrada trabalhou neste item'));
  if (!route.agent) {
    return fail(409, 'session_closed', tr('a sessão que trabalhou neste item está fechada; abra-a para conversar'), { route: routeSummary(route) });
  }

  const framed = tr('Pergunta pelo roadmap {0}, item {1}:\n{2}', [roadmapId, itemId, text]);
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
  return fail(404, 'no_session', tr('o agente saiu do escritório'));
}
