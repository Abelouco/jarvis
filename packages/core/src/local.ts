// Banco local (SQLite) — cada app fornece um adaptador com esta forma.
// Mobile: expo-sqlite. Desktop: tauri-plugin-sql.

export type Valor = string | number | null;

export interface BancoLocal {
  executar(sql: string, params?: Valor[]): Promise<void>;
  consultar<T = Record<string, unknown>>(sql: string, params?: Valor[]): Promise<T[]>;
}

/** Colunas de `tasks` iguais às do Supabase (sem o controle local `dirty`). */
export const COLUNAS_TASKS = [
  'id', 'user_id', 'project_id', 'title', 'notes', 'priority', 'due_date', 'due_time',
  'done_at', 'archived', 'position', 'created_at', 'updated_at', 'deleted_at',
] as const;

export const COLUNAS_CONVERSATIONS = ['id', 'user_id', 'title', 'created_at', 'updated_at', 'deleted_at'] as const;

export const COLUNAS_MESSAGES = [
  'id', 'user_id', 'conversation_id', 'role', 'content', 'provider', 'model', 'latency_ms',
  'sensitive', 'created_at', 'updated_at', 'deleted_at',
] as const;

/** Tabelas que sincronizam com o Supabase, na ordem de envio (pais antes dos filhos). */
export interface TabelaSync {
  nome: string;
  colunas: readonly string[];
  /** Colunas boolean no Supabase e 0/1 no SQLite. */
  booleanas: readonly string[];
}
export const TABELAS_SYNC: readonly TabelaSync[] = [
  { nome: 'tasks', colunas: COLUNAS_TASKS, booleanas: ['archived'] },
  { nome: 'conversations', colunas: COLUNAS_CONVERSATIONS, booleanas: [] },
  { nome: 'messages', colunas: COLUNAS_MESSAGES, booleanas: ['sensitive'] },
];

export const SCHEMA_LOCAL = [
  `create table if not exists tasks (
    id text primary key,
    user_id text,
    project_id text,
    title text not null,
    notes text,
    priority text not null default 'media',
    due_date text,
    due_time text,
    done_at text,
    archived integer not null default 0,
    position real not null default 0,
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists tasks_dirty_idx on tasks (dirty)`,
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
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    dirty integer not null default 0
  )`,
  `create index if not exists messages_dirty_idx on messages (dirty)`,
  `create index if not exists messages_conversa_idx on messages (conversation_id, created_at)`,
  `create table if not exists sync_state (tabela text primary key, cursor text)`,
];

export async function prepararBanco(db: BancoLocal) {
  for (const sql of SCHEMA_LOCAL) await db.executar(sql);
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
