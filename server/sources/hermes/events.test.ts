// Traduções puras dos eventos do Hermes: timestamp, preview mascarado, atividade por ferramenta, tokens e id de uso.
import { describe, expect, it } from 'vitest';
import { eventAt, hermesActivity, hermesPreview, hermesTokens, hermesUsageId, hermesToolName } from './events';

const TOKEN = ['sk', 'ant', 'api03', 'testeFALSO0123456789abcdefXYZ'].join('-');

describe('eventos do Hermes: campos', () => {
  it('ts em segundos vira ms; ts em ms fica; sem ts usa o relógio de quem chamou', () => {
    expect(eventAt({ ts: 1_790_000_000 }, 5)).toBe(1_790_000_000_000);
    expect(eventAt({ ts: 1_790_000_000_123 }, 5)).toBe(1_790_000_000_123);
    expect(eventAt({}, 42)).toBe(42);
  });

  it('preview é uma linha, mascarado e cortado; tool name é cortado', () => {
    const p = hermesPreview(`echo ${TOKEN}\nsegunda linha`);
    expect(p).toContain('***');
    expect(p).not.toContain(TOKEN);
    expect(p).not.toContain('\n');
    expect(hermesPreview('x'.repeat(500))).toHaveLength(200);
    expect(hermesToolName({ tool_name: 'a'.repeat(200) })).toHaveLength(80);
  });
});

describe('eventos do Hermes: atividade', () => {
  it('terminal vira comando; arquivo vira Read/Write/Edit; busca, web e delegação também', () => {
    expect(hermesActivity('terminal', 'npm test')).toMatchObject({ kind: 'test', text: 'Rodando testes' });
    expect(hermesActivity('read_file', '/p/loja/app.ts')).toMatchObject({ kind: 'read', text: 'Lendo app.ts' });
    expect(hermesActivity('write_file', '/p/loja/novo.ts')).toMatchObject({ kind: 'write', text: 'Escrevendo novo.ts' });
    expect(hermesActivity('patch', '/p/loja/app.ts')).toMatchObject({ kind: 'edit', text: 'Editando app.ts' });
    expect(hermesActivity('search_files', 'carrinho')).toMatchObject({ kind: 'search' });
    expect(hermesActivity('web_search', 'pix art')).toMatchObject({ kind: 'web' });
    expect(hermesActivity('delegate_task', 'Revisar a loja')).toMatchObject({ kind: 'delegate', text: 'Delegando: Revisar a loja' });
    expect(hermesActivity('ferramenta_estranha', 'x')).toMatchObject({ kind: 'other', text: 'Usando ferramenta_estranha' });
  });

  it('browser tem atividades próprias', () => {
    expect(hermesActivity('browser_click', 'Comprar')).toMatchObject({ kind: 'browser', icon: '🖱️' });
    expect(hermesActivity('browser_snapshot', '')).toMatchObject({ kind: 'browser', icon: '📸' });
  });
});

describe('eventos do Hermes: uso', () => {
  it('prompt/input é inclusivo; cache e raciocínio não são somados de novo', () => {
    expect(
      hermesTokens({ usage: { input_tokens: 35, prompt_tokens: 100, output_tokens: 8, cache_read_tokens: 20, cache_write_tokens: 10, reasoning_tokens: 3 } }),
    ).toEqual({ input: 35, output: 8 });
    expect(hermesTokens({ usage: { prompt_tokens: 100, output_tokens: 8 } })).toEqual({ input: 100, output: 8 });
    // O plugin manda os campos já normalizados no próprio evento.
    expect(hermesTokens({ input_tokens: 35, output_tokens: 8, cached_input_tokens: 20 })).toEqual({ input: 35, output: 8 });
    expect(hermesTokens({ usage: { total_tokens: 100 } })).toBeUndefined();
    expect(hermesTokens({})).toBeUndefined();
  });

  it('id de uso usa usage_id/api_request_id e cai para sessão + tentativa', () => {
    expect(hermesUsageId({ usage_id: 'u1' })).toBe('u1');
    expect(hermesUsageId({ api_request_id: 'a1' })).toBe('a1');
    expect(hermesUsageId({ session_id: 's', started_at: 10, api_call_count: 2 })).toBe('s:10:2');
    expect(hermesUsageId({})).toBeUndefined();
  });
});
