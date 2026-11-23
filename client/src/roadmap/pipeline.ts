// Cliente HTTP/SSE do Hermes Pipeline.
//
// O navegador fala com `/api/roadmap`, o proxy do servidor do Habblaud, que injeta o
// token do Habblaud. O token tem só `roadmap.read` e `agent.converse`: nenhuma
// ferramenta de mutação passa por aqui. Quem move o roadmap é o agente, no pipeline.

const BASE = '/api/roadmap';

export type ApiPipelineStatus = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'canceled';

export interface ApiCounts {
  total: number;
  done: number;
  in_progress: number;
  blocked: number;
  review: number;
  ready: number;
  backlog: number;
  canceled: number;
}

export interface ApiProgress {
  done: number;
  total: number;
  percent: number;
}

export interface ApiRoadmapSummary {
  id: string;
  title: string;
  subtitle: string;
  objective: string;
  status: 'active' | 'archived' | 'draft';
  currentPhaseId: string;
  owner: string;
  counts: ApiCounts;
  progress: ApiProgress;
  milestone: string;
  revision: number;
  updatedAt: string;
}

export interface ApiLink {
  kind: 'blocks' | 'caused_by' | 'fixes' | 'relates_to' | 'duplicates';
  targetId: string;
  targetRoadmapId?: string;
}

export interface ApiDependency {
  kind: 'plan' | 'phase' | 'external';
  targetId?: string;
  targetRoadmapId?: string;
  label: string;
  status: string;
  detail?: string;
  blocking?: boolean;
}

export interface ApiEstimate {
  unit: 'tokens';
  p50: number;
  p80: number;
  confidence: number;
  sample: number;
  basis: string;
  humanDays?: number;
}

export interface ApiActual {
  tokens?: number;
  days?: number;
  sessions?: number;
  updatedAt: string;
}

export interface ApiExecution {
  provider: string;
  sessionId: string;
  agentId: string;
}

export interface ApiDecision {
  date: string;
  text: string;
  by: string;
}

