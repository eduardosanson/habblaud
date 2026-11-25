// Histórico da gaveta no navegador: recarregar a página não pode sumir com a pergunta feita. Um item, uma conversa;
// o armazenamento pode faltar, estar cheio ou corrompido, e nada disso derruba a gaveta.
import type { ChatMessage } from './state';

export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'habblaud:roadmap-chat:';
const KEEP = 50;

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === 'string' && (m.role === 'user' || m.role === 'agent') && typeof m.text === 'string' && typeof m.at === 'string';
}

export function loadConversation(store: KeyValue | undefined, key: string): ChatMessage[] {
  try {
    const list: unknown = JSON.parse(store?.getItem(PREFIX + key) ?? '[]');
    return Array.isArray(list) ? list.filter(isMessage) : [];
  } catch {
    return [];
  }
}

export function saveConversation(store: KeyValue | undefined, key: string, messages: readonly ChatMessage[]): void {
  try {
    if (messages.length === 0) store?.removeItem(PREFIX + key);
    else store?.setItem(PREFIX + key, JSON.stringify(messages.slice(-KEEP)));
  } catch {
    // sem espaço ou sem permissão: a conversa segue só na memória
  }
}
