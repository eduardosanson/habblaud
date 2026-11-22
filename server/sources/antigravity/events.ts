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

const GOOGLE_GROUP_RE = /\b(gemini|gemma|google|argon|neon|hydrogen|imagen|veo)\b/i;
const THIRD_PARTY_GROUP_RE = /\b(claude|gpt|openai|anthropic|third[- ]?party|3p)\b/i;
const GOOGLE_BUCKET_ID_RE = /^(?:gemini|gemma|google)[-_]/i;
const THIRD_PARTY_BUCKET_ID_RE = /^(?:3p|third[-_]?party)[-_]/i;

/** Apenas grupos de modelos do Google (exclui modelos de terceiros como Claude e GPT). */
export function isGoogleAntigravityGroup(groupName: string, bucketId?: string): boolean {
  if (THIRD_PARTY_GROUP_RE.test(groupName)) return false;
  if (bucketId && THIRD_PARTY_BUCKET_ID_RE.test(bucketId)) return false;
  if (GOOGLE_GROUP_RE.test(groupName)) return true;
  if (bucketId && GOOGLE_BUCKET_ID_RE.test(bucketId)) return true;
  return false;
}

const WINDOW_ORDER: Record<string, number> = { '5h': 0, weekly: 1, monthly: 2 };

/** `agy -p "/usage" --output-format json` -> janelas nomeadas (somente Google) + as piores 5 h/semana para o cartão. */
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
    if (!name) continue;
    const rawBuckets = Array.isArray(group?.buckets) ? group.buckets : [];
    const buckets = rawBuckets
      .map((b) => rec(b))
      .filter((b): b is Record<string, unknown> => !!b && b.disabled !== true)
      .filter((b) => isGoogleAntigravityGroup(name, str(b.id)))
      .sort((a, b) => (WINDOW_ORDER[str(a.window) ?? ''] ?? 3) - (WINDOW_ORDER[str(b.window) ?? ''] ?? 3));

    for (const bucket of buckets) {
      const remaining = num(bucket.remaining_fraction);
      if (remaining === undefined) continue;
      const utilization = Math.min(100, Math.max(0, (1 - remaining) * 100));
      const window = str(bucket.window);
      const winKind: NonNullable<AccountUsage['details']>[number]['window'] =
        window === '5h' || window === 'weekly' || window === 'monthly' ? window : undefined;
      const resetsAt = resetOf(bucket.reset_time ?? bucket.resetTime);
      const label =
        window === '5h'
          ? `${name} · 5 h`
          : window === 'weekly'
            ? `${name} · semana`
            : window === 'monthly'
              ? `${name} · mês`
              : `${name}${window ? ` · ${window}` : ''}`;
      details.push({
        label,
        group: name,
        ...(winKind ? { window: winKind } : {}),
        utilization,
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      });
      const entry: UsageWindow = { utilization, ...(resetsAt !== undefined ? { resetsAt } : {}) };
      if (window === '5h') fiveHour = keepWorst(fiveHour, entry);
      else if (window === 'weekly') sevenDay = keepWorst(sevenDay, entry);
    }
  }
  if (!fiveHour && !sevenDay && details.length === 0) return undefined;
  return {
    source: 'antigravity',
    fetchedAt,
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    ...(details.length ? { details } : {}),
  };
}
