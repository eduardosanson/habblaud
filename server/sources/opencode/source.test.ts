// Integração da fonte do OpenCode: um cliente falso (sessões, ativas, uso e eventos) + AccountsService + Office.
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import type { OpenCodeClientLike, OpenCodeEvent } from './client';
import { activeSessionIds, OpenCodeSource } from './source';

setQuiet(true);

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
  location: { directory: '/projetos/loja/' },
};

const CHILD = {
  ...SESSION,
  id: 'ses_2',
  parentID: 'ses_1',
  title: 'Revisar a loja',
  agent: 'review',
  time: { created: 1_100, updated: 1_900, busy: 1_900, idle: 1_800, viewed: 1_900 },
};

const USAGE = {
  workspace: { id: 'w', name: 'Default' },
  go: {
    rolling: { percent: 5, limited: false, resetsAt: 11_000 },
    weekly: { percent: 39, limited: false, resetsAt: 22_000 },
    monthly: { percent: 82, limited: false, resetsAt: 33_000 },
  },
  budgets: [],
};

const EVENT = (type: string, data: Record<string, unknown>, created = 5_000): OpenCodeEvent => ({
  id: `evt_${type}_${created}`,
  type,
  created,
  data,
});

class FakeClient implements OpenCodeClientLike {
  sessions: unknown[] = [];
  active: Record<string, { type: string }> = {};
  usage: unknown;
  queued: OpenCodeEvent[] = [];
  /** Sessões devolvidas por GET /api/session/:id (para eventos de sessão desconhecida). */
  byId = new Map<string, unknown>();
  /** POSTs recebidos (prompt). */
  posted: Array<{ path: string; body: unknown }> = [];
  /** Erro a devolver no próximo POST (teste de recusa do serviço). */
  postError?: unknown;

  async get<T>(path: string): Promise<T> {
    if (path.startsWith('/api/session/active')) return this.active as T;
    if (path === '/api/session') return this.sessions as T;
    if (path.startsWith('/api/experimental/usage/limits')) return this.usage as T;
    const id = /^\/api\/session\/([^/?]+)$/.exec(path)?.[1];
    if (id && this.byId.has(id)) return this.byId.get(id) as T;
    throw new Error(`GET inesperado: ${path}`);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    if (this.postError) throw this.postError;
    this.posted.push({ path, body });
    return {} as T;
  }

  async *events(): AsyncGenerator<OpenCodeEvent> {
    for (const ev of this.queued) yield ev;
  }
}

function setup(opts: { client?: FakeClient; now?: () => number } = {}) {
  let clock = opts.now?.() ?? 10_000;
  const now = () => clock;
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: '/home/u', env: {}, now, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 'teste',
    startedAt: clock,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    now,
  });
  late.office = office;
  const client = opts.client ?? new FakeClient();
  const source = new OpenCodeSource({
    accounts,
    office,
    client,
    now,
    recentMs: 60_000,
    serviceFile: '/home/u/.local/state/opencode/service.json',
  });
  return {
    accounts,
    office,
    client,
    source,
    now,
    advance(ms: number) {
      clock += ms;
    },
    agents(): AgentInfo[] {
      return office.commit().snapshot.agents;
    },
    agent(id = 'opencode:ses_1'): AgentInfo | undefined {
      return office.commit().snapshot.agents.find((a) => a.id === id);
    },
  };
}

afterEach(() => {
  // Nada de timers entre testes: os testes chamam boot/sweep/applyEvent diretamente.
});

describe('fonte do OpenCode: /api/session/active', () => {
  it('só as sessões running contam como ativas', () => {
    expect([...activeSessionIds({ a: { type: 'running' }, b: { type: 'idle' }, c: { type: 'retry' } })]).toEqual(['a']);
    expect([...activeSessionIds(null)]).toEqual([]);
  });
});

