// Proxy de leitura/conversa do roadmap para o Hermes Pipeline.
//
// O navegador chama `/api/roadmap/*` na mesma origem. Este módulo injeta o token do
// Habblaud, repassa o SSE e limita as rotas ao contrato do roadmap. Nenhuma ferramenta
// de mutação passa por aqui: quem move o roadmap é o agente, dentro do pipeline.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tr } from '../../shared/i18n';
import { sendJson } from '../http/app';
import type { RoadmapConfig } from './config';

const PREFIX = '/api/roadmap';
const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 30_000;

/** Rotas do contrato que o Habblaud pode consumir (somente leitura + conversa). */
const ALLOWED: readonly RegExp[] = [
  /^\/api\/roadmaps$/,
  /^\/api\/roadmaps\/[^/]+$/,
  /^\/api\/roadmaps\/[^/]+\/events$/,
  /^\/api\/agent\/sessions$/,
  /^\/api\/agent\/sessions\/[^/]+\/messages$/,
  /^\/api\/agent\/sessions\/[^/]+\/events$/,
];

export interface RoadmapStatus {
  enabled: boolean;
  configured: boolean;
  local: boolean;
  available: boolean;
  reason?: string;
  source?: string;
  /** Allowlist configurada em HABBLAUD_ROADMAP_IDS. */
  roadmaps?: string[];
}

export interface RoadmapProxyOptions {
  config: RoadmapConfig | (() => RoadmapConfig);
  /** Porta local com Host loopback (o mesmo critério do terminal e do World). */
  isLocal(req: IncomingMessage): boolean;
  /** CA adicional opcional (equivalente a NODE_EXTRA_CA_CERTS quando carregado do `.env` após o boot do Node). */
  extraCaPath?: string | (() => string | undefined);
}

function errorBody(code: string, message: string, retryable = false): Record<string, unknown> {
  return { error: { code, message, retryable } };
}

function extraCaOption(caPath: string | undefined): string[] | undefined {
  const clean = caPath?.trim();
  if (!clean || !Array.isArray(tls.rootCertificates) || tls.rootCertificates.length === 0) return undefined;
  try {
    const pem = readFileSync(clean, 'utf8').trim();
    if (!pem) return undefined;
    return [...tls.rootCertificates, pem];
  } catch {
    return undefined;
  }
}

