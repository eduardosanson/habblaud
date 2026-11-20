// Gaveta de conversa do roadmap. O histórico e as respostas vêm do agente do Hermes
// Pipeline; a UI só mostra mensagens, recibos de ação e o contexto enviado. Nenhuma
// mutação é feita aqui — o agente chama as ferramentas e o snapshot é recarregado.
import { tr } from '../../../shared/i18n';
import {
  AGENTS,
  ROADMAPS,
  SESSIONS,
  agentById,
  contextLabel,
  contextTitle,
  defaultPlanFor,
  defaultSessionForRoadmap,
  phaseById,
  planById,
  roadmapById,
  sessionById,
  type ConversationContext,
  type Plan,
  type PlanRef,
} from './data';
import { suggestedQuestions } from './conversation-data';
import type { ActionReceipt, AppActions, AppState, ChatMessage } from './state';
import { accountChip, avatar, emptyState, h, icon, planProgressText, planStatusPill, providerTag } from './ui';

function openPlanFromChat(actions: AppActions, plan: Plan): void {
  actions.closeConversation();
  actions.openPlan(plan.id, plan.roadmapId);
}

function planRefCard(ref: PlanRef, actions: AppActions): HTMLElement | null {
  const plan = planById(ref.roadmapId, ref.planId);
  if (!plan) return null;
  return h(
    'button',
    {
      class: `rp-planref is-${plan.status}`,
      attrs: { type: 'button' },
      on: { click: () => openPlanFromChat(actions, plan) },
    },
    h(
      'span',
      { class: 'rp-planref__top' },
      planStatusPill(plan),
      h('span', { class: 'rp-small rp-muted', text: planProgressText(plan) }),
    ),
    h('strong', { class: 'rp-planref__title', text: `${plan.id} ${plan.title}` }),
    h(
      'span',
      { class: 'rp-planref__action' },
      h('span', { text: tr('Abrir plano') }),
      icon('arrowRight'),
    ),
  );
}

function receipts(actions: ActionReceipt[] | undefined): HTMLElement | null {
  if (!actions?.length) return null;
  const list = h('div', { class: 'rp-receipts', attrs: { 'aria-label': tr('Recibos de ação do pipeline') } });
  for (const action of actions) {
    const rejected = action.status === 'rejected';
    list.append(
      h(
        'div',
        { class: `rp-receipt is-${action.status}` },
        icon(rejected ? 'warning' : action.status === 'applied' ? 'check' : 'clock'),
        h(
          'span',
          { class: 'rp-receipt__text' },
          h('strong', { text: action.summary || action.action }),
          h('span', {
            class: 'rp-receipt__meta',
            text: rejected
              ? action.error?.message ?? tr('ação recusada')
              : tr('revisão {0} · {1}', [action.revision, action.status]),
          }),
        ),
      ),
    );
  }
  return list;
}

function messageEl(message: ChatMessage, actions: AppActions): HTMLElement {
  if (message.role === 'user') {
    return h(
      'div',
      { class: 'rp-msg rp-msg--user' },
      h('span', { class: 'rp-msg__meta', text: tr('Você · {0}', [message.at]) }),
      h('div', { class: 'rp-bubble' }, h('span', { text: message.text })),
      receipts(message.actions),
    );
  }
  const agent = message.agentId ? AGENTS[message.agentId] : undefined;
  return h(
    'div',
    { class: 'rp-msg rp-msg--agent' },
    agent ? avatar(agent, 'xs') : h('span', { class: 'rp-msg__fallback', text: '·' }),
    h(
      'div',
      { class: 'rp-msg__body' },
      h(
        'span',
        { class: 'rp-msg__meta' },
        agent ? h('strong', { text: agent.name }) : null,
        agent ? providerTag(agent.provider, true) : null,
        h('span', { class: 'rp-muted', text: message.at }),
      ),
      h('div', { class: 'rp-bubble' }, h('span', { text: message.text })),
      message.planRef ? planRefCard(message.planRef, actions) : null,
      receipts(message.actions),
    ),
  );
}

