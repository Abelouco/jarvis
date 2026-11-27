// Ferramentas de computador da IA (Fase 4 · etapa 7): abrir, mídia, achar arquivo e ver a tela.
// O servidor não mexe no PC: grava `pc_commands` e espera o app executar. Tudo é sensível (só Groq).
// O recibo existe, mas "desfaz" não volta atrás numa ação que já aconteceu no computador.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import { falha, recibo, registrar, type Ctx, type ResultadoFerramenta } from './tarefas.ts';

const DETECTOR =
  /\b(abre|abrir|abra|abrindo|pausa|despausa|musicas?|volume|proxima musica|(?:acha|achar|encontra|encontrar|procura) (?:o|a|os|as|meu|minha|meus|minhas|um|uma|arquivo|pdf)|arquivos? (?:do|da|de|no|na|chamado)|minha tela|na tela|prints?)\b/;

export const pareceComputador = (texto: string) => DETECTOR.test(normalizar(texto));

export interface AlvoAberto {
  tipo: 'url' | 'caminho' | 'programa';
  valor: string;
}

const PASTAS: Record<string, string> = {
  downloads: '%USERPROFILE%\\Downloads',
  download: '%USERPROFILE%\\Downloads',
  documentos: '%USERPROFILE%\\Documents',
  documents: '%USERPROFILE%\\Documents',
  'meus documentos': '%USERPROFILE%\\Documents',
  'area de trabalho': '%USERPROFILE%\\Desktop',
  desktop: '%USERPROFILE%\\Desktop',
};

const EXT_ARQUIVO = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|txt|mp[34]|exe|lnk|zip|csv)$/i;

