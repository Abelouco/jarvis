// Aba Projetos (Fase 2 · Etapa 3): lista com progresso e, ao abrir um projeto, o quadro
// (A fazer / Fazendo / Feito). Tudo no banco local; o sync leva para o Supabase e a IA vê igual.
// Sem arrastar-e-soltar: no Windows o Tauri intercepta o "drag" da janela; as setas movem entre colunas.
import { hojeSP, somarDias, type ProjetoResumo, type StatusProjeto, type Task } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const NOME_STATUS: Record<StatusProjeto, string> = {
  em_andamento: 'Em andamento', planejamento: 'Planejamento', pausado: 'Pausado', concluido: 'Concluído',
};
const STATUS = Object.keys(NOME_STATUS) as StatusProjeto[];
type Coluna = 'a_fazer' | 'fazendo' | 'feito';
const COLUNAS: [Coluna, string][] = [['a_fazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feito', 'Feito']];

function rotuloData(data: string) {
  const hoje = hojeSP();
  if (data === hoje) return 'hoje';
  if (data === somarDias(hoje, 1)) return 'amanhã';
  if (data === somarDias(hoje, -1)) return 'ontem';
  const [, m, d] = data.split('-');
  return `${CURTO[new Date(`${data}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
}
const pct = (f: number, t: number) => (t ? Math.round((f / t) * 100) : 0);
const colunaDe = (t: Task): Coluna => (t.done_at ? 'feito' : t.board_column === 'fazendo' ? 'fazendo' : 'a_fazer');

export function htmlProjetos() {
  return `
    <div id="proj-lista">
      <form class="nova form-tarefa" id="novo-projeto" autocomplete="off">
        <div class="nova-linha">
          <input name="nome" placeholder="Novo projeto (ex.: Reformar o quarto)" maxlength="200" />
          <button class="adicionar" title="Criar (Enter)">+</button>
        </div>
        <div class="nova-detalhes">
          <div class="ft-campo">
            <span class="rotulo">Prazo</span>
            <input type="date" name="prazo" title="Prazo (opcional)" />
          </div>
          <div class="ft-campo">
            <span class="rotulo">Descrição</span>
            <textarea name="descricao" rows="2" placeholder="O objetivo, em uma frase (opcional)"></textarea>
          </div>
          <div class="nova-acoes">
            <span class="previa"></span>
            <button type="button" class="cancelar">Cancelar</button>
            <button type="submit" class="salvar">Criar projeto</button>
          </div>
        </div>
      </form>
      <p class="dica-tarefas">Ou peça na conversa: <em>"cria o projeto Lançar o app"</em>,
        <em>"põe a tarefa comprar tinta no projeto reforma"</em>, <em>"como está o projeto reforma?"</em></p>
      <div id="projetos"></div>
    </div>
    <div id="proj-detalhe" hidden></div>`;
}

