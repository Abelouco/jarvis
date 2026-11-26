// Aba Avisos (Fase 3 · Etapa 6): o que o J.A.R.V.I.S. avisou sozinho, com o porquê, e os ajustes.
// Lê e escreve direto no Supabase por jarvis.avisos.* (avisos não ficam no banco local).
import { partesSP, hojeSP, type Notice, type NoticeSettings, type TipoAviso } from '@jarvis/core';
import { jarvis } from './jarvis';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const NOME_TIPO: Record<TipoAviso, string> = {
  tarefa_atrasada: 'Tarefa atrasada',
  lembrete_hora: 'Lembrete',
  habito_sequencia: 'Sequência de hábito',
  prazo_projeto: 'Prazo de projeto',
  diario_vazio: 'Diário em branco',
  resumo_manha: 'Resumo da manhã',
  resumo_noite: 'Resumo da noite',
};

const NOME_STATUS: Record<Notice['status'], string> = {
  enviado: '',
  segurado_silencio: 'segurado pelo silêncio',
  juntado: 'junto com outros',
  silenciado: 'silenciado por você',
  agendado: 'agendado',
};

/** "hoje 14:05", "ontem 21:00", "24/11 08:00" */
function quando(iso: string): string {
  const { data, hora } = partesSP(iso);
  const hoje = hojeSP();
  if (data === hoje) return `hoje ${hora}`;
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (data === ontem.toISOString().slice(0, 10)) return `ontem ${hora}`;
  return `${data.slice(8, 10)}/${data.slice(5, 7)} ${hora}`;
}

/** "PC", "celular", "PC e celular" */
function canais(c: string[]): string {
  const pc = c.includes('pc') || c.includes('pc_local');
  const cel = c.includes('push');
  return pc && cel ? 'PC e celular' : pc ? 'PC' : cel ? 'celular' : '';
}

const hm = (t: string) => t.slice(0, 5);

export function htmlAvisos(): string {
  return `
<div class="av">
  <header class="av-topo">
    <div>
      <h2>Avisos</h2>
      <p class="av-sub">O que eu avisei sozinho, e por quê. Peça ajustes na conversa também: <em>"silencia o diário até amanhã"</em>, <em>"resumo da manhã às 9h"</em>.</p>
    </div>
    <button type="button" class="av-lidos" hidden>Marcar todos como vistos</button>
  </header>
  <p class="av-erro" hidden></p>
  <div class="av-grade">
    <section class="av-historico"><h3>Histórico</h3><ul class="av-lista"></ul></section>
    <aside class="av-lado">
      <section class="av-cartao">
        <h3>Ajustes</h3>
        <form class="av-prefs">
          <label class="av-ligado"><input type="checkbox" name="enabled" /> Avisos ligados</label>
          <fieldset><legend>Silêncio</legend>
            <label>das <input type="time" name="quiet_start" required /></label>
            <label>às <input type="time" name="quiet_end" required /></label>
            <small>Avisos normais esperam; urgentes furam o silêncio.</small>
          </fieldset>
          <fieldset><legend>Resumos</legend>
            <label>manhã <input type="time" name="morning_at" required /></label>
            <label>noite <input type="time" name="evening_at" required /></label>
          </fieldset>
          <button class="av-salvar">Salvar</button> <span class="av-salvo"></span>
        </form>
      </section>
      <section class="av-cartao">
        <h3>O que você pediu</h3>
        <ul class="av-regras"></ul>
      </section>
    </aside>
  </div>
</div>`;
}

