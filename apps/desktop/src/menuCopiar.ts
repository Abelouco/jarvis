// Menu do clique direito no chat: destaca o trecho sob o mouse e oferece copiar
// a seleção, o trecho, o código ou a resposta inteira.
import { copiar } from './markdown';

interface Item {
  rotulo: string;
  texto: string;
}

let menu: HTMLDivElement | null = null;
let destacado: HTMLElement | null = null;

function fechar() {
  menu?.remove();
  menu = null;
  destacado?.classList.remove('md-destaque');
  destacado = null;
  removeEventListener('keydown', tecla, true);
  removeEventListener('mousedown', foraDoMenu, true);
  removeEventListener('blur', fechar);
}

const tecla = (e: KeyboardEvent) => {
  if (e.key === 'Escape') fechar();
};
const foraDoMenu = (e: MouseEvent) => {
  if (menu && !menu.contains(e.target as Node)) fechar();
};

/** Texto puro de um elemento, sem os botões (Copiar, Rodar...) que estão dentro dele. */
function textoDe(el: Element): string {
  const copia = el.cloneNode(true) as HTMLElement;
  copia.querySelectorAll('button, .md-cab').forEach((b) => b.remove());
  return (copia.innerText ?? copia.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Liga o menu no container do chat.
 * `respostaInteira(msg)` devolve o texto original (Markdown) de uma mensagem do assistente.
 */
export function ligarMenuCopiar(chat: HTMLElement, respostaInteira: (msg: HTMLElement) => string | undefined) {
  chat.addEventListener('contextmenu', (e) => {
    const alvo = e.target as HTMLElement;
    const msg = alvo.closest<HTMLElement>('.msg');
    if (!msg || msg.classList.contains('pensando')) return;
    e.preventDefault();
    fechar();

    const itens: Item[] = [];
    const selecao = getSelection()?.toString().trim();
    if (selecao) itens.push({ rotulo: 'Copiar seleção', texto: selecao });

    // Só o que está EM DESTAQUE, como no Claude: o trecho em caixinha (código inline) ou em
    // negrito sob o mouse. Nada de copiar o parágrafo inteiro.
    const realce = alvo.closest<HTMLElement>('code, strong');
    if (realce && !realce.closest('pre') && msg.contains(realce)) {
      const texto = (realce.textContent ?? '').trim();
      if (texto) {
        destacado = realce;
        itens.unshift({ rotulo: `Copiar “${texto.length > 40 ? `${texto.slice(0, 40)}…` : texto}”`, texto });
      }
    }

    const codigo = alvo.closest<HTMLElement>('.md-codigo, .md-comando');
    const cartaoTexto = alvo.closest<HTMLElement>('.md-texto');
    if (codigo) {
      destacado = codigo;
      itens.push({ rotulo: codigo.classList.contains('md-comando') ? 'Copiar comando' : 'Copiar código', texto: textoDe(codigo.querySelector('pre') ?? codigo) });
    } else if (cartaoTexto) {
      destacado = cartaoTexto;
      itens.push({ rotulo: 'Copiar texto do cartão', texto: textoDe(cartaoTexto.querySelector('.md-texto-corpo') ?? cartaoTexto) });
    }

    if (msg.dataset.r === 'assistant') {
      const inteira = respostaInteira(msg);
      if (inteira) itens.push({ rotulo: 'Copiar resposta inteira', texto: inteira });
    } else {
      itens.push({ rotulo: 'Copiar mensagem', texto: textoDe(msg) });
    }
    if (!itens.length) return;

    destacado?.classList.add('md-destaque');
    menu = document.createElement('div');
    menu.className = 'menu-copiar';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = itens.map((it, i) => `<button type="button" role="menuitem" data-i="${i}">${it.rotulo}</button>`).join('');
    document.body.appendChild(menu);

    // Posição: junto do mouse, sem sair da janela.
    const { innerWidth: lw, innerHeight: lh } = window;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(e.clientX, lw - r.width - 8)}px`;
    menu.style.top = `${Math.min(e.clientY, lh - r.height - 8)}px`;

    menu.onclick = async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!b) return;
      const item = itens[Number(b.dataset.i)];
      if (item) await copiar(item.texto);
      const alvoDestaque = destacado;
      fechar();
      // Confirma visualmente o que foi copiado.
      if (alvoDestaque) {
        alvoDestaque.classList.add('md-copiado');
        setTimeout(() => alvoDestaque.classList.remove('md-copiado'), 700);
      }
    };
    addEventListener('keydown', tecla, true);
    addEventListener('mousedown', foraDoMenu, true);
    addEventListener('blur', fechar);
    chat.closest('.principal')?.addEventListener('scroll', fechar, { once: true });
  });
}
