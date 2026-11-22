import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDotEnv, mergeEnvWithDotEnv, parseDotEnv, readDotEnv } from './dotenv';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dotenv', () => {
  it('interpreta comentários, export, aspas simples/duplas e comentário inline', () => {
    const parsed = parseDotEnv(
      [
        '# comentário inicial',
        'HABBLAUD_ROADMAP=1 # liga o roadmap',
        'export HABBLAUD_ROADMAP_URL=https://sanson-server.com',
        'SINGLE=\'valor # literal\\n\' # comentário depois',
        'DOUBLE="linha1\\nlinha2\\t\\"ok\\"\\\\"',
        'EMPTY= # só comentário',
        'WITH_HASH=https://exemplo.com/#secao',
        'linha sem igual',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      HABBLAUD_ROADMAP: '1',
      HABBLAUD_ROADMAP_URL: 'https://sanson-server.com',
      SINGLE: 'valor # literal\\n',
      DOUBLE: 'linha1\nlinha2\t"ok"\\',
      EMPTY: '',
      WITH_HASH: 'https://exemplo.com/#secao',
    });
  });

  it('readDotEnv devolve vazio quando arquivo não existe', () => {
    expect(readDotEnv('/tmp/habblaud-dotenv-inexistente-999999/.env')).toEqual({});
  });

  it('mergeEnvWithDotEnv preserva ambiente não vazio e preenche chaves ausentes ou vazias', () => {
    const env: NodeJS.ProcessEnv = {
      HABBLAUD_ROADMAP_URL: 'https://override.example.com',
      HABBLAUD_ROADMAP_TOKEN: '   ',
    };
    const merged = mergeEnvWithDotEnv(env, {
      HABBLAUD_ROADMAP_URL: 'https://sanson-server.com',
      HABBLAUD_ROADMAP_TOKEN: 'token-do-dotenv',
      HABBLAUD_ROADMAP: '1',
    });
    expect(merged).toEqual({
      HABBLAUD_ROADMAP_URL: 'https://override.example.com',
      HABBLAUD_ROADMAP_TOKEN: 'token-do-dotenv',
      HABBLAUD_ROADMAP: '1',
    });
    expect(env.HABBLAUD_ROADMAP).toBeUndefined();
  });

  it('applyDotEnv carrega o arquivo e atualiza apenas chaves ausentes ou vazias no alvo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'habblaud-dotenv-'));
    temps.push(dir);
    const file = join(dir, '.env');
    writeFileSync(file, 'A=1\nB=2\nC=""\n', 'utf8');
    const target: NodeJS.ProcessEnv = { A: 'env-a', B: '' };
    const loaded = applyDotEnv(file, target);
    expect(loaded).toEqual({ A: '1', B: '2', C: '' });
    expect(target).toEqual({ A: 'env-a', B: '2', C: '' });
  });
});
