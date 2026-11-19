// Terminal do OpenCode: mensagens da API (user, assistant, tools, shell, compactação) -> TerminalEntry, e o
// MessageStream que entrega init/append sem repetir o que já saiu. Tudo com cliente falso; nenhum teste fala com o
// serviço real.
import { describe, expect, it } from 'vitest';
import type { TerminalEntry } from '../../../shared/types';
import type { OpenCodeClientLike, OpenCodeEvent } from './client';
import { isOpenCodeSessionId, openCodeMessageEntries, OpenCodeMessageStream } from './terminal';
import { TEXT_MAX } from '../terminal';

const T0 = 1_790_000_000_000;
// Token falso montado em partes (nada de segredo literal no repositório).
const TOKEN = ['sk', 'ant', 'api03', 'testeFALSO0123456789abcdefXYZ'].join('-');

function user(text: string, extra: Record<string, unknown> = {}, at = T0): Record<string, unknown> {
  return { id: `msg_u${at}`, type: 'user', time: { created: at }, text, ...extra };
}

function assistant(content: unknown[], at = T0, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `msg_a${at}`, type: 'assistant', time: { created: at }, content, ...extra };
}

function tool(name: string, input: Record<string, unknown>, state: Record<string, unknown>, at = T0, id = 'call_1'): Record<string, unknown> {
  return { type: 'tool', id, name, executed: true, state, time: { created: at, ...(state.status === 'running' ? {} : { completed: at + 10 }) } };
}

const kinds = (entries: TerminalEntry[]) => entries.map((e) => e.kind);
const only = <K extends TerminalEntry['kind']>(entries: TerminalEntry[], kind: K) =>
  entries.filter((e): e is Extract<TerminalEntry, { kind: K }> => e.kind === kind);

class FakeClient implements OpenCodeClientLike {
  messages: unknown[] = [];
  paths: string[] = [];
  /** Erro a devolver em get (teste de serviço fora do ar/sessão desconhecida). */
  fail?: unknown;

  async get<T>(path: string): Promise<T> {
    this.paths.push(path);
    if (this.fail) throw this.fail;
    // A API responde a página mais recente primeiro (order=desc); o stream devolve na ordem cronológica.
    return this.messages.slice().reverse() as T;
  }

  async post<T>(path: string): Promise<T> {
    throw new Error(`POST inesperado: ${path}`);
  }

  async *events(): AsyncGenerator<OpenCodeEvent> {
    return;
  }
}

function stream(client: FakeClient, opts: Partial<ConstructorParameters<typeof OpenCodeMessageStream>[0]> = {}) {
  return new OpenCodeMessageStream({ client, sessionId: 'ses_1', streamId: 'opencode:ses_1', ...opts });
}

