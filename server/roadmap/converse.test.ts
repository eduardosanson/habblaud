import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { SendResult } from '../messages/registry';
import type { RoadmapConfig } from './config';
import { createRoadmapHandler, type ConverseDeps } from './proxy';

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const SID = '0198a1b2-c3d4-4e5f-8a9b-0123456789ab';
const SID_B = '0198a1b2-c3d4-4e5f-8a9b-0123456789cd';

function exec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    roadmapId: 'r',
    itemId: 'i',
    source: 'pipeline-run',
    profile: 'impl',
    provider: 'codex',
    model: 'm',
    workerSessionId: SID,
    cwd: '/w/proj',
    startedAt: '2026-11-22T09:00:00Z',
    endedAt: '2026-11-22T10:00:00Z',
    ...over,
  };
}

interface Fake {
  item?: unknown[];
  roadmap?: unknown[];
  /** Resposta de GET /api/roadmaps/r; sem ela, 404. */
  snapshot?: unknown;
  /** Responde este status (com envelope de erro) em qualquer rota de execuções. */
  failWith?: number;
  seen?: string[];
}

/** Pipeline falso: só as duas rotas de execuções do item r/i e do roadmap r. */
async function fakePipeline(fake: Fake = {}): Promise<string> {
  return listen((req, res) => {
    fake.seen?.push(`${req.method} ${req.url} ${String(req.headers.authorization)}`);
    if (fake.failWith) {
      res.writeHead(fake.failWith, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'forbidden', message: 'token inválido', retryable: false } }));
      return;
    }
    const json = { 'Content-Type': 'application/json; charset=utf-8' };
    if (req.url === '/api/roadmaps/r' && fake.snapshot) {
      res.writeHead(200, json);
      res.end(JSON.stringify(fake.snapshot));
    } else if (req.url === '/api/roadmaps/r/items/i/executions') {
      res.writeHead(200, json);
      res.end(JSON.stringify({ roadmapId: 'r', itemId: 'i', executions: fake.item ?? [] }));
    } else if (req.url === '/api/roadmaps/r/executions?limit=200') {
      res.writeHead(200, json);
      res.end(JSON.stringify({ roadmapId: 'r', executions: fake.roadmap ?? [] }));
    } else {
      res.writeHead(404, json);
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'x', retryable: false } }));
    }
  });
}

interface Harness {
  base: string;
  sent: unknown[];
}

interface StartOpts {
  /** Todos os agentes aceitam mensagem (padrão) ou nenhum. */
  live?: boolean;
  sendResult?: SendResult;
  withConverse?: boolean;
  local?: boolean;
  /** Liga a reabertura; `problem` é a trava do terminal (motivo da recusa). */
  reopen?: { problem: string | null; resumed: string[] };
  /** `provider` ausente quer dizer Claude Code, como no escritório de verdade. */
  agents?: Array<{ id: string; provider?: 'codex' | 'claude'; sessionId: string }>;
}

