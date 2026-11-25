// Tradução do snapshot do Hermes Pipeline para o modelo das telas e hidratação dos
// índices em memória. Este arquivo é o único ponto que conhece o formato da API.
import { intlLocale, tr } from '../../../shared/i18n';
import {
  replaceAgents,
  replaceRoadmaps,
  replaceSessions,
  type Activity,
  type Actual,
  type Agent,
  type AvatarId,
  type ChainNode,
  type Criterion,
  type Decision,
  type Dependency,
  type Estimate,
  type ExecutionLink,
  type LinkType,
  type Phase,
  type PipelineStatus,
  type Plan,
  type PlanStatus,
  type Provider,
  type Roadmap,
  type Session,
  type Size,
  type Step,
  type WorkLink,
} from './data';
import {
  getRoadmap,
  getRoadmapStatus,
  listRoadmapExecutions,
  listRoadmaps,
  PipelineError,
  type ApiActivity,
  type ApiDependency,
  type ApiItem,
  type ApiItemExecution,
  type ApiRoadmap,
  type ApiSession,
  type ApiSnapshot,
} from './pipeline';

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
};

const PROVIDER_COLOR: Record<Provider, string> = {
  claude: '#f08a3c',
  codex: '#a77bf3',
  opencode: '#5cc97b',
  hermes: '#d4a34a',
};

const AVATARS: AvatarId[] = ['nina', 'teo', 'lia', 'hugo', 'cora', 'bento'];

function providerFromHarness(harness: string): Provider {
  const value = harness.toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('codex')) return 'codex';
  if (value.includes('opencode')) return 'opencode';
  return 'hermes';
}

function providerFromExecution(provider: string): Provider {
  return providerFromHarness(provider);
}

function sizeOf(value: string): Size {
  return value === 'XS' || value === 'S' || value === 'M' || value === 'L' || value === 'XL' ? value : 'M';
}

function planStatus(status: PipelineStatus): PlanStatus {
  if (status === 'done') return 'done';
  if (status === 'blocked') return 'blocked';
  if (status === 'in_progress' || status === 'review') return 'active';
  return 'future';
}

function dependencyStatus(status: string): PlanStatus {
  if (status === 'done') return 'done';
  if (status === 'blocked' || status === 'pending') return 'blocked';
  if (status === 'active' || status === 'in_progress' || status === 'review') return 'active';
  return 'future';
}

