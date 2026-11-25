import { describe, expect, it } from 'vitest';
import { loadConversation, saveConversation, type KeyValue } from './conversation-store';
import type { ChatMessage } from './state';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const message = (id: string): ChatMessage => ({ id, role: 'user', text: `pergunta ${id}`, at: '25/11' });

describe('histórico da conversa', () => {
  it('volta depois de recarregar a página, separado por item', () => {
    const store = memory();
    saveConversation(store, 'r:a', [message('1')]);
    saveConversation(store, 'r:b', [message('2')]);
    expect(loadConversation(store, 'r:a')).toEqual([message('1')]);
    expect(loadConversation(store, 'r:b')).toEqual([message('2')]);
  });

  it('guarda só as últimas 50 mensagens', () => {
    const store = memory();
    saveConversation(store, 'r:a', Array.from({ length: 60 }, (_, i) => message(String(i))));
    const kept = loadConversation(store, 'r:a');
    expect(kept).toHaveLength(50);
    expect(kept[0]!.id).toBe('10');
  });

  it('conversa vazia apaga o que estava guardado', () => {
    const store = memory();
    saveConversation(store, 'r:a', [message('1')]);
    saveConversation(store, 'r:a', []);
    expect(store.data.size).toBe(0);
  });

  it('armazenamento indisponível, cheio ou corrompido não derruba a gaveta', () => {
    const broken: KeyValue = { getItem: () => { throw new Error('negado'); }, setItem: () => { throw new Error('cheio'); }, removeItem: () => {} };
    expect(() => saveConversation(broken, 'r:a', [message('1')])).not.toThrow();
    expect(loadConversation(broken, 'r:a')).toEqual([]);
    expect(loadConversation(undefined, 'r:a')).toEqual([]);
    const store = memory();
    store.setItem('habblaud:roadmap-chat:r:a', '{"nao":"lista"}');
    expect(loadConversation(store, 'r:a')).toEqual([]);
  });
});
