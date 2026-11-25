// Ferramentas de projetos da IA (Fase 2 · Etapa 3). Entram no mesmo planejador das tarefas
// (`registrar`), com recibo para desfazer e confirmação `cf_` para apagar.
// Projeto = objetivo com marcos (etapas com data-alvo) e tarefas num quadro (a fazer / fazendo / feito).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizar } from './sensivel.ts';
import {
  acharPorNome, atualizar, avisoReferencias, dataHumana, falha, pedirConfirmacao, quando, recibo, registrar,
  resolverQuando, resolverTarefas, CAMPOS_TAREFA, type Ctx, type ResultadoFerramenta, type Tarefa,
} from './tarefas.ts';

export type StatusProjeto = 'planejamento' | 'em_andamento' | 'pausado' | 'concluido';
const STATUS: StatusProjeto[] = ['planejamento', 'em_andamento', 'pausado', 'concluido'];
const NOME_STATUS: Record<StatusProjeto, string> = {
  planejamento: 'planejamento', em_andamento: 'em andamento', pausado: 'pausado', concluido: 'concluído',
};

export interface Projeto {
  id: string;
  name: string;
  description: string | null;
  priority: 'alta' | 'media' | 'baixa';
  status: StatusProjeto;
  due_date: string | null;
  archived: boolean;
  deleted_at: string | null;
}

export interface Marco {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
  deleted_at: string | null;
}

const CAMPOS = 'id, name, description, priority, status, due_date, archived, deleted_at';
const CAMPOS_MARCO = 'id, project_id, title, due_date, done_at, deleted_at';

async function projetosAtivos(sb: SupabaseClient, incluirConcluidos = true): Promise<Projeto[]> {
  let q = sb.from('projects').select(CAMPOS).is('deleted_at', null).eq('archived', false);
  if (!incluirConcluidos) q = q.neq('status', 'concluido');
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Projeto[];
}

/** Acha um projeto por "nome ou id"; texto = aviso para o dono. */
async function acharProjeto(sb: SupabaseClient, ref: unknown): Promise<Projeto | string> {
  const r = String(ref ?? '').trim();
  if (!r) return 'Qual projeto?';
  const base = await projetosAtivos(sb);
  const c = acharPorNome(r, base.map((p) => ({ ...p, title: p.name })));
  if (c.length === 1) return base.find((p) => p.id === c[0]!.id)!;
  if (c.length > 1) return `"${r}" bate com mais de um projeto: ${c.slice(0, 5).map((p) => `**${p.title}**`).join(', ')}. Qual?`;
  return `Não achei projeto chamado "${r}".`;
}

async function marcosDe(sb: SupabaseClient, projetoId: string): Promise<Marco[]> {
  const { data, error } = await sb.from('project_milestones').select(CAMPOS_MARCO)
    .eq('project_id', projetoId).is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false }).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Marco[];
}

async function acharMarco(sb: SupabaseClient, projeto: Projeto, ref: unknown): Promise<Marco | string> {
  const r = String(ref ?? '').trim();
  if (!r) return `Qual marco de **${projeto.name}**?`;
  const ms = await marcosDe(sb, projeto.id);
  const c = acharPorNome(r, ms);
  if (c.length === 1) return c[0]!;
  if (c.length > 1) return `"${r}" bate com mais de um marco: ${c.slice(0, 5).map((m) => `**${m.title}**`).join(', ')}. Qual?`;
  return `**${projeto.name}** não tem marco chamado "${r}".`;
}

async function tarefasDe(sb: SupabaseClient, projetoId: string): Promise<Tarefa[]> {
  const { data, error } = await sb.from('tasks').select(CAMPOS_TAREFA)
    .eq('project_id', projetoId).is('deleted_at', null).eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Tarefa[];
}

