// Gaveta de conversa do roadmap. A pergunta vai para a sessão REAL do agente que trabalhou no plano (o Habblaud
// escolhe a sessão pelo registro do pipeline) e a resposta vem da conversa dessa sessão. Aqui só se mostram as
// mensagens, o agente que recebeu e as sugestões. Nenhuma mutação é feita aqui: se o agente mover o roadmap, o
// snapshot é recarregado pelo evento do pipeline.
import { tr } from '../../../shared/i18n';
import {
  ROADMAPS,
  contextLabel,
  contextTitle,
  defaultPlanFor,
  phaseById,
  planById,
  roadmapById,
  type ConversationContext,
} from './data';
import { suggestedQuestions } from './conversation-data';
import type { AppActions, AppState, ChatMessage } from './state';
import { providerLabel } from './bridge';
import { canSend, describeOption, initialChoice, liveSelected, reopenTarget, sameSession } from './session-picker';
import { emptyState, h, icon } from './ui';
import { renderMarkdown } from '../ui/markdown';
import type { Provider } from '../../../shared/types';

function providerChip(provider: Provider): HTMLElement {
  return h('span', { class: `rp-provider rp-provider--${provider} rp-provider--xs`, text: providerLabel(provider) });
}

/** Rótulo do cabeçalho: sessão viva escolhida e ainda sem pergunta não é "sem conversa". */
export function connectionLabel(connection: 'closed' | 'connecting' | 'live' | 'reconnecting', liveChosen: boolean): string {
  if (connection === 'live') return tr('Conectado');
  if (connection === 'reconnecting') return tr('Reconectando');
  if (connection === 'connecting') return tr('Conectando');
  return liveChosen ? tr('Pronto para perguntar') : tr('Sem conversa ativa');
}

export function messageEl(message: ChatMessage): HTMLElement {
  if (message.role === 'user') {
    return h(
      'div',
      { class: 'rp-msg rp-msg--user' },
      h('span', { class: 'rp-msg__meta', text: tr('Você · {0}', [message.at]) }),
      h('div', { class: 'rp-bubble' }, h('span', { text: message.text })),
    );
  }
  return h(
    'div',
    { class: 'rp-msg rp-msg--agent' },
    h('span', { class: 'rp-msg__fallback', text: '·' }),
    h(
      'div',
      { class: 'rp-msg__body' },
      h(
        'span',
        { class: 'rp-msg__meta' },
        message.author ? h('strong', { text: message.author.name }) : null,
        message.author ? providerChip(message.author.provider) : null,
        h('span', { class: 'rp-muted', text: message.at }),
      ),
      h('div', { class: 'rp-bubble' }, h('div', { class: 'ui-md' }, renderMarkdown(message.text))),
    ),
  );
}

function typingEl(state: AppState): HTMLElement {
  const target = state.conversation.target;
  return h(
    'div',
    { class: 'rp-msg rp-msg--agent rp-msg--typing' },
    h('span', { class: 'rp-msg__fallback', text: '·' }),
    h(
      'div',
      { class: 'rp-msg__body' },
      h(
        'span',
        { class: 'rp-msg__meta' },
        target ? h('strong', { text: target.profile ?? target.provider }) : null,
        target ? providerChip(target.provider) : null,
      ),
      h('div', { class: 'rp-bubble rp-typing' }, h('span'), h('span'), h('span')),
    ),
  );
}

/** Por que o envio está bloqueado (sessão fechada, ninguém registrado…); `null` quando dá para enviar ou a lista ainda não chegou. */
function sendBlockedReason(state: AppState): string | null {
  const picker = state.conversation.sessions;
  if (picker.status !== 'ready' || !picker.options) return null;
  const verdict = canSend(picker.options, picker.choice ?? initialChoice(picker.options));
  return verdict.ok ? null : verdict.reason;
}

