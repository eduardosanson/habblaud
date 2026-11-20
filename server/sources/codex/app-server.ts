// Uso do Codex AO VIVO pelo app-server local: quando o Codex (TUI/VS Code) está aberto, ele mantém um socket
// (app-server-control.sock) e já consulta account/rateLimits/read a cada ~15 s. Ler esse socket dá o limite atual
// sem esperar um turno e sem ler auth.json, credenciais ou fazer chamada de rede: é só um socket Unix local.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { AccountUsage, UsageWindow } from '../../../shared/types';
import { codexPlanLabel } from './accounts';

export interface CodexLiveUsage {
  usage: AccountUsage;
  plan?: string;
}

/** Caminho do socket do app-server do Codex dentro de um CODEX_HOME. */
export function codexAppServerSocket(dir: string): string {
  return join(dir, 'app-server-control', 'app-server-control.sock');
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Epoch em segundos (app-server) ou ms -> ms. */
function epochMs(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** `windowDurationMins` (app-server) ou `window_minutes` (rollout) -> janela. */
function usageWindow(raw: unknown, position: 'fiveHour' | 'sevenDay'): { key: 'fiveHour' | 'sevenDay'; window: UsageWindow } | undefined {
  const w = rec(raw);
  if (!w) return undefined;
  const used = num(w.usedPercent ?? w.used_percent);
  if (used === undefined) return undefined;
  const minutes = num(w.windowDurationMins ?? w.window_minutes);
  const key = minutes === 300 ? 'fiveHour' : minutes === 10_080 ? 'sevenDay' : position;
  const window: UsageWindow = { utilization: Math.min(100, Math.max(0, used)) };
  const resets = epochMs(w.resetsAt ?? w.resets_at);
  if (resets !== undefined) window.resetsAt = resets;
  return { key, window };
}

/**
 * `account/rateLimits/read` (resultado já desembrulhado) -> uso da conta.
 * Prefere o bucket `codex` de `rateLimitsByLimitId` (o mesmo que o TUI usa) e cai no `rateLimits` legado.
 */
export function usageFromAppServer(raw: unknown, now: number): CodexLiveUsage | undefined {
  const result = rec(raw);
  if (!result) return undefined;
  const byId = rec(result.rateLimitsByLimitId);
  const rl = rec(byId?.codex) ?? rec(result.rateLimits) ?? (byId ? rec(Object.values(byId)[0]) : undefined);
  if (!rl) return undefined;

  const usage: AccountUsage = { source: 'codex', fetchedAt: now };
  for (const [position, value] of [
    ['fiveHour', rl.primary],
    ['sevenDay', rl.secondary],
  ] as const) {
    const parsed = usageWindow(value, position);
    if (parsed && !usage[parsed.key]) usage[parsed.key] = parsed.window;
  }
  const reached = str(rl.rateLimitReachedType ?? rl.rate_limit_reached_type);
  if ((rl.primary === null || rl.primary === undefined) && reached) usage.noQuota = true;
  if (!usage.fiveHour && !usage.sevenDay && !usage.noQuota) return undefined;
  const plan = codexPlanLabel(rl.planType ?? rl.plan_type);
  return { usage, ...(plan ? { plan } : {}) };
}

export interface ReadCodexLiveOptions {
  socketPath: string;
  now?: number;
  /** Tempo máximo para conectar e ler (padrão 2 s). */
  timeoutMs?: number;
}

/** Frame WebSocket de cliente (mascarado, texto/pong). */
function wsFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  size: number;
}

/** Lê um frame de servidor (não mascarado); undefined se ainda faltam bytes. */
function readWsFrame(buffer: Buffer): WsFrame | undefined {
  if (buffer.length < 2) return undefined;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    length = Number(big);
    offset = 10;
  }
  const maskOffset = masked ? offset : 0;
  offset += maskOffset + length;
  if (buffer.length < offset) return undefined;
  let payload = buffer.subarray(offset - length, offset);
  if (masked) {
    const key = buffer.subarray(offset - length - 4, offset - length);
    payload = Buffer.from(payload.map((b, i) => b ^ key[i % 4]));
  }
  return { fin, opcode, payload, size: offset };
}

/**
 * Lê o uso ao vivo do app-server do Codex. O socket de controle fala WebSocket sobre Unix; o handshake e os frames
 * são feitos aqui para manter zero dependências. Sem o socket (Codex fechado) ou com erro: undefined, sem exceção.
 */
export async function readCodexAppServerUsage(opts: ReadCodexLiveOptions): Promise<CodexLiveUsage | undefined> {
  if (!existsSync(opts.socketPath)) return undefined;
  return await new Promise<CodexLiveUsage | undefined>((resolve) => {
    let done = false;
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    let text = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sock = connect(opts.socketPath);
    const finish = (value: CodexLiveUsage | undefined): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      sock.destroy();
      resolve(value);
    };
    const send = (message: Record<string, unknown>): void => {
      if (!done) sock.write(wsFrame(1, Buffer.from(JSON.stringify(message))));
    };
    const handle = (raw: string): void => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error) return finish(undefined);
        send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} });
        return;
      }
      if (message.id === 2) {
        if (message.error) return finish(undefined);
        finish(usageFromAppServer(message.result, opts.now ?? Date.now()));
      }
    };

    timer = setTimeout(() => finish(undefined), opts.timeoutMs ?? 2_000);
    timer.unref?.();
    sock.on('connect', () => {
      sock.write(
        `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('latin1');
        buffer = buffer.subarray(end + 4);
        if (!/^HTTP\/1\.1 101\b/.test(head)) return finish(undefined);
        upgraded = true;
        send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'habblaud', version: '0.0.0' }, capabilities: { experimentalApi: true } },
        });
      }
      for (let frame = readWsFrame(buffer); frame; frame = readWsFrame(buffer)) {
        buffer = buffer.subarray(frame.size);
        if (frame.opcode === 8) return finish(undefined);
        if (frame.opcode === 9) {
          sock.write(wsFrame(10, frame.payload));
          continue;
        }
        if (frame.opcode !== 1 && frame.opcode !== 2 && frame.opcode !== 0) continue;
        text += frame.payload.toString();
        if (frame.fin) {
          const message = text;
          text = '';
          handle(message);
          if (done) return;
        }
      }
    });
    sock.on('error', () => finish(undefined));
    sock.on('close', () => finish(undefined));
  });
}