function confidence(value: number): 'low' | 'medium' | 'high' {
  if (value >= 0.75) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function humanize(value: string): string {
  return capitalize(value.replace(/[-_]+/g, ' ').trim());
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(intlLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return tr('agora');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('há {0} min', [minutes]);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr('há {0} h', [hours]);
  const days = Math.round(hours / 24);
  if (days < 30) return tr('há {0} dias', [days]);
  return formatDateTime(iso);
}

function avatarFor(id: string): AvatarId {
  if (id === 'nina') return 'nina';
  if (id === 'leitor') return 'teo';
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATARS[hash % AVATARS.length]!;
}

function statusLabel(status: Agent['status']): string {
  if (status === 'working') return tr('Trabalhando');
  if (status === 'blocked') return tr('Bloqueado');
  return tr('Ocioso');
}

interface ItemIndexEntry {
  item: ApiItem;
  phase: string;
}

function itemIndex(snapshots: ApiSnapshot[]): Map<string, ItemIndexEntry> {
  const index = new Map<string, ItemIndexEntry>();
  for (const snapshot of snapshots) {
    for (const phase of snapshot.roadmap.phases ?? []) {
      for (const item of phase.items ?? []) index.set(item.id, { item, phase: phase.id });
    }
  }
  return index;
}

interface AgentContext {
  items: Map<string, ItemIndexEntry>;
  roadmapTitles: Map<string, string>;
}

function agentFromSession(session: ApiSession, context: AgentContext): Agent {
  const provider = providerFromHarness(session.harness);
  const current = session.currentItemId ? context.items.get(session.currentItemId)?.item : undefined;
  const status: Agent['status'] =
    current?.status === 'blocked' ? 'blocked' : current && (current.status === 'in_progress' || current.status === 'review') ? 'working' : 'idle';
  const readOnly = !session.capabilities.includes('roadmap.write');
  return {
    id: session.agentId,
    name: session.displayName || capitalize(session.agentId),
    role: readOnly ? tr('Somente leitura') : session.model && session.model !== 'none' ? session.model : PROVIDER_LABEL[provider],
    provider,
    color: PROVIDER_COLOR[provider],
    short: (session.displayName || session.agentId).slice(0, 1).toUpperCase(),
    avatar: avatarFor(session.agentId),
    status,
    statusLabel: statusLabel(status),
    ...(current ? { currentRoadmapId: current.roadmapId, currentPlanId: current.key } : {}),
    ...(!current && session.roadmapIds[0] ? { currentRoadmapId: session.roadmapIds[0] } : {}),
    roadmapIds: [...session.roadmapIds],
    since: formatAgo(session.lastSeen),
    ...(status === 'idle' ? { note: tr('Sem item em foco neste momento.') } : {}),
  };
}

function ownerAgent(id: string, name: string, roadmapTitle: string): Agent {
  return {
    id,
    name,
    role: tr('Responsável por {0}', [roadmapTitle]),
    provider: 'hermes',
    color: PROVIDER_COLOR.hermes,
    short: name.slice(0, 1).toUpperCase(),
    avatar: avatarFor(id),
    status: 'idle',
    statusLabel: statusLabel('idle'),
    since: '—',
    note: tr('Sem sessão conectada a este roadmap.'),
  };
}

function buildAgents(snapshots: ApiSnapshot[], sessions: ApiSession[], context: AgentContext): Map<string, Agent> {
  const agents = new Map<string, Agent>();
  for (const session of sessions) agents.set(session.agentId, agentFromSession(session, context));

  const ensure = (id: string, name: string, roadmapTitle: string): void => {
    if (!agents.has(id)) agents.set(id, ownerAgent(id, name, roadmapTitle));
  };

  for (const snapshot of snapshots) {
    const roadmap = snapshot.roadmap;
    const ownerId = slug(roadmap.owner) || 'responsavel';
    ensure(ownerId, roadmap.owner, roadmap.title);
    for (const phase of roadmap.phases ?? []) {
      for (const item of phase.items ?? []) {
        if (item.ownerId) ensure(item.ownerId, capitalize(item.ownerId), roadmap.title);
      }
    }
    for (const activity of roadmap.activity ?? []) {
      const actor = activity.actor === 'seed' ? 'pipeline' : activity.actor;
      if (!agents.has(actor)) {
        agents.set(actor, {
          id: actor,
          name: actor === 'pipeline' ? tr('Hermes Pipeline') : capitalize(actor),
          role: actor === 'pipeline' ? tr('Fonte da verdade') : tr('Registro do roadmap'),
          provider: 'hermes',
          color: PROVIDER_COLOR.hermes,
          short: actor === 'pipeline' ? 'H' : actor.slice(0, 1).toUpperCase(),
          avatar: avatarFor(actor),
          status: 'idle',
          statusLabel: statusLabel('idle'),
          since: '—',
        });
      }
    }
  }
  return agents;
}

function mapSessions(sessions: ApiSession[], titles: Map<string, string>): Session[] {
  return sessions.map((session) => {
    const provider = providerFromHarness(session.harness);
    return {
      id: session.id,
      agentId: session.agentId,
      provider,
      title: session.roadmapIds.map((id) => titles.get(id) ?? id).join(' · ') || tr('Sem roadmap vinculado'),
      status: session.status === 'active' ? 'active' : 'idle',
      lastSeen: formatAgo(session.lastSeen),
      workspace: session.roadmapIds.map((id) => titles.get(id) ?? id).join(' · ') || tr('Hermes Pipeline'),
      harness: session.harness,
      model: session.model,
      capabilities: [...session.capabilities],
      roadmapIds: [...session.roadmapIds],
      currentItemId: session.currentItemId,
    };
  });
}

function mapSteps(item: ApiItem): Step[] {
  return (item.steps ?? []).map((title) => ({
    title,
    status: item.status === 'done' ? 'done' : 'pending',
  }));
}

function mapCriteria(criteria: { text: string; done: boolean }[] | null): Criterion[] {
  return (criteria ?? []).map((criterion) => ({ text: criterion.text, done: Boolean(criterion.done) }));
}

function mapDependencies(dependencies: ApiDependency[] | null): Dependency[] {
  return (dependencies ?? []).map((dep) => ({
    kind: dep.kind,
    label: dep.label,
    status: dependencyStatus(dep.status),
    ...(dep.detail ? { detail: dep.detail } : {}),
    ...(dep.targetId ? { planId: dep.targetId } : {}),
    ...(dep.targetRoadmapId ? { roadmapId: dep.targetRoadmapId } : {}),
    ...(dep.blocking ? { blocking: true } : {}),
  }));
}

function mapLinks(links: ApiItem['links']): WorkLink[] {
  return (links ?? []).map((link) => ({
    type: link.kind as LinkType,
    targetId: link.targetId,
    ...(link.targetRoadmapId ? { targetRoadmapId: link.targetRoadmapId } : {}),
  }));
}

function mapDecisions(decisions: ApiItem['decisions']): Decision[] {
  return (decisions ?? []).map((decision) => ({
    date: formatDateTime(decision.date),
    text: decision.text,
    by: decision.by,
  }));
}

function mapEstimate(estimate: ApiItem['estimate']): Estimate | null {
  if (!estimate) return null;
  return {
    unit: 'tokens',
    p50: estimate.p50,
    p80: estimate.p80,
    confidence: confidence(estimate.confidence),
    sample: estimate.sample,
    basis: estimate.basis,
    ...(estimate.humanDays != null ? { humanDays: estimate.humanDays } : {}),
  };
}

function mapActual(actual: ApiItem['actual']): Actual | undefined {
  if (!actual) return undefined;
  return {
    ...(actual.tokens != null ? { tokens: actual.tokens } : {}),
    ...(actual.days != null ? { days: actual.days } : {}),
    ...(actual.sessions != null ? { sessions: actual.sessions } : {}),
    updatedAt: formatDateTime(actual.updatedAt),
  };
}

function mapExecution(execution: ApiItem['execution']): ExecutionLink | undefined {
  if (!execution) return undefined;
  return {
    provider: providerFromExecution(execution.provider),
    sessionId: execution.sessionId,
    agentId: execution.agentId,
  };
}

function mapPlan(item: ApiItem): Plan {
  const steps = mapSteps(item);
  const nextStep = steps.find((step) => step.status === 'pending')?.title;
  const actual = mapActual(item.actual);
  const execution = mapExecution(item.execution);
  const estimate = mapEstimate(item.estimate);
  return {
    id: item.key,
    apiId: item.id,
    key: item.key,
    roadmapId: item.roadmapId,
    phaseId: item.phaseId,
    parentId: item.parentId ?? '',
    index: item.index,
    title: item.title,
    type: item.type,
    status: planStatus(item.status),
    pipelineStatus: item.status,
    priority: item.priority,
    ownerId: item.ownerId,
    objective: item.objective,
    steps,
    criteria: mapCriteria(item.criteria),
    dependencies: mapDependencies(item.dependencies),
    decisions: mapDecisions(item.decisions),
    links: mapLinks(item.links),
    size: item.size ? sizeOf(item.size) : null,
    estimate,
    ...(actual ? { actual } : {}),
    ...(execution ? { execution } : {}),
    sizeBasis: item.size ? tr('Peso {0} definido no Hermes Pipeline.', [item.size]) : tr('Sem peso registrado no Hermes Pipeline.'),
    ...(item.blockReason ? { blockReason: item.blockReason } : {}),
    ...(item.unblock?.length ? { unblock: item.unblock } : {}),
    ...(nextStep ? { nextStep } : {}),
    ...(item.status === 'blocked' ? { blockedSince: formatDateTime(item.updatedAt) } : {}),
    updatedAt: formatDateTime(item.updatedAt),
    revision: item.revision,
  };
}

function mapPhase(phase: ApiSnapshot['roadmap']['phases'][number]): Phase {
  return {
    id: phase.id,
    roadmapId: (phase.items ?? [])[0]?.roadmapId ?? '',
    index: phase.index,
    name: phase.name,
    objective: phase.objective,
    ownerId: phase.ownerId,
    pipelineStatus: phase.status,
    plans: (phase.items ?? []).filter((item) => item.status !== 'canceled').map(mapPlan),
    revision: (phase.items ?? [])[0]?.revision,
  };
}

function activityKind(action: string): Activity['kind'] {
  if (action.includes('done')) return 'done';
  if (action.includes('blocked')) return 'blocked';
  if (action.includes('moved') || action.includes('started')) return 'active';
  return 'decision';
}

function mapActivity(activity: ApiActivity, itemKeys: Map<string, string>): Activity {
  return {
    id: String(activity.id),
    at: formatDateTime(activity.at),
    ago: formatAgo(activity.at),
    agentId: activity.actor === 'seed' ? 'pipeline' : activity.actor,
    kind: activityKind(activity.action),
    text: activity.summary,
    ...(activity.itemId && itemKeys.has(activity.itemId) ? { planId: itemKeys.get(activity.itemId)! } : {}),
  };
}

function blockerChain(plans: Plan[]): ChainNode[] {
  const blocked = plans.find((plan) => plan.status === 'blocked');
  if (!blocked) return [];
  const nodes: ChainNode[] = [];
  const seen = new Set<string>();
  const visit = (plan: Plan): void => {
    if (seen.has(plan.id)) return;
    seen.add(plan.id);
    nodes.push({ kind: 'plan', label: `${plan.id} ${plan.title}`, status: plan.status, planId: plan.id });
    for (const dep of plan.dependencies.filter((dependency) => dependency.blocking)) {
      const target = dep.planId ? plans.find((candidate) => candidate.apiId === dep.planId || candidate.id === dep.planId) : undefined;
      if (target) visit(target);
      else nodes.push({ kind: 'external', label: dep.label, status: dep.status, ...(dep.detail ? { detail: dep.detail } : {}) });
    }
  };
  visit(blocked);
  return nodes;
}

function ownerIdFor(owner: string, agents: Map<string, Agent>): string {
  const match = [...agents.values()].find((agent) => agent.name.toLowerCase() === owner.toLowerCase() || agent.id === owner.toLowerCase());
  return match?.id ?? slug(owner) ?? 'responsavel';
}

export function mapRoadmap(snapshot: ApiSnapshot, agents: Map<string, Agent>): Roadmap {
  const api = snapshot.roadmap;
  const plans = (api.phases ?? []).flatMap((phase) => (phase.items ?? []).filter((item) => item.status !== 'canceled').map(mapPlan));
  const itemKeys = new Map<string, string>();
  for (const phase of api.phases ?? []) for (const item of phase.items ?? []) itemKeys.set(item.id, item.key);
  const active = plans.filter((plan) => plan.status === 'active').length;
  const blocked = plans.filter((plan) => plan.status === 'blocked').length;
  const headline =
    blocked > 0
      ? tr('{0} em andamento, {1} bloqueios e o restante no backlog.', [active, blocked])
      : tr('{0} em andamento e o restante no backlog.', [active]);
  const milestoneTitle = humanize(api.milestone);
  return {
    id: api.id,
    title: api.title,
    subtitle: api.subtitle,
    objective: api.objective,
    status: api.status,
    currentPhaseId: api.currentPhaseId,
    snapshotAt: formatDateTime(snapshot.generatedAt),
    snapshotLabel: tr('revisão {0}', [snapshot.revision]),
    countRule: tr(
      'O progresso conta itens concluídos sobre o total de itens, excluindo cancelados. Peso e estimativa não entram no denominador.',
    ),
    ownerId: ownerIdFor(api.owner, agents),
    updatedAt: formatDateTime(api.updatedAt),
    workHeadline: headline,
    workLede: tr('Acompanhe o que o agente moveu. O Habblaud lê o pipeline e conversa; não altera o roadmap.'),
    phases: (api.phases ?? []).map((phase) => ({
      ...mapPhase(phase),
      roadmapId: api.id,
      plans: (phase.items ?? []).filter((item) => item.status !== 'canceled').map(mapPlan),
    })),
    milestone: {
      id: api.milestone,
      phaseId: api.currentPhaseId,
      title: milestoneTitle,
      date: '',
      daysLeft: tr('sem data'),
      status: blocked > 0 ? 'at-risk' : 'on-track',
      summary: '',
      criteria: [],
      planIds: [],
    },
    activity: (api.activity ?? []).map((activity) => mapActivity(activity, itemKeys)),
    blockerChain: blockerChain(plans),
    revision: snapshot.revision,
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
  };
}

export function hydrateLive(snapshots: ApiSnapshot[], sessions: ApiSession[]): Roadmap[] {
  const items = itemIndex(snapshots);
  const titles = new Map(snapshots.map((snapshot) => [snapshot.roadmap.id, snapshot.roadmap.title]));
  const context: AgentContext = { items, roadmapTitles: titles };
  const agents = buildAgents(snapshots, sessions, context);
  const roadmaps = snapshots.map((snapshot) => mapRoadmap(snapshot, agents));
  replaceAgents([...agents.values()]);
  replaceSessions(mapSessions(sessions, titles));
  replaceRoadmaps(roadmaps);
  return roadmaps;
}

/**
 * O pipeline só registra execuções (não há mais /agent/sessions): as sessões vêm do que ele registrou. Uma por
 * `provider:workerSessionId`; execução sem id de sessão não conta. Da mais antiga para a mais nova, porque
 * `buildAgents` deixa a última de cada agente (perfil) valer.
 */
export function sessionsFromExecutions(executions: readonly ApiItemExecution[]): ApiSession[] {
  const sessions = new Map<string, ApiSession>();
  for (const e of executions) {
    if (!e.workerSessionId) continue;
    const id = `${e.provider}:${e.workerSessionId}`;
    const seen = e.endedAt ?? e.startedAt;
    const running = e.outcome === 'running';
    const known = sessions.get(id);
    if (!known) {
      sessions.set(id, {
        id,
        agentId: e.profile,
        displayName: e.profile,
        harness: e.provider,
        model: e.model,
        status: running ? 'active' : 'idle',
        // Quem executou item registrou no roadmap; sem isso a página o chamaria de "Somente leitura".
        capabilities: ['roadmap.write'],
        roadmapIds: [e.roadmapId],
        currentItemId: running ? e.itemId : null,
        lastSeen: seen,
      });
      continue;
    }
    if (!known.roadmapIds.includes(e.roadmapId)) known.roadmapIds.push(e.roadmapId);
    if (seen > known.lastSeen) Object.assign(known, { agentId: e.profile, displayName: e.profile, model: e.model, lastSeen: seen });
    if (running) Object.assign(known, { status: 'active', currentItemId: e.itemId });
  }
  return [...sessions.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : a.lastSeen > b.lastSeen ? 1 : 0));
}

/** As execuções de um roadmap são auxiliares (chips de agentes): falha do pipeline aqui não derruba a página. */
async function executionsOf(roadmapId: string): Promise<ApiItemExecution[]> {
  try {
    return (await listRoadmapExecutions(roadmapId)).executions;
  } catch (error) {
    if (error instanceof PipelineError) return [];
    throw error;
  }
}

export async function loadLiveData(): Promise<{ snapshots: ApiSnapshot[]; sessions: ApiSession[] }> {
  const status = await getRoadmapStatus();
  if (!status.available) {
    throw new PipelineError(
      503,
      'roadmap_disabled',
      status.reason ?? tr('o roadmap está desligado no servidor do Habblaud'),
      false,
    );
  }
  const { roadmaps } = await listRoadmaps();
  const [snapshots, executions] = await Promise.all([
    Promise.all(roadmaps.map((roadmap) => getRoadmap(roadmap.id))),
    Promise.all(roadmaps.map((roadmap) => executionsOf(roadmap.id))),
  ]);
  return { snapshots, sessions: sessionsFromExecutions(executions.flat()) };
}

export function sourceFor(roadmap: Roadmap | undefined): { revision: number; generatedAt: string; label: string; updatedAt: string } | null {
  if (!roadmap) return null;
  return {
    revision: roadmap.revision,
    generatedAt: roadmap.generatedAt,
    label: roadmap.source,
    updatedAt: roadmap.updatedAt,
  };
}
