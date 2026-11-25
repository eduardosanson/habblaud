// Resolve a sala de um agente dinamicamente pelo roadmap configurado na worktree
// (<git-dir>/habblaud.json ou .roadmap.yaml) ou pela sessão ativa registrada pelo pipeline.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { RoadmapConfig } from './config';
import { ROOM_NAME_MAX } from '../model/room-aliases';

export interface WorktreeMarker {
  roadmapId: string;
  roadmapTitle?: string;
  rootPath: string;
}

export interface SessionRoadmapInfo {
  roadmapId: string;
  roadmapTitle?: string;
  workdir?: string;
}

export interface ResolvedRoom {
  id: string;
  name: string;
  path: string;
}

export interface WorktreeRoadmapResolverOptions {
  config?: () => RoadmapConfig;
  extraCaPath?: () => string | undefined;
  stateDir?: string;
  cacheMs?: number;
  titleRefreshMs?: number;
  now?: () => number;
  fetchRoadmaps?: () => Promise<Array<{ id: string; title?: string }>>;
  onTitleChange?: () => void;
}

function readJsonObj(file: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Devolve o diretório `.git` real do repositório ou da worktree vinculada contendo `cwd`. */
export function resolveGitDir(cwd: string): string | undefined {
  let cur: string;
  try {
    cur = resolve(cwd);
    if (!existsSync(cur)) return undefined;
    if (statSync(cur).isFile()) cur = dirname(cur);
  } catch {
    return undefined;
  }
  while (true) {
    const dot = join(cur, '.git');
    try {
      const st = statSync(dot);
      if (st.isDirectory()) return dot;
      if (st.isFile()) {
        const first = readFileSync(dot, 'utf8').split(/\r?\n/, 1)[0]?.trim() ?? '';
        if (first.startsWith('gitdir:')) {
          const raw = first.slice('gitdir:'.length).trim();
          if (raw) {
            const target = isAbsolute(raw) ? raw : resolve(cur, raw);
            if (existsSync(target) && statSync(target).isDirectory()) return target;
          }
        }
      }
    } catch {
      // sem .git neste nível
    }
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/** Lê `<git-dir>/habblaud.json` ou fallback `<dir>/.roadmap.yaml` subindo a partir de `cwd`. */
export function readWorktreeMarker(cwd: string): WorktreeMarker | undefined {
  let start: string;
  try {
    start = resolve(cwd);
    if (!existsSync(start)) return undefined;
    if (statSync(start).isFile()) start = dirname(start);
  } catch {
    return undefined;
  }

  let dir = start;
  while (true) {
    const dot = join(dir, '.git');
    if (existsSync(dot)) {
      const gitDir = resolveGitDir(dir);
      if (gitDir) {
        const ctx = readJsonObj(join(gitDir, 'habblaud.json'));
        const rid = typeof ctx?.roadmapId === 'string' ? ctx.roadmapId.trim() : '';
        if (rid) {
          const title = typeof ctx?.roadmapTitle === 'string' && ctx.roadmapTitle.trim() ? ctx.roadmapTitle.trim() : undefined;
          return { roadmapId: rid, ...(title ? { roadmapTitle: title } : {}), rootPath: dir };
        }
      }
    }
    const markerFile = join(dir, '.roadmap.yaml');
    try {
      if (statSync(markerFile).isFile()) {
        const raw = readFileSync(markerFile, 'utf8');
        const m = /^\s*roadmap\s*:\s*['"]?([^\s#'"]+)['"]?/m.exec(raw);
        if (m?.[1]) return { roadmapId: m[1].trim(), rootPath: dir };
      }
    } catch {
      // sem marcador neste nível
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Lê `<stateDir>/active-sessions.json` ou `<stateDir>/coordination/*.json` para a sessão. */
export function readSessionRoadmap(sessionId: string, stateDir: string): SessionRoadmapInfo | undefined {
  const sid = sessionId.trim();
  if (!sid || !stateDir) return undefined;
  const active = readJsonObj(join(stateDir, 'active-sessions.json'));
  const sessions = active?.sessions;
  if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
    const entry = (sessions as Record<string, unknown>)[sid];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      const rid = typeof rec.roadmapId === 'string' ? rec.roadmapId.trim() : '';
      if (rid) {
        const title = typeof rec.roadmapTitle === 'string' && rec.roadmapTitle.trim() ? rec.roadmapTitle.trim() : undefined;
        const workdir = typeof rec.workdir === 'string' && rec.workdir.trim() ? rec.workdir.trim() : undefined;
        return { roadmapId: rid, ...(title ? { roadmapTitle: title } : {}), ...(workdir ? { workdir } : {}) };
      }
    }
  }
  const coordDir = join(stateDir, 'coordination');
  try {
    for (const name of readdirSync(coordDir)) {
      if (!name.endsWith('.json')) continue;
      const obj = readJsonObj(join(coordDir, name));
      if (!obj || obj.session_id !== sid) continue;
      const rid = typeof obj.roadmap === 'string' ? obj.roadmap.trim() : '';
      if (rid) return { roadmapId: rid };
    }
  } catch {
    // sem diretório coordination
  }
  return undefined;
}

function extraCaOption(caPath: string | undefined): string[] | undefined {
  const clean = caPath?.trim();
  if (!clean || !Array.isArray(tls.rootCertificates) || tls.rootCertificates.length === 0) return undefined;
  try {
    const pem = readFileSync(clean, 'utf8').trim();
    return pem ? [...tls.rootCertificates, pem] : undefined;
  } catch {
    return undefined;
  }
}

async function fetchRoadmapsFromApi(config: RoadmapConfig, ca?: string[]): Promise<Array<{ id: string; title?: string }>> {
  if (!config.enabled || !config.url || !config.token) return [];
  const target = new URL('/api/roadmaps', config.url);
  const secure = target.protocol === 'https:';
  return new Promise((resolvePromise, reject) => {
    const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/json', 'Cache-Control': 'no-store' };
    const req = (secure ? https.request : http.request)(
      target,
      { method: 'GET', headers, ...(secure && ca ? { ca } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) {
            res.destroy();
            reject(new Error('too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if ((res.statusCode ?? 502) !== 200) return resolvePromise([]);
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { roadmaps?: Array<{ id?: unknown; title?: unknown }> };
            const list = Array.isArray(parsed.roadmaps) ? parsed.roadmaps : [];
            resolvePromise(
              list
                .filter((r) => typeof r?.id === 'string' && r.id.trim())
                .map((r) => ({ id: String(r.id).trim(), ...(typeof r.title === 'string' && r.title.trim() ? { title: r.title.trim() } : {}) })),
            );
          } catch {
            resolvePromise([]);
          }
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(5_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export class WorktreeRoadmapResolver {
  private readonly stateDir: string;
  private readonly cacheMs: number;
  private readonly titleRefreshMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: ResolvedRoom | undefined }>();
  private readonly titles = new Map<string, string>();
  private lastTitleFetchAt = -Infinity;
  private refreshing = false;

  constructor(private readonly opts: WorktreeRoadmapResolverOptions = {}) {
    this.stateDir = opts.stateDir ?? join(homedir(), '.local', 'state', 'hermes-pipeline');
    this.cacheMs = opts.cacheMs ?? 1_500;
    this.titleRefreshMs = opts.titleRefreshMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  resolve(cwd: string, sessionId = ''): ResolvedRoom | undefined {
    const key = `${cwd}\0${sessionId}`;
    const moment = this.now();
    const cached = this.cache.get(key);
    if (cached && moment - cached.at < this.cacheMs) return cached.value;

    const marker = readWorktreeMarker(cwd);
    const sess = !marker && sessionId ? readSessionRoadmap(sessionId, this.stateDir) : undefined;
    const roadmapId = marker?.roadmapId ?? sess?.roadmapId;
    if (!roadmapId) {
      this.cache.set(key, { at: moment, value: undefined });
      return undefined;
    }

    const titleFromSource = marker?.roadmapTitle ?? sess?.roadmapTitle;
    if (titleFromSource && !this.titles.has(roadmapId)) this.titles.set(roadmapId, titleFromSource);
    const title = (this.titles.get(roadmapId) ?? titleFromSource ?? roadmapId).trim().slice(0, ROOM_NAME_MAX);
    if (!this.titles.has(roadmapId)) void this.refreshTitles();

    const value: ResolvedRoom = {
      id: `roadmap:${roadmapId}`,
      name: title || roadmapId.slice(0, ROOM_NAME_MAX),
      path: marker?.rootPath ?? sess?.workdir ?? cwd,
    };
    this.cache.set(key, { at: moment, value });
    return value;
  }

  async refreshTitles(): Promise<void> {
    const moment = this.now();
    if (this.refreshing || moment - this.lastTitleFetchAt < this.titleRefreshMs) return;
    const fetcher =
      this.opts.fetchRoadmaps ??
      (() => {
        const cfg = this.opts.config?.();
        if (!cfg) return Promise.resolve([]);
        return fetchRoadmapsFromApi(cfg, extraCaOption(this.opts.extraCaPath?.()));
      });
    this.refreshing = true;
    this.lastTitleFetchAt = moment;
    try {
      const list = await fetcher();
      let changed = false;
      for (const r of list) {
        if (!r.id || !r.title?.trim()) continue;
        const clean = r.title.trim();
        if (this.titles.get(r.id) !== clean) {
          this.titles.set(r.id, clean);
          changed = true;
        }
      }
      if (changed) {
        this.cache.clear();
        this.opts.onTitleChange?.();
      }
    } catch {
      // falha de rede não bloqueia o escritório
    } finally {
      this.refreshing = false;
    }
  }
}
