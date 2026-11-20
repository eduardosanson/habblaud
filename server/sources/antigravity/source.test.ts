// Fonte do Antigravity: eventos normalizados do hook -> Office, conta única e sem terminal por enquanto.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { AntigravitySource } from './source';

setQuiet(true);

function setup() {
  let now = 1_790_000_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const accounts = new AccountsService({ dirs: [], home: '/home/u', env: {}, now: clock.now, onChange: () => {} });
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    now: clock.now,
  });
  const source = new AntigravitySource({ accounts, office, now: clock.now, home: '/home/u', dir: '/home/u/.gemini/antigravity-cli', usageMs: 0 });
  return { accounts, office, source, clock };
}

const snap = (office: Office): OfficeSnapshot => office.commit().snapshot;
const agent = (office: Office): AgentInfo | undefined => snap(office).agents[0];
const MAIN = 'antigravity:c1';

const ev = (type: string, fields: Record<string, unknown> = {}) => ({ event: { type, session_id: 'c1', ...fields } });

describe('AntigravitySource', () => {
  it('session_start cria a conta única e o agente na sala do projeto, com título e modelo', () => {
    const { accounts, office, source } = setup();
    expect(source.applyEvent(ev('session_start', { project: '/p/loja', title: 'Revisar a loja', model: 'Gemini 4' }))).toBe(true);
    expect(agent(office)).toMatchObject({ id: MAIN, provider: 'antigravity', account: 'antigravity', sessionId: 'c1', roomId: '/p/loja', status: 'idle', title: 'Revisar a loja', model: 'Gemini 4' });
    expect(accounts.entriesOf('antigravity').map((e) => [e.id, e.detected.name])).toEqual([['antigravity', 'Antigravity']]);
    expect(source.sources()).toEqual([{ label: 'antigravity', provider: 'antigravity', path: '/home/u/.gemini/antigravity-cli', sessions: 1, ok: true }]);
  });

  it('busy/idle, ferramenta e encerramento mudam o status e a atividade', () => {
    const { office, source } = setup();
    source.applyEvent(ev('session_start', { project: '/p/loja' }));
    source.applyEvent(ev('session_busy', { title: 'Rodar os testes' }));
    expect(agent(office)?.status).toBe('working');
    source.applyEvent(ev('tool_start', { tool_name: 'run_command', call_id: 'call-1', input: { command: 'echo oi' } }));
    expect(agent(office)?.activity).toMatchObject({ kind: 'run', tool: 'run_command' });
    source.applyEvent(ev('tool_end', { tool_name: 'run_command', call_id: 'call-1', error: 'falhou' }));
    expect(agent(office)?.activity).toMatchObject({ kind: 'error' });
    source.applyEvent(ev('session_idle'));
    expect(agent(office)?.status).toBe('idle');
    source.applyEvent(ev('session_end', { failed: true, error: 'acabou mal' }));
    expect(agent(office)?.status).toBe('offline');
    expect(source.sources()[0].sessions).toBe(0);
  });

  it('evento desconhecido ou sem sessão é ignorado', () => {
    const { source } = setup();
    expect(source.applyEvent({ event: { type: 'qualquer' } })).toBe(false);
    expect(source.applyEvent({ event: { type: 'session_start' } })).toBe(false);
  });
});
