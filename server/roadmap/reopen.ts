// Reabrir a PRÓPRIA sessão finalizada que trabalhou no item, para a pergunta ser respondida por quem fez o trabalho.
//
// Só o Claude Code, num terminal do Habblaud (`claude --resume <id>`, PtyManager). Regras de segurança:
// - só uma sessão que o servidor listou para o item (o navegador nunca aponta um destino por conta própria);
// - a pasta vem do transcript gravado NESTA máquina, nunca do pipeline (abrir o Claude Code numa pasta carrega os
//   hooks e as permissões dela, e o pipeline pode ser remoto);
// - sessão que ainda está aberta em algum lugar nunca é reaberta (duas cópias gravariam a mesma conversa).
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tr } from '../../shared/i18n';
import { targetsFor, type ConverseDeps, type ConverseOutcome, type PipelineGet } from './converse';
import { safeWorkdir } from './harness';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quanto ler do começo do transcript para achar a pasta (a primeira linha com `cwd` vem logo). */
const HEAD_BYTES = 1024 * 1024;

export interface ReopenAccount {
  id: string;
  /** Pasta de configuração do Claude Code (com `projects/` e `sessions/`). */
  dir: string;
}

export interface ReopenDeps extends Omit<ConverseDeps, 'office'> {
  office: { list(): ReadonlyArray<ReturnType<ConverseDeps['office']['list']>[number] & { status?: string }> };
  accounts: () => ReadonlyArray<ReopenAccount>;
  /** Abre o terminal retomando a sessão. Ausente = terminal interativo desligado. */
  resume?: (p: { sessionId: string; cwd: string; account: string }) => { agentId?: string };
  /** Agente do terminal que o Habblaud já abriu para esta sessão e ainda roda. */
  opened?: (sessionId: string) => string | undefined;
  disabledReason?: () => string | undefined;
  /** Depois de abrir: o terminal parou no aviso de pasta não confiável (e foi encerrado)? */
  blockedOnTrust?: (sessionId: string) => Promise<boolean>;
  isAlive: (pid: number) => boolean;
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function transcriptCwd(file: string): string | null {
  let head: string;
  try {
    const buffer = Buffer.alloc(Math.min(statSync(file).size, HEAD_BYTES));
    const fd = openSync(file, 'r');
    try {
      head = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of head.split('\n')) {
    try {
      const cwd = safeWorkdir((JSON.parse(line) as { cwd?: unknown } | null)?.cwd);
      if (cwd) return cwd;
    } catch {
      // linha vazia, cortada ou que não é JSON
    }
  }
  return null;
}

/** Conta e pasta de uma sessão do Claude Code, pelo transcript local (`<conta>/projects/*\/<id>.jsonl`). */
export function findClaudeSession(accounts: ReadonlyArray<ReopenAccount>, sessionId: string): { account: string; cwd: string } | null {
  if (!SESSION_ID.test(sessionId)) return null;
  for (const account of accounts) {
    const projects = join(account.dir, 'projects');
    for (const project of entries(projects)) {
      const cwd = transcriptCwd(join(projects, project, `${sessionId}.jsonl`));
      if (cwd) return { account: account.id, cwd };
    }
  }
  return null;
}

/** Há processo vivo com esta sessão no registro de alguma conta (`<conta>/sessions/<pid>.json`)? */
export function isClaudeSessionRunning(accounts: ReadonlyArray<ReopenAccount>, sessionId: string, isAlive: (pid: number) => boolean): boolean {
  return accounts.some((account) => {
    const sessions = join(account.dir, 'sessions');
    return entries(sessions).some((name) => {
      const pid = /^(\d+)\.json$/.exec(name)?.[1];
      if (!pid || !isAlive(Number(pid))) return false;
      try {
        return (JSON.parse(readFileSync(join(sessions, name), 'utf8')) as { sessionId?: unknown }).sessionId === sessionId;
      } catch {
        return false;
      }
    });
  });
}

function fail(status: number, code: string, message: string): ConverseOutcome {
  return { status, body: { error: { code, message, retryable: false } } };
}

const ok = (status: number, reopened: boolean, agentId: string | undefined): ConverseOutcome => ({
  status,
  body: { reopened, ...(agentId ? { agentId } : {}) },
});

/** POST /api/roadmap/reopen {roadmapId, itemId, session}: 202 abriu; 200 já estava aberta. */
export async function reopen(deps: ReopenDeps, get: PipelineGet, allowedRoadmap: (id: string) => boolean, raw: unknown): Promise<ConverseOutcome> {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const session = body.session && typeof body.session === 'object' ? (body.session as Record<string, unknown>) : {};
  const { roadmapId, itemId } = body;
  const { provider, sessionId } = session;
  if (typeof roadmapId !== 'string' || !roadmapId || typeof itemId !== 'string' || !itemId || typeof provider !== 'string' || typeof sessionId !== 'string') {
    return fail(400, 'bad_request', tr('esperado {roadmapId, itemId, session}'));
  }
  if (!allowedRoadmap(roadmapId)) return fail(404, 'not_found', tr('roadmap fora da lista permitida'));

  const found = await targetsFor(deps, get, roadmapId, itemId);
  if ('failure' in found) return found.failure;
  const target = found.targets.find((t) => t.candidate.provider === provider && t.candidate.sessionId === sessionId);
  if (!target) return fail(400, 'unknown_session', tr('essa sessão não trabalhou neste item'));
  if (target.candidate.provider !== 'claude') return fail(409, 'unsupported_provider', tr('por enquanto só sessões do Claude Code podem ser reabertas por aqui'));

  const present = deps.office
    .list()
    .find((a) => a.kind === 'main' && (a.provider ?? 'claude') === 'claude' && a.sessionId === sessionId && a.status !== 'offline' && a.status !== 'done');
  if (present) return ok(200, false, present.id);
  const opened = deps.opened?.(sessionId);
  if (opened) return ok(200, false, opened);

  if (!deps.resume) return fail(409, 'reopen_disabled', tr('reabrir sessões está desligado: {0}', [deps.disabledReason?.() ?? tr('indisponível')]));
  const accounts = deps.accounts();
  if (isClaudeSessionRunning(accounts, sessionId, deps.isAlive)) {
    return fail(409, 'already_open', tr('essa sessão ainda está aberta em outro lugar; feche-a ou espere ela aparecer no escritório'));
  }
  const local = findClaudeSession(accounts, sessionId);
  if (!local) return fail(409, 'transcript_missing', tr('não achei a conversa desta sessão neste computador'));
  try {
    const { agentId } = deps.resume({ sessionId, cwd: local.cwd, account: local.account });
    if (await deps.blockedOnTrust?.(sessionId)) {
      return fail(409, 'folder_untrusted', tr('a pasta {0} ainda não é confiável para o Claude Code: abra o claude nela uma vez, confirme, e reabra', [basename(local.cwd)]));
    }
    return ok(202, true, agentId);
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return fail(typeof status === 'number' ? status : 500, 'reopen_failed', error instanceof Error ? error.message : tr('erro interno'));
  }
}
