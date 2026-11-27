// Ferramentas de avisos da IA (Fase 3 · Etapa 5): o dono ajusta os avisos pela conversa.
// Entram no mesmo planejador das tarefas (`registrar`), com recibo para desfazer.
// Regras ficam em `notice_rules` (por tipo ou por item); preferências em `notice_settings`.
// O vigia (`avisos_vigia`) lê as duas a cada minuto.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import { acharPorNome, falha, normalizarHora, recibo, registrar, resolverQuando, type Ctx, type ResultadoFerramenta } from './tarefas.ts';
import { instanteSP, partesSP } from './recorrencia.ts';

export type TipoAviso =
  | 'tarefa_atrasada' | 'lembrete_hora' | 'prazo_projeto' | 'resumo_manha' | 'resumo_noite';

export const NOMES_TIPO: Record<TipoAviso, string> = {
  tarefa_atrasada: 'tarefas atrasadas',
  lembrete_hora: 'lembretes',
  prazo_projeto: 'prazo de projeto',
  resumo_manha: 'resumo da manhã',
  resumo_noite: 'resumo da noite',
};

/** "atrasadas", "resumo da manhã", "lembretes"... -> tipo. Aceita o próprio nome técnico. */
export function tipoAviso(x: unknown): TipoAviso | null {
  if (typeof x !== 'string') return null;
  const t = normalizar(x).trim();
  if (t in NOMES_TIPO) return t as TipoAviso;
  if (/resumo.*(manha|dia seguinte)|bom dia/.test(t)) return 'resumo_manha';
  if (/resumo.*noite|resumo do dia/.test(t)) return 'resumo_noite';
  if (/atrasad|tarefa/.test(t)) return 'tarefa_atrasada';
  if (/lembrete/.test(t)) return 'lembrete_hora';
  if (/prazo|projeto/.test(t)) return 'prazo_projeto';
  return null;
}

/** Tabela e coluna de nome do item de cada tipo (para "silencia a tarefa Ler"). */
const ITEM: Partial<Record<TipoAviso, { tabela: string; nome: string; filtro: (q: any) => any }>> = {
  tarefa_atrasada: { tabela: 'tasks', nome: 'title', filtro: (q) => q.is('done_at', null).eq('archived', false) },
  lembrete_hora: { tabela: 'reminders', nome: 'title', filtro: (q) => q.is('done_at', null) },
  prazo_projeto: { tabela: 'projects', nome: 'name', filtro: (q) => q.eq('archived', false) },
};

/**
 * Até quando silenciar: horas ("por 2 horas"), dias ("por 3 dias"), um dia (QUANDO: "até amanhã" = volta a
 * avisar quando amanhã começar; "hoje" = até o fim de hoje) ou para sempre (null). Devolve ISO, null ou erro.
 */
export function resolverAte(a: Record<string, unknown>, hoje: string, agora = new Date()): string | null | { erro: string } {
  const horas = Number(a.por_horas ?? 0);
  if (Number.isFinite(horas) && horas > 0) return new Date(agora.getTime() + Math.round(horas * 60) * 60_000).toISOString();
  const dias = Number(a.por_dias ?? 0);
  if (Number.isFinite(dias) && dias > 0) {
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.round(dias));
    return instanteSP(d.toISOString().slice(0, 10), '00:00');
  }
  const dia = resolverQuando(a, hoje);
  if (dia === undefined || dia === null) return null;
  if (dia < hoje) return { erro: 'Essa data já passou.' };
  return instanteSP(dia, dia === hoje ? '23:59' : '00:00');
}

export function rotuloAte(iso: string | null, hoje: string): string {
  if (!iso) return 'até você pedir de volta';
  const { data, hora } = partesSP(iso);
  if (data === hoje) return `até hoje às ${hora}`;
  return hora === '00:00' ? `até ${data.slice(8, 10)}/${data.slice(5, 7)}` : `até ${data.slice(8, 10)}/${data.slice(5, 7)} às ${hora}`;
}

