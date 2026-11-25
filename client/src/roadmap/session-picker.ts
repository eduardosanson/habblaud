// Seletor de sessão da gaveta de conversa: o que cada sessão mostra e quando dá para enviar. Sem DOM, para testar.
// A lista vem do servidor do Habblaud (GET /api/roadmap/sessions); aqui só se decide a escolha inicial e o veredito.
import { tr } from '../../../shared/i18n';
import type { Provider } from '../../../shared/types';
import { providerLabel } from './bridge';
import type { ApiSessionOption, ApiSessionOptions } from './pipeline';

export interface SessionChoice {
  provider: Provider;
  sessionId: string;
}

export type SendVerdict = { ok: true } | { ok: false; reason: string };

export function sameSession(a: SessionChoice, b: SessionChoice): boolean {
  return a.provider === b.provider && a.sessionId === b.sessionId;
}

/** A que o servidor sugeriu; sem ela, a primeira viva; sem nenhuma viva, nada. */
export function initialChoice(opts: ApiSessionOptions): SessionChoice | null {
  if (opts.suggested) return { provider: opts.suggested.provider, sessionId: opts.suggested.sessionId };
  const live = opts.options.find((option) => option.live);
  return live ? { provider: live.provider, sessionId: live.sessionId } : null;
}

/** Texto de uma linha do seletor: provider, perfil, se é só do roadmap (não do item) e se a sessão está viva. */
export function describeOption(option: ApiSessionOption): string {
  const state = option.live ? tr('viva') : tr('fechada');
  const scope = option.scope === 'roadmap' ? tr('do roadmap') : undefined;
  return [providerLabel(option.provider), option.profile, scope, state].filter(Boolean).join(' · ');
}

/** A sessão escolhida que dá para reabrir: fechada e do Claude Code (o único com reabertura no servidor). */
export function reopenTarget(opts: ApiSessionOptions, choice: SessionChoice | null): SessionChoice | null {
  const picked = choice ? opts.options.find((option) => sameSession(option, choice)) : undefined;
  return picked && !picked.live && picked.provider === 'claude' ? { provider: picked.provider, sessionId: picked.sessionId } : null;
}

/** A sessão que o seletor mostra (a escolhida ou, sem escolha, a inicial) está viva? */
export function liveSelected(opts: ApiSessionOptions | null, choice: SessionChoice | null): boolean {
  const shown = opts ? (choice ?? initialChoice(opts)) : null;
  return !!shown && !!opts?.options.find((option) => sameSession(option, shown))?.live;
}

/** Dá para enviar? Só para uma sessão viva que está na lista; do contrário, o motivo para mostrar à pessoa. */
export function canSend(opts: ApiSessionOptions, choice: SessionChoice | null): SendVerdict {
  if (opts.options.length === 0) return { ok: false, reason: tr('Ninguém registrou sessão neste item.') };
  const picked = choice ? opts.options.find((option) => sameSession(option, choice)) : undefined;
  if (!picked) return { ok: false, reason: tr('Escolha uma sessão para conversar.') };
  if (!picked.live) return { ok: false, reason: tr('Sessão fechada: abra-a para conversar.') };
  return { ok: true };
}
