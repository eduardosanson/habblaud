// Configuração do roadmap do Habblaud: a página `/roadmap` lê um Hermes Pipeline local
// e conversa com o agente. O token fica só no servidor do Habblaud; o navegador fala
// com `/api/roadmap/*`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';

export interface RoadmapConfig {
  /** Ligado por HABBLAUD_ROADMAP (padrão ligado) e com URL + token válidos. */
  enabled: boolean;
  /** Base HTTP do Hermes Pipeline, sem barra no fim (padrão http://127.0.0.1:49500). */
  url?: string;
  /** Token do Habblaud no pipeline (`roadmap.read` + `agent.converse`). Nunca vai ao navegador. */
  token?: string;
  /** Quando definido, só estes roadmaps aparecem (HABBLAUD_ROADMAP_IDS). */
  ids?: string[];
  /** Por que ficou desligado (vai para o log e para o estado da página). */
  warning?: string;
}

export const DEFAULT_ROADMAP_URL = 'http://127.0.0.1:49500';

function readRoadmapTokenFile(env: NodeJS.ProcessEnv): string {
  const base = env.HABBLAUD_DATA_DIR?.trim() || join(homedir(), '.habblaud');
  try {
    return readFileSync(join(base, 'roadmap-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

function isOn(value: string | undefined): boolean {
  return !!value && /^(1|true|yes|sim|on)$/i.test(value.trim());
}

function isLocalPipelineHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === 'host.docker.internal' || /^127\./.test(host);
}

/**
 * Hermes Pipeline a partir do ambiente:
 * - `HABBLAUD_ROADMAP=0` desliga o recurso; ausente liga, mas só com token.
 * - `HABBLAUD_ROADMAP_URL` (padrão `http://127.0.0.1:49500`): base sem caminho, usuário ou parâmetros. `http://` só
 *   para o próprio computador (ou `host.docker.internal`, para o Docker); `https://` vale para qualquer host.
 * - `HABBLAUD_ROADMAP_TOKEN` é o token do Habblaud no pipeline; para conveniência, aceita `PIPELINE_HABBLAUD_TOKEN`
 *   quando o Habblaud roda no mesmo ambiente do pipeline.
 * - `HABBLAUD_ROADMAP_IDS` (opcional) restringe a lista a estes roadmaps e esconde sessões de outros roadmaps.
 */
export function parseRoadmapConfig(env: NodeJS.ProcessEnv = process.env): RoadmapConfig {
  const flag = env.HABBLAUD_ROADMAP?.trim();
  if (flag && !isOn(flag)) return { enabled: false };
  const token =
    env.HABBLAUD_ROADMAP_TOKEN?.trim() ||
    env.PIPELINE_HABBLAUD_TOKEN?.trim() ||
    readRoadmapTokenFile(env) ||
    '';
  const ids = [...new Set((env.HABBLAUD_ROADMAP_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
  const raw = env.HABBLAUD_ROADMAP_URL?.trim() || DEFAULT_ROADMAP_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { enabled: false, warning: tr('HABBLAUD_ROADMAP_URL não é um endereço válido') };
  }
  const secure = url.protocol === 'https:';
  if (!secure && url.protocol !== 'http:') {
    return { enabled: false, warning: tr('HABBLAUD_ROADMAP_URL precisa começar com http:// ou https://') };
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { enabled: false, warning: tr('HABBLAUD_ROADMAP_URL deve ter só o endereço do pipeline (sem caminho, usuário, senha ou parâmetros)') };
  }
  if (!secure && !isLocalPipelineHost(url.hostname)) {
    return { enabled: false, warning: tr('HABBLAUD_ROADMAP_URL com http:// só vale para o próprio computador ou host.docker.internal; use https:// para outro host') };
  }
  if (!token) {
    return {
      enabled: false,
      url: `${url.protocol}//${url.host}`,
      warning: tr('HABBLAUD_ROADMAP_TOKEN não definido: o roadmap fica desligado até o token do Habblaud ser configurado'),
      ...(ids.length ? { ids } : {}),
    };
  }
  return { enabled: true, url: `${url.protocol}//${url.host}`, token, ...(ids.length ? { ids } : {}) };
}

export function syncRoadmapTokenFile(token: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (!token) return;
  const base = env.HABBLAUD_DATA_DIR?.trim() || join(homedir(), '.habblaud');
  try {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'roadmap-token'), token + '\n', { mode: 0o600 });
  } catch {
    // best effort
  }
}
