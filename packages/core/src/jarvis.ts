// Núcleo local-first: o app lê e escreve no SQLite e responde na hora;
// o sync empurra o que mudou aqui e puxa o que mudou no Supabase.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { criarCliente, ouvirEventos, type ArmazenamentoSessao } from './supabase';
import { novoId, prepararBanco, TABELAS_SYNC, type BancoLocal, type TabelaSync, type Valor } from './local';
import type {
  ColunaQuadro, Fonte, Habit, Note, Notice, NoticeRule, NoticeSettings, TipoNota, JarvisEvent, Memory, Message, Milestone, Prioridade, Project, Reminder, StatusProjeto, Task,
} from './types';
import { cumpriu, idRegistro, previstoNoDia, semana, sequencia, vezesNoMes, type TipoHabito } from './habitos';
import {
  dataAposConcluir, hojeSP, instanteSP, normalizarRecorrencia, partesSP, primeiraData, proximaData, type Recorrencia,
} from './recorrencia';

export interface OpcoesJarvis {
  db: BancoLocal;
  sessao?: ArmazenamentoSessao;
  /** Qual app e versão (ex.: "PC v0.1.12"): a IA usa para saber a própria versão. */
  versaoApp?: () => string | Promise<string>;
}

export type EstadoSync = 'parado' | 'sincronizando' | 'offline' | 'erro';

/** O que a IA está fazendo agora (vai ganhar 'agindo' e 'permissao' com as ferramentas). */
export type EstadoIA = 'repouso' | 'pensando' | 'pesquisando' | 'agindo' | 'permissao';

type Ouvinte = () => void;

export interface Atividade {
  id: number;
  /** Ex.: "Tarefa criada". */
  texto: string;
  /** Nome do item, quando ele existe no banco local. */
  detalhe: string | null;
  quando: string;
}

const NOME_ENTIDADE: Record<string, string> = {
  tasks: 'Tarefa', projects: 'Projeto', project_milestones: 'Marco', reminders: 'Lembrete', habits: 'Hábito', notes: 'Nota',
  habit_logs: 'Registro de hábito', memories: 'Memória', memory_links: 'Ligação de memória',
};
/** Entidades de nome feminino ("Tarefa criada"); as outras ficam no masculino ("Projeto criado"). */
const FEMININAS = new Set(['tasks', 'memories', 'memory_links']);
/** Entidades que aparecem em "Atividades recentes" (mensagens só fazem o cérebro pulsar). */
const ENTIDADES_ATIVIDADE = Object.keys(NOME_ENTIDADE);
const NOME_ACAO: Record<string, string> = { created: 'criad', updated: 'atualizad', deleted: 'apagad' };

/** "14:15" se for hoje, "ontem 14:15", ou "21/11 14:15". */
export function quandoCurto(iso: string, agoraRef = new Date()): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (x: Date) => x.toDateString();
  if (dia(d) === dia(agoraRef)) return hora;
  const ontem = new Date(agoraRef);
  ontem.setDate(ontem.getDate() - 1);
  if (dia(d) === dia(ontem)) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

const agora = () => new Date().toISOString();
const somarDiasLocal = (data: string, dias: number) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

function lerFontes(bruto: string | null): Fonte[] | null {
  if (!bruto) return null;
  try {
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((f) => f && typeof f.url === 'string') : null;
  } catch {
    return null;
  }
}
const LOTE = 500;