describe('fonte do OpenCode: boot', () => {
  it('cria principal e subagente na sala do projeto, com conta e uso', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION, CHILD];
    ctx.client.active = { ses_1: { type: 'running' } };
    ctx.client.usage = USAGE;
    await ctx.source.boot();

    const main = ctx.agent()!;
    expect(main).toMatchObject({
      kind: 'main',
      provider: 'opencode',
      account: 'opencode',
      sessionId: 'ses_1',
      roomId: '/projetos/loja',
      role: 'Agente build',
      status: 'working',
      title: 'Configuração de harnesses',
      model: 'deepseek-v4.1-flash',
    });
    expect(main.stats).toMatchObject({ tokensIn: 407, tokensOut: 25, costUSD: 0.25 });

    const sub = ctx.agent('opencode:ses_2')!;
    expect(sub).toMatchObject({ kind: 'sub', parentId: 'opencode:ses_1', role: 'Agente review', status: 'working' });

    expect(ctx.accounts.list(new Map())[0]).toMatchObject({
      id: 'opencode',
      provider: 'opencode',
      name: 'OpenCode',
      short: 'O',
      usage: { source: 'opencode', fiveHour: { utilization: 5 }, sevenDay: { utilization: 39 }, monthly: { utilization: 82 } },
    });
    expect(ctx.source.sources()).toEqual([
      { label: 'opencode', provider: 'opencode', path: '/home/u/.local/state/opencode', sessions: 1, ok: true },
    ]);
  });

  it('ignora arquivadas e antigas; sessão ativa antiga continua', async () => {
    const ctx = setup();
    ctx.advance(100_000);
    const old = { ...SESSION, id: 'ses_old', time: { created: 1_000, updated: 2_000, viewed: 2_000 } };
    const archived = { ...SESSION, id: 'ses_arch', time: { ...SESSION.time, archived: 3_000 } };
    ctx.client.sessions = [old, archived, { ...SESSION, id: 'ses_active', time: { created: 1_000, updated: 2_000 } }];
    ctx.client.active = { ses_active: { type: 'running' } };
    await ctx.source.boot();
    expect(ctx.agents().map((a) => a.sessionId).sort()).toEqual(['ses_active']);
  });

  it('subagente já ocioso no boot não vira personagem trabalhando', async () => {
    const ctx = setup();
    const idleChild = { ...CHILD, id: 'ses_idle_child', time: { ...CHILD.time, busy: 1_700, idle: 1_800 } };
    ctx.client.sessions = [SESSION, idleChild];
    await ctx.source.boot();
    expect(ctx.agent('opencode:ses_idle_child')).toBeUndefined();
  });

  it('boot repetido não duplica agentes', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION];
    await ctx.source.boot();
    await ctx.source.boot();
    expect(ctx.agents().filter((a) => a.kind === 'main')).toHaveLength(1);
  });

  it('messageStream existe para o principal e para o subagente (sessão filha) e só para quem está no escritório', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION, CHILD];
    await ctx.source.boot();
    const main = ctx.source.messageStream('opencode:ses_1');
    const sub = ctx.source.messageStream('opencode:ses_2');
    expect(main).toBeDefined();
    expect(sub).toBeDefined();
    expect(main).not.toBe(sub);
    expect(ctx.source.messageStream('opencode:ses_que_nao_esta')).toBeUndefined();
  });

  it('promptSession manda POST .../prompt com delivery queue; sem serviço ou id inválido lança', async () => {
    const ctx = setup();
    const bare = new OpenCodeSource({ accounts: ctx.accounts, office: ctx.office, now: ctx.now, serviceFile: '/x/service.json' });
    await expect(bare.promptSession('ses_1', 'oi')).rejects.toThrow(/não está disponível/);
    ctx.client.sessions = [SESSION];
    await ctx.source.boot();
    await ctx.source.promptSession('ses_1', 'roda os testes');
    expect(ctx.client.posted).toEqual([{ path: '/api/session/ses_1/prompt', body: { text: 'roda os testes', delivery: 'queue' } }]);
    await expect(ctx.source.promptSession('../x', 'oi')).rejects.toThrow(/inválida/);
    ctx.client.postError = Object.assign(new Error('OpenCode respondeu 404'), { status: 404 });
    await expect(ctx.source.promptSession('ses_1', 'oi')).rejects.toThrow(/404/);
  });
});