interface RegraBD {
  id: string; kind: TipoAviso; entity_id: string | null; active: boolean;
  fixed_time: string | null; muted_until: string | null; note: string | null; deleted_at: string | null;
}
const CAMPOS_REGRA = 'id, kind, entity_id, active, fixed_time, muted_until, note, deleted_at';
interface Prefs {
  id: string; enabled: boolean; quiet_start: string; quiet_end: string; morning_at: string; evening_at: string;
}
const CAMPOS_PREFS = 'id, enabled, quiet_start, quiet_end, morning_at, evening_at';

async function regraAtual(sb: SupabaseClient, kind: TipoAviso, entity: string | null): Promise<RegraBD | null> {
  let q = sb.from('notice_rules').select(CAMPOS_REGRA).is('deleted_at', null).eq('kind', kind);
  q = entity ? q.eq('entity_id', entity) : q.is('entity_id', null);
  const { data } = await q.limit(1).maybeSingle();
  return (data as RegraBD | null) ?? null;
}

/** Cria ou muda a regra (uma por tipo/item), com recibo. */
async function gravarRegra(ctx: Ctx, kind: TipoAviso, entity: string | null, m: Partial<RegraBD>, acao: string) {
  const antes = await regraAtual(ctx.sb, kind, entity);
  const r = antes
    ? await ctx.sb.from('notice_rules').update(m).eq('id', antes.id).select(CAMPOS_REGRA).single()
    : await ctx.sb.from('notice_rules').insert({ kind, entity_id: entity, ...m }).select(CAMPOS_REGRA).single();
  if (r.error) throw new Error(r.error.message);
  await recibo(ctx.sb, acao, antes, r.data as RegraBD, 'notice_rules');
  return r.data as RegraBD;
}

async function prefs(sb: SupabaseClient): Promise<Prefs> {
  const { data } = await sb.from('notice_settings').select(CAMPOS_PREFS).is('deleted_at', null).limit(1).maybeSingle();
  if (data) return data as Prefs;
  const r = await sb.from('notice_settings').insert({}).select(CAMPOS_PREFS).single();
  if (r.error) throw new Error(r.error.message);
  return r.data as Prefs;
}

async function mudarPrefs(ctx: Ctx, m: Partial<Prefs>, acao: string) {
  const antes = await prefs(ctx.sb);
  const r = await ctx.sb.from('notice_settings').update(m).eq('id', antes.id).select(CAMPOS_PREFS).single();
  if (r.error) throw new Error(r.error.message);
  await recibo(ctx.sb, acao, antes, r.data as Prefs, 'notice_settings');
  return r.data as Prefs;
}

/** Item citado ("a tarefa Ler") -> id e nome. Texto = erro para o dono. */
async function acharItem(sb: SupabaseClient, kind: TipoAviso, ref: string): Promise<{ id: string; nome: string } | string> {
  const it = ITEM[kind];
  if (!it) return `O aviso de ${NOMES_TIPO[kind]} não é de um item só: dá para ligar, desligar ou mudar a hora dele todo.`;
  const { data, error } = await it.filtro(sb.from(it.tabela).select(`id, ${it.nome}`).is('deleted_at', null)).limit(300);
  if (error) return `Não consegui procurar (${error.message}).`;
  const lista = ((data ?? []) as Record<string, string>[]).map((x) => ({ id: x.id!, title: x[it.nome]! }));
  const c = acharPorNome(ref, lista);
  if (c.length === 1) return { id: c[0]!.id, nome: c[0]!.title };
  if (c.length > 1) return `"${ref}" bate com mais de um: ${c.slice(0, 5).map((x) => `**${x.title}**`).join(', ')}. Qual?`;
  return `Não achei "${ref}" entre ${it.tabela === 'projects' ? 'os projetos' : it.tabela === 'reminders' ? 'os lembretes' : 'as tarefas'}.`;
}

