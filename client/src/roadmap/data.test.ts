// Contrato de leitura do roadmap: o teste cobre a tradução do snapshot do Hermes
// Pipeline para o modelo das telas, incluindo a regra de progresso, vínculos inversos
// e a hidratação dos índices usados pela navegação.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENTS,
  ALL_PLANS,
  ROADMAPS,
  SESSIONS,
  capacity,
  countPlans,
  defaultPlanFor,
  defaultSessionForRoadmap,
  overallCounts,
  phaseById,
  phaseCounts,
  phaseStatus,
  planById,
  replaceAgents,
  replaceRoadmaps,
  replaceSessions,
  roadmapById,
  sessionForPlan,
  roadmapPlans,
  typeCounts,
  workLinks,
  type Agent,
  type Plan,
} from './data';
import { hydrateLive, mapRoadmap } from './live';
import type { ApiItem, ApiPhase, ApiSession, ApiSnapshot } from './pipeline';

function item(partial: Partial<ApiItem> & Pick<ApiItem, 'id' | 'key' | 'phaseId' | 'title' | 'status'>): ApiItem {
  return {
    roadmapId: 'praca',
    parentId: null,
    index: Number(partial.key.split('.')[1] ?? 1),
    type: 'task',
    priority: 'P2',
    ownerId: 'nina',
    objective: `${partial.title} com critério verificável.`,
    steps: ['Revisar o contexto', 'Implementar a mudança mínima', 'Registrar evidência'],
    criteria: [
      { text: 'Comportamento verificado', done: partial.status === 'done' },
      { text: 'Evidência registrada', done: partial.status === 'done' },
    ],
    dependencies: [],
    links: [],
    decisions: [],
    size: 'S',
    estimate: { unit: 'tokens', p50: 10_000, p80: 18_000, confidence: 0.6, sample: 3, basis: 'semente de teste', humanDays: 0.5 },
    actual: partial.status === 'done' ? { tokens: 9_000, days: 1, sessions: 2, updatedAt: '2026-11-01T10:00:00Z' } : null,
    execution: partial.status === 'in_progress' ? { provider: 'claude-code', sessionId: 'sess-nina', agentId: 'nina' } : null,
    blockReason: null,
    unblock: null,
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    revision: 7,
    ...partial,
  };
}

function phase(partial: Partial<ApiPhase> & Pick<ApiPhase, 'id' | 'index' | 'name' | 'items'>): ApiPhase {
  return {
    objective: `${partial.name} com objetivo verificável.`,
    ownerId: 'nina',
    status: 'backlog',
    counts: { total: 0, done: 0, in_progress: 0, blocked: 0, review: 0, ready: 0, backlog: 0, canceled: 0 },
    progress: { done: 0, total: 0, percent: 0 },
    ...partial,
  };
}

function snapshot(phases: ApiPhase[]): ApiSnapshot {
  const items = phases.flatMap((p) => p.items).filter((i) => i.status !== 'canceled');
  const done = items.filter((i) => i.status === 'done').length;
  const inProgress = items.filter((i) => i.status === 'in_progress' || i.status === 'review').length;
  const blocked = items.filter((i) => i.status === 'blocked').length;
  const backlog = items.filter((i) => i.status === 'backlog' || i.status === 'ready').length;
  return {
    schemaVersion: 1,
    source: 'hermes-pipeline',
    revision: 7,
    generatedAt: '2026-11-19T18:00:00Z',
    roadmap: {
      id: 'praca',
      title: 'Praça compartilhada',
      subtitle: 'Um lugar para todo mundo usar',
      objective: 'Abrir a praça para a comunidade.',
      status: 'active',
      currentPhaseId: phases[1]!.id,
      owner: 'Nina',
      counts: { total: items.length, done, in_progress: inProgress, blocked, review: 0, ready: 0, backlog, canceled: 1 },
      progress: { done, total: items.length, percent: Math.round((done / items.length) * 100) },
      phases,
      milestone: 'portas-abertas',
      activity: [
        { id: 2, actor: 'seed', action: 'item.done', summary: '1.1 mapa concluído.', itemId: 'praca-1.1', revision: 7, at: '2026-11-01T10:00:00Z' },
        { id: 1, actor: 'seed', action: 'item.blocked', summary: '2.1 bloqueada.', itemId: 'praca-2.1', revision: 7, at: '2026-11-01T09:50:00Z' },
      ],
      createdAt: '2026-11-01T09:00:00Z',
      updatedAt: '2026-11-19T18:00:00Z',
      revision: 7,
    },
  };
}