describe('terminal do OpenCode: prompts e respostas', () => {
  it('user vira prompt; anexos viram marcadores, sem repetir o que já está no texto', () => {
    const entries = openCodeMessageEntries([
      user('@spec.md arruma o carrinho', {
        files: [
          { name: 'spec.md', mime: 'text/markdown', source: { type: 'uri', uri: 'file:///p/spec.md' }, mention: { text: '@spec.md' } },
          { name: 'logo.png', mime: 'image/png', source: { type: 'uri', uri: 'file:///p/logo.png' } },
          { name: 'nota.txt', mime: 'text/plain', source: { type: 'uri', uri: 'file:///p/nota.txt' } },
        ],
      }),
    ]);
    expect(entries).toMatchObject([{ kind: 'user', text: '@spec.md arruma o carrinho\n[imagem] [arquivo: nota.txt]' }]);
  });

  it('só anexos (sem texto) ainda viram prompt', () => {
    const entries = openCodeMessageEntries([user('', { files: [{ name: 'foto.png', mime: 'image/png' }] })]);
    expect(entries).toMatchObject([{ kind: 'user', text: '[imagem]' }]);
  });

  it('assistant em streaming não entra; ao terminar, raciocínio e texto saem uma vez', () => {
    const streaming = assistant(
      [
        { type: 'reasoning', text: 'pensando', time: { created: T0, completed: T0 + 1 } },
        { type: 'text', text: 'resposta parcial' },
      ],
      T0,
    );
    expect(openCodeMessageEntries([streaming]).map((e) => e.kind)).toEqual(['thinking']);
    const done = assistant(
      [
        { type: 'reasoning', text: 'pensando', time: { created: T0, completed: T0 + 1 } },
        { type: 'text', text: 'resposta final' },
      ],
      T0,
      { time: { created: T0, completed: T0 + 5 } },
    );
    expect(openCodeMessageEntries([done])).toMatchObject([
      { kind: 'thinking', text: 'pensando' },
      { kind: 'assistant', text: 'resposta final' },
    ]);
  });

  it('texto e ferramentas são mascarados e cortados pelas mesmas regras do Claude Code', () => {
    const entries = openCodeMessageEntries([
      assistant(
        [
          { type: 'text', text: `a senha é ${TOKEN}` },
          tool('shell', { command: `echo ${TOKEN}` }, { status: 'completed', input: { command: `echo ${TOKEN}` }, content: [{ type: 'text', text: `saída ${TOKEN}` }] }),
        ],
        T0,
        { time: { created: T0, completed: T0 + 5 } },
      ),
    ]);
    const all = JSON.stringify(entries);
    expect(all).not.toContain(TOKEN);
    expect(only(entries, 'assistant')[0]?.text).toContain('***');
    expect(only(entries, 'result')[0]?.text).toContain('***');
    const long = 'x'.repeat(TEXT_MAX + 100);
    const cut = openCodeMessageEntries([assistant([{ type: 'text', text: long }], T0, { time: { created: T0, completed: T0 + 1 } })]);
    expect(only(cut, 'assistant')[0]?.text.endsWith('…')).toBe(true);
  });
});

