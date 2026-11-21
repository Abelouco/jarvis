// Desenha as respostas da IA no PC a partir dos blocos do leitor de Markdown do core.
// Todo texto passa por `esc`: nada que a IA escreva vira HTML de verdade.
import { lerMarkdown, type Bloco, type Inline } from '@jarvis/core';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICONE_COPIAR = '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6"/><path d="M10.5 3.2V2.8A1.3 1.3 0 0 0 9.2 1.5H3a1.5 1.5 0 0 0-1.5 1.5v6.2A1.3 1.3 0 0 0 2.8 10.5h.4"/></svg>';
const ICONE_EXPANDIR = '<svg viewBox="0 0 16 16"><path d="M9.5 1.8h4.7v4.7M14.2 1.8 9 7M6.5 14.2H1.8V9.5M1.8 14.2 7 9"/></svg>';

/** Textos dos blocos copiáveis da tela atual (o botão guarda só o índice). */
export const textosCopiaveis: string[] = [];

function inline(f: Inline[]): string {
  return f.map((x) => {
    switch (x.t) {
      case 'txt': return esc(x.v);
      case 'quebra': return '<br>';
      case 'neg': return `<strong>${inline(x.f)}</strong>`;
      case 'ita': return `<em>${inline(x.f)}</em>`;
      case 'risc': return `<s>${inline(x.f)}</s>`;
      case 'cod': return `<code>${esc(x.v)}</code>`;
      case 'link': return `<a href="${esc(x.url)}" target="_blank" rel="noreferrer noopener">${inline(x.f)}</a>`;
    }
  }).join('');
}

function guardar(texto: string): number {
  textosCopiaveis.push(texto);
  return textosCopiaveis.length - 1;
}

function bloco(b: Bloco): string {
  switch (b.t) {
    case 'titulo':
      return `<h${b.nivel + 1} class="md-t${b.nivel}">${inline(b.f)}</h${b.nivel + 1}>`;
    case 'par':
      return `<p>${inline(b.f)}</p>`;
    case 'linha':
      return '<hr>';
    case 'citacao':
      return `<blockquote>${b.filhos.map(bloco).join('')}</blockquote>`;
    case 'lista': {
      const tag = b.ordenada ? 'ol' : 'ul';
      const inicio = b.ordenada && b.inicio !== 1 ? ` start="${b.inicio}"` : '';
      const itens = b.itens.map((it) => {
        const caixa = it.marcado === undefined ? '' : `<span class="md-caixa${it.marcado ? ' marcada' : ''}"></span>`;
        return `<li>${caixa}${inline(it.f)}${it.filhos.map(bloco).join('')}</li>`;
      }).join('');
      return `<${tag}${inicio}>${itens}</${tag}>`;
    }
    case 'tabela': {
      const al = (i: number) => (b.alin[i] === 'c' ? ' class="c"' : b.alin[i] === 'd' ? ' class="d"' : '');
      return `<div class="md-tabela"><table><thead><tr>${b.cab.map((c, i) => `<th${al(i)}>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${b.linhas.map((l) => `<tr>${l.map((c, i) => `<td${al(i)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    case 'codigo': {
      const n = guardar(b.texto);
      return `<div class="md-codigo"><div class="md-cab"><span>${esc(b.lang || 'código')}</span>`
        + `<button type="button" class="md-btn" data-copiar="${n}" title="Copiar">${ICONE_COPIAR}</button></div>`
        + `<pre><code>${esc(b.texto)}</code></pre></div>`;
    }
    case 'texto': {
      const n = guardar(b.texto);
      return `<div class="md-texto"><div class="md-cab"><span>${esc(b.titulo)}</span><span class="md-acoes">`
        + `<button type="button" class="md-btn" data-copiar="${n}" title="Copiar">${ICONE_COPIAR}</button>`
        + `<button type="button" class="md-btn" data-expandir="${n}" data-titulo="${esc(b.titulo)}" title="Expandir">${ICONE_EXPANDIR}</button>`
        + `</span></div><div class="md-texto-corpo">${b.texto.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div></div>`;
    }
  }
}

/** HTML de uma resposta da IA. */
export function respostaHtml(texto: string): string {
  return lerMarkdown(texto).map(bloco).join('');
}

/** Botão de copiar a resposta inteira (texto como a IA escreveu). */
export function botaoCopiarResposta(texto: string): string {
  const n = guardar(texto);
  return `<button type="button" class="md-btn md-copiar-tudo" data-copiar="${n}" title="Copiar a resposta inteira">${ICONE_COPIAR}<span>Copiar resposta</span></button>`;
}

export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sem a API de área de transferência: método antigo.
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Janela sobreposta para ler um texto longo, com copiar. Esc ou clique fora fecha. */
export function abrirExpandido(titulo: string, texto: string) {
  const fundo = document.createElement('div');
  fundo.className = 'md-sobreposto';
  fundo.innerHTML = `<div class="md-janela" role="dialog" aria-label="${esc(titulo)}">
    <div class="md-cab"><span>${esc(titulo)}</span><span class="md-acoes">
      <button type="button" class="md-btn" data-acao="copiar" title="Copiar">${ICONE_COPIAR}<span>Copiar</span></button>
      <button type="button" class="md-btn" data-acao="fechar" title="Fechar (Esc)">✕</button></span></div>
    <div class="md-texto-corpo">${texto.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>
  </div>`;
  const fechar = () => {
    fundo.remove();
    removeEventListener('keydown', tecla);
  };
  const tecla = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
  fundo.onclick = async (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo === fundo || alvo.closest('[data-acao="fechar"]')) fechar();
    const b = alvo.closest<HTMLButtonElement>('[data-acao="copiar"]');
    if (b && (await copiar(texto))) marcarCopiado(b);
  };
  addEventListener('keydown', tecla);
  document.body.appendChild(fundo);
}

export function marcarCopiado(b: HTMLElement) {
  b.classList.add('copiado');
  setTimeout(() => b.classList.remove('copiado'), 1400);
}
