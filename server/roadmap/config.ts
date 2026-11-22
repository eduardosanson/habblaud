// Configuração do roadmap do Habblaud: a página `/roadmap` lê um Hermes Pipeline
// (local ou remoto) e conversa com o agente. O token fica só no servidor do Habblaud;
// o navegador fala com `/api/roadmap/*`.
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

interface StoredRoadmapConfig {
  url?: string;
  ids?: string[];
  token?: string;
}

/**
 * Pasta de estado do roadmap:
 * - explícito (`opts.dataDir`) ou `HABBLAUD_DATA_DIR`;
 * - `HOME` do `env` (quando fornecido);
 * - `~/.habblaud` apenas quando `env === process.env` (evita vazar o host em testes unitários).
 */
export function roadmapDataDir(env: NodeJS.ProcessEnv = process.env, explicitDataDir?: string): string | undefined {
  const explicit = explicitDataDir?.trim();
  if (explicit) return explicit;
  const fromEnv = env.HABBLAUD_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  const home = env.HOME?.trim();
  if (home) return join(home, '.habblaud');
  return env === process.env ? join(homedir(), '.habblaud') : undefined;
}

function readRoadmapJson(dataDir: string | undefined): StoredRoadmapConfig {
  if (!dataDir) return {};
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'roadmap.json'), 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return {};
    const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined;
    const ids = Array.isArray(raw.ids)
      ? [...new Set(raw.ids.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean))]
      : undefined;
    const token = typeof raw.token === 'string' && raw.token.trim() ? raw.token.trim() : undefined;
    return {
      ...(url ? { url } : {}),
      ...(ids?.length ? { ids } : {}),
      ...(token ? { token } : {}),
    };
  } catch {
    return {};
  }
}

