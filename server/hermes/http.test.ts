// Rota dos eventos do plugin do Hermes (POST /api/hermes/events) pelas rotas de verdade (guard e app): repassa à
// fonte do Hermes só com Host local, só POST com JSON, corpo até 256 KB; sem a fonte, {ok: false}. Dados sintéticos.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import type { AgentInfo } from '../../shared/types';
import { HermesSource } from '../sources/hermes/source';
import { tempDir } from '../test/fixtures';
import { request } from '../test/permission-server';
import { parseHermesEvent } from './http';

setQuiet(true);

const HOME = '/home/u/.hermes/profiles/developer';
const EVENT = { type: 'session_open', session_id: 's1', platform: 'cli', project: '/p/loja' };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(opts: { source?: HermesSource | null } = {}): Promise<{ base: string; office: Office }> {
  const tmp = tempDir();
  const office = new Office({ names: new NameStore(null), version: 't', startedAt: 0, accounts: () => [], sources: () => [], accountName: () => undefined });
  const hub = new Hub(office, { throttleMs: 10 });
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
  const hermes = opts.source === null ? undefined : opts.source ?? new HermesSource({ accounts, office, home: '/home/u/.hermes' });
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, hermes });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  close = () =>
    new Promise((ok) => {
      hermes?.stop?.();
      hub.stop();
      server.closeAllConnections();
      server.close(() => {
        tmp.cleanup();
        ok();
      });
    });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, office };
}

const main = (office: Office): AgentInfo | undefined => office.commit().snapshot.agents.find((a) => a.provider === 'hermes' && a.kind === 'main');

describe('POST /api/hermes/events', () => {
  it('aplica session_open na fonte: agente na sala do projeto e {ok: true}', async () => {
    const s = await serve();
    const r = await request(s.base, '/api/hermes/events', { method: 'POST', body: { profile: 'developer', home: HOME, event: EVENT } });
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(main(s.office)).toMatchObject({ id: 'hermes:developer:s1', provider: 'hermes', account: 'developer', roomId: '/p/loja', status: 'idle' });
  });

  it('sem a fonte (ou se ela falha): 200 {ok: false}', async () => {
    let s = await serve({ source: null });
    expect(await request(s.base, '/api/hermes/events', { method: 'POST', body: { event: EVENT } })).toMatchObject({ status: 200, json: { ok: false } });
    await close!();
    const broken = { applyEvent: () => { throw new Error('quebrou'); } } as unknown as HermesSource;
    s = await serve({ source: broken });
    expect(await request(s.base, '/api/hermes/events', { method: 'POST', body: { event: EVENT } })).toMatchObject({ status: 200, json: { ok: false } });
  });

  it('Host que não é local: 403; GET: 405; sem JSON: 415; corpo inválido: 400; acima de 256 KB: 413', async () => {
    const s = await serve();
    for (const host of ['habblaud.lan:4747', '192.168.0.10:4747']) {
      const r = await request(s.base, '/api/hermes/events', { method: 'POST', headers: { Host: host }, body: { event: EVENT } });
      expect(r.status, host).toBe(403);
    }
    expect((await request(s.base, '/api/hermes/events')).status).toBe(405);
    expect((await request(s.base, '/api/hermes/events', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    for (const body of [{}, { event: 'x' }, { event: { session_id: 's' } }, []]) {
      expect((await request(s.base, '/api/hermes/events', { method: 'POST', body })).status, JSON.stringify(body)).toBe(400);
    }
    const big = { event: { ...EVENT, preview: 'x'.repeat(300 * 1024) } };
    expect((await request(s.base, '/api/hermes/events', { method: 'POST', body: big })).status).toBe(413);
  });

  it('peça pura: parseHermesEvent valida o type e completa o perfil padrão', () => {
    expect(parseHermesEvent({ profile: ' developer ', home: HOME, event: EVENT })).toEqual({ profile: 'developer', home: HOME, event: EVENT });
    expect(parseHermesEvent({ event: EVENT })).toEqual({ profile: 'default', event: EVENT });
    expect(() => parseHermesEvent({ event: {} })).toThrow();
    expect(() => parseHermesEvent({ event: 'x' })).toThrow();
  });
});
