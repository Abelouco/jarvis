// Ferramentas de lembretes da IA (Fase 2 · Etapa 2). Entram no mesmo planejador das tarefas
// (`registrar`), com recibo para desfazer e confirmação `cf_` para apagar.
// Lembrete = aviso numa hora certa. O app do PC avisa (notificação do Windows) quando chega a hora.
// A hora sai daqui, nunca da IA: ela só diz "amanhã", "segunda", "daqui a 20 minutos", "às 15h".
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import {
  acharPorNome, avisoReferencias, dataHumana, falha, normalizarHora, pedirConfirmacao, recibo, registrar, resolverQuando,
  resolverTarefas, type Ctx, type ResultadoFerramenta, type Tarefa,
} from './tarefas.ts';
import {
  agoraHHMM, descreverRecorrencia, deslocarLembrete, instanteSP, lembreteDaTarefa, normalizarRecorrencia, partesSP,
  primeiraData, proximaData, somarDias, type Recorrencia,
} from './recorrencia.ts';

export interface Lembrete {
  id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  priority: 'alta' | 'media' | 'baixa';
  alarm: boolean;
  recurrence: Recorrencia | null;
  done_at: string | null;
  deleted_at: string | null;
  /** A tarefa de onde o lembrete nasceu (concluir/apagar/mudar o prazo dela leva o lembrete junto). */
  task_id: string | null;
}

const CAMPOS = 'id, title, notes, remind_at, priority, alarm, recurrence, done_at, deleted_at, task_id';

/**
 * Instante do lembrete de uma tarefa a partir do LEMBRAR da IA: {antes_minutos} conta do prazo da tarefa;
 * {QUANDO?, hora} é uma hora certa (sem QUANDO, no dia do prazo). Tarefa fixa: o lembrete repete junto.
 * Devolve o instante e a repetição, ou um texto de erro.
 */
export function instanteDaTarefa(
  t: Pick<Tarefa, 'due_date' | 'due_time' | 'recurrence'>, l: Record<string, unknown>, hoje: string, agora = new Date(),
): { iso: string; rec: Recorrencia | null } | string {
  const rec = (t.recurrence ?? null) as Recorrencia | null;
  if (l.hora === undefined || l.hora === null) {
    const antes = Number(l.antes_minutos ?? 0);
    if (!Number.isFinite(antes) || antes < 0) return 'Quanto tempo antes devo avisar?';
    if (!t.due_date) return 'A tarefa não tem data: quando devo avisar?';
    if (!t.due_time) return 'A tarefa não tem hora: a que horas devo avisar?';
    const iso = lembreteDaTarefa(t.due_date, t.due_time, antes)!;
    if (!rec && Date.parse(iso) <= agora.getTime()) return 'Essa hora de aviso já passou.';
    return { iso, rec };
  }
  const hora = normalizarHora(l.hora);
  if (!hora) return 'A que horas devo avisar?';
  const dia = resolverQuando(l, hoje) ?? t.due_date ?? (hora > agoraHHMM(agora) ? hoje : somarDias(hoje, 1));
  return { iso: instanteSP(dia, hora), rec };
}

/** Lembretes (não apagados) ligados a uma tarefa. */
async function daTarefa(sb: SupabaseClient, taskId: string): Promise<Lembrete[]> {
  const { data } = await sb.from('reminders').select(CAMPOS).eq('task_id', taskId).is('deleted_at', null);
  return (data ?? []) as Lembrete[];
}

/** "hoje às 15:00", "segunda, 30/11 às 08:00", "toda segunda às 20:00 (próximo: segunda, 30/11)". */
export function quandoLembrete(l: Pick<Lembrete, 'remind_at' | 'recurrence'>, hoje: string): string {
  const { data, hora } = partesSP(l.remind_at);
  if (l.recurrence) return `${descreverRecorrencia(l.recurrence)} às ${hora} (próximo: ${dataHumana(data, hoje)})`;
  return `${dataHumana(data, hoje)} às ${hora}`;
}

/**
 * Instante do lembrete a partir do que a IA entendeu. Devolve ISO ou um texto de erro.
 * `agora` só para os testes.
 */
