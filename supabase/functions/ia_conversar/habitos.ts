// Ferramentas de hábitos da IA (Fase 2 · Etapa 4). Entram no mesmo planejador das tarefas
// (`registrar`), com recibo para desfazer e confirmação `cf_` para apagar.
// Hábito = constância: feito ou não, minutos ou quantidade por dia; todo dia, em dias da semana ou N vezes por semana.
// O registro do dia (`habit_logs`) tem id fixo por hábito+dia (`idRegistro`), igual ao do app.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import {
  acharPorNome, dataHumana, falha, normalizarHora, pedirConfirmacao, recibo, registrar, resolverQuando,
  type Ctx, type ResultadoFerramenta,
} from './tarefas.ts';
import { numeroDoDia, somarDias } from './recorrencia.ts';
import {
  cumpriu, descreverFrequencia, descreverMeta, idRegistro, previstoNoDia, semana, sequencia, vezesNoMes, type TipoHabito,
} from './habitos_regras.ts';

export interface Habito {
  id: string;
  name: string;
  kind: TipoHabito;
  unit: string | null;
  daily_target: number | null;
  weekdays: number[] | null;
  times_per_week: number | null;
  monthly_target: number | null;
  time_of_day: string | null;
  paused: boolean;
  deleted_at: string | null;
}

interface Registro {
  id: string;
  habit_id: string;
  day: string;
  value: number | null;
  deleted_at: string | null;
}

const CAMPOS = 'id, name, kind, unit, daily_target, weekdays, times_per_week, monthly_target, time_of_day, paused, deleted_at';
const CAMPOS_REG = 'id, habit_id, day, value, deleted_at';

async function ativos(sb: SupabaseClient): Promise<Habito[]> {
  const { data, error } = await sb.from('habits').select(CAMPOS).is('deleted_at', null)
    .order('paused').order('position').order('created_at').limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Habito[];
}

async function acharHabito(sb: SupabaseClient, ref: unknown): Promise<Habito | string> {
  const r = String(ref ?? '').trim();
  if (!r) return 'Qual hábito?';
  const base = await ativos(sb);
  const c = acharPorNome(r, base.map((h) => ({ ...h, title: h.name })));
  if (c.length === 1) return base.find((h) => h.id === c[0]!.id)!;
  if (c.length > 1) return `"${r}" bate com mais de um hábito: ${c.slice(0, 5).map((h) => `**${h.title}**`).join(', ')}. Qual?`;
  return `Não achei hábito chamado "${r}".`;
}

/** Dias cumpridos (até ~400 dias atrás) de cada hábito. */
async function feitosDe(sb: SupabaseClient, hs: Habito[], hoje: string) {
  const mapa = new Map<string, { feitos: Set<string>; valores: Map<string, number> }>();
  for (const h of hs) mapa.set(h.id, { feitos: new Set(), valores: new Map() });
  if (!hs.length) return mapa;
  const { data } = await sb.from('habit_logs').select('habit_id, day, value').in('habit_id', hs.map((h) => h.id))
    .is('deleted_at', null).gte('day', somarDias(hoje, -400)).limit(10000);
  for (const l of (data ?? []) as { habit_id: string; day: string; value: number | null }[]) {
    const m = mapa.get(l.habit_id);
    const h = hs.find((x) => x.id === l.habit_id);
    if (!m || !h) continue;
    const v = l.value == null ? 1 : Number(l.value);
    m.valores.set(l.day, v);
    if (cumpriu(h, v)) m.feitos.add(l.day);
  }
  return mapa;
}

const seq = (s: { n: number; unidade: string }) =>
  s.n ? `sequência de ${s.n} ${s.n === 1 ? s.unidade.replace(/s$/, '') : s.unidade}` : 'sem sequência';

const valorTexto = (h: Habito, v: number) =>
  h.kind === 'duration' ? `${v} min` : h.kind === 'quantity' ? `${v}${h.unit ? ` ${h.unit}` : ''}` : '';

function lerTipo(t: unknown): TipoHabito {
  const v = normalizar(String(t ?? ''));
  if (/^(dura|minut|tempo|hora)/.test(v)) return 'duration';
  if (/^(quant|numer|vezes|contag)/.test(v)) return 'quantity';
  return 'boolean';
}

function lerDias(x: unknown): number[] | null {
  if (!Array.isArray(x)) return null;
  const ds = [...new Set(x.map(numeroDoDia).filter((n): n is number => n !== null))].sort();
  return ds.length && ds.length < 7 ? ds : null;
}

const inteiro = (x: unknown, min: number, max: number) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

