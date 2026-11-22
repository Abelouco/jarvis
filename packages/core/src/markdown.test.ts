// Rodar: node --test packages/core/src/markdown.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerInline, lerMarkdown } from './markdown.ts';

test('títulos, parágrafos e linha', () => {
  const b = lerMarkdown('## 1. Visão geral\n\nTexto normal\ncontinua\n\n---\n#### Fim');
  assert.deepEqual(b.map((x) => x.t), ['titulo', 'par', 'linha', 'titulo']);
  assert.equal(b[0]!.t === 'titulo' && b[0]!.nivel, 2);
});

test('inline: negrito, itálico, código, link, riscado', () => {
  const f = lerInline('**Prós** e *contras*, `npm i` e [docs](https://x.dev) ~~não~~');
  assert.deepEqual(f.map((x) => x.t), ['neg', 'txt', 'ita', 'txt', 'cod', 'txt', 'link', 'txt', 'risc']);
  // snake_case não vira itálico
  assert.deepEqual(lerInline('use dominio_verbo_aqui').map((x) => x.t), ['txt']);
});

test('listas numeradas e com marcadores, com subitens', () => {
  const b = lerMarkdown('1. **Automação** – scripts\n2. Prototipagem\n   - REPL\n   - menos código\n3. Fim');
  assert.equal(b.length, 1);
  const l = b[0]!;
  assert.ok(l.t === 'lista' && l.ordenada && l.itens.length === 3);
  assert.ok(l.t === 'lista' && l.itens[1]!.filhos[0]!.t === 'lista');
});

test('tabela com cabeçalho e alinhamento', () => {
  const b = lerMarkdown('| Indicador | Efeito |\n|---|:---:|\n| Receita | +R$ 4 bi |\n| Classe média | Apoio leve |');
  const t = b[0]!;
  assert.ok(t.t === 'tabela');
  if (t.t === 'tabela') {
    assert.equal(t.cab.length, 2);
    assert.equal(t.linhas.length, 2);
    assert.deepEqual(t.alin, ['e', 'c']);
  }
});

test('código e bloco para copiar', () => {
  const b = lerMarkdown('```python\nprint(1)\n```\n\n```texto E-mail ao cliente\nOlá, tudo bem?\n\nAbraço\n```');
  assert.deepEqual(b[0], { t: 'codigo', lang: 'python', texto: 'print(1)' });
  assert.deepEqual(b[1], { t: 'texto', titulo: 'E-mail ao cliente', texto: 'Olá, tudo bem?\n\nAbraço' });
});

test('cartão de texto sai limpo para colar', () => {
  const b = lerMarkdown('```texto Convite\nChurrasco no **sábado**, às **13h**.\n```');
  assert.deepEqual(b[0], { t: 'texto', titulo: 'Convite', texto: 'Churrasco no sábado, às 13h.' });
});

test('comandos de terminal', () => {
  const b = lerMarkdown('```powershell\nPS C:\\> Get-Date\n```\n```bash\n$ npm install\n```\n```cmd\ndir\n```');
  assert.deepEqual(b, [
    { t: 'comando', shell: 'powershell', texto: 'Get-Date' },
    { t: 'comando', shell: 'bash', texto: 'npm install' },
    { t: 'comando', shell: 'cmd', texto: 'dir' },
  ]);
});

test('cartão de opções', () => {
  const b = lerMarkdown('Feito.\n\n```opcoes O que fazemos agora?\n- Montar o plano da semana\n- **Ver** os exercícios\n3. Parar por hoje\n```');
  assert.deepEqual(b[1], {
    t: 'opcoes', pergunta: 'O que fazemos agora?',
    itens: ['Montar o plano da semana', 'Ver os exercícios', 'Parar por hoje'],
  });
});

test('cerca sem fechar (resposta cortada) não quebra', () => {
  const b = lerMarkdown('Veja:\n```python\nprint(1)');
  assert.deepEqual(b.map((x) => x.t), ['par', 'codigo']);
});

test('citação', () => {
  const b = lerMarkdown('> **Atenção:** confira o saldo\n> antes de pagar');
  assert.equal(b[0]!.t, 'citacao');
});