const hh = (t: string | null) => (t ? t.slice(0, 5) : '');

/** Tipo + item (opcional) a partir dos argumentos; erro em texto. */
async function alvo(ctx: Ctx, a: Record<string, unknown>, ferramenta: string) {
  const kind = tipoAviso(a.tipo);
  if (!kind) return falha(ferramenta, 'De qual aviso? (tarefas atrasadas, lembretes, prazo de projeto, resumo da manhã ou da noite)');
  const ref = typeof a.ref === 'string' ? a.ref.trim() : '';
  if (!ref) return { kind, item: null as { id: string; nome: string } | null };
  const item = await acharItem(ctx.sb, kind, ref);
  if (typeof item === 'string') return falha(ferramenta, item);
  return { kind, item };
}
const ehFalha = (x: unknown): x is ResultadoFerramenta => !!x && typeof x === 'object' && 'ferramenta' in x;
const nomeAlvo = (kind: TipoAviso, item: { nome: string } | null) => (item ? `**${item.nome}** (${NOMES_TIPO[kind]})` : `**${NOMES_TIPO[kind]}**`);

const FERRAMENTAS = `
avisos_silenciar {tipo: TIPO_AVISO, ref?: "nome ou id do item", por_horas?: número, por_dias?: número, QUANDO? (até esse dia)}   (sem prazo = até pedir de volta)
avisos_ligar {tipo?: TIPO_AVISO, ref?: "nome ou id"}   (volta a avisar; sem tipo = religa todos os avisos)
avisos_desligar_todos {}   (para de avisar de tudo, até religar)
avisos_horario {tipo: TIPO_AVISO, hora: "HH:MM"|null}   (avisar só nessa hora; null = na hora em que acontece. Resumos: muda a hora do resumo)
avisos_configurar {silencio_inicio?: "HH:MM", silencio_fim?: "HH:MM", resumo_manha?: "HH:MM", resumo_noite?: "HH:MM"}
avisos_listar {quantos?: número}   (últimos avisos com o motivo de cada um, e as regras que o dono pediu)
TIPO_AVISO = "tarefa_atrasada"|"lembrete_hora"|"prazo_projeto"|"resumo_manha"|"resumo_noite"`;