async function salvarRegistro(ctx: Ctx, h: Habito, dia: string, valor: number | null, acao: string): Promise<Registro | null> {
  const { data: antes } = await ctx.sb.from('habit_logs').select(CAMPOS_REG).eq('habit_id', h.id).eq('day', dia).maybeSingle();
  const agora = new Date().toISOString();
  let r;
  if (antes) {
    r = await ctx.sb.from('habit_logs').update({ value: valor, deleted_at: valor == null ? agora : null })
      .eq('id', (antes as Registro).id).select(CAMPOS_REG).single();
  } else {
    if (valor == null) return null;
    r = await ctx.sb.from('habit_logs').insert({ id: idRegistro(h.id, dia), habit_id: h.id, day: dia, value: valor })
      .select(CAMPOS_REG).single();
  }
  if (r.error) {
    console.warn('habitos: registro falhou', r.error.message);
    return null;
  }
  await recibo(ctx.sb, acao, (antes as Registro | null) ?? null, r.data as Registro, 'habit_logs');
  return r.data as Registro;
}

async function mudarHabito(ctx: Ctx, h: Habito, m: Partial<Habito>, acao: string): Promise<Habito | null> {
  const { data, error } = await ctx.sb.from('habits').update(m).eq('id', h.id).select(CAMPOS).single();
  if (error) {
    console.warn('habitos: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, h, data as Habito, 'habits');
  return data as Habito;
}

const FERRAMENTAS = `
habitos_criar {nome, tipo?: "sim_nao"|"minutos"|"quantidade", meta?: número por dia, unidade?: "copos"|"páginas"|..., dias_semana?: ["seg", ...], vezes_semana?: número, meta_mes?: número, horario?: "HH:MM"}
habitos_listar {}   (hábitos de hoje: o que falta, o que já foi, sequências)
habitos_marcar {ref: "nome ou id", valor?: número (minutos ou quantidade, SOMA ao dia), QUANDO? (padrão hoje)}
habitos_desmarcar {ref: "nome ou id", QUANDO?}
habitos_ver {ref: "nome ou id"}   (sequência, semana, mês, últimas vezes)
habitos_editar {ref: "nome ou id", nome?, meta?, unidade?, dias_semana?: [...]|null (null = todo dia), vezes_semana?: número|null, meta_mes?: número|null, horario?: "HH:MM"|null, pausado?: boolean}
habitos_apagar {ref: "nome ou id"}`;

const REGRAS = [
  '- HÁBITO = algo que o dono quer fazer com constância (meditar, ler, beber água, treinar). "quero criar o hábito de X"/"todo dia quero X" sem hora certa e sem prazo -> habitos_criar. Com aviso numa hora -> lembrete; afazer pontual -> tarefa.',
  '- Tipo: "30 minutos de leitura" -> tipo:"minutos", meta:30. "8 copos de água" -> tipo:"quantidade", meta:8, unidade:"copos". Sem número -> "sim_nao". "3 vezes por semana" -> vezes_semana:3. "de segunda a sexta" -> dias_semana:["seg","ter","qua","qui","sex"].',
  '- "meditei", "li 20 minutos", "bebi 2 copos", "fiz o treino" (algo que bate com um hábito da lista abaixo) -> habitos_marcar com o nome exato do hábito e valor quando houver número. "ontem eu meditei" -> quando:"ontem".',
  '- "como estão meus hábitos?"/"o que falta hoje?" (sobre hábitos) -> habitos_listar. "pausa o hábito X" -> habitos_editar pausado:true.',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(habit\w*|sequencia|streak|ofensiva|meditei|treinei|malhei|corri|caminhei|pedalei|nadei|estudei|li \d+|li o|li a|bebi|pratiquei|alonguei|orei|rezei|escrevi no diario|fiz (o|a|meu|minha) (treino|meditacao|leitura|exercicio|alongamento|caminhada|corrida))\b/,

  async contexto(sb) {
    const hs = await ativos(sb);
    if (!hs.length) return 'Hábitos: (nenhum)';
    return `Hábitos (nome | tipo | frequência${hs.some((h) => h.paused) ? ' | pausado' : ''}):\n${hs.slice(0, 40)
      .map((h) => `- ${h.name} | ${h.kind === 'boolean' ? 'sim/não' : descreverMeta(h) + ' por dia'} | ${descreverFrequencia(h)}${h.paused ? ' | pausado' : ''}`)
      .join('\n')}`;
  },

  executores: {
    async habitos_criar(ctx, a) {
      const nome = String(a.nome ?? a.titulo ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
      if (!nome) return falha('habitos_criar', 'Qual é o hábito?');
      const existentes = await ativos(ctx.sb);
      const igual = existentes.find((h) => normalizar(h.name) === normalizar(nome));
      if (igual) {
        return {
          ferramenta: 'habitos_criar', ok: true, resumo: 'já existia', fatos: { ja_existia: true, habito: igual },
          texto: `Esse hábito já existe: **${igual.name}** · ${descreverFrequencia(igual)}.`, ids: [igual.id],
        };
      }
      const tipo = a.meta != null && a.tipo === undefined ? 'quantity' : lerTipo(a.tipo);
      const meta = tipo === 'boolean' ? null : Number(a.meta) > 0 ? Number(a.meta) : null;
      const { data, error } = await ctx.sb.from('habits').insert({
        name: nome, kind: tipo, daily_target: meta,
        unit: tipo === 'quantity' && typeof a.unidade === 'string' && a.unidade.trim() ? a.unidade.trim().slice(0, 30) : null,
        weekdays: lerDias(a.dias_semana), times_per_week: inteiro(a.vezes_semana, 1, 7),
        monthly_target: inteiro(a.meta_mes, 1, 31), time_of_day: normalizarHora(a.horario),
        position: Date.now() / 1000,
      }).select(CAMPOS).single();
      if (error) return falha('habitos_criar', `Não consegui criar o hábito (${error.message}).`);
      const h = data as Habito;
      await recibo(ctx.sb, 'habitos_criar', null, h, 'habits');
      const meta_ = descreverMeta(h);
      return {
        ferramenta: 'habitos_criar', ok: true, resumo: `hábito "${h.name}"`, fatos: { habito: h },
        texto: `Hábito criado: **${h.name}** · ${descreverFrequencia(h)}${meta_ ? ` · ${meta_} por dia` : ''}${h.time_of_day ? ` · às ${h.time_of_day.slice(0, 5)}` : ''}.`,
        ids: [h.id],
      };
    },

    async habitos_listar(ctx) {
      const hs = (await ativos(ctx.sb)).filter((h) => !h.paused);
      if (!hs.length) {
        return {
          ferramenta: 'habitos_listar', ok: true, resumo: '0 hábitos', fatos: { total: 0 },
          texto: 'Nenhum hábito ativo. Quer criar um?', ids: [],
        };
      }
      const mapa = await feitosDe(ctx.sb, hs, ctx.hoje);
      const feitos: string[] = [];
      const faltam: string[] = [];
      const livres: string[] = [];
      for (const h of hs) {
        const m = mapa.get(h.id)!;
        const s = sequencia(h, m.feitos, ctx.hoje);
        const sem = semana(h, m.feitos, ctx.hoje);
        const v = m.valores.get(ctx.hoje);
        const extra = h.times_per_week ? ` · ${sem.feitas}/${sem.meta} na semana` : s.n ? ` · ${seq(s)}` : '';
        if (m.feitos.has(ctx.hoje)) feitos.push(`- ✓ **${h.name}**${v && h.kind !== 'boolean' ? ` (${valorTexto(h, v)})` : ''}${extra}`);
        else if (previstoNoDia(h, ctx.hoje) && !(h.times_per_week && sem.feitas >= sem.meta)) {
          const parcial = v && h.kind !== 'boolean' ? ` · ${valorTexto(h, v)} de ${descreverMeta(h)}` : descreverMeta(h) ? ` · ${descreverMeta(h)}` : '';
          faltam.push(`- **${h.name}**${parcial}${h.time_of_day ? ` · ${h.time_of_day.slice(0, 5)}` : ''}${extra}`);
        } else livres.push(h.name);
      }
      const partes: string[] = [];
      if (faltam.length) partes.push(`**Faltam hoje (${faltam.length})**\n${faltam.join('\n')}`);
      if (feitos.length) partes.push(`**Feitos hoje (${feitos.length})**\n${feitos.join('\n')}`);
      if (!faltam.length && feitos.length) partes.unshift('Todos os hábitos de hoje estão feitos.');
      if (livres.length) partes.push(`Fora de hoje: ${livres.join(', ')}.`);
      return {
        ferramenta: 'habitos_listar', ok: true, resumo: `${feitos.length} feito(s), ${faltam.length} faltando`,
        fatos: { feitos: feitos.length, faltam: faltam.length, habitos: hs }, texto: partes.join('\n\n'), ids: hs.map((h) => h.id),
      };
    },

    async habitos_marcar(ctx, a) {
      const h = await acharHabito(ctx.sb, a.ref ?? a.habito ?? a.nome);
      if (typeof h === 'string') return falha('habitos_marcar', h);
      const dia = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
      if (dia > ctx.hoje) return falha('habitos_marcar', 'Só dá para marcar hoje ou dias que já passaram.');
      const { data: atual } = await ctx.sb.from('habit_logs').select('value').eq('habit_id', h.id).eq('day', dia)
        .is('deleted_at', null).maybeSingle();
      const tinha = atual ? (atual.value == null ? 1 : Number(atual.value)) : null;
      const n = Number(a.valor);
      let valor: number;
      if (h.kind === 'boolean') valor = 1;
      else if (Number.isFinite(n) && n > 0) valor = Math.round(((tinha ?? 0) + n) * 100) / 100;
      else valor = Math.max(tinha ?? 0, h.daily_target ?? 1);
      if (h.kind === 'boolean' && tinha) {
        return {
          ferramenta: 'habitos_marcar', ok: true, resumo: 'já marcado', fatos: { habito: h.name, dia },
          texto: `**${h.name}** já estava marcado ${dia === ctx.hoje ? 'hoje' : `em ${dataHumana(dia, ctx.hoje)}`}.`, ids: [h.id],
        };
      }
      const r = await salvarRegistro(ctx, h, dia, valor, 'habitos_marcar');
      if (!r) return falha('habitos_marcar', 'Não consegui marcar.');
      const m = (await feitosDe(ctx.sb, [h], ctx.hoje)).get(h.id)!;
      const s = sequencia(h, m.feitos, ctx.hoje);
      const ok = cumpriu(h, valor);
      const falta = !ok && h.daily_target ? ` · faltam ${valorTexto(h, Math.round((h.daily_target - valor) * 100) / 100)} para a meta` : '';
      return {
        ferramenta: 'habitos_marcar', ok: true, resumo: `marcado "${h.name}"`, fatos: { habito: h.name, dia, valor, sequencia: s },
        texto: `${ok ? '✓ ' : ''}**${h.name}**${h.kind !== 'boolean' ? ` · ${valorTexto(h, valor)}` : ''}${dia !== ctx.hoje ? ` (${dataHumana(dia, ctx.hoje)})` : ''}${falta}${ok && s.n > 1 ? ` · ${seq(s)}` : ''}.`,
        ids: [r.id],
      };
    },

    async habitos_desmarcar(ctx, a) {
      const h = await acharHabito(ctx.sb, a.ref ?? a.habito ?? a.nome);
      if (typeof h === 'string') return falha('habitos_desmarcar', h);
      const dia = resolverQuando(a, ctx.hoje) ?? ctx.hoje;
      const r = await salvarRegistro(ctx, h, dia, null, 'habitos_desmarcar');
      if (!r) return falha('habitos_desmarcar', `**${h.name}** não estava marcado ${dia === ctx.hoje ? 'hoje' : `em ${dataHumana(dia, ctx.hoje)}`}.`);
      return {
        ferramenta: 'habitos_desmarcar', ok: true, resumo: `desmarcado "${h.name}"`, fatos: { habito: h.name, dia },
        texto: `Desmarquei **${h.name}** ${dia === ctx.hoje ? 'hoje' : `em ${dataHumana(dia, ctx.hoje)}`}.`, ids: [r.id],
      };
    },

    async habitos_ver(ctx, a) {
      const h = await acharHabito(ctx.sb, a.ref ?? a.habito ?? a.nome);
      if (typeof h === 'string') return falha('habitos_ver', h);
      const m = (await feitosDe(ctx.sb, [h], ctx.hoje)).get(h.id)!;
      const s = sequencia(h, m.feitos, ctx.hoje);
      const sem = semana(h, m.feitos, ctx.hoje);
      const mes = vezesNoMes(m.feitos, ctx.hoje);
      const ultimas = [...m.feitos].sort().reverse().slice(0, 5).map((d) => dataHumana(d, ctx.hoje));
      const meta = descreverMeta(h);
      const linhas = [
        `**${h.name}** · ${descreverFrequencia(h)}${meta ? ` · ${meta} por dia` : ''}${h.time_of_day ? ` · às ${h.time_of_day.slice(0, 5)}` : ''}${h.paused ? ' · pausado' : ''}`,
        `- ${s.n ? seq(s)[0]!.toUpperCase() + seq(s).slice(1) : 'Sem sequência no momento'}`,
        `- Semana: **${sem.feitas}/${sem.meta}**`,
        `- Mês: **${mes}**${h.monthly_target ? ` de ${h.monthly_target}${mes >= h.monthly_target ? ' ✓' : ` (faltam ${h.monthly_target - mes})`}` : ''} vez(es)`,
        `- Hoje: ${m.feitos.has(ctx.hoje) ? 'feito ✓' : previstoNoDia(h, ctx.hoje) ? (m.valores.get(ctx.hoje) ? `${valorTexto(h, m.valores.get(ctx.hoje)!)} de ${meta}` : 'ainda não') : 'não é dia dele'}`,
        ultimas.length ? `- Últimas vezes: ${ultimas.join(', ')}` : '- Ainda não foi feito nenhuma vez.',
      ];
      return {
        ferramenta: 'habitos_ver', ok: true, resumo: `hábito "${h.name}"`,
        fatos: { habito: h, sequencia: s, semana: sem, mes }, texto: linhas.join('\n'), ids: [h.id],
      };
    },

    async habitos_editar(ctx, a) {
      const h = await acharHabito(ctx.sb, a.ref ?? a.habito);
      if (typeof h === 'string') return falha('habitos_editar', h);
      const m: Partial<Habito> = {};
      if (typeof a.nome === 'string' && a.nome.trim()) m.name = a.nome.trim().slice(0, 120);
      if (a.meta !== undefined) {
        const n = Number(a.meta);
        if (a.meta === null || !(n > 0)) {
          m.daily_target = null;
        } else {
          m.daily_target = n;
          if (h.kind === 'boolean') m.kind = 'quantity';
        }
      }
      if (typeof a.unidade === 'string') m.unit = a.unidade.trim().slice(0, 30) || null;
      if (a.dias_semana !== undefined) {
        m.weekdays = a.dias_semana === null ? null : lerDias(a.dias_semana);
        if (a.vezes_semana === undefined) m.times_per_week = null;
      }
      if (a.vezes_semana !== undefined) m.times_per_week = a.vezes_semana === null ? null : inteiro(a.vezes_semana, 1, 7);
      if (a.meta_mes !== undefined) m.monthly_target = a.meta_mes === null ? null : inteiro(a.meta_mes, 1, 31);
      if (a.horario !== undefined) m.time_of_day = a.horario === null ? null : normalizarHora(a.horario);
      if (typeof a.pausado === 'boolean') m.paused = a.pausado;
      if (!Object.keys(m).length) return falha('habitos_editar', `O que devo mudar em **${h.name}**?`);
      const n = await mudarHabito(ctx, h, m, 'habitos_editar');
      if (!n) return falha('habitos_editar', 'Não consegui salvar a mudança.');
      const meta = descreverMeta(n);
      return {
        ferramenta: 'habitos_editar', ok: true, resumo: `editado "${n.name}"`, fatos: { antes: h, depois: n },
        texto: n.paused && !h.paused
          ? `Hábito **${n.name}** pausado. A sequência fica guardada.`
          : `Atualizado: **${n.name}** · ${descreverFrequencia(n)}${meta ? ` · ${meta} por dia` : ''}${n.time_of_day ? ` · às ${n.time_of_day.slice(0, 5)}` : ''}${n.paused ? ' · pausado' : ''}.`,
        ids: [n.id],
      };
    },

    async habitos_apagar(ctx, a) {
      const h = await acharHabito(ctx.sb, a.ref ?? a.habito ?? (Array.isArray(a.refs) ? a.refs[0] : undefined));
      if (typeof h === 'string') return falha('habitos_apagar', h);
      return pedirConfirmacao(ctx.sb, 'habitos_apagar', [{ id: h.id, title: h.name }], 'apagar este hábito (e o histórico dele)');
    },
  },

  confirmar: {
    async habitos_apagar(ctx, ids): Promise<ResultadoFerramenta> {
      const { data } = await ctx.sb.from('habits').select(CAMPOS).in('id', ids).is('deleted_at', null);
      const alvo = (data ?? []) as Habito[];
      if (!alvo.length) return falha('jarvis_confirmar', 'O hábito não existe mais.');
      const feitos: Habito[] = [];
      for (const h of alvo) {
        const n = await mudarHabito(ctx, h, { deleted_at: new Date().toISOString() }, 'habitos_apagar');
        if (n) feitos.push(n);
      }
      return {
        ferramenta: 'jarvis_confirmar', ok: true, resumo: `habitos_apagar: ${feitos.length}`, fatos: { habitos: feitos },
        texto: `Hábito apagado: ${feitos.map((h) => `**${h.name}**`).join(', ')}. Se mudar de ideia, é só dizer "desfaz".`,
        ids: feitos.map((h) => h.id),
      };
    },
  },
});
