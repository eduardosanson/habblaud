// Modelo de leitura do roadmap do Habblaud.
//
// A fonte da verdade é o Hermes Pipeline: este arquivo só define os tipos que as telas
// consomem e os índices em memória preenchidos por `live.ts` a partir do snapshot/SSE.
// Nada aqui cria item, muda status, estima ou persiste: o Habblaud lê e conversa; quem
// escreve é o agente, pelas ferramentas do pipeline.
import { tr } from '../../../shared/i18n';

export type Provider = 'claude' | 'codex' | 'opencode' | 'hermes';
export type PipelineStatus = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done' | 'canceled';
export type PlanStatus = 'done' | 'active' | 'review' | 'blocked' | 'future';
export type StepStatus = 'done' | 'active' | 'pending' | 'blocked';
export type DepKind = 'plan' | 'phase' | 'external';
export type AgentStatus = 'working' | 'blocked' | 'idle';
export type AvatarId = 'nina' | 'teo' | 'lia' | 'hugo' | 'cora' | 'bento';
export type RoadmapStatus = 'active' | 'archived' | 'draft';
export type WorkItemType = 'story' | 'task' | 'bug';
export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type LinkType = 'blocks' | 'caused_by' | 'fixes' | 'relates_to' | 'duplicates';

export interface Agent {
  /** O registro não diz qual agente foi: a tela não atribui a nenhum provider. */
  anonymous?: boolean;
  id: string;
  name: string;
  role: string;
  provider: Provider;
  color: string;
  short: string;
  avatar: AvatarId;
  status: AgentStatus;
  statusLabel: string;
  currentRoadmapId?: string;
  /** Roadmaps que a sessão declara acompanhar (pode ser mais de um). */
  roadmapIds?: string[];
  currentPlanId?: string;
  since: string;
  note?: string;
}

export interface Step {
  title: string;
  status: StepStatus;
  note?: string;
}

export interface Criterion {
  text: string;
  done: boolean;
}

export interface Dependency {
  kind: DepKind;
  label: string;
  status: PlanStatus;
  detail?: string;
  planId?: string;
  phaseId?: string;
  /** Roadmap do item apontado, quando a dependência cruza roadmaps. */
  roadmapId?: string;
  /** A dependência é a causa direta do bloqueio do plano. */
  blocking?: boolean;
}

export interface Decision {
  date: string;
  text: string;
  by: string;
}

export interface WorkLink {
  type: LinkType;
  targetId: string;
  /** Roadmap do item apontado, quando o vínculo cruza roadmaps. */
  targetRoadmapId?: string;
  note?: string;
}

export interface Estimate {
  unit: 'tokens';
  p50: number;
  p80: number;
  confidence: 'low' | 'medium' | 'high';
  sample: number;
  basis: string;
  /** Faixa derivada para trabalho humano; tokens continuam sendo a unidade principal. */
  humanDays?: number;
}

export interface Actual {
  tokens?: number;
  days?: number;
  sessions?: number;
  updatedAt: string;
}

export interface ExecutionLink {
  provider: Provider;
  sessionId: string;
  agentId: string;
}

/** O que o agente escreveu ao encerrar o trabalho: é com isto que a pessoa decide uma revisão. */
export interface Delivery {
  summary: string;
  author: string;
  model: string;
  at: string;
  changedFiles: string[];
}

export interface Plan {
  /** Chave estável exibida (ex.: 3.7); é o identificador de navegação na UI. */
  id: string;
  /** ID canônico no Hermes Pipeline (ex.: praca-3.7), usado nas ferramentas e no contexto. */
  apiId: string;
  key: string;
  roadmapId: string;
  phaseId: string;
  parentId: string;
  index: number;
  title: string;
  type: WorkItemType;
  status: PlanStatus;
  pipelineStatus: PipelineStatus;
  priority?: string;
  ownerId: string;
  objective: string;
  steps: Step[];
  criteria: Criterion[];
  dependencies: Dependency[];
  decisions: Decision[];
  links: WorkLink[];
  size: Size | null;
  estimate: Estimate | null;
  actual?: Actual;
  execution?: ExecutionLink;
  delivery?: Delivery;
  sizeBasis: string;
  blockReason?: string;
  unblock?: string[];
  updatedAt: string;
  nextStep?: string;
  blockedSince?: string;
  revision?: number;
}