const session: ApiSession = {
  id: 'sess-nina',
  agentId: 'nina',
  displayName: 'Nina',
  harness: 'claude-code',
  model: 'claude-sonnet',
  status: 'active',
  capabilities: ['roadmap.read', 'roadmap.write', 'roadmap.complete', 'roadmap.estimate', 'agent.converse'],
  roadmapIds: ['praca'],
  currentItemId: 'praca-2.1',
  lastSeen: '2026-11-19T17:58:00Z',
};

const nina: Agent = {
  id: 'nina',
  name: 'Nina',
  role: 'Claude Code',
  provider: 'claude',
  color: '#f08a3c',
  short: 'N',
  avatar: 'nina',
  status: 'working',
  statusLabel: 'Trabalhando',
  currentRoadmapId: 'praca',
  currentPlanId: '2.1',
  since: 'agora',
};

const fixture = snapshot([
  phase({
    id: 'praca-p1',
    index: 1,
    name: 'Fundação',
    items: [
      item({ id: 'praca-1.1', key: '1.1', phaseId: 'praca-p1', title: 'Mapa da praça', status: 'done' }),
      item({ id: 'praca-1.2', key: '1.2', phaseId: 'praca-p1', title: 'Rascunho cancelado', status: 'canceled', type: 'story' }),
    ],
  }),
  phase({
    id: 'praca-p2',
    index: 2,
    name: 'Circulação',
    items: [
      item({
        id: 'praca-2.1',
        key: '2.1',
        phaseId: 'praca-p2',
        title: 'Corrimão da rampa',
        status: 'in_progress',
        dependencies: [{ kind: 'external', label: 'Licença da prefeitura', status: 'pending', blocking: true, detail: 'Protocolo 2026/441' }],
      }),
      item({
        id: 'praca-2.2',
        key: '2.2',
        phaseId: 'praca-p2',
        title: 'Visita duplicada',
        status: 'backlog',
        type: 'bug',
        links: [{ kind: 'caused_by', targetId: 'praca-2.1' }, { kind: 'relates_to', targetId: 'praca-2.1' }],
      }),
      item({ id: 'praca-2.3', key: '2.3', phaseId: 'praca-p2', title: 'Corrigir duplicação', status: 'backlog', links: [{ kind: 'fixes', targetId: 'praca-2.2' }] }),
    ],
  }),
]);

function planIn(roadmap: ReturnType<typeof mapRoadmap>, id: string): Plan | undefined {
  return roadmap.phases.flatMap((phase) => phase.plans).find((plan) => plan.id === id || plan.apiId === id);
}

function phaseIn(roadmap: ReturnType<typeof mapRoadmap>, id: string) {
  return roadmap.phases.find((phase) => phase.id === id || String(phase.index) === id);
}

