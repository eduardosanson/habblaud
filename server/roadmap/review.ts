// A única escrita que o Habblaud faz no roadmap: transmitir a decisão da pessoa sobre um item em revisão. O pedido
// vem da própria página (a trava é a mesma do terminal), só os campos conhecidos seguem, e quem muda o estado é o
// pipeline, que exige o escopo de revisão e a revisão do roadmap que a pessoa estava vendo.
import { tr } from '../../shared/i18n';
import type { ConverseOutcome } from './converse';

/** POST no pipeline com o token do servidor. Rejeita se o pipeline não responde. */
export type PipelinePost = (path: string, body: unknown) => Promise<{ status: number; json: unknown }>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 4_000;

function fail(status: number, code: string, message: string, retryable = false): ConverseOutcome {
  return { status, body: { error: { code, message, retryable } } };
}

export async function review(post: PipelinePost, allowedRoadmap: (id: string) => boolean, raw: unknown): Promise<ConverseOutcome> {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const { roadmapId, itemId, decision, expectedRevision, actionId } = body;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (typeof roadmapId !== 'string' || !ID.test(roadmapId) || typeof itemId !== 'string' || !ID.test(itemId)) {
    return fail(400, 'bad_request', tr('esperado {roadmapId, itemId, decision}'));
  }
  if (decision !== 'approve' && decision !== 'return') return fail(400, 'bad_request', tr('esperado {roadmapId, itemId, decision}'));
  if (!Number.isInteger(expectedRevision) || typeof actionId !== 'string' || !UUID.test(actionId) || note.length > NOTE_MAX) {
    return fail(400, 'bad_request', tr('esperado {roadmapId, itemId, decision}'));
  }
  if (decision === 'return' && !note) return fail(400, 'bad_request', tr('para devolver, diga o que precisa mudar'));
  if (!allowedRoadmap(roadmapId)) return fail(404, 'not_found', tr('roadmap fora da lista permitida'));
  try {
    const result = await post(`/api/roadmaps/${encodeURIComponent(roadmapId)}/items/${encodeURIComponent(itemId)}/review`, {
      actionId,
      expectedRevision,
      decision,
      note,
    });
    return { status: result.status, body: result.json };
  } catch {
    return fail(502, 'pipeline_unavailable', tr('o Hermes Pipeline não respondeu'), true);
  }
}
