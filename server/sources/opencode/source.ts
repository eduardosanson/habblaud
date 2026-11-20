// Fonte de agentes do OpenCode V2 (AgentSource 'opencode'): um serviço local com API HTTP e SSE.
//
// O OpenCode não grava "sessões abertas" num registro como o Claude Code: o servidor em segundo plano é a fonte da
// verdade. No boot lemos /api/session (sessões recentes), /api/session/active (rodando agora) e
// /api/experimental/usage/limits; depois acompanhamos /api/event. Presença = ativa ou vista/atualizada dentro da
// janela (padrão 2 h), porque o OpenCode guarda sessões antigas para sempre. O SSE é live-only: ao reconectar,
// refazemos o boot para ressincronizar.
//
// Nada de /api/credential: a senha do service.json fica só em memória e nunca vai para o snapshot, o log ou a página.
import { dirname } from 'node:path';
import type { AccountUsage, Activity, AgentStatus, ShellJob, SourceInfo } from '../../../shared/types';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';
import type { AccountsService } from '../../accounts/service';
import { describeCommand, maskSecrets, truncate } from '../../../shared/activity';
import { errMsg, log } from '../../log';
import type { Office, ShellDoneInput, TranscriptSummary } from '../../model/office';
import type { AgentSource } from '../source';
import type { MessageStream } from '../stream';
import {
  isLoopbackEndpoint,
  OpenCodeClient,
  openCodeServiceFile,
  parseOpenCodeService,
  readOpenCodeService,
  type OpenCodeClientLike,
  type OpenCodeEndpoint,
  type OpenCodeEvent,
} from './client';
import {
  describeOpenCodeTool,
  eventActivity,
  eventStatus,
  eventWaitingFor,
  isRecentSession,
  parseOpenCodeSession,
  parseOpenCodeUsage,
  sessionRole,
  sessionStats,
  sessionTitle,
  type OpenCodeSession,
} from './map';
import { createOpenCodeMessageStream, isOpenCodeSessionId } from './terminal';
import { tr } from '../../../shared/i18n';

export interface OpenCodeSourceOptions {
  accounts: AccountsService;
  office: Office;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => number;
  /** Caminho do service.json (testes e HABBLAUD_OPENCODE_SERVICE). */
  serviceFile?: string;
  /** URL/senha explícitas (HABBLAUD_OPENCODE_URL/PASSWORD ou testes). */
  endpoint?: OpenCodeEndpoint;
  /** Cliente injetado (testes). */
  client?: OpenCodeClientLike;
  /** Janela de presença de sessões vistas/atualizadas (padrão 2 h). */
  recentMs?: number;
  /** Releitura de ativas/uso e varredura de presença. */
  pollMs?: number;
  /** Releitura só do uso do plano (o cartão acompanha o OpenCode de perto; padrão 15 s). */
  usageMs?: number;
  /** Espera antes de tentar o SSE de novo. */
  reconnectMs?: number;
}

interface Tracker {
  key: string;
  session: OpenCodeSession;
  kind: 'main' | 'sub';
  inOffice: boolean;
  lastSeenAt: number;
  status: AgentStatus;
  subDone: boolean;
  toolCalls: number;
  subagents: number;
  shells: Map<string, ShellJob>;
  /** Nome da ferramenta por id de chamada: `session.tool.input.started` avisa antes do `called`. */
  toolNames: Map<string, string>;
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** `{ ses_1: { type: 'running' } }` (o `data` do /api/session/active, já desembrulhado) -> ids rodando. */
export function activeSessionIds(raw: unknown): Set<string> {
  const data = rec(raw);
  const out = new Set<string>();
  if (!data) return out;
  for (const [id, value] of Object.entries(data)) {
    if (rec(value)?.type === 'running') out.add(id);
  }
  return out;
}

export class OpenCodeSource implements AgentSource {
  readonly provider = 'opencode' as const;
  private readonly now: () => number;
  private readonly recentMs: number;
  private readonly pollMs: number;
  private readonly usageMs: number;
  private readonly reconnectMs: number;
  private readonly serviceFile: string;
  private readonly accountDir: string;
  private readonly accountId: string;
  private readonly trackers = new Map<string, Tracker>();
  private readonly active = new Set<string>();
  private client?: OpenCodeClientLike;
  private timer: ReturnType<typeof setInterval> | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private abort?: AbortController;
  private stopped = false;
  private error?: string;

