// Roteador da conversa do roadmap: dado o item, descobre qual sessão real do escritório deve receber a pergunta.
//
// Regra fixa, sem LLM e sem aleatoriedade (mesma entrada, mesma saída):
//   1. participantes do item: o que está vivo no escritório e aceita mensagem; senão o mais recente;
//   2. sem participante no item: o mesmo critério sobre quem trabalhou no roadmap.
// A sessão vem de `resume` (pipeline novo) ou, em pipeline antigo, de `workerSessionId` + `provider` da execução.
// Id de run do pipeline e `workerSessionId` vazio nunca viram sessão. O `argv` do pipeline nunca é usado.
import type { Provider } from '../../shared/types';
import { isSessionId, providerOfHarness, providerOfPipeline, resumeCommand, safeWorkdir, validateResume } from './harness';

/** O que o roteador lê de um participante (subconjunto do que o pipeline devolve). */
export interface RouterParticipant {
  profile?: string;
  model?: string;
  role?: string;
  lastEndedAt?: string;
  resume?: unknown;
}

/** O que o roteador lê de uma execução (subconjunto do que o pipeline devolve). */
export interface RouterExecution {
  profile?: string;
  model?: string;
  role?: string;
  provider?: string;
  harness?: string;
  workerSessionId?: string;
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
  resume?: unknown;
}

/** Agente aberto no escritório (subconjunto de AgentInfo). */
export interface LiveAgent {
  id: string;
  provider?: Provider;
  sessionId: string;
  canMessage?: boolean;
}

export interface Candidate {
  provider: Provider;
  sessionId: string;
  /** Só existe quando o pipeline registrou `resume`; sem ele não dá para reabrir, só para falar com quem está vivo. */
  workdir?: string;
  profile?: string;
  role?: string;
  model?: string;
  /** Quando a sessão trabalhou no item (ISO); ordena do mais novo para o mais antigo. */
  at: string;
}

export type RouteReason = 'live' | 'recent' | 'roadmap-live' | 'roadmap-recent';

export interface RouteResult {
  reason: RouteReason;
  candidate: Candidate;
  /** Presente quando a sessão está viva no escritório e aceita mensagem. */
  agent?: LiveAgent;
  /** Há comando verificado para reabrir a sessão (provider com retomada conhecida e workdir registrado). */
  resumable: boolean;
}

export interface RouteInput {
  participants?: readonly RouterParticipant[];
  executions?: readonly RouterExecution[];
  /** Quem trabalhou no roadmap (fallback quando o item não tem ninguém). */
  roadmapParticipants?: readonly RouterParticipant[];
  roadmapExecutions?: readonly RouterExecution[];
  liveAgents: readonly LiveAgent[];
}

function fromResume(resume: unknown, extra: Pick<Candidate, 'profile' | 'role' | 'model' | 'at'>): Candidate | null {
  const valid = validateResume(resume);
  return valid ? { provider: valid.provider, sessionId: valid.sessionId, workdir: valid.workdir, ...extra } : null;
}

function candidatesOf(participants: readonly RouterParticipant[] = [], executions: readonly RouterExecution[] = []): Candidate[] {
  const all: Candidate[] = [];
  for (const p of participants) {
    const c = fromResume(p.resume, { profile: p.profile, role: p.role, model: p.model, at: p.lastEndedAt ?? '' });
    if (c) all.push(c);
  }
  for (const e of executions) {
    const extra = { profile: e.profile, role: e.role, model: e.model, at: e.endedAt ?? e.startedAt ?? '' };
    const c = fromResume(e.resume, extra);
    if (c) {
      all.push(c);
      continue;
    }
    const provider = providerOfHarness(e.harness) ?? providerOfPipeline(e.provider);
    if (!provider || !isSessionId(e.workerSessionId)) continue;
    const workdir = safeWorkdir(e.cwd);
    all.push({ provider, sessionId: e.workerSessionId, ...(workdir ? { workdir } : {}), ...extra });
  }
  // Mais novo primeiro; o empate fica na ordem em que chegou. Uma sessão só entra uma vez (a mais nova dela).
  const ordered = all.map((c, i) => ({ c, i })).sort((a, b) => (a.c.at < b.c.at ? 1 : a.c.at > b.c.at ? -1 : a.i - b.i));
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const { c } of ordered) {
    const key = `${c.provider}:${c.sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

function resumable(c: Candidate): boolean {
  return !!c.workdir && resumeCommand({ provider: c.provider, sessionId: c.sessionId, workdir: c.workdir }) !== null;
}

/** Cada candidata vira um alvo; as vivas e acessíveis vêm primeiro, e a ordem de recência vale dentro de cada grupo. */
function targetsOf(candidates: readonly Candidate[], liveAgents: readonly LiveAgent[], liveReason: RouteReason, recentReason: RouteReason): RouteResult[] {
  const targets = candidates.map((candidate): RouteResult => {
    const agent = liveAgents.find((a) => a.canMessage === true && a.provider === candidate.provider && a.sessionId === candidate.sessionId);
    return agent
      ? { reason: liveReason, candidate, agent, resumable: resumable(candidate) }
      : { reason: recentReason, candidate, resumable: resumable(candidate) };
  });
  return [...targets.filter((t) => t.agent), ...targets.filter((t) => !t.agent)];
}

/** Todas as sessões que trabalharam no item (ou, sem nenhuma, no roadmap), sem repetição. */
export function listTargets(input: RouteInput): RouteResult[] {
  const item = targetsOf(candidatesOf(input.participants, input.executions), input.liveAgents, 'live', 'recent');
  if (item.length > 0) return item;
  return targetsOf(candidatesOf(input.roadmapParticipants, input.roadmapExecutions), input.liveAgents, 'roadmap-live', 'roadmap-recent');
}

export function resolveTarget(input: RouteInput): RouteResult | null {
  return listTargets(input)[0] ?? null;
}
