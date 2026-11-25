import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoadmapConfig } from './config';
import { createRoadmapHandler } from './proxy';

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

interface Seen {
  method: string;
  path: string;
  auth: string;
  body: unknown;
}

async function setup(opts: { status?: number; problem?: string | null; ids?: string[]; withReview?: boolean } = {}) {
  const seen: Seen[] = [];
  const upstream = await listen((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: JSON.parse(raw) });
      res.writeHead(opts.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(opts.status ? { error: { code: 'revision_conflict', message: 'revisão divergente' } } : { ok: true }));
    });
  });
  const config: RoadmapConfig = { enabled: true, url: upstream, token: 'segredo', ...(opts.ids ? { ids: opts.ids } : {}) };
  const handler = createRoadmapHandler({
    config,
    isLocal: () => true,
    ...(opts.withReview === false ? {} : { review: { problem: () => opts.problem ?? null } }),
  });
  const base = await listen((req, res) => handler(req, res, new URL(req.url ?? '/', 'http://localhost')));
  const post = (body: unknown) => fetch(`${base}/api/roadmap/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { seen, post, base };
}

const BODY = { roadmapId: 'r1', itemId: 'item_a', decision: 'approve', note: 'conferi', expectedRevision: 7, actionId: '11111111-1111-4111-8111-111111111111' };

describe('POST /api/roadmap/review', () => {
  it('repassa só a decisão ao item certo, com o token do servidor', async () => {
    const { seen, post } = await setup();
    const response = await post({ ...BODY, extra: 'não vai', status: 'done' });
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      {
        method: 'POST',
        path: '/api/roadmaps/r1/items/item_a/review',
        auth: 'Bearer segredo',
        body: { actionId: BODY.actionId, expectedRevision: 7, decision: 'approve', note: 'conferi' },
      },
    ]);
  });

  it('só a própria página decide: pedido de outro site não chega ao pipeline', async () => {
    const { seen, post } = await setup({ problem: 'origem não permitida' });
    expect((await post(BODY)).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it.each([
    [{ decision: 'canceled' }],
    [{ itemId: '../../mcp' }],
    [{ roadmapId: '' }],
    [{ expectedRevision: '7' }],
    [{ actionId: 'x' }],
    [{ decision: 'return', note: '  ' }],
  ])('recusa pedido inválido %o sem tocar o pipeline', async (over) => {
    const { seen, post } = await setup();
    expect((await post({ ...BODY, ...over })).status).toBe(400);
    expect(seen).toEqual([]);
  });

  it('respeita a lista de roadmaps permitidos', async () => {
    const { seen, post } = await setup({ ids: ['outro'] });
    expect((await post(BODY)).status).toBe(404);
    expect(seen).toEqual([]);
  });

  it('devolve a recusa do pipeline como veio', async () => {
    const { post } = await setup({ status: 409 });
    const response = await post(BODY);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'revision_conflict' } });
  });

  it('só existe por POST e quando configurada', async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/api/roadmap/review`)).status).toBe(405);
    const off = await setup({ withReview: false });
    expect((await off.post(BODY)).status).toBe(404);
  });
});
