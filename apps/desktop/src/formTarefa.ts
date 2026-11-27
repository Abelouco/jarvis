// Formulário de tarefa (criar e editar): título, quando, hora, repetição, prioridade, notas e "me lembrar" (só ao criar).
// Mostra embaixo uma prévia em palavras ("toda segunda às 20:00 · próxima: seg 30/11") calculada com
// as mesmas regras do servidor (@jarvis/core/recorrencia), para nunca sair uma data diferente da dita.
import {
  descreverRecorrencia, normalizarRecorrencia, primeiraData, proximaData, somarDias, hojeSP,
  type Frequencia, type LembrarTarefa, type Prioridade, type Recorrencia, type Task,
} from '@jarvis/core';
import { jarvis } from './jarvis';

const NOME_PRIO: Record<Prioridade, string> = { alta: 'alta', media: 'média', baixa: 'baixa' };
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

type Quando = '' | 'hoje' | 'amanha' | 'data';
type Repetir = '' | Frequencia;
/** '' = não lembrar; número = minutos antes do prazo; 'outra' = data e hora certas. */
type Lembrar = '' | number | 'outra';
const ANTES: [number, string][] = [[0, 'Na hora'], [15, '15 min antes'], [60, '1 h antes'], [1440, '1 dia antes']];
const NOME_ANTES = (m: number) => (m === 0 ? 'na hora' : m < 60 ? `${m} min antes` : m < 1440 ? `${m / 60} h antes` : `${m / 1440} dia antes`);

interface Rascunho {
  id: string | null;
  quando: Quando;
  data: string;
  hora: string;
  repetir: Repetir;
  dias: number[];
  diaMes: number;
  prioridade: Prioridade;
  lembrar: Lembrar;
  alarme: boolean;
}

const novoRascunho = (): Rascunho => ({
  id: null, quando: '', data: '', hora: '', repetir: '', dias: [], diaMes: 1, prioridade: 'media', lembrar: '', alarme: false,
});