function readRoadmapTokenFile(dataDir: string | undefined): string {
  if (!dataDir) return '';
  try {
    return readFileSync(join(dataDir, 'roadmap-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

function readStoredRoadmapConfig(dataDir: string | undefined): StoredRoadmapConfig {
  const fromJson = readRoadmapJson(dataDir);
  const fileToken = readRoadmapTokenFile(dataDir);
  const token = fileToken || fromJson.token;
  return {
    ...fromJson,
    ...(token ? { token } : {}),
  };
}

function isOn(value: string | undefined): boolean {
  return !!value && /^(1|true|yes|sim|on)$/i.test(value.trim());
}

function isLocalPipelineHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === 'host.docker.internal' || /^127\./.test(host);
}

/**
 * Hermes Pipeline a partir do ambiente e do estado persistido (`<dataDir>/roadmap.json` e `roadmap-token`):
 * - `HABBLAUD_ROADMAP=0` desliga o recurso; ausente liga, mas só com token.
 * - `HABBLAUD_ROADMAP_URL` (padrão persistido ou `http://127.0.0.1:49500`): base sem caminho, usuário ou parâmetros.
 *   `http://` só para o próprio computador (ou `host.docker.internal`, para o Docker); `https://` vale para qualquer host.
 * - `HABBLAUD_ROADMAP_TOKEN` é o token do Habblaud no pipeline; para conveniência, aceita `PIPELINE_HABBLAUD_TOKEN`
 *   quando o Habblaud roda no mesmo ambiente do pipeline.
 * - `HABBLAUD_ROADMAP_IDS` (opcional) restringe a lista a estes roadmaps e esconde sessões de outros roadmaps.
 */
export function parseRoadmapConfig(env: NodeJS.ProcessEnv = process.env, opts?: { dataDir?: string }): RoadmapConfig {
  const flag = env.HABBLAUD_ROADMAP?.trim();
  if (flag && !isOn(flag)) return { enabled: false };

  const dataDir = roadmapDataDir(env, opts?.dataDir);
  const stored = readStoredRoadmapConfig(dataDir);
  const token =
    env.HABBLAUD_ROADMAP_TOKEN?.trim() ||
    env.PIPELINE_HABBLAUD_TOKEN?.trim() ||
    stored.token ||
    '';

  const envUrl = env.HABBLAUD_ROADMAP_URL?.trim();
  const raw = envUrl || stored.url || DEFAULT_ROADMAP_URL;
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

  const normalizedUrl = `${url.protocol}//${url.host}`;
  const envIds = [...new Set((env.HABBLAUD_ROADMAP_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
  const ids =
    envIds.length > 0
      ? envIds
      : !envUrl || normalizedUrl === stored.url
        ? (stored.ids ?? [])
        : [];

  if (!token) {
    return {
      enabled: false,
      url: normalizedUrl,
      warning: tr('HABBLAUD_ROADMAP_TOKEN não definido: o roadmap fica desligado até o token do Habblaud ser configurado'),
      ...(ids.length ? { ids } : {}),
    };
  }
  return { enabled: true, url: normalizedUrl, token, ...(ids.length ? { ids } : {}) };
}

/**
 * Persiste `roadmap-token` e `roadmap.json` (`url`/`ids`) em `<dataDir>` para que reinícios sem `.env`
 * mantenham o endereço remoto. Só grava quando a configuração está ativa e veio do ambiente.
 */
export function syncRoadmapConfigFile(env: NodeJS.ProcessEnv = process.env, opts?: { dataDir?: string }): void {
  const dataDir = roadmapDataDir(env, opts?.dataDir);
  if (!dataDir) return;
  const cfg = parseRoadmapConfig(env, { dataDir });
  if (!cfg.enabled) return;

  const envToken = env.HABBLAUD_ROADMAP_TOKEN?.trim() || env.PIPELINE_HABBLAUD_TOKEN?.trim() || '';
  const envUrl = env.HABBLAUD_ROADMAP_URL?.trim() || '';
  const envIdsRaw = env.HABBLAUD_ROADMAP_IDS?.trim() || '';

  try {
    mkdirSync(dataDir, { recursive: true });
    if (envToken) {
      const tokenPath = join(dataDir, 'roadmap-token');
      let currentToken = '';
      try {
        currentToken = readFileSync(tokenPath, 'utf8').trim();
      } catch {
        // ausente
      }
      if (currentToken !== envToken) {
        writeFileSync(tokenPath, envToken + '\n', { mode: 0o600 });
      }
    }

    if (envUrl || envIdsRaw) {
      const jsonPath = join(dataDir, 'roadmap.json');
      const existing = readRoadmapJson(dataDir);
      const next: { url?: string; ids?: string[] } = {};
      if (envUrl && cfg.url) {
        next.url = cfg.url;
      } else if (existing.url) {
        next.url = existing.url;
      }
      if (envIdsRaw) {
        if (cfg.ids?.length) next.ids = cfg.ids;
      } else if (existing.ids?.length && (!envUrl || !existing.url || cfg.url === existing.url)) {
        next.ids = existing.ids;
      }
      if (next.url || next.ids?.length) {
        const serialized = JSON.stringify(next, null, 2) + '\n';
        let currentJson = '';
        try {
          currentJson = readFileSync(jsonPath, 'utf8');
        } catch {
          // ausente
        }
        if (currentJson !== serialized) {
          writeFileSync(jsonPath, serialized, { mode: 0o600 });
        }
      }
    }
  } catch {
    // best effort
  }
}

/**
 * Avisa quando `.env` trouxe a URL remota e um token, mas um export prévio no shell manteve um token
 * diferente sem definir `HABBLAUD_ROADMAP_URL` (caso clássico de token antigo em ~/.bashrc).
 */
export function roadmapEnvConflictWarning(initialEnv: NodeJS.ProcessEnv, dotEnv: Record<string, string>): string | undefined {
  const dotUrl = dotEnv.HABBLAUD_ROADMAP_URL?.trim();
  const dotToken = dotEnv.HABBLAUD_ROADMAP_TOKEN?.trim();
  if (!dotUrl || !dotToken) return undefined;
  if (initialEnv.HABBLAUD_ROADMAP_URL?.trim()) return undefined;
  const shellToken = initialEnv.HABBLAUD_ROADMAP_TOKEN?.trim() || initialEnv.PIPELINE_HABBLAUD_TOKEN?.trim();
  if (!shellToken || shellToken === dotToken) return undefined;
  return tr(
    'HABBLAUD_ROADMAP_TOKEN do ambiente difere do .env (enquanto HABBLAUD_ROADMAP_URL veio do .env): confira export antigo no shell ou use ./run-roadmap.sh',
  );
}
