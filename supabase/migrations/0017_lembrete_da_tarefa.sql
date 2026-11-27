-- Fase 4 · Etapa 2: lembrete na criação de tarefa.
-- O lembrete que nasce de uma tarefa guarda o vínculo. Concluir ou apagar a tarefa leva o lembrete junto
-- e mudar o prazo leva o lembrete junto (mesma antecedência). Quem faz isso: o app (banco local) e a IA.
alter table public.reminders add column if not exists task_id uuid references public.tasks (id);
create index if not exists reminders_task_idx on public.reminders (task_id) where task_id is not null;
