import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLiveData, sessionsFromExecutions } from './live';
import type { ApiItemExecution } from './pipeline';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function exec(over: Partial<ApiItemExecution> = {}): ApiItemExecution {
  return {
    id: 1,
    roadmapId: 'r1',
    itemId: 'r1-a',
    source: 'pipeline-run',
    profile: 'impl-neon',
    provider: 'codex',
    model: 'm',
    workerSessionId: 'sess-aaaa',
    startedAt: '2026-11-24T09:00:00Z',
    endedAt: '2026-11-24T10:00:00Z',
    outcome: 'completed',
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('sessionsFromExecutions', () => {
  it('uma sessão por provider:workerSessionId, com os roadmaps onde ela apareceu', () => {
    const sessions = sessionsFromExecutions([
      exec({ id: 1, roadmapId: 'r1', endedAt: '2026-11-24T08:00:00Z' }),
      exec({ id: 2, roadmapId: 'r2', endedAt: '2026-11-24T10:00:00Z' }),
      exec({ id: 3, roadmapId: 'r1', provider: 'claude-code', workerSessionId: 'sess-bbbb', profile: 'reviewer' }),
    ]);
    expect(sessions).toHaveLength(2);
    const codex = sessions.find((s) => s.id === 'codex:sess-aaaa')!;
    expect(codex).toMatchObject({ agentId: 'impl-neon', displayName: 'impl-neon', harness: 'codex', model: 'm', lastSeen: '2026-11-24T10:00:00Z' });
    expect([...codex.roadmapIds].sort()).toEqual(['r1', 'r2']);
    expect(sessions.find((s) => s.id === 'claude-code:sess-bbbb')).toMatchObject({ agentId: 'reviewer', harness: 'claude-code' });
  });

  it('execução em andamento deixa a sessão ativa e aponta o item; as demais ficam ociosas', () => {
    const [running, done] = [
      sessionsFromExecutions([exec({ outcome: 'running', endedAt: undefined, itemId: 'r1-b' })])[0]!,
      sessionsFromExecutions([exec({ outcome: 'completed' })])[0]!,
    ];
    expect(running).toMatchObject({ status: 'active', currentItemId: 'r1-b' });
    expect(done).toMatchObject({ status: 'idle', currentItemId: null });
  });

  it('ignora execução sem id de sessão (o revisor do pipeline)', () => {
    expect(sessionsFromExecutions([exec({ workerSessionId: '' })])).toEqual([]);
  });

  it('não rotula como somente leitura quem trabalhou no roadmap', () => {
    expect(sessionsFromExecutions([exec()])[0]!.capabilities).toContain('roadmap.write');
  });

  it('da mais antiga para a mais nova, para a mais recente definir o agente de um mesmo perfil', () => {
    const sessions = sessionsFromExecutions([
      exec({ id: 1, workerSessionId: 'sess-novo', endedAt: '2026-11-24T12:00:00Z' }),
      exec({ id: 2, workerSessionId: 'sess-velho', endedAt: '2026-11-24T08:00:00Z' }),
    ]);
    expect(sessions.map((s) => s.id)).toEqual(['codex:sess-velho', 'codex:sess-novo']);
  });
});

/** Simula o proxy do Habblaud com dois roadmaps; guarda as URLs pedidas. */
function stubProxy(opts: { executions?: Record<string, Response | ApiItemExecution[]> } = {}): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/status')) return json(200, { enabled: true, configured: true, local: true, available: true });
      if (url === '/api/roadmap/roadmaps') return json(200, { roadmaps: [{ id: 'r1' }, { id: 'r2' }] });
      const snapshot = /^\/api\/roadmap\/roadmaps\/(r\d)$/.exec(url);
      if (snapshot) return json(200, { schemaVersion: 1, roadmap: { id: snapshot[1] } });
      const executions = /^\/api\/roadmap\/roadmaps\/(r\d)\/executions\?limit=200$/.exec(url);
      if (executions) {
        const given = opts.executions?.[executions[1]!];
        if (given instanceof Response) return given.clone();
        return json(200, { roadmapId: executions[1], executions: given ?? [] });
      }
      return json(404, { error: { code: 'not_found', message: 'rota não encontrada', retryable: false } });
    }),
  );
  return urls;
}

describe('loadLiveData sem as rotas de conversa do pipeline', () => {
  it('monta as sessões pelas execuções de cada roadmap e não chama /agent/sessions', async () => {
    const urls = stubProxy({
      executions: {
        r1: [exec({ roadmapId: 'r1' })],
        r2: [exec({ id: 2, roadmapId: 'r2', provider: 'claude-code', workerSessionId: 'sess-bbbb', profile: 'reviewer' })],
      },
    });

    const data = await loadLiveData();

    expect(data.snapshots.map((s) => s.roadmap.id)).toEqual(['r1', 'r2']);
    expect(data.sessions.map((s) => s.id).sort()).toEqual(['claude-code:sess-bbbb', 'codex:sess-aaaa']);
    expect(urls.some((url) => url.includes('/agent/sessions'))).toBe(false);
  });

  it('a falha das execuções de um roadmap não derruba a página: ele só fica sem sessões', async () => {
    stubProxy({
      executions: {
        r1: json(500, { error: { code: 'internal', message: 'quebrou', retryable: true } }),
        r2: [exec({ roadmapId: 'r2' })],
      },
    });

    const data = await loadLiveData();

    expect(data.snapshots).toHaveLength(2);
    expect(data.sessions.map((s) => s.id)).toEqual(['codex:sess-aaaa']);
  });
});