export function ligarProjetos(raiz: HTMLElement, op: { pulsar?: () => void } = {}) {
  const lista = raiz.querySelector<HTMLDivElement>('#proj-lista')!;
  const detalhe = raiz.querySelector<HTMLDivElement>('#proj-detalhe')!;
  const form = raiz.querySelector<HTMLFormElement>('#novo-projeto')!;
  const caixa = raiz.querySelector<HTMLDivElement>('#projetos')!;
  let aberto: string | null = null;
  let editandoInfo = false;

  // ---------- novo projeto ----------
  const limpar = () => {
    form.reset();
    form.classList.remove('aberta');
  };
  form.addEventListener('focusin', () => form.classList.add('aberta'));
  form.querySelector<HTMLButtonElement>('.cancelar')!.onclick = limpar;
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      limpar();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nome = (form.nome as HTMLInputElement).value.trim();
    if (!nome) return (form.nome as HTMLInputElement).focus();
    const id = await jarvis.projetos.criar(nome, {
      prazo: (form.prazo as HTMLInputElement).value || null,
      descricao: (form.descricao as HTMLTextAreaElement).value,
    });
    op.pulsar?.();
    limpar();
    abrir(id);
  };

  // ---------- lista ----------
  function cartao(p: ProjetoResumo) {
    const atrasado = p.due_date && p.due_date < hojeSP() && p.status !== 'concluido';
    const progresso = pct(p.feitas, p.total);
    const info = [
      p.total ? `${p.feitas}/${p.total} tarefas` : 'sem tarefas',
      p.due_date ? `<span class="${atrasado ? 'atrasada' : ''}">prazo ${rotuloData(p.due_date)}</span>` : '',
    ].filter(Boolean).join(' · ');
    return `<li class="projeto" data-id="${p.id}" data-s="${p.status}" data-p="${p.priority}">
      <div class="proj-topo">
        <span class="proj-nome">${esc(p.name)}</span>
        <span class="proj-status">${NOME_STATUS[p.status]}</span>
      </div>
      ${p.description ? `<div class="proj-desc">${esc(p.description)}</div>` : ''}
      <div class="barra"><i style="width:${progresso}%"></i></div>
      <div class="proj-info"><span>${info}</span><b>${progresso}%</b></div>
    </li>`;
  }
  async function desenharLista() {
    const ps = await jarvis.projetos.listar();
    const abertos = ps.filter((p) => p.status !== 'concluido');
    const feitos = ps.filter((p) => p.status === 'concluido');
    const sec = (nome: string, xs: ProjetoResumo[]) =>
      xs.length ? `<section class="secao"><h3>${nome} <b>${xs.length}</b></h3><ul class="projetos">${xs.map(cartao).join('')}</ul></section>` : '';
    caixa.innerHTML = ps.length
      ? sec('Projetos', abertos) + sec('Concluídos', feitos)
      : '<div class="vazio"><strong>Nenhum projeto.</strong>Crie acima ou peça na conversa.</div>';
  }
  caixa.onclick = (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.projeto')?.dataset.id;
    if (id) abrir(id);
  };

  // ---------- detalhe ----------
  function abrir(id: string | null) {
    aberto = id;
    editandoInfo = false;
    lista.hidden = !!id;
    detalhe.hidden = !id;
    void desenhar();
  }

  function cardTarefa(t: Task) {
    const col = colunaDe(t);
    const i = COLUNAS.findIndex(([c]) => c === col);
    const atrasada = !t.done_at && t.due_date && t.due_date < hojeSP();
    return `<li class="card ${t.done_at ? 'feita' : ''}" data-id="${t.id}" data-p="${t.priority}">
      <div class="card-titulo">${esc(t.title)}</div>
      <div class="card-pe">
        ${t.due_date ? `<span class="quando ${atrasada ? 'atrasada' : ''}">${rotuloData(t.due_date)}${t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ''}</span>` : ''}
        <span class="card-acoes">
          ${i > 0 ? `<button data-mover="${COLUNAS[i - 1]![0]}" title="Voltar para ${COLUNAS[i - 1]![1]}">←</button>` : ''}
          ${i < 2 ? `<button data-mover="${COLUNAS[i + 1]![0]}" title="Mover para ${COLUNAS[i + 1]![1]}">→</button>` : ''}
          <button data-tirar title="Tirar do projeto (a tarefa continua na lista)">×</button>
        </span>
      </div>
    </li>`;
  }

  async function desenhar() {
    if (!aberto) return desenharLista();
    const ps = await jarvis.projetos.listar();
    const p = ps.find((x) => x.id === aberto);
    if (!p) return abrir(null); // apagado (aqui ou em outro aparelho)
    const todas = await jarvis.tarefas.listar();
    const tarefas = todas.filter((t) => t.project_id === p.id);
    const hoje = hojeSP();
    const todasDoProjeto = todas.filter((t) => t.project_id === p.id);
    const progresso = pct(todasDoProjeto.filter((t) => t.done_at).length, todasDoProjeto.length);

    const info = editandoInfo
      ? `<form class="proj-editar" id="proj-editar">
          <input name="nome" value="${esc(p.name)}" maxlength="200" />
          <textarea name="descricao" rows="2" placeholder="Descrição (opcional)">${esc(p.description ?? '')}</textarea>
          <label>Prazo <input type="date" name="prazo" value="${p.due_date ?? ''}" /></label>
          <div class="nova-acoes"><span class="previa"></span>
            <button type="button" class="cancelar">Cancelar</button><button class="salvar">Salvar</button></div>
        </form>`
      : `<div class="proj-cabeca">
          <h2>${esc(p.name)}</h2>
          ${p.description ? `<p>${esc(p.description)}</p>` : ''}
          <div class="proj-meta">
            ${p.due_date ? `<span class="${p.due_date < hoje && p.status !== 'concluido' ? 'atrasada' : ''}">prazo ${rotuloData(p.due_date)}</span>` : '<span>sem prazo</span>'}
            <span>${todasDoProjeto.length ? `${progresso}% · ${todasDoProjeto.filter((t) => t.done_at).length}/${todasDoProjeto.length} tarefas` : 'sem tarefas'}</span>
          </div>
          <div class="barra"><i style="width:${progresso}%"></i></div>
        </div>`;

    detalhe.innerHTML = `
      <div class="proj-barra">
        <button class="voltar" data-a="voltar">← Projetos</button>
        <div class="chips" data-grupo="status">
          ${STATUS.map((s) => `<button type="button" data-status="${s}" class="${p.status === s ? 'ativa' : ''}">${NOME_STATUS[s]}</button>`).join('')}
        </div>
        <span class="proj-espaco"></span>
        <button class="link" data-a="editar">Editar</button>
        <button class="link perigo" data-a="apagar">Apagar</button>
      </div>
      ${info}
      <section class="secao">
        <h3>Quadro</h3>
        <form class="nova-tarefa-proj" id="nova-tarefa-proj" autocomplete="off">
          <input name="t" placeholder="+ Nova tarefa neste projeto" maxlength="200" />
          <input type="date" name="d" title="Prazo (opcional)" />
          <button class="salvar">Adicionar</button>
        </form>
        <div class="quadro">
          ${COLUNAS.map(([c, nome]) => {
            const xs = tarefas.filter((t) => colunaDe(t) === c);
            return `<div class="coluna" data-col="${c}">
              <h4>${nome} <b>${xs.length}</b></h4>
              <ul>${xs.map((t) => cardTarefa(t)).join('') || '<li class="coluna-vazia">—</li>'}</ul>
            </div>`;
          }).join('')}
        </div>
      </section>`;

    // Formulários do detalhe (recriados a cada desenho).
    const ft = detalhe.querySelector<HTMLFormElement>('#nova-tarefa-proj')!;
    ft.onsubmit = async (e) => {
      e.preventDefault();
      const t = (ft.t as HTMLInputElement).value.trim();
      if (!t) return;
      await jarvis.tarefas.criar(t, 'media', (ft.d as HTMLInputElement).value || null, null, { projeto: p.id });
      op.pulsar?.();
      setTimeout(() => detalhe.querySelector<HTMLInputElement>('#nova-tarefa-proj input[name="t"]')?.focus(), 50);
    };
    const fe = detalhe.querySelector<HTMLFormElement>('#proj-editar');
    if (fe) {
      fe.onsubmit = async (e) => {
        e.preventDefault();
        editandoInfo = false;
        await jarvis.projetos.editar(p.id, {
          nome: (fe.nome as HTMLInputElement).value,
          descricao: (fe.descricao as HTMLTextAreaElement).value,
          prazo: (fe.prazo as HTMLInputElement).value || null,
        });
      };
      fe.querySelector<HTMLButtonElement>('.cancelar')!.onclick = () => {
        editandoInfo = false;
        void desenhar();
      };
      (fe.nome as HTMLInputElement).focus();
    }
  }

  detalhe.onclick = async (e) => {
    const alvo = e.target as HTMLElement;
    const b = alvo.closest<HTMLButtonElement>('button');
    if (!b || !aberto) return;
    const id = aberto;
    if (b.dataset.a === 'voltar') return abrir(null);
    if (b.dataset.a === 'editar') {
      editandoInfo = true;
      return void desenhar();
    }
    if (b.dataset.a === 'apagar') {
      // Dois cliques: o primeiro pede confirmação no próprio botão.
      if (!b.classList.contains('confirmar')) {
        b.classList.add('confirmar');
        b.textContent = 'Apagar mesmo? (as tarefas ficam)';
        setTimeout(() => {
          b.classList.remove('confirmar');
          b.textContent = 'Apagar';
        }, 4000);
        return;
      }
      await jarvis.projetos.apagar(id);
      return abrir(null);
    }
    if (b.dataset.status) return jarvis.projetos.editar(id, { status: b.dataset.status as StatusProjeto });
    const card = b.closest<HTMLElement>('.card')?.dataset.id;
    if (card) {
      if (b.dataset.mover) return jarvis.tarefas.mover(card, { coluna: b.dataset.mover as Coluna });
      if (b.dataset.tirar !== undefined) return jarvis.tarefas.mover(card, { projeto: null });
    }
  };

  jarvis.aoMudar(() => {
    // Não redesenha no meio da digitação de um formulário do detalhe.
    const foco = document.activeElement;
    if (aberto && foco && detalhe.contains(foco) && foco.matches('input, textarea, select') && (foco as HTMLInputElement).value) return;
    void desenhar();
  });
  void desenhar();
}
