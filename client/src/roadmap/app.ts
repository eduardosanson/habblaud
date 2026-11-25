// Estado e interações do roadmap. O Habblaud carrega o snapshot do Hermes Pipeline,
// acompanha `roadmap.changed` e conversa com o agente da sessão. Não existe rascunho,
// criação, edição, estimativa local nem publicação: a escrita é do agente no pipeline.
import { tr } from '../../../shared/i18n';
import {
  ROADMAPS,
  defaultPlanFor,
  normalizeSearch,
  phaseById,
  planById,
  planMatches,
  roadmapById,
  type ConversationContext,
  type Roadmap,
} from './data';
import { awaitDelivery, parseTerminalEvent, repliesTo } from './bridge';
import { renderChatBackdrop, renderConversation } from './conversation';
import { loadConversation, saveConversation } from './conversation-store';
import { formatDateTime, hydrateLive, loadLiveData, sourceFor } from './live';
import { getDelivery, listSessionOptions, PipelineError, postConverse, postReopen, subscribeRoadmap, type Subscription, postReview } from './pipeline';
import { canSend, initialChoice, reopenTarget, sameSession, type SessionChoice } from './session-picker';
import type { AppActions, AppState, ChatMessage, SessionPickerState, StreamStatus, ToastState } from './state';
import type { TerminalEntry } from '../../../shared/types';
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
      messages: [],
      typing: false,
      target: null,
      draftText: '',
      replyToken: 0,
      connection: 'closed',
      sessions: emptySessions(),
    },
    toast: null,
    review: { notes: {}, sending: null },
    source: null,
    roadmapStream: 'closed',
  };
}

/** Reabertura: intervalo entre as releituras e quantas antes de desistir (~40 s). */
const REOPEN_POLL_MS = 2_000;
const REOPEN_TRIES = 20;

