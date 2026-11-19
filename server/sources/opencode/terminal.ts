// Terminal do OpenCode: a conversa de uma sessão vem do serviço local (GET /api/session/{id}/message), não de um
// arquivo. Cada mensagem do OpenCode vira TerminalEntry pelas mesmas regras do terminal do Claude Code (textos
// limpos, segredos mascarados, cortes), e o MessageStream entrega ao terminal o `init` e os `append` como qualquer
// transcript — o navegador não sabe de onde veio.
//
// Formato (API V2, experimental): user (texto + anexos), assistant (content: reasoning | text | tool), shell,
// compaction, system, synthetic e idle. O assistant é a única mensagem que cresce: o texto só entra quando a
// mensagem termina, o raciocínio quando o bloco termina e a ferramenta assim que começa (o resultado quando acaba).
import type { TerminalEntry, TerminalInit } from '../../../shared/types';
import { maskSecrets } from '../../../shared/activity';
import { marked, prepare, RESULT_MAX, RESULT_MAX_LINES, TEXT_MAX, THINKING_MAX, toolView } from '../terminal';
import type { MessageDelta, MessageStream } from '../stream';
import type { OpenCodeClientLike } from './client';
import { tr } from '../../../shared/i18n';

/** Mensagens buscadas por poll (a página mais recente; o suficiente para um terminal aberto). */
export const MESSAGE_LIMIT = 100;
/** Entradas mostradas no init, como no terminal do Claude Code. */
export const INIT_ENTRIES = 500;
/** Ids lembrados para não repetir entradas a cada poll. */
const SEEN_MAX = 20_000;

type Rec = Record<string, unknown>;
type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;
type ResultEntry = Extract<TerminalEntry, { kind: 'result' }>;
type SystemEntry = Extract<TerminalEntry, { kind: 'system' }>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** O id de uma sessão do OpenCode (`ses_...`): sem barras, nada de path traversal na rota do serviço. */
export function isOpenCodeSessionId(v: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(v);
}

function atOf(m: Rec, fallback = 0): number {
  return num(rec(m.time)?.created) ?? fallback;
}

function isImage(mime: string | undefined): boolean {
  return !!mime && /^image\//i.test(mime);
}

function fileName(f: Rec): string | undefined {
  const name = str(f.name);
  if (name) return name;
  const uri = str(rec(f.source)?.uri);
  if (!uri) return undefined;
  try {
    const path = new URL(uri).pathname;
    return path.slice(path.lastIndexOf('/') + 1) || undefined;
  } catch {
    return undefined;
  }
}

/** Texto de um resultado de ferramenta do OpenCode: blocos de texto e arquivos (imagem/anexo). */
function resultText(raw: unknown): string {
  const parts: string[] = [];
  for (const item of list(raw)) {
    const b = rec(item);
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'file') {
      const mime = str(b.mime);
      parts.push(isImage(mime) ? tr('[imagem]') : tr('[arquivo: {0}]', [str(b.name) ?? tr('anexo')]));
    }
  }
  return parts.join('\n');
}

/** Uma mensagem `system`/`synthetic`: texto curto no rótulo, o conteúdo inteiro no detalhe (cortado). */
function systemEntry(id: string, at: number, text: string, detail: string | undefined, level: SystemEntry['level'] = 'info'): SystemEntry {
  const e: SystemEntry = { kind: 'system', id, at, text: maskSecrets(oneLine(text) || text), level };
  if (detail?.trim()) {
    const d = marked(prepare(detail, RESULT_MAX));
    if (d) e.detail = d;
  }
  return e;
}

