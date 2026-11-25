import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSessionRoadmap, readWorktreeMarker, resolveGitDir, WorktreeRoadmapResolver } from './worktree';

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

describe('worktree roadmap resolver', () => {
  it('lê habblaud.json no gitdir do repo principal e de uma worktree vinculada', () => {
    const root = tempDir('hb-wt-');
    const repo = join(root, 'atlas');
    mkdirSync(repo);
    git(repo, 'init');
    git(repo, 'config', 'user.email', 't@example.com');
    git(repo, 'config', 'user.name', 'Teste');
    writeFileSync(join(repo, 'README.md'), 'ok\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-m', 'init');

    const wt = join(root, 'atlas-wt-e1');
    git(repo, 'worktree', 'add', '-b', 'feat/e1', wt);

    const wtGitDir = resolveGitDir(wt);
    expect(wtGitDir).toBeTruthy();
    expect(wtGitDir).not.toBe(join(repo, '.git'));
    writeFileSync(join(wtGitDir!, 'habblaud.json'), JSON.stringify({ roadmapId: 'atlas-ondas', roadmapTitle: 'Atlas Store — ondas' }));

    const nested = join(wt, 'src');
    mkdirSync(nested);
    expect(readWorktreeMarker(nested)).toEqual({
      roadmapId: 'atlas-ondas',
      roadmapTitle: 'Atlas Store — ondas',
      rootPath: wt,
    });
    expect(git(wt, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('usa .roadmap.yaml como fallback quando não há habblaud.json', () => {
    const root = tempDir('hb-yaml-');
    writeFileSync(join(root, '.roadmap.yaml'), 'roadmap: meu-roadmap\ngate: true\n');
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(readWorktreeMarker(sub)).toEqual({ roadmapId: 'meu-roadmap', rootPath: root });
  });

  it('resolve sessões por active-sessions.json e coordination/*.json; marcador da worktree vence a sessão', async () => {
    const root = tempDir('hb-sess-');
    const stateDir = join(root, 'state');
    mkdirSync(join(stateDir, 'coordination'), { recursive: true });
    writeFileSync(
      join(stateDir, 'active-sessions.json'),
      JSON.stringify({ sessions: { 's-worker': { roadmapId: 'atlas-ondas', roadmapTitle: 'Atlas Store — ondas', workdir: '/p/wt1' } } }),
    );
    writeFileSync(join(stateDir, 'coordination', 'coord.json'), JSON.stringify({ session_id: 's-coord', roadmap: 'atlas-ondas' }));

    expect(readSessionRoadmap('s-worker', stateDir)).toEqual({
      roadmapId: 'atlas-ondas',
      roadmapTitle: 'Atlas Store — ondas',
      workdir: '/p/wt1',
    });
    expect(readSessionRoadmap('s-coord', stateDir)).toEqual({ roadmapId: 'atlas-ondas' });

    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, '.git', 'habblaud.json'), JSON.stringify({ roadmapId: 'outro-rm', roadmapTitle: 'Outro RM' }));

    let notified = 0;
    const resolver = new WorktreeRoadmapResolver({
      stateDir,
      fetchRoadmaps: async () => [{ id: 'atlas-ondas', title: 'Atlas Store — ondas' }],
      onTitleChange: () => {
        notified += 1;
      },
    });
    // Coordenador sem marcador na pasta pega via coordination + busca título da API
    const coordRoom = resolver.resolve(join(root, 'sem-marcador'), 's-coord');
    expect(coordRoom).toMatchObject({ id: 'roadmap:atlas-ondas', name: 'atlas-ondas' });
    await new Promise((r) => setTimeout(r, 10));
    expect(notified).toBe(1);
    expect(resolver.resolve(join(root, 'sem-marcador'), 's-coord')).toMatchObject({
      id: 'roadmap:atlas-ondas',
      name: 'Atlas Store — ondas',
    });
    // Marcador na worktree vence sobre o mapa da sessão
    expect(resolver.resolve(repo, 's-coord')).toEqual({
      id: 'roadmap:outro-rm',
      name: 'Outro RM',
      path: repo,
    });
  });
});
