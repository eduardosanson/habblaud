import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findClaudeSession, isClaudeSessionRunning, reopen, type ReopenDeps } from './reopen';
import type { PipelineGet } from './converse';

const SID = '0198a1b2-c3d4-4e5f-8a9b-0123456789ab';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reopen-'));
  dirs.push(dir);
  return dir;
}

/** Conta do Claude Code com o transcript da sessão gravado na pasta `cwd`. */
function account(cwd: string | null, id = 'acc'): { id: string; dir: string } {
  const dir = temp();
  const project = join(dir, 'projects', '-w-proj');
  mkdirSync(project, { recursive: true });
  if (cwd !== null) {
    const lines = ['{"type":"summary"}', 'isto não é json', JSON.stringify({ type: 'user', cwd }), JSON.stringify({ type: 'user', cwd: '/outra' })];
    writeFileSync(join(project, `${SID}.jsonl`), lines.join('\n') + '\n');
  }
  return { id, dir };
}

const execution = { provider: 'claude-code', workerSessionId: SID, cwd: '/do/pipeline', endedAt: '2026-11-22T10:00:00Z' };

const get: PipelineGet = async (path) =>
  path.endsWith('/items/i/executions') ? { status: 200, json: { executions: [execution] } } : { status: 404, json: null };

interface Fake {
  deps: ReopenDeps;
  resumed: Array<{ sessionId: string; cwd: string; account: string }>;
}

function fake(over: Partial<ReopenDeps> = {}, cwd: string | null = '/w/proj'): Fake {
  const resumed: Fake['resumed'] = [];
  const acc = account(cwd);
  const deps: ReopenDeps = {
    office: { list: () => [] },
    messages: { canMessage: () => false, send: () => ({ error: 'not-found' }) },
    accounts: () => [acc],
    resume: (p) => {
      resumed.push(p);
      return { agentId: `${p.account}:99` };
    },
    isAlive: () => false,
    ...over,
  };
  return { deps, resumed };
}

const body = { roadmapId: 'r', itemId: 'i', session: { provider: 'claude', sessionId: SID } };
const run = (f: Fake, raw: unknown = body) => reopen(f.deps, get, () => true, raw);
const code = (out: { body: unknown }) => (out.body as { error?: { code: string } }).error?.code;

describe('findClaudeSession', () => {
  it('usa a primeira pasta gravada no transcript local', () => {
    const acc = account('/w/proj');
    expect(findClaudeSession([acc], SID)).toEqual({ account: 'acc', cwd: '/w/proj' });
  });

  it('procura em todas as contas', () => {
    expect(findClaudeSession([account(null, 'vazia'), account('/w/b', 'b')], SID)).toEqual({ account: 'b', cwd: '/w/b' });
  });

  it('sem transcript, ou com id que não é de sessão, não acha nada', () => {
    expect(findClaudeSession([account(null)], SID)).toBeNull();
    expect(findClaudeSession([account('/w/proj')], '../../etc/passwd')).toBeNull();
  });
});

describe('isClaudeSessionRunning', () => {
  it('reconhece a sessão registrada por um processo vivo', () => {
    const acc = account('/w/proj');
    mkdirSync(join(acc.dir, 'sessions'));
    writeFileSync(join(acc.dir, 'sessions', '123.json'), JSON.stringify({ sessionId: SID }));
    expect(isClaudeSessionRunning([acc], SID, (pid) => pid === 123)).toBe(true);
    expect(isClaudeSessionRunning([acc], SID, () => false)).toBe(false);
  });
});