/** Nome/entrada da ferramenta no formato do Claude Code (toolView): "Bash(npm test)", "Read(arquivo)". */
function toolOf(name: string, input: Rec, cwd: string | undefined): { name: string; view: ReturnType<typeof toolView> } {
  const path = str(input.path) ?? str(input.filePath) ?? str(input.file) ?? str(input.absolutePath);
  const command = str(input.command) ?? str(input.cmd);
  switch (name.toLowerCase()) {
    case 'shell':
    case 'bash':
      return { name: 'Bash', view: toolView('Bash', { command }, cwd) };
    case 'read':
      return { name: 'Read', view: toolView('Read', { file_path: path, offset: input.offset, limit: input.limit }, cwd) };
    case 'write':
      return { name: 'Write', view: toolView('Write', { file_path: path, content: input.content }, cwd) };
    case 'edit':
      return {
        name: 'Edit',
        view: toolView('Edit', { file_path: path, old_string: input.oldString ?? input.old_string, new_string: input.newString ?? input.new_string }, cwd),
      };
    case 'patch':
      return {
        name: 'Edit',
        view: toolView('Edit', { file_path: path, old_string: input.oldString ?? input.old_string, new_string: input.newString ?? input.new_string ?? input.patch }, cwd),
      };
    case 'glob':
      return { name: 'Glob', view: toolView('Glob', { pattern: input.pattern }, cwd) };
    case 'grep':
      return { name: 'Grep', view: toolView('Grep', { pattern: input.pattern, path, include: input.include }, cwd) };
    case 'ls':
    case 'list':
      return { name: 'LS', view: toolView('LS', { path }, cwd) };
    case 'webfetch':
      return { name: 'WebFetch', view: toolView('WebFetch', { url: input.url, prompt: input.prompt, format: input.format }, cwd) };
    case 'websearch':
      return { name: 'WebSearch', view: toolView('WebSearch', { query: input.query }, cwd) };
    case 'task': {
      const sub = str(input.agent) ?? str(input.subagent_type) ?? str(input.subagentType);
      const desc = str(input.description) ?? str(input.prompt);
      return { name: 'Task', view: toolView('Task', { subagent_type: sub, description: desc, prompt: input.prompt }, cwd) };
    }
    case 'todowrite':
      return { name: 'TodoWrite', view: toolView('TodoWrite', { todos: input.todos }, cwd) };
    case 'todoread':
      return { name: 'TaskList', view: toolView('TaskList', {}, cwd) };
    case 'skill':
      return { name: 'Skill', view: toolView('Skill', { skill: str(input.id) ?? str(input.name) ?? str(input.skill) }, cwd) };
    case 'question':
    case 'ask':
      return { name: 'AskUserQuestion', view: toolView('AskUserQuestion', { questions: input.questions }, cwd) };
    default: {
      // O OpenCode V2 não usa o prefixo mcp__ do Claude Code: o nome do MCP vem como "servidor_ferramenta"
      // (ex.: atlas-store_atlas_status) e cai no formato padrão, com o primeiro argumento no título.
      return { name, view: toolView(name, input, cwd) };
    }
  }
}

function toolEntry(part: Rec, at: number, cwd: string | undefined, fallbackId: string): ToolEntry | undefined {
  const state = rec(part.state);
  // `streaming` = o modelo ainda está montando os argumentos (input é uma string parcial): espera.
  if (!state || state.status === 'streaming') return undefined;
  const name = str(part.name) ?? tr('ferramenta');
  const input = rec(state.input) ?? {};
  const { name: shown, view } = toolOf(name, input, cwd);
  const e: ToolEntry = { kind: 'tool', id: str(part.id) ?? fallbackId, at, tool: shown, title: maskSecrets(view.title) };
  if (view.input) {
    e.input = view.input;
    e.inputKind = view.inputKind;
  }
  return e;
}

function resultEntry(part: Rec, at: number, fallbackId: string): ResultEntry | undefined {
  const state = rec(part.state);
  const status = state?.status;
  if (status !== 'completed' && status !== 'error') return undefined;
  const error = status === 'error';
  const failed = rec(state?.error);
  let raw = resultText(state?.content);
  if (error && !raw.trim()) raw = str(failed?.message) ?? tr('(sem saída)');
  const metadata = rec(state?.metadata);
  const exit = num(metadata?.exit);
  if (!error && exit !== undefined && exit !== 0) raw = raw.trim() ? tr('Código de saída {0}\n{1}', [exit, raw]) : tr('Código de saída {0}', [exit]);
  const p = prepare(raw, RESULT_MAX, RESULT_MAX_LINES);
  const toolUseId = str(part.id) ?? fallbackId;
  const e: ResultEntry = {
    kind: 'result',
    id: `${toolUseId}:r`,
    at,
    toolUseId,
    text: p.text || tr('(sem saída)'),
  };
  if (error) e.error = true;
  if (p.truncated) e.truncated = true;
  return e;
}

