// Fonte do Antigravity (AgentSource 'antigravity'): o hook do CLI `agy` (mod/habblaud-antigravity/hook.mjs) manda
// eventos de sessão/ferramenta para POST /api/antigravity/events. O uso do plano vem do próprio CLI
// (`agy -p "/usage" --output-format json`), com os grupos Gemini Models / Claude and GPT models / Argon.
//
// Nada de credenciais: o hook só observa e o comando de uso é o mesmo que o Antigravity já roda para o usuário.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AccountUsage, Activity, AgentStatus, SourceInfo, UsageWindow } from '../../../shared/types';
import { describeTool, SPECIAL } from '../../../shared/activity';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';
import type { AccountsService } from '../../accounts/service';
import { errMsg, log } from '../../log';
import type { Office, TranscriptSummary } from '../../model/office';
import type { AgentSource } from '../source';
import { eventAt, eventSessionId, eventType, parseAntigravityUsage, rec, str, type AntigravityEventBody } from './events';
import { tr } from '../../../shared/i18n';

const runFile = promisify(execFile);
const DEFAULT_STALE_MS = 2 * 60 * 60_000;

export interface AntigravitySourceOptions {
  accounts: AccountsService;
  office: Office;
  /** Pasta do estado do Antigravity (padrão: ~/.gemini/antigravity-cli). */
  dir?: string;
  home?: string;
  now?: () => number;
  /** Sessão sem evento por este tempo sai do escritório (padrão 2 h). */
  staleMs?: number;
  /** Releitura do uso no `agy` (padrão 60 s; 0 desliga). */
  usageMs?: number;
  /** Binário do Antigravity (padrão: agy do PATH). */
  bin?: string;
  env?: NodeJS.ProcessEnv;
}

interface Tracker {
  key: string;
  sessionId: string;
  inOffice: boolean;
  status: AgentStatus;
  startedAt: number;
  lastSeenAt: number;
  cwd: string;
  title?: string;
  model?: string;
  toolCalls: number;
  calls: Set<string>;
}

export class AntigravitySource implements AgentSource {
  readonly provider = 'antigravity' as const;
  private readonly now: () => number;
  private readonly dir: string;
  private readonly accountId: string;
  private readonly staleMs: number;
  private readonly usageMs: number;
  private readonly bin: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly trackers = new Map<string, Tracker>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private usageBusy = false;
  private stopped = false;