const REGRAS = [
  '- AVISOS (o que o J.A.R.V.I.S. manda sozinho: PC e celular) = avisos_*. "não me avisa mais do resumo da noite" -> avisos_silenciar {tipo:"resumo_noite"}; "silencia a tarefa Ler até amanhã" -> {tipo:"tarefa_atrasada", ref:"Ler", quando:"amanha"}; "silencia os avisos de tarefa por 2 horas" -> {tipo:"tarefa_atrasada", por_horas:2}.',
  '- "me manda o resumo da manhã às 9h" -> avisos_configurar {resumo_manha:"09:00"}; "não me incomoda depois das 23h" / "silêncio das 23h às 7h" -> avisos_configurar {silencio_inicio:"23:00", silencio_fim:"07:00"}; "só me avisa de tarefa atrasada às 18h" -> avisos_horario {tipo:"tarefa_atrasada", hora:"18:00"}.',
  '- "por que você me avisou?", "quais avisos você mandou?" -> avisos_listar. "me lembra/me avisa de X às H" continua sendo lembretes_criar (não é avisos_*).',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(avisos?|notifica\w*|silencia\w*|silencio|resumo d[ao] (manha|noite|dia)|me incomod\w*|para de (me )?avisar|por que (voce )?me avisou)\b/,
  executores: {
    async avisos_silenciar(ctx, a) {
      const t = await alvo(ctx, a, 'avisos_silenciar');
      if (ehFalha(t)) return t;
      const ate = resolverAte(a, ctx.hoje);
      if (ate && typeof ate === 'object') return falha('avisos_silenciar', ate.erro);
      const r = await gravarRegra(ctx, t.kind, t.item?.id ?? null,
        ate ? { active: true, muted_until: ate } : { active: false, muted_until: null }, 'avisos_silenciar');
      return {
        ferramenta: 'avisos_silenciar', ok: true, resumo: `silenciado ${NOMES_TIPO[t.kind]}`, fatos: { regra: r },
        texto: `Certo, sem avisos de ${nomeAlvo(t.kind, t.item)} ${rotuloAte(ate, ctx.hoje)}.`, ids: [r.id],
      };
    },

    async avisos_ligar(ctx, a) {
      if (!a.tipo) {
        const p = await mudarPrefs(ctx, { enabled: true }, 'avisos_ligar');
        return { ferramenta: 'avisos_ligar', ok: true, resumo: 'avisos ligados', fatos: { preferencias: p }, texto: 'Avisos ligados de novo.', ids: [p.id] };
      }
      const t = await alvo(ctx, a, 'avisos_ligar');
      if (ehFalha(t)) return t;
      const antes = await regraAtual(ctx.sb, t.kind, t.item?.id ?? null);
      if (!antes || (antes.active && !antes.muted_until)) {
        return { ferramenta: 'avisos_ligar', ok: true, resumo: 'já estava ligado', fatos: {}, texto: `Os avisos de ${nomeAlvo(t.kind, t.item)} já estão ligados.`, ids: [] };
      }
      const r = await gravarRegra(ctx, t.kind, t.item?.id ?? null, { active: true, muted_until: null }, 'avisos_ligar');
      return {
        ferramenta: 'avisos_ligar', ok: true, resumo: `ligado ${NOMES_TIPO[t.kind]}`, fatos: { regra: r },
        texto: `Voltei a avisar de ${nomeAlvo(t.kind, t.item)}.`, ids: [r.id],
      };
    },

    async avisos_desligar_todos(ctx) {
      const p = await mudarPrefs(ctx, { enabled: false }, 'avisos_desligar_todos');
      return {
        ferramenta: 'avisos_desligar_todos', ok: true, resumo: 'avisos desligados', fatos: { preferencias: p },
        texto: 'Desliguei todos os avisos. Para voltar, é só dizer "liga os avisos".', ids: [p.id],
      };
    },

    async avisos_horario(ctx, a) {
      const kind = tipoAviso(a.tipo);
      if (!kind) return falha('avisos_horario', 'De qual aviso?');
      const hora = a.hora === null ? null : normalizarHora(a.hora);
      if (a.hora !== null && !hora) return falha('avisos_horario', 'Em que hora?');
      if (kind === 'resumo_manha' || kind === 'resumo_noite') {
        if (!hora) return falha('avisos_horario', 'O resumo precisa de uma hora. Qual?');
        const p = await mudarPrefs(ctx, kind === 'resumo_manha' ? { morning_at: hora } : { evening_at: hora }, 'avisos_horario');
        return { ferramenta: 'avisos_horario', ok: true, resumo: `${NOMES_TIPO[kind]} às ${hora}`, fatos: { preferencias: p }, texto: `O **${NOMES_TIPO[kind]}** passa a sair às ${hora}.`, ids: [p.id] };
      }
      const r = await gravarRegra(ctx, kind, null, { fixed_time: hora }, 'avisos_horario');
      return {
        ferramenta: 'avisos_horario', ok: true, resumo: hora ? `${NOMES_TIPO[kind]} às ${hora}` : `${NOMES_TIPO[kind]} na hora`, fatos: { regra: r },
        texto: hora ? `Os avisos de **${NOMES_TIPO[kind]}** vão sair só às ${hora}, todos juntos.` : `Os avisos de **${NOMES_TIPO[kind]}** voltam a sair na hora em que acontecem.`,
        ids: [r.id],
      };
    },

    async avisos_configurar(ctx, a) {
      const m: Partial<Prefs> = {};
      const campos: [string, keyof Prefs, string][] = [
        ['silencio_inicio', 'quiet_start', 'silêncio começa'], ['silencio_fim', 'quiet_end', 'silêncio termina'],
        ['resumo_manha', 'morning_at', 'resumo da manhã'], ['resumo_noite', 'evening_at', 'resumo da noite'],
      ];
      const ditos: string[] = [];
      for (const [arg, col, nome] of campos) {
        if (a[arg] === undefined) continue;
        const h = normalizarHora(a[arg]);
        if (!h) return falha('avisos_configurar', `Não entendi a hora de "${nome}".`);
        (m as Record<string, string>)[col] = h;
        ditos.push(`${nome} às ${h}`);
      }
      if (!ditos.length) return falha('avisos_configurar', 'O que devo mudar? (horário de silêncio ou dos resumos)');
      const p = await mudarPrefs(ctx, m, 'avisos_configurar');
      return {
        ferramenta: 'avisos_configurar', ok: true, resumo: ditos.join(', '), fatos: { preferencias: p },
        texto: `Feito: ${ditos.join('; ')}.\nSilêncio das ${hh(p.quiet_start)} às ${hh(p.quiet_end)} (urgente fura). Resumos às ${hh(p.morning_at)} e às ${hh(p.evening_at)}.`,
        ids: [p.id],
      };
    },

    async avisos_listar(ctx, a) {
      const n = Math.min(Math.max(Number(a.quantos) || 8, 1), 20);
      const [avisos, regras, p] = await Promise.all([
        ctx.sb.from('notices').select('id, kind, title, reason, status, channels, created_at').is('deleted_at', null)
          .is('group_id', null).order('created_at', { ascending: false }).limit(n),
        ctx.sb.from('notice_rules').select(CAMPOS_REGRA).is('deleted_at', null),
        prefs(ctx.sb),
      ]);
      const lista = (avisos.data ?? []) as { id: string; kind: TipoAviso; title: string; reason: string; status: string; channels: string[]; created_at: string }[];
      const status: Record<string, string> = {
        enviado: '', segurado_silencio: ' · segurado (silêncio)', juntado: ' · junto com outros', silenciado: ' · silenciado', agendado: ' · agendado',
      };
      const linhas = lista.map((x) => {
        const { data, hora } = partesSP(x.created_at);
        const quando = data === ctx.hoje ? `hoje ${hora}` : `${data.slice(8, 10)}/${data.slice(5, 7)} ${hora}`;
        return `- ${quando} · **${x.title}**${status[x.status] ?? ''}\n  ${x.reason}`;
      });
      const rs = ((regras.data ?? []) as RegraBD[]).filter((r) => !r.active || r.muted_until || r.fixed_time);
      const regrasTxt = rs.map((r) => {
        const nome = NOMES_TIPO[r.kind] + (r.entity_id ? ' (um item)' : '');
        if (!r.active) return `- ${nome}: desligado`;
        if (r.muted_until && Date.parse(r.muted_until) > Date.now()) return `- ${nome}: silenciado ${rotuloAte(r.muted_until, ctx.hoje)}`;
        return r.fixed_time ? `- ${nome}: só às ${hh(r.fixed_time)}` : '';
      }).filter(Boolean);
      const texto = [
        lista.length ? `**Últimos avisos (${lista.length})**\n${linhas.join('\n')}` : 'Ainda não mandei nenhum aviso.',
        `**Como está:** ${p.enabled ? 'avisos ligados' : 'avisos DESLIGADOS'}; silêncio das ${hh(p.quiet_start)} às ${hh(p.quiet_end)}; resumos às ${hh(p.morning_at)} e às ${hh(p.evening_at)}.`,
        regrasTxt.length ? `**O que você pediu:**\n${regrasTxt.join('\n')}` : '',
      ].filter(Boolean).join('\n\n');
      return {
        ferramenta: 'avisos_listar', ok: true, resumo: `${lista.length} aviso(s)`, fatos: { avisos: lista, regras: rs, preferencias: p },
        texto, ids: lista.map((x) => x.id),
      };
    },
  },
});