  constructor(private readonly opts: OpenCodeSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.recentMs = opts.recentMs ?? 120 * 60_000;
    this.pollMs = opts.pollMs ?? 60_000;
    this.usageMs = opts.usageMs ?? 15_000;
    this.reconnectMs = opts.reconnectMs ?? 2_000;
    this.serviceFile = opts.serviceFile ?? openCodeServiceFile(opts.env ?? process.env, opts.home);
    this.accountDir = dirname(this.serviceFile);
    const detected: DetectedAccount = {
      id: 'opencode',
      provider: 'opencode',
      configDir: this.accountDir,
      short: 'O',
      name: 'OpenCode',
      color: ACCOUNT_COLORS[2],
    };
    const entries = opts.accounts.setProviderAccounts('opencode', [{ dir: this.accountDir, detected }]);
    this.accountId = entries[0]?.id ?? 'opencode';
    if (opts.client) this.client = opts.client;
  }

  async start(): Promise<void> {
    this.opts.office.beginBoot();
    try {
      await this.boot();
    } catch (err) {
      this.fail(err);
    } finally {
      this.opts.office.endBoot();
    }
    if (this.stopped) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((err) => this.warn('refresh', err));
      this.sweep();
    }, this.pollMs);
    this.timer.unref?.();
    this.usageTimer = setInterval(() => {
      void this.refreshUsage().catch((err) => this.warn('usage', err));
    }, this.usageMs);
    this.usageTimer.unref?.();
    void this.streamLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.timer = null;
    this.usageTimer = null;
    this.abort?.abort();
    this.abort = undefined;
  }

  sources(): SourceInfo[] {
    const sessions = [...this.trackers.values()].filter((t) => t.kind === 'main' && t.inOffice).length;
    return [
      {
        label: this.accountId,
        provider: 'opencode',
        path: this.accountDir,
        sessions,
        ok: !this.error,
        ...(this.error ? { error: this.error } : {}),
      },
    ];
  }

  /** Sem transcript de arquivo: a conversa vem da API (messageStream) e o histórico, do OpenCodeHistory. */
  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /**
   * Conversa ao vivo de um agente (principal ou subagente): a sessão do OpenCode correspondente, lida pela API.
   * Stream novo a cada chamada do terminal; undefined se o agente não está mais no escritório ou o cliente não subiu.
   */
  messageStream(agentId: string): MessageStream | undefined {
    const client = this.client;
    const t = this.trackers.get(agentId);
    if (!client || !t) return undefined;
    return createOpenCodeMessageStream({
      client,
      sessionId: t.session.id,
      streamId: agentId,
      intervalMs: 1_000,
      ...(t.session.cwd ? { cwd: t.session.cwd } : {}),
    });
  }

  /** O cliente já resolvido (o histórico usa as mesmas rotas); undefined antes do boot ou sem serviço. */
  api(): OpenCodeClientLike | undefined {
    return this.client;
  }

  /**
   * Manda um prompt à sessão do OpenCode (POST /api/session/{id}/prompt), na fila dela: é o caminho das mensagens
   * digitadas no escritório. Lança se o serviço não estiver resolvido ou recusar; o chamador vira "failed" com o
   * motivo. `delivery: 'queue'` espera o turno atual, como o plugin do Claude Code faz.
   */
  async promptSession(sessionId: string, text: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error(tr('o serviço do OpenCode não está disponível'));
    if (!isOpenCodeSessionId(sessionId)) throw new Error(tr('sessão do OpenCode inválida'));
    await client.post(`/api/session/${encodeURIComponent(sessionId)}/prompt`, { text, delivery: 'queue' });
  }

  terminalParser(): undefined {
    return undefined;
  }

  /** Boot (também usado nos testes): sessões recentes, ativas e uso. */
  async boot(): Promise<void> {
    const client = this.ensureClient();
    if (!client) return;
    const [sessionsRaw, activeRaw, usageRaw] = await Promise.all([
      client.get<unknown>('/api/session'),
      client.get<unknown>('/api/session/active'),
      client.get<unknown>('/api/experimental/usage/limits').catch(() => undefined),
    ]);
    this.active.clear();
    for (const id of activeSessionIds(activeRaw)) this.active.add(id);
    this.applySessions(Array.isArray(sessionsRaw) ? sessionsRaw : []);
    if (usageRaw !== undefined) this.applyUsage(usageRaw);
    this.error = undefined;
  }

  /** Releitura periódica/reconexão: sessões, ativas e uso. */
  async refresh(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const [sessionsRaw, activeRaw, usageRaw] = await Promise.all([
      client.get<unknown>('/api/session'),
      client.get<unknown>('/api/session/active'),
      client.get<unknown>('/api/experimental/usage/limits').catch(() => undefined),
    ]);
    this.active.clear();
    for (const id of activeSessionIds(activeRaw)) this.active.add(id);
    this.applySessions(Array.isArray(sessionsRaw) ? sessionsRaw : []);
    if (usageRaw !== undefined) this.applyUsage(usageRaw);
    this.error = undefined;
  }

  /** Só o uso do plano: o cartão não espera a releitura completa (sessões/ativas) para acompanhar o OpenCode. */
  async refreshUsage(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const usageRaw = await client.get<unknown>('/api/experimental/usage/limits').catch(() => undefined);
    if (usageRaw !== undefined) this.applyUsage(usageRaw);
  }

  /** Tira do escritório quem não está ativo e não foi visto dentro da janela. */
  sweep(): void {
    const now = this.now();
    for (const t of [...this.trackers.values()]) {
      if (!t.inOffice || this.active.has(t.session.id)) continue;
      const seen = Math.max(t.lastSeenAt, t.session.time.viewed ?? 0, t.session.time.updated, t.session.time.created);
      if (now - seen > this.recentMs) this.leave(t);
    }
  }

  /** Aplica um evento do /api/event (público para os testes). */
  async applyEvent(ev: OpenCodeEvent): Promise<void> {
    const sid = str(ev.data.sessionID);
    if (!sid) return;
    const key = `${this.accountId}:${sid}`;
    let t = this.trackers.get(key);

    if (ev.type === 'session.deleted' || ev.type === 'session.archived') {
      if (t) this.leave(t);
      return;
    }

    if (!t) {
      if (ev.type === 'session.created') {
        const fromEvent = this.sessionFromEvent(ev);
        if (fromEvent) t = this.addSession(fromEvent, this.active.has(sid), true);
        if (!t) t = await this.ensureSession(sid);
      } else {
        t = await this.ensureSession(sid);
      }
      if (!t) return;
    }

    t.lastSeenAt = Math.max(t.lastSeenAt, ev.created ?? this.now());

    switch (ev.type) {
      case 'session.created':
        this.updateFromEvent(t, ev);
        this.applySummary(t);
        return;
      case 'session.renamed': {
        const title = str(ev.data.title);
        if (title) t.session.title = title;
        this.applySummary(t);
        return;
      }
      case 'session.usage.updated':
        this.updateUsageFromEvent(t, ev);
        return;
      case 'session.execution.started':
        this.active.add(sid);
        this.setStatus(t, 'working');
        this.opts.office.fillWorkingActivity(t.key);
        return;
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        this.active.delete(sid);
        this.setStatus(t, 'idle');
        // Depois do "Concluiu" sintetizado: o erro/interrupção precisa ser a atividade atual.
        const activity = eventActivity(ev);
        if (activity) this.addActivity(t, activity);
        return;
      }
      case 'session.idle':
        this.active.delete(sid);
        this.setStatus(t, 'idle');
        return;
      case 'session.viewed':
        if (!this.active.has(sid)) this.setStatus(t, 'idle');
        return;
      case 'session.status': {
        const activity = eventActivity(ev);
        if (activity) this.addActivity(t, activity);
        const status = eventStatus(ev);
        if (status) this.setStatus(t, status, status === 'waiting' ? eventWaitingFor(ev) : undefined);
        return;
      }
      case 'permission.asked':
        this.setStatus(t, 'waiting', eventWaitingFor(ev));
        return;
      case 'permission.replied':
        this.setStatus(t, this.active.has(sid) ? 'working' : 'idle');
        return;
      case 'session.tool.input.started': {
        const id = str(ev.data.id);
        const name = str(ev.data.name);
        if (id && name) t.toolNames.set(id, name);
        this.setStatus(t, 'working');
        return;
      }
      case 'session.tool.called': {
        const callId = str(ev.data.id);
        const name = (callId ? t.toolNames.get(callId) : undefined) ?? str(ev.data.name) ?? tr('ferramenta');
        const desc = describeOpenCodeTool(name, ev.data.input);
        this.addActivity(t, { id: `${t.key}:tool:${callId ?? ev.id ?? this.now()}`, at: ev.created ?? this.now(), tool: name, ...desc });
        t.toolCalls++;
        this.applySummary(t);
        this.setStatus(t, 'working');
        return;
      }
      case 'session.tool.failed': {
        const activity = eventActivity(ev);
        if (activity) this.addActivity(t, activity);
        this.setStatus(t, 'working');
        return;
      }
      case 'session.tool.success':
        this.setStatus(t, 'working');
        return;
      case 'session.text.started':
      case 'session.reasoning.started':
      case 'session.compaction.started':
      case 'session.compaction.ended':
      case 'session.compaction.failed': {
        const activity = eventActivity(ev);
        if (activity) this.addActivity(t, activity);
        const status = eventStatus(ev);
        if (status) this.setStatus(t, status);
        return;
      }
      case 'session.shell.started':
        this.shellStarted(t, ev);
        return;
      case 'session.shell.ended':
        this.shellEnded(t, ev);
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- sessões

  private ensureClient(): OpenCodeClientLike | undefined {
    if (this.client) return this.client;
    const endpoint = this.resolveEndpoint();
    if (!endpoint) return undefined;
    if (endpoint.version) {
      const major = Number.parseInt(endpoint.version.split('.')[0] ?? '', 10);
      if (Number.isFinite(major) && major !== 2) {
        this.fail(tr('OpenCode {0}: esta fonte só entende a versão 2 do serviço.', [endpoint.version]));
        return undefined;
      }
    }
    this.client = new OpenCodeClient(endpoint);
    return this.client;
  }

  private resolveEndpoint(): OpenCodeEndpoint | undefined {
    if (this.opts.endpoint) return this.opts.endpoint;
    const env = this.opts.env ?? process.env;
    const url = env.HABBLAUD_OPENCODE_URL?.trim();
    const password = env.HABBLAUD_OPENCODE_PASSWORD;
    if (url) {
      const endpoint = parseOpenCodeService({ url, password });
      if (!endpoint) {
        this.fail(tr('OpenCode: HABBLAUD_OPENCODE_URL/HABBLAUD_OPENCODE_PASSWORD inválidos.'));
        return undefined;
      }
      return endpoint;
    }
    const fromFile = readOpenCodeService(this.serviceFile);
    if (!fromFile) {
      this.fail(tr('OpenCode: serviço local não encontrado em {0}.', [this.serviceFile]));
      return undefined;
    }
    if (!isLoopbackEndpoint(fromFile.url)) {
      this.fail(tr('OpenCode: o service.json não aponta para o próprio computador.'));
      return undefined;
    }
    return fromFile;
  }

  private sessionFromEvent(ev: OpenCodeEvent): OpenCodeSession | undefined {
    const at = ev.created ?? this.now();
    return parseOpenCodeSession({
      id: ev.data.sessionID,
      projectID: ev.data.projectID,
      parentID: ev.data.parentID,
      location: ev.data.location,
      title: ev.data.title,
      agent: ev.data.agent,
      model: ev.data.model,
      time: { created: at, updated: at },
    });
  }

  private async ensureSession(sid: string): Promise<Tracker | undefined> {
    const client = this.client;
    if (!client) return undefined;
    const raw = await client.get<unknown>(`/api/session/${encodeURIComponent(sid)}`);
    const session = parseOpenCodeSession(raw);
    if (!session) return undefined;
    return this.addSession(session, this.active.has(sid));
  }

  private applySessions(raw: readonly unknown[]): void {
    const now = this.now();
    const sessions = raw
      .map((item) => parseOpenCodeSession(item))
      .filter((s): s is OpenCodeSession => !!s)
      .sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));

    const seen = new Set<string>();
    for (const session of sessions) {
      const key = `${this.accountId}:${session.id}`;
      seen.add(key);
      const active = this.active.has(session.id);
      const existing = this.trackers.get(key);
      if (!isRecentSession(session, active, now, this.recentMs)) {
        if (existing) this.leave(existing);
        continue;
      }
      if (existing) {
        existing.session = session;
        existing.lastSeenAt = Math.max(existing.lastSeenAt, session.time.viewed ?? 0, session.time.updated, session.time.created);
        this.applySummary(existing);
        if (existing.status !== 'waiting') this.setStatus(existing, active ? 'working' : 'idle');
      } else {
        this.addSession(session, active);
      }
    }

    for (const t of [...this.trackers.values()]) {
      if (!seen.has(t.key) && !this.active.has(t.session.id)) {
        const seenAt = Math.max(t.session.time.viewed ?? 0, t.session.time.updated, t.session.time.created);
        if (now - seenAt > this.recentMs) this.leave(t);
      }
    }
  }

  private addSession(session: OpenCodeSession, active: boolean, fresh = false): Tracker | undefined {
    const key = `${this.accountId}:${session.id}`;
    if (this.trackers.has(key)) return this.trackers.get(key);
    if (!session.cwd) return undefined;
    const status: AgentStatus = active ? 'working' : 'idle';

    if (session.parentId) {
      // No boot/refresh, um subagente já ocioso não entra: senão ele ficaria "trabalhando" até o próximo evento.
      // No `session.created` ao vivo (fresh), ele entra mesmo sem tempo de busy/idle preenchido.
      if (!fresh && !active && (session.time.busy ?? 0) <= (session.time.idle ?? 0)) return undefined;
      const parent = this.trackers.get(`${this.accountId}:${session.parentId}`);
      if (!parent?.inOffice || parent.subDone) return undefined;
      const added = this.opts.office.addSub({
        id: key,
        parentId: parent.key,
        sessionId: session.id,
        role: sessionRole(session, 'sub'),
        title: sessionTitle(session),
        background: false,
        startedAt: session.time.created,
      });
      if (!added) return undefined;
      parent.subagents++;
      const t: Tracker = {
        key,
        session,
        kind: 'sub',
        inOffice: true,
        lastSeenAt: Math.max(session.time.viewed ?? 0, session.time.updated, session.time.created),
        status: 'working',
        subDone: false,
        toolCalls: 0,
        subagents: 0,
        shells: new Map(),
        toolNames: new Map(),
      };
      this.trackers.set(key, t);
      this.applySummary(parent);
      this.applySummary(t);
      return t;
    }

    this.opts.office.addMain({
      id: key,
      provider: 'opencode',
      account: this.accountId,
      sessionId: session.id,
      cwd: session.cwd,
      role: sessionRole(session),
      startedAt: session.time.created,
      status,
    });
    if (!this.opts.office.has(key)) return undefined;
    const t: Tracker = {
      key,
      session,
      kind: 'main',
      inOffice: true,
      lastSeenAt: Math.max(session.time.viewed ?? 0, session.time.updated, session.time.created),
      status,
      subDone: false,
      toolCalls: 0,
      subagents: 0,
      shells: new Map(),
      toolNames: new Map(),
    };
    this.trackers.set(key, t);
    this.applySummary(t);
    if (status === 'working') this.opts.office.fillWorkingActivity(key);
    return t;
  }

  private updateFromEvent(t: Tracker, ev: OpenCodeEvent): void {
    const title = str(ev.data.title);
    const agent = str(ev.data.agent);
    const model = ev.data.model;
    const modelId = typeof model === 'string' ? str(model) : str(rec(model)?.id);
    if (title) t.session.title = title;
    if (agent) t.session.agent = agent;
    if (modelId) t.session.model = modelId;
  }

  private updateUsageFromEvent(t: Tracker, ev: OpenCodeEvent): void {
    const cost = num(ev.data.cost);
    const tokens = rec(ev.data.tokens);
    if (cost !== undefined) t.session.cost = cost;
    if (tokens) {
      t.session.tokens = {
        input: num(tokens.input) ?? t.session.tokens.input,
        output: num(tokens.output) ?? t.session.tokens.output,
        reasoning: num(tokens.reasoning) ?? t.session.tokens.reasoning,
        cacheRead: num(rec(tokens.cache)?.read) ?? t.session.tokens.cacheRead,
        cacheWrite: num(rec(tokens.cache)?.write) ?? t.session.tokens.cacheWrite,
      };
    }
    this.applySummary(t);
  }

  private applySummary(t: Tracker): void {
    const summary: TranscriptSummary = {
      tasks: [],
      stats: sessionStats(t.session, t.toolCalls, t.subagents),
    };
    const title = sessionTitle(t.session);
    if (title) summary.title = title;
    if (t.session.model) summary.model = t.session.model;
    summary.firstAt = t.session.time.created;
    summary.lastAt = t.session.time.updated;
    this.opts.office.applyTranscript(t.key, summary);
  }

  private setStatus(t: Tracker, status: AgentStatus, waitingFor?: string): void {
    if (t.kind === 'sub') {
      if (status === 'idle' || status === 'done') {
        if (!t.subDone) this.opts.office.completeSub(t.key);
        t.subDone = true;
        t.status = 'done';
        return;
      }
      if (t.subDone) {
        this.opts.office.reactivateSub(t.key);
        t.subDone = this.opts.office.isSubDone(t.key);
      }
    }
    t.status = status;
    this.opts.office.setStatus(t.key, status, waitingFor);
  }

  private leave(t: Tracker): void {
    if (!t.inOffice) {
      this.trackers.delete(t.key);
      return;
    }
    if (t.kind === 'sub') {
      if (!t.subDone) this.opts.office.completeSub(t.key);
      t.subDone = true;
    } else {
      this.opts.office.closeMain(t.key);
    }
    this.active.delete(t.session.id);
    t.inOffice = false;
    this.trackers.delete(t.key);
  }

  private addActivity(t: Tracker, activity: Activity): void {
    this.opts.office.addActivity(t.key, activity, true, { feed: true });
  }

  // ---------------------------------------------------------------- uso e shells

  private applyUsage(raw: unknown): void {
    const usage: AccountUsage | undefined = parseOpenCodeUsage(raw, this.now());
    if (usage) this.opts.accounts.setUsage(this.accountId, usage);
  }

  private shellStarted(t: Tracker, ev: OpenCodeEvent): void {
    const shell = rec(ev.data.shell);
    const id = str(shell?.id);
    if (!id) return;
    const command = str(shell?.command);
    const startedAt = num(rec(shell?.time)?.started) ?? ev.created ?? this.now();
    const label = command ? describeCommand(command).text : tr('comando');
    const job: ShellJob = {
      id,
      label: truncate(maskSecrets(label), 46),
      ...(command ? { command: truncate(maskSecrets(command), 300) } : {}),
      startedAt,
      background: true,
      kind: 'shell',
    };
    t.shells.set(id, job);
    this.opts.office.setShells(t.key, [...t.shells.values()]);
    this.setStatus(t, 'working');
  }

  private shellEnded(t: Tracker, ev: OpenCodeEvent): void {
    const shell = rec(ev.data.shell);
    const id = str(shell?.id);
    if (!id) return;
    const job = t.shells.get(id);
    t.shells.delete(id);
    this.opts.office.setShells(t.key, [...t.shells.values()]);
    const status = str(shell?.status);
    const exit = shell?.exit;
    const outcome = status === 'killed' ? 'killed' : exit === 0 || exit === '0' ? 'ok' : 'failed';
    const command = str(shell?.command) ?? job?.command;
    const input: ShellDoneInput = {
      id,
      label: job?.label ?? (command ? describeCommand(command).text : tr('comando')),
      startedAt: job?.startedAt ?? ev.created ?? this.now(),
      ...(command ? { command: truncate(maskSecrets(command), 300) } : {}),
    };
    this.opts.office.shellDone(t.key, input, outcome, ev.created ?? this.now());
    this.setStatus(t, 'working');
  }

  // ---------------------------------------------------------------- stream

  private async streamLoop(): Promise<void> {
    while (!this.stopped) {
      const client = this.client;
      if (!client) return;
      this.abort = new AbortController();
      try {
        for await (const ev of client.events(this.abort.signal)) {
          if (this.stopped) return;
          await this.applyEvent(ev);
        }
      } catch (err) {
        if (this.stopped) return;
        this.warn('stream', err);
      }
      this.abort = undefined;
      if (this.stopped) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.reconnectMs);
        timer.unref?.();
      });
      await this.refresh().catch((err) => this.warn('resync', err));
    }
  }

  private fail(err: unknown): void {
    this.error = err instanceof Error ? err.message : String(err);
    this.warn('source', err);
  }

  private warn(where: string, err: unknown): void {
    log.warnOnce(`opencode-${where}:${errMsg(err)}`, tr('OpenCode: {0} ({1})', [where, errMsg(err)]));
  }
}