export function resolverInstante(a: Record<string, unknown>, hoje: string, agora = new Date()): { iso: string; rec: Recorrencia | null } | string {
  const rec = normalizarRecorrencia(a.repetir);
  const em = Number(a.em_minutos ?? 0) + Number(a.em_horas ?? 0) * 60;
  if (!rec && Number.isFinite(em) && em > 0) {
    return { iso: new Date(agora.getTime() + Math.round(em) * 60_000).toISOString(), rec: null };
  }
  const hora = normalizarHora(a.hora);
  const pedida = resolverQuando(a, hoje);
  if (rec) {
    if (!hora) return 'A que horas devo avisar?';
    const data = (pedida && proximaData(rec, pedida, true)) || primeiraData(rec, hora, agora);
    if (!data) return 'Essa repetição não tem próxima data.';
    return { iso: instanteSP(data, hora), rec };
  }
  if (!hora) return pedida ? 'A que horas devo avisar?' : 'Quando devo avisar?';
  // Só a hora: hoje, se ainda não passou; senão amanhã.
  const data = pedida ?? (hora > agoraHHMM(agora) ? hoje : somarDias(hoje, 1));
  return { iso: instanteSP(data, hora), rec: null };
}

async function abertos(sb: SupabaseClient): Promise<Lembrete[]> {
  const { data, error } = await sb.from('reminders').select(CAMPOS)
    .is('deleted_at', null).is('done_at', null).order('remind_at').limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Lembrete[];
}

