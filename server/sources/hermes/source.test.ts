// Fonte do Hermes: eventos do plugin aplicados no Office (sessões, status, ferramentas, subagentes, aprovação e uso),
// com contas por perfil e sala pelo projeto. Sem I/O: AccountService + Office + relógio injetado.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { HermesSource } from './source';
import type { HermesEventBody } from './events';

setQuiet(true);

const HOME = '/home/u/.hermes';
const DEV = '/home/u/.hermes/profiles/developer';

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
  const source = new HermesSource({ accounts, office, now: clock.now, home: HOME, staleMs: 60_000 });
  return { accounts, office, source, clock };
}

function ev(type: string, fields: Record<string, unknown> = {}, profile = 'developer', home = DEV): HermesEventBody {
  return { profile, home, event: { type, ts: undefined, ...fields } };
}

const snap = (office: Office): OfficeSnapshot => office.commit().snapshot;
const agent = (office: Office, id: string): AgentInfo | undefined => snap(office).agents.find((a) => a.id === id);
const MAIN = 'hermes:developer:s1';

describe('HermesSource: sessão principal', () => {
  it('session_open cria o agente na sala do projeto, com conta do perfil; sem eventos a fonte não aparece', () => {
    const { accounts, office, source } = setup();
    expect(source.sources()).toEqual([]);
    expect(source.applyEvent(ev('session_open', { session_id: 's1', platform: 'cli', project: '/p/loja' }))).toBe(true);
    const a = agent(office, MAIN);
    expect(a).toMatchObject({ kind: 'main', provider: 'hermes', account: 'developer', sessionId: 's1', roomId: '/p/loja', status: 'idle' });
    expect(a?.role).toBe('Hermes (cli)');
    expect(accounts.entriesOf('hermes').map((e) => [e.id, e.detected.name])).toEqual([['developer', 'Hermes developer']]);
    expect(source.sources()).toEqual([{ label: 'hermes', provider: 'hermes', path: DEV, sessions: 1, ok: true }]);
  });

  it('busy/idle, ferramenta (uma vez por call), uso (uma vez por id) e aprovação', () => {
    const { office, source, clock } = setup();
    source.applyEvent(ev('session_start', { session_id: 's1', platform: 'cli', project: '/p/loja', model: 'hermes-4' }));
    source.applyEvent(ev('session_busy', { session_id: 's1' }));
    expect(agent(office, MAIN)?.status).toBe('working');

    source.applyEvent(ev('tool_start', { session_id: 's1', call_id: 'c1', tool_name: 'terminal', preview: 'npm test' }));
    expect(agent(office, MAIN)?.activity).toMatchObject({ kind: 'test', text: 'Rodando testes', tool: 'terminal' });
    expect(agent(office, MAIN)?.stats.toolCalls).toBe(1);
    source.applyEvent(ev('tool_start', { session_id: 's1', call_id: 'c1', tool_name: 'terminal', preview: 'npm test' }));
    expect(agent(office, MAIN)?.stats.toolCalls).toBe(1);

    source.applyEvent(ev('usage', { session_id: 's1', usage_id: 'u1', usage: { input_tokens: 35, output_tokens: 8, cache_read_tokens: 20 }, response_model: 'hermes-4' }));
    expect(agent(office, MAIN)?.stats).toMatchObject({ tokensIn: 35, tokensOut: 8 });
    source.applyEvent(ev('usage', { session_id: 's1', usage_id: 'u1', usage: { input_tokens: 35, output_tokens: 8 } }));
    expect(agent(office, MAIN)?.stats).toMatchObject({ tokensIn: 35, tokensOut: 8 });
    expect(agent(office, MAIN)?.model).toBe('hermes-4');

    source.applyEvent(ev('approval_request', { session_id: 's1', call_id: 'c1', command: 'rm -rf /tmp/x' }));
    expect(agent(office, MAIN)).toMatchObject({ status: 'waiting', waitingFor: 'aprovar rm -rf /tmp/x' });
    source.applyEvent(ev('approval_response', { session_id: 's1', choice: 'approve' }));
    expect(agent(office, MAIN)?.status).toBe('working');

    clock.advance(1_000);
    source.applyEvent(ev('session_idle', { session_id: 's1' }));
    expect(agent(office, MAIN)?.status).toBe('idle');
  });

  it('subagente nasce do evento, recebe as ferramentas da sessão filha e entrega no subagent_stop', () => {
    const { office, source } = setup();
    source.applyEvent(ev('session_open', { session_id: 's1', platform: 'cli', project: '/p/loja' }));
    source.applyEvent(ev('subagent_start', { parent_session_id: 's1', child_session_id: 's2', child_role: 'reviewer', child_goal: 'Revisar a loja' }));
    const subId = `${MAIN}:s2`;
    expect(agent(office, subId)).toMatchObject({ kind: 'sub', parentId: MAIN, role: 'reviewer', title: 'Revisar a loja', status: 'working' });
    expect(agent(office, MAIN)?.stats.subagents).toBe(1);
    source.applyEvent(ev('tool_start', { session_id: 's2', call_id: 'c9', tool_name: 'read_file', preview: '/p/loja/app.ts' }));
    expect(agent(office, subId)?.activity).toMatchObject({ kind: 'read', text: 'Lendo app.ts' });
    source.applyEvent(ev('subagent_stop', { parent_session_id: 's1', child_session_id: 's2', child_status: 'completed' }));
    expect(agent(office, subId)?.status).toBe('done');
    // A sessão filha pode voltar a trabalhar: o subagente reativa.
    source.applyEvent(ev('tool_start', { session_id: 's2', call_id: 'c10', tool_name: 'read_file', preview: '/p/loja/b.ts' }));
    expect(agent(office, subId)?.status).toBe('working');
  });

  it('session_end fecha; sessão parada além da janela sai na varredura; evento desconhecido/inválido não entra', () => {
    const { office, source, clock } = setup();
    expect(source.applyEvent(ev('evento_novo', { session_id: 's1' }))).toBe(false);
    expect(source.applyEvent(ev('tool_start', {}))).toBe(false);
    source.applyEvent(ev('session_open', { session_id: 's1', project: '/p/loja' }));
    clock.advance(61_000);
    source.sweep();
    expect(agent(office, MAIN)?.status).toBe('offline');
    expect(source.sources()).toEqual([{ label: 'hermes', provider: 'hermes', path: DEV, sessions: 0, ok: true }]);

    source.applyEvent(ev('session_open', { session_id: 's1', project: '/p/loja' }));
    source.applyEvent(ev('session_end', { session_id: 's1', failed: true }));
    expect(agent(office, MAIN)?.status).toBe('offline');
    const feed = snap(office).agents.find((a) => a.id === MAIN)?.recent ?? [];
    expect(feed.some((a) => a.text === 'A sessão falhou')).toBe(true);
  });

  it('dois perfis viram duas contas; a conta que já existe não muda de id', () => {
    const { accounts, source } = setup();
    source.applyEvent(ev('session_open', { session_id: 's1', platform: 'cli' }, 'developer', DEV));
    source.applyEvent(ev('session_open', { session_id: 's2', platform: 'telegram' }, 'orchestrator', '/home/u/.hermes/profiles/orchestrator'));
    expect(accounts.entriesOf('hermes').map((e) => e.id).sort()).toEqual(['developer', 'orchestrator']);
    source.applyEvent(ev('session_busy', { session_id: 's1' }, 'developer', DEV));
    expect(accounts.entriesOf('hermes').map((e) => e.id).sort()).toEqual(['developer', 'orchestrator']);
  });

  it('uso antes do session_start ainda cria o principal; evento repetido pelo event_id não duplica atividade', () => {
    const { office, source } = setup();
    source.applyEvent(ev('usage', { session_id: 's0', usage_id: 'u0', usage: { input_tokens: 10, output_tokens: 2 }, platform: 'cli' }));
    expect(agent(office, 'hermes:developer:s0')).toMatchObject({ kind: 'main', status: 'idle' });
    expect(agent(office, 'hermes:developer:s0')?.stats).toMatchObject({ tokensIn: 10, tokensOut: 2 });

    const e = ev('tool_start', { session_id: 's0', call_id: 'c1', tool_name: 'terminal', preview: 'ls', event_id: 'ev-1' });
    source.applyEvent(e);
    source.applyEvent(e);
    expect(agent(office, 'hermes:developer:s0')?.stats.toolCalls).toBe(1);
  });
});