describe('reopen', () => {
  it('reabre a sessão fechada na pasta do transcript, não na do pipeline', async () => {
    const f = fake();
    const out = await run(f);
    expect(out).toEqual({ status: 202, body: { reopened: true, agentId: 'acc:99' } });
    expect(f.resumed).toEqual([{ sessionId: SID, cwd: '/w/proj', account: 'acc' }]);
  });

  it('não reabre sessão que está no escritório, mesmo sem receber mensagem', async () => {
    const f = fake({ office: { list: () => [{ id: 'acc:7', sessionId: SID, kind: 'main', status: 'idle' }] } });
    const out = await run(f);
    expect(out).toEqual({ status: 200, body: { reopened: false, agentId: 'acc:7' } });
    expect(f.resumed).toEqual([]);
  });

  it('agente que já saiu do escritório não conta como aberto', async () => {
    const f = fake({ office: { list: () => [{ id: 'acc:7', sessionId: SID, kind: 'main', status: 'offline' }] } });
    expect((await run(f)).status).toBe(202);
  });

  it('recusa quando há processo vivo com a sessão que o escritório ainda não viu', async () => {
    const acc = account('/w/proj');
    mkdirSync(join(acc.dir, 'sessions'));
    writeFileSync(join(acc.dir, 'sessions', '123.json'), JSON.stringify({ sessionId: SID }));
    const f = fake({ accounts: () => [acc], isAlive: () => true });
    const out = await run(f);
    expect([out.status, code(out)]).toEqual([409, 'already_open']);
    expect(f.resumed).toEqual([]);
  });

  it('segundo pedido enquanto o terminal que abrimos ainda sobe devolve o mesmo agente', async () => {
    const f = fake({ opened: () => 'acc:99', isAlive: () => true });
    expect(await run(f)).toEqual({ status: 200, body: { reopened: false, agentId: 'acc:99' } });
    expect(f.resumed).toEqual([]);
  });

  it('só reabre sessão que o servidor listou para o item', async () => {
    const f = fake();
    const out = await run(f, { ...body, session: { provider: 'claude', sessionId: '0198a1b2-c3d4-4e5f-8a9b-000000000000' } });
    expect([out.status, code(out)]).toEqual([400, 'unknown_session']);
    expect(f.resumed).toEqual([]);
  });

  it('terminal desligado: explica como ligar', async () => {
    const f = fake({ resume: undefined, disabledReason: () => 'desligado (ligue com HABBLAUD_PTY=1)' });
    const out = await run(f);
    expect([out.status, code(out)]).toEqual([409, 'reopen_disabled']);
    expect((out.body as { error: { message: string } }).error.message).toContain('HABBLAUD_PTY=1');
  });

  it('sem transcript nesta máquina não abre nada', async () => {
    const f = fake({}, null);
    const out = await run(f);
    expect([out.status, code(out)]).toEqual([409, 'transcript_missing']);
  });

  it('erro do terminal volta com o status e a mensagem dele', async () => {
    const f = fake({
      resume: () => {
        throw Object.assign(new Error('pasta não encontrada: /w/proj'), { status: 400 });
      },
    });
    const out = await run(f);
    expect([out.status, code(out)]).toEqual([400, 'reopen_failed']);
  });

  it('harness sem reabertura verificada é recusado', async () => {
    const f = fake();
    const codex: PipelineGet = async () => ({ status: 200, json: { executions: [{ ...execution, provider: 'codex' }] } });
    const out = await reopen(f.deps, codex, () => true, { ...body, session: { provider: 'codex', sessionId: SID } });
    expect([out.status, code(out)]).toEqual([409, 'unsupported_provider']);
  });

  it('pasta ainda não confiável: explica o que fazer, sem expor o caminho', async () => {
    const f = fake({ blockedOnTrust: async () => true });
    const out = await run(f);
    expect([out.status, code(out)]).toEqual([409, 'folder_untrusted']);
    const message = (out.body as { error: { message: string } }).error.message;
    expect(message).toContain('proj');
    expect(message).not.toContain('/w/proj');
  });

  it('corpo sem sessão é pedido inválido', async () => {
    const f = fake();
    expect((await run(f, { roadmapId: 'r', itemId: 'i' })).status).toBe(400);
  });
});