export interface Phase {
  id: string;
  roadmapId: string;
  index: number;
  name: string;
  objective: string;
  ownerId: string;
  pipelineStatus: PipelineStatus;
  plans: Plan[];
  revision?: number;
}

export interface ChainNode {
  kind: 'plan' | 'external';
  label: string;
  status: PlanStatus;
  detail?: string;
  planId?: string;
}

export interface Roadmap {
  id: string;
  title: string;
  subtitle: string;
  objective: string;
  status: RoadmapStatus;
  currentPhaseId: string;
  snapshotAt: string;
  snapshotLabel: string;
  countRule: string;
  ownerId: string;
  updatedAt: string;
  workHeadline: string;
  workLede: string;
  phases: Phase[];
  milestone: Milestone;
  activity: Activity[];
  blockerChain: ChainNode[];
  revision: number;
  source: string;
  generatedAt: string;
}

export interface Milestone {
  id: string;
  phaseId: string;
  title: string;
  date: string;
  daysLeft: string;
  status: 'on-track' | 'at-risk' | 'late' | 'review' | 'done';
  summary: string;
  criteria: { text: string; done: boolean }[];
  planIds: string[];
}

export interface Activity {
  id: string;
  at: string;
  ago: string;
  agentId: string;
  kind: 'done' | 'active' | 'blocked' | 'decision';
  text: string;
  planId?: string;
}

export interface Session {
  id: string;
  agentId: string;
  provider: Provider;
  title: string;
  status: 'active' | 'idle';
  lastSeen: string;
  workspace: string;
  harness: string;
  model: string;
  capabilities: string[];
  roadmapIds: string[];
  currentItemId: string | null;
}

export interface ConversationContext {
  roadmapId: string;
  kind: 'roadmap' | 'phase' | 'plan';
  id?: string;
}

export interface PlanRef {
  roadmapId: string;
  planId: string;
}

export interface StatusCounts {
  done: number;
  active: number;
  review: number;
  blocked: number;
  future: number;
  total: number;
}

// ---------------------------------------------------------------- índices em memória
//
// Mutáveis de propósito: `live.ts` substitui o conteúdo quando chega um snapshot novo.
// As telas sempre leem daqui, então não existe uma segunda cópia de dados.

export const AGENT_LIST: Agent[] = [];
export const AGENTS: Record<string, Agent> = {};
export const ROADMAPS: Roadmap[] = [];
export const ROADMAP_BY_ID = new Map<string, Roadmap>();
export const ALL_PHASES: Phase[] = [];
export const ALL_PLANS: Plan[] = [];
export const PLAN_BY_ID = new Map<string, Plan>();
export const PHASE_BY_ID = new Map<string, Phase>();
export const SESSIONS: Session[] = [];

export function replaceAgents(agents: Agent[]): void {
  AGENT_LIST.splice(0, AGENT_LIST.length, ...agents);
  for (const key of Object.keys(AGENTS)) delete AGENTS[key];
  for (const agent of agents) AGENTS[agent.id] = agent;
}

export function replaceSessions(sessions: Session[]): void {
  SESSIONS.splice(0, SESSIONS.length, ...sessions);
}

export function replaceRoadmaps(roadmaps: Roadmap[]): void {
  ROADMAPS.splice(0, ROADMAPS.length, ...roadmaps);
  ROADMAP_BY_ID.clear();
  ALL_PHASES.splice(0, ALL_PHASES.length);
  ALL_PLANS.splice(0, ALL_PLANS.length);
  PLAN_BY_ID.clear();
  PHASE_BY_ID.clear();
  for (const roadmap of roadmaps) {
    ROADMAP_BY_ID.set(roadmap.id, roadmap);
    for (const phase of roadmap.phases) {
      ALL_PHASES.push(phase);
      PHASE_BY_ID.set(`${roadmap.id}:${phase.id}`, phase);
      for (const plan of phase.plans) {
        ALL_PLANS.push(plan);
        PLAN_BY_ID.set(`${roadmap.id}:${plan.id}`, plan);
      }
    }
  }
}

// ---------------------------------------------------------------- rótulos e consultas

export function workTypeLabel(type: WorkItemType): string {
  if (type === 'story') return tr('História');
  if (type === 'bug') return tr('Bug');
  return tr('Task');
}