describe('terminal do OpenCode: ferramentas', () => {
  it('shell em execução vira Bash pendente; ao terminar, resulta com a saída', () => {
    const running = assistant([tool('shell', { command: 'npm test' }, { status: 'running', input: { command: 'npm test' } })], T0);
    expect(openCodeMessageEntries([running])).toMatchObject([{ kind: 'tool', tool: 'Bash', title: 'Bash(npm test)', input: 'npm test', inputKind: 'command' }]);
    const done = assistant(
      [tool('shell', { command: 'npm test' }, { status: 'completed', input: { command: 'npm test' }, content: [{ type: 'text', text: 'ok' }], metadata: { exit: 0 } })],
      T0,
    );
    expect(openCodeMessageEntries([done])).toMatchObject([
      { kind: 'tool', tool: 'Bash', title: 'Bash(npm test)' },
      { kind: 'result', toolUseId: 'call_1', text: 'ok' },
    ]);
  });

  it('código de saída diferente de zero entra no resultado; erro da ferramenta vem marcado', () => {
    const failed = assistant(
      [tool('shell', {}, { status: 'completed', input: { command: 'npm test' }, content: [{ type: 'text', text: 'falhou' }], metadata: { exit: 1 } })],
      T0,
    );
    expect(only(openCodeMessageEntries([failed]), 'result')[0]).toMatchObject({ text: 'Código de saída 1\nfalhou' });
    const error = assistant([tool('shell', {}, { status: 'error', input: { command: 'npm test' }, error: { message: 'interrompido' } })], T0);
    expect(only(openCodeMessageEntries([error]), 'result')[0]).toMatchObject({ text: 'interrompido', error: true });
  });

  it('edit vira diff, read/write usam o caminho relativo e tools desconhecidas caem no formato padrão', () => {
    const entries = openCodeMessageEntries(
      [
        assistant([
          tool('edit', { path: '/p/loja/app.ts', oldString: 'a', newString: 'b' }, { status: 'completed', input: { path: '/p/loja/app.ts', oldString: 'a', newString: 'b' }, content: [] }, T0, 'call_e'),
          tool('read', { path: '/p/loja/app.ts', offset: 10 }, { status: 'completed', input: { path: '/p/loja/app.ts', offset: 10 }, content: [{ type: 'text', text: 'linha' }] }, T0, 'call_r'),
          tool('write', { path: '/p/loja/novo.ts', content: 'x' }, { status: 'completed', input: { path: '/p/loja/novo.ts', content: 'x' }, content: [] }, T0, 'call_w'),
          tool('custom_thing', { foo: 'bar' }, { status: 'completed', input: { foo: 'bar' }, content: [] }, T0, 'call_c'),
        ]),
      ],
      { cwd: '/p/loja' },
    );
    expect(entries.filter((e) => e.kind === 'tool').map((e) => [e.tool, e.title])).toEqual([
      ['Edit', 'Edit(app.ts)'],
      ['Read', 'Read(app.ts)'],
      ['Write', 'Write(novo.ts)'],
      ['custom_thing', 'custom_thing(bar)'],
    ]);
    expect(only(entries, 'tool')[0]?.inputKind).toBe('diff');
  });

  it('task, skill, question e MCP ganham o título do terminal do Claude Code', () => {
    const entries = openCodeMessageEntries([
      assistant([
        tool('task', { description: 'Revisar', agent: 'review', prompt: 'olha' }, { status: 'completed', input: { description: 'Revisar', agent: 'review', prompt: 'olha' }, content: [] }, T0, 'call_t'),
        tool('skill', { id: 'orca-cli' }, { status: 'completed', input: { id: 'orca-cli' }, content: [] }, T0, 'call_s'),
        tool('question', { questions: [{ question: 'Qual?', options: [{ label: 'A' }] }] }, { status: 'running', input: { questions: [{ question: 'Qual?', options: [{ label: 'A' }] }] } }, T0, 'call_q'),
        tool('atlas-store_atlas_status', { q: 'x' }, { status: 'completed', input: { q: 'x' }, content: [] }, T0, 'call_m'),
      ]),
    ]);
    expect(entries.filter((e) => e.kind === 'tool').map((e) => e.title)).toEqual([
      'Task(review: Revisar)',
      'Skill(orca-cli)',
      'AskUserQuestion(Qual?)',
      'atlas-store_atlas_status(x)',
    ]);
  });

  it('ferramenta em streaming (argumentos pela metade) espera', () => {
    const entries = openCodeMessageEntries([assistant([tool('shell', {}, { status: 'streaming', input: '{"comm' })])]);
    expect(entries).toEqual([]);
  });
});

describe('terminal do OpenCode: eventos da sessão', () => {
  it('shell do usuário vira "! comando" e a saída vem no system', () => {
    const entries = openCodeMessageEntries([
      { id: 'msg_sh', type: 'shell', time: { created: T0, completed: T0 + 5 }, shellID: 'sh_1', command: 'ls -la', status: 'exited', exit: 0, output: { output: 'a\nb', cursor: 0, size: 3, truncated: false } },
    ]);
    expect(entries).toMatchObject([
      { kind: 'user', text: '! ls -la' },
      { kind: 'system', text: 'Saída do comando', detail: 'a\nb', level: 'info' },
    ]);
  });

  it('compactação, idle com falha/interrupção e avisos do sistema', () => {
    const entries = openCodeMessageEntries([
      { id: 'msg_c', type: 'compaction', time: { created: T0 }, status: 'completed', reason: 'auto', summary: 'resumo' },
      { id: 'msg_f', type: 'compaction', time: { created: T0 }, status: 'failed', reason: 'manual', error: { message: 'sem espaço' } },
      { id: 'msg_i', type: 'idle', time: { created: T0 }, outcome: 'interrupted' },
      { id: 'msg_x', type: 'idle', time: { created: T0 }, outcome: 'succeeded' },
      { id: 'msg_s', type: 'system', time: { created: T0 }, text: 'Aviso da sessão', description: 'Aviso curto' },
      { id: 'msg_n', type: 'system', time: { created: T0 }, text: 'catálogo', metadata: { notice: 'instructions' } },
    ]);
    expect(entries).toMatchObject([
      { kind: 'system', text: 'Conversa compactada automaticamente', detail: 'resumo' },
      { kind: 'system', text: 'Falha ao compactar o contexto', detail: 'sem espaço', level: 'error' },
      { kind: 'system', text: 'Interrompido pelo usuário', level: 'warn' },
      { kind: 'system', text: 'Aviso curto', detail: 'Aviso da sessão' },
    ]);
  });

  it('synthetic de shell não repete a saída; os outros viram system', () => {
    const entries = openCodeMessageEntries([
      { id: 'msg_1', type: 'synthetic', time: { created: T0 }, text: 'saída', metadata: { source: 'shell' } },
      { id: 'msg_2', type: 'synthetic', time: { created: T0 }, text: 'Concluído em 2 s', description: 'Tarefa terminou' },
    ]);
    expect(entries).toMatchObject([{ kind: 'system', text: 'Tarefa terminou', detail: 'Concluído em 2 s' }]);
  });
});

