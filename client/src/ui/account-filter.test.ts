import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import {
  effectiveHiddenAccounts,
  filterAccounts,
  HERMES_GROUP,
  hermesGroupAccount,
  isAccountHidden,
  selectedHermesProfile,
} from './account-filter';

function account(id: string, provider: AccountInfo['provider'], name = id): AccountInfo {
  return { id, provider, short: id.slice(0, 2).toUpperCase(), name, color: '#123456', configDir: '', sessions: 1, usageStatus: 'disabled' };
}

const CLAUDE = account('.claude', undefined, 'Conta A');
const CODEX = account('.codex', 'codex', 'Codex');
const DEV = account('developer', 'hermes', 'Hermes D');
const SPEC = account('spec-writer', 'hermes', 'Hermes SW');
const DEFAULT = account('default', 'hermes', 'Hermes');
const ACCOUNTS = [CLAUDE, DEV, CODEX, SPEC, DEFAULT];

describe('filtro de contas com o Hermes agrupado', () => {
  it('troca os perfis do Hermes por um chip único na posição do primeiro', () => {
    const out = filterAccounts(ACCOUNTS);
    expect(out.map((a) => a.id)).toEqual(['.claude', HERMES_GROUP, '.codex']);
    const group = out[1];
    expect(group).toMatchObject({ id: HERMES_GROUP, provider: 'hermes', short: 'H', name: 'Hermes', color: '#123456', sessions: 3 });
    expect(hermesGroupAccount([DEV])).toMatchObject({ id: HERMES_GROUP, name: 'Hermes', sessions: 1 });
  });

  it('sem Hermes, as contas ficam como estão', () => {
    expect(filterAccounts([CLAUDE, CODEX]).map((a) => a.id)).toEqual(['.claude', '.codex']);
    expect(filterAccounts([])).toEqual([]);
  });

  it('o select escolhe um perfil; os outros ficam ocultos', () => {
    const hidden = effectiveHiddenAccounts(ACCOUNTS, { hiddenAccounts: [], hideHermes: false, hermesProfile: 'developer' });
    expect([...hidden].sort()).toEqual(['default', 'spec-writer']);
    expect(selectedHermesProfile(ACCOUNTS, { hiddenAccounts: [], hideHermes: false, hermesProfile: 'developer' })).toBe('developer');
    expect(selectedHermesProfile(ACCOUNTS, { hiddenAccounts: [], hideHermes: false, hermesProfile: 'sumiu' })).toBe('');
    // Perfil inválido (sumiu): todos os perfis voltam.
    expect(effectiveHiddenAccounts(ACCOUNTS, { hiddenAccounts: [], hideHermes: false, hermesProfile: 'sumiu' }).size).toBe(0);
  });

  it('o grupo desligado oculta todos os perfis, sem mexer nas outras contas', () => {
    const hidden = effectiveHiddenAccounts(ACCOUNTS, { hiddenAccounts: ['.claude'], hideHermes: true, hermesProfile: 'developer' });
    expect([...hidden].sort()).toEqual(['.claude', 'default', 'developer', 'spec-writer']);
    expect(isAccountHidden(ACCOUNTS, { hiddenAccounts: [], hideHermes: true, hermesProfile: '' }, 'default')).toBe(true);
    expect(isAccountHidden(ACCOUNTS, { hiddenAccounts: [], hideHermes: true, hermesProfile: '' }, '.codex')).toBe(false);
  });

  it('ids antigos de perfis em hiddenAccounts são ignorados (o grupo manda)', () => {
    const hidden = effectiveHiddenAccounts(ACCOUNTS, { hiddenAccounts: ['developer', 'spec-writer', '.claude'], hideHermes: false, hermesProfile: '' });
    expect([...hidden]).toEqual(['.claude']);
  });
});
