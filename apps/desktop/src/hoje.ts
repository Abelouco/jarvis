// Aba Hoje (Fase 2 · Etapa 6): o dia num lugar só. Tarefas, lembretes, hábitos, diário e projetos.
// Só lê e mostra o que já está no banco local (jarvis.*); as ações reaproveitam as funções das outras abas.
import { hojeSP, partesSP, type HabitoResumo, type Note, type ProjetoResumo, type Reminder, type Task } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Abas para onde os links "ver todas" levam. */
export type AbaDestino = 'tarefas' | 'lembretes' | 'habitos' | 'conhecimento' | 'projetos';

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function saudacao(): string {
  const h = Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** "quinta-feira, 26 de novembro" */
function dataExtenso(dia: string): string {
  const [, m, d] = dia.split('-').map(Number);
  return `${SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${d} de ${MESES[m! - 1]}`;
}

/** Hora atual em São Paulo, "HH:MM". */
const agoraHM = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });

export function htmlHoje(): string {
  return `
<div class="hj">
  <header class="hj-topo">
    <div>
      <h2 class="hj-saudacao"></h2>
      <p class="hj-data"></p>
    </div>
    <span class="hj-selo" hidden>Dia em dia ✓</span>
  </header>
  <p class="hj-resumo"></p>
  <div class="hj-grade">
    <section class="hj-cartao" data-cartao="tarefas"><h3>Tarefas <button type="button" class="hj-ver" data-ir="tarefas">ver todas</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="habitos"><h3>Hábitos <button type="button" class="hj-ver" data-ir="habitos">ver todos</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="lembretes"><h3>Lembretes <button type="button" class="hj-ver" data-ir="lembretes">ver todos</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao" data-cartao="diario"><h3>Diário <button type="button" class="hj-ver" data-ir="conhecimento">abrir</button></h3><div class="hj-corpo"></div></section>
    <section class="hj-cartao hj-largo" data-cartao="projetos"><h3>Projetos <button type="button" class="hj-ver" data-ir="projetos">ver todos</button></h3><div class="hj-corpo"></div></section>
  </div>
  <p class="dica-tarefas">Ou peça na conversa: <em>"o que tenho hoje?"</em>, <em>"meditei"</em>, <em>"me lembra às 18h de ligar pro João"</em>.</p>
</div>`;
}

