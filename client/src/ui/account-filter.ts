// Filtro de contas da barra lateral. O Hermes é um grupo só no topo ("Hermes"), com um select para escolher
// o perfil; as demais ferramentas continuam com um chip por conta.
import type { AccountInfo } from '../../../shared/types';
import { isHermes } from './provider';

/** Id sintético do chip que representa todos os perfis do Hermes (nunca colide com uma conta de verdade). */
export const HERMES_GROUP = '__hermes__';

export interface AccountFilterPrefs {
  /** Contas ocultas individualmente (não inclui os perfis do Hermes: esses são o grupo). */
  hiddenAccounts: readonly string[];
  /** Grupo Hermes desligado no topo. */
  hideHermes: boolean;
  /** Perfis do Hermes escolhidos (vazio = todos). */
  hermesProfiles: readonly string[];
}

/** Conta sintética do grupo Hermes (chip "H", nome "Hermes"). */
export function hermesGroupAccount(accounts: readonly AccountInfo[]): AccountInfo {
  const first = accounts.find(isHermes);
  const sessions = accounts.filter(isHermes).reduce((n, a) => n + a.sessions, 0);
  return {
    id: HERMES_GROUP,
    provider: 'hermes',
    short: 'H',
    name: 'Hermes',
    color: first?.color ?? '#8b98b3',
    configDir: '',
    sessions,
    usageStatus: 'disabled',
  };
}

/** Troca todos os perfis do Hermes por um chip único, na posição do primeiro perfil. */
export function filterAccounts(accounts: readonly AccountInfo[]): AccountInfo[] {
  const hermes = accounts.filter(isHermes);
  if (hermes.length === 0) return [...accounts];
  const out: AccountInfo[] = [];
  let inserted = false;
  for (const account of accounts) {
    if (!isHermes(account)) {
      out.push(account);
      continue;
    }
    if (!inserted) {
      out.push(hermesGroupAccount(hermes));
      inserted = true;
    }
  }
  return out;
}

/** Perfis escolhidos que ainda existem (vazio = todos). */
export function selectedHermesProfiles(accounts: readonly Pick<AccountInfo, 'id' | 'provider'>[], prefs: AccountFilterPrefs): string[] {
  const wanted = prefs.hermesProfiles ?? [];
  if (!wanted.length) return [];
  const ids = new Set(accounts.filter((a) => isHermes(a)).map((a) => a.id));
  return wanted.filter((id) => ids.has(id));
}

/**
 * Conjunto efetivo de contas ocultas: as escolhidas à mão + os perfis do Hermes fora da seleção (ou todos,
 * quando o grupo está desligado). Ids antigos de perfis do Hermes em `hiddenAccounts` são ignorados: o grupo
 * manda, e `hiddenAccounts` guarda no máximo 20 contas.
 */
export function effectiveHiddenAccounts(
  accounts: readonly Pick<AccountInfo, 'id' | 'provider'>[],
  prefs: AccountFilterPrefs,
): Set<string> {
  const hermesIds = new Set(accounts.filter((a) => isHermes(a)).map((a) => a.id));
  const hidden = new Set(prefs.hiddenAccounts.filter((id) => !hermesIds.has(id)));
  if (prefs.hideHermes) {
    for (const id of hermesIds) hidden.add(id);
  } else {
    const selected = selectedHermesProfiles(accounts, prefs);
    if (selected.length) for (const id of hermesIds) if (!selected.includes(id)) hidden.add(id);
  }
  return hidden;
}

/** Uma conta está fora do filtro atual? (para o feed e os avisos, que antes olhavam só `hiddenAccounts`) */
export function isAccountHidden(
  accounts: readonly Pick<AccountInfo, 'id' | 'provider'>[],
  prefs: AccountFilterPrefs,
  id: string,
): boolean {
  return effectiveHiddenAccounts(accounts, prefs).has(id);
}
