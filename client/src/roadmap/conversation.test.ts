import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageEl } from './conversation';

// O Vitest roda em `node`: este `document` mínimo guarda só o que a montagem da mensagem usa.
class FakeNode {
  children: FakeNode[] = [];
  className = '';
  title = '';
  style = { setProperty: () => {} };
  private own = '';

  constructor(readonly tag: string) {}

  get textContent(): string {
    return this.own + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.own = value;
    this.children = [];
  }

  append(...nodes: Array<FakeNode | string>): void {
    for (const node of nodes) {
      if (typeof node === 'string') this.children.push(text(node));
      else if (node.tag === '#fragment') this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  setAttribute(): void {}
  removeAttribute(): void {}

  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function text(value: string): FakeNode {
  const node = new FakeNode('#text');
  node.textContent = value;
  return node;
}

function render(role: 'agent' | 'user', value: string): FakeNode {
  return messageEl({ id: 'm1', role, text: value, at: 'agora' }) as unknown as FakeNode;
}

const tags = (node: FakeNode) => node.all().map((child) => child.tag);

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: text,
    createDocumentFragment: () => new FakeNode('#fragment'),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('mensagem da gaveta do roadmap', () => {
  it('formata o Markdown da resposta do agente', () => {
    const el = render('agent', '**Feito.**\n\n- um item\n\n```ts\nconst a = 1;\n```');

    expect(tags(el)).toEqual(expect.arrayContaining(['strong', 'ul', 'li', 'pre']));
    expect(el.textContent).not.toContain('**');
    expect(el.textContent).not.toContain('```');
    expect(el.all().some((node) => node.className === 'ui-md')).toBe(true);
  });

  it('mostra HTML da resposta como texto, sem criar elementos nem links', () => {
    const el = render('agent', '<img src=x onerror=alert(1)> [site](javascript:alert)');

    expect(tags(el)).not.toContain('img');
    expect(tags(el)).not.toContain('a');
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('mantém a pergunta da pessoa como foi digitada', () => {
    const el = render('user', 'o que é **isto**?');

    expect(tags(el)).not.toContain('strong');
    expect(el.textContent).toContain('o que é **isto**?');
  });
});
