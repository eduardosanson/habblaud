import type { Provider } from '../../../shared/types';
import type { ConversationContext, WorkItemType } from './data';
import type { ApiSessionOptions } from './pipeline';
import type { SessionChoice } from './session-picker';

export type Variant = 'overview' | 'phases' | 'backlog' | 'work';
export type Filter = 'all' | 'active' | 'review' | 'blocked' | 'done' | 'future';
export type BacklogTypeFilter = 'all' | WorkItemType;
export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** Quem respondeu: o agente real da sessão que trabalhou no item (nome do perfil no pipeline e provider). */
export interface ChatAuthor {
  name: string;
  provider: Provider;
}

export interface ChatMessage {
  id: string;
  role: 'agent' | 'user';
  author?: ChatAuthor;
  text: string;
  at: string;
}

/** Agente que recebeu a pergunta (resposta de POST /api/roadmap/converse). */
export interface ConversationTarget {
  agentId: string;
  provider: Provider;
  profile?: string;
  role?: string;
  /** A sessão pode ser reaberta se fechar (há comando verificado para o provider). */
  resumable: boolean;
}

/** Seletor de sessão da gaveta: a lista que o servidor montou para o plano em foco e a escolha da pessoa. */
export interface SessionPickerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  options: ApiSessionOptions | null;
  error: string | null;
  /** Escolha da pessoa; `null` vale a sugerida. */
  choice: SessionChoice | null;
  /** Item para o qual a lista foi carregada; respostas atrasadas de outro item são descartadas. */
  forItemId: string | null;
  /** Reabertura pedida e a sessão ainda não apareceu viva. */
  reopening: boolean;
}

export interface ConversationUiState {
  open: boolean;
  context: ConversationContext;
  messages: ChatMessage[];
  /** Pergunta entregue e o agente ainda não respondeu. */
  typing: boolean;
  /** Para quem a última pergunta foi. */
  target: ConversationTarget | null;
  draftText: string;
  /** Muda a cada pergunta/contexto; respostas atrasadas de outra pergunta são descartadas. */
  replyToken: number;
  /** Estado do stream da conversa do agente (terminal do Habblaud). */
  connection: StreamStatus;
  sessions: SessionPickerState;
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
  openConversation(context: ConversationContext, opts?: { question?: string }): void;
  closeConversation(): void;
  setConversationContext(context: ConversationContext): void;
  setChatDraft(text: string): void;
  ask(question: string): void;
  send(text: string): void;
  /** Recarrega a lista de sessões do plano em foco (também é o "tentar de novo" do seletor). */
  loadSessions(): void;
  chooseSession(choice: SessionChoice): void;
  reopenSession(): void;
  showToast(text: string, tone?: ToastState['tone']): void;
  jumpToCurrent(): void;
}
