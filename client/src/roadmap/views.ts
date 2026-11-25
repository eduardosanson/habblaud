// Telas do roadmap: visão geral, fases com detalhe, trabalho agora e índice de roadmaps.
// Toda navegação é local (estado em memória); nenhuma tela chama API ou lê sessão real.
import { tr } from '../../../shared/i18n';
import {
  AGENT_LIST,
  ROADMAPS,
  SESSIONS,
  agentById,
  capacity,
  compactTokens,
  countPlans,
  defaultPlanFor,
  linkLabel,
  nextPendingStep,
  normalizeSearch,
  overallCounts,
  phaseById,
  phaseCounts,
  phaseStatus,
  planById,
  planMatches,
  planStepCounts,
  roadmapById,
  roadmapPlans,
  roadmapState,
  typeCounts,
  workFocus,
  workLinks,
  workTypeLabel,
  type Agent,
  type ChainNode,
  type Phase,
  type Plan,
  type PlanStatus,
  type Roadmap,
  type Size,
  type StatusCounts,
  type WorkItemType,
} from './data';
import type { AppActions, AppState, Filter, Variant } from './state';
import {
  accountChip,
  agentIdentity,
  agentStatusPill,
  countLabel,
  dependencyIcon,
  emptyState,
  h,
  icon,
  legend,
  planProgressText,
  providerTag,
  sectionHead,
  statusBar,
  statusDot,
  planStatusLabel,
  planStatusPill,
  statusPill,
} from './ui';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: tr('Tudo') },
  { id: 'active', label: tr('Em andamento') },
  { id: 'review', label: tr('Em revisão') },
  { id: 'blocked', label: tr('Bloqueados') },
  { id: 'done', label: tr('Concluídos') },
  { id: 'future', label: tr('Futuros') },
];

function selectedRoadmap(state: AppState): Roadmap {
  return roadmapById(state.selectedRoadmapId) ?? ROADMAPS[0];
}

function ownerOf(plan: Plan): Agent | undefined {
  return agentById(plan.ownerId);
}

function sessionOf(agentId: string | undefined) {
  return agentId ? SESSIONS.find((s) => s.agentId === agentId) : undefined;
}

function agentsFor(roadmap: Roadmap): Agent[] {
  return AGENT_LIST.filter((agent) => agent.roadmapIds?.includes(roadmap.id) || agent.currentRoadmapId === roadmap.id);
}

function chatPlan(actions: AppActions, plan: Plan): void {
  actions.openConversation({ roadmapId: plan.roadmapId, kind: 'plan', id: plan.id });
}

function defaultConversationContext(state: AppState): { roadmapId: string; kind: 'roadmap' } | { roadmapId: string; kind: 'phase'; id: string } | { roadmapId: string; kind: 'plan'; id: string } {
  const roadmap = selectedRoadmap(state);
  if (state.variant === 'work') return { roadmapId: roadmap.id, kind: 'plan', id: defaultPlanFor(roadmap).id };
  if (state.variant === 'phases' || state.variant === 'backlog') return { roadmapId: roadmap.id, kind: 'plan', id: state.selectedPlanId };
  return { roadmapId: roadmap.id, kind: 'roadmap' };
}

function roadmapStatusLabel(roadmap: Roadmap): string {
  const state = roadmapState(roadmap);
  if (state === 'active') return tr('Ativo');
  if (state === 'done') return tr('Concluído');
  if (state === 'review') return tr('Em revisão');
  if (state === 'archived') return tr('Arquivado');
  return tr('Rascunho');
}

function roadmapTone(roadmap: Roadmap): PlanStatus | 'draft' {
  const state = roadmapState(roadmap);
  return state === 'archived' ? 'future' : state;
}

function roadmapStatusPill(roadmap: Roadmap): HTMLElement {
  return statusPill(roadmapTone(roadmap), roadmapStatusLabel(roadmap));
}

function typeChip(type: WorkItemType): HTMLElement {
  return h(
    'span',
    { class: `rp-type rp-type--${type}` },
    icon(type === 'bug' ? 'bug' : type === 'story' ? 'story' : 'check'),
    h('span', { text: workTypeLabel(type) }),
  );
}

function sizeChip(size: Size | null): HTMLElement {
  if (!size) return h('span', { class: 'rp-size rp-size--none', text: '—', title: tr('Sem peso registrado no pipeline') });
  return h('span', { class: `rp-size rp-size--${size.toLowerCase()}`, text: size });
}

function typeDot(type: WorkItemType): HTMLElement {
  const el = h('span', { class: `rp-type-dot rp-type-dot--${type}`, title: workTypeLabel(type) });
  el.setAttribute('aria-label', workTypeLabel(type));
  el.setAttribute('role', 'img');
  return el;
}

function estimateSummary(plan: Plan): HTMLElement {
  return h(
    'span',
    { class: 'rp-estimate' },
    sizeChip(plan.size),
    plan.estimate
      ? h('span', { text: tr('{0}–{1} tokens', [compactTokens(plan.estimate.p50), compactTokens(plan.estimate.p80)]) })
      : h('span', { class: 'rp-muted', text: tr('Sem estimativa') }),
  );
}

function typeBreakdown(plans: readonly Plan[]): HTMLElement {
  const c = typeCounts(plans);
  const story = c.story === 1 ? tr('1 história') : tr('{0} histórias', [c.story]);
  const task = c.task === 1 ? tr('1 task') : tr('{0} tasks', [c.task]);
  const bug = c.bug === 1 ? tr('1 bug') : tr('{0} bugs', [c.bug]);
  return h('span', { class: 'rp-type-summary', text: `${story} · ${task} · ${bug}` });
}

function capacityLine(roadmap: Roadmap): HTMLElement {
  const c = capacity(roadmapPlans(roadmap));
  const hasEstimate = c.estimateP50 > 0 || c.estimateP80 > 0;
  return h(
    'p',
    { class: 'rp-capacity' },
    icon('spark'),
    h('span', {
      text: hasEstimate
        ? tr('Esforço estimado: {0}–{1} tokens · realizado {2} em {3} sessões', [
            compactTokens(c.estimateP50),
            compactTokens(c.estimateP80),
            compactTokens(c.actualTokens),
            c.sessions,
          ])
        : tr('Sem estimativas no pipeline · realizado {0} em {1} sessões', [compactTokens(c.actualTokens), c.sessions]),
    }),
  );
}

function executionLine(plan: Plan): HTMLElement {
  if (!plan.execution) {
    return h('span', { class: 'rp-execution is-empty' }, icon('clock'), h('span', { text: tr('Sem execução vinculada ainda') }));
  }
  const agent = agentById(plan.execution.agentId);
  return h(
    'span',
    { class: 'rp-execution' },
    icon('person'),
    h('span', { text: agent?.name ?? tr('agente') }),
    providerTag(plan.execution.provider, true),
    h('span', { class: 'rp-muted', text: tr('sessão {0}', [plan.execution.sessionId]) }),
  );
}

// ---------------------------------------------------------------- barra superior e guia

export function renderTopbar(state: AppState, actions: AppActions): HTMLElement {
  const tabs: { id: Variant; label: string; icon: 'overview' | 'phases' | 'layers' | 'work' }[] = [
    { id: 'overview', label: tr('Visão geral'), icon: 'overview' },
    { id: 'phases', label: tr('Fases e detalhe'), icon: 'phases' },
    { id: 'backlog', label: tr('Backlog'), icon: 'layers' },
    { id: 'work', label: tr('Trabalho agora'), icon: 'work' },
  ];
  const nav = h('nav', { class: 'rp-tabs', attrs: { role: 'tablist', 'aria-label': tr('Hierarquias do roadmap') } });
  for (const tab of tabs) {
    const selected = state.variant === tab.id;
    nav.append(
      h(
        'button',
        {
          class: `rp-tab${selected ? ' is-active' : ''}`,
          attrs: { role: 'tab', 'aria-selected': String(selected), 'aria-controls': 'rp-main', type: 'button' },
          on: { click: () => actions.setVariant(tab.id) },
        },
        icon(tab.icon),
        h('span', { text: tab.label }),
      ),
    );
  }

  const roadmapsButton = h(
    'button',
    {
      class: 'rp-btn rp-btn--roadmaps',
      id: 'rp-open-roadmaps',
      attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': String(state.roadmapIndexOpen) },
      title: tr('Ver todos os roadmaps'),
      on: { click: () => actions.openRoadmapIndex() },
    },
    icon('layers'),
    h('span', { text: tr('Roadmaps') }),
  );

  const chatButton = h(
    'button',
    {
      class: 'rp-btn rp-btn--chat',
      id: 'rp-open-conversation',
      attrs: { type: 'button', 'aria-expanded': String(state.conversation.open), 'aria-haspopup': 'dialog' },
      title: tr('Conversar com o agente do Hermes Pipeline'),
      on: {
        click: () => {
          if (state.conversation.open) {
            document.getElementById('rp-composer-input')?.focus();
            return;
          }
          actions.openConversation(defaultConversationContext(state));
        },
      },
    },
    icon('chat'),
    h('span', { text: tr('Conversa') }),
    h('span', { class: 'rp-btn__dot', attrs: { 'aria-hidden': 'true' } }),
  );

  return h(
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
    nav,
    h(
      'div',
      { class: 'rp-topbar__actions' },
      h(
        'a',
        { class: 'rp-btn rp-btn--office', attrs: { href: '/', title: tr('Voltar ao escritório') } },
        icon('chevronLeft'),
        h('span', { text: tr('Escritório') }),
      ),
      h(
        'span',
        {
          class: `rp-source-badge is-${state.roadmapStream === 'live' ? 'live' : state.roadmapStream === 'reconnecting' ? 'warn' : 'offline'}`,
          title: state.source
            ? tr('Fonte: {0} · revisão {1} · gerado {2}', [state.source.label, state.source.revision, state.source.generatedAt])
            : tr('Sem conexão com o Hermes Pipeline'),
        },
        icon('layers'),
        h('span', {
          text: state.source
            ? tr('Pipeline · revisão {0}', [state.source.revision])
            : tr('Pipeline offline'),
        }),
      ),
      roadmapsButton,
      chatButton,
    ),
  );
}

export function renderPage(state: AppState, actions: AppActions): HTMLElement {
  return h(
    'div',
    { class: 'rp-page' },
    renderRoadmapBar(state, actions),
    h('main', { id: 'rp-main', class: 'rp-main' }, renderVariant(state, actions)),
    h(
      'footer',
      { class: 'rp-footer' },
      icon('lock'),
      h('span', {
        text: tr('Somente leitura · fonte Hermes Pipeline · o agente move o roadmap · o Habblaud não escreve estado'),
      }),
    ),
  );
}

function renderVariant(state: AppState, actions: AppActions): HTMLElement {
  if (state.variant === 'phases') return renderPhases(state, actions);
  if (state.variant === 'backlog') return renderBacklog(state, actions);
  if (state.variant === 'work') return renderWork(state, actions);
  return renderOverview(state, actions);
}

// ---------------------------------------------------------------- seletor e índice de roadmaps

