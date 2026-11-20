import type { ConversationContext, PlanRef, WorkItemType } from './data';

export type Variant = 'overview' | 'phases' | 'backlog' | 'work';
export type Filter = 'all' | 'active' | 'blocked' | 'done' | 'future';
export type BacklogTypeFilter = 'all' | WorkItemType;
export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface ActionReceipt {
  id: string;
  action: string;
  status: 'started' | 'applied' | 'rejected';
  target: { roadmapId: string; itemId?: string };
  summary: string;
  revision: number;
  error?: { code: string; message: string; retryable?: boolean };
}

export interface ChatMessage {
  id: string;
  messageId: string;
  role: 'agent' | 'user';
  agentId?: string;
  text: string;
  at: string;
  replyTo?: string;
  state?: string;
  planRef?: PlanRef;
  actions?: ActionReceipt[];
}

export interface ConversationUiState {
  open: boolean;
  context: ConversationContext;
  sessionId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  typing: boolean;
  sessionMenuOpen: boolean;
  draftText: string;
  /** Muda quando a sessão/contexto muda; respostas atrasadas de outra seleção são descartadas. */
  replyToken: number;
  connection: StreamStatus;
}

export interface ToastState {
  id: number;
  text: string;
  tone?: 'info' | 'ok' | 'error';
}

export interface SourceState {
  revision: number;
  generatedAt: string;
  label: string;
  updatedAt: string;
}

export interface AppState {
  ready: boolean;
  loading: boolean;
  loadError: string | null;
  variant: Variant;
  selectedRoadmapId: string;
  selectedPlanId: string;
  /** No celular, abre o detalhe como folha; no desktop o painel já está ao lado. */
  detailOpen: boolean;
  expandedPhases: Set<string>;
  filter: Filter;
  backlogType: BacklogTypeFilter;
  search: string;
  roadmapIndexOpen: boolean;
  roadmapMenuOpen: boolean;
  conversation: ConversationUiState;
  toast: ToastState | null;
  source: SourceState | null;
  roadmapStream: StreamStatus;
}

export interface AppActions {
  retry(): void;
  setVariant(variant: Variant): void;
  togglePhase(id: string): void;
  openPhase(id: string, planId?: string, roadmapId?: string): void;
  openPlan(id: string, roadmapId?: string): void;
  closeDetail(): void;
  setFilter(filter: Filter): void;
  setBacklogType(type: BacklogTypeFilter): void;
  setSearch(query: string): void;
  openRoadmapIndex(): void;
  closeRoadmapIndex(): void;
  toggleRoadmapMenu(): void;
  closeRoadmapMenu(): void;
  selectRoadmap(id: string): void;
  openConversation(context: ConversationContext, opts?: { sessionId?: string | null; question?: string }): void;
  closeConversation(): void;
  setConversationContext(context: ConversationContext): void;
  toggleSessionMenu(): void;
  chooseSession(sessionId: string | null): void;
  setChatDraft(text: string): void;
  ask(question: string): void;
  send(text: string): void;
  refreshConversation(): void;
  showToast(text: string, tone?: ToastState['tone']): void;
  jumpToCurrent(): void;
}
