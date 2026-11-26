// Banco local (SQLite) — cada app fornece um adaptador com esta forma.
// Mobile: expo-sqlite. Desktop: tauri-plugin-sql.

export type Valor = string | number | null;

export interface BancoLocal {
  executar(sql: string, params?: Valor[]): Promise<void>;
  consultar<T = Record<string, unknown>>(sql: string, params?: Valor[]): Promise<T[]>;
}

/** Colunas de `tasks` iguais às do Supabase (sem o controle local `dirty`). */
export const COLUNAS_PROJECTS = [
  'id', 'user_id', 'name', 'description', 'priority', 'status', 'due_date', 'archived',
  'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_MILESTONES = [
  'id', 'user_id', 'project_id', 'title', 'due_date', 'done_at', 'position', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_TASKS = [
  'id', 'user_id', 'project_id', 'milestone_id', 'board_column', 'title', 'notes', 'priority', 'due_date', 'due_time',
  'done_at', 'archived', 'position', 'recurrence', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_REMINDERS = [
  'id', 'user_id', 'title', 'notes', 'remind_at', 'channel', 'priority', 'alarm', 'recurrence',
  'done_at', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_HABITS = [
  'id', 'user_id', 'name', 'kind', 'unit', 'daily_target', 'weekdays', 'times_per_week', 'monthly_target', 'time_of_day',
  'color', 'position', 'paused', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_HABIT_LOGS = [
  'id', 'user_id', 'habit_id', 'day', 'value', 'note', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_NOTES = [
  'id', 'user_id', 'kind', 'title', 'content', 'notebook', 'tags', 'pinned', 'day', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_CONVERSATIONS = ['id', 'user_id', 'title', 'created_at', 'updated_at', 'deleted_at'] as const;

export const COLUNAS_MESSAGES = [
  'id', 'user_id', 'conversation_id', 'role', 'content', 'provider', 'model', 'latency_ms',
  'sensitive', 'sources', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_MEMORIES = [
  'id', 'user_id', 'kind', 'title', 'content', 'importance', 'sensitive', 'created_at', 'updated_at', 'deleted_at',
] as const;

/** Tabelas que sincronizam com o Supabase, na ordem de envio (pais antes dos filhos). */
export interface TabelaSync {
  nome: string;
  colunas: readonly string[];
  /** Colunas boolean no Supabase e 0/1 no SQLite. */
  booleanas: readonly string[];
  /** Colunas que só o servidor escreve (o app nunca sobe, para não apagar o que a IA marcou). */
  somenteServidor?: readonly string[];
  /** Colunas jsonb no Supabase, guardadas como texto JSON no SQLite. */
  json?: readonly string[];
}
export const TABELAS_SYNC: readonly TabelaSync[] = [
  { nome: 'projects', colunas: COLUNAS_PROJECTS, booleanas: ['archived'] },
  { nome: 'project_milestones', colunas: COLUNAS_MILESTONES, booleanas: [] },
  { nome: 'tasks', colunas: COLUNAS_TASKS, booleanas: ['archived'], json: ['recurrence'] },
  { nome: 'reminders', colunas: COLUNAS_REMINDERS, booleanas: ['alarm'], json: ['recurrence'] },
  { nome: 'habits', colunas: COLUNAS_HABITS, booleanas: ['paused'], json: ['weekdays'] },
  { nome: 'habit_logs', colunas: COLUNAS_HABIT_LOGS, booleanas: [] },
  { nome: 'notes', colunas: COLUNAS_NOTES, booleanas: ['pinned'], json: ['tags'] },
  { nome: 'conversations', colunas: COLUNAS_CONVERSATIONS, booleanas: [] },
  {
    nome: 'messages', colunas: COLUNAS_MESSAGES, booleanas: ['sensitive'],
    somenteServidor: ['sensitive', 'provider', 'model', 'latency_ms', 'sources'],
    json: ['sources'],
  },
  // Quem cria e muda memórias é a IA (no servidor); o app só lê e "esquece" (deleted_at).
  { nome: 'memories', colunas: COLUNAS_MEMORIES, booleanas: ['sensitive'], somenteServidor: ['sensitive'] },
];

export const SCHEMA_LOCAL = [
  `create table if not exists projects (
    id text primary key,
    user_id text,
    name text not null,
    description text,
    priority text not null default 'media',
    status text not null default 'planejamento',
    due_date text,
    archived integer not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists projects_dirty_idx on projects (dirty)`,
  `create table if not exists project_milestones (
    id text primary key,
    user_id text,
    project_id text not null,
    title text not null,
    due_date text,
    done_at text,
    position real not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists project_milestones_dirty_idx on project_milestones (dirty)`,
  `create table if not exists tasks (
    id text primary key,
    user_id text,
    project_id text,
    milestone_id text,
    board_column text not null default 'a_fazer',
    title text not null,
    notes text,
    priority text not null default 'media',
    due_date text,
    due_time text,
    recurrence text,
    done_at text,
    archived integer not null default 0,
    position real not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists tasks_dirty_idx on tasks (dirty)`,
  `create table if not exists reminders (
    id text primary key,
    user_id text,
    title text not null,
    notes text,
    remind_at text not null,
    channel text not null default 'app',
    priority text not null default 'media',
    alarm integer not null default 0,
    recurrence text,
    done_at text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists reminders_dirty_idx on reminders (dirty)`,
  `create table if not exists habits (
    id text primary key,
    user_id text,
    name text not null,
    kind text not null default 'boolean',
    unit text,
    daily_target real,
    weekdays text,
    times_per_week integer,
    monthly_target integer,
    time_of_day text,
    color text not null default 'verde_agua',
    position real not null default 0,
    paused integer not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists habits_dirty_idx on habits (dirty)`,
  `create table if not exists habit_logs (
    id text primary key,
    user_id text,
    habit_id text not null,
    day text not null,
    value real,
    note text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists habit_logs_dirty_idx on habit_logs (dirty)`,
  `create index if not exists habit_logs_habito_idx on habit_logs (habit_id, day)`,
  `create table if not exists notes (
    id text primary key,
    user_id text,
    kind text not null default 'nota',
    title text,
    content text not null default '',
    notebook text,
    tags text not null default '[]',
    pinned integer not null default 0,
    day text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists notes_dirty_idx on notes (dirty)`,
  `create index if not exists notes_tipo_idx on notes (kind, updated_at)`,
  `create table if not exists conversations (
    id text primary key,
    user_id text,
    title text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists conversations_dirty_idx on conversations (dirty)`,
  `create table if not exists messages (
    id text primary key,
    user_id text,
    conversation_id text not null,
    role text not null,
    content text not null,
    provider text,
    model text,
    latency_ms integer,
    sensitive integer not null default 0,
    sources text,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists messages_dirty_idx on messages (dirty)`,
  `create index if not exists messages_conversa_idx on messages (conversation_id, created_at)`,
  `create table if not exists memories (
    id text primary key,
    user_id text,
    kind text not null default 'nota',
    title text,
    content text not null,
    importance integer not null default 5,
    sensitive integer not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists memories_dirty_idx on memories (dirty)`,
  `create table if not exists sync_state (tabela text primary key, cursor text)`,
];

/** Colunas acrescentadas depois que o banco local já existia nos aparelhos. */
const COLUNAS_NOVAS: [tabela: string, coluna: string, tipo: string][] = [
  ['messages', 'sources', 'text'],
  ['tasks', 'recurrence', 'text'],
  ['tasks', 'milestone_id', 'text'],
  ['tasks', 'board_column', "text not null default 'a_fazer'"],
];

export async function prepararBanco(db: BancoLocal) {
  for (const sql of SCHEMA_LOCAL) await db.executar(sql);
  for (const [tabela, coluna, tipo] of COLUNAS_NOVAS) {
    const cols = await db.consultar<{ name: string }>(`pragma table_info(${tabela})`);
    if (!cols.some((c) => c.name === coluna)) await db.executar(`alter table ${tabela} add column ${coluna} ${tipo}`);
  }
}

/** uuid v4 sem depender de crypto.randomUUID (nem todo motor JS tem). */
export function novoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
