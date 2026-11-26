-- Fase 2 · Etapa 5: conhecimento (paridade com o Néctar).
-- `notes` guarda o que o DONO escreve: notas (com caderno e etiquetas), capturas (caixa de entrada
-- rápida, para organizar depois) e o diário (uma entrada por dia). Fica separado de `memories`,
-- que é o que a IA aprende sozinha sobre o dono (a IA nunca reescreve uma nota por conta própria).
-- Busca de texto em português sem acento, como as memórias (custo zero, nada sai do banco).
-- O id da entrada do diário é derivado de (dono, dia), igual no app e no servidor, para dois
-- aparelhos escreverem no mesmo dia sem bater no índice único.

-- array_to_string não é "immutable"; este invólucro permite usar as etiquetas na coluna gerada.
create or replace function public.juntar_etiquetas(etiquetas text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_to_string(etiquetas, ' '), '');
$$;

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null default 'nota' check (kind in ('nota', 'captura', 'diario')),
  title       text,
  content     text not null default '',
  notebook    text,
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  day         date,
  sensitive   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint notes_diario_tem_dia check (kind <> 'diario' or day is not null),
  busca tsvector generated always as (
    to_tsvector('portuguese', public.sem_acento(
      coalesce(title, '') || ' ' || coalesce(notebook, '') || ' ' || content || ' ' || public.juntar_etiquetas(tags)
    ))
  ) stored
);

create unique index if not exists notes_diario_dia_idx on public.notes (user_id, day)
  where kind = 'diario' and deleted_at is null;
create index if not exists notes_busca_idx on public.notes using gin (busca);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at);

alter table public.notes enable row level security;
drop policy if exists notes_dono on public.notes;
create policy notes_dono on public.notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes for each row execute function public.set_updated_at();
drop trigger if exists notes_event on public.notes;
create trigger notes_event after insert or update or delete on public.notes for each row execute function public.log_entity_event();

alter publication supabase_realtime add table public.notes;

-- Notas mais parecidas com `consulta` (qualquer palavra conta; as mais raras pesam mais).
create or replace function public.buscar_notas(consulta text, limite integer default 10)
returns table (id uuid, kind text, title text, content text, notebook text, tags text[], day date, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery(
      'portuguese',
      regexp_replace(trim(public.sem_acento(consulta)), '\s+', ' or ', 'g')
    ) as tsq
  )
  select n.id, n.kind, n.title, n.content, n.notebook, n.tags, n.day, n.updated_at
  from public.notes n, q
  where n.deleted_at is null
    and n.busca @@ q.tsq
  order by ts_rank(n.busca, q.tsq) desc, n.updated_at desc
  limit least(greatest(limite, 1), 30);
$$;
