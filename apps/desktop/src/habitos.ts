// Aba Hábitos (Fase 2 · Etapa 4): o dia de hoje com um toque para marcar, a sequência, os últimos 14 dias
// e a meta da semana. Tudo no banco local; o sync leva para o Supabase e a IA vê igual.
// Hábito com horário: se chegar a hora e ainda não foi feito, o app avisa (notificação do Windows).
import { invoke } from '@tauri-apps/api/core';
import { descreverFrequencia, descreverMeta, hojeSP, type HabitoResumo, type TipoHabito } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CURTO = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOME_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
type Freq = 'todo_dia' | 'dias' | 'vezes';

const agoraHHMM = () =>
  new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

export function htmlHabitos() {
  return `
    <form class="nova form-tarefa" id="novo-habito" autocomplete="off">
      <div class="nova-linha">
        <input name="nome" placeholder="Novo hábito (ex.: Meditar, Ler, Beber água)" maxlength="120" />
        <button class="adicionar" title="Criar (Enter)">+</button>
      </div>
      <div class="nova-detalhes">
        <div class="ft-campo">
          <span class="rotulo">Tipo</span>
          <div class="chips" data-grupo="tipo">
            <button type="button" data-v="boolean" class="ativa">Feito ou não</button>
            <button type="button" data-v="duration">Minutos</button>
            <button type="button" data-v="quantity">Quantidade</button>
          </div>
        </div>
        <div class="ft-campo" data-campo="meta" hidden>
          <span class="rotulo">Meta/dia</span>
          <input type="number" name="meta" min="0" step="any" class="num" placeholder="30" />
          <input name="unidade" class="unidade" placeholder="copos, páginas…" maxlength="30" />
        </div>
        <div class="ft-campo">
          <span class="rotulo">Frequência</span>
          <div class="chips" data-grupo="freq">
            <button type="button" data-v="todo_dia" class="ativa">Todo dia</button>
            <button type="button" data-v="dias">Dias da semana</button>
            <button type="button" data-v="vezes">Vezes por semana</button>
          </div>
        </div>
        <div class="ft-campo" data-campo="dias" hidden>
          <span class="rotulo"></span>
          <div class="dias-semana">${NOME_DIA.map((d, i) => `<button type="button" data-d="${i}" title="${d}">${CURTO[i]}</button>`).join('')}</div>
        </div>
        <div class="ft-campo" data-campo="vezes" hidden>
          <span class="rotulo"></span>
          <input type="number" name="vezes" min="1" max="7" value="3" class="num" /> <span class="dica">vezes por semana, em qualquer dia</span>
        </div>
        <div class="ft-campo">
          <span class="rotulo">Horário</span>
          <input type="time" name="horario" title="Avisa nessa hora se ainda não foi feito (opcional)" />
          <span class="rotulo curto">Meta/mês</span>
          <input type="number" name="metaMes" min="1" max="31" class="num" placeholder="—" title="Vezes no mês (opcional)" />
        </div>
        <div class="nova-acoes">
          <span class="previa"></span>
          <button type="button" class="cancelar">Cancelar</button>
          <button type="submit" class="salvar">Criar hábito</button>
        </div>
      </div>
    </form>
    <p class="dica-tarefas">Ou na conversa: <em>"quero criar o hábito de ler 30 minutos por dia"</em>, <em>"meditei"</em>,
      <em>"bebi 2 copos de água"</em>, <em>"como estão meus hábitos?"</em></p>
    <div id="habitos"></div>`;
}

