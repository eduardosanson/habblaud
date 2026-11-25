import { describe, expect, it } from 'vitest';
import { providerOfHarness, providerOfPipeline, resumeCommand, validateResume } from './harness';

describe('providerOfHarness', () => {
  it('mapeia os harness do pipeline para o Provider do Habblaud (CA01)', () => {
    expect(providerOfHarness('agy')).toBe('antigravity');
    expect(providerOfHarness('claude-code')).toBe('claude');
    expect(providerOfHarness('codex')).toBe('codex');
    expect(providerOfHarness('opencode')).toBe('opencode');
    expect(providerOfHarness('hermes')).toBe('hermes');
  });

  it('ignora harness desconhecido ou vazio', () => {
    expect(providerOfHarness('claude-subscription-directsdk-experimental')).toBeNull();
    expect(providerOfHarness('')).toBeNull();
    expect(providerOfHarness(undefined)).toBeNull();
  });
});

describe('validateResume', () => {
  const ok = { harness: 'codex', sessionId: '0198a1b2-c3d4-4e5f-8a9b-0123456789ab', workdir: '/home/u/proj', argv: ['codex', 'resume'] };

  it('aceita um descritor bem formado e devolve o provider', () => {
    expect(validateResume(ok)).toEqual({
      provider: 'codex',
      sessionId: ok.sessionId,
      workdir: '/home/u/proj',
    });
  });

  it('nunca repassa o argv do pipeline (RNF01)', () => {
    expect(validateResume(ok)).not.toHaveProperty('argv');
  });

  it('recusa sessionId com metacaracteres, vazio ou comprido demais (CA02)', () => {
    for (const sessionId of ['', 'a;rm -rf /', '../etc/passwd', 'a b', '$(id)', 'x'.repeat(200), '-rf']) {
      expect(validateResume({ ...ok, sessionId })).toBeNull();
    }
  });

  it('recusa workdir relativo, com .. ou NUL', () => {
    for (const workdir of ['', 'proj', './proj', '/a/../b', '/a\0b']) {
      expect(validateResume({ ...ok, workdir })).toBeNull();
    }
  });

  it('recusa harness desconhecido e descritor nulo', () => {
    expect(validateResume({ ...ok, harness: 'bash' })).toBeNull();
    expect(validateResume(null)).toBeNull();
    expect(validateResume(undefined)).toBeNull();
  });

  it('trata sessionId de run do pipeline como inválido (CA05)', () => {
    expect(validateResume({ ...ok, sessionId: 'run:feat-demo-visibilidade:demo-visibilidade:D1:2' })).toBeNull();
  });
});

describe('resumeCommand', () => {
  const base = { sessionId: '0198a1b2-c3d4-4e5f-8a9b-0123456789ab', workdir: '/home/u/proj' };

  it('monta o comando por lista fixa, sem shell, com o id depois dos subcomandos', () => {
    expect(resumeCommand({ provider: 'claude', ...base })).toEqual({
      file: 'claude',
      args: ['--resume', base.sessionId],
      cwd: '/home/u/proj',
    });
    expect(resumeCommand({ provider: 'codex', ...base })).toEqual({
      file: 'codex',
      args: ['resume', base.sessionId],
      cwd: '/home/u/proj',
    });
  });

  it('devolve null onde a reabertura ainda não foi verificada (RF06)', () => {
    expect(resumeCommand({ provider: 'antigravity', ...base })).toBeNull();
    expect(resumeCommand({ provider: 'hermes', ...base })).toBeNull();
    expect(resumeCommand({ provider: 'opencode', ...base })).toBeNull();
  });
});

describe('providerOfPipeline', () => {
  it('entende o enum de provider que o pipeline grava nas execuções', () => {
    expect(providerOfPipeline('claude-code')).toBe('claude');
    expect(providerOfPipeline('codex')).toBe('codex');
    expect(providerOfPipeline('opencode')).toBe('opencode');
    expect(providerOfPipeline('antigravity')).toBe('antigravity');
    expect(providerOfPipeline('hermes')).toBe('hermes');
  });

  it('ignora provider fora do enum, vazio ou ausente', () => {
    expect(providerOfPipeline('claude-subscription-directsdk-experimental')).toBeNull();
    expect(providerOfPipeline('')).toBeNull();
    expect(providerOfPipeline(undefined)).toBeNull();
  });
});
