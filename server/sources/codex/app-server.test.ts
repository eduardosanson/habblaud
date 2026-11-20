// Leitor do uso ao vivo do Codex pelo app-server local (socket Unix, JSON-RPC por linha).
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { codexPlanLabel } from './accounts';
import { codexAppServerSocket, readCodexAppServerUsage, usageFromAppServer } from './app-server';
import { CodexSource } from './source';

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function fixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rateLimits: {
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 41, windowDurationMins: 10080, resetsAt: 1_900_000_000 },
      planType: 'plus',
      rateLimitReachedType: null,
    },
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 41, windowDurationMins: 10080, resetsAt: 1_900_000_000 },
        planType: 'plus',
        rateLimitReachedType: null,
      },
      outro_modelo: {
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        planType: 'pro',
      },
    },
    ...over,
  };
}

/** Frame de texto do servidor (sem máscara). */
function serverFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const head = Buffer.alloc(4);
  head[0] = 0x81;
  head[1] = 126;
  head.writeUInt16BE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

/** Um frame de cliente (mascarado); undefined se faltam bytes. */
function clientFrame(buffer: Buffer): { payload: string; size: number } | undefined {
  if (buffer.length < 2) return undefined;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (!masked || buffer.length < offset + 4 + length) return undefined;
  const key = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + length).map((b, i) => b ^ key[i % 4]));
  return { payload: payload.toString(), size: offset + length };
}

/** Servidor WebSocket/JSON-RPC de mentira: responde initialize e account/rateLimits/read com o resultado dado. */
async function fakeAppServer(result: Record<string, unknown> | null): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'hb-codex-'));
  const socketPath = join(dir, 's.sock');
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('latin1');
        buffer = buffer.subarray(end + 4);
        const key = /sec-websocket-key:\s*(.+)/i.exec(head)?.[1]?.trim() ?? '';
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        upgraded = true;
      }
      for (let frame = clientFrame(buffer); frame; frame = clientFrame(buffer)) {
        buffer = buffer.subarray(frame.size);
        const message = JSON.parse(frame.payload) as { id?: number };
        if (message.id === 1) socket.write(serverFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));
        if (message.id === 2) {
          const reply = result
            ? { jsonrpc: '2.0', id: 2, result }
            : { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'sem login' } };
          socket.write(serverFrame(JSON.stringify(reply)));
        }
      }
    });
  });
  await new Promise<void>((ok) => server.listen(socketPath, ok));
  cleanups.push(() => {
    for (const s of sockets) s.destroy();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return socketPath;
}

describe('uso do Codex pelo app-server local', () => {
  const NOW = Date.parse('2026-11-20T01:30:00Z');

  it('mapeia primary/secondary, prefere o bucket codex e converte resetsAt de segundos', () => {
    const live = usageFromAppServer(fixture(), NOW)!;
    expect(live.plan).toBe('Plus');
    expect(live.usage).toEqual({
      source: 'codex',
      fetchedAt: NOW,
      fiveHour: { utilization: 12, resetsAt: 1_800_000_000_000 },
      sevenDay: { utilization: 41, resetsAt: 1_900_000_000_000 },
    });
  });

  it('sem rateLimitsByLimitId, cai no rateLimits legado; sem duração usa a posição', () => {
    const live = usageFromAppServer(
      {
        rateLimits: {
          primary: { usedPercent: 7, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 8, resetsAt: 1_900_000_000 },
        },
      },
      NOW,
    )!;
    expect(live.usage.fiveHour).toEqual({ utilization: 7, resetsAt: 1_800_000_000_000 });
    expect(live.usage.sevenDay).toEqual({ utilization: 8, resetsAt: 1_900_000_000_000 });
  });

  it('sem janelas e com cota esgotada: sem cota; sem nada: indefinido', () => {
    expect(usageFromAppServer({ rateLimits: { primary: null, secondary: null, rateLimitReachedType: 'workspace_owner_credits_depleted' } }, NOW)).toEqual({
      usage: { source: 'codex', fetchedAt: NOW, noQuota: true },
    });
    expect(usageFromAppServer({ rateLimits: { primary: null, secondary: null } }, NOW)).toBeUndefined();
    expect(usageFromAppServer(null, NOW)).toBeUndefined();
  });

  it('lê o socket: initialize e depois account/rateLimits/read', async () => {
    const socketPath = await fakeAppServer(fixture());
    const live = await readCodexAppServerUsage({ socketPath, now: NOW });
    expect(live?.usage.fiveHour?.utilization).toBe(12);
    expect(live?.usage.sevenDay?.utilization).toBe(41);
    expect(live?.plan).toBe('Plus');
  });

  it('socket ausente ou erro do app-server: undefined, sem exceção', async () => {
    expect(await readCodexAppServerUsage({ socketPath: join(tmpdir(), 'nao-existe.sock'), now: NOW })).toBeUndefined();
    const socketPath = await fakeAppServer(null);
    expect(await readCodexAppServerUsage({ socketPath, now: NOW, timeoutMs: 500 })).toBeUndefined();
  });

  it('o plano do app-server usa o mesmo rótulo do rollout', () => {
    expect(codexPlanLabel('plus')).toBe('Plus');
    expect(codexPlanLabel('self_serve_business_usage_based')).toBe('Self Serve Business Usage Based');
  });

  it('o caminho do socket fica dentro do CODEX_HOME', () => {
    expect(codexAppServerSocket('/home/x/.codex')).toBe('/home/x/.codex/app-server-control/app-server-control.sock');
  });

  it('a fonte do Codex pega o uso ao vivo do app-server e o plano', async () => {
    const liveSocket = await fakeAppServer(fixture());
    const home = mkdtempSync(join(tmpdir(), 'hb-codex-home-'));
    const codexDir = join(home, '.codex');
    mkdirSync(join(codexDir, 'app-server-control'), { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), '');
    symlinkSync(liveSocket, codexAppServerSocket(codexDir));
    const now = () => NOW;
    const accounts = new AccountsService({ dirs: [], home, env: {}, now, onChange: () => {} });
    const office = new Office({
      names: new NameStore(null),
      version: 'teste',
      startedAt: NOW,
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: (id) => accounts.find(id)?.detected.name,
      now,
    });
    const source = new CodexSource({
      accounts,
      office,
      dirs: [codexDir],
      env: {},
      home,
      now,
      watch: false,
      pollMs: 60_000,
      liveUsageMs: 20,
    });
    cleanups.push(() => {
      source.stop();
      rmSync(home, { recursive: true, force: true });
    });
    source.start();
    await new Promise((ok) => setTimeout(ok, 200));
    const acc = accounts.list(new Map())[0];
    expect(acc).toMatchObject({ id: '.codex', plan: 'Plus', usageStatus: 'ok', usage: { source: 'codex', fiveHour: { utilization: 12 }, sevenDay: { utilization: 41 } } });
  });
});
