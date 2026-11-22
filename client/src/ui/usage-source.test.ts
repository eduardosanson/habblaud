import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import { HERMES_GROUP } from './account-filter';
import { FIVE_HOURS_MS, MONTH_MS, WEEK_MS } from './format';
import { antigravityUsageNote, cardState, codexUsageNote, detailMeterMeta, hermesUsageNote, openCodeUsageNote, showsUsageAge, sourceLabel, usageMessage, usageSubtitle } from './usage';

const MIN = 60_000;
type Acc = Pick<AccountInfo, 'usage' | 'usageStatus' | 'provider' | 'email' | 'plan' | 'configDir'>;
const codex = (over: Partial<Acc> = {}): Acc => ({ provider: 'codex', usageStatus: 'ok', configDir: '~/.codex', plan: 'Team', ...over });
const win = { utilization: 42, resetsAt: 10 * 60 * MIN };

describe('sourceLabel', () => {
  it('diz quem gravou o uso ao vivo', () => {
    expect(sourceLabel({ source: 'statusline', via: 'mod', fetchedAt: 0 })).toBe('ao vivo (mod do Habblaud)');
    expect(sourceLabel({ source: 'statusline', via: 'tap', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'statusline', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'cache', fetchedAt: 0 })).toBe('cache do /usage do Claude Code');
    expect(sourceLabel({ source: 'codex', fetchedAt: 0 })).toBe('arquivos do Codex');
    expect(sourceLabel({ source: 'codex', via: 'app-server', fetchedAt: 0 })).toBe('ao vivo (app-server do Codex)');
    expect(sourceLabel({ source: 'opencode', fetchedAt: 0 })).toBe('limites do OpenCode');
    expect(sourceLabel({ source: 'antigravity', fetchedAt: 0 })).toBe('limites do Antigravity');
  });
});

describe('cartão de uso de uma conta do Codex', () => {
  it('"sem cota" é um estado próprio (nunca 0% nem "sem dados")', () => {
    const noQuota = codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } });
    expect(cardState(noQuota)).toBe('noquota');
    expect(usageMessage(noQuota)).toEqual(['sem cota', 'sem cota']);
    expect(codexUsageNote(noQuota, 3 * MIN)).toMatch(/^Na última leitura \(há 3 min\), a conta estava sem cota nem créditos .*Não é 0%/);
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 }, usageStatus: 'stale' }))).toBe('stale');
    expect(cardState(codex())).toBe('empty');
  });

  it('a idade fica sempre à mostra no Codex (só se renova com sessão rodando); no Claude Code, só quando é antiga', () => {
    const fresh = { source: 'codex' as const, fiveHour: win, fetchedAt: 0 };
    expect(showsUsageAge(codex({ usage: fresh }))).toBe(true);
    expect(showsUsageAge(codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } }))).toBe(true);
    expect(showsUsageAge(codex())).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'statusline' }, usageStatus: 'ok' })).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'cache' }, usageStatus: 'stale' })).toBe(true);
    expect(codexUsageNote(codex({ usage: fresh }), 12 * MIN)).toBe('O Codex só grava o uso enquanto alguma sessão roda: estes números são da última leitura (há 12 min).');
    expect(codexUsageNote(codex({ usage: { ...fresh, via: 'app-server' } }), 12 * MIN)).toBe(
      'Limites lidos ao vivo pelo app-server local do Codex (última leitura: há 12 min).',
    );
  });

  it('sem números: não há o que instalar; embaixo do nome, o plano (sem e-mail)', () => {
    expect(usageMessage(codex())).toEqual(['sem dados ainda', 'sem dados']);
    expect(codexUsageNote(codex(), 0)).toBe('Não precisa instalar nada: os números chegam com a próxima sessão do Codex.');
    expect(usageSubtitle(codex())).toBe('plano Team');
    expect(usageSubtitle(codex({ plan: undefined }))).toBe('Codex');
    // Claude Code: como antes.
    expect(usageMessage({ usageStatus: 'disabled' })).toEqual(['sem dados de uso', 'sem dados']);
    expect(usageSubtitle({ email: 'a@b.c', configDir: '~/.claude' })).toBe('a@b.c');
    expect(usageSubtitle({ configDir: '~/.claude' })).toBe('~/.claude');
    expect(codexUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });
});

