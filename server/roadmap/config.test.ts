import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROADMAP_URL,
  parseRoadmapConfig,
  roadmapEnvConflictWarning,
  syncRoadmapConfigFile,
} from './config';

const temps: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-roadmap-cfg-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseRoadmapConfig', () => {
  it('desliga com HABBLAUD_ROADMAP=0', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP: '0', HABBLAUD_ROADMAP_TOKEN: 't' })).toEqual({ enabled: false });
  });

  it('sem token fica desligado e explica o motivo', () => {
    const config = parseRoadmapConfig({ HABBLAUD_DATA_DIR: '/tmp/habblaud-roadmap-test-nao-existe' });
    expect(config.enabled).toBe(false);
    expect(config.warning).toMatch(/HABBLAUD_ROADMAP_TOKEN/);
    expect(config.url).toBe(DEFAULT_ROADMAP_URL);
  });

  it('liga com o token e o endereço padrão', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 'segredo' })).toEqual({
      enabled: true,
      url: DEFAULT_ROADMAP_URL,
      token: 'segredo',
    });
  });

  it('aceita PIPELINE_HABBLAUD_TOKEN como conveniência', () => {
    expect(parseRoadmapConfig({ PIPELINE_HABBLAUD_TOKEN: 'pipeline' })).toMatchObject({ enabled: true, token: 'pipeline' });
  });

  it('recusa endereço inválido, com caminho ou http para outra máquina', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'não é url' }).warning).toMatch(/endereço válido/);
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'http://127.0.0.1:49500/api' }).warning).toMatch(/sem caminho/);
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'http://10.0.0.5:49500' }).warning).toMatch(/próprio computador/);
  });

  it('aceita https em qualquer host e http no host.docker.internal', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'https://roadmap.example.com' })).toMatchObject({
      enabled: true,
      url: 'https://roadmap.example.com',
    });
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'http://host.docker.internal:49500' })).toMatchObject({
      enabled: true,
      url: 'http://host.docker.internal:49500',
    });
  });

  it('HABBLAUD_ROADMAP_IDS restringe a lista sem duplicatas', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_IDS: ' atlas-ondas, praca, atlas-ondas ' }).ids).toEqual([
      'atlas-ondas',
      'praca',
    ]);
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't' }).ids).toBeUndefined();
  });

  it('normaliza a barra final e preserva a porta', () => {
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'http://127.0.0.1:49500/' }).url).toBe(
      'http://127.0.0.1:49500',
    );
    expect(parseRoadmapConfig({ HABBLAUD_ROADMAP_TOKEN: 't', HABBLAUD_ROADMAP_URL: 'http://localhost:5000' }).url).toBe('http://localhost:5000');
  });

  it('persiste url, ids e token em disco e relê sem variáveis de ambiente', () => {
    const dir = makeTempDir();
    syncRoadmapConfigFile(
      {
        HABBLAUD_DATA_DIR: dir,
        HABBLAUD_ROADMAP_URL: 'https://sanson-server.com/',
        HABBLAUD_ROADMAP_TOKEN: 'tok-remoto',
        HABBLAUD_ROADMAP_IDS: 'atlas-ondas, praca',
      },
    );
    expect(JSON.parse(readFileSync(join(dir, 'roadmap.json'), 'utf8'))).toEqual({
      url: 'https://sanson-server.com',
      ids: ['atlas-ondas', 'praca'],
    });
    expect(readFileSync(join(dir, 'roadmap-token'), 'utf8').trim()).toBe('tok-remoto');
    expect(parseRoadmapConfig({ HABBLAUD_DATA_DIR: dir })).toEqual({
      enabled: true,
      url: 'https://sanson-server.com',
      token: 'tok-remoto',
      ids: ['atlas-ondas', 'praca'],
    });
  });

  it('não sobrescreve url remota persistida quando só o token é informado depois', () => {
    const dir = makeTempDir();
    syncRoadmapConfigFile({
      HABBLAUD_DATA_DIR: dir,
      HABBLAUD_ROADMAP_URL: 'https://sanson-server.com',
      HABBLAUD_ROADMAP_TOKEN: 'tok-1',
    });
    syncRoadmapConfigFile({
      HABBLAUD_DATA_DIR: dir,
      HABBLAUD_ROADMAP_TOKEN: 'tok-2',
    });
    expect(parseRoadmapConfig({ HABBLAUD_DATA_DIR: dir })).toEqual({
      enabled: true,
      url: 'https://sanson-server.com',
      token: 'tok-2',
    });
  });

  it('override explícito de HABBLAUD_ROADMAP_URL vence o disco e não herda ids de outro servidor', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'roadmap.json'), JSON.stringify({ url: 'https://server-a.com', ids: ['atlas-ondas'] }));
    writeFileSync(join(dir, 'roadmap-token'), 'tok-a\n');
    expect(
      parseRoadmapConfig({
        HABBLAUD_DATA_DIR: dir,
        HABBLAUD_ROADMAP_URL: 'https://server-b.com',
      }),
    ).toEqual({
      enabled: true,
      url: 'https://server-b.com',
      token: 'tok-a',
    });
  });

  it('HABBLAUD_ROADMAP=0 continua desligando mesmo com roadmap.json e roadmap-token no disco', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'roadmap.json'), JSON.stringify({ url: 'https://sanson-server.com' }));
    writeFileSync(join(dir, 'roadmap-token'), 'tok\n');
    expect(parseRoadmapConfig({ HABBLAUD_DATA_DIR: dir, HABBLAUD_ROADMAP: '0' })).toEqual({ enabled: false });
  });

  it('avisa apenas quando token antigo do shell difere do .env sem URL no ambiente', () => {
    const dotEnv = {
      HABBLAUD_ROADMAP_URL: 'https://sanson-server.com',
      HABBLAUD_ROADMAP_TOKEN: 'tok-novo',
    };
    expect(roadmapEnvConflictWarning({ HABBLAUD_ROADMAP_TOKEN: 'tok-antigo' }, dotEnv)).toMatch(/difere do \.env/);
    expect(roadmapEnvConflictWarning({ HABBLAUD_ROADMAP_TOKEN: 'tok-novo' }, dotEnv)).toBeUndefined();
    expect(
      roadmapEnvConflictWarning(
        { HABBLAUD_ROADMAP_URL: 'https://outro.com', HABBLAUD_ROADMAP_TOKEN: 'tok-outro' },
        dotEnv,
      ),
    ).toBeUndefined();
  });
});