export function htmlFormTarefa() {
  return `
    <form class="nova form-tarefa" id="nova" autocomplete="off">
      <div class="nova-linha">
        <input name="t" placeholder="O que precisa ser feito?" maxlength="200" />
        <button class="adicionar" title="Adicionar (Enter)">+</button>
      </div>
      <div class="nova-detalhes">
        <div class="ft-campo">
          <span class="rotulo">Quando</span>
          <div class="chips" data-grupo="quando">
            <button type="button" data-v="">Sem data</button>
            <button type="button" data-v="hoje">Hoje</button>
            <button type="button" data-v="amanha">Amanhã</button>
          </div>
          <input type="date" name="data" title="Escolher a data" />
          <input type="time" name="hora" title="Hora (opcional)" />
        </div>
        <div class="ft-campo">
          <span class="rotulo">Repetir</span>
          <div class="chips" data-grupo="repetir">
            <button type="button" data-v="">Não</button>
            <button type="button" data-v="diaria">Todo dia</button>
            <button type="button" data-v="dias_uteis">Dias úteis</button>
            <button type="button" data-v="semanal">Semanal</button>
            <button type="button" data-v="mensal">Mensal</button>
          </div>
        </div>
        <div class="ft-campo sub" data-mostrar="semanal">
          <span class="rotulo"></span>
          <div class="dias-semana">
            ${LETRAS.map((l, i) => `<button type="button" data-dia="${i}" title="${NOMES_DIA[i]}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="ft-campo sub" data-mostrar="mensal">
          <span class="rotulo"></span>
          <label class="dia-mes">todo dia <input type="number" name="diames" min="1" max="31" value="1" /></label>
        </div>
        <div class="ft-campo">
          <span class="rotulo">Prioridade</span>
          <div class="prios">
            ${(['alta', 'media', 'baixa'] as Prioridade[])
              .map((p) => `<button type="button" class="prio" data-p="${p}">${NOME_PRIO[p]}</button>`).join('')}
          </div>
        </div>
        <div class="ft-campo" data-campo="lembrar">
          <span class="rotulo">Me lembrar</span>
          <div class="chips" data-grupo="lembrar">
            <button type="button" data-v="">Não</button>
            ${ANTES.map(([m, n]) => `<button type="button" data-v="${m}">${n}</button>`).join('')}
            <button type="button" data-v="outra">Outra hora</button>
          </div>
          <label class="ft-alarme" title="Toca até você desligar"><input type="checkbox" name="alarme" /> alarme</label>
        </div>
        <div class="ft-campo sub" data-lembrar="outra">
          <span class="rotulo"></span>
          <input type="date" name="ldata" title="Dia do aviso (vazio = dia da tarefa)" />
          <input type="time" name="lhora" title="Hora do aviso" />
        </div>
        <div class="ft-campo">
          <span class="rotulo">Notas</span>
          <textarea name="notas" rows="2" placeholder="Detalhes, links, o que lembrar (opcional)"></textarea>
        </div>
        <div class="nova-acoes">
          <span class="previa" id="previa"></span>
          <button type="button" class="cancelar">Cancelar</button>
          <button type="submit" class="salvar">Adicionar</button>
        </div>
      </div>
    </form>`;
}

/** Liga o formulário. Devolve `editar(tarefa)` para abrir uma tarefa da lista nele. */
export function ligarFormTarefa(form: HTMLFormElement) {
  const titulo = form.t as HTMLInputElement;
  const campoData = form.data as HTMLInputElement;
  const campoHora = form.hora as HTMLInputElement;
  const campoDiaMes = form.diames as HTMLInputElement;
  const notas = form.notas as HTMLTextAreaElement;
  const campoAlarme = form.alarme as HTMLInputElement;
  const campoLData = form.ldata as HTMLInputElement;
  const campoLHora = form.lhora as HTMLInputElement;
  const previa = form.querySelector<HTMLSpanElement>('#previa')!;
  const salvar = form.querySelector<HTMLButtonElement>('.salvar')!;
  let r = novoRascunho();

  const dataEscolhida = (): string | null => {
    const hoje = hojeSP();
    if (r.quando === 'hoje') return hoje;
    if (r.quando === 'amanha') return somarDias(hoje, 1);
    if (r.quando === 'data' && r.data) return r.data;
    return null;
  };

  const recorrencia = (): Recorrencia | null => {
    if (!r.repetir) return null;
    if (r.repetir === 'semanal') return normalizarRecorrencia({ freq: 'semanal', dias: r.dias });
    if (r.repetir === 'mensal') return normalizarRecorrencia({ freq: 'mensal', dia_mes: r.diaMes });
    return { freq: r.repetir };
  };

  function desenhar() {
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="quando"] button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.v === r.quando));
    // Com repetição, sem escolher data = a próxima ocorrência é calculada sozinha.
    form.querySelector<HTMLButtonElement>('[data-grupo="quando"] [data-v=""]')!.textContent = r.repetir ? 'Automático' : 'Sem data';
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="repetir"] button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.v === r.repetir));
    form.querySelectorAll<HTMLButtonElement>('.dias-semana button').forEach((b) =>
      b.classList.toggle('ativa', r.dias.includes(Number(b.dataset.dia))));
    form.querySelectorAll<HTMLButtonElement>('.prio').forEach((b) => b.classList.toggle('ativa', b.dataset.p === r.prioridade));
    form.querySelectorAll<HTMLElement>('[data-mostrar]').forEach((el) => { el.hidden = el.dataset.mostrar !== r.repetir; });
    // "Me lembrar" só ao criar (o lembrete de uma tarefa que já existe se edita na aba Lembretes).
    form.querySelector<HTMLElement>('[data-campo="lembrar"]')!.hidden = !!r.id;
    form.querySelector<HTMLElement>('[data-lembrar="outra"]')!.hidden = !!r.id || r.lembrar !== 'outra';
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="lembrar"] button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.v === String(r.lembrar)));
    form.querySelector<HTMLElement>('.ft-alarme')!.hidden = r.lembrar === '';
    campoData.classList.toggle('ativa', r.quando === 'data');
    if (r.quando !== 'data') campoData.value = '';
    salvar.textContent = r.id ? 'Salvar' : 'Adicionar';
    form.classList.toggle('editando', !!r.id);

    // Prévia em palavras, com a data que vai ser gravada de verdade.
    const hora = r.hora ? ` às ${r.hora}` : '';
    const rec = recorrencia();
    const data = dataEscolhida();
    let texto = '';
    if (r.repetir === 'semanal' && !rec) texto = 'Escolha os dias da semana.';
    else if (rec) {
      const primeira = (data && proximaData(rec, data, true)) || primeiraData(rec, r.hora || null);
      texto = `${descreverRecorrencia(rec)}${hora}${primeira ? ` · próxima: ${rotulo(primeira)}` : ''}`;
    } else if (data) texto = `${rotulo(data)}${hora}`;
    else texto = r.hora ? `hoje${hora}` : 'sem data';
    if (!r.id && typeof r.lembrar === 'number') {
      texto += r.hora ? ` · aviso ${NOME_ANTES(r.lembrar)}` : ' · para avisar antes, escolha a hora';
    } else if (!r.id && r.lembrar === 'outra') {
      texto += campoLHora.value ? ` · aviso ${campoLData.value ? rotulo(campoLData.value) : 'no dia'} às ${campoLHora.value}` : ' · escolha a hora do aviso';
    }
    previa.textContent = texto;
    previa.classList.remove('erro');
  }

  const rotulo = (data: string) => {
    const hoje = hojeSP();
    if (data === hoje) return 'hoje';
    if (data === somarDias(hoje, 1)) return 'amanhã';
    const [, m, d] = data.split('-');
    return `${CURTO[new Date(`${data}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
  };

  function limpar() {
    r = novoRascunho();
    titulo.value = '';
    campoHora.value = '';
    campoDiaMes.value = '1';
    notas.value = '';
    campoAlarme.checked = false;
    campoLData.value = '';
    campoLHora.value = '';
    form.classList.remove('aberta');
    desenhar();
  }

  form.addEventListener('focusin', () => form.classList.add('aberta'));
  form.querySelector<HTMLButtonElement>('.cancelar')!.onclick = limpar;
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      limpar();
      titulo.blur();
    }
  });

  form.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.type === 'submit' || b.classList.contains('cancelar')) return;
    const grupo = b.closest<HTMLElement>('[data-grupo]')?.dataset.grupo;
    if (grupo === 'quando') r.quando = b.dataset.v as Quando;
    else if (grupo === 'lembrar') {
      const v = b.dataset.v ?? '';
      r.lembrar = v === '' || v === 'outra' ? v : Number(v);
    }
    else if (grupo === 'repetir') {
      r.repetir = b.dataset.v as Repetir;
      // Semanal sem dias: começa pelo dia da data escolhida (ou de hoje).
      if (r.repetir === 'semanal' && !r.dias.length) {
        r.dias = [new Date(`${dataEscolhida() ?? hojeSP()}T12:00:00Z`).getUTCDay()];
      }
      if (r.repetir === 'mensal') {
        r.diaMes = Number((dataEscolhida() ?? hojeSP()).slice(8, 10));
        campoDiaMes.value = String(r.diaMes);
      }
    } else if (b.dataset.dia !== undefined) {
      const d = Number(b.dataset.dia);
      r.dias = r.dias.includes(d) ? r.dias.filter((x) => x !== d) : [...r.dias, d].sort();
    } else if (b.dataset.p) r.prioridade = b.dataset.p as Prioridade;
    desenhar();
  };
  campoData.oninput = () => {
    r.data = campoData.value;
    r.quando = campoData.value ? 'data' : '';
    desenhar();
  };
  campoHora.oninput = () => {
    r.hora = campoHora.value;
    desenhar();
  };
  campoAlarme.onchange = () => { r.alarme = campoAlarme.checked; };
  campoLData.oninput = campoLHora.oninput = () => desenhar();
  campoDiaMes.oninput = () => {
    r.diaMes = Math.min(31, Math.max(1, Number(campoDiaMes.value) || 1));
    desenhar();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = titulo.value.trim();
    if (!t) {
      titulo.focus();
      return;
    }
    const rec = recorrencia();
    if (r.repetir === 'semanal' && !rec) return;
    // Hora sem data (e sem repetir) = hoje.
    const data = dataEscolhida() ?? (r.hora && !rec ? hojeSP() : null);
    const hora = r.hora || null;
    if (r.id) {
      await jarvis.tarefas.editar(r.id, {
        titulo: t, prioridade: r.prioridade, data, hora, repetir: rec, notas: notas.value,
      });
    } else {
      let lembrar: LembrarTarefa | null = null;
      if (typeof r.lembrar === 'number') lembrar = { antes_minutos: r.lembrar, alarme: r.alarme };
      else if (r.lembrar === 'outra') {
        if (!campoLHora.value) return campoLHora.focus();
        lembrar = { data: campoLData.value || null, hora: campoLHora.value, alarme: r.alarme };
      }
      try {
        await jarvis.tarefas.criar(t, r.prioridade, data, hora, { repetir: rec, notas: notas.value, lembrar });
      } catch (err) {
        // Lembrete impossível (sem hora, hora passada): nada foi criado; avisa e deixa corrigir.
        previa.textContent = err instanceof Error ? err.message : String(err);
        previa.classList.add('erro');
        return;
      }
    }
    limpar();
  };

  desenhar();

  return {
    editar(t: Task) {
      const hoje = hojeSP();
      r = {
        id: t.id,
        quando: !t.due_date ? '' : t.due_date === hoje ? 'hoje' : t.due_date === somarDias(hoje, 1) ? 'amanha' : 'data',
        data: t.due_date ?? '',
        hora: t.due_time?.slice(0, 5) ?? '',
        repetir: t.recurrence?.freq ?? '',
        dias: t.recurrence?.dias ?? [],
        diaMes: t.recurrence?.dia_mes ?? 1,
        prioridade: t.priority,
        lembrar: '',
        alarme: false,
      };
      titulo.value = t.title;
      campoData.value = r.quando === 'data' ? r.data : '';
      campoHora.value = r.hora;
      campoDiaMes.value = String(r.diaMes);
      notas.value = t.notes ?? '';
      form.classList.add('aberta');
      desenhar();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titulo.focus();
    },
  };
}
