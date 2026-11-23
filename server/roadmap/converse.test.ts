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

/** Pipeline falso: devolve o que o teste entregar para participants e executions do item r/i. */
async function fakePipeline(participants: unknown[], executions: unknown[] = [], seen: string[] = []): Promise<string> {
  return listen((req, res) => {
    seen.push(`${req.method} ${req.url} ${String(req.headers.authorization)}`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (req.url === '/api/roadmaps/r/items/i/participants') res.end(JSON.stringify({ roadmapId: 'r', itemId: 'i', participants }));
    else if (req.url === '/api/roadmaps/r/items/i/executions') res.end(JSON.stringify({ roadmapId: 'r', itemId: 'i', executions }));
    else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'x', retryable: false } }));
    }
  });
}

const codexParticipant = {
  profile: 'impl',
  harness: 'codex',
  model: 'm',
  role: 'implementador',
  executions: 1,
  lastEndedAt: '2026-11-22T10:00:00Z',
  resume: { harness: 'codex', sessionId: SID, workdir: '/w/proj', argv: ['codex', 'resume'] },
};

interface Harness {
  base: string;
  sent: unknown[];
}

async function start(pipelineUrl: string, opts: { live?: boolean; sendResult?: SendResult; withConverse?: boolean; local?: boolean } = {}): Promise<Harness> {
  const sent: unknown[] = [];
  const converse: ConverseDeps = {
    office: { list: () => [{ id: 'codex:1', provider: 'codex', sessionId: SID, kind: 'main' }] },
    messages: {
      canMessage: () => opts.live !== false,
      send: (raw) => {
        sent.push(raw);
        return opts.sendResult ?? { message: { id: 'm-1', agentId: 'codex:1', status: 'queued', createdAt: 1, updatedAt: 1 } };
      },
    },
  };
  const config: RoadmapConfig = { enabled: true, url: pipelineUrl, token: 'segredo' };
  const handler = createRoadmapHandler({
    config,
    isLocal: () => opts.local !== false,
    ...(opts.withConverse === false ? {} : { converse }),
  });
  const base = await listen((req, res) => handler(req, res, new URL(req.url ?? '/', 'http://localhost')));
  return { base, sent };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/roadmap/converse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/roadmap/converse', () => {
  it('entrega a pergunta ao agente vivo que trabalhou no item e diz como escolheu', async () => {
    const seen: string[] = [];
    const { base, sent } = await start(await fakePipeline([codexParticipant], [], seen));
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'como ficou o teste?' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, messageId: 'm-1', agentId: 'codex:1', route: { reason: 'live', provider: 'codex' } });
    expect(sent).toHaveLength(1);
    const delivered = sent[0] as { agentId: string; text: string };
    expect(delivered.agentId).toBe('codex:1');
    expect(delivered.text).toContain('como ficou o teste?');
    expect(delivered.text).toContain('r');
    expect(seen[0]).toBe('GET /api/roadmaps/r/items/i/participants Bearer segredo');
  });

  it('usa o workerSessionId real quando o pipeline ainda não devolve participants', async () => {
    const execution = { provider: 'codex', workerSessionId: SID, startedAt: '2026-11-22T09:00:00Z', endedAt: '2026-11-22T10:00:00Z' };
    const url = await listen((req, res) => {
      res.writeHead(req.url?.endsWith('/participants') ? 404 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.url?.endsWith('/participants') ? JSON.stringify({ error: { code: 'not_found', message: 'x', retryable: false } }) : JSON.stringify({ executions: [execution] }));
    });
    const { base } = await start(url);
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(202);
  });

  it('sessão fechada: 409 session_closed, sem entregar nada, e avisa se dá para reabrir', async () => {
    const { base, sent } = await start(await fakePipeline([codexParticipant]), { live: false });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'session_closed' }, route: { reason: 'recent', resumable: true } });
    expect(sent).toHaveLength(0);
  });

  it('ninguém trabalhou no item: 404 no_session', async () => {
    const { base, sent } = await start(await fakePipeline([]));
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'no_session' } });
    expect(sent).toHaveLength(0);
  });

  it('repassa a recusa do registro de mensagens (agente não aceita mensagem agora)', async () => {
    const { base } = await start(await fakePipeline([codexParticipant]), { sendResult: { error: 'unavailable', reason: 'sem entregador' } });
    const response = await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'unavailable', message: 'sem entregador' } });
  });

  it('corpo inválido: 400 sem consultar o pipeline', async () => {
    const seen: string[] = [];
    const { base } = await start(await fakePipeline([codexParticipant], [], seen));
    for (const body of [{}, { roadmapId: 'r', itemId: 'i' }, { roadmapId: 'r', itemId: 'i', text: '   ' }, { roadmapId: '', itemId: 'i', text: 'x' }]) {
      expect((await post(base, body)).status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it('respeita a allowlist de roadmaps e a porta local', async () => {
    const url = await fakePipeline([codexParticipant]);
    const restricted = createRoadmapHandler({ config: { enabled: true, url, token: 't', ids: ['outro'] }, isLocal: () => true, converse: undefined });
    const base = await listen((req, res) => restricted(req, res, new URL(req.url ?? '/', 'http://localhost')));
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(404);
    const remote = await start(url, { local: false });
    expect((await post(remote.base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(403);
  });

  it('sem a conversa configurada, a rota não existe', async () => {
    const { base } = await start(await fakePipeline([codexParticipant]), { withConverse: false });
    expect((await post(base, { roadmapId: 'r', itemId: 'i', text: 'oi' })).status).toBe(404);
  });
});