export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function countPlans(plans: readonly Plan[]): StatusCounts {
  const counts: StatusCounts = { done: 0, active: 0, review: 0, blocked: 0, future: 0, total: plans.length };
  for (const p of plans) counts[p.status] += 1;
  return counts;
}

export function phaseStatus(phase: Phase): PlanStatus {
  const c = countPlans(phase.plans);
  if (c.blocked > 0) return 'blocked';
  if (c.active > 0) return 'active';
  if (c.total > 0 && c.done === c.total) return 'done';
  if (c.review > 0) return 'review';
  return 'future';
}

export function planStepCounts(plan: Plan): { done: number; total: number; active?: Step; blocked?: Step } {
  const active = plan.steps.find((s) => s.status === 'active');
  const blocked = plan.steps.find((s) => s.status === 'blocked');
  return {
    done: plan.steps.filter((s) => s.status === 'done').length,
    total: plan.steps.length,
    ...(active ? { active } : {}),
    ...(blocked ? { blocked } : {}),
  };
}

export function nextPendingStep(plan: Plan): Step | undefined {
  return plan.steps.find((s) => s.status === 'active') ?? plan.steps.find((s) => s.status === 'blocked') ?? plan.steps.find((s) => s.status === 'pending');
}

export function roadmapById(id: string | null | undefined): Roadmap | undefined {
  return id ? ROADMAP_BY_ID.get(id) : undefined;
}

export function roadmapPlans(roadmap: Roadmap): Plan[] {
  return roadmap.phases.flatMap((p) => p.plans);
}

export function defaultPlanFor(roadmap: Roadmap): Plan {
  const current = roadmap.phases.find((p) => p.id === roadmap.currentPhaseId);
  const plan =
    current?.plans.find((p) => p.status === 'active') ??
    current?.plans.find((p) => p.status === 'blocked') ??
    current?.plans.find((p) => p.status === 'review') ??
    current?.plans[0] ??
    roadmapPlans(roadmap)[0];
  if (!plan) throw new Error('roadmap sem itens');
  return plan;
}

/** O item que alguém está tocando ou que espera uma pessoa; `undefined` quando não há nenhum. */
export function workFocus(roadmap: Roadmap): Plan | undefined {
  const plans = roadmapPlans(roadmap);
  return plans.find((p) => p.status === 'active') ?? plans.find((p) => p.status === 'blocked') ?? plans.find((p) => p.status === 'review');
}

export type RoadmapState = RoadmapStatus | 'done' | 'review';

/**
 * Estado que a tela mostra. O pipeline só diz active/archived/draft: um roadmap ativo cujos itens já terminaram (ou
 * só esperam revisão) não pode aparecer como se alguém estivesse trabalhando nele.
 */
export function roadmapState(roadmap: Roadmap): RoadmapState {
  if (roadmap.status !== 'active') return roadmap.status;
  const c = overallCounts(roadmap);
  if (c.total > 0 && c.done === c.total) return 'done';
  if (c.review > 0 && c.done + c.review === c.total) return 'review';
  return 'active';
}

export function overallCounts(roadmap: Roadmap): StatusCounts {
  return countPlans(roadmapPlans(roadmap));
}

export function phaseCounts(phase: Phase): StatusCounts {
  return countPlans(phase.plans);
}

export function planById(roadmapId: string, id: string): Plan | undefined {
  return (
    PLAN_BY_ID.get(`${roadmapId}:${id}`) ??
    ALL_PLANS.find((plan) => plan.roadmapId === roadmapId && (plan.apiId === id || plan.key === id))
  );
}

export function phaseById(roadmapId: string, id: string): Phase | undefined {
  const direct = PHASE_BY_ID.get(`${roadmapId}:${id}`);
  if (direct) return direct;
  return ROADMAP_BY_ID.get(roadmapId)?.phases.find((phase) => String(phase.index) === id);
}

export function agentById(id: string): Agent | undefined {
  return AGENTS[id];
}

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function planMatches(plan: Plan, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const owner = agentById(plan.ownerId);
  const haystack = [
    plan.id,
    plan.apiId,
    plan.title,
    plan.objective,
    plan.priority ?? '',
    owner?.name ?? '',
    ...plan.steps.map((s) => `${s.title} ${s.note ?? ''}`),
    ...plan.criteria.map((c) => c.text),
    ...plan.dependencies.map((d) => d.label),
    ...plan.decisions.map((d) => d.text),
  ]
    .join(' ')
    .toLowerCase();
  return normalizeSearch(haystack).includes(q);
}