describe('OpenCodeMessageStream', () => {
  it('valida o id da sessão (nada de barra ou path traversal)', () => {
    expect(isOpenCodeSessionId('ses_e0e0637e8ffeA2xfzl73RN5se3')).toBe(true);
    expect(isOpenCodeSessionId('ses_1')).toBe(true);
    for (const bad of ['', '../x', 'ses/1', 'ses 1', 'x'.repeat(129)]) expect(isOpenCodeSessionId(bad)).toBe(false);
  });

  it('load traz a conversa em ordem e poll só o que apareceu depois', async () => {
    const client = new FakeClient();
    client.messages = [user('primeiro', {}, T0), assistant([{ type: 'text', text: 'ok' }], T0 + 1, { time: { created: T0 + 1, completed: T0 + 2 } })];
    const s = stream(client);
    const init = await s.load();
    expect(init).toMatchObject({ agentId: 'opencode:ses_1', truncated: false });
    expect(init.entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
    expect(client.paths[0]).toBe('/api/session/ses_1/message?limit=100&order=desc');

    client.messages.push(user('segundo', {}, T0 + 3));
    expect((await s.poll()).append).toMatchObject([{ kind: 'user', text: 'segundo' }]);
    expect((await s.poll()).append).toEqual([]);
  });

  it('ferramenta que termina depois do load entra só como resultado', async () => {
    const client = new FakeClient();
    const part = tool('shell', { command: 'npm test' }, { status: 'running', input: { command: 'npm test' } });
    client.messages = [assistant([part])];
    const s = stream(client);
    expect((await s.load()).entries.map((e) => e.kind)).toEqual(['tool']);
    part.state = { status: 'completed', input: { command: 'npm test' }, content: [{ type: 'text', text: 'ok' }], metadata: { exit: 0 } };
    part.time = { created: T0, completed: T0 + 10 };
    expect((await s.poll()).append).toMatchObject([{ kind: 'result', text: 'ok' }]);
  });

  it('init limita as entradas e marca truncated quando a API pagina', async () => {
    const client = new FakeClient();
    client.messages = [user('um', {}, T0), user('dois', {}, T0 + 1), user('três', {}, T0 + 2)];
    const s = stream(client, { initEntries: 2, limit: 2 });
    const init = await s.load();
    expect(init.entries.map((e) => 'text' in e && e.text)).toEqual(['dois', 'três']);
    expect(init.truncated).toBe(true);
  });

  it('erro do serviço sobe para o terminal (status preservado)', async () => {
    const client = new FakeClient();
    client.fail = Object.assign(new Error('OpenCode respondeu 404'), { status: 404 });
    await expect(stream(client).load()).rejects.toMatchObject({ status: 404 });
  });
});
