// Ferramentas de conhecimento da IA (Fase 2 · Etapa 5). Entram no mesmo planejador das tarefas
// (`registrar`), com recibo para desfazer e confirmação `cf_` para apagar.
// Conhecimento = o que o DONO escreve (tabela `notes`): notas (caderno + etiquetas), capturas
// (caixa de entrada rápida) e o diário (uma entrada por dia, id fixo por dono+dia, igual ao do app).
// Diferente de `memories` (o que a IA aprende sozinha): aqui a IA só escreve quando o dono pede.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { avaliarSensibilidade, normalizar } from './sensivel.ts';
import {
  acharPorNome, dataHumana, falha, pedirConfirmacao, recibo, registrar, resolverQuando,
  type Ctx, type ResultadoFerramenta,
} from './tarefas.ts';
import { idRegistro } from './habitos_regras.ts';

export type TipoNota = 'nota' | 'captura' | 'diario';

export interface Nota {
  id: string;
  kind: TipoNota;
  title: string | null;
  content: string;
  notebook: string | null;
  tags: string[];
  pinned: boolean;
  day: string | null;
  updated_at: string;
  deleted_at: string | null;
}

const CAMPOS = 'id, kind, title, content, notebook, tags, pinned, day, updated_at, deleted_at';
const NOME_TIPO: Record<TipoNota, string> = { nota: 'nota', captura: 'captura', diario: 'diário' };

/** Nome para mostrar: título, "Diário de hoje" ou o começo do texto. */
export function nomeNota(n: Pick<Nota, 'kind' | 'title' | 'content' | 'day'>, hoje: string): string {
  if (n.title?.trim()) return n.title.trim();
  if (n.kind === 'diario' && n.day) return `Diário de ${dataHumana(n.day, hoje)}`;
  const t = n.content.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || '(vazia)';
}

/** "#Ideias, trabalho" -> ["ideias", "trabalho"] (sem repetir, no máximo 20). */
export function lerEtiquetas(x: unknown): string[] {
  const lista = Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[,;]/) : [];
  return [...new Set(lista.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20);
}

const trecho = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function recentes(sb: SupabaseClient, limite = 300): Promise<Nota[]> {
  const { data, error } = await sb.from('notes').select(CAMPOS).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Nota[];
}

/** Acha uma nota por "nome ou id" (título ou começo do texto); texto = aviso para o dono. */
async function acharNota(sb: SupabaseClient, ref: unknown, hoje: string): Promise<Nota | string> {
  const r = String(ref ?? '').trim();
  if (!r) return 'Qual nota?';
  const base = await recentes(sb);
  const c = acharPorNome(r, base.map((n) => ({ ...n, title: nomeNota(n, hoje) })));
  if (c.length === 1) return base.find((n) => n.id === c[0]!.id)!;
  if (c.length > 1) return `"${r}" bate com mais de uma nota: ${c.slice(0, 5).map((n) => `**${n.title}**`).join(', ')}. Qual?`;
  // Sem bater pelo nome: tenta a busca de texto (acha pelo conteúdo).
  const { data } = await sb.rpc('buscar_notas', { consulta: r.slice(0, 300), limite: 2 });
  const achadas = (data ?? []) as Nota[];
  if (achadas.length === 1) return achadas[0]!;
  return `Não achei nota com "${r}".`;
}

async function diarioDoDia(sb: SupabaseClient, dia: string): Promise<Nota | null> {
  const { data } = await sb.from('notes').select(CAMPOS).eq('kind', 'diario').eq('day', dia).is('deleted_at', null).maybeSingle();
  return (data as Nota | null) ?? null;
}

