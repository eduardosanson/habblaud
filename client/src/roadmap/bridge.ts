// Resposta do agente à pergunta do roadmap, lida do terminal da própria sessão.
//
// A pergunta entra na sessão do agente como se a pessoa a tivesse digitado (server/roadmap/converse.ts), e o terminal
// do Habblaud já transmite essa conversa. Aqui só se acha, no meio dela, a pergunta feita e o que o agente respondeu
// depois. O que identifica a pergunta é o TEXTO dela (o cabeçalho que o servidor põe antes muda com o idioma).
import type { Provider, TerminalEntry } from '../../../shared/types';

/** O relógio do agente pode diferir do desta página: a pergunta vale se apareceu até 5 s antes do envio. */
export const CLOCK_SKEW_MS = 5_000;

export interface AgentReply {
  id: string;
  text: string;
  at: number;
}

export interface Replies {
  /** A pergunta já apareceu na conversa do agente (a sessão a recebeu). */
  delivered: boolean;
  replies: AgentReply[];
}

/**
 * Respostas do agente à pergunta enviada em `sentAt`: os textos do agente (`assistant`) depois da pergunta, até a
 * próxima mensagem do usuário. Ferramentas, raciocínio e eventos não contam. Se houver perguntas iguais, vale a mais
 * recente que apareceu a partir do envio.
 */
export function repliesTo(entries: readonly TerminalEntry[], sent: { question: string; sentAt: number }): Replies {
  const question = sent.question.trim();
  let start = -1;
  if (question) {
    entries.forEach((entry, index) => {
      if (entry.kind === 'user' && entry.at >= sent.sentAt - CLOCK_SKEW_MS && entry.text.includes(question)) start = index;
    });
  }
  if (start < 0) return { delivered: false, replies: [] };
  const replies: AgentReply[] = [];
  for (const entry of entries.slice(start + 1)) {
    if (entry.kind === 'user') break;
    if (entry.kind === 'assistant' && entry.text.trim()) replies.push({ id: entry.id, text: entry.text, at: entry.at });
  }
  return { delivered: true, replies };
}

type ConversationEntry = Extract<TerminalEntry, { kind: 'user' | 'assistant' }>;

function isConversationEntry(value: unknown): value is ConversationEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (e.kind === 'user' || e.kind === 'assistant') && typeof e.id === 'string' && typeof e.at === 'number' && Number.isFinite(e.at) && typeof e.text === 'string';
}

/**
 * Lê um evento `init` (`{entries}`) ou `append` (lista) do stream do terminal do agente e devolve só a conversa
 * (usuário e agente). Dado inválido vira lista vazia: um frame ruim nunca derruba a gaveta.
 */
export function parseTerminalEvent(data: unknown, event: 'init' | 'append'): TerminalEntry[] {
  if (typeof data !== 'string') return [];
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return [];
  }
  const list = event === 'init' ? (json && typeof json === 'object' ? (json as { entries?: unknown }).entries : undefined) : json;
  return Array.isArray(list) ? list.filter(isConversationEntry) : [];
}

/** Situação de uma mensagem na fila do escritório (GET /api/messages/:id). */
export interface DeliveryState {
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  error?: string;
}

/** Leituras até desistir: o servidor resolve a mensagem em bem menos que isso. */
export const DELIVERY_ATTEMPTS = 120;

/**
 * Acompanha a mensagem até a fila resolvê-la. `null` = não há o que afirmar (conversa trocada, mensagem desconhecida
 * ou sem desfecho); falha de leitura não é falha de entrega.
 */
export async function awaitDelivery(
  read: () => Promise<DeliveryState | null>,
  wait: () => Promise<void>,
  alive: () => boolean,
): Promise<{ ok: true } | { ok: false; reason?: string } | null> {
  for (let attempt = 0; attempt < DELIVERY_ATTEMPTS && alive(); attempt += 1) {
    let state: DeliveryState | null;
    try {
      state = await read();
    } catch {
      await wait();
      continue;
    }
    if (!state) return null;
    if (state.status === 'delivered') return { ok: true };
    if (state.status === 'failed') return { ok: false, ...(state.error ? { reason: state.error } : {}) };
    await wait();
  }
  return null;
}

const PROVIDER_LABEL: Readonly<Record<Provider, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  antigravity: 'Antigravity',
};

/** Nome de exibição do provider do agente que respondeu (a página do roadmap tem o próprio tipo, sem Antigravity). */
export function providerLabel(provider: Provider): string {
  return PROVIDER_LABEL[provider];
}
