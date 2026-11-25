-- Fase 2 · Etapa 2: lembretes. Notas e repetição (mesmo formato de tasks.recurrence).
-- Lembrete fixo é uma linha só: concluir leva `remind_at` para a próxima ocorrência (mesma hora).
alter table public.reminders add column if not exists notes text;
alter table public.reminders add column if not exists recurrence jsonb;
alter table public.reminders drop constraint if exists reminders_recurrence_check;
alter table public.reminders add constraint reminders_recurrence_check check (
  recurrence is null
  or (jsonb_typeof(recurrence) = 'object'
      and recurrence->>'freq' in ('diaria', 'dias_uteis', 'fim_de_semana', 'semanal', 'mensal'))
);
