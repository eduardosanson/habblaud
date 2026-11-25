// Peças visuais do roadmap: painéis, chips de conta, status, barras segmentadas e
// identidade de agente. Tudo em DOM puro, sem dependência nova.
import { tr } from '../../../shared/i18n';
import type { Agent, Dependency, Plan, PlanStatus, StepStatus, StatusCounts } from './data';
import { planStepCounts } from './data';
import { avatarSvg, ICONS, providerName, type IconName } from './icons';

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
  style?: Record<string, string>;
}

export type Child = Node | string | number | null | undefined | false | Child[];

function appendChild(el: Element, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const nested of child) appendChild(el, nested);
    return;
  }
  if (typeof child === 'string' || typeof child === 'number') {
    el.append(String(child));
    return;
  }
  el.append(child);
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const p = props ?? {};
  const el = document.createElement(tag);
  if (p.class) el.className = p.class;
  if (p.id) el.id = p.id;
  if (p.text != null) el.textContent = p.text;
  if (p.html != null) el.innerHTML = p.html;
  if (p.title) el.title = p.title;
  if (p.attrs) {
    for (const [key, value] of Object.entries(p.attrs)) {
      if (value === false || value == null) el.removeAttribute(key);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (p.style) for (const [key, value] of Object.entries(p.style)) el.style.setProperty(key, value);
  if (p.on) for (const [event, handler] of Object.entries(p.on)) el.addEventListener(event, handler as EventListener);
  for (const child of children) appendChild(el, child);
  return el;
}

export function icon(name: IconName, cls = ''): HTMLElement {
  const el = h('span', { class: `rp-icon${cls ? ` ${cls}` : ''}`, html: ICONS[name] });
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function avatar(agent: Agent, size: 'xs' | 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const el = h('span', { class: `rp-avatar rp-avatar--${size}`, html: avatarSvg(agent.avatar), title: agent.name });
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function accountChip(agent: Agent, size: 'sm' | 'md' = 'sm'): HTMLElement {
  const el = h('span', {
    class: `rp-acc rp-acc--${size}`,
    text: agent.short,
    title: `${agent.name} · ${providerName(agent.provider)}`,
  });
  el.style.setProperty('--acc', agent.color);
  el.dataset.provider = agent.provider;
  el.setAttribute('aria-label', `${agent.name} · ${providerName(agent.provider)}`);
  return el;
}

export function providerTag(provider: Agent['provider'], xs = false): HTMLElement {
  return h('span', {
    class: `rp-provider rp-provider--${provider}${xs ? ' rp-provider--xs' : ''}`,
    text: providerName(provider),
  });
}

export function agentIdentity(
  agent: Agent,
  opts: { compact?: boolean; showRole?: boolean; showProvider?: boolean; size?: 'xs' | 'sm' | 'md' } = {},
): HTMLElement {
  const showRole = opts.showRole ?? !opts.compact;
  const showProvider = opts.showProvider ?? true;
  const text = h(
    'span',
    { class: 'rp-agent__text' },
    h('span', { class: 'rp-agent__name', text: agent.name }),
    showRole ? h('span', { class: 'rp-agent__role', text: agent.role }) : null,
  );
  return h(
    'span',
    { class: `rp-agent${opts.compact ? ' rp-agent--compact' : ''}` },
    avatar(agent, opts.size ?? (opts.compact ? 'xs' : 'sm')),
    text,
    showProvider ? providerTag(agent.provider, opts.compact) : null,
  );
}

export function statusLabel(status: PlanStatus | 'draft' | 'risk'): string {
  if (status === 'done') return tr('Concluído');
  if (status === 'active') return tr('Em andamento');
  if (status === 'review') return tr('Em revisão');
  if (status === 'blocked') return tr('Bloqueado');
  if (status === 'future') return tr('Futuro');
  if (status === 'draft') return tr('Rascunho');
  return tr('Em risco');
}

export function statusPill(status: PlanStatus | 'draft' | 'risk', label?: string, extraClass = ''): HTMLElement {
  return h(
    'span',
    { class: `rp-pill rp-pill--${status}${extraClass ? ` ${extraClass}` : ''}` },
    h('span', { class: 'rp-pill__dot', attrs: { 'aria-hidden': 'true' } }),
    h('span', { text: label ?? statusLabel(status) }),
  );
}

/** Rótulo fiel ao status do pipeline quando ele é mais específico que a faixa da tela. */
export function planStatusLabel(plan: Plan): string {
  if (plan.status === 'future' && plan.pipelineStatus === 'ready') return tr('Pronto');
  if (plan.status === 'future' && plan.pipelineStatus === 'backlog') return tr('Backlog');
  return statusLabel(plan.status);
}

export function planStatusPill(plan: Plan, extraClass = ''): HTMLElement {
  return statusPill(plan.status, planStatusLabel(plan), extraClass);
}

export function statusDot(status: PlanStatus | 'draft' | 'risk'): HTMLElement {
  const el = h('span', { class: `rp-dot rp-dot--${status}` });
  el.setAttribute('aria-label', statusLabel(status));
  el.setAttribute('role', 'img');
  return el;
}

function stepToPlanStatus(status: PlanStatus | StepStatus): PlanStatus {
  if (status === 'pending') return 'future';
  return status;
}

export function statusBar(
  items: readonly { status: PlanStatus | StepStatus; label?: string }[],
  opts: { label?: string; size?: 'sm' | 'md' | 'lg'; className?: string } = {},
): HTMLElement {
  const statuses = items.map((item) => stepToPlanStatus(item.status));
  const done = statuses.filter((s) => s === 'done').length;
  const total = statuses.length;
  const label = opts.label ?? tr('Progresso');
  const bar = h('span', {
    class: `rp-bar rp-bar--${opts.size ?? 'md'}${opts.className ? ` ${opts.className}` : ''}`,
    attrs: {
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': total,
      'aria-valuenow': done,
      'aria-valuetext': tr('{0} de {1} concluídos', [done, total]),
    },
  });
  if (total === 0) {
    bar.append(h('span', { class: 'rp-bar__seg is-future' }));
    return bar;
  }
  statuses.forEach((status, index) => {
    bar.append(
      h('span', {
        class: `rp-bar__seg is-${status}`,
        title: items[index]?.label ?? statusLabel(status),
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  });
  return bar;
}

export function countLabel(kind: PlanStatus, n: number): string {
  if (kind === 'done') return n === 1 ? tr('1 concluído') : tr('{0} concluídos', [n]);
  if (kind === 'active') return n === 1 ? tr('1 em andamento') : tr('{0} em andamento', [n]);
  if (kind === 'review') return tr('{0} em revisão', [n]);
  if (kind === 'blocked') return n === 1 ? tr('1 bloqueado') : tr('{0} bloqueados', [n]);
  return n === 1 ? tr('1 futuro') : tr('{0} futuros', [n]);
}

export function legend(counts: StatusCounts, opts: { skipZero?: boolean } = {}): HTMLElement {
  const el = h('span', { class: 'rp-legend' });
  const kinds: PlanStatus[] = ['done', 'active', 'review', 'blocked', 'future'];
  for (const kind of kinds) {
    const n = counts[kind];
    // "Em revisão" só entra na legenda quando existe.
    if (n === 0 && (opts.skipZero || kind === 'review')) continue;
    el.append(
      h(
        'span',
        { class: 'rp-legend__item' },
        h('span', { class: `rp-legend__swatch is-${kind}`, attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: countLabel(kind, n) }),
      ),
    );
  }
  return el;
}

export function planProgressText(plan: Plan): string {
  const c = planStepCounts(plan);
  return tr('{0} de {1} etapas', [c.done, c.total]);
}

export function agentStatusPill(agent: Agent): HTMLElement {
  if (agent.status === 'working') return statusPill('active', agent.statusLabel);
  if (agent.status === 'blocked') return statusPill('blocked', agent.statusLabel);
  return statusPill('future', agent.statusLabel);
}

export function sectionHead(eyebrow: string, title: string, extra?: Node | null): HTMLElement {
  return h(
    'div',
    { class: 'rp-sec-head' },
    h('div', { class: 'rp-sec-head__text' }, h('p', { class: 'rp-eyebrow', text: eyebrow }), h('h2', { class: 'rp-h2', text: title })),
    extra ? h('div', { class: 'rp-sec-head__extra' }, extra) : null,
  );
}

export function emptyState(iconName: IconName, title: string, text: string, action?: Node | null): HTMLElement {
  return h(
    'div',
    { class: 'rp-empty' },
    h('span', { class: 'rp-empty__icon' }, icon(iconName)),
    h('h3', { class: 'rp-empty__title', text: title }),
    h('p', { class: 'rp-empty__text', text }),
    action ? h('div', { class: 'rp-empty__action' }, action) : null,
  );
}

export function dependencyIcon(dep: Dependency): IconName {
  if (dep.kind === 'plan') return 'layers';
  if (dep.kind === 'phase') return 'flag';
  return 'external';
}

export function timeEl(text: string): HTMLElement {
  return h('time', { class: 'rp-time', text, attrs: { datetime: '' } });
}
