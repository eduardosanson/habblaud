// Fonte de agentes do Hermes (AgentSource 'hermes'): o plugin mod/habblaud-hermes observa os hooks do Hermes e manda
// eventos para POST /api/hermes/events. Não há leitura de transcript nesta fase: o escritório mostra sessões,
// status, atividades, subagentes, aprovações (só o estado "esperando") e tokens; terminal/histórico ficam para a
// próxima fase.
//
// Cada perfil do Hermes (~/.hermes ou ~/.hermes/profiles/<nome>) vira uma conta. A sala é o `project` que o plugin
// manda (o `terminal.cwd` do perfil, quando existe); sem ele, a pasta do perfil. Eventos são observações: nada volta
// para a sessão do Hermes e um evento inválido é ignorado.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Activity, AgentStatus, SourceInfo } from '../../../shared/types';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';
import type { AccountsService } from '../../accounts/service';
import { maskSecrets, truncate } from '../../../shared/activity';
import type { Office, TranscriptSummary } from '../../model/office';
import type { AgentSource } from '../source';
import {
  eventAt,
  eventSessionId,
  eventType,
  hermesActivity,
  hermesTokens,
  hermesToolName,
  hermesUsageId,
  str,
  type HermesEventBody,
} from './events';
import { tr } from '../../../shared/i18n';

export interface HermesSourceOptions {
  accounts: AccountsService;
  office: Office;
  /** Pasta base do Hermes (padrão: HERMES_HOME ou ~/.hermes). */
  home?: string;
  now?: () => number;
  /** Sessão sem nenhum evento por este tempo sai do escritório (padrão 2 h). */
  staleMs?: number;
  /** Intervalo da varredura de presença. */
  sweepMs?: number;
}

interface Profile {
  name: string;
  home: string;
  account?: string;
  short: string;
  display: string;
  color: string;
}

interface Tracker {
  key: string;
  sessionId: string;
  profile: string;
  account: string;
  kind: 'main' | 'sub';
  parentKey?: string;
  inOffice: boolean;
  status: AgentStatus;
  startedAt: number;
  lastSeenAt: number;
  cwd: string;
  platform?: string;
  model?: string;
  toolCalls: number;
  subagents: number;
  tokensIn: number;
  tokensOut: number;
  /** Chamadas de ferramenta já contadas (o mesmo evento pode chegar repetido). */
  calls: Set<string>;
  /** Medições de uso já somadas. */
  usageIds: Set<string>;
  subSeq: number;
  subDone: boolean;
}

const EVENT_SEEN_MAX = 5_000;
const CALL_SEEN_MAX = 2_000;
const USAGE_SEEN_MAX = 5_000;
const DEFAULT_STALE_MS = 2 * 60 * 60_000;

const KNOWN_TYPES = new Set([
  'session_open',
  'session_start',
  'session_end',
  'session_finalize',
  'session_reset',
  'session_delete',
  'session_busy',
  'session_idle',
  'tool_start',
  'tool_end',
  'subagent_start',
  'subagent_stop',
  'approval_request',
  'approval_response',
  'usage',
]);

function profileName(raw: unknown): string {
  const name = str(raw);
  return name ? truncate(name, 80) : 'default';
}

export class HermesSource implements AgentSource {
  readonly provider = 'hermes' as const;
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly baseHome: string;
  private readonly profiles = new Map<string, Profile>();
  private readonly trackers = new Map<string, Tracker>();
  /** Sessão do perfil -> agente principal (ou subagente). */
  private readonly bySession = new Map<string, string>();
  private readonly seenEvents = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenAny = false;

