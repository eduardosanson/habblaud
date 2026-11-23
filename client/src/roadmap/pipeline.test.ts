import { afterEach, describe, expect, it, vi } from 'vitest';
import { listExecutions, listParticipants, PipelineError } from './pipeline';

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('execuções e participantes do item', () => {
  it('lista as execuções pela rota do proxy, com o id do item escapado', async () => {
    const fetchFn = stubFetch(200, { roadmapId: 'r', itemId: 'a/b', executions: [] });
    const result = await listExecutions('r', 'a/b');
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/roadmap/roadmaps/r/items/a%2Fb/executions');
    expect(result.executions).toEqual([]);
  });

  it('lista os participantes e preserva o descritor resume sem alterá-lo', async () => {
    const participant = {
      profile: 'impl-neon',
      harness: 'agy',
      model: 'gemini',
      role: 'implementador',
      executions: 1,
      lastOutcome: 'completed',
      lastEndedAt: '2026-11-22T15:26:20Z',
      resume: { harness: 'agy', sessionId: 's-1', workdir: '/w', argv: ['agy', 'resume'] },
    };
    const fetchFn = stubFetch(200, { roadmapId: 'r', itemId: 'i', participants: [participant] });
    const result = await listParticipants('r', 'i');
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/roadmap/roadmaps/r/items/i/participants');
    expect(result.participants[0]).toEqual(participant);
  });

  it('propaga o erro do pipeline (rota ainda inexistente no pipeline antigo vira 404 tipado)', async () => {
    stubFetch(404, { error: { code: 'not_found', message: 'sem rota', retryable: false } });
    await expect(listParticipants('r', 'i')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(listParticipants('r', 'i')).rejects.toBeInstanceOf(PipelineError);
  });
});
