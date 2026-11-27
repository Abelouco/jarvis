// Like e deslike nas respostas (Fase 4 · etapa 3).
// - Like: fica verde, com um pulso curto. Clicar de novo tira.
// - Deslike: abre "o que não ficou bom?"; depois de enviado, fica vermelho (pulso curto) e mostra a lição
//   que o J.A.R.V.I.S. aprendeu ("Entendido, Senhor: ..."). Clicar de novo tira (a lição deixa de valer).
// O servidor (ia_conversar, corpo `feedback`) guarda a avaliação e escreve a lição.
import type { Message } from '@jarvis/core';
import { jarvis } from './jarvis';

type Avaliacao = 'like' | 'dislike';

const ICONE_LIKE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M7 10v11H3V10h4Zm0 0 4-7a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7"/></svg>';
const ICONE_DISLIKE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="transform:scaleY(-1)"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M7 10v11H3V10h4Zm0 0 4-7a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7"/></svg>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Liga as avaliações ao chat. `redesenhar` força o chat a se desenhar de novo. */
export function criarAvaliacao(redesenhar: () => void, avisarErro: (texto: string) => void) {
  const avaliacoes = new Map<string, Avaliacao>();
  const frases = new Map<string, string>(); // lição aprendida no deslike (mostrada embaixo)
  const animar = new Set<string>(); // pulso só no clique, não em todo redesenho
  let conversa: string | null = null;
  let motivoDe: string | null = null; // resposta com o campo do motivo aberto
  let rascunho = '';
  let enviando: string | null = null;
  let erro = '';
  let versao = 0;
  let focar: string | null = null; // campo do motivo a focar depois do próximo desenho

  const mudou = () => {
    versao++;
    redesenhar();
  };

  async function carregar(conversationId: string | null) {
    if (!conversationId || conversationId === conversa) return;
    conversa = conversationId;
    avaliacoes.clear();
    frases.clear();
    motivoDe = null;
    try {
      for (const [id, r] of await jarvis.feedback.daConversa(conversationId)) avaliacoes.set(id, r);
    } catch {
      /* sem rede: os botões aparecem vazios e funcionam quando a rede voltar */
    }
    mudou();
  }

  async function enviar(id: string, rating: Avaliacao | null, motivo?: string) {
    const antes = avaliacoes.get(id) ?? null;
    enviando = id;
    erro = '';
    // Mostra na hora (o servidor confirma em seguida).
    if (rating) avaliacoes.set(id, rating);
    else avaliacoes.delete(id);
    if (rating === 'like') animar.add(id);
    mudou();
    try {
      const r = await jarvis.feedback.avaliar(id, rating, motivo);
      if (r.frase) frases.set(id, r.frase);
      else frases.delete(id);
      if (rating === 'dislike') {
        animar.add(id);
        motivoDe = null;
        rascunho = '';
      }
    } catch (e) {
      if (antes) avaliacoes.set(id, antes);
      else avaliacoes.delete(id);
      erro = e instanceof Error ? e.message : String(e);
      if (motivoDe !== id) avisarErro(`Não consegui guardar a avaliação: ${erro}`);
    } finally {
      enviando = null;
      mudou();
      setTimeout(() => animar.delete(id), 700);
    }
  }

  return {
    carregar,
    /** Entra na assinatura do chat: mudou a avaliação, o chat se redesenha. */
    assinatura: () => `${conversa}:${versao}`,

    html(m: Message): string {
      const r = avaliacoes.get(m.id);
      const pulso = animar.has(m.id) ? ' pulso' : '';
      const ocupado = enviando === m.id ? ' disabled' : '';
      const botoes = `
        <button type="button" class="fb fb-like${r === 'like' ? ' ativa' + pulso : ''}" data-avaliar="like" data-msg="${m.id}"
          title="${r === 'like' ? 'Tirar o like' : 'Boa resposta'}"${ocupado}>${ICONE_LIKE}</button>
        <button type="button" class="fb fb-dislike${r === 'dislike' ? ' ativa' + pulso : ''}${motivoDe === m.id ? ' aberta' : ''}" data-avaliar="dislike" data-msg="${m.id}"
          title="${r === 'dislike' ? 'Tirar o deslike (a lição deixa de valer)' : 'Não ficou boa'}"${ocupado}>${ICONE_DISLIKE}</button>`;
      const campo = motivoDe === m.id ? `
        <form class="fb-motivo" data-motivo="${m.id}">
          <textarea name="motivo" rows="2" maxlength="1000" placeholder="O que não ficou bom? O J.A.R.V.I.S. vai aprender a não repetir.">${esc(rascunho)}</textarea>
          <div class="fb-motivo-acoes">
            ${erro ? `<span class="fb-erro">${esc(erro)}</span>` : ''}
            <button type="button" class="fb-cancelar" data-av-cancelar>Cancelar</button>
            <button type="submit" class="fb-enviar"${ocupado}>${enviando === m.id ? 'Aprendendo…' : 'Enviar'}</button>
          </div>
        </form>` : '';
      const frase = frases.get(m.id);
      const licao = frase && r === 'dislike' ? `<div class="fb-licao">${esc(frase)}</div>` : '';
      return botoes + campo + licao;
    },

    /** Mensagem com avaliação fica com os botões sempre visíveis. */
    avaliada: (id: string) => avaliacoes.has(id) || motivoDe === id,

    /** Clique no chat: true se era um botão daqui. */
    clique(alvo: HTMLElement): boolean {
      if (alvo.closest('[data-av-cancelar]')) {
        motivoDe = null;
        rascunho = '';
        erro = '';
        mudou();
        return true;
      }
      const b = alvo.closest<HTMLButtonElement>('[data-avaliar]');
      if (!b || b.disabled) return !!alvo.closest('.fb-motivo');
      const id = b.dataset.msg!;
      const atual = avaliacoes.get(id);
      if (b.dataset.avaliar === 'like') {
        motivoDe = null;
        void enviar(id, atual === 'like' ? null : 'like');
      } else if (atual === 'dislike') {
        void enviar(id, null); // desfaz o deslike
      } else {
        motivoDe = motivoDe === id ? null : id;
        rascunho = '';
        erro = '';
        focar = id;
        mudou();
      }
      return true;
    },

    /** Depois de o chat se desenhar: foca o campo do motivo recém-aberto. */
    depoisDeDesenhar() {
      if (!focar) return;
      const t = document.querySelector<HTMLTextAreaElement>(`[data-motivo="${focar}"] textarea`);
      if (t) {
        t.focus();
        focar = null;
      }
    },

    /** Liga o envio e o rascunho do campo do motivo (delegado no chat). */
    ligar(chat: HTMLElement) {
      chat.addEventListener('input', (e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLTextAreaElement && t.closest('.fb-motivo')) rascunho = t.value;
      });
      chat.addEventListener('submit', (e) => {
        const f = (e.target as HTMLElement).closest<HTMLFormElement>('.fb-motivo');
        if (!f) return;
        e.preventDefault();
        const motivo = rascunho.trim();
        if (motivo.length < 3) {
          f.querySelector('textarea')?.focus();
          return;
        }
        void enviar(f.dataset.motivo!, 'dislike', motivo);
      });
      chat.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        if (!(t instanceof HTMLTextAreaElement) || !t.closest('.fb-motivo')) return;
        // Enter envia; Shift+Enter quebra a linha; Esc fecha.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          t.closest('form')?.requestSubmit();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          motivoDe = null;
          rascunho = '';
          mudou();
        }
      });
    },
  };
}
