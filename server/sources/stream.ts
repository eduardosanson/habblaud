// Conversa ao vivo de uma ferramenta que não grava transcript em arquivo (o OpenCode fala HTTP): o terminal
// pergunta ao stream a conversa recente (load) e, depois, só o que apareceu de novo (poll).
//
// Os dois métodos são assíncronos de propósito: o terminal do Claude Code/Codex continua lendo arquivo de forma
// síncrona (TranscriptSource), e uma fonte remota entra no mesmo lugar sem mudar o protocolo SSE do navegador.
import type { TerminalEntry, TerminalInit } from '../../shared/types';

/** O que mudou desde o último ciclo do terminal. */
export interface MessageDelta {
  /** Substitui tudo o que o cliente tem (o stream foi truncado/substituído). */
  init?: TerminalInit;
  /** Entradas novas, da mais antiga para a mais recente. */
  append?: TerminalEntry[];
}

/** Uma conversa ao vivo, aberta por UMA conexão de terminal (estado próprio, como o parser de arquivo). */
export interface MessageStream {
  /** Intervalo de polling que o terminal deve usar; ausente = o padrão do modo (agente ou sessão do histórico). */
  readonly intervalMs?: number;
  /** Conversa recente: já vem limitada ao que o `init` do terminal mostra. */
  load(): Promise<TerminalInit>;
  /** Só o que apareceu desde o load/poll anterior. */
  poll(): Promise<MessageDelta>;
}