export function ligarAbaAvisos(raiz: HTMLElement, op: { selo?: (n: number) => void } = {}) {
  const lista = raiz.querySelector<HTMLUListElement>('.av-lista')!;
  const regrasEl = raiz.querySelector<HTMLUListElement>('.av-regras')!;
  const form = raiz.querySelector<HTMLFormElement>('.av-prefs')!;
  const erroEl = raiz.querySelector<HTMLParagraphElement>('.av-erro')!;
  const lidosBtn = raiz.querySelector<HTMLButtonElement>('.av-lidos')!;
  const salvoEl = raiz.querySelector<HTMLSpanElement>('.av-salvo')!;

  let desenhando = false;
  let deNovo = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function statusTexto(a: Notice): string {
    if ((a.status === 'agendado' || a.status === 'segurado_silencio') && a.scheduled_for) {
      return `sai ${quando(a.scheduled_for)}`;
    }
    return NOME_STATUS[a.status];
  }

  function desenharHistorico(avisos: Notice[]) {
    const principais = avisos.filter((a) => a.group_id === null);
    const filhos = new Map<string, Notice[]>();
    for (const a of avisos) {
      if (!a.group_id) continue;
      const arr = filhos.get(a.group_id) ?? [];
      arr.push(a);
      filhos.set(a.group_id, arr);
    }

    if (!principais.length) {
      lista.innerHTML = '<li class="av-vazio">Nenhum aviso ainda. O primeiro deve ser um resumo (manhã ou noite).</li>';
      return;
    }

    lista.innerHTML = principais.map((a) => {
      const classes = ['av-item'];
      if (a.status === 'enviado' && !a.read_at) classes.push('av-nao-lido');
      if (a.priority === 'urgente') classes.push('av-urgente');
      if (a.status === 'silenciado') classes.push('av-apagado');

      const canal = canais(a.channels);
      const st = statusTexto(a);
      const filhosDo = filhos.get(a.id);
      const blocoFilhos = filhosDo?.length
        ? `<details class="av-filhos"><summary>ver os ${filhosDo.length}</summary><ul>${
          filhosDo.map((f) => `<li><strong>${esc(f.title)}</strong><p class="av-motivo"><b>Por quê:</b> ${esc(f.reason)}</p></li>`).join('')
        }</ul></details>`
        : '';

      return `<li class="${classes.join(' ')}" data-id="${a.id}">
        <div class="av-meta">
          <span class="av-tipo">${NOME_TIPO[a.kind]}</span>
          <span class="av-quando">${quando(a.sent_at ?? a.created_at)}</span>
          ${canal ? `<span class="av-canal">${esc(canal)}</span>` : ''}
          ${st ? `<span class="av-status">${esc(st)}</span>` : ''}
        </div>
        <strong>${esc(a.title)}</strong>
        <p class="av-corpo">${esc(a.body)}</p>
        <p class="av-motivo"><b>Por quê:</b> ${esc(a.reason)}</p>
        ${blocoFilhos}
      </li>`;
    }).join('');
  }

  function desenharRegras(regras: Awaited<ReturnType<typeof jarvis.avisos.regras>>) {
    if (!regras.length) {
      regrasEl.innerHTML = '<li class="av-vazio">Nenhum ajuste. Tudo no padrão.</li>';
      return;
    }
    const agora = Date.now();
    regrasEl.innerHTML = regras.map((r) => {
      const nome = NOME_TIPO[r.kind] + (r.nome ? ` · ${esc(r.nome)}` : '');
      let texto = '';
      if (!r.active) texto = 'desligado';
      else if (r.muted_until && Date.parse(r.muted_until) > agora) texto = `silenciado até ${quando(r.muted_until)}`;
      else if (r.fixed_time) texto = `só às ${hm(r.fixed_time)}`;
      return `<li data-id="${r.id}"><span>${nome}: ${esc(texto)}</span> <button type="button" class="av-normal">voltar ao normal</button></li>`;
    }).join('');
  }

  function preencherForm(p: NoticeSettings) {
    if (form.contains(document.activeElement)) return;
    (form.elements.namedItem('enabled') as HTMLInputElement).checked = p.enabled;
    (form.elements.namedItem('quiet_start') as HTMLInputElement).value = hm(p.quiet_start);
    (form.elements.namedItem('quiet_end') as HTMLInputElement).value = hm(p.quiet_end);
    (form.elements.namedItem('morning_at') as HTMLInputElement).value = hm(p.morning_at);
    (form.elements.namedItem('evening_at') as HTMLInputElement).value = hm(p.evening_at);
  }

  async function desenhar(): Promise<void> {
    if (desenhando) {
      deNovo = true;
      return;
    }
    desenhando = true;
    deNovo = false;
    try {
      let avisos: Notice[];
      let regras: Awaited<ReturnType<typeof jarvis.avisos.regras>>;
      let prefs: NoticeSettings;
      let naoLidos: number;
      try {
        [avisos, regras, prefs, naoLidos] = await Promise.all([
          jarvis.avisos.listar(60),
          jarvis.avisos.regras(),
          jarvis.avisos.preferencias(),
          jarvis.avisos.naoLidos(),
        ]);
        erroEl.hidden = true;
        erroEl.textContent = '';
      } catch {
        erroEl.textContent = 'Sem conexão com o servidor: os avisos ficam lá. Tente de novo em instantes.';
        erroEl.hidden = false;
        return;
      }
      op.selo?.(naoLidos);
      lidosBtn.hidden = naoLidos <= 0;
      desenharHistorico(avisos);
      desenharRegras(regras);
      preencherForm(prefs);
    } finally {
      desenhando = false;
      if (deNovo) void desenhar();
    }
  }

  function agendar() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void desenhar();
    }, 400);
  }

  /** Ação no servidor: sem internet, mostra o erro em vez de falhar calada. */
  async function agir(f: () => Promise<void>) {
    try {
      await f();
      void desenhar();
    } catch {
      erroEl.textContent = 'Sem conexão com o servidor: não consegui salvar. Tente de novo em instantes.';
      erroEl.hidden = false;
    }
  }

  lista.onclick = (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('summary, details ul')) return;
    const id = alvo.closest<HTMLLIElement>('.av-item.av-nao-lido')?.dataset.id;
    if (id) void agir(() => jarvis.avisos.marcarLidos([id]));
  };

  lidosBtn.onclick = () => void agir(() => jarvis.avisos.marcarLidos());

  regrasEl.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.av-normal');
    const id = btn?.closest<HTMLLIElement>('li[data-id]')?.dataset.id;
    if (id) void agir(() => jarvis.avisos.removerRegra(id));
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const enabled = form.elements.namedItem('enabled') as HTMLInputElement;
    const quietStart = form.elements.namedItem('quiet_start') as HTMLInputElement;
    const quietEnd = form.elements.namedItem('quiet_end') as HTMLInputElement;
    const morningAt = form.elements.namedItem('morning_at') as HTMLInputElement;
    const eveningAt = form.elements.namedItem('evening_at') as HTMLInputElement;
    try {
      await jarvis.avisos.salvarPreferencias({
        enabled: enabled.checked,
        quiet_start: quietStart.value,
        quiet_end: quietEnd.value,
        morning_at: morningAt.value,
        evening_at: eveningAt.value,
      });
      salvoEl.textContent = 'Salvo ✓';
      setTimeout(() => { salvoEl.textContent = ''; }, 2000);
    } catch (err) {
      salvoEl.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  jarvis.aoEvento((e) => {
    if (e.entity_type === 'notices' || e.entity_type === 'notice_rules' || e.entity_type === 'notice_settings') agendar();
  });

  void desenhar();
  return { recarregar: () => void desenhar() };
}
