// Leitor de Markdown do chat, compartilhado entre PC e celular: transforma o texto da IA
// em blocos (títulos, listas, tabelas, código, citações) que cada app desenha do seu jeito.
// Sem dependências e sem HTML cru: nada do texto vira código na tela.
//
// Blocos especiais:
// - ```texto Título    (também "escrita", "copiar"): cartão com copiar e expandir.
// - ```powershell / ```cmd / ```bash ...: comando de terminal (no PC ganha o botão "Rodar").
// - ```opcoes Pergunta?  (uma opção por linha): cartão de escolha no fim da resposta.

export type Inline =
  | { t: 'txt'; v: string }
  | { t: 'neg'; f: Inline[] }
  | { t: 'ita'; f: Inline[] }
  | { t: 'risc'; f: Inline[] }
  | { t: 'cod'; v: string }
  | { t: 'link'; f: Inline[]; url: string }
  | { t: 'cita'; n: number }
  | { t: 'quebra' };

export type Alinhamento = 'e' | 'c' | 'd';

export interface ItemLista {
  f: Inline[];
  filhos: Bloco[];
  /** [ ] / [x] no começo do item */
  marcado?: boolean;
}

export type Bloco =
  | { t: 'titulo'; nivel: 1 | 2 | 3 | 4; f: Inline[] }
  | { t: 'par'; f: Inline[] }
  | { t: 'lista'; ordenada: boolean; inicio: number; itens: ItemLista[] }
  | { t: 'tabela'; cab: Inline[][]; alin: Alinhamento[]; linhas: Inline[][][] }
  | { t: 'codigo'; lang: string; texto: string }
  | { t: 'texto'; titulo: string; texto: string }
  | { t: 'comando'; shell: Shell; texto: string }
  | { t: 'opcoes'; pergunta: string; itens: string[] }
  | { t: 'citacao'; filhos: Bloco[] }
  | { t: 'linha' }
  | { t: 'imagem'; url: string; alt: string };

/** Onde o comando roda: no Windows, bash/sh também vão para o PowerShell. */
export type Shell = 'powershell' | 'cmd' | 'bash';

const LANG_TEXTO = /^(texto|escrita|copiar|text)$/i;
const LANG_OPCOES = /^(opcoes|opções|escolhas|opcao|opção)$/i;
const SHELLS: Record<string, Shell> = {
  powershell: 'powershell', ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  cmd: 'cmd', bat: 'cmd', batch: 'cmd',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
};
const RE_CERCA = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/;
const RE_TITULO = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_LINHA = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const RE_SEPARADOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RE_CITACAO = /^\s{0,3}>\s?(.*)$/;
const RE_IMAGEM = /^\s{0,3}!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)\s*$/;