/** Traduz uma mensagem do OpenCode em entradas do terminal (pode devolver nenhuma, uma ou várias). */
function messageEntries(raw: unknown, cwd: string | undefined): TerminalEntry[] {
  const m = rec(raw);
  if (!m) return [];
  const id = str(m.id);
  if (!id) return [];
  const at = atOf(m);
  const out: TerminalEntry[] = [];
  const push = (e: TerminalEntry | undefined) => {
    if (e) out.push(e);
  };

  switch (m.type) {
    case 'user': {
      const text = typeof m.text === 'string' ? m.text : '';
      const extras: string[] = [];
      for (const rawFile of list(m.files)) {
        const f = rec(rawFile);
        if (!f) continue;
        const name = fileName(f);
        const mention = str(rec(f.mention)?.text);
        if (mention && text.includes(mention)) continue; // já aparece no texto ("@arquivo")
        extras.push(isImage(str(f.mime)) ? tr('[imagem]') : tr('[arquivo: {0}]', [name ?? tr('anexo')]));
      }
      const body = marked(prepare([text.trimEnd(), extras.join(' ')].filter((s) => s.trim()).join('\n'), TEXT_MAX));
      if (body) out.push({ kind: 'user', id: `${id}:u`, at, text: body });
      return out;
    }
    case 'assistant': {
      const time = rec(m.time);
      const done = num(time?.completed) !== undefined;
      const content = list(m.content);
      content.forEach((rawPart, i) => {
        const part = rec(rawPart);
        if (!part) return;
        switch (part.type) {
          case 'reasoning': {
            const text = typeof part.text === 'string' ? part.text : '';
            const finished = done || num(rec(part.time)?.completed) !== undefined;
            if (!finished || !text.trim()) return;
            const body = marked(prepare(text, THINKING_MAX));
            if (body) push({ kind: 'thinking', id: `${id}:k${i}`, at: num(rec(part.time)?.created) ?? at, text: body });
            return;
          }
          case 'text': {
            // Texto só quando a mensagem inteira terminou (senão o mesmo bloco entraria aos pedaços).
            const text = typeof part.text === 'string' ? part.text : '';
            if (!done || !text.trim()) return;
            const body = marked(prepare(text, TEXT_MAX));
            if (body) push({ kind: 'assistant', id: `${id}:t${i}`, at: num(time?.completed) ?? at, text: body });
            return;
          }
          case 'tool': {
            const partAt = num(rec(part.time)?.created) ?? at;
            const fallbackId = `${id}:tool${i}`;
            push(toolEntry(part, partAt, cwd, fallbackId));
            const doneAt = num(rec(part.time)?.completed) ?? partAt;
            push(resultEntry(part, doneAt, fallbackId));
            return;
          }
          default:
            return;
        }
      });
      const error = rec(m.error);
      const why = str(error?.message);
      if (done && why) push(systemEntry(`${id}:err`, num(time?.completed) ?? at, tr('Erro da API'), why, 'error'));
      return out;
    }
    case 'shell': {
      const command = typeof m.command === 'string' ? m.command : '';
      if (command.trim()) out.push({ kind: 'user', id: `${id}:u`, at, text: maskedPrompt(`! ${command}`) });
      const status = str(m.status);
      if (!status || status === 'running') return out;
      const output = str(rec(m.output)?.output) ?? '';
      const exit = num(m.exit);
      const level: SystemEntry['level'] = status === 'killed' || status === 'timeout' || (exit !== undefined && exit !== 0) ? 'error' : 'info';
      const text = output.trim() ? tr('Saída do comando') : exit !== undefined ? tr('Código de saída {0}', [exit]) : tr('(sem saída)');
      push(systemEntry(`${id}:out`, num(rec(m.time)?.completed) ?? at, text, output.trim() ? output : undefined, level));
      return out;
    }
    case 'compaction': {
      const status = str(m.status);
      if (status === 'running') return out;
      const reason = str(m.reason);
      if (status === 'failed') {
        push(systemEntry(`${id}:compact`, at, tr('Falha ao compactar o contexto'), str(rec(m.error)?.message), 'error'));
      } else {
        const text = reason === 'manual' ? tr('Conversa compactada (/compact)') : tr('Conversa compactada automaticamente');
        push(systemEntry(`${id}:compact`, at, text, str(m.summary)));
      }
      return out;
    }
    case 'idle': {
      const outcome = str(m.outcome);
      if (outcome === 'failed') {
        push(systemEntry(`${id}:idle`, at, tr('O turno falhou'), str(rec(m.error)?.message), 'error'));
      } else if (outcome === 'interrupted') {
        push(systemEntry(`${id}:idle`, at, tr('Interrompido pelo usuário'), undefined, 'warn'));
      }
      return out;
    }
    case 'synthetic': {
      // O resultado de um shell já saiu na mensagem `shell`; não repete.
      if (str(rec(m.metadata)?.source) === 'shell') return out;
      const text = typeof m.text === 'string' ? m.text : '';
      const description = str(m.description) ?? oneLine(text);
      if (description) push(systemEntry(`${id}:syn`, at, description, text));
      return out;
    }
    case 'system': {
      // Avisos de instruções do Code Mode entram no contexto do modelo, não na conversa.
      if (str(rec(m.metadata)?.notice) === 'instructions') return out;
      const text = typeof m.text === 'string' ? m.text : '';
      const description = str(m.description) ?? oneLine(text);
      if (description) push(systemEntry(`${id}:sys`, at, description, text));
      return out;
    }
    default:
      // agent-switched, model-switched, location-switched, skill: configuração, não conversa.
      return out;
  }
}

function oneLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? '';
}

function maskedPrompt(text: string): string {
  return marked(prepare(text, TEXT_MAX));
}

/** Todas as mensagens (na ordem em que vieram) no formato do terminal. Puro: os testes cobrem cada tipo. */
export function openCodeMessageEntries(messages: readonly unknown[], opts: { cwd?: string } = {}): TerminalEntry[] {
  return messages.flatMap((m) => messageEntries(m, opts.cwd));
}

export interface OpenCodeMessageStreamOptions {
  client: OpenCodeClientLike;
  sessionId: string;
  /** Id no `init`: o agente do escritório ou "session:<conta>:<sessão>". */
  streamId: string;
  cwd?: string;
  /** Mensagens por poll (padrão MESSAGE_LIMIT). */
  limit?: number;
  /** Entradas no init (padrão INIT_ENTRIES). */
  initEntries?: number;
  /** Intervalo de polling sugerido ao terminal. */
  intervalMs?: number;
}

/**
 * Conversa ao vivo de uma sessão do OpenCode: cada load/poll lê a página mais recente de mensagens e entrega só
 * as entradas que ainda não saíram. Funciona igual para o agente principal e para o subagente (a sessão filha).
 */
export class OpenCodeMessageStream implements MessageStream {
  readonly intervalMs?: number;
  private readonly client: OpenCodeClientLike;
  private readonly sessionId: string;
  private readonly streamId: string;
  private readonly cwd?: string;
  private readonly limit: number;
  private readonly initEntries: number;
  private seen = new Set<string>();

  constructor(opts: OpenCodeMessageStreamOptions) {
    this.client = opts.client;
    this.sessionId = opts.sessionId;
    this.streamId = opts.streamId;
    this.cwd = opts.cwd;
    this.limit = opts.limit ?? MESSAGE_LIMIT;
    this.initEntries = opts.initEntries ?? INIT_ENTRIES;
    if (opts.intervalMs !== undefined) this.intervalMs = opts.intervalMs;
  }

  async load(): Promise<TerminalInit> {
    const { messages, truncated } = await this.fetch();
    const entries = openCodeMessageEntries(messages, this.cwd ? { cwd: this.cwd } : {});
    this.seen = new Set(entries.map((e) => e.id));
    const kept = entries.length > this.initEntries ? entries.slice(-this.initEntries) : entries;
    return { agentId: this.streamId, entries: kept, truncated: truncated || kept.length < entries.length };
  }

  async poll(): Promise<MessageDelta> {
    const { messages } = await this.fetch();
    const fresh = openCodeMessageEntries(messages, this.cwd ? { cwd: this.cwd } : {}).filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.remember(e.id);
    return { append: fresh };
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
  }

  /** A página mais recente (desc), devolvida na ordem cronológica; `truncated` = há mensagens mais antigas. */
  private async fetch(): Promise<{ messages: unknown[]; truncated: boolean }> {
    const path = `/api/session/${encodeURIComponent(this.sessionId)}/message?limit=${this.limit}&order=desc`;
    const raw = await this.client.get<unknown>(path);
    const page = list(raw);
    return { messages: page.slice().reverse(), truncated: page.length >= this.limit };
  }
}

/** Stream novo para uma conexão de terminal (como createTerminalParser: cada uma tem o estado dela). */
export function createOpenCodeMessageStream(opts: OpenCodeMessageStreamOptions): MessageStream {
  return new OpenCodeMessageStream(opts);
}