function emptySessions(): SessionPickerState {
  return { status: 'idle', options: null, error: null, choice: null, forItemId: null, reopening: false };
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
  /** Stream da conversa do agente que recebeu a pergunta (terminal do Habblaud). */
  let bridgeSource: EventSource | null = null;
  let roadmapStream: Subscription | null = null;
  let roadmapStreamId: string | null = null;
  let loadingData = false;
  let reloadQueued = false;

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

  /** Item cuja conversa está carregada; trocar de item carrega o histórico dele, o resto só grava. */
  let historyKey: string | null = null;
  const syncHistory = (): void => {
    const { open, context, messages } = state.conversation;
    if (!open || context.kind !== 'plan' || !context.id) return;
    // Pelo id canônico do item: a chave exibida (o contexto) pode repetir ou mudar.
    const plan = planById(context.roadmapId, context.id);
    if (!plan) return;
    const key = `${context.roadmapId}:${plan.apiId}`;
    let store: Storage | undefined;
    try {
      store = window.sessionStorage;
    } catch {
      store = undefined;
    }
    if (key === historyKey) saveConversation(store, key, messages);
    else {
      historyKey = key;
      state.conversation.messages = loadConversation(store, key);
    }
  };

  const render = (): void => {
    syncHistory();
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

  const closeBridge = (): void => {
    bridgeSource?.close();
    bridgeSource = null;
    setConversationConnection('closed');
  };

  /**
   * Acompanha a conversa do agente que recebeu a pergunta e mostra o que ele responde depois dela. A conversa vem do
   * terminal do próprio Habblaud (/api/agents/:id/terminal); se ele estiver desligado, a pergunta já foi entregue e a
   * resposta fica na sessão do agente.
   */
  const followAgent = (agentId: string, question: string, sentAt: number, token: number, author: ChatMessage['author']): void => {
    closeBridge();
    let source: EventSource;
    try {
      source = new EventSource(`/api/agents/${encodeURIComponent(agentId)}/terminal`);
    } catch {
      return;
    }
    bridgeSource = source;
    setConversationConnection('connecting');
    let entries: TerminalEntry[] = [];
    const apply = (): void => {
      if (state.conversation.replyToken !== token) return;
      const { replies } = repliesTo(entries, { question, sentAt });
      const known = new Set(state.conversation.messages.map((message) => message.id));
      let added = false;
      for (const reply of replies) {
        const id = `reply-${token}-${reply.id}`;
        if (known.has(id)) continue;
        state.conversation.messages.push({ id, role: 'agent', ...(author ? { author } : {}), text: reply.text, at: formatDateTime(new Date(reply.at).toISOString()) });
        added = true;
      }
      if (added) state.conversation.typing = false;
      if (added) render();
    };
    source.addEventListener('open', () => {
      if (bridgeSource === source) setConversationConnection('live');
    });
    source.addEventListener('init', (event) => {
      if (bridgeSource !== source) return;
      entries = parseTerminalEvent((event as MessageEvent).data, 'init');
      apply();
    });
    source.addEventListener('append', (event) => {
      if (bridgeSource !== source) return;
      entries = entries.concat(parseTerminalEvent((event as MessageEvent).data, 'append'));
      apply();
    });
    source.addEventListener('error', () => {
      if (bridgeSource !== source) return;
      if (source.readyState === 2) {
        // O servidor recusou (terminal desligado, agente saiu) ou o navegador desistiu.
        source.close();
        bridgeSource = null;
        setConversationConnection('closed');
        if (state.conversation.replyToken === token && state.conversation.typing) {
          state.conversation.typing = false;
          actions.showToast(tr('Não foi possível acompanhar a resposta do agente. A pergunta foi entregue: veja a resposta na sessão dele.'), 'error');
          render();
        }
      } else {
        setConversationConnection('reconnecting');
      }
    });
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
      hydrateLive(data.snapshots, data.sessions, data.executions);
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
      connectRoadmapStream();
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
      document.getElementById('rp-composer-input')?.focus({ preventScroll: true });
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

  const resetConversation = (): void => {
    closeBridge();
    historyKey = null;
    state.conversation.messages = [];
    state.conversation.typing = false;
    state.conversation.target = null;
    state.conversation.draftText = '';
    state.conversation.replyToken += 1;
    sessionsToken += 1;
    state.conversation.sessions = emptySessions();
  };

  /** Carrega a lista de sessões do plano em foco; fora de um plano, esvazia. A escolha anterior só sobrevive no mesmo item. */
  let sessionsToken = 0;
  const refreshSessions = (): void => {
    const context = state.conversation.context;
    const plan = context.kind === 'plan' && context.id ? planById(context.roadmapId, context.id) : undefined;
    const picker = state.conversation.sessions;
    const token = ++sessionsToken;
    if (!plan) {
      state.conversation.sessions = emptySessions();
      return;
    }
    if (picker.forItemId !== plan.apiId) picker.choice = null;
    picker.status = 'loading';
    picker.error = null;
    picker.reopening = false;
    picker.forItemId = plan.apiId;
    void listSessionOptions(context.roadmapId, plan.apiId)
      .then((options) => {
        if (token !== sessionsToken) return;
        picker.options = options;
        picker.status = 'ready';
        const chosen = picker.choice;
        if (chosen && !options.options.some((option) => sameSession(option, chosen))) picker.choice = null;
        render();
      })
      .catch((error: unknown) => {
        if (token !== sessionsToken) return;
        picker.status = 'error';
        picker.error = describeError(error);
        render();
      });
  };

  /** Depois de reabrir, relê a lista até a sessão aparecer viva (o plugin de mensagens leva alguns segundos). */
  const awaitReopened = (roadmapId: string, itemId: string, choice: SessionChoice, token: number, tries: number): void => {
    const picker = state.conversation.sessions;
    const finish = (text: string, tone: ToastState['tone']): void => {
      picker.reopening = false;
      actions.showToast(text, tone);
    };
    window.setTimeout(() => {
      if (token !== sessionsToken) return;
      void listSessionOptions(roadmapId, itemId)
        .catch(() => null)
        .then((options) => {
          if (token !== sessionsToken) return;
          if (options) picker.options = options;
          if (options?.options.some((option) => option.live && sameSession(option, choice))) {
            finish(tr('Sessão reaberta. Já pode perguntar.'), 'ok');
          } else if (tries > 1) {
            awaitReopened(roadmapId, itemId, choice, token, tries - 1);
          } else {
            finish(tr('A sessão abriu, mas ainda não recebe mensagens. Veja o terminal dela no escritório.'), 'error');
          }
        });
    }, REOPEN_POLL_MS);
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
        phase?.plans.find((p) => p.status === 'review')?.id ??
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
        // Outro roadmap, outra conversa: a pergunta de um não segue para o outro.
        state.conversation.context = { roadmapId: roadmap.id, kind: 'roadmap' };
        resetConversation();
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
      state.conversation.open = true;
      state.conversation.context = resolved;
      resetConversation();
      refreshSessions();
      state.roadmapIndexOpen = false;
      state.roadmapMenuOpen = false;
      render();
      focusConversationTarget();
      if (opts?.question) {
        const question = opts.question;
        window.setTimeout(() => {
          if (state.conversation.open) actions.send(question);
        }, 90);
      }
    },

    closeConversation() {
      state.conversation.open = false;
      state.conversation.typing = false;
      state.conversation.replyToken += 1;
      closeBridge();
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
      refreshSessions();
      render();
      focusConversationTarget();
    },

    loadSessions() {
      refreshSessions();
      render();
    },

    chooseSession(choice) {
      state.conversation.sessions.choice = choice;
      render();
    },

    reopenSession() {
      const context = state.conversation.context;
      const plan = context.kind === 'plan' && context.id ? planById(context.roadmapId, context.id) : undefined;
      const picker = state.conversation.sessions;
      if (!plan || !picker.options || picker.reopening) return;
      const choice = reopenTarget(picker.options, picker.choice ?? initialChoice(picker.options));
      if (!choice) return;
      picker.choice = choice;
      picker.reopening = true;
      const token = ++sessionsToken;
      render();
      void postReopen({ roadmapId: context.roadmapId, itemId: plan.apiId, session: choice })
        .then(() => awaitReopened(context.roadmapId, plan.apiId, choice, token, REOPEN_TRIES))
        .catch((error: unknown) => {
          if (token !== sessionsToken) return;
          picker.reopening = false;
          actions.showToast(tr('Não foi possível reabrir a sessão: {0}', [describeError(error)]), 'error');
          render();
        });
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
      const context = state.conversation.context;
      const plan = context.kind === 'plan' && context.id ? planById(context.roadmapId, context.id) : undefined;
      if (!plan) {
        actions.showToast(tr('Escolha um plano: a pergunta vai para o agente que trabalhou nele.'), 'error');
        return;
      }
      // Com a lista pronta, só vai para uma sessão viva da lista (a escolhida ou a sugerida). Enquanto ela carrega, ou se
      // falhou, o servidor decide pela sugerida: a pergunta de um atalho não se perde por causa disso.
      const picker = state.conversation.sessions;
      let session: SessionChoice | undefined;
      if (picker.status === 'ready' && picker.options) {
        const choice = picker.choice ?? initialChoice(picker.options);
        const verdict = canSend(picker.options, choice);
        if (!verdict.ok) {
          actions.showToast(verdict.reason, 'error');
          return;
        }
        session = choice ?? undefined;
      }
      const token = ++state.conversation.replyToken;
      closeBridge();
      const message: ChatMessage = { id: `user-${token}-${uuid()}`, role: 'user', text: value, at: formatDateTime(new Date().toISOString()) };
      state.conversation.messages.push(message);
      state.conversation.draftText = '';
      state.conversation.typing = true;
      render();
      void postConverse({ roadmapId: context.roadmapId, itemId: plan.apiId, text: value, ...(session ? { session } : {}) })
        .then((accepted) => {
          if (state.conversation.replyToken !== token) return;
          const route = accepted.route;
          state.conversation.target = { agentId: accepted.agentId, provider: route.provider, ...(route.profile ? { profile: route.profile } : {}), ...(route.role ? { role: route.role } : {}), resumable: route.resumable };
          followAgent(accepted.agentId, value, accepted.sentAt, token, { name: route.profile ?? route.provider, provider: route.provider });
          render();
          const current = (): boolean => state.conversation.replyToken === token;
          void awaitDelivery(() => getDelivery(accepted.messageId), () => new Promise((resolve) => window.setTimeout(resolve, 2_000)), current).then((outcome) => {
            if (!outcome || outcome.ok || !current()) return;
            // Aceita pela fila mas sem confirmação: diz na conversa (o aviso passageiro some) e devolve o texto. A
            // conversa da sessão segue acompanhada: uma entrega atrasada ainda traz a resposta.
            state.conversation.typing = false;
            state.conversation.draftText = value;
            state.conversation.messages.push({
              id: `failed-${token}`,
              role: 'agent',
              author: { name: 'Habblaud', provider: route.provider },
              text: tr('A pergunta não foi entregue: {0}. O que o agente fez está em “O que foi entregue”, neste item; para conversar, reabra a sessão.', [outcome.reason ?? tr('sem motivo informado')]),
              at: formatDateTime(new Date().toISOString()),
            });
            render();
          });
        })
        .catch((error: unknown) => {
          if (state.conversation.replyToken !== token) return;
          // Não foi entregue: some da conversa e volta para o campo, para a pessoa tentar de novo.
          state.conversation.messages = state.conversation.messages.filter((item) => item.id !== message.id);
          state.conversation.draftText = value;
          state.conversation.typing = false;
          actions.showToast(tr('O agente não recebeu a mensagem: {0}', [describeError(error)]), 'error');
          render();
        });
    },

    setReviewNote(itemId, note) {
      // sem render: redesenhar a cada tecla tiraria o foco do campo
      state.review.notes[itemId] = note;
    },

    decideReview(planId, decision) {
      const roadmap = selectedRoadmap();
      const plan = roadmap ? planById(roadmap.id, planId) : undefined;
      if (!roadmap || !plan || state.review.sending) return;
      const note = (state.review.notes[plan.apiId] ?? '').trim();
      if (decision === 'return' && !note) {
        actions.showToast(tr('Para devolver, escreva o que precisa mudar.'), 'error');
        return;
      }
      state.review.sending = plan.apiId;
      render();
      void postReview({ roadmapId: roadmap.id, itemId: plan.apiId, decision, note, expectedRevision: roadmap.revision, actionId: uuid() })
        .then(() => {
          delete state.review.notes[plan.apiId];
          actions.showToast(decision === 'approve' ? tr('{0} aprovado.', [plan.id]) : tr('{0} devolvido.', [plan.id]), 'ok');
        })
        .catch((error: unknown) => {
          actions.showToast(tr('A decisão não foi registrada: {0}', [describeError(error)]), 'error');
        })
        .finally(() => {
          state.review.sending = null;
          // aprovado, devolvido ou desatualizado: a tela relê o roadmap
          void reloadData(false);
          render();
        });
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
