import { descreverRecorrencia, quandoCurto, type Memory, type Message, type Prioridade, type Task } from '@jarvis/core';
import { jarvis } from './jarvis';
import './estilo.css';
import { montarNucleo, type NucleoMontado } from './nucleo3d';
import { ligarAtualizacao } from './atualizacao';
import { ligarMenuCopiar } from './menuCopiar';
import { calar, estadoVoz, falar, gravar, instalarVoz, type Gravacao } from './voz';
import { paraFala } from '@jarvis/core';
import { invoke } from '@tauri-apps/api/core';
import type { Shell } from '@jarvis/core';
import {
  abrirExpandido, botaoCopiarResposta, confirmarRodar, copiar, marcarCopiado, respostaHtml, textosCopiaveis,
} from './markdown';
import { montarControlesJanela } from './janela';
import { htmlFormTarefa, ligarFormTarefa } from './formTarefa';
import { htmlLembretes, ligarLembretes } from './lembretes';
import { htmlProjetos, ligarProjetos } from './projetos';
import { htmlHabitos, ligarHabitos } from './habitos';
import { htmlConhecimento, ligarConhecimento } from './conhecimento';
import { htmlHoje, ligarHoje } from './hoje';
import { ligarAvisos } from './avisos';
import { htmlAvisos, ligarAbaAvisos } from './abaAvisos';

const app = document.querySelector<HTMLDivElement>('#app')!;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;