export function ligarHoje(raiz: HTMLElement, op: { pulsar?: () => void; irPara?: (aba: AbaDestino) => void } = {}) {
  const corpo = (c: string) => raiz.querySelector<HTMLDivElement>(`[data-cartao="${c}"] .hj-corpo`)!;
  let desenhando = false;

  function desenharTarefas(lista: Task[], hoje: string) {
    const abertas = lista.filter((t) => !t.done_at);
    const atrasadas = abertas.filter((t) => t.due_date && t.due_date < hoje);
    const deHoje = abertas
      .filter((t) => t.due_date === hoje)
      .sort((a, b) => (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99'));
    const extra = abertas.filter((t) => !t.due_date && t.priority === 'alta').slice(0, 3);

    const itens: { t: Task; marca: string }[] = [
      ...atrasadas.map((t) => ({ t, marca: 'atrasada' })),
      ...deHoje.map((t) => ({ t, marca: t.due_time?.slice(0, 5) || '' })),
      ...extra.map((t) => ({ t, marca: 'alta' })),
    ];
    const total = itens.length;
    const mostrar = itens.slice(0, 8);
    const resto = total - mostrar.length;

    if (!mostrar.length) {
      corpo('tarefas').innerHTML = '<p class="hj-vazio">Nada para hoje.</p>';
    } else {
      const lis = mostrar.map(({ t, marca }) => {
        const dir = marca === 'atrasada'
          ? `<span class="hj-atrasada">atrasada</span>`
          : marca === 'alta'
            ? `<span>alta</span>`
            : marca
              ? `<span>${esc(marca)}</span>`
              : '';
        return `<li data-tarefa="${t.id}">
          <button type="button" class="hj-check" data-concluir="${t.id}" title="Concluir"></button>
          <span class="hj-titulo">${esc(t.title)}</span>
          ${dir}
        </li>`;
      }).join('');
      const mais = resto > 0
        ? `<li class="hj-mais"><button type="button" class="hj-ver" data-ir="tarefas">+ ${resto}</button></li>`
        : '';
      corpo('tarefas').innerHTML = `<ul class="hj-lista">${lis}${mais}</ul>`;
    }
    return { atrasadas: atrasadas.length, deHoje: deHoje.length };
  }

  function desenharHabitos(lista: HabitoResumo[]) {
    const hoje = lista.filter((h) => h.previstoHoje && !h.paused);
    const ordenados = [...hoje].sort((a, b) => Number(a.feitoHoje) - Number(b.feitoHoje));
    if (!ordenados.length) {
      corpo('habitos').innerHTML = '<p class="hj-vazio">Nenhum hábito para hoje.</p>';
    } else {
      const lis = ordenados.map((h) => {
        let meta = '';
        if (h.kind !== 'boolean' && h.daily_target) {
          const unidade = h.unit ? ` ${esc(h.unit)}` : (h.kind === 'duration' ? ' min' : '');
          meta = `<span class="hj-meta">${h.hojeValor ?? 0}/${h.daily_target}${unidade}</span>`;
        }
        const seq = h.sequencia.n > 1 ? `<span class="hj-seq">🔥 ${h.sequencia.n}</span>` : '';
        return `<li>
          <button type="button" class="hj-habito${h.feitoHoje ? ' feito' : ''}" data-habito="${h.id}" data-tipo="${h.kind}"
            data-meta="${h.daily_target ?? ''}" data-feito="${h.feitoHoje ? '1' : ''}"
            title="${h.kind === 'quantity' ? '+1 (clique)' : h.feitoHoje ? 'Desmarcar' : 'Marcar como feito'}">
            <span>${esc(h.name)}</span>${meta}${seq}
          </button>
        </li>`;
      }).join('');
      corpo('habitos').innerHTML = `<ul class="hj-lista">${lis}</ul>`;
    }
    const faltando = hoje.filter((h) => !h.feitoHoje).length;
    return { faltando, total: hoje.length };
  }

  function desenharLembretes(lista: Reminder[], hoje: string) {
    const agora = agoraHM();
    const deHoje = lista
      .filter((l) => !l.done_at && partesSP(l.remind_at).data === hoje)
      .sort((a, b) => a.remind_at.localeCompare(b.remind_at));
    if (!deHoje.length) {
      corpo('lembretes').innerHTML = '<p class="hj-vazio">Nenhum lembrete hoje.</p>';
      return;
    }
    const lis = deHoje.map((l) => {
      const { hora } = partesSP(l.remind_at);
      const passou = hora < agora ? ' hj-passou' : '';
      return `<li class="${passou.trim()}">
        <span class="hj-hora">${esc(hora)}</span>
        <span class="hj-titulo">${esc(l.title)}</span>
      </li>`;
    }).join('');
    corpo('lembretes').innerHTML = `<ul class="hj-lista">${lis}</ul>`;
  }

  function desenharDiario(n: Note | undefined) {
    const texto = n?.content.trim();
    if (!texto) {
      corpo('diario').innerHTML =
        '<button type="button" class="hj-convite" data-ir="conhecimento">Como foi o dia? Escreva no diário →</button>';
      return;
    }
    const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
    corpo('diario').innerHTML =
      `<p class="hj-diario" data-ir="conhecimento">${linhas.map((l) => esc(l)).join('<br>')}</p>`;
  }

  function desenharProjetos(lista: ProjetoResumo[], hoje: string) {
    const ativos = lista
      .filter((p) => p.status === 'em_andamento')
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      })
      .slice(0, 4);
    if (!ativos.length) {
      corpo('projetos').innerHTML = '<p class="hj-vazio">Nenhum projeto em andamento.</p>';
      return;
    }
    const lis = ativos.map((p) => {
      const pct = p.total ? Math.round((p.feitas / p.total) * 100) : 0;
      let prazo = '';
      if (p.due_date) {
        const [, m, d] = p.due_date.split('-');
        const cls = p.due_date < hoje ? ' hj-atrasada' : '';
        prazo = `<span class="hj-prazo${cls}">prazo ${d}/${m}</span>`;
      }
      return `<li>
        <div class="hj-proj-topo">
          <span class="hj-titulo">${esc(p.name)}</span>
          ${prazo}
        </div>
        <div class="hj-barra"><span style="width:${pct}%"></span></div>
        <span class="hj-proj-meta">${p.feitas}/${p.total} tarefas</span>
      </li>`;
    }).join('');
    corpo('projetos').innerHTML = `<ul class="hj-lista">${lis}</ul>`;
  }

  function desenharTopo(hoje: string, t: { atrasadas: number; deHoje: number }, h: { faltando: number; total: number }) {
    raiz.querySelector<HTMLElement>('.hj-saudacao')!.textContent = saudacao();
    raiz.querySelector<HTMLElement>('.hj-data')!.textContent = dataExtenso(hoje);
    const partes: string[] = [];
    if (t.atrasadas > 0) partes.push(`${t.atrasadas} atrasada${t.atrasadas === 1 ? '' : 's'}`);
    partes.push(`${t.deHoje} para hoje`);
    if (h.faltando > 0) partes.push(`${h.faltando} hábito${h.faltando === 1 ? '' : 's'} faltando`);
    raiz.querySelector<HTMLElement>('.hj-resumo')!.textContent = partes.join(' · ');
    const selo = raiz.querySelector<HTMLElement>('.hj-selo')!;
    selo.hidden = !(t.atrasadas === 0 && t.deHoje === 0 && h.total > 0 && h.faltando === 0);
  }

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
      const hoje = hojeSP();
      const [tarefas, lembretes, habitos, diario, projetos] = await Promise.all([
        jarvis.tarefas.listar(), jarvis.lembretes.listar(), jarvis.habitos.listar(hoje),
        jarvis.conhecimento.diario(hoje), jarvis.projetos.listar(),
      ]);
      const t = desenharTarefas(tarefas, hoje);
      const h = desenharHabitos(habitos);
      desenharLembretes(lembretes, hoje);
      desenharDiario(diario);
      desenharProjetos(projetos, hoje);
      desenharTopo(hoje, t, h);
    } finally {
      desenhando = false;
      if (deNovo) void desenhar();
    }
  }

  raiz.onclick = async (e) => {
    const alvo = e.target as HTMLElement;
    const ir = alvo.closest<HTMLElement>('[data-ir]')?.dataset.ir as AbaDestino | undefined;
    if (ir) return op.irPara?.(ir);
    const concluir = alvo.closest<HTMLElement>('[data-concluir]')?.dataset.concluir;
    if (concluir) {
      await jarvis.tarefas.alternarConcluida(concluir);
      op.pulsar?.();
      return void desenhar();
    }
    const hb = alvo.closest<HTMLElement>('[data-habito]');
    if (hb) {
      const id = hb.dataset.habito!;
      const meta = Number(hb.dataset.meta) || 0;
      // Quantidade soma 1 (copos, páginas...). Minutos: um clique cumpre a meta do dia, outro desmarca.
      if (hb.dataset.tipo === 'quantity') await jarvis.habitos.somar(id, 1);
      else if (hb.dataset.tipo === 'duration' && meta) {
        await jarvis.habitos.registrar(id, hojeSP(), hb.dataset.feito ? null : meta);
      } else await jarvis.habitos.alternar(id);
      op.pulsar?.();
      return void desenhar();
    }
  };

  jarvis.aoMudar(() => void desenhar());
  void desenhar();
}