function sessionMenu(state: AppState, actions: AppActions): HTMLElement {
  const current = state.conversation.sessionId;
  const roadmap = roadmapById(state.selectedRoadmapId);
  const linked = roadmap ? SESSIONS.filter((session) => session.roadmapIds.includes(roadmap.id)) : [];
  const options = linked.map((session) => {
    const agent = AGENTS[session.agentId];
    const active = current === session.id;
    const canWrite = session.capabilities.includes('roadmap.write');
    return h(
      'button',
      {
        class: `rp-session-option${active ? ' is-active' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': String(active) },
        on: { click: () => actions.chooseSession(session.id) },
      },
      accountChip(agent, 'md'),
      h(
        'span',
        { class: 'rp-session-option__main' },
        h(
          'span',
          { class: 'rp-session-option__name' },
          h('strong', { text: agent.name }),
          providerTag(agent.provider, true),
          h('span', { class: `rp-dot rp-dot--${session.status === 'active' ? 'active' : 'future'}`, attrs: { 'aria-hidden': 'true' } }),
        ),
        h('span', { class: 'rp-session-option__title', text: session.title }),
        h('span', {
          class: 'rp-session-option__meta',
          text: tr('sessão {0} · {1} · {2}', [session.id, canWrite ? tr('leitura e escrita') : tr('somente leitura'), session.lastSeen]),
        }),
      ),
      active ? icon('check', 'rp-session-option__check') : null,
    );
  });
  return h(
    'div',
    { class: 'rp-session-menu', attrs: { role: 'listbox', 'aria-label': tr('Sessões do Hermes Pipeline') } },
    h(
      'div',
      { class: 'rp-session-menu__head' },
      h('strong', { text: tr('Sessões do Hermes Pipeline') }),
      h('span', { text: tr('Cada sessão tem suas próprias permissões.') }),
    ),
    linked.length ? options : h('p', { class: 'rp-small rp-muted', text: tr('Nenhuma sessão vinculada a este roadmap.') }),
    h(
      'button',
      {
        class: `rp-session-option rp-session-option--none${current === null ? ' is-active' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': String(current === null) },
        on: { click: () => actions.chooseSession(null) },
      },
      h('span', { class: 'rp-session-option__none-icon' }, icon('door')),
      h(
        'span',
        { class: 'rp-session-option__main' },
        h('span', { class: 'rp-session-option__name' }, h('strong', { text: tr('Sem sessão') })),
        h('span', { class: 'rp-session-option__meta', text: tr('Fechar a conversa e ver o estado vazio') }),
      ),
      current === null ? icon('check', 'rp-session-option__check') : null,
    ),
  );
}

function sessionButton(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = roadmapById(state.selectedRoadmapId);
  const raw = sessionById(state.conversation.sessionId);
  const session = raw && roadmap && raw.roadmapIds.includes(roadmap.id) ? raw : undefined;
  const agent = session ? AGENTS[session.agentId] : undefined;
  const linked = roadmap ? SESSIONS.filter((candidate) => candidate.roadmapIds.includes(roadmap.id)).length : 0;
  const button = h(
    'button',
    {
      class: `rp-session-btn${session ? '' : ' is-empty'}`,
      id: 'rp-session-btn',
      attrs: {
        type: 'button',
        'aria-expanded': String(state.conversation.sessionMenuOpen),
        'aria-haspopup': 'listbox',
      },
      on: { click: () => actions.toggleSessionMenu() },
    },
    session && agent
      ? accountChip(agent, 'md')
      : h('span', { class: 'rp-session-btn__empty-icon' }, icon('door')),
    h(
      'span',
      { class: 'rp-session-btn__main' },
      session && agent
        ? h(
            'span',
            { class: 'rp-session-btn__name' },
            h('strong', { text: agent.name }),
            providerTag(agent.provider, true),
            h('span', { class: `rp-dot rp-dot--${session.status === 'active' ? 'active' : 'future'}`, attrs: { 'aria-hidden': 'true' } }),
          )
        : h('span', { class: 'rp-session-btn__name' }, h('strong', { text: tr('Sem sessão') })),
      session
        ? h('span', { class: 'rp-session-btn__meta', text: tr('sessão {0} · {1} · {2}', [session.id, session.workspace, session.lastSeen]) })
        : h('span', {
            class: 'rp-session-btn__meta',
            text: linked ? tr('Escolha uma sessão do Hermes Pipeline') : tr('Nenhuma sessão vinculada a este roadmap'),
          }),
    ),
    icon('chevronDown', 'rp-chevron'),
  );
  return h(
    'div',
    { class: 'rp-session-wrap' },
    button,
    state.conversation.sessionMenuOpen ? h('div', { class: 'rp-session-backdrop', on: { click: () => actions.toggleSessionMenu() } }) : null,
    state.conversation.sessionMenuOpen ? sessionMenu(state, actions) : null,
  );
}

export function renderChatBackdrop(actions: AppActions): HTMLElement {
  return h('div', {
    class: 'rp-backdrop rp-backdrop--chat',
    attrs: { 'aria-hidden': 'true' },
    on: { click: () => actions.closeConversation() },
  });
}

export function renderConversation(state: AppState, actions: AppActions): HTMLElement {
  const conversation = state.conversation;
  const roadmap = roadmapById(state.selectedRoadmapId) ?? ROADMAPS[0];
  if (!roadmap) return h('aside', { class: 'rp-chat', id: 'rp-chat' });
  const rawSession = sessionById(conversation.sessionId);
  const session = rawSession && rawSession.roadmapIds.includes(roadmap.id) ? rawSession : undefined;
  const agent = session ? AGENTS[session.agentId] : undefined;
  const linkedSessions = SESSIONS.filter((candidate) => candidate.roadmapIds.includes(roadmap.id));
  const selectedPlan = planById(roadmap.id, state.selectedPlanId) ?? defaultPlanFor(roadmap);
  const selectedPhase = phaseById(roadmap.id, selectedPlan.phaseId) ?? roadmap.phases[0]!;
  const context = conversation.context;
  const contextPlan = context.kind === 'plan' ? planById(context.roadmapId, context.id ?? '') : undefined;
  const contextPhase = context.kind === 'phase' ? phaseById(context.roadmapId, context.id ?? '') : undefined;
  const focusPhase = contextPhase ?? (contextPlan ? phaseById(context.roadmapId, contextPlan.phaseId) : selectedPhase) ?? selectedPhase;
  const focusPlan =
    contextPlan ??
    (selectedPlan.phaseId === focusPhase.id
      ? selectedPlan
      : focusPhase.plans.find((p) => p.status === 'active') ??
        focusPhase.plans.find((p) => p.status === 'blocked') ??
        focusPhase.plans[0]) ??
    selectedPlan;
  const sameContext = (a: ConversationContext, b: ConversationContext): boolean =>
    a.roadmapId === b.roadmapId && a.kind === b.kind && (a.kind === 'roadmap' || a.id === b.id);
  const contextButtons: { label: string; context: ConversationContext }[] = [
    { label: tr('Roadmap'), context: { roadmapId: roadmap.id, kind: 'roadmap' } },
    { label: tr('Fase {0}', [focusPhase.index]), context: { roadmapId: roadmap.id, kind: 'phase', id: focusPhase.id } },
    { label: tr('Plano {0}', [focusPlan.id]), context: { roadmapId: roadmap.id, kind: 'plan', id: focusPlan.id } },
  ];
  const roadmapOwner = agentById(roadmap.ownerId);
  const exampleSession = defaultSessionForRoadmap(roadmap.id);

  const history = h('div', {
    class: 'rp-chat__history',
    id: 'rp-chat-history',
    attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': tr('Histórico da conversa') },
  });

  if (!session || !agent) {
    history.append(
      emptyState(
        'door',
        linkedSessions.length ? tr('Nenhuma sessão escolhida') : tr('Nenhuma sessão vinculada a este roadmap'),
        linkedSessions.length
          ? tr('Escolha uma sessão do Hermes Pipeline para ver o histórico e conversar com o agente.')
          : tr('O Hermes Pipeline ainda não registrou uma sessão para este roadmap. A conversa fica disponível quando um agente for vinculado.'),
        h(
          'div',
          { class: 'rp-empty__buttons' },
          h(
            'button',
            { class: 'rp-btn rp-btn--primary', attrs: { type: 'button' }, on: { click: () => actions.toggleSessionMenu() } },
            icon('search'),
            h('span', { text: tr('Escolher sessão') }),
          ),
          exampleSession
            ? h(
                'button',
                {
                  class: 'rp-btn',
                  attrs: { type: 'button' },
                  on: { click: () => actions.chooseSession(exampleSession.id) },
                },
                h('span', { text: tr('Conversar com {0}', [roadmapOwner?.name ?? tr('o agente')]) }),
              )
            : null,
        ),
      ),
    );
  } else {
    history.append(
      h(
        'p',
        { class: 'rp-chat__history-note' },
        icon('spark'),
        h('span', { text: tr('Conversa ao vivo · o agente responde e pode mover o roadmap pelo pipeline') }),
      ),
    );
    if (conversation.loading && !conversation.messages.length) {
      history.append(
        h(
          'div',
          { class: 'rp-msg rp-msg--agent rp-msg--typing' },
          avatar(agent, 'xs'),
          h(
            'div',
            { class: 'rp-msg__body' },
            h('span', { class: 'rp-msg__meta' }, h('strong', { text: agent.name }), providerTag(agent.provider, true)),
            h('div', { class: 'rp-bubble rp-typing' }, h('span'), h('span'), h('span')),
          ),
        ),
      );
    }
    for (const message of conversation.messages) history.append(messageEl(message, actions));
    if (conversation.typing) {
      history.append(
        h(
          'div',
          { class: 'rp-msg rp-msg--agent rp-msg--typing' },
          avatar(agent, 'xs'),
          h(
            'div',
            { class: 'rp-msg__body' },
            h('span', { class: 'rp-msg__meta' }, h('strong', { text: agent.name }), providerTag(agent.provider, true)),
            h('div', { class: 'rp-bubble rp-typing' }, h('span'), h('span'), h('span')),
          ),
        ),
      );
    }
    if (!conversation.loading && !conversation.messages.length && !conversation.typing) {
      history.append(
        emptyState(
          'chat',
          tr('Sem mensagens ainda'),
          tr('Pergunte sobre o roadmap ou peça uma mudança. O agente executa no pipeline e devolve o recibo.'),
        ),
      );
    }
  }

  const suggestions =
    session && agent
      ? h(
          'div',
          { class: 'rp-chat__suggestions' },
          h('p', { class: 'rp-label', text: tr('Exemplos para o agente') }),
          h(
            'div',
            { class: 'rp-chat__chips' },
            suggestedQuestions(context).map((question) =>
              h(
                'button',
                {
                  class: 'rp-question',
                  attrs: { type: 'button' },
                  on: { click: () => actions.ask(question) },
                },
                icon('spark'),
                h('span', { text: question }),
              ),
            ),
          ),
        )
      : null;

  const composer = session
    ? h(
        'form',
        {
          class: 'rp-composer',
          on: {
            submit: (event) => {
              event.preventDefault();
              const input = document.getElementById('rp-composer-input') as HTMLTextAreaElement | null;
              actions.send(input?.value ?? '');
            },
          },
        },
        h(
          'div',
          { class: 'rp-composer__box' },
          h('textarea', {
            id: 'rp-composer-input',
            class: 'rp-composer__input',
            attrs: {
              rows: 2,
              placeholder: tr('Pergunte ou peça uma mudança sobre {0}…', [contextLabel(context)]),
              'aria-label': tr('Mensagem para o agente do Hermes Pipeline'),
            },
            on: {
              input: (event) => actions.setChatDraft((event.target as HTMLTextAreaElement).value),
              keydown: (event) => {
                const keyboard = event as KeyboardEvent;
                if (keyboard.key === 'Enter' && !keyboard.shiftKey) {
                  keyboard.preventDefault();
                  actions.send((keyboard.target as HTMLTextAreaElement).value);
                }
              },
            },
          }, conversation.draftText),
          h(
            'button',
            {
              class: 'rp-send-btn',
              attrs: { type: 'submit', 'aria-label': tr('Enviar mensagem ao agente'), title: tr('Enviar mensagem ao agente') },
            },
            icon('send'),
          ),
        ),
        h('p', { class: 'rp-composer__hint', text: tr('Enter envia · Shift+Enter quebra linha · a mensagem vai para a sessão do pipeline') }),
        h(
          'p',
          { class: 'rp-composer__foot' },
          icon('lock'),
          h('span', { text: tr('Somente leitura no Habblaud · o agente move o roadmap pelas ferramentas do pipeline') }),
        ),
      )
    : h(
        'div',
        { class: 'rp-composer rp-composer--disabled' },
        h(
          'div',
          { class: 'rp-composer__box' },
          h('input', {
            class: 'rp-composer__input',
            attrs: { type: 'text', placeholder: tr('Escolha uma sessão para perguntar'), disabled: true, 'aria-label': tr('Composer desativado sem sessão') },
          }),
          h('button', { class: 'rp-send-btn', attrs: { type: 'button', disabled: true, 'aria-label': tr('Enviar desativado') } }, icon('send')),
        ),
        h(
          'p',
          { class: 'rp-composer__foot' },
          icon('lock'),
          h('span', { text: tr('Sem sessão: escolha uma das sessões conectadas ao pipeline.') }),
        ),
      );

  const connectionLabel =
    conversation.connection === 'live'
      ? tr('Conectado')
      : conversation.connection === 'reconnecting'
        ? tr('Reconectando')
        : conversation.connection === 'connecting'
          ? tr('Conectando')
          : tr('Sem sessão');

  return h(
    'aside',
    { class: 'rp-chat', id: 'rp-chat', attrs: { role: 'dialog', 'aria-label': tr('Conversa sobre o roadmap'), 'aria-modal': 'false' } },
    h(
      'div',
      { class: 'rp-chat__head' },
      h(
        'div',
        { class: 'rp-chat__top' },
        h(
          'div',
          { class: 'rp-chat__title' },
          h('span', { class: 'rp-chat__eyebrow', text: tr('CONVERSA') }),
          h('h2', { class: 'rp-h2', text: tr('Converse com o agente') }),
          h('span', { class: `rp-chat__sim is-${conversation.connection}`, text: connectionLabel }),
        ),
        h(
          'div',
          { class: 'rp-chat__top-actions' },
          session
            ? h(
                'button',
                {
                  class: 'rp-icon-btn rp-icon-btn--sm',
                  attrs: { type: 'button', 'aria-label': tr('Atualizar conversa'), title: tr('Atualizar conversa') },
                  on: { click: () => actions.refreshConversation() },
                },
                icon('reset'),
              )
            : null,
          h(
            'button',
            {
              class: 'rp-icon-btn',
              id: 'rp-chat-close',
              attrs: { type: 'button', 'aria-label': tr('Fechar conversa'), title: tr('Fechar conversa') },
              on: { click: () => actions.closeConversation() },
            },
            icon('close'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'rp-chat__context' },
        h(
          'div',
          { class: 'rp-context-tabs', attrs: { role: 'group', 'aria-label': tr('Contexto da conversa') } },
          contextButtons.map((item) =>
            h(
              'button',
              {
                class: `rp-context-tab${sameContext(context, item.context) ? ' is-active' : ''}`,
                attrs: { type: 'button', 'aria-pressed': String(sameContext(context, item.context)) },
                on: { click: () => actions.setConversationContext(item.context) },
              },
              h('span', { text: item.label }),
            ),
          ),
        ),
        h(
          'p',
          { class: 'rp-chat__context-line' },
          icon('pin'),
          h('span', {
            text:
              context.kind === 'roadmap'
                ? `${roadmap.title} · ${contextLabel(context)}`
                : `${roadmap.title} · ${contextLabel(context)} · ${contextTitle(context)}`,
          }),
        ),
      ),
      sessionButton(state, actions),
    ),
    history,
    suggestions,
    composer,
  );
}
