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

const CONFIG: RoadmapConfig = { enabled: true, url: 'http://127.0.0.1:1', token: 'segredo' };

async function startProxy(config: RoadmapConfig, local = true): Promise<string> {
  const handler = createRoadmapHandler({ config, isLocal: () => local });
  return listen((req, res) => handler(req, res, new URL(req.url ?? '/', 'http://localhost')));
}

async function readSse(url: string): Promise<{ status: number; type: string; body: string; close(): void }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.once('data', (chunk: Buffer) => {
        resolve({
          status: res.statusCode ?? 0,
          type: String(res.headers['content-type'] ?? ''),
          body: chunk.toString('utf8'),
          close() {
            req.destroy();
            res.destroy();
          },
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

describe('proxy do roadmap', () => {
  it('responde o status mesmo desligado e explica o motivo', async () => {
    const base = await startProxy({ enabled: false, warning: 'falta token' });
    const response = await fetch(`${base}/api/roadmap/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, available: false, reason: 'falta token' });
  });

  it('não libera dados fora do computador', async () => {
    const base = await startProxy(CONFIG, false);
    const status = await fetch(`${base}/api/roadmap/status`).then((r) => r.json());
    expect(status).toMatchObject({ local: false, available: false });
    expect((await fetch(`${base}/api/roadmap/roadmaps`)).status).toBe(403);
  });

  it('repassa a lista com o token e devolve JSON', async () => {
    let seenAuth = '';
    const upstream = await listen((req, res) => {
      seenAuth = String(req.headers.authorization ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ roadmaps: [{ id: 'atlas-ondas' }] }));
    });
    const base = await startProxy({ ...CONFIG, url: upstream });
    const response = await fetch(`${base}/api/roadmap/roadmaps`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roadmaps: [{ id: 'atlas-ondas' }] });
    expect(seenAuth).toBe('Bearer segredo');
  });

  it('repassa POST com corpo e Content-Type sem aceitar rota fora do contrato', async () => {
    let body = '';
    let type = '';
    const upstream = await listen((req, res) => {
      type = String(req.headers['content-type'] ?? '');
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end('{"accepted":true}');
      });
    });
    const base = await startProxy({ ...CONFIG, url: upstream });
    const response = await fetch(`${base}/api/roadmap/agent/sessions/sess-nina/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'mova o 6.1', messageId: 'x' }),
    });
    expect(response.status).toBe(202);
    expect(type).toContain('application/json');
    expect(JSON.parse(body)).toEqual({ text: 'mova o 6.1', messageId: 'x' });
    expect((await fetch(`${base}/api/roadmap/qualquer`)).status).toBe(404);
    expect((await fetch(`${base}/api/roadmap/roadmaps`, { method: 'PUT' })).status).toBe(405);
  });

  it('repassa SSE com o mesmo tipo e sem buffer', async () => {
    const upstream = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write('event: roadmap.changed\ndata: {"roadmapId":"atlas-ondas","revision":2}\n\n');
    });
    const base = await startProxy({ ...CONFIG, url: upstream });
    const sse = await readSse(`${base}/api/roadmap/roadmaps/atlas-ondas/events`);
    expect(sse.status).toBe(200);
    expect(sse.type).toContain('text/event-stream');
    expect(sse.body).toContain('roadmap.changed');
    sse.close();
  });

  it('com HABBLAUD_ROADMAP_IDS filtra a lista, as sessões e bloqueia outros snapshots', async () => {
    const upstream = await listen((req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.url === '/api/roadmaps') {
        res.end(JSON.stringify({ roadmaps: [{ id: 'atlas-ondas' }, { id: 'praca' }, { id: 'confianca' }] }));
        return;
      }
      if (req.url === '/api/agent/sessions') {
        res.end(
          JSON.stringify({
            sessions: [
              { id: 'sess-atlas', roadmapIds: ['atlas-ondas'] },
              { id: 'sess-seed', roadmapIds: ['praca', 'confianca'] },
              { id: 'sess-mixed', roadmapIds: ['atlas-ondas', 'praca'] },
            ],
          }),
        );
        return;
      }
      res.end(JSON.stringify({ roadmap: { id: 'praca' } }));
    });
    const base = await startProxy({ ...CONFIG, url: upstream, ids: ['atlas-ondas'] });
    expect(await fetch(`${base}/api/roadmap/status`).then((r) => r.json())).toMatchObject({ roadmaps: ['atlas-ondas'] });
    expect(await fetch(`${base}/api/roadmap/roadmaps`).then((r) => r.json())).toEqual({ roadmaps: [{ id: 'atlas-ondas' }] });
    expect(await fetch(`${base}/api/roadmap/agent/sessions`).then((r) => r.json())).toEqual({
      sessions: [
        { id: 'sess-atlas', roadmapIds: ['atlas-ondas'] },
        { id: 'sess-mixed', roadmapIds: ['atlas-ondas'] },
      ],
    });
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca`)).status).toBe(404);
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca/events`)).status).toBe(404);
    expect((await fetch(`${base}/api/roadmap/roadmaps/atlas-ondas`)).status).toBe(200);
  });

  it('repassa participants e executions do item, somente leitura, com o token', async () => {
    const seen: string[] = [];
    const upstream = await listen((req, res) => {
      seen.push(`${req.method} ${req.url} ${String(req.headers.authorization)}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ participants: [] }));
    });
    const base = await startProxy({ ...CONFIG, url: upstream });
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca/items/praca-3.7/participants`)).status).toBe(200);
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca/items/praca-3.7/executions`)).status).toBe(200);
    expect(seen).toEqual([
      'GET /api/roadmaps/praca/items/praca-3.7/participants Bearer segredo',
      'GET /api/roadmaps/praca/items/praca-3.7/executions Bearer segredo',
    ]);
    // POST nessas rotas não vira escrita: o pipeline só registra pelas ferramentas do agente.
    const posted = await fetch(`${base}/api/roadmap/roadmaps/praca/items/praca-3.7/participants`, { method: 'POST', body: '{}' });
    expect(posted.status).toBe(405);
  });

  it('com HABBLAUD_ROADMAP_IDS a allowlist vale também para as rotas do item', async () => {
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{}');
    });
    const base = await startProxy({ ...CONFIG, url: upstream, ids: ['atlas-ondas'] });
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca/items/praca-3.7/participants`)).status).toBe(404);
    expect((await fetch(`${base}/api/roadmap/roadmaps/praca/items/praca-3.7/executions`)).status).toBe(404);
    expect((await fetch(`${base}/api/roadmap/roadmaps/atlas-ondas/items/atlas-ondas-E1/participants`)).status).toBe(200);
  });

  it('responde 502 quando o pipeline está fora do ar', async () => {
    const base = await startProxy({ ...CONFIG, url: 'http://127.0.0.1:1' });
    const response = await fetch(`${base}/api/roadmap/roadmaps`);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('pipeline_unavailable');
  });

  it('reflete troca de URL e token quando config é fornecida como função', async () => {
    const seen: string[] = [];
    const upstreamA = await listen((req, res) => {
      seen.push(`A:${String(req.headers.authorization ?? '')}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ roadmaps: [{ id: 'a' }] }));
    });
    const upstreamB = await listen((req, res) => {
      seen.push(`B:${String(req.headers.authorization ?? '')}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ roadmaps: [{ id: 'b' }] }));
    });
    let active: RoadmapConfig = { enabled: true, url: upstreamA, token: 'tok-a' };
    const handler = createRoadmapHandler({ config: () => active, isLocal: () => true });
    const base = await listen((req, res) => handler(req, res, new URL(req.url ?? '/', 'http://localhost')));

    expect(await fetch(`${base}/api/roadmap/roadmaps`).then((r) => r.json())).toEqual({ roadmaps: [{ id: 'a' }] });
    active = { enabled: true, url: upstreamB, token: 'tok-b' };
    expect(await fetch(`${base}/api/roadmap/roadmaps`).then((r) => r.json())).toEqual({ roadmaps: [{ id: 'b' }] });
    expect(seen).toEqual(['A:Bearer tok-a', 'B:Bearer tok-b']);
  });

  it('respeita enabled: false mesmo quando url e token estão preenchidos (HABBLAUD_ROADMAP=0)', async () => {
    const base = await startProxy({ enabled: false, url: 'https://sanson-server.com', token: 'segredo' });
    const status = await fetch(`${base}/api/roadmap/status`).then((r) => r.json());
    expect(status).toMatchObject({ enabled: false, available: false });
    expect((await fetch(`${base}/api/roadmap/roadmaps`)).status).toBe(503);
  });
});