  constructor(private readonly opts: HermesSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
    this.baseHome = opts.home ?? process.env.HERMES_HOME ?? join(homedir(), '.hermes');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.opts.sweepMs ?? 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sem eventos ainda, a fonte não aparece no snapshot/health (quem não usa Hermes não vê uma conta vazia). */
  sources(): SourceInfo[] {
    if (!this.seenAny) return [];
    const sessions = [...this.trackers.values()].filter((t) => t.kind === 'main' && t.inOffice).length;
    const first = this.profiles.values().next().value as Profile | undefined;
    return [{ label: 'hermes', provider: 'hermes', path: first?.home ?? this.baseHome, sessions, ok: true }];
  }

  /** Sem transcript de arquivo nesta fase: terminal/histórico do Hermes ficam para a próxima. */
  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /**
   * Aplica um evento do plugin. Devolve true quando o evento foi reconhecido (mesmo que repetido); false para um
   * tipo desconhecido ou sem a identidade mínima. Nunca lança: o chamador é a rota local.
   */
  applyEvent(body: HermesEventBody): boolean {
    const ev = body.event;
    const type = eventType(ev);
    if (!type || !KNOWN_TYPES.has(type)) return false;
    const at = eventAt(ev, this.now());
    const profile = this.ensureProfile(profileName(body.profile), str(body.home));
    const eventId = str(ev.event_id);
    if (eventId && this.seenEvents.has(eventId)) return true;
    if (eventId) this.remember(this.seenEvents, eventId, EVENT_SEEN_MAX);
    this.seenAny = true;

    const sessionId = eventSessionId(ev);
    if (type === 'subagent_start') return this.subagentStart(profile, ev, at);
    if (type === 'subagent_stop') return this.subagentStop(profile, ev, at);
    if (!sessionId) return false;

    if (type === 'usage') return this.usage(profile, sessionId, ev, at);

    const t = this.trackerFor(profile, sessionId);
    if (type === 'session_open' || type === 'session_start') {
      return this.sessionStart(profile, sessionId, ev, at);
    }
    if (!t) return false;
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    t.platform = str(ev.platform) ?? t.platform;
    t.model = str(ev.model) ?? t.model;

    switch (type) {
      case 'session_busy':
        this.setStatus(t, 'working');
        if (!this.activityOf(t)) this.opts.office.fillWorkingActivity(t.key);
        return true;
      case 'session_idle':
        this.setStatus(t, 'idle');
        return true;
      case 'tool_start':
        this.toolStart(t, ev, at);
        return true;
      case 'tool_end':
        this.toolEnd(t, ev, at);
        return true;
      case 'approval_request':
        this.setStatus(t, 'waiting', this.waitingFor(ev));
        return true;
      case 'approval_response':
        this.setStatus(t, 'working');
        return true;
      case 'session_end':
      case 'session_finalize':
      case 'session_reset':
      case 'session_delete':
        this.finishSession(t, ev, at);
        return true;
      default:
        return false;
    }
  }

  /** Tira do escritório quem não manda evento há mais que `staleMs` (processo morto/sem session_end). */
  sweep(): void {
    const now = this.now();
    for (const t of [...this.trackers.values()]) if (now - t.lastSeenAt > this.staleMs) this.leave(t);
  }

  // ---------------------------------------------------------------- sessões e perfis

  /** O perfil vira conta (id final do AccountsService) e a pasta é a sala de fallback. */
  private ensureProfile(name: string, home: string | undefined): Profile {
    let p = this.profiles.get(name);
    if (!p) {
      const h = home ?? (name === 'default' ? this.baseHome : join(this.baseHome, 'profiles', name));
      p = {
        name,
        home: h,
        short: name === 'default' ? 'H' : (name[0] ?? 'H').toUpperCase(),
        display: name === 'default' ? 'Hermes' : `Hermes ${name}`,
        color: ACCOUNT_COLORS[this.profiles.size % ACCOUNT_COLORS.length],
      };
      this.profiles.set(name, p);
      this.applyAccounts();
    } else if (home && p.home !== home) {
      p.home = home;
      this.applyAccounts();
    }
    return p;
  }

  /** Registra todos os perfis conhecidos como contas do Hermes (o id final volta em cada entrada). */
  private applyAccounts(): void {
    const list = [...this.profiles.values()];
    const detected = list.map(
      (p): DetectedAccount => ({
        id: p.name,
        provider: 'hermes',
        configDir: p.home,
        short: p.short,
        name: p.display,
        color: p.color,
      }),
    );
    const entries = this.opts.accounts.setProviderAccounts(
      'hermes',
      list.map((p, i) => ({ dir: p.home, detected: detected[i] })),
    );
    list.forEach((p, i) => {
      p.account = entries[i]?.id ?? p.name;
    });
  }

  private sessionKey(profile: Profile, sessionId: string): string {
    return `${profile.name}:${sessionId}`;
  }

  private trackerFor(profile: Profile, sessionId: string): Tracker | undefined {
    const key = this.bySession.get(this.sessionKey(profile, sessionId));
    return key ? this.trackers.get(key) : undefined;
  }

  private sessionStart(profile: Profile, sessionId: string, ev: Record<string, unknown>, at: number): boolean {
    const existing = this.trackerFor(profile, sessionId);
    if (existing) {
      existing.lastSeenAt = Math.max(existing.lastSeenAt, at);
      existing.platform = str(ev.platform) ?? existing.platform;
      existing.model = str(ev.model) ?? existing.model;
      this.applySummary(existing);
      return true;
    }
    const platform = str(ev.platform);
    const model = str(ev.model);
    const project = str(ev.project) ?? str(ev.cwd) ?? str(ev.directory);
    const cwd = project ?? profile.home;
    const role = platform ? `Hermes (${truncate(platform, 24)})` : 'Hermes';
    this.opts.office.addMain({
      id: this.keyFor(profile, sessionId),
      provider: 'hermes',
      account: profile.account ?? profile.name,
      sessionId,
      cwd,
      role,
      startedAt: at,
      status: 'idle',
    });
    const key = this.keyFor(profile, sessionId);
    if (!this.opts.office.has(key)) return false;
    const t: Tracker = {
      key,
      sessionId,
      profile: profile.name,
      account: profile.account ?? profile.name,
      kind: 'main',
      inOffice: true,
      status: 'idle',
      startedAt: at,
      lastSeenAt: at,
      cwd,
      toolCalls: 0,
      subagents: 0,
      tokensIn: 0,
      tokensOut: 0,
      calls: new Set(),
      usageIds: new Set(),
      subSeq: 0,
      subDone: false,
    };
    if (platform) t.platform = platform;
    if (model) t.model = model;
    this.trackers.set(key, t);
    this.bySession.set(this.sessionKey(profile, sessionId), key);
    this.applySummary(t);
    return true;
  }

  private finishSession(t: Tracker, ev: Record<string, unknown>, at: number): void {
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    const failed = ev.failed === true || str(ev.turn_exit_reason)?.startsWith('error') === true;
    if (failed) this.addActivity(t, { id: `${t.key}:failed:${at}`, at, kind: 'error', icon: '⚠️', text: tr('A sessão falhou') });
    this.leave(t);
  }

  private leave(t: Tracker): void {
    if (t.kind === 'sub') {
      if (!t.subDone) this.opts.office.completeSub(t.key);
      t.subDone = true;
    } else {
      this.opts.office.closeMain(t.key);
    }
    t.inOffice = false;
    this.trackers.delete(t.key);
    for (const [sid, key] of this.bySession) if (key === t.key) this.bySession.delete(sid);
  }

  private keyFor(profile: Profile, sessionId: string): string {
    return `hermes:${profile.name}:${sessionId}`;
  }

  // ---------------------------------------------------------------- subagentes

  private subagentStart(profile: Profile, ev: Record<string, unknown>, at: number): boolean {
    const parentSession = str(ev.parent_session_id);
    const childSession = str(ev.child_session_id);
    if (!parentSession || !childSession) return false;
    const parent = this.trackerFor(profile, parentSession);
    if (!parent) return false;
    const childKey = `${parent.key}:${childSession}`;
    const existing = this.trackers.get(childKey);
    if (existing) {
      existing.lastSeenAt = Math.max(existing.lastSeenAt, at);
      return true;
    }
    const role = str(ev.child_role) ?? tr('Subagente (Hermes)');
    const goal = str(ev.child_goal);
    const added = this.opts.office.addSub({
      id: childKey,
      parentId: parent.key,
      sessionId: childSession,
      role: truncate(maskSecrets(role), 60),
      ...(goal ? { title: truncate(maskSecrets(goal), 90) } : {}),
      background: false,
      startedAt: at,
    });
    if (!added) return false;
    parent.subagents++;
    const t: Tracker = {
      key: childKey,
      sessionId: childSession,
      profile: profile.name,
      account: parent.account,
      kind: 'sub',
      parentKey: parent.key,
      inOffice: true,
      status: 'working',
      startedAt: at,
      lastSeenAt: at,
      cwd: parent.cwd,
      toolCalls: 0,
      subagents: 0,
      tokensIn: 0,
      tokensOut: 0,
      calls: new Set(),
      usageIds: new Set(),
      subSeq: 0,
      subDone: false,
    };
    this.trackers.set(childKey, t);
    this.bySession.set(this.sessionKey(profile, childSession), childKey);
    this.applySummary(parent);
    this.applySummary(t);
    return true;
  }

  private subagentStop(profile: Profile, ev: Record<string, unknown>, at: number): boolean {
    const childSession = str(ev.child_session_id);
    if (!childSession) return false;
    const t = this.trackerFor(profile, childSession);
    if (!t || t.kind !== 'sub') return false;
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    const status = str(ev.child_status);
    if (status === 'failed' || status === 'interrupted') {
      const summary = str(ev.child_summary);
      this.addActivity(t, {
        id: `${t.key}:stop:${at}`,
        at,
        kind: 'error',
        icon: '⚠️',
        text: status === 'failed' ? tr('O subagente falhou') : tr('Subagente interrompido'),
        ...(summary ? { detail: truncate(maskSecrets(summary), 300) } : {}),
      });
    }
    this.setStatus(t, 'done');
    return true;
  }

  // ---------------------------------------------------------------- ferramentas

  private toolStart(t: Tracker, ev: Record<string, unknown>, at: number): void {
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    const tool = hermesToolName(ev);
    const call = str(ev.call_id) ?? str(ev.tool_call_id);
    const id = call ?? `${tool}:${at}`;
    const fresh = !t.calls.has(id);
    if (fresh) {
      this.remember(t.calls, id, CALL_SEEN_MAX);
      t.toolCalls++;
    }
    this.setStatus(t, 'working');
    if (!fresh) return;
    const desc = hermesActivity(tool, ev.preview ?? ev.input);
    this.addActivity(t, { id: `${t.key}:tool:${id}`, at, tool, ...desc });
    this.applySummary(t);
  }

  private toolEnd(t: Tracker, ev: Record<string, unknown>, at: number): void {
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    const status = str(ev.status);
    if (status && status !== 'ok' && status !== 'success') {
      const tool = hermesToolName(ev);
      const error = str(ev.error_message);
      this.addActivity(t, {
        id: `${t.key}:tool-error:${str(ev.call_id) ?? str(ev.tool_call_id) ?? at}`,
        at,
        tool,
        kind: 'error',
        icon: '⚠️',
        text: tr('A ferramenta falhou'),
        ...(error ? { detail: truncate(maskSecrets(error), 300) } : {}),
      });
    }
    this.setStatus(t, 'working');
  }

  // ---------------------------------------------------------------- uso e status

  private usage(profile: Profile, sessionId: string, ev: Record<string, unknown>, at: number): boolean {
    const t = this.trackerFor(profile, sessionId) ?? (this.sessionStart(profile, sessionId, ev, at) ? this.trackerFor(profile, sessionId) : undefined);
    if (!t) return false;
    const tokens = hermesTokens(ev);
    if (!tokens) return false;
    const id = hermesUsageId(ev);
    if (id) {
      if (t.usageIds.has(id)) return true;
      this.remember(t.usageIds, id, USAGE_SEEN_MAX);
    }
    t.tokensIn += tokens.input;
    t.tokensOut += tokens.output;
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    t.model = str(ev.response_model) ?? str(ev.model) ?? t.model;
    this.applySummary(t);
    return true;
  }

  private waitingFor(ev: Record<string, unknown>): string {
    const why = str(ev.command) ?? str(ev.description);
    const clean = why ? truncate(maskSecrets(why.split('\n')[0].trim()), 80) : '';
    return clean ? tr('aprovar {0}', [clean]) : tr('aprovar uma permissão');
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

  private activityOf(t: Tracker): Activity | undefined {
    return this.opts.office.get(t.key)?.activity;
  }

  private addActivity(t: Tracker, activity: Activity): void {
    this.opts.office.addActivity(t.key, activity, true, { feed: true });
  }

  private applySummary(t: Tracker): void {
    const summary: TranscriptSummary = {
      tasks: [],
      stats: {
        toolCalls: t.toolCalls,
        tokensIn: t.tokensIn,
        tokensOut: t.tokensOut,
        subagents: t.subagents,
      },
      firstAt: t.startedAt,
      lastAt: t.lastSeenAt,
    };
    if (t.platform) summary.title = `Hermes · ${t.platform}`;
    if (t.model) summary.model = t.model;
    this.opts.office.applyTranscript(t.key, summary);
  }

  private remember(set: Set<string>, id: string, max: number): void {
    set.add(id);
    if (set.size > max) set.delete(set.values().next().value as string);
  }
}
