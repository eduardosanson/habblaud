import { describe, expect, it } from 'vitest';
import type { ApiItemExecution, ApiParticipant } from '../../client/src/roadmap/pipeline';
import { listTargets, resolveTarget, type LiveAgent } from './router';

const SID_A = '0198a1b2-c3d4-4e5f-8a9b-0123456789ab';
const SID_B = '0198a1b2-c3d4-4e5f-8a9b-0123456789cd';

function participant(over: Partial<ApiParticipant> & { sessionId?: string; harness?: string } = {}): ApiParticipant {
  const harness = over.harness ?? 'codex';
  return {
    profile: 'impl',
    harness,
    model: 'm',
    role: 'implementador',
    executions: 1,
    lastEndedAt: '2026-11-22T10:00:00Z',
    resume: { harness, sessionId: over.sessionId ?? SID_A, workdir: '/w/proj', argv: ['x'] },
    ...over,
  };
}

function execution(over: Partial<ApiItemExecution> = {}): ApiItemExecution {
  return {
    id: 1,
    roadmapId: 'r',
    itemId: 'i',
    source: 'pipeline-run',
    profile: 'impl',
    provider: 'antigravity',
    model: 'm',
    workerSessionId: SID_A,
    startedAt: '2026-11-22T09:00:00Z',
    endedAt: '2026-11-22T10:00:00Z',
    ...over,
  };
}

const live = (provider: LiveAgent['provider'], sessionId: string, over: Partial<LiveAgent> = {}): LiveAgent => ({
  id: `${provider}:${sessionId}`,
  provider,
  sessionId,
  canMessage: true,
  ...over,
});

describe('resolveTarget', () => {
  it('prefere o participante que está vivo no escritório (CA03)', () => {
    const result = resolveTarget({
      participants: [
        participant({ sessionId: SID_A, lastEndedAt: '2026-11-22T12:00:00Z' }),
        participant({ sessionId: SID_B, lastEndedAt: '2026-11-22T08:00:00Z' }),
      ],
      liveAgents: [live('codex', SID_B)],
    });
    expect(result).toMatchObject({ reason: 'live', candidate: { sessionId: SID_B }, agent: { id: `codex:${SID_B}` } });
  });

  it('sem ninguém vivo, escolhe o mais recente e diz se dá para reabrir', () => {
    const result = resolveTarget({
      participants: [
        participant({ sessionId: SID_A, lastEndedAt: '2026-11-22T08:00:00Z' }),
        participant({ sessionId: SID_B, lastEndedAt: '2026-11-22T12:00:00Z' }),
      ],
      liveAgents: [],
    });
    expect(result).toMatchObject({ reason: 'recent', candidate: { sessionId: SID_B }, resumable: true });
    expect(result && 'agent' in result ? result.agent : undefined).toBeUndefined();
  });

  it('harness sem retomada verificada aparece como não reabrível', () => {
    const result = resolveTarget({ participants: [participant({ harness: 'agy' })], liveAgents: [] });
    expect(result).toMatchObject({ candidate: { provider: 'antigravity' }, resumable: false });
  });

  it('ignora agente vivo que não aceita mensagem', () => {
    const result = resolveTarget({
      participants: [participant({ sessionId: SID_A })],
      liveAgents: [live('codex', SID_A, { canMessage: false })],
    });
    expect(result).toMatchObject({ reason: 'recent' });
  });

  it('usa o fallback do roadmap quando o item não tem participante (CA04)', () => {
    const result = resolveTarget({
      participants: [],
      roadmapParticipants: [participant({ sessionId: SID_B })],
      liveAgents: [live('codex', SID_B)],
    });
    expect(result).toMatchObject({ reason: 'roadmap-live', candidate: { sessionId: SID_B } });
  });

  it('devolve null com motivo quando não há ninguém (CA04)', () => {
    expect(resolveTarget({ participants: [], liveAgents: [] })).toBeNull();
  });

  it('com pipeline antigo (sem resume), usa o workerSessionId real e o provider da execução', () => {
    const result = resolveTarget({
      participants: [],
      executions: [execution({ provider: 'antigravity', workerSessionId: SID_A })],
      liveAgents: [live('antigravity', SID_A)],
    });
    expect(result).toMatchObject({ reason: 'live', candidate: { provider: 'antigravity', sessionId: SID_A } });
    expect(result && result.candidate.workdir).toBeUndefined();
  });

  it('nunca trata id de run nem workerSessionId vazio como sessão do harness (CA05)', () => {
    const result = resolveTarget({
      participants: [],
      executions: [
        execution({ workerSessionId: '' }),
        execution({ id: 2, workerSessionId: 'run:feat-demo:demo:D1:2' }),
        execution({ id: 3, provider: 'claude-subscription-directsdk-experimental', workerSessionId: SID_B }),
      ],
      liveAgents: [live('claude', SID_B)],
    });
    expect(result).toBeNull();
  });

  it('é determinístico: a mesma entrada dá a mesma saída (RNF02)', () => {
    const input = {
      participants: [participant({ sessionId: SID_A }), participant({ sessionId: SID_B })],
      liveAgents: [live('codex', SID_A), live('codex', SID_B)],
    };
    expect(resolveTarget(input)).toEqual(resolveTarget(input));
  });
});