/** Seletor da sessão com quem conversar: a sugerida já vem escolhida; fechadas aparecem, mas não recebem. */
function sessionPickerEl(state: AppState, actions: AppActions): HTMLElement {
  const picker = state.conversation.sessions;
  const box = h(
    'div',
    { class: 'rp-session', attrs: { role: 'group', 'aria-label': tr('Sessão com quem conversar') } },
    h('span', { class: 'rp-label', text: tr('Sessão') }),
  );
  if (picker.status === 'error') {
    box.append(
      h('span', { class: 'rp-session__note is-error', attrs: { role: 'alert' }, text: tr('Não foi possível listar as sessões: {0}', [picker.error ?? '']) }),
      h('button', { class: 'rp-btn', attrs: { type: 'button' }, on: { click: () => actions.loadSessions() } }, h('span', { text: tr('Tentar de novo') })),
    );
    return box;
  }
  const options = picker.options;
  if (picker.status !== 'ready' || !options) {
    box.append(h('span', { class: 'rp-session__note', text: tr('Carregando as sessões…') }));
    return box;
  }
  const choice = picker.choice ?? initialChoice(options);
  if (options.options.length > 0) {
    const select = h(
      'select',
      {
        class: 'rp-session__select',
        id: 'rp-session-select',
        attrs: { 'aria-label': tr('Sessão com quem conversar') },
        on: {
          change: (event) => {
            const picked = options.options[Number((event.target as HTMLSelectElement).value)];
            if (picked) actions.chooseSession({ provider: picked.provider, sessionId: picked.sessionId });
          },
        },
      },
      options.options.map((option, index) =>
        h('option', { attrs: { value: String(index), selected: choice !== null && sameSession(option, choice) }, text: describeOption(option) }),
      ),
    );
    box.append(select);
  }
  if (reopenTarget(options, choice)) {
    box.append(
      h(
        'button',
        { class: 'rp-btn', attrs: { type: 'button', disabled: picker.reopening }, on: { click: () => actions.reopenSession() } },
        h('span', { text: picker.reopening ? tr('Reabrindo a sessão…') : tr('Reabrir sessão') }),
      ),
    );
  }
  const blocked = sendBlockedReason(state);
  if (blocked) box.append(h('span', { class: 'rp-session__note', attrs: { role: 'status' }, text: blocked }));
  return box;
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
        focusPhase.plans.find((p) => p.status === 'review') ??
        focusPhase.plans[0]) ??
    selectedPlan;
  const sameContext = (a: ConversationContext, b: ConversationContext): boolean =>
    a.roadmapId === b.roadmapId && a.kind === b.kind && (a.kind === 'roadmap' || a.id === b.id);
  const contextButtons: { label: string; context: ConversationContext }[] = [
    { label: tr('Roadmap'), context: { roadmapId: roadmap.id, kind: 'roadmap' } },
    { label: tr('Fase {0}', [focusPhase.index]), context: { roadmapId: roadmap.id, kind: 'phase', id: focusPhase.id } },
    { label: tr('Plano {0}', [focusPlan.id]), context: { roadmapId: roadmap.id, kind: 'plan', id: focusPlan.id } },
  ];
  // A pergunta precisa de um plano: é o plano que diz qual agente trabalhou nele.
  const canAsk = Boolean(contextPlan);

  const history = h('div', {
    class: 'rp-chat__history',
    id: 'rp-chat-history',
    attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': tr('Histórico da conversa') },
  });

  if (!canAsk) {
    history.append(
      emptyState(
        'door',
        tr('Escolha um plano'),
        tr('A pergunta vai para o agente que trabalhou no plano. Escolha a aba do plano para conversar com ele.'),
        h(
          'button',
          {
            class: 'rp-btn rp-btn--primary',
            attrs: { type: 'button' },
            on: { click: () => actions.setConversationContext({ roadmapId: roadmap.id, kind: 'plan', id: focusPlan.id }) },
          },
          h('span', { text: tr('Conversar sobre o plano {0}', [focusPlan.id]) }),
        ),
      ),
    );
  } else {
    history.append(
      h(
        'p',
        { class: 'rp-chat__history-note' },
        icon('spark'),
        h('span', { text: tr('A pergunta vai para a sessão do agente que trabalhou neste plano; a resposta vem dela') }),
      ),
    );
    for (const message of conversation.messages) history.append(messageEl(message));
    if (conversation.typing) history.append(typingEl(state));
    if (!conversation.messages.length && !conversation.typing) {
      history.append(
        emptyState(
          'chat',
          tr('Sem mensagens ainda'),
          tr('Pergunte sobre o plano. A pergunta chega à sessão do agente que trabalhou nele.'),
        ),
      );
    }
  }

  const suggestions = canAsk
    ? h(
        'div',
        { class: 'rp-chat__suggestions' },
        h('p', { class: 'rp-label', text: tr('Perguntas para o agente') }),
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

  const composer = canAsk
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
              placeholder: tr('Pergunte sobre {0}…', [contextLabel(context)]),
              'aria-label': tr('Mensagem para o agente que trabalhou no plano'),
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
              attrs: { type: 'submit', 'aria-label': tr('Enviar mensagem ao agente'), title: sendBlockedReason(state) ?? tr('Enviar mensagem ao agente'), disabled: sendBlockedReason(state) !== null },
            },
            icon('send'),
          ),
        ),
        h('p', { class: 'rp-composer__hint', text: tr('Enter envia · Shift+Enter quebra linha · a mensagem vai para a sessão do agente') }),
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
            attrs: { type: 'text', placeholder: tr('Escolha um plano para perguntar'), disabled: true, 'aria-label': tr('Composer desativado sem plano') },
          }),
          h('button', { class: 'rp-send-btn', attrs: { type: 'button', disabled: true, 'aria-label': tr('Enviar desativado') } }, icon('send')),
        ),
        h(
          'p',
          { class: 'rp-composer__foot' },
          icon('lock'),
          h('span', { text: tr('Sem plano: a pergunta precisa de um plano para achar o agente.') }),
        ),
      );

  const picker = conversation.sessions;
  const statusText = connectionLabel(conversation.connection, liveSelected(picker.options, picker.choice));

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
          h('span', { class: `rp-chat__sim is-${conversation.connection}`, text: statusText }),
        ),
        h(
          'div',
          { class: 'rp-chat__top-actions' },
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
    ),
    history,
    canAsk ? sessionPickerEl(state, actions) : null,
    suggestions,
    composer,
  );
}
