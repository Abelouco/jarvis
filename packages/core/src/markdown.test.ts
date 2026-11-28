// Rodar: node --test packages/core/src/markdown.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerInline, lerMarkdown, paraFala } from './markdown.ts';

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

test('citações de fonte [n]', () => {
  const f = lerInline('Use madeira [1][3] e corda.');
  assert.deepEqual(f.map((x) => x.t), ['txt', 'cita', 'cita', 'txt']);
});

test('texto para fala: sem marcas, citações e com avisos', () => {
  const t = paraFala('## Vara de pesca\n\nUse **madeira** [1].\n\n1. Abra o menu\n2. Clique em `Criar`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```powershell\nnode -v\n```');
  assert.equal(t, 'Vara de pesca. Use madeira. 1. Abra o menu. 2. Clique em Criar. Deixei uma tabela na tela. Deixei o comando na tela, pronto para rodar.');
});

test('citação', () => {
  const b = lerMarkdown('> **Atenção:** confira o saldo\n> antes de pagar');
  assert.equal(b[0]!.t, 'citacao');
});

test('linha só com imagem https vira bloco; outro esquema continua texto', () => {
  const b = lerMarkdown('![mapa](https://x.com/a.jpg)');
  assert.deepEqual(b[0], { t: 'imagem', url: 'https://x.com/a.jpg', alt: 'mapa' });
  const ruim = lerMarkdown('![x](javascript:alert(1))');
  assert.equal(ruim[0]!.t, 'par');
});

// ---------- chat: resposta que chegou depois do "Parar" ----------
import { respostasDepoisDoParar } from './chatRegras.ts';

test('chat: resposta que chegou depois do Parar some; a de ação fica', () => {
  const u = (id: string) => ({ id, role: 'user' as const });
  const a = (id: string, route: string | null = 'rapido') => ({ id, role: 'assistant' as const, route });
  assert.deepEqual(respostasDepoisDoParar([u('1'), a('p', 'interrompido'), a('r', 'pesquisa'), u('2'), a('ok')]), ['r']);
  assert.deepEqual(respostasDepoisDoParar([u('1'), a('r', 'pesquisa'), a('p', 'interrompido')]), ['r']);
  assert.deepEqual(respostasDepoisDoParar([u('1'), a('p', 'interrompido'), a('x', 'acao')]), []);
  assert.deepEqual(respostasDepoisDoParar([u('1'), a('r'), u('2'), a('s')]), []);
});
