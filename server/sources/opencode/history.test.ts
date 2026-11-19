// Histórico do OpenCode: GET /api/session -> RecentSession (provider 'opencode'), janela, subagentes de fora e
// resolve() -> MessageStream da conversa (GET .../message). Cliente falso; nada fala com o serviço real.
import { describe, expect, it } from 'vitest';
import type { OpenCodeClientLike, OpenCodeEvent } from './client';
import { OpenCodeHistory } from './history';

const NOW = 1_790_000_000_000;
const DAY = 24 * 3600_000;

function session(id: string, at: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    agent: 'build',
    model: { id: 'deepseek-v4.1-flash' },
    tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } },
    time: { created: at, updated: at, viewed: at },
    location: { directory: '/p/loja' },
    title: `Sessão ${id}`,
    ...extra,
  };
}

class FakeClient implements OpenCodeClientLike {
  sessions: unknown[] = [];
  messages: Record<string, unknown[]> = {};
  paths: string[] = [];

  async get<T>(path: string): Promise<T> {
    this.paths.push(path);
    if (path.startsWith('/api/session?')) return this.sessions as T;
    const m = /^\/api\/session\/([^/]+)\/message\?/.exec(path);
    if (m) return (this.messages[decodeURIComponent(m[1])] ?? []).slice().reverse() as T;
    throw new Error(`GET inesperado: ${path}`);
  }

  async post<T>(path: string): Promise<T> {
    throw new Error(`POST inesperado: ${path}`);
  }

  async *events(): AsyncGenerator<OpenCodeEvent> {
    return;
  }
}

function setup(opts: { client?: OpenCodeClientLike; accounts?: Array<{ id: string }>; open?: (account: string, sid: string) => string | undefined } = {}) {
  const client = opts.client;
  return new OpenCodeHistory({
    accounts: () => opts.accounts ?? [{ id: 'opencode' }],
    client: () => client,
    openAgentOf: opts.open ?? (() => undefined),
    now: () => NOW,
  });
}

describe('histórico do OpenCode: listagem', () => {
  it('só sessões raiz, dentro da janela e não arquivadas; provider, projeto, título e aberta', async () => {
    const client = new FakeClient();
    client.sessions = [
      session('ses_new', NOW - 60_000),
      session('ses_old', NOW - 8 * DAY),
      session('ses_child', NOW - 30_000, { parentID: 'ses_new' }),
      session('ses_arch', NOW - 20_000, { time: { created: NOW - 20_000, updated: NOW - 20_000, archived: NOW - 20_000 } }),
      { id: 'sem-location' },
    ];
    const history = setup({ client, open: (_a, sid) => (sid === 'ses_new' ? 'opencode:ses_new' : undefined) });
    const list = await history.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      account: 'opencode',
      provider: 'opencode',
      sessionId: 'ses_new',
      project: '/p/loja',
      projectDir: '-p-loja',
      title: 'Sessão ses_new',
      lastAt: NOW - 60_000,
      firstAt: NOW - 60_000,
      size: 0,
      open: true,
      agentId: 'opencode:ses_new',
    });
    expect(client.paths[0]).toBe('/api/session?limit=150&order=desc');
  });

  it('sem cliente (serviço não subiu): lista vazia, sem erro', async () => {
    await expect(setup().list()).resolves.toEqual([]);
  });

  it('sem conta registrada: não inventa sessão', async () => {
    const client = new FakeClient();
    client.sessions = [session('ses_1', NOW)];
    await expect(setup({ client, accounts: [] }).list()).resolves.toEqual([]);
  });
});

describe('histórico do OpenCode: resolve', () => {
  it('id inválido = 400; conta desconhecida ou serviço fora = 404', () => {
    const history = setup({ client: new FakeClient() });
    expect(history.resolve('opencode', '../x')).toMatchObject({ status: 400 });
    expect(history.resolve('outra', 'ses_1')).toMatchObject({ status: 404 });
    expect(setup().resolve('opencode', 'ses_1')).toMatchObject({ status: 404 });
  });

  it('sessão válida devolve um stream que lê /message e entrega as entradas', async () => {
    const client = new FakeClient();
    client.sessions = [session('ses_1', NOW)];
    client.messages.ses_1 = [
      { id: 'msg_u', type: 'user', time: { created: NOW }, text: 'Arruma o carrinho' },
      { id: 'msg_a', type: 'assistant', time: { created: NOW + 1, completed: NOW + 2 }, content: [{ type: 'text', text: 'Pronto' }] },
    ];
    const history = setup({ client });
    // A listagem guarda o cwd da sessão para os títulos das ferramentas.
    await history.list();
    const found = history.resolve('opencode', 'ses_1');
    expect('stream' in found).toBe(true);
    if (!('stream' in found)) return;
    const s = found.stream();
    expect(s.intervalMs).toBe(2_000);
    const init = await s.load();
    expect(init.agentId).toBe('session:opencode:ses_1');
    expect(init.entries).toMatchObject([
      { kind: 'user', text: 'Arruma o carrinho' },
      { kind: 'assistant', text: 'Pronto' },
    ]);
    expect(client.paths.at(-1)).toBe('/api/session/ses_1/message?limit=100&order=desc');
  });
});
