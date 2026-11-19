// Eventos do plugin do Hermes (mod/habblaud-hermes): o plugin observa os hooks e manda um JSON por evento para
// POST /api/hermes/events. Os eventos só observam (nada volta para a sessão do Hermes) e só valem vindos do próprio
// computador: a trava (Host local e, fora do Docker, conexão pelo loopback) é conferida em http/app.ts, como nos
// eventos do Codex. O guard (http/guard.ts) já exigiu JSON.
//
//   POST /api/hermes/events   (plugin)   {profile, home?, event: {type, ...}}: 200 {ok}
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { errMsg, log } from '../log';
import type { HermesSource } from '../sources/hermes/source';
import { rec, str, type HermesEventBody } from '../sources/hermes/events';
import { tr } from '../../shared/i18n';

/** Corpo de POST /api/hermes/events. Sem `event.type`: 400. */
export function parseHermesEvent(raw: unknown): HermesEventBody {
  const r = rec(raw);
  const event = rec(r?.event);
  if (!r || !event || !str(event.type)) throw new HttpError(400, 'esperado {profile?, home?, event: {type, ...}}');
  const profile = str(r.profile) ?? 'default';
  const home = str(r.home);
  const out: HermesEventBody = { profile, event };
  if (home) out.home = home;
  return out;
}

/** Trata POST /api/hermes/events (método e Host já conferidos). `ok` = a fonte do Hermes reconheceu o evento. */
export async function handleHermesEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { source?: HermesSource },
): Promise<void> {
  const body = parseHermesEvent(await readJson(req));
  let ok = false;
  if (deps.source) {
    try {
      ok = deps.source.applyEvent(body);
    } catch (err) {
      log.warnOnce(`hermes-event:${errMsg(err)}`, tr('Eventos do Hermes: falha ao aplicar um evento ({0}).', [errMsg(err)]));
    }
  }
  sendJson(res, 200, { ok });
}