describe('tradução do snapshot do pipeline', () => {
  it('exclui cancelados do denominador e mantém a mesma contagem em fases e roadmap', () => {
    const roadmap = mapRoadmap(fixture, new Map([['nina', nina]]));
    expect(overallCounts(roadmap)).toEqual({ done: 1, active: 1, blocked: 0, future: 2, total: 4 });
    const sum = roadmap.phases.map((p) => countPlans(p.plans));
    expect(sum.reduce((acc, c) => acc + c.total, 0)).toBe(4);
    expect(sum.reduce((acc, c) => acc + c.done, 0)).toBe(1);
    expect(phaseCounts(roadmap.phases[0]!)).toEqual({ done: 1, active: 0, blocked: 0, future: 0, total: 1 });
    expect(phaseStatus(roadmap.phases[0]!)).toBe('done');
    expect(phaseStatus(roadmap.phases[1]!)).toBe('active');
  });

  it('preserva a chave exibida e o id canônico do item', () => {
    const roadmap = mapRoadmap(fixture, new Map([['nina', nina]]));
    const plan = planIn(roadmap, '2.2')!;
    expect(plan.id).toBe('2.2');
    expect(plan.apiId).toBe('praca-2.2');
    expect(planIn(roadmap, 'praca-2.1')?.key).toBe('2.1');
    expect(phaseIn(roadmap, '2')?.name).toBe('Circulação');
  });

  it('deriva os dois lados dos vínculos canônicos', () => {
    const roadmap = mapRoadmap(fixture, new Map([['nina', nina]]));
    const bug = planIn(roadmap, '2.2')!;
    const links = workLinks(bug, roadmap);
    expect(links.some((l) => l.type === 'caused_by' && l.direction === 'out' && l.target?.id === '2.1')).toBe(true);
    expect(links.some((l) => l.type === 'fixes' && l.direction === 'in' && l.target?.id === '2.3')).toBe(true);
  });

  it('traduz estimativa, realizado, execução e atividade', () => {
    const roadmap = mapRoadmap(fixture, new Map([['nina', nina]]));
    const active = planIn(roadmap, '2.1')!;
    expect(active.estimate?.unit).toBe('tokens');
    expect(active.estimate?.humanDays).toBe(0.5);
    expect(active.execution?.provider).toBe('claude');
    expect(active.dependencies[0]).toMatchObject({ kind: 'external', blocking: true, label: 'Licença da prefeitura' });
    expect(roadmap.milestone.id).toBe('portas-abertas');
    expect(roadmap.activity[0]?.agentId).toBe('pipeline');
    expect(roadmap.activity[0]?.planId).toBe('1.1');
    expect(roadmap.revision).toBe(7);
    expect(roadmap.source).toBe('hermes-pipeline');
  });

  it('soma estimado e realizado para a capacidade', () => {
    const roadmap = mapRoadmap(fixture, new Map([['nina', nina]]));
    const c = capacity(roadmapPlans(roadmap));
    expect(c.estimateP50).toBe(40_000);
    expect(c.actualTokens).toBe(9_000);
    expect(c.sessions).toBe(2);
    const types = typeCounts(roadmapPlans(roadmap));
    expect(types.bug).toBe(1);
    expect(types.story + types.task + types.bug).toBe(types.total);
  });
});

describe('hidratação dos índices', () => {
  beforeEach(() => {
    // Cada teste que hidrata parte de um estado limpo.
    replaceRoadmaps([]);
    replaceAgents([]);
    replaceSessions([]);
  });

  it('só usa sessão que declara acompanhar o roadmap; não cai em sessão de outro roadmap', () => {
    hydrateLive([fixture], [session]);
    expect(defaultSessionForRoadmap('praca')?.id).toBe('sess-nina');
    expect(defaultSessionForRoadmap('atlas-ondas')).toBeUndefined();
    const active = defaultPlanFor(roadmapById('praca')!);
    expect(sessionForPlan(active)?.id).toBe('sess-nina');
    const other = { ...active, roadmapId: 'atlas-ondas' };
    expect(sessionForPlan(other)).toBeUndefined();
  });

  it('substitui roadmap, agentes e sessões pelos dados do pipeline', () => {
    hydrateLive([fixture], [session]);
    expect(ROADMAPS.map((r) => r.id)).toEqual(['praca']);
    expect(ALL_PLANS).toHaveLength(4);
    expect(AGENTS.nina?.name).toBe('Nina');
    expect(AGENTS.nina?.currentPlanId).toBe('2.1');
    expect(SESSIONS[0]?.id).toBe('sess-nina');
    expect(SESSIONS[0]?.capabilities).toContain('roadmap.write');
    expect(defaultPlanFor(roadmapById('praca')!).id).toBe('2.1');
    expect(ROADMAPS[0]?.snapshotLabel).toBe('revisão 7');
  });
});
