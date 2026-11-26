// Aba Conhecimento (Fase 2 · Etapa 5): notas com cadernos/etiquetas, capturas (caixa de entrada)
// e diário dos últimos 14 dias. Tudo no banco local; o sync leva para o Supabase e a IA vê igual.
import { hojeSP, somarDias, type Note } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
type Secao = 'notas' | 'capturas' | 'diario';

function rotuloDia(dia: string) {
  const hoje = hojeSP();
  if (dia === hoje) return 'hoje';
  if (dia === somarDias(hoje, -1)) return 'ontem';
  const [, m, d] = dia.split('-');
  return `${CURTO[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
}

function parseEtiquetas(s: string) {
  return s.split(/[,;#]+/).map((t) => t.trim()).filter(Boolean);
}

function tituloDe(n: Note) {
  if (n.title?.trim()) return n.title.trim();
  const linha = n.content.trim().split(/\r?\n/)[0] ?? '';
  return linha.slice(0, 80) || '(sem título)';
}

function preview(n: Note) {
  const t = n.content.trim().replace(/\s+/g, ' ');
  return t.slice(0, 180);
}

export function htmlConhecimento() {
  return `
    <div class="cn">
      <div class="cn-secs" role="tablist">
        <button type="button" data-sec="notas" class="ativa">Notas</button>
        <button type="button" data-sec="capturas">Capturas</button>
        <button type="button" data-sec="diario">Diário</button>
      </div>

      <div class="cn-painel" data-painel="notas">
        <aside class="cn-lado" id="cn-lado"></aside>
        <div class="cn-main">
          <div class="cn-topo">
            <input type="search" id="cn-busca" placeholder="Buscar notas…" autocomplete="off" />
            <button type="button" class="cn-btn" id="cn-nova">Nova nota</button>
          </div>
          <form class="cn-editor" id="cn-editor" hidden autocomplete="off">
            <input name="titulo" placeholder="Título" maxlength="200" />
            <div class="cn-editor-linha">
              <input name="caderno" list="cn-cadernos" placeholder="Caderno (opcional)" maxlength="80" />
              <input name="etiquetas" placeholder="Etiquetas (vírgula)" maxlength="200" />
            </div>
            <textarea name="conteudo" rows="6" placeholder="Escreva a nota…" required></textarea>
            <datalist id="cn-cadernos"></datalist>
            <div class="cn-editor-acoes">
              <label class="cn-fixar"><input type="checkbox" name="fixada" /> Fixar</label>
              <span class="cn-espaco"></span>
              <button type="button" class="cancelar" id="cn-cancelar">Cancelar</button>
              <button type="submit" class="salvar">Salvar</button>
            </div>
          </form>
          <div id="cn-notas"></div>
        </div>
      </div>

      <div class="cn-painel" data-painel="capturas" hidden>
        <form class="cn-rapida" id="cn-captura" autocomplete="off">
          <input name="texto" placeholder="Captura rápida — Enter para guardar" maxlength="4000" />
        </form>
        <div id="cn-capturas"></div>
      </div>

      <div class="cn-painel" data-painel="diario" hidden>
        <div class="cn-dias" id="cn-dias"></div>
        <textarea id="cn-diario" rows="14" placeholder="Como foi o dia?"></textarea>
        <div class="cn-diario-rodape"><span id="cn-salvo"></span></div>
      </div>

      <p class="dica-tarefas">Ou peça na conversa: <em>"anota aí: ideia de app de receitas"</em>,
        <em>"escreve no diário que hoje foi produtivo"</em>, <em>"o que eu anotei sobre o carro?"</em></p>
    </div>`;
}

export function ligarConhecimento(raiz: HTMLElement, op: { pulsar?: () => void; aoMudar?: () => void } = {}) {
  const secs = raiz.querySelectorAll<HTMLButtonElement>('.cn-secs button');
  const paineis = raiz.querySelectorAll<HTMLElement>('.cn-painel');
  const lado = raiz.querySelector<HTMLElement>('#cn-lado')!;
  const caixaNotas = raiz.querySelector<HTMLDivElement>('#cn-notas')!;
  const caixaCapturas = raiz.querySelector<HTMLDivElement>('#cn-capturas')!;
  const busca = raiz.querySelector<HTMLInputElement>('#cn-busca')!;
  const formEditor = raiz.querySelector<HTMLFormElement>('#cn-editor')!;
  const formCaptura = raiz.querySelector<HTMLFormElement>('#cn-captura')!;
  const listaCadernos = raiz.querySelector<HTMLDataListElement>('#cn-cadernos')!;
  const faixaDias = raiz.querySelector<HTMLDivElement>('#cn-dias')!;
  const areaDiario = raiz.querySelector<HTMLTextAreaElement>('#cn-diario')!;
  const statusSalvo = raiz.querySelector<HTMLSpanElement>('#cn-salvo')!;

  let secao: Secao = 'notas';
  let caderno: string | null | undefined = undefined; // undefined = todas; null = sem caderno
  let etiqueta: string | null = null;
  let termo = '';
  let editando: string | null = null;
  let diaDiario = hojeSP();
  let timerBusca: ReturnType<typeof setTimeout> | null = null;
  let timerDiario: ReturnType<typeof setTimeout> | null = null;
  let desenhando = false;
  let textoDiarioCarregado = '';

  function mostrarSecao(s: Secao) {
    secao = s;
    secs.forEach((b) => b.classList.toggle('ativa', b.dataset.sec === s));
    paineis.forEach((p) => {
      p.hidden = p.dataset.painel !== s;
    });
    void desenhar();
  }

  secs.forEach((b) => {
    b.onclick = () => mostrarSecao(b.dataset.sec as Secao);
  });

  // ---------- editor de nota ----------
  function fecharEditor() {
    editando = null;
    formEditor.reset();
    formEditor.hidden = true;
  }
  function abrirEditor(n?: Note) {
    editando = n?.id ?? null;
    (formEditor.titulo as HTMLInputElement).value = n?.title ?? '';
    (formEditor.caderno as HTMLInputElement).value = n?.notebook ?? '';
    (formEditor.etiquetas as HTMLInputElement).value = (n?.tags ?? []).join(', ');
    (formEditor.conteudo as HTMLTextAreaElement).value = n?.content ?? '';
    (formEditor.fixada as HTMLInputElement).checked = !!n?.pinned;
    formEditor.hidden = false;
    formEditor.querySelector<HTMLButtonElement>('.salvar')!.textContent = n ? 'Salvar' : 'Criar nota';
    (formEditor.conteudo as HTMLTextAreaElement).focus();
  }
  raiz.querySelector<HTMLButtonElement>('#cn-nova')!.onclick = () => abrirEditor();
  raiz.querySelector<HTMLButtonElement>('#cn-cancelar')!.onclick = fecharEditor;
  formEditor.onsubmit = async (e) => {
    e.preventDefault();
    const conteudo = (formEditor.conteudo as HTMLTextAreaElement).value;
    if (!conteudo.trim()) return (formEditor.conteudo as HTMLTextAreaElement).focus();
    const dados = {
      titulo: (formEditor.titulo as HTMLInputElement).value,
      caderno: (formEditor.caderno as HTMLInputElement).value || null,
      etiquetas: parseEtiquetas((formEditor.etiquetas as HTMLInputElement).value),
      conteudo,
      fixada: (formEditor.fixada as HTMLInputElement).checked,
      tipo: 'nota' as const,
    };
    if (editando) await jarvis.conhecimento.editar(editando, dados);
    else {
      await jarvis.conhecimento.criar(dados);
      op.pulsar?.();
    }
    fecharEditor();
  };

  // ---------- busca ----------
  busca.oninput = () => {
    if (timerBusca) clearTimeout(timerBusca);
    timerBusca = setTimeout(() => {
      termo = busca.value.trim();
      void desenhar();
    }, 200);
  };

  // ---------- capturas ----------
  formCaptura.onsubmit = async (e) => {
    e.preventDefault();
    const texto = (formCaptura.texto as HTMLInputElement).value.trim();
    if (!texto) return;
    await jarvis.conhecimento.criar({ conteudo: texto, tipo: 'captura' });
    op.pulsar?.();
    formCaptura.reset();
  };

  // ---------- diário ----------
  async function carregarDiario() {
    const n = await jarvis.conhecimento.diario(diaDiario);
    textoDiarioCarregado = n?.content ?? '';
    areaDiario.value = textoDiarioCarregado;
    statusSalvo.textContent = '';
  }
  function agendarSalvarDiario() {
    if (timerDiario) clearTimeout(timerDiario);
    statusSalvo.textContent = '…';
    timerDiario = setTimeout(() => void salvarDiario(), 800);
  }
  async function salvarDiario() {
    const texto = areaDiario.value;
    if (texto === textoDiarioCarregado) {
      statusSalvo.textContent = texto ? 'salvo' : '';
      return;
    }
    await jarvis.conhecimento.escreverDiario(diaDiario, texto);
    textoDiarioCarregado = texto;
    statusSalvo.textContent = texto.trim() ? 'salvo' : '';
    op.aoMudar?.();
    // redesenha só a faixa de dias (bolinhas)
    if (secao === 'diario') void desenharDias();
  }
  areaDiario.oninput = agendarSalvarDiario;
  areaDiario.onblur = () => {
    if (timerDiario) clearTimeout(timerDiario);
    void salvarDiario();
  };

  async function desenharDias() {
    const hoje = hojeSP();
    const de = somarDias(hoje, -13);
    const com = new Set(await jarvis.conhecimento.diasComDiario(de, hoje));
    const botoes: string[] = [];
    for (let i = 0; i < 14; i++) {
      const dia = somarDias(de, i);
      const futuro = dia > hoje;
      const marcado = com.has(dia);
      const ativo = dia === diaDiario;
      botoes.push(
        `<button type="button" class="cn-dia${marcado ? ' tem' : ''}${ativo ? ' ativa' : ''}" data-dia="${dia}"
          title="${esc(rotuloDia(dia))}" ${futuro ? 'disabled' : ''}>
          <span class="cn-dia-letra">${CURTO[new Date(`${dia}T12:00:00Z`).getUTCDay()]}</span>
          <span class="cn-dia-num">${dia.slice(8)}</span>
          <span class="cn-dia-ponto"></span>
        </button>`,
      );
    }
    faixaDias.innerHTML = botoes.join('');
  }
  faixaDias.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-dia]');
    if (!b || b.disabled) return;
    if (timerDiario) {
      clearTimeout(timerDiario);
      await salvarDiario();
    }
    diaDiario = b.dataset.dia!;
    await carregarDiario();
    await desenharDias();
  };

  // ---------- desenho ----------
  function cartaoNota(n: Note) {
    const tags = n.tags.map((t) => `<span class="cn-tag">#${esc(t)}</span>`).join('');
    const meta = [n.notebook ? esc(n.notebook) : '', tags].filter(Boolean).join(' · ');
    return `<article class="cn-cartao" data-id="${n.id}">
      <div class="cn-cartao-topo">
        <span class="cn-cartao-titulo">${n.pinned ? '📌 ' : ''}${esc(tituloDe(n))}</span>
        <div class="cn-acoes">
          <button type="button" data-fixar title="${n.pinned ? 'Desafixar' : 'Fixar'}">${n.pinned ? '📍' : '📌'}</button>
          <button type="button" data-editar title="Editar">✎</button>
          <button type="button" data-apagar title="Apagar">×</button>
        </div>
      </div>
      ${meta ? `<div class="cn-cartao-meta">${meta}</div>` : ''}
      <div class="cn-cartao-preview">${esc(preview(n))}</div>
    </article>`;
  }

  function cartaoCaptura(n: Note) {
    return `<article class="cn-cartao" data-id="${n.id}">
      <div class="cn-cartao-topo">
        <span class="cn-cartao-titulo">${esc(preview(n) || '(vazio)')}</span>
        <div class="cn-acoes">
          <button type="button" data-organizar title="Organizar em caderno">Organizar</button>
          <button type="button" data-apagar title="Apagar">×</button>
        </div>
      </div>
    </article>`;
  }

  async function desenharLado(cadernos: { nome: string; total: number }[], etiquetas: { nome: string; total: number }[]) {
    // "Todas" = sem filtro de caderno/etiqueta
    const todasAtiva = caderno === undefined && !etiqueta;
    let html = `<div class="cn-grupo"><button type="button" class="cn-filtro${todasAtiva ? ' ativa' : ''}" data-todas="1">Todas</button>`;
    for (const c of cadernos) {
      html += `<button type="button" class="cn-filtro${caderno === c.nome && !etiqueta ? ' ativa' : ''}" data-caderno="${esc(c.nome)}">${esc(c.nome)} <b>${c.total}</b></button>`;
    }
    html += `</div>`;
    if (etiquetas.length) {
      html += `<div class="cn-grupo"><span class="cn-grupo-titulo">Etiquetas</span>`;
      for (const et of etiquetas) {
        html += `<button type="button" class="cn-filtro${etiqueta === et.nome ? ' ativa' : ''}" data-etiqueta="${esc(et.nome)}">#${esc(et.nome)} <b>${et.total}</b></button>`;
      }
      html += `</div>`;
    }
    lado.innerHTML = html;
    listaCadernos.innerHTML = cadernos.map((c) => `<option value="${esc(c.nome)}"></option>`).join('');
  }

  lado.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.cn-filtro');
    if (!b) return;
    if (b.dataset.todas === '1') {
      caderno = undefined;
      etiqueta = null;
    } else if (b.dataset.etiqueta != null) {
      etiqueta = b.dataset.etiqueta;
      caderno = undefined;
    } else if (b.dataset.caderno != null) {
      caderno = b.dataset.caderno || null;
      etiqueta = null;
    }
    void desenhar();
  };

  caixaNotas.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const id = b?.closest<HTMLElement>('.cn-cartao')?.dataset.id;
    if (!b || !id) return;
    const n = (await jarvis.conhecimento.ver(id));
    if (!n) return;
    if (b.hasAttribute('data-fixar')) return jarvis.conhecimento.editar(id, { fixada: !n.pinned });
    if (b.hasAttribute('data-editar')) return abrirEditor(n);
    if (b.hasAttribute('data-apagar')) {
      if (!confirm(`Apagar a nota "${tituloDe(n)}"?`)) return;
      return jarvis.conhecimento.apagar(id);
    }
  };

  caixaCapturas.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const id = b?.closest<HTMLElement>('.cn-cartao')?.dataset.id;
    if (!b || !id) return;
    if (b.hasAttribute('data-organizar')) {
      const nome = prompt('Caderno para organizar esta captura:');
      if (nome == null) return;
      const cad = nome.trim();
      if (!cad) return;
      await jarvis.conhecimento.editar(id, { caderno: cad });
      op.pulsar?.();
      return;
    }
    if (b.hasAttribute('data-apagar')) {
      if (!confirm('Apagar esta captura?')) return;
      return jarvis.conhecimento.apagar(id);
    }
  };

  // Mudança que chega no meio de um desenho não se perde: desenha de novo ao terminar.
  let deNovo = false;
  async function desenhar(): Promise<void> {
    if (desenhando) {
      deNovo = true;
      return;
    }
    desenhando = true;
    deNovo = false;
    try {
      if (secao === 'notas') {
        const [notas, cadernos, etiquetas] = await Promise.all([
          jarvis.conhecimento.listar({
            tipo: 'nota',
            termo: termo || undefined,
            caderno: etiqueta ? undefined : caderno,
            etiqueta: etiqueta ?? undefined,
          }),
          jarvis.conhecimento.cadernos(),
          jarvis.conhecimento.etiquetas(),
        ]);
        await desenharLado(cadernos, etiquetas);
        caixaNotas.innerHTML = notas.length
          ? `<div class="cn-lista">${notas.map(cartaoNota).join('')}</div>`
          : '<div class="vazio">Nenhuma nota ainda. Crie a primeira ou peça na conversa.</div>';
      } else if (secao === 'capturas') {
        const caps = await jarvis.conhecimento.listar({ tipo: 'captura' });
        caixaCapturas.innerHTML = caps.length
          ? `<div class="cn-lista">${caps.map(cartaoCaptura).join('')}</div>`
          : '<div class="vazio">Caixa de entrada vazia. Digite acima e Enter, ou diga na conversa.</div>';
      } else {
        await desenharDias();
        // Não sobrescreve o textarea se o dono está digitando.
        if (document.activeElement !== areaDiario) await carregarDiario();
      }
      op.aoMudar?.();
    } finally {
      desenhando = false;
      if (deNovo) void desenhar();
    }
  }

  jarvis.aoMudar(() => {
    const foco = document.activeElement;
    if (foco && (formEditor.contains(foco) || formCaptura.contains(foco) || foco === areaDiario || foco === busca)) return;
    void desenhar();
  });

  void desenhar();
}
