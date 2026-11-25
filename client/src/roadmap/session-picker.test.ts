import { describe, expect, it } from 'vitest';
import { providerLabel } from './bridge';
import type { ApiSessionOption, ApiSessionOptions } from './pipeline';
import { canSend, describeOption, initialChoice, reopenTarget, sameSession } from './session-picker';

function option(over: Partial<ApiSessionOption> = {}): ApiSessionOption {
  return { provider: 'claude', sessionId: 's-1', live: true, resumable: false, lastAt: '2026-11-24T10:00:00Z', scope: 'item', ...over };
}

function options(list: ApiSessionOption[], suggested: ApiSessionOptions['suggested'] = null): ApiSessionOptions {
  return { options: list, suggested };
}

describe('initialChoice', () => {
  it('começa pela sessão que o servidor sugeriu', () => {
    const list = [option({ sessionId: 's-1' }), option({ provider: 'codex', sessionId: 's-2' })];
    expect(initialChoice(options(list, { provider: 'codex', sessionId: 's-2' }))).toEqual({ provider: 'codex', sessionId: 's-2' });
  });

  it('sem sugerida, pega a primeira viva', () => {
    const list = [option({ sessionId: 's-1', live: false }), option({ sessionId: 's-2', live: true })];
    expect(initialChoice(options(list))).toEqual({ provider: 'claude', sessionId: 's-2' });
  });

  it('sem sugerida e sem nenhuma viva, não escolhe nada', () => {
    expect(initialChoice(options([option({ live: false })]))).toBeNull();
    expect(initialChoice(options([]))).toBeNull();
  });
});

describe('canSend', () => {
  const live = option({ sessionId: 's-1', live: true });
  const closed = option({ provider: 'codex', sessionId: 's-2', live: false });

  it('libera o envio para uma sessão viva da lista', () => {
    expect(canSend(options([live, closed]), { provider: 'claude', sessionId: 's-1' })).toEqual({ ok: true });
  });

  it('item sem nenhuma sessão registrada: explica e não deixa enviar (CA07)', () => {
    const verdict = canSend(options([]), null);
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.ok === false && verdict.reason).toContain('Ninguém registrou');
  });

  it('sessão fechada aparece na lista, mas não recebe: manda abri-la', () => {
    const verdict = canSend(options([live, closed]), { provider: 'codex', sessionId: 's-2' });
    expect(verdict.ok === false && verdict.reason).toContain('fechada');
  });

  it('sem escolha, ou com uma escolha que não está na lista, pede para escolher', () => {
    expect(canSend(options([live]), null)).toMatchObject({ ok: false });
    expect(canSend(options([live]), { provider: 'claude', sessionId: 'forjada' })).toMatchObject({ ok: false });
  });
});

describe('describeOption e sameSession', () => {
  it('o texto traz o provider, o perfil e se está viva ou fechada', () => {
    const text = describeOption(option({ profile: 'reviewer', live: true }));
    expect(text).toContain(providerLabel('claude'));
    expect(text).toContain('reviewer');
    expect(text).toContain('viva');
    expect(describeOption(option({ live: false }))).toContain('fechada');
  });

  it('sessão que só trabalhou em outro item do roadmap é marcada como do roadmap', () => {
    expect(describeOption(option({ profile: 'impl', scope: 'roadmap' }))).toContain('do roadmap');
    expect(describeOption(option({ profile: 'impl', scope: 'item' }))).not.toContain('do roadmap');
  });

  it('sem perfil, o texto ainda se sustenta', () => {
    expect(describeOption(option({ live: true }))).toContain(providerLabel('claude'));
  });

  it('duas escolhas são a mesma sessão só com provider e id iguais', () => {
    expect(sameSession({ provider: 'claude', sessionId: 'a' }, { provider: 'claude', sessionId: 'a' })).toBe(true);
    expect(sameSession({ provider: 'claude', sessionId: 'a' }, { provider: 'codex', sessionId: 'a' })).toBe(false);
    expect(sameSession({ provider: 'claude', sessionId: 'a' }, { provider: 'claude', sessionId: 'b' })).toBe(false);
  });
});

describe('reopenTarget', () => {
  const closed = option({ sessionId: 's-1', live: false });

  it('oferece reabrir a sessão fechada do Claude Code escolhida', () => {
    expect(reopenTarget(options([closed]), { provider: 'claude', sessionId: 's-1' })).toEqual({ provider: 'claude', sessionId: 's-1' });
  });

  it('não oferece para sessão viva, de outro harness, fora da lista ou sem escolha', () => {
    const live = option({ sessionId: 's-2' });
    const codex = option({ provider: 'codex', sessionId: 's-3', live: false });
    const list = options([closed, live, codex]);
    expect(reopenTarget(list, { provider: 'claude', sessionId: 's-2' })).toBeNull();
    expect(reopenTarget(list, { provider: 'codex', sessionId: 's-3' })).toBeNull();
    expect(reopenTarget(list, { provider: 'claude', sessionId: 'x' })).toBeNull();
    expect(reopenTarget(list, null)).toBeNull();
  });
});
