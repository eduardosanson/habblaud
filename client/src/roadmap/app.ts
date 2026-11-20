// Estado e interações do roadmap. O Habblaud carrega o snapshot do Hermes Pipeline,
// acompanha `roadmap.changed` e conversa com o agente da sessão. Não existe rascunho,
// criação, edição, estimativa local nem publicação: a escrita é do agente no pipeline.
import { tr } from '../../../shared/i18n';
import {
  ROADMAPS,
  defaultPlanFor,
  defaultSessionForRoadmap,
  normalizeSearch,
  phaseById,
  planById,
  planMatches,
  roadmapById,
  sessionById,
  type ConversationContext,
  type Roadmap,
} from './data';
import { mapMessages } from './conversation-data';
import { renderChatBackdrop, renderConversation } from './conversation';
import { hydrateLive, loadLiveData, sourceFor } from './live';
import {
  PipelineError,
  listMessages,
  postMessage,
  subscribeRoadmap,
  subscribeSession,
  type ApiActionReceipt,
  type Subscription,
} from './pipeline';
import type { AppActions, AppState, StreamStatus, ToastState } from './state';
import { h, icon } from './ui';
import { renderPage, renderRoadmapIndex, renderTopbar } from './views';

interface FocusInfo {
  id: string;
  start?: number | null;
  end?: number | null;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function createInitialState(): AppState {
  return {
    ready: false,
    loading: true,
    loadError: null,
    variant: 'overview',
    selectedRoadmapId: '',
    selectedPlanId: '',
    detailOpen: false,
    expandedPhases: new Set(),
    filter: 'all',
    backlogType: 'all',
    search: '',
    roadmapIndexOpen: false,
    roadmapMenuOpen: false,
    conversation: {
      open: false,
      context: { roadmapId: '', kind: 'roadmap' },
      sessionId: null,
      messages: [],
      loading: false,
      typing: false,
      sessionMenuOpen: false,
      draftText: '',
      replyToken: 0,
      connection: 'closed',
    },
    toast: null,
    source: null,
    roadmapStream: 'closed',
  };
}

function describeError(error: unknown): string {
  if (error instanceof PipelineError) {
    if (error.status === 0) return tr('O servidor do Habblaud não respondeu.');
    if (error.code === 'roadmap_disabled' || error.code === 'local_only') return error.message;
    if (error.status === 401 || error.status === 403) {
      return tr('O token do Habblaud não foi aceito ({0}). Confira HABBLAUD_ROADMAP_TOKEN no servidor.', [error.message]);
    }
    return error.status ? `${error.status} · ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function renderToast(toast: ToastState): HTMLElement {
  const tone = toast.tone ?? 'info';
  return h(
    'div',
    { class: `rp-toast is-${tone}`, attrs: { role: 'status', 'aria-live': 'polite' } },
    icon(tone === 'error' ? 'warning' : tone === 'ok' ? 'check' : 'info'),
    h('span', { class: 'rp-toast__text', text: toast.text }),
    h('span', { class: 'rp-toast__tag', text: tr('Pipeline') }),
  );
}

function captureFocus(): FocusInfo | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.id) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
  }
  return { id: el.id };
}

function restoreFocus(info: FocusInfo | null): void {
  if (!info) return;
  const el = document.getElementById(info.id);
  if (!(el instanceof HTMLElement)) return;
  el.focus({ preventScroll: true });
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && info.start != null) {
    try {
      el.setSelectionRange(info.start, info.end ?? info.start);
    } catch {
      // Alguns tipos de input não aceitam seleção; o foco já foi restaurado.
    }
  }
}

function renderBoot(state: AppState, actions: AppActions): HTMLElement {
  const loading = state.loading && !state.loadError;
  return h(
    'div',
    { class: 'rp-page rp-boot' },
    h(
      'header',
      { class: 'rp-topbar' },
      h(
        'div',
        { class: 'rp-brand' },
        h('img', {
          class: 'rp-brand__mark',
          attrs: { src: '/assets/brand/logo-mark.png', alt: '', width: 30, height: 30 },
        }),
        h('span', { class: 'rp-brand__name', text: 'Habblaud' }),
      ),
      h(
        'div',
        { class: 'rp-topbar__actions' },
        h('a', { class: 'rp-btn rp-btn--office', attrs: { href: '/', title: tr('Voltar ao escritório') } }, icon('chevronLeft'), h('span', { text: tr('Escritório') })),
        h('span', { class: 'rp-source-badge is-offline' }, icon('layers'), h('span', { text: tr('Hermes Pipeline') })),
      ),
    ),
    h(
      'main',
      { class: 'rp-main rp-main--boot' },
      h(
        'section',
        { class: 'rp-panel rp-connect', attrs: { role: 'status', 'aria-live': 'polite' } },
        h('span', { class: 'rp-eyebrow', text: tr('FONTE DA VERDADE') }),
        h('h1', { class: 'rp-h1', text: loading ? tr('Conectando ao Hermes Pipeline…') : tr('Não foi possível ler o roadmap') }),
        h(
          'p',
          { class: 'rp-lede' },
          loading
            ? tr('Buscando roadmaps, sessões e a revisão atual. Esta página não usa dados fictícios.')
            : state.loadError ?? tr('O pipeline não respondeu.'),
        ),
        loading
          ? h('div', { class: 'rp-connect__dots' }, h('span'), h('span'), h('span'))
          : h(
              'div',
              { class: 'rp-connect__actions' },
              h(
                'button',
                { class: 'rp-btn rp-btn--primary', attrs: { type: 'button' }, on: { click: () => actions.retry() } },
                icon('reset'),
                h('span', { text: tr('Tentar de novo') }),
              ),
            ),
        !loading
          ? h(
              'div',
              { class: 'rp-connect__help' },
              h('p', { class: 'rp-small', text: tr('No servidor do Habblaud, configure o pipeline e reinicie:') }),
              h('pre', { class: 'rp-connect__code', text: 'HABBLAUD_ROADMAP_TOKEN=... npm run dev' }),
              h('p', {
                class: 'rp-small rp-muted',
                text: tr('HABBLAUD_ROADMAP_URL aponta para o Hermes Pipeline (padrão http://127.0.0.1:49500). O roadmap só abre pelo próprio computador.'),
              }),
            )
          : null,
      ),
    ),
  );
}

export function start(): void {
  const root = document.getElementById('rp-app');
  if (!root) return;

  const state = createInitialState();
  let toastSeq = 0;
  let lastTriggerId = 'rp-open-conversation';
  let lastRoadmapTriggerId = 'rp-open-roadmaps';
  let messageToken = 0;
  let sessionStream: Subscription | null = null;
  let sessionStreamId: string | null = null;
  let roadmapStream: Subscription | null = null;
  let roadmapStreamId: string | null = null;
  let loadingData = false;
  let reloadQueued = false;
  /** IDs enviados nesta página; recibos antigos do SSE não geram toast. */
  const sentMessageIds = new Set<string>();

  const selectedRoadmap = (): Roadmap | undefined => roadmapById(state.selectedRoadmapId) ?? ROADMAPS[0];

  const setRoadmapStream = (status: StreamStatus): void => {
    if (state.roadmapStream === status) return;
    state.roadmapStream = status;
    if (state.ready) render();
  };

  const setConversationConnection = (status: StreamStatus): void => {
    if (state.conversation.connection === status) return;
    state.conversation.connection = status;
    if (state.conversation.open) render();
  };

  const render = (): void => {
    const focus = captureFocus();
    if (!state.ready) {
      root.replaceChildren(renderBoot(state, actions));
      restoreFocus(focus);
      return;
    }
    const children: (HTMLElement | null)[] = [renderTopbar(state, actions), renderPage(state, actions)];
    if (state.conversation.open) {
      children.push(renderChatBackdrop(actions), renderConversation(state, actions));
    }
    if (state.roadmapIndexOpen) children.push(renderRoadmapIndex(state, actions));
    if (state.toast) children.push(renderToast(state.toast));
    root.replaceChildren(...children.filter((child): child is HTMLElement => child !== null));
    restoreFocus(focus);
    window.requestAnimationFrame(() => {
      if (!state.conversation.open) return;
      const history = document.getElementById('rp-chat-history');
      if (history) history.scrollTop = history.scrollHeight;
    });
  };

  const connectRoadmapStream = (): void => {
    const id = state.selectedRoadmapId;
    if (!id) return;
    if (roadmapStream && roadmapStreamId === id) return;
    roadmapStream?.close();
    roadmapStreamId = id;
    roadmapStream = subscribeRoadmap(id, {
      onEvent: (event) => {
        if (event.roadmapId !== state.selectedRoadmapId) return;
        if (state.source && event.revision <= state.source.revision) return;
        void reloadData(false);
      },
      onStatus: (status) => {
        if (status === 'closed') return;
        setRoadmapStream(status);
      },
    });
  };

  const connectSessionStream = (): void => {
    const id = state.conversation.sessionId;
    if (!id) {
      sessionStream?.close();
      sessionStream = null;
      sessionStreamId = null;
      setConversationConnection('closed');
      return;
    }
    if (sessionStream && sessionStreamId === id) return;
    sessionStream?.close();
    sessionStreamId = id;
    sessionStream = subscribeSession(id, {
      onMessage: (message) => {
        if (state.conversation.sessionId !== id) return;
        if (message.role === 'user') {
          state.conversation.typing = true;
        } else {
          state.conversation.typing = false;
        }
        void refreshMessages({ quiet: true });
      },
      onAction: (action) => {
        if (state.conversation.sessionId !== id) return;
        // O SSE repete o histórico ao conectar. Só a mensagem mais nova, ligada a um
        // messageId enviado por esta página, vira toast/recarga em `refreshMessages`.
        if (action.status === 'started') {
          state.conversation.typing = true;
          render();
        }
        void refreshMessages({ quiet: true });
      },
      onError: (error) => {
        if (state.conversation.sessionId !== id) return;
        actions.showToast(tr('Erro do agente: {0}', [error.message]), 'error');
        state.conversation.typing = false;
        render();
      },
      onStatus: (status) => {
        if (status === 'closed') return;
        setConversationConnection(status);
      },
    });
  };

  const handleAction = (action: ApiActionReceipt): void => {
    if (action.status === 'applied') {
      actions.showToast(tr('Ação aplicada: {0}', [action.summary || action.action]), 'ok');
      void reloadData(false);
      return;
    }
    if (action.status === 'rejected') {
      actions.showToast(tr('Ação recusada: {0}', [action.error?.message ?? (action.summary || action.action)]), 'error');
      return;
    }
    state.conversation.typing = true;
    render();
  };

  const chooseSession = (roadmap: Roadmap): string | null => defaultSessionForRoadmap(roadmap.id)?.id ?? null;

  const ensureSession = (): void => {
    const roadmap = selectedRoadmap();
    if (!roadmap) return;
    const current = sessionById(state.conversation.sessionId);
    if (!current || !current.roadmapIds.includes(roadmap.id)) {
      state.conversation.sessionId = chooseSession(roadmap);
    }
    if (state.conversation.open) connectSessionStream();
  };

  const refreshMessages = async (opts: { quiet?: boolean } = {}): Promise<void> => {
    const sessionId = state.conversation.sessionId;
    if (!sessionId) {
      state.conversation.messages = [];
      state.conversation.loading = false;
      render();
      return;
    }
    const token = ++messageToken;
    const session = sessionById(sessionId);
    if (!opts.quiet) {
      state.conversation.loading = true;
      render();
    }
    try {
      const { messages } = await listMessages(sessionId, 100);
      if (token !== messageToken || state.conversation.sessionId !== sessionId) return;
      const mapped = mapMessages(messages, session);
      state.conversation.messages = mapped;
      state.conversation.loading = false;
      state.conversation.typing = messages.some(
        (message) =>
          message.role === 'user' &&
          (message.status === 'queued' || message.status === 'processing') &&
          !messages.some((reply) => reply.role === 'agent' && reply.replyTo === message.messageId),
      );
      const fresh = mapped.filter((message) => message.role === 'agent' && message.replyTo && sentMessageIds.has(message.replyTo));
      for (const reply of fresh) {
        sentMessageIds.delete(reply.replyTo!);
        for (const action of reply.actions ?? []) handleAction(action);
      }
      render();
    } catch (error) {
      if (token !== messageToken) return;
      state.conversation.loading = false;
      state.conversation.typing = false;
      actions.showToast(tr('Não foi possível ler a conversa: {0}', [describeError(error)]), 'error');
      render();
    }
  };

  const reloadData = async (initial: boolean): Promise<void> => {
    if (loadingData) {
      reloadQueued = true;
      return;
    }
    loadingData = true;
    if (initial || !state.ready) {
      state.loading = true;
      state.loadError = null;
      render();
    }
    try {
      const data = await loadLiveData();
      hydrateLive(data.snapshots, data.sessions);
      const current = selectedRoadmap();
      if (!current) throw new Error(tr('O pipeline não devolveu nenhum roadmap.'));
      if (!state.selectedRoadmapId || !roadmapById(state.selectedRoadmapId)) {
        state.selectedRoadmapId = current.id;
        state.expandedPhases = new Set([current.currentPhaseId]);
        state.selectedPlanId = defaultPlanFor(current).id;
      }
      const roadmap = selectedRoadmap()!;
      if (!planById(roadmap.id, state.selectedPlanId)) state.selectedPlanId = defaultPlanFor(roadmap).id;
      state.expandedPhases.add(roadmap.currentPhaseId);
      state.source = sourceFor(roadmap);
      state.ready = true;
      state.loading = false;
      state.loadError = null;
      ensureSession();
      connectRoadmapStream();
      if (state.conversation.open) {
        connectSessionStream();
        void refreshMessages({ quiet: true });
      }
      render();
    } catch (error) {
      const detail = describeError(error);
      state.loading = false;
      if (!state.ready) {
        state.loadError = detail;
      } else {
        actions.showToast(tr('O pipeline não atualizou o roadmap: {0}', [detail]), 'error');
      }
      render();
    } finally {
      loadingData = false;
      if (reloadQueued) {
        reloadQueued = false;
        void reloadData(false);
      }
    }
  };

  const ensureRoadmap = (id: string): Roadmap | undefined => {
    const roadmap = roadmapById(id) ?? selectedRoadmap();
    if (!roadmap) return undefined;
    if (state.selectedRoadmapId === roadmap.id) return roadmap;
    state.selectedRoadmapId = roadmap.id;
    state.selectedPlanId = defaultPlanFor(roadmap).id;
    state.expandedPhases = new Set([roadmap.currentPhaseId]);
    state.filter = 'all';
    state.backlogType = 'all';
    state.search = '';
    state.detailOpen = false;
    state.roadmapMenuOpen = false;
    state.roadmapIndexOpen = false;
    state.source = sourceFor(roadmap);
    if (state.conversation.open) state.conversation.context = { roadmapId: roadmap.id, kind: 'roadmap' };
    connectRoadmapStream();
    return roadmap;
  };

  const expandMatchingPhases = (): void => {
    const roadmap = selectedRoadmap();
    if (!roadmap) return;
    const query = state.search.trim();
    if (state.filter === 'all' && !query) {
      state.expandedPhases.add(roadmap.currentPhaseId);
      return;
    }
    const next = new Set<string>();
    for (const phase of roadmap.phases) {
      const searchMatchesPhase = query.length > 0 && normalizeSearch([phase.name, phase.objective].join(' ')).includes(normalizeSearch(query));
      const plans = phase.plans.filter((plan) => {
        if (state.filter !== 'all' && plan.status !== state.filter) return false;
        if (query.length > 0 && !searchMatchesPhase && !planMatches(plan, query)) return false;
        return true;
      });
      if (plans.length > 0) next.add(phase.id);
    }
    next.add(roadmap.currentPhaseId);
    state.expandedPhases = next;
  };

  const focusConversationTarget = (): void => {
    window.requestAnimationFrame(() => {
      const target = state.conversation.sessionId ? document.getElementById('rp-composer-input') : document.getElementById('rp-session-btn');
      target?.focus({ preventScroll: true });
    });
  };

  const contextFor = (context: ConversationContext): ConversationContext | null => {
    const roadmap = ensureRoadmap(context.roadmapId);
    if (!roadmap) return null;
    if (context.kind === 'roadmap') return { roadmapId: roadmap.id, kind: 'roadmap' };
    if (context.kind === 'phase') {
      const phase = phaseById(roadmap.id, context.id ?? '');
      return { roadmapId: roadmap.id, kind: 'phase', ...(phase ? { id: phase.id } : context.id ? { id: context.id } : {}) };
    }
    const plan = planById(roadmap.id, context.id ?? '');
    return { roadmapId: roadmap.id, kind: 'plan', ...(plan ? { id: plan.apiId } : context.id ? { id: context.id } : {}) };
  };

  const actions: AppActions = {
    retry() {
      void reloadData(true);
    },

    setVariant(variant) {
      state.variant = variant;
      state.detailOpen = false;
      state.roadmapMenuOpen = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    togglePhase(id) {
      if (state.expandedPhases.has(id)) state.expandedPhases.delete(id);
      else state.expandedPhases.add(id);
      render();
    },

    openPhase(id, planId, roadmapId) {
      const roadmap = ensureRoadmap(roadmapId ?? state.selectedRoadmapId);
      if (!roadmap) return;
      state.variant = 'phases';
      const phase = phaseById(roadmap.id, id);
      if (phase) state.expandedPhases.add(phase.id);
      const targetPlanId =
        planId ??
        phase?.plans.find((p) => p.status === 'active')?.id ??
        phase?.plans.find((p) => p.status === 'blocked')?.id ??
        phase?.plans[0]?.id;
      if (targetPlanId) state.selectedPlanId = targetPlanId;
      state.detailOpen = Boolean(planId);
      state.roadmapMenuOpen = false;
      state.roadmapIndexOpen = false;
      render();
      window.requestAnimationFrame(() => {
        document.getElementById(`rp-phase-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    },

    openPlan(id, roadmapId) {
      const first = ensureRoadmap(roadmapId ?? state.selectedRoadmapId);
      if (!first) return;
      const plan = planById(first.id, id);
      if (!plan) return;
      if (state.variant !== 'backlog') state.variant = 'phases';
      state.selectedPlanId = plan.id;
      state.expandedPhases.add(plan.phaseId);
      state.detailOpen = true;
      state.roadmapMenuOpen = false;
      state.roadmapIndexOpen = false;
      render();
      window.requestAnimationFrame(() => {
        const detail = document.getElementById('rp-detail');
        if (detail) detail.scrollTop = 0;
      });
    },

    closeDetail() {
      state.detailOpen = false;
      render();
      window.requestAnimationFrame(() => document.getElementById(`rp-plan-${state.selectedPlanId}`)?.focus());
    },

    setFilter(filter) {
      state.filter = filter;
      expandMatchingPhases();
      render();
    },

    setBacklogType(type) {
      state.backlogType = type;
      render();
    },

    setSearch(query) {
      state.search = query;
      expandMatchingPhases();
      render();
    },

    openRoadmapIndex() {
      const trigger = document.activeElement;
      if (trigger instanceof HTMLElement && trigger.id) lastRoadmapTriggerId = trigger.id;
      state.roadmapIndexOpen = true;
      state.roadmapMenuOpen = false;
      state.conversation.sessionMenuOpen = false;
      render();
      window.requestAnimationFrame(() => document.getElementById('rp-roadmap-index-close')?.focus());
    },

    closeRoadmapIndex() {
      state.roadmapIndexOpen = false;
      render();
      window.requestAnimationFrame(() => document.getElementById(lastRoadmapTriggerId)?.focus({ preventScroll: true }));
    },

    toggleRoadmapMenu() {
      state.roadmapMenuOpen = !state.roadmapMenuOpen;
      state.roadmapIndexOpen = false;
      render();
    },

    closeRoadmapMenu() {
      if (!state.roadmapMenuOpen) return;
      state.roadmapMenuOpen = false;
      render();
    },

    selectRoadmap(id) {
      const roadmap = ensureRoadmap(id);
      if (!roadmap) return;
      state.selectedPlanId = defaultPlanFor(roadmap).id;
      state.detailOpen = false;
      state.roadmapIndexOpen = false;
      state.roadmapMenuOpen = false;
      if (state.conversation.open) {
        state.conversation.context = { roadmapId: roadmap.id, kind: 'roadmap' };
        ensureSession();
        void refreshMessages({ quiet: true });
      }
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    openConversation(context, opts) {
      const trigger = document.activeElement;
      if (trigger instanceof HTMLElement && trigger.id) lastTriggerId = trigger.id;
      const resolved = contextFor(context);
      if (!resolved) return;
      const roadmap = selectedRoadmap();
      if (!roadmap) return;
      if (resolved.kind === 'plan' && resolved.id) {
        const plan = planById(roadmap.id, resolved.id);
        if (plan) {
          state.selectedPlanId = plan.id;
          state.expandedPhases.add(plan.phaseId);
        }
      }
      const candidate = opts?.sessionId !== undefined ? opts.sessionId : state.conversation.sessionId;
      const candidateSession = candidate ? sessionById(candidate) : undefined;
      const nextSession = candidateSession?.roadmapIds.includes(roadmap.id) ? candidate : chooseSession(roadmap);
      state.conversation = {
        ...state.conversation,
        open: true,
        context: resolved,
        sessionId: nextSession,
        messages: [],
        loading: Boolean(nextSession),
        typing: false,
        sessionMenuOpen: false,
        draftText: '',
        replyToken: state.conversation.replyToken + 1,
        connection: nextSession ? 'connecting' : 'closed',
      };
      state.roadmapIndexOpen = false;
      state.roadmapMenuOpen = false;
      connectSessionStream();
      render();
      focusConversationTarget();
      if (nextSession) void refreshMessages();
      if (opts?.question) {
        const question = opts.question;
        window.setTimeout(() => {
          if (state.conversation.open) actions.send(question);
        }, 90);
      }
    },

    closeConversation() {
      state.conversation.open = false;
      state.conversation.sessionMenuOpen = false;
      state.conversation.typing = false;
      state.conversation.replyToken += 1;
      sessionStream?.close();
      sessionStream = null;
      sessionStreamId = null;
      state.conversation.connection = 'closed';
      render();
      window.requestAnimationFrame(() => document.getElementById(lastTriggerId)?.focus({ preventScroll: true }));
    },

    setConversationContext(context) {
      const resolved = contextFor(context);
      if (!resolved) return;
      const roadmap = selectedRoadmap();
      if (resolved.kind === 'plan' && resolved.id && roadmap) {
        const plan = planById(roadmap.id, resolved.id);
        if (plan) {
          state.selectedPlanId = plan.id;
          state.expandedPhases.add(plan.phaseId);
        }
      }
      state.conversation.context = resolved;
      state.conversation.sessionMenuOpen = false;
      render();
      focusConversationTarget();
    },

    toggleSessionMenu() {
      state.conversation.sessionMenuOpen = !state.conversation.sessionMenuOpen;
      render();
    },

    chooseSession(sessionId) {
      messageToken += 1;
      state.conversation.sessionId = sessionId;
      state.conversation.sessionMenuOpen = false;
      state.conversation.messages = [];
      state.conversation.loading = Boolean(sessionId);
      state.conversation.typing = false;
      state.conversation.draftText = '';
      state.conversation.replyToken += 1;
      state.conversation.connection = sessionId ? 'connecting' : 'closed';
      connectSessionStream();
      render();
      focusConversationTarget();
      if (sessionId) void refreshMessages();
    },

    setChatDraft(text) {
      state.conversation.draftText = text;
    },

    ask(question) {
      actions.send(question);
    },

    send(text) {
      const value = text.trim();
      if (!value) return;
      const session = sessionById(state.conversation.sessionId);
      if (!session) {
        actions.showToast(tr('Escolha uma sessão do pipeline para conversar.'), 'error');
        return;
      }
      const context = state.conversation.context;
      const plan = context.kind === 'plan' && context.id ? planById(context.roadmapId, context.id) : undefined;
      const messageId = uuid();
      sentMessageIds.add(messageId);
      const token = ++state.conversation.replyToken;
      state.conversation.draftText = '';
      state.conversation.typing = true;
      render();
      void postMessage(session.id, {
        messageId,
        text: value,
        context: {
          roadmapId: context.roadmapId,
          ...(plan ? { itemId: plan.apiId } : {}),
        },
      })
        .then(() => {
          if (state.conversation.replyToken !== token) return;
          void refreshMessages({ quiet: true });
        })
        .catch((error: unknown) => {
          if (state.conversation.replyToken !== token) return;
          sentMessageIds.delete(messageId);
          state.conversation.typing = false;
          actions.showToast(tr('O agente não recebeu a mensagem: {0}', [describeError(error)]), 'error');
          render();
        });
    },

    refreshConversation() {
      void refreshMessages();
    },

    showToast(text, tone = 'info') {
      toastSeq += 1;
      const id = toastSeq;
      state.toast = { id, text, tone };
      render();
      window.setTimeout(() => {
        if (state.toast?.id !== id) return;
        state.toast = null;
        render();
      }, 4200);
    },

    jumpToCurrent() {
      const roadmap = selectedRoadmap();
      if (!roadmap) return;
      const plan = defaultPlanFor(roadmap);
      state.variant = 'phases';
      state.selectedPlanId = plan.id;
      state.expandedPhases.add(roadmap.currentPhaseId);
      state.detailOpen = true;
      state.roadmapMenuOpen = false;
      state.roadmapIndexOpen = false;
      render();
      window.requestAnimationFrame(() => {
        document.getElementById(`rp-plan-${plan.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const detail = document.getElementById('rp-detail');
        if (detail) detail.scrollTop = 0;
      });
    },
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.roadmapIndexOpen) {
      actions.closeRoadmapIndex();
      return;
    }
    if (state.roadmapMenuOpen) {
      actions.closeRoadmapMenu();
      return;
    }
    if (state.conversation.sessionMenuOpen) {
      state.conversation.sessionMenuOpen = false;
      render();
      return;
    }
    if (state.conversation.open) {
      actions.closeConversation();
      return;
    }
    if (state.detailOpen) actions.closeDetail();
  });

  const desktop = window.matchMedia('(min-width: 961px)');
  desktop.addEventListener('change', (event) => {
    if (event.matches && state.detailOpen) {
      state.detailOpen = false;
      render();
    }
  });

  render();
  void reloadData(true);
}