async function mudarProjeto(ctx: Ctx, p: Projeto, m: Partial<Projeto>, acao: string): Promise<Projeto | null> {
  const { data, error } = await ctx.sb.from('projects').update(m).eq('id', p.id).select(CAMPOS).single();
  if (error) {
    console.warn('projetos: update falhou', error.message);
    return null;
  }
  await recibo(ctx.sb, acao, p, data as Projeto, 'projects');
  return data as Projeto;
}

const pct = (feitas: number, total: number) => (total ? Math.round((feitas / total) * 100) : 0);
const prazo = (d: string | null, hoje: string) => (d ? ` · prazo ${dataHumana(d, hoje)}${d < hoje ? ' (atrasado)' : ''}` : '');

/** Status a partir do que a IA mandou (aceita "em andamento", "concluído"...). */
function lerStatus(s: unknown): StatusProjeto | null {
  const v = normalizar(String(s ?? '')).replace(/\s+/g, '_');
  if (STATUS.includes(v as StatusProjeto)) return v as StatusProjeto;
  if (/^(conclu|termin|finaliz|feito)/.test(v)) return 'concluido';
  if (/^(paus|parad|congel)/.test(v)) return 'pausado';
  if (/^(andamento|ativ|retom|comec|inici)/.test(v)) return 'em_andamento';
  if (/^planej/.test(v)) return 'planejamento';
  return null;
}

const FERRAMENTAS = `
projetos_criar {nome, descricao?, QUANDO? (prazo do projeto), prioridade?, marcos?: ["título do marco", ...]}
projetos_listar {filtro?: "abertos"|"todos"|"concluidos"}
projetos_ver {ref: "nome ou id"}   (marcos, tarefas e progresso de um projeto)
projetos_editar {ref: "nome ou id", nome?, descricao?, status?: "planejamento"|"em_andamento"|"pausado"|"concluido", QUANDO? (prazo), prioridade?}
projetos_apagar {ref: "nome ou id"}
projetos_criar_marco {projeto: "nome", titulo, QUANDO? (data-alvo)}
projetos_concluir_marco {projeto: "nome", ref: "nome do marco"}
projetos_mover_tarefas {refs: ["tarefa", ...], projeto?: "nome"|null (null = tirar do projeto), marco?: "nome"|null, coluna?: "a_fazer"|"fazendo"}`;

const REGRAS = [
  '- PROJETO = objetivo maior com etapas (ex.: "Reformar o quarto", "Lançar o app"). "cria o projeto X" -> projetos_criar. "cria a tarefa Y no projeto X" -> tarefas_criar com projeto:"X". "coloca/põe/move a tarefa Y no projeto X" -> projetos_mover_tarefas. "comecei a Y"/"estou fazendo a Y" (tarefa de projeto) -> projetos_mover_tarefas coluna:"fazendo".',
  '- Use o nome exato da lista de projetos abaixo quando der para saber qual é. Marco = etapa do projeto com data-alvo ("marco", "etapa", "fase").',
  '- "como está o projeto X?"/"progresso do X" -> projetos_ver. "terminei o projeto X" -> projetos_editar status:"concluido". "pausa o projeto X" -> status:"pausado".',
];

