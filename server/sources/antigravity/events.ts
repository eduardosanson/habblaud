// Eventos do Antigravity: o hook do `agy` (mod/habblaud-antigravity/hook.mjs) manda um JSON por evento para
// POST /api/antigravity/events. O hook normaliza os nomes do runtime para os tipos abaixo; o servidor só observa.
import type { AccountUsage, UsageWindow } from '../../../shared/types';

export interface AntigravityEventBody {
  event: Record<string, unknown>;
}

export const ANTIGRAVITY_EVENT_TYPES = new Set([
  'session_start',
  'session_busy',
  'session_idle',
  'session_end',
  'tool_start',
  'tool_end',
]);

export function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function eventType(ev: Record<string, unknown>): string | undefined {
  return str(ev.type) ?? str(ev.hookEventName) ?? str(ev.hook_event_name);
}

export function eventSessionId(ev: Record<string, unknown>): string | undefined {
  return str(ev.session_id) ?? str(ev.conversationId) ?? str(ev.conversation_id) ?? str(ev.sessionId);
}

export function eventAt(ev: Record<string, unknown>, now: number): number {
  const raw = num(ev.at) ?? num(ev.ts);
  if (raw === undefined) return now;
  return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
}

/** `agy -p "/usage" --output-format json` -> janelas nomeadas + as piores 5 h/semana para o cartão. */
export function parseAntigravityUsage(raw: unknown, fetchedAt: number): AccountUsage | undefined {
  const root = rec(raw);
  const command = rec(root?.command);
  const data = rec(command?.data) ?? rec(root?.data) ?? root;
  const groups = Array.isArray(data?.groups) ? data.groups : undefined;
  if (!groups) return undefined;

  const details: NonNullable<AccountUsage['details']> = [];
  let fiveHour: UsageWindow | undefined;
  let sevenDay: UsageWindow | undefined;
  const keepWorst = (current: UsageWindow | undefined, next: UsageWindow): UsageWindow => (!current || next.utilization > current.utilization ? next : current);
  const resetOf = (v: unknown): number | undefined => {
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isNaN(t) ? undefined : t;
    }
    const n = num(v);
    return n === undefined ? undefined : n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  };

  for (const g of groups) {
    const group = rec(g);
    const name = str(group?.name);
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    for (const b of buckets) {
      const bucket = rec(b);
      const remaining = num(bucket?.remaining_fraction);
      if (!name || remaining === undefined) continue;
      const utilization = Math.min(100, Math.max(0, (1 - remaining) * 100));
      const window = str(bucket?.window);
      const resetsAt = resetOf(bucket?.reset_time ?? bucket?.resetTime);
      const label = window === '5h' ? `${name} · 5 h` : window === 'weekly' ? `${name} · semana` : `${name}${window ? ` · ${window}` : ''}`;
      details.push({ label, utilization, ...(resetsAt !== undefined ? { resetsAt } : {}) });
      const entry: UsageWindow = { utilization, ...(resetsAt !== undefined ? { resetsAt } : {}) };
      if (window === '5h') fiveHour = keepWorst(fiveHour, entry);
      else if (window === 'weekly') sevenDay = keepWorst(sevenDay, entry);
    }
  }
  if (!fiveHour && !sevenDay) return undefined;
  return {
    source: 'antigravity',
    fetchedAt,
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    ...(details.length ? { details } : {}),
  };
}