export function ligarHabitos(raiz: HTMLElement, op: { pulsar?: () => void; aoMudar?: (hs: HabitoResumo[]) => void } = {}) {
  const form = raiz.querySelector<HTMLFormElement>('#novo-habito')!;
  const caixa = raiz.querySelector<HTMLDivElement>('#habitos')!;
  let editando: string | null = null;
  let tipo: TipoHabito = 'boolean';
  let freq: Freq = 'todo_dia';
  let dias = new Set<number>();
  let apagando: string | null = null;
  let lista: HabitoResumo[] = [];

  // ---------- formulário (novo e editar) ----------
  const campo = (n: string) => form.querySelector<HTMLElement>(`[data-campo="${n}"]`)!;
  function aplicar() {
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="tipo"] button').forEach((b) => b.classList.toggle('ativa', b.dataset.v === tipo));
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="freq"] button').forEach((b) => b.classList.toggle('ativa', b.dataset.v === freq));
    form.querySelectorAll<HTMLButtonElement>('.dias-semana button').forEach((b) => b.classList.toggle('ativa', dias.has(Number(b.dataset.d))));
    campo('meta').hidden = tipo === 'boolean';
    (form.unidade as HTMLInputElement).hidden = tipo !== 'quantity';
    (form.meta as HTMLInputElement).placeholder = tipo === 'duration' ? 'minutos' : 'quantos';
    campo('dias').hidden = freq !== 'dias';
    campo('vezes').hidden = freq !== 'vezes';
    form.querySelector<HTMLButtonElement>('.salvar')!.textContent = editando ? 'Salvar' : 'Criar hábito';
  }
  function limpar() {
    form.reset();
    editando = null;
    tipo = 'boolean';
    freq = 'todo_dia';
    dias = new Set();
    form.classList.remove('aberta', 'editando');
    aplicar();
  }
  form.addEventListener('focusin', () => form.classList.add('aberta'));
  form.querySelector<HTMLButtonElement>('.cancelar')!.onclick = limpar;
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      limpar();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  });
  form.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[type="button"]');
    if (!b) return;
    const grupo = b.parentElement?.dataset.grupo;
    if (grupo === 'tipo') tipo = b.dataset.v as TipoHabito;
    else if (grupo === 'freq') freq = b.dataset.v as Freq;
    else if (b.dataset.d !== undefined) {
      const d = Number(b.dataset.d);
      if (dias.has(d)) dias.delete(d);
      else dias.add(d);
    } else return;
    aplicar();
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nome = (form.nome as HTMLInputElement).value.trim();
    if (!nome) return (form.nome as HTMLInputElement).focus();
    const meta = Number((form.meta as HTMLInputElement).value);
    const metaMes = Number((form.metaMes as HTMLInputElement).value);
    const dados = {
      nome, tipo,
      meta: tipo !== 'boolean' && meta > 0 ? meta : null,
      unidade: tipo === 'quantity' ? (form.unidade as HTMLInputElement).value : null,
      dias: freq === 'dias' && dias.size && dias.size < 7 ? [...dias].sort() : null,
      vezesSemana: freq === 'vezes' ? Math.min(7, Math.max(1, Math.round(Number((form.vezes as HTMLInputElement).value) || 3))) : null,
      metaMes: metaMes >= 1 && metaMes <= 31 ? Math.round(metaMes) : null,
      horario: (form.horario as HTMLInputElement).value || null,
    };
    if (editando) await jarvis.habitos.editar(editando, dados);
    else {
      await jarvis.habitos.criar(nome, dados);
      op.pulsar?.();
    }
    limpar();
  };
  function editar(h: HabitoResumo) {
    editando = h.id;
    tipo = h.kind;
    freq = h.times_per_week ? 'vezes' : h.weekdays?.length ? 'dias' : 'todo_dia';
    dias = new Set(h.weekdays ?? []);
    (form.nome as HTMLInputElement).value = h.name;
    (form.meta as HTMLInputElement).value = h.daily_target ? String(h.daily_target) : '';
    (form.unidade as HTMLInputElement).value = h.unit ?? '';
    (form.vezes as HTMLInputElement).value = String(h.times_per_week ?? 3);
    (form.horario as HTMLInputElement).value = h.time_of_day ?? '';
    (form.metaMes as HTMLInputElement).value = h.monthly_target ? String(h.monthly_target) : '';
    form.classList.add('aberta', 'editando');
    aplicar();
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    (form.nome as HTMLInputElement).focus();
  }

  // ---------- lista ----------
  function item(h: HabitoResumo) {
    const meta = descreverMeta(h);
    const sub = [descreverFrequencia(h), meta ? `${meta}/dia` : '', h.time_of_day ? `às ${h.time_of_day}` : '',
      h.monthly_target ? `${h.mes}/${h.monthly_target} no mês` : ''].filter(Boolean).join(' · ');
    const seq = h.sequencia.n
      ? `<span class="hab-seq" title="Sequência atual">▲ ${h.sequencia.n} ${h.sequencia.n === 1 ? h.sequencia.unidade.replace(/s$/, '') : h.sequencia.unidade}</span>`
      : '';
    const semana = h.times_per_week ? `<span class="hab-semana" title="Nesta semana">${h.semana.feitas}/${h.semana.meta}</span>` : '';
    const valor = h.kind !== 'boolean'
      ? `<span class="hab-valor"><button type="button" data-menos title="Tirar">−</button><b>${fmt(h.hojeValor ?? 0)}${h.daily_target ? `/${fmt(h.daily_target)}` : ''}</b>${h.kind === 'duration' ? ' min' : h.unit ? ` ${esc(h.unit)}` : ''}<button type="button" data-mais title="Somar">+</button></span>`
      : '';
    const pontos = h.ultimos.map((u) => {
      const parcial = !u.feito && u.valor != null;
      const estado = u.feito ? 'feito' : parcial ? 'parcial' : u.previsto ? 'falta' : 'livre';
      const rot = `${NOME_DIA[new Date(`${u.dia}T12:00:00Z`).getUTCDay()]} ${u.dia.slice(8)}/${u.dia.slice(5, 7)}`;
      return `<button type="button" class="ponto ${estado}" data-dia="${u.dia}" title="${rot}${u.valor != null && h.kind !== 'boolean' ? ` · ${fmt(u.valor)}` : ''}"></button>`;
    }).join('');
    const p = h.daily_target && h.hojeValor ? Math.min(100, Math.round((h.hojeValor / h.daily_target) * 100)) : 0;
    return `<li class="habito${h.feitoHoje ? ' feito' : ''}${h.paused ? ' pausado' : ''}" data-id="${h.id}" style="--p:${p}%">
      <button type="button" class="check" title="${h.feitoHoje ? 'Desmarcar hoje' : 'Marcar hoje'}">✓</button>
      <div class="hab-corpo">
        <div class="hab-topo"><span class="hab-nome">${esc(h.name)}</span>${seq}${semana}</div>
        <div class="hab-sub">${esc(sub)}</div>
      </div>
      ${valor}
      <div class="hab-dias" title="Últimos 14 dias (clique num dia para marcar ou desmarcar)">${pontos}</div>
      <div class="hab-acoes">
        <button type="button" data-editar title="Editar">✎</button>
        <button type="button" data-pausar title="${h.paused ? 'Retomar' : 'Pausar'}">${h.paused ? '▶' : '❚❚'}</button>
        <button type="button" data-apagar class="${apagando === h.id ? 'confirmar' : ''}" title="Apagar">${apagando === h.id ? 'Apagar?' : '×'}</button>
      </div>
    </li>`;
  }
  const secao = (nome: string, hs: HabitoResumo[], extra = '') =>
    hs.length ? `<section class="secao"><h3>${nome} <b>${extra || hs.length}</b></h3><ul class="habitos">${hs.map(item).join('')}</ul></section>` : '';

  async function desenhar() {
    lista = await jarvis.habitos.listar();
    op.aoMudar?.(lista);
    const ativos = lista.filter((h) => !h.paused);
    const deHoje = ativos.filter((h) => h.previstoHoje && !(h.times_per_week && h.semana.feitas >= h.semana.meta && !h.feitoHoje));
    const fora = ativos.filter((h) => !deHoje.includes(h));
    const pausados = lista.filter((h) => h.paused);
    const feitos = deHoje.filter((h) => h.feitoHoje).length;
    caixa.innerHTML = lista.length
      ? secao('Hoje', deHoje, `${feitos}/${deHoje.length}`) + secao('Fora de hoje', fora) + secao('Pausados', pausados)
      : '<div class="vazio">Nenhum hábito ainda. Crie o primeiro acima ou peça na conversa.</div>';
  }

  caixa.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const id = b?.closest<HTMLElement>('.habito')?.dataset.id;
    if (!b || !id) return;
    const h = lista.find((x) => x.id === id);
    if (!h) return;
    if (!b.hasAttribute('data-apagar') && apagando) apagando = null;
    if (b.classList.contains('check')) {
      if (!h.feitoHoje) op.pulsar?.();
      return jarvis.habitos.alternar(id);
    }
    if (b.dataset.dia) {
      if (b.dataset.dia > hojeSP()) return;
      return jarvis.habitos.alternar(id, b.dataset.dia);
    }
    const passo = h.kind === 'duration' ? 5 : 1;
    if (b.hasAttribute('data-mais')) return jarvis.habitos.somar(id, passo);
    if (b.hasAttribute('data-menos')) return jarvis.habitos.somar(id, -passo);
    if (b.hasAttribute('data-editar')) return editar(h);
    if (b.hasAttribute('data-pausar')) return jarvis.habitos.editar(id, { pausado: !h.paused });
    if (b.hasAttribute('data-apagar')) {
      if (apagando === id) {
        apagando = null;
        return jarvis.habitos.apagar(id);
      }
      apagando = id;
      return void desenhar();
    }
  };

  // ---------- aviso na hora do hábito ----------
  async function vigiar() {
    const hoje = hojeSP();
    const agora = minutos(agoraHHMM());
    for (const h of lista) {
      if (h.paused || !h.time_of_day || !h.previstoHoje || h.feitoHoje) continue;
      const atraso = agora - minutos(h.time_of_day);
      if (atraso < 0 || atraso > 30) continue; // só perto da hora (abrir o app à noite não dispara tudo)
      const chave = `habito-avisado:${h.id}:${hoje}`;
      if (localStorage.getItem(chave)) continue;
      localStorage.setItem(chave, '1');
      const meta = descreverMeta(h);
      try {
        await invoke('notificar', { titulo: h.name, corpo: `Hora do hábito${meta ? ` · ${meta}` : ''}. Marque na aba Hábitos ou me conte quando fizer.` });
      } catch (err) {
        console.warn('hábitos: notificação falhou', err);
      }
    }
  }
  setInterval(() => void vigiar(), 30_000);
  // Virada do dia: a lista de hoje muda sozinha.
  setInterval(() => void desenhar(), 60_000);

  jarvis.aoMudar(() => {
    const foco = document.activeElement;
    if (foco && form.contains(foco) && editando) return;
    void desenhar();
  });
  aplicar();
  void desenhar().then(vigiar);
}