registrar({
  ferramentas: FERRAMENTAS,
  regras: REGRAS,
  detector: /\b(projet\w*|marcos?|etapas?|fases? d[oe]|kanban|quadro)\b/,

  async contexto(sb) {
    const ps = await projetosAtivos(sb, false);
    if (!ps.length) return 'Projetos abertos: (nenhum)';
    const ids = ps.slice(0, 30).map((p) => p.id);
    const { data } = await sb.from('project_milestones').select('project_id, title').in('project_id', ids)
      .is('deleted_at', null).is('done_at', null);
    const marcos = new Map<string, string[]>();
    for (const m of (data ?? []) as { project_id: string; title: string }[]) {
      marcos.set(m.project_id, [...(marcos.get(m.project_id) ?? []), m.title]);
    }
    return `Projetos abertos (nome | status | marcos em aberto):\n${ps.slice(0, 30)
      .map((p) => `- ${p.name} | ${NOME_STATUS[p.status]} | ${(marcos.get(p.id) ?? []).slice(0, 6).join('; ') || '-'}`).join('\n')}`;
  },

  async aoCriarTarefa(ctx, a) {
    if (a.projeto === undefined || a.projeto === null || a.projeto === '') return {};
    const p = await acharProjeto(ctx.sb, a.projeto);
    if (typeof p === 'string') return p;
    const campos: Record<string, unknown> = { project_id: p.id, nome_projeto: p.name };
    if (a.marco) {
      const m = await acharMarco(ctx.sb, p, a.marco);
      if (typeof m === 'string') return m;
      campos.milestone_id = m.id;
    }
    return campos;
  },

  executores: {
    async projetos_criar(ctx, a) {
      const nome = String(a.nome ?? a.titulo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
      if (!nome) return falha('projetos_criar', 'Qual é o nome do projeto?');
      const existentes = await projetosAtivos(ctx.sb);
      const igual = existentes.find((p) => normalizar(p.name) === normalizar(nome));
      if (igual) {
        return {
          ferramenta: 'projetos_criar', ok: true, resumo: 'já existia', fatos: { ja_existia: true, projeto: igual },
          texto: `Esse projeto já existe: **${igual.name}** (${NOME_STATUS[igual.status]}).`, ids: [igual.id],
        };
      }
      const prio = ['alta', 'media', 'baixa'].includes(String(a.prioridade)) ? String(a.prioridade) : 'media';
      const { data, error } = await ctx.sb.from('projects').insert({
        name: nome, priority: prio, status: 'em_andamento', due_date: resolverQuando(a, ctx.hoje) ?? null,
        description: typeof a.descricao === 'string' && a.descricao.trim() ? a.descricao.trim().slice(0, 2000) : null,
      }).select(CAMPOS).single();
      if (error) return falha('projetos_criar', `Não consegui criar o projeto (${error.message}).`);
      const p = data as Projeto;
      await recibo(ctx.sb, 'projetos_criar', null, p, 'projects');
      const titulos = (Array.isArray(a.marcos) ? a.marcos : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
      const criados: string[] = [];
      for (const [i, t] of titulos.entries()) {
        const { data: m } = await ctx.sb.from('project_milestones')
          .insert({ project_id: p.id, title: t.slice(0, 200), position: i }).select(CAMPOS_MARCO).single();
        if (m) {
          await recibo(ctx.sb, 'projetos_criar', null, m as Marco, 'project_milestones');
          criados.push(t);
        }
      }
      return {
        ferramenta: 'projetos_criar', ok: true, resumo: `projeto "${p.name}"`, fatos: { projeto: p, marcos: criados },
        texto: `Projeto criado: **${p.name}**${prazo(p.due_date, ctx.hoje)}.${criados.length ? `\nMarcos: ${criados.map((t) => `**${t}**`).join(', ')}.` : ''}`,
        ids: [p.id],
      };
    },

    async projetos_listar(ctx, a) {
      const filtro = String(a.filtro ?? 'abertos');
      let ps = await projetosAtivos(ctx.sb);
      if (filtro === 'abertos') ps = ps.filter((p) => p.status !== 'concluido');
      else if (filtro === 'concluidos') ps = ps.filter((p) => p.status === 'concluido');
      if (!ps.length) {
        return {
          ferramenta: 'projetos_listar', ok: true, resumo: '0 projetos', fatos: { total: 0 },
          texto: filtro === 'concluidos' ? 'Nenhum projeto concluído.' : 'Nenhum projeto aberto. Quer criar um?', ids: [],
        };
      }
      const { data } = await ctx.sb.from('tasks').select('project_id, done_at').in('project_id', ps.map((p) => p.id))
        .is('deleted_at', null);
      const cont = new Map<string, { t: number; f: number }>();
      for (const t of (data ?? []) as { project_id: string; done_at: string | null }[]) {
        const c = cont.get(t.project_id) ?? { t: 0, f: 0 };
        c.t++;
        if (t.done_at) c.f++;
        cont.set(t.project_id, c);
      }
      const linhas = ps.map((p) => {
        const c = cont.get(p.id) ?? { t: 0, f: 0 };
        return `- **${p.name}** · ${NOME_STATUS[p.status]} · ${c.t ? `${c.f}/${c.t} tarefas (${pct(c.f, c.t)}%)` : 'sem tarefas'}${prazo(p.due_date, ctx.hoje)}`;
      });
      const titulo = filtro === 'concluidos' ? 'Projetos concluídos' : filtro === 'todos' ? 'Projetos' : 'Projetos abertos';
      return {
        ferramenta: 'projetos_listar', ok: true, resumo: `${ps.length} projeto(s)`,
        fatos: { filtro, total: ps.length, projetos: ps }, texto: `**${titulo} (${ps.length})**\n${linhas.join('\n')}`,
        ids: ps.map((p) => p.id),
      };
    },

    async projetos_ver(ctx, a) {
      const p = await acharProjeto(ctx.sb, a.ref ?? a.projeto ?? a.nome);
      if (typeof p === 'string') return falha('projetos_ver', p);
      const [ms, ts] = await Promise.all([marcosDe(ctx.sb, p.id), tarefasDe(ctx.sb, p.id)]);
      const feitas = ts.filter((t) => t.done_at);
      const fazendo = ts.filter((t) => !t.done_at && t.board_column === 'fazendo');
      const aFazer = ts.filter((t) => !t.done_at && t.board_column !== 'fazendo');
      const lt = (t: Tarefa) => `- ${t.title}${t.due_date ? ` · ${quando(t, ctx.hoje)}` : ''}`;
      const partes = [
        `**${p.name}** · ${NOME_STATUS[p.status]}${prazo(p.due_date, ctx.hoje)} · ${ts.length ? `${feitas.length}/${ts.length} tarefas (${pct(feitas.length, ts.length)}%)` : 'sem tarefas'}`,
      ];
      if (p.description) partes.push(p.description);
      if (ms.length) {
        partes.push(`**Marcos**\n${ms.map((m) => `- ${m.done_at ? '✓' : '○'} ${m.title}${m.due_date ? ` · ${dataHumana(m.due_date, ctx.hoje)}` : ''}`).join('\n')}`);
      }
      if (fazendo.length) partes.push(`**Fazendo (${fazendo.length})**\n${fazendo.map(lt).join('\n')}`);
      if (aFazer.length) partes.push(`**A fazer (${aFazer.length})**\n${aFazer.slice(0, 20).map(lt).join('\n')}`);
      if (feitas.length) partes.push(`Feitas: ${feitas.length}.`);
      return {
        ferramenta: 'projetos_ver', ok: true, resumo: `projeto "${p.name}"`,
        fatos: { projeto: p, marcos: ms, tarefas: ts.length, feitas: feitas.length, fazendo: fazendo.length },
        texto: partes.join('\n\n'), ids: [p.id],
      };
    },

    async projetos_editar(ctx, a) {
      const p = await acharProjeto(ctx.sb, a.ref ?? a.projeto);
      if (typeof p === 'string') return falha('projetos_editar', p);
      const m: Partial<Projeto> = {};
      if (typeof a.nome === 'string' && a.nome.trim()) m.name = a.nome.trim().slice(0, 200);
      if (typeof a.descricao === 'string') m.description = a.descricao.trim().slice(0, 2000) || null;
      if (a.status !== undefined) {
        const s = lerStatus(a.status);
        if (!s) return falha('projetos_editar', 'Status do projeto: planejamento, em andamento, pausado ou concluído.');
        m.status = s;
      }
      const d = resolverQuando(a, ctx.hoje);
      if (d !== undefined) m.due_date = d;
      if (['alta', 'media', 'baixa'].includes(String(a.prioridade))) m.priority = a.prioridade as Projeto['priority'];
      if (!Object.keys(m).length) return falha('projetos_editar', `O que devo mudar em **${p.name}**?`);
      const n = await mudarProjeto(ctx, p, m, 'projetos_editar');
      if (!n) return falha('projetos_editar', 'Não consegui salvar a mudança.');
      return {
        ferramenta: 'projetos_editar', ok: true, resumo: `editado "${n.name}"`, fatos: { antes: p, depois: n },
        texto: n.status === 'concluido' && p.status !== 'concluido'
          ? `Projeto **${n.name}** concluído. Parabéns, Senhor.`
          : `Atualizado: **${n.name}** · ${NOME_STATUS[n.status]}${prazo(n.due_date, ctx.hoje)}.`,
        ids: [n.id],
      };
    },

    async projetos_apagar(ctx, a) {
      const p = await acharProjeto(ctx.sb, a.ref ?? a.projeto ?? (Array.isArray(a.refs) ? a.refs[0] : undefined));
      if (typeof p === 'string') return falha('projetos_apagar', p);
      return pedirConfirmacao(ctx.sb, 'projetos_apagar', [{ id: p.id, title: p.name }],
        'apagar este projeto (as tarefas dele continuam na lista)');
    },

    async projetos_criar_marco(ctx, a) {
      const p = await acharProjeto(ctx.sb, a.projeto ?? a.ref);
      if (typeof p === 'string') return falha('projetos_criar_marco', p);
      const titulo = String(a.titulo ?? a.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
      if (!titulo) return falha('projetos_criar_marco', 'Qual é o marco?');
      const ms = await marcosDe(ctx.sb, p.id);
      const igual = ms.find((m) => normalizar(m.title) === normalizar(titulo));
      if (igual) {
        return {
          ferramenta: 'projetos_criar_marco', ok: true, resumo: 'já existia', fatos: { ja_existia: true, marco: igual },
          texto: `**${p.name}** já tem o marco **${igual.title}**.`, ids: [igual.id],
        };
      }
      const { data, error } = await ctx.sb.from('project_milestones').insert({
        project_id: p.id, title: titulo, due_date: resolverQuando(a, ctx.hoje) ?? null, position: ms.length,
      }).select(CAMPOS_MARCO).single();
      if (error) return falha('projetos_criar_marco', `Não consegui criar o marco (${error.message}).`);
      const m = data as Marco;
      await recibo(ctx.sb, 'projetos_criar_marco', null, m, 'project_milestones');
      return {
        ferramenta: 'projetos_criar_marco', ok: true, resumo: `marco "${m.title}"`, fatos: { projeto: p.name, marco: m },
        texto: `Marco criado em **${p.name}**: **${m.title}**${m.due_date ? ` · ${dataHumana(m.due_date, ctx.hoje)}` : ''}.`,
        ids: [m.id],
      };
    },

    async projetos_concluir_marco(ctx, a) {
      const p = await acharProjeto(ctx.sb, a.projeto);
      if (typeof p === 'string') return falha('projetos_concluir_marco', p);
      const m = await acharMarco(ctx.sb, p, a.ref ?? a.marco ?? a.titulo);
      if (typeof m === 'string') return falha('projetos_concluir_marco', m);
      if (m.done_at) {
        return {
          ferramenta: 'projetos_concluir_marco', ok: true, resumo: 'já concluído', fatos: { marco: m },
          texto: `O marco **${m.title}** já estava concluído.`, ids: [m.id],
        };
      }
      const { data, error } = await ctx.sb.from('project_milestones').update({ done_at: new Date().toISOString() })
        .eq('id', m.id).select(CAMPOS_MARCO).single();
      if (error) return falha('projetos_concluir_marco', 'Não consegui concluir o marco.');
      await recibo(ctx.sb, 'projetos_concluir_marco', m, data as Marco, 'project_milestones');
      const restantes = (await marcosDe(ctx.sb, p.id)).filter((x) => !x.done_at);
      return {
        ferramenta: 'projetos_concluir_marco', ok: true, resumo: `marco "${m.title}" concluído`, fatos: { marco: data, restantes: restantes.length },
        texto: `Marco **${m.title}** concluído ✓${restantes.length ? ` · faltam ${restantes.length} em **${p.name}**.` : ` · todos os marcos de **${p.name}** estão feitos.`}`,
        ids: [m.id],
      };
    },

    async projetos_mover_tarefas(ctx, a) {
      const r = await resolverTarefas(ctx.sb, a.refs ?? a.ref);
      const aviso = avisoReferencias(r);
      if (!r.achadas.length) return falha('projetos_mover_tarefas', aviso || 'Quais tarefas?');
      const m: Partial<Tarefa> = {};
      let destino = '';
      let projeto: Projeto | null = null;
      if (a.projeto === null) {
        m.project_id = null;
        m.milestone_id = null;
        destino = 'fora do projeto';
      } else if (a.projeto !== undefined && a.projeto !== '') {
        const p = await acharProjeto(ctx.sb, a.projeto);
        if (typeof p === 'string') return falha('projetos_mover_tarefas', p);
        projeto = p;
        m.project_id = p.id;
        m.milestone_id = null;
        destino = `em **${p.name}**`;
      }
      if (a.marco !== undefined) {
        if (a.marco === null) m.milestone_id = null;
        else {
          let p = projeto;
          if (!p) {
            const pid = r.achadas[0]!.project_id;
            if (!pid) return falha('projetos_mover_tarefas', 'Em qual projeto fica esse marco?');
            const achado = (await projetosAtivos(ctx.sb)).find((x) => x.id === pid);
            if (!achado) return falha('projetos_mover_tarefas', 'Em qual projeto fica esse marco?');
            p = achado;
          }
          const mc = await acharMarco(ctx.sb, p, a.marco);
          if (typeof mc === 'string') return falha('projetos_mover_tarefas', mc);
          m.project_id = p.id;
          m.milestone_id = mc.id;
          destino = `em **${p.name}** › ${mc.title}`;
        }
      }
      if (a.coluna === 'a_fazer' || a.coluna === 'fazendo') {
        m.board_column = a.coluna;
        m.done_at = null;
        destino += `${destino ? ', ' : ''}em "${a.coluna === 'fazendo' ? 'fazendo' : 'a fazer'}"`;
      }
      if (!Object.keys(m).length) return falha('projetos_mover_tarefas', 'Para onde devo mover?');
      const feitas: Tarefa[] = [];
      for (const t of r.achadas) {
        const n = await atualizar(ctx, t, m, 'projetos_mover_tarefas');
        if (n) feitas.push(n);
      }
      return {
        ferramenta: 'projetos_mover_tarefas', ok: feitas.length > 0, resumo: `${feitas.length} movida(s)`, fatos: { tarefas: feitas },
        texto: [`Pronto: ${feitas.map((t) => `**${t.title}**`).join(', ')} ${destino}.`, aviso].filter(Boolean).join('\n\n'),
        ids: feitas.map((t) => t.id),
      };
    },
  },

  confirmar: {
    async projetos_apagar(ctx, ids): Promise<ResultadoFerramenta> {
      const { data } = await ctx.sb.from('projects').select(CAMPOS).in('id', ids).is('deleted_at', null);
      const alvo = (data ?? []) as Projeto[];
      if (!alvo.length) return falha('jarvis_confirmar', 'O projeto não existe mais.');
      const feitos: Projeto[] = [];
      for (const p of alvo) {
        const n = await mudarProjeto(ctx, p, { deleted_at: new Date().toISOString() }, 'projetos_apagar');
        if (n) feitos.push(n);
      }
      return {
        ferramenta: 'jarvis_confirmar', ok: true, resumo: `projetos_apagar: ${feitos.length}`, fatos: { projetos: feitos },
        texto: `Projeto apagado: ${feitos.map((p) => `**${p.name}**`).join(', ')}. As tarefas dele continuam na lista. Se mudar de ideia, é só dizer "desfaz".`,
        ids: feitos.map((p) => p.id),
      };
    },
  },
});
