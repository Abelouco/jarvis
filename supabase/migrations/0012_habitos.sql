-- Fase 2 · Etapa 4: hábitos. As tabelas `habits` e `habit_logs` já existem desde a 0001
-- (com RLS, updated_at, eventos e realtime). Aqui entra o que falta para a paridade com o Néctar:
--   times_per_week -> "3 vezes por semana" (qualquer dia); nulo = pelos dias de `weekdays` (ou todo dia)
--   monthly_target -> meta de vezes no mês (opcional)
--   time_of_day    -> horário do hábito (o app avisa se ainda não foi feito)
--   color, position -> aparência e ordem na lista
-- O registro do dia (`habit_logs`) é um por hábito por dia; desmarcar = exclusão suave.
-- O id do registro é derivado de (habit_id, day), igual no app e no servidor, para dois aparelhos
-- marcarem o mesmo dia sem bater na unique (habit_id, day).

alter table public.habits add column if not exists times_per_week smallint;
alter table public.habits drop constraint if exists habits_times_per_week_check;
alter table public.habits add constraint habits_times_per_week_check check (times_per_week between 1 and 7);
alter table public.habits add column if not exists monthly_target smallint;
alter table public.habits drop constraint if exists habits_monthly_target_check;
alter table public.habits add constraint habits_monthly_target_check check (monthly_target between 1 and 31);
alter table public.habits add column if not exists time_of_day time;
alter table public.habits add column if not exists color text not null default 'verde_agua';
alter table public.habits add column if not exists position double precision not null default 0;

create index if not exists habit_logs_habit_day_idx on public.habit_logs (habit_id, day);
