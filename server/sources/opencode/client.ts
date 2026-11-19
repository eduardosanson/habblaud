// Cliente do serviço local do OpenCode V2: descoberta pelo service.json, Basic auth, JSON e SSE.
// Nada de credenciais do OpenCode: o service.json só tem a senha local do servidor, usada em memória e nunca
// registrada em log, snapshot ou arquivo.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { tr } from '../../../shared/i18n';

export interface OpenCodeEndpoint {
  /** Base HTTP, sem barra no fim. */
  url: string;
  password: string;
  version?: string;
  id?: string;
}

export interface OpenCodeEvent {
  id?: string;
  type: string;
  created?: number;
  data: Record<string, unknown>;
}

/** O que a fonte usa do cliente (testes injetam um falso). */
export interface OpenCodeClientLike {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  events(signal?: AbortSignal): AsyncGenerator<OpenCodeEvent>;
}

export interface OpenCodeClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Arquivo de registro do serviço: $XDG_STATE_HOME/opencode/service.json ou ~/.local/state/opencode/service.json. */
export function openCodeServiceFile(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME || homedir()): string {
  const raw = env.XDG_STATE_HOME?.trim();
  const state = raw ? resolve(expandHome(raw, home)) : join(home, '.local', 'state');
  return join(state, 'opencode', 'service.json');
}

function expandHome(p: string, home: string): string {
  return p.replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Valida o conteúdo do service.json. A URL precisa ser http(s) e a senha existir; o resto é opcional.
 * A exigência de loopback fica para quem lê o arquivo (o OpenCode local), não para uma URL explícita do dono.
 */
export function parseOpenCodeService(raw: unknown): OpenCodeEndpoint | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const j = raw as Record<string, unknown>;
  const url = str(j.url);
  const password = str(j.password);
  if (!url || !password || !/^https?:\/\//i.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  const out: OpenCodeEndpoint = { url: `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, ''), password };
  const version = str(j.version);
  const id = str(j.id);
  if (version) out.version = version;
  if (id) out.id = id;
  return out;
}

/** Lê o service.json; arquivo ausente, ilegível ou inválido = undefined. */
export function readOpenCodeService(file: string): OpenCodeEndpoint | undefined {
  try {
    return parseOpenCodeService(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

/** A URL é do próprio computador? (127.0.0.0/8, localhost ou ::1). */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '::1') return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    return !!m && m[1] === '127' && [m[2], m[3], m[4]].every((x) => Number(x) <= 255);
  } catch {
    return false;
  }
}

export class OpenCodeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenCodeError';
  }
}

/** Cliente mínimo do serviço local: JSON com Basic e o stream de eventos. */
export class OpenCodeClient implements OpenCodeClientLike {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(endpoint: OpenCodeEndpoint, opts: OpenCodeClientOptions = {}) {
    this.base = endpoint.url.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString('base64')}`;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: { accept: 'application/json', authorization: this.auth, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new OpenCodeError(res.status, tr('OpenCode respondeu {0}', [String(res.status)]));
    const json = (await res.json()) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json) && 'data' in json) {
      return (json as { data: T }).data;
    }
    return json as T;
  }

  /** SSE do /api/event: cada bloco `data:` vira um evento; comentários (`: heartbeat`) são ignorados. */
  async *events(signal?: AbortSignal): AsyncGenerator<OpenCodeEvent> {
    const res = await this.fetchFn(`${this.base}/api/event`, {
      headers: { accept: 'text/event-stream', authorization: this.auth },
      signal,
    });
    if (!res.ok || !res.body) throw new OpenCodeError(res.status, tr('OpenCode: stream de eventos indisponível'));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const end = buffer.search(/\r?\n\r?\n/);
          if (end < 0) break;
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          try {
            const event = JSON.parse(data) as OpenCodeEvent;
            if (event && typeof event.type === 'string') yield event;
          } catch {
            // Linha parcial/JSON inválido: ignora; o próximo evento vem inteiro.
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // stream já fechado
      }
    }
  }
}
