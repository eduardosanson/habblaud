// Traduções puras dos eventos do plugin do Hermes (mod/habblaud-hermes): atividade da ferramenta, tokens e
// timestamps. Sem I/O e sem Office aqui; o HermesSource aplica no escritório e os testes cobrem o que cada evento vira.
import type { ActivityDescription } from '../../../shared/activity';
import { describeCommand, describeTool, maskSecrets, truncate } from '../../../shared/activity';
import { toolView } from '../terminal';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;

/** Corpo de POST /api/hermes/events: o perfil do Hermes, a pasta e o evento observado. */
export interface HermesEventBody {
  /** Perfil do Hermes (nome da pasta em ~/.hermes/profiles; "default" no ~/.hermes). */
  profile: string;
  /** HERMES_HOME da sessão (pasta do perfil), para a conta e a sala de fallback. */
  home?: string;
  event: Rec;
}

export function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function eventType(ev: Rec): string | undefined {
  return str(ev.type);
}

export function eventSessionId(ev: Rec): string | undefined {
  return str(ev.session_id);
}

/** Carimbo do evento em epoch ms (o plugin manda `ts` em segundos, como o Hermes). */
export function eventAt(ev: Rec, fallback: number): number {
  const ts = num(ev.ts);
  if (ts === undefined) return fallback;
  return Math.round(ts > 1e12 ? ts : ts * 1_000);
}

/** Preview curto de uma ferramenta: uma linha, sem segredos, até `max` caracteres. */
export function hermesPreview(raw: unknown, max = 200): string {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return '';
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return truncate(maskSecrets(line), max);
}

/** Atividade de uma ferramenta do Hermes, reaproveitando as descrições do Claude Code. */
export function hermesActivity(tool: string, rawPreview: unknown): ActivityDescription {
  const preview = hermesPreview(rawPreview);
  switch (tool) {
    case 'terminal':
    case 'process':
    case 'execute_code':
      return describeCommand(preview);
    case 'read_file':
    case 'skill_view':
      return describeTool('Read', { file_path: preview });
    case 'write_file':
      return describeTool('Write', { file_path: preview });
    case 'patch':
    case 'skill_manage':
      return describeTool('Edit', { file_path: preview });
    case 'search_files':
      return describeTool('Grep', { pattern: preview });
    case 'web_search':
      return describeTool('WebSearch', { query: preview });
    case 'web_extract':
    case 'browser_navigate':
      return describeTool('WebFetch', { url: preview });
    case 'browser_click':
      return { kind: 'browser', icon: '🖱️', text: tr('Clicando na página'), ...(preview ? { detail: preview } : {}) };
    case 'browser_snapshot':
    case 'browser_vision':
      return { kind: 'browser', icon: '📸', text: tr('Olhando a página'), ...(preview ? { detail: preview } : {}) };
    case 'delegate_task':
      return describeTool('Task', { description: preview });
    default:
      return { kind: 'other', icon: '🛠️', text: tr('Usando {0}', [tool]), ...(preview ? { detail: preview } : {}) };
  }
}

export interface HermesTokens {
  input: number;
  output: number;
}

/** Tokens de um `post_api_request`: prompt/input já é inclusivo; cache e raciocínio são subconjuntos. */
export function hermesTokens(ev: Rec): HermesTokens | undefined {
  // O plugin normaliza os campos no evento (input_tokens/output_tokens); aceitar `usage` aninhado também cobre
  // fixtures antigas e um payload cru do Hermes.
  const usage = rec(ev.usage) ?? ev;
  const input = num(usage.input_tokens) ?? num(usage.prompt_tokens);
  const output = num(usage.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return { input: Math.max(0, input ?? 0), output: Math.max(0, output ?? 0) };
}

/** Identidade de uma medição de uso (para não contar a mesma tentativa duas vezes). */
export function hermesUsageId(ev: Rec): string | undefined {
  const direct = str(ev.usage_id) ?? str(ev.api_request_id);
  if (direct) return direct;
  const session = eventSessionId(ev);
  const started = num(ev.started_at);
  const call = num(ev.api_call_count);
  return session && (started !== undefined || call !== undefined) ? `${session}:${started ?? ''}:${call ?? ''}` : undefined;
}

/** O Hermes chama a mesma ferramenta de vários jeitos; o nome vai como veio, só cortado. */
export function hermesToolName(ev: Rec): string {
  return truncate(str(ev.tool_name) ?? tr('ferramenta'), 80);
}

/** Texto de uma mensagem do Hermes (string ou lista de partes); sem system prompt e cortado. */
export function hermesText(raw: unknown, max = 20_000): string {
  if (typeof raw === 'string') return truncate(maskSecrets(raw), max);
  if (!Array.isArray(raw)) return '';
  const parts: string[] = [];
  for (const item of raw) {
    const part = rec(item);
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
    else if (part.type === 'image') parts.push(tr('[imagem]'));
  }
  return truncate(maskSecrets(parts.join('\n')), max);
}

/** Argumentos de uma ferramenta do Hermes no formato do terminal do Claude Code. */
export function hermesToolView(tool: string, rawInput: unknown, cwd?: string): ReturnType<typeof toolView> {
  const input = rec(rawInput) ?? {};
  const path = str(input.path) ?? str(input.file_path) ?? str(input.filePath) ?? str(input.absolutePath);
  const command = str(input.command) ?? str(input.cmd);
  switch (tool) {
    case 'terminal':
    case 'process':
    case 'execute_code':
      return toolView('Bash', { command }, cwd);
    case 'read_file':
    case 'skill_view':
      return toolView('Read', { file_path: path }, cwd);
    case 'write_file':
      return toolView('Write', { file_path: path, content: input.content }, cwd);
    case 'edit':
    case 'patch':
    case 'skill_manage':
      return toolView('Edit', { file_path: path, old_string: input.oldString ?? input.old_string, new_string: input.newString ?? input.new_string ?? input.patch }, cwd);
    case 'search_files':
      return toolView('Grep', { pattern: input.pattern ?? input.query, path }, cwd);
    case 'web_search':
      return toolView('WebSearch', { query: input.query }, cwd);
    case 'web_extract':
    case 'browser_navigate':
      return toolView('WebFetch', { url: input.url }, cwd);
    case 'delegate_task':
      return toolView('Task', { description: input.description ?? input.goal, prompt: input.prompt }, cwd);
    case 'todowrite':
      return toolView('TodoWrite', { todos: input.todos }, cwd);
    case 'todoread':
      return toolView('TaskList', {}, cwd);
    case 'skill':
      return toolView('Skill', { skill: input.name ?? input.id }, cwd);
    case 'question':
      return toolView('AskUserQuestion', { questions: input.questions }, cwd);
    default:
      return toolView(tool, input, cwd);
  }
}
