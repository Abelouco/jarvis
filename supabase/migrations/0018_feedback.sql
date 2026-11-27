-- Fase 4 · Etapa 3: like e deslike que viram lição. Desenho em docs/fase4-acoes.md.
-- message_feedback  -> o like/deslike do dono numa resposta (deslike traz o motivo)
-- assistant_lessons -> o que o J.A.R.V.I.S. aprendeu: "evitar" (de um deslike) ou "manter" (de vários likes)
-- As lições ativas entram no prompt (ia_conversar); `hits` conta quantas vezes entraram.

create table if not exists public.assistant_lessons (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson             text not null check (char_length(lesson) between 3 and 400),
  kind               text not null check (kind in ('evitar', 'manter')),
  scope              text not null default 'geral' check (scope in ('geral', 'tarefas', 'lembretes', 'projetos', 'avisos', 'pesquisa')),
  source_feedback_id uuid,
  active             boolean not null default true,
  hits               integer not null default 0,
  last_used_at       timestamptz,
  sensitive          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists assistant_lessons_ativas_idx on public.assistant_lessons (user_id)
  where active and deleted_at is null;

create table if not exists public.message_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id      uuid not null references public.messages (id),
  conversation_id uuid not null references public.conversations (id),
  rating          text not null check (rating in ('like', 'dislike')),
  reason          text check (reason is null or char_length(reason) <= 1000),
  lesson_id       uuid references public.assistant_lessons (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint message_feedback_unico unique (user_id, message_id)
);
create index if not exists message_feedback_conversa_idx on public.message_feedback (conversation_id);

alter table public.assistant_lessons drop constraint if exists assistant_lessons_feedback_fk;
alter table public.assistant_lessons add constraint assistant_lessons_feedback_fk
  foreign key (source_feedback_id) references public.message_feedback (id);

-- ---------- RLS, updated_at, eventos, realtime ----------
do $$
declare t text;
begin
  foreach t in array array['assistant_lessons', 'message_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_dono', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_dono', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('drop trigger if exists %I on public.%I', t || '_event', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_entity_event()', t || '_event', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Lições usadas numa resposta: conta o uso (o nó da lição pulsa no núcleo pelo evento de update).
create or replace function public.usar_licoes(ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.assistant_lessons
     set hits = hits + 1, last_used_at = now()
   where id = any(ids) and user_id = (select auth.uid());
$$;
grant execute on function public.usar_licoes(uuid[]) to authenticated;
