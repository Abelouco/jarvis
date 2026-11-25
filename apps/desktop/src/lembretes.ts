// Aba Lembretes (Fase 2 · Etapa 2): formulário, lista e o vigia que avisa na hora certa.
// Aviso = notificação do Windows + faixa no app (Feito / +10 min). Com "alarme", toca um som até o dono responder.
// O vigia roda enquanto o app está aberto (mesmo minimizado). Lembrete que venceu com o app fechado
// avisa assim que o app abrir.
import {
  descreverRecorrencia, hojeSP, normalizarRecorrencia, partesSP, primeiraData, proximaData, somarDias,
  type Frequencia, type Recorrencia, type Reminder,
} from '@jarvis/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function rotuloData(data: string) {
  const hoje = hojeSP();
  if (data === hoje) return 'hoje';
  if (data === somarDias(hoje, 1)) return 'amanhã';
  if (data === somarDias(hoje, -1)) return 'ontem';
  const [, m, d] = data.split('-');
  return `${CURTO[new Date(`${data}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
}
const quando = (l: Pick<Reminder, 'remind_at'>) => {
  const { data, hora } = partesSP(l.remind_at);
  return `${rotuloData(data)} · ${hora}`;
};

export function htmlLembretes() {
  return `
    <form class="nova form-tarefa" id="novo-lembrete" autocomplete="off">
      <div class="nova-linha">
        <input name="t" placeholder="Do que devo te lembrar?" maxlength="200" />
        <button class="adicionar" title="Adicionar (Enter)">+</button>
      </div>
      <div class="nova-detalhes">
        <div class="ft-campo">
          <span class="rotulo">Quando</span>
          <div class="chips" data-grupo="atalho">
            <button type="button" data-min="10">em 10 min</button>
            <button type="button" data-min="30">em 30 min</button>
            <button type="button" data-min="60">em 1 h</button>
            <button type="button" data-dia="hoje">Hoje</button>
            <button type="button" data-dia="amanha">Amanhã</button>
          </div>
          <input type="date" name="data" title="Data" />
          <input type="time" name="hora" title="Hora" required />
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
            ${LETRAS.map((l, i) => `<button type="button" data-ds="${i}" title="${NOMES_DIA[i]}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="ft-campo sub" data-mostrar="mensal">
          <span class="rotulo"></span>
          <label class="dia-mes">todo dia <input type="number" name="diames" min="1" max="31" value="1" /></label>
        </div>
        <div class="ft-campo">
          <span class="rotulo">Alarme</span>
          <label class="alarme-op"><input type="checkbox" name="alarme" /> tocar um som até eu responder</label>
        </div>
        <div class="ft-campo">
          <span class="rotulo">Notas</span>
          <textarea name="notas" rows="2" placeholder="Detalhes (opcional)"></textarea>
        </div>
        <div class="nova-acoes">
          <span class="previa" id="previa-lembrete"></span>
          <button type="button" class="cancelar">Cancelar</button>
          <button type="submit" class="salvar">Adicionar</button>
        </div>
      </div>
    </form>
    <p class="dica-tarefas">Ou peça na conversa: <em>"me lembra daqui a 20 minutos de tirar o bolo"</em>,
      <em>"todo dia às 7h tomar remédio, com alarme"</em>. Clique num lembrete para editar.</p>
    <div id="lista-lembretes"></div>`;
}

interface Opcoes {
  /** Pulso no núcleo quando um lembrete dispara. */
  pulsar?: () => void;
  /** Fala o aviso (se a voz estiver ligada). */
  falar?: (texto: string) => void;
}

export function ligarLembretes(raiz: HTMLElement, op: Opcoes = {}) {
  const form = raiz.querySelector<HTMLFormElement>('#novo-lembrete')!;
  const lista = raiz.querySelector<HTMLDivElement>('#lista-lembretes')!;
  const titulo = form.t as HTMLInputElement;
  const campoData = form.data as HTMLInputElement;
  const campoHora = form.hora as HTMLInputElement;
  const campoDiaMes = form.diames as HTMLInputElement;
  const alarme = form.alarme as HTMLInputElement;
  const notas = form.notas as HTMLTextAreaElement;
  const previa = form.querySelector<HTMLSpanElement>('#previa-lembrete')!;
  const salvar = form.querySelector<HTMLButtonElement>('.salvar')!;

  let editando: string | null = null;
  let repetir: '' | Frequencia = '';
  let dias: number[] = [];
  let todos: Reminder[] = [];

  const recorrencia = (): Recorrencia | null => {
    if (!repetir) return null;
    if (repetir === 'semanal') return normalizarRecorrencia({ freq: 'semanal', dias });
    if (repetir === 'mensal') return normalizarRecorrencia({ freq: 'mensal', dia_mes: Number(campoDiaMes.value) || 1 });
    return { freq: repetir };
  };

  /** Data efetiva: a escolhida; sem data, hoje se a hora não passou, senão amanhã. */
  const dataEfetiva = (): string | null => {
    if (campoData.value) return campoData.value;
    if (recorrencia()) return null;
    const agoraHM = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return campoHora.value && campoHora.value <= agoraHM ? somarDias(hojeSP(), 1) : hojeSP();
  };

  function desenharForm() {
    form.querySelectorAll<HTMLButtonElement>('[data-grupo="repetir"] button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.v === repetir));
    form.querySelectorAll<HTMLButtonElement>('[data-ds]').forEach((b) =>
      b.classList.toggle('ativa', dias.includes(Number(b.dataset.ds))));
    form.querySelectorAll<HTMLElement>('[data-mostrar]').forEach((el) => { el.hidden = el.dataset.mostrar !== repetir; });
    salvar.textContent = editando ? 'Salvar' : 'Adicionar';
    form.classList.toggle('editando', !!editando);
    const rec = recorrencia();
    const hora = campoHora.value;
    let texto: string;
    if (!hora) texto = 'Escolha a hora.';
    else if (repetir === 'semanal' && !rec) texto = 'Escolha os dias da semana.';
    else if (rec) {
      const d = (campoData.value && proximaData(rec, campoData.value, true)) || primeiraData(rec, hora);
      texto = `${descreverRecorrencia(rec)} às ${hora}${d ? ` · próximo: ${rotuloData(d)}` : ''}`;
    } else texto = `${rotuloData(dataEfetiva()!)} às ${hora}`;
    previa.textContent = `${texto}${alarme.checked ? ' · com alarme' : ''}`;
  }

  function limpar() {
    editando = null;
    repetir = '';
    dias = [];
    form.reset();
    form.classList.remove('aberta');
    desenharForm();
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
  form.addEventListener('input', desenharForm);
  form.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.type === 'submit' || b.classList.contains('cancelar')) return;
    if (b.dataset.min) {
      // "em 10 min": hoje, agora + N minutos.
      const d = new Date(Date.now() + Number(b.dataset.min) * 60_000);
      const p = partesSP(d.toISOString());
      campoData.value = p.data;
      campoHora.value = p.hora;
    } else if (b.dataset.dia) {
      campoData.value = b.dataset.dia === 'hoje' ? hojeSP() : somarDias(hojeSP(), 1);
      if (!campoHora.value) campoHora.value = '09:00';
    } else if (b.dataset.v !== undefined && b.closest('[data-grupo="repetir"]')) {
      repetir = b.dataset.v as typeof repetir;
      const base = campoData.value || hojeSP();
      if (repetir === 'semanal' && !dias.length) dias = [new Date(`${base}T12:00:00Z`).getUTCDay()];
      if (repetir === 'mensal') campoDiaMes.value = String(Number(base.slice(8, 10)));
    } else if (b.dataset.ds !== undefined) {
      const d = Number(b.dataset.ds);
      dias = dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d].sort();
    }
    desenharForm();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = titulo.value.trim();
    if (!t) return titulo.focus();
    if (!campoHora.value) return campoHora.focus();
    const rec = recorrencia();
    if (repetir === 'semanal' && !rec) return;
    const dados = { repetir: rec, notas: notas.value, alarme: alarme.checked };
    try {
      if (editando) {
        await jarvis.lembretes.editar(editando, { titulo: t, data: campoData.value || dataEfetiva(), hora: campoHora.value, ...dados });
      } else {
        await jarvis.lembretes.criar(t, campoData.value || dataEfetiva(), campoHora.value, dados);
      }
      limpar();
      void pedirPermissao();
    } catch (err) {
      previa.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  function editar(l: Reminder) {
    const p = partesSP(l.remind_at);
    editando = l.id;
    titulo.value = l.title;
    campoData.value = p.data;
    campoHora.value = p.hora;
    repetir = l.recurrence?.freq ?? '';
    dias = l.recurrence?.dias ?? [];
    campoDiaMes.value = String(l.recurrence?.dia_mes ?? 1);
    alarme.checked = l.alarm;
    notas.value = l.notes ?? '';
    form.classList.add('aberta');
    desenharForm();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titulo.focus();
  }

  // ---------- lista ----------
  function item(l: Reminder) {
    const venceu = !l.done_at && Date.parse(l.remind_at) <= Date.now();
    const rep = l.recurrence ? `<span class="rep">↻ ${descreverRecorrencia(l.recurrence)}</span>` : '';
    return `<li class="tarefa lembrete ${l.done_at ? 'feita' : ''}" data-id="${l.id}" data-p="${l.priority}">
      <button class="check" title="${l.done_at ? 'Reativar' : l.recurrence ? 'Feito (passa para o próximo)' : 'Feito'}">${l.done_at ? '✓' : ''}</button>
      <span class="titulo" title="Clique para editar">${esc(l.title)}</span>
      ${l.alarm ? '<span class="nota" title="Com alarme">⏰</span>' : ''}${l.notes ? `<span class="nota" title="${esc(l.notes)}">≡</span>` : ''}${rep}
      <span class="quando ${venceu ? 'atrasada' : ''}">${quando(l)}</span>
      <button class="apagar" title="Apagar">×</button>
    </li>`;
  }
  function secao(nome: string, ls: Reminder[], classe = '') {
    return ls.length ? `<section class="secao ${classe}"><h3>${nome} <b>${ls.length}</b></h3><ul class="lista">${ls.map(item).join('')}</ul></section>` : '';
  }
  async function desenharLista() {
    todos = await jarvis.lembretes.listar();
    const agora = Date.now();
    const hoje = hojeSP();
    const ativos = todos.filter((l) => !l.done_at);
    const vencidos = ativos.filter((l) => Date.parse(l.remind_at) <= agora);
    const deHoje = ativos.filter((l) => Date.parse(l.remind_at) > agora && partesSP(l.remind_at).data === hoje);
    const depois = ativos.filter((l) => partesSP(l.remind_at).data > hoje);
    const feitos = todos.filter((l) => l.done_at && Date.parse(l.done_at) > agora - 7 * 864e5).slice(0, 10);
    lista.innerHTML = ativos.length || feitos.length
      ? [secao('Já passaram', vencidos, 'secao-atrasadas'), secao('Hoje', deHoje, 'secao-hoje'),
        secao('Próximos', depois), secao('Concluídos', feitos)].join('')
      : '<div class="vazio"><strong>Nenhum lembrete.</strong>Escreva acima ou peça na conversa.</div>';
  }
  lista.onclick = (e) => {
    const alvo = e.target as HTMLElement;
    const id = alvo.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;
    const l = todos.find((x) => x.id === id);
    if (!l) return;
    if (alvo.closest('.apagar')) void jarvis.lembretes.apagar(id);
    else if (alvo.closest('.check')) void (l.done_at ? jarvis.lembretes.reabrir(id) : jarvis.lembretes.concluir(id));
    else if (alvo.closest('.titulo, .quando') && !l.done_at) editar(l);
  };

  // ---------- o vigia ----------
  // Já avisados (id + hora): não repete o mesmo aviso. Guardado para não avisar de novo ao reabrir o app.
  const CHAVE = 'jarvis.lembretes.avisados';
  const avisados = new Set<string>(JSON.parse(localStorage.getItem(CHAVE) ?? '[]') as string[]);
  const guardar = () => localStorage.setItem(CHAVE, JSON.stringify([...avisados].slice(-300)));
  /** Soneca de lembrete fixo (a hora da série não muda no banco). */
  const sonecas = new Map<string, number>();
  const faixa = document.createElement('div');
  faixa.className = 'avisos-lembrete';
  document.body.append(faixa);
  let somAlarme: (() => void) | null = null;

  async function pedirPermissao() {
    try {
      if (!(await isPermissionGranted())) await requestPermission();
    } catch {
      /* fora do Tauri (navegador): só a faixa no app */
    }
  }

  function tocarAlarme() {
    if (somAlarme) return;
    const ctx = new AudioContext();
    const bipe = () => {
      for (const [i, f] of [880, 660, 880].entries()) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.22);
        o.stop(ctx.currentTime + i * 0.22 + 0.21);
      }
    };
    bipe();
    const t = setInterval(bipe, 1600);
    somAlarme = () => {
      clearInterval(t);
      void ctx.close();
      somAlarme = null;
    };
  }
  function pararAlarmeSeNinguem() {
    if (!faixa.querySelector('[data-alarme="1"]')) somAlarme?.();
  }

  function mostrarAviso(l: Reminder) {
    if (faixa.querySelector(`[data-id="${l.id}"]`)) return;
    const el = document.createElement('div');
    el.className = 'aviso-lembrete';
    el.dataset.id = l.id;
    el.dataset.alarme = l.alarm ? '1' : '0';
    el.innerHTML = `<span class="sino">${l.alarm ? '⏰' : '🔔'}</span>
      <div class="txt"><strong>${esc(l.title)}</strong><small>${quando(l)}${l.notes ? ` · ${esc(l.notes.slice(0, 80))}` : ''}</small></div>
      <button data-a="soneca">+10 min</button><button data-a="feito" class="feito">Feito</button>`;
    el.onclick = async (e) => {
      const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.a;
      if (!a) return;
      el.remove();
      pararAlarmeSeNinguem();
      if (a === 'feito') await jarvis.lembretes.concluir(l.id);
      else if (!(await jarvis.lembretes.adiar(l.id, 10))) sonecas.set(l.id, Date.now() + 10 * 60_000);
    };
    faixa.append(el);
  }

  function avisar(l: Reminder) {
    mostrarAviso(l);
    op.pulsar?.();
    if (l.alarm) tocarAlarme();
    op.falar?.(`Senhor, lembrete: ${l.title}.`);
    void (async () => {
      try {
        if (await isPermissionGranted()) sendNotification({ title: l.title, body: `Lembrete · ${quando(l)}${l.notes ? `\n${l.notes}` : ''}` });
      } catch {
        /* sem notificação do sistema: a faixa no app basta */
      }
    })();
  }

  async function vigiar() {
    const agora = Date.now();
    for (const l of await jarvis.lembretes.listar()) {
      if (l.done_at || l.deleted_at) continue;
      const soneca = sonecas.get(l.id);
      const chave = `${l.id}|${l.remind_at}`;
      if (soneca) {
        if (soneca <= agora) {
          sonecas.delete(l.id);
          avisar(l);
        }
        continue;
      }
      if (Date.parse(l.remind_at) > agora || avisados.has(chave)) continue;
      avisados.add(chave);
      guardar();
      // Venceu há mais de 12 h (app ficou fechado): só mostra na lista, sem alarme.
      if (agora - Date.parse(l.remind_at) > 12 * 3600_000) continue;
      avisar(l);
    }
    // Faixas de lembretes que foram concluídos em outro lugar somem.
    const ativos = new Set(todos.filter((l) => !l.done_at).map((l) => l.id));
    faixa.querySelectorAll<HTMLElement>('.aviso-lembrete').forEach((el) => {
      if (!ativos.has(el.dataset.id!) && !sonecas.has(el.dataset.id!)) el.remove();
    });
    pararAlarmeSeNinguem();
  }

  jarvis.aoMudar(() => void desenharLista());
  void desenharLista();
  void pedirPermissao();
  setInterval(() => void vigiar(), 15_000);
  setTimeout(() => void vigiar(), 3_000);
  // A lista muda de grupo com o tempo ("Hoje" -> "Já passaram").
  setInterval(() => void desenharLista(), 60_000);
  desenharForm();
}
