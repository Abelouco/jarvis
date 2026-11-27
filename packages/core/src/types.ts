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

/** Coluna do quadro do projeto (concluída = `done_at`). */
export type ColunaQuadro = 'a_fazer' | 'fazendo';

export interface Task extends Base {
  project_id: string | null;
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
  /** Tarefa de onde o lembrete nasceu: concluir, apagar ou mudar o prazo dela leva o lembrete junto. */
  task_id: string | null;
}

/** "Me lembrar" ao criar uma tarefa: X minutos antes do prazo, ou numa data e hora certas. */
export type LembrarTarefa = { antes_minutos: number; alarme?: boolean } | { data: string | null; hora: string; alarme?: boolean };

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

// ---------- avisos (Fase 3): só no servidor, a tela lê direto do Supabase ----------
export type TipoAviso =
  | 'tarefa_atrasada' | 'lembrete_hora' | 'prazo_projeto' | 'resumo_manha' | 'resumo_noite';

/** Aviso que o vigia deu (ou segurou), com o motivo. */
export interface Notice {
  id: string;
  kind: TipoAviso;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string;
  reason: string;
  priority: 'urgente' | 'normal' | 'baixa';
  status: 'enviado' | 'segurado_silencio' | 'juntado' | 'silenciado' | 'agendado';
  /** 'pc', 'pc_local' (o app avisou sozinho) e/ou 'push' (celular) */
  channels: string[];
  scheduled_for: string | null;
  sent_at: string | null;
  read_at: string | null;
  group_id: string | null;
  created_at: string;
}

/** Preferências dos avisos (uma linha por dono). Horas "HH:MM:SS". */
export interface NoticeSettings {
  id: string;
  enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  morning_at: string;
  evening_at: string;
}

/** Regra pedida pelo dono: desligar, silenciar até, ou avisar só numa hora. entity_id = um item só. */
export interface NoticeRule {
  id: string;
  kind: TipoAviso;
  entity_id: string | null;
  active: boolean;
  fixed_time: string | null;
  muted_until: string | null;
  note: string | null;
}