describe('fonte do OpenCode: eventos', () => {
  it('execução, ferramenta, permissão e fim de turno', async () => {
    const ctx = setup();
    ctx.client.byId.set('ses_1', SESSION);
    await ctx.source.applyEvent(EVENT('session.created', { sessionID: 'ses_1', location: { directory: '/projetos/loja' } }));
    expect(ctx.agent()?.status).toBe('idle');

    await ctx.source.applyEvent(EVENT('session.execution.started', { sessionID: 'ses_1' }, 6_000));
    expect(ctx.agent()?.status).toBe('working');

    await ctx.source.applyEvent(EVENT('session.tool.input.started', { sessionID: 'ses_1', id: 'call_1', name: 'shell' }, 6_100));
    await ctx.source.applyEvent(EVENT('session.tool.called', { sessionID: 'ses_1', id: 'call_1', input: { command: 'npm test' } }, 6_200));
    expect(ctx.agent()?.activity).toMatchObject({ kind: 'test', text: 'Rodando testes' });
    expect(ctx.agent()?.stats.toolCalls).toBe(1);

    await ctx.source.applyEvent(EVENT('permission.asked', { sessionID: 'ses_1', action: 'bash', resources: ['npm test'] }, 6_300));
    expect(ctx.agent()?.status).toBe('waiting');
    expect(ctx.agent()?.waitingFor).toBe('aprovar bash (npm test)');

    await ctx.source.applyEvent(EVENT('permission.replied', { sessionID: 'ses_1', requestID: 'p1', reply: 'once' }, 6_400));
    expect(ctx.agent()?.status).toBe('working');

    await ctx.source.applyEvent(EVENT('session.idle', { sessionID: 'ses_1' }, 6_500));
    expect(ctx.agent()?.status).toBe('idle');
  });

  it('subagente nasce do evento com parentID e entrega ao ficar ocioso', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION];
    await ctx.source.boot();
    await ctx.source.applyEvent(
      EVENT('session.created', {
        sessionID: 'ses_2',
        parentID: 'ses_1',
        location: { directory: '/projetos/loja' },
        title: 'Revisar',
        agent: 'review',
      }),
    );
    await ctx.source.applyEvent(EVENT('session.execution.started', { sessionID: 'ses_2' }, 6_000));
    expect(ctx.agent('opencode:ses_2')).toMatchObject({ kind: 'sub', parentId: 'opencode:ses_1', status: 'working' });

    await ctx.source.applyEvent(EVENT('session.idle', { sessionID: 'ses_2' }, 6_500));
    expect(ctx.agent('opencode:ses_2')?.status).toBe('done');
  });

  it('renomear, uso e remover', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION];
    await ctx.source.boot();
    await ctx.source.applyEvent(EVENT('session.renamed', { sessionID: 'ses_1', title: 'Novo título' }, 6_000));
    expect(ctx.agent()?.title).toBe('Novo título');

    await ctx.source.applyEvent(
      EVENT('session.usage.updated', {
        sessionID: 'ses_1',
        cost: 1.5,
        tokens: { input: 1_000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      }, 6_100),
    );
    expect(ctx.agent()?.stats).toMatchObject({ tokensIn: 1_000, tokensOut: 200, costUSD: 1.5 });

    await ctx.source.applyEvent(EVENT('session.deleted', { sessionID: 'ses_1' }, 6_200));
    expect(ctx.agent()?.status).toBe('offline');
  });
});

describe('fonte do OpenCode: presença', () => {
  it('sessão ociosa sai depois da janela; ativa fica', async () => {
    const ctx = setup();
    ctx.client.sessions = [SESSION];
    ctx.client.active = { ses_1: { type: 'running' } };
    await ctx.source.boot();
    expect(ctx.agent()?.status).toBe('working');
    ctx.advance(120_000);
    ctx.source.sweep();
    expect(ctx.agent()?.status).toBe('working');

    ctx.client.active = {};
    await ctx.source.refresh();
    ctx.advance(120_000);
    ctx.source.sweep();
    expect(ctx.agent()?.status).toBe('offline');
  });
});
