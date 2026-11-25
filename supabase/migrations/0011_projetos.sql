-- Fase 2 · Etapa 3: projetos. A tabela `projects` já existe desde a 0001.
-- Aqui entram os marcos (etapas do projeto, com data-alvo) e o quadro das tarefas:
--   tasks.milestone_id  -> a qual marco a tarefa pertence (opcional)
--   tasks.board_column  -> coluna do quadro: 'a_fazer' ou 'fazendo' (concluída = done_at preenchido)

create table if not exists public.project_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null,
  due_date    date,
  done_at     timestamptz,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists project_milestones_user_updated_idx on public.project_milestones (user_id, updated_at);
create index if not exists project_milestones_project_idx      on public.project_milestones (project_id);

create trigger project_milestones_updated_at before update on public.project_milestones
  for each row execute function public.set_updated_at();
create trigger project_milestones_event after insert or update or delete on public.project_milestones
  for each row execute function public.log_entity_event();

alter table public.project_milestones enable row level security;
create policy project_milestones_owner on public.project_milestones for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.project_milestones;

alter table public.tasks add column if not exists milestone_id uuid
  references public.project_milestones (id) on delete set null;
alter table public.tasks add column if not exists board_column text not null default 'a_fazer';
alter table public.tasks drop constraint if exists tasks_board_column_check;
alter table public.tasks add constraint tasks_board_column_check check (board_column in ('a_fazer', 'fazendo'));
create index if not exists tasks_milestone_idx on public.tasks (milestone_id);

-- Lista de projetos abertos (o planejador da IA lê os nomes).
create index if not exists projects_user_open_idx on public.projects (user_id, updated_at desc)
  where deleted_at is null and archived = false;
