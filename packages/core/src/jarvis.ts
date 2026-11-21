// Núcleo local-first: o app lê e escreve no SQLite e responde na hora;
// o sync empurra o que mudou aqui e puxa o que mudou no Supabase.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { criarCliente, ouvirEventos, type ArmazenamentoSessao } from './supabase';
import { COLUNAS_TASKS, novoId, prepararBanco, type BancoLocal, type Valor } from './local';
import type { JarvisEvent, Prioridade, Task } from './types';

export interface OpcoesJarvis {
  db: BancoLocal;
  sessao?: ArmazenamentoSessao;
}

export type EstadoSync = 'parado' | 'sincronizando' | 'offline' | 'erro';

type Ouvinte = () => void;

const agora = () => new Date().toISOString();
const LOTE = 500;

export function criarJarvis({ db, sessao }: OpcoesJarvis) {
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

  // ---------- login (e-mail e senha; a conta do dono é criada no painel e cadastros ficam desligados) ----------
  const auth = {
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
  const tarefas = {
    async listar(): Promise<Task[]> {
      const linhas = await db.consultar<Omit<Task, 'archived'> & { archived: number }>(
        `select * from tasks where deleted_at is null and archived = 0
         order by done_at is not null, position, created_at desc`,
      );
      return linhas.map((t) => ({ ...t, archived: !!t.archived }));
    },
    async criar(titulo: string, prioridade: Prioridade = 'media') {
      const t = agora();
      const user = (await auth.sessao())?.user.id ?? null;
      await db.executar(
        `insert into tasks (id, user_id, title, priority, created_at, updated_at, dirty)
         values (?, ?, ?, ?, ?, ?, 1)`,
        [novoId(), user, titulo.trim(), prioridade, t, t],
      );
      mudouLocal();
    },
    async alternarConcluida(id: string) {
      const t = agora();
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mudarEstado(/fetch|network|rede/i.test(msg) ? 'offline' : 'erro', msg);
    }
  }

  async function empurrar(userId: string) {
    const sujas = await db.consultar<Record<string, Valor>>(`select * from tasks where dirty = 1 limit ${LOTE}`);
    if (!sujas.length) return;
    const envio = sujas.map((r) => {
      const linha: Record<string, unknown> = {};
      for (const c of COLUNAS_TASKS) linha[c] = r[c];
      linha.user_id = userId;
      linha.archived = !!r.archived;
      delete linha.updated_at; // quem carimba é o trigger do servidor
      return linha;
    });
    const { data, error } = await sb.from('tasks').upsert(envio, { onConflict: 'id' }).select();
    if (error) throw error;
    // Grava a versão do servidor e limpa a marca, só se a linha não mudou de novo enquanto subia.
    const enviadoEm = new Map(sujas.map((r) => [r.id as string, r.updated_at as string]));
    for (const srv of (data ?? []) as Task[]) {
      await gravarDoServidor(srv, enviadoEm.get(srv.id));
    }
  }

  async function puxar() {
    const [estadoRow] = await db.consultar<{ cursor: string | null }>(
      `select cursor from sync_state where tabela = 'tasks'`,
    );
    let cursor = estadoRow?.cursor ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await sb
        .from('tasks')
        .select('*')
        .gte('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(LOTE);
      if (error) throw error;
      const linhas = (data ?? []) as Task[];
      for (const srv of linhas) await gravarDoServidor(srv);
      const ultimo = linhas.at(-1)?.updated_at;
      // Sem avanço (lote vazio ou tudo no mesmo instante): para, evita laço infinito.
      if (!ultimo || ultimo === cursor) break;
      cursor = ultimo;
      await db.executar(
        `insert into sync_state (tabela, cursor) values ('tasks', ?)
         on conflict (tabela) do update set cursor = excluded.cursor`,
        [cursor],
      );
      if (linhas.length < LOTE) break;
    }
    avisar();
  }

  /**
   * Grava uma linha vinda do servidor.
   * - Sem `enviadoEm`: só sobrescreve se a local não tiver mudança pendente.
   * - Com `enviadoEm`: confirmação de envio; limpa `dirty` se a local ainda é a que subiu.
   */
  async function gravarDoServidor(srv: Task, enviadoEm?: string) {
    const valores: Valor[] = COLUNAS_TASKS.map((c) => {
      const v = srv[c as keyof Task] as unknown;
      if (c === 'archived') return v ? 1 : 0;
      return (v ?? null) as Valor;
    });
    const sets = COLUNAS_TASKS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    const condicao = enviadoEm === undefined ? 'tasks.dirty = 0' : 'tasks.updated_at = ?';
    await db.executar(
      `insert into tasks (${COLUNAS_TASKS.join(', ')}, dirty)
       values (${COLUNAS_TASKS.map(() => '?').join(', ')}, 0)
       on conflict (id) do update set ${sets}, dirty = 0 where ${condicao}`,
      enviadoEm === undefined ? valores : [...valores, enviadoEm],
    );
  }

  function ligarSync() {
    if (!canal) {
      canal = ouvirEventos(sb, (e) => {
        ouvintesEvento.forEach((f) => f(e));
        if (e.entity_type === 'tasks') agendarSync(150);
      });
    }
    relogio ??= setInterval(() => void sincronizar(), 60_000);
    agendarSync(0);
  }

  function desligarSync() {
    if (canal) void sb.removeChannel(canal);
    canal = null;
    if (relogio) clearInterval(relogio);
    relogio = null;
  }

  return {
    iniciar,
    auth,
    tarefas,
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