const recuo = (l: string) => (l.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;
const vazia = (l: string) => !l.trim();

function celulas(linha: string): string[] {
  let s = linha.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function iniciaBloco(linhas: string[], i: number): boolean {
  const l = linhas[i]!;
  return RE_CERCA.test(l) || RE_TITULO.test(l) || RE_LINHA.test(l) || RE_ITEM.test(l) || RE_CITACAO.test(l)
    || RE_IMAGEM.test(l)
    || (l.includes('|') && i + 1 < linhas.length && RE_SEPARADOR.test(linhas[i + 1]!));
}

/** Texto para colar: sem marcas de negrito/itálico que a IA às vezes deixa escapar. */
function limparTexto(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^#{1,6}\s+/gm, '');
}

export function lerMarkdown(texto: string): Bloco[] {
  return blocos(texto.replace(/\r\n?/g, '\n').split('\n'));
}

function blocos(linhas: string[]): Bloco[] {
  const out: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i]!;
    if (vazia(l)) { i++; continue; }

    const imagem = l.match(RE_IMAGEM);
    if (imagem) {
      out.push({ t: 'imagem', alt: imagem[1] ?? '', url: imagem[2]! });
      i++;
      continue;
    }

    // ``` cerca de código (ou bloco para copiar). Se não fechar, vai até o fim.
    const cerca = l.match(RE_CERCA);
    if (cerca) {
      const marca = cerca[1]!;
      const lang = cerca[2] ?? '';
      const resto = (cerca[3] ?? '').trim();
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i]!.trim().startsWith(marca[0]!.repeat(3))) corpo.push(linhas[i++]!);
      i++;
      const conteudo = corpo.join('\n').replace(/\s+$/, '');
      const shell = SHELLS[lang.toLowerCase()];
      if (LANG_TEXTO.test(lang)) out.push({ t: 'texto', titulo: resto || 'Texto', texto: limparTexto(conteudo) });
      else if (LANG_OPCOES.test(lang)) {
        const itens = conteudo.split('\n')
          .map((l) => limparTexto(l.replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s*/, '')).trim())
          .filter(Boolean)
          .slice(0, 6);
        if (itens.length) out.push({ t: 'opcoes', pergunta: limparTexto(resto), itens });
      } else if (shell && conteudo.trim()) {
        // Tira o "$ " ou "> " de prompt que a IA às vezes põe na frente.
        out.push({ t: 'comando', shell, texto: conteudo.replace(/^\s*(?:\$|PS [^>]*>|>)\s+/gm, '') });
      } else out.push({ t: 'codigo', lang: lang.toLowerCase(), texto: conteudo });
      continue;
    }

    const titulo = l.match(RE_TITULO);
    if (titulo) {
      out.push({ t: 'titulo', nivel: Math.min(Math.max(titulo[1]!.length, 1), 4) as 1 | 2 | 3 | 4, f: lerInline(titulo[2]!) });
      i++;
      continue;
    }

    if (RE_LINHA.test(l)) { out.push({ t: 'linha' }); i++; continue; }

    // Tabela: linha com | seguida do separador |---|---|
    if (l.includes('|') && i + 1 < linhas.length && RE_SEPARADOR.test(linhas[i + 1]!)) {
      const cab = celulas(l);
      const alin: Alinhamento[] = celulas(linhas[i + 1]!).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'd' : 'e');
      i += 2;
      const linhasTab: Inline[][][] = [];
      while (i < linhas.length && linhas[i]!.includes('|') && !vazia(linhas[i]!)) {
        const cs = celulas(linhas[i]!);
        while (cs.length < cab.length) cs.push('');
        linhasTab.push(cs.slice(0, cab.length).map(lerInline));
        i++;
      }
      out.push({ t: 'tabela', cab: cab.map(lerInline), alin, linhas: linhasTab });
      continue;
    }

    if (RE_CITACAO.test(l)) {
      const dentro: string[] = [];
      while (i < linhas.length && (RE_CITACAO.test(linhas[i]!) || (!vazia(linhas[i]!) && !iniciaBloco(linhas, i)))) {
        const m = linhas[i]!.match(RE_CITACAO);
        dentro.push(m ? m[1]! : linhas[i]!);
        i++;
      }
      out.push({ t: 'citacao', filhos: blocos(dentro) });
      continue;
    }

    const item = l.match(RE_ITEM);
    if (item) {
      const r = lerLista(linhas, i);
      out.push(r.bloco);
      i = r.fim;
      continue;
    }

    // Parágrafo: junta as linhas (mantendo a quebra) até uma linha vazia ou outro bloco.
    const par: string[] = [l.trim()];
    i++;
    while (i < linhas.length && !vazia(linhas[i]!) && !iniciaBloco(linhas, i)) par.push(linhas[i++]!.trim());
    out.push({ t: 'par', f: lerInline(par.join('\n')) });
  }
  return out;
}

function lerLista(linhas: string[], inicio: number): { bloco: Bloco; fim: number } {
  const primeiro = linhas[inicio]!.match(RE_ITEM)!;
  const base = recuo(linhas[inicio]!);
  const ordenada = /\d/.test(primeiro[2]!);
  const itens: { texto: string; filhos: string[] }[] = [];
  let i = inicio;
  while (i < linhas.length) {
    const l = linhas[i]!;
    const m = l.match(RE_ITEM);
    if (m && recuo(l) <= base + 1) {
      if (/\d/.test(m[2]!) !== ordenada) break; // mudou de tipo: outra lista
      itens.push({ texto: m[3]!, filhos: [] });
      i++;
      continue;
    }
    if (vazia(l)) {
      // Linha vazia continua a lista só se a próxima for item ou estiver recuada.
      const prox = linhas[i + 1];
      if (prox !== undefined && (RE_ITEM.test(prox) && recuo(prox) <= base + 1 || recuo(prox) > base + 1)) {
        itens.at(-1)!.filhos.push('');
        i++;
        continue;
      }
      break;
    }
    if (recuo(l) > base + 1) {
      itens.at(-1)!.filhos.push(l);
      i++;
      continue;
    }
    // Linha "preguiçosa" (continuação do item sem recuo)
    if (!iniciaBloco(linhas, i)) {
      itens.at(-1)!.texto += '\n' + l.trim();
      i++;
      continue;
    }
    break;
  }
  const n = Number.parseInt(primeiro[2]!, 10);
  return {
    fim: i,
    bloco: {
      t: 'lista',
      ordenada,
      inicio: ordenada && Number.isFinite(n) ? n : 1,
      itens: itens.map((it) => {
        const marca = it.texto.match(/^\[( |x|X)\]\s+(.*)$/s);
        const filhosTxt = it.filhos.join('\n');
        const menor = Math.min(...it.filhos.filter((f) => !vazia(f)).map(recuo));
        const dedent = it.filhos.map((f) => f.slice(Number.isFinite(menor) ? Math.min(menor, recuo(f)) : 0));
        return {
          f: lerInline(marca ? marca[2]! : it.texto),
          marcado: marca ? marca[1] !== ' ' : undefined,
          filhos: filhosTxt.trim() ? blocos(dedent) : [],
        };
      }),
    },
  };
}