async function resolver(sb: SupabaseClient, refs: unknown) {
  const lista = (Array.isArray(refs) ? refs : [refs]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const base = await abertos(sb);
  const achados: Lembrete[] = [];
  const avisos: string[] = [];
  for (const ref of lista) {
    const c = acharPorNome(ref, base);
    if (c.length === 1) {
      if (!achados.some((l) => l.id === c[0]!.id)) achados.push(c[0]!);
    } else if (c.length > 1) avisos.push(`"${ref}" bate com mais de um: ${c.slice(0, 5).map((l) => `**${l.title}**`).join(', ')}. Qual?`);
    else avisos.push(`Não achei lembrete ativo para "${ref}".`);
  }
  return { achados, aviso: avisos.join('\n') };
}

async function mudar(ctx: Ctx, l: Lembrete, m: Partial<Lembrete>, acao: string): Promise<Lembrete | null> {
  const { data, error } = await ctx.sb.from('reminders').update(m).eq('id', l.id).select(CAMPOS).single();
  if (error) {
    console.warn('lembretes: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, l, data as Lembrete, 'reminders');
  return data as Lembrete;
}

/** Lembrete fixo: concluir leva para a próxima ocorrência, mesma hora. */
export function proximoInstante(l: Pick<Lembrete, 'remind_at' | 'recurrence'>, agora = new Date()): string | null {
  if (!l.recurrence) return null;
  const { data, hora } = partesSP(l.remind_at);
  const hoje = partesSP(agora.toISOString()).data;
  const base = data > hoje ? data : hoje;
  const prox = proximaData(l.recurrence, base, false);
  return prox ? instanteSP(prox, hora) : null;
}

async function concluirVarios(ctx: Ctx, alvo: Lembrete[]) {
  const feitos: Lembrete[] = [];
  for (const l of alvo) {
    const prox = proximoInstante(l);
    const n = await mudar(ctx, l, prox ? { remind_at: prox } : { done_at: new Date().toISOString() }, 'lembretes_concluir');
    if (n) feitos.push(n);
  }
  return feitos;
}

const linha = (l: Lembrete, hoje: string) => `- **${l.title}** · ${quandoLembrete(l, hoje)}${l.alarm ? ' · alarme' : ''}`;

const FERRAMENTAS = `
lembretes_criar {titulo, QUANDO?, hora?: "HH:MM", em_minutos?: número, em_horas?: número, repetir?: REPETIR, alarme?: true, prioridade?, notas?, tarefa?: "nome ou id", antes_minutos?: número}   (tarefa = lembrete de uma tarefa que já existe)
lembretes_listar {filtro?: "proximos"|"hoje"|"todos"}
lembretes_concluir {refs: ["nome ou id", ...]}   (o dono já viu/fez; lembrete fixo passa para o próximo)
lembretes_adiar {ref: "nome ou id", em_minutos?: número, QUANDO?, hora?}   (adiar/soneca)
lembretes_editar {ref: "nome ou id", titulo?, QUANDO?, hora?, repetir?: REPETIR|null, alarme?: boolean, notas?}
lembretes_apagar {refs: ["nome ou id", ...]}`;

const REGRAS = [
  '- LEMBRETE x TAREFA: "me lembra", "me avisa", "lembrete", "alarme", "desperta" = lembretes_*. "tarefa", "anota", "preciso fazer" sem pedir aviso = tarefas_*.',
  '- Lembrete: "daqui a 20 minutos" -> em_minutos:20; "em 2 horas" -> em_horas:2; "às 15h" -> hora:"15:00" (sem QUANDO); "amanhã às 9h" -> quando:"amanha", hora:"09:00". "todo dia às 7h tomar água" -> repetir:{freq:"diaria"}, hora:"07:00". "alarme"/"desperta"/"me acorda" -> alarme:true.',
  '- O título do lembrete é o que avisar (ex.: "Ligar para o dentista"), sem a hora.',
  '- TAREFA COM LEMBRETE: se a mesma mensagem cria uma tarefa E pede aviso dela, é UMA ação: tarefas_criar com lembrar (nunca um lembretes_criar separado). "cria a tarefa X sexta às 14h e me lembra 1 hora antes" -> tarefas_criar {..., lembrar:{antes_minutos:60}}; "...e me avisa na hora" -> lembrar:{antes_minutos:0}; "...e me lembra amanhã às 9h" -> lembrar:{quando:"amanha", hora:"09:00"}. Para uma tarefa que JÁ existe ("me lembra da tarefa X 30 min antes") -> lembretes_criar {tarefa:"X", antes_minutos:30}.',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(lembr\w*|me avis\w*|avis[ae] (me|que)|alarme\w*|despert\w*|me acord\w*|soneca)\b/,

  /** "cria a tarefa X ... e me lembra": a tarefa já foi criada; aqui nasce o lembrete ligado a ela. */
  async depoisDeCriarTarefa(ctx, t, a) {
    if (!a.lembrar) return '';
    const l = (typeof a.lembrar === 'object' ? a.lembrar : {}) as Record<string, unknown>;
    const r = instanteDaTarefa(t, l, ctx.hoje);
    if (typeof r === 'string') return ` Não pus o lembrete: ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
    const { data, error } = await ctx.sb.from('reminders').insert({
      title: t.title, remind_at: r.iso, recurrence: r.rec, alarm: l.alarme === true || a.alarme === true,
      priority: t.priority, task_id: t.id,
    }).select(CAMPOS).single();
    if (error) return ` Não consegui pôr o lembrete (${error.message}).`;
    // Mesma ação da tarefa: "desfaz" leva os dois juntos.
    await recibo(ctx.sb, 'tarefas_criar', null, data as Lembrete, 'reminders');
    return ` Vou avisar ${quandoLembrete(data as Lembrete, ctx.hoje)}.`;
  },

  /** Concluir/reabrir/apagar a tarefa leva o lembrete junto; mudar o prazo leva o lembrete junto (mesma antecedência). */
  async aoAtualizarTarefa(ctx, antes, depois, acao) {
    const ls = await daTarefa(ctx.sb, depois.id);
    if (!ls.length) return;
    const agora = new Date().toISOString();
    for (const l of ls) {
      let m: Partial<Lembrete> | null = null;
      if (depois.deleted_at && !antes.deleted_at) m = { deleted_at: agora };
      else if (depois.done_at && !antes.done_at) m = l.done_at ? null : { done_at: agora };
      else if (!depois.done_at && antes.done_at) m = l.done_at && Date.parse(l.remind_at) > Date.now() ? { done_at: null } : null;
      else if (l.done_at) m = null;
      // Tarefa fixa concluída: o prazo anda, mas o lembrete fixo já anda sozinho.
      else if ((!l.recurrence || acao !== 'tarefas_concluir')
        && (antes.due_date !== depois.due_date || antes.due_time !== depois.due_time)) {
        const novo = deslocarLembrete(l.remind_at, { data: antes.due_date, hora: antes.due_time },
          { data: depois.due_date, hora: depois.due_time });
        if (novo) m = { remind_at: novo };
      }
      if (m) await mudar(ctx, l, m, acao);
    }
  },
  executores: {
    async lembretes_criar(ctx, a) {
      let tarefa: Tarefa | null = null;
      if (a.tarefa) {
        const rt = await resolverTarefas(ctx.sb, a.tarefa);
        if (rt.achadas.length !== 1) return falha('lembretes_criar', avisoReferencias(rt) || 'De qual tarefa?');
        tarefa = rt.achadas[0]!;
      }
      const titulo = String(a.titulo ?? tarefa?.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
      if (!titulo) return falha('lembretes_criar', 'Do que devo lembrar?');
      const r = tarefa && (a.antes_minutos !== undefined || (!a.hora && !a.em_minutos && !a.em_horas))
        ? instanteDaTarefa(tarefa, { antes_minutos: a.antes_minutos ?? 0 }, ctx.hoje)
        : resolverInstante(a, ctx.hoje);
      if (typeof r === 'string') return falha('lembretes_criar', r);
      const ativos = await abertos(ctx.sb);
      const igual = ativos.find((l) => normalizar(l.title) === normalizar(titulo) && l.remind_at === r.iso);
      if (igual) {
        return {
          ferramenta: 'lembretes_criar', ok: true, resumo: 'já existia', fatos: { ja_existia: true, lembrete: igual },
          texto: `Esse já está marcado: **${igual.title}** · ${quandoLembrete(igual, ctx.hoje)}.`, ids: [igual.id],
        };
      }
      const prio = ['alta', 'media', 'baixa'].includes(String(a.prioridade)) ? String(a.prioridade) : 'media';
      const { data, error } = await ctx.sb.from('reminders').insert({
        title: titulo, remind_at: r.iso, recurrence: r.rec, alarm: a.alarme === true, priority: prio, task_id: tarefa?.id ?? null,
        notes: typeof a.notas === 'string' && a.notas.trim() ? a.notas.trim().slice(0, 2000) : null,
      }).select(CAMPOS).single();
      if (error) return falha('lembretes_criar', `Não consegui criar o lembrete (${error.message}).`);
      const l = data as Lembrete;
      await recibo(ctx.sb, 'lembretes_criar', null, l, 'reminders');
      return {
        ferramenta: 'lembretes_criar', ok: true, resumo: `lembrete "${l.title}"`, fatos: { lembrete: l },
        texto: `Vou avisar: **${l.title}** · ${quandoLembrete(l, ctx.hoje)}${l.alarm ? ' · com alarme' : ''}.`,
        ids: [l.id],
      };
    },

    async lembretes_listar(ctx, a) {
      const filtro = String(a.filtro ?? 'proximos');
      let lista = await abertos(ctx.sb);
      if (filtro === 'hoje') lista = lista.filter((l) => partesSP(l.remind_at).data <= ctx.hoje);
      else if (filtro === 'proximos') lista = lista.slice(0, 15);
      const texto = lista.length
        ? `**Lembretes${filtro === 'hoje' ? ' de hoje' : ''} (${lista.length})**\n${lista.slice(0, 30).map((l) => linha(l, ctx.hoje)).join('\n')}`
        : 'Nenhum lembrete marcado.';
      return {
        ferramenta: 'lembretes_listar', ok: true, resumo: `${lista.length} lembrete(s)`,
        fatos: { filtro, total: lista.length, lembretes: lista.slice(0, 30) }, texto, ids: lista.map((l) => l.id),
      };
    },

    async lembretes_concluir(ctx, a) {
      const { achados, aviso } = await resolver(ctx.sb, a.refs ?? a.ref);
      if (!achados.length) return falha('lembretes_concluir', aviso || 'Qual lembrete?');
      const feitos = await concluirVarios(ctx, achados);
      return {
        ferramenta: 'lembretes_concluir', ok: feitos.length > 0, resumo: `${feitos.length} concluído(s)`, fatos: { lembretes: feitos },
        texto: [`Feito: ${feitos.map((l) => `**${l.title}**${l.recurrence ? ` (próximo: ${quandoLembrete(l, ctx.hoje)})` : ''}`).join(', ')} ✓`, aviso]
          .filter(Boolean).join('\n\n'),
        ids: feitos.map((l) => l.id),
      };
    },

    async lembretes_adiar(ctx, a) {
      const { achados, aviso } = await resolver(ctx.sb, a.ref ?? a.refs);
      if (achados.length !== 1) return falha('lembretes_adiar', aviso || 'Qual lembrete?');
      const l = achados[0]!;
      const r = resolverInstante({ em_minutos: 10, ...a, repetir: undefined }, ctx.hoje);
      if (typeof r === 'string') return falha('lembretes_adiar', r);
      const n = await mudar(ctx, l, { remind_at: r.iso }, 'lembretes_adiar');
      if (!n) return falha('lembretes_adiar', 'Não consegui adiar.');
      return {
        ferramenta: 'lembretes_adiar', ok: true, resumo: 'adiado', fatos: { lembrete: n },
        texto: `Adiado: **${n.title}** · ${quandoLembrete({ ...n, recurrence: null }, ctx.hoje)}.`, ids: [n.id],
      };
    },

    async lembretes_editar(ctx, a) {
      const { achados, aviso } = await resolver(ctx.sb, a.ref ?? a.refs);
      if (achados.length !== 1) return falha('lembretes_editar', aviso || 'Qual lembrete?');
      const l = achados[0]!;
      const m: Partial<Lembrete> = {};
      if (typeof a.titulo === 'string' && a.titulo.trim()) m.title = a.titulo.trim().slice(0, 200);
      if (typeof a.alarme === 'boolean') m.alarm = a.alarme;
      if (typeof a.notas === 'string') m.notes = a.notas.trim().slice(0, 2000) || null;
      const atual = partesSP(l.remind_at);
      const mexeuNaHora = a.hora !== undefined || resolverQuando(a, ctx.hoje) !== undefined || a.em_minutos !== undefined
        || a.em_horas !== undefined || a.repetir !== undefined;
      if (mexeuNaHora) {
        const repetir = a.repetir === undefined ? l.recurrence : a.repetir;
        const r = resolverInstante({ hora: atual.hora, ...a, repetir }, ctx.hoje);
        if (typeof r === 'string') return falha('lembretes_editar', r);
        m.remind_at = r.iso;
        m.recurrence = r.rec;
      }
      if (!Object.keys(m).length) return falha('lembretes_editar', `O que devo mudar em **${l.title}**?`);
      const n = await mudar(ctx, l, m, 'lembretes_editar');
      if (!n) return falha('lembretes_editar', 'Não consegui salvar a mudança.');
      return {
        ferramenta: 'lembretes_editar', ok: true, resumo: `editado "${n.title}"`, fatos: { antes: l, depois: n },
        texto: `Atualizado: **${n.title}** · ${quandoLembrete(n, ctx.hoje)}${n.alarm ? ' · com alarme' : ''}.`, ids: [n.id],
      };
    },

    async lembretes_apagar(ctx, a) {
      const { achados, aviso } = await resolver(ctx.sb, a.refs ?? a.ref);
      if (!achados.length) return falha('lembretes_apagar', aviso || 'Qual lembrete?');
      const c = await pedirConfirmacao(ctx.sb, 'lembretes_apagar', achados,
        achados.length === 1 ? 'apagar este lembrete' : `apagar ${achados.length} lembretes`);
      if (aviso) c.texto += `\n\n${aviso}`;
      return c;
    },
  },
  confirmar: {
    async lembretes_apagar(ctx, ids): Promise<ResultadoFerramenta> {
      const { data } = await ctx.sb.from('reminders').select(CAMPOS).in('id', ids).is('deleted_at', null);
      const alvo = (data ?? []) as Lembrete[];
      if (!alvo.length) return falha('jarvis_confirmar', 'Os lembretes não existem mais.');
      const feitos: Lembrete[] = [];
      for (const l of alvo) {
        const n = await mudar(ctx, l, { deleted_at: new Date().toISOString() }, 'lembretes_apagar');
        if (n) feitos.push(n);
      }
      return {
        ferramenta: 'jarvis_confirmar', ok: true, resumo: `lembretes_apagar: ${feitos.length}`, fatos: { lembretes: feitos },
        texto: `Apagado${feitos.length > 1 ? 's' : ''}: ${feitos.map((l) => `**${l.title}**`).join(', ')}. Se mudar de ideia, é só dizer "desfaz".`,
        ids: feitos.map((l) => l.id),
      };
    },
  },
});
