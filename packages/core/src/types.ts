// Espelho do schema em supabase/migrations/0001_fase0_nucleo.sql.
// Mais tarde: gerar automaticamente com `supabase gen types`.

export type Prioridade = 'alta' | 'media' | 'baixa';

/** Campos que toda tabela tem (regra do banco). */
export interface Base {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type StatusProjeto = 'planejamento' | 'em_andamento' | 'pausado' | 'concluido';

export interface Project extends Base {
  name: string;
  description: string | null;
  priority: Prioridade;
  status: StatusProjeto;
  due_date: string | null; // AAAA-MM-DD
  archived: boolean;
}

/** Etapa de um projeto, com data-alvo. */
export interface Milestone extends Base {
  project_id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
  position: number;
}

/** Coluna do quadro do projeto (concluída = `done_at`). */
export type ColunaQuadro = 'a_fazer' | 'fazendo';

export interface Task extends Base {
  project_id: string | null;
  milestone_id: string | null;
  board_column: ColunaQuadro;
  title: string;
  notes: string | null;
  priority: Prioridade;
  due_date: string | null; // AAAA-MM-DD
  due_time: string | null; // HH:MM
  recurrence: import('./recorrencia').Recorrencia | null;
  done_at: string | null;
  archived: boolean;
  position: number;
}

export interface Reminder extends Base {
  title: string;
  notes: string | null;
  /** instante ISO (UTC) */
  remind_at: string;
  channel: string;
  priority: Prioridade;
  alarm: boolean;
  recurrence: import('./recorrencia').Recorrencia | null;
  done_at: string | null;
}

export interface Conversation extends Base {
  title: string | null;
}

/** Página da web usada numa resposta com pesquisa. */
export interface Fonte {
  titulo: string;
  url: string;
}

export interface Message extends Base {
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: 'groq' | 'gemini' | null;
  model: string | null;
  latency_ms: number | null;
  sensitive: boolean;
  /** Fontes da pesquisa na web (só nas respostas que pesquisaram). */
  sources: Fonte[] | null;
}

/** Algo que o J.A.R.V.I.S. aprendeu sobre o dono. */
export interface Memory extends Base {
  kind: 'fato' | 'preferencia' | 'nota' | 'captura' | 'diario';
  title: string | null;
  content: string;
  importance: number;
  sensitive: boolean;
}

export interface JarvisEvent {
  id: number;
  user_id: string;
  kind: string; // created, updated, deleted, thinking, tool_call, notify
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Hábito: constância (feito ou não, minutos ou quantidade por dia). */
export interface Habit extends Base {
  name: string;
  kind: 'boolean' | 'duration' | 'quantity';
  unit: string | null;
  daily_target: number | null;
  /** 0 = domingo ... 6 = sábado; nulo = todo dia */
  weekdays: number[] | null;
  times_per_week: number | null;
  monthly_target: number | null;
  /** HH:MM (o servidor devolve HH:MM:SS) */
  time_of_day: string | null;
  color: string;
  position: number;
  paused: boolean;
}

/** Registro de um hábito num dia (um por dia; desmarcar = deleted_at). */
export interface HabitLog extends Base {
  habit_id: string;
  day: string;
  value: number | null;
  note: string | null;
}