export function criarJarvis({ db, sessao, versaoApp }: OpcoesJarvis) {
  const sb: SupabaseClient = criarCliente(sessao);
  const ouvintes = new Set<Ouvinte>();
  const ouvintesEvento = new Set<(e: JarvisEvent) => void>();
  let estado: EstadoSync = 'parado';
  let ultimoErro: string | null = null;
  let fila: Promise<void> = Promise.resolve();
  let agendado: ReturnType<typeof setTimeout> | null = null;
  let canal: ReturnType<typeof ouvirEventos> | null = null;
  let relogio: ReturnType<typeof setInterval> | null = null;
  let pronto: Promise<void> | null = null;

  const avisar = () => ouvintes.forEach((f) => f());
  const mudarEstado = (e: EstadoSync, erro: string | null = null) => {
    estado = e;
    ultimoErro = erro;
    avisar();
  };

  async function iniciar() {
    pronto ??= prepararBanco(db);
    await pronto;
    const { data } = await sb.auth.getSession();
    if (data.session) ligarSync();
    sb.auth.onAuthStateChange((_ev, s) => {
      if (s) ligarSync();
      else desligarSync();
      avisar();
    });
  }

  // ---------- login (e-mail e senha; a conta é criada pelo próprio app) ----------
  const auth = {
    /** Cria a conta. Devolve true se já entrou; false se o Supabase exige confirmar o e-mail. */
    async criarConta(email: string, senha: string): Promise<boolean> {
      if (senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
      const { data, error } = await sb.auth.signUp({ email: email.trim().toLowerCase(), password: senha });
      if (error) throw new Error(error.message === 'User already registered' ? 'Esse e-mail já tem conta. Use Entrar.' : error.message);
      return !!data.session;
    },
    async entrar(email: string, senha: string) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    },
    async sessao(): Promise<Session | null> {
      return (await sb.auth.getSession()).data.session;
    },
    async sair() {
      await sb.auth.signOut();
    },
  };

  // ---------- tarefas (sempre no banco local) ----------
  const lerTarefa = (t: Omit<Task, 'archived' | 'recurrence'> & { archived: number; recurrence: string | null }): Task => {
    let recurrence: Recorrencia | null = null;
    try {
      recurrence = t.recurrence ? normalizarRecorrencia(JSON.parse(t.recurrence)) : null;
    } catch {
      /* repetição ilegível: trata como tarefa única */
    }
    return { ...t, archived: !!t.archived, recurrence };
  };
  const tarefas = {
    async listar(): Promise<Task[]> {
      const linhas = await db.consultar<Parameters<typeof lerTarefa>[0]>(
        `select * from tasks where deleted_at is null and archived = 0
         order by done_at is not null, position, created_at desc`,
      );
      return linhas.map(lerTarefa);
    },
    /**
     * Cria uma tarefa. `data` AAAA-MM-DD e `hora` HH:MM (fuso America/Sao_Paulo).
     * Com `repetir`, a data vira a primeira ocorrência da série (se não vier, é calculada).
     */
    async criar(titulo: string, prioridade: Prioridade = 'media', data: string | null = null, hora: string | null = null,
      extra: { repetir?: Recorrencia | null; notas?: string | null; projeto?: string | null; marco?: string | null;
        coluna?: ColunaQuadro } = {}) {
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      const rec = extra.repetir ? normalizarRecorrencia(extra.repetir) : null;
      const dia = rec ? (data && proximaData(rec, data, true)) || primeiraData(rec, hora) : data;
      await db.executar(
        `insert into tasks (id, user_id, project_id, milestone_id, board_column, title, notes, priority, due_date, due_time,
         recurrence, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [novoId(), user, extra.projeto ?? null, extra.projeto ? extra.marco ?? null : null, extra.coluna ?? 'a_fazer',
          titulo.trim(), extra.notas?.trim() || null, prioridade, dia, dia ? hora : null,
          rec ? JSON.stringify(rec) : null, t, t],
      );
      mudouLocal();
    },
    /** Muda os campos dados (os ausentes ficam como estão). */
    async editar(id: string, m: { titulo?: string; prioridade?: Prioridade; data?: string | null; hora?: string | null;
      repetir?: Recorrencia | null; notas?: string | null }) {
      const [atual] = (await db.consultar<Parameters<typeof lerTarefa>[0]>(`select * from tasks where id = ?`, [id])).map(lerTarefa);
      if (!atual) return;
      const rec = m.repetir === undefined ? atual.recurrence : m.repetir ? normalizarRecorrencia(m.repetir) : null;
      const hora = m.hora === undefined ? atual.due_time : m.hora;
      let data = m.data === undefined ? atual.due_date : m.data;
      if (rec) data = (data && proximaData(rec, data, true)) || primeiraData(rec, hora);
      await db.executar(
        `update tasks set title = ?, notes = ?, priority = ?, due_date = ?, due_time = ?, recurrence = ?,
         updated_at = ?, dirty = 1 where id = ?`,
        [m.titulo?.trim() || atual.title, m.notas === undefined ? atual.notes : m.notas?.trim() || null,
          m.prioridade ?? atual.priority, data, data ? hora : null, rec ? JSON.stringify(rec) : null, agora(), id],
      );
      mudouLocal();
    },
    /** Concluir uma tarefa fixa passa ela para a próxima data (e ela continua aberta). */
    async alternarConcluida(id: string) {
      const t = agora();
      const [atual] = (await db.consultar<Parameters<typeof lerTarefa>[0]>(`select * from tasks where id = ?`, [id])).map(lerTarefa);
      if (!atual) return;
      if (!atual.done_at && atual.recurrence) {
        const proxima = dataAposConcluir(atual.recurrence, atual.due_date);
        if (proxima) {
          await db.executar(`update tasks set due_date = ?, updated_at = ?, dirty = 1 where id = ?`, [proxima, t, id]);
          mudouLocal();
          return;
        }
      }
      await db.executar(
        `update tasks set done_at = case when done_at is null then ? else null end,
         updated_at = ?, dirty = 1 where id = ?`,
        [t, t, id],
      );
      mudouLocal();
    },
    /** Exclusão suave: nunca apaga de verdade. */
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update tasks set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
    /**
     * Move no quadro: projeto, marco e coluna (os ausentes ficam como estão).
     * Coluna 'feito' conclui; ir para outra coluna reabre. Trocar de projeto tira do marco.
     */
    async mover(id: string, m: { projeto?: string | null; marco?: string | null; coluna?: ColunaQuadro | 'feito' }) {
      const [atual] = (await db.consultar<Parameters<typeof lerTarefa>[0]>(`select * from tasks where id = ?`, [id])).map(lerTarefa);
      if (!atual) return;
      const projeto = m.projeto === undefined ? atual.project_id : m.projeto;
      let marco = m.marco === undefined ? atual.milestone_id : m.marco;
      if (!projeto || (projeto !== atual.project_id && m.marco === undefined)) marco = null;
      const t = agora();
      let done = atual.done_at;
      let coluna = atual.board_column ?? 'a_fazer';
      if (m.coluna === 'feito') done ??= t;
      else if (m.coluna) {
        coluna = m.coluna;
        done = null;
      }
      await db.executar(
        `update tasks set project_id = ?, milestone_id = ?, board_column = ?, done_at = ?, updated_at = ?, dirty = 1 where id = ?`,
        [projeto, marco, coluna, done, t, id],
      );
      mudouLocal();
    },
  };

  // ---------- projetos e marcos (banco local) ----------
  type LinhaProjeto = Omit<Project, 'archived'> & { archived: number };
  const lerProjeto = (p: LinhaProjeto): Project => ({ ...p, archived: !!p.archived });
  const ORDEM_STATUS = `case p.status when 'em_andamento' then 0 when 'planejamento' then 1 when 'pausado' then 2 else 3 end`;
  const projetos = {
    /** Projetos com o progresso (tarefas concluídas / total, marcos feitos / total). */
    async listar(): Promise<ProjetoResumo[]> {
      const linhas = await db.consultar<LinhaProjeto & { total: number; feitas: number; marcos: number; marcos_feitos: number }>(
        `select p.*,
           (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null) as total,
           (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null and t.done_at is not null) as feitas,
           (select count(*) from project_milestones m where m.project_id = p.id and m.deleted_at is null) as marcos,
           (select count(*) from project_milestones m where m.project_id = p.id and m.deleted_at is null
              and m.done_at is not null) as marcos_feitos
         from projects p where p.deleted_at is null and p.archived = 0
         order by ${ORDEM_STATUS}, p.due_date is null, p.due_date, p.updated_at desc`,
      );
      return linhas.map((l) => ({
        ...lerProjeto(l), total: Number(l.total), feitas: Number(l.feitas),
        marcos: Number(l.marcos), marcosFeitos: Number(l.marcos_feitos),
      }));
    },
    async criar(nome: string, extra: { descricao?: string | null; prazo?: string | null; prioridade?: Prioridade;
      status?: StatusProjeto } = {}): Promise<string> {
      const t = agora();
      const id = novoId();
      const user = (await auth.sessao())?.user.id ?? null;
      await db.executar(
        `insert into projects (id, user_id, name, description, priority, status, due_date, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [id, user, nome.trim(), extra.descricao?.trim() || null, extra.prioridade ?? 'media',
          extra.status ?? 'em_andamento', extra.prazo ?? null, t, t],
      );
      mudouLocal();
      return id;
    },
    async editar(id: string, m: { nome?: string; descricao?: string | null; prazo?: string | null; prioridade?: Prioridade;
      status?: StatusProjeto }) {
      const [atual] = (await db.consultar<LinhaProjeto>(`select * from projects where id = ?`, [id])).map(lerProjeto);
      if (!atual) return;
      await db.executar(
        `update projects set name = ?, description = ?, due_date = ?, priority = ?, status = ?, updated_at = ?, dirty = 1 where id = ?`,
        [m.nome?.trim() || atual.name, m.descricao === undefined ? atual.description : m.descricao?.trim() || null,
          m.prazo === undefined ? atual.due_date : m.prazo, m.prioridade ?? atual.priority, m.status ?? atual.status, agora(), id],
      );
      mudouLocal();
    },
    /** Exclusão suave do projeto. As tarefas guardam o vínculo (se o projeto voltar, voltam junto). */
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update projects set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
    async marcos(projetoId: string): Promise<Milestone[]> {
      return db.consultar<Milestone>(
        `select * from project_milestones where project_id = ? and deleted_at is null
         order by due_date is null, due_date, position, created_at`,
        [projetoId],
      );
    },
    async criarMarco(projetoId: string, titulo: string, prazo: string | null = null) {
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      await db.executar(
        `insert into project_milestones (id, user_id, project_id, title, due_date, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, 1)`,
        [novoId(), user, projetoId, titulo.trim(), prazo, t, t],
      );
      mudouLocal();
    },
    async editarMarco(id: string, m: { titulo?: string; prazo?: string | null }) {
      const [atual] = await db.consultar<Milestone>(`select * from project_milestones where id = ?`, [id]);
      if (!atual) return;
      await db.executar(`update project_milestones set title = ?, due_date = ?, updated_at = ?, dirty = 1 where id = ?`,
        [m.titulo?.trim() || atual.title, m.prazo === undefined ? atual.due_date : m.prazo, agora(), id]);
      mudouLocal();
    },
    async alternarMarco(id: string) {
      const t = agora();
      await db.executar(
        `update project_milestones set done_at = case when done_at is null then ? else null end, updated_at = ?, dirty = 1 where id = ?`,
        [t, t, id],
      );
      mudouLocal();
    },
    /** Exclusão suave do marco; as tarefas dele continuam no projeto (o app trata marco apagado como "sem marco"). */
    async apagarMarco(id: string) {
      const t = agora();
      await db.executar(`update project_milestones set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
  };

  // ---------- hábitos (banco local; o registro do dia tem id fixo por hábito+dia) ----------
  type LinhaHabito = Omit<Habit, 'weekdays' | 'paused'> & { weekdays: string | null; paused: number };
  const lerHabito = (h: LinhaHabito): Habit => {
    let weekdays: number[] | null = null;
    try {
      const w = h.weekdays ? JSON.parse(h.weekdays) : null;
      weekdays = Array.isArray(w) && w.length ? w.map(Number).filter((n) => n >= 0 && n <= 6) : null;
    } catch {
      /* dias ilegíveis: todo dia */
    }
    return {
      ...h, weekdays, paused: !!h.paused, time_of_day: h.time_of_day ? h.time_of_day.slice(0, 5) : null,
      daily_target: h.daily_target == null ? null : Number(h.daily_target),
    };
  };
  const umHabito = async (id: string) =>
    (await db.consultar<LinhaHabito>(`select * from habits where id = ?`, [id])).map(lerHabito)[0];
  const valorDoDia = async (habitId: string, dia: string) => {
    const [l] = await db.consultar<{ value: number | null }>(
      `select value from habit_logs where habit_id = ? and day = ? and deleted_at is null`, [habitId, dia]);
    return l ? (l.value == null ? 1 : Number(l.value)) : null;
  };
  type OpcoesHabito = {
    nome?: string; tipo?: TipoHabito; meta?: number | null; unidade?: string | null; dias?: number[] | null;
    vezesSemana?: number | null; metaMes?: number | null; horario?: string | null; cor?: string; pausado?: boolean;
  };
  const habitos = {
    /** Hábitos com o dia de hoje, a sequência, a semana, o mês e os últimos 14 dias. */
    async listar(hoje = hojeSP()): Promise<HabitoResumo[]> {
      const hs = (await db.consultar<LinhaHabito>(
        `select * from habits where deleted_at is null order by paused, position, created_at`,
      )).map(lerHabito);
      const desde = somarDiasLocal(hoje, -400);
      const logs = await db.consultar<{ habit_id: string; day: string; value: number | null }>(
        `select habit_id, day, value from habit_logs where deleted_at is null and day >= ?`, [desde]);
      const valores = new Map<string, Map<string, number>>();
      for (const l of logs) {
        if (!valores.has(l.habit_id)) valores.set(l.habit_id, new Map());
        valores.get(l.habit_id)!.set(l.day, l.value == null ? 1 : Number(l.value));
      }
      return hs.map((h) => {
        const v = valores.get(h.id) ?? new Map<string, number>();
        const feitos = new Set([...v].filter(([, x]) => cumpriu(h, x)).map(([d]) => d));
        return {
          ...h,
          hojeValor: v.get(hoje) ?? null,
          feitoHoje: feitos.has(hoje),
          previstoHoje: previstoNoDia(h, hoje),
          sequencia: sequencia(h, feitos, hoje),
          semana: semana(h, feitos, hoje),
          mes: vezesNoMes(feitos, hoje),
          ultimos: Array.from({ length: 14 }, (_, i) => {
            const dia = somarDiasLocal(hoje, i - 13);
            return { dia, valor: v.get(dia) ?? null, feito: feitos.has(dia), previsto: previstoNoDia(h, dia) };
          }),
        };
      });
    },
    async criar(nome: string, op: OpcoesHabito = {}): Promise<string> {
      const t = agora();
      const id = novoId();
      const user = (await auth.sessao())?.user.id ?? null;
      const tipo = op.tipo ?? 'boolean';
      await db.executar(
        `insert into habits (id, user_id, name, kind, unit, daily_target, weekdays, times_per_week, monthly_target, time_of_day,
           color, position, paused, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)`,
        [id, user, nome.trim(), tipo, tipo === 'boolean' ? null : op.unidade?.trim() || null,
          tipo === 'boolean' ? null : op.meta ?? null, op.dias?.length ? JSON.stringify(op.dias) : null,
          op.vezesSemana ?? null, op.metaMes ?? null, op.horario ?? null, op.cor ?? 'verde_agua', Date.now() / 1000, t, t],
      );
      mudouLocal();
      return id;
    },
    async editar(id: string, m: OpcoesHabito) {
      const h = await umHabito(id);
      if (!h) return;
      const tipo = m.tipo ?? h.kind;
      const dias = m.dias === undefined ? h.weekdays : m.dias;
      await db.executar(
        `update habits set name = ?, kind = ?, unit = ?, daily_target = ?, weekdays = ?, times_per_week = ?, monthly_target = ?,
           time_of_day = ?, color = ?, paused = ?, updated_at = ?, dirty = 1 where id = ?`,
        [m.nome?.trim() || h.name, tipo, tipo === 'boolean' ? null : (m.unidade === undefined ? h.unit : m.unidade?.trim() || null),
          tipo === 'boolean' ? null : (m.meta === undefined ? h.daily_target : m.meta),
          dias?.length ? JSON.stringify(dias) : null,
          m.vezesSemana === undefined ? h.times_per_week : m.vezesSemana,
          m.metaMes === undefined ? h.monthly_target : m.metaMes,
          m.horario === undefined ? h.time_of_day : m.horario, m.cor ?? h.color,
          (m.pausado ?? h.paused) ? 1 : 0, agora(), id],
      );
      mudouLocal();
    },
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update habits set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
    /** Valor do dia (absoluto). null = desmarcar (exclusão suave do registro). */
    async registrar(habitId: string, dia: string, valor: number | null) {
      const t = agora();
      const [existe] = await db.consultar<{ id: string }>(
        `select id from habit_logs where habit_id = ? and day = ? order by deleted_at is not null limit 1`, [habitId, dia]);
      if (existe) {
        await db.executar(
          `update habit_logs set value = ?, deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`,
          [valor, valor == null ? t : null, t, existe.id],
        );
      } else if (valor != null) {
        const user = (await auth.sessao())?.user.id ?? null;
        await db.executar(
          `insert into habit_logs (id, user_id, habit_id, day, value, created_at, updated_at, dirty) values (?, ?, ?, ?, ?, ?, ?, 1)`,
          [idRegistro(habitId, dia), user, habitId, dia, valor, t, t],
        );
      }
      mudouLocal();
    },
    /** Marca/desmarca o dia: sim/não vira 1; minutos/quantidade vai direto para a meta (ou zera). */
    async alternar(habitId: string, dia = hojeSP()) {
      const h = await umHabito(habitId);
      if (!h) return;
      const atual = await valorDoDia(habitId, dia);
      await habitos.registrar(habitId, dia, cumpriu(h, atual) ? null : (h.kind === 'boolean' ? 1 : h.daily_target ?? 1));
    },
    /** Soma ao valor do dia (minutos ou quantidade). */
    async somar(habitId: string, delta: number, dia = hojeSP()) {
      const atual = (await valorDoDia(habitId, dia)) ?? 0;
      const novo = Math.round((atual + delta) * 100) / 100;
      await habitos.registrar(habitId, dia, novo > 0 ? novo : null);
    },
  };

  // ---------- conhecimento: notas, capturas e diário (banco local) ----------
  type LinhaNota = Omit<Note, 'tags' | 'pinned'> & { tags: string | null; pinned: number };
  const lerNota = (n: LinhaNota): Note => {
    let tags: string[] = [];
    try {
      const t = n.tags ? JSON.parse(n.tags) : [];
      tags = Array.isArray(t) ? t.map(String) : [];
    } catch {
      /* etiquetas ilegíveis: nenhuma */
    }
    return { ...n, tags, pinned: !!n.pinned };
  };
  const limparEtiquetas = (ts: string[] | undefined) =>
    [...new Set((ts ?? []).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 20);
  type OpcoesNota = {
    titulo?: string | null; conteudo?: string; caderno?: string | null; etiquetas?: string[]; fixada?: boolean; tipo?: TipoNota;
  };
  const conhecimento = {
    /** Notas e capturas (não o diário), fixadas primeiro e depois as mais recentes. `termo` busca no título, texto e etiquetas. */
    async listar(filtro: { tipo?: 'nota' | 'captura'; caderno?: string | null; etiqueta?: string; termo?: string } = {}): Promise<Note[]> {
      const onde = [`deleted_at is null`, `kind <> 'diario'`];
      const args: Valor[] = [];
      if (filtro.tipo) {
        onde.push(`kind = ?`);
        args.push(filtro.tipo);
      }
      if (filtro.caderno !== undefined) {
        onde.push(filtro.caderno === null ? `notebook is null` : `notebook = ?`);
        if (filtro.caderno !== null) args.push(filtro.caderno);
      }
      if (filtro.etiqueta) {
        onde.push(`tags like ?`);
        args.push(`%"${filtro.etiqueta.toLowerCase()}"%`);
      }
      if (filtro.termo?.trim()) {
        onde.push(`(title like ? or content like ? or tags like ?)`);
        const t = `%${filtro.termo.trim()}%`;
        args.push(t, t, t);
      }
      return (await db.consultar<LinhaNota>(
        `select * from notes where ${onde.join(' and ')} order by pinned desc, updated_at desc limit 500`, args,
      )).map(lerNota);
    },
    /** Cadernos com a contagem de notas. */
    async cadernos(): Promise<{ nome: string; total: number }[]> {
      return db.consultar<{ nome: string; total: number }>(
        `select notebook as nome, count(*) as total from notes where deleted_at is null and kind = 'nota' and notebook is not null
         group by notebook order by notebook collate nocase`,
      );
    },
    /** Etiquetas usadas, com a contagem. */
    async etiquetas(): Promise<{ nome: string; total: number }[]> {
      const linhas = await db.consultar<{ tags: string | null }>(`select tags from notes where deleted_at is null and tags <> '[]'`);
      const cont = new Map<string, number>();
      for (const l of linhas) for (const t of lerNota({ tags: l.tags } as LinhaNota).tags) cont.set(t, (cont.get(t) ?? 0) + 1);
      return [...cont].map(([nome, total]) => ({ nome, total })).sort((a, b) => a.nome.localeCompare(b.nome));
    },
    async ver(id: string): Promise<Note | undefined> {
      return (await db.consultar<LinhaNota>(`select * from notes where id = ?`, [id])).map(lerNota)[0];
    },
    async criar(op: OpcoesNota & { conteudo: string }): Promise<string> {
      const t = agora();
      const id = novoId();
      const user = (await auth.sessao())?.user.id ?? null;
      const tipo = op.tipo === 'captura' ? 'captura' : 'nota';
      await db.executar(
        `insert into notes (id, user_id, kind, title, content, notebook, tags, pinned, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [id, user, tipo, op.titulo?.trim() || null, op.conteudo, tipo === 'nota' ? op.caderno?.trim() || null : null,
          JSON.stringify(limparEtiquetas(op.etiquetas)), op.fixada ? 1 : 0, t, t],
      );
      mudouLocal();
      return id;
    },
    /** Muda só o que vier. Mudar `caderno` de uma captura a transforma em nota (organizar). */
    async editar(id: string, m: OpcoesNota) {
      const n = await conhecimento.ver(id);
      if (!n) return;
      const tipo = m.tipo ?? (n.kind === 'captura' && m.caderno ? 'nota' : n.kind);
      await db.executar(
        `update notes set kind = ?, title = ?, content = ?, notebook = ?, tags = ?, pinned = ?, updated_at = ?, dirty = 1 where id = ?`,
        [tipo, m.titulo === undefined ? n.title : m.titulo?.trim() || null, m.conteudo ?? n.content,
          m.caderno === undefined ? n.notebook : m.caderno?.trim() || null,
          JSON.stringify(m.etiquetas === undefined ? n.tags : limparEtiquetas(m.etiquetas)),
          (m.fixada ?? n.pinned) ? 1 : 0, agora(), id],
      );
      mudouLocal();
    },
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update notes set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
    /** Entrada do diário do dia (ou undefined). */
    async diario(dia = hojeSP()): Promise<Note | undefined> {
      return (await db.consultar<LinhaNota>(
        `select * from notes where kind = 'diario' and day = ? and deleted_at is null`, [dia],
      )).map(lerNota)[0];
    },
    /** Dias que têm diário entre `de` e `ate` (para o calendário). */
    async diasComDiario(de: string, ate: string): Promise<string[]> {
      return (await db.consultar<{ day: string }>(
        `select day from notes where kind = 'diario' and deleted_at is null and day between ? and ? order by day`, [de, ate],
      )).map((l) => l.day);
    },
    /** Grava o texto do diário do dia (texto vazio = apaga a entrada). id fixo por dono+dia, igual no servidor. */
    async escreverDiario(dia: string, texto: string) {
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      const id = idRegistro(`diario:${user ?? ''}`, dia);
      const [existe] = await db.consultar<{ id: string }>(`select id from notes where id = ?`, [id]);
      const vazio = !texto.trim();
      if (existe) {
        await db.executar(
          `update notes set content = ?, deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`,
          [texto, vazio ? t : null, t, id],
        );
      } else if (!vazio) {
        await db.executar(
          `insert into notes (id, user_id, kind, content, day, tags, pinned, created_at, updated_at, dirty)
           values (?, ?, 'diario', ?, ?, '[]', 0, ?, ?, 1)`,
          [id, user, texto, dia, t, t],
        );
      }
      mudouLocal();
    },
  };

  // ---------- lembretes (sempre no banco local; quem avisa na hora é o app) ----------
  type LinhaLembrete = Omit<Reminder, 'alarm' | 'recurrence'> & { alarm: number; recurrence: string | null };
  const lerLembrete = (l: LinhaLembrete): Reminder => {
    let recurrence: Recorrencia | null = null;
    try {
      recurrence = l.recurrence ? normalizarRecorrencia(JSON.parse(l.recurrence)) : null;
    } catch {
      /* repetição ilegível: lembrete único */
    }
    return { ...l, alarm: !!l.alarm, recurrence };
  };
  const umLembrete = async (id: string) =>
    (await db.consultar<LinhaLembrete>(`select * from reminders where id = ?`, [id])).map(lerLembrete)[0];
  /** Instante de um lembrete: com repetição, a primeira ocorrência a partir da data (ou de agora). */
  const instante = (data: string | null, hora: string, rec: Recorrencia | null) => {
    if (rec) {
      const d = (data && proximaData(rec, data, true)) || primeiraData(rec, hora);
      return d ? instanteSP(d, hora) : null;
    }
    return instanteSP(data ?? hojeSP(), hora);
  };
  const lembretes = {
    /** Ativos primeiro (pela hora), depois os concluídos recentes. */
    async listar(): Promise<Reminder[]> {
      const linhas = await db.consultar<LinhaLembrete>(
        `select * from reminders where deleted_at is null order by done_at is not null, remind_at`,
      );
      return linhas.map(lerLembrete);
    },
    /** `data` AAAA-MM-DD e `hora` HH:MM em São Paulo. */
    async criar(titulo: string, data: string | null, hora: string,
      extra: { repetir?: Recorrencia | null; notas?: string | null; alarme?: boolean; prioridade?: Prioridade } = {}) {
      const rec = extra.repetir ? normalizarRecorrencia(extra.repetir) : null;
      const quando = instante(data, hora, rec);
      if (!quando) throw new Error('Essa repetição não tem próxima data.');
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      await db.executar(
        `insert into reminders (id, user_id, title, notes, remind_at, priority, alarm, recurrence, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [novoId(), user, titulo.trim(), extra.notas?.trim() || null, quando, extra.prioridade ?? 'media',
          extra.alarme ? 1 : 0, rec ? JSON.stringify(rec) : null, t, t],
      );
      mudouLocal();
    },
    async editar(id: string, m: { titulo: string; data: string | null; hora: string; repetir: Recorrencia | null;
      notas: string | null; alarme: boolean; prioridade?: Prioridade }) {
      const atual = await umLembrete(id);
      if (!atual) return;
      const rec = m.repetir ? normalizarRecorrencia(m.repetir) : null;
      const quando = instante(m.data, m.hora, rec);
      if (!quando) throw new Error('Essa repetição não tem próxima data.');
      await db.executar(
        `update reminders set title = ?, notes = ?, remind_at = ?, priority = ?, alarm = ?, recurrence = ?,
         done_at = null, updated_at = ?, dirty = 1 where id = ?`,
        [m.titulo.trim() || atual.title, m.notas?.trim() || null, quando, m.prioridade ?? atual.priority,
          m.alarme ? 1 : 0, rec ? JSON.stringify(rec) : null, agora(), id],
      );
      mudouLocal();
    },
    /** Concluir: o fixo passa para a próxima ocorrência (mesma hora); o único fica concluído. */
    async concluir(id: string) {
      const l = await umLembrete(id);
      if (!l) return;
      const t = agora();
      if (l.recurrence) {
        const { data, hora } = partesSP(l.remind_at);
        const hoje = hojeSP();
        const prox = proximaData(l.recurrence, data > hoje ? data : hoje, false);
        if (prox) {
          await db.executar(`update reminders set remind_at = ?, updated_at = ?, dirty = 1 where id = ?`,
            [instanteSP(prox, hora), t, id]);
          mudouLocal();
          return;
        }
      }
      await db.executar(`update reminders set done_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
    /**
     * Soneca: avisa de novo daqui a `minutos`. Devolve false para lembrete fixo: nele a hora da série
     * não muda (a soneca fica só no app que avisou).
     */
    async adiar(id: string, minutos = 10): Promise<boolean> {
      if ((await umLembrete(id))?.recurrence) return false;
      const quando = new Date(Date.now() + minutos * 60_000).toISOString();
      await db.executar(`update reminders set remind_at = ?, done_at = null, updated_at = ?, dirty = 1 where id = ?`,
        [quando, agora(), id]);
      mudouLocal();
      return true;
    },
    async reabrir(id: string) {
      await db.executar(`update reminders set done_at = null, updated_at = ?, dirty = 1 where id = ?`, [agora(), id]);
      mudouLocal();
    },
    /** Exclusão suave. */
    async apagar(id: string) {
      const t = agora();
      await db.executar(`update reminders set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
  };

  function mudouLocal() {
    avisar();
    agendarSync(300);
  }

  // ---------- sync ----------
  function agendarSync(atraso = 0) {
    if (agendado) clearTimeout(agendado);
    agendado = setTimeout(() => {
      agendado = null;
      void sincronizar();
    }, atraso);
  }

  /** Roda um sync por vez, em fila. */
  function sincronizar(): Promise<void> {
    fila = fila.then(rodarSync, rodarSync);
    return fila;
  }

  async function rodarSync() {
    const s = await auth.sessao();
    if (!s) return;
    mudarEstado('sincronizando');
    try {
      await empurrar(s.user.id);
      await puxar();
      mudarEstado('parado');
      void retomarPendente();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mudarEstado(/fetch|network|rede/i.test(msg) ? 'offline' : 'erro', msg);
    }
  }

  async function empurrar(userId: string) {
    for (const t of TABELAS_SYNC) await empurrarTabela(t, userId);
  }

  async function empurrarTabela(t: TabelaSync, userId: string) {
    const sujas = await db.consultar<Record<string, Valor>>(`select * from ${t.nome} where dirty = 1 limit ${LOTE}`);
    if (!sujas.length) return;
    const envio = sujas.map((r) => {
      const linha: Record<string, unknown> = {};
      for (const c of t.colunas) linha[c] = r[c];
      linha.user_id = userId;
      for (const c of t.booleanas) linha[c] = !!r[c];
      for (const c of t.json ?? []) {
        if (typeof linha[c] === 'string') {
          try {
            linha[c] = JSON.parse(linha[c] as string);
          } catch {
            linha[c] = null;
          }
        }
      }
      for (const c of t.somenteServidor ?? []) delete linha[c];
      delete linha.updated_at; // quem carimba é o trigger do servidor
      return linha;
    });
    const { data, error } = await sb.from(t.nome).upsert(envio, { onConflict: 'id' }).select();
    if (error) throw error;
    // Grava a versão do servidor e limpa a marca, só se a linha não mudou de novo enquanto subia.
    const enviadoEm = new Map(sujas.map((r) => [r.id as string, r.updated_at as string]));
    for (const srv of (data ?? []) as Record<string, unknown>[]) {
      await gravarDoServidor(t, srv, enviadoEm.get(srv.id as string));
    }
  }

  async function puxar() {
    for (const t of TABELAS_SYNC) await puxarTabela(t);
    avisar();
  }

  async function puxarTabela(t: TabelaSync) {
    const [estadoRow] = await db.consultar<{ cursor: string | null }>(
      `select cursor from sync_state where tabela = ?`,
      [t.nome],
    );
    let cursor = estadoRow?.cursor ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await sb
        .from(t.nome)
        .select('*')
        .gte('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(LOTE);
      if (error) throw error;
      const linhas = (data ?? []) as Record<string, unknown>[];
      for (const srv of linhas) await gravarDoServidor(t, srv);
      const ultimo = linhas.at(-1)?.updated_at as string | undefined;
      // Sem avanço (lote vazio ou tudo no mesmo instante): para, evita laço infinito.
      if (!ultimo || ultimo === cursor) break;
      cursor = ultimo;
      await db.executar(
        `insert into sync_state (tabela, cursor) values (?, ?)
         on conflict (tabela) do update set cursor = excluded.cursor`,
        [t.nome, cursor],
      );
      if (linhas.length < LOTE) break;
    }
  }

  /**
   * Grava uma linha vinda do servidor.
   * - Sem `enviadoEm`: só sobrescreve se a local não tiver mudança pendente.
   * - Com `enviadoEm`: confirmação de envio; limpa `dirty` se a local ainda é a que subiu.
   */
  async function gravarDoServidor(t: TabelaSync, srv: Record<string, unknown>, enviadoEm?: string) {
    const valores: Valor[] = t.colunas.map((c) => {
      const v = srv[c];
      if (t.booleanas.includes(c)) return v ? 1 : 0;
      if (t.json?.includes(c)) return v == null ? null : JSON.stringify(v);
      return (v ?? null) as Valor;
    });
    const sets = t.colunas.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    const condicao = enviadoEm === undefined ? `${t.nome}.dirty = 0` : `${t.nome}.updated_at = ?`;
    await db.executar(
      `insert into ${t.nome} (${t.colunas.join(', ')}, dirty)
       values (${t.colunas.map(() => '?').join(', ')}, 0)
       on conflict (id) do update set ${sets}, dirty = 0 where ${condicao}`,
      enviadoEm === undefined ? valores : [...valores, enviadoEm],
    );
  }

  // ---------- conversa (chat) ----------
  const TABELA_MSG = TABELAS_SYNC.find((t) => t.nome === 'messages')!;
  /** undefined = ainda não decidiu; null = conversa nova, criada no primeiro envio. */
  let conversaAtual: string | null | undefined;
  let pensando = false;
  let erroChat: string | null = null;

  async function idConversaAtual(): Promise<string | null> {
    if (conversaAtual === undefined) {
      const [c] = await db.consultar<{ id: string }>(
        `select id from conversations where deleted_at is null order by updated_at desc limit 1`,
      );
      conversaAtual = c?.id ?? null;
    }
    return conversaAtual;
  }

  async function mensagemDeErro(error: unknown): Promise<string> {
    const ctx = (error as { context?: unknown })?.context;
    if (ctx instanceof Response) {
      try {
        const j = await ctx.clone().json();
        if (j?.erro) return String(j.erro);
      } catch {
        /* resposta sem JSON */
      }
    }
    const msg = error instanceof Error ? error.message : String(error);
    return /fetch|network|rede|Failed to send/i.test(msg) ? 'Sem conexão. A mensagem ficou guardada; tente de novo.' : msg;
  }

  // ---------- pergunta sem resposta (queda, erro, app fechado no meio) ----------
  // Se a última mensagem da conversa é do dono, ela está em aberto: o J.A.R.V.I.S. responde
  // essa antes de qualquer outra coisa. Outro aparelho pode estar respondendo agora mesmo,
  // então só retoma uma pergunta recente se a falha foi aqui; as antigas, sempre.
  // A função é idempotente: se já houver resposta, devolve a mesma (nunca responde duas vezes).
  const TEMPO_OUTRO_APARELHO = 40_000;
  const ESPERAS_RETENTATIVA = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
  const falhasAqui = new Map<string, number>(); // id da pergunta -> nº de falhas nesta sessão
  let relogioPendente: ReturnType<typeof setTimeout> | null = null;

  async function perguntaEmAberto(): Promise<Message | null> {
    const id = await idConversaAtual();
    if (!id) return null;
    const [ultima] = await db.consultar<Omit<Message, 'sensitive'> & { sensitive: number }>(
      `select * from messages where conversation_id = ? and deleted_at is null
       order by created_at desc, rowid desc limit 1`,
      [id],
    );
    return ultima?.role === 'user' ? { ...ultima, sensitive: !!ultima.sensitive } : null;
  }

  function agendarRetomada(atraso: number) {
    if (relogioPendente) clearTimeout(relogioPendente);
    relogioPendente = setTimeout(() => {
      relogioPendente = null;
      void retomarPendente();
    }, atraso);
  }

  /** Pede a resposta de uma pergunta já gravada. true = respondida. */
  /** Perguntas feitas por voz: a resposta delas é lida em voz alta. */
  const porVoz = new Set<string>();
  const ouvintesResposta = new Set<(m: Message, voz: boolean, fala: string | null) => void>();

  async function pedirResposta(m: Pick<Message, 'id' | 'conversation_id' | 'content'>): Promise<boolean> {
    pensando = true;
    erroChat = null;
    avisar();
    try {
      const { data, error } = await sb.functions.invoke('ia_conversar', {
        body: {
          conversation_id: m.conversation_id, message_id: m.id, text: m.content,
          voz: porVoz.has(m.id),
          app: versaoApp ? await Promise.resolve(versaoApp()).catch(() => '') : '',
        },
      });
      if (error) throw error;
      if (data?.mensagem) {
        await gravarDoServidor(TABELA_MSG, data.mensagem as Record<string, unknown>);
        const resposta = { ...(data.mensagem as Message), sources: (data.mensagem as Message).sources ?? null };
        const voz = porVoz.delete(m.id);
        // Pergunta por voz: o servidor manda também um resumo curto para falar.
        const fala = typeof data.fala === 'string' && data.fala.trim() ? data.fala.trim() : null;
        ouvintesResposta.forEach((f) => f(resposta, voz, fala));
      }
      falhasAqui.delete(m.id);
      return true;
    } catch (e) {
      const n = (falhasAqui.get(m.id) ?? 0) + 1;
      falhasAqui.set(m.id, n);
      const espera = ESPERAS_RETENTATIVA[Math.min(n - 1, ESPERAS_RETENTATIVA.length - 1)]!;
      erroChat = `${await mensagemDeErro(e)} Tento de novo em ${Math.round(espera / 1000)} s.`;
      agendarRetomada(espera);
      return false;
    } finally {
      pensando = false;
      avisar();
      agendarSync(300);
    }
  }

  /** Responde a pergunta em aberto da conversa atual, se houver. */
  async function retomarPendente(): Promise<boolean> {
    if (pensando || !(await auth.sessao())) return !pensando;
    const p = await perguntaEmAberto();
    if (!p) return true;
    const idade = Date.now() - Date.parse(p.created_at);
    if (!falhasAqui.has(p.id) && idade < TEMPO_OUTRO_APARELHO) {
      // Pode ser outro aparelho respondendo agora: espera um pouco e confere de novo.
      agendarRetomada(TEMPO_OUTRO_APARELHO - idade + 500);
      return false;
    }
    return pedirResposta(p);
  }

  const chat = {
    /** Mensagens da conversa atual, da mais antiga para a mais nova (banco local). */
    async mensagens(): Promise<Message[]> {
      const id = await idConversaAtual();
      if (!id) return [];
      const linhas = await db.consultar<Omit<Message, 'sensitive' | 'sources'> & { sensitive: number; sources: string | null }>(
        `select * from messages where conversation_id = ? and deleted_at is null order by created_at, rowid`,
        [id],
      );
      return linhas.map((m) => ({ ...m, sensitive: !!m.sensitive, sources: lerFontes(m.sources) }));
    },
    estado: () => ({ pensando, erro: erroChat }),
    novaConversa() {
      conversaAtual = null;
      erroChat = null;
      if (relogioPendente) clearTimeout(relogioPendente);
      relogioPendente = null;
      avisar();
    },
    /**
     * Envia uma pergunta. Se houver outra em aberto, responde aquela primeiro.
     * Devolve false se não deu para enviar agora (o texto deve voltar para o campo).
     */
    /** Avisa quando chega a resposta da IA (voz = a pergunta foi feita falando). */
    aoResponder(f: (m: Message, voz: boolean, fala: string | null) => void) {
      ouvintesResposta.add(f);
      return () => { ouvintesResposta.delete(f); };
    },
    /** Transcreve um áudio gravado (Groq Whisper, no servidor). */
    async transcrever(audio: Blob, nome = 'fala.webm'): Promise<string> {
      const form = new FormData();
      form.append('audio', audio, nome);
      // As últimas mensagens ajudam a acertar nomes ("Medieval Dynasty", não "medieval de Nastia").
      // Mensagens sensíveis ficam de fora.
      const id = await idConversaAtual();
      if (id) {
        const ultimas = await db.consultar<{ role: string; content: string }>(
          `select role, content from messages where conversation_id = ? and deleted_at is null and coalesce(sensitive, 0) = 0
           order by created_at desc, rowid desc limit 4`,
          [id],
        );
        const contexto = ultimas.reverse()
          .map((m) => `${m.role === 'user' ? 'Dono' : 'JARVIS'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`)
          .join('\n');
        if (contexto) form.append('contexto', contexto);
      }
      const { data, error } = await sb.functions.invoke('ia_transcrever', { body: form });
      if (error) throw new Error(await mensagemDeErro(error));
      return String(data?.texto ?? '').trim();
    },
    async enviar(texto: string, opcoes: { voz?: boolean } = {}): Promise<boolean> {
      const limpo = texto.trim();
      if (!limpo || pensando) return false;
      const s = await auth.sessao();
      if (!s) throw new Error('Faça login.');
      const aberta = await perguntaEmAberto();
      if (aberta && !(await pedirResposta(aberta))) return false;
      const t = agora();
      let conversa = await idConversaAtual();
      if (!conversa) {
        conversa = novoId();
        await db.executar(
          `insert into conversations (id, user_id, title, created_at, updated_at, dirty) values (?, ?, ?, ?, ?, 1)`,
          [conversa, s.user.id, limpo.slice(0, 60), t, t],
        );
        conversaAtual = conversa;
      }
      const idMsg = novoId();
      await db.executar(
        `insert into messages (id, user_id, conversation_id, role, content, created_at, updated_at, dirty)
         values (?, ?, ?, 'user', ?, ?, ?, 1)`,
        [idMsg, s.user.id, conversa, limpo, t, t],
      );
      if (opcoes.voz) porVoz.add(idMsg);
      await pedirResposta({ id: idMsg, conversation_id: conversa, content: limpo });
      return true;
    },
  };

  // ---------- memória (o que a IA aprendeu sobre o dono) ----------
  const memorias = {
    /** Tudo o que ele sabe, das mais importantes para as menos (banco local). */
    async listar(): Promise<Memory[]> {
      const linhas = await db.consultar<Omit<Memory, 'sensitive'> & { sensitive: number }>(
        `select * from memories where deleted_at is null order by importance desc, updated_at desc`,
      );
      return linhas.map((m) => ({ ...m, sensitive: !!m.sensitive }));
    },
    /** Esquecer = exclusão suave (some do app e da IA; nada é apagado de verdade). */
    async esquecer(id: string) {
      const t = agora();
      await db.executar(`update memories set deleted_at = ?, updated_at = ?, dirty = 1 where id = ?`, [t, t, id]);
      mudouLocal();
    },
  };

  // ---------- atividades recentes (a partir da tabela events) ----------
  const MAX_ATIVIDADES = 15;
  let eventosRecentes: JarvisEvent[] = [];
  let historicoCarregado = false;

  async function carregarHistorico() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .in('entity_type', ENTIDADES_ATIVIDADE)
      .order('created_at', { ascending: false })
      .limit(MAX_ATIVIDADES);
    if (error) return; // offline: a lista começa só com o que chegar ao vivo
    const vistos = new Set(eventosRecentes.map((e) => e.id));
    eventosRecentes = [...eventosRecentes, ...((data ?? []) as JarvisEvent[]).filter((e) => !vistos.has(e.id))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, MAX_ATIVIDADES);
    historicoCarregado = true;
    avisar();
  }

  const atividades = {
    /** As últimas coisas que aconteceram, já em texto, com o nome do item (vem do banco local). */
    async listar(): Promise<Atividade[]> {
      const titulos = new Map<string, string>();
      for (const [tabela, coluna] of [
        ['tasks', 'title'], ['memories', 'coalesce(title, content)'], ['reminders', 'title'],
        ['projects', 'name'], ['project_milestones', 'title'], ['habits', 'name'], ['notes', "coalesce(title, case when kind = 'diario' then 'Diário ' || day else substr(content, 1, 60) end)"],
        ['habit_logs', '(select h.name from habits h where h.id = habit_logs.habit_id)'],
      ] as const) {
        const ids = eventosRecentes.filter((e) => e.entity_type === tabela && e.entity_id).map((e) => e.entity_id!);
        if (!ids.length) continue;
        const linhas = await db.consultar<{ id: string; titulo: string }>(
          `select id, ${coluna} as titulo from ${tabela} where id in (${ids.map(() => '?').join(', ')})`,
          ids,
        );
        for (const l of linhas) titulos.set(l.id, l.titulo);
      }
      return eventosRecentes.map((e) => ({
        id: e.id,
        texto: `${NOME_ENTIDADE[e.entity_type ?? ''] ?? 'Item'} ${NOME_ACAO[e.kind] ? NOME_ACAO[e.kind] + (FEMININAS.has(e.entity_type ?? '') ? 'a' : 'o') : e.kind}`,
        detalhe: (e.entity_id && titulos.get(e.entity_id)) || null,
        quando: e.created_at,
      }));
    },
    carregado: () => historicoCarregado,
  };

  function ligarSync() {
    if (!canal) {
      canal = ouvirEventos(sb, (e) => {
        // Outro aparelho pediu algo à IA: o cérebro mostra "pensando" aqui também, até a resposta chegar.
        if (e.kind === 'thinking') {
          pensandoRemotoAte = Date.now() + 60_000;
          if (relogioRemoto) clearTimeout(relogioRemoto);
          relogioRemoto = setTimeout(avisar, 60_500);
        } else if (e.kind === 'searching') {
          // A IA está pesquisando na internet (em qualquer aparelho).
          pesquisandoAte = Date.now() + 60_000;
        } else if (e.kind === 'created' && e.entity_type === 'messages') {
          pensandoRemotoAte = 0;
          pesquisandoAte = 0;
        }
        const entraNaLista = !!e.entity_type && ENTIDADES_ATIVIDADE.includes(e.entity_type);
        if (entraNaLista && !eventosRecentes.some((x) => x.id === e.id)) {
          eventosRecentes = [e, ...eventosRecentes].slice(0, MAX_ATIVIDADES);
        }
        ouvintesEvento.forEach((f) => f(e));
        avisar();
        if (e.entity_type && TABELAS_SYNC.some((t) => t.nome === e.entity_type)) agendarSync(150);
      });
      void carregarHistorico();
    }
    relogio ??= setInterval(() => void sincronizar(), 60_000);
    agendarSync(0);
  }

  // ---------- estado da IA (o que o cérebro mostra) ----------
  let pensandoRemotoAte = 0;
  let pesquisandoAte = 0;
  let relogioRemoto: ReturnType<typeof setTimeout> | null = null;
  const ia = {
    /** 'pensando' enquanto este aparelho ou outro espera uma resposta da IA. */
    estado(): EstadoIA {
      const pensandoAgora = pensando || pensandoRemotoAte > Date.now();
      if (pensandoAgora && pesquisandoAte > Date.now()) return 'pesquisando';
      return pensandoAgora ? 'pensando' : 'repouso';
    },
  };

  function desligarSync() {
    if (canal) void sb.removeChannel(canal);
    canal = null;
    eventosRecentes = [];
    historicoCarregado = false;
    if (relogio) clearInterval(relogio);
    relogio = null;
  }

  /** Avisos (Fase 3). O vigia roda no servidor; o aparelho só diz que está aberto. */
  const avisos = {
    /**
     * Sinal de "aberto" (a cada minuto): com ele, o vigia entrega no aparelho em vez do celular.
     * Também garante as preferências padrão das contas novas. Falha calada: sem internet, tudo bem.
     */
    async presenca(aparelho: string, plataforma: 'pc' | 'android', nome?: string, tokenPush?: string | null) {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      await sb.from('devices').upsert(
        {
          id: aparelho, user_id: uid, platform: plataforma, name: nome ?? null, seen_at: new Date().toISOString(),
          // undefined = não mexe no token já gravado
          ...(tokenPush !== undefined ? { push_token: tokenPush } : {}),
        },
        { onConflict: 'id' },
      );
      await sb.from('notice_settings').upsert({ user_id: uid }, { onConflict: 'user_id', ignoreDuplicates: true });
    },

    // ----- aba Avisos: lê e escreve direto no Supabase (avisos não ficam no banco local) -----

    /** Últimos avisos (os de dentro de um grupo vêm junto, com group_id). Sem internet: lança erro. */
    async listar(limite = 60): Promise<Notice[]> {
      const { data, error } = await sb.from('notices')
        .select('id, kind, entity_type, entity_id, title, body, reason, priority, status, channels, scheduled_for, sent_at, read_at, group_id, created_at')
        .is('deleted_at', null).order('created_at', { ascending: false }).limit(limite);
      if (error) throw new Error(error.message);
      return (data ?? []) as Notice[];
    },
    /** Quantos avisos enviados ainda não foram vistos (para o selo da aba). */
    async naoLidos(): Promise<number> {
      const { count } = await sb.from('notices').select('id', { count: 'exact', head: true })
        .is('deleted_at', null).is('read_at', null).is('group_id', null).eq('status', 'enviado');
      return count ?? 0;
    },
    /** Marca como vistos (todos os enviados, se `ids` não vier). */
    async marcarLidos(ids?: string[]) {
      let q = sb.from('notices').update({ read_at: new Date().toISOString() }).is('read_at', null).is('deleted_at', null);
      q = ids?.length ? q.in('id', ids) : q.eq('status', 'enviado');
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    async preferencias(): Promise<NoticeSettings> {
      const { data, error } = await sb.from('notice_settings')
        .select('id, enabled, quiet_start, quiet_end, morning_at, evening_at').is('deleted_at', null).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return data as NoticeSettings;
      const r = await sb.from('notice_settings').insert({}).select('id, enabled, quiet_start, quiet_end, morning_at, evening_at').single();
      if (r.error) throw new Error(r.error.message);
      return r.data as NoticeSettings;
    },
    /** Muda as preferências. Horas em "HH:MM". */
    async salvarPreferencias(m: Partial<Omit<NoticeSettings, 'id'>>): Promise<NoticeSettings> {
      const atual = await avisos.preferencias();
      const { data, error } = await sb.from('notice_settings').update(m).eq('id', atual.id)
        .select('id, enabled, quiet_start, quiet_end, morning_at, evening_at').single();
      if (error) throw new Error(error.message);
      return data as NoticeSettings;
    },
    /** Regras que mudam algo (desligado, silenciado ainda valendo ou hora fixa). `nome` = item, quando é de um item só. */
    async regras(): Promise<(NoticeRule & { nome: string | null })[]> {
      const { data, error } = await sb.from('notice_rules')
        .select('id, kind, entity_id, active, fixed_time, muted_until, note').is('deleted_at', null);
      if (error) throw new Error(error.message);
      const agora = Date.now();
      const valendo = ((data ?? []) as NoticeRule[])
        .filter((r) => !r.active || (r.muted_until && Date.parse(r.muted_until) > agora) || r.fixed_time);
      // nome do item: procura no banco local (tarefas, lembretes, hábitos, projetos)
      const nomes = new Map<string, string>();
      for (const t of await tarefas.listar()) nomes.set(t.id, t.title);
      for (const l of await lembretes.listar()) nomes.set(l.id, l.title);
      for (const h of await habitos.listar()) nomes.set(h.id, h.name);
      for (const p of await projetos.listar()) nomes.set(p.id, p.name);
      return valendo.map((r) => ({ ...r, nome: r.entity_id ? nomes.get(r.entity_id) ?? 'item apagado' : null }));
    },
    /** Desfaz a regra: volta a avisar como padrão (exclusão suave). */
    async removerRegra(id: string) {
      const { error } = await sb.from('notice_rules').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
  };

  return {
    iniciar,
    auth,
    avisos,
    tarefas,
    projetos,
    habitos,
    conhecimento,
    lembretes,
    atividades,
    chat,
    ia,
    memorias,
    sincronizar,
    estado: () => ({ estado, ultimoErro }),
    /** Avisa quando algo local mudou (para a tela recarregar). */
    aoMudar(f: Ouvinte) {
      ouvintes.add(f);
      return () => { ouvintes.delete(f); };
    },
    /** Cada evento real do núcleo (o cérebro vai pulsar com isso). */
    aoEvento(f: (e: JarvisEvent) => void) {
      ouvintesEvento.add(f);
      return () => { ouvintesEvento.delete(f); };
    },
  };
}

export type Jarvis = ReturnType<typeof criarJarvis>;

/** Projeto com o progresso, como a lista mostra. */
export type ProjetoResumo = Project & { total: number; feitas: number; marcos: number; marcosFeitos: number };

/** Hábito com o que a tela mostra: hoje, sequência, semana, mês e os últimos 14 dias. */
export type HabitoResumo = Habit & {
  hojeValor: number | null;
  feitoHoje: boolean;
  previstoHoje: boolean;
  sequencia: { n: number; unidade: 'dias' | 'semanas' };
  semana: { feitas: number; meta: number };
  mes: number;
  ultimos: { dia: string; valor: number | null; feito: boolean; previsto: boolean }[];
};
