import { quandoCurto, type Message, type Prioridade, type Task } from '@jarvis/core';
import { jarvis } from './jarvis';
import './estilo.css';
import { montarNucleo, type NucleoMontado } from './nucleo3d';
import { ligarAtualizacao } from './atualizacao';
import { abrirExpandido, botaoCopiarResposta, copiar, marcarCopiado, respostaHtml, textosCopiaveis } from './markdown';
import { montarControlesJanela } from './janela';

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
    <div class="faixa-arrastar" data-tauri-drag-region></div>
    <section class="entrada">
      <div class="entrada-caixa">
        <div class="nucleo3d hero" id="nucleo"></div>
        <div class="marca">
          <h1>J.A.R.V.I.S.</h1>
          <p>assistente pessoal</p>
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
// Ids já desenhados: só os novos entram com animação.
let atividadesVistas = new Set<number>();

type Aba = 'conversa' | 'tarefas';
const lerAba = (): Aba => {
  try {
    return localStorage.getItem('jarvis.aba') === 'tarefas' ? 'tarefas' : 'conversa';
  } catch {
    return 'conversa';
  }
};
let aba: Aba = lerAba();
let qtdMensagensDesenhadas = -1;
// Só redesenha quando algo mudou de verdade (redesenhar tudo a cada evento fazia a tela piscar).
let assinaturaChat = '';
let assinaturaListas = '';
let assinaturaAtividades = '';
let mensagensVistas = new Set<string>();

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
      <header class="topo" data-tauri-drag-region>
        <span class="sinal"></span>
        <span class="nome" data-tauri-drag-region>J.A.R.V.I.S.</span>
        <span class="espaco" data-tauri-drag-region></span>
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
            <nav class="abas-painel" id="abas">
              <button type="button" data-aba="conversa">Conversa</button>
              <button type="button" data-aba="tarefas">Tarefas</button>
            </nav>
            <div class="vista" id="vista-conversa">
              <div class="chat" id="chat"></div>
              <div class="chat-rodape">
                <p class="aviso" id="erro-chat"></p>
                <form class="nova falar" id="falar">
                  <input name="m" placeholder="Fale com o J.A.R.V.I.S." autocomplete="off" maxlength="4000" />
                  <button type="button" class="nova-conversa" id="nova-conversa" title="Começar outra conversa">nova</button>
                  <button class="adicionar" title="Enviar (Enter)">↑</button>
                </form>
              </div>
            </div>
            <div class="vista" id="vista-tarefas">
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
          </div>
        </main>
        <aside class="lateral">
          <div class="nucleo3d lateral-nucleo" id="nucleo"></div>
          <h3>Atividades recentes</h3>
          <ul class="atividades" id="atividades"></ul>
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

  // ---------- conversa ----------
  const falar = $<HTMLFormElement>('#falar');
  const campoFala = falar.m as HTMLInputElement;
  falar.onsubmit = (e) => {
    e.preventDefault();
    const texto = campoFala.value.trim();
    if (!texto || jarvis.chat.estado().pensando) return;
    campoFala.value = '';
    // Se não deu para enviar (havia uma pergunta em aberto e ela falhou), o texto volta.
    void jarvis.chat.enviar(texto).then((ok) => {
      if (!ok && !campoFala.value) campoFala.value = texto;
    });
  };
  $<HTMLDivElement>('#chat').onclick = async (e) => {
    const alvo = e.target as HTMLElement;
    const bCopiar = alvo.closest<HTMLButtonElement>('[data-copiar]');
    if (bCopiar) {
      const texto = textosCopiaveis[Number(bCopiar.dataset.copiar)];
      if (texto !== undefined && (await copiar(texto))) marcarCopiado(bCopiar);
      return;
    }
    const bExpandir = alvo.closest<HTMLButtonElement>('[data-expandir]');
    if (bExpandir) {
      const texto = textosCopiaveis[Number(bExpandir.dataset.expandir)];
      if (texto !== undefined) abrirExpandido(bExpandir.dataset.titulo ?? 'Texto', texto);
    }
  };
  $<HTMLButtonElement>('#nova-conversa').onclick = () => {
    jarvis.chat.novaConversa();
    campoFala.focus();
  };

  // ---------- abas ----------
  const mostrarAba = () => {
    $<HTMLElement>('#abas').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.aba === aba),
    );
    $<HTMLDivElement>('#vista-conversa').hidden = aba !== 'conversa';
    $<HTMLDivElement>('#vista-tarefas').hidden = aba !== 'tarefas';
    (aba === 'conversa' ? campoFala : campo).focus();
  };
  $<HTMLElement>('#abas').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-aba]');
    if (!b) return;
    aba = b.dataset.aba as Aba;
    try {
      localStorage.setItem('jarvis.aba', aba);
    } catch {
      /* sem armazenamento: só não lembra a aba */
    }
    qtdMensagensDesenhadas = -1;
    mostrarAba();
    void desenharChat();
  };

  marcarPrio();
  trocarNucleo($('#nucleo'), 0.8);
  qtdMensagensDesenhadas = -1;
  assinaturaChat = assinaturaListas = assinaturaAtividades = '';
  mensagensVistas = new Set();
  mostrarAba();
  atividadesVistas = new Set();
  await atualizarPainel();
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

  const htmlListas = lista.length
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
  if (htmlListas !== assinaturaListas) {
    assinaturaListas = htmlListas;
    $<HTMLDivElement>('#listas').innerHTML = htmlListas;
  }

  const { estado, ultimoErro } = jarvis.estado();
  const el = $<HTMLSpanElement>('#estado');
  el.dataset.e = estado;
  el.title = ultimoErro ?? '';
  el.querySelector('span')!.textContent = NOME_ESTADO[estado];

  await desenharAtividades();
  await desenharChat();
}

