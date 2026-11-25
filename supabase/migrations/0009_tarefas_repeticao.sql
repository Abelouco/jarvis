-- Tarefas fixas (que se repetem). Formato:
--   {"freq": "diaria"|"dias_uteis"|"fim_de_semana"|"semanal"|"mensal",
--    "dias": [0..6] (semanal; 0 = domingo), "dia_mes": 1..31 (mensal), "ate": "AAAA-MM-DD" | null}
-- A tarefa fixa é uma linha só: concluir uma ocorrência leva `due_date` para a próxima data.
alter table public.tasks add column if not exists recurrence jsonb;

alter table public.tasks drop constraint if exists tasks_recurrence_check;
alter table public.tasks add constraint tasks_recurrence_check check (
  recurrence is null
  or (jsonb_typeof(recurrence) = 'object'
      and recurrence->>'freq' in ('diaria', 'dias_uteis', 'fim_de_semana', 'semanal', 'mensal'))
);