export interface ApiItem {
  id: string;
  key: string;
  roadmapId: string;
  phaseId: string;
  parentId: string | null;
  index: number;
  title: string;
  type: 'story' | 'task' | 'bug';
  status: ApiPipelineStatus;
  priority: string;
  ownerId: string;
  objective: string;
  steps: string[] | null;
  criteria: { text: string; done: boolean }[] | null;
  dependencies: ApiDependency[] | null;
  links: ApiLink[] | null;
  decisions: ApiDecision[] | null;
  size: 'XS' | 'S' | 'M' | 'L' | 'XL' | null;
  estimate: ApiEstimate | null;
  actual: ApiActual | null;
  execution: ApiExecution | null;
  blockReason: string | null;
  unblock: string[] | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ApiPhase {
  id: string;
  index: number;
  name: string;
  objective: string;
  ownerId: string;
  status: ApiPipelineStatus;
  counts: ApiCounts;
  progress: ApiProgress;
  items: ApiItem[];
}

export interface ApiActivity {
  id: number;
  actor: string;
  action: string;
  summary: string;
  itemId: string | null;
  revision: number;
  at: string;
}

export interface ApiRoadmap {
  id: string;
  title: string;
  subtitle: string;
  objective: string;
  status: 'active' | 'archived' | 'draft';
  currentPhaseId: string;
  owner: string;
  counts: ApiCounts;
  progress: ApiProgress;
  phases: ApiPhase[];
  milestone: string;
  activity: ApiActivity[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ApiSnapshot {
  schemaVersion: number;
  source: string;
  revision: number;
  generatedAt: string;
  roadmap: ApiRoadmap;
}

export interface ApiSession {
  id: string;
  agentId: string;
  displayName: string;
  harness: string;
  model: string;
  status: string;
  capabilities: string[];
  roadmapIds: string[];
  currentItemId: string | null;
  lastSeen: string;
}

export interface ApiRoadmapStatus {
  enabled: boolean;
  configured: boolean;
  local: boolean;
  available: boolean;
  reason?: string;
  source?: string;
}

export interface ApiActionReceipt {
  id: string;
  action: string;
  status: 'started' | 'applied' | 'rejected';
  target: { roadmapId: string; itemId?: string };
  summary: string;
  revision: number;
  error?: ApiErrorPayload;
}

export interface ApiMessage {
  id: string;
  messageId: string;
  sessionId: string;
  role: 'user' | 'agent';
  text: string;
  context: { roadmapId?: string; itemId?: string };
  status: string;
  replyTo: string | null;
  error: string | null;
  receivedAt: string;
  processedAt: string;
  actions: ApiActionReceipt[];
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export interface ApiRoadmapChanged {
  roadmapId: string;
  revision: number;
  changedItemIds: string[];
  reason: string;
}

export class PipelineError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new PipelineError(0, 'pipeline_unavailable', error instanceof Error ? error.message : String(error), true);
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const envelope = payload as { error?: ApiErrorPayload } | null;
    const error = envelope?.error;
    throw new PipelineError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? `o pipeline respondeu ${response.status}`,
      error?.retryable ?? response.status >= 500,
      error?.details,
    );
  }
  return payload as T;
}

export function getRoadmapStatus(): Promise<ApiRoadmapStatus> {
  return request('/status');
}

export function listRoadmaps(): Promise<{ roadmaps: ApiRoadmapSummary[] }> {
  return request('/roadmaps');
}

export function getRoadmap(id: string): Promise<ApiSnapshot> {
  return request(`/roadmaps/${encodeURIComponent(id)}`);
}

/**
 * Como reabrir a sessão que fez a execução (registro do pipeline). Dado de outro processo: o `argv` nunca é executado
 * pelo Habblaud (ver server/roadmap/harness.ts).
 */
export interface ApiResume {
  harness: string;
  sessionId: string;
  workdir: string;
  argv: string[];
}

/** Execução registrada no item. Campos de sessão reabrível só existem em pipelines mais novos. */
export interface ApiItemExecution {
  id: number;
  roadmapId: string;
  itemId: string;
  source: string;
  board?: string;
  runId?: string;
  profile: string;
  provider: string;
  model: string;
  /** Id real da sessão do worker quando conhecido; vazio quando o pipeline não o capturou. */
  workerSessionId: string;
  startedAt: string;
  endedAt?: string;
  outcome?: string;
  summary?: string;
  changedFiles?: string[];
  statusFrom?: string;
  statusTo?: string;
  createdAt?: string;
  harness?: string;
  workdir?: string;
  role?: string;
  resume?: ApiResume | null;
}

/** Agente que participou do item, com a última sessão reabrível dele. */
export interface ApiParticipant {
  profile: string;
  harness: string;
  model: string;
  role: string;
  executions: number;
  lastOutcome?: string;
  lastEndedAt?: string;
  resume: ApiResume | null;
}

function itemPath(roadmapId: string, itemId: string, leaf: string): string {
  return `/roadmaps/${encodeURIComponent(roadmapId)}/items/${encodeURIComponent(itemId)}/${leaf}`;
}

export function listExecutions(roadmapId: string, itemId: string): Promise<{ roadmapId: string; itemId: string; executions: ApiItemExecution[] }> {
  return request(itemPath(roadmapId, itemId, 'executions'));
}

export function listParticipants(roadmapId: string, itemId: string): Promise<{ roadmapId: string; itemId: string; participants: ApiParticipant[] }> {
  return request(itemPath(roadmapId, itemId, 'participants'));
}

export function listSessions(): Promise<{ sessions: ApiSession[] }> {
  return request('/agent/sessions');
}

export function listMessages(sessionId: string, limit = 50): Promise<{ sessionId: string; messages: ApiMessage[] }> {
  return request(`/agent/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`);
}

export function postMessage(
  sessionId: string,
  body: { messageId: string; text: string; context: { roadmapId: string; itemId?: string } },
): Promise<{ accepted: boolean; messageId: string; sessionId: string; receivedAt: string }> {
  return request(`/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface Subscription {
  close(): void;
}

type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface StreamHandlers<T> {
  onEvent(event: T): void;
  onStatus?(status: StreamStatus): void;
}

function subscribe<T>(path: string, eventName: string, handlers: StreamHandlers<T>): Subscription {
  const source = new EventSource(`${BASE}${path}`);
  let closed = false;
  handlers.onStatus?.('connecting');
  source.addEventListener('open', () => handlers.onStatus?.('live'));
  source.addEventListener(eventName, (event) => {
    try {
      handlers.onEvent(JSON.parse((event as MessageEvent<string>).data) as T);
    } catch {
      // Evento malformado não pode derrubar a conversa; o próximo snapshot corrige.
    }
  });
  source.addEventListener('heartbeat', () => handlers.onStatus?.('live'));
  source.addEventListener('error', () => {
    if (closed) return;
    handlers.onStatus?.('reconnecting');
  });
  return {
    close() {
      closed = true;
      source.close();
      handlers.onStatus?.('closed');
    },
  };
}

export function subscribeRoadmap(id: string, handlers: StreamHandlers<ApiRoadmapChanged>): Subscription {
  return subscribe(`/roadmaps/${encodeURIComponent(id)}/events`, 'roadmap.changed', handlers);
}

export interface SessionStreamHandlers {
  onMessage?(message: ApiMessage): void;
  onAction?(action: ApiActionReceipt): void;
  onError?(error: ApiErrorPayload): void;
  onStatus?(status: StreamStatus): void;
}

export function subscribeSession(id: string, handlers: SessionStreamHandlers): Subscription {
  const source = new EventSource(`${BASE}/agent/sessions/${encodeURIComponent(id)}/events`);
  let closed = false;
  const status = handlers.onStatus;
  status?.('connecting');
  source.addEventListener('open', () => status?.('live'));
  source.addEventListener('heartbeat', () => status?.('live'));
  source.addEventListener('message', (event) => {
    try {
      handlers.onMessage?.(JSON.parse((event as MessageEvent<string>).data) as ApiMessage);
    } catch {
      // Ignora evento malformado.
    }
  });
  source.addEventListener('action', (event) => {
    try {
      handlers.onAction?.(JSON.parse((event as MessageEvent<string>).data) as ApiActionReceipt);
    } catch {
      // Ignora evento malformado.
    }
  });
  source.addEventListener('error', (event) => {
    const data = (event as MessageEvent<string>).data;
    if (data) {
      try {
        handlers.onError?.(JSON.parse(data) as ApiErrorPayload);
        return;
      } catch {
        // Cai no status de reconexão abaixo.
      }
    }
    if (!closed) status?.('reconnecting');
  });
  return {
    close() {
      closed = true;
      source.close();
      status?.('closed');
    },
  };
}
