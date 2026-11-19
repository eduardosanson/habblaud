// Mapeamento puro do OpenCode: sessão, uso, ferramentas e eventos -> escritório.
import { describe, expect, it } from 'vitest';
import {
  describeOpenCodeTool,
  eventActivity,
  eventStatus,
  eventWaitingFor,
  isRecentSession,
  parseOpenCodeSession,
  parseOpenCodeUsage,
  sessionCwd,
  sessionRole,
  sessionStats,
  sessionTitle,
} from './map';

const SESSION = {
  id: 'ses_1',
  projectID: 'p1',
  agent: 'build',
  model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
  cost: 0.25,
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 300, write: 7 } },
  outcome: 'succeeded',
  time: { created: 1_000, updated: 2_000, busy: 1_500, idle: 1_800, viewed: 1_900 },
  title: 'Configuração de harnesses',
  location: { directory: '/projetos/habblaud/' },
};

const EVENT = (type: string, data: Record<string, unknown>, created = 5_000) => ({ id: `evt_${type}`, type, created, data });

describe('parseOpenCodeSession', () => {
  it('normaliza os campos que o escritório usa', () => {
    const s = parseOpenCodeSession(SESSION)!;
    expect(s).toMatchObject({
      id: 'ses_1',
      projectId: 'p1',
      agent: 'build',
      model: 'deepseek-v4.1-flash',
      title: 'Configuração de harnesses',
      cwd: '/projetos/habblaud',
      cost: 0.25,
      tokens: { input: 100, output: 20, reasoning: 5, cacheRead: 300, cacheWrite: 7 },
      time: { created: 1_000, updated: 2_000, busy: 1_500, idle: 1_800, viewed: 1_900 },
    });
  });

  it('recusa sessão sem id, cwd ou tempo', () => {
    expect(parseOpenCodeSession({ ...SESSION, id: '' })).toBeUndefined();
    expect(parseOpenCodeSession({ ...SESSION, location: {} })).toBeUndefined();
    expect(parseOpenCodeSession({ ...SESSION, time: {} })).toBeUndefined();
    expect(parseOpenCodeSession(null)).toBeUndefined();
  });

  it('mantém parentID e arquivada quando existem', () => {
    expect(parseOpenCodeSession({ ...SESSION, parentID: 'ses_pai', time: { ...SESSION.time, archived: 9_000 } })).toMatchObject({
      parentId: 'ses_pai',
      archivedAt: 9_000,
    });
  });
});

describe('parseOpenCodeUsage', () => {
  it('mapeia rolling para 5 h e weekly para a semana', () => {
    const u = parseOpenCodeUsage(
      {
        workspace: { id: 'w', name: 'Default' },
        go: {
          rolling: { percent: 5, limited: false, resetsAt: 11_000 },
          weekly: { percent: 39, limited: false, resetsAt: 22_000 },
          monthly: { percent: 82, limited: false, resetsAt: 33_000 },
        },
        budgets: [],
      },
      1_000,
    );
    expect(u).toEqual({
      source: 'opencode',
      fetchedAt: 1_000,
      fiveHour: { utilization: 5, resetsAt: 11_000 },
      sevenDay: { utilization: 39, resetsAt: 22_000 },
    });
  });

  it('sem janelas não inventa uso', () => {
    expect(parseOpenCodeUsage({ go: {} }, 1_000)).toBeUndefined();
    expect(parseOpenCodeUsage(null, 1_000)).toBeUndefined();
  });
});

describe('describeOpenCodeTool', () => {
  it('traduz as ferramentas do OpenCode para as atividades do escritório', () => {
    expect(describeOpenCodeTool('shell', { command: 'npm test' })).toMatchObject({ kind: 'test', text: 'Rodando testes' });
    expect(describeOpenCodeTool('read', { filePath: '/x/App.tsx' })).toMatchObject({ kind: 'read', text: 'Lendo App.tsx' });
    expect(describeOpenCodeTool('edit', { filePath: '/x/App.tsx' })).toMatchObject({ kind: 'edit', text: 'Editando App.tsx' });
    expect(describeOpenCodeTool('write', { filePath: '/x/novo.ts' })).toMatchObject({ kind: 'write', text: 'Escrevendo novo.ts' });
    expect(describeOpenCodeTool('grep', { pattern: 'TODO' })).toMatchObject({ kind: 'search' });
    expect(describeOpenCodeTool('task', { description: 'Revisar o PR', subagent_type: 'review' })).toMatchObject({
      kind: 'delegate',
      text: 'Delegando: Revisar o PR',
    });
    expect(describeOpenCodeTool('ferramenta_estranha', {})).toMatchObject({ kind: 'other', text: 'Usando ferramenta_estranha' });
  });
});

describe('eventos', () => {
  it('status por borda', () => {
    expect(eventStatus(EVENT('session.execution.started', { sessionID: 'ses_1' }))).toBe('working');
    expect(eventStatus(EVENT('session.execution.succeeded', { sessionID: 'ses_1' }))).toBe('idle');
    expect(eventStatus(EVENT('session.idle', { sessionID: 'ses_1' }))).toBe('idle');
    expect(eventStatus(EVENT('permission.asked', { sessionID: 'ses_1', action: 'bash' }))).toBe('waiting');
    expect(eventStatus(EVENT('session.status', { sessionID: 'ses_1', status: { type: 'busy' } }))).toBe('working');
    expect(eventStatus(EVENT('session.status', { sessionID: 'ses_1', status: { type: 'retry', attempt: 2 } }))).toBe('working');
    expect(eventStatus(EVENT('session.renamed', { sessionID: 'ses_1' }))).toBeUndefined();
  });

  it('motivo da espera e atividades', () => {
    expect(eventWaitingFor(EVENT('permission.asked', { sessionID: 'ses_1', action: 'bash', resources: ['npm test'] }))).toBe(
      'aprovar bash (npm test)',
    );
    expect(eventActivity(EVENT('session.reasoning.started', { sessionID: 'ses_1' }))).toMatchObject({ kind: 'think' });
    expect(eventActivity(EVENT('session.text.started', { sessionID: 'ses_1' }))).toMatchObject({ kind: 'respond' });
    expect(eventActivity(EVENT('session.compaction.started', { sessionID: 'ses_1' }))).toMatchObject({ kind: 'compact' });
    expect(eventActivity(EVENT('session.status', { sessionID: 'ses_1', status: { type: 'retry', attempt: 2 } }))).toMatchObject({
      kind: 'wait',
    });
  });
});

describe('presença e resumo', () => {
  it('ativa ou vista/atualizada na janela; arquivada nunca', () => {
    const s = parseOpenCodeSession(SESSION)!;
    expect(isRecentSession(s, false, 10_000, 60_000)).toBe(true); // viewed 1.900, janela até 9.400? 10.000-60.000 = -50.000
    expect(isRecentSession(s, false, 200_000, 60_000)).toBe(false);
    expect(isRecentSession(s, true, 200_000, 60_000)).toBe(true);
    expect(isRecentSession({ ...s, archivedAt: 1 }, true, 10_000, 60_000)).toBe(false);
  });

  it('título, sala, papel e estatísticas', () => {
    const s = parseOpenCodeSession(SESSION)!;
    expect(sessionTitle(s)).toBe('Configuração de harnesses');
    expect(sessionCwd(s)).toBe('/projetos/habblaud');
    expect(sessionRole(s)).toBe('Agente build');
    expect(sessionStats(s, 4, 2)).toEqual({
      toolCalls: 4,
      tokensIn: 407,
      tokensOut: 25,
      costUSD: 0.25,
      subagents: 2,
    });
  });
});