async function mudar(ctx: Ctx, n: Nota, m: Partial<Nota> & { sensitive?: boolean }, acao: string): Promise<Nota | null> {
  const { data, error } = await ctx.sb.from('notes').update(m).eq('id', n.id).select(CAMPOS).single();
  if (error) {
    console.warn('conhecimento: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, n, data as Nota, 'notes');
  return data as Nota;
}

const linha = (n: Nota, hoje: string) =>
  `- ${n.pinned ? '📌 ' : ''}**${nomeNota(n, hoje)}**${n.notebook ? ` · ${n.notebook}` : ''}${n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}${n.title ? ` — ${trecho(n.content, 90)}` : ''}`;

const FERRAMENTAS = `
conhecimento_criar {conteudo, tipo?: "nota"|"captura", titulo?, caderno?: "nome", etiquetas?: ["...", ...]}
conhecimento_diario {texto, QUANDO? (padrão hoje)}   (escreve no diário do dia; se já houver, acrescenta)
conhecimento_buscar {termo}   (procura nas notas, capturas e diário pelo conteúdo)
conhecimento_listar {tipo?: "nota"|"captura"|"diario", caderno?, etiqueta?}
conhecimento_ver {ref?: "título ou id", QUANDO? (para ver o diário de um dia)}
conhecimento_editar {ref: "título ou id", titulo?, conteudo? (substitui), acrescentar? (soma ao fim), caderno?: "nome"|null, etiquetas?: [...], fixar?: boolean}
conhecimento_apagar {ref: "título ou id"}`;

const REGRAS = [
  '- CONHECIMENTO = o que o dono quer guardar para consultar depois (ideia, informação, resumo, receita, senha NÃO). "anota/guarda/salva essa ideia/informação", "cria uma nota" -> conhecimento_criar. Ideia solta sem organizar ("anota aí: ...", "captura") -> tipo:"captura". Com caderno ou título -> tipo:"nota". "anota que preciso fazer X" (afazer) continua sendo tarefa.',
  '- "no diário", "querido diário", "hoje eu...(relato do dia) anota no diário" -> conhecimento_diario com o texto do dono, em 1ª pessoa como ele falou.',
  '- "o que eu anotei sobre X?", "procura nas minhas notas X" -> conhecimento_buscar termo:"X". "minhas notas", "minhas capturas", "o caderno X" -> conhecimento_listar. "lê a nota X" / "o que escrevi no diário ontem" -> conhecimento_ver.',
  '- "coloca a nota X no caderno Y"/"organiza a captura X em Y" -> conhecimento_editar caderno:"Y". "acrescenta na nota X: ..." -> acrescentar. "fixa a nota X" -> fixar:true.',
  '- Use o título exato da lista de notas abaixo quando der. Conteúdo: o texto do dono, sem resumir nem inventar.',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(notas?|anotei|anotac\w*|caderno\w*|diario|captur\w*|etiqueta\w*|ideias?|conhecimento|guarda (essa|esta|isso|isto|aqui)|salva (essa|esta|isso|isto|como nota)|o que (eu )?(anotei|escrevi))\b/,

  async contexto(sb) {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const ns = (await recentes(sb, 60)).filter((n) => n.kind !== 'diario');
    const cadernos = [...new Set(ns.map((n) => n.notebook).filter(Boolean))];
    return [
      `Cadernos: ${cadernos.length ? cadernos.join(', ') : '(nenhum)'}`,
      `Notas e capturas recentes (título | tipo | caderno):\n${ns.length
        ? ns.slice(0, 30).map((n) => `- ${nomeNota(n, hoje)} | ${NOME_TIPO[n.kind]} | ${n.notebook ?? '-'}`).join('\n')
        : '(nenhuma)'}`,
    ].join('\n');
  },

  executores: {
    async conhecimento_criar(ctx, a) {
      const conteudo = String(a.conteudo ?? a.texto ?? '').trim().slice(0, 20000);
      const titulo = typeof a.titulo === 'string' && a.titulo.trim() ? a.titulo.trim().slice(0, 200) : null;
      if (!conteudo && !titulo) return falha('conhecimento_criar', 'O que devo anotar?');
      const caderno = typeof a.caderno === 'string' && a.caderno.trim() ? a.caderno.trim().slice(0, 80) : null;
      const tipo: TipoNota = a.tipo === 'captura' || (a.tipo !== 'nota' && !caderno && !titulo) ? 'captura' : 'nota';
      // Não duplica a mesma nota feita há pouco (ex.: o dono repetiu o pedido).
      const iguais = (await recentes(ctx.sb, 20)).filter((n) => normalizar(n.content) === normalizar(conteudo) && n.kind === tipo);
      if (iguais.length) {
        return {
          ferramenta: 'conhecimento_criar', ok: true, resumo: 'já existia', fatos: { ja_existia: true, nota: iguais[0] },
          texto: `Isso já está anotado: **${nomeNota(iguais[0]!, ctx.hoje)}**.`, ids: [iguais[0]!.id],
        };
      }
      const { data, error } = await ctx.sb.from('notes').insert({
        kind: tipo, title: titulo, content: conteudo, notebook: tipo === 'nota' ? caderno : null,
        tags: lerEtiquetas(a.etiquetas), sensitive: avaliarSensibilidade(`${titulo ?? ''} ${conteudo}`).sensivel,
      }).select(CAMPOS).single();
      if (error) return falha('conhecimento_criar', `Não consegui anotar (${error.message}).`);
      const n = data as Nota;
      await recibo(ctx.sb, 'conhecimento_criar', null, n, 'notes');
      return {
        ferramenta: 'conhecimento_criar', ok: true, resumo: `${NOME_TIPO[n.kind]} "${nomeNota(n, ctx.hoje)}"`, fatos: { nota: n },
        texto: n.kind === 'captura'
          ? `Capturado: **${nomeNota(n, ctx.hoje)}**. Fica nas capturas até você organizar.`
          : `Nota criada: **${nomeNota(n, ctx.hoje)}**${n.notebook ? ` · caderno **${n.notebook}**` : ''}${n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}.`,
        ids: [n.id],
      };
    },

    async conhecimento_diario(ctx, a) {
      const texto = String(a.texto ?? a.conteudo ?? '').trim().slice(0, 20000);
      if (!texto) return falha('conhecimento_diario', 'O que devo escrever no diário?');
      const dia = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
      if (dia > ctx.hoje) return falha('conhecimento_diario', 'O diário é de hoje ou de dias que já passaram.');
      const atual = await diarioDoDia(ctx.sb, dia);
      const quando = dia === ctx.hoje ? 'de hoje' : `de ${dataHumana(dia, ctx.hoje)}`;
      if (atual) {
        const n = await mudar(ctx, atual, {
          content: atual.content.trim() ? `${atual.content.trimEnd()}\n\n${texto}` : texto,
          sensitive: avaliarSensibilidade(`${atual.content} ${texto}`).sensivel,
        }, 'conhecimento_diario');
        if (!n) return falha('conhecimento_diario', 'Não consegui escrever no diário.');
        return {
          ferramenta: 'conhecimento_diario', ok: true, resumo: `diário ${dia}`, fatos: { nota: n },
          texto: `Acrescentei no diário ${quando}.`, ids: [n.id],
        };
      }
      const { data: u } = await ctx.sb.auth.getUser();
      if (!u.user) return falha('conhecimento_diario', 'Sessão inválida.');
      const id = idRegistro(`diario:${u.user.id}`, dia);
      // Pode existir apagado (mesmo id fixo): reaproveita.
      const { data: apagado } = await ctx.sb.from('notes').select(CAMPOS).eq('id', id).maybeSingle();
      const r = apagado
        ? await ctx.sb.from('notes').update({ content: texto, deleted_at: null, sensitive: avaliarSensibilidade(texto).sensivel })
          .eq('id', id).select(CAMPOS).single()
        : await ctx.sb.from('notes').insert({ id, kind: 'diario', day: dia, content: texto, sensitive: avaliarSensibilidade(texto).sensivel })
          .select(CAMPOS).single();
      if (r.error) return falha('conhecimento_diario', `Não consegui escrever no diário (${r.error.message}).`);
      await recibo(ctx.sb, 'conhecimento_diario', (apagado as Nota | null) ?? null, r.data as Nota, 'notes');
      return {
        ferramenta: 'conhecimento_diario', ok: true, resumo: `diário ${dia}`, fatos: { nota: r.data },
        texto: `Escrevi no diário ${quando}.`, ids: [id],
      };
    },

    async conhecimento_buscar(ctx, a) {
      const termo = String(a.termo ?? a.ref ?? '').trim();
      if (!termo) return falha('conhecimento_buscar', 'O que devo procurar nas notas?');
      const { data, error } = await ctx.sb.rpc('buscar_notas', { consulta: termo.slice(0, 300), limite: 8 });
      if (error) return falha('conhecimento_buscar', `Não consegui procurar (${error.message}).`);
      const ns = (data ?? []) as Nota[];
      if (!ns.length) {
        return {
          ferramenta: 'conhecimento_buscar', ok: true, resumo: '0 notas', fatos: { termo, total: 0 },
          texto: `Não achei nada anotado sobre "${termo}".`, ids: [],
        };
      }
      const partes = ns.map((n) => `**${nomeNota(n, ctx.hoje)}**${n.kind !== 'nota' ? ` (${NOME_TIPO[n.kind]})` : ''}${n.notebook ? ` · ${n.notebook}` : ''}\n${trecho(n.content, 400)}`);
      return {
        ferramenta: 'conhecimento_buscar', ok: true, resumo: `${ns.length} nota(s)`, fatos: { termo, total: ns.length, notas: ns },
        texto: `**Encontrei ${ns.length} sobre "${termo}"**\n\n${partes.join('\n\n')}`, ids: ns.map((n) => n.id),
      };
    },

    async conhecimento_listar(ctx, a) {
      const tipo = ['nota', 'captura', 'diario'].includes(String(a.tipo)) ? a.tipo as TipoNota : null;
      let q = ctx.sb.from('notes').select(CAMPOS).is('deleted_at', null);
      if (tipo) q = q.eq('kind', tipo);
      else q = q.neq('kind', 'diario');
      if (typeof a.caderno === 'string' && a.caderno.trim()) q = q.ilike('notebook', a.caderno.trim());
      const etiqueta = lerEtiquetas(a.etiqueta)[0];
      if (etiqueta) q = q.contains('tags', [etiqueta]);
      const { data, error } = await q.order('pinned', { ascending: false })
        .order(tipo === 'diario' ? 'day' : 'updated_at', { ascending: false }).limit(30);
      if (error) return falha('conhecimento_listar', `Não consegui ler as notas (${error.message}).`);
      const ns = (data ?? []) as Nota[];
      const titulo = tipo === 'captura' ? 'Capturas' : tipo === 'diario' ? 'Diário' : typeof a.caderno === 'string' && a.caderno.trim()
        ? `Caderno ${a.caderno.trim()}` : etiqueta ? `#${etiqueta}` : 'Notas recentes';
      return {
        ferramenta: 'conhecimento_listar', ok: true, resumo: `${ns.length} nota(s)`, fatos: { tipo, total: ns.length, notas: ns },
        texto: ns.length
          ? `**${titulo} (${ns.length})**\n${ns.map((n) => (n.kind === 'diario' ? `- **${nomeNota(n, ctx.hoje)}** — ${trecho(n.content, 90)}` : linha(n, ctx.hoje))).join('\n')}`
          : `${titulo}: nada por aqui ainda.`,
        ids: ns.map((n) => n.id),
      };
    },

    async conhecimento_ver(ctx, a) {
      let n: Nota | string | null;
      if (!a.ref && resolverQuando(a, ctx.hoje) !== undefined) {
        const dia = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
        n = await diarioDoDia(ctx.sb, dia);
        if (!n) return falha('conhecimento_ver', `Não há nada no diário de ${dataHumana(dia, ctx.hoje)}.`);
      } else n = await acharNota(ctx.sb, a.ref ?? a.titulo, ctx.hoje);
      if (typeof n === 'string') return falha('conhecimento_ver', n);
      const cab = `**${nomeNota(n, ctx.hoje)}**${n.kind === 'captura' ? ' · captura' : ''}${n.notebook ? ` · caderno ${n.notebook}` : ''}${n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}`;
      return {
        ferramenta: 'conhecimento_ver', ok: true, resumo: `nota "${nomeNota(n, ctx.hoje)}"`, fatos: { nota: n },
        texto: `${cab}\n\n${n.content.slice(0, 6000) || '(vazia)'}`, ids: [n.id],
      };
    },

    async conhecimento_editar(ctx, a) {
      const n = await acharNota(ctx.sb, a.ref ?? a.titulo_atual, ctx.hoje);
      if (typeof n === 'string') return falha('conhecimento_editar', n);
      const m: Partial<Nota> & { sensitive?: boolean } = {};
      if (typeof a.titulo === 'string') m.title = a.titulo.trim().slice(0, 200) || null;
      if (typeof a.conteudo === 'string' && a.conteudo.trim()) m.content = a.conteudo.trim().slice(0, 20000);
      if (typeof a.acrescentar === 'string' && a.acrescentar.trim()) {
        m.content = `${(m.content ?? n.content).trimEnd()}\n\n${a.acrescentar.trim()}`.trim().slice(0, 20000);
      }
      if (a.caderno !== undefined && n.kind !== 'diario') {
        m.notebook = typeof a.caderno === 'string' && a.caderno.trim() ? a.caderno.trim().slice(0, 80) : null;
        if (m.notebook && n.kind === 'captura') m.kind = 'nota'; // organizar a captura
      }
      if (a.etiquetas !== undefined) m.tags = lerEtiquetas(a.etiquetas);
      if (typeof a.fixar === 'boolean') m.pinned = a.fixar;
      if (!Object.keys(m).length) return falha('conhecimento_editar', `O que devo mudar em **${nomeNota(n, ctx.hoje)}**?`);
      if (m.content || m.title !== undefined) m.sensitive = avaliarSensibilidade(`${m.title ?? n.title ?? ''} ${m.content ?? n.content}`).sensivel;
      const nova = await mudar(ctx, n, m, 'conhecimento_editar');
      if (!nova) return falha('conhecimento_editar', 'Não consegui salvar a mudança.');
      const oQue = m.kind === 'nota' ? `organizei em **${nova.notebook}**`
        : a.acrescentar ? 'acrescentei o texto' : m.pinned !== undefined ? (m.pinned ? 'fixada' : 'desafixada') : 'atualizada';
      return {
        ferramenta: 'conhecimento_editar', ok: true, resumo: `editada "${nomeNota(nova, ctx.hoje)}"`, fatos: { antes: n, depois: nova },
        texto: `**${nomeNota(nova, ctx.hoje)}**: ${oQue}.`, ids: [nova.id],
      };
    },

    async conhecimento_apagar(ctx, a) {
      const n = await acharNota(ctx.sb, a.ref ?? (Array.isArray(a.refs) ? a.refs[0] : undefined), ctx.hoje);
      if (typeof n === 'string') return falha('conhecimento_apagar', n);
      return pedirConfirmacao(ctx.sb, 'conhecimento_apagar', [{ id: n.id, title: nomeNota(n, ctx.hoje) }],
        `apagar esta ${NOME_TIPO[n.kind] === 'diário' ? 'entrada do diário' : NOME_TIPO[n.kind]}`);
    },
  },

  confirmar: {
    async conhecimento_apagar(ctx, ids): Promise<ResultadoFerramenta> {
      const { data } = await ctx.sb.from('notes').select(CAMPOS).in('id', ids).is('deleted_at', null);
      const alvo = (data ?? []) as Nota[];
      if (!alvo.length) return falha('jarvis_confirmar', 'A nota não existe mais.');
      const feitas: Nota[] = [];
      for (const n of alvo) {
        const x = await mudar(ctx, n, { deleted_at: new Date().toISOString() }, 'conhecimento_apagar');
        if (x) feitas.push(x);
      }
      return {
        ferramenta: 'jarvis_confirmar', ok: true, resumo: `conhecimento_apagar: ${feitas.length}`, fatos: { notas: feitas },
        texto: `Apagada: ${feitas.map((n) => `**${nomeNota(n, ctx.hoje)}**`).join(', ')}. Se mudar de ideia, é só dizer "desfaz".`,
        ids: feitas.map((n) => n.id),
      };
    },
  },
});
