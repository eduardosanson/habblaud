// Carregador simples de arquivos `.env` sem dependências externas (mesma precedência do Docker Compose:
// variáveis já definidas e não vazias no ambiente têm prioridade sobre o `.env`).
import { readFileSync } from 'node:fs';

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquoteValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    if (end !== -1) return trimmed.slice(1, end);
  }
  if (trimmed.startsWith('"')) {
    let out = '';
    for (let i = 1; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (ch === '\\' && i + 1 < trimmed.length) {
        const next = trimmed[++i]!;
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else out += next;
      } else if (ch === '"') {
        return out;
      } else {
        out += ch;
      }
    }
    return trimmed.slice(1);
  }
  return trimmed.replace(/(?:^|\s)#.*$/, '').trim();
}

/** Interpreta o texto de um arquivo `.env` ignorando comentários e linhas inválidas. */
export function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = LINE_RE.exec(line);
    if (!match) continue;
    result[match[1]!] = unquoteValue(match[2] ?? '');
  }
  return result;
}

/** Lê um arquivo `.env` do disco; devolve `{}` se não existir ou falhar a leitura. */
export function readDotEnv(filePath: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Devolve um novo objeto de ambiente onde o `.env` preenche apenas chaves ausentes ou vazias em `env`
 * (variáveis não vazias do processo sempre vencem).
 */
export function mergeEnvWithDotEnv(env: NodeJS.ProcessEnv, dotEnv: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(dotEnv)) {
    if (!merged[key]?.trim()) merged[key] = value;
  }
  return merged;
}

/**
 * Lê `filePath` e preenche no próprio `env` as chaves que ainda estão ausentes ou vazias.
 * Devolve o mapa lido do `.env`.
 */
export function applyDotEnv(filePath: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const dotEnv = readDotEnv(filePath);
  for (const [key, value] of Object.entries(dotEnv)) {
    if (!env[key]?.trim()) env[key] = value;
  }
  return dotEnv;
}
