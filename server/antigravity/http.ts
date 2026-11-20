// Eventos do Antigravity: o hook do `agy` (mod/habblaud-antigravity/hook.mjs) manda um JSON por evento para
// POST /api/antigravity/events. Só observa; nada volta para a sessão do Antigravity.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { errMsg, log } from '../log';
import type { AntigravitySource } from '../sources/antigravity/source';
import { rec, str, type AntigravityEventBody } from '../sources/antigravity/events';
import { tr } from '../../shared/i18n';

export function parseAntigravityEvent(raw: unknown): AntigravityEventBody {
  const r = rec(raw);
  const event = rec(r?.event);
  if (!r || !event || !str(event.type)) throw new HttpError(400, 'esperado {event: {type, ...}}');
  return { event };
}

export async function handleAntigravityEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { source?: AntigravitySource },
): Promise<void> {
  const body = parseAntigravityEvent(await readJson(req));
  let ok = false;
  if (deps.source) {
    try {
      ok = deps.source.applyEvent(body);
    } catch (err) {
      log.warnOnce(`antigravity-event:${errMsg(err)}`, tr('Eventos do Antigravity: falha ao aplicar um evento ({0}).', [errMsg(err)]));
    }
  }
  sendJson(res, 200, { ok });
}