function itemMensagem(m: Message, nova: boolean) {
  const classe = `msg${nova ? ' nova' : ''}`;
  if (m.role === 'user') {
    return `<div class="${classe}" data-r="user"><div class="texto">${esc(m.content)}</div></div>`;
  }
  return `<div class="${classe}" data-r="assistant"><div class="md">${respostaHtml(m.content)}</div>`
    + `<div class="msg-acoes">${botaoCopiarResposta(m.content)}</div></div>`;
}

async function desenharChat() {
  const msgs = await jarvis.chat.mensagens();
  if (tela !== 'painel') return;
  const { pensando, erro } = jarvis.chat.estado();
  const assinatura = `${pensando}|${erro}|` + msgs.map((m) => `${m.id}:${m.content.length}`).join(',');
  if (assinatura === assinaturaChat) return;
  assinaturaChat = assinatura;

  const chat = $<HTMLDivElement>('#chat');
  const primeiraVez = mensagensVistas.size === 0;
  textosCopiaveis.length = 0;
  chat.innerHTML = msgs.length || pensando
    ? msgs.map((m) => itemMensagem(m, !primeiraVez && !mensagensVistas.has(m.id))).join('')
      + (pensando ? `<div class="msg pensando nova" data-r="assistant"><i></i><i></i><i></i></div>` : '')
    : `<div class="vazio"><strong>Às suas ordens.</strong>Pergunte qualquer coisa.</div>`;
  mensagensVistas = new Set(msgs.map((m) => m.id));
  $<HTMLParagraphElement>('#erro-chat').textContent = erro ?? '';
  // Desce até a última mensagem quando chega algo novo.
  const qtd = msgs.length + (pensando ? 1 : 0);
  if (qtd !== qtdMensagensDesenhadas && aba === 'conversa') {
    qtdMensagensDesenhadas = qtd;
    const rolagem = chat.closest<HTMLElement>('.principal');
    // Resposta nova: rola até o começo dela (respostas longas se leem de cima para baixo).
    const ultima = chat.lastElementChild as HTMLElement | null;
    if (rolagem && ultima) {
      const alvo = ultima.dataset.r === 'assistant' && !ultima.classList.contains('pensando')
        ? ultima.offsetTop - 24
        : rolagem.scrollHeight;
      rolagem.scrollTop = alvo;
    }
  }
}

async function desenharAtividades() {
  const itens = await jarvis.atividades.listar();
  if (tela !== 'painel') return;
  const assinatura = itens.map((a) => `${a.id}:${a.detalhe ?? ''}`).join(',') + `|${jarvis.atividades.carregado()}`;
  if (assinatura === assinaturaAtividades) return;
  assinaturaAtividades = assinatura;
  const primeiraVez = atividadesVistas.size === 0;
  $<HTMLUListElement>('#atividades').innerHTML = itens.length
    ? itens
        .map(
          (a) => `
      <li class="atividade ${!primeiraVez && !atividadesVistas.has(a.id) ? 'nova' : ''}">
        <div class="o-que">${esc(a.texto)}</div>
        ${a.detalhe ? `<div class="detalhe">${esc(a.detalhe)}</div>` : ''}
        <div class="quando">${quandoCurto(a.quando)}</div>
      </li>`,
        )
        .join('')
    : `<li class="atividade nada">${jarvis.atividades.carregado() ? 'Nenhuma atividade ainda.' : 'Carregando…'}</li>`;
  atividadesVistas = new Set(itens.map((a) => a.id));
}


// ======================= ligação =======================

let agendado = false;
jarvis.aoMudar(() => {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    nucleo?.definirEstado(estadoDoNucleo());
    void decidirTela().then(atualizarPainel);
  });
});

// O núcleo mostra o que a IA está fazendo (estado contínuo) e cada evento real vira uma descarga:
// verde = algo criado, vermelho = algo apagado, neutro = mudança ou pensamento.
function estadoDoNucleo() {
  const ia = jarvis.ia.estado();
  if (ia !== 'repouso') return ia;
  return jarvis.chat.estado().erro ? 'erro' : 'repouso';
}
jarvis.aoEvento((e) => {
  if (e.kind === 'deleted') nucleo?.pulsar(1, 'apagado');
  else if (e.kind === 'created' && e.entity_type !== 'messages' && e.entity_type !== 'conversations') nucleo?.pulsar(0.8, 'criado');
  else if (e.kind === 'thinking') nucleo?.pulsar(0.5);
  else nucleo?.pulsar(0.35);
});

montarControlesJanela();
void jarvis.iniciar().then(decidirTela);
ligarAtualizacao();
