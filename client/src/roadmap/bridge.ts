// Resposta do agente à pergunta do roadmap, lida do terminal da própria sessão.
//
// A pergunta entra na sessão do agente como se a pessoa a tivesse digitado (server/roadmap/converse.ts), e o terminal
// do Habblaud já transmite essa conversa. Aqui só se acha, no meio dela, a pergunta feita e o que o agente respondeu
// depois. O que identifica a pergunta é o TEXTO dela (o cabeçalho que o servidor põe antes muda com o idioma).
import type { TerminalEntry } from '../../../shared/types';

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