/** Negrito, itálico, riscado, `código`, [links](https://...) e quebras de linha. */
export function lerInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const soltar = () => {
    if (buf) out.push({ t: 'txt', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && /[\\`*_~[\]()#|>-]/.test(s[i + 1]!)) { buf += s[i + 1]; i += 2; continue; }
    if (c === '\n') { soltar(); out.push({ t: 'quebra' }); i++; continue; }
    if (c === '`') {
      const fim = s.indexOf('`', i + 1);
      if (fim > i + 1) { soltar(); out.push({ t: 'cod', v: s.slice(i + 1, fim) }); i = fim + 1; continue; }
    }
    const dois = s.slice(i, i + 2);
    if (dois === '**' || dois === '__' || dois === '~~') {
      const fim = s.indexOf(dois, i + 2);
      if (fim > i + 2) {
        soltar();
        const f = lerInline(s.slice(i + 2, fim));
        out.push(dois === '~~' ? { t: 'risc', f } : { t: 'neg', f });
        i = fim + 2;
        continue;
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] !== c && s[i + 1] !== ' ') {
      const antes = s[i - 1];
      const podeAbrir = c === '*' || !antes || !/[\p{L}\p{N}]/u.test(antes);
      let fim = podeAbrir ? s.indexOf(c, i + 1) : -1;
      while (fim > 0 && (s[fim - 1] === ' ' || s[fim + 1] === c)) fim = s.indexOf(c, fim + 2);
      if (fim > i + 1 && (c === '*' || !s[fim + 1] || !/[\p{L}\p{N}]/u.test(s[fim + 1]!))) {
        soltar();
        out.push({ t: 'ita', f: lerInline(s.slice(i + 1, fim)) });
        i = fim + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = s.slice(i).match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (m) { soltar(); out.push({ t: 'link', f: lerInline(m[1]!), url: m[2]! }); i += m[0].length; continue; }
      // Citação de fonte da pesquisa: [1], [2]...
      const cita = s.slice(i).match(/^\[(\d{1,2})\](?!\()/);
      if (cita) { soltar(); out.push({ t: 'cita', n: Number(cita[1]) }); i += cita[0].length; continue; }
    }
    buf += c;
    i++;
  }
  soltar();
  return out;
}

/** Texto puro de um trecho (para copiar, acessibilidade etc.). */
export function textoPuro(f: Inline[]): string {
  return f.map((x) => {
    switch (x.t) {
      case 'txt': case 'cod': return x.v;
      case 'cita': return `[${x.n}]`;
      case 'quebra': return '\n';
      case 'link': return textoPuro(x.f);
      default: return textoPuro(x.f);
    }
  }).join('');
}

/** Texto falado de um trecho: sem citações [n] nem marcas. */
function falaInline(f: Inline[]): string {
  return f.map((x) => {
    switch (x.t) {
      case 'txt': case 'cod': return x.v;
      case 'cita': return '';
      case 'quebra': return ' ';
      default: return falaInline(x.f);
    }
  }).join('').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

function falaBloco(b: Bloco, partes: string[]) {
  switch (b.t) {
    case 'titulo': case 'par': {
      const t = falaInline(b.f);
      if (t) partes.push(/[.!?:;]$/.test(t) ? t : `${t}.`);
      break;
    }
    case 'lista':
      b.itens.forEach((it, i) => {
        const t = falaInline(it.f);
        if (t) partes.push(`${b.ordenada ? `${b.inicio + i}. ` : ''}${/[.!?:;]$/.test(t) ? t : `${t}.`}`);
        it.filhos.forEach((f) => falaBloco(f, partes));
      });
      break;
    case 'citacao': b.filhos.forEach((f) => falaBloco(f, partes)); break;
    case 'tabela': partes.push('Deixei uma tabela na tela.'); break;
    case 'codigo': partes.push('Deixei o código na tela.'); break;
    case 'comando': partes.push('Deixei o comando na tela, pronto para rodar.'); break;
    case 'texto': partes.push(`O texto "${b.titulo}" está pronto na tela para copiar.`); break;
    case 'opcoes':
      partes.push(`${b.pergunta || 'Escolha uma opção.'} ${b.itens.map((x, i) => `${i + 1}: ${x}`).join('; ')}.`);
      break;
    case 'imagem': partes.push('Deixei a imagem na tela.'); break;
    case 'linha': break;
  }
}

/**
 * Transforma uma resposta em texto para ler em voz alta: tira Markdown, citações e links;
 * troca tabelas, código e cartões por um aviso curto ("Deixei ... na tela").
 */
export function paraFala(texto: string): string {
  const partes: string[] = [];
  lerMarkdown(texto).forEach((b) => falaBloco(b, partes));
  // Avisos iguais em sequência viram um só.
  return partes.filter((p, i) => p !== partes[i - 1]).join(' ').replace(/\s+/g, ' ').trim();
}