/** Tira artigo e a palavra "pasta"/"programa" do começo, sem mexer no resto. */
function limparAlvo(bruto: string): string {
  let s = bruto.trim().replace(/^["']+|["']+$/g, '').trim();
  let anterior = '';
  while (s && s !== anterior) {
    anterior = s;
    s = s
      .replace(/^(pasta|programa|aplicativo|app|site|pagina)\s+/i, '')
      .replace(/^(o|a|os|as|um|uma)\s+/i, '')
      .trim();
  }
  return s;
}

/**
 * Programa, site ou pasta, sem rede e sem olhar o PC.
 * Site vira URL; pasta conhecida vira caminho com `%USERPROFILE%`; o resto é nome de programa.
 */
export function classificarAlvo(alvo: string): AlvoAberto {
  const original = alvo.trim();
  if (!original) return { tipo: 'programa', valor: '' };
  if (/^https?:\/\//i.test(original)) return { tipo: 'url', valor: original };
  const s = limparAlvo(original);
  if (!s) return { tipo: 'programa', valor: '' };
  const chave = normalizar(s).replace(/\s+/g, ' ');
  const pasta = PASTAS[chave];
  if (pasta) return { tipo: 'caminho', valor: pasta };
  if (/^[a-z]:[\\/]/i.test(s) || s.startsWith('\\\\') || s.startsWith('/') || s.includes('\\')) {
    return { tipo: 'caminho', valor: s };
  }
  if (!EXT_ARQUIVO.test(s) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[\/?#]\S*)?$/i.test(s)) {
    return { tipo: 'url', valor: `https://${s}` };
  }
  return { tipo: 'programa', valor: s };
}

const ACOES_MIDIA = ['tocar_pausar', 'proxima', 'anterior', 'volume_mais', 'volume_menos', 'mudo'] as const;
const TIPOS_ARQUIVO = ['pdf', 'imagem', 'video', 'planilha', 'documento'] as const;

const FRASE_MIDIA: Record<(typeof ACOES_MIDIA)[number], string> = {
  tocar_pausar: 'Mandei tocar ou pausar.',
  proxima: 'Próxima faixa.',
  anterior: 'Faixa anterior.',
  volume_mais: 'Aumentei o volume.',
  volume_menos: 'Diminuí o volume.',
  mudo: 'Mudo.',
};

const ABERTO_MS = 2 * 60_000;
const ESPERA_MS = 8_000;
/** Print + upload + visão do Groq passam fácil de 8 s. */
const ESPERA_TELA_MS = 25_000;

const ok = (
  ferramenta: string, resumo: string, texto: string, fatos: Record<string, unknown> = {}, ids: string[] = [],
): ResultadoFerramenta => ({ ferramenta, ok: true, resumo, fatos: { computador: true, ...fatos }, texto, ids });

const erro = (ferramenta: string, msg: string): ResultadoFerramenta => ({ ...falha(ferramenta, msg), fatos: { computador: true } });

async function pcAberto(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.from('devices').select('seen_at').eq('platform', 'pc').is('deleted_at', null);
  if (error || !data) return false;
  const agora = Date.now();
  return data.some((d) => agora - new Date(d.seen_at as string).getTime() < ABERTO_MS);
}

async function esperar(sb: SupabaseClient, id: string, espera: number): Promise<{ status: string; result: Record<string, unknown> | null } | null> {
  const prazo = Date.now() + espera;
  while (Date.now() < prazo) {
    await new Promise((r) => setTimeout(r, 500));
    const { data, error } = await sb.from('pc_commands').select('status, result').eq('id', id).maybeSingle();
    if (error || !data) continue;
    if (data.status !== 'pendente' && data.status !== 'executando') {
      return { status: data.status as string, result: (data.result ?? null) as Record<string, unknown> | null };
    }
  }
  return null;
}

function dataArquivo(ms: number): string {
  if (!ms) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}

async function pedir(
  ctx: Ctx, ferramenta: string, kind: string, args: Record<string, unknown>,
  textoDe: (result: Record<string, unknown>) => string,
): Promise<ResultadoFerramenta> {
  const aberto = await pcAberto(ctx.sb);
  const { data, error } = await ctx.sb.from('pc_commands').insert({ kind, args }).select('id').single();
  if (error || !data) return erro(ferramenta, `Não consegui pedir ao PC (${error?.message ?? 'sem linha'}).`);
  await recibo(ctx.sb, ferramenta, null, data as { id: string }, 'pc_commands');
  const id = data.id as string;
  if (!aberto) {
    return ok(ferramenta, 'PC fechado', 'O PC está fechado; faço assim que ele abrir.', { id }, [id]);
  }
  const fim = await esperar(ctx.sb, id, kind === 'ver_tela' ? ESPERA_TELA_MS : ESPERA_MS);
  if (!fim) return ok(ferramenta, 'pedido no PC', 'Mandei para o PC; a resposta não chegou a tempo.', { id }, [id]);
  if (fim.status === 'falhou' || fim.status === 'cancelado') {
    const msg = typeof fim.result?.erro === 'string' ? fim.result.erro
      : typeof fim.result?.motivo === 'string' ? fim.result.motivo
      : 'O PC não conseguiu fazer isso.';
    return erro(ferramenta, msg);
  }
  const texto = textoDe(fim.result ?? {});
  return ok(ferramenta, texto.replace(/\s+/g, ' ').slice(0, 160), texto, { id }, [id]);
}

registrar({
  ferramentas: `
computador_abrir {alvo: "programa, site ou pasta"}
computador_midia {acao: "tocar_pausar"|"proxima"|"anterior"|"volume_mais"|"volume_menos"|"mudo"}
computador_achar_arquivo {termo, tipo?: "pdf"|"imagem"|"video"|"planilha"|"documento"}
computador_ver_tela {pergunta?}`,
  regras: [
    '- COMPUTADOR: "abre o Spotify" / "abre o youtube.com" / "abre a pasta downloads" -> computador_abrir {alvo}. Site pode ser domínio ou URL. Pasta conhecida: downloads, documentos, área de trabalho. O resto é nome de programa.',
    '- "pausa" / "continua a música" / "próxima" / "aumenta o volume" / "mudo" -> computador_midia. tocar_pausar serve para pausar e para voltar a tocar.',
    '- "acha o PDF do contrato" -> computador_achar_arquivo {termo:"contrato", tipo:"pdf"}. Sem tipo se o dono não disser o tipo.',
    '- "o que tem na minha tela?" / "qual é o erro na tela?" -> computador_ver_tela. Se a pergunta for sobre a tela, passe pergunta; senão omita.',
    '- "desfaz" NÃO desfaz ação no PC (abrir, mídia, achar arquivo, ver a tela). Diga isso ao dono. Não chame jarvis_desfazer para voltar atrás no computador.',
  ],
  detector: DETECTOR,
  executores: {
    async computador_abrir(ctx, a) {
      const alvo = String(a.alvo ?? '').trim();
      if (!alvo) return erro('computador_abrir', 'O que devo abrir?');
      const cls = classificarAlvo(alvo);
      if (!cls.valor) return erro('computador_abrir', 'O que devo abrir?');
      return pedir(ctx, 'computador_abrir', 'abrir', { tipo: cls.tipo, valor: cls.valor }, (r) => {
        const nome = typeof r.aberto === 'string' && r.aberto ? r.aberto : cls.valor;
        return `Abri **${nome}**.`;
      });
    },
    async computador_midia(ctx, a) {
      const acao = String(a.acao ?? '').trim();
      if (!ACOES_MIDIA.includes(acao as (typeof ACOES_MIDIA)[number])) {
        return erro('computador_midia', 'Qual ação na mídia? Pausar, próxima, anterior, volume ou mudo.');
      }
      const frase = FRASE_MIDIA[acao as (typeof ACOES_MIDIA)[number]];
      return pedir(ctx, 'computador_midia', 'midia', { acao }, () => frase);
    },
    async computador_achar_arquivo(ctx, a) {
      const termo = String(a.termo ?? '').trim().slice(0, 120);
      if (termo.length < 2) return erro('computador_achar_arquivo', 'O que devo procurar?');
      const tipo = typeof a.tipo === 'string' && (TIPOS_ARQUIVO as readonly string[]).includes(a.tipo) ? a.tipo : undefined;
      return pedir(ctx, 'computador_achar_arquivo', 'achar_arquivo', tipo ? { termo, tipo } : { termo }, (r) => {
        const lista = Array.isArray(r.arquivos) ? r.arquivos : [];
        if (!lista.length) return `Não achei arquivo com **${termo}**.`;
        const linhas = lista.slice(0, 10).map((item) => {
          const arq = item as { caminho?: string; modificado_ms?: number };
          const quando = dataArquivo(Number(arq.modificado_ms) || 0);
          const caminho = String(arq.caminho ?? '').replace(/`/g, "'");
          return `- \`${caminho}\`${quando ? ` · ${quando}` : ''}`;
        });
        return `Achei ${linhas.length} arquivo${linhas.length > 1 ? 's' : ''}:\n${linhas.join('\n')}`;
      });
    },
    async computador_ver_tela(ctx, a) {
      const pergunta = typeof a.pergunta === 'string' ? a.pergunta.trim().slice(0, 400) : '';
      return pedir(ctx, 'computador_ver_tela', 'ver_tela', pergunta ? { pergunta } : {}, (r) => {
        const texto = typeof r.texto === 'string' ? r.texto.trim() : '';
        return texto || 'Não consegui descrever a tela.';
      });
    },
  },
});
