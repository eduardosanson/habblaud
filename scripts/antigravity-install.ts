// Instala (ou remove) o hook do Habblaud no Antigravity CLI (agy). Roda no host com tsx:
//
//   npm run antigravity:install
//   npm run antigravity:uninstall
//   npm run antigravity:status
//
// O hook fica em ~/.gemini/config/hooks.json como um grupo "habblaud", ao lado dos grupos de outras ferramentas
// (Orca, ai-memory...). Ele lê o contexto do hook no stdin e manda um evento para POST /api/antigravity/events;
// nunca bloqueia o agente. O uso do plano é lido pelo próprio `agy -p "/usage"` e não depende do hook.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK = join(ROOT, 'mod', 'habblaud-antigravity', 'hook.mjs');
export const GROUP = 'habblaud';

const USAGE = 'Uso: npm run antigravity:<install|uninstall|status> [-- --dry-run]';

export interface AntigravityInstallOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  dryRun?: boolean;
  out?: (line: string) => void;
}

export function hooksFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.GEMINI_HOME?.trim() || env.HABBLAUD_ANTIGRAVITY_HOME?.trim() || join(home, '.gemini');
  return join(resolve(base), 'config', 'hooks.json');
}

/** Comando do hook; o Node que roda o instalador é o mesmo que rodará o hook. */
export function hookCommand(node = process.execPath, hook = HOOK): string {
  return `${node} "${hook}"`;
}

function group(command: string): Record<string, unknown> {
  const direct = [{ type: 'command', command }];
  const matched = [{ matcher: '*', hooks: [{ type: 'command', command }] }];
  return {
    SessionStart: direct,
    UserPromptSubmit: direct,
    PreInvocation: direct,
    PostInvocation: direct,
    Stop: direct,
    SessionEnd: direct,
    PreToolUse: matched,
    PostToolUse: matched,
  };
}

function readHooks(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeHooks(file: string, hooks: Record<string, unknown>, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(file, `${file}.habblaud-backup-${stamp}`);
  }
  writeFileSync(file, `${JSON.stringify(hooks, null, 2)}\n`);
}

function install(opts: AntigravityInstallOptions, out: (line: string) => void): number {
  const file = hooksFile(opts.env, opts.home);
  const hooks = readHooks(file);
  hooks[GROUP] = group(hookCommand());
  if (opts.dryRun) {
    out(`Colocaria o grupo "${GROUP}" em ${file}:`);
    out(JSON.stringify(hooks[GROUP], null, 2));
    return 0;
  }
  writeHooks(file, hooks, false);
  out(`Hook do Antigravity instalado em ${file}.`);
  out('Abra uma sessão nova do Antigravity (ou reinicie a IDE/CLI) para carregar os hooks.');
  return 0;
}

function uninstall(opts: AntigravityInstallOptions, out: (line: string) => void): number {
  const file = hooksFile(opts.env, opts.home);
  const hooks = readHooks(file);
  if (!(GROUP in hooks)) {
    out(`Nada para remover: o grupo "${GROUP}" não está em ${file}.`);
    return 0;
  }
  delete hooks[GROUP];
  if (opts.dryRun) {
    out(`Removeria o grupo "${GROUP}" de ${file}.`);
    return 0;
  }
  writeHooks(file, hooks, false);
  out(`Grupo "${GROUP}" removido de ${file}.`);
  return 0;
}

function status(opts: AntigravityInstallOptions, out: (line: string) => void): number {
  const file = hooksFile(opts.env, opts.home);
  const hooks = readHooks(file);
  const current = hooks[GROUP];
  if (!current) {
    out(`Antigravity em ${file}: hook ${GROUP} — não instalado.`);
    return 0;
  }
  const text = JSON.stringify(current);
  out(`Antigravity em ${file}: hook ${GROUP} — ${text.includes(HOOK.replace(/\\/g, '\\\\')) ? 'ligado' : 'presente, mas aponta para outro caminho'}.`);
  out(`Hook esperado: ${hookCommand()}`);
  return 0;
}

export function parseArgs(argv: string[]): { action: 'install' | 'uninstall' | 'status'; dryRun: boolean } | undefined {
  if (argv.includes('-h') || argv.includes('--help')) return undefined;
  const action = argv[0];
  if (action !== 'install' && action !== 'uninstall' && action !== 'status') return undefined;
  return { action, dryRun: argv.includes('--dry-run') };
}

export async function main(argv = process.argv.slice(2), opts: Partial<AntigravityInstallOptions> = {}): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed) {
    console.log(USAGE);
    return 0;
  }
  const out = opts.out ?? ((line: string) => console.log(line));
  const full: AntigravityInstallOptions = {
    home: opts.home ?? homedir(),
    env: opts.env ?? process.env,
    dryRun: opts.dryRun ?? parsed.dryRun,
    out,
  };
  if (parsed.action === 'install') return install(full, out);
  if (parsed.action === 'uninstall') return uninstall(full, out);
  return status(full, out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`[antigravity] Erro inesperado: ${String(err)}`);
      process.exitCode = 1;
    },
  );
}