async function start(pipelineUrl: string, opts: StartOpts = {}): Promise<Harness> {
  const sent: unknown[] = [];
  const agents = opts.agents ?? [{ id: 'codex:1', provider: 'codex', sessionId: SID }];
  const converse: ConverseDeps = {
    office: { list: () => agents.map((a) => ({ ...a, kind: 'main' })) },
    messages: {
      canMessage: () => opts.live !== false,
      send: (raw) => {
        sent.push(raw);
        const agentId = (raw as { agentId: string }).agentId;
        return opts.sendResult ?? { message: { id: 'm-1', agentId, status: 'queued', createdAt: 1, updatedAt: 1 } };
      },
    },
  };
  const config: RoadmapConfig = { enabled: true, url: pipelineUrl, token: 'segredo' };
  const handler = createRoadmapHandler({
    config,
    isLocal: () => opts.local !== false,
    ...(opts.withConverse === false ? {} : { converse }),
    ...(opts.reopen
      ? {
          reopen: {
            problem: () => opts.reopen!.problem,
            deps: {
              ...converse,
              accounts: () => [],
              isAlive: () => false,
              resume: (p: { sessionId: string }) => {
                opts.reopen!.resumed.push(p.sessionId);
                return { agentId: 'acc:1' };
              },
              opened: () => 'acc:1',
            },
          },
        }
      : {}),
  });
  const base = await listen((req, res) => handler(req, res, new URL(req.url ?? '/', 'http://localhost')));
  return { base, sent };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/roadmap/converse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sessions = (base: string, query = 'roadmapId=r&itemId=i') => fetch(`${base}/api/roadmap/sessions?${query}`);

const TWO_AGENTS = [
  { id: 'codex:1', provider: 'codex' as const, sessionId: SID },
  { id: 'claude:2', provider: 'claude' as const, sessionId: SID_B },
];
const TWO_EXECUTIONS = [
  exec({ id: 1, provider: 'codex', workerSessionId: SID, endedAt: '2026-11-22T10:00:00Z' }),
  exec({ id: 2, provider: 'claude-code', workerSessionId: SID_B, profile: 'reviewer', endedAt: '2026-11-22T12:00:00Z' }),
];

describe('POST /api/roadmap/converse', () => {
  it('entrega a pergunta ao agente vivo que trabalhou no item e diz como escolheu', async () => {
    const seen: string[] = [];
    const { base, sent } = await start(await fakePipeline({ item: [exec()], seen }));
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'como ficou o teste?' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, messageId: 'm-1', agentId: 'codex:1', sentAt: expect.any(Number), route: { reason: 'live', provider: 'codex' } });
    expect(sent).toHaveLength(1);
    const delivered = sent[0] as { agentId: string; text: string };
    expect(delivered.agentId).toBe('codex:1');
    expect(delivered.text).toContain('como ficou o teste?');
    expect(seen).toEqual(['GET /api/roadmaps/r/items/i/executions Bearer segredo', 'GET /api/roadmaps/r Bearer segredo']);
  });

  it('a pergunta chega com o número e o título do item, que a sessão pode nunca ter visto', async () => {
    const snapshot = { roadmap: { id: 'r', phases: [{ id: 'f', items: [{ id: 'outro', key: '1.1', title: 'Outro' }, { id: 'i', key: '5.1', title: 'Revisar a busca' }] }] } };
    const { base, sent } = await start(await fakePipeline({ item: [exec()], snapshot }));
    await post(base, { roadmapId: 'r', itemId: 'i', text: 'o que mudou no 5.1?' });
    expect((sent[0] as { text: string }).text).toContain('5.1 «Revisar a busca»');
  });

  it('sem conseguir ler o item, entrega com o id mesmo', async () => {
    const { base, sent } = await start(await fakePipeline({ item: [exec()] }));
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(202);
    expect((sent[0] as { text: string }).text).toContain('item i');
  });

  it('item sem execuções: usa quem trabalhou no roadmap', async () => {
    const { base } = await start(await fakePipeline({ item: [], roadmap: [exec({ itemId: 'outro' })] }));
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ route: { reason: 'roadmap-live' } });
  });

  it('sessão fechada: 409 session_closed, sem entregar nada, e avisa se dá para reabrir', async () => {
    const { base, sent } = await start(await fakePipeline({ item: [exec({ provider: 'claude-code', workerSessionId: SID })] }), { live: false });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'session_closed', details: { route: { reason: 'recent', resumable: true } } } });
    expect(sent).toHaveLength(0);
  });

  it('ninguém trabalhou no item nem no roadmap: 404 no_session', async () => {
    const { base, sent } = await start(await fakePipeline());
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'no_session' } });
    expect(sent).toHaveLength(0);
  });

  it('repassa a recusa do registro de mensagens (agente não aceita mensagem agora)', async () => {
    const { base } = await start(await fakePipeline({ item: [exec()] }), { sendResult: { error: 'unavailable', reason: 'sem entregador' } });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'unavailable', message: 'sem entregador' } });
  });

  it('corpo inválido: 400 sem consultar o pipeline', async () => {
    const seen: string[] = [];
    const { base } = await start(await fakePipeline({ item: [exec()], seen }));
    for (const body of [{}, { roadmapId: 'r', itemId: 'i' }, { roadmapId: 'r', itemId: 'i', text: '   ' }, { roadmapId: '', itemId: 'i', text: 'x' }]) {
      expect((await post(base, body)).status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it('respeita a allowlist de roadmaps e a porta local', async () => {
    const url = await fakePipeline({ item: [exec()] });
    const restricted = createRoadmapHandler({ config: { enabled: true, url, token: 't', ids: ['outro'] }, isLocal: () => true, converse: undefined });
    const base = await listen((req, res) => restricted(req, res, new URL(req.url ?? '/', 'http://localhost')));
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(404);
    const remote = await start(url, { local: false });
    expect((await post(remote.base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(403);
  });

  it('sem a conversa configurada, a rota não existe', async () => {
    const { base } = await start(await fakePipeline({ item: [exec()] }), { withConverse: false });
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(404);
  });

  it('com o pipeline recusando o token, repassa o status e o erro dele', async () => {
    const { base, sent } = await start(await fakePipeline({ failWith: 401 }));
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden', message: 'token inválido' } });
    expect(sent).toHaveLength(0);
  });
});

describe('POST /api/roadmap/converse com a sessão escolhida', () => {
  it('entrega na sessão viva escolhida, não na sugerida (CA05)', async () => {
    const { base, sent } = await start(await fakePipeline({ item: TWO_EXECUTIONS }), { agents: TWO_AGENTS });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi', session: { provider: 'codex', sessionId: SID } });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ agentId: 'codex:1' });
    expect((sent[0] as { agentId: string }).agentId).toBe('codex:1');
  });

  it('sem `session`, vale a sugerida: a viva mais recente', async () => {
    const { base } = await start(await fakePipeline({ item: TWO_EXECUTIONS }), { agents: TWO_AGENTS });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(await response.json()).toMatchObject({ agentId: 'claude:2' });
  });

  it('sessão que o servidor não listou: 400 unknown_session e nada entra na fila (CA04)', async () => {
    const { base, sent } = await start(await fakePipeline({ item: TWO_EXECUTIONS }), { agents: TWO_AGENTS });
    for (const session of [
      { provider: 'codex', sessionId: 'forjada-0123' },
      { provider: 'opencode', sessionId: SID },
      { provider: 'codex' },
      'codex',
    ]) {
      const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi', session });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'unknown_session' } });
    }
    expect(sent).toHaveLength(0);
  });

  it('sessão escolhida fechada: 409 session_closed (CA06)', async () => {
    const { base, sent } = await start(await fakePipeline({ item: TWO_EXECUTIONS }), { agents: [TWO_AGENTS[1]!] });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi', session: { provider: 'codex', sessionId: SID } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'session_closed' } });
    expect(sent).toHaveLength(0);
  });
});

describe('GET /api/roadmap/sessions', () => {
  it('lista as sessões do item sem repetição, vivas primeiro, e diz qual é a sugerida (CA03)', async () => {
    const item = [
      ...TWO_EXECUTIONS,
      exec({ id: 3, provider: 'codex', workerSessionId: SID, profile: 'impl-novo', endedAt: '2026-11-22T14:00:00Z' }),
      exec({ id: 4, provider: 'claude-subscription-directsdk-experimental', workerSessionId: '', profile: 'revisor-sem-id' }),
    ];
    const { base } = await start(await fakePipeline({ item }), { agents: [TWO_AGENTS[1]!] });
    const response = await sessions(base);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { options: Array<Record<string, unknown>>; suggested: unknown };
    expect(body.options).toHaveLength(2);
    expect(body.options[0]).toMatchObject({ provider: 'claude', sessionId: SID_B, agentId: 'claude:2', live: true, profile: 'reviewer', scope: 'item' });
    expect(body.options[1]).toMatchObject({ provider: 'codex', sessionId: SID, live: false, profile: 'impl-novo', resumable: true, lastAt: '2026-11-22T14:00:00Z' });
    expect(body.options[1]).not.toHaveProperty('agentId');
    expect(body.suggested).toEqual({ provider: 'claude', sessionId: SID_B });
    expect(JSON.stringify(body)).not.toContain('/w/proj');
  });

  it('item sem execuções: cai no roadmap e marca o escopo', async () => {
    const { base } = await start(await fakePipeline({ item: [], roadmap: [exec({ itemId: 'outro' })] }));
    const body = (await (await sessions(base)).json()) as { options: Array<Record<string, unknown>> };
    expect(body.options).toMatchObject([{ sessionId: SID, scope: 'roadmap', live: true }]);
  });

  it('ninguém registrado: lista vazia e nenhuma sugerida (CA07)', async () => {
    const { base } = await start(await fakePipeline());
    expect(await (await sessions(base)).json()).toEqual({ options: [], suggested: null });
  });

  it('pipeline recusando o token: repassa o status e o erro dele (CA08)', async () => {
    const { base } = await start(await fakePipeline({ failWith: 401 }));
    const response = await sessions(base);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden', message: 'token inválido' } });
  });

  it('pede roadmapId e itemId; só abre pelo próprio computador e respeita a allowlist', async () => {
    const url = await fakePipeline({ item: [exec()] });
    const local = await start(url);
    expect((await sessions(local.base, 'roadmapId=r')).status).toBe(400);
    expect((await sessions(local.base, '')).status).toBe(400);
    const remote = await start(url, { local: false });
    expect((await sessions(remote.base)).status).toBe(403);
    const restricted = createRoadmapHandler({
      config: { enabled: true, url, token: 't', ids: ['outro'] },
      isLocal: () => true,
      converse: { office: { list: () => [] }, messages: { canMessage: () => true, send: () => ({ error: 'not-found' }) } },
    });
    const base = await listen((req, res) => restricted(req, res, new URL(req.url ?? '/', 'http://localhost')));
    expect((await sessions(base)).status).toBe(404);
  });

  it('sem a conversa configurada, a rota não existe', async () => {
    const { base } = await start(await fakePipeline({ item: [exec()] }), { withConverse: false });
    expect((await sessions(base)).status).toBe(404);
  });
});

describe('agente do Claude Code no escritório (provider ausente quer dizer claude)', () => {
  const CLAUDE_AGENT = [{ id: '.claude:123', sessionId: SID_B }];
  const CLAUDE_EXECUTION = [exec({ provider: 'claude-code', workerSessionId: SID_B, profile: 'claude-code-sonnet-5-5' })];

  it('lista a sessão como viva e acessível', async () => {
    const { base } = await start(await fakePipeline({ item: CLAUDE_EXECUTION }), { agents: CLAUDE_AGENT });
    const body = (await (await sessions(base)).json()) as { options: Array<Record<string, unknown>> };
    expect(body.options).toMatchObject([{ provider: 'claude', sessionId: SID_B, live: true, agentId: '.claude:123' }]);
  });

  it('entrega a pergunta nela', async () => {
    const { base, sent } = await start(await fakePipeline({ item: CLAUDE_EXECUTION }), { agents: CLAUDE_AGENT });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi', session: { provider: 'claude', sessionId: SID_B } });
    expect(response.status).toBe(202);
    expect((sent[0] as { agentId: string }).agentId).toBe('.claude:123');
  });
});

describe('POST /api/roadmap/reopen', () => {
  const body = { roadmapId: 'r', itemId: 'i', session: { provider: 'claude', sessionId: SID } };
  const reopenPost = (base: string, method = 'POST') =>
    fetch(`${base}/api/roadmap/reopen`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  const pipeline = () => fakePipeline({ item: [exec({ provider: 'claude-code' })] });

  it('chega à reabertura com a sessão listada', async () => {
    const reopen = { problem: null, resumed: [] as string[] };
    const { base } = await start(await pipeline(), { agents: [], reopen });
    const response = await reopenPost(base);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reopened: false, agentId: 'acc:1' });
  });

  it('aplica a trava do terminal antes de qualquer coisa', async () => {
    const reopen = { problem: 'origem não permitida', resumed: [] as string[] };
    const { base } = await start(await pipeline(), { agents: [], reopen });
    const response = await reopenPost(base);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'local_only', message: 'origem não permitida' } });
    expect(reopen.resumed).toEqual([]);
  });

  it('só aceita POST, e sem configuração a rota não existe', async () => {
    const withIt = await start(await pipeline(), { reopen: { problem: null, resumed: [] } });
    expect((await reopenPost(withIt.base, 'GET')).status).toBe(405);
    const without = await start(await pipeline());
    expect((await reopenPost(without.base)).status).toBe(404);
  });
});
