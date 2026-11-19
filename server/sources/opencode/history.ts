// Histórico do terminal do OpenCode (o HistoryProvider 'opencode', ver sources/source.ts): as sessões raiz dos
// últimos 7 dias vêm de GET /api/session. Não há arquivo por sessão (o OpenCode guarda tudo no banco dele), então a
// listagem não tem tamanho de transcript e a conversa é resolvida por um MessageStream (GET .../message), o mesmo
// caminho do terminal de um agente aberto. Subagentes ficam de fora da listagem, como no Claude Code e no Codex.
import type { RecentSession } from '../../../shared/types';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from '../history';
import type { HistoryProvider, HistoryResolveResult } from '../source';
import { encodeCwd } from '../watcher';
import type { OpenCodeClientLike } from './client';
import { parseOpenCodeSession, type OpenCodeSession } from './map';
import { createOpenCodeMessageStream, isOpenCodeSessionId } from './terminal';
import { tr } from '../../../shared/i18n';

/** Polling da conversa de uma sessão do histórico (quase sempre encerrada). */
const SESSION_POLL_MS = 2_000;

export interface OpenCodeHistoryAccount {
  id: string;
}

export interface OpenCodeHistoryOptions {
  /** Contas do OpenCode (o AccountsService as registra quando a fonte sobe). */
  accounts: () => readonly OpenCodeHistoryAccount[];
  /** Cliente do serviço; undefined antes do boot (ou quando o OpenCode não está no ar). */
  client: () => OpenCodeClientLike | undefined;
  /** Agente principal da sessão, se ela ainda estiver aberta no escritório. */
  openAgentOf: (account: string, sessionId: string) => string | undefined;
  now?: () => number;
  maxAgeMs?: number;
  limit?: number;
}

export class OpenCodeHistory implements HistoryProvider {
  readonly provider = 'opencode' as const;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly limit: number;
  /** cwd por sessão visto na última listagem (para os títulos das ferramentas no terminal). */
  private readonly cwds = new Map<string, string>();

  constructor(private readonly opts: OpenCodeHistoryOptions) {
    this.now = opts.now ?? Date.now;
    this.maxAgeMs = opts.maxAgeMs ?? HISTORY_MAX_AGE_MS;
    this.limit = opts.limit ?? HISTORY_LIMIT;
  }

  hasAccount(account: string): boolean {
    return this.opts.accounts().some((a) => a.id === account);
  }

  async list(): Promise<RecentSession[]> {
    const client = this.opts.client();
    if (!client) return [];
    const raw = await client.get<unknown>(`/api/session?limit=${this.limit}&order=desc`);
    if (!Array.isArray(raw)) return [];
    const now = this.now();
    this.cwds.clear();
    const sessions: OpenCodeSession[] = [];
    for (const item of raw) {
      const s = parseOpenCodeSession(item);
      if (!s || s.parentId || s.archivedAt !== undefined) continue;
      const seen = Math.max(s.time.updated, s.time.viewed ?? 0, s.time.created);
      if (now - seen > this.maxAgeMs) continue;
      sessions.push(s);
    }
    sessions.sort((a, b) => b.time.updated - a.time.updated);

    const account = this.accountId();
    if (!account) return [];
    const out: RecentSession[] = [];
    for (const s of sessions.slice(0, this.limit)) {
      if (s.cwd) this.cwds.set(s.id, s.cwd);
      const agentId = this.opts.openAgentOf(account, s.id);
      const r: RecentSession = {
        account,
        provider: 'opencode',
        sessionId: s.id,
        projectDir: s.cwd ? encodeCwd(s.cwd) : 'opencode',
        lastAt: s.time.updated,
        size: 0,
        open: !!agentId,
      };
      if (s.cwd) r.project = s.cwd;
      if (s.title) r.title = s.title;
      r.firstAt = s.time.created;
      if (agentId) r.agentId = agentId;
      out.push(r);
    }
    return out;
  }

  /**
   * Valida a conta e o id e devolve um stream da conversa. A existência da sessão é conferida na primeira leitura
   * (GET .../message): um id bem formado e desconhecido vira 404 no próprio terminal, sem tocar em arquivo nenhum.
   */
  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!isOpenCodeSessionId(sessionId)) return { status: 400, error: tr('id de sessão inválido') };
    if (!this.hasAccount(account)) return { status: 404, error: tr('conta desconhecida') };
    const client = this.opts.client();
    if (!client) return { status: 404, error: tr('sessão não encontrada') };
    const cwd = this.cwds.get(sessionId);
    return {
      stream: () =>
        createOpenCodeMessageStream({
          client,
          sessionId,
          streamId: `session:${account}:${sessionId}`,
          intervalMs: SESSION_POLL_MS,
          ...(cwd ? { cwd } : {}),
        }),
    };
  }

  /** O OpenCode tem uma conta só, com o id que o AccountsService escolheu (normalmente "opencode"). */
  private accountId(): string | undefined {
    return this.opts.accounts()[0]?.id;
  }
}
