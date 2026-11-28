// Computador (Fase 4): o app executa o que `ia_conversar` gravou em `pc_commands`.
// Parte 2: com a sessão ligada, `controlar` olha a janela, pede os passos e executa.
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { currentMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, type PcComando } from '@jarvis/core';
import { definirModoControle } from './nucleo3d';
import { jarvis } from './jarvis';

const DEZ_MIN = 10 * 60_000;

interface Passo {
  acao: string;
  alvo_id?: string;
  x?: number;
  y?: number;
  duplo?: boolean;
  direito?: boolean;
  texto?: string;
  combinacao?: string;
  direcao?: string;
  quantidade?: number;
  ms?: number;
  alvo?: string;
  resumo?: string;
  motivo?: string;
}

interface RespostaControle {
  passos?: Passo[];
  perigo?: string | null;
  pensamento?: string;
  codigo?: string;
  erro?: string;
}

function textoErro(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  return 'O PC não conseguiu fazer isso.';
}

function horaSP(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

const esperarMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PrintTela {
  imagem: string;
  processo: string;
  titulo: string;
}

async function descreverTela(imagem: string, pergunta?: string, processo?: string, titulo?: string): Promise<string> {
  const sessao = await jarvis.auth.sessao();
  if (!sessao) throw new Error('Sem sessão para ver a tela.');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ia_tela`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessao.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imagem,
      pergunta: pergunta || null,
      processo: processo || null,
      titulo: titulo || null,
    }),
  });
  const corpo = await r.json().catch(() => ({} as { erro?: string; texto?: string }));
  if (!r.ok) throw new Error(corpo.erro || 'Não consegui descrever a tela.');
  const texto = (corpo.texto ?? '').trim();
  if (!texto) throw new Error('A descrição da tela veio vazia.');
  return texto;
}

function notificar(corpo: string) {
  void invoke('notificar', { titulo: 'J.A.R.V.I.S.', corpo }).catch((err) =>
    console.warn('computador: notificação falhou', err),
  );
}

async function executar(cmd: PcComando): Promise<Record<string, unknown>> {
  const args = cmd.args ?? {};
  if (cmd.kind === 'abrir') {
    const aberto = await invoke<string>('pc_abrir', {
      alvo: String(args.valor ?? ''),
      tipo: String(args.tipo ?? 'programa'),
    });
    return { aberto };
  }
  if (cmd.kind === 'midia') {
    const acao = String(args.acao ?? '');
    await invoke<string>('pc_midia', { acao });
    return { acao };
  }
  if (cmd.kind === 'achar_arquivo') {
    const arquivos = await invoke<{ caminho: string; modificado_ms: number }[]>('pc_achar_arquivo', {
      termo: String(args.termo ?? ''),
      tipo: typeof args.tipo === 'string' ? args.tipo : null,
    });
    return { arquivos };
  }
  if (cmd.kind === 'ver_tela') {
    const print = await invoke<PrintTela>('pc_print');
    const pergunta = typeof args.pergunta === 'string' ? args.pergunta : undefined;
    const texto = await descreverTela(print.imagem, pergunta, print.processo, print.titulo);
    return { texto };
  }
  if (cmd.kind === 'digitar') {
    const aberto = await invoke<string>('pc_digitar', {
      texto: String(args.texto ?? ''),
      programa: args.programa ?? null,
    });
    return { aberto };
  }
  throw new Error('Pedido de computador desconhecido.');
}

let geracao = 0;
let pedidoParar = false;
let tinhaSessao = false;
let ateFaixa: string | null = null;
let estadoFaixa = 'no controle';

function emitirFaixa() {
  void emitTo('faixa', 'faixa-estado', {
    ate: ateFaixa ? horaSP(ateFaixa) : '',
    estado: estadoFaixa,
    pausado: estadoFaixa.startsWith('Pausado'),
  });
}

async function fecharFaixa() {
  const janela = await WebviewWindow.getByLabel('faixa').catch(() => null);
  if (janela) await janela.close().catch(() => {});
  definirModoControle(false);
}

async function abrirFaixa() {
  const monitor = await currentMonitor().catch(() => null);
  const largura = monitor?.size.width ?? window.screen.width;
  const x = monitor?.position.x ?? 0;
  const y = monitor?.position.y ?? 0;
  const existente = await WebviewWindow.getByLabel('faixa').catch(() => null);
  if (existente) {
    await existente.show().catch(() => {});
    return;
  }
  new WebviewWindow('faixa', {
    url: 'faixa.html',
    x, y, width: largura, height: 28,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focus: false,
    transparent: false,
  });
}

async function sincronizarSessao() {
  const s = await jarvis.computador.sessaoAtiva().catch(() => null);
  if (!s) {
    if (tinhaSessao) {
      pedidoParar = true;
      geracao += 1;
      await invoke('pc_parar', { pausar: false }).catch(() => {});
    }
    tinhaSessao = false;
    await fecharFaixa();
    return;
  }
  tinhaSessao = true;
  ateFaixa = s.authorized_until;
  estadoFaixa = 'no controle';
  definirModoControle(true);
  await abrirFaixa();
  emitirFaixa();
}

async function plano(cmd: PcComando, historico: { passo: Passo; ok: boolean; erro?: string }[], liberado = false): Promise<RespostaControle> {
  const sessao = await jarvis.auth.sessao();
  if (!sessao) throw new Error('Sem sessão para controlar o PC.');
  let arvore: {
    elementos: unknown[];
    processo: string;
    titulo: string;
    largura_tela: number;
    altura_tela: number;
  } = {
    elementos: [],
    processo: '',
    titulo: '',
    largura_tela: window.screen.width,
    altura_tela: window.screen.height,
  };
  try {
    arvore = await invoke<typeof arvore>('pc_arvore');
  } catch (e) {
    console.warn('computador: árvore indisponível', e);
  }
  let print: string | undefined;
  const arvoreCurta = (arvore.elementos?.length ?? 0) < 15;
  const passoFalhou = historico.some((item) => item.ok === false);
  if (arvoreCurta || passoFalhou) print = (await invoke<PrintTela>('pc_print')).imagem;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ia_controlar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessao.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      objetivo: String(cmd.args?.objetivo ?? ''),
      arvore: arvore.elementos ?? [],
      print,
      historico: historico.slice(-12),
      liberado,
      comando_id: cmd.id,
      tela: { largura: arvore.largura_tela, altura: arvore.altura_tela },
      processo: arvore.processo,
      titulo: arvore.titulo,
    }),
  });
  const corpo = await r.json().catch(() => ({} as RespostaControle));
  if (!r.ok) throw new Error(corpo.erro || 'Não consegui decidir o próximo passo.');
  return corpo;
}

/** Olha a tela, pede um lote e executa até pronto, confirmação, parada ou 25 rodadas. */
async function pilotar(cmd: PcComando) {
  const meu = ++geracao;
  pedidoParar = false;
  await invoke('pc_retomar').catch(() => {});
  await invoke('pc_controle_ativo', { ativo: true });
  const historico: { passo: Passo; ok: boolean; erro?: string }[] = [];
  const vivo = () => meu === geracao && !pedidoParar;
  let liberado = cmd.args?.liberado === true;
  try {
    if (cmd.args?.programa) await abrirEEsperar(cmd.args.programa);
    for (let rodada = 0; rodada < 25 && vivo(); rodada++) {
      const sessao = await jarvis.computador.sessaoAtiva().catch(() => null);
      if (!sessao || !vivo()) {
        await jarvis.computador.concluir(cmd.id, 'cancelado', { motivo: 'sessão encerrada' }, 'executando').catch(() => {});
        return;
      }
      const corpo = await plano(cmd, historico, liberado);
      // O "sim" libera só o passo perigoso que pediu a confirmação; os seguintes voltam a pedir.
      if (corpo.perigo) liberado = false;
      if (corpo.codigo) {
        const perigo = corpo.perigo || 'esse passo precisa de confirmação';
        await jarvis.computador.concluir(cmd.id, 'aguardando_cf', { motivo: perigo });
        notificar(`Preciso da sua confirmação: ${perigo}. Diga 'sim' na conversa.`);
        return;
      }
      const passos = corpo.passos ?? [];
      for (const passo of passos) {
        if (!vivo()) return;
        if (passo.acao === 'pronto') {
          const resumo = passo.resumo || 'Feito.';
          await jarvis.computador.concluir(cmd.id, 'feito', { resumo });
          notificar(`${resumo} Concluído, Senhor.`);
          return;
        }
        if (passo.acao === 'pedir_dono') {
          const motivo = passo.motivo || 'Preciso de você na tela.';
          await jarvis.computador.concluir(cmd.id, 'falhou', { erro: motivo });
          notificar(motivo);
          return;
        }
        try {
          let seguiu = false;
          while (!seguiu) {
            try {
              await invoke('pc_passo', { passo });
              seguiu = true;
            } catch (e) {
              if (textoErro(e) !== 'parado') throw e;
              if (!vivo()) return;
              const ainda = await jarvis.computador.sessaoAtiva().catch(() => null);
              if (!ainda || pedidoParar) return;
              estadoFaixa = 'Pausado: você mexeu no mouse';
              emitirFaixa();
              await esperarMs(200);
            }
          }
          estadoFaixa = 'no controle';
          emitirFaixa();
          historico.push({ passo, ok: true });
        } catch (e) {
          const erro = textoErro(e);
          historico.push({ passo, ok: false, erro });
          await jarvis.computador.concluir(cmd.id, 'falhou', { erro }).catch(() => {});
          notificar(erro);
          return;
        }
        if (historico.length > 12) historico.splice(0, historico.length - 12);
      }
    }
    if (vivo()) {
      const erro = 'Parei depois de muitas tentativas.';
      await jarvis.computador.concluir(cmd.id, 'falhou', { erro }).catch(() => {});
      notificar(erro);
    }
  } catch (e) {
    const erro = textoErro(e);
    await jarvis.computador.concluir(cmd.id, 'falhou', { erro }).catch(() => {});
    notificar(erro);
  } finally {
    await invoke('pc_controle_ativo', { ativo: false }).catch(() => {});
    if (cmd.args?.auto_sessao === true) await jarvis.computador.soltar('dono').catch(() => {});
  }
}

/** Abre o programa do pedido e espera a janela nova vir para a frente. */
async function abrirEEsperar(programa: unknown): Promise<void> {
  if (!programa || typeof programa !== 'object') return;
  const p = programa as { tipo?: unknown; valor?: unknown };
  const valor = typeof p.valor === 'string' ? p.valor : '';
  const tipo = typeof p.tipo === 'string' ? p.tipo : 'programa';
  if (!valor) return;
  const anterior = await invoke<string>('pc_hwnd_frente');
  await invoke('pc_abrir', { alvo: valor, tipo });
  await invoke('pc_esperar_janela', { anterior });
}

async function rodar(cmd: PcComando, emCurso: Set<string>) {
  if (!cmd.id || emCurso.has(cmd.id)) return;
  emCurso.add(cmd.id);
  const especial = cmd.kind === 'controlar' || cmd.kind === 'comando';
  const velho = !especial && Date.now() - new Date(cmd.created_at).getTime() > DEZ_MIN;
  try {
    await jarvis.computador.concluir(cmd.id, velho ? 'cancelado' : 'executando', velho ? { motivo: 'pedido antigo' } : null);
  } catch (e) {
    emCurso.delete(cmd.id);
    if (e instanceof Error && e.message === 'ja-pego') return;
    console.warn('computador: não peguei o pedido', e);
    return;
  } finally {
    if (velho) emCurso.delete(cmd.id);
  }
  if (velho) return;
  try {
    if (cmd.kind === 'controlar') {
      await pilotar(cmd);
      return;
    }
    if (cmd.kind === 'comando') {
      const saida = await invoke<string>('pc_comando', { comando: String(cmd.args?.comando ?? '') });
      await jarvis.computador.concluir(cmd.id, 'feito', { saida });
      return;
    }
    const result = await executar(cmd);
    await jarvis.computador.concluir(cmd.id, 'feito', result);
  } catch (e) {
    await jarvis.computador.concluir(cmd.id, 'falhou', { erro: textoErro(e) }).catch((err) =>
      console.warn('computador: não gravei a falha', err),
    );
  } finally {
    emCurso.delete(cmd.id);
  }
}

/** Botão Controle no topo: desligado pede 30 minutos; ligado solta o PC. */
export function ligarBotaoControle(botao: HTMLButtonElement, avisarErro: (texto: string) => void) {
  let ligado = false;
  function mostrar() {
    botao.textContent = ligado ? 'Soltar PC' : 'Controle';
    botao.style.color = ligado ? '#c62828' : '';
    botao.style.borderColor = ligado ? '#c62828' : '';
    botao.title = ligado ? 'Soltar o PC' : 'Assumir o PC por 30 minutos';
  }
  async function atualizar() {
    const s = await jarvis.computador.sessaoAtiva().catch(() => null);
    ligado = !!s;
    mostrar();
  }
  botao.onclick = async () => {
    try {
      if (ligado) await jarvis.computador.soltar('dono');
      else await jarvis.computador.assumir(30);
    } catch (e) {
      avisarErro(textoErro(e));
    }
    await atualizar();
  };
  mostrar();
  void atualizar();
  jarvis.computador.ouvirSessoes(() => { void atualizar(); });
}

/** Escuta os pedidos e, ao abrir, tira os que ficaram pendentes. */
export function ligarComputador() {
  const emCurso = new Set<string>();
  let ouvindo = false;
  const tratar = (cmd: PcComando) => { void rodar(cmd, emCurso); };
  const ligar = async () => {
    if (ouvindo) return;
    const sessao = await jarvis.auth.sessao();
    if (!sessao) return;
    ouvindo = true;
    jarvis.computador.ouvir(tratar);
    jarvis.computador.ouvirSessoes(() => { void sincronizarSessao(); });
    void listen('controle-panico', () => {
      pedidoParar = true;
      geracao += 1;
      void jarvis.computador.soltar('panico');
      void fecharFaixa();
    });
    void listen('controle-pausado', () => {
      estadoFaixa = 'Pausado: você mexeu no mouse';
      emitirFaixa();
    });
    void listen('faixa-pronta', () => emitirFaixa());
    void listen('faixa-parar', () => {
      pedidoParar = true;
      geracao += 1;
      void jarvis.computador.soltar('dono');
    });
    window.setInterval(() => { void jarvis.computador.soltar('tempo').catch(() => {}); }, 5000);
    void sincronizarSessao();
    const lista = await jarvis.computador.pendentes().catch((e) => {
      console.warn('computador: não li os pendentes', e);
      return [] as PcComando[];
    });
    for (const c of lista) tratar(c);
  };
  void ligar();
  const relogio = window.setInterval(() => { if (!ouvindo) void ligar(); }, 3000);
  window.addEventListener('beforeunload', () => window.clearInterval(relogio));
}
