import { afterEach, describe, expect, it, vi } from 'vitest';
import { listExecutions, listRoadmapExecutions, listSessionOptions, PipelineError, postConverse } from './pipeline';

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('execuções e sessões', () => {
  it('lista as execuções do item pela rota do proxy, com o id do item escapado', async () => {
    const fetchFn = stubFetch(200, { roadmapId: 'r', itemId: 'a/b', executions: [] });
    const result = await listExecutions('r', 'a/b');
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/roadmap/roadmaps/r/items/a%2Fb/executions');
    expect(result.executions).toEqual([]);
  });

  it('lista as execuções do roadmap com o limite pedido (padrão 200)', async () => {
    const fetchFn = stubFetch(200, { roadmapId: 'r', executions: [] });
    await listRoadmapExecutions('r', 50);
    await listRoadmapExecutions('a/b');
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/roadmap/roadmaps/r/executions?limit=50');
    expect(fetchFn.mock.calls[1]![0]).toBe('/api/roadmap/roadmaps/a%2Fb/executions?limit=200');
  });

  it('lista as sessões do item pela rota do Habblaud, com os ids escapados', async () => {
    const options = { options: [{ provider: 'claude', sessionId: 's-1', live: true, resumable: false, lastAt: '2026-11-24T10:00:00Z', scope: 'item' }], suggested: { provider: 'claude', sessionId: 's-1' } };
    const fetchFn = stubFetch(200, options);
    const result = await listSessionOptions('r', 'a/b');
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/roadmap/sessions?roadmapId=r&itemId=a%2Fb');
    expect(result).toEqual(options);
  });

  it('propaga o erro do pipeline como erro tipado', async () => {
    stubFetch(401, { error: { code: 'forbidden', message: 'token inválido', retryable: false } });
    await expect(listSessionOptions('r', 'i')).rejects.toMatchObject({ status: 401, code: 'forbidden' });
    await expect(listSessionOptions('r', 'i')).rejects.toBeInstanceOf(PipelineError);
  });
});

describe('postConverse', () => {
  it('envia a pergunta ao /converse e devolve o agente que recebeu', async () => {
    const accepted = { accepted: true, messageId: 'm-1', agentId: 'codex:1', sentAt: 123, route: { reason: 'live', provider: 'codex', resumable: true } };
    const fetchFn = stubFetch(202, accepted);
    const result = await postConverse({ roadmapId: 'r', itemId: 'i', text: 'oi' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/roadmap/converse');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(result).toEqual(accepted);
  });

  it('envia a sessão escolhida junto da pergunta', async () => {
    const fetchFn = stubFetch(202, { accepted: true, messageId: 'm-2', agentId: 'claude:2', sentAt: 1, route: { reason: 'live', provider: 'claude', resumable: false } });
    await postConverse({ roadmapId: 'r', itemId: 'i', text: 'oi', session: { provider: 'claude', sessionId: 's-1' } });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ roadmapId: 'r', itemId: 'i', text: 'oi', session: { provider: 'claude', sessionId: 's-1' } });
  });

  it('sessão fechada chega como erro tipado com o resumo da rota', async () => {
    stubFetch(409, { error: { code: 'session_closed', message: 'fechada', retryable: false, details: { route: { reason: 'recent', provider: 'codex', resumable: true } } } });
    await expect(postConverse({ roadmapId: 'r', itemId: 'i', text: 'oi' })).rejects.toMatchObject({
      status: 409,
      code: 'session_closed',
      details: { route: { resumable: true } },
    });
  });
});
