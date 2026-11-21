import { describe, expect, it } from 'vitest';
import { DEFAULT_ROADMAP_URL, parseRoadmapConfig } from './config';

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
});