  constructor(private readonly opts: AntigravitySourceOptions) {
    this.now = opts.now ?? Date.now;
    const home = opts.home ?? process.env.HOME ?? homedir();
    this.dir = opts.dir ?? join(home, '.gemini', 'antigravity-cli');
    this.staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
    this.usageMs = opts.usageMs ?? 60_000;
    this.bin = opts.bin ?? process.env.HABBLAND_ANTIGRAVITY_BIN ?? 'agy';
    this.env = opts.env ?? process.env;
    const detected: DetectedAccount = {
      id: 'antigravity',
      provider: 'antigravity',
      configDir: this.dir,
      short: 'AG',
      name: 'Antigravity',
      color: ACCOUNT_COLORS[ACCOUNT_COLORS.length - 1] ?? ACCOUNT_COLORS[0],
      plan: 'Antigravity',
    };
    const entries = opts.accounts.setProviderAccounts('antigravity', [{ dir: this.dir, detected }]);
    this.accountId = entries[0]?.id ?? 'antigravity';
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref?.();
    if (this.usageMs > 0) {
      void this.refreshUsage();
      this.usageTimer = setInterval(() => void this.refreshUsage(), this.usageMs);
      this.usageTimer.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.timer = null;
    this.usageTimer = null;
  }

  sources(): SourceInfo[] {
    const sessions = [...this.trackers.values()].filter((t) => t.inOffice).length;
    return [{ label: 'antigravity', provider: 'antigravity', path: this.dir, sessions, ok: true }];
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /** Sem transcript em arquivo; o terminal do Antigravity fica para uma fase seguinte. */
  terminalParser(): undefined {
    return undefined;
  }

  applyEvent(body: AntigravityEventBody): boolean {
    const ev = body.event;
    const type = eventType(ev);
    const sessionId = eventSessionId(ev);
    if (!type || !sessionId) return false;
    if (!['session_start', 'session_busy', 'session_idle', 'session_end', 'tool_start', 'tool_end'].includes(type)) return false;
    const at = eventAt(ev, this.now());
    const t = this.ensure(ev, sessionId, at);
    if (!t) return false;
    if (type === 'session_end') {
      this.add(t, at, ev.failed === true ? SPECIAL.error('Antigravity', str(ev.error)) : SPECIAL.turnDone());
      t.inOffice = false;
      this.trackers.delete(t.key);
      this.opts.office.closeMain(t.key);
      return true;
    }
    t.lastSeenAt = Math.max(t.lastSeenAt, at);
    const title = str(ev.title) ?? str(ev.lastUserInput) ?? str(ev.last_user_input);
    if (title) t.title = title.slice(0, 90);
    const model = str(ev.model) ?? str(ev.modelName);
    if (model) t.model = model;
    if (type === 'session_start' || type === 'session_idle') {
      this.opts.office.setStatus(t.key, 'idle');
      t.status = 'idle';
    } else {
      this.opts.office.setStatus(t.key, 'working');
      t.status = 'working';
    }
    if (type === 'session_busy' && !this.opts.office.get(t.key)?.activity) this.opts.office.fillWorkingActivity(t.key);
    if (type === 'tool_start') this.toolStart(t, ev, at);
    if (type === 'tool_end' && ev.error) this.add(t, at, SPECIAL.error(str(ev.tool_name) ?? str(ev.toolName), str(ev.error)));
    this.applySummary(t);
    return true;
  }

  // ---------------------------------------------------------------- sessões

  private keyFor(sessionId: string): string {
    return `antigravity:${sessionId}`;
  }

  private ensure(ev: Record<string, unknown>, sessionId: string, at: number): Tracker | undefined {
    const key = this.keyFor(sessionId);
    const existing = this.trackers.get(key);
    if (existing) return existing;
    const cwd = str(ev.project) ?? str(ev.cwd) ?? str(ev.directory) ?? this.dir;
    const title = str(ev.title) ?? str(ev.lastUserInput) ?? str(ev.last_user_input);
    this.opts.office.addMain({
      id: key,
      provider: 'antigravity',
      account: this.accountId,
      sessionId,
      cwd,
      role: str(ev.platform) ? `Antigravity (${str(ev.platform)})` : 'Antigravity',
      startedAt: at,
      status: 'idle',
    });
    if (!this.opts.office.has(key)) return undefined;
    const t: Tracker = {
      key,
      sessionId,
      inOffice: true,
      status: 'idle',
      startedAt: at,
      lastSeenAt: at,
      cwd,
      toolCalls: 0,
      calls: new Set(),
    };
    if (title) t.title = title.slice(0, 90);
    const model = str(ev.model) ?? str(ev.modelName);
    if (model) t.model = model;
    this.trackers.set(key, t);
    this.applySummary(t);
    return t;
  }

  private toolStart(t: Tracker, ev: Record<string, unknown>, at: number): void {
    const rawName = str(ev.tool_name) ?? str(ev.toolName) ?? 'tool';
    const callId = str(ev.call_id) ?? str(ev.callId) ?? `${at}`;
    if (t.calls.has(callId)) return;
    t.calls.add(callId);
    t.toolCalls++;
    const input = rec(ev.input) ?? rec(ev.toolInput) ?? {};
    const inputName = rawName.toLowerCase();
    const mapped =
      inputName.includes('command') || inputName === 'run_command'
        ? describeTool('Bash', input)
        : inputName.includes('read')
          ? describeTool('Read', input)
          : inputName.includes('write')
            ? describeTool('Write', input)
            : inputName.includes('edit') || inputName.includes('patch')
              ? describeTool('Edit', input)
              : inputName.includes('grep')
                ? describeTool('Grep', input)
                : inputName.includes('search') || inputName.includes('list')
                  ? describeTool('Glob', input)
                  : inputName.includes('browser') || inputName.includes('web')
                    ? describeTool('WebFetch', input)
                    : inputName.includes('spawn') || inputName === 'task'
                      ? SPECIAL.supervising()
                      : SPECIAL.think();
    const activity: Activity = {
      id: `${t.key}:tool:${callId}`,
      at,
      kind: mapped.kind,
      icon: mapped.icon,
      text: mapped.text,
      ...(mapped.detail ? { detail: mapped.detail } : {}),
      tool: rawName,
    };
    this.opts.office.addActivity(t.key, activity, true, { feed: true });
    this.applySummary(t);
  }

  private add(t: Tracker, at: number, desc: { kind: Activity['kind']; icon: string; text: string; detail?: string; tool?: string }): void {
    this.opts.office.addActivity(t.key, { id: `${t.key}:act:${at}`, at, ...desc }, true, { feed: true });
  }

  private applySummary(t: Tracker): void {
    const summary: TranscriptSummary = {
      tasks: [],
      stats: { toolCalls: t.toolCalls, tokensIn: 0, tokensOut: 0, subagents: 0 },
      firstAt: t.startedAt,
      lastAt: t.lastSeenAt,
    };
    if (t.title) summary.title = t.title;
    if (t.model) summary.model = t.model;
    this.opts.office.applyTranscript(t.key, summary);
  }

  private sweep(): void {
    const now = this.now();
    for (const t of [...this.trackers.values()]) {
      if (now - t.lastSeenAt <= this.staleMs) continue;
      t.inOffice = false;
      this.trackers.delete(t.key);
      this.opts.office.closeMain(t.key);
    }
  }

  /** Uso do plano: `agy -p "/usage" --output-format json`. Sem `agy`/sem login, o cartão fica sem dados. */
  async refreshUsage(): Promise<void> {
    if (this.usageBusy || this.stopped) return;
    this.usageBusy = true;
    try {
      const { stdout } = await runFile(this.bin, ['-p', '/usage', '--output-format', 'json'], {
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        env: this.env,
      });
      const usage = parseAntigravityUsage(JSON.parse(stdout), this.now());
      if (usage) this.opts.accounts.setUsage(this.accountId, usage);
    } catch (err) {
      log.warnOnce('antigravity-usage', tr('Antigravity: não foi possível ler o uso ({0}).', [errMsg(err).slice(0, 120)]));
    } finally {
      this.usageBusy = false;
    }
  }
}