// Só um núcleo 3D vivo por vez (um contexto WebGL).
let nucleo: NucleoMontado | null = null;
function trocarNucleo(caixa: HTMLElement | null, densidade = 1) {
  nucleo?.destruir();
  // Na coluna lateral a câmera fica mais longe: os anéis cabem inteiros, sem bater na borda do quadro.
  nucleo = caixa ? montarNucleo(caixa, densidade, caixa.classList.contains('lateral-nucleo') ? 10.5 : undefined) : null;
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

/** Tarefas já desenhadas: as que surgem depois (criadas pela IA ou noutro aparelho) chegam com brilho verde. */
let tarefasVistas: Set<string> | null = null;
// Ids já desenhados: só os novos entram com animação.
let atividadesVistas = new Set<number>();

type Aba = 'hoje' | 'conversa' | 'tarefas' | 'projetos' | 'habitos' | 'conhecimento' | 'lembretes' | 'avisos' | 'memoria';
const lerAba = (): Aba => {
  try {
    const salva = localStorage.getItem('jarvis.aba');
    return salva === 'hoje' || salva === 'tarefas' || salva === 'projetos' || salva === 'habitos' || salva === 'conhecimento' || salva === 'lembretes' || salva === 'avisos' || salva === 'memoria'
      ? salva : 'conversa';
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
let assinaturaMemoria = '';
let memoriaConfirmando: string | null = null;

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
              <button type="button" data-aba="hoje">Hoje</button>
              <button type="button" data-aba="conversa">Conversa</button>
              <button type="button" data-aba="tarefas">Tarefas</button>
              <button type="button" data-aba="projetos">Projetos</button>
              <button type="button" data-aba="habitos">Hábitos</button>
              <button type="button" data-aba="conhecimento">Conhecimento</button>
              <button type="button" data-aba="lembretes">Lembretes</button>
              <button type="button" data-aba="avisos">Avisos</button>
              <button type="button" data-aba="memoria">Memória</button>
            </nav>
            <div class="vista" id="vista-hoje">${htmlHoje()}</div>
            <div class="vista" id="vista-conversa">
              <div class="chat" id="chat"></div>
              <div class="chat-rodape">
                <p class="aviso" id="erro-chat"></p>
                <form class="nova falar" id="falar">
                  <input name="m" placeholder="Fale com o J.A.R.V.I.S." autocomplete="off" maxlength="4000" />
                  <button type="button" class="nova-conversa" id="nova-conversa" title="Começar outra conversa">nova</button>
                  <button type="button" class="microfone" id="microfone" title="Falar (Ctrl+Espaço)"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
                  <button class="adicionar" title="Enviar (Enter)">↑</button>
                </form>
              </div>
            </div>
            <div class="vista" id="vista-memoria">
              <p class="memoria-intro">O que o J.A.R.V.I.S. aprendeu sobre você nas conversas. Ele usa isso para responder melhor.
                Peça no chat para lembrar ou esquecer algo, ou esqueça por aqui.</p>
              <div id="memorias"></div>
            </div>
            <div class="vista" id="vista-lembretes">${htmlLembretes()}</div>
            <div class="vista" id="vista-avisos">${htmlAvisos()}</div>
            <div class="vista" id="vista-projetos">${htmlProjetos()}</div>
            <div class="vista" id="vista-habitos">${htmlHabitos()}</div>
            <div class="vista" id="vista-conhecimento">${htmlConhecimento()}</div>
            <div class="vista" id="vista-tarefas">
            ${htmlFormTarefa()}
            <p class="dica-tarefas">Ou peça na conversa: <em>"toda segunda às 20h, pelada"</em>, <em>"o que tenho hoje?"</em>, <em>"conclui a do mercado"</em>. Clique numa tarefa para editar.</p>
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

  const formTarefa = ligarFormTarefa($<HTMLFormElement>('#nova'));
  ligarLembretes($<HTMLDivElement>('#vista-lembretes'), { pulsar: () => nucleo?.pulsar(0.8, 'criado') });
  ligarProjetos($<HTMLDivElement>('#vista-projetos'), { pulsar: () => nucleo?.pulsar(0.8, 'criado') });
  ligarHabitos($<HTMLDivElement>('#vista-habitos'), { pulsar: () => nucleo?.pulsar(0.8, 'criado') });
  ligarConhecimento($<HTMLDivElement>('#vista-conhecimento'), { pulsar: () => nucleo?.pulsar(0.8, 'criado') });
  ligarHoje($<HTMLDivElement>('#vista-hoje'), {
    pulsar: () => nucleo?.pulsar(0.8, 'criado'),
    irPara: (destino) => $<HTMLElement>('#abas').querySelector<HTMLButtonElement>(`button[data-aba="${destino}"]`)?.click(),
  });
  const abaAvisos = ligarAbaAvisos($<HTMLDivElement>('#vista-avisos'), {
    selo: (n) => {
      const b = $<HTMLElement>('#abas').querySelector<HTMLButtonElement>('button[data-aba="avisos"]');
      if (b) b.dataset.selo = n > 0 ? String(n) : '';
    },
  });

  // Um único ouvinte de clique para a lista inteira.
  $<HTMLDivElement>('#listas').onclick = (e) => {
    const alvo = e.target as HTMLElement;
    const id = alvo.closest<HTMLLIElement>('li[data-id]')?.dataset.id;
    if (!id) return;
    if (alvo.closest('.apagar')) void jarvis.tarefas.apagar(id);
    else if (alvo.closest('.check')) void jarvis.tarefas.alternarConcluida(id);
    else if (alvo.closest('.titulo, .quando')) {
      // Clicar na tarefa abre ela no formulário para editar.
      void jarvis.tarefas.listar().then((l) => {
        const t = l.find((x) => x.id === id);
        if (t && !t.done_at) formTarefa.editar(t);
      });
    }
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
    const bRodar = alvo.closest<HTMLButtonElement>('[data-rodar]');
    if (bRodar) {
      const comando = textosCopiaveis[Number(bRodar.dataset.rodar)];
      const shell = (bRodar.dataset.shell ?? 'powershell') as Shell;
      if (comando === undefined || !(await confirmarRodar(comando, shell))) return;
      try {
        await invoke('abrir_terminal', { comando, shell });
        marcarCopiado(bRodar);
      } catch (erro) {
        $<HTMLParagraphElement>('#erro-chat').textContent = String(erro);
      }
      return;
    }
    // Links (fontes e links dentro da resposta) abrem no navegador padrão.
    const link = alvo.closest<HTMLElement>('a[href], [data-link]');
    if (link) {
      e.preventDefault();
      const url = link.dataset.link ?? link.getAttribute('href') ?? '';
      if (/^https?:\/\//.test(url)) void invoke('abrir_link', { url }).catch(() => {});
      return;
    }
    // Cartão de opções: a escolha vira a próxima mensagem do dono.
    const bOpcao = alvo.closest<HTMLButtonElement>('[data-opcao]');
    if (bOpcao && !bOpcao.disabled) {
      if (jarvis.chat.estado().pensando) return;
      void jarvis.chat.enviar(bOpcao.dataset.opcao ?? '');
      return;
    }
    const bExpandir = alvo.closest<HTMLButtonElement>('[data-expandir]');
    if (bExpandir) {
      const texto = textosCopiaveis[Number(bExpandir.dataset.expandir)];
      if (texto !== undefined) abrirExpandido(bExpandir.dataset.titulo ?? 'Texto', texto);
    }
  };
  // Esquecer pede confirmação: o primeiro clique arma, o segundo esquece.
  $<HTMLDivElement>('#memorias').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-esquecer]');
    if (!b) return;
    const id = b.dataset.esquecer!;
    if (memoriaConfirmando === id) {
      memoriaConfirmando = null;
  tarefasVistas = null;
      void jarvis.memorias.esquecer(id);
    } else {
      memoriaConfirmando = id;
      assinaturaMemoria = '';
      void desenharMemorias();
    }
  };
  // Clique direito: copiar seleção, trecho, código ou a resposta inteira.
  ligarMenuCopiar($<HTMLDivElement>('#chat'), (msg) => {
    const botao = msg.nextElementSibling?.querySelector<HTMLElement>('[data-copiar]');
    return botao ? textosCopiaveis[Number(botao.dataset.copiar)] : undefined;
  });
  $<HTMLButtonElement>('#microfone').onclick = () => void alternarVoz();
  atualizarMicrofone();
  $<HTMLButtonElement>('#nova-conversa').onclick = () => {
    jarvis.chat.novaConversa();
    campoFala.focus();
  };

  // ---------- abas ----------
  const mostrarAba = () => {
    $<HTMLElement>('#abas').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.classList.toggle('ativa', b.dataset.aba === aba),
    );
    $<HTMLDivElement>('#vista-hoje').hidden = aba !== 'hoje';
    $<HTMLDivElement>('#vista-conversa').hidden = aba !== 'conversa';
    $<HTMLDivElement>('#vista-tarefas').hidden = aba !== 'tarefas';
    $<HTMLDivElement>('#vista-lembretes').hidden = aba !== 'lembretes';
    $<HTMLDivElement>('#vista-avisos').hidden = aba !== 'avisos';
    $<HTMLDivElement>('#vista-projetos').hidden = aba !== 'projetos';
    $<HTMLDivElement>('#vista-habitos').hidden = aba !== 'habitos';
    $<HTMLDivElement>('#vista-conhecimento').hidden = aba !== 'conhecimento';
    $<HTMLDivElement>('#vista-memoria').hidden = aba !== 'memoria';
    if (aba === 'avisos') abaAvisos.recarregar();
    if (aba === 'conversa') campoFala.focus();
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

  trocarNucleo($('#nucleo'), 0.8);
  qtdMensagensDesenhadas = -1;
  assinaturaChat = assinaturaListas = assinaturaAtividades = assinaturaMemoria = '';
  memoriaConfirmando = null;
  mensagensVistas = new Set();
  mostrarAba();
  atividadesVistas = new Set();
  await atualizarPainel();
}

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function rotuloData(data: string, hoje: string) {
  if (data === hoje) return 'hoje';
  if (data === somarDias(hoje, 1)) return 'amanhã';
  if (data === somarDias(hoje, -1)) return 'ontem';
  const [, m, d] = data.split('-');
  return `${SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]} ${d}/${m}`;
}

let nomeProjeto = new Map<string, string>();

function itemTarefa(t: Task, hoje: string, novas: Set<string>) {
  const atrasada = !t.done_at && !!t.due_date && t.due_date < hoje;
  const rep = t.recurrence ? `<span class="rep" title="Tarefa fixa: ao concluir, passa para a próxima data">↻ ${descreverRecorrencia(t.recurrence)}</span>` : '';
  const quando = t.due_date
    ? `<span class="quando ${atrasada ? 'atrasada' : ''}">${rotuloData(t.due_date, hoje)}${t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ''}</span>`
    : '';
  const nota = t.notes ? `<span class="nota" title="${esc(t.notes)}">≡</span>` : '';
  return `
    <li class="tarefa ${t.done_at ? 'feita' : ''} ${novas.has(t.id) ? 'recem' : ''}" data-id="${t.id}" data-p="${t.priority}">
      <button class="check" title="${t.done_at ? 'Reabrir' : 'Concluir'}">✓</button>
      <span class="titulo" title="Clique para editar">${esc(t.title)}</span>
      ${nota}${t.project_id && nomeProjeto.has(t.project_id) ? `<span class="tag-projeto" title="Projeto">▣ ${esc(nomeProjeto.get(t.project_id)!)}</span>` : ''}${rep}${quando}
      ${t.priority !== 'media' ? `<span class="tag">${NOME_PRIO[t.priority]}</span>` : ''}
      <button class="apagar" title="Apagar">×</button>
    </li>`;
}

const PESO: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };
const porPrazo = (a: Task, b: Task) =>
  (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
  || (a.due_time ?? '99').localeCompare(b.due_time ?? '99')
  || PESO[a.priority] - PESO[b.priority];

function secao(titulo: string, lista: Task[], hoje: string, novas: Set<string>, classe = '') {
  if (!lista.length) return '';
  return `
    <section class="secao ${classe}">
      <h3>${titulo} <b>${lista.length}</b></h3>
      <ul class="lista">${lista.map((t) => itemTarefa(t, hoje, novas)).join('')}</ul>
    </section>`;
}

async function atualizarPainel() {
  if (tela !== 'painel') return;
  const [lista, projetos] = await Promise.all([jarvis.tarefas.listar(), jarvis.projetos.listar()]);
  nomeProjeto = new Map(projetos.map((p) => [p.id, p.name]));
  // Cada projeto real é um nó dourado do cérebro; as tarefas dele, pontos em volta.
  nucleo?.definirProjetos(projetos.filter((p) => p.status !== 'concluido').map((p) => ({
    id: p.id, progresso: p.total ? p.feitas / p.total : 0,
    tarefas: lista.filter((t) => t.project_id === p.id && !t.done_at && t.board_column !== 'fazendo').map((t) => t.id),
    fazendo: lista.filter((t) => t.project_id === p.id && !t.done_at && t.board_column === 'fazendo').map((t) => t.id),
    feitas: lista.filter((t) => t.project_id === p.id && t.done_at).map((t) => t.id),
  })));
  const hoje = hojeSP();
  const abertas = lista.filter((t) => !t.done_at).sort(porPrazo);
  const atrasadas = abertas.filter((t) => t.due_date && t.due_date < hoje);
  const deHoje = abertas.filter((t) => t.due_date === hoje);
  const proximas = abertas.filter((t) => t.due_date && t.due_date > hoje);
  const semData = abertas.filter((t) => !t.due_date).sort((a, b) => PESO[a.priority] - PESO[b.priority]);
  // Concluídas: só as dos últimos 7 dias (as mais recentes primeiro).
  const corte = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const feitas = lista.filter((t) => t.done_at && t.done_at >= corte)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')).slice(0, 10);

  const novas = new Set<string>();
  if (tarefasVistas) for (const t of lista) if (!tarefasVistas.has(t.id)) novas.add(t.id);
  tarefasVistas = new Set(lista.map((t) => t.id));

  const partes = [
    atrasadas.length ? `${atrasadas.length} atrasada${atrasadas.length > 1 ? 's' : ''}` : '',
    `${deHoje.length} para hoje`,
    proximas.length ? `${proximas.length} próxima${proximas.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  $<HTMLDivElement>('#resumo').textContent = abertas.length ? partes.join(' · ') : feitas.length ? 'Tudo em dia.' : '';

  const htmlListas = abertas.length || feitas.length
    ? [
      secao('Atrasadas', atrasadas, hoje, novas, 'secao-atrasadas'),
      secao('Hoje', deHoje, hoje, novas, 'secao-hoje'),
      secao('Próximas', proximas, hoje, novas),
      secao('Sem data', semData, hoje, novas),
      !abertas.length ? '<div class="vazio"><strong>Tudo em dia.</strong>Nenhuma tarefa aberta.</div>' : '',
      secao('Concluídas', feitas, hoje, novas, 'secao-feitas'),
    ].join('')
    : `<div class="vazio"><strong>Nenhuma tarefa por aqui.</strong>Escreva acima, ou peça ao J.A.R.V.I.S. na conversa.</div>`;
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
  await desenharMemorias();
}

const NOME_TIPO: Record<string, string> = {
  preferencia: 'Preferências', fato: 'Fatos', nota: 'Notas', captura: 'Capturas', diario: 'Diário',
};

function itemMemoria(m: Memory) {
  const confirmando = memoriaConfirmando === m.id;
  return `
    <li class="memoria" data-imp="${m.importance >= 8 ? 'alta' : m.importance >= 5 ? 'media' : 'baixa'}">
      <div class="memoria-corpo">
        <div class="memoria-titulo">${esc(m.title ?? m.content)}${m.sensitive ? '<span class="memoria-sens" title="Sensível: nunca vai para o Gemini">sensível</span>' : ''}</div>
        ${m.title ? `<div class="memoria-texto">${esc(m.content)}</div>` : ''}
        <div class="memoria-quando">${quandoCurto(m.updated_at)}</div>
      </div>
      <button class="memoria-esquecer${confirmando ? ' confirmar' : ''}" data-esquecer="${m.id}" title="Esquecer">${confirmando ? 'Esquecer?' : '×'}</button>
    </li>`;
}

async function desenharMemorias() {
  const lista = await jarvis.memorias.listar();
  if (tela !== 'painel') return;
  // Cada memória real é um nó do cérebro.
  nucleo?.definirMemorias(lista.map((m) => ({ id: m.id, importancia: m.importance })));
  const assinatura = `${memoriaConfirmando}|` + lista.map((m) => `${m.id}:${m.updated_at}`).join(',');
  if (assinatura === assinaturaMemoria) return;
  assinaturaMemoria = assinatura;
  const grupos = new Map<string, Memory[]>();
  for (const m of lista) grupos.set(m.kind, [...(grupos.get(m.kind) ?? []), m]);
  $<HTMLDivElement>('#memorias').innerHTML = lista.length
    ? [...grupos.entries()].map(([tipo, itens]) => `
      <section class="secao">
        <h3>${NOME_TIPO[tipo] ?? tipo} <b>${itens.length}</b></h3>
        <ul class="lista">${itens.map(itemMemoria).join('')}</ul>
      </section>`).join('')
    : `<div class="vazio"><strong>Ainda não sei nada sobre você.</strong>Conte algo no chat, como seu nome, sua rotina ou do que você gosta.</div>`;
}

/** Fontes da pesquisa na web, embaixo da resposta. */
function fontesHtml(m: Message) {
  if (!m.sources?.length) return '';
  const nome = (f: { titulo: string; url: string }) => {
    const t = f.titulo.trim();
    try {
      return t || new URL(f.url).hostname.replace(/^www\./, '');
    } catch {
      return t || 'fonte';
    }
  };
  return `<div class="md-fontes"><span class="md-fontes-rotulo">Fontes</span>${m.sources
    .map((f, i) => `<button type="button" class="md-fonte" data-link="${esc(f.url)}" title="${esc(f.titulo || f.url)}"><b>${i + 1}</b>${esc(nome(f))}</button>`)
    .join('')}</div>`;
}

function itemMensagem(m: Message, nova: boolean, ultima: boolean) {
  const classe = `msg${nova ? ' nova' : ''}`;
  if (m.role === 'user') {
    return `<div class="${classe}" data-r="user"><div class="texto">${esc(m.content)}</div></div>`;
  }
  // O botão fica fora da mensagem, logo abaixo dela.
  return `<div class="${classe}" data-r="assistant"><div class="md">${respostaHtml(m.content, ultima, m.sources ?? [])}</div>${fontesHtml(m)}</div>`
    + `<div class="msg-acoes${nova ? ' nova' : ''}">${botaoCopiarResposta(m.content)}</div>`;
}

async function desenharChat() {
  const msgs = await jarvis.chat.mensagens();
  if (tela !== 'painel') return;
  const { pensando, erro } = jarvis.chat.estado();
  const assinatura = `${pensando}|${jarvis.ia.estado()}|${erro}|` + msgs.map((m) => `${m.id}:${m.content.length}:${m.sources?.length ?? 0}`).join(',');
  if (assinatura === assinaturaChat) return;
  assinaturaChat = assinatura;

  const chat = $<HTMLDivElement>('#chat');
  const primeiraVez = mensagensVistas.size === 0;
  textosCopiaveis.length = 0;
  chat.innerHTML = msgs.length || pensando
    ? msgs.map((m, i) => itemMensagem(m, !primeiraVez && !mensagensVistas.has(m.id), i === msgs.length - 1 && !pensando)).join('')
      + (pensando
        ? `<div class="msg pensando nova" data-r="assistant"><i></i><i></i><i></i>${jarvis.ia.estado() === 'pesquisando' ? '<span>Pesquisando na internet…</span>' : ''}</div>`
        : '')
    : `<div class="vazio"><strong>Às suas ordens.</strong>Pergunte qualquer coisa.</div>`;
  mensagensVistas = new Set(msgs.map((m) => m.id));
  $<HTMLParagraphElement>('#erro-chat').textContent = erro ?? '';
  // Desce até a última mensagem quando chega algo novo.
  const qtd = msgs.length + (pensando ? 1 : 0);
  if (qtd !== qtdMensagensDesenhadas && aba === 'conversa') {
    qtdMensagensDesenhadas = qtd;
    const rolagem = chat.closest<HTMLElement>('.principal');
    // Resposta nova: rola até o começo dela (respostas longas se leem de cima para baixo).
    const todas = chat.querySelectorAll<HTMLElement>('.msg');
    const ultima = todas[todas.length - 1] ?? null;
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

// ======================= voz =======================

type ModoVoz = 'parado' | 'ouvindo' | 'transcrevendo';
let modoVoz: ModoVoz = 'parado';
let gravacao: Gravacao | null = null;
/** Uma pergunta feita por voz está esperando resposta (a resposta será falada). */
let aguardandoVoz = false;
let falandoAgora = false;

function avisoVoz(texto: string) {
  const el = document.querySelector<HTMLParagraphElement>('#erro-chat');
  if (el) el.textContent = texto;
}

function atualizarMicrofone() {
  const b = document.querySelector<HTMLButtonElement>('#microfone');
  if (b) {
    b.dataset.modo = falandoAgora ? 'falando' : modoVoz;
    b.title = falandoAgora ? 'Parar de falar (Esc)'
      : modoVoz === 'ouvindo' ? 'Terminar e enviar (Ctrl+Espaço)'
        : modoVoz === 'transcrevendo' ? 'Entendendo o que você disse…'
          : 'Falar (Ctrl+Espaço)';
  }
  nucleo?.definirEstado(estadoDoNucleo());
}

/** Na primeira vez que usa a voz, oferece instalar a voz natural (sem ela, usa a do Windows). */
let ofereceuVoz = false;
async function oferecerVozNatural() {
  if (ofereceuVoz) return;
  ofereceuVoz = true;
  let estado;
  try {
    estado = await estadoVoz();
  } catch {
    return;
  }
  if (estado.instalada) return;
  const faixa = document.createElement('div');
  faixa.className = 'faixa-update faixa-voz';
  faixa.innerHTML = `<span>Voz natural do J.A.R.V.I.S. · download único de ~${Math.round(estado.total / 1e6)} MB</span>`
    + '<button type="button" data-a="sim">Instalar</button><button type="button" data-a="nao">Agora não</button>';
  const texto = faixa.querySelector('span')!;
  const sim = faixa.querySelector<HTMLButtonElement>('[data-a="sim"]')!;
  const nao = faixa.querySelector<HTMLButtonElement>('[data-a="nao"]')!;
  nao.onclick = () => faixa.remove();
  sim.onclick = async () => {
    sim.disabled = true;
    nao.hidden = true;
    texto.textContent = 'Baixando a voz… 0%';
    const relogio = setInterval(async () => {
      try {
        const e = await estadoVoz();
        texto.textContent = `Baixando a voz… ${Math.round((e.baixado / e.total) * 100)}%`;
      } catch {
        /* segue */
      }
    }, 700);
    try {
      await instalarVoz();
      clearInterval(relogio);
      texto.textContent = 'Voz instalada.';
      sim.hidden = true;
      falar('Voz instalada, Senhor. Bem melhor assim.', () => nucleo?.pulsar(0.18));
      setTimeout(() => faixa.remove(), 3000);
    } catch (e) {
      clearInterval(relogio);
      texto.textContent = e instanceof Error ? e.message : String(e);
      sim.disabled = false;
      sim.textContent = 'Tentar de novo';
      nao.hidden = false;
    }
  };
  document.body.appendChild(faixa);
}

async function alternarVoz() {
  void oferecerVozNatural();
  if (falandoAgora) {
    calar();
    falandoAgora = false;
    atualizarMicrofone();
    return;
  }
  if (modoVoz === 'ouvindo') return finalizarGravacao();
  if (modoVoz === 'transcrevendo' || jarvis.chat.estado().pensando) return;
  try {
    avisoVoz('');
    gravacao = await gravar({
      // O núcleo pulsa com o volume da sua voz.
      aoNivel: (n) => nucleo?.pulsar(n * 0.018),
      aoTerminar: () => void finalizarGravacao(),
    });
    modoVoz = 'ouvindo';
  } catch (e) {
    avisoVoz(`Não consegui usar o microfone: ${e instanceof Error ? e.message : e}`);
  }
  atualizarMicrofone();
}

async function finalizarGravacao() {
  if (modoVoz !== 'ouvindo' || !gravacao) return;
  modoVoz = 'transcrevendo';
  atualizarMicrofone();
  const g = gravacao;
  gravacao = null;
  try {
    const audio = await g.parar();
    if (!audio) {
      avisoVoz('Não ouvi nada. Toque no microfone e fale.');
      return;
    }
    const texto = await jarvis.chat.transcrever(audio);
    if (!texto) {
      avisoVoz('Não entendi o que você disse. Tente de novo.');
      return;
    }
    aguardandoVoz = true;
    void jarvis.chat.enviar(texto, { voz: true }).then((ok) => {
      if (!ok) aguardandoVoz = false;
    });
  } catch (e) {
    avisoVoz(e instanceof Error ? e.message : String(e));
  } finally {
    modoVoz = 'parado';
    atualizarMicrofone();
  }
}

/** Reserva quando o servidor não mandou o resumo: as primeiras frases. */
function resumoLocal(texto: string): string {
  const frases = texto.match(/[^.!?]+[.!?]+/g) ?? [texto];
  return frases.slice(0, 4).join(' ').trim();
}

// Resposta de uma pergunta feita por voz: lê em voz alta (sem Markdown, citações nem código).
jarvis.chat.aoResponder((m, voz, fala) => {
  if (!voz) return;
  aguardandoVoz = false;
  falandoAgora = true;
  atualizarMicrofone();
  // Fala o resumo curto do servidor; sem ele, só o começo da resposta (o resto está na tela).
  falar(fala ?? resumoLocal(paraFala(m.content)), () => nucleo?.pulsar(0.18), () => {
    falandoAgora = false;
    atualizarMicrofone();
  });
});

// Ctrl+Espaço: falar / terminar de falar. Esc: cala a voz ou cancela a gravação.
addEventListener('keydown', (e) => {
  if (tela !== 'painel') return;
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    void alternarVoz();
  } else if (e.key === 'Escape') {
    if (falandoAgora) {
      calar();
      falandoAgora = false;
      atualizarMicrofone();
    } else if (modoVoz === 'ouvindo' && gravacao) {
      gravacao.cancelar();
      gravacao = null;
      modoVoz = 'parado';
      atualizarMicrofone();
    }
  }
});

// O núcleo mostra o que a IA está fazendo (estado contínuo) e cada evento real vira uma descarga:
// verde = algo criado, vermelho = algo apagado, neutro = mudança ou pensamento.
function estadoDoNucleo() {
  if (modoVoz === 'ouvindo') return 'ouvindo';
  if (falandoAgora) return 'falando';
  if (modoVoz === 'transcrevendo') return 'pensando';
  const ia = jarvis.ia.estado();
  if (ia === 'pesquisando') return 'agindo';
  if (ia !== 'repouso') return ia;
  return jarvis.chat.estado().erro ? 'erro' : 'repouso';
}
jarvis.aoEvento((e) => {
  // Pergunta feita por voz que vai precisar de pesquisa: avisa antes de sumir pesquisando.
  if (e.kind === 'searching' && aguardandoVoz && !falandoAgora) {
    falandoAgora = true;
    atualizarMicrofone();
    falar('Só um momento, Senhor...', () => nucleo?.pulsar(0.18), () => {
      falandoAgora = false;
      atualizarMicrofone();
    });
  }
  if (e.kind === 'deleted') nucleo?.pulsar(1, 'apagado');
  else if (e.kind === 'created' && e.entity_type !== 'messages' && e.entity_type !== 'conversations') nucleo?.pulsar(0.8, 'criado');
  else if (e.kind === 'thinking') nucleo?.pulsar(0.5);
  else nucleo?.pulsar(0.35);
});

montarControlesJanela();
void jarvis.iniciar().then(decidirTela);
ligarAvisos({ pulsar: () => nucleo?.pulsar(0.8, 'criado') });
ligarAtualizacao();