function statusOf(config: RoadmapConfig, local: boolean): RoadmapStatus {
  const configured = Boolean(config.url && config.token);
  const available = local && config.enabled && configured;
  const reason = !local
    ? tr('o roadmap só abre pelo próprio computador (http://localhost)')
    : !config.enabled
      ? (config.warning ?? tr('roadmap desligado (HABBLAUD_ROADMAP=0)'))
      : !config.token
        ? (config.warning ?? tr('HABBLAUD_ROADMAP_TOKEN não definido: o roadmap fica desligado até o token do Habblaud ser configurado'))
        : config.warning;
  return {
    enabled: config.enabled,
    configured,
    local,
    available,
    ...(available ? { source: 'hermes-pipeline' } : {}),
    ...(config.ids?.length ? { roadmaps: [...config.ids] } : {}),
    ...(reason && !available ? { reason } : {}),
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = chunk as Buffer;
    size += data.length;
    if (size > MAX_BODY) {
      req.resume();
      throw new Error('too_large');
    }
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

function jsonHeaders(upstream: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': typeof upstream.headers['content-type'] === 'string' ? upstream.headers['content-type'] : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (typeof upstream.headers['retry-after'] === 'string') headers['Retry-After'] = upstream.headers['retry-after'];
  return headers;
}

function allowedId(config: RoadmapConfig, id: string): boolean {
  return !config.ids?.length || config.ids.includes(id);
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Busca JSON no pipeline para as rotas de lista que precisam de filtro local. */
async function upstreamJson(
  baseUrl: string,
  token: string,
  targetPath: string,
  search: string,
  ca?: string[],
): Promise<{ status: number; body: Buffer }> {
  const target = new URL(`${targetPath}${search}`, baseUrl);
  const secure = target.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Cache-Control': 'no-store' };
    const onResponse = (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.destroy();
          reject(new Error('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    };
    const req = secure
      ? https.request(target, { method: 'GET', headers, ...(ca ? { ca } : {}) }, onResponse)
      : http.request(target, { method: 'GET', headers }, onResponse);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function filteredList(
  res: ServerResponse,
  result: { status: number; body: Buffer },
  transform: (data: Record<string, unknown>) => void,
): void {
  if (result.status !== 200) {
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(result.body);
    return;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.body.toString('utf8')) as Record<string, unknown>;
  } catch {
    sendJson(res, 502, errorBody('pipeline_unavailable', tr('o Hermes Pipeline devolveu uma resposta inválida'), true));
    return;
  }
  transform(data);
  sendJson(res, 200, data);
}

function sseHeaders(upstream: IncomingMessage): Record<string, string> {
  return {
    'Content-Type': typeof upstream.headers['content-type'] === 'string' ? upstream.headers['content-type'] : 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

/**
 * Devolve o handler de `/api/roadmap/*`. O status responde mesmo desligado, para a página
 * explicar o motivo; as demais rotas só existem com configuração válida e acesso local.
 */
export function createRoadmapHandler(opts: RoadmapProxyOptions): (req: IncomingMessage, res: ServerResponse, url: URL) => void {
  const { isLocal } = opts;
  const readConfig = typeof opts.config === 'function' ? opts.config : () => opts.config as RoadmapConfig;
  const readCaPath = typeof opts.extraCaPath === 'function' ? opts.extraCaPath : () => opts.extraCaPath as string | undefined;

  return (req, res, url) => {
    const config = readConfig();
    const method = req.method ?? 'GET';
    const local = isLocal(req);
    if (url.pathname === `${PREFIX}/status`) {
      if (method !== 'GET' && method !== 'HEAD') {
        req.resume();
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(res, 405, errorBody('method_not_allowed', tr('método não permitido')));
      } else {
        sendJson(res, 200, statusOf(config, local));
      }
      return;
    }
    if (!local) {
      req.resume();
      sendJson(res, 403, errorBody('local_only', tr('o roadmap só abre pelo próprio computador (http://localhost)')));
      return;
    }
    if (!config.enabled || !config.url || !config.token) {
      req.resume();
      sendJson(
        res,
        503,
        errorBody(
          'roadmap_disabled',
          config.warning ??
            (config.enabled
              ? tr('HABBLAUD_ROADMAP_TOKEN não definido: o roadmap fica desligado até o token do Habblaud ser configurado')
              : tr('roadmap desligado (HABBLAUD_ROADMAP=0)')),
        ),
      );
      return;
    }
    if (method !== 'GET' && method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, errorBody('method_not_allowed', tr('método não permitido')));
      return;
    }
    const targetPath = `/api${url.pathname.slice(PREFIX.length)}`;
    if (!ALLOWED.some((route) => route.test(targetPath))) {
      req.resume();
      sendJson(res, 404, errorBody('not_found', tr('rota de roadmap desconhecida')));
      return;
    }
    const snapshotMatch = /^\/api\/roadmaps\/([^/]+)(?:\/events)?$/.exec(targetPath);
    if (snapshotMatch && !allowedId(config, decodeId(snapshotMatch[1]!))) {
      req.resume();
      sendJson(res, 404, errorBody('not_found', tr('roadmap fora da lista permitida')));
      return;
    }
    const ca = extraCaOption(readCaPath());
    if (config.ids?.length && method === 'GET' && (targetPath === '/api/roadmaps' || targetPath === '/api/agent/sessions')) {
      const listPath = targetPath;
      void upstreamJson(config.url, config.token, listPath, url.search, ca)
        .then((result) =>
          filteredList(res, result, (data) => {
            if (listPath === '/api/roadmaps' && Array.isArray(data.roadmaps)) {
              data.roadmaps = (data.roadmaps as { id?: unknown }[]).filter((roadmap) => typeof roadmap.id === 'string' && allowedId(config, roadmap.id));
            }
            if (listPath === '/api/agent/sessions' && Array.isArray(data.sessions)) {
              data.sessions = (data.sessions as { roadmapIds?: unknown }[])
                .filter((session) => Array.isArray(session.roadmapIds) && session.roadmapIds.some((id) => typeof id === 'string' && allowedId(config, id)))
                .map((session) => ({ ...session, roadmapIds: (session.roadmapIds as string[]).filter((id) => allowedId(config, id)) }));
            }
          }),
        )
        .catch((error: unknown) => {
          if (res.headersSent) return void res.destroy();
          sendJson(res, 502, errorBody('pipeline_unavailable', error instanceof Error && error.message === 'too_large' ? tr('corpo grande demais') : tr('o Hermes Pipeline não respondeu'), true));
        });
      return;
    }
    void forward(req, res, url, targetPath, config.url, config.token, method === 'POST', ca).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      const message = error instanceof Error && error.message === 'too_large' ? tr('corpo grande demais') : tr('o Hermes Pipeline não respondeu');
      sendJson(res, error instanceof Error && error.message === 'too_large' ? 413 : 502, errorBody('pipeline_unavailable', message, true));
    });
  };
}

async function forward(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  targetPath: string,
  baseUrl: string,
  token: string,
  hasBody: boolean,
  ca?: string[],
): Promise<void> {
  const body = hasBody ? await readBody(req) : undefined;
  const target = new URL(`${targetPath}${url.search}`, baseUrl);
  const isEvent = targetPath.endsWith('/events');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: typeof req.headers.accept === 'string' ? req.headers.accept : isEvent ? 'text/event-stream' : 'application/json',
    'Cache-Control': 'no-store',
    'User-Agent': 'Habblaud roadmap proxy',
  };
  if (typeof req.headers['content-type'] === 'string') headers['Content-Type'] = req.headers['content-type'];
  if (typeof req.headers['last-event-id'] === 'string') headers['Last-Event-ID'] = req.headers['last-event-id'];
  if (body) headers['Content-Length'] = String(body.length);

  const secure = target.protocol === 'https:';
  await new Promise<void>((resolve, reject) => {
    const onResponse = (response: IncomingMessage) => {
      if (isEvent) {
        res.writeHead(response.statusCode ?? 502, sseHeaders(response));
        res.flushHeaders();
      } else {
        res.writeHead(response.statusCode ?? 502, jsonHeaders(response));
      }
      response.on('error', () => {
        if (!res.writableEnded) res.destroy();
      });
      response.pipe(res);
      response.on('end', resolve);
    };
    const upstream = secure
      ? https.request(target, { method: req.method, headers, ...(ca ? { ca } : {}) }, onResponse)
      : http.request(target, { method: req.method, headers }, onResponse);
    upstream.setTimeout(isEvent ? 0 : TIMEOUT_MS, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', reject);
    res.on('close', () => upstream.destroy());
    upstream.end(body);
  });
}