describe('cartão de uso de uma conta do OpenCode', () => {
  const opencode = (over: Partial<Acc> = {}): Acc => ({ provider: 'opencode', usageStatus: 'ok', configDir: '~/.local/state/opencode', ...over });

  it('sem números, não há o que instalar; a idade fica à mostra', () => {
    expect(usageMessage(opencode())).toEqual(['sem dados ainda', 'sem dados']);
    expect(showsUsageAge(opencode())).toBe(false);
    expect(showsUsageAge(opencode({ usage: { source: 'opencode', fiveHour: win, fetchedAt: 0 } }))).toBe(true);
    expect(openCodeUsageNote(opencode(), 0)).toBe('Não há o que instalar: o OpenCode informa os limites do plano no próprio serviço local.');
    expect(usageSubtitle(opencode())).toBe('OpenCode');
    expect(usageSubtitle(opencode({ plan: 'Go' }))).toBe('plano Go');
    expect(openCodeUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });

  it('a origem e a explicação citam o OpenCode', () => {
    const usage = { source: 'opencode' as const, fiveHour: win, fetchedAt: 0 };
    expect(openCodeUsageNote(opencode({ usage }), 12 * MIN)).toBe(
      'O OpenCode informa os limites do plano aberto (5 h, semana e mês): estes números são da última leitura (há 12 min).',
    );
    expect(cardState(opencode({ usage: { source: 'opencode', monthly: win, fetchedAt: 0 } }))).toBe('ok');
  });
});

describe('cartão de uso de uma conta do Antigravity', () => {
  const antigravity = (over: Partial<Acc> = {}): Acc => ({
    provider: 'antigravity',
    usageStatus: 'ok',
    configDir: '~/.gemini/antigravity-cli',
    plan: 'Antigravity',
    ...over,
  });

  it('sem números, não há o que instalar; com números, cita os modelos do Google', () => {
    expect(usageMessage(antigravity())).toEqual(['sem dados ainda', 'sem dados']);
    expect(usageSubtitle(antigravity())).toBe('Google');
    expect(usageSubtitle(antigravity({ plan: 'Ultra' }))).toBe('plano Ultra');
    expect(cardState(antigravity({ usage: { source: 'antigravity', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(antigravity({ usage: { source: 'antigravity', details: [{ label: 'Gemini Models · 5 h', utilization: 5 }], fetchedAt: 0 } }))).toBe('ok');
    expect(showsUsageAge(antigravity({ usage: { source: 'antigravity', fiveHour: win, fetchedAt: 0 } }))).toBe(true);
    expect(antigravityUsageNote(antigravity({ usage: { source: 'antigravity', fiveHour: win, fetchedAt: 0 } }), 12 * MIN)).toBe(
      'O Antigravity exibe apenas os modelos do Google (Gemini e Argon), sem modelos de terceiros. Estes números são da última leitura (há 12 min).',
    );
    expect(antigravityUsageNote(antigravity(), 0)).toBe('Não há o que instalar: o uso vem do próprio CLI do Antigravity (`agy`).');
    expect(antigravityUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });

  it('detailMeterMeta gera rótulos compactos e windowMs correto para cada janela', () => {
    expect(detailMeterMeta({ label: 'Gemini Models · 5 h', group: 'Gemini Models', window: '5h', utilization: 5 })).toEqual({
      long: 'Gemini 5h',
      short: 'Gem. 5h',
      title: 'Gemini Models · 5 h',
      windowMs: FIVE_HOURS_MS,
    });
    expect(detailMeterMeta({ label: 'Gemini Models · semana', group: 'Gemini Models', window: 'weekly', utilization: 9 })).toEqual({
      long: 'Gemini Sem.',
      short: 'Gem. Sem.',
      title: 'Gemini Models · semana',
      windowMs: WEEK_MS,
    });
    expect(detailMeterMeta({ label: 'Gemini 4 Argon · semana', group: 'Gemini 4 Argon', window: 'weekly', utilization: 0 })).toEqual({
      long: 'Argon Sem.',
      short: 'Arg. Sem.',
      title: 'Gemini 4 Argon · semana',
      windowMs: WEEK_MS,
    });
    expect(detailMeterMeta({ label: 'Gemini 4 Argon · mês', utilization: 10 })).toEqual({
      long: 'Argon Mês',
      short: 'Arg. Mês',
      title: 'Gemini 4 Argon · mês',
      windowMs: MONTH_MS,
    });
  });
});

describe('cartão de uso de uma conta do Hermes', () => {
  const hermes = (over: Partial<Acc> = {}): Acc => ({ provider: 'hermes', usageStatus: 'ok', configDir: '~/.hermes/profiles/developer', ...over });

  it('sem limites de plano: sem números, com a explicação de que os tokens ficam no agente', () => {
    expect(usageMessage(hermes())).toEqual(['sem dados ainda', 'sem dados']);
    expect(hermesUsageNote(hermes())).toBe('O Hermes não informa limites de plano: os tokens de cada sessão aparecem no agente.');
    expect(hermesUsageNote({})).toBe('');
    expect(usageSubtitle(hermes())).toBe('~/.hermes/profiles/developer');
    // O cartão do grupo Hermes não repete a pasta (o topo mostra um cartão só).
    expect(usageSubtitle({ ...hermes(), id: HERMES_GROUP })).toBe('');
  });
});
