// Ponte entre o registro do Hermes Pipeline e as sessões reais do escritório.
//
// O pipeline só registra quem trabalhou em cada item (`resume`: harness, sessionId, workdir, argv). Este módulo
// traduz esse registro para o vocabulário do Habblaud e decide o que é seguro usar:
// - o harness do pipeline vira `Provider` (agy → antigravity);
// - `resume` é validado: sessionId e workdir bem formados. Id de run do pipeline (`run:...`) não é sessão;
// - o `argv` do pipeline é dado de outro processo e NUNCA é repassado nem executado: o comando de retomada sai
//   de uma lista fixa por provider, a partir de sessionId + workdir validados.
// Node puro, sem dependências.
import type { Provider } from '../../shared/types';

const PROVIDER_BY_HARNESS: Readonly<Record<string, Provider>> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  hermes: 'hermes',
  agy: 'antigravity',
};

/** Id de sessão aceito: começa e termina alfanumérico, só letras, dígitos, `.`, `_` e `-` no meio. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}[A-Za-z0-9]$|^[A-Za-z0-9]$/;
const WORKDIR_MAX = 1_024;

export interface ValidResume {
  provider: Provider;
  sessionId: string;
  workdir: string;
}

export interface ResumeCommand {
  file: string;
  args: string[];
  cwd: string;
}

export function providerOfHarness(harness: unknown): Provider | null {
  if (typeof harness !== 'string') return null;
  return Object.hasOwn(PROVIDER_BY_HARNESS, harness) ? PROVIDER_BY_HARNESS[harness]! : null;
}

function safeWorkdir(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > WORKDIR_MAX) return null;
  if (!value.startsWith('/') || value.includes('\0')) return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

/** Valida o descritor `resume` do pipeline. Devolve só os campos seguros (nunca o argv) ou `null`. */
export function validateResume(resume: unknown): ValidResume | null {
  if (!resume || typeof resume !== 'object') return null;
  const r = resume as Record<string, unknown>;
  const provider = providerOfHarness(r.harness);
  if (!provider) return null;
  if (typeof r.sessionId !== 'string' || !SESSION_ID.test(r.sessionId)) return null;
  const workdir = safeWorkdir(r.workdir);
  if (!workdir) return null;
  return { provider, sessionId: r.sessionId, workdir };
}

/**
 * Comando para reabrir uma sessão, só onde a retomada foi verificada (`claude --resume <id>`, `codex resume <id>`).
 * Os demais providers devolvem `null`: a página explica que a sessão está fechada em vez de inventar resposta.
 */
export function resumeCommand(r: ValidResume): ResumeCommand | null {
  switch (r.provider) {
    case 'claude':
      return { file: 'claude', args: ['--resume', r.sessionId], cwd: r.workdir };
    case 'codex':
      return { file: 'codex', args: ['resume', r.sessionId], cwd: r.workdir };
    default:
      return null;
  }
}
