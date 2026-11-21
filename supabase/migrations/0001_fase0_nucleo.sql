-- J.A.R.V.I.S. · Fase 0 · núcleo de dados
-- Regras: toda tabela tem user_id (RLS por dono), updated_at e deleted_at
-- (exclusão suave) para a sincronização local-first puxar "o que mudou desde X".

-- ---------- utilidades ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- projetos ----------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  description text,
  priority    text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  status      text not null default 'planejamento' check (status in ('planejamento', 'em_andamento', 'pausado', 'concluido')),
  due_date    date,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- tarefas ----------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete set null,
  title       text not null,
  notes       text,
  priority    text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  due_date    date,
  due_time    time,
  done_at     timestamptz,
  archived    boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- lembretes ----------
create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  remind_at   timestamptz not null,
  channel     text not null default 'app' check (channel in ('app', 'whatsapp', 'telegram', 'email')),
  priority    text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  alarm       boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- hábitos ----------
create table public.habits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null,
  kind          text not null default 'boolean' check (kind in ('boolean', 'duration', 'quantity')),
  unit          text,
  daily_target  numeric,
  weekdays      smallint[],          -- 0 = domingo ... 6 = sábado; nulo = todo dia
  paused        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.habit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id    uuid not null references public.habits (id) on delete cascade,
  day         date not null,
  value       numeric,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (habit_id, day)
);

-- ---------- memória (o grafo do cérebro) ----------
create table public.memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null default 'nota' check (kind in ('fato', 'preferencia', 'nota', 'captura', 'diario')),
  title       text,
  content     text not null,
  tags        text[] not null default '{}',
  importance  smallint not null default 5 check (importance between 1 and 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.memory_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id   uuid not null references public.memories (id) on delete cascade,
  target_id   uuid not null references public.memories (id) on delete cascade,
  kind        text not null default 'related' check (kind in ('related', 'extends', 'contradicts', 'supports', 'references', 'derived', 'inspired')),
  strength    real not null default 0.5 check (strength between 0 and 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (source_id, target_id, kind)
);

-- ---------- eventos (alimentam os pulsos do cérebro) ----------
create table public.events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null,          -- ex.: created, updated, deleted, thinking, tool_call, notify
  entity_type  text,
  entity_id    uuid,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- ---------- confirmação (prévia + código) e desfazer (24 h) ----------
create table public.pending_confirmations (
  code        text primary key check (code ~ '^cf_[A-Za-z0-9_-]{16,40}$'),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action      text not null,
  args_hash   text not null,
  preview     jsonb not null,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.undo_receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  irreversible  boolean not null default false,
  expires_at    timestamptz not null default now() + interval '24 hours',
  undone_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------- índices (sync por usuário + data de mudança) ----------
create index projects_user_updated_idx      on public.projects (user_id, updated_at);
create index tasks_user_updated_idx         on public.tasks (user_id, updated_at);
create index tasks_project_idx              on public.tasks (project_id);
create index reminders_user_updated_idx     on public.reminders (user_id, updated_at);
create index reminders_user_remind_idx      on public.reminders (user_id, remind_at) where done_at is null and deleted_at is null;
create index habits_user_updated_idx        on public.habits (user_id, updated_at);
create index habit_logs_user_updated_idx    on public.habit_logs (user_id, updated_at);
create index memories_user_updated_idx      on public.memories (user_id, updated_at);
create index memory_links_user_updated_idx  on public.memory_links (user_id, updated_at);
create index memory_links_source_idx        on public.memory_links (source_id);
create index memory_links_target_idx        on public.memory_links (target_id);
create index events_user_created_idx        on public.events (user_id, created_at desc);
create index pending_conf_user_idx          on public.pending_confirmations (user_id);
create index undo_receipts_user_idx         on public.undo_receipts (user_id, created_at desc);

-- ---------- updated_at automático ----------
create trigger projects_updated_at     before update on public.projects     for each row execute function public.set_updated_at();
create trigger tasks_updated_at        before update on public.tasks        for each row execute function public.set_updated_at();
create trigger reminders_updated_at    before update on public.reminders    for each row execute function public.set_updated_at();
create trigger habits_updated_at       before update on public.habits       for each row execute function public.set_updated_at();
create trigger habit_logs_updated_at   before update on public.habit_logs   for each row execute function public.set_updated_at();
create trigger memories_updated_at     before update on public.memories     for each row execute function public.set_updated_at();
create trigger memory_links_updated_at before update on public.memory_links for each row execute function public.set_updated_at();

-- ---------- toda mudança vira um evento (pulso no cérebro) ----------
create or replace function public.log_entity_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rec  record;
  ev   text;
begin
  if tg_op = 'DELETE' then
    rec := old; ev := 'deleted';
  else
    rec := new;
    ev := case
      when tg_op = 'INSERT' then 'created'
      when new.deleted_at is not null and old.deleted_at is null then 'deleted'
      else 'updated'
    end;
  end if;
  insert into public.events (user_id, kind, entity_type, entity_id)
  values (rec.user_id, ev, tg_table_name, rec.id);
  return null;
end;
$$;

create trigger projects_event     after insert or update or delete on public.projects     for each row execute function public.log_entity_event();
create trigger tasks_event        after insert or update or delete on public.tasks        for each row execute function public.log_entity_event();
create trigger reminders_event    after insert or update or delete on public.reminders    for each row execute function public.log_entity_event();
create trigger habits_event       after insert or update or delete on public.habits       for each row execute function public.log_entity_event();
create trigger habit_logs_event   after insert or update or delete on public.habit_logs   for each row execute function public.log_entity_event();
create trigger memories_event     after insert or update or delete on public.memories     for each row execute function public.log_entity_event();
create trigger memory_links_event after insert or update or delete on public.memory_links for each row execute function public.log_entity_event();

-- ---------- segurança: cada um só vê e muda o que é seu ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'tasks', 'reminders', 'habits', 'habit_logs',
    'memories', 'memory_links', 'events', 'pending_confirmations', 'undo_receipts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_owner', t
    );
  end loop;
end;
$$;

-- ---------- tempo real (o app escuta e o cérebro pulsa) ----------
alter publication supabase_realtime add table
  public.events, public.projects, public.tasks, public.reminders,
  public.habits, public.habit_logs, public.memories, public.memory_links;
