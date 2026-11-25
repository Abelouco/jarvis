-- J.A.R.V.I.S. · Fase 1 · memória de pesquisas
-- Cada pesquisa na web que deu resposta (citou fontes) fica guardada com os trechos encontrados.
-- Numa pergunta parecida, a IA reaproveita esses trechos em vez de pesquisar de novo:
-- resposta mais rápida e zero créditos do Tavily. Assunto sensível nunca é pesquisado nem guardado.
-- Não gera linha em `events`: é cache interno, não entidade do dono (não pulsa o cérebro).

create table public.web_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question    text not null,
  queries     text not null default '', -- as consultas feitas, uma por linha
  results     jsonb not null default '[]'::jsonb,
  reused      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  busca       tsvector generated always as (
    to_tsvector('portuguese', public.sem_acento(question || ' ' || queries))
  ) stored
);

create index web_searches_busca_idx on public.web_searches using gin (busca);
create index web_searches_user_updated_idx on public.web_searches (user_id, updated_at);
create trigger web_searches_updated_at before update on public.web_searches
  for each row execute function public.set_updated_at();

alter table public.web_searches enable row level security;
create policy web_searches_owner on public.web_searches for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Pesquisas guardadas mais parecidas com `consulta` (últimos 90 dias). security invoker: RLS de quem chamou.
create or replace function public.buscar_pesquisas(consulta text, limite integer default 3)
returns table (id uuid, question text, queries text, created_at timestamptz, rank real)
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
  select w.id, w.question, w.queries, w.created_at, ts_rank(w.busca, q.tsq) as rank
  from public.web_searches w, q
  where w.deleted_at is null
    and w.created_at > now() - interval '90 days'
    and w.busca @@ q.tsq
  order by ts_rank(w.busca, q.tsq) desc, w.created_at desc
  limit least(greatest(limite, 1), 5);
$$;