describe('com as execuções do pipeline atual (provider do enum, sem participants)', () => {
  it('acha o agente Claude vivo quando o provider vem como claude-code (CA01)', () => {
    const result = resolveTarget({
      executions: [execution({ provider: 'claude-code', workerSessionId: SID_A })],
      liveAgents: [live('claude', SID_A)],
    });
    expect(result).toMatchObject({ reason: 'live', candidate: { provider: 'claude', sessionId: SID_A }, agent: { id: `claude:${SID_A}` } });
  });

  it('lista a mesma sessão uma vez, com a execução mais recente (CA03)', () => {
    const targets = listTargets({
      executions: [
        execution({ id: 1, provider: 'codex', workerSessionId: SID_A, profile: 'velho', endedAt: '2026-11-22T08:00:00Z' }),
        execution({ id: 2, provider: 'codex', workerSessionId: SID_A, profile: 'novo', endedAt: '2026-11-22T12:00:00Z' }),
      ],
      liveAgents: [],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.candidate).toMatchObject({ sessionId: SID_A, profile: 'novo' });
  });

  it('não lista execução sem id de sessão (o revisor do pipeline)', () => {
    const targets = listTargets({
      executions: [execution({ provider: 'claude-subscription-directsdk-experimental', workerSessionId: '' }), execution({ workerSessionId: '' })],
      liveAgents: [],
    });
    expect(targets).toEqual([]);
  });

  it('põe as vivas primeiro e depois as mais recentes', () => {
    const targets = listTargets({
      executions: [
        execution({ id: 1, provider: 'codex', workerSessionId: SID_A, endedAt: '2026-11-22T12:00:00Z' }),
        execution({ id: 2, provider: 'codex', workerSessionId: SID_B, endedAt: '2026-11-22T08:00:00Z' }),
      ],
      liveAgents: [live('codex', SID_B)],
    });
    expect(targets.map((t) => t.candidate.sessionId)).toEqual([SID_B, SID_A]);
    expect(targets[0]!.agent?.id).toBe(`codex:${SID_B}`);
    expect(targets[1]!.agent).toBeUndefined();
  });

  it('só diz que dá para reabrir quando a execução traz o cwd', () => {
    const withCwd = resolveTarget({ executions: [execution({ provider: 'claude-code', workerSessionId: SID_A, cwd: '/home/u/proj' })], liveAgents: [] });
    const without = resolveTarget({ executions: [execution({ provider: 'claude-code', workerSessionId: SID_A })], liveAgents: [] });
    expect(withCwd).toMatchObject({ reason: 'recent', resumable: true, candidate: { workdir: '/home/u/proj' } });
    expect(without).toMatchObject({ reason: 'recent', resumable: false });
  });

  it('descarta cwd relativo ou com ..', () => {
    const rel = resolveTarget({ executions: [execution({ provider: 'claude-code', workerSessionId: SID_A, cwd: '../x' })], liveAgents: [] });
    const dots = resolveTarget({ executions: [execution({ provider: 'claude-code', workerSessionId: SID_A, cwd: '/a/../b' })], liveAgents: [] });
    expect(rel).toMatchObject({ resumable: false });
    expect(dots).toMatchObject({ resumable: false });
  });
});