function renderRoadmapBar(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = selectedRoadmap(state);
  const counts = overallCounts(roadmap);
  const phase = phaseById(roadmap.id, roadmap.currentPhaseId);

  const menuOptions = ROADMAPS.map((r) => {
    const c = overallCounts(r);
    const p = phaseById(r.id, r.currentPhaseId);
    const active = r.id === roadmap.id;
    return h(
      'button',
      {
        class: `rp-roadmap-menu__item${active ? ' is-active' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': String(active) },
        on: { click: () => actions.selectRoadmap(r.id) },
      },
      statusDot(roadmapTone(r)),
      h(
        'span',
        { class: 'rp-roadmap-menu__main' },
        h('span', { class: 'rp-roadmap-menu__title' }, h('strong', { text: r.title }), active ? icon('check', 'rp-roadmap-menu__check') : null),
        h('span', { class: 'rp-roadmap-menu__meta', text: tr('{0} · {1}/{2} itens · Fase {3}', [roadmapStatusLabel(r), c.done, c.total, p?.index ?? '—']) }),
      ),
    );
  });

  const switchWrap = h(
    'div',
    { class: 'rp-roadmap-switch-wrap' },
    h(
      'button',
      {
        class: 'rp-roadmap-switch',
        id: 'rp-roadmap-switch',
        attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': String(state.roadmapMenuOpen) },
        on: { click: () => actions.toggleRoadmapMenu() },
      },
      h('span', { class: 'rp-roadmap-switch__icon' }, icon('layers')),
      h(
        'span',
        { class: 'rp-roadmap-switch__main' },
        h('span', { class: 'rp-roadmap-switch__eyebrow', text: tr('ROADMAP ATUAL') }),
        h('strong', { class: 'rp-roadmap-switch__title', text: roadmap.title }),
        h('span', { class: 'rp-roadmap-switch__meta', text: tr('{0} · {1}/{2} itens · Fase {3}', [roadmapStatusLabel(roadmap), counts.done, counts.total, phase?.index ?? '—']) }),
      ),
      roadmapStatusPill(roadmap),
      icon('chevronDown', 'rp-chevron'),
    ),
    state.roadmapMenuOpen ? h('div', { class: 'rp-roadmap-menu-backdrop', on: { click: () => actions.closeRoadmapMenu() } }) : null,
    state.roadmapMenuOpen
      ? h(
          'div',
          { class: 'rp-roadmap-menu', attrs: { role: 'listbox', 'aria-label': tr('Roadmaps') } },
          h('p', { class: 'rp-roadmap-menu__head', text: tr('Trocar roadmap') }),
          menuOptions,
          h(
            'button',
            {
              class: 'rp-roadmap-menu__all',
              attrs: { type: 'button' },
              on: { click: () => actions.openRoadmapIndex() },
            },
            icon('overview'),
            h('span', { text: tr('Ver todos os roadmaps') }),
          ),
        )
      : null,
  );

  return h(
    'div',
    { class: 'rp-roadmap-bar' },
    switchWrap,
    h(
      'div',
      { class: 'rp-roadmap-bar__side' },
      h('span', {
        class: 'rp-roadmap-bar__count',
        text: ROADMAPS.length === 1 ? tr('1 roadmap') : tr('{0} roadmaps', [ROADMAPS.length]),
      }),
      h(
        'button',
        { class: 'rp-link rp-roadmap-bar__all', attrs: { type: 'button' }, on: { click: () => actions.openRoadmapIndex() } },
        h('span', { text: tr('Ver todos') }),
        icon('arrowRight'),
      ),
    ),
  );
}

export function renderRoadmapIndex(state: AppState, actions: AppActions): HTMLElement {
  const current = selectedRoadmap(state);
  return h(
    'div',
    { class: 'rp-roadmap-index', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rp-roadmap-index-title' } },
    h('div', { class: 'rp-roadmap-index__backdrop', attrs: { 'aria-hidden': 'true' }, on: { click: () => actions.closeRoadmapIndex() } }),
    h(
      'div',
      { class: 'rp-roadmap-index__panel' },
      h(
        'div',
        { class: 'rp-roadmap-index__head' },
        h(
          'div',
          null,
          h('p', { class: 'rp-eyebrow', text: tr('ROADMAPS') }),
          h('h2', { class: 'rp-h2', id: 'rp-roadmap-index-title', text: tr('Escolha um roadmap') }),
          h('p', { class: 'rp-lede rp-lede--small', text: tr('Cada roadmap é um recorte de planejamento com fases, marcos e agentes próprios.') }),
        ),
        h(
          'button',
          {
            class: 'rp-icon-btn',
            id: 'rp-roadmap-index-close',
            attrs: { type: 'button', 'aria-label': tr('Fechar roadmaps'), title: tr('Fechar roadmaps') },
            on: { click: () => actions.closeRoadmapIndex() },
          },
          icon('close'),
        ),
      ),
      h(
        'div',
        { class: 'rp-roadmap-index__grid' },
        ROADMAPS.map((roadmap) => renderRoadmapCard(roadmap, roadmap.id === current.id, actions)),
        h(
          'div',
          { class: 'rp-roadmap-card rp-roadmap-card--new is-static' },
          h('span', { class: 'rp-roadmap-card__new-icon' }, icon('lock')),
          h('strong', { text: tr('Gerenciado no Hermes Pipeline') }),
          h('span', { class: 'rp-small', text: tr('Criar, arquivar e editar roadmaps fica no pipeline. Aqui a leitura é somente leitura.') }),
        ),
      ),
    ),
  );
}

function renderRoadmapCard(roadmap: Roadmap, selected: boolean, actions: AppActions): HTMLElement {
  const counts = overallCounts(roadmap);
  const phase = phaseById(roadmap.id, roadmap.currentPhaseId);
  const agents = agentsFor(roadmap);
  const owner = agentById(roadmap.ownerId);
  return h(
    'button',
    {
      class: `rp-roadmap-card${selected ? ' is-selected' : ''}`,
      attrs: { type: 'button' },
      on: { click: () => actions.selectRoadmap(roadmap.id) },
    },
    h(
      'span',
      { class: 'rp-roadmap-card__top' },
      roadmapStatusPill(roadmap),
      selected ? h('span', { class: 'rp-roadmap-card__selected' }, icon('check'), h('span', { text: tr('Aberto') })) : null,
    ),
    h('strong', { class: 'rp-roadmap-card__title', text: roadmap.title }),
    h('span', { class: 'rp-roadmap-card__subtitle', text: roadmap.subtitle }),
    h('span', { class: 'rp-roadmap-card__objective', text: roadmap.objective }),
    h(
      'span',
      { class: 'rp-roadmap-card__phase' },
      icon('flag'),
      h('span', { text: phase ? tr('Fase atual · {0} · {1}', [phase.index, phase.name]) : tr('Sem fase atual') }),
    ),
    h(
      'span',
      { class: 'rp-roadmap-card__progress' },
      h('span', { class: 'rp-roadmap-card__fraction' }, h('strong', { text: `${counts.done}/${counts.total}` }), h('span', { text: tr('itens') })),
      statusBar(
        roadmapPlans(roadmap).map((p) => ({ status: p.status, label: `${p.id} ${p.title}` })),
        { label: tr('Progresso de {0}: {1} de {2}', [roadmap.title, counts.done, counts.total]), size: 'sm' },
      ),
    ),
    legend(counts, { skipZero: true }),
    h(
      'span',
      { class: 'rp-roadmap-card__meta' },
      h('span', null, icon('person'), h('span', { text: agents.length === 1 ? tr('1 agente') : tr('{0} agentes', [agents.length]) })),
      h('span', null, icon('target'), h('span', { text: countLabel('active', counts.active) })),
      h('span', { class: counts.blocked > 0 ? 'is-blocked' : '' }, icon('lock'), h('span', { text: countLabel('blocked', counts.blocked) })),
    ),
    h(
      'span',
      { class: 'rp-roadmap-card__foot' },
      h('span', { text: owner ? tr('Dono: {0} · atualizado {1}', [owner.name, roadmap.updatedAt]) : tr('Atualizado {0}', [roadmap.updatedAt]) }),
      h('span', { class: 'rp-roadmap-card__open' }, h('span', { text: tr('Abrir') }), icon('arrowRight')),
    ),
  );
}

// ---------------------------------------------------------------- visão geral

export function renderOverview(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = selectedRoadmap(state);
  const counts = overallCounts(roadmap);
  const currentPhase = phaseById(roadmap.id, roadmap.currentPhaseId)!;
  const currentCounts = phaseCounts(currentPhase);
  const plans = roadmapPlans(roadmap);
  const active = plans.filter((p) => p.status === 'active');
  const blocked = plans.filter((p) => p.status === 'blocked');

  return h(
    'div',
    { class: 'rp-view rp-overview' },
    renderHero(roadmap, counts),
    h(
      'div',
      { class: 'rp-overview__grid' },
      h(
        'div',
        { class: 'rp-overview__main' },
        renderCurrentPhase(roadmap, currentPhase, currentCounts, actions),
        renderAgentsNow(roadmap, active, blocked, actions),
        renderPhaseStrip(roadmap, actions),
      ),
      h(
        'aside',
        { class: 'rp-overview__side' },
        renderMilestone(roadmap, actions),
        renderAttention(roadmap, blocked, actions),
        renderActivity(roadmap, actions),
      ),
    ),
  );
}

function renderHero(roadmap: Roadmap, counts: StatusCounts): HTMLElement {
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  const phase = phaseById(roadmap.id, roadmap.currentPhaseId);
  const agents = agentsFor(roadmap);
  return h(
    'section',
    { class: 'rp-panel rp-hero' },
    h(
      'div',
      { class: 'rp-hero__copy' },
      h('p', { class: 'rp-eyebrow', text: tr('ROADMAP · HABBLAUD') }),
      h('h1', { class: 'rp-h1 rp-hero__title', text: roadmap.title }),
      h('p', { class: 'rp-lede', text: roadmap.objective }),
      h(
        'div',
        { class: 'rp-hero__meta' },
        h('span', { class: 'rp-meta-chip' }, icon('target'), h('span', { text: tr('Fase atual · {0} de {1}', [phase?.index ?? '—', roadmap.phases.length]) })),
        h('span', { class: 'rp-meta-chip' }, icon('clock'), h('span', { text: tr('{0} · {1}', [roadmap.snapshotAt, roadmap.snapshotLabel]) })),
        h(
          'span',
          { class: 'rp-meta-chip' },
          icon('person'),
          h('span', { text: agents.length === 1 ? tr('1 agente neste roadmap') : tr('{0} agentes neste roadmap', [agents.length]) }),
        ),
        h('span', { class: 'rp-meta-chip' }, icon('layers'), h('span', { text: roadmap.subtitle })),
      ),
    ),
    h(
      'div',
      { class: 'rp-hero__progress' },
      h(
        'div',
        { class: 'rp-hero__progress-head' },
        h('span', { class: 'rp-label', text: tr('Progresso do roadmap') }),
        h(
          'span',
          { class: 'rp-fraction', attrs: { 'aria-label': tr('{0} de {1} itens concluídos', [counts.done, counts.total]) } },
          h('strong', { text: String(counts.done) }),
          h('span', { text: `/ ${counts.total}` }),
        ),
      ),
      h('p', { class: 'rp-hero__progress-sub', text: tr('itens concluídos · {0}%', [pct]) }),
      statusBar(
        roadmapPlans(roadmap).map((p) => ({ status: p.status, label: `${p.id} ${p.title} — ${statusLabelForBar(p.status)}` })),
        { size: 'lg', label: tr('Progresso de {0}: {1} de {2} itens concluídos', [roadmap.title, counts.done, counts.total]) },
      ),
      legend(counts),
      h(
        'p',
        { class: 'rp-count-note' },
        icon('info'),
        h('span', {
          text: tr('Contamos 1 item = 1 plano com critérios de aceite. Etapas e subtarefas não entram no denominador.'),
        }),
      ),
      h(
        'details',
        { class: 'rp-count-details' },
        h('summary', { text: tr('Como contamos') }),
        h('p', { text: roadmap.countRule }),
      ),
      capacityLine(roadmap),
      h(
        'div',
        { class: 'rp-hero__types' },
        h('span', { class: 'rp-label', text: tr('Composição') }),
        typeBreakdown(roadmapPlans(roadmap)),
      ),
    ),
    h('img', {
      class: 'rp-hero__mark',
      attrs: { src: '/assets/brand/logo-mark.png', alt: '', 'aria-hidden': 'true' },
    }),
  );
}

function statusLabelForBar(status: PlanStatus): string {
  if (status === 'done') return tr('concluído');
  if (status === 'active') return tr('em andamento');
  if (status === 'review') return tr('em revisão');
  if (status === 'blocked') return tr('bloqueado');
  return tr('futuro');
}

function renderCurrentPhase(roadmap: Roadmap, phase: Phase, counts: StatusCounts, actions: AppActions): HTMLElement {
  const status = phaseStatus(phase);
  return h(
    'section',
    { class: 'rp-panel rp-current' },
    sectionHead(tr('FASE ATUAL'), tr('{0} · {1}', [String(phase.index).padStart(2, '0'), phase.name]), statusPill(status)),
    h('p', { class: 'rp-body', text: phase.objective }),
    h(
      'div',
      { class: 'rp-stats' },
      h('div', { class: 'rp-stat' }, h('strong', { text: `${counts.done}/${counts.total}` }), h('span', { text: tr('planos concluídos') })),
      h('div', { class: 'rp-stat rp-stat--active' }, h('strong', { text: String(counts.active) }), h('span', { text: tr('em andamento') })),
      counts.review > 0 ? h('div', { class: 'rp-stat' }, h('strong', { text: String(counts.review) }), h('span', { text: tr('em revisão') })) : null,
      h(
        'div',
        { class: 'rp-stat rp-stat--blocked' },
        h('strong', { text: String(counts.blocked) }),
        h('span', { text: counts.blocked === 1 ? tr('bloqueado') : tr('bloqueados') }),
      ),
    ),
    statusBar(
      phase.plans.map((p) => ({ status: p.status, label: `${p.id} ${p.title}` })),
      { label: tr('Progresso da fase {0}', [phase.index]), size: 'md' },
    ),
    h(
      'p',
      { class: 'rp-checkpoint' },
      icon('clock'),
      h('span', { text: tr('Próximo checkpoint: {0}', [nextPendingStep(defaultPlanFor(roadmap))?.title ?? tr('sem checkpoint')]) }),
    ),
    h(
      'button',
      { class: 'rp-btn rp-btn--primary', attrs: { type: 'button' }, on: { click: () => actions.openPhase(phase.id, defaultPlanFor(roadmap).id, roadmap.id) } },
      h('span', { text: tr('Ver fase e planos') }),
      icon('arrowRight'),
    ),
  );
}

function renderAgentsNow(roadmap: Roadmap, active: Plan[], blocked: Plan[], actions: AppActions): HTMLElement {
  const list = h('div', { class: 'rp-now-list' });
  const agents = agentsFor(roadmap);
  const ordered = [...agents].sort((a, b) => {
    const rank = { working: 0, blocked: 1, idle: 2 } as const;
    return rank[a.status] - rank[b.status];
  });
  for (const agent of ordered) {
    const plan = agent.currentPlanId ? planById(roadmap.id, agent.currentPlanId) : undefined;
    const step = plan ? nextPendingStep(plan) : undefined;
    const session = sessionOf(agent.id);
    const displayAgent: Agent = plan
      ? agent
      : { ...agent, status: 'idle', statusLabel: tr('Em outro roadmap'), note: tr('A sessão está em outro roadmap neste momento.') };
    const row = h(
      'article',
      { class: `rp-now-row is-${displayAgent.status}` },
      accountChip(displayAgent, 'md'),
      h(
        'div',
        { class: 'rp-now-row__main' },
        h(
          'div',
          { class: 'rp-now-row__top' },
          plan
            ? h(
                'button',
                { class: 'rp-link rp-now-row__plan', attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
                h('strong', { text: `${plan.id} ${plan.title}` }),
              )
            : h('strong', { text: tr('Sem plano em foco') }),
          agentStatusPill(displayAgent),
        ),
        h(
          'p',
          { class: 'rp-now-row__line' },
          h('span', { text: `${agent.name} · ${agent.role}` }),
          providerTag(agent.provider, true),
          h('span', { class: 'rp-muted', text: `· ${agent.since}` }),
        ),
        displayAgent.status === 'working' && step
          ? h('p', { class: 'rp-now-row__detail' }, icon('work'), h('span', { text: tr('Agora: {0}', [step.title]) }))
          : null,
        displayAgent.status === 'blocked' && plan
          ? h(
              'p',
              { class: 'rp-now-row__detail is-blocked' },
              icon('lock'),
              h('span', { text: tr('Bloqueado: {0}', [plan.blockReason ?? tr('aguardando dependência')]) }),
            )
          : null,
        displayAgent.status === 'idle' && displayAgent.note ? h('p', { class: 'rp-now-row__detail' }, icon('spark'), h('span', { text: displayAgent.note })) : null,
      ),
      h(
        'div',
        { class: 'rp-now-row__actions' },
        plan
          ? h(
              'button',
              {
                class: 'rp-icon-btn',
                attrs: { type: 'button', 'aria-label': tr('Perguntar sobre {0}', [plan.id]), title: tr('Perguntar sobre {0}', [plan.id]) },
                on: {
                  click: () =>
                    actions.openConversation({ roadmapId: roadmap.id, kind: 'plan', id: plan.id }),
                },
              },
              icon('chat'),
            )
          : null,
        h(
          'button',
          {
            class: 'rp-icon-btn',
            attrs: { type: 'button', 'aria-label': tr('Abrir plano de {0}', [agent.name]), title: tr('Abrir plano de {0}', [agent.name]) },
            on: { click: () => (plan ? actions.openPlan(plan.id, roadmap.id) : actions.setVariant('work')) },
          },
          icon('arrowRight'),
        ),
      ),
    );
    list.append(row);
  }
  return h(
    'section',
    { class: 'rp-panel rp-now' },
    sectionHead(
      tr('ACONTECENDO AGORA'),
      tr('Quem está trabalhando e em quê'),
      h('span', { class: 'rp-small', text: agents.length === 1 ? tr('1 agente neste roadmap') : tr('{0} agentes neste roadmap', [agents.length]) }),
    ),
    agents.length
      ? list
      : emptyState('person', tr('Nenhum agente neste roadmap agora'), tr('O trabalho pode estar em outro roadmap ou parado.')),
    h(
      'p',
      { class: 'rp-footnote' },
      icon('info'),
      h('span', {
        text: tr('Trabalho em andamento e bloqueio são estados diferentes: o bloqueado não avança até a dependência sair.'),
      }),
    ),
  );
}

function renderPhaseStrip(roadmap: Roadmap, actions: AppActions): HTMLElement {
  const grid = h('div', { class: 'rp-phase-strip__grid' });
  for (const phase of roadmap.phases) {
    const status = phaseStatus(phase);
    const counts = phaseCounts(phase);
    grid.append(
      h(
        'button',
        {
          class: `rp-phase-mini is-${status}${phase.id === roadmap.currentPhaseId ? ' is-current' : ''}`,
          attrs: { type: 'button' },
          on: { click: () => actions.openPhase(phase.id, undefined, roadmap.id) },
        },
        h(
          'span',
          { class: 'rp-phase-mini__top' },
          h('span', { class: 'rp-phase-mini__index', text: String(phase.index).padStart(2, '0') }),
          statusPill(status),
        ),
        h('span', { class: 'rp-phase-mini__name', text: phase.name }),
        h(
          'span',
          { class: 'rp-phase-mini__meta' },
          h('span', { text: tr('{0}/{1}', [counts.done, counts.total]) }),
          phase.id === roadmap.currentPhaseId ? h('span', { class: 'rp-current-tag', text: tr('atual') }) : null,
        ),
        statusBar(
          phase.plans.map((p) => ({ status: p.status, label: `${p.id} ${p.title}` })),
          { size: 'sm', label: tr('Progresso da fase {0}', [phase.index]) },
        ),
      ),
    );
  }
  return h(
    'section',
    { class: 'rp-panel rp-phase-strip' },
    sectionHead(
      tr('TODAS AS FASES'),
      tr('O caminho completo'),
      h(
        'button',
        { class: 'rp-btn rp-btn--ghost', attrs: { type: 'button' }, on: { click: () => actions.setVariant('phases') } },
        h('span', { text: tr('Ver lista completa') }),
        icon('arrowRight'),
      ),
    ),
    grid,
  );
}

function renderMilestone(roadmap: Roadmap, actions: AppActions): HTMLElement {
  const m = roadmap.milestone;
  const doneCriteria = m.criteria.filter((c) => c.done).length;
  const criteria = h('ul', { class: 'rp-criteria rp-criteria--compact' });
  for (const criterion of m.criteria) {
    criteria.append(
      h(
        'li',
        { class: criterion.done ? 'is-done' : '' },
        h('span', { class: 'rp-check', attrs: { 'aria-hidden': 'true' } }, criterion.done ? icon('check') : null),
        h('span', { text: criterion.text }),
      ),
    );
  }
  const plans = h('div', { class: 'rp-milestone__plans' });
  for (const id of m.planIds) {
    const plan = planById(roadmap.id, id);
    if (!plan) continue;
    plans.append(
      h(
        'button',
        { class: `rp-plan-chip is-${plan.status}`, attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
        statusDot(plan.status),
        h('span', { text: `${plan.id} ${plan.title}` }),
      ),
    );
  }
  const blocked = m.planIds.filter((id) => planById(roadmap.id, id)?.status === 'blocked').length;
  const phase = phaseById(roadmap.id, m.phaseId);
  return h(
    'section',
    { class: 'rp-panel rp-milestone' },
    sectionHead(tr('PRÓXIMO MARCO'), m.title, statusPill(m.status === 'at-risk' ? 'risk' : m.status === 'done' || m.status === 'review' ? m.status : 'active')),
    m.date ? h('p', { class: 'rp-milestone__date' }, icon('calendar'), h('span', { text: `${m.date} · ${m.daysLeft}` })) : null,
    m.summary ? h('p', { class: 'rp-body', text: m.summary }) : null,
    m.criteria.length
      ? h(
          'div',
          { class: 'rp-subhead' },
          h('h3', { class: 'rp-h3', text: tr('Critérios do marco') }),
          h('span', { class: 'rp-small', text: tr('{0} de {1} atendidos', [doneCriteria, m.criteria.length]) }),
        )
      : null,
    m.criteria.length ? criteria : null,
    m.planIds.length
      ? h(
          'p',
          { class: 'rp-footnote' },
          icon('info'),
          h('span', {
            text: tr('O marco depende dos {0} planos abaixo; {1} bloqueado(s).', [m.planIds.length, blocked]),
          }),
        )
      : null,
    m.planIds.length ? plans : null,
    phase
      ? h(
          'button',
          { class: 'rp-btn rp-btn--ghost', attrs: { type: 'button' }, on: { click: () => actions.openPhase(phase.id, undefined, roadmap.id) } },
          h('span', { text: tr('Ver fase {0}', [phase.index]) }),
          icon('arrowRight'),
        )
      : null,
  );
}

function renderAttention(roadmap: Roadmap, blocked: Plan[], actions: AppActions): HTMLElement {
  const list = h('div', { class: 'rp-block-list' });
  for (const plan of blocked) {
    const blocking = plan.dependencies.filter((d) => d.blocking);
    list.append(
      h(
        'article',
        { class: 'rp-block-card' },
        h(
          'div',
          { class: 'rp-block-card__head' },
          h('span', { class: 'rp-block-card__lock' }, icon('lock')),
          h('div', { class: 'rp-block-card__title' }, h('strong', { text: `${plan.id} ${plan.title}` }), h('span', { class: 'rp-small', text: plan.updatedAt })),
          statusPill('blocked'),
        ),
        h('p', { class: 'rp-block-card__reason', text: plan.blockReason ?? tr('Aguardando dependência.') }),
        h(
          'div',
          { class: 'rp-dep-chips' },
          blocking.map((d) =>
            h('span', { class: 'rp-dep-chip is-blocked' }, icon('lock'), h('span', { text: d.label })),
          ),
        ),
        h(
          'div',
          { class: 'rp-block-card__actions' },
          h(
            'button',
            { class: 'rp-btn rp-btn--sm', attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
            h('span', { text: tr('Ver plano') }),
            icon('arrowRight'),
          ),
          h(
            'button',
            {
              class: 'rp-icon-btn rp-icon-btn--sm',
              attrs: { type: 'button', 'aria-label': tr('Conversar sobre o bloqueio de {0}', [plan.id]), title: tr('Conversar sobre o bloqueio') },
              on: { click: () => actions.openConversation({ roadmapId: roadmap.id, kind: 'plan', id: plan.id }) },
            },
            icon('chat'),
          ),
        ),
      ),
    );
  }
  return h(
    'section',
    { class: 'rp-panel rp-attention' },
    sectionHead(tr('PRECISA DE DECISÃO'), tr('Bloqueios ativos'), h('span', { class: 'rp-count-badge', text: String(blocked.length) })),
    blocked.length
      ? list
      : emptyState('check', tr('Nenhum bloqueio ativo'), tr('Este roadmap pode seguir sem uma decisão externa agora.')),
    h('p', { class: 'rp-footnote' }, icon('warning'), h('span', { text: tr('Bloqueado não é o mesmo que em andamento: o item não avança até a dependência sair.') })),
  );
}

function renderActivity(roadmap: Roadmap, actions: AppActions): HTMLElement {
  const list = h('div', { class: 'rp-activity-list' });
  for (const event of roadmap.activity) {
    const agent = agentById(event.agentId);
    if (!agent) continue;
    const plan = event.planId ? planById(roadmap.id, event.planId) : undefined;
    const row = h(
      plan ? 'button' : 'div',
      {
        class: `rp-activity-row is-${event.kind}`,
        ...(plan ? { attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } } : {}),
      },
      h(
        'span',
        { class: 'rp-activity-row__icon' },
        event.kind === 'done' ? icon('check') : event.kind === 'active' ? icon('work') : event.kind === 'blocked' ? icon('lock') : icon('decision'),
      ),
      h(
        'span',
        { class: 'rp-activity-row__main' },
        h(
          'span',
          { class: 'rp-activity-row__line' },
          accountChip(agent),
          h('strong', { text: agent.name }),
          h('span', { text: event.text }),
        ),
        h(
          'span',
          { class: 'rp-activity-row__meta' },
          h('span', { text: `${event.at} · ${event.ago}` }),
          plan ? h('span', { class: 'rp-muted', text: tr('ver plano') }) : null,
        ),
      ),
      plan ? icon('chevronRight', 'rp-activity-row__chevron') : null,
    );
    list.append(row);
  }
  return h(
    'section',
    { class: 'rp-panel rp-activity' },
    sectionHead(tr('ATIVIDADE RECENTE'), tr('O que mudou no roadmap'), h('span', { class: 'rp-small', text: tr('feed do pipeline') })),
    roadmap.activity.length
      ? list
      : emptyState('clock', tr('Sem atividade recente'), tr('O pipeline ainda não registrou mudanças neste roadmap.')),
    h('p', { class: 'rp-footnote' }, icon('clock'), h('span', { text: tr('Snapshot de {0} · {1}.', [roadmap.snapshotAt, roadmap.snapshotLabel]) })),
  );
}

// ---------------------------------------------------------------- fases e detalhe

export function renderPhases(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = selectedRoadmap(state);
  const filterActive = state.filter !== 'all' || state.search.trim().length > 0;
  const visible = roadmap.phases.map((phase) => {
    const searchMatchesPhase = state.search.trim().length > 0 && normalizeSearch([phase.name, phase.objective].join(' ')).includes(normalizeSearch(state.search));
    const plans = phase.plans.filter((plan) => {
      if (state.filter !== 'all' && plan.status !== state.filter) return false;
      if (state.search.trim().length > 0 && !searchMatchesPhase && !planMatches(plan, state.search)) return false;
      return true;
    });
    return { phase, plans };
  }).filter(({ plans }) => plans.length > 0);
  const totalPlans = visible.reduce((acc, v) => acc + v.plans.length, 0);

  return h(
    'div',
    { class: 'rp-view rp-phases' },
    h(
      'div',
      { class: 'rp-phases__layout' },
      renderPhaseBrowser(state, actions, roadmap, visible, totalPlans, filterActive),
      renderDetail(state, actions, roadmap),
    ),
    state.detailOpen
      ? h('div', {
          class: 'rp-backdrop rp-backdrop--detail',
          attrs: { 'aria-hidden': 'true' },
          on: { click: () => actions.closeDetail() },
        })
      : null,
  );
}

// ---------------------------------------------------------------- backlog

function renderBacklog(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = selectedRoadmap(state);
  const allPlans = roadmapPlans(roadmap);
  const typePlans = allPlans.filter((p) => state.backlogType === 'all' || p.type === state.backlogType);
  const typeCountsValue = typeCounts(allPlans);
  const statusCountsValue = countPlans(typePlans);
  const query = state.search.trim();
  const visiblePlans = typePlans.filter((p) => {
    if (state.filter !== 'all' && p.status !== state.filter) return false;
    if (query && !planMatches(p, query)) return false;
    return true;
  });
  const visible = roadmap.phases
    .map((phase) => ({ phase, plans: phase.plans.filter((p) => visiblePlans.includes(p)) }))
    .filter(({ plans }) => plans.length > 0);
  const openBugs = allPlans.filter((p) => p.type === 'bug' && p.status !== 'done').length;
  const filterActive = state.filter !== 'all' || state.backlogType !== 'all' || query.length > 0;

  return h(
    'div',
    { class: 'rp-view rp-backlog' },
    h(
      'div',
      { class: 'rp-phases__layout' },
      renderBacklogBrowser(
        state,
        actions,
        roadmap,
        visible,
        visiblePlans.length,
        filterActive,
        typeCountsValue,
        statusCountsValue,
        openBugs,
      ),
      renderDetail(state, actions, roadmap),
    ),
    state.detailOpen
      ? h('div', {
          class: 'rp-backdrop rp-backdrop--detail',
          attrs: { 'aria-hidden': 'true' },
          on: { click: () => actions.closeDetail() },
        })
      : null,
  );
}

function renderBacklogBrowser(
  state: AppState,
  actions: AppActions,
  roadmap: Roadmap,
  visible: { phase: Phase; plans: Plan[] }[],
  totalVisible: number,
  filterActive: boolean,
  types: ReturnType<typeof typeCounts>,
  statuses: StatusCounts,
  openBugs: number,
): HTMLElement {
  const typeOptions: { id: AppState['backlogType']; label: string; count: number }[] = [
    { id: 'all', label: tr('Tudo'), count: types.total },
    { id: 'story', label: tr('Histórias'), count: types.story },
    { id: 'task', label: tr('Tasks'), count: types.task },
    { id: 'bug', label: tr('Bugs'), count: types.bug },
  ];
  const typeRow = h('div', { class: 'rp-type-filter', attrs: { role: 'group', 'aria-label': tr('Filtrar por tipo de item') } });
  for (const opt of typeOptions) {
    typeRow.append(
      h(
        'button',
        {
          class: `rp-filter rp-filter--type${state.backlogType === opt.id ? ' is-active' : ''}`,
          attrs: { type: 'button', 'aria-pressed': String(state.backlogType === opt.id) },
          on: { click: () => actions.setBacklogType(opt.id) },
        },
        opt.id !== 'all' ? typeChip(opt.id) : h('span', { text: opt.label }),
        h('span', { class: 'rp-filter__count', text: String(opt.count) }),
      ),
    );
  }

  const statusRow = h('div', { class: 'rp-filter-group', attrs: { role: 'group', 'aria-label': tr('Filtrar por status') } });
  for (const filter of FILTERS) {
    const count = filter.id === 'all' ? statuses.total : statuses[filter.id];
    statusRow.append(
      h(
        'button',
        {
          class: `rp-filter${state.filter === filter.id ? ' is-active' : ''}`,
          attrs: { type: 'button', 'aria-pressed': String(state.filter === filter.id) },
          on: { click: () => actions.setFilter(filter.id) },
        },
        h('span', { text: filter.label }),
        h('span', { class: 'rp-filter__count', text: String(count) }),
      ),
    );
  }

  const list = h('div', { class: 'rp-backlog-list' });
  for (const { phase, plans } of visible) {
    const expanded = state.expandedPhases.has(phase.id);
    const phaseCountsValue = countPlans(phase.plans);
    const header = h(
      'button',
      {
        class: 'rp-backlog-epic__head',
        attrs: { type: 'button', 'aria-expanded': String(expanded) },
        on: { click: () => actions.togglePhase(phase.id) },
      },
      h('span', { class: 'rp-backlog-epic__index', text: tr('ÉPICO {0}', [String(phase.index).padStart(2, '0')]) }),
      h('span', { class: 'rp-backlog-epic__title', text: phase.name }),
      h('span', { class: 'rp-backlog-epic__meta', text: tr('{0} de {1} itens · {2} visíveis', [phaseCountsValue.done, phaseCountsValue.total, plans.length]) }),
      statusPill(phaseStatus(phase)),
      icon(expanded ? 'chevronDown' : 'chevronRight', 'rp-chevron'),
    );
    list.append(
      h(
        'article',
        { class: 'rp-backlog-epic' },
        header,
        expanded
          ? h(
              'div',
              { class: 'rp-backlog-epic__body' },
              plans.map((plan) => renderBacklogRow(plan, roadmap, state.selectedPlanId === plan.id, actions)),
            )
          : null,
      ),
    );
  }
  if (visible.length === 0) {
    list.append(
      emptyState(
        'search',
        tr('Nenhum item encontrado'),
        tr('Ajuste o tipo, o status ou a busca para ver o backlog.'),
        h(
          'button',
          {
            class: 'rp-btn',
            attrs: { type: 'button' },
            on: {
              click: () => {
                actions.setBacklogType('all');
                actions.setFilter('all');
                actions.setSearch('');
              },
            },
          },
          h('span', { text: tr('Limpar filtros') }),
        ),
      ),
    );
  }

  return h(
    'section',
    { class: 'rp-panel rp-browser rp-backlog-browser' },
    h(
      'div',
      { class: 'rp-browser__head' },
      h(
        'div',
        { class: 'rp-browser__title' },
        h('p', { class: 'rp-eyebrow', text: tr('BACKLOG · ITENS') }),
        h('h1', { class: 'rp-h1 rp-browser__h1', text: tr('Épicos, histórias, tasks e bugs') }),
        h('p', {
          class: 'rp-lede rp-lede--small',
          text: tr('{0} itens · {1} bugs abertos · {2} em andamento', [types.total, openBugs, statuses.active]),
        }),
      ),
      h(
        'div',
        { class: 'rp-browser__actions' },
        h(
          'button',
          {
            class: 'rp-btn rp-btn--primary',
            attrs: { type: 'button' },
            on: { click: () => actions.openConversation({ roadmapId: roadmap.id, kind: 'roadmap' }) },
          },
          icon('chat'),
          h('span', { text: tr('Pedir mudança ao agente') }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'rp-backlog-toolbar' },
      h('div', { class: 'rp-backlog-toolbar__types' }, typeRow),
      h(
        'label',
        { class: 'rp-search' },
        icon('search'),
        h('input', {
          id: 'rp-search',
          attrs: {
            type: 'search',
            value: state.search,
            placeholder: tr('Buscar item, bug ou agente…'),
            'aria-label': tr('Buscar item, bug ou agente'),
          },
          on: { input: (event) => actions.setSearch((event.target as HTMLInputElement).value) },
        }),
      ),
    ),
    h('div', { class: 'rp-backlog-toolbar__status' }, statusRow),
    h(
      'div',
      { class: 'rp-result-line' },
      h('span', {
        text: filterActive
          ? tr('{0} itens no filtro', [totalVisible])
          : tr('{0} itens · {1} épicos', [types.total, roadmap.phases.length]),
      }),
      filterActive
        ? h(
            'button',
            {
              class: 'rp-link',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  actions.setBacklogType('all');
                  actions.setFilter('all');
                  actions.setSearch('');
                },
              },
            },
            h('span', { text: tr('Limpar filtros') }),
          )
        : null,
    ),
    list,
  );
}

function renderBacklogRow(plan: Plan, roadmap: Roadmap, selected: boolean, actions: AppActions): HTMLElement {
  const agent = ownerOf(plan);
  const links = workLinks(plan, roadmap);
  const origin = links.find((l) => l.type === 'caused_by' && l.direction === 'out');
  const fix = links.find((l) => l.type === 'fixes' && l.direction === 'in');
  const firstLink = origin ?? links[0];
  const subline =
    plan.type === 'bug' && origin
      ? tr('originado por {0} {1}{2}', [
          origin.target?.id ?? '—',
          origin.target?.title ?? '',
          fix ? tr(' · corrigido por {0}', [fix.target?.id ?? '—']) : '',
        ])
      : firstLink
        ? tr('{0} {1} {2}', [firstLink.label, firstLink.target?.id ?? '', firstLink.target?.title ?? ''])
        : tr('{0} · atualizado {1}', [agent?.name ?? tr('sem agente'), plan.updatedAt]);

  return h(
    'button',
    {
      class: `rp-backlog-row is-${plan.status} is-type-${plan.type}${selected ? ' is-selected' : ''}`,
      id: `rp-plan-${plan.id}`,
      attrs: { type: 'button', 'aria-current': selected ? 'true' : null },
      on: { click: () => actions.openPlan(plan.id, plan.roadmapId) },
    },
    h('span', { class: 'rp-backlog-row__type' }, typeChip(plan.type)),
    h(
      'span',
      { class: 'rp-backlog-row__main' },
      h('span', { class: 'rp-backlog-row__title' }, h('strong', { text: `${plan.id} ${plan.title}` }), planStatusPill(plan)),
      h('span', { class: 'rp-backlog-row__sub' }, h('span', { text: subline })),
    ),
    h(
      'span',
      { class: 'rp-backlog-row__side' },
      h(
        'span',
        { class: 'rp-backlog-row__estimate' },
        sizeChip(plan.size),
        h('span', {
          text: plan.estimate
            ? tr('{0}–{1} tokens', [compactTokens(plan.estimate.p50), compactTokens(plan.estimate.p80)])
            : tr('Sem estimativa'),
        }),
      ),
      links.length ? h('span', { class: 'rp-backlog-row__links' }, icon('layers'), h('span', { text: String(links.length) })) : null,
      icon('chevronRight', 'rp-chevron'),
    ),
  );
}

function renderPhaseBrowser(
  state: AppState,
  actions: AppActions,
  roadmap: Roadmap,
  visible: { phase: Phase; plans: Plan[] }[],
  totalPlans: number,
  filterActive: boolean,
): HTMLElement {
  const counts = overallCounts(roadmap);
  const active = roadmapPlans(roadmap).filter((p) => p.status === 'active');
  const nowChips = active.map((plan) => {
    const agent = ownerOf(plan);
    return h(
      'button',
      { class: 'rp-now-chip', attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
      statusDot(plan.status),
      h('span', { class: 'rp-now-chip__id', text: plan.id }),
      h('span', { class: 'rp-now-chip__title', text: plan.title }),
      h('span', { class: 'rp-now-chip__agent', text: agent?.name ?? tr('sem agente') }),
    );
  });

  const filterRow = h('div', { class: 'rp-filter-group', attrs: { role: 'group', 'aria-label': tr('Filtrar planos por status') } });
  for (const filter of FILTERS) {
    const count = filter.id === 'all' ? counts.total : counts[filter.id];
    filterRow.append(
      h(
        'button',
        {
          class: `rp-filter${state.filter === filter.id ? ' is-active' : ''}`,
          attrs: { type: 'button', 'aria-pressed': String(state.filter === filter.id) },
          on: { click: () => actions.setFilter(filter.id) },
        },
        h('span', { text: filter.label }),
        h('span', { class: 'rp-filter__count', text: String(count) }),
      ),
    );
  }

  const list = h('div', { class: 'rp-phase-list' });
  for (const { phase, plans } of visible) {
    const expanded = state.expandedPhases.has(phase.id);
    const status = phaseStatus(phase);
    const phaseCountsValue = countPlans(phase.plans);
    const blockedCount = phaseCountsValue.blocked;
    const header = h(
      'button',
      {
        class: 'rp-phase__head',
        attrs: { type: 'button', 'aria-expanded': String(expanded) },
        on: { click: () => actions.togglePhase(phase.id) },
      },
      h('span', { class: 'rp-phase__index', text: String(phase.index).padStart(2, '0') }),
      h(
        'span',
        { class: 'rp-phase__title' },
        h(
          'span',
          { class: 'rp-phase__name-line' },
          h('strong', { text: phase.name }),
          phase.id === roadmap.currentPhaseId ? h('span', { class: 'rp-current-tag', text: tr('atual') }) : null,
        ),
      ),
      h('span', {
        class: 'rp-phase__summary',
        text:
          blockedCount > 0
            ? tr('{0} de {1} planos · {2}', [phaseCountsValue.done, phaseCountsValue.total, countLabel('blocked', blockedCount)])
            : phaseCountsValue.active > 0
              ? tr('{0} de {1} planos · {2}', [phaseCountsValue.done, phaseCountsValue.total, countLabel('active', phaseCountsValue.active)])
              : phaseCountsValue.review > 0
                ? tr('{0} de {1} planos · {2}', [phaseCountsValue.done, phaseCountsValue.total, countLabel('review', phaseCountsValue.review)])
                : tr('{0} de {1} planos', [phaseCountsValue.done, phaseCountsValue.total]),
      }),
      h(
        'span',
        { class: 'rp-phase__badges' },
        blockedCount > 0 ? h('span', { class: 'rp-alert-badge' }, icon('lock'), h('span', { text: String(blockedCount) })) : null,
        statusPill(status),
      ),
      h('span', { class: 'rp-phase__chevron' }, icon(expanded ? 'chevronDown' : 'chevronRight', 'rp-chevron')),
    );

    const body = expanded
      ? h(
          'div',
          { class: 'rp-phase__body' },
          h('p', { class: 'rp-phase__objective', text: phase.objective }),
          h(
            'div',
            { class: 'rp-plan-list' },
            plans.map((plan) => renderPlanRow(plan, state.selectedPlanId === plan.id, actions)),
          ),
        )
      : null;

    list.append(
      h(
        'article',
        {
          class: `rp-phase${phase.id === roadmap.currentPhaseId ? ' is-current' : ''}${status === 'blocked' ? ' is-blocked' : ''}`,
          id: `rp-phase-${phase.id}`,
        },
        header,
        body,
      ),
    );
  }

  if (visible.length === 0) {
    list.append(
      emptyState(
        'search',
        tr('Nenhum plano encontrado'),
        tr('Ajuste o filtro ou limpe a busca para ver o roadmap completo.'),
        h(
          'button',
          {
            class: 'rp-btn',
            attrs: { type: 'button' },
            on: {
              click: () => {
                actions.setFilter('all');
                actions.setSearch('');
              },
            },
          },
          h('span', { text: tr('Limpar filtros') }),
        ),
      ),
    );
  }

  return h(
    'section',
    { class: 'rp-panel rp-browser' },
    h(
      'div',
      { class: 'rp-browser__head' },
      h(
        'div',
        { class: 'rp-browser__title' },
        h('p', { class: 'rp-eyebrow', text: tr('PLANO DE FASES') }),
        h('h1', { class: 'rp-h1 rp-browser__h1', text: tr('Roadmap completo') }),
        h('p', { class: 'rp-lede rp-lede--small', text: tr('{0} fases · {1} planos · {2} concluídos', [roadmap.phases.length, counts.total, counts.done]) }),
      ),
      h(
        'div',
        { class: 'rp-browser__actions' },
        h(
          'button',
          {
            class: 'rp-btn rp-btn--primary',
            attrs: { type: 'button' },
            on: { click: () => actions.openConversation({ roadmapId: roadmap.id, kind: 'roadmap' }) },
          },
          icon('chat'),
          h('span', { text: tr('Pedir mudança ao agente') }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'rp-now-strip' },
      h('span', { class: 'rp-now-strip__label' }, icon('work'), h('span', { text: tr('AGORA') })),
      h('div', { class: 'rp-now-strip__chips' }, nowChips),
      h(
        'button',
        { class: 'rp-btn rp-btn--sm rp-now-strip__jump', attrs: { type: 'button' }, on: { click: () => actions.jumpToCurrent() } },
        icon('target'),
        h('span', { text: tr('Ir para o trabalho atual') }),
      ),
    ),
    h(
      'div',
      { class: 'rp-filters' },
      filterRow,
      h(
        'label',
        { class: 'rp-search' },
        icon('search'),
        h('input', {
          id: 'rp-search',
          attrs: {
            type: 'search',
            value: state.search,
            placeholder: tr('Buscar fase, plano ou agente…'),
            'aria-label': tr('Buscar fase, plano ou agente'),
          },
          on: { input: (event) => actions.setSearch((event.target as HTMLInputElement).value) },
        }),
      ),
    ),
    h(
      'div',
      { class: 'rp-result-line' },
      h('span', {
        text: filterActive
          ? tr('{0} fases · {1} planos no filtro', [visible.length, totalPlans])
          : tr('{0} fases · {1} planos', [roadmap.phases.length, counts.total]),
      }),
      filterActive
        ? h(
            'button',
            {
              class: 'rp-link',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  actions.setFilter('all');
                  actions.setSearch('');
                },
              },
            },
            h('span', { text: tr('Limpar filtros') }),
          )
        : null,
    ),
    list,
  );
}

function renderPlanRow(plan: Plan, selected: boolean, actions: AppActions): HTMLElement {
  const agent = ownerOf(plan);
  const step = nextPendingStep(plan);
  const counts = planStepCounts(plan);
  const depChips = plan.dependencies.filter((d) => d.status !== 'done');
  const visibleDeps = depChips.slice(0, 2);
  const extraDeps = depChips.length - visibleDeps.length;
  const statusLine =
    plan.status === 'review'
      ? h('span', { class: 'rp-plan-row__status is-review' }, icon('work'), h('span', { text: tr('Em revisão · {0}', [plan.updatedAt]) }))
      : plan.status === 'active'
        ? h('span', { class: 'rp-plan-row__status is-active' }, icon('work'), h('span', { text: tr('Agora: {0}', [step?.title ?? plan.nextStep ?? plan.title]) }))
        : plan.status === 'blocked'
        ? h('span', { class: 'rp-plan-row__status is-blocked' }, icon('lock'), h('span', { text: plan.blockReason ?? tr('Aguardando dependência.') }))
          : plan.status === 'done'
            ? h('span', { class: 'rp-plan-row__status is-done' }, icon('check'), h('span', { text: tr('Concluído · {0}', [plan.updatedAt]) }))
            : h('span', { class: 'rp-plan-row__status is-future' }, icon('clock'), h('span', { text: planStatusLabel(plan) === 'Backlog' ? tr('No backlog') : planStatusLabel(plan) === 'Pronto' ? tr('Pronto para começar') : tr('Planejado · sem trabalho ativo') }));

  return h(
    'button',
    {
      class: `rp-plan-row is-${plan.status}${selected ? ' is-selected' : ''}`,
      id: `rp-plan-${plan.id}`,
      attrs: { type: 'button', 'aria-current': selected ? 'true' : null },
      on: { click: () => actions.openPlan(plan.id, plan.roadmapId) },
    },
    statusDot(plan.status),
    h(
      'span',
      { class: 'rp-plan-row__main' },
      h(
        'span',
        { class: 'rp-plan-row__title' },
        typeDot(plan.type),
        h('strong', { text: `${plan.id} ${plan.title}` }),
        h('span', { class: 'rp-plan-row__meta' }, agent ? `${agent.name} · ${planProgressText(plan)}` : planProgressText(plan)),
      ),
      statusLine,
      visibleDeps.length
        ? h(
            'span',
            { class: 'rp-dep-chips' },
            visibleDeps.map((dep) =>
              h(
                'span',
                { class: `rp-dep-chip is-${dep.status}` },
                statusDot(dep.status),
                h('span', { text: dep.label }),
              ),
            ),
            extraDeps > 0 ? h('span', { class: 'rp-dep-chip rp-dep-chip--more', text: `+${extraDeps}` }) : null,
          )
        : null,
    ),
    h(
      'span',
      { class: 'rp-plan-row__side' },
      sizeChip(plan.size),
      planStatusPill(plan),
      h('span', { class: 'rp-plan-row__steps', text: tr('{0}/{1}', [counts.done, counts.total]) }),
      icon('chevronRight', 'rp-chevron'),
    ),
  );
}

function renderDetail(state: AppState, actions: AppActions, roadmap: Roadmap): HTMLElement {
  return h(
    'section',
    { class: `rp-panel rp-detail${state.detailOpen ? ' is-open' : ''}`, id: 'rp-detail', attrs: { 'aria-label': tr('Detalhe do plano') } },
    h(
      'button',
      { class: 'rp-detail__back', attrs: { type: 'button' }, on: { click: () => actions.closeDetail() } },
      icon('chevronLeft'),
      h('span', { text: tr('Voltar') }),
    ),
    renderPlanDetail(state, actions, roadmap),
  );
}

function renderPlanDetail(state: AppState, actions: AppActions, roadmap: Roadmap): HTMLElement {
  const plan = planById(roadmap.id, state.selectedPlanId) ?? defaultPlanFor(roadmap);
  const phase = phaseById(roadmap.id, plan.phaseId)!;
  const agent = ownerOf(plan);
  const counts = planStepCounts(plan);
  const doneCriteria = plan.criteria.filter((c) => c.done).length;
  const blockedDeps = plan.dependencies.filter((d) => d.planId && d.status === 'blocked');
  const related = plan.status === 'active' ? blockedDeps[0] : undefined;
  const relatedPlan = related?.planId ? planById(related.roadmapId ?? roadmap.id, related.planId) : undefined;

  return h(
    'div',
    { class: 'rp-detail__inner' },
    h(
      'div',
      { class: 'rp-detail__head' },
      h(
        'div',
        { class: 'rp-detail__crumbs' },
        h('span', { text: tr('{0} · Fase {1} · {2}', [roadmap.title, phase.index, phase.name]) }),
        icon('chevronRight'),
        h('span', { text: tr('Plano {0}', [plan.id]) }),
      ),
      h(
        'div',
        { class: 'rp-detail__title-row' },
        h('div', { class: 'rp-detail__title-main' }, typeChip(plan.type), h('h2', { class: 'rp-h2', text: plan.title })),
        planStatusPill(plan),
      ),
      h(
        'div',
        { class: 'rp-detail__meta' },
        agent ? agentIdentity(agent, { compact: true }) : null,
        h('span', { class: 'rp-muted', text: tr('Atualizado {0}', [plan.updatedAt]) }),
        h('span', { class: 'rp-muted', text: planProgressText(plan) }),
        estimateSummary(plan),
        executionLine(plan),
      ),
      h(
        'div',
        { class: 'rp-detail__actions' },
        h(
          'button',
          {
            class: 'rp-btn rp-btn--sm',
            id: `rp-chat-${plan.id}`,
            attrs: { type: 'button' },
            on: { click: () => actions.openConversation({ roadmapId: roadmap.id, kind: 'plan', id: plan.id }) },
          },
          icon('chat'),
          h('span', { text: tr('Perguntar sobre este plano') }),
        ),
      ),
    ),
    statusBar(
      plan.steps.map((s) => ({ status: s.status, label: s.title })),
      { label: tr('Progresso do plano {0}: {1}', [plan.id, planProgressText(plan)]), size: 'md' },
    ),
    h(
      'div',
      { class: 'rp-detail__body' },
      h('section', { class: 'rp-detail__section' }, h('h3', { class: 'rp-h3', text: tr('Objetivo') }), h('p', { class: 'rp-body', text: plan.objective })),
      renderEstimateCard(plan),
      plan.status === 'blocked' ? renderBlockCallout(plan, actions) : null,
      relatedPlan && related
        ? h(
            'div',
            { class: 'rp-related-block' },
            h('span', { class: 'rp-related-block__icon' }, icon('lock')),
            h(
              'div',
              { class: 'rp-related-block__text' },
              h('strong', { text: tr('Bloqueio no caminho') }),
              h('p', { text: tr('{0} {1} está bloqueado e segura o marco. {2}', [relatedPlan.id, relatedPlan.title, related.detail ?? '']) }),
            ),
            h(
              'button',
              { class: 'rp-btn rp-btn--sm', attrs: { type: 'button' }, on: { click: () => actions.openPlan(relatedPlan.id, relatedPlan.roadmapId) } },
              h('span', { text: tr('Ver {0}', [relatedPlan.id]) }),
            ),
          )
        : null,
      renderSteps(plan),
      renderCriteria(plan, doneCriteria),
      renderDependencies(plan, roadmap, actions),
      renderLinks(plan, roadmap, actions),
      renderDecisions(plan),
    ),
    h(
      'div',
      { class: 'rp-detail__footer' },
      h(
        'button',
        {
          class: 'rp-btn rp-btn--primary',
          attrs: { type: 'button' },
          on: { click: () => chatPlan(actions, plan) },
        },
        icon('chat'),
        h('span', { text: tr('Perguntar sobre este plano') }),
      ),
      h('span', { class: 'rp-small rp-muted', text: tr('A resposta vem do agente conectado ao Hermes Pipeline') }),
    ),
  );
}

function renderBlockCallout(plan: Plan, actions: AppActions): HTMLElement {
  return h(
    'section',
    { class: 'rp-block-callout' },
    h(
      'div',
      { class: 'rp-block-callout__head' },
      h('span', { class: 'rp-block-callout__icon' }, icon('lock')),
      h('div', null, h('h3', { class: 'rp-h3', text: tr('Motivo do bloqueio') }), h('span', { class: 'rp-small', text: tr('Desde {0}', [plan.blockedSince ?? tr('hoje')]) })),
      statusPill('blocked'),
    ),
    h('p', { class: 'rp-body', text: plan.blockReason ?? tr('Aguardando dependência.') }),
    plan.unblock?.length
      ? h(
          'div',
          { class: 'rp-block-callout__unblock' },
          h('h4', { class: 'rp-label', text: tr('O que destrava') }),
          h(
            'ul',
            { class: 'rp-unblock-list' },
            plan.unblock.map((item) => h('li', null, h('span', { class: 'rp-check' }, icon('check')), h('span', { text: item }))),
          ),
        )
      : null,
    h(
      'div',
      { class: 'rp-block-callout__actions' },
      h(
        'button',
        {
          class: 'rp-btn rp-btn--sm',
          attrs: { type: 'button' },
          on: { click: () => actions.openConversation({ roadmapId: plan.roadmapId, kind: 'plan', id: plan.id }) },
        },
        icon('chat'),
        h('span', { text: tr('Conversar sobre o bloqueio') }),
      ),
    ),
  );
}

function renderSteps(plan: Plan): HTMLElement {
  const counts = planStepCounts(plan);
  const list = h('ol', { class: 'rp-steps' });
  plan.steps.forEach((step, index) => {
    const label =
      step.status === 'done'
        ? tr('concluída')
        : step.status === 'active'
          ? tr('em andamento')
          : step.status === 'blocked'
            ? tr('bloqueada')
            : tr('pendente');
    list.append(
      h(
        'li',
        {
          class: `rp-step is-${step.status}`,
          attrs: { 'aria-current': step.status === 'active' ? 'step' : null },
        },
        h(
          'span',
          { class: 'rp-step__mark', attrs: { 'aria-hidden': 'true' } },
          step.status === 'done' ? icon('check') : step.status === 'blocked' ? icon('lock') : step.status === 'active' ? h('span', { class: 'rp-step__pulse' }) : h('span', { class: 'rp-step__empty' }),
        ),
        h(
          'span',
          { class: 'rp-step__main' },
          h('span', { class: 'rp-step__index', text: String(index + 1).padStart(2, '0') }),
          h('strong', { text: step.title }),
          step.note ? h('span', { class: 'rp-step__note', text: step.note }) : null,
        ),
        h('span', { class: 'rp-step__state', text: label }),
      ),
    );
  });
  return h(
    'section',
    { class: 'rp-detail__section' },
    h(
      'div',
      { class: 'rp-detail__section-head' },
      h('h3', { class: 'rp-h3', text: tr('Etapas em ordem') }),
      h('span', { class: 'rp-small', text: tr('{0} de {1} concluídas', [counts.done, counts.total]) }),
    ),
    list,
  );
}

function renderCriteria(plan: Plan, done: number): HTMLElement {
  const list = h('ul', { class: 'rp-criteria' });
  for (const criterion of plan.criteria) {
    list.append(
      h(
        'li',
        { class: criterion.done ? 'is-done' : '' },
        h('span', { class: 'rp-check', attrs: { 'aria-hidden': 'true' } }, criterion.done ? icon('check') : null),
        h('span', { text: criterion.text }),
      ),
    );
  }
  return h(
    'section',
    { class: 'rp-detail__section' },
    h(
      'div',
      { class: 'rp-detail__section-head' },
      h('h3', { class: 'rp-h3', text: tr('Critérios de aceite') }),
      h('span', { class: 'rp-small', text: tr('{0} de {1} atendidos', [done, plan.criteria.length]) }),
    ),
    list,
  );
}

function renderDependencies(plan: Plan, roadmap: Roadmap, actions: AppActions): HTMLElement {
  const list = h('ul', { class: 'rp-deps' });
  for (const dep of plan.dependencies) {
    const content = h(
      'span',
      { class: 'rp-dep__main' },
      h(
        'span',
        { class: 'rp-dep__line' },
        h('span', { class: 'rp-dep__icon' }, icon(dependencyIcon(dep))),
        h('strong', { text: dep.label }),
        dep.blocking ? h('span', { class: 'rp-dep__blocking', text: tr('bloqueia') }) : null,
      ),
      dep.detail ? h('span', { class: 'rp-dep__detail', text: dep.detail }) : null,
    );
    const action = dep.planId
      ? h(
          'button',
          {
            class: 'rp-link rp-dep__open',
            attrs: { type: 'button' },
            on: { click: () => actions.openPlan(dep.planId!, dep.roadmapId ?? roadmap.id) },
          },
          h('span', { text: tr('Abrir') }),
          icon('chevronRight'),
        )
      : null;
    list.append(
      h(
        'li',
        { class: `rp-dep${dep.blocking ? ' is-blocking' : ''}` },
        content,
        h('span', { class: 'rp-dep__side' }, statusPill(dep.status), action),
      ),
    );
  }
  return h(
    'section',
    { class: 'rp-detail__section' },
    h('div', { class: 'rp-detail__section-head' }, h('h3', { class: 'rp-h3', text: tr('Dependências') }), h('span', { class: 'rp-small', text: tr('{0}', [plan.dependencies.length]) })),
    list,
  );
}

function renderEstimateCard(plan: Plan): HTMLElement {
  const estimate = plan.estimate;
  const actual = plan.actual?.tokens;
  const pct = actual && estimate && estimate.p50 > 0 ? Math.min(100, Math.round((actual / estimate.p50) * 100)) : 0;
  const days = estimate?.humanDays;
  const confidence =
    estimate?.confidence === 'high' ? tr('alta') : estimate?.confidence === 'medium' ? tr('média') : tr('baixa');
  return h(
    'section',
    { class: 'rp-detail__section' },
    h(
      'div',
      { class: 'rp-detail__section-head' },
      h('h3', { class: 'rp-h3', text: tr('Peso e estimativa') }),
      h('span', { class: 'rp-small', text: estimate ? tr('P50 / P80') : tr('sem estimativa') }),
    ),
    h(
      'div',
      { class: 'rp-estimate-card' },
      h(
        'div',
        { class: 'rp-estimate-card__top' },
        sizeChip(plan.size),
        h('strong', { text: plan.size ? tr('Peso {0}', [plan.size]) : tr('Sem peso no pipeline') }),
        estimate ? h('span', { class: 'rp-small', text: tr('confiança {0}', [confidence]) }) : null,
      ),
      estimate
        ? h(
            'div',
            { class: 'rp-estimate-card__numbers' },
            h('span', null, h('strong', { text: compactTokens(estimate.p50) }), h('span', { text: tr('P50 tokens') })),
            h('span', null, h('strong', { text: compactTokens(estimate.p80) }), h('span', { text: tr('P80 tokens') })),
            days != null ? h('span', null, h('strong', { text: String(days) }), h('span', { text: tr('dias humanos (derivado)') })) : null,
          )
        : h('p', { class: 'rp-small rp-muted', text: tr('O pipeline não registra estimativa para este item.') }),
      h('p', { class: 'rp-small rp-muted', text: estimate?.basis ?? tr('Estimativa ausente no snapshot.') }),
      h('p', { class: 'rp-estimate-card__why', text: plan.sizeBasis }),
      actual
        ? h(
            'div',
            { class: 'rp-estimate-card__actual' },
            estimate
              ? h('div', { class: 'rp-estimate-bar', attrs: { role: 'progressbar', 'aria-label': tr('Realizado sobre o P50'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct } }, h('span', { style: { width: `${pct}%` } }))
              : null,
            h('span', {
              class: 'rp-small',
              text: estimate
                ? tr('realizado {0} tokens ({1}% do P50)', [compactTokens(actual), pct])
                : tr('realizado {0} tokens', [compactTokens(actual)]),
            }),
          )
        : h('p', { class: 'rp-small rp-muted', text: tr('Sem consumo registrado ainda.') }),
      h('p', { class: 'rp-footnote' }, icon('info'), h('span', { text: tr('Faixa P50/P80: planejamento, não promessa. O realizado vem da sessão vinculada.') })),
    ),
  );
}

function renderLinks(plan: Plan, roadmap: Roadmap, actions: AppActions): HTMLElement {
  const links = workLinks(plan, roadmap);
  const list = h('ul', { class: 'rp-links' });
  for (const link of links) {
    const target = link.target;
    list.append(
      h(
        'li',
        { class: `rp-link-row is-${link.type}` },
        h('span', { class: 'rp-link-row__label' }, icon('layers'), h('span', { text: link.label })),
        h(
          'span',
          { class: 'rp-link-row__main' },
          target ? h('strong', { text: `${target.id} ${target.title}` }) : h('strong', { text: tr('Item removido') }),
          target ? h('span', { class: 'rp-small', text: workTypeLabel(target.type) }) : null,
        ),
        target ? planStatusPill(target) : null,
        target
          ? h(
              'button',
              {
                class: 'rp-link rp-link-row__open',
                attrs: { type: 'button' },
                on: { click: () => actions.openPlan(target.id, target.roadmapId) },
              },
              h('span', { text: tr('Abrir') }),
              icon('chevronRight'),
            )
          : null,
      ),
    );
  }
  if (!links.length) list.append(h('li', { class: 'rp-small rp-muted', text: tr('Nenhum vínculo registrado.') }));
  return h(
    'section',
    { class: 'rp-detail__section' },
    h(
      'div',
      { class: 'rp-detail__section-head' },
      h('h3', { class: 'rp-h3', text: tr('Vínculos') }),
      h('span', { class: 'rp-small', text: String(links.length) }),
    ),
    list,
  );
}

function renderDecisions(plan: Plan): HTMLElement {
  const list = h('ol', { class: 'rp-decisions' });
  for (const decision of plan.decisions) {
    list.append(
      h(
        'li',
        { class: 'rp-decision' },
        h('span', { class: 'rp-decision__date', text: decision.date }),
        h('span', { class: 'rp-decision__text' }, h('span', { text: decision.text }), h('span', { class: 'rp-decision__by', text: tr('por {0}', [decision.by]) })),
      ),
    );
  }
  if (!plan.decisions.length) {
    list.append(h('li', { class: 'rp-decision rp-decision--empty', text: tr('Nenhuma decisão registrada neste plano.') }));
  }
  return h(
    'section',
    { class: 'rp-detail__section' },
    h('div', { class: 'rp-detail__section-head' }, h('h3', { class: 'rp-h3', text: tr('Decisões') }), h('span', { class: 'rp-small', text: tr('{0}', [plan.decisions.length]) })),
    list,
  );
}

// ---------------------------------------------------------------- trabalho agora

export function renderWork(state: AppState, actions: AppActions): HTMLElement {
  const roadmap = selectedRoadmap(state);
  const plans = roadmapPlans(roadmap);
  const active = plans.filter((p) => p.status === 'active');
  const blocked = plans.filter((p) => p.status === 'blocked');
  const review = plans.filter((p) => p.status === 'review');
  const allFuture = plans.filter((p) => p.status === 'future');
  const future = allFuture.slice(0, 3);
  const current = workFocus(roadmap);
  // Sem trabalho em foco, os botões levam ao item padrão; o cartão diz que não há nada em andamento.
  const focus = current ?? defaultPlanFor(roadmap);
  const focusAgent = ownerOf(focus);
  const focusStep = nextPendingStep(focus);

  return h(
    'div',
    { class: 'rp-view rp-work' },
    h(
      'section',
      { class: 'rp-panel rp-focus' },
      h(
        'div',
        { class: 'rp-focus__copy' },
        h('p', { class: 'rp-eyebrow', text: tr('TRABALHO AGORA · {0}', [roadmap.title]) }),
        h('h1', { class: 'rp-h1 rp-focus__title', text: roadmap.workHeadline }),
        h('p', { class: 'rp-lede', text: roadmap.workLede }),
        h(
          'div',
          { class: 'rp-focus__actions' },
          h(
            'button',
            { class: 'rp-btn rp-btn--primary', attrs: { type: 'button' }, on: { click: () => actions.openPlan(focus.id, roadmap.id) } },
            h('span', { text: current ? tr('Abrir plano atual') : tr('Abrir roadmap em fases') }),
            icon('arrowRight'),
          ),
          h(
            'button',
            {
              class: 'rp-btn',
              attrs: { type: 'button' },
              on: { click: () => actions.openConversation({ roadmapId: roadmap.id, kind: 'plan', id: focus.id }) },
            },
            icon('chat'),
            h('span', { text: focusAgent ? tr('Perguntar a {0}', [focusAgent.name]) : tr('Perguntar ao agente') }),
          ),
        ),
        h(
          'div',
          { class: 'rp-focus__metrics' },
          h('div', { class: 'rp-focus__metric' }, h('strong', { text: String(active.length) }), h('span', { text: tr('em andamento') })),
          h('div', { class: 'rp-focus__metric is-blocked' }, h('strong', { text: String(blocked.length) }), h('span', { text: tr('bloqueados') })),
          h('div', { class: 'rp-focus__metric' }, h('strong', { text: roadmap.milestone.daysLeft }), h('span', { text: tr('para o marco') })),
        ),
      ),
      current
        ? h(
            'div',
            { class: 'rp-focus__card' },
            h('div', { class: 'rp-focus__card-top' }, h('span', { class: 'rp-label', text: tr('FOCO ATUAL') }), planStatusPill(focus)),
            h('h2', { class: 'rp-h2', text: `${focus.id} ${focus.title}` }),
            h('p', { class: 'rp-body', text: focus.objective }),
            focusAgent ? agentIdentity(focusAgent, { compact: true }) : null,
            focus.status === 'active'
              ? h('p', { class: 'rp-focus__step' }, icon('work'), h('span', { text: tr('Agora: {0}', [focusStep?.title ?? focus.nextStep ?? focus.title]) }))
              : focus.status === 'review'
                ? h('p', { class: 'rp-focus__step' }, icon('clock'), h('span', { text: tr('Terminado pelo agente; espera a sua revisão.') }))
                : null,
            statusBar(
              focus.steps.map((s) => ({ status: s.status, label: s.title })),
              { label: tr('Progresso do plano {0}', [focus.id]), size: 'md' },
            ),
            h('span', { class: 'rp-small rp-muted', text: planProgressText(focus) }),
            estimateSummary(focus),
          )
        : h(
            'div',
            { class: 'rp-focus__card' },
            h('span', { class: 'rp-label', text: tr('FOCO ATUAL') }),
            h('h2', { class: 'rp-h2', text: tr('Nada em andamento') }),
            h('p', { class: 'rp-body', text: tr('Nenhum item está sendo trabalhado nem esperando revisão neste roadmap.') }),
          ),
    ),
    h(
      'div',
      { class: 'rp-work-grid' },
      renderWorkLane(tr('Em andamento'), active.length, 'active', active.map((p) => renderWorkCard(p, actions))),
      review.length ? renderWorkLane(tr('Em revisão'), review.length, 'review', review.map((p) => renderWorkCard(p, actions))) : null,
      renderWorkLane(tr('Bloqueado'), blocked.length, 'blocked', blocked.map((p) => renderWorkCard(p, actions))),
      renderWorkLane(
        tr('A seguir'),
        allFuture.length,
        'future',
        future.map((p) => renderWorkCard(p, actions)),
        tr('{0} de {1} futuros aparecem aqui', [future.length, allFuture.length]),
      ),
    ),
    h(
      'div',
      { class: 'rp-work-bottom' },
      renderBlockerChain(roadmap, actions),
      renderMilestoneExpectations(roadmap, actions),
    ),
  );
}

function renderWorkLane(title: string, count: number, status: string, cards: HTMLElement[], note?: string): HTMLElement {
  return h(
    'section',
    { class: `rp-lane is-${status}` },
    h(
      'div',
      { class: 'rp-lane__head' },
      h('h2', { class: 'rp-h3', text: title }),
      h('span', { class: 'rp-lane__count', text: String(count) }),
    ),
    note ? h('p', { class: 'rp-lane__note', text: note }) : null,
    h('div', { class: 'rp-lane__cards' }, cards.length ? cards : h('p', { class: 'rp-small rp-muted', text: tr('Nada nesta faixa agora.') })),
  );
}

function renderWorkCard(plan: Plan, actions: AppActions): HTMLElement {
  const agent = ownerOf(plan);
  const counts = planStepCounts(plan);
  const step = nextPendingStep(plan);
  const blocking = plan.dependencies.filter((d) => d.blocking);
  return h(
    'article',
    { class: `rp-work-card is-${plan.status}` },
    h(
      'div',
      { class: 'rp-work-card__top' },
      planStatusPill(plan),
      h('span', { class: 'rp-small rp-muted', text: plan.updatedAt }),
    ),
    h(
      'button',
      { class: 'rp-work-card__title', attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, plan.roadmapId) } },
      h('strong', { text: `${plan.id} ${plan.title}` }),
    ),
    h('p', { class: 'rp-work-card__objective', text: plan.objective }),
    agent ? agentIdentity(agent, { compact: true }) : h('span', { class: 'rp-small rp-muted', text: tr('Sem agente em atividade') }),
    h(
      'div',
      { class: 'rp-work-card__progress' },
      statusBar(
        plan.steps.map((s) => ({ status: s.status, label: s.title })),
        { label: tr('Progresso do plano {0}', [plan.id]), size: 'sm' },
      ),
      h('span', { class: 'rp-small', text: tr('{0}/{1} etapas', [counts.done, counts.total]) }),
    ),
    h(
      'span',
      { class: 'rp-work-card__effort' },
      sizeChip(plan.size),
      h('span', {
        text: plan.estimate
          ? tr('{0}–{1} tokens', [compactTokens(plan.estimate.p50), compactTokens(plan.estimate.p80)])
          : tr('Sem estimativa'),
      }),
    ),
    plan.status === 'blocked'
      ? h(
          'div',
          { class: 'rp-work-card__block' },
          h('p', { text: plan.blockReason ?? tr('Aguardando dependência.') }),
          blocking.length
            ? h(
                'div',
                { class: 'rp-dep-chips' },
                blocking.map((dep) => h('span', { class: 'rp-dep-chip is-blocked' }, icon('lock'), h('span', { text: dep.label }))),
              )
            : null,
        )
      : h(
          'p',
          { class: `rp-work-card__next is-${plan.status}` },
          icon(plan.status === 'future' ? 'clock' : 'work'),
          h('span', {
            text:
              plan.status === 'future'
                ? planStatusLabel(plan) === 'Backlog'
                  ? tr('No backlog')
                  : planStatusLabel(plan) === 'Pronto'
                    ? tr('Pronto para começar')
                    : tr('Planejado · sem trabalho ativo')
                : tr('Agora: {0}', [step?.title ?? plan.nextStep ?? plan.title]),
          }),
        ),
    h(
      'div',
      { class: 'rp-work-card__actions' },
      h(
        'button',
        { class: 'rp-btn rp-btn--sm', attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, plan.roadmapId) } },
        h('span', { text: tr('Abrir plano') }),
        icon('arrowRight'),
      ),
      h(
        'button',
        {
          class: 'rp-icon-btn rp-icon-btn--sm',
          attrs: { type: 'button', 'aria-label': tr('Perguntar sobre {0}', [plan.id]), title: tr('Perguntar sobre {0}', [plan.id]) },
          on: {
            click: () =>
              actions.openConversation({ roadmapId: plan.roadmapId, kind: 'plan', id: plan.id }),
          },
        },
        icon('chat'),
      ),
    ),
  );
}

function renderBlockerChain(roadmap: Roadmap, actions: AppActions): HTMLElement {
  if (!roadmap.blockerChain.length) {
    return h(
      'section',
      { class: 'rp-panel rp-chain-panel' },
      sectionHead(tr('CAMINHO DO BLOQUEIO'), tr('De que o trabalho travado depende')),
      emptyState('check', tr('Nenhum bloqueio ativo'), tr('O pipeline não registra bloqueio neste roadmap agora.')),
    );
  }
  const chain = h('div', { class: 'rp-chain' });
  roadmap.blockerChain.forEach((node, index) => {
    if (index > 0) {
      chain.append(h('span', { class: 'rp-chain__arrow' }, icon('chevronDown'), h('span', { text: tr('depende de') })));
    }
    chain.append(renderChainNode(roadmap, node, actions));
  });
  const external = [...roadmap.blockerChain].reverse().find((n) => n.kind === 'external');
  return h(
    'section',
    { class: 'rp-panel rp-chain-panel' },
    sectionHead(tr('CAMINHO DO BLOQUEIO'), tr('De que o trabalho travado depende')),
    chain,
    h(
      'p',
      { class: 'rp-footnote' },
      icon('info'),
      h('span', {
        text: external
          ? tr('A {0} é a raiz deste bloqueio. O restante do roadmap segue.', [external.label])
          : tr('O restante do roadmap segue enquanto este caminho não destrava.'),
      }),
    ),
  );
}

function renderChainNode(roadmap: Roadmap, node: ChainNode, actions: AppActions): HTMLElement {
  if (node.kind === 'plan' && node.planId) {
    const plan = planById(roadmap.id, node.planId);
    if (plan) {
      return h(
        'button',
        { class: `rp-chain__node is-${plan.status}`, attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
        h('span', { class: 'rp-chain__node-top' }, statusDot(plan.status), h('strong', { text: `${plan.id} ${plan.title}` }), planStatusPill(plan)),
        h('span', { class: 'rp-chain__node-meta', text: tr('{0} · {1}', [ownerOf(plan)?.name ?? tr('sem agente'), plan.updatedAt]) }),
      );
    }
  }
  return h(
    'div',
    { class: `rp-chain__node is-${node.status}${node.kind === 'external' ? ' is-external' : ''}` },
    h('span', { class: 'rp-chain__node-top' }, icon('external'), h('strong', { text: node.label }), statusPill(node.status, node.status === 'active' ? tr('em análise') : undefined)),
    node.detail ? h('span', { class: 'rp-chain__node-meta', text: node.detail }) : null,
  );
}

function renderMilestoneExpectations(roadmap: Roadmap, actions: AppActions): HTMLElement {
  const m = roadmap.milestone;
  const doneCriteria = m.criteria.filter((c) => c.done).length;
  const criteria = h('ul', { class: 'rp-criteria' });
  for (const criterion of m.criteria) {
    criteria.append(
      h(
        'li',
        { class: criterion.done ? 'is-done' : '' },
        h('span', { class: 'rp-check' }, criterion.done ? icon('check') : null),
        h('span', { text: criterion.text }),
      ),
    );
  }
  const plans = h('div', { class: 'rp-milestone__plans' });
  for (const id of m.planIds) {
    const plan = planById(roadmap.id, id);
    if (!plan) continue;
    plans.append(
      h(
        'button',
        { class: `rp-plan-chip is-${plan.status}`, attrs: { type: 'button' }, on: { click: () => actions.openPlan(plan.id, roadmap.id) } },
        statusDot(plan.status),
        h('span', { text: `${plan.id} ${plan.title}` }),
        planStatusPill(plan),
      ),
    );
  }
  const phase = phaseById(roadmap.id, m.phaseId);
  return h(
    'section',
    { class: 'rp-panel rp-milestone-panel' },
    sectionHead(tr('O QUE O MARCO ESPERA'), m.title, statusPill(m.status === 'at-risk' ? 'risk' : 'active')),
    m.date ? h('p', { class: 'rp-milestone__date' }, icon('calendar'), h('span', { text: `${m.date} · ${m.daysLeft}` })) : null,
    m.summary ? h('p', { class: 'rp-body', text: m.summary }) : null,
    m.criteria.length
      ? h('div', { class: 'rp-subhead' }, h('h3', { class: 'rp-h3', text: tr('Critérios') }), h('span', { class: 'rp-small', text: tr('{0} de {1}', [doneCriteria, m.criteria.length]) }))
      : null,
    m.criteria.length ? criteria : null,
    m.planIds.length ? plans : null,
    phase
      ? h(
          'button',
          { class: 'rp-btn rp-btn--ghost', attrs: { type: 'button' }, on: { click: () => actions.openPhase(phase.id, undefined, roadmap.id) } },
          h('span', { text: tr('Ver fase {0}', [phase.index]) }),
          icon('arrowRight'),
        )
      : null,
  );
}
