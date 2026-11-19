// Traduções puras do OpenCode: sessão, uso, ferramentas e eventos -> tipos do escritório.
// Sem I/O e sem Office aqui: os testes cobrem o que cada evento vira.
import type { AccountUsage, Activity, AgentStats, UsageWindow } from '../../../shared/types';
import { describeCommand, describeTool, maskSecrets, truncate, type ActivityDescription } from '../../../shared/activity';
import { normalizeCwd } from '../../model/rooms';
import { tr } from '../../../shared/i18n';
import type { OpenCodeEvent } from './client';

export interface OpenCodeTokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface OpenCodeSession {
  id: string;
  projectId?: string;
  parentId?: string;
  agent?: string;
  model?: string;
  cost?: number;
  tokens: OpenCodeTokens;
  title?: string;
  cwd?: string;
  time: {
    created: number;
    updated: number;
    busy?: number;
    idle?: number;
    viewed?: number;
    archived?: number;
  };
  archivedAt?: number;
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

/** Sessão do `GET /api/session` (e do evento `session.created`) no formato que a fonte usa. */
export function parseOpenCodeSession(raw: unknown): OpenCodeSession | undefined {
  const j = rec(raw);
  if (!j) return undefined;
  const id = str(j.id);
  const location = rec(j.location);
  const cwd = str(location?.directory);
  const time = rec(j.time);
  const created = num(time?.created);
  const updated = num(time?.updated);
  if (!id || !cwd || created === undefined || updated === undefined) return undefined;

  const tokens = rec(j.tokens);
  const cache = rec(tokens?.cache);
  const model = j.model;
  const modelId = typeof model === 'string' ? str(model) : str(rec(model)?.id);
  const parentId = str(j.parentID);
  const archived = num(time?.archived);
  const out: OpenCodeSession = {
    id,
    tokens: {
      input: num(tokens?.input) ?? 0,
      output: num(tokens?.output) ?? 0,
      reasoning: num(tokens?.reasoning) ?? 0,
      cacheRead: num(cache?.read) ?? 0,
      cacheWrite: num(cache?.write) ?? 0,
    },
    time: {
      created,
      updated,
      ...(num(time?.busy) !== undefined ? { busy: num(time?.busy) } : {}),
      ...(num(time?.idle) !== undefined ? { idle: num(time?.idle) } : {}),
      ...(num(time?.viewed) !== undefined ? { viewed: num(time?.viewed) } : {}),
      ...(archived !== undefined ? { archived } : {}),
    },
  };
  const projectId = str(j.projectID);
  const agent = str(j.agent);
  const title = str(j.title);
  const cost = num(j.cost);
  if (projectId) out.projectId = projectId;
  if (parentId) out.parentId = parentId;
  if (agent) out.agent = agent;
  if (modelId) out.model = modelId;
  if (title) out.title = title;
  if (cost !== undefined) out.cost = cost;
  if (archived !== undefined) out.archivedAt = archived;
  out.cwd = normalizeCwd(cwd);
  return out;
}

function usageWindow(raw: unknown): UsageWindow | undefined {
  const j = rec(raw);
  if (!j) return undefined;
  const percent = num(j.percent);
  if (percent === undefined) return undefined;
  const w: UsageWindow = { utilization: Math.min(100, Math.max(0, percent)) };
  const resetsAt = num(j.resetsAt);
  if (resetsAt !== undefined) w.resetsAt = resetsAt;
  return w;
}

/** `GET /api/experimental/usage/limits` (o data já desembrulhado) -> uso do plano. */
export function parseOpenCodeUsage(raw: unknown, fetchedAt: number): AccountUsage | undefined {
  const j = rec(raw);
  if (!j) return undefined;
  const go = rec(j.go) ?? j;
  const fiveHour = usageWindow(go.rolling);
  const sevenDay = usageWindow(go.weekly);
  if (!fiveHour && !sevenDay) return undefined;
  return {
    source: 'opencode',
    fetchedAt,
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
  };
}

/** Atividade de uma ferramenta do OpenCode, reaproveitando as descrições do Claude Code. */
export function describeOpenCodeTool(name: string, rawInput: unknown): ActivityDescription {
  const input = rec(rawInput) ?? {};
  const file = str(input.filePath) ?? str(input.path) ?? str(input.file) ?? str(input.absolutePath);
  const command = str(input.command) ?? str(input.cmd);
  const pattern = str(input.pattern);
  const url = str(input.url);
  const query = str(input.query);
  switch (name.toLowerCase()) {
    case 'read':
      return describeTool('Read', { file_path: file });
    case 'edit':
      return describeTool('Edit', { file_path: file });
    case 'write':
      return describeTool('Write', { file_path: file });
    case 'patch':
    case 'multiedit':
      return describeTool('Edit', { file_path: file });
    case 'shell':
    case 'bash':
      return describeCommand(command ?? '', str(input.description));
    case 'glob':
      return describeTool('Glob', { pattern });
    case 'grep':
      return describeTool('Grep', { pattern });
    case 'ls':
    case 'list':
      return describeTool('LS', { path: file });
    case 'webfetch':
      return describeTool('WebFetch', { url });
    case 'websearch':
      return describeTool('WebSearch', { query });
    case 'task':
      return describeTool('Task', {
        description: str(input.description),
        subagent_type: str(input.subagent_type) ?? str(input.agent),
        prompt: str(input.prompt),
      });
    case 'todowrite':
      return describeTool('TodoWrite', { todos: input.todos });
    case 'todoread':
      return describeTool('TaskList', {});
    case 'skill':
      return describeTool('Skill', { skill: str(input.name) ?? str(input.skill) });
    case 'question':
    case 'ask':
      return { kind: 'ask', icon: '❓', text: tr('Fazendo uma pergunta a você'), ...(str(input.question) ? { detail: str(input.question) } : {}) };
    default:
      if (name.startsWith('mcp_')) return describeTool(name.replace(/^mcp_/, 'mcp__'), input);
      return { kind: 'other', icon: '🛠️', text: tr('Usando {0}', [name]) };
  }
}

function errorText(raw: unknown): string | undefined {
  const j = rec(raw);
  const message = str(j?.message) ?? str(j?.data) ?? str(raw);
  return message ? truncate(maskSecrets(message), 120) : undefined;
}

function activityBase(ev: OpenCodeEvent, kind: Activity['kind'], icon: string, text: string): Activity {
  const sid = str(ev.data.sessionID) ?? 'opencode';
  return { id: `${sid}:${ev.id ?? `${ev.type}:${ev.created ?? 0}`}`, at: ev.created ?? Date.now(), kind, icon, text };
}

/** Status que o evento decide; undefined = o evento não muda o status. */
export function eventStatus(ev: OpenCodeEvent): 'working' | 'idle' | 'waiting' | undefined {
  switch (ev.type) {
    case 'session.execution.started':
    case 'session.tool.input.started':
    case 'session.tool.called':
    case 'session.tool.success':
    case 'session.text.started':
    case 'session.reasoning.started':
    case 'session.compaction.started':
    case 'session.compaction.ended':
    case 'session.shell.started':
    case 'session.shell.ended':
    case 'permission.replied':
      return 'working';
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
    case 'session.idle':
      return 'idle';
    case 'permission.asked':
      return 'waiting';
    case 'session.status': {
      const status = rec(ev.data.status);
      if (status?.type === 'idle') return 'idle';
      if (status?.type === 'busy' || status?.type === 'retry') return 'working';
      return undefined;
    }
    case 'session.viewed':
      return 'idle';
    default:
      return undefined;
  }
}

/** Motivo exibido em `waitingFor` quando o agente espera você. */
export function eventWaitingFor(ev: OpenCodeEvent): string | undefined {
  if (ev.type !== 'permission.asked') return undefined;
  const action = str(ev.data.action) ?? tr('uma ação');
  const resources = Array.isArray(ev.data.resources) ? ev.data.resources.filter((x): x is string => typeof x === 'string') : [];
  return resources.length ? tr('aprovar {0} ({1})', [action, truncate(resources[0], 40)]) : tr('aprovar {0}', [action]);
}

/** Atividade de eventos que não dependem de ferramenta (texto, raciocínio, compactação, retry, erro). */
export function eventActivity(ev: OpenCodeEvent): Activity | undefined {
  switch (ev.type) {
    case 'session.reasoning.started':
      return activityBase(ev, 'think', '💭', tr('Pensando'));
    case 'session.text.started':
      return activityBase(ev, 'respond', '✍️', tr('Escrevendo resposta'));
    case 'session.compaction.started':
      return activityBase(ev, 'compact', '🗜️', tr('Compactando o contexto'));
    case 'session.compaction.ended':
      return activityBase(ev, 'compact', '🗜️', tr('Contexto compactado'));
    case 'session.compaction.failed': {
      const act = activityBase(ev, 'error', '⚠️', tr('Falha ao compactar o contexto'));
      act.error = true;
      return act;
    }
    case 'session.execution.failed': {
      const act = activityBase(ev, 'error', '⚠️', tr('O turno falhou'));
      act.error = true;
      const detail = errorText(ev.data.error);
      if (detail) act.detail = detail;
      return act;
    }
    case 'session.execution.interrupted':
      return activityBase(ev, 'wait', '⏹️', tr('Turno interrompido'));
    case 'session.status': {
      const status = rec(ev.data.status);
      if (status?.type !== 'retry') return undefined;
      const attempt = num(status.attempt) ?? 0;
      return activityBase(ev, 'wait', '🔁', tr('Tentando de novo (tentativa {0})', [String(attempt)]));
    }
    case 'session.tool.failed': {
      const act = activityBase(ev, 'error', '⚠️', tr('A ferramenta falhou'));
      act.error = true;
      const detail = errorText(ev.data.error);
      if (detail) act.detail = detail;
      return act;
    }
    default:
      return undefined;
  }
}

/** A sessão deve estar no escritório agora? Ativa ou vista/atualizada dentro da janela; arquivada nunca. */
export function isRecentSession(s: OpenCodeSession, active: boolean, now: number, recentMs: number): boolean {
  if (s.archivedAt !== undefined) return false;
  if (active) return true;
  const seen = Math.max(s.time.viewed ?? 0, s.time.updated, s.time.created);
  return now - seen <= recentMs;
}

/** Estatísticas do agente a partir da sessão; `toolCalls` e `subagents` vêm do rastreamento ao vivo. */
export function sessionStats(s: OpenCodeSession, toolCalls: number, subagents: number): AgentStats {
  const stats: AgentStats = {
    toolCalls,
    tokensIn: s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite,
    tokensOut: s.tokens.output + s.tokens.reasoning,
    subagents,
  };
  if (s.cost !== undefined) stats.costUSD = s.cost;
  return stats;
}

/** Papel exibido: o agente do OpenCode (`build`, `plan`...) ou o padrão da ferramenta. */
export function sessionRole(s: OpenCodeSession, kind: 'main' | 'sub' = 'main'): string {
  if (s.agent) return tr('Agente {0}', [s.agent]);
  return kind === 'sub' ? tr('Subagente (OpenCode)') : tr('Agente principal (OpenCode)');
}

export function sessionCwd(s: OpenCodeSession): string | undefined {
  return s.cwd;
}

export function sessionTitle(s: OpenCodeSession): string | undefined {
  return s.title?.trim() || undefined;
}