export function phaseMatches(phase: Phase, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = normalizeSearch([phase.name, phase.objective].join(' '));
  return haystack.includes(q) || phase.plans.some((p) => planMatches(p, query));
}

export function contextLabel(context: ConversationContext): string {
  if (context.kind === 'roadmap') return tr('Roadmap');
  if (context.kind === 'phase') {
    const phase = phaseById(context.roadmapId, context.id ?? '');
    return `${tr('Fase')} ${phase?.index ?? context.id ?? ''}`.trim();
  }
  const plan = planById(context.roadmapId, context.id ?? '');
  return `${tr('Plano')} ${plan?.id ?? context.id ?? ''}`.trim();
}

export function contextTitle(context: ConversationContext): string {
  if (context.kind === 'roadmap') return roadmapById(context.roadmapId)?.title ?? tr('Roadmap');
  if (context.kind === 'phase') return phaseById(context.roadmapId, context.id ?? '')?.name ?? tr('Fase');
  return planById(context.roadmapId, context.id ?? '')?.title ?? tr('Plano');
}

// ---------------------------------------------------------------- vínculos, tipos e capacidade

export function linkLabel(type: LinkType, inverse = false): string {
  if (type === 'caused_by') return inverse ? tr('originou') : tr('originado por');
  if (type === 'fixes') return inverse ? tr('corrigido por') : tr('corrige');
  if (type === 'blocks') return inverse ? tr('bloqueado por') : tr('bloqueia');
  if (type === 'duplicates') return inverse ? tr('duplicado por') : tr('duplica');
  return tr('relacionado a');
}

export interface WorkLinkView {
  direction: 'out' | 'in';
  type: LinkType;
  label: string;
  target?: Plan;
  note?: string;
}

/** Vínculos de um item: os que ele declara e os que outros itens declaram apontando para ele. */
export function workLinks(plan: Plan, roadmap: Roadmap): WorkLinkView[] {
  const findPlan = (roadmapId: string, id: string): Plan | undefined =>
    roadmapId === roadmap.id
      ? roadmapPlans(roadmap).find((candidate) => candidate.id === id || candidate.apiId === id || candidate.key === id)
      : planById(roadmapId, id);
  const out: WorkLinkView[] = plan.links.map((link) => ({
    direction: 'out',
    type: link.type,
    label: linkLabel(link.type),
    target: findPlan(link.targetRoadmapId ?? roadmap.id, link.targetId),
    ...(link.note ? { note: link.note } : {}),
  }));
  for (const other of roadmapPlans(roadmap)) {
    if (other.apiId === plan.apiId) continue;
    for (const link of other.links) {
      if (link.targetId !== plan.apiId) continue;
      if ((link.targetRoadmapId ?? other.roadmapId) !== plan.roadmapId) continue;
      out.push({
        direction: 'in',
        type: link.type,
        label: linkLabel(link.type, true),
        target: other,
        ...(link.note ? { note: link.note } : {}),
      });
    }
  }
  return out;
}

export interface TypeCounts {
  story: number;
  task: number;
  bug: number;
  total: number;
}

export function typeCounts(plans: readonly Plan[]): TypeCounts {
  const counts: TypeCounts = { story: 0, task: 0, bug: 0, total: plans.length };
  for (const p of plans) counts[p.type] += 1;
  return counts;
}

export interface Capacity {
  estimateP50: number;
  estimateP80: number;
  actualTokens: number;
  sessions: number;
}

export function capacity(plans: readonly Plan[]): Capacity {
  let estimateP50 = 0;
  let estimateP80 = 0;
  let actualTokens = 0;
  let sessions = 0;
  for (const p of plans) {
    estimateP50 += p.estimate?.p50 ?? 0;
    estimateP80 += p.estimate?.p80 ?? 0;
    actualTokens += p.actual?.tokens ?? 0;
    sessions += p.actual?.sessions ?? 0;
  }
  return { estimateP50, estimateP80, actualTokens, sessions };
}
