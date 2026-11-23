import { describe, expect, it } from 'vitest';
import type { TerminalEntry } from '../../../shared/types';
import { parseTerminalEvent, providerLabel, repliesTo } from './bridge';

const user = (id: string, at: number, text: string): TerminalEntry => ({ kind: 'user', id, at, text });
const assistant = (id: string, at: number, text: string): TerminalEntry => ({ kind: 'assistant', id, at, text });
const tool = (id: string, at: number): TerminalEntry => ({ kind: 'tool', id, at, tool: 'Bash', title: 'Bash(ls)' });

const Q = { question: 'como ficou o teste?', sentAt: 10_000 };
const framed = 'Pergunta pelo roadmap r, item i:\ncomo ficou o teste?';

describe('repliesTo', () => {
  it('antes de a pergunta aparecer no terminal do agente, não há resposta nem entrega', () => {
    expect(repliesTo([assistant('a0', 9_000, 'conversa antiga')], Q)).toEqual({ delivered: false, replies: [] });
  });

  it('a pergunta apareceu e o agente ainda não respondeu', () => {
    expect(repliesTo([user('u1', 10_500, framed)], Q)).toEqual({ delivered: true, replies: [] });
  });

  it('junta as respostas do agente depois da pergunta, ignorando ferramentas', () => {
    const entries = [user('u1', 10_500, framed), tool('t1', 10_600), assistant('a1', 11_000, 'Vou ver.'), assistant('a2', 12_000, 'Passou.')];
    expect(repliesTo(entries, Q)).toEqual({ delivered: true, replies: [{ id: 'a1', text: 'Vou ver.', at: 11_000 }, { id: 'a2', text: 'Passou.', at: 12_000 }] });
  });

  it('para na próxima mensagem do usuário: o que vem depois é de outra conversa', () => {
    const entries = [user('u1', 10_500, framed), assistant('a1', 11_000, 'Passou.'), user('u2', 13_000, 'outra coisa'), assistant('a2', 14_000, 'resposta da outra')];
    expect(repliesTo(entries, Q).replies.map((r) => r.id)).toEqual(['a1']);
  });

  it('ignora a pergunta idêntica feita antes do envio (conversa antiga igual)', () => {
    const entries = [user('u0', 5_000, framed), assistant('a0', 6_000, 'resposta antiga'), user('u1', 10_500, framed), assistant('a1', 11_000, 'resposta nova')];
    expect(repliesTo(entries, Q).replies.map((r) => r.id)).toEqual(['a1']);
  });

  it('tolera o relógio do agente alguns segundos adiantado ou atrasado', () => {
    expect(repliesTo([user('u1', 8_000, framed)], Q).delivered).toBe(true);
    expect(repliesTo([user('u1', 3_000, framed)], Q).delivered).toBe(false);
  });

  it('é o texto da pergunta que identifica, não o cabeçalho (que muda com o idioma)', () => {
    const english = 'Question from the roadmap r, item i:\ncomo ficou o teste?';
    expect(repliesTo([user('u1', 10_500, english)], Q).delivered).toBe(true);
  });

  it('descarta respostas vazias', () => {
    expect(repliesTo([user('u1', 10_500, framed), assistant('a1', 11_000, '   ')], Q).replies).toEqual([]);
  });
});

describe('parseTerminalEvent', () => {
  it('lê as entradas de um init e de um append', () => {
    const entries = [user('u1', 1, 'oi'), assistant('a1', 2, 'olá')];
    expect(parseTerminalEvent(JSON.stringify({ agentId: 'x', entries, truncated: false }), 'init')).toEqual(entries);
    expect(parseTerminalEvent(JSON.stringify(entries), 'append')).toEqual(entries);
  });

  it('descarta lixo sem lançar: JSON inválido, formato errado e entradas sem texto', () => {
    expect(parseTerminalEvent('{nao e json', 'init')).toEqual([]);
    expect(parseTerminalEvent(JSON.stringify({ entries: 'x' }), 'init')).toEqual([]);
    expect(parseTerminalEvent(JSON.stringify({ kind: 'user' }), 'append')).toEqual([]);
    expect(parseTerminalEvent(JSON.stringify([{ kind: 'assistant', id: 'a', at: 1 }, { kind: 'user', id: 'u', at: 1, text: 'ok' }]), 'append')).toEqual([user('u', 1, 'ok')]);
    expect(parseTerminalEvent(undefined, 'init')).toEqual([]);
  });
});

describe('providerLabel', () => {
  it('dá o nome de exibição de todo provider do Habblaud, inclusive o Antigravity', () => {
    expect(providerLabel('claude')).toBe('Claude Code');
    expect(providerLabel('antigravity')).toBe('Antigravity');
    expect(providerLabel('codex')).toBe('Codex');
    expect(providerLabel('opencode')).toBe('OpenCode');
    expect(providerLabel('hermes')).toBe('Hermes');
  });
});
