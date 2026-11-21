import type { JarvisEvent, Prioridade, Task } from '@jarvis/core';
import { jarvis } from './jarvis';
import './estilo.css';
import { montarNucleo, type NucleoMontado } from './nucleo3d';

const app = document.querySelector<HTMLDivElement>('#app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;

// Só um núcleo 3D vivo por vez (um contexto WebGL).
let nucleo: NucleoMontado | null = null;
function trocarNucleo(caixa: HTMLElement | null, densidade = 1) {
  nucleo?.destruir();
  nucleo = caixa ? montarNucleo(caixa, densidade) : null;
}

const NOME_PRIO: Record<Prioridade, string> = { alta: 'alta', media: 'média', baixa: 'baixa' };
const NOME_EVENTO: Record<string, string> = { created: 'criada', updated: 'atualizada', deleted: 'apagada' };
const NOME_ENTIDADE: Record<string, string> = {
  tasks: 'Tarefa', projects: 'Projeto', reminders: 'Lembrete', habits: 'Hábito',
  habit_logs: 'Registro de hábito', memories: 'Memória', memory_links: 'Ligação de memória',
};
const NOME_ESTADO = { parado: 'sincronizado', sincronizando: 'sincronizando', offline: 'offline', erro: 'erro no sync' };

let tela: 'login' | 'painel' | null = null;

async function decidirTela() {
  const logado = !!(await jarvis.auth.sessao());
  const nova = logado ? 'painel' : 'login';
  if (nova === tela) return;
  tela = nova;
  if (logado) montarPainel();
  else montarLogin();
}

// ======================= login =======================

let modoCriar = false;

function montarLogin() {
  app.innerHTML = `
    <section class="entrada">
      <div class="entrada-caixa">
        <div class="nucleo3d hero" id="nucleo"></div>
        <div class="marca">
          <h1>J.A.R.V.I.S.</h1>
          <p>assistente pessoal · núcleo online</p>
        </div>
        <form class="cartao" id="login" novalidate>
          <div class="abas" role="tablist">
            <button type="button" data-m="entrar">Entrar</button>
            <button type="button" data-m="criar">Criar conta</button>
          </div>
          <div class="campo">
            <label for="email">E-mail</label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="voce@exemplo.com" required />
          </div>
          <div class="campo">
            <label for="senha">Senha</label>
            <input id="senha" name="senha" type="password" placeholder="••••••••" required />
          </div>
          <button class="primario" id="enviar"></button>
          <p class="aviso" id="aviso"></p>
        </form>
      </div>
    </section>`;

  const form = $<HTMLFormElement>('#login');
  const aviso = $<HTMLParagraphElement>('#aviso');
  const enviar = $<HTMLButtonElement>('#enviar');
  const senha = $<HTMLInputElement>('#senha');

  const aplicarModo = () => {
    form.querySelectorAll<HTMLButtonElement>('.abas button').forEach((b) =>
      b.classList.toggle('ativa', (b.dataset.m === 'criar') === modoCriar),
    );
    enviar.textContent = modoCriar ? 'Criar conta' : 'Entrar';
    senha.autocomplete = modoCriar ? 'new-password' : 'current-password';
    senha.placeholder = modoCriar ? 'mínimo de 6 caracteres' : '••••••••';
  };
  const avisar = (txt: string, ok = false) => {
    aviso.textContent = txt;
    aviso.classList.toggle('ok', ok);
  };

  form.querySelectorAll<HTMLButtonElement>('.abas button').forEach((b) => {
    b.onclick = () => {
      modoCriar = b.dataset.m === 'criar';
      avisar('');
      aplicarModo();
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = (form.email as HTMLInputElement).value;
    if (!email || !senha.value) return avisar('Preencha e-mail e senha.');
    enviar.disabled = true;
    avisar('');
    try {
      if (!modoCriar) await jarvis.auth.entrar(email, senha.value);
      else if (!(await jarvis.auth.criarConta(email, senha.value))) {
        modoCriar = false;
        aplicarModo();
        avisar('Conta criada. Confirme pelo link no seu e-mail e depois entre.', true);
      }
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err));
    } finally {
      enviar.disabled = false;
    }
  };

  aplicarModo();
  trocarNucleo($('#nucleo'));
  (form.email as HTMLInputElement).focus();
}

// ======================= painel =======================

let prioridade: Prioridade = 'media';
const pulsos: JarvisEvent[] = [];

function saudacao() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function dataHoje() {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function montarPainel() {
  const email = (await jarvis.auth.sessao())?.user.email ?? '';
  app.innerHTML = `
    <section class="painel">
      <header class="topo">
        <span class="sinal"></span>
        <span class="nome">J.A.R.V.I.S.</span>
        <span class="espaco"></span>
        <span class="estado" id="estado"><i></i><span></span></span>
        <button class="conta" id="sair" title="${esc(email)}">Sair</button>
      </header>
      <div class="corpo">
        <main class="principal">
          <div class="principal-inner">
            <div class="saudacao">
              <div>
                <h2>${saudacao()}.</h2>
                <p>${dataHoje()}</p>
                <div class="resumo" id="resumo"></div>
              </div>
            </div>
            <form class="nova" id="nova">
              <input name="t" placeholder="O que precisa ser feito?" autocomplete="off" />
              <div class="prios">
                ${(['alta', 'media', 'baixa'] as Prioridade[])
                  .map((p) => `<button type="button" class="prio" data-p="${p}">${NOME_PRIO[p]}</button>`)
                  .join('')}
              </div>
              <button class="adicionar" title="Adicionar (Enter)">+</button>
            </form>
            <div id="listas"></div>
          </div>
        </main>
        <aside class="lateral">
          <div class="nucleo3d lateral-nucleo" id="nucleo"></div>
          <h3>Pulsos</h3>
          <p class="legenda">Cada pulso é um evento real do núcleo. É o que vai acender o cérebro.</p>
          <ul class="pulsos" id="pulsos"></ul>
        </aside>
      </div>
    </section>`;

  $<HTMLButtonElement>('#sair').onclick = () => void jarvis.auth.sair();

  const form = $<HTMLFormElement>('#nova');
  const campo = form.t as HTMLInputElement;
  const marcarPrio = () =>
    form.querySelectorAll<HTMLButtonElement>('.prio').forEach((b) => b.classList.toggle('ativa', b.dataset.p === prioridade));
  form.querySelectorAll<HTMLButtonElement>('.prio').forEach((b) => {
    b.onclick = () => {
      prioridade = b.dataset.p as Prioridade;
      marcarPrio();
      campo.focus();
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const titulo = campo.value.trim();
    if (!titulo) return;
    campo.value = '';
    await jarvis.tarefas.criar(titulo, prioridade);
  };

  // Um único ouvinte de clique para a lista inteira.
  $<HTMLDivElement>('#listas').onclick = (e) => {
    const alvo = e.target as HTMLElement;
    const id = alvo.closest<HTMLLIElement>('li[data-id]')?.dataset.id;
    if (!id) return;
    if (alvo.closest('.apagar')) void jarvis.tarefas.apagar(id);
    else if (alvo.closest('.check')) void jarvis.tarefas.alternarConcluida(id);
  };

  marcarPrio();
  trocarNucleo($('#nucleo'), 0.8);
  campo.focus();
  await atualizarPainel();
  desenharPulsos();
}

function itemTarefa(t: Task) {
  return `
    <li class="tarefa ${t.done_at ? 'feita' : ''}" data-id="${t.id}" data-p="${t.priority}">
      <button class="check" title="${t.done_at ? 'Reabrir' : 'Concluir'}">✓</button>
      <span class="titulo">${esc(t.title)}</span>
      <span class="tag">${NOME_PRIO[t.priority]}</span>
      <button class="apagar" title="Apagar">×</button>
    </li>`;
}

const PESO: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

async function atualizarPainel() {
  if (tela !== 'painel') return;
  const lista = await jarvis.tarefas.listar();
  const abertas = lista.filter((t) => !t.done_at).sort((a, b) => PESO[a.priority] - PESO[b.priority]);
  const feitas = lista.filter((t) => t.done_at);

  $<HTMLDivElement>('#resumo').textContent = abertas.length
    ? `${abertas.length} pendente${abertas.length > 1 ? 's' : ''} · ${feitas.length} concluída${feitas.length === 1 ? '' : 's'}`
    : feitas.length ? 'Tudo em dia.' : 'Nada na fila ainda.';

  $<HTMLDivElement>('#listas').innerHTML = lista.length
    ? `
      <section class="secao">
        <h3>Pendentes <b>${abertas.length}</b></h3>
        <ul class="lista">${abertas.map(itemTarefa).join('')}</ul>
      </section>
      ${feitas.length ? `
      <section class="secao">
        <h3>Concluídas <b>${feitas.length}</b></h3>
        <ul class="lista">${feitas.map(itemTarefa).join('')}</ul>
      </section>` : ''}`
    : `<div class="vazio"><strong>Nenhuma tarefa por aqui.</strong>Escreva acima e aperte Enter.</div>`;

  const { estado, ultimoErro } = jarvis.estado();
  const el = $<HTMLSpanElement>('#estado');
  el.dataset.e = estado;
  el.title = ultimoErro ?? '';
  el.querySelector('span')!.textContent = NOME_ESTADO[estado];
}

function desenharPulsos() {
  if (tela !== 'painel') return;
  $<HTMLUListElement>('#pulsos').innerHTML = pulsos.length
    ? pulsos
        .map(
          (p) => `
      <li class="pulso">
        <div class="o-que">${NOME_ENTIDADE[p.entity_type ?? ''] ?? esc(p.entity_type ?? 'Evento')} ${NOME_EVENTO[p.kind] ?? esc(p.kind)}</div>
        <div class="quando">${new Date(p.created_at).toLocaleTimeString('pt-BR')}</div>
      </li>`,
        )
        .join('')
    : `<li class="pulso nada">Aguardando o primeiro evento…</li>`;
}


// ======================= ligação =======================

let agendado = false;
jarvis.aoMudar(() => {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    void decidirTela().then(atualizarPainel);
  });
});

jarvis.aoEvento((e) => {
  pulsos.unshift(e);
  pulsos.length = Math.min(pulsos.length, 12);
  desenharPulsos();
  nucleo?.pulsar();
});

void jarvis.iniciar().then(decidirTela);
