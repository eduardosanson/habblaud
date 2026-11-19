// Instalador do plugin do Hermes: pasta base, perfis, symlink e plano de habilitação. Sem tocar em ~/.hermes de verdade:
// os testes usam uma pasta temporária e um runner falso.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hermesHome, hermesPluginCommands, hermesProfiles, linkState, main, parseArgs, pluginLink, PLUGIN_DIR } from '../../scripts/hermes-install';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'habblaud-hermes-'));
}

describe('instalador do Hermes: peças puras', () => {
  it('pasta base: HABBLAUD_HERMES_HOME ou ~/.hermes (não o HERMES_HOME do perfil ativo)', () => {
    expect(hermesHome({ HABBLAUD_HERMES_HOME: '/x/hermes', HERMES_HOME: '/x/perfil' }, '/home/u')).toBe('/x/hermes');
    expect(hermesHome({ HERMES_HOME: '/x/perfil' }, '/home/u')).toBe('/home/u/.hermes');
  });

  it('perfis são as pastas de profiles/, em ordem; o padrão fica de fora', () => {
    const home = dir();
    mkdirSync(join(home, 'profiles', 'tester'), { recursive: true });
    mkdirSync(join(home, 'profiles', 'developer'), { recursive: true });
    mkdirSync(join(home, 'profiles', '.deleted'), { recursive: true });
    writeFileSync(join(home, 'profiles', 'arquivo'), 'x');
    expect(hermesProfiles(home)).toEqual(['developer', 'tester']);
    expect(hermesPluginCommands(home, 'enable')).toEqual([
      ['plugins', 'enable', 'habblaud'],
      ['-p', 'developer', 'plugins', 'enable', 'habblaud'],
      ['-p', 'tester', 'plugins', 'enable', 'habblaud'],
    ]);
  });

  it('linkState: ausente, nosso, de outro, pasta e arquivo', () => {
    const home = dir();
    const link = pluginLink(home);
    mkdirSync(join(home, 'plugins'), { recursive: true });
    expect(linkState(link)).toBe('missing');
    symlinkSync(PLUGIN_DIR, link);
    expect(linkState(link)).toBe('ours');
    const other = join(home, 'outro');
    mkdirSync(other);
    const link2 = join(home, 'plugins', 'outro-link');
    symlinkSync(other, link2);
    expect(linkState(link2)).toBe('other-link');
    const folder = join(home, 'plugins', 'pasta');
    mkdirSync(folder);
    expect(linkState(folder)).toBe('directory');
    const file = join(home, 'plugins', 'arquivo');
    writeFileSync(file, 'x');
    expect(linkState(file)).toBe('file');
  });

  it('parseArgs entende install/uninstall/status e opções; help = undefined', () => {
    expect(parseArgs(['install', '--dry-run'])).toEqual({ action: 'install', dryRun: true, noEnable: false, force: false });
    expect(parseArgs(['status'])).toMatchObject({ action: 'status' });
    expect(parseArgs(['--help'])).toBeUndefined();
    expect(parseArgs(['outro'])).toBeUndefined();
  });
});

describe('instalador do Hermes: fluxo com runner falso', () => {
  it('install cria o symlink e habilita nos perfis; uninstall desabilita e remove', async () => {
    const home = dir();
    mkdirSync(join(home, 'profiles', 'dev'), { recursive: true });
    const calls: string[][] = [];
    const out: string[] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return { ok: true };
    };
    expect(await main(['install'], { home, run, out: (l) => out.push(l) })).toBe(0);
    expect(linkState(pluginLink(home))).toBe('ours');
    expect(calls).toEqual([
      ['hermes', 'plugins', 'enable', 'habblaud'],
      ['hermes', '-p', 'dev', 'plugins', 'enable', 'habblaud'],
    ]);
    expect(out.join('\n')).toContain('Reinicie as sessões');

    calls.length = 0;
    expect(await main(['uninstall'], { home, run, out: (l) => out.push(l) })).toBe(0);
    expect(linkState(pluginLink(home))).toBe('missing');
    expect(calls).toEqual([
      ['hermes', 'plugins', 'disable', 'habblaud'],
      ['hermes', '-p', 'dev', 'plugins', 'disable', 'habblaud'],
    ]);
  });

  it('--dry-run não grava; --no-enable só liga o symlink; pasta de verdade não é sobrescrita', async () => {
    const home = dir();
    const out: string[] = [];
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => (calls.push([command, ...args]), { ok: true });
    expect(await main(['install', '--dry-run'], { home, run, out: (l) => out.push(l) })).toBe(0);
    expect(linkState(pluginLink(home))).toBe('missing');
    expect(calls).toEqual([]);

    expect(await main(['install', '--no-enable'], { home, run, out: (l) => out.push(l) })).toBe(0);
    expect(linkState(pluginLink(home))).toBe('ours');
    expect(calls).toEqual([]);

    const home2 = dir();
    mkdirSync(pluginLink(home2), { recursive: true });
    expect(await main(['install'], { home: home2, run, out: (l) => out.push(l) })).toBe(1);
  });

  it('sem o hermes no PATH: avisa e devolve 1, mas o symlink fica', async () => {
    const home = dir();
    const out: string[] = [];
    const code = await main(['install'], { home, run: () => ({ ok: false, missing: true }), out: (l) => out.push(l) });
    expect(code).toBe(1);
    expect(linkState(pluginLink(home))).toBe('ours');
    expect(out.join('\n')).toContain('hermes plugins enable habblaud');
  });
});
