// Instala (ou remove) o plugin do Habblaud no Hermes. Roda no HOST com tsx:
//
//   npm run hermes:install     # cria ~/.hermes/plugins/habblaud e habilita no perfil padrão e nos perfis
//   npm run hermes:uninstall   # desabilita e remove o symlink
//   npm run hermes:status      # mostra o que está instalado, sem alterar nada
//   (opções: --dry-run, --no-enable, --force)
//
// O plugin (mod/habblaud-hermes) observa os hooks do Hermes e manda eventos para POST /api/hermes/events.
// A instalação é um symlink em ~/.hermes/plugins/habblaud (como o pixel-office) + `hermes plugins enable habblaud`
// no perfil padrão e em cada ~/.hermes/profiles/*. O Hermes carrega o plugin nas sessões abertas depois disso.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_NAME = 'habblaud';
export const PLUGIN_DIR = join(ROOT, 'mod', 'habblaud-hermes');

const USAGE = 'Uso: npm run hermes:<install|uninstall|status> [-- --dry-run] [--no-enable] [--force]';

export interface HermesInstallOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  dryRun?: boolean;
  noEnable?: boolean;
  force?: boolean;
  out?: (line: string) => void;
  run?: (command: string, args: string[]) => { ok: boolean; missing?: boolean };
}

/** Pasta BASE do Hermes (a que contém plugins/ e profiles/): HABBLAUD_HERMES_HOME ou ~/.hermes. */
export function hermesHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const raw = env.HABBLAUD_HERMES_HOME?.trim();
  return resolve(raw || join(home, '.hermes'));
}

