// Cliente do OpenCode: descoberta do service.json, Basic auth, JSON e o parser SSE do /api/event.
import { describe, expect, it, vi } from 'vitest';
import {
  isLoopbackEndpoint,
  openCodeServiceFile,
  OpenCodeClient,
  parseOpenCodeService,
  readOpenCodeService,
} from './client';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('service.json do OpenCode', () => {
  it('acha o arquivo no XDG_STATE_HOME ou no padrão', () => {
    expect(openCodeServiceFile({ XDG_STATE_HOME: '/x/state' }, '/home/u')).toBe('/x/state/opencode/service.json');
    expect(openCodeServiceFile({}, '/home/u')).toBe('/home/u/.local/state/opencode/service.json');
  });

  it('lê url, senha e versão; recusa JSON sem o essencial', () => {
    expect(parseOpenCodeService({ url: 'http://127.0.0.1:49700/', password: 'segredo', version: '2.3.2', id: 'x' })).toEqual({
      url: 'http://127.0.0.1:49700',
      password: 'segredo',
      version: '2.3.2',
      id: 'x',
    });
    expect(parseOpenCodeService({ url: 'ftp://x', password: 'p' })).toBeUndefined();
    expect(parseOpenCodeService({ url: 'http://127.0.0.1:1' })).toBeUndefined();
    expect(parseOpenCodeService(null)).toBeUndefined();
  });

  it('só considera loopback o que é loopback', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:1')).toBe(true);
    expect(isLoopbackEndpoint('http://localhost:1')).toBe(true);
    expect(isLoopbackEndpoint('http://[::1]:1')).toBe(true);
    expect(isLoopbackEndpoint('http://192.168.0.2:1')).toBe(false);
    expect(isLoopbackEndpoint('http://host.docker.internal:1')).toBe(false);
  });

  it('readOpenCodeService devolve undefined para arquivo ausente ou inválido', () => {
    expect(readOpenCodeService('/caminho/que/nao/existe/service.json')).toBeUndefined();
  });
});

describe('OpenCodeClient', () => {
  it('manda Basic e devolve o data do envelope', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: `Basic ${Buffer.from('opencode:s3nh4').toString('base64')}` });
      return new Response(JSON.stringify({ data: [{ id: 'ses_1' }], cursor: {} }), { headers: { 'content-type': 'application/json' } });
    });
    const client = new OpenCodeClient({ url: 'http://127.0.0.1:1', password: 's3nh4' }, { fetch: fetchImpl as typeof fetch });
    await expect(client.get<{ id: string }[]>('/api/session')).resolves.toEqual([{ id: 'ses_1' }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('devolve o JSON direto quando não há envelope data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '2.3.2' })));
    const client = new OpenCodeClient({ url: 'http://127.0.0.1:1', password: 'p' }, { fetch: fetchImpl as typeof fetch });
    await expect(client.get<{ version: string }>('/api/info')).resolves.toEqual({ version: '2.3.2' });
  });

  it('erro HTTP vira exceção com o status, sem a senha', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    const client = new OpenCodeClient({ url: 'http://127.0.0.1:1', password: 'muito-secreta' }, { fetch: fetchImpl as typeof fetch });
    await expect(client.get('/api/session')).rejects.toThrow(/401/);
    await expect(client.get('/api/session')).rejects.not.toThrow(/muito-secreta/);
  });

  it('lê o SSE em pedaços, ignora heartbeat e entrega cada evento', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        streamOf([
          ': heartbeat\n\n',
          'data: {"id":"evt_1","type":"session.execution.started","created":10,"data":{"sessionID":"ses_1"}}\n\n',
          'data: {"id":"evt_2","type":"session.idle",',
          '"created":20,"data":{"sessionID":"ses_1"}}\n\n',
          ': heartbeat\n\n',
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const client = new OpenCodeClient({ url: 'http://127.0.0.1:1', password: 'p' }, { fetch: fetchImpl as typeof fetch });
    const events: unknown[] = [];
    for await (const ev of client.events()) events.push(ev);
    expect(events).toEqual([
      { id: 'evt_1', type: 'session.execution.started', created: 10, data: { sessionID: 'ses_1' } },
      { id: 'evt_2', type: 'session.idle', created: 20, data: { sessionID: 'ses_1' } },
    ]);
  });
});
