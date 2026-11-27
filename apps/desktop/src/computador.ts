// Computador, parte 1 (Fase 4 · etapa 7): o app executa o que `ia_conversar` gravou em `pc_commands`.
// O modo controle (mouse e teclado) fica para a etapa 8.
import { invoke } from '@tauri-apps/api/core';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, type PcComando } from '@jarvis/core';
import { jarvis } from './jarvis';

const DEZ_MIN = 10 * 60_000;

function textoErro(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e.trim();
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  return 'O PC não conseguiu fazer isso.';
}

async function descreverTela(imagem: string, pergunta?: string): Promise<string> {
  const sessao = await jarvis.auth.sessao();
  if (!sessao) throw new Error('Sem sessão para ver a tela.');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ia_tela`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessao.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imagem, pergunta: pergunta || null }),
  });
  const corpo = await r.json().catch(() => ({} as { erro?: string; texto?: string }));
  if (!r.ok) throw new Error(corpo.erro || 'Não consegui descrever a tela.');
  const texto = (corpo.texto ?? '').trim();
  if (!texto) throw new Error('A descrição da tela veio vazia.');
  return texto;
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
    const imagem = await invoke<string>('pc_print');
    const pergunta = typeof args.pergunta === 'string' ? args.pergunta : undefined;
    const texto = await descreverTela(imagem, pergunta);
    return { texto };
  }
  throw new Error('Pedido de computador desconhecido.');
}

async function rodar(cmd: PcComando, emCurso: Set<string>) {
  if (!cmd.id || emCurso.has(cmd.id)) return;
  emCurso.add(cmd.id);
  const velho = Date.now() - new Date(cmd.created_at).getTime() > DEZ_MIN;
  try {
    await jarvis.computador.concluir(cmd.id, velho ? 'cancelado' : 'executando', velho ? { motivo: 'pedido antigo' } : null);
  } catch (e) {
    if (e instanceof Error && e.message === 'ja-pego') return;
    console.warn('computador: não peguei o pedido', e);
    return;
  }
  if (velho) return;
  try {
    const result = await executar(cmd);
    await jarvis.computador.concluir(cmd.id, 'feito', result);
  } catch (e) {
    await jarvis.computador.concluir(cmd.id, 'falhou', { erro: textoErro(e) }).catch((err) =>
      console.warn('computador: não gravei a falha', err),
    );
  }
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
    const lista = await jarvis.computador.pendentes().catch((e) => {
      console.warn('computador: não li os pendentes', e);
      return [] as PcComando[];
    });
    for (const c of lista) tratar(c);
  };

  void ligar();
  // O login pode terminar depois desta chamada: tenta de novo até a sessão existir.
  const relogio = window.setInterval(() => { if (!ouvindo) void ligar(); }, 3000);
  window.addEventListener('beforeunload', () => window.clearInterval(relogio));
}