/** Nomes dos perfis (pastas em ~/.hermes/profiles); o padrão não entra. */
export function hermesProfiles(home: string): string[] {
  try {
    return readdirSync(join(home, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Comandos de habilitação/desabilitação por perfil (o primeiro é o padrão). */
export function hermesPluginCommands(home: string, action: 'enable' | 'disable'): string[][] {
  return [[`plugins`, action, PLUGIN_NAME], ...hermesProfiles(home).map((p) => ['-p', p, 'plugins', action, PLUGIN_NAME])];
}

/** Configuração que o plugin precisa: mensagens (inject_message) e aprovações pelo escritório. */
export function hermesConfigCommands(home: string, action: 'set' | 'unset'): string[][] {
  const values: Record<string, string> = {
    'plugins.entries.habblaud.allow_gateway_injection': 'true',
    'security.approval.transport': PLUGIN_NAME,
    'security.approval.transport_fallback': 'builtin',
  };
  const out: string[][] = [];
  for (const profile of [undefined, ...hermesProfiles(home)]) {
    for (const [key, value] of Object.entries(values)) {
      out.push([...(profile ? ['-p', profile] : []), 'config', action, key, ...(action === 'set' ? [value] : [])]);
    }
  }
  return out;
}

export function pluginLink(home: string): string {
  return join(home, 'plugins', PLUGIN_NAME);
}

/** Symlink do plugin em cada perfil: o Hermes carrega plugins da pasta do perfil, não só da base. */
export function profilePluginLink(home: string, profile: string): string {
  return join(home, 'profiles', profile, 'plugins', PLUGIN_NAME);
}

/** Todos os lugares do plugin: a pasta base e cada perfil. */
export function pluginLinks(home: string): string[] {
  return [pluginLink(home), ...hermesProfiles(home).map((profile) => profilePluginLink(home, profile))];
}

/** O que existe no caminho do symlink: ausente, nosso, link para outro lugar ou pasta de verdade. */
export function linkState(link: string, pluginDir = PLUGIN_DIR): 'missing' | 'ours' | 'other-link' | 'directory' | 'file' {
  if (!existsSync(link) && !isSymlink(link)) return 'missing';
  try {
    if (isSymlink(link)) {
      const target = realpathSync(link);
      return target === realpathSync(pluginDir) ? 'ours' : 'other-link';
    }
    return lstatSync(link).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'missing';
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[]): { ok: boolean; missing?: boolean } {
  const r = spawnSync(command, args, { stdio: 'inherit' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, missing: true };
  return { ok: r.status === 0 };
}

function install(opts: HermesInstallOptions, out: (line: string) => void): number {
  const links = pluginLinks(opts.home);
  // Confere tudo antes de mexer em qualquer link: uma pasta de verdade no lugar do plugin não pode ser sobrescrita.
  for (const link of links) {
    const state = linkState(link);
    if (state === 'directory' || state === 'file') {
      out(`Já existe ${link} e ele não é um symlink; não vou sobrescrever. Remova na mão se for um plugin antigo.`);
      return 1;
    }
    if (state === 'other-link' && !opts.force) {
      out(`O symlink ${link} aponta para outro lugar; use --force para trocar.`);
      return 1;
    }
  }
  if (opts.dryRun) {
    for (const link of links) out(`Criaria o symlink ${link} -> ${PLUGIN_DIR}.`);
  } else {
    for (const link of links) {
      mkdirSync(dirname(link), { recursive: true });
      if (isSymlink(link)) rmSync(link);
      symlinkSync(PLUGIN_DIR, link, 'dir');
    }
    out(`Plugin ligado em ${pluginLink(opts.home)} e nos perfis (${links.length - 1}).`);
  }

  if (opts.noEnable) {
    out(`Para habilitar: hermes plugins enable ${PLUGIN_NAME} (repita com -p <perfil> para cada perfil).`);
    return 0;
  }
  const run = opts.run ?? runCommand;
  let failed = false;
  for (const args of hermesPluginCommands(opts.home, 'enable')) {
    const shown = ['hermes', ...args].join(' ');
    if (opts.dryRun) {
      out(`  ${shown}`);
      continue;
    }
    const r = run('hermes', args);
    if (r.missing) {
      out(`\`hermes\` não está no PATH. Rode na mão: ${shown}`);
      failed = true;
      break;
    }
    if (!r.ok) {
      out(`O comando falhou: ${shown}`);
      failed = true;
    }
  }
  if (!failed) {
    for (const args of hermesConfigCommands(opts.home, 'set')) {
      const shown = ['hermes', ...args].join(' ');
      if (opts.dryRun) {
        out(`  ${shown}`);
        continue;
      }
      const r = run('hermes', args);
      if (r.missing || !r.ok) {
        out(`Não consegui configurar: ${shown}`);
        failed = true;
      }
    }
  }
  out('Reinicie as sessões do Hermes para carregar o plugin.');
  return failed ? 1 : 0;
}

function uninstall(opts: HermesInstallOptions, out: (line: string) => void): number {
  const run = opts.run ?? runCommand;
  for (const args of hermesPluginCommands(opts.home, 'disable')) {
    const shown = ['hermes', ...args].join(' ');
    if (opts.dryRun) out(`  ${shown}`);
    else {
      const r = run('hermes', args);
      if (r.missing || !r.ok) out(`Não consegui rodar: ${shown}`);
    }
  }
  for (const args of hermesConfigCommands(opts.home, 'unset')) {
    const shown = ['hermes', ...args].join(' ');
    if (opts.dryRun) out(`  ${shown}`);
    else {
      const r = run('hermes', args);
      if (r.missing || !r.ok) out(`Não consegui limpar: ${shown}`);
    }
  }
  for (const link of pluginLinks(opts.home)) {
    if (linkState(link) === 'ours') {
      if (opts.dryRun) out(`Removeria o symlink ${link}.`);
      else {
        rmSync(link);
        out(`Symlink removido: ${link}.`);
      }
    } else {
      out(`Nada para remover em ${link} (ele não é um symlink do Habblaud).`);
    }
  }
  return 0;
}

function status(opts: HermesInstallOptions, out: (line: string) => void): number {
  const link = pluginLink(opts.home);
  const state = linkState(link);
  const label =
    state === 'ours'
      ? `ligado (symlink para ${PLUGIN_DIR})`
      : state === 'other-link'
        ? 'symlink aponta para outro lugar'
        : state === 'directory'
          ? 'existe uma pasta no lugar do symlink'
          : state === 'file'
            ? 'existe um arquivo no lugar do symlink'
            : 'não instalado';
  out(`Hermes em ${opts.home}: plugin ${PLUGIN_NAME} — ${label}.`);
  const profiles = hermesProfiles(opts.home);
  out(`Perfis: ${profiles.length ? profiles.join(', ') : 'nenhum (só o padrão)'}`);
  const missing = profiles.filter((profile) => linkState(profilePluginLink(opts.home, profile)) !== 'ours');
  out(
    missing.length
      ? `Sem o plugin nos perfis: ${missing.join(', ')} (rode npm run hermes:install).`
      : 'Plugin ligado em todos os perfis.',
  );
  out('Confira a habilitação com: hermes plugins list (e hermes -p <perfil> plugins list).');
  return 0;
}

interface Args {
  action: 'install' | 'uninstall' | 'status';
  dryRun: boolean;
  noEnable: boolean;
  force: boolean;
}

export function parseArgs(argv: string[]): Args | undefined {
  if (argv.includes('-h') || argv.includes('--help')) return undefined;
  const action = argv[0];
  if (action !== 'install' && action !== 'uninstall' && action !== 'status') return undefined;
  return { action, dryRun: argv.includes('--dry-run'), noEnable: argv.includes('--no-enable'), force: argv.includes('--force') };
}

export async function main(argv = process.argv.slice(2), opts: Partial<HermesInstallOptions> = {}): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed) {
    console.log(USAGE);
    return 0;
  }
  const out = opts.out ?? ((line: string) => console.log(line));
  const full: HermesInstallOptions = {
    home: opts.home ?? hermesHome(opts.env ?? process.env),
    env: opts.env ?? process.env,
    dryRun: opts.dryRun ?? parsed.dryRun,
    noEnable: opts.noEnable ?? parsed.noEnable,
    force: opts.force ?? parsed.force,
    out,
    ...(opts.run ? { run: opts.run } : {}),
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
      console.error(`[hermes] Erro inesperado: ${String(err)}`);
      process.exitCode = 1;
    },
  );
}
