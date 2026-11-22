-- J.A.R.V.I.S. · Fase 1 · memória
-- A IA guarda fatos e preferências do dono em `memories` (tabela da 0001) e busca as
-- relevantes antes de responder. Busca de texto em português, sem acento, sem embeddings
-- (custa zero e nada sai do banco).

create extension if not exists unaccent with schema extensions;

-- unaccent não é "immutable" (o dicionário pode mudar); este invólucro fixa o dicionário
-- para poder ser usado na coluna gerada e no índice.
create or replace function public.sem_acento(texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(texto, ''));
$$;

alter table public.memories
  add column sensitive boolean not null default false,
  add column source_message_id uuid references public.messages (id) on delete set null,
  add column busca tsvector generated always as (
    to_tsvector('portuguese', public.sem_acento(coalesce(title, '') || ' ' || content))
  ) stored;

create index memories_busca_idx on public.memories using gin (busca);

-- Memórias mais parecidas com `consulta` (qualquer palavra conta; as mais raras pesam mais).
-- security invoker: roda com a RLS de quem chamou, então cada um só acha as próprias.
create or replace function public.buscar_memorias(consulta text, limite integer default 8)
returns setof public.memories
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
  select m.*
  from public.memories m, q
  where m.deleted_at is null
    and m.busca @@ q.tsq
  order by ts_rank(m.busca, q.tsq) desc, m.importance desc, m.updated_at desc
  limit least(greatest(limite, 1), 30);
$$;
