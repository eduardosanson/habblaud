import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLiveData } from './live';
import { PipelineError } from './pipeline';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Simula o proxy do Habblaud; `sessions` define a resposta de /agent/sessions. */
function stubProxy(sessions: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/status')) return json(200, { enabled: true, configured: true, local: true, available: true });
      if (url.endsWith('/roadmaps')) return json(200, { roadmaps: [] });
      if (url.endsWith('/agent/sessions')) return sessions.clone();
      return json(404, { error: { code: 'not_found', message: 'rota não encontrada', retryable: false } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('loadLiveData sem as rotas de conversa do pipeline', () => {
  it('abre o roadmap com sessões vazias quando /agent/sessions responde 404', async () => {
    stubProxy(json(404, { error: { code: 'not_found', message: 'rota não encontrada', retryable: false } }));

    const data = await loadLiveData();

    expect(data.sessions).toEqual([]);
    expect(data.snapshots).toEqual([]);
  });

  it('continua usando as sessões quando o pipeline ainda as expõe', async () => {
    const session = { sessionId: 's1', agentId: 'a1' };
    stubProxy(json(200, { sessions: [session] }));

    const data = await loadLiveData();

    expect(data.sessions).toEqual([session]);
  });

  it('não esconde falha de autenticação: 401 em /agent/sessions continua sendo erro', async () => {
    stubProxy(json(401, { error: { code: 'forbidden', message: 'token inválido', retryable: false } }));

    await expect(loadLiveData()).rejects.toMatchObject({ status: 401 });
    await expect(loadLiveData()).rejects.toBeInstanceOf(PipelineError);
  });
});
